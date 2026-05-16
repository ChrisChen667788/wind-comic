'use client';

/**
 * v3.0 P0.2 — useYjs hook: 连接 ws://host:1234/<docName>, 暴露 Y.Doc + awareness.
 *
 * 用法:
 *   const { doc, awareness, status } = useYjs('project-abc123');
 *   const arr = doc.getArray<{...}>('comments');
 *   useEffect(() => {
 *     const onChange = () => setComments(arr.toArray());
 *     arr.observe(onChange);
 *     return () => arr.unobserve(onChange);
 *   }, [arr]);
 *
 * Awareness presence:
 *   awareness.setLocalStateField('user', { id, name, avatarUrl, color });
 *   awareness.on('change', () => setPresence([...awareness.getStates().values()]));
 *
 * 容错:
 *   - WS 没启 / 网络断 → status='disconnected', 但 doc 仍可用 (本地 mutation 仍生效, 重连后同步)
 *   - 同一 docName 多次 mount 共享同一 doc 实例 (避免重复连接)
 */

import { useEffect, useRef, useState } from 'react';
import * as Y from 'yjs';
import { WebsocketProvider } from 'y-websocket';

interface YjsRegistryEntry {
  doc: Y.Doc;
  provider: WebsocketProvider;
  refCount: number;
}

const registry = new Map<string, YjsRegistryEntry>();

function defaultWsUrl(): string {
  if (typeof window === 'undefined') return 'ws://localhost:1234';
  // 浏览器环境: 默认连同 host 但端口换 1234. 生产环境用 wss + 反代.
  const proto = window.location.protocol === 'https:' ? 'wss' : 'ws';
  const wsHost = process.env.NEXT_PUBLIC_YJS_WS_URL
    || `${proto}://${window.location.hostname}:1234`;
  return wsHost;
}

export type YjsStatus = 'connecting' | 'connected' | 'disconnected';

export interface UseYjsResult {
  doc: Y.Doc;
  provider: WebsocketProvider;
  status: YjsStatus;
}

export function useYjs(docName: string | null | undefined): UseYjsResult | null {
  const [status, setStatus] = useState<YjsStatus>('connecting');
  const docRef = useRef<Y.Doc | null>(null);
  const providerRef = useRef<WebsocketProvider | null>(null);

  useEffect(() => {
    if (!docName) return;
    // 进入注册表
    let entry = registry.get(docName);
    if (!entry) {
      const doc = new Y.Doc();
      const provider = new WebsocketProvider(defaultWsUrl(), docName, doc, {
        connect: true,
      });
      entry = { doc, provider, refCount: 0 };
      registry.set(docName, entry);
    }
    entry.refCount++;
    docRef.current = entry.doc;
    providerRef.current = entry.provider;

    const provider = entry.provider;
    const updateStatus = () => {
      // y-websocket 3.x 的 provider 有 'status' 事件 + ws.readyState
      if (provider.wsconnected) setStatus('connected');
      else if (provider.wsconnecting) setStatus('connecting');
      else setStatus('disconnected');
    };
    updateStatus();

    const onStatus = () => updateStatus();
    provider.on('status', onStatus);
    provider.on('connection-close', onStatus);
    provider.on('connection-error', onStatus);

    return () => {
      provider.off('status', onStatus);
      provider.off('connection-close', onStatus);
      provider.off('connection-error', onStatus);
      const e = registry.get(docName);
      if (!e) return;
      e.refCount--;
      if (e.refCount <= 0) {
        // 没人用了, 关连接
        try { e.provider.destroy(); } catch { /* ignore */ }
        registry.delete(docName);
      }
    };
  }, [docName]);

  if (!docRef.current || !providerRef.current) return null;
  return {
    doc: docRef.current,
    provider: providerRef.current,
    status,
  };
}
