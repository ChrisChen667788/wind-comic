/**
 * v12.468 — 2.35:1 下线;能选的画幅 = 视频引擎真出得了的画幅。
 *
 * ── 怎么发现的 ────────────────────────────────────────────────────────
 * 创建页画幅给了 9:16 / 16:9 / 1:1 / 2.35:1 四个。选 2.35:1 时:
 *   - create-pipeline 把 '2.35:1' 原样写进 projects.aspect;
 *   - 编排器 `setAspect` 只认 `^\d+:\d+$`,把它拒掉(只打一行 warn),this.aspect 留在默认 16:9;
 *   - Style Bible 那一步看到 aspect === '16:9' 又按题材把漫剧 / 短剧翻成 9:16。
 * 于是项目行写着 2.35:1,出的却是 16:9 或 9:16。视频引擎本来就只出 16:9 / 9:16 / 1:1
 * (normalizeVideoAspect),出图引擎里 MiniMax 的尺寸表没有 2.35:1(会落到 1:1),MJ 的 --ar 不收小数。
 * 分镜整张重生、九宫格候选两个弹窗也各自给了 2.35:1,同样被拒成 16:9。
 *
 * 顺带的同类问题:用户**显式选了 16:9**,漫剧题材照样被翻成 9:16(判据只看 aspect === '16:9',
 * 分不清默认值和用户选的),项目行记 16:9。
 * (两个弹窗的 `defaultAspectRatio` 没有调用方传、9:16 项目重生默认 16:9 —— 这条 v12.467 已接上,
 *  由 v12-467-image-entry-aspect 锁;它新增的 parseProjectAspect 本版改为复用 parseRequestedAspect。)
 *
 * ── 这一份锁什么(管线回写见 v12-468-aspect-pipeline) ──────────────────────
 * 1. 唯一清单 PROJECT_ASPECTS 与请求画幅的解析;
 * 2. 故事模板不再推荐引擎出不了的画幅;
 * 3. 两个弹窗只给三种画幅;1:1 项目发 1:1、旧库里的 2.35:1 项目发 16:9;项目页把画幅递给镜头工坊;
 * 4. 编排器:2.35:1 按横竖就近归而不是丢掉;显式指定过的画幅不再被题材翻转;
 * 5. 创建页(真渲染):只有三个画幅按钮;上次存下的 2.35:1 偏好不恢复。
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import fs from 'node:fs';
import ts from 'typescript';
import { PROJECT_ASPECTS, isProjectAspect, parseRequestedAspect, normalizeVideoAspect } from '@/lib/video-aspect';
import { storyTemplates } from '@/lib/story-templates';

vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ push: () => {}, replace: () => {}, prefetch: () => {} }),
  usePathname: () => '/dashboard/create',
}));

afterEach(async () => {
  const { cleanup } = await import('@testing-library/react');
  cleanup();
  vi.unstubAllGlobals();
  localStorage.clear();
});

// ── 1. 唯一清单 + 解析 ──────────────────────────────────────────────────
describe('v12.468 · 项目画幅清单', () => {
  it('只有视频引擎出得了的三种,且每一种过 normalizeVideoAspect 都原样不变', () => {
    expect([...PROJECT_ASPECTS].sort()).toEqual(['16:9', '1:1', '9:16']);
    for (const a of PROJECT_ASPECTS) expect(normalizeVideoAspect(a)).toBe(a);
    expect(isProjectAspect('2.35:1')).toBe(false);
    expect(isProjectAspect('9:16')).toBe(true);
    expect(isProjectAspect(' 9:16')).toBe(false); // 不偷偷 trim:存进 localStorage 的就是按钮上的原值
    expect(isProjectAspect(undefined)).toBe(false);
  });

  it.each([
    ['9:16', '9:16'], ['16:9', '16:9'], ['1:1', '1:1'],
    ['2.35:1', '16:9'], ['2.39:1', '16:9'], ['21:9', '16:9'], ['4:3', '16:9'],
    ['3:4', '9:16'], ['1:2.35', '9:16'], [' 16 : 9 ', '16:9'], ['2:2', '1:1'],
  ])('请求画幅 %s → 出片 %s', (input, expected) => {
    expect(parseRequestedAspect(input)).toBe(expected);
  });

  it.each([[undefined], [null], [''], ['wide'], ['0:1'], ['16:0'], ['abc:def'], [16 / 9]])(
    '%s 不算指定了画幅(返回 null,由调用方按「没指定」处理)', (input) => {
      expect(parseRequestedAspect(input)).toBeNull();
    });
});

// ── 2. 模板 ─────────────────────────────────────────────────────────────
describe('v12.468 · 故事模板只推荐出得了的画幅', () => {
  it('每个模板的 recommendedAspect 都在清单里(科幻 / 历史两个原为 2.35:1)', () => {
    const withAspect = storyTemplates.filter((t) => t.recommendedAspect !== undefined);
    expect(withAspect.length).toBeGreaterThan(0);
    for (const t of withAspect) expect(isProjectAspect(t.recommendedAspect), t.id).toBe(true);
    expect(storyTemplates.find((t) => t.id === 'sci-fi-space')?.recommendedAspect).toBe('16:9');
    expect(storyTemplates.find((t) => t.id === 'historical-biopic')?.recommendedAspect).toBe('16:9');
  });
});

// ── 3. 镜头工坊 → 两个弹窗 ────────────────────────────────────────────────
type Sent = { url: string; body: Record<string, unknown> };

/** 记下所有 POST 的请求体;都回 500 无流,让弹窗尽快收尾 —— 断言只看「发出去的是什么」 */
function stubFetch(): Sent[] {
  const sent: Sent[] = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    if (init?.method === 'POST' && typeof init.body === 'string') sent.push({ url, body: JSON.parse(init.body) });
    if (!init?.method || init.method === 'GET') return new Response(JSON.stringify({ items: [] }), { status: 200 });
    return new Response(null, { status: 500 });
  }));
  return sent;
}

