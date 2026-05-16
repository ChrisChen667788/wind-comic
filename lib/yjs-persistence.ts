/**
 * v3.0 P0.2 — Yjs document snapshot persistence (SQLite BLOB).
 *
 * 用法:
 *   loadDoc(docName) → 返回 Y.Doc (空 doc 或从 BLOB 恢复)
 *   persistDoc(docName, doc) → 把 Y.encodeStateAsUpdate(doc) 写回 SQLite (UPSERT)
 *
 * 性能:
 *   - 每次 update 都 persist 不现实 — 高频协作会 IO bound. 调用方应 debounce.
 *   - update_count 字段记录累计 update 次数; 每 100 次后 caller 可选触发 GC (重新
 *     从当前 doc 取 full state 写回, 把碎片合并).
 *
 * 注意:
 *   - SQLite BLOB 无大小硬上限, 但单 row 控制在 < 1MB 比较稳; 大项目可改为附属表分片.
 */

import { db, now } from '@/lib/db';
import * as Y from 'yjs';

interface YjsDocRow {
  doc_name: string;
  state: Buffer;
  update_count: number;
  updated_at: string;
  created_at: string;
}

/**
 * 从 SQLite 加载 Y.Doc state. 若不存在则返回空 doc.
 * 调用方拿到的 Y.Doc 后通常需要在它身上注册 observer.
 */
export function loadDoc(docName: string): Y.Doc {
  const doc = new Y.Doc();
  const row = db
    .prepare('SELECT state FROM yjs_docs WHERE doc_name = ?')
    .get(docName) as { state: Buffer } | undefined;
  if (row && row.state) {
    try {
      Y.applyUpdate(doc, new Uint8Array(row.state));
    } catch (e) {
      // 损坏的 snapshot — 退回空 doc, 让后续 update 写回新状态
      console.error(`[yjs-persistence] applyUpdate failed for ${docName}:`, e);
    }
  }
  return doc;
}

/**
 * 把 Y.Doc 当前状态写到 SQLite (UPSERT).
 * 返回累计 update_count.
 */
export function persistDoc(docName: string, doc: Y.Doc): number {
  const state = Y.encodeStateAsUpdate(doc);
  const ts = now();
  const existing = db
    .prepare('SELECT update_count FROM yjs_docs WHERE doc_name = ?')
    .get(docName) as { update_count: number } | undefined;
  if (existing) {
    const nextCount = existing.update_count + 1;
    db.prepare(`UPDATE yjs_docs SET state = ?, update_count = ?, updated_at = ? WHERE doc_name = ?`).run(
      Buffer.from(state), nextCount, ts, docName,
    );
    return nextCount;
  } else {
    db.prepare(
      `INSERT INTO yjs_docs (doc_name, state, update_count, updated_at, created_at) VALUES (?, ?, 1, ?, ?)`,
    ).run(docName, Buffer.from(state), ts, ts);
    return 1;
  }
}

/**
 * 元信息 — 给 admin / debug 用.
 */
export function describeDoc(docName: string): {
  exists: boolean;
  sizeBytes: number;
  updateCount: number;
  updatedAt: string | null;
} {
  const row = db
    .prepare('SELECT state, update_count, updated_at FROM yjs_docs WHERE doc_name = ?')
    .get(docName) as Pick<YjsDocRow, 'state' | 'update_count' | 'updated_at'> | undefined;
  if (!row) return { exists: false, sizeBytes: 0, updateCount: 0, updatedAt: null };
  return {
    exists: true,
    sizeBytes: row.state?.length || 0,
    updateCount: row.update_count,
    updatedAt: row.updated_at,
  };
}

/**
 * 删除一个 doc — 测试 + 项目硬删时调用.
 */
export function deleteDoc(docName: string): boolean {
  const result = db.prepare('DELETE FROM yjs_docs WHERE doc_name = ?').run(docName);
  return result.changes > 0;
}
