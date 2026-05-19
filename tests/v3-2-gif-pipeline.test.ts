/**
 * v3.2 P3.3 — GIF pipeline pure-function fuzz tests.
 *
 * 覆盖:
 *   - validateFrames 在所有 broken input 上给可读 error
 *   - buildConcatList 拒绝 path 含单引号 / 空 list / 非数 duration
 *   - paletteGen/UseArgs clamp fps / width 到合理区间
 *   - paletteUseArgs dither spec mapping
 *
 * "fuzz" 风格: 同一个函数喂 N 种异常 input, 不放过任何沉默错误.
 */

import { describe, it, expect } from 'vitest';
import {
  validateFrames,
  buildConcatList,
  paletteGenArgs,
  paletteUseArgs,
} from '@/lib/gif-pipeline';

const mkBuf = (len = 16) => {
  const b = new Uint8Array(len);
  for (let i = 0; i < len; i++) b[i] = i & 0xff;
  return b;
};

// ─── validateFrames ────────────────────────────────────────────────────────

describe('v3.2 P3.3 · validateFrames — broken inputs', () => {
  it('accepts a minimal valid frame list', () => {
    expect(() => validateFrames([{ buffer: mkBuf() }])).not.toThrow();
    expect(() => validateFrames([
      { buffer: mkBuf(), durationMs: 100 },
      { buffer: mkBuf(), durationMs: 200 },
    ])).not.toThrow();
  });

  it('rejects non-array input', () => {
    expect(() => validateFrames(undefined as any)).toThrow(/not an array/);
    expect(() => validateFrames(null as any)).toThrow(/not an array/);
    expect(() => validateFrames('frames' as any)).toThrow(/not an array/);
    expect(() => validateFrames({ length: 1 } as any)).toThrow(/not an array/);
  });

  it('rejects empty array (0 frames)', () => {
    expect(() => validateFrames([])).toThrow(/zero frames/);
  });

  it('rejects runaway capture (>10000 frames)', () => {
    const lots = Array(10_001).fill({ buffer: mkBuf() });
    expect(() => validateFrames(lots)).toThrow(/too many frames/);
  });

  it('rejects non-object frame', () => {
    expect(() => validateFrames([null] as any)).toThrow(/not an object/);
    expect(() => validateFrames(['hi' as any])).toThrow(/not an object/);
  });

  it('rejects missing buffer', () => {
    expect(() => validateFrames([{ durationMs: 100 } as any])).toThrow(/missing buffer/);
  });

  it('rejects non-Buffer/Uint8Array buffer', () => {
    expect(() => validateFrames([{ buffer: 'not a buffer' as any }])).toThrow(/not Buffer/);
    expect(() => validateFrames([{ buffer: 42 as any }])).toThrow(/not Buffer/);
    expect(() => validateFrames([{ buffer: { 0: 1 } as any }])).toThrow(/not Buffer/);
  });

  it('rejects empty buffer (0 bytes)', () => {
    expect(() => validateFrames([{ buffer: new Uint8Array(0) }])).toThrow(/0 bytes/);
  });

  it('rejects bad durationMs', () => {
    expect(() => validateFrames([{ buffer: mkBuf(), durationMs: -10 }])).toThrow(/must be > 0/);
    expect(() => validateFrames([{ buffer: mkBuf(), durationMs: 0 }])).toThrow(/must be > 0/);
    expect(() => validateFrames([{ buffer: mkBuf(), durationMs: NaN }])).toThrow(/not finite/);
    expect(() => validateFrames([{ buffer: mkBuf(), durationMs: Infinity }])).toThrow(/not finite/);
    expect(() => validateFrames([{ buffer: mkBuf(), durationMs: 99_999 }])).toThrow(/> 60s/);
    expect(() => validateFrames([{ buffer: mkBuf(), durationMs: 'fast' as any }])).toThrow(/not finite/);
  });

  it('omitted durationMs is OK (uses default in caller)', () => {
    expect(() => validateFrames([{ buffer: mkBuf() }])).not.toThrow();
    expect(() => validateFrames([{ buffer: mkBuf(), durationMs: undefined }])).not.toThrow();
  });
});

// ─── buildConcatList ──────────────────────────────────────────────────────

