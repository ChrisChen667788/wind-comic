/**
 * v13.10 · 前端:项目页 / 导演台 / 创建页节点图 —— 同一镜多行分镜只显示、只计、只用当前那行。
 *
 * 病:项目页把同镜多行全列成卡片(重生 / 选定过的镜旧稿新稿各一张),分镜 tab 的镜头数、导演台 SHOTS 数的是行数;
 * 一键成片的「镜号→分镜文字」进 Map 后写者赢(拿到的是较早的重生稿),只认 data.prompt 的镜还被直接跳过。
 *
 * 夹具同 tests/v13-10-storyboard-latest-row:多行镜头按 旧行 A → 当前行 B → 较早重生行 C 的顺序给出
 * (接口按镜号、插入顺序返回),A 的 updatedAt 最晚 —— 取第一行、取最后一行、按 updatedAt 取都会取错。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, waitFor, within, cleanup } from '@testing-library/react';

vi.mock('next/navigation', () => ({
  useParams: () => ({ id: 'p-v1310' }),
  useRouter: () => ({ push: () => {}, replace: () => {}, back: () => {}, refresh: () => {}, prefetch: () => {} }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => '/projects/p-v1310',
}));

const T = { june: '2026-06-01T00:00:00.000Z', july: '2026-07-01T00:00:00.000Z', aug: '2026-08-01T00:00:00.000Z', sep: '2026-09-01T00:00:00.000Z' };
const img = (tag: string) => `https://cdn.example/${tag}.png`;
const asset = (id: string, shot: number, name: string, data: Record<string, unknown>, media: string, created: string, updated = created) =>
  ({ id, type: 'storyboard', name, data, mediaUrls: [media], persistentUrl: null, shotNumber: shot, version: 1, createdAt: created, updatedAt: updated, stale: false, isPlaceholder: false });

const ASSETS = [
  asset('a1', 1, '镜头 1', { description: '旧稿一:站台远景', duration: 6 }, img('sb-1-a'), T.june, T.sep),
  asset('b1', 1, 'Shot 1(九宫格选定 c7)', { prompt: '新稿一:她在车门合上前回头', picked: true }, img('sb-1-b'), T.aug),
  asset('c1', 1, 'Shot 1 (re-gen)', { prompt: '中间稿一:车厢俯拍', regenerated: true }, img('sb-1-c'), T.july),
  asset('a2', 2, '镜头 2', { description: '旧稿二:天台全景' }, img('sb-2-a'), T.june, T.sep),
  asset('b2', 2, 'Shot 2 (re-gen)', { prompt: '新稿二:逆光剪影拉天线', regenerated: true }, img('sb-2-b'), T.aug),
  asset('c2', 2, 'Shot 2 (re-gen)', { prompt: '中间稿二:天台俯拍', regenerated: true }, img('sb-2-c'), T.july),
  asset('s3', 3, '镜头 3', { description: '码头俯拍两人隔着集装箱对峙' }, img('sb-3'), T.june),
  { id: 'sc', type: 'script', name: '剧本', data: { shots: [1, 2, 3].map((n) => ({ shotNumber: n, duration: 5 })) }, mediaUrls: [], shotNumber: null, version: 1, createdAt: T.june, updatedAt: T.june },
];
const PROJECT = {
  id: 'p-v1310', userId: 'u1', user_id: 'u1', title: '同镜多行', description: '', covers: [], status: 'completed', aspect: '16:9',
  styleId: null, primaryCharacterRef: null, lockedCharacters: [], scriptData: null, directorNotes: null,
  assets: ASSETS, createdAt: T.june, updatedAt: T.sep,
};

let posted: Array<{ url: string; body: any }> = [];
function routeFetch() {
  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (init?.body) { try { posted.push({ url, body: JSON.parse(String(init.body)) }); } catch { posted.push({ url, body: init.body }); } }
    const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { 'Content-Type': 'application/json' } });
    if (/\/api\/projects\/p-v1310(\?|$)/.test(url)) return json(PROJECT);
    if (url.includes('/review-status')) return json({ status: 'draft' }); // 徽章拿到未知状态会崩整页
    // 一键成片:质检判镜 1、镜 3 低分要重拍;重拍请求记下就算完成
    if (url.includes('/vision-audit/run')) {
      return json({
        audits: [{ shotNumber: 1, score: 40 }, { shotNumber: 3, score: 41 }],
        summary: { avgScore: 50, shotCount: 3, failCount: 2, weakestShots: [{ shotNumber: 1, score: 40 }], verdict: 'poor' },
      });
    }
    if (url.includes('/regenerate-storyboard')) return new Response('data: {"type":"complete"}\n\n', { status: 200 });
    return json({});
  });
}

beforeEach(() => {
  posted = [];
  vi.stubGlobal('fetch', routeFetch());
  vi.stubGlobal('confirm', () => true);
  window.confirm = () => true;
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

async function renderPage() {
  const { default: ProjectDetailPage } = await import('@/app/projects/[id]/page');
  const { ToastProvider } = await import('@/components/ui/toast-provider');
  render(<ToastProvider><ProjectDetailPage /></ToastProvider>);
  return screen.findByRole('tab', { name: /分镜/ }, { timeout: 15_000 });
}

describe('v13.10 · 项目页', () => {
  it('分镜 tab 每镜一张卡,卡上是当前那行的图;tab 上的镜头数是 3 不是 7', async () => {
    const tab = await renderPage();
    expect(within(tab).getByText('03')).toBeTruthy();
    fireEvent.click(tab);
    await waitFor(() => expect(document.querySelector(`img[src="${img('sb-1-b')}"]`)).toBeTruthy());
    for (const stale of ['sb-1-a', 'sb-1-c', 'sb-2-a', 'sb-2-c']) {
      expect(document.querySelector(`img[src="${img(stale)}"]`), `被替换的 ${stale} 还挂在页面上`).toBeNull();
    }
    expect(document.querySelector(`img[src="${img('sb-2-b')}"]`)).toBeTruthy();
    expect(document.querySelector(`img[src="${img('sb-3')}"]`)).toBeTruthy();
  }, 30_000);

  it('一键成片重拍低分镜:用的是当前那行的文字,只有 description 的镜也不再被跳过', async () => {
    await renderPage();
    fireEvent.click(screen.getByRole('tab', { name: /一键成片/ }));
    const run = await screen.findByRole('button', { name: /运行自愈闭环/ }, { timeout: 10_000 });
    fireEvent.click(run);
    await waitFor(() => expect(posted.filter((p) => p.url.includes('/regenerate-storyboard')).length).toBeGreaterThanOrEqual(2), { timeout: 15_000 });
    const regen = posted.filter((p) => p.url.includes('/regenerate-storyboard'));
    const s1 = regen.find((p) => p.body.shotNumber === 1)?.body.customPrompt ?? '';
    expect(s1).toContain('她在车门合上前回头');
    for (const stale of ['旧稿一', '中间稿一']) expect(s1).not.toContain(stale);
    expect(regen.find((p) => p.body.shotNumber === 3)?.body.customPrompt ?? '').toContain('码头俯拍两人隔着集装箱对峙');
  }, 40_000);
});

describe('v13.10 · 导演台 / 创建页节点图', () => {
  it('导演台 SHOTS 数的是镜,不是分镜行', async () => {
    const { DirectorConsole } = await import('@/components/director-console');
    render(<DirectorConsole assets={ASSETS as any} onEditStage={() => {}} projectId="p-v1310" projectAspect="16:9" onReran={() => {}} />);
    const label = await screen.findByText('SHOTS');
    const card = label.parentElement as HTMLElement;
    expect(within(card).getByText('3')).toBeTruthy();
  }, 20_000);

  it('创建页分镜节点:每镜一张卡,是当前那行', async () => {
    const { ReactFlowProvider } = await import('@xyflow/react');
    const mod = await import('@/components/nodes/storyboard-node');
    const StoryboardNode = (mod as any).StoryboardNode ?? (mod as any).default;
    render(
      <ReactFlowProvider>
        <StoryboardNode {...({ id: 'node-storyboard', data: { label: '分镜', status: 'completed', progress: 100, assets: ASSETS } } as any)} />
      </ReactFlowProvider>,
    );
    await waitFor(() => expect(screen.getByText(/新稿一/)).toBeTruthy());
    for (const stale of ['旧稿一', '中间稿一', '旧稿二', '中间稿二']) expect(screen.queryByText(new RegExp(stale))).toBeNull();
    expect(screen.getByText(/新稿二/)).toBeTruthy();
  }, 20_000);
});
