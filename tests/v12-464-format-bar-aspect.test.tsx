/**
 * v12.464 — 格式条的「画幅」只有一个来源:`projects.aspect`。
 *
 * ── 怎么发现的 ────────────────────────────────────────────────────────
 * v7.4 给项目页分镜 tab 加了格式条,画幅是一个下拉框(默认 Scope 2.39:1),存进 `project-format`
 * 资产的 `aspectId`,并配了 `aspectRatioOf()`「喂给生成接口」。但**全仓没有任何生成代码读过它**。
 * v10.6.0 竖屏优先另起了 `projects.aspect`(建项目时选,出片 / 分镜竖构图 / 导演台几何都按它算),
 * 两份「画幅」从此并存,而格式条那份是死的:9:16 项目的格式条写着「Scope 2.39:1」,改了也不生效。
 * README 的截图(assets/v12-425/13-storyboard-specs.jpg)就是这个画面 —— 竖构图分镜上方挂着 Scope 2.39:1。
 *
 * 修法:格式条只读显示 `projects.aspect`(详情接口的 `aspect`,v12.439 起才有),删掉 `aspectId`。
 * 不做成可编辑:改画幅不会重排已出的素材,单镜重生也不读 `projects.aspect`,
 * 做成下拉只会把「改了没用」换个地方再演一遍。
 *
 * ── 这条测试锁什么 ────────────────────────────────────────────────────
 * 1. 格式条显示的就是项目画幅,且没有可改画幅的控件;
 * 2. 保存只写色彩 / 帧率 / 安全框(帧率被 EDL/AAF 导出与片段重拍读取,行为不变);
 * 3. 接口:旧资产残留的 `aspectId` 不再回吐、请求体带了也不落库;
 * 4. 项目页把详情接口的 `aspect` 递给格式条(接口那一跳由 v12-439-director-stage-3d 锁);
 * 5. `aspectId` 不在任何源码里复活(按 AST 取标识符与属性名,不 grep 原文);
 * 6. 对外文档不再说画幅「真实进入生成 prompt」。
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

vi.mock('@/lib/auth-guard', () => ({ requireProjectAccess: vi.fn(async () => ({ ok: true, userId: 'u1' })) }));

const store: { rows: Array<{ id: string; data: string }>; writes: unknown[] } = { rows: [], writes: [] };
vi.mock('@/lib/repos/asset-repo', () => ({
  listAssetsByType: vi.fn(async () => store.rows),
  createAsset: vi.fn(async (a: { data: unknown }) => { store.writes.push(a.data); return { id: 'a1' }; }),
  updateAsset: vi.fn(async (_id: string, patch: { data: unknown }) => { store.writes.push(patch.data); return true; }),
}));

/** 旧版本存下的格式资产:画幅 Scope —— 生产库里所有点过「保存格式」的项目都长这样 */
const LEGACY = { aspectId: 'scope', colorSpaceId: 'aces', fps: 24, safeArea: true };

afterEach(async () => {
  const { cleanup } = await import('@testing-library/react');
  cleanup();
  vi.unstubAllGlobals();
  store.rows = [];
  store.writes = [];
});

async function renderBar(aspect: string | null | undefined, initialFormat: object = LEGACY) {
  const { render } = await import('@testing-library/react');
  const React = (await import('react')).default;
  const { ProjectFormatBar } = await import('@/components/project/project-format-bar');
  const { container } = render(React.createElement(ProjectFormatBar, { projectId: 'p1', aspect, initialFormat }));
  /** 按标签文字取控件所在的 label(标签和下拉框写在同一个 <label> 里) */
  const field = (name: string) => [...container.querySelectorAll('label')].find((l) => l.textContent?.startsWith(name));
  return { container, field };
}

