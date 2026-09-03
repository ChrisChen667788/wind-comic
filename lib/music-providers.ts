/**
 * lib/music-providers.ts — BGM 生成的**唯一入口 + 供应商兜底链**(v12.410)。
 *
 * ── 病象:功能已死,而不是待办 ────────────────────────────────────────
 * 全仓 7 处 BGM 调用点**全部直连** `minimaxService.generateMusic()`(music-2.6),
 * 没有任何兜底。而 MiniMax Music API 已对新用户停服(410 + 2153,**无预告**)——
 * 于是「按剧生成 BGM」这项写在 README 上的能力,实际是**断服状态**:
 * 用户一点就报 502。这不是「还没做」,是「做过、现在坏了、没人发现」。
 *
 * 这也是 v12.402 那条教训的直接续集:同一家供应商停 Music API 时是无预告的,
 * 而我们把一整项能力压在它一家身上。**单点依赖 + 无兜底 = 供应商替我们决定功能生死。**
 *
 * ── 修法:注册表 + 优先级兜底 ──────────────────────────────────────────
 * 与 video-providers 同构:一个入口,按优先级依次尝试,全挂才报错,
 * 且报错要说清**每一家分别为什么失败** —— 否则用户只看到「作曲失败」,
 * 无从判断是该充值、该换 key、还是该等供应商恢复。
 *
 * 三个 provider 的取舍:
 *   · **ElevenLabs Music**($0.15/min):官方 API、授权语料商用最干净,作主力;
 *   · **自托管**(ACE-Step 1.5 / YuE,均 Apache-2.0 或 MIT):
 *     契合本项目「开源可自托管」的定位,也是**唯一不会被供应商停服掐死**的一条;
 *   · **MiniMax music-2.6**:保留在链尾 —— 它当下对新用户返 410,
 *     但老账号可能仍可用,留着不花成本;真恢复了也能自动被用上。
 */

export interface MusicRequest {
  prompt: string;
  /** 期望时长(秒);各家上限不同,由各 provider 自行夹取 */
  durationSec?: number;
  style?: string;
}

export interface MusicProvider {
  id: string;
  name: string;
  /** 数字越小越先试 */
  priority: number;
  available(): boolean;
  generate(req: MusicRequest): Promise<string>;
}

const registry: MusicProvider[] = [];

export function registerMusicProvider(p: MusicProvider): void {
  const i = registry.findIndex((x) => x.id === p.id);
  if (i >= 0) registry[i] = p;
  else registry.push(p);
}

export function listMusicProviders(): MusicProvider[] {
  return [...registry].sort((a, b) => a.priority - b.priority);
}

export function availableMusicProviders(): MusicProvider[] {
  return listMusicProviders().filter((p) => {
    try { return p.available(); } catch { return false; }
  });
}

export class NoMusicProviderError extends Error {
  constructor(public readonly attempts: Array<{ id: string; reason: string }>) {
    const detail = attempts.length
      ? attempts.map((a) => `${a.id}: ${a.reason}`).join(' · ')
      : '一个都没配置';
    super(`所有 BGM 引擎都不可用 —— ${detail}`);
    this.name = 'NoMusicProviderError';
  }
}

/**
 * 唯一入口。按优先级依次尝试,全挂才抛,并把**每一家分别为什么失败**带出来。
 * 只说「作曲失败」的话,用户无从判断该充值、该换 key、还是该等供应商恢复。
 */
export async function generateMusic(req: MusicRequest): Promise<{ url: string; provider: string }> {
  const attempts: Array<{ id: string; reason: string }> = [];

  for (const p of listMusicProviders()) {
    let usable = false;
    try { usable = p.available(); } catch { usable = false; }
    if (!usable) {
      attempts.push({ id: p.id, reason: '未配置' });
      continue;
    }
    try {
      const url = await p.generate(req);
      if (url) return { url, provider: p.id };
      attempts.push({ id: p.id, reason: '返回空音频' });
    } catch (e) {
      attempts.push({ id: p.id, reason: e instanceof Error ? e.message.slice(0, 120) : String(e) });
    }
  }

  throw new NoMusicProviderError(attempts);
}

/** 仅供测试:清空注册表 */
export function _resetMusicProviders(): void {
  registry.length = 0;
}
