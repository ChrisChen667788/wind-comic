#!/usr/bin/env node
/**
 * v3.0 P0.2 — Standalone Yjs WebSocket server (port 1234 by default).
 *
 * 协议:
 *   - 客户端连接 ws://host:1234/<docName> (docName 通常 = `project-<projectId>`)
 *   - 用 y-protocols/sync 标准消息: sync step 1 / 2 / update / awareness
 *   - 服务器对每个 docName 持一个 Y.Doc 实例 (内存), 多个 WS 连接同享
 *   - Y.Doc 收到 update → 广播给同 doc 的所有其他连接 + debounced 持久化到 SQLite
 *   - 启动时不预加载; 连接到来时 lazy load snapshot
 *
 * 启动:
 *   node scripts/ws-server.mjs                    # 默认端口 1234
 *   WS_PORT=4001 node scripts/ws-server.mjs       # 覆盖
 *
 * 与 Next.js 关系: 完全独立进程; dev 双开两个终端, prod 用 systemd / pm2.
 *
 * 注意 SQLite 并发:
 *   - WS server + Next.js 都打开同一个 .db 文件
 *   - better-sqlite3 在 WAL 模式下读写互不阻塞 (我们 lib/db.ts 默认开 WAL)
 *   - 我们这里只写 yjs_docs 表, 不动其他表, 不会和 Next.js 路由打架
 */

import { WebSocketServer } from 'ws';
import * as Y from 'yjs';
import * as syncProtocol from 'y-protocols/sync';
import * as awarenessProtocol from 'y-protocols/awareness';
import * as encoding from 'lib0/encoding';
import * as decoding from 'lib0/decoding';
import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');

// ── SQLite (复用主库) ──────────────────────────────────────────────────────────
// 测试隔离: VITEST/NODE_ENV=test 下用 qfmj.test.db, 与 lib/db.ts 的测试库一致,
// e2e 子进程不再写生产库 (lib/db.ts 已在测试进程启动时清过该文件).
const isTestEnv = !!process.env.VITEST || process.env.NODE_ENV === 'test';
// QFMJ_DB_PATH: 测试时由 e2e 测试进程透传"它本次实际用的随机库文件"路径, 确保子进程
// 与测试进程读写同一个库 (lib/db.ts 现在每个测试文件用一个独占的随机库文件名).
// 未设置时回退到默认: 测试 qfmj.test.db / 生产 qfmj.db.
const dbPath = process.env.QFMJ_DB_PATH
  || path.join(projectRoot, 'data', isTestEnv ? 'qfmj.test.db' : 'qfmj.db');
const sqlite = new Database(dbPath);
sqlite.pragma('journal_mode = WAL');
// Next.js 主进程 + 本 ws-server 同时写同一 sqlite, 不设 busy_timeout 时并发写直接抛
// SQLITE_BUSY (yjs_docs 持久化静默失败). 等最多 5s 拿锁, 与 lib/db.ts 一致.
sqlite.pragma('busy_timeout = 5000');

// 自给自足地保证 yjs_docs 存在: 子进程打开的库通常已由测试/主进程建好表, 但跨进程
// WAL 刚写入的表偶有可见性时延, 直接 prepare 会抛 "no such table" 导致子进程启动即崩
// (表现为 e2e "port wait timeout"). IF NOT EXISTS 幂等, 见到了就跳过, 没见到就自己建.
sqlite.exec(`CREATE TABLE IF NOT EXISTS yjs_docs (
  doc_name TEXT PRIMARY KEY,
  state BLOB NOT NULL,
  update_count INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);`);

const SELECT_DOC = sqlite.prepare('SELECT state, update_count FROM yjs_docs WHERE doc_name = ?');
const INSERT_DOC = sqlite.prepare(
  `INSERT INTO yjs_docs (doc_name, state, update_count, updated_at, created_at) VALUES (?, ?, 1, ?, ?)`,
);
const UPDATE_DOC = sqlite.prepare(
  `UPDATE yjs_docs SET state = ?, update_count = update_count + 1, updated_at = ? WHERE doc_name = ?`,
);

function loadStateFromDb(docName) {
  const row = SELECT_DOC.get(docName);
  return row ? new Uint8Array(row.state) : null;
}

