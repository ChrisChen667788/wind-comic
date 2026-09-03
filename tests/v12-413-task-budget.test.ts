/**
 * v12.413 — 一次「一键成片」内部连着几十次付费调用,中途没有任何刹车点。
 *
 * ── 与已有护栏的分工 ──────────────────────────────────────────────────
 * `lib/budget-enforce.ts` 管**按用户按月**的金额上限:超了拒绝新请求。
 * 那道闸是对的,但粒度太粗 —— 等月上限拦住时,这一单已经花掉了。
 * 这里补的是**单次任务内**的闸(借鉴 Devin 的 ACU)。
 *
 * ── 两条设计上的硬约束 ────────────────────────────────────────────────
 * ① **超限暂停,不硬失败**。硬失败会把前面已经花钱生成的东西一起丢掉,那是双输;
 * ② **暂停必须产出人能回应的东西**。这条是从 v12.401 学来的:
 *    一道通向不了人的告警,和没有告警是一回事。所以暂停时必须带出
 *    「已花多少 / 卡在哪一步 / 再放行多少能继续」—— 没有这三个数,
 *    人面对一个按钮也不知道该不该点。
 */
import { describe, it, expect } from 'vitest';
import { TaskBudget, createTaskBudget } from '@/lib/task-budget';

describe('v12.413 · 单任务预算闸', () => {
  it('未设预算时不拦 —— 与历史行为一致(零回归)', () => {
    const b = new TaskBudget(0);
    for (let i = 0; i < 50; i++) expect(b.request(999, '视频生成').allowed).toBe(true);
    expect(b.snapshot().state).toBe('ok');
  });

  it('先问再花:预算内放行并逐阶段记账', () => {
    const b = new TaskBudget(10);
    expect(b.request(3, '分镜出图').allowed).toBe(true);
    expect(b.request(4, '视频生成').allowed).toBe(true);
    const s = b.snapshot();
    expect(s.spentCny).toBe(7);
    expect(s.remainingCny).toBe(3);
    expect(s.byStage).toEqual({ 分镜出图: 3, 视频生成: 4 });
  });

  it('超限是**暂停**不是抛错 —— 硬失败会把已经花钱生成的东西一起丢掉', () => {
    const b = new TaskBudget(10);
    b.request(9, '分镜出图');
    const r = b.request(5, '视频生成');
    expect(r.allowed).toBe(false);
    expect(b.snapshot().state).toBe('paused');
    // 已花的没有被清掉,已生成的内容仍然有效
    expect(b.snapshot().spentCny).toBe(9);
  });

  it('暂停时必须带出「卡在哪 / 还差多少」—— 否则人面对按钮也不知道该不该点', () => {
    const b = new TaskBudget(10);
    b.request(9, '分镜出图');
    const r = b.request(5, '视频生成');
    const s = r.snapshot;
    expect(s.pausedAtStage).toBe('视频生成');
    expect(s.neededCny, '没有这个数字,人无法决定批不批').toBe(4);
    expect(r.message).toContain('视频生成');
    expect(r.message).toContain('已生成的内容都还在');
  });

  it('人确认后可追加并从暂停处继续', () => {
    const b = new TaskBudget(10);
    b.request(9, '分镜出图');
    expect(b.request(5, '视频生成').allowed).toBe(false);
    expect(b.approveMore(10).allowed).toBe(true);
    expect(b.snapshot().state).toBe('ok');
    expect(b.request(5, '视频生成').allowed, '批准后应能继续').toBe(true);
  });

  it('一直批下去也该有个头 —— 超硬上限即终止', () => {
    const b = new TaskBudget(10);
    // 硬上限 = 初始预算 × 10
    expect(b.approveMore(80).allowed).toBe(true);
    const over = b.approveMore(50);
    expect(over.allowed, '无限追加 = 没有上限').toBe(false);
    expect(b.snapshot().state).toBe('stopped');
    expect(b.request(1, '视频生成').allowed).toBe(false);
  });

  it('里程碑汇报要能看出钱花在哪一步', () => {
    const b = new TaskBudget(20);
    b.request(3, '分镜出图');
    b.request(6, '视频生成');
    const line = b.milestone('Shot 3 完成');
    expect(line).toContain('Shot 3 完成');
    expect(line).toContain('分镜出图');
    expect(line).toContain('视频生成');
    expect(line, '要能看出还剩多少').toMatch(/剩 ¥/);
  });

  it('createTaskBudget 读 env,显式参数优先', () => {
    const prev = process.env.TASK_BUDGET_CNY;
    try {
      process.env.TASK_BUDGET_CNY = '50';
      expect(createTaskBudget().snapshot().limitCny).toBe(50);
      expect(createTaskBudget(7).snapshot().limitCny).toBe(7);
      delete process.env.TASK_BUDGET_CNY;
      expect(createTaskBudget().snapshot().limitCny, '没配就是不设闸').toBe(0);
    } finally {
      if (prev === undefined) delete process.env.TASK_BUDGET_CNY;
      else process.env.TASK_BUDGET_CNY = prev;
    }
  });
});
