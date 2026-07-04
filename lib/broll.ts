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
 * 从 Pexels 返回里选最合适的一条文件直链(纯函数):
 * 画幅方向匹配 + 短边 ≥540(质量下限)且 ≤1080(文件别太大)+ 时长 ≥minSec 优先。
 */
export function pickBestBrollFile(videos: PexelsVideo[], vertical: boolean, minSec: number): string | null {
  const scored: Array<{ link: string; score: number }> = [];
  for (const v of videos || []) {
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
      scored.push({ link: f.link, score });
    }
  }
  scored.sort((a, b) => b.score - a.score);
  return scored[0]?.link || null;
}

/** 调 Pexels 视频搜索。无 key / 失败 → null(调用方落 Ken Burns)。 */
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
    return pickBestBrollFile(j?.videos || [], opts.vertical, opts.minSec);
  } catch (e) {
    console.warn('[Broll] 搜索失败:', e instanceof Error ? e.message : e);
    return null;
  }
}
