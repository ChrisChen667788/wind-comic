/**
 * lib/event-bus-redis (v10.4.5) — 跨实例事件总线桥(Redis pub/sub,零新依赖)。
 *
 * 动机(阶段十八 A 收官):event-bus 是 globalThis EventEmitter,多副本部署时
 * 评论/通知/流水线进度互不可见。本模块在 `REDIS_URL` 存在时把本地事件桥到
 * Redis(全部走单一线路频道 `qfmj-bus`,信封带 origin 防自回环双投),
 * 远端事件回灌本地 emitter —— event-bus 对外接口零变化。
 *
 * 取舍:手写最小 RESP 子集(与 v10.4.4 SigV4 同款零依赖哲学)——
 * pub/sub 只需 AUTH/SUBSCRIBE/PUBLISH 三条命令 + 推送帧解析;
 * 断线指数退避重连(1s→30s),Redis 不可用时静默降级为进程内(行为 = 现状)。
 * 支持 redis:// 与 rediss://(TLS)。
 */
import net from 'net';
import tls from 'tls';

// ── 纯函数区(单测覆盖)────────────────────────────────────────────────────

export interface RedisTarget {
  host: string;
  port: number;
  password?: string;
  tls: boolean;
}

export function parseRedisUrl(raw: string): RedisTarget | null {
  try {
    const u = new URL(raw);
    if (u.protocol !== 'redis:' && u.protocol !== 'rediss:') return null;
    return {
      host: u.hostname || '127.0.0.1',
      port: u.port ? parseInt(u.port, 10) : 6379,
      password: u.password ? decodeURIComponent(u.password) : undefined,
      tls: u.protocol === 'rediss:',
    };
  } catch {
    return null;
  }
}

/** RESP 命令编码:数组 of bulk strings。 */
export function encodeCommand(args: string[]): Buffer {
  const parts: Buffer[] = [Buffer.from(`*${args.length}\r\n`)];
  for (const a of args) {
    const b = Buffer.from(a);
    parts.push(Buffer.from(`$${b.length}\r\n`), b, Buffer.from('\r\n'));
  }
  return Buffer.concat(parts);
}

/**
 * 最小 RESP 解析器:+simple / -error / :int / $bulk / *array。
 * 支持跨 chunk 粘包/半包(feed 增量喂,凑不齐整帧就攒着)。
 */
export class RespReader {
  private buf = Buffer.alloc(0);

  feed(chunk: Buffer): unknown[] {
    this.buf = Buffer.concat([this.buf, chunk]);
    const out: unknown[] = [];
    for (;;) {
      const r = this.tryParse(0);
      if (!r) break;
      out.push(r.value);
      this.buf = this.buf.subarray(r.next);
    }
    return out;
  }

  private tryParse(pos: number): { value: unknown; next: number } | null {
    if (pos >= this.buf.length) return null;
    const nl = this.buf.indexOf('\r\n', pos);
    if (nl < 0) return null;
    const type = String.fromCharCode(this.buf[pos]);
    const head = this.buf.toString('utf8', pos + 1, nl);
    const after = nl + 2;
    switch (type) {
      case '+': return { value: head, next: after };
      case '-': return { value: new Error(head), next: after };
      case ':': return { value: parseInt(head, 10), next: after };
      case '$': {
        const len = parseInt(head, 10);
        if (len === -1) return { value: null, next: after };
        if (this.buf.length < after + len + 2) return null; // bulk 体未到齐
        return { value: this.buf.toString('utf8', after, after + len), next: after + len + 2 };
      }
      case '*': {
        const n = parseInt(head, 10);
        if (n === -1) return { value: null, next: after };
        const items: unknown[] = [];
        let cur = after;
        for (let i = 0; i < n; i++) {
          const r = this.tryParse(cur);
          if (!r) return null; // 子元素未到齐,整帧等下个 chunk
          items.push(r.value);
          cur = r.next;
        }
        return { value: items, next: cur };
      }
      default:
        return { value: new Error(`RESP 未知类型 "${type}"`), next: after };
    }
  }
}

/** 线路信封:单一频道承载全部逻辑频道,origin 防自回环。 */
export interface BusEnvelope {
  channel: string;
  origin: string;
  event: unknown;
}

