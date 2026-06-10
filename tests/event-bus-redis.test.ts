/**
 * v10.4.5 — Redis 事件桥纯函数单测。
 * 覆盖:RESP 命令编码、解析器(粘包/半包/多帧/含 CRLF 的 bulk)、
 * REDIS_URL 解析(默认端口/密码/TLS/坏值)、信封防自回环。
 * 真 Redis 双进程互通由发版验收脚本覆盖(见 VERSIONS v10.4.5 实录)。
 */
import { describe, it, expect } from 'vitest';
import { encodeCommand, RespReader, parseRedisUrl, shouldDeliver } from '@/lib/event-bus-redis';

describe('v10.4.5 · encodeCommand', () => {
  it('RESP 数组 of bulk strings(含 UTF-8 字节长)', () => {
    expect(encodeCommand(['PING']).toString()).toBe('*1\r\n$4\r\nPING\r\n');
    // 中文按字节算长度
    expect(encodeCommand(['PUBLISH', 'ch', '你好']).toString())
      .toBe('*3\r\n$7\r\nPUBLISH\r\n$2\r\nch\r\n$6\r\n你好\r\n');
  });
});

describe('v10.4.5 · RespReader', () => {
  it('单帧:simple/int/bulk/array', () => {
    const r = new RespReader();
    expect(r.feed(Buffer.from('+OK\r\n'))).toEqual(['OK']);
    expect(r.feed(Buffer.from(':42\r\n'))).toEqual([42]);
    expect(r.feed(Buffer.from('$5\r\nhello\r\n'))).toEqual(['hello']);
    expect(r.feed(Buffer.from('*3\r\n$7\r\nmessage\r\n$8\r\nqfmj-bus\r\n$2\r\nhi\r\n')))
      .toEqual([['message', 'qfmj-bus', 'hi']]);
  });

  it('错误帧 → Error 值;$-1/*-1 → null', () => {
    const r = new RespReader();
    const [err] = r.feed(Buffer.from('-ERR boom\r\n'));
    expect(err).toBeInstanceOf(Error);
    expect(r.feed(Buffer.from('$-1\r\n'))).toEqual([null]);
    expect(r.feed(Buffer.from('*-1\r\n'))).toEqual([null]);
  });

  it('半包:bulk 体跨 chunk 到齐才出帧', () => {
    const r = new RespReader();
    expect(r.feed(Buffer.from('$10\r\nhello'))).toEqual([]); // 体未到齐
    expect(r.feed(Buffer.from('world\r\n'))).toEqual(['helloworld']);
  });

  it('粘包:一个 chunk 多帧全部吐出;数组子元素跨 chunk', () => {
    const r = new RespReader();
    expect(r.feed(Buffer.from('+A\r\n:1\r\n+B\r\n'))).toEqual(['A', 1, 'B']);
    expect(r.feed(Buffer.from('*2\r\n$1\r\na\r\n'))).toEqual([]); // 数组差一个元素
    expect(r.feed(Buffer.from('$1\r\nb\r\n'))).toEqual([['a', 'b']]);
  });

  it('bulk 内含 \\r\\n 不截断(按长度读)', () => {
    const r = new RespReader();
    expect(r.feed(Buffer.from('$9\r\na\r\nb\r\nc12\r\n'))).toEqual(['a\r\nb\r\nc12']);
  });
});

describe('v10.4.5 · parseRedisUrl', () => {
  it('默认端口 6379 / 显式端口 / 密码解码 / TLS 标记', () => {
    expect(parseRedisUrl('redis://localhost')).toEqual({ host: 'localhost', port: 6379, password: undefined, tls: false });
    expect(parseRedisUrl('redis://:p%40ss@10.0.0.5:6390')).toEqual({ host: '10.0.0.5', port: 6390, password: 'p@ss', tls: false });
    expect(parseRedisUrl('rediss://cache.example.com')).toMatchObject({ tls: true, port: 6379 });
  });
  it('非 redis 协议 / 垃圾输入 → null', () => {
    expect(parseRedisUrl('http://x')).toBeNull();
    expect(parseRedisUrl('not a url')).toBeNull();
  });
});

describe('v10.4.5 · shouldDeliver(防自回环)', () => {
  it('他源投递、自源跳过、坏信封拒收', () => {
    expect(shouldDeliver({ channel: 'c', origin: 'other', event: {} }, 'self')).toBe(true);
    expect(shouldDeliver({ channel: 'c', origin: 'self', event: {} }, 'self')).toBe(false);
    expect(shouldDeliver({ origin: 'other' }, 'self')).toBe(false);
    expect(shouldDeliver(null, 'self')).toBe(false);
  });
});
