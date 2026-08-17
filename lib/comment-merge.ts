/**
 * lib/comment-merge — 合并 **Yjs 广播来的评论**与服务端取回的评论。v12.327。
 *
 * ── 病象:一句类型断言把信任边界抹掉了 ────────────────────────────
 * `comment-thread.tsx` 里原本是:
 *   const all = arr.toArray() as unknown as FetchedComment[];
 *   ...
 *   byId.set(yc.id, { ...byId.get(yc.id), ...yc });   // Yjs 版整体覆盖服务端版
 *
 * `arr` 是 Yjs 的共享数组 —— **项目内任何协作者都能往里写任意对象**(CRDT 没有
 * 逐字段权限)。那句 `as unknown as` 告诉读代码的人「这些是评论」,而实际上它们是
 * 网络对端提供的任意数据。后果不是类型不整齐,是:
 *
 *   ① **冒名与篡改**:推一个带**已存在 id** 的对象,就能覆盖掉服务端那条评论的
 *      `authorName` / `content` —— 在**所有人**的界面上把别人的话改掉、或让一段话
 *      看起来是别人写的。
 *   ② **渲染崩溃**:`content` 推成对象,React 渲染直接抛,整条评论区挂掉。
 *   ③ **脏键**:`id` 缺失 → `byId.set(undefined, …)`,排序键 `createdAt` 也没有。
 *
 * ── 修法:分清「新增」与「更新」 ──────────────────────────────────
 * Yjs 在这里的正当用途只有两个:**别人刚发的新评论**、**软删标记**
 * (`broadcastNewComment` / `broadcastDeleteComment` 就只做这两件事)。所以:
 *
 *   · id **已存在**(来自服务端)→ 只接受**可变字段白名单**(deletedAt/updatedAt),
 *     作者、正文、时间一律以服务端为准 —— 冒名与篡改从根上不可能;
 *   · id **是新的** → 必须整体通过校验才收,任一必填字段类型不对就丢弃。
 *
 * 这样实时性一点没丢(新评论照样秒现、删除照样同步),而攻击面没了。
 */

/** 服务端权威字段之外,允许由 Yjs 更新的可变字段。 */
const MUTABLE_FROM_YJS = ['deletedAt', 'updatedAt'] as const;

export interface MinimalComment {
  id: string;
  targetType: string;
  targetId: string;
  authorUserId: string;
  authorName: string;
  content: string;
  createdAt: string;
  deletedAt?: string | null;
  updatedAt?: string | null;
  [k: string]: unknown;
}

const isStr = (v: unknown): v is string => typeof v === 'string' && v.length > 0;
const isNullableStr = (v: unknown): v is string | null | undefined =>
  v === null || v === undefined || typeof v === 'string';

/**
 * 校验一条 Yjs 来的评论。**只认必填字段都是非空字符串的对象**;
 * 任何一项不对就返回 null —— 宁可少显示一条,也不把任意对象当评论渲染。
 */
export function sanitizeYjsComment(raw: unknown): MinimalComment | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const c = raw as Record<string, unknown>;
  if (!isStr(c.id) || !isStr(c.targetType) || !isStr(c.targetId)) return null;
  if (!isStr(c.authorUserId) || !isStr(c.authorName)) return null;
  if (typeof c.content !== 'string') return null;      // 允许空串正文(带附件的评论)
  if (!isStr(c.createdAt)) return null;
  if (!isNullableStr(c.deletedAt) || !isNullableStr(c.updatedAt)) return null;
  return c as unknown as MinimalComment;
}

/**
 * 把 Yjs 来的条目合进已有列表。
 *
 * @param prev      服务端取回的权威列表
 * @param incoming  Yjs 共享数组的原始内容(未经校验)
 * @param accept    过滤器:只处理当前线程关心的那些(targetType/targetId 匹配)
 */
export function mergeYjsComments<T extends { id: string; createdAt: string }>(
  prev: T[],
  incoming: unknown[],
  accept: (c: MinimalComment) => boolean,
): T[] {
  const byId = new Map<string, T>(prev.map((c) => [c.id, c]));
  for (const raw of incoming) {
    const c = sanitizeYjsComment(raw);
    if (!c || !accept(c)) continue;
    const existing = byId.get(c.id);
    if (existing) {
      // 已有服务端版本 → **只吸收可变字段**,作者/正文/时间不容篡改
      const patch: Record<string, unknown> = {};
      for (const k of MUTABLE_FROM_YJS) {
        if (c[k] !== undefined) patch[k] = c[k];
      }
      if (Object.keys(patch).length > 0) byId.set(c.id, { ...existing, ...patch });
    } else {
      // 新评论 → 已整体过校验,可以收
      byId.set(c.id, c as unknown as T);
    }
  }
  return Array.from(byId.values()).sort((a, b) =>
    a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0,
  );
}
