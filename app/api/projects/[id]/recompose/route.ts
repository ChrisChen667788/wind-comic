import { filterReachable, isMediaReachable } from '@/lib/media-reachable';
import { pickShotVoice } from '@/lib/shot-voice';
import { pickScriptAsset } from '@/lib/script-asset';
import { NextResponse } from 'next/server';
import { serveFilePathUrl } from '@/lib/serve-file-sign';
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
  let scriptFellBackFrom: string | null = null;
  // v12.381:按目标语种选剧本,而不是「取第一条」。
  // v12.187 给本端点加了 body.language 让 TTS 按语种发音,但**台词来源没跟着切** ——
  // 传 language:'en' 的结果是用英语嗓念中文台词,烧上去的字幕也还是中文。
  const scriptPick = pickScriptAsset(scriptAssets, body?.language);
  if (scriptPick.fellBack) {
    // 静默降级正是本系列一直在消灭的东西:选了英语却出中文片,得让调用方知道
    console.warn(`[recompose] 没有 ${scriptPick.requested} 版剧本,已回退主稿 —— 台词与字幕将是主稿语种,未必是所请求的语种`);
  }
  scriptFellBackFrom = scriptPick.fellBack ? scriptPick.requested : null;
  const scriptShots: any[] = parse(scriptPick.row?.data ?? null)?.shots || [];
  const dlg = new Map<number, { dialogue?: string; transition?: string; duration?: number; speaker?: string; characters?: unknown }>();
  for (const s of scriptShots) dlg.set(s.shotNumber, { dialogue: s.dialogue, transition: s.transition, duration: s.duration, speaker: s.speaker, characters: s.characters });

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
        speaker: sc.speaker,          // v12.374:配音重生要知道谁在说
        characters: sc.characters,
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

  // v12.184:自定义 BGM(body.bgmUrl,http/站内)优先于项目 music 资产 —— 用户上传/外链换曲即重合成
  const customBgm = typeof body?.bgmUrl === 'string' && /^(https?:|\/api\/serve-file)/.test(body.bgmUrl) ? body.bgmUrl : '';
  // v12.379:**在候选里挑一条可达的,而不是挑第一条再看它可不可达。**
  // 原来取 musicAssets[0],而 listAssetsByType 是 `ORDER BY shot_number` ——
  // music 资产的 shot_number 全是 NULL,顺序实际由插入次序决定。
  // 项目 1 有两条:6 月那条 AI 作曲(文件早丢了)和刚上传的自备 BGM,
  // [0] 稳稳取到坏的那条,新上传的配乐永远轮不到 —— 上传了却没声音,还查不出原因。
  // v12.374 的守卫本来就能判可达性;既然能判,就该拿它来**选**,不只是用来**拒**。
  let musicDropped = false;
  const musicCandidates = [...musicAssets]
    // 新的优先:同为 NULL 的 shot_number 排不出先后,时间能
    .sort((a, b) => String(b.updated_at || b.created_at || '').localeCompare(String(a.updated_at || a.created_at || '')))
    .map((a) => a.persistent_url || parse(a.media_urls)?.[0] || '')
    .filter(Boolean);
  const musicPick = customBgm
    ? (isMediaReachable(customBgm) ? customBgm : '')
    : (filterReachable(musicCandidates, (u) => u).kept[0] || '');
  if (!musicPick && (customBgm || musicCandidates.length)) {
    musicDropped = true;
    console.warn(
      `[recompose] ${musicCandidates.length + (customBgm ? 1 : 0)} 条 BGM 候选没有一条的文件还在盘上,本次成片无背景音乐`
    );
  }
  const musicUrl = musicPick ? fullUrl(musicPick) : '';
  const keepSet = new Set(clips.map((c) => c.shotNumber));

  let voiceoverDropped = 0;
  const voiceoverFailed: Array<{ shotNumber: number; voiceId: string; error: string }> = [];
  let voiceoverClips: Array<{ shotNumber: number; audioUrl: string }> = [];
  if (regenVoiceover) {
    // 重生 TTS:为有台词的镜逐条生成配音(原 timeline 的 TTS 临时音频过期/丢失时用)。
    // audioUrl 可能是 data:/serve-file?path=,composeVideo 在同进程 downloadFile 直接处理,无需 origin 前缀。
    await import('@/lib/tts-providers/builtins'); // 注册 TTS provider(否则 dispatch 链为空 → 0 配音)
    // v12.375:音色从**全片唯一入口**领,而不是这里现挑。
    // resolveAndPersistCast 会读本项目剧本投票出的性别、把结果存下来,
    // 成片与重配单镜因此拿到同一个嗓 —— 各挑各的正是 v12.338 要防的「重配就换嗓」。
    const { resolveAndPersistCast } = await import('@/lib/voice-cast');
    const castNames = Array.from(
      new Set(
        clips
          .flatMap((c) => (Array.isArray(c.characters) ? (c.characters as unknown[]) : []))
          .filter((x): x is string => typeof x === 'string' && !!x.trim())
          .map((x) => x.trim()),
      ),
    );
    let cast: Map<string, string> | null = null;
    try {
      cast = await resolveAndPersistCast(id, castNames);
    } catch (e) {
      // 音色表是增强项,拿不到就退回按名解析,不该让整条重生链失败
      console.warn('[recompose] 取角色音色表失败,退回按名解析:', e instanceof Error ? e.message : e);
    }
    const { dispatchTTSGenerate } = await import('@/lib/tts-providers/registry');
    const { ttsLangCode } = await import('@/lib/language-detect');
    for (const c of clips) {
      const line = (c.dialogue || '').trim();
      if (!line) continue;
      // v12.374:音色在 try 外定 —— catch 里要把它一起报出来,
      // 「哪一镜、用哪个音色、报什么错」三样齐了才叫可排查。
      const voiceId = pickShotVoice(c, cast);
      try {
        // v12.187:TTS 语种可传(一键多语版:翻译稿重配即该语种配音;默认 zh 保旧)
        const { normalizeLanguage } = await import('@/lib/language-detect');
        const ttsLang = ttsLangCode(normalizeLanguage(String(body?.language || 'zh'), line));
        // v12.374:走和主管线同一套选路。原来写死的 'female-zh' 不在 VOICE_CATALOG 内,
        // MiniMax 直接回 2054 voice id not exist —— 这条重生路径至今一次都没成过。
        const d = await dispatchTTSGenerate({ text: line, voiceId, language: ttsLang });
        if (d.result?.audioUrl) {
          voiceoverClips.push({ shotNumber: c.shotNumber, audioUrl: d.result.audioUrl });
        } else {
          // v12.374:dispatch 失败**不抛错**,它返回 { result: null, tried: [...] }。
          // 原来这里只有 `if (result) push`,于是每一次失败都被无声吞掉 ——
          // 接口照样 200、配音数永远 0,连一行日志都没有。
          const why = (d.tried || []).map((t: any) => `${t.id}: ${t.error}`).join(' | ') || '无 provider 可用';
          voiceoverFailed.push({ shotNumber: c.shotNumber, voiceId, error: why });
          console.warn(`[recompose] TTS 重生无结果 shot ${c.shotNumber} (voice=${voiceId}):`, why);
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        voiceoverFailed.push({ shotNumber: c.shotNumber, voiceId, error: msg });
        console.warn(`[recompose] TTS 重生失败 shot ${c.shotNumber}:`, msg);
      }
    }
  } else {
    const voSrc: any[] = parse(timelineAssets[0]?.data)?.voiceoverClips || [];
    const inScope = voSrc.filter((vo) => keepSet.has(vo.shotNumber) && vo.audioUrl);
    // v12.374:URL 非空 ≠ 文件还在。判定放在 fullUrl() 之前 ——
    // 它会把相对路径包成 http://localhost:3000/...,包完仍指向同一个本地文件,
    // 先包再判就得多绕一层解析。少一层转换,少一个出错的地方。
    const voPick = filterReachable(inScope, (vo) => vo.audioUrl);
    voiceoverDropped = voPick.dropped.length;
    if (voiceoverDropped > 0) {
      console.warn(
        `[recompose] ${voiceoverDropped}/${inScope.length} 段配音的音频文件已不在盘上(镜头 ` +
          `${voPick.dropped.map((v) => v.shotNumber).join(',')}),已剔除。` +
          `不剔除的话 ffmpeg 会静默合出一条哑轨,而接口照样报成功。` +
          `要补回来,用 regenVoiceover 重生。`
      );
    }
    voiceoverClips = voPick.kept.map((vo) => ({ shotNumber: vo.shotNumber, audioUrl: fullUrl(vo.audioUrl) }));
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

  // v12.292:**重合成也要把成片实际转场回写 timeline 资产**。
  // v12.289 只接了 editor-agent 主路径 —— 而 EDL/AAF 导出一律以 timeline 资产为准。
  // 重合成时 selectTransitions 会按张力/关键镜重新挑(与上次 editor 的结果未必相同),
  // 不回写的话:成片已经换成 wipeleft 0.5s,剪辑线里却还写着上次的 dissolve 0.7s,越导越旧。
  try {
    const raw = timelineAssets[0]?.data;
    const tl = raw ? JSON.parse(raw) : null;
    if (tl && Array.isArray(tl.timeline)) {
      const { applyRenderedTransitions } = await import('@/lib/edit-rhythm');
      const n = applyRenderedTransitions(tl.timeline, result.renderedTransitions);
      if (n > 0) {
        // name 必须沿用原资产 —— upsertAsset 无 shotNumber 时按 {type, name} 选行,换名字会插出重复
        await upsertAsset({
          projectId: id, type: 'timeline',
          name: timelineAssets[0]?.name || '剪辑时间线', data: tl,
        });
        console.log(`[recompose] 转场回写 timeline 资产: ${n} 镜`);
      }
    }
  } catch (e) {
    console.warn('[recompose] 转场回写跳过(非阻塞):', e instanceof Error ? e.message : e);
  }

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
      const vUrl = `${serveFilePathUrl(vPath)}`;
      await upsertAsset({
        projectId: id, type: 'ab_variant', name: `Hook变体${vi + 1}: ${hv.title.slice(0, 20)}`,
        data: { hookTitle: hv.title, aspect, width: w, height: h }, mediaUrls: [vUrl], persistentUrl: vUrl, shotNumber: vi + 1,
      });
      variants.push({ title: hv.title, url: vUrl });
    } catch (e) {
      console.warn(`[recompose] Hook 变体 ${vi + 1} 失败(跳过):`, e instanceof Error ? e.message : e);
    }
  }

  const serveUrl = `${serveFilePathUrl(outputPath)}`;
  await upsertAsset({
    projectId: id, type: 'final_video', name: '最终成片',
    data: { duration: result.totalDuration, hasBgm: result.hasMusic, hasVoiceover: result.hasVoiceover, audible: !!(result.hasMusic || result.hasVoiceover), aspect, width: w, height: h, recomposed: true, hookCard: hookAppended, endCard: cardAppended },
    mediaUrls: [serveUrl], persistentUrl: serveUrl,
  });

  return NextResponse.json({ ok: true, finalVideoUrl: serveUrl, width: w, height: h, clips: clips.length, voiceover: voiceoverClips.length, voiceoverDropped, musicDropped,
      scriptFellBackFrom,   // v12.381:请求了某语种却只有中文稿时如实告知
      voiceoverFailed: voiceoverFailed.length ? voiceoverFailed : undefined, hookCard: hookAppended, endCard: cardAppended, variants: variants.length > 0 ? variants : undefined });
}
