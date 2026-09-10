/**
 * 「确认入库」的唯一客户端出口(v12.432)。
 *
 * 修前 editor-node 和 node-shell 各写了一遍同样的 POST /api/assets/confirm,
 * 两处都是 `.catch(() => {})` 外面再套一层 `try {} catch {}` —— 双重吞错;
 * 而且两处都在 await **之前**就把按钮点亮成「已保存 ✓ / 已确认」并 disable。
 * 于是网络断了、登录过期了、写库失败了,用户看到的全是绿色成功态,
 * 刷新之后确认全没了,还以为是系统把自己的操作弄丢了。
 *
 * 内存 store(confirmNodeAssets)是 plain zustand,没有 persist,刷新即丢,
 * 它不是持久化的替身 —— 这条路由是唯一真正写 SQLite 的路径。
 *
 * 这里只做一件事:把「存没存上」如实返回,绝不吞。怎么显示由调用方决定,
 * 但不许再冒出第三份实现 —— tests/v12-432-no-silent-drop 里有门禁盯着。
 */

export interface ConfirmAssetsPayload {
  projectId: string;
  agentRole: string;
  assets: unknown[];
  timeline?: unknown;
}

export type ConfirmAssetsResult = { ok: true } | { ok: false; reason: string };

export async function confirmAssetsToServer(
  payload: ConfirmAssetsPayload,
  fetchImpl?: typeof fetch,
): Promise<ConfirmAssetsResult> {
  const doFetch = fetchImpl || fetch;
  try {
    const res = await doFetch('/api/assets/confirm', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      // 「没权限」和「网断了」的处置完全不同,别糊成一句「保存失败」
      const reason =
        res.status === 401 || res.status === 403
          ? '没有编辑权限,可能是登录过期了'
          : `服务端返回 ${res.status}`;
      return { ok: false, reason };
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, reason: e instanceof Error && e.message ? e.message : '网络不通' };
  }
}