describe('v3.2 P3.3 · buildConcatList', () => {
  it('emits paired file/duration lines + trailing repeat', () => {
    const list = buildConcatList([
      { path: '/tmp/a.png', durationSec: 0.1 },
      { path: '/tmp/b.png', durationSec: 0.2 },
    ]);
    const lines = list.split('\n');
    expect(lines).toContain("file '/tmp/a.png'");
    expect(lines).toContain('duration 0.100');
    expect(lines).toContain("file '/tmp/b.png'");
    expect(lines).toContain('duration 0.200');
    // 最后一行 file 必须重复最后一帧
    expect(lines[lines.length - 1]).toBe("file '/tmp/b.png'");
  });

  it('rejects empty list', () => {
    expect(() => buildConcatList([])).toThrow(/empty/);
  });

  it('rejects entry without path', () => {
    expect(() => buildConcatList([{ path: '', durationSec: 0.1 }])).toThrow(/missing path/);
    expect(() => buildConcatList([{ path: undefined as any, durationSec: 0.1 }])).toThrow(/missing path/);
  });

  it('rejects path containing single quote (would break concat syntax)', () => {
    expect(() => buildConcatList([
      { path: "/tmp/it's-bad.png", durationSec: 0.1 },
    ])).toThrow(/single quote/);
  });

  it('rejects non-finite / <=0 durationSec', () => {
    expect(() => buildConcatList([
      { path: '/tmp/a.png', durationSec: 0 },
    ])).toThrow(/invalid durationSec/);
    expect(() => buildConcatList([
      { path: '/tmp/a.png', durationSec: -1 },
    ])).toThrow(/invalid durationSec/);
    expect(() => buildConcatList([
      { path: '/tmp/a.png', durationSec: NaN },
    ])).toThrow(/invalid durationSec/);
    expect(() => buildConcatList([
      { path: '/tmp/a.png', durationSec: Infinity },
    ])).toThrow(/invalid durationSec/);
  });

  it('handles 1 frame correctly (file written 2x)', () => {
    const list = buildConcatList([{ path: '/tmp/a.png', durationSec: 0.5 }]);
    const lines = list.split('\n').filter((l) => l.startsWith('file'));
    expect(lines).toHaveLength(2);
  });
});

// ─── paletteGenArgs / paletteUseArgs ──────────────────────────────────────

describe('v3.2 P3.3 · paletteGenArgs / paletteUseArgs', () => {
  it('paletteGen has default fps=10 width=960', () => {
    const args = paletteGenArgs('/t/list.txt', '/t/p.png');
    const vfIdx = args.indexOf('-vf');
    expect(args[vfIdx + 1]).toContain('fps=10');
    expect(args[vfIdx + 1]).toContain('scale=960:-1');
    expect(args[args.length - 1]).toBe('/t/p.png');
  });

  it('paletteGen clamps insane fps to [1, 60]', () => {
    expect(paletteGenArgs('/t/l', '/t/p', { fps: 0 }).join(' ')).toContain('fps=1');
    expect(paletteGenArgs('/t/l', '/t/p', { fps: 999 }).join(' ')).toContain('fps=60');
    expect(paletteGenArgs('/t/l', '/t/p', { fps: -5 }).join(' ')).toContain('fps=1');
  });

  it('paletteGen clamps insane width to [64, 4096]', () => {
    expect(paletteGenArgs('/t/l', '/t/p', { width: 10 }).join(' ')).toContain('scale=64:');
    expect(paletteGenArgs('/t/l', '/t/p', { width: 99_999 }).join(' ')).toContain('scale=4096:');
  });

  it('paletteUse default dither = bayer:bayer_scale=5', () => {
    const args = paletteUseArgs('/t/l', '/t/p', '/t/out.gif');
    const fcIdx = args.indexOf('-filter_complex');
    expect(args[fcIdx + 1]).toContain('paletteuse=dither=bayer:bayer_scale=5');
  });

  it('paletteUse accepts sierra2 / none dither', () => {
    const sierra = paletteUseArgs('/t/l', '/t/p', '/t/out.gif', { dither: 'sierra2' });
    expect(sierra.join(' ')).toContain('paletteuse=dither=sierra2');
    const none = paletteUseArgs('/t/l', '/t/p', '/t/out.gif', { dither: 'none' });
    expect(none.join(' ')).toContain('paletteuse=dither=none');
  });

  it('paletteUse rejects unknown dither by falling back to bayer', () => {
    const args = paletteUseArgs('/t/l', '/t/p', '/t/out.gif', { dither: 'rainbow' as any });
    expect(args.join(' ')).toContain('paletteuse=dither=bayer:bayer_scale=5');
  });

  it('paletteUse always sets -loop 0 (infinite loop GIF)', () => {
    const args = paletteUseArgs('/t/l', '/t/p', '/t/out.gif');
    const loopIdx = args.indexOf('-loop');
    expect(loopIdx).toBeGreaterThanOrEqual(0);
    expect(args[loopIdx + 1]).toBe('0');
  });

  it('paletteUse outFile is the last arg (ffmpeg convention)', () => {
    const args = paletteUseArgs('/t/l', '/t/p', '/tmp/output.gif');
    expect(args[args.length - 1]).toBe('/tmp/output.gif');
  });
});
