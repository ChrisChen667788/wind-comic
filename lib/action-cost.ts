/**
 * 「按下去之前,这一下要花多少钱」—— 唯一出口(v12.435)。
 *
 * ## 为什么要有这个文件
 *
 * 估算逻辑早就在 `lib/budget-estimate`(v12.172)里了,但它只被 `assertBudget` 用于
 * **服务端拦截**:超预算才报错,没超就一声不吭。于是用户点「重生这镜」时看到的是
 * 一个普通按钮,点完钱就没了 —— 直到月底看账单才知道那晚重生了四十次。
 *
 * 竞品里 Runway 的 Director Mode 在每个镜位旁边写着「本镜约消耗 N 积分」,
 * 而那几篇讲 3D 导演台/动作捕捉的文章,共同的卖点就一句话:**别再抽卡烧钱**。
 * 「抽卡贵」不是模型问题,是**代价在按下去之后才出现**的交互问题。
 *
 * ## 诚实边界(这是本文件最要紧的部分)
 *
 * `estimatePipelineCostCny` 刻意**宁高勿低**:未知引擎按最贵档、图像按每镜 1.5 张均摊。
 * 那是给护栏用的口径 —— 拿它当账单展示就会**系统性吓唬用户**。所以这里把
 * 「估得准不准」也一并返回(`confident`),界面必须据此改口:
 * 引擎已知 → 「约 ¥1.2」;引擎未知 → 「最多 ¥3.6(按最贵引擎估)」。
 *
 * **一个数字只有说得清它怎么来的,才配写在按钮上。** 这与 v12.432 那条
 * 「0 是一个结论,只有真读到才配写出来」是同一条规矩,只是换到了钱上。
 */

import { estimatePipelineCostCny, videoRatePerSec } from './budget-estimate';

/** 单价表里认识的引擎(与 budget-estimate 的 VIDEO_CNY_PER_SEC 对齐)。 */
const KNOWN_PROVIDERS = new Set(['veo', 'minimax', 'kling', 'keling', 'vidu', 'seedance']);

/**
 * 只收**真有按钮在用**的花费种类。
 *
 * 初版还有 shots-video / storyboard / asset-image 三种,收尾自审时发现零调用 ——
 * 而且 storyboard 用的是 ¥0.45/张,那是护栏口径里「含 1.5 倍重生均摊」的数;
 * 用户明确点一次重出分镜只花一张 ¥0.30,却会被标成 confident 的「约 ¥0.45」,
 * 一个声称准确、实际偏高 50% 的数字 —— 正是本版要消灭的那类谎。
 * 没有调用方的备用件留着只会在接线那天把这个错一起带进界面,所以删了。
 * 要加新入口时,在这里加一种并同时接上按钮。
 */
export type SpendAction =
  /** 跑一整条流水线 */
  | { kind: 'pipeline'; shotCount?: number | null; videoProvider?: string | null; secondsPerShot?: number | null; mode?: string | null }
  /** 重生单镜视频 */
  | { kind: 'shot-video'; videoProvider?: string | null; secondsPerShot?: number | null; mode?: string | null };

export interface CostPreview {
  /** 人民币,已按 0.1 向上取整 */
  cny: number;
  /** 按钮上那句话 */
  label: string;
  /** 展开后的算式,用户要能自己验 */
  detail: string;
  /** 引擎已知 → true;未知按最贵档 → false,界面必须改口 */
  confident: boolean;
}

const IMAGE_CNY_PER_SHOT = 0.45; // 与 budget-estimate 同口径(每镜 ~1.5 张 × ¥0.3)
const YUAN = (n: number) => `¥${n.toFixed(n < 1 ? 2 : 1)}`;

/** 向上取到 0.1,与 estimatePipelineCostCny 的口径一致 —— 两处不同会让用户对不上账。 */
const round1 = (n: number) => Math.ceil(n * 10) / 10;

function providerKnown(p?: string | null): boolean {
  return KNOWN_PROVIDERS.has(String(p || '').toLowerCase());
}

function modeLabel(mode?: string | null): string {
  const m = String(mode || 'std').toLowerCase();
  return m === '4k' ? ' 4K' : m === 'pro' ? ' Pro' : '';
}

export function previewCost(a: SpendAction): CostPreview {
  switch (a.kind) {
    case 'pipeline': {
      const shots = Math.max(1, a.shotCount ?? 8);
      const sec = Math.max(3, a.secondsPerShot ?? 6);
      const known = providerKnown(a.videoProvider);
      const cny = estimatePipelineCostCny({
        shotCount: shots, videoProvider: a.videoProvider, secondsPerShot: sec, mode: a.mode,
      });
      return {
        cny,
        label: known ? `约 ${YUAN(cny)}` : `最多 ${YUAN(cny)}`,
        detail: `${shots} 镜 × ${sec} 秒 × ${YUAN(videoRatePerSec(a.videoProvider, a.mode))}/秒${modeLabel(a.mode)}`
          + `,另含出图与配音约 ${YUAN(round1(shots * (IMAGE_CNY_PER_SHOT + 0.1)))}`
          + (known ? '' : ' —— 引擎未指定,按最贵档估'),
        confident: known,
      };
    }
    case 'shot-video': {
      const sec = Math.max(3, a.secondsPerShot ?? 6);
      const rate = videoRatePerSec(a.videoProvider, a.mode);
      const known = providerKnown(a.videoProvider);
      const cny = round1(sec * rate);
      return {
        cny,
        label: known ? `约 ${YUAN(cny)}` : `最多 ${YUAN(cny)}`,
        detail: `${sec} 秒 × ${YUAN(rate)}/秒${modeLabel(a.mode)}`
          + (known ? '' : ' —— 引擎未指定,按最贵档估'),
        confident: known,
      };
    }
  }
}

/**
 * 重生前那句确认话。和 label 分开,因为**确认要说清「再花一次」** ——
 * 用户已经为这镜付过一次钱了,重生是**追加**不是首次。
 */
export function confirmSpendText(a: SpendAction): string {
  const p = previewCost(a);
  const head = p.confident ? `这一步预计再花 ${YUAN(p.cny)}` : `这一步最多再花 ${YUAN(p.cny)}`;
  return `${head}(${p.detail})。继续吗?`;
}
