/**
 * v4.1.4 — SSE 格式化 / 解析单测 (纯函数).
 */

import { describe, it, expect } from 'vitest';
import { formatSSE, parseSSEChunk } from '@/lib/sse';

describe('v4.1.4 · formatSSE', () => {
  it('formats event + JSON data with trailing blank line', () => {
    const s = formatSSE({ event: 'progress', data: { pct: 42 } });
    expect(s).toBe('event: progress\ndata: {"pct":42}\n\n');
  });
  it('omits event line when not given (default message)', () => {
    expect(formatSSE({ data: { a: 1 } })).toBe('data: {"a":1}\n\n');
  });
  it('passes through string data', () => {
    expect(formatSSE({ event: 'done', data: 'ok' })).toBe('event: done\ndata: ok\n\n');
  });
  it('prefixes each line of multiline data', () => {
    const s = formatSSE({ data: 'line1\nline2' });
    expect(s).toBe('data: line1\ndata: line2\n\n');
  });
});

describe('v4.1.4 · parseSSEChunk', () => {
  it('parses a single complete frame', () => {
    const { events, rest } = parseSSEChunk('event: progress\ndata: {"pct":10}\n\n');
    expect(events).toEqual([{ event: 'progress', data: { pct: 10 } }]);
    expect(rest).toBe('');
  });
  it('parses multiple frames, keeps incomplete tail in rest', () => {
    const buf = 'event: progress\ndata: {"pct":1}\n\nevent: progress\ndata: {"pct":2}\n\nevent: done\ndata: {"v":';
    const { events, rest } = parseSSEChunk(buf);
    expect(events).toHaveLength(2);
    expect(events[1].data).toEqual({ pct: 2 });
    expect(rest).toContain('event: done'); // 未完成帧留回 buffer
  });
  it('defaults event to "message" when no event line', () => {
    const { events } = parseSSEChunk('data: {"x":1}\n\n');
    expect(events[0].event).toBe('message');
  });
  it('keeps raw string when data is not JSON', () => {
    const { events } = parseSSEChunk('event: done\ndata: hello\n\n');
    expect(events[0].data).toBe('hello');
  });
  it('round-trips formatSSE → parseSSEChunk', () => {
    const frame = formatSSE({ event: 'done', data: { videoUrl: 'https://x/v.mp4', model: 'Kling' } });
    const { events } = parseSSEChunk(frame);
    expect(events[0]).toEqual({ event: 'done', data: { videoUrl: 'https://x/v.mp4', model: 'Kling' } });
  });
  it('handles streaming: partial then completing frame across two chunks', () => {
    let buffer = 'event: progress\ndata: {"pct":';
    let r1 = parseSSEChunk(buffer);
    expect(r1.events).toHaveLength(0); // 还没收全
    buffer = r1.rest + '50}\n\n';
    let r2 = parseSSEChunk(buffer);
    expect(r2.events).toEqual([{ event: 'progress', data: { pct: 50 } }]);
  });
});
