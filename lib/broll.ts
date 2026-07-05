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

/**
 * v12.107.0 角色感知(纯函数):从 brief/锁定角色性别推出英文人设词,注入查询首部 ——
 * 实测坑:耳机片 brief 锁男主,B-roll 却混入女性镜(通用素材检索不带人设)。
 */
export function derivePersonaHint(idea: string, lockedGender?: 'male' | 'female' | 'unknown'): string {
  if (lockedGender === 'male') return 'young man';
  if (lockedGender === 'female') return 'young woman';
  const t = idea || '';
  if (/男主角|男性|男生|小伙|先生|男士/.test(t)) return 'young man';
  if (/女主角|女性|女生|姑娘|女士|她/.test(t)) return 'young woman';
  return '';
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
  // v12.108:缓存命中直接复用(已筛过的干净链接)
  const ck = brollCacheKey(query, opts.vertical);
  const cache = readBrollCache();
  const hit = cache[ck];
  if (hit && Date.now() - hit.at < 7 * 24 * 3600_000) {
    console.log(`[Broll] v12.108 缓存命中: "${query.slice(0, 40)}"`);
    return hit.link;
  }
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
      if (verdict === 'clean') { cache[ck] = { link: candidates[i], at: Date.now() }; writeBrollCache(cache); } // 只缓存筛过的干净结果
      return candidates[i];
    }
    console.log('[Broll] v12.103 全部候选含烤字 → 放弃 B-roll(交 Ken Burns)');
    return null;
  } catch (e) {
    console.warn('[Broll] 搜索失败:', e instanceof Error ? e.message : e);
    return null;
  }
}

// ─── v12.106.0 AI 视频镜烤字抽查(复用本模块抽帧+VLM 基建)────────────────────────
/** 片源分类(纯函数):AI CDN / Pexels B-roll(已筛过)/ 本地(KenBurns 等)/ 无效。 */
export function classifyClipSource(url: string | undefined | null): 'ai' | 'broll' | 'local' | 'invalid' {
  if (!url) return 'invalid';
  if (url.startsWith('/api/serve-file') || url.startsWith('data:')) return 'local';
  if (!url.startsWith('http')) return 'invalid';
  if (/pexels\.com/i.test(url)) return 'broll';
  return 'ai';
}

/** AI 镜烤字抽查:与 B-roll 同款(抽第 1 秒帧 → VLM hasBakedText)。 */
export const screenVideoForBakedText = screenBrollForBakedText;

// ─── v12.108.0 B-roll 结果缓存(落盘 LRU)────────────────────────────────────────
// 同 query 的筛查结果复用:每次筛查 ~15s(抽帧+VLM)+ 费用;同品类多镜/重跑常撞同查询。
// data/broll-cache.json,上限 200 条,TTL 7 天(Pexels 直链长期有效)。

const BROLL_CACHE_MAX = 200;
const BROLL_CACHE_TTL_MS = 7 * 24 * 3600_000;

export function brollCacheKey(query: string, vertical: boolean): string {
  return `${vertical ? 'v' : 'h'}:${query.trim().toLowerCase()}`;
}

/** 纯函数:裁剪缓存(去过期 + LRU 截断到上限)。 */
export function pruneBrollCache(
  cache: Record<string, { link: string; at: number }>,
  now: number,
  max: number = BROLL_CACHE_MAX,
  ttlMs: number = BROLL_CACHE_TTL_MS,
): Record<string, { link: string; at: number }> {
  const alive = Object.entries(cache || {}).filter(([, v]) => v && now - v.at < ttlMs);
  alive.sort((a, b) => b[1].at - a[1].at);
  return Object.fromEntries(alive.slice(0, max));
}

function brollCachePath(): string {
  const path = require('path') as typeof import('path');
  return path.join(process.cwd(), 'data', 'broll-cache.json');
}

export function readBrollCache(): Record<string, { link: string; at: number }> {
  try {
    const fs = require('fs') as typeof import('fs');
    return JSON.parse(fs.readFileSync(brollCachePath(), 'utf-8'));
  } catch { return {}; }
}

export function writeBrollCache(cache: Record<string, { link: string; at: number }>): void {
  try {
    const fs = require('fs') as typeof import('fs');
    const path = require('path') as typeof import('path');
    fs.mkdirSync(path.dirname(brollCachePath()), { recursive: true });
    fs.writeFileSync(brollCachePath(), JSON.stringify(pruneBrollCache(cache, Date.now())));
  } catch { /* 缓存写失败不阻塞 */ }
}
