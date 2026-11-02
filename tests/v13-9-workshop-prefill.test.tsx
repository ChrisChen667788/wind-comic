/**
 * v13.9 · 镜头工坊两个出图弹窗的预填 = 这一镜的分镜文字。
 *
 * 病:工坊的「改 prompt 重生」与「九宫格选帧」预填读 storyboards[].prompt,而项目页传进来的 storyboards
 * 只有镜号和图 —— 预填永远是空串。九宫格点「生成候选」必报「该镜基础 prompt 太短」,
 * 改 prompt 重生打开是一个空输入框。不论这一镜的文字存在 description 还是 prompt 里都一样。
 *
 * 只喂组件 prop 的测试正是当初没抓到它的原因(prop 喂了,页面从来不给)。所以这里:
 *   ① 分镜行取自**真的项目详情接口**(真测试库),按项目页同样的过滤交给 toWorkshopStoryboards,再渲染工坊、
 *      点按钮,断言**发出去的请求体**与输入框里的字;
 *   ② 解析项目页源码:每个 <ShotWorkshopTab> 的 storyboards 都经 toWorkshopStoryboards。
 */
import { describe, it, expect, vi, beforeAll, afterEach } from 'vitest';
import fs from 'node:fs';
import ts from 'typescript';

const h = vi.hoisted(() => ({ uid: 'u-v1309-ui' }));
vi.mock('@/lib/auth-guard', async (importOriginal) => {
  const m = await importOriginal<typeof import('@/lib/auth-guard')>();
  return { ...m, requireProjectAccess: async () => ({ ok: true, userId: h.uid }) };
});

import { db, now } from '@/lib/db';
import { createProject } from '@/lib/repos/project-repo';
import { createAsset } from '@/lib/repos/asset-repo';

const TEXT = {
  1: '雨夜巷口她撑着红伞回头看向镜头 --ar 16:9 --no text', // 只有 description(创建页写法)
  2: '天台逆光剪影他把发报机天线拉到最长 --ar 16:9', // 只有 prompt(重生分镜图写法)
} as const;
let apiStoryboards: Array<Record<string, unknown>> = [];

beforeAll(async () => {
  db.prepare(`INSERT OR IGNORE INTO users (id, email, password_hash, name, role, created_at) VALUES (?, ?, ?, ?, 'user', ?)`)
    .run(h.uid, `${h.uid}@test.local`, 'x', '工坊预填', now());
  const pid = (await createProject({ userId: h.uid, title: '工坊预填', description: 'd', coverUrls: [] }) as { id: string }).id;
  await createAsset({ projectId: pid, type: 'storyboard', name: '镜头 1', shotNumber: 1, mediaUrls: ['https://cdn.example/sb-1.png'], data: { description: TEXT[1] } });
  await createAsset({ projectId: pid, type: 'storyboard', name: 'Shot 2 (re-gen)', shotNumber: 2, mediaUrls: ['https://cdn.example/sb-2.png'], data: { prompt: TEXT[2], regenerated: true } });
  const { GET } = await import('@/app/api/projects/[id]/route');
  const res = await GET(new Request(`http://localhost/api/projects/${pid}`) as never, { params: Promise.resolve({ id: pid }) });
  const body = await res.json() as { assets: Array<Record<string, unknown>> };
  apiStoryboards = body.assets.filter((a) => a.type === 'storyboard'); // 与项目页同一过滤
  // 首次加载工坊组件 + testing-library 要 3 秒左右(两个 worker 挤着跑时 9 秒),原来算在第一条用例的
  // 5 秒超时里 —— 叠到 v13.4 上验证时就这么红过一次。挪到这里加载,用例只算自己的时间。
  await import('@testing-library/react');
  await import('@/components/project/shot-workshop-tab');
}, 60_000);

afterEach(async () => {
  const { cleanup } = await import('@testing-library/react');
  cleanup();
  vi.unstubAllGlobals();
});

async function renderWorkshop(shot: 1 | 2) {
  const posts: Array<{ url: string; body: Record<string, unknown> }> = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    if (init?.method === 'POST') {
      posts.push({ url: String(url), body: JSON.parse(String(init.body || '{}')) });
      return new Response('stop', { status: 500 }); // 不出图,只看请求体
    }
    return new Response(JSON.stringify({ items: [] }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }));
  const { render, screen, fireEvent } = await import('@testing-library/react');
  const React = (await import('react')).default;
  const { ShotWorkshopTab, toWorkshopStoryboards } = await import('@/components/project/shot-workshop-tab');
  render(React.createElement(ShotWorkshopTab, {
    projectId: 'p-ui',
    videos: [{ shotNumber: shot, videoUrl: `https://cdn.example/v-${shot}.mp4` }],
    storyboards: toWorkshopStoryboards(apiStoryboards as never),
  }));
  return { posts, screen, fireEvent };
}

describe('v13.9 · 工坊出图弹窗的预填', () => {
  it.each([1, 2] as const)('镜 %i:九宫格「生成候选」发出的 basePrompt 是分镜文字(原来必报「prompt 太短」)', async (shot) => {
    const { posts, screen, fireEvent } = await renderWorkshop(shot);
    fireEvent.click(screen.getByText('九宫格选帧'));
    fireEvent.click(await screen.findByText('生成候选'));
    const { waitFor } = await import('@testing-library/react');
    await waitFor(() => expect(posts.find((p) => p.url.includes('/candidates'))).toBeTruthy());
    expect(screen.queryByText(/prompt 太短/)).toBeNull();
    expect(posts.find((p) => p.url.includes('/candidates'))!.body.basePrompt).toBe(TEXT[shot]);
  });

  it.each([1, 2] as const)('镜 %i:「改 prompt 重生」打开时输入框里就是分镜文字', async (shot) => {
    const { screen, fireEvent } = await renderWorkshop(shot);
    fireEvent.click(screen.getByText('改 prompt 重生'));
    const box = (await screen.findAllByRole('textbox')).find((el) => (el as HTMLTextAreaElement).value.length > 0) as HTMLTextAreaElement | undefined;
    expect(box?.value).toBe(TEXT[shot]);
  });

  it('项目页里每个 <ShotWorkshopTab> 的 storyboards 都经 toWorkshopStoryboards(手写映射会再次漏掉 prompt)', () => {
    const file = 'app/projects/[id]/page.tsx';
    const sf = ts.createSourceFile(file, fs.readFileSync(file, 'utf-8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const attrs: ts.JsxAttributes[] = [];
    const walk = (n: ts.Node) => {
      if ((ts.isJsxSelfClosingElement(n) || ts.isJsxOpeningElement(n)) && n.tagName.getText(sf) === 'ShotWorkshopTab') attrs.push(n.attributes);
      ts.forEachChild(n, walk);
    };
    walk(sf);
    expect(attrs.length, '项目页里一个 <ShotWorkshopTab> 都没找到 —— 改名了?').toBeGreaterThanOrEqual(1);
    for (const a of attrs) {
      const attr = a.properties.find((p): p is ts.JsxAttribute => ts.isJsxAttribute(p) && p.name.getText(sf) === 'storyboards');
      const expr = attr?.initializer && ts.isJsxExpression(attr.initializer) ? attr.initializer.expression : undefined;
      expect(expr && ts.isCallExpression(expr) ? expr.expression.getText(sf) : expr?.getText(sf)).toBe('toWorkshopStoryboards');
    }
  });
});
