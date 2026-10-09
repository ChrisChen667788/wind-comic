/**
 * v12.473 — 极速分镜台(/dashboard/short-video)的参数面板:只留有读者的参数,画幅真交给创建页。
 *
 * ── 怎么发现的(逐个参数 git grep 读者,排除定义处和测试) ─────────────────────
 *   - 分辨率 1080P / 4K / 8K(默认 8K)、帧率 24 / 30 / 60:只有本页底部状态条回显;
 *     创建管线没有分辨率 / 帧率入参(帧率在项目页格式条,单镜 4K 在镜头工坊重渲);
 *   - 超分 1x / 2x / 4x(默认 4x)、插帧 ON(默认开)、运动强度滑条:全仓零读者;
 *   - 画幅:只有「预览」发给 /api/preview-shot(2.39:1 不在它的白名单,兜成 16:9);
 *     「用此方案去创作」只往 `qfmj-create-seed` 写创意 + 分镜文字,画幅一个都没带,
 *     到创建页回到默认 9:16 / 上次的偏好 —— 选 16:9 规划的方案在创建页按竖屏出片;
 *     2.39:1 视频引擎本来就出不了(PROJECT_ASPECTS 只有三种);
 *   - 运镜速度:有读者(编进每镜 AI prompt),但切换后不重编已出的三镜,复制 / 预览 / 导出拿到的还是旧速度;
 *     改某镜运镜 / 景别时重编拿的是中文画面描述,LLM 给的英文画面描述就丢了;
 *   - 导出的分镜表里没有任何输出参数。
 *
 * ── 这一份锁什么 ─────────────────────────────────────────────────────────
 * 1. lib:参数只剩 cameraSpeed + aspectRatio;交接 / 改参 / 导出三个纯函数;
 * 2. 极速分镜台(真渲染):面板里没有 8K / 60fps / 2.39:1 / 超分 / 插帧 / 运动强度;画幅按钮就是三种;
 *    选 16:9 → 预览发 16:9、交给创建页的是 16:9、导出文档写着 16:9;切「快」→ 三镜 prompt 全部重编且保留 LLM 描述;
 * 3. 创建页(真渲染):跟着 seed 来的画幅被采用,且不被「恢复上次偏好」盖掉;不合法 / 没跟 seed 的画幅不采用。
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { PROJECT_ASPECTS } from '@/lib/video-aspect';
import * as sv from '@/lib/short-video';
import { parseShortVideoPlan, defaultParams, RHYTHM_TEMPLATES, type ShortVideoPlan } from '@/lib/short-video';

const nav = vi.hoisted(() => ({ push: [] as string[] }));
vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ push: (u: string) => { nav.push.push(u); }, replace: () => {}, prefetch: () => {} }),
  usePathname: () => '/dashboard/short-video',
}));

afterEach(async () => {
  const { cleanup } = await import('@testing-library/react');
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  localStorage.clear();
  sessionStorage.clear();
  nav.push.length = 0;
});

const RAW = {
  title: '雨夜追凶',
  shots: [
    { phase: 'hook', frameContent: '暴雨贫民窟', aiPrompt: 'cyberpunk slum heavy rain neon' },
    { phase: 'body', frameContent: '侦探点烟', aiPrompt: 'detective lighting a cigarette' },
    { phase: 'climax', frameContent: '踩灭烟头', aiPrompt: 'boot stepping on cigarette' },
  ],
};
const LLM_CORES = RAW.shots.map((s) => s.aiPrompt);
const makePlan = (durationS = 15): ShortVideoPlan =>
  parseShortVideoPlan(RAW, { idea: '雨夜侦探发现线索', style: 'noir', durationS, rhythmId: 'suspense' });

// ── 1. lib ──────────────────────────────────────────────────────────────
describe('v12.473 · 参数只剩有读者的两个', () => {
  it('defaultParams 只有运镜速度 + 画幅;画幅在 PROJECT_ASPECTS 里', () => {
    const p = defaultParams(sv.getRhythmTemplate('blockbuster'));
    expect(Object.keys(p).sort()).toEqual(['aspectRatio', 'cameraSpeed']);
    expect(p.cameraSpeed).toBe('fast');
    expect(PROJECT_ASPECTS).toContain(p.aspectRatio);
  });

  it('节奏模板不再带没人读的运动强度', () => {
    for (const t of RHYTHM_TEMPLATES) expect(t).not.toHaveProperty('motionIntensity');
  });
});

describe('v12.473 · 交给创建页 / 改参 / 导出', () => {
  it.each(PROJECT_ASPECTS.map((a) => [a]))('画幅 %s 原样交给创建页', (a) => {
    const plan = sv.applyParamsPatch(makePlan(), { aspectRatio: a });
    expect(sv.buildCreateHandoff(plan).aspect).toBe(a);
  });

  it('不在清单里的画幅(旧客户端残留的 2.39:1)不带 —— 创建页照旧', () => {
    const plan = { ...makePlan(), params: { ...makePlan().params, aspectRatio: '2.39:1' as any } };
    expect(sv.buildCreateHandoff(plan).aspect).toBeNull();
  });

  it('seed 文字:创意 + 三幕画面 + 运镜;时长按方案写(30s 方案不再写成 15s)', () => {
    const { seed } = sv.buildCreateHandoff(makePlan(30));
    expect(seed.startsWith('雨夜侦探发现线索\n\n[30s 三幕分镜]\n')).toBe(true);
    expect(seed).toContain('HOOK 暴雨贫民窟（');
    expect(seed).toContain('CLIMAX 踩灭烟头（');
  });

  it('切运镜速度 → 三镜 prompt 全部重编,LLM 的英文描述还在', () => {
    const plan = makePlan(); // suspense → slow
    expect(plan.shots.every((s) => s.aiPrompt.includes('slow camera move'))).toBe(true);
    const fast = sv.applyParamsPatch(plan, { cameraSpeed: 'fast' });
    fast.shots.forEach((s, i) => {
      expect(s.aiPrompt).toContain('fast camera move');
      expect(s.aiPrompt).not.toContain('slow camera move');
      expect(s.aiPrompt).toContain(LLM_CORES[i]);
    });
    expect(plan.shots[0].aiPrompt).toContain('slow camera move'); // 纯函数,不改入参
  });

  it('只改画幅不动三镜', () => {
    const plan = makePlan();
    const next = sv.applyParamsPatch(plan, { aspectRatio: '16:9' });
    expect(next.shots).toBe(plan.shots);
    expect(next.params.aspectRatio).toBe('16:9');
  });

  it('改某镜运镜 / 景别 → 只重编该镜,LLM 的英文描述不丢(修前换成了中文画面描述)', () => {
    const plan = makePlan();
    const next = sv.applyShotPatch(plan, 2, { cameraMoveId: 'tracking-shot', shotSize: 'CU' });
    const s2 = next.shots[1];
    expect(s2).toMatchObject({ cameraMoveId: 'tracking-shot', cameraMoveLabel: '跟拍', cameraType: 'Tracking', shotSize: 'CU' });
    expect(s2.aiPrompt).toContain('tracking shot following the subject');
    expect(s2.aiPrompt).toContain('close up');
    expect(s2.aiPrompt).toContain(LLM_CORES[1]);
    expect(s2.aiPrompt).not.toContain('侦探点烟');
    expect(next.shots[0]).toBe(plan.shots[0]); // 别的镜原样不动
    expect(next.shots[2]).toBe(plan.shots[2]);
  });

  it('导出的分镜表写着画幅与运镜速度', () => {
    const md = sv.buildStoryboardMarkdown(sv.applyParamsPatch(makePlan(), { aspectRatio: '16:9', cameraSpeed: 'fast' }));
    expect(md).toContain('画幅:16:9');
    expect(md).toContain('运镜速度:快');
    expect(md).toContain('## HOOK 01 (0s–3s)');
    expect(md).not.toMatch(/8K|fps|Upscale|插帧/);
  });
});

// ── 2. 极速分镜台(真渲染) ──────────────────────────────────────────────
type Sent = { url: string; body: Record<string, unknown> };

async function renderPlannedStudio() {
  const sent: Sent[] = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    if (typeof init?.body === 'string') sent.push({ url, body: JSON.parse(init.body) });
    if (url === '/api/short-video/plan') return new Response(JSON.stringify({ plan: makePlan() }), { status: 200 });
    return new Response(JSON.stringify({ error: 'stub' }), { status: 500 });
  }));
  const { render, fireEvent, screen, waitFor } = await import('@testing-library/react');
  const React = (await import('react')).default;
  const { default: ShortVideoStudioPage } = await import('@/app/dashboard/short-video/page');
  const utils = render(React.createElement(ShortVideoStudioPage));
  fireEvent.change(screen.getByPlaceholderText(/输入创意/), { target: { value: '雨夜侦探发现线索' } });
  fireEvent.click(screen.getByRole('button', { name: /生成分镜计划/ }));
  await waitFor(() => expect(screen.getByRole('button', { name: /用此方案去创作/ })).toBeTruthy());
  const aside = () => screen.getByRole('button', { name: /用此方案去创作/ }).closest('aside') as HTMLElement;
  const prompts = () => [...utils.container.querySelectorAll('main code')].map((c) => c.textContent ?? '');
  const clickText = (root: HTMLElement, text: string) => {
    const b = [...root.querySelectorAll('button')].find((x) => x.textContent?.trim() === text);
    if (!b) throw new Error(`没有「${text}」按钮`);
    fireEvent.click(b);
  };
  return { ...utils, sent, aside, prompts, clickText, fireEvent, screen, waitFor };
}

describe('v12.473 · 极速分镜台面板', { timeout: 60_000 }, () => {
  it('没有 8K / 4K / 60fps / 2.39:1 / 超分 / 插帧 / 运动强度;画幅按钮就是 PROJECT_ASPECTS', async () => {
    const { aside, container } = await renderPlannedStudio();
    const panel = aside();
    expect(panel.textContent).not.toMatch(/8K|1080P|fps|2\.39|Upscale|放大|插帧|Interpolation|Motion Intensity/);
    expect(panel.querySelectorAll('select, input[type="range"]')).toHaveLength(0);
    const aspectButtons = [...panel.querySelectorAll('[data-testid="sv-aspect"] button')].map((b) => b.textContent?.trim());
    expect(aspectButtons).toEqual([...PROJECT_ASPECTS]);
    // 底部状态条也不再写 8K · 24fps
    expect(container.querySelector('.cinema-statusbar')?.textContent).not.toMatch(/8K|fps/);
  });

  it('选 16:9 → 交给创建页的是 16:9(连同 seed 文字),并跳到创建页', async () => {
    const { aside, clickText, screen, fireEvent } = await renderPlannedStudio();
    clickText(aside(), '16:9');
    fireEvent.click(screen.getByRole('button', { name: /用此方案去创作/ }));
    expect(sessionStorage.getItem('qfmj-create-aspect')).toBe('16:9');
    expect(sessionStorage.getItem('qfmj-create-seed')).toContain('雨夜侦探发现线索');
    expect(nav.push).toEqual(['/dashboard/create']);
  });

  it('默认 9:16 也照样交过去(不是只在改过时才带)', async () => {
    const { screen, fireEvent } = await renderPlannedStudio();
    fireEvent.click(screen.getByRole('button', { name: /用此方案去创作/ }));
    expect(sessionStorage.getItem('qfmj-create-aspect')).toBe('9:16');
  });

  it('选 1:1 → 试拍预览发的也是 1:1', async () => {
    const { aside, clickText, container, fireEvent, sent, waitFor } = await renderPlannedStudio();
    clickText(aside(), '1:1');
    const preview = [...container.querySelectorAll('main button')].find((b) => b.textContent?.includes('预览'));
    fireEvent.click(preview!);
    await waitFor(() => expect(sent.some((s) => s.url === '/api/preview-shot')).toBe(true));
    expect(sent.find((s) => s.url === '/api/preview-shot')!.body.aspect).toBe('1:1');
  });

  it('切到「快」→ 三镜展示的 AI Prompt 立刻重编,LLM 描述还在', async () => {
    const { aside, clickText, prompts, waitFor } = await renderPlannedStudio();
    expect(prompts().every((p) => p.includes('slow camera move'))).toBe(true);
    clickText(aside(), '快');
    await waitFor(() => expect(prompts().every((p) => p.includes('fast camera move'))).toBe(true));
    prompts().forEach((p, i) => expect(p).toContain(LLM_CORES[i]));
  });

  it('改某镜运镜 → 该镜 prompt 仍保留 LLM 的英文描述', async () => {
    const { container, prompts, fireEvent, waitFor } = await renderPlannedStudio();
    const bodySelect = container.querySelectorAll('main select')[1] as HTMLSelectElement;
    fireEvent.change(bodySelect, { target: { value: 'tracking-shot' } });
    await waitFor(() => expect(prompts()[1]).toContain('tracking shot'));
    expect(prompts()[1]).toContain(LLM_CORES[1]);
  });

  it('导出分镜表 → 文档里有画幅', async () => {
    const blobs: Blob[] = [];
    (URL as any).createObjectURL = vi.fn((b: Blob) => { blobs.push(b); return 'blob:sv'; });
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    const { aside, clickText, screen, fireEvent } = await renderPlannedStudio();
    clickText(aside(), '16:9');
    fireEvent.click(screen.getByRole('button', { name: /导出分镜表/ }));
    expect(blobs).toHaveLength(1);
    expect(await blobs[0].text()).toContain('画幅:16:9');
  });
});

// ── 3. 创建页(真渲染) ──────────────────────────────────────────────────
async function renderCreatePage() {
  vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 200 })));
  const { render, waitFor } = await import('@testing-library/react');
  const React = (await import('react')).default;
  const { default: DashboardCreatePage } = await import('@/app/dashboard/create/page');
  const { ToastProvider } = await import('@/components/ui/toast-provider');
  const { container } = render(React.createElement(ToastProvider, null, React.createElement(DashboardCreatePage)));
  const selected = () => [...container.querySelectorAll('button.cinema-btn-primary')]
    .map((b) => b.textContent?.trim() ?? '').filter((t) => /^\d+(\.\d+)?:\d+$/.test(t));
  await new Promise((r) => setTimeout(r, 50)); // 让挂载时的 seed / 偏好 effect 跑完
  return { container, selected, waitFor };
}

describe('v12.473 · 创建页采用极速分镜台带来的画幅', { timeout: 60_000 }, () => {
  it('seed + 16:9 → 选中 16:9,创意填好,两个 key 都被消费掉', async () => {
    sessionStorage.setItem('qfmj-create-seed', '雨夜侦探发现线索\n\n[15s 三幕分镜]\nHOOK 暴雨贫民窟');
    sessionStorage.setItem('qfmj-create-aspect', '16:9');
    const { selected, container, waitFor } = await renderCreatePage();
    await waitFor(() => expect(selected()).toEqual(['16:9']));
    expect(container.textContent + [...container.querySelectorAll('textarea')].map((t) => t.value).join('')).toContain('暴雨贫民窟');
    expect(sessionStorage.getItem('qfmj-create-aspect')).toBeNull();
    expect(sessionStorage.getItem('qfmj-create-seed')).toBeNull();
  });

  it('上次偏好是 1:1、带来的是 16:9 → 以带来的为准(恢复偏好不盖掉)', async () => {
    localStorage.setItem('windcomic.createPrefs.v1', JSON.stringify({ aspect: '1:1', scriptLanguage: 'zh' }));
    sessionStorage.setItem('qfmj-create-seed', '雨夜侦探发现线索');
    sessionStorage.setItem('qfmj-create-aspect', '16:9');
    const { selected, waitFor } = await renderCreatePage();
    await waitFor(() => expect(selected()).toEqual(['16:9']));
  });

  it('反面:带来的是引擎出不了的 2.39:1 → 不采用,照常恢复上次偏好 1:1', async () => {
    localStorage.setItem('windcomic.createPrefs.v1', JSON.stringify({ aspect: '1:1', scriptLanguage: 'zh' }));
    sessionStorage.setItem('qfmj-create-seed', '雨夜侦探发现线索');
    sessionStorage.setItem('qfmj-create-aspect', '2.39:1');
    const { selected, waitFor } = await renderCreatePage();
    await waitFor(() => expect(selected()).toEqual(['1:1']));
    expect(sessionStorage.getItem('qfmj-create-aspect')).toBeNull();
  });

  it('反面:只有画幅没有 seed(残留)→ 不采用并清掉,停在默认 9:16', async () => {
    sessionStorage.setItem('qfmj-create-aspect', '16:9');
    const { selected, waitFor } = await renderCreatePage();
    await waitFor(() => expect(selected()).toEqual(['9:16']));
    expect(sessionStorage.getItem('qfmj-create-aspect')).toBeNull();
  });
});
