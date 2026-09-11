/**
 * v12.434 —— 列表页空态不许冒充错误态。
 *
 * 五个列表页各写了一遍同样的取数,而且都错在同一处:
 *
 * ```ts
 * try {
 *   const res = await fetch('/api/characters');
 *   const data = await res.json();
 *   setCharacters(Array.isArray(data) ? data : []);   // ← 401 在这里变成「空」
 * } catch { setCharacters([]); }                      // ← 网络错在这里变成「空」
 * ```
 *
 * 两条路都通向同一个 `[]`,渲染层只认 `length === 0`,于是页面说
 * 「暂无角色 · 点击「保存角色」添加你的第一个角色资产」—— 对一个库里有 137 条角色的
 * 账号说这句话,等于告诉他东西没了,而他能做的只有反复刷新。
 *
 * **根因比 catch 吞错更隐蔽:没查 `res.ok`**。401 返回的是 `{ message: 'Unauthorized' }`,
 * `Array.isArray` 为假,**连异常都不是**,静静地变成空数组。
 *
 * 案例库最狠:它连空态都没有 —— 失败时标题下面一片空白,没有加载中、没有出错、
 * 也没有「暂无案例」。
 */
import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { render, screen, fireEvent } from '@testing-library/react';
import { loadList } from '@/lib/load-list';
import { LoadErrorState } from '@/components/ui/load-error-state';

const ROOT = process.cwd();
const read = (p: string) => readFileSync(join(ROOT, p), 'utf-8');
const stripComments = (src: string) =>
  src.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').filter((l) => !/^\s*(\/\/|\*)/.test(l)).join('\n');

const resp = (body: unknown, status = 200) =>
  ({ ok: status >= 200 && status < 300, status, json: async () => body }) as unknown as Response;

describe('v12.434 · loadList:失败绝不折叠成空列表', () => {
  it('正常取数', async () => {
    const r = await loadList('/x', { fetchImpl: (async () => resp([1, 2, 3])) as any });
    expect(r).toEqual({ ok: true, items: [1, 2, 3] });
  });

  it('200 但返回的不是数组 —— 这正是 401 body 的形状,必须判失败而不是判空', async () => {
    const r = await loadList('/x', { fetchImpl: (async () => resp({ message: 'Unauthorized' })) as any });
    expect(r.ok).toBe(false);
    expect((r as { reason: string }).reason).toContain('格式');
  });

  it('401/403 说的是登录,不是「你没有数据」', async () => {
    for (const s of [401, 403]) {
      const r = await loadList('/x', { fetchImpl: (async () => resp({}, s)) as any });
      expect(r.ok).toBe(false);
      expect((r as { reason: string }).reason).toContain('登录');
    }
  });

  it('5xx / 404 / 网络错各说各的 —— 处置方式不同', async () => {
    const r5 = await loadList('/x', { fetchImpl: (async () => resp({}, 503)) as any });
    expect((r5 as { reason: string }).reason).toContain('服务端');
    const r4 = await loadList('/x', { fetchImpl: (async () => resp({}, 404)) as any });
    expect((r4 as { reason: string }).reason).toContain('404');
    const rn = await loadList('/x', { fetchImpl: (async () => { throw new Error('ECONNREFUSED'); }) as any });
    expect(rn.ok).toBe(false);
    expect((rn as { reason: string }).reason).toContain('ECONNREFUSED');
  });

  it('响应体不是合法 JSON 也算失败', async () => {
    const bad = { ok: true, status: 200, json: async () => { throw new Error('bad'); } } as unknown as Response;
    const r = await loadList('/x', { fetchImpl: (async () => bad) as any });
    expect(r.ok).toBe(false);
    expect((r as { reason: string }).reason).toContain('JSON');
  });

  it('任何失败都不许返回 ok —— 「空」这个结论只有真读到才配下', async () => {
    const fails: Array<() => Promise<Response>> = [
      async () => resp({}, 401), async () => resp({}, 500), async () => resp({}, 404),
      async () => resp({ message: 'x' }), async () => { throw new Error('net'); },
    ];
    for (const f of fails) {
      const r = await loadList('/x', { fetchImpl: f as any });
      expect(r.ok).toBe(false);
      expect(r).not.toHaveProperty('items');
    }
    // 正向自证:真的空数组才回 ok + 空
    const empty = await loadList('/x', { fetchImpl: (async () => resp([])) as any });
    expect(empty).toEqual({ ok: true, items: [] });
  });

  it('pick 能取嵌套数组;map 里单条抛错只跳过那条,不拖垮整页', async () => {
    const r = await loadList('/x', {
      fetchImpl: (async () => resp({ assets: [1, 2, 3] })) as any,
      pick: (b: any) => b?.assets,
      map: (a: any) => { if (a === 2) throw new Error('坏数据'); return a * 10; },
    });
    expect(r).toEqual({ ok: true, items: [10, 30] });
  });
});