async function renderWorkshop(aspect: string | null | undefined) {
  const { render } = await import('@testing-library/react');
  const React = (await import('react')).default;
  const { ShotWorkshopTab } = await import('@/components/project/shot-workshop-tab');
  return render(React.createElement(ShotWorkshopTab, {
    projectId: 'p465',
    aspect,
    videos: [{ shotNumber: 1, videoUrl: '/v1.mp4', meta: { prompt: '雨夜街头,女主撑伞回头' } }],
    storyboards: [{ shotNumber: 1, imageUrl: '/s1.png' }],
  }));
}

/** 弹窗里的画幅按钮(文字形如 W:H 的按钮) */
const aspectButtons = (root: HTMLElement) =>
  [...root.querySelectorAll('button')].map((b) => b.textContent?.trim() ?? '').filter((t) => /^\d+(\.\d+)?:\d+$/.test(t));

// 「9:16 项目发 9:16、不传画幅发 16:9」由 v12-467-image-entry-aspect 锁;这里只锁 v12.468 新增的部分。
describe('v12.468 · 镜头工坊的两个弹窗按项目画幅出图', () => {
  it('两个弹窗都只给清单里的三种画幅(没有 2.35:1)', async () => {
    const { fireEvent, screen, cleanup } = await import('@testing-library/react');
    for (const [open, label] of [['改 prompt 重生', '分镜重生'], ['九宫格选帧', '九宫格']] as const) {
      cleanup();
      stubFetch();
      const { container } = await renderWorkshop('9:16');
      fireEvent.click(screen.getByText(open));
      expect(aspectButtons(container), label).toEqual([...PROJECT_ASPECTS]);
    }
  });

  it('反面:1:1 项目发 1:1;旧库里记成 2.35:1 的项目发 16:9(引擎实际出的),不发 2.35:1', async () => {
    const { fireEvent, waitFor, screen } = await import('@testing-library/react');
    for (const [aspect, expected] of [['1:1', '1:1'], ['2.35:1', '16:9'], [null, '16:9']] as const) {
      const { cleanup } = await import('@testing-library/react');
      cleanup();
      const sent = stubFetch();
      await renderWorkshop(aspect);
      fireEvent.click(screen.getByText('改 prompt 重生'));
      fireEvent.click(screen.getByText('重生这一镜'));
      await waitFor(() => expect(sent.some((s) => s.url.endsWith('/regenerate-storyboard'))).toBe(true));
      expect(sent.find((s) => s.url.endsWith('/regenerate-storyboard'))!.body.aspectRatio, `aspect=${aspect}`).toBe(expected);
    }
  });

  it('项目页把详情接口的画幅递给唯一的 <ShotWorkshopTab>', () => {
    const file = 'app/projects/[id]/page.tsx';
    const sf = ts.createSourceFile(file, fs.readFileSync(file, 'utf-8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const tabs: ts.JsxAttributes[] = [];
    const walk = (n: ts.Node) => {
      if ((ts.isJsxSelfClosingElement(n) || ts.isJsxOpeningElement(n)) && n.tagName.getText(sf) === 'ShotWorkshopTab') tabs.push(n.attributes);
      ts.forEachChild(n, walk);
    };
    walk(sf);
    expect(tabs.length).toBe(1);
    const attr = tabs[0].properties.find((p): p is ts.JsxAttribute => ts.isJsxAttribute(p) && p.name.getText(sf) === 'aspect');
    expect(attr?.initializer?.getText(sf)).toBe('{project?.aspect}');
  });
});

// ── 4. 编排器 ───────────────────────────────────────────────────────────
const DRAMA = '女主重生回到婚礼前一天,当众揭穿未婚夫';

async function makeOrchestrator(opts: { genre: string; idea: string; aspect?: string }) {
  const { HybridOrchestrator } = await import('@/services/hybrid-orchestrator');
  const o = new HybridOrchestrator();
  const anyO = o as unknown as Record<string, unknown>;
  anyO.genre = opts.genre;
  anyO.originalIdea = opts.idea; // isDramaContext 题材和创意文本都看
  anyO.styleKeywords = 'cinematic anime, rim light';
  const renders: string[] = [];
  // 出图换成记账:Style Bible 帧按什么画幅出,就是之后全片按什么画幅出
  anyO.generateImage = async (_p: string, op?: { aspectRatio?: string }) => { renders.push(op?.aspectRatio ?? ''); return 'https://img.test/bible.png'; };
  if (opts.aspect !== undefined) o.setAspect(opts.aspect);
  await o.runStyleBibleArtist({ title: 't', genre: opts.genre } as never);
  return { aspect: anyO.aspect, renders };
}

describe('v12.468 · 编排器:用户指定的画幅不被题材改掉', { timeout: 60_000 }, () => {
  it('2.35:1 → 按 16:9 出,且算用户指定:短剧题材也不翻成 9:16', async () => {
    const r = await makeOrchestrator({ genre: '短剧', idea: DRAMA, aspect: '2.35:1' });
    expect(r.aspect).toBe('16:9');
    expect(r.renders).toEqual(['16:9']);
  });

  it('显式选 16:9 + 短剧题材 → 仍是 16:9', async () => {
    const r = await makeOrchestrator({ genre: '短剧', idea: DRAMA, aspect: '16:9' });
    expect(r.aspect).toBe('16:9');
    expect(r.renders).toEqual(['16:9']);
  });

  it('反面:没指定画幅 + 短剧题材 → 照旧默认翻成 9:16(v2.20 的竖屏默认保留)', async () => {
    const r = await makeOrchestrator({ genre: '短剧', idea: DRAMA });
    expect(r.aspect).toBe('9:16');
    expect(r.renders).toEqual(['9:16']);
  });

  it('反面:没指定画幅 + 非短剧题材 → 16:9 不动', async () => {
    const r = await makeOrchestrator({ genre: '科幻', idea: '星际飞船在深空发现远古遗迹' });
    expect(r.aspect).toBe('16:9');
    expect(r.renders).toEqual(['16:9']);
  });

  it('认不出的值不算指定:setAspect("wide") 之后短剧题材仍按默认翻竖屏', async () => {
    const r = await makeOrchestrator({ genre: '短剧', idea: DRAMA, aspect: 'wide' });
    expect(r.aspect).toBe('9:16');
  });
});

// ── 5. 创建页 ───────────────────────────────────────────────────────────
async function renderCreatePage() {
  vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 200 })));
  const { render } = await import('@testing-library/react');
  const React = (await import('react')).default;
  const { default: DashboardCreatePage } = await import('@/app/dashboard/create/page');
  const { ToastProvider } = await import('@/components/ui/toast-provider');
  const { container } = render(React.createElement(ToastProvider, null, React.createElement(DashboardCreatePage)));
  const selected = () => [...container.querySelectorAll('button.cinema-btn-primary')]
    .map((b) => b.textContent?.trim() ?? '').filter((t) => /^\d+(\.\d+)?:\d+$/.test(t));
  return { container, selected };
}

