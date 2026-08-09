/**
 * lib/xfade-timeline — 链式 xfade 压缩后的输出时间轴(**纯函数,零依赖**)。
 *
 * v12.297 从 `services/video-composer.ts` 抽出。原因:导出侧(EDL/AAF)也必须用这一份 ——
 * 而 video-composer 拖着 ffmpeg 依赖,API 路由不宜整个引入。
 *
 * 讽刺的是,下面这段注释早就把病根写清楚了:「配音按 durations 纯累加、不减转场重叠 →
 * 逐镜滞后 Σ effectiveTd」。v12.264/265 在**成片**里修掉了它,而 v12.277 做**导出**时
 * 又原样犯了一遍 —— 剪辑软件应用 D(溶解)事件后画面轨压缩、音频轨停在绝对位置,于是错开。
 */

/**
 * v12.264 音画同步单一真源 —— xfade 压缩后每镜在**输出时间轴**上的真实画面起点。
 *
 * 根因:链式 xfade 每次转场把画面时间轴压缩 effectiveTd(offset = 累计时长 − effectiveTd),
 *       而旧版配音 adelay 却按 durations[] **纯累加**(不减转场重叠)定位 → 配音相对画面
 *       逐镜滞后 Σ effectiveTd(默认转场 0.5s × 转场数 ≈ 真机实测 0.5~1s 延迟)。
 * 修复:画面 xfade offset 与配音起点都由本函数产出 → 同源对齐,累计漂移归零。口型不脱节。
 *
 * @param durations   各镜**终值**时长(秒),已含情绪调速/卡点/逐镜变速。
 * @param effectiveTds effectiveTds[i] = 进入第 i 镜那次转场的实际 xfade 时长(秒);[0] 恒 0(首镜无转场)。
 * @returns clipStartSec 各镜画面起点(秒,首镜=0);totalSec 压缩后总时长(= BGM 尾淡出基准)。
 * 导出供 tests 单测锁住「配音起点 == 画面 xfade offset」不再回归。
 */
export function computeXfadeTimeline(
  durations: number[],
  effectiveTds: number[],
): { clipStartSec: number[]; totalSec: number } {
  const n = durations.length;
  const clipStartSec: number[] = new Array(n).fill(0); // clipStartSec[0] = 0(首镜从 0 起)
  if (n === 0) return { clipStartSec, totalSec: 0 };
  let cumulativeDuration = durations[0] || 0;
  for (let i = 1; i < n; i++) {
    const offset = Math.max(0, cumulativeDuration - (effectiveTds[i] || 0));
    clipStartSec[i] = offset;
    cumulativeDuration = offset + (durations[i] || 0);
  }
  return { clipStartSec, totalSec: cumulativeDuration };
}
