/**
 * v12.459 · 片段重拍面板真渲染:预演 → 确认重拍 → take 列表 → 采用 / 回退,失败如实显示。
 *
 * v12.330 把框选接到了重拍,但只接到预演:点了弹一句「可以重拍」就结束,没有真重拍的按钮、
 * 看不到 take、无从采用 —— 界面上走不通。这里把整条路在组件层真走一遍。
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup, act } from '@testing-library/react';
import { SegmentRetakePanel } from '@/components/project/segment-retake-panel';

const PLAN = { ok: true, patchFromS: 3, patchToS: 5, generateDurationS: 3, totalAfterS: 8, padSeconds: 1 };
const TAKE = (over: Record<string, unknown> = {}) => ({
  takeId: 't1', fromS: 3, toS: 5, videoUrl: '/api/serve-file?path=%2Fx%2Ft1.mp4&sig=a', createdAt: '2026-09-30T00:00:00Z',
  adopted: false, original: false, patchIsAnimatic: false, ...over,
});

type Reply = { status?: number; body: unknown };
function api(handlers: { get?: () => Reply; dry?: () => Reply; run?: () => Reply; adopt?: () => Reply }) {
  return vi.fn(async (_url: string, init?: RequestInit) => {
    const body = init?.body ? JSON.parse(String(init.body)) : null;
    const pick = !init?.method || init.method === 'GET' ? handlers.get
      : body?.adoptTakeId ? handlers.adopt : body?.dryRun ? handlers.dry : handlers.run;
    const r = pick?.() ?? { body: {} };
    const status = r.status ?? 200;
    return { ok: status < 400, status, json: async () => r.body };
  });
}
const bodies = (f: ReturnType<typeof api>) =>
  f.mock.calls.filter(([, i]) => (i as RequestInit)?.method === 'POST').map(([, i]) => JSON.parse(String((i as RequestInit).body)));

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('v12.459 · 片段重拍面板', () => {
  it('没框选时只提示,不出按钮;框选后先预演(dryRun),拿到计划才出现「确认重拍」', async () => {
    const f = api({ get: () => ({ body: { takes: [] } }), dry: () => ({ body: { dryRun: true, plan: PLAN } }) });
    vi.stubGlobal('fetch', f);
    const { rerender } = render(<SegmentRetakePanel projectId="p1" shotNumber={3} range={null} />);
    expect(screen.getByText(/先在上方框出/)).toBeTruthy();
    expect(screen.queryByTestId('segment-retake-confirm')).toBeNull();

    rerender(<SegmentRetakePanel projectId="p1" shotNumber={3} range={{ fromS: 3, toS: 5 }} />);
    expect(screen.queryByTestId('segment-retake-confirm'), '没预演就不给花钱的按钮').toBeNull();
    fireEvent.click(screen.getByTestId('segment-retake-preview'));
    await waitFor(() => expect(screen.getByTestId('segment-retake-confirm')).toBeTruthy());
    expect(bodies(f)[0]).toEqual({ shotNumber: 3, fromS: 3, toS: 5, dryRun: true });
    expect(screen.getByTestId('segment-retake-plan').textContent).toMatch(/总长仍是 8\.000s/);
  });

  it('确认重拍:发真请求(不带 dryRun、带修改说明),成功后刷新 take 列表并提示', async () => {
    let takes: unknown[] = [];
    const f = api({
      get: () => ({ body: { takes } }),
      dry: () => ({ body: { dryRun: true, plan: PLAN } }),
      run: () => { takes = [TAKE()]; return { body: { ok: true, takeId: 't1', measuredDurationS: 8, patchIsAnimatic: false, plan: PLAN } }; },
    });
    vi.stubGlobal('fetch', f);
    render(<SegmentRetakePanel projectId="p1" shotNumber={3} range={{ fromS: 3, toS: 5 }} />);
    fireEvent.click(screen.getByTestId('segment-retake-preview'));
    await waitFor(() => screen.getByTestId('segment-retake-confirm'));
    fireEvent.change(screen.getByPlaceholderText(/这一段想怎么改/), { target: { value: '别眨眼' } });
    fireEvent.click(screen.getByTestId('segment-retake-confirm'));
    await waitFor(() => expect(screen.getAllByTestId('segment-retake-take')).toHaveLength(1));
    const run = bodies(f).find((b) => !b.dryRun && !b.adoptTakeId)!;
    expect(run).toEqual({ shotNumber: 3, fromS: 3, toS: 5, prompt: '别眨眼' });
    expect(screen.getByTestId('segment-retake-notice').textContent).toMatch(/时长不变/);
  });

  it('**连点两下「确认重拍」只发一条真请求**(真重拍会花钱)', async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => { release = r; });
    const f = vi.fn(async (_u: string, init?: RequestInit) => {
      const body = init?.body ? JSON.parse(String(init.body)) : null;
      if (!init?.method || init.method === 'GET') return { ok: true, status: 200, json: async () => ({ takes: [] }) };
      if (body?.dryRun) return { ok: true, status: 200, json: async () => ({ dryRun: true, plan: PLAN }) };
      await gate;
      return { ok: true, status: 200, json: async () => ({ ok: true, takeId: 't1', measuredDurationS: 8, patchIsAnimatic: false, plan: PLAN }) };
    });
    vi.stubGlobal('fetch', f);
    render(<SegmentRetakePanel projectId="p1" shotNumber={3} range={{ fromS: 3, toS: 5 }} />);
    fireEvent.click(screen.getByTestId('segment-retake-preview'));
    await waitFor(() => screen.getByTestId('segment-retake-confirm'));
    const btn = screen.getByTestId('segment-retake-confirm') as HTMLButtonElement;
    // 两下点击放进**同一批**:这一批结束前 React 不重渲,按钮还没被 disabled ——
    // 这正是真实浏览器里连点落在同一帧的情形(fireEvent 每下都同步刷新,测不出这个窗口)
    act(() => { btn.click(); btn.click(); });
    release();
    await waitFor(() => expect(screen.getByTestId('segment-retake-notice')).toBeTruthy());
    expect(bodies(f).filter((b) => !b.dryRun && !b.adoptTakeId)).toHaveLength(1);
  });

  it('回退到的原片只有外链 → 如实显示服务端的提醒', async () => {
    let takes = [TAKE({ takeId: 'orig', original: true })];
    vi.stubGlobal('fetch', api({
      get: () => ({ body: { takes } }),
      adopt: () => { takes = takes.map((t) => ({ ...t, adopted: true })); return { body: { ok: true, invalidated: [], warning: '原片当时没能落盘,只存了引擎外链 —— 若链接已过期,这一镜需要重新生成' } }; },
    }));
    render(<SegmentRetakePanel projectId="p1" shotNumber={3} range={null} />);
    await waitFor(() => screen.getByText('回退到原片'));
    fireEvent.click(screen.getByText('回退到原片'));
    await waitFor(() => expect(screen.getByTestId('segment-retake-notice').textContent).toMatch(/若链接已过期/));
  });

  it('**重拍失败把服务端的人话显示出来**(引擎没出片 / 预算 / 时长对不上)', async () => {
    const f = api({
      get: () => ({ body: { takes: [] } }),
      dry: () => ({ body: { dryRun: true, plan: PLAN } }),
      run: () => ({ status: 502, body: { message: '视频引擎没有出片(回落成了静止图占位片),这次不记 take' } }),
    });
    vi.stubGlobal('fetch', f);
    render(<SegmentRetakePanel projectId="p1" shotNumber={3} range={{ fromS: 3, toS: 5 }} />);
    fireEvent.click(screen.getByTestId('segment-retake-preview'));
    await waitFor(() => screen.getByTestId('segment-retake-confirm'));
    fireEvent.click(screen.getByTestId('segment-retake-confirm'));
    await waitFor(() => expect(screen.getByTestId('segment-retake-notice').textContent).toMatch(/静止图占位片/));
  });

  it('预演不通过 → 显示原因,不出确认按钮', async () => {
    vi.stubGlobal('fetch', api({
      get: () => ({ body: { takes: [] } }),
      dry: () => ({ status: 400, body: { message: '选区不足一帧,请拉长选区', plan: { ok: false, reason: '选区不足一帧,请拉长选区' } } }),
    }));
    render(<SegmentRetakePanel projectId="p1" shotNumber={3} range={{ fromS: 3, toS: 3 }} />);
    fireEvent.click(screen.getByTestId('segment-retake-preview'));
    await waitFor(() => expect(screen.getByRole('alert').textContent).toMatch(/不足一帧/));
    expect(screen.queryByTestId('segment-retake-confirm')).toBeNull();
  });

  it('take 列表:当前采用 / 原片(排最后,按钮叫「回退到原片」)/ 占位补丁都标出来;点采用发 adoptTakeId', async () => {
    let takes = [TAKE({ takeId: 'orig', original: true, adopted: false }), TAKE({ takeId: 't2', adopted: true }), TAKE({ takeId: 't3', patchIsAnimatic: true })];
    const f = api({
      get: () => ({ body: { takes } }),
      adopt: () => { takes = takes.map((t) => ({ ...t, adopted: t.takeId === 'orig' })); return { body: { ok: true, invalidated: ['final_video'] } }; },
    });
    vi.stubGlobal('fetch', f);
    render(<SegmentRetakePanel projectId="p1" shotNumber={3} range={null} />);
    await waitFor(() => expect(screen.getAllByTestId('segment-retake-take')).toHaveLength(3));
    const rows = screen.getAllByTestId('segment-retake-take');
    expect(rows[rows.length - 1].textContent, '原片排最后').toMatch(/原片/);
    expect(screen.getByText('当前采用')).toBeTruthy();
    expect(screen.getByText('占位补丁')).toBeTruthy();

    fireEvent.click(screen.getByText('回退到原片'));
    await waitFor(() => expect(screen.getByTestId('segment-retake-notice').textContent).toMatch(/已回退到原片/));
    expect(bodies(f)).toContainEqual({ adoptTakeId: 'orig' });
    expect(screen.getByTestId('segment-retake-notice').textContent, '作废了成片才说要重新合成').toMatch(/成片已标记为需要重新合成/);
  });

  it('**项目还没有成片时不说「成片需要重新合成」**(真机验证时抓到的假话)', async () => {
    let takes = [TAKE({ takeId: 't2' })];
    vi.stubGlobal('fetch', api({
      get: () => ({ body: { takes } }),
      adopt: () => { takes = takes.map((t) => ({ ...t, adopted: true })); return { body: { ok: true, invalidated: ['storyboard#3'] } }; },
    }));
    render(<SegmentRetakePanel projectId="p1" shotNumber={3} range={null} />);
    await waitFor(() => screen.getByText('采用此版本'));
    fireEvent.click(screen.getByText('采用此版本'));
    await waitFor(() => expect(screen.getByTestId('segment-retake-notice').textContent).toMatch(/已采用/));
    expect(screen.getByTestId('segment-retake-notice').textContent).not.toMatch(/成片已标记/);
    expect(screen.getByTestId('segment-retake-notice').textContent).toMatch(/还没有成片/);
  });

  it('读 take 列表失败 → 显示出来,不是静默空白', async () => {
    vi.stubGlobal('fetch', api({ get: () => ({ status: 401, body: {} }) }));
    render(<SegmentRetakePanel projectId="p1" shotNumber={3} range={null} />);
    await waitFor(() => expect(screen.getByRole('alert').textContent).toMatch(/登录已失效/));
  });
});
