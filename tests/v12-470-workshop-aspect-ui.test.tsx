/**
 * v12.470 · 导演控制台「广告包装车间」的出片画幅可选,默认跟随项目。
 *
 * 修前按钮写死 `{ platform: 'douyin', aspect: '9:16' }`,按钮上也没写「竖屏」——
 * 16:9 项目点一下,正式成片就被换成左右裁掉的竖屏版。服务端整链(车间 → recompose → 合成器)
 * 见 tests/v12-470-recompose-asset-aspect.test.ts;这里守的是用户在界面上选到什么、发出去的是什么。
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { DirectorConsole } from '@/components/director-console';

const ASSETS = [
  { type: 'plan', updatedAt: '2026-10-08', stale: false },
  { type: 'script', updatedAt: '2026-10-08', stale: false },
  { type: 'final_video', updatedAt: '2026-10-08', stale: false },
] as any;

function setup(projectAspect: string | undefined) {
  const bodies: Array<Record<string, unknown>> = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    if (String(url).includes('/ad-workshop')) bodies.push(JSON.parse(String(init?.body || '{}')));
    const aspect = (bodies.at(-1)?.aspect as string | undefined) ?? projectAspect;
    return new Response(JSON.stringify({ ok: true, okSteps: 4, totalSteps: 4, steps: { recompose: { ok: true, aspect } } }), { status: 200 });
  }));
  render(<DirectorConsole assets={ASSETS} onEditStage={() => {}} projectId="p1" projectAspect={projectAspect} />);
  return bodies;
}

const select = () => screen.getByTestId('workshop-aspect') as HTMLSelectElement;
const runWorkshop = () => fireEvent.click(screen.getByText(/广告包装车间/));

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('v12.470 · 广告包装车间画幅选择', () => {
  it('默认「跟随项目」并标出项目画幅;请求里不带 aspect,交给服务端读 projects.aspect', async () => {
    const bodies = setup('16:9');
    expect(select().value).toBe('');
    expect(select().selectedOptions[0].textContent).toBe('跟随项目(16:9)');
    expect(screen.queryByTestId('workshop-aspect-note')).toBeNull();
    runWorkshop();
    await waitFor(() => expect(bodies).toHaveLength(1));
    expect(bodies[0]).toEqual({ platform: 'douyin' });
    await waitFor(() => expect(screen.getByText(/包装 4\/4\(16:9\)/)).toBeTruthy());
  });

  it('三档都能选,选什么发什么', async () => {
    const bodies = setup('16:9');
    const values = Array.from(select().options).map((o) => o.value);
    expect(values).toEqual(['', '9:16', '16:9', '1:1']);
    fireEvent.change(select(), { target: { value: '1:1' } });
    runWorkshop();
    await waitFor(() => expect(bodies).toHaveLength(1));
    expect(bodies[0]).toEqual({ platform: 'douyin', aspect: '1:1' });
  });

  it('横屏项目选竖屏:先说清会裁掉左右、会替换正式成片', () => {
    setup('16:9');
    fireEvent.change(select(), { target: { value: '9:16' } });
    expect(screen.getByTestId('workshop-aspect-note').textContent).toContain('与项目画幅 16:9 不同:画面左右会被裁掉,并替换当前正式成片');
  });

  it('竖屏项目选横屏:提示的是补黑边而不是裁切(合成画布横屏是缩入补边)', () => {
    setup('9:16');
    expect(select().selectedOptions[0].textContent).toBe('跟随项目(9:16)');
    fireEvent.change(select(), { target: { value: '16:9' } });
    expect(screen.getByTestId('workshop-aspect-note').textContent).toContain('画面会缩小并补黑边');
  });

  it('选的正好是项目画幅 → 不提示', () => {
    setup('9:16');
    fireEvent.change(select(), { target: { value: '9:16' } });
    expect(screen.queryByTestId('workshop-aspect-note')).toBeNull();
  });

  it('项目页真的把项目画幅传给了导演控制台(否则「跟随项目」后面永远是空的)', async () => {
    const fs = await import('node:fs');
    const src = fs.readFileSync('app/projects/[id]/page.tsx', 'utf-8');
    const at = src.indexOf('<DirectorConsole');
    expect(at).toBeGreaterThan(0);
    expect(src.slice(at, src.indexOf('/>', at))).toMatch(/projectAspect=\{project\?\.aspect\}/);
  });
});
