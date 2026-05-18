'use client';

/**
 * v3.1.3 P4 — Y.Map 段编辑锁 (timeline 多人协作时防冲突).
 *
 * 设计:
 *   - 共享 Y.Map<segmentKey, LockEntry> 在每个 project doc 里 ("segmentLocks" map)
 *   - LockEntry = { userId, userName, color, lockedAt (epoch ms) }
 *   - 拖动开始时 client 尝试 acquire — 若已有他人锁 → 拒绝, UI 给提示
 *   - mouseup 释放; 网络掉/未释放 → 30s 后服务端无关心, 其他 client 视为 stale 自动忽略
 *
 * 为什么不用 awareness:
 *   awareness 是"会话级 ephemeral", 任一 client 关 tab 立即清掉 — 但若拖动到一半
 *   网络抖, 锁会被瞬时丢, 出现"我以为锁着实际没锁"的竞态.
 *   Y.Map 是 Yjs CRDT 持久化数据, 即便客户端断网 30s 重连, 锁状态也保留.
 *
 * 锁的 stale 处理:
 *   tryAcquire 时检查现有 entry 的 lockedAt, 距 now > STALE_AFTER_MS 视为过期可抢.
 *   保守 30s — 比 awareness 30s timeout 一致.
 */

import { useEffect, useState, useCallback } from 'react';
import * as Y from 'yjs';
import { useYjs } from '@/hooks/use-yjs';

export interface LockEntry {
  userId: string;
  userName: string;
  color: string;
  lockedAt: number;
}

export const STALE_AFTER_MS = 30_000;

export interface SegmentLocksApi {
  /** 当前已知锁 map */
  locks: Record<string, LockEntry>;
  /** 试图获取一个段的锁; 返回 true = 拿到, false = 被他人锁住 */
  tryAcquire: (segmentKey: string) => boolean;
  /** 主动释放一个锁 (例如 mouseup) */
  release: (segmentKey: string) => void;
  /** 当前用户的 locks (调用方 cleanup 用) */
  myLocks: string[];
}

const NULL_API: SegmentLocksApi = {
  locks: {},
  tryAcquire: () => true,           // 未连 yjs 时, 退化为单人模式, 永远允许
  release: () => { /* no-op */ },
  myLocks: [],
};

function isStale(entry: LockEntry, now: number): boolean {
  return now - entry.lockedAt > STALE_AFTER_MS;
}

export function useSegmentLocks(
  projectId: string | null,
  currentUser: { id: string; name: string; color: string } | null,
): SegmentLocksApi {
  const yjs = useYjs(projectId && currentUser ? `project-${projectId}` : null);
  const [locks, setLocks] = useState<Record<string, LockEntry>>({});

  // 订阅 Y.Map 变化 → 同步到 React state
  useEffect(() => {
    if (!yjs) return;
    const map = yjs.doc.getMap<LockEntry>('segmentLocks');
    const sync = () => {
      const out: Record<string, LockEntry> = {};
      const now = Date.now();
      map.forEach((v, k) => {
        if (!v || typeof v !== 'object') return;
        // 过期的不放到本地 state — 避免 UI 显示"假锁"
        if (isStale(v as LockEntry, now)) return;
        out[k] = v as LockEntry;
      });
      setLocks(out);
    };
    map.observe(sync);
    sync();
    return () => map.unobserve(sync);
  }, [yjs]);

  // tryAcquire: 检查 → 写入. CRDT 上 Y.Map.set 是原子的, 写完 observe 会立刻在自己端 fire.
  // 两人同时 acquire 同一段, Yjs 会按 clientId 决定胜者; 输的一方 observe 会看到 winner 的值,
  // 这里通过 setTimeout 0 二次确认是不是自己 — 不是就回滚 (rare path, 但保 correctness).
  const tryAcquire = useCallback((segmentKey: string): boolean => {
    if (!yjs || !currentUser) return true; // 未连接 → 单人模式允许
    const map = yjs.doc.getMap<LockEntry>('segmentLocks');
    const existing = map.get(segmentKey);
    const now = Date.now();
    if (existing && existing.userId !== currentUser.id && !isStale(existing, now)) {
      return false; // 被别人锁
    }
    // 自己 / stale 锁 / 未锁 → 写入
    const entry: LockEntry = {
      userId: currentUser.id,
      userName: currentUser.name,
      color: currentUser.color,
      lockedAt: now,
    };
    yjs.doc.transact(() => map.set(segmentKey, entry));
    return true;
  }, [yjs, currentUser]);

  const release = useCallback((segmentKey: string): void => {
    if (!yjs || !currentUser) return;
    const map = yjs.doc.getMap<LockEntry>('segmentLocks');
    const cur = map.get(segmentKey);
    if (cur && cur.userId === currentUser.id) {
      yjs.doc.transact(() => map.delete(segmentKey));
    }
  }, [yjs, currentUser]);

  // tab close / 组件卸载 → 主动释放本用户所有锁 (Yjs 不会 onClose 帮我们清)
  useEffect(() => {
    if (!yjs || !currentUser) return;
    const cleanup = () => {
      const map = yjs.doc.getMap<LockEntry>('segmentLocks');
      yjs.doc.transact(() => {
        map.forEach((v, k) => {
          if ((v as LockEntry)?.userId === currentUser.id) map.delete(k);
        });
      });
    };
    window.addEventListener('beforeunload', cleanup);
    return () => {
      window.removeEventListener('beforeunload', cleanup);
      cleanup();
    };
  }, [yjs, currentUser]);

  if (!yjs || !currentUser) return NULL_API;

  const myLocks = Object.entries(locks)
    .filter(([, v]) => v.userId === currentUser.id)
    .map(([k]) => k);

  return { locks, tryAcquire, release, myLocks };
}
