/**
 * v3.0 P0.2 — Yjs persistence layer.
 *
 * 验证范围:
 *   - loadDoc 返回空 doc 当 doc_name 不存在
 *   - persistDoc 写入 + update_count 递增
 *   - loadDoc 能从 BLOB 完全恢复 Y.Array / Y.Map 内容
 *   - 损坏的 state BLOB 不抛 — 退回空 doc
 *   - describeDoc / deleteDoc 行为
 *   - 多次 persist 的 update_count 单调递增
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { db } from '@/lib/db';
import * as Y from 'yjs';
import {
  loadDoc,
  persistDoc,
  describeDoc,
  deleteDoc,
} from '@/lib/yjs-persistence';

beforeEach(() => {
  // 清测试产物
  db.prepare(`DELETE FROM yjs_docs WHERE doc_name LIKE 'test-yjs-%'`).run();
});

describe('v3.0 P0.2 · yjs-persistence', () => {
  it('loadDoc returns empty Y.Doc when name not found', () => {
    const doc = loadDoc('test-yjs-nonexistent');
    expect(doc).toBeInstanceOf(Y.Doc);
    expect(doc.getArray('comments').length).toBe(0);
  });

  it('persistDoc + loadDoc round-trips Y.Array content', () => {
    const docName = 'test-yjs-roundtrip';
    const original = new Y.Doc();
    const arr = original.getArray<{ id: string; content: string }>('comments');
    arr.push([{ id: 'c1', content: 'hello' }, { id: 'c2', content: 'world' }]);
    persistDoc(docName, original);

    const restored = loadDoc(docName);
    const restoredArr = restored.getArray<{ id: string; content: string }>('comments');
    expect(restoredArr.length).toBe(2);
    const items = restoredArr.toArray();
    expect(items[0]).toEqual({ id: 'c1', content: 'hello' });
    expect(items[1]).toEqual({ id: 'c2', content: 'world' });
  });

  it('persistDoc handles Y.Map content', () => {
    const docName = 'test-yjs-map';
    const doc = new Y.Doc();
    const m = doc.getMap<string>('meta');
    m.set('title', 'My Project');
    m.set('owner', 'alice');
    persistDoc(docName, doc);

    const restored = loadDoc(docName);
    const restoredMap = restored.getMap<string>('meta');
    expect(restoredMap.get('title')).toBe('My Project');
    expect(restoredMap.get('owner')).toBe('alice');
  });

  it('persistDoc increments update_count on each call', () => {
    const docName = 'test-yjs-count';
    const doc = new Y.Doc();
    doc.getArray('x').push(['a']);
    expect(persistDoc(docName, doc)).toBe(1);

    doc.getArray('x').push(['b']);
    expect(persistDoc(docName, doc)).toBe(2);

    doc.getArray('x').push(['c']);
    expect(persistDoc(docName, doc)).toBe(3);
  });

  it('describeDoc reports size + count + timestamp', () => {
    const docName = 'test-yjs-describe';
    const before = describeDoc(docName);
    expect(before.exists).toBe(false);
    expect(before.sizeBytes).toBe(0);
    expect(before.updateCount).toBe(0);
    expect(before.updatedAt).toBeNull();

    const doc = new Y.Doc();
    doc.getArray('items').push([{ x: 1 }, { x: 2 }]);
    persistDoc(docName, doc);

    const after = describeDoc(docName);
    expect(after.exists).toBe(true);
    expect(after.sizeBytes).toBeGreaterThan(0);
    expect(after.updateCount).toBe(1);
    expect(after.updatedAt).toBeTruthy();
  });

  it('deleteDoc removes and returns true; second delete returns false', () => {
    const docName = 'test-yjs-delete';
    const doc = new Y.Doc();
    doc.getArray('x').push(['a']);
    persistDoc(docName, doc);

    expect(deleteDoc(docName)).toBe(true);
    expect(deleteDoc(docName)).toBe(false);
    expect(describeDoc(docName).exists).toBe(false);
  });

  it('corrupted BLOB does not throw — returns empty doc', () => {
    const docName = 'test-yjs-corrupt';
    const ts = new Date().toISOString();
    // 直接写入垃圾 BLOB
    db.prepare(
      `INSERT INTO yjs_docs (doc_name, state, update_count, updated_at, created_at) VALUES (?, ?, 1, ?, ?)`,
    ).run(docName, Buffer.from([0xff, 0xff, 0xff, 0xff]), ts, ts);

    const doc = loadDoc(docName);
    expect(doc).toBeInstanceOf(Y.Doc);
    expect(doc.getArray('comments').length).toBe(0);
  });

  it('subsequent persists after loadDoc preserve cumulative state', () => {
    const docName = 'test-yjs-cumul';
    // 第 1 次写入
    {
      const doc = new Y.Doc();
      doc.getArray('items').push([{ id: '1' }]);
      persistDoc(docName, doc);
    }
    // 加载, 增加, 再 persist
    {
      const doc = loadDoc(docName);
      doc.getArray<{ id: string }>('items').push([{ id: '2' }]);
      persistDoc(docName, doc);
    }
    // 最终加载应该有 2 条
    {
      const doc = loadDoc(docName);
      const arr = doc.getArray<{ id: string }>('items');
      expect(arr.length).toBe(2);
      expect(arr.toArray().map((x) => x.id)).toEqual(['1', '2']);
    }
  });
});
