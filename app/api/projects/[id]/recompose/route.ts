import { NextResponse } from 'next/server';
import { getUserFromRequest } from '@/app/api/auth/lib';
import { getOwnedProject } from '@/lib/repos/project-repo';
import { listAssetsByType, upsertAsset } from '@/lib/repos/asset-repo';
import { dimsForAspect } from '@/lib/video-reframe';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * v12.50.0 — 复用现有镜头「重新合成成片」(不重生视频,省 AI/时间)。
 *
 * 用途:换画幅(横→竖)、丢掉个别坏镜、加结构化片尾卡后,**用已生成的逐镜视频重新走 composer**
 * 产出新成片并存回 final_video。比整片重跑快一个量级,且确定性(纯本地 ffmpeg,不碰生成引擎)。
 *
 * POST { aspect?, keepShots?: number[], dropShots?: number[], endCard?: {title?, slogan?, durationSec?, bg?} }
 *   - 属主守卫(需登录 + 是本人项目)
 *   - 从 video/script/music/timeline 资产重建 composer 输入,filter keep/drop
 *   - composeVideo(aspect 生效)→ appendEndCard(可选)→ upsert final_video(幂等替换)
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const payload = getUserFromRequest(request);
  if (!payload) return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
  if (!(await getOwnedProject(id, payload.sub))) return NextResponse.json({ message: 'Forbidden' }, { status: 403 });

  const body = await request.json().catch(() => ({} as any));
  const aspect: string = typeof body?.aspect === 'string' ? body.aspect : '16:9';
  const keepShots: number[] | undefined = Array.isArray(body?.keepShots) ? body.keepShots.map(Number) : undefined;
  const dropShots: Set<number> = new Set((Array.isArray(body?.dropShots) ? body.dropShots : []).map(Number));
  const endCard = body?.endCard && typeof body.endCard === 'object' ? body.endCard : undefined;
  const regenVoiceover: boolean = body?.regenVoiceover === true; // 重生 TTS(原配音临时音频过期时自愈)
  const captionStyle = ['clean', 'social', 'bold', 'karaoke'].includes(body?.captionStyle) ? body.captionStyle : undefined; // v12.52.0/54 字幕风格
  const platform = ['douyin', 'xiaohongshu', 'none'].includes(body?.platform) ? body.platform : undefined; // v12.79 平台安全区

  const origin = new URL(request.url).origin;
  const fullUrl = (u: string | null | undefined): string => {
    if (!u) return '';
    return u.startsWith('/api/serve-file') ? origin + u : u;
  };

  // ── 重建 composer 输入(复用已生成资产)──
  const [videoAssets, scriptAssets, musicAssets, timelineAssets] = await Promise.all([
    listAssetsByType(id, 'video'),
    listAssetsByType(id, 'script'),
    listAssetsByType(id, 'music'),
    listAssetsByType(id, 'timeline'),
  ]);
  if (videoAssets.length === 0) return NextResponse.json({ message: '该项目没有可复用的镜头视频' }, { status: 400 });

  const parse = (s: string | null): any => { try { return s ? JSON.parse(s) : {}; } catch { return {}; } };
  const scriptShots: any[] = parse(scriptAssets[0]?.data)?.shots || [];
  const dlg = new Map<number, { dialogue?: string; transition?: string; duration?: number }>();
  for (const s of scriptShots) dlg.set(s.shotNumber, { dialogue: s.dialogue, transition: s.transition, duration: s.duration });

  const clips = videoAssets
    .map((v) => {
      const shotNumber = v.shot_number ?? 0;
      const meta = parse(v.data);
      const sc = dlg.get(shotNumber) || {};
      return {
        shotNumber,
        videoUrl: fullUrl(v.persistent_url || parse(v.media_urls)?.[0] || ''),
        duration: meta?.duration || sc.duration || 4,
        transition: sc.transition || 'cut',
        dialogue: sc.dialogue || '',
      };
    })
    .filter((c) => c.videoUrl && (!keepShots || keepShots.includes(c.shotNumber)) && !dropShots.has(c.shotNumber))
    .sort((a, b) => a.shotNumber - b.shotNumber);

  if (clips.length === 0) return NextResponse.json({ message: 'keep/drop 过滤后无可用镜头' }, { status: 400 });

  // v12.80.0 合规守卫全覆盖:带 hookCard/endCard/hookVariants = 广告场景 → 台词(烧字幕+TTS)、
  // 卡文案、变体标题全过《广告法》净化(v12.65 只盖主管线 Writer 出口,recompose 入口一直绕过;
  // 老项目 recompose 也借此补净化)。纯剧情片(无卡)不动。
  {
    const isAdContext = !!(body?.hookCard?.title || body?.endCard?.title || body?.endCard?.slogan || (Array.isArray(body?.hookVariants) && body.hookVariants.length));
    if (isAdContext) {
      const { sanitizeAdCopy } = await import('@/lib/ad-compliance');
      let hits = 0;
      for (const c of clips) {
        if (!c.dialogue) continue;
        const r = sanitizeAdCopy(c.dialogue);
        if (r.hits.length) { c.dialogue = r.text; hits += r.hits.length; }
      }
      for (const card of [body?.hookCard, body?.endCard, ...(Array.isArray(body?.hookVariants) ? body.hookVariants : [])]) {
        if (!card) continue;
        for (const k of ['title', 'slogan'] as const) {
          if (typeof card[k] === 'string' && card[k]) {
            const r = sanitizeAdCopy(card[k]);
            if (r.hits.length) { card[k] = r.text; hits += r.hits.length; }
          }
        }
      }
      if (hits > 0) console.warn(`[recompose] v12.80 广告合规净化 ${hits} 处(台词/卡文案/变体)`);
    }
  }

  const musicUrl = fullUrl(musicAssets[0]?.persistent_url || parse(musicAssets[0]?.media_urls)?.[0] || '');
  const keepSet = new Set(clips.map((c) => c.shotNumber));

  let voiceoverClips: Array<{ shotNumber: number; audioUrl: string }> = [];
  if (regenVoiceover) {
    // 重生 TTS:为有台词的镜逐条生成配音(原 timeline 的 TTS 临时音频过期/丢失时用)。
    // audioUrl 可能是 data:/serve-file?path=,composeVideo 在同进程 downloadFile 直接处理,无需 origin 前缀。
    await import('@/lib/tts-providers/builtins'); // 注册 TTS provider(否则 dispatch 链为空 → 0 配音)
    const { dispatchTTSGenerate } = await import('@/lib/tts-providers/registry');
    const { ttsLangCode } = await import('@/lib/language-detect');
    for (const c of clips) {
      const line = (c.dialogue || '').trim();
      if (!line) continue;
      try {
        const d = await dispatchTTSGenerate({ text: line, voiceId: 'female-zh', language: ttsLangCode('zh') });
        if (d.result?.audioUrl) voiceoverClips.push({ shotNumber: c.shotNumber, audioUrl: d.result.audioUrl });
      } catch (e) { console.warn(`[recompose] TTS 重生失败 shot ${c.shotNumber}:`, e instanceof Error ? e.message : e); }
    }
  } else {
    const voSrc: any[] = parse(timelineAssets[0]?.data)?.voiceoverClips || [];
    voiceoverClips = voSrc
      .filter((vo) => keepSet.has(vo.shotNumber) && vo.audioUrl)
      .map((vo) => ({ shotNumber: vo.shotNumber, audioUrl: fullUrl(vo.audioUrl) }));
  }

  // ── 合成 ──
  const { composeVideo, appendEndCard, prependHookCard } = await import('@/services/video-composer');
  const result = await composeVideo({
    clips,
    aspect,                                  // v12.49.0 画布跟画幅
    captionStyle,                            // v12.52.0 字幕风格预设(社媒大字等)
    platform,                                // v12.79.0 平台安全区避让
    musicUrl: musicUrl || undefined,
    voiceoverClips: voiceoverClips.length > 0 ? voiceoverClips : undefined,
    musicVolume: voiceoverClips.length > 0 ? 0.2 : 0.3,
    voiceoverVolume: 0.9,
  });

  const { w, h } = dimsForAspect(aspect);
  const hookCard = body?.hookCard && typeof body.hookCard === 'object' ? body.hookCard : undefined;
  let outputPath = result.outputPath;
  let hookAppended = false;
  let cardAppended = false;
  if (hookCard && hookCard.title) {
    const hk = await prependHookCard(outputPath, {
      title: hookCard.title, slogan: hookCard.slogan, accentColor: hookCard.accentColor,
      w, h, durationSec: hookCard.durationSec, bg: hookCard.bg === 'solid' ? 'solid' : 'blur',
    });
    outputPath = hk.outputPath;
    hookAppended = hk.appended;
  }
  if (endCard && (endCard.title || endCard.slogan)) {
    const card = await appendEndCard(outputPath, {
      title: endCard.title, slogan: endCard.slogan, accentColor: endCard.accentColor,
      w, h, durationSec: endCard.durationSec, bg: endCard.bg === 'solid' ? 'solid' : 'blur',
    });
    outputPath = card.outputPath;
    cardAppended = card.appended;
  }

  // v12.69.0 批量 Hook 变体(A/B):同一主体成片 + N 个不同 Hook 开场(≤3),每变体独立落
  // ab_variant 资产(shotNumber=序号)。主成片(上方 hookCard/endCard 链)不受影响。
  const hookVariants: Array<{ title: string; slogan?: string; durationSec?: number }> =
    (Array.isArray(body?.hookVariants) ? body.hookVariants : [])
      .filter((v: any) => v && typeof v.title === 'string' && v.title.trim())
      .slice(0, 3);
  const variants: Array<{ title: string; url: string }> = [];
  for (let vi = 0; vi < hookVariants.length; vi++) {
    const hv = hookVariants[vi];
    try {
      let vPath = result.outputPath; // 变体基于「无卡」主体成片
      const hk = await prependHookCard(vPath, { title: hv.title, slogan: hv.slogan, w, h, durationSec: hv.durationSec, bg: 'blur' });
      vPath = hk.outputPath;
      if (endCard && (endCard.title || endCard.slogan)) {
        const ec = await appendEndCard(vPath, { title: endCard.title, slogan: endCard.slogan, w, h, durationSec: endCard.durationSec, bg: endCard.bg === 'solid' ? 'solid' : 'blur' });
        vPath = ec.outputPath;
      }
      const vUrl = `/api/serve-file?path=${encodeURIComponent(vPath)}`;
      await upsertAsset({
        projectId: id, type: 'ab_variant', name: `Hook变体${vi + 1}: ${hv.title.slice(0, 20)}`,
        data: { hookTitle: hv.title, aspect, width: w, height: h }, mediaUrls: [vUrl], persistentUrl: vUrl, shotNumber: vi + 1,
      });
      variants.push({ title: hv.title, url: vUrl });
    } catch (e) {
      console.warn(`[recompose] Hook 变体 ${vi + 1} 失败(跳过):`, e instanceof Error ? e.message : e);
    }
  }

  const serveUrl = `/api/serve-file?path=${encodeURIComponent(outputPath)}`;
  await upsertAsset({
    projectId: id, type: 'final_video', name: '最终成片',
    data: { duration: result.totalDuration, hasBgm: result.hasMusic, hasVoiceover: result.hasVoiceover, audible: !!(result.hasMusic || result.hasVoiceover), aspect, width: w, height: h, recomposed: true, hookCard: hookAppended, endCard: cardAppended },
    mediaUrls: [serveUrl], persistentUrl: serveUrl,
  });

  return NextResponse.json({ ok: true, finalVideoUrl: serveUrl, width: w, height: h, clips: clips.length, voiceover: voiceoverClips.length, hookCard: hookAppended, endCard: cardAppended, variants: variants.length > 0 ? variants : undefined });
}