describe('v12.434 · 失败态自己的样子', () => {
  it('说清「加载失败」,并且明说这不等于数据没了', () => {
    render(<LoadErrorState what="角色库" reason="登录可能过期了,重新登录再试" />);
    expect(screen.getByText(/角色库加载失败/)).toBeTruthy();
    expect(screen.getByText(/这不代表你的角色库没了/)).toBeTruthy();
    expect(screen.getByText(/登录可能过期了/)).toBeTruthy();
  });

  it('给了 onRetry 才有重试按钮,点了会调用', () => {
    const spy = vi.fn();
    const { unmount } = render(<LoadErrorState what="素材库" onRetry={spy} />);
    fireEvent.click(screen.getByText('重试'));
    expect(spy).toHaveBeenCalledTimes(1);
    unmount();
    render(<LoadErrorState what="素材库" />);
    expect(screen.queryByText('重试')).toBeNull();
  });
});

const SITES: Array<{ file: string; empty: string; state: string; loader: string }> = [
  { file: 'app/dashboard/characters/page.tsx', empty: '暂无角色', state: 'loadError', loader: 'const fetchCharacters' },
  { file: 'app/dashboard/assets/page.tsx', empty: '暂无素材', state: 'loadError', loader: 'const fetchAssets' },
  { file: 'app/dashboard/cases/page.tsx', empty: '暂无案例', state: 'loadError', loader: 'const fetchCases' },
  { file: 'app/dashboard/projects/page.tsx', empty: '还没有创作项目', state: 'loadError', loader: 'api.projects()' },
];

/** 取数那一段的源码(到该语句块收尾为止) */
function loaderBody(file: string, loader: string): string {
  const code = stripComments(read(file));
  const at = code.indexOf(loader);
  expect(at).toBeGreaterThan(0);
  const end = code.indexOf('\n  };', at);
  return code.slice(at, end > at ? end : at + 900);
}

describe('v12.434 · 五处都接上了,而且顺序不能反', () => {
  it.each(SITES)('$file 有独立的失败态', ({ file, state }) => {
    const code = stripComments(read(file));
    expect(code).toContain(`const [${state}, set`);
    expect(code).toContain('LoadErrorState');
  });

  it.each(SITES)('$file 的失败分支排在空态之前 —— 排后面就永远够不到', ({ file }) => {
    const code = stripComments(read(file));
    // 锁三元的**门**,不是组件名:`LoadErrorState` 在顶部 import 里也有一份,
    // indexOf 永远先命中那行,分支挪到哪都测不出来。
    const errGate = code.indexOf(') : loadError ? (');
    const emptyGate = code.indexOf('.length === 0 ? (');
    // 正向自证:两道门都找得到
    expect(errGate).toBeGreaterThan(0);
    expect(emptyGate).toBeGreaterThan(0);
    // 失败时列表本来就是空的;空态那道门若在前面,失败态就是一段永远走不到的死代码
    expect(errGate).toBeLessThan(emptyGate);
  });

  // 只管**取数那一段**。整文件禁 `.catch(() => {})` 是过宽的:
  // characters 页里还有一处「复制成功后在后台累加使用次数」的即发即忘 ——
  // 主操作已成功且有反馈,计数器没加上不值得打断用户。那是正当的,不该被这条门禁误伤。
  it.each(SITES)('$file 的取数不再把失败吞成空数组', ({ file, loader }) => {
    const body = loaderBody(file, loader);
    // 正向自证:确实切到了取数那一段
    expect(body).toMatch(/loadList|api\.projects\(\)/);
    expect(body).not.toMatch(/catch\s*\{\s*set\w+\(\[\]\);?\s*\}/);
    expect(body).not.toMatch(/\.catch\(\(\) => \{\}\)/);
    // 失败一定要落到某个状态上,不能什么都不做
    expect(body).toMatch(/setLoadError\(/);
  });

  it('风格收藏(在创作工坊里,不是独立页)同样分得清', () => {
    const code = stripComments(read('components/create/style-lora-library.tsx'));
    expect(code).toContain('loadList');
    expect(code).toContain('loadError');
    expect(code).toContain('风格收藏没读到');
    const errGate = code.indexOf(') : loadError ? (');
    const emptyGate = code.indexOf(') : items.length === 0 ? (');
    expect(errGate).toBeGreaterThan(0);
    expect(emptyGate).toBeGreaterThan(0);
    expect(errGate).toBeLessThan(emptyGate);
    // 取数失败必须真的落到 loadError 上 —— 只 console.warn 等于只有开发者看得见,
    // 而 setItems([]) 会让它掉回「暂无收藏」,正是本版要消灭的那句谎。
    const body = loaderBody('components/create/style-lora-library.tsx', 'const refresh');
    expect(body).toContain('await loadList');
    expect(body).toMatch(/setLoadError\(r\.reason\)/);
    expect(body).not.toMatch(/else\s*\{[^}]*setItems\(\[\]\)/);
  });
});

describe('v12.434 · 同一页读写要用同一套凭据', () => {
  it.each([
    ['app/dashboard/characters/page.tsx'],
    ['app/dashboard/assets/page.tsx'],
  ])('%s 的列表 GET 带上了 Authorization', (file) => {
    const code = stripComments(read(file as string));
    expect(code).toContain('getToken()');
    // 取数那一段自己要带头,而不是靠页面别处的写操作带
    // 锚在**调用**上,不是文件顶部那行 import —— indexOf 会先命中 import,
    // 拿它取窗口等于什么都没测(这个坑这轮已经踩到第二次)。
    const at = code.indexOf('await loadList');
    expect(at).toBeGreaterThan(0);
    const seg = code.slice(Math.max(0, at - 300), at + 300);
    expect(seg).toContain('Authorization');
    expect(seg).toContain('Bearer');
  });
});