function persistStateToDb(docName, state) {
  const ts = new Date().toISOString();
  const row = SELECT_DOC.get(docName);
  if (row) {
    UPDATE_DOC.run(Buffer.from(state), ts, docName);
  } else {
    INSERT_DOC.run(docName, Buffer.from(state), ts, ts);
  }
  if (process.env.WS_DEBUG) console.error(`[ws-debug] persisted ${docName} → ${dbPath} (${state.length}b)`);
}

// ── Yjs 协议常量 ───────────────────────────────────────────────────────────────
const messageSync = 0;
const messageAwareness = 1;

// ── 文档注册表 ────────────────────────────────────────────────────────────────
// 每个 docName 对应一个 entry, 多个 WS 连接共享.
const docs = new Map(); // docName → { doc, awareness, conns, persistTimer }

const PERSIST_DEBOUNCE_MS = 2000;
const MAX_BATCHED_UPDATES_BEFORE_FLUSH = 20;

function getOrCreateDoc(docName) {
  let entry = docs.get(docName);
  if (entry) return entry;

  const doc = new Y.Doc();
  // 从 DB 恢复
  const restoredState = loadStateFromDb(docName);
  if (restoredState) {
    try {
      Y.applyUpdate(doc, restoredState);
    } catch (e) {
      console.error(`[ws] failed to restore ${docName}:`, e);
    }
  }

  const awareness = new awarenessProtocol.Awareness(doc);
  awareness.setLocalState(null); // server 自己不参与 awareness

  /** Set<WebSocket> — 所有连接到该 doc 的 ws */
  const conns = new Map(); // ws → Set<clientId>

  let pendingUpdates = 0;
  let persistTimer = null;
  const schedulePersist = () => {
    pendingUpdates++;
    if (pendingUpdates >= MAX_BATCHED_UPDATES_BEFORE_FLUSH) {
      if (persistTimer) clearTimeout(persistTimer);
      pendingUpdates = 0;
      try {
        persistStateToDb(docName, Y.encodeStateAsUpdate(doc));
      } catch (e) {
        console.error(`[ws] persist failed for ${docName}:`, e);
      }
      return;
    }
    if (persistTimer) clearTimeout(persistTimer);
    persistTimer = setTimeout(() => {
      pendingUpdates = 0;
      try {
        persistStateToDb(docName, Y.encodeStateAsUpdate(doc));
      } catch (e) {
        console.error(`[ws] persist failed for ${docName}:`, e);
      }
    }, PERSIST_DEBOUNCE_MS);
  };

  // 监听 doc update → 广播给其他连接 + 计划持久化
  doc.on('update', (update, origin) => {
    const message = encoding.createEncoder();
    encoding.writeVarUint(message, messageSync);
    syncProtocol.writeUpdate(message, update);
    const buf = encoding.toUint8Array(message);
    for (const [ws] of conns) {
      if (ws !== origin && ws.readyState === 1 /* OPEN */) {
        try { ws.send(buf); } catch (e) { /* socket closing */ }
      }
    }
    schedulePersist();
  });

  // 监听 awareness 变化 → 广播
  awareness.on('update', ({ added, updated, removed }, origin) => {
    const changedClients = added.concat(updated, removed);
    if (changedClients.length === 0) return;
    const message = encoding.createEncoder();
    encoding.writeVarUint(message, messageAwareness);
    encoding.writeVarUint8Array(
      message,
      awarenessProtocol.encodeAwarenessUpdate(awareness, changedClients),
    );
    const buf = encoding.toUint8Array(message);
    for (const [ws] of conns) {
      if (ws !== origin && ws.readyState === 1) {
        try { ws.send(buf); } catch (e) { /* swallow */ }
      }
    }
  });

  entry = { doc, awareness, conns, schedulePersist };
  docs.set(docName, entry);
  return entry;
}

