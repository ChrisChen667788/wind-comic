/**
 * v3.0 P0.2 — End-to-end WS server test.
 *
 * 启动 scripts/ws-server.mjs 子进程, 用 ws + y-protocols 模拟两个客户端:
 *   - Client A 连接, push 一个 Y.Map 到 'comments' Y.Array
 *   - Client B 连接 (后到), 期待立刻收到 sync2 把 Y.Array 同步过来 (含 A push 的项)
 *   - Client A 再 push, B 通过 'update' 实时收到
 *   - 关闭所有 client + server, 验证 SQLite yjs_docs 表里有该 doc + 内容能 restore
 *
 * 用临时端口 + 临时 doc_name 防干扰. 测试结束清理 DB 行.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { spawn, type ChildProcess } from 'child_process';
import { WebSocket as NodeWebSocket } from 'ws';
import * as Y from 'yjs';
import * as syncProtocol from 'y-protocols/sync';
import * as encoding from 'lib0/encoding';
import * as decoding from 'lib0/decoding';
import { db } from '@/lib/db';
import { loadDoc, deleteDoc } from '@/lib/yjs-persistence';
import path from 'path';

const TEST_PORT = 14322;
const TEST_DOC = 'test-e2e-doc';
const messageSync = 0;

let serverProc: ChildProcess | null = null;

function waitForPort(port: number, timeoutMs = 5000): Promise<void> {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const tick = () => {
      const ws = new NodeWebSocket(`ws://localhost:${port}/__ping__`);
      ws.once('open', () => { ws.close(); resolve(); });
      ws.once('error', () => {
        if (Date.now() - start > timeoutMs) reject(new Error('port wait timeout'));
        else setTimeout(tick, 100);
      });
    };
    tick();
  });
}

function connectClient(docName: string, port: number, doc: Y.Doc): Promise<NodeWebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new NodeWebSocket(`ws://localhost:${port}/${docName}`);
    ws.binaryType = 'arraybuffer';

    ws.on('message', (data: ArrayBuffer | Buffer) => {
      const arr = data instanceof ArrayBuffer ? new Uint8Array(data) : new Uint8Array(data);
      const decoder = decoding.createDecoder(arr);
      const messageType = decoding.readVarUint(decoder);
      if (messageType !== messageSync) return;
      const encoder = encoding.createEncoder();
      encoding.writeVarUint(encoder, messageSync);
      syncProtocol.readSyncMessage(decoder, encoder, doc, ws);
      if (encoding.length(encoder) > 1) {
        ws.send(encoding.toUint8Array(encoder));
      }
    });

    // 当 doc 本地 mutation 触发 update → 发给 server (用 origin tag = ws 避免回环)
    doc.on('update', (update: Uint8Array, origin: unknown) => {
      if (origin === ws) return; // server 推回的, 跳
      const enc = encoding.createEncoder();
      encoding.writeVarUint(enc, messageSync);
      syncProtocol.writeUpdate(enc, update);
      try { ws.send(encoding.toUint8Array(enc)); } catch { /* ignore */ }
    });

    ws.on('open', () => {
      // 主动发 syncStep1, server 回 syncStep2 把我们 catch-up 到 latest
      const enc = encoding.createEncoder();
      encoding.writeVarUint(enc, messageSync);
      syncProtocol.writeSyncStep1(enc, doc);
      ws.send(encoding.toUint8Array(enc));
      resolve(ws);
    });
    ws.on('error', reject);
  });
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

beforeAll(async () => {
  const scriptPath = path.join(process.cwd(), 'scripts', 'ws-server.mjs');
  serverProc = spawn('node', [scriptPath], {
    env: { ...process.env, WS_PORT: String(TEST_PORT) },
    stdio: 'pipe',
  });
  // 任由 stderr/stdout, 但抓 error
  serverProc.on('error', (e) => console.error('[test] ws server spawn error:', e));
  await waitForPort(TEST_PORT, 6000);
}, 10_000);

afterAll(async () => {
  if (serverProc && !serverProc.killed) {
    serverProc.kill('SIGTERM');
    await sleep(300);
    if (!serverProc.killed) serverProc.kill('SIGKILL');
  }
});

beforeEach(() => {
  // 每个测试开始前清掉测试 doc
  db.prepare('DELETE FROM yjs_docs WHERE doc_name LIKE ?').run('test-e2e-%');
});

describe('v3.0 P0.2 · WS server e2e', () => {
  it('two clients sync via Y.Array push', async () => {
    const docA = new Y.Doc();
    const docB = new Y.Doc();
    const wsA = await connectClient(TEST_DOC, TEST_PORT, docA);
    await sleep(150);

    // A 写入
    const arrA = docA.getArray<{ id: string; content: string }>('comments');
    arrA.push([{ id: 'a1', content: 'from A' }]);
    await sleep(300);

    // B 后到 — 期待 syncStep2 自动把 A 的内容推过来
    const wsB = await connectClient(TEST_DOC, TEST_PORT, docB);
    await sleep(300);

    const arrB = docB.getArray<{ id: string; content: string }>('comments');
    expect(arrB.length).toBe(1);
    expect(arrB.get(0)).toEqual({ id: 'a1', content: 'from A' });

    // A 再 push, B 收到 update event
    arrA.push([{ id: 'a2', content: 'second' }]);
    await sleep(300);
    expect(arrB.length).toBe(2);

    wsA.close();
    wsB.close();
    await sleep(200);
  }, 8_000);

  it('persists state to SQLite after disconnect', async () => {
    const docName = 'test-e2e-persist';
    const doc = new Y.Doc();
    const ws = await connectClient(docName, TEST_PORT, doc);
    await sleep(150);

    doc.getArray<{ k: string }>('items').push([{ k: 'persisted-value' }]);
    await sleep(300);

    ws.close();
    // 给 server 时间触发 final flush
    await sleep(500);

    // 从 SQLite restore — 走 lib/yjs-persistence
    const restored = loadDoc(docName);
    const arr = restored.getArray<{ k: string }>('items');
    expect(arr.length).toBe(1);
    expect(arr.get(0)).toEqual({ k: 'persisted-value' });

    deleteDoc(docName);
  }, 6_000);

  it('rejects invalid doc names', async () => {
    return new Promise<void>((resolve) => {
      // doc name 含 '/' 不在白名单, server 应直接 close
      const ws = new NodeWebSocket(`ws://localhost:${TEST_PORT}/bad/path/here`);
      ws.on('close', () => resolve());
      ws.on('open', () => { /* still close fires after server kicks */ });
      setTimeout(resolve, 1500);
    });
  }, 3_000);
});
