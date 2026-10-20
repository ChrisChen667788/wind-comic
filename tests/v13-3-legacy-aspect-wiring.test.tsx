/**
 * v13.3 — 旧库画幅修复的接线:启动钩子、系列封面 / 整季导出、MasterPrompt「用此创作」。
 * 判定与修复本身(真库 + 真媒体)见 v13-3-legacy-aspect。
 *
 * 这一份真调入口函数,只把外部依赖(鉴权、库、出图引擎、ffmpeg 拼接、落盘)换成记录入参的假实现,
 * 断言的是**下游收到了什么**,不是源码里写了什么:
 * 1. instrumentation.register():nodejs 运行时排程一次修复;edge 运行时不排;修复模块抛错不让启动失败;
 * 2. 系列封面:锚点集记着 2.35:1 → 出图引擎收到 16:9(修前原样收 2.35:1);空值仍按 9:16;
 * 3. 整季导出:已完成集记着 2.35:1 → 拼接画幅与记进 season_video 的 aspect 都是 16:9(修前记 2.35:1、画布 1280x720);
 * 4. MasterPrompt 页(真渲染):默认的 2.39:1 → 提示按 16:9 出,「用此创作」带 16:9;改成 9:16 → 没有提示、带 9:16;
 *    认不出的写法 → 提示用创建页的设置,并清掉残留的 qfmj-create-aspect(否则创建页会采用上一次带来的画幅)。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const st = vi.hoisted(() => ({
  scheduled: 0,
  scheduleThrows: false,
  eps: [] as Array<Record<string, unknown>>,
  imageCalls: [] as Array<Record<string, unknown>>,
  concatAspects: [] as string[],
  upserts: [] as Array<Record<string, unknown>>,
  push: [] as string[],
}));

// ── 启动钩子的依赖 ──
vi.mock('@/lib/server-proxy', () => ({ installServerProxy: async () => null }));
vi.mock('@/lib/telemetry', () => ({ initSentry: async () => {} }));
vi.mock('@/lib/model-overrides', () => ({ loadModelOverridesIntoEnv: async () => 0 }));
vi.mock('@/lib/pipeline-worker', () => ({ ensurePipelineWorker: () => {} }));
vi.mock('@/lib/legacy-aspect-repair', () => ({
  scheduleLegacyAspectRepair: () => {
    if (st.scheduleThrows) throw new Error('db gone');
    st.scheduled++;
    return null;
  },
}));

// ── 系列路由的依赖 ──
vi.mock('@/app/api/auth/lib', () => ({ getUserFromRequest: () => ({ sub: 'u-133' }) }));
vi.mock('@/lib/repos/series-repo', () => ({ listSeriesEpisodes: async () => st.eps }));
vi.mock('@/lib/repos/asset-repo', () => ({
  listAssetsByType: async (_projectId: string, type: string) =>
    (type === 'final_video' ? [{ persistent_url: '/api/serve-file?key=ep' }] : []),
  upsertAsset: async (a: Record<string, unknown>) => { st.upserts.push(a); return a; },
}));
vi.mock('@/lib/asset-storage', () => ({ persistAsset: async () => ({ url: '/api/serve-file?key=persisted' }) }));
vi.mock('@/lib/budget-enforce', () => ({ assertBudget: async () => ({ allow: true }) }));
vi.mock('@/lib/image-providers/builtins', () => ({}));
vi.mock('@/lib/image-providers/registry', () => ({
  dispatchImageGenerate: async (req: Record<string, unknown>) => {
    st.imageCalls.push(req);
    return { result: { imageUrl: 'https://cdn.example/cover.png' }, tried: [] };
  },
}));
vi.mock('@/lib/repos/resource-lock-repo', () => ({
  acquireLock: async () => true, releaseLock: async () => {}, makeLockOwner: () => 'owner-133',
}));
vi.mock('@/lib/serve-file-sign', () => ({ serveFilePathUrl: (p: string) => `/api/serve-file?path=${encodeURIComponent(p)}` }));
vi.mock('@/services/video-composer', () => ({
  concatVideos: async (urls: string[], aspect: string, tmpDir: string) => {
    st.concatAspects.push(aspect);
    return { outputPath: `${tmpDir}/season.mp4`, count: urls.length };
  },
}));

vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ push: (u: string) => { st.push.push(u); }, replace: () => {}, prefetch: () => {} }),
  usePathname: () => '/dashboard/master-prompt',
}));

beforeEach(() => {
  st.scheduled = 0;
  st.scheduleThrows = false;
  st.eps = [];
  st.imageCalls.length = 0;
  st.concatAspects.length = 0;
  st.upserts.length = 0;
  st.push.length = 0;
});

// ── 1. 启动钩子 ─────────────────────────────────────────────────────────────
describe('v13.3 · 启动时排程一次旧库画幅修复', () => {
  const runtime = process.env.NEXT_RUNTIME;
  afterEach(() => {
    if (runtime === undefined) delete process.env.NEXT_RUNTIME; else process.env.NEXT_RUNTIME = runtime;
  });

  it('nodejs 运行时:register() 排程一次', async () => {
    process.env.NEXT_RUNTIME = 'nodejs';
    const { register } = await import('@/instrumentation');
    await register();
    expect(st.scheduled).toBe(1);
  });

  it('edge 运行时:不排程(那里没有库也没有 ffprobe)', async () => {
    process.env.NEXT_RUNTIME = 'edge';
    const { register } = await import('@/instrumentation');
    await register();
    expect(st.scheduled).toBe(0);
  });

  it('修复模块抛错:register() 照样完成 —— 修不了也不该让服务起不来', async () => {
    process.env.NEXT_RUNTIME = 'nodejs';
    st.scheduleThrows = true;
    const { register } = await import('@/instrumentation');
    await expect(register()).resolves.toBeUndefined();
  });
});

// ── 2. 系列封面 ─────────────────────────────────────────────────────────────
const ep = (aspect: string | null, extra: Record<string, unknown> = {}) =>
  ({ id: `ep-${Math.random().toString(36).slice(2, 8)}`, title: '雨夜 第1集', aspect, status: 'completed', episode_number: 1, ...extra });
const post = (body: unknown = {}) =>
  new Request('http://localhost/api/series/s-133/x', { method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json' } });
const params = { params: Promise.resolve({ id: 's-133' }) };

describe('v13.3 · 系列封面按归一后的画幅出图', () => {
  it.each([
    ['2.35:1', '16:9'], // 修前原样交给出图引擎
    ['21:9', '16:9'],
    ['9:16', '9:16'],
    ['1:1', '1:1'],
    [null, '9:16'],      // 没记画幅:保持原来的默认
  ])('锚点集画幅 %s → 出图引擎收到 %s', async (aspect, expected) => {
    st.eps = [ep(aspect)];
    const { POST } = await import('@/app/api/series/[id]/cover/route');
    const res = await POST(post(), params);
    expect(res.status).toBe(200);
    expect(st.imageCalls).toHaveLength(1);
    expect(st.imageCalls[0].aspectRatio).toBe(expected);
  });
});

// ── 3. 整季导出 ─────────────────────────────────────────────────────────────
describe('v13.3 · 整季导出记下的画幅与拼接画布一致', () => {
  it.each([
    ['2.35:1', '16:9'],
    ['9:16', '9:16'],
    [null, '16:9'],
  ])('已完成集画幅 %s → 拼接画幅与 season_video.aspect 都是 %s', async (aspect, expected) => {
    st.eps = [ep(aspect)];
    const { POST } = await import('@/app/api/series/[id]/export/route');
    const res = await POST(post({ ignoreHealth: true }), params);
    expect(res.status).toBe(200);
    expect(st.concatAspects).toEqual([expected]);
    const season = st.upserts.find((u) => u.type === 'season_video') as { data: { aspect: string } } | undefined;
    expect(season?.data.aspect).toBe(expected);
  });
});

// ── 4. MasterPrompt 页 ──────────────────────────────────────────────────────
async function renderMasterPrompt() {
  const { render, fireEvent, cleanup } = await import('@testing-library/react');
  const React = (await import('react')).default;
  const { default: MasterPromptPage } = await import('@/app/dashboard/master-prompt/page');
  const utils = render(React.createElement(MasterPromptPage));
  const aspectInput = () => {
    const label = [...utils.container.querySelectorAll('label')].find((l) => l.textContent?.trim().startsWith('画幅'));
    const input = label?.querySelector('input');
    if (!input) throw new Error('找不到「画幅」输入框');
    return input as HTMLInputElement;
  };
  const hint = () => utils.container.querySelector('[data-testid="mp-aspect-hint"]')?.textContent ?? null;
  const sendToCreate = () => {
    const b = [...utils.container.querySelectorAll('button')].find((x) => x.textContent?.includes('用此创作'));
    if (!b) throw new Error('找不到「用此创作」');
    fireEvent.click(b);
  };
  const setAspect = (v: string) => fireEvent.change(aspectInput(), { target: { value: v } });
  return { ...utils, aspectInput, hint, sendToCreate, setAspect, cleanup };
}

describe('v13.3 · MasterPrompt「用此创作」把画幅一起带给创建页', { timeout: 60_000 }, () => {
  afterEach(async () => {
    const { cleanup } = await import('@testing-library/react');
    cleanup();
    sessionStorage.clear();
  });

  it('默认 2.39:1:提示按 16:9 出,带过去的是 16:9,并跳到创建页', async () => {
    const { aspectInput, hint, sendToCreate } = await renderMasterPrompt();
    expect(aspectInput().value).toBe('2.39:1');
    expect(hint()).toContain('16:9');
    sendToCreate();
    expect(sessionStorage.getItem('qfmj-create-aspect')).toBe('16:9');
    expect(sessionStorage.getItem('qfmj-create-seed')).toContain('[Master Prompt]');
    expect(st.push).toEqual(['/dashboard/create']);
  });

  it('改成 9:16:没有提示(创建页认得),带过去的是 9:16', async () => {
    const { setAspect, hint, sendToCreate } = await renderMasterPrompt();
    setAspect('9:16');
    expect(hint()).toBeNull();
    sendToCreate();
    expect(sessionStorage.getItem('qfmj-create-aspect')).toBe('9:16');
  });

  it('反面:认不出的写法 → 提示用创建页设置,并清掉上一次残留的画幅', async () => {
    sessionStorage.setItem('qfmj-create-aspect', '1:1'); // 上一次从别处带来、没被消费的
    const { setAspect, hint, sendToCreate } = await renderMasterPrompt();
    setAspect('cinemascope');
    expect(hint()).toContain('创建页的画幅设置');
    sendToCreate();
    expect(sessionStorage.getItem('qfmj-create-aspect')).toBeNull();
    expect(sessionStorage.getItem('qfmj-create-seed')).toBeTruthy();
  });
});
