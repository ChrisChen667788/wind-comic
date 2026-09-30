/**
 * lib/regen-hermetic — 单镜重生在 MOCK_ENGINES=1 下必须**全封闭**:一个真引擎都不碰。v12.459。
 *
 * v10.4.0 立的规矩是「MOCK_ENGINES=1 全封闭(hermetic)」,但它只对主流水线成立 —— 主流水线的视频走插件链,
 * mock-video 在那里排第一。**单镜重生(orchestrator.regenerateShot)有自己一条直连 Veo / MiniMax / 可灵 /
 * HappyHorse 的链**,从不经过插件链,于是 MOCK_ENGINES=1 对它无效:本地「零成本联调」照样真扣费。
 * v12.459 片段重拍的真机验证就是这么撞上的 —— 开着 MOCK_ENGINES=1,MiniMax 真建了一条 Hailuo-2.3 任务。
 *
 * 这里在引擎链入口把整条链换成一段本地确定性假片(与 mock-video provider 同一个生成器),
 * 返回站内签名地址 —— 不走 HTTP(localhost 会被 safeFetch 的 SSRF 防护拦下)。
 * 编排器只改一行(它有 < 4500 行的瘦身锁,当时正好 4499 行)。
 */
import { mockEnginesEnabled, mockSeed } from './mock-providers';
import { ensureMockClipFile, MOCK_AR_SIZE } from './mock-clip';
import { serveFilePathUrl } from './serve-file-sign';

export interface RegenAttempt { name: string; gen: () => Promise<string> }

export function hermeticRegenAttempts(
  attempts: RegenAttempt[],
  ctx: { prompt: string; durationS: number; aspect?: string },
): RegenAttempt[] {
  if (!mockEnginesEnabled()) return attempts;
  console.log(`[Regenerate] MOCK_ENGINES=1 → 全封闭,跳过 ${attempts.map((a) => a.name).join(' / ') || '(空链)'},改用本地假片`);
  return [{
    name: 'mock-video',
    gen: async () => {
      const ar = ctx.aspect && MOCK_AR_SIZE[ctx.aspect] ? ctx.aspect : '16:9';
      const dur = Math.min(Math.max(Math.round(ctx.durationS || 2), 1), 15);
      const file = await ensureMockClipFile(mockSeed(`${ctx.prompt}|${ar}|${dur}`), ar, dur);
      return serveFilePathUrl(file);
    },
  }];
}
