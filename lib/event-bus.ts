/**
 * lib/event-bus (v10.2.0) — 进程内事件总线,用于实时推送(替代前端轮询)。
 *
 * 写路径(评论 / 通知 / 流水线进度)emit 对应频道 → SSE 端点订阅该频道 → 即时推给前端。
 * v10.4.5: 配 `REDIS_URL` 时自动桥到 Redis pub/sub(lib/event-bus-redis,零依赖手写
 * RESP)→ 多实例部署事件互通;不配则纯进程内(历史行为)。接口零变化。
 * 挂 globalThis 单例,保证 Next dev HMR / 多次 import 下仍是同一个 emitter。
 *
 * 仅服务端使用(依赖 Node `events`);前端走 lib/sse-client.ts,绝不 import 本模块。
 */
import { EventEmitter } from 'events';
import crypto from 'crypto';
import { startRedisBus, type RedisBusClient } from './event-bus-redis';

const g = globalThis as unknown as {
  __qfmjBus?: EventEmitter;
  __qfmjBusOrigin?: string;
  __qfmjRedisBus?: RedisBusClient | null;
  __qfmjRedisBusStarted?: boolean;
};
const bus = g.__qfmjBus ?? new EventEmitter();
bus.setMaxListeners(0); // 每个 SSE 连接一个监听者,不设上限
g.__qfmjBus = bus;

// ── v10.4.5: Redis 跨实例桥(REDIS_URL 存在才启;无则纯进程内 = 历史行为)──
// origin 标识本进程(HMR 下复用),远端回灌时据此防自回环双投。
const ORIGIN = g.__qfmjBusOrigin ?? `${process.pid}-${crypto.randomUUID().slice(0, 8)}`;
g.__qfmjBusOrigin = ORIGIN;

function ensureRedisBridge(): void {
  if (g.__qfmjRedisBusStarted) return;
  g.__qfmjRedisBusStarted = true;
  const url = process.env.REDIS_URL;
  if (!url) return;
  // 同步创建客户端(socket 连接异步,未就绪期间 publish 由客户端内部队列兜底)——
  // 此前用异步动态 import,首个 emit 时客户端还没出生,`?.publish` 被静默跳过 = 首发事件跨实例丢失。
  try {
    g.__qfmjRedisBus = startRedisBus(url, ORIGIN, (env) => {
      bus.emit(env.channel, env.event); // 远端事件回灌本地订阅者
    });
  } catch (e) {
    console.warn('[event-bus] Redis 桥启动失败,降级进程内:', e);
  }
}

/** 本地 emit + (配了 Redis 时)跨实例广播。 */
function busEmit(channel: string, event: BusEvent): void {
  bus.emit(channel, event);
  ensureRedisBridge();
  g.__qfmjRedisBus?.publish(channel, event);
}

export interface BusEvent {
  type: string;
  at: number;
  [k: string]: unknown;
}

export function notifChannel(userId: string): string {
  return `notif:${userId}`;
}
export function commentChannel(projectId: string): string {
  return `comment:${projectId}`;
}
/** v10.4.1: 流水线任务进度频道(worker emit → create-stream SSE 订阅) */
export function pipelineChannel(jobId: string): string {
  return `pipeline:${jobId}`;
}

export function emitNotification(userId: string, extra: Record<string, unknown> = {}): void {
  if (!userId) return;
  busEmit(notifChannel(userId), { type: 'notification', at: Date.now(), ...extra });
}
export function emitComment(projectId: string, extra: Record<string, unknown> = {}): void {
  if (!projectId) return;
  busEmit(commentChannel(projectId), { type: 'comment', at: Date.now(), ...extra });
}
/** v10.4.1: 流水线进度事件 — type 即 SSE 事件名,data 原样透传给客户端 */
export function emitPipeline(jobId: string, type: string, data: unknown): void {
  if (!jobId) return;
  busEmit(pipelineChannel(jobId), { type, at: Date.now(), data } as BusEvent);
}

/** 订阅频道,返回退订函数。 */
export function subscribe(channel: string, cb: (ev: BusEvent) => void): () => void {
  ensureRedisBridge(); // 纯订阅进程(只收不发)也要把桥拉起来才能收到远端事件
  bus.on(channel, cb);
  return () => {
    bus.off(channel, cb);
  };
}

export function listenerCount(channel: string): number {
  return bus.listenerCount(channel);
}
