/**
 * lib/task-budget.ts — 单次出片任务的预算闸(v12.413)。
 *
 * ── 与已有护栏的分工 ──────────────────────────────────────────────────
 * `lib/budget-enforce.ts` 管的是**按用户按月**的金额上限:超了就拒绝新请求。
 * 那道闸是对的,但粒度太粗 —— 一次「一键成片」内部会连着发几十次付费调用,
 * 中途没有任何刹车点;等月上限拦住时,这一单已经花掉了。
 *
 * 这里补的是**单次任务内**的闸,借鉴 Devin 的 ACU:
 *   · 每次付费动作先报一次预估花费;
 *   · 超过任务预算时**暂停等人确认**,而不是硬失败 ——
 *     硬失败会把前面已经花钱生成的东西一起丢掉,那是双输;
 *   · 里程碑(导演→编剧→分镜→视频)是天然的确认点,在那里汇报已花多少。
 *
 * ── 一条从 v12.401 学来的约束 ────────────────────────────────────────
 * **暂停必须产出可被人看见、可被人回应的东西。**
 * v12.401 那次的教训是:一道通向不了人的告警,和没有告警是一回事。
 * 所以 `pause` 不是简单地 return false —— 它带出「已花多少 / 卡在哪一步 /
 * 再放行多少才能继续」,调用方据此才可能给出一个真能点的按钮。
 */

export type BudgetState = 'ok' | 'paused' | 'stopped';

export interface TaskBudgetSnapshot {
  limitCny: number;
  spentCny: number;
  remainingCny: number;
  state: BudgetState;
  /** 卡住时停在哪个阶段 */
  pausedAtStage?: string;
  /** 还差多少才能放行下一步 —— 没有这个数字,人无法决定批不批 */
  neededCny?: number;
  /** 各阶段已花明细,里程碑汇报用 */
  byStage: Record<string, number>;
}

export interface ChargeResult {
  allowed: boolean;
  snapshot: TaskBudgetSnapshot;
  /** 直接可展示给人的一句话 */
  message: string;
}

/** 硬上限:即便人一直批,也不该无限追加。默认 10 倍初始预算。 */
const HARD_MULTIPLIER = 10;

export class TaskBudget {
  private limit: number;
  private readonly initialLimit: number;
  private spent = 0;
  private state: BudgetState = 'ok';
  private pausedAtStage?: string;
  private neededCny?: number;
  private byStage: Record<string, number> = {};

  constructor(limitCny: number) {
    this.limit = Math.max(0, Number(limitCny) || 0);
    this.initialLimit = this.limit;
  }

  snapshot(): TaskBudgetSnapshot {
    return {
      limitCny: this.limit,
      spentCny: Number(this.spent.toFixed(4)),
      remainingCny: Number(Math.max(0, this.limit - this.spent).toFixed(4)),
      state: this.state,
      pausedAtStage: this.pausedAtStage,
      neededCny: this.neededCny,
      byStage: { ...this.byStage },
    };
  }

  /**
   * 申请一次付费动作。**先问再花** —— 花完再拦就没意义了。
   * 超预算时不抛异常:抛异常会把前面已经花钱生成的东西一起丢掉。
   */
  request(costCny: number, stage: string): ChargeResult {
    const cost = Math.max(0, Number(costCny) || 0);

    // 无预算 = 不设闸(与历史行为一致,零回归)
    if (this.limit <= 0) {
      this.spent += cost;
      this.byStage[stage] = Number(((this.byStage[stage] || 0) + cost).toFixed(4));
      return { allowed: true, snapshot: this.snapshot(), message: '未设任务预算,不拦' };
    }

    if (this.state === 'stopped') {
      return {
        allowed: false,
        snapshot: this.snapshot(),
        message: `任务已被终止(累计 ¥${this.spent.toFixed(2)},硬上限 ¥${(this.initialLimit * HARD_MULTIPLIER).toFixed(2)})`,
      };
    }

    if (this.spent + cost > this.limit) {
      this.state = 'paused';
      this.pausedAtStage = stage;
      this.neededCny = Number((this.spent + cost - this.limit).toFixed(4));
      return {
        allowed: false,
        snapshot: this.snapshot(),
        // 没有「还差多少」这个数字,人无法决定批不批
        message:
          `预算不够,已在「${stage}」暂停:已花 ¥${this.spent.toFixed(2)} / 预算 ¥${this.limit.toFixed(2)},` +
          `这一步还需 ¥${cost.toFixed(2)},再放行 ¥${this.neededCny.toFixed(2)} 即可继续。` +
          `**已生成的内容都还在**,批准后从这一步接着跑。`,
      };
    }

    this.spent += cost;
    this.byStage[stage] = Number(((this.byStage[stage] || 0) + cost).toFixed(4));
    return { allowed: true, snapshot: this.snapshot(), message: `「${stage}」花费 ¥${cost.toFixed(2)}` };
  }

  /** 人确认后追加预算,从暂停处继续。硬上限之上不再追加 —— 一直批下去也该有个头。 */
  approveMore(extraCny: number): ChargeResult {
    const extra = Math.max(0, Number(extraCny) || 0);
    const hardCap = this.initialLimit * HARD_MULTIPLIER;

    if (this.limit + extra > hardCap) {
      this.state = 'stopped';
      return {
        allowed: false,
        snapshot: this.snapshot(),
        message: `追加会超过硬上限 ¥${hardCap.toFixed(2)}(初始预算的 ${HARD_MULTIPLIER} 倍),已终止。请另起任务或调高初始预算。`,
      };
    }

    this.limit += extra;
    this.state = 'ok';
    this.pausedAtStage = undefined;
    this.neededCny = undefined;
    return { allowed: true, snapshot: this.snapshot(), message: `已追加 ¥${extra.toFixed(2)},预算 ¥${this.limit.toFixed(2)}` };
  }

  /** 里程碑汇报 —— 天然的人工确认点(导演→编剧→分镜→视频)。 */
  milestone(stage: string): string {
    const s = this.snapshot();
    const detail = Object.entries(s.byStage)
      .map(([k, v]) => `${k} ¥${v.toFixed(2)}`)
      .join(' · ');
    return this.limit > 0
      ? `【${stage}】已花 ¥${s.spentCny.toFixed(2)} / 预算 ¥${s.limitCny.toFixed(2)}(剩 ¥${s.remainingCny.toFixed(2)})${detail ? ` —— ${detail}` : ''}`
      : `【${stage}】已花 ¥${s.spentCny.toFixed(2)}(未设预算)${detail ? ` —— ${detail}` : ''}`;
  }
}

export function createTaskBudget(limitCny?: number): TaskBudget {
  const fromEnv = Number(process.env.TASK_BUDGET_CNY);
  return new TaskBudget(Number.isFinite(Number(limitCny)) && Number(limitCny) > 0 ? Number(limitCny) : (Number.isFinite(fromEnv) ? fromEnv : 0));
}
