/**
 * v12.459 · 片段重拍路由的行为:预演不花钱、旧的 patchUrl 入参被拒、预算护栏、同镜互斥、
 * 占位补丁只在联调模式放行、执行链的人话错误原样透传。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';

const run = vi.fn();
const budget = vi.fn();

vi.mock('@/lib/auth-guard', () => ({
  requireProjectAccess: vi.fn(async () => ({ ok: true, userId: 'u1' })),
}));
vi.mock('@/lib/budget-enforce', () => ({ assertBudget: (...a: unknown[]) => budget(...a) }));
vi.mock('@/services/segment-retake-run', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/services/segment-retake-run')>();
  return {
    ...real,
    shotFinalDuration: vi.fn(async () => 8),
    projectFps: vi.fn(async () => 24),
    runSegmentRetake: (...a: unknown[]) => run(...a),
  };
});

const { POST } = await import('@/app/api/projects/[id]/segment-retake/route');
const { SegmentRetakeError, tryLockShot } = await import('@/services/segment-retake-run');

const call = (body: unknown) => POST(
  new NextRequest('http://localhost/api/projects/p1/segment-retake', { method: 'POST', body: JSON.stringify(body) }),
  { params: Promise.resolve({ id: 'p1' }) },
);

beforeEach(() => {
  run.mockReset();
  budget.mockReset();
  budget.mockResolvedValue({ allow: true });
  run.mockResolvedValue({ takeId: 't1', videoUrl: '/v', measuredDurationS: 8, patchIsAnimatic: false, plan: {} });
});
afterEach(() => { delete process.env.MOCK_ENGINES; });

describe('v12.459 · 片段重拍路由', () => {
  it('预演:只回计划 —— 不查预算、不调执行链', async () => {
    const r = await call({ shotNumber: 1, fromS: 3, toS: 5, dryRun: true });
    expect(r.status).toBe(200);
    const b = await r.json();
    expect(b.dryRun).toBe(true);
    expect(b.plan).toMatchObject({ ok: true, patchFromS: 3, patchToS: 5, totalAfterS: 8 });
    expect(budget).not.toHaveBeenCalled();
    expect(run).not.toHaveBeenCalled();
  });

  it('计划不通过 → 400 人话,不查预算不开跑', async () => {
    const r = await call({ shotNumber: 1, fromS: 5, toS: 3 });
    expect(r.status).toBe(400);
    expect((await r.json()).message).toMatch(/拖反了/);
    expect(run).not.toHaveBeenCalled();
  });

  it('**旧的 patchUrl 入参被拒** —— 它会绕过缝合,把裸补丁记成整镜', async () => {
    const r = await call({ shotNumber: 1, fromS: 3, toS: 5, patchUrl: 'https://cdn/x.mp4' });
    expect(r.status).toBe(400);
    expect((await r.json()).message).toMatch(/不再接受 patchUrl/);
    expect(run).not.toHaveBeenCalled();
  });

  it('预算不够 → 402,不开跑;估价按本次要生成的秒数', async () => {
    budget.mockResolvedValue({ allow: false, guard: { message: '本次预估 ¥3 将越过硬上限' } });
    const r = await call({ shotNumber: 1, fromS: 3, toS: 5 });
    expect(r.status).toBe(402);
    expect((await r.json()).message).toMatch(/硬上限/);
    expect(run).not.toHaveBeenCalled();
    expect(budget).toHaveBeenCalledWith(expect.objectContaining({ userId: 'u1', pendingCostCny: expect.any(Number) }));
  });

  it('正常:交给执行链,默认**不**放行占位补丁;返回 take', async () => {
    const r = await call({ shotNumber: 1, fromS: 3, toS: 5, prompt: '别眨眼' });
    expect(r.status).toBe(200);
    expect(await r.json()).toMatchObject({ ok: true, takeId: 't1' });
    expect(run).toHaveBeenCalledWith(
      { projectId: 'p1', shotNumber: 1, fromS: 3, toS: 5, prompt: '别眨眼' },
      expect.objectContaining({ allowAnimaticPatch: false, generatePatch: expect.any(Function) }),
    );
  });

  it('联调模式(MOCK_ENGINES=1)才放行占位补丁', async () => {
    process.env.MOCK_ENGINES = '1';
    await call({ shotNumber: 1, fromS: 3, toS: 5 });
    expect(run.mock.calls[0][1]).toMatchObject({ allowAnimaticPatch: true });
  });

  it('执行链的人话错误原样透传(状态码 + 文案)', async () => {
    run.mockRejectedValue(new SegmentRetakeError('引擎给的补丁画面只有 1.00s,这一段至少需要 2.00s', 422, { patchVideoS: 1 }));
    const r = await call({ shotNumber: 1, fromS: 3, toS: 5 });
    expect(r.status).toBe(422);
    expect(await r.json()).toMatchObject({ message: expect.stringMatching(/至少需要 2\.00s/), patchVideoS: 1 });
  });

  it('**同一镜正在重拍 → 409**;结束后锁释放(成功、失败都释放)', async () => {
    const hold = tryLockShot('p1', 1)!;
    const r = await call({ shotNumber: 1, fromS: 3, toS: 5 });
    expect(r.status).toBe(409);
    expect(run).not.toHaveBeenCalled();
    hold();

    run.mockRejectedValueOnce(new Error('ffmpeg 挂了'));
    expect((await call({ shotNumber: 1, fromS: 3, toS: 5 })).status).toBe(500);
    const again = tryLockShot('p1', 1);
    expect(again, '失败后锁必须释放,否则这一镜永远重拍不了').toBeTypeOf('function');
    again!();
  });
});
