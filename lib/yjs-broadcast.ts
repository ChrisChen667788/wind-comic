/**
 * v3.0 P0.2 — REST → Yjs broadcast bridge.
 *
 * 设计: REST API (createComment 等) 仍然写 SQLite 作为权威源, 但写成功后通过
 * 一个 "system" WebSocket 客户端连到 ws-server, 把新数据塞进 Y.Array, 让所有
 * 在线客户端瞬时收到. 这样:
 *   - 客户端可以纯靠 Yjs 监听获得实时 (不需要 30s 轮询)
 *   - 客户端断网重连时, REST API 仍然能返回完整数据 (SQLite 是权威)
 *   - Yjs server 重启后状态从 SQLite snapshot 恢复
 *
 * 为什么不让 client 自己写 Y.Array?
 *   - 通知 / 鉴权 / 配额这些 server-side 逻辑必须经过 REST
 *   - 让 client 直接写会绕过这些, 安全性差
 *
 * 实现注意:
 *   - 用 ws 包做一个轻量 client (而不是 y-websocket, 后者主要 for browser)
 *   - 每次广播都建立 + 关闭一个连接 (低频写, 不值得保持长连接)
 *   - 失败静默: WS server 没起来不应该拖垮 REST 写入
 */

import WebSocket from 'ws';
import * as Y from 'yjs';
import * as syncProtocol from 'y-protocols/sync';
import * as encoding from 'lib0/encoding';
import * as decoding from 'lib0/decoding';
import type { CommentRow } from '@/lib/comments';

const WS_URL = process.env.YJS_WS_URL || 'ws://localhost:1234';
const BROADCAST_TIMEOUT_MS = 1500;

const messageSync = 0;

export function docNameForProject(projectId: string): string {
  return `project-${projectId}`;
}

/**
 * 把单个 update 通过临时 WS 连接广播到 server.
 *
 * 内部走完整 sync 握手:
 *   1. 我们打开 ws → server 发 syncStep1 (state vector)
 *   2. 我们收 syncStep1 → 回 syncStep2 (空, 因为我们手里这个临时 doc 状态比 server 老)
 *   3. 我们做 mutation (apply 到自己的 doc, 触发 update event)
 *   4. 我们用 update event 把变更发回 server (writeUpdate)
 *   5. 关闭连接
 */
async function broadcastMutation(
  docName: string,
  mutate: (doc: Y.Doc) => void,
): Promise<boolean> {
  return new Promise((resolve) => {
    let resolved = false;
    const settle = (ok: boolean) => {
      if (resolved) return;
      resolved = true;
      try { ws.close(); } catch { /* ignore */ }
      resolve(ok);
    };

    const url = `${WS_URL}/${encodeURIComponent(docName)}`;
    const ws = new WebSocket(url);
    const doc = new Y.Doc();

    // server 任何 sync 消息 → 应用到我们的 doc, 让我们和 server 同步
    ws.on('message', (data: Buffer | ArrayBuffer | Buffer[]) => {
      try {
        const arr =
          data instanceof Buffer ? new Uint8Array(data)
          : data instanceof ArrayBuffer ? new Uint8Array(data)
          : new Uint8Array(Buffer.concat(data as Buffer[]));
        const decoder = decoding.createDecoder(arr);
        const messageType = decoding.readVarUint(decoder);
        if (messageType !== messageSync) return; // 忽略 awareness 等
        const encoder = encoding.createEncoder();
        encoding.writeVarUint(encoder, messageSync);
        syncProtocol.readSyncMessage(decoder, encoder, doc, ws);
        if (encoding.length(encoder) > 1) {
          ws.send(encoding.toUint8Array(encoder));
        }
      } catch (e) {
        console.warn('[yjs-broadcast] message error:', e);
      }
    });

    ws.on('open', () => {
      // 客户端主动发 syncStep1, server 会回 syncStep2 把我们同步到 latest
      const encoder = encoding.createEncoder();
      encoding.writeVarUint(encoder, messageSync);
      syncProtocol.writeSyncStep1(encoder, doc);
      ws.send(encoding.toUint8Array(encoder));

      // 等 50ms 让 server 的 syncStep2 到, 再 mutate (这样 mutate 是基于 latest)
      setTimeout(() => {
        // 注册 update 监听 → 把这次 mutate 产生的 update 发给 server
        const onUpdate = (update: Uint8Array, origin: unknown) => {
          if (origin === ws) return; // server 推来的回声, 跳
          const enc = encoding.createEncoder();
          encoding.writeVarUint(enc, messageSync);
          syncProtocol.writeUpdate(enc, update);
          try {
            ws.send(encoding.toUint8Array(enc));
          } catch (e) {
            // ignore
          }
        };
        doc.on('update', onUpdate);
        try {
          mutate(doc);
        } finally {
          doc.off('update', onUpdate);
        }
        // 给 server 50ms 接收, 然后关
        setTimeout(() => settle(true), 100);
      }, 80);
    });

    ws.on('error', (e) => {
      console.warn(`[yjs-broadcast] ws error (${docName}):`, e instanceof Error ? e.message : e);
      settle(false);
    });

    setTimeout(() => settle(false), BROADCAST_TIMEOUT_MS);
  });
}

/**
 * 把一条新评论广播到对应 project 的 Y.Doc.comments Y.Array.
 *
 * 失败容忍 — broadcast 失败不影响 REST 返回 (客户端只会 fallback 到下一次轮询 / 重连后 catch up).
 */
export async function broadcastNewComment(
  projectId: string,
  comment: CommentRow,
): Promise<void> {
  const docName = docNameForProject(projectId);
  try {
    await broadcastMutation(docName, (doc) => {
      const arr = doc.getArray<{ [k: string]: unknown }>('comments');
      // 检查是否已存在 (server 端可能已经被前一次 broadcast 写过)
      const all = arr.toArray();
      if (all.some((c) => (c as any)?.id === comment.id)) return;
      arr.push([
        {
          id: comment.id,
          projectId: comment.projectId,
          targetType: comment.targetType,
          targetId: comment.targetId,
          authorUserId: comment.authorUserId,
          authorName: comment.authorName,
          authorAvatarUrl: comment.authorAvatarUrl,
          content: comment.content,
          mentions: comment.mentions,
          parentId: comment.parentId,
          createdAt: comment.createdAt,
          deletedAt: comment.deletedAt,
        },
      ]);
    });
  } catch (e) {
    // never throw — Yjs broadcast 是 best-effort
    console.warn(`[yjs-broadcast] broadcastNewComment failed for ${projectId}:`, e);
  }
}

/**
 * 评论软删 — 把 Y.Array 里同 id 的元素的 deletedAt 字段标上.
 * Y.Array 不支持 set-by-index 的复杂 mutation, 所以这里用 delete + insert.
 */
export async function broadcastDeleteComment(
  projectId: string,
  commentId: string,
  deletedAt: string,
): Promise<void> {
  const docName = docNameForProject(projectId);
  try {
    await broadcastMutation(docName, (doc) => {
      const arr = doc.getArray<{ [k: string]: unknown }>('comments');
      const all = arr.toArray();
      const idx = all.findIndex((c) => (c as any)?.id === commentId);
      if (idx < 0) return;
      const existing = all[idx] as any;
      doc.transact(() => {
        arr.delete(idx, 1);
        arr.insert(idx, [{ ...existing, deletedAt }]);
      });
    });
  } catch (e) {
    console.warn(`[yjs-broadcast] broadcastDeleteComment failed for ${projectId}:`, e);
  }
}