describe('v12.464 · 格式条显示的是项目画幅', () => {
  it('9:16 项目:显示 9:16 竖屏,旧资产里的 Scope 不再出现', async () => {
    const { container } = await renderBar('9:16');
    const shown = container.querySelector('[data-testid="format-aspect"]');
    expect(shown?.textContent).toBe('9:16 竖屏');
    expect(container.textContent).toContain('ACES 1.3'); // 整条确实渲染出来了
    expect(container.textContent).not.toMatch(/Scope|2\.39/);
  });

  it('16:9 / 1:1 按项目值;空值按库列默认 16:9(与详情接口同一口径)', async () => {
    for (const [aspect, label] of [['16:9', '16:9 横屏'], ['1:1', '1:1 方形'], [undefined, '16:9 横屏'], ['  ', '16:9 横屏']] as const) {
      const { container } = await renderBar(aspect);
      expect(container.querySelector('[data-testid="format-aspect"]')?.textContent, `aspect=${aspect}`).toBe(label);
      const { cleanup } = await import('@testing-library/react');
      cleanup();
    }
  });

  it('画幅没有可改的控件;色彩、帧率仍是下拉框', async () => {
    const { container, field } = await renderBar('9:16');
    expect(field('色彩')?.querySelector('select')).toBeTruthy();
    expect(field('帧率')?.querySelector('select')).toBeTruthy();
    expect(container.querySelectorAll('select').length).toBe(2);
    expect(field('画幅')?.querySelector('select') ?? null).toBeNull();
  });

  it('视频引擎出不了的画幅(创建页可选 2.35:1)明说;引擎支持的三种不提示', async () => {
    const wide = await renderBar('2.35:1');
    expect(wide.container.querySelector('[data-testid="format-aspect"]')?.textContent).toBe('2.35:1');
    const warn = wide.container.querySelector('[data-testid="format-aspect-warn"]');
    expect(warn, '2.35:1 要提示视频引擎出不了').toBeTruthy();
    expect(warn!.textContent).toContain('不支持');
    const { cleanup } = await import('@testing-library/react');
    for (const a of ['9:16', '16:9', '1:1']) {
      cleanup();
      const ok = await renderBar(a);
      expect(ok.container.querySelector('[data-testid="format-aspect"]'), a).toBeTruthy();
      expect(ok.container.querySelector('[data-testid="format-aspect-warn"]'), a).toBeNull();
    }
  });
});

describe('v12.464 · 保存只写色彩 / 帧率 / 安全框', () => {
  it('改帧率、色彩、安全框后保存:请求体正好是这三项,没有 aspectId', async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return { ok: true, json: async () => ({ ok: true, format: JSON.parse(String(init.body)).format }) } as unknown as Response;
    }));
    const { fireEvent, waitFor } = await import('@testing-library/react');
    const { container, field } = await renderBar('9:16');
    fireEvent.change(field('帧率')!.querySelector('select')!, { target: { value: '30' } });
    fireEvent.change(field('色彩')!.querySelector('select')!, { target: { value: 'rec709' } });
    fireEvent.click([...container.querySelectorAll('button')].find((b) => b.textContent?.startsWith('安全框'))!);
    fireEvent.click([...container.querySelectorAll('button')].find((b) => b.textContent?.includes('保存格式'))!);
    await waitFor(() => expect(calls.length).toBe(1));
    expect(calls[0].url).toBe('/api/projects/p1/format');
    expect(calls[0].init.method).toBe('POST');
    expect(JSON.parse(String(calls[0].init.body)).format).toEqual({ colorSpaceId: 'rec709', fps: 30, safeArea: false });
  });
});

describe('v12.464 · /format 接口不再回吐、不再落库 aspectId', () => {
  const params = { params: Promise.resolve({ id: 'p1' }) };

  it('GET:旧资产带 aspectId:scope → 回的格式只有三项,帧率保留', async () => {
    store.rows = [{ id: 'a1', data: JSON.stringify({ ...LEGACY, fps: 30 }) }];
    const { GET } = await import('@/app/api/projects/[id]/format/route');
    const body = await (await GET(new Request('http://t/api/projects/p1/format') as never, params)).json();
    expect(body.format).toEqual({ colorSpaceId: 'aces', fps: 30, safeArea: true });
  });

  it('GET:没有格式资产 → 默认值里也没有画幅', async () => {
    const { GET } = await import('@/app/api/projects/[id]/format/route');
    const body = await (await GET(new Request('http://t/api/projects/p1/format') as never, params)).json();
    expect(body.format).toEqual({ colorSpaceId: 'aces', fps: 24, safeArea: true });
  });

  it('POST:请求体带 aspectId(旧前端 / 参数联动 JSON)→ 落库的只有三项', async () => {
    store.rows = [{ id: 'a1', data: JSON.stringify(LEGACY) }];
    const { POST } = await import('@/app/api/projects/[id]/format/route');
    const req = new Request('http://t/api/projects/p1/format', {
      method: 'POST', body: JSON.stringify({ format: { aspectId: '9:16', colorSpaceId: 'p3', fps: 25, safeArea: true } }),
    });
    const res = await POST(req as never, params);
    expect(res.status).toBe(200);
    expect(store.writes).toEqual([{ colorSpaceId: 'p3', fps: 25, safeArea: true }]);
  });
});