export function shouldDeliver(env: unknown, selfOrigin: string): env is BusEnvelope {
  const e = env as BusEnvelope;
  return !!e && typeof e.channel === 'string' && e.channel.length > 0 && e.origin !== selfOrigin;
}

// ── 客户端 ──────────────────────────────────────────────────────────────────

const WIRE_CHANNEL = 'qfmj-bus';
const QUEUE_CAP = 200;

type Sock = net.Socket | tls.TLSSocket;

export class RedisBusClient {
  private target: RedisTarget;
  private origin: string;
  private onRemote: (env: BusEnvelope) => void;
  private pub: Sock | null = null;
  private sub: Sock | null = null;
  private pubReady = false;
  private queue: string[] = [];
  private backoffMs = 1000;
  private stopped = false;

  constructor(target: RedisTarget, origin: string, onRemote: (env: BusEnvelope) => void) {
    this.target = target;
    this.origin = origin;
    this.onRemote = onRemote;
    this.connect();
  }

  publish(channel: string, event: unknown): void {
    const payload = JSON.stringify({ channel, origin: this.origin, event } satisfies BusEnvelope);
    if (this.pubReady && this.pub) {
      this.pub.write(encodeCommand(['PUBLISH', WIRE_CHANNEL, payload]));
    } else {
      this.queue.push(payload);
      if (this.queue.length > QUEUE_CAP) this.queue.shift(); // 丢最旧,防内存涨
    }
  }

  stop(): void {
    this.stopped = true;
    this.pub?.destroy();
    this.sub?.destroy();
  }

  private dial(): Sock {
    const { host, port } = this.target;
    const sock: Sock = this.target.tls ? tls.connect({ host, port }) : net.connect({ host, port });
    sock.unref?.(); // 不阻止进程退出
    return sock;
  }

  private connect(): void {
    if (this.stopped) return;

    // ── 发布连接 ──
    const pub = this.dial();
    this.pub = pub;
    pub.on('connect', () => {
      if (this.target.password) pub.write(encodeCommand(['AUTH', this.target.password]));
      this.pubReady = true;
      this.backoffMs = 1000;
      for (const p of this.queue.splice(0)) pub.write(encodeCommand(['PUBLISH', WIRE_CHANNEL, p]));
      console.log(`[event-bus] Redis 桥已连接 ${this.target.host}:${this.target.port}(origin=${this.origin})`);
    });
    pub.on('data', () => { /* PUBLISH/AUTH 回执不关心 */ });
    pub.on('error', () => { /* close 统一处理 */ });
    pub.on('close', () => { this.pubReady = false; this.scheduleReconnect(); });

    // ── 订阅连接(Redis 规定订阅态连接不能再发普通命令 → 独立 socket)──
    const sub = this.dial();
    this.sub = sub;
    const reader = new RespReader();
    sub.on('connect', () => {
      if (this.target.password) sub.write(encodeCommand(['AUTH', this.target.password]));
      sub.write(encodeCommand(['SUBSCRIBE', WIRE_CHANNEL]));
    });
    sub.on('data', (chunk: Buffer) => {
      for (const v of reader.feed(chunk)) {
        if (!Array.isArray(v) || v[0] !== 'message' || typeof v[2] !== 'string') continue;
        try {
          const env = JSON.parse(v[2]);
          if (shouldDeliver(env, this.origin)) this.onRemote(env);
        } catch { /* 坏帧跳过 */ }
      }
    });
    sub.on('error', () => { /* close 统一处理 */ });
    sub.on('close', () => this.scheduleReconnect());
  }

  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private scheduleReconnect(): void {
    if (this.stopped || this.reconnectTimer) return;
    const delay = this.backoffMs;
    this.backoffMs = Math.min(this.backoffMs * 2, 30_000);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.pub?.destroy();
      this.sub?.destroy();
      this.connect();
    }, delay);
    (this.reconnectTimer as { unref?: () => void }).unref?.();
  }
}

/** 入口:REDIS_URL 不合法返回 null(调用方降级进程内)。 */
export function startRedisBus(
  url: string,
  origin: string,
  onRemote: (env: BusEnvelope) => void,
): RedisBusClient | null {
  const target = parseRedisUrl(url);
  if (!target) {
    console.warn(`[event-bus] REDIS_URL 无法解析(${url.slice(0, 30)}…)—— 降级进程内总线`);
    return null;
  }
  return new RedisBusClient(target, origin, onRemote);
}
