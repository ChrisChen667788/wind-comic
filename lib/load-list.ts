/**
 * 列表类接口的统一取数(v12.434)。
 *
 * ## 为什么要有这个文件
 *
 * 五个列表页各写了一遍同样的取数,而且都写错了同一个地方:
 *
 * ```ts
 * try {
 *   const res = await fetch('/api/characters');
 *   const data = await res.json();
 *   setCharacters(Array.isArray(data) ? data : []);   // ← 401 在这里变成「空」
 * } catch { setCharacters([]); }                      // ← 网络错在这里变成「空」
 * ```
 *
 * 两条路都通向同一个 `[]`,而渲染层只认 `length === 0`,于是页面说的是
 * **「暂无角色 · 点击「保存角色」添加你的第一个角色资产」** ——
 * 对一个库里有 137 条角色的账号说这句话,等于告诉他东西没了。
 *
 * **根因是没查 `res.ok`**:401 返回的是 `{ message: 'Unauthorized' }`,
 * `Array.isArray` 为假,连 catch 都进不去,静静地变成空数组。这条比 catch 吞错更隐蔽,
 * 因为它**根本不是异常**。
 *
 * ## 契约
 *
 * 只回答两件事:**拿到了什么** 或 **为什么没拿到**。绝不把失败折叠成空列表 ——
 * 「没有数据」和「读不到数据」必须能被调用方分开,这是整条链路上最容易被抹平的区别。
 */

export type LoadListResult<T> =
  | { ok: true; items: T[] }
  | { ok: false; reason: string };

export interface LoadListOptions<T> {
  /** 从响应体里取出数组。默认认为响应体**就是**数组。 */
  pick?: (body: unknown) => unknown;
  /** 传给 fetch 的附加选项(headers 等) */
  init?: RequestInit;
  /** 便于测试注入 */
  fetchImpl?: typeof fetch;
  /** 逐项映射;抛错的项会被跳过而不是整批失败 */
  map?: (raw: any) => T;
}

export async function loadList<T = any>(
  url: string,
  opts: LoadListOptions<T> = {},
): Promise<LoadListResult<T>> {
  const doFetch = opts.fetchImpl || fetch;
  let res: Response;
  try {
    res = await doFetch(url, opts.init);
  } catch (e) {
    return { ok: false, reason: e instanceof Error && e.message ? e.message : '网络不通' };
  }

  // 这一步是整个文件存在的理由 —— 少了它,401 会伪装成「你还没有任何数据」
  if (!res.ok) {
    return { ok: false, reason: httpReason(res.status) };
  }

  let body: unknown;
  try {
    body = await res.json();
  } catch {
    return { ok: false, reason: '返回的不是合法 JSON' };
  }

  const raw = opts.pick ? opts.pick(body) : body;
  if (!Array.isArray(raw)) {
    // 状态码是 200 却不是数组 —— 接口坏了,不是「没有数据」
    return { ok: false, reason: '接口返回的格式不对' };
  }

  const items: T[] = [];
  for (const r of raw) {
    try {
      items.push((opts.map ? opts.map(r) : r) as T);
    } catch {
      // 单条坏了不拖垮整页;这属于「部分」,由各自页面的产物标记负责
    }
  }
  return { ok: true, items };
}

/** 「没权限」和「网断了」的处置完全不同,别糊成一句「加载失败」。 */
function httpReason(status: number): string {
  if (status === 401 || status === 403) return '登录可能过期了,重新登录再试';
  if (status === 404) return '接口不存在(404)';
  if (status >= 500) return `服务端出错(${status})`;
  return `请求失败(${status})`;
}
