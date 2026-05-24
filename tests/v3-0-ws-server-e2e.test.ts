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
import { db, dbPath } from '@/lib/db';
import { deleteDoc } from '@/lib/yjs-persistence';
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
    // v4.x: 显式传 VITEST, 让 ws-server 子进程也走测试库.
    // QFMJ_DB_PATH: lib/db.ts 现在每个测试文件用一个独占的随机库文件, 这里把本测试
    // 进程实际用的那个文件路径透传给子进程, 保证两边读写同一个库 (否则子进程会另开
    // 一个默认名的库, 与测试进程不互通).
    env: { ...process.env, WS_PORT: String(TEST_PORT), VITEST: 'true', NODE_ENV: 'test', QFMJ_DB_PATH: dbPath },
    stdio: 'pipe',
  });
  // 抓子进程输出: 之前只挂 'error'(只捕获 spawn 失败), 子进程启动时若抛异常
  // (如 yjs_docs 表不可见 → prepare "no such table" → 进程退出) 会被吞掉,
  // 测试只看到 "port wait timeout" 这种无信息的报错. 这里把 stderr + 退出码留下来,
  // 在端口等待失败时一并抛出, 便于定位.
  let childOut = '';
  serverProc.stdout?.on('data', (d) => { childOut += d.toString(); });
  serverProc.stderr?.on('data', (d) => { childOut += d.toString(); });
  let earlyExit: string | null = null;
  serverProc.on('exit', (code, sig) => {
    if (code !== 0 && code !== null) earlyExit = `ws-server exited early code=${code} sig=${sig}`;
  });
  serverProc.on('error', (e) => { childOut += `\n[spawn error] ${e}`; });
  try {
    await waitForPort(TEST_PORT, 10_000);
  } catch (e) {
    throw new Error(`${(e as Error).message}${earlyExit ? ' · ' + earlyExit : ''}\n--- ws-server output ---\n${childOut || '(empty)'}`);
  }
}, 15_000);

afterAll(async () => {
  // 关键: 必须等子进程**真正退出**, 而不是只看 serverProc.killed (那只代表
  // 信号已发出). ws-server 收到 SIGTERM 会先 flush + sqlite.close(), 期间仍持有
  // qfmj.test.db / -wal / -shm 句柄. 若此处提前返回, 下一个测试文件 import '@/lib/db'
  // 时会 unlink 这些仍被打开的文件并重建, 与子进程的收尾写入/关闭竞争, 偶发让
  // CREATE TABLE 抛 SQLITE_BUSY/IOERR (全量跑约 1/2 概率挂). 进程 exit 后内核已
  // 释放其所有 fd, unlink+重建才安全.
  const proc = serverProc;
  serverProc = null;
  if (!proc || proc.exitCode !== null) return;
  await new Promise<void>((resolve) => {
    let killTimer: ReturnType<typeof setTimeout>;
    const done = () => { clearTimeout(killTimer); resolve(); };
    proc.once('exit', done);
    proc.kill('SIGTERM');
    // 收尾(flush + close)给足时间; 2s 还没退就强杀, exit 仍会触发 done
    killTimer = setTimeout(() => { try { proc.kill('SIGKILL'); } catch { /* already gone */ } }, 2000);
  });
}, 10_000);

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

  it('persists state to SQLite after disconnect (verified via reconnect restore)', async () => {
    // 验证 持久化→恢复 全链路, 但走 WS reconnect (server 在自己进程里从 DB 恢复),
    // 不在测试进程跨进程裸读 SQLite —— 后者在全量 singleFork 重负载下 WAL 帧可见性不稳.
    const docName = 'test-e2e-persist';
    const docA = new Y.Doc();
    const wsA = await connectClient(docName, TEST_PORT, docA);
    await sleep(400);
    docA.getArray<{ k: string }>('items').push([{ k: 'persisted-value' }]);
    await sleep(1500); // 给 push 到达 server + 持久化
    wsA.close();
    await sleep(1000); // server 最后一刷 + 把 doc 从内存卸载 (下次连接强制走 DB 恢复)

    // 新客户端连同一 doc → server 从 SQLite 恢复 → 同步给新客户端
    const docB = new Y.Doc();
    const wsB = await connectClient(docName, TEST_PORT, docB);
    let items: Array<{ k: string }> = [];
    for (let i = 0; i < 40; i++) {
      await sleep(250);
      items = docB.getArray<{ k: string }>('items').toArray();
      if (items.length >= 1) break;
    }
    wsB.close();
    expect(items.length).toBe(1);
    expect(items[0]).toEqual({ k: 'persisted-value' });

    deleteDoc(docName);
  }, 30_000);

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