describe('v12.464 · 项目页把详情接口的画幅递给格式条', () => {
  it('页面里唯一的 <ProjectFormatBar> 带 aspect={project?.aspect}', () => {
    const file = 'app/projects/[id]/page.tsx';
    const sf = ts.createSourceFile(file, fs.readFileSync(file, 'utf-8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const bars: ts.JsxAttributes[] = [];
    const walk = (n: ts.Node) => {
      if ((ts.isJsxSelfClosingElement(n) || ts.isJsxOpeningElement(n)) && n.tagName.getText(sf) === 'ProjectFormatBar') bars.push(n.attributes);
      ts.forEachChild(n, walk);
    };
    walk(sf);
    expect(bars.length).toBe(1);
    const attr = bars[0].properties.find((p): p is ts.JsxAttribute => ts.isJsxAttribute(p) && p.name.getText(sf) === 'aspect');
    const expr = attr?.initializer && ts.isJsxExpression(attr.initializer) ? attr.initializer.expression?.getText(sf) : undefined;
    expect(expr).toBe('project?.aspect');
  });
});

describe('v12.464 · 第二份画幅不复活', () => {
  /** 源码目录下所有 .ts/.tsx 里,作为标识符 / 属性名出现的 `name`(注释与字符串里的不算) */
  function identifierHits(name: string): string[] {
    const hits: string[] = [];
    for (const dir of ['app', 'components', 'lib', 'services']) {
      for (const rel of fs.readdirSync(dir, { recursive: true }) as string[]) {
        if (!/\.tsx?$/.test(rel)) continue;
        const file = path.join(dir, rel);
        const sf = ts.createSourceFile(file, fs.readFileSync(file, 'utf-8'), ts.ScriptTarget.Latest, true,
          file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
        const walk = (n: ts.Node) => {
          if ((ts.isIdentifier(n) || ts.isPrivateIdentifier(n)) && n.text === name) {
            hits.push(`${file}:${sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1}`);
          }
          ts.forEachChild(n, walk);
        };
        walk(sf);
      }
    }
    return hits;
  }

  it('aspectId / aspectRatioOf / FORMAT_PRESETS 在源码里一处都没有', () => {
    // 扫描器自证:同一个格式资产里活着的字段确实扫得到
    expect(identifierHits('colorSpaceId').length).toBeGreaterThan(0);
    for (const dead of ['aspectId', 'aspectRatioOf', 'FORMAT_PRESETS']) {
      expect(identifierHits(dead), dead).toEqual([]);
    }
  });

  it('lib/project-format 不再导出画幅预设', async () => {
    const mod = await import('@/lib/project-format');
    expect(Object.keys(mod)).toContain('normalizeProjectFormat');
    for (const dead of ['FORMAT_PRESETS', 'aspectRatioOf', 'getAspect']) expect(Object.keys(mod), dead).not.toContain(dead);
  });
});

describe('v12.464 · 对外文档不再说格式条的画幅进了生成', () => {
  for (const file of ['README.md', 'README.zh-CN.md', 'docs/modelscope-intro.md', 'docs/SCREENSHOTS-v12.425.md']) {
    it(file, () => {
      const src = fs.readFileSync(file, 'utf-8');
      const i = src.indexOf('13-storyboard-specs.jpg');
      expect(i, '分镜规格那张截图的说明还在').toBeGreaterThan(0);
      const caption = src.slice(i, i + 1200);
      expect(caption).toContain('projects.aspect');
      expect(caption).not.toMatch(/Scope 2\.39|真实进入生成 prompt|会真实进入生成/);
    });
  }
});
