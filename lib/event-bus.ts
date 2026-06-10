/**
 * lib/event-bus (v10.2.0) — 进程内事件总线,用于实时推送(替代前端轮询)。
 *
 * 写路径(评论 / 通知)emit 对应频道 → SSE 端点订阅该频道 → 即时推给前端。
 * 单实例足够(同 rate-limit 的取舍);多实例部署需换 Redis pub/sub 等共享总线。
 * 挂 globalThis 单例,保证 Next dev HMR / 多次 import 下仍是同一个 emitter。
 *
 * 仅服务端使用(依赖 Node `events`);前端走 lib/sse-client.ts,绝不 import 本模块。
 */
import { EventEmitter } from 'events';

const g = globalThis as unknown as { __qfmjBus?: EventEmitter };
const bus = g.__qfmjBus ?? new EventEmitter();
bus.setMaxListeners(0); // 每个 SSE 连接一个监听者,不设上限
g.__qfmjBus = bus;

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
  bus.emit(notifChannel(userId), { type: 'notification', at: Date.now(), ...extra });
}
export function emitComment(projectId: string, extra: Record<string, unknown> = {}): void {
  if (!projectId) return;
  bus.emit(commentChannel(projectId), { type: 'comment', at: Date.now(), ...extra });
}
/** v10.4.1: 流水线进度事件 — type 即 SSE 事件名,data 原样透传给客户端 */
export function emitPipeline(jobId: string, type: string, data: unknown): void {
  if (!jobId) return;
  bus.emit(pipelineChannel(jobId), { type, at: Date.now(), data });
}

/** 订阅频道,返回退订函数。 */
export function subscribe(channel: string, cb: (ev: BusEvent) => void): () => void {
  bus.on(channel, cb);
  return () => {
    bus.off(channel, cb);
  };
}

export function listenerCount(channel: string): number {
  return bus.listenerCount(channel);
}
