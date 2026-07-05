/**
 * Pexels B-roll 兜底(v12.95.0,调研落地:MoneyPrinterTurbo 的免版权素材模式)。
 *
 * 病根:供给侧翻车(分镜占位/视频引擎余额尽)时,Ken Burns 静图动画是唯一兜底,而分镜图
 * 也是占位时连它都没米下锅(实测 9 缺镜残片)。升级为**双层兜底**:失败镜先搜 Pexels
 * 免版权实拍素材(商用安全,Pexels License 允许商用免署名)作 B-roll,搜不到再 Ken Burns。
 *
 * 纯逻辑(查询构造/选片)可单测;真正调 API 在 searchPexelsBroll(PEXELS_API_KEY 未配 → null 跳过)。
 */

/** 从镜头 visualPrompt(英文)构造 Pexels 查询:剥运镜/镜头术语与节拍标记,取前 8 个实义词。 */
export function buildBrollQuery(visualPrompt: string): string {
  let t = (visualPrompt || '').toLowerCase();
  // 剥「static on 50mm lens, MS, eye level angle, ...:」类镜头语言前缀(到首个冒号)
  const colon = t.indexOf(':');
  if (colon > 0 && colon < 90) t = t.slice(colon + 1);
  // 剥节拍标记与常见相机词
  t = t
    .replace(/beat \d+-?\d*s?/g, ' ')
    .replace(/\b(static|push in|pull out|orbit|dolly|tracking|handheld|close-?up|wide|medium|shot|angle|lens|\d+mm|ecu|ms|ls|eye level|frame within frame|cinematic|camera)\b/g, ' ')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const words = t.split(' ').filter((w) => w.length > 2);
  return words.slice(0, 8).join(' ');
}

export interface PexelsVideoFile { width: number; height: number; link: string; quality?: string }
export interface PexelsVideo { duration: number; video_files: PexelsVideoFile[] }

/**
 * v12.103.0 候选排序(纯函数):画幅方向匹配 + 短边 540-1200 + 时长优先,
 * 返回按分排序的**候选列表**(供逐个视觉筛查;每条视频只取其最佳文件,避免同片重复)。
 */
export function rankBrollFiles(videos: PexelsVideo[], vertical: boolean, minSec: number, limit: number = 3): string[] {
  const scored: Array<{ link: string; score: number }> = [];
  for (const v of videos || []) {
    let best: { link: string; score: number } | null = null;
    for (const f of v.video_files || []) {
      if (!f?.link || !f.width || !f.height) continue;
      const isVert = f.height > f.width;
      if (isVert !== vertical) continue;
      const short = Math.min(f.width, f.height);
      if (short < 540 || short > 1200) continue;
      let score = 0;
      if ((v.duration || 0) >= minSec) score += 10;
      score += short >= 720 ? 5 : 2;
      if (f.quality === 'hd') score += 2;
      if (!best || score > best.score) best = { link: f.link, score };
    }
    if (best) scored.push(best);
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, Math.max(1, limit)).map((x) => x.link);
}

/** 旧签名兼容:取排序第一条。 */
export function pickBestBrollFile(videos: PexelsVideo[], vertical: boolean, minSec: number): string | null {
  return rankBrollFiles(videos, vertical, minSec, 1)[0] || null;
}

/**
 * v12.103.0 烤字/字幕筛查:抽候选视频第 1 秒一帧 → 复用 shot-quality-gate 的 VLM
 * (sonnet-5 视觉,自带跨网关兜底)查 `hasBakedText`。实测坑:Pexels 纪录片/访谈类素材
 * 常自带外语字幕,混进广告成片是硬伤。返回 'clean' | 'baked-text' | 'unknown'(视觉挂了)。
 */
export async function screenBrollForBakedText(link: string): Promise<'clean' | 'baked-text' | 'unknown'> {
  try {
    const { execFileSync } = await import('child_process');
    const fs = await import('fs');
    const os = await import('os');
    const path = await import('path');
    const { resolveFFmpegPath } = await import('@/services/video-composer');
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'broll-screen-'));
    const frame = path.join(tmp, 'f.png');
    // ffmpeg 直读 https,抽第 1 秒一帧(限 25s,防慢源卡管线)
    execFileSync(resolveFFmpegPath(), ['-y', '-v', 'error', '-ss', '1', '-i', link, '-frames:v', '1', frame], { stdio: 'pipe', timeout: 25_000 });
    if (!fs.existsSync(frame)) return 'unknown';
    const { scoreShotStyle } = await import('@/lib/shot-quality-gate');
    const s = await scoreShotStyle(frame);
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {}
    if (!s) return 'unknown'; // 视觉全挂 → 不阻塞(接受该候选)
    return s.hasBakedText ? 'baked-text' : 'clean';
  } catch (e) {
    console.warn('[Broll] 筛查失败(按 unknown 放行):', e instanceof Error ? e.message.slice(0, 60) : e);
    return 'unknown';
  }
}

/** 调 Pexels 视频搜索 + 逐候选烤字筛查。无 key / 失败 → null(调用方落 Ken Burns)。
 *  BROLL_TEXT_SCREEN_DISABLE=1 关闭筛查(直接取排序第一)。 */
export async function searchPexelsBroll(
  query: string,
  opts: { vertical: boolean; minSec: number },
  env: NodeJS.ProcessEnv = process.env,
): Promise<string | null> {
  const key = env.PEXELS_API_KEY;
  if (!key || !query) return null;
  try {
    const u = `https://api.pexels.com/videos/search?query=${encodeURIComponent(query)}&orientation=${opts.vertical ? 'portrait' : 'landscape'}&per_page=6`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 12_000);
    let r: Response;
    try {
      r = await fetch(u, { headers: { Authorization: key }, signal: controller.signal });
    } finally { clearTimeout(timer); }
    if (!r.ok) { console.warn(`[Broll] Pexels HTTP ${r.status}`); return null; }
    const j: any = await r.json();
    const candidates = rankBrollFiles(j?.videos || [], opts.vertical, opts.minSec, 3);
    if (candidates.length === 0) return null;
    if (env.BROLL_TEXT_SCREEN_DISABLE === '1') return candidates[0];
    // v12.103:逐候选视觉筛查 —— 干净即用;带烤字跳下一条;视觉挂了(unknown)放行不阻塞
    for (let i = 0; i < candidates.length; i++) {
      const verdict = await screenBrollForBakedText(candidates[i]);
      if (verdict === 'baked-text') {
        console.log(`[Broll] v12.103 候选#${i + 1} 含烤字/字幕,跳过`);
        continue;
      }
      if (verdict === 'unknown' && i === 0) console.log('[Broll] 视觉筛查不可用,按原排序放行');
      return candidates[i];
    }
    console.log('[Broll] v12.103 全部候选含烤字 → 放弃 B-roll(交 Ken Burns)');
    return null;
  } catch (e) {
    console.warn('[Broll] 搜索失败:', e instanceof Error ? e.message : e);
    return null;
  }
}