function closeConn(entry, ws) {
  const controlledIds = entry.conns.get(ws);
  if (controlledIds) {
    awarenessProtocol.removeAwarenessStates(
      entry.awareness,
      Array.from(controlledIds),
      null,
    );
  }
  entry.conns.delete(ws);
  // 没有连接了 — 把 doc 卸载省内存. 下次连接会从 DB 恢复.
  if (entry.conns.size === 0) {
    // 最后一刷
    try {
      persistStateToDb(getDocNameForEntry(entry), Y.encodeStateAsUpdate(entry.doc));
    } catch (e) { /* swallow */ }
    // 找到 docName 并移除
    for (const [name, e] of docs.entries()) {
      if (e === entry) {
        docs.delete(name);
        break;
      }
    }
  }
}
function getDocNameForEntry(entry) {
  for (const [name, e] of docs.entries()) if (e === entry) return name;
  return 'unknown';
}

function handleMessage(ws, entry, message) {
  try {
    const decoder = decoding.createDecoder(message);
    const messageType = decoding.readVarUint(decoder);
    const encoder = encoding.createEncoder();
    switch (messageType) {
      case messageSync: {
        encoding.writeVarUint(encoder, messageSync);
        syncProtocol.readSyncMessage(decoder, encoder, entry.doc, ws);
        if (encoding.length(encoder) > 1) {
          ws.send(encoding.toUint8Array(encoder));
        }
        break;
      }
      case messageAwareness: {
        awarenessProtocol.applyAwarenessUpdate(
          entry.awareness,
          decoding.readVarUint8Array(decoder),
          ws,
        );
        break;
      }
      default:
        console.warn(`[ws] unknown message type ${messageType}`);
    }
  } catch (e) {
    console.error(`[ws] message handler error:`, e);
    ws.close();
  }
}

// ── 连接 lifecycle ────────────────────────────────────────────────────────────
function onConnection(ws, req) {
  // URL 形如 /project-abc123 — 取 pathname 去 '/' 作 docName
  const url = req.url || '/';
  const docName = url.slice(1).split('?')[0] || 'default';

  if (!/^[\w-]+$/.test(docName) || docName.length > 100) {
    console.warn(`[ws] rejected invalid docName: ${docName}`);
    ws.close();
    return;
  }

  const entry = getOrCreateDoc(docName);
  entry.conns.set(ws, new Set());

  ws.binaryType = 'arraybuffer';
  ws.on('message', (data) => {
    const msg = data instanceof ArrayBuffer ? new Uint8Array(data) : new Uint8Array(data);
    handleMessage(ws, entry, msg);
  });
  ws.on('close', () => closeConn(entry, ws));
  ws.on('error', () => closeConn(entry, ws));

  // sync step 1 — 发送服务器当前状态 vector
  {
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, messageSync);
    syncProtocol.writeSyncStep1(encoder, entry.doc);
    ws.send(encoding.toUint8Array(encoder));
  }
  // 发送当前 awareness 状态
  const awarenessStates = entry.awareness.getStates();
  if (awarenessStates.size > 0) {
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, messageAwareness);
    encoding.writeVarUint8Array(
      encoder,
      awarenessProtocol.encodeAwarenessUpdate(
        entry.awareness,
        Array.from(awarenessStates.keys()),
      ),
    );
    ws.send(encoding.toUint8Array(encoder));
  }

  console.log(`[ws] ${docName} +1 conn (total: ${entry.conns.size})`);
}

// ── 启动 ──────────────────────────────────────────────────────────────────────
const PORT = parseInt(process.env.WS_PORT || '1234', 10);
const wss = new WebSocketServer({ port: PORT });
wss.on('connection', onConnection);
wss.on('listening', () => {
  console.log(`[ws] Yjs WebSocket server listening on :${PORT}`);
  console.log(`[ws] connect to ws://localhost:${PORT}/<docName>`);
});

// graceful shutdown — 把所有 active doc 刷盘
const shutdown = (signal) => {
  console.log(`[ws] received ${signal}, flushing ${docs.size} active doc(s)...`);
  for (const [name, entry] of docs.entries()) {
    try {
      persistStateToDb(name, Y.encodeStateAsUpdate(entry.doc));
    } catch (e) {
      console.error(`[ws] final flush failed for ${name}:`, e);
    }
  }
  wss.close(() => {
    sqlite.close();
    process.exit(0);
  });
  // hard exit after 3s
  setTimeout(() => process.exit(0), 3000);
};
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