describe('v12.468 · 创建页只给出得了的画幅', { timeout: 60_000 }, () => {
  it('画幅按钮就是清单里的三个(没有 2.35:1),默认选中 9:16', async () => {
    const { container, selected } = await renderCreatePage();
    expect(aspectButtons(container)).toEqual([...PROJECT_ASPECTS]);
    expect(selected()).toEqual(['9:16']);
  });

  it('上次存下的偏好是 2.35:1 → 不恢复,停在默认 9:16', async () => {
    const { waitFor } = await import('@testing-library/react');
    localStorage.setItem('windcomic.createPrefs.v1', JSON.stringify({ aspect: '2.35:1', scriptLanguage: 'zh' }));
    const { selected } = await renderCreatePage();
    await new Promise((r) => setTimeout(r, 50)); // 让挂载时的恢复 effect 跑完
    await waitFor(() => expect(selected()).toEqual(['9:16']));
  });

  it('反面:上次存下的是 16:9 → 照常恢复(偏好记忆本身没被关掉)', async () => {
    const { waitFor } = await import('@testing-library/react');
    localStorage.setItem('windcomic.createPrefs.v1', JSON.stringify({ aspect: '16:9', scriptLanguage: 'zh' }));
    const { selected } = await renderCreatePage();
    await waitFor(() => expect(selected()).toEqual(['16:9']));
  });
});
