/**
 * v3.5 — 字幕烧录预设单测.
 */

import { describe, it, expect } from 'vitest';
import {
  getSubtitleStyle,
  getSubtitleStyleWithOverrides,
  styleToForceStyle,
  escapeSubtitlePath,
  buildSubtitlesFilter,
  listSubtitlePlatforms,
} from '@/lib/subtitle-burn';

describe('v3.5 · getSubtitleStyle', () => {
  it('returns platform preset', () => {
    const douyin = getSubtitleStyle('douyin');
    expect(douyin.fontSize).toBe(56);
    expect(douyin.bold).toBe(-1);
    expect(douyin.alignment).toBe(2);
  });

  it('unknown platform falls back to default', () => {
    expect(getSubtitleStyle('myspace')).toEqual(getSubtitleStyle('default'));
  });

  it('returns a copy (mutation safe)', () => {
    const a = getSubtitleStyle('douyin');
    a.fontSize = 999;
    const b = getSubtitleStyle('douyin');
    expect(b.fontSize).toBe(56);
  });

  it('all platforms have distinct, valid styles', () => {
    for (const p of listSubtitlePlatforms()) {
      const s = getSubtitleStyle(p);
      expect(s.fontSize).toBeGreaterThan(0);
      expect(s.outline).toBeGreaterThanOrEqual(0);
      expect(s.primaryColour).toMatch(/^&H[0-9A-F]{8}$/);
    }
  });
});

describe('v3.5 · getSubtitleStyleWithOverrides', () => {
  it('merges overrides on top of preset', () => {
    const s = getSubtitleStyleWithOverrides('douyin', { fontSize: 72, marginV: 200 });
    expect(s.fontSize).toBe(72);
    expect(s.marginV).toBe(200);
    expect(s.bold).toBe(-1); // unchanged from douyin preset
  });
});

describe('v3.5 · styleToForceStyle', () => {
  it('serializes to ASS force_style K=V pairs', () => {
    const fs = styleToForceStyle(getSubtitleStyle('youtube'));
    expect(fs).toContain('FontName=Arial');
    expect(fs).toContain('FontSize=44');
    expect(fs).toContain('Outline=3');
    expect(fs).toContain('Alignment=2');
    expect(fs.split(',').length).toBe(9);
  });
});

describe('v3.5 · escapeSubtitlePath', () => {
  it('escapes colon (windows drive) and quote', () => {
    expect(escapeSubtitlePath('C:/sub.srt')).toBe('C\\:/sub.srt');
    expect(escapeSubtitlePath("/tmp/it's.srt")).toContain("\\'");
  });
  it('escapes backslash first (no double-escape mangling)', () => {
    const out = escapeSubtitlePath('a\\b');
    expect(out).toBe('a\\\\b');
  });
  it('leaves plain unix path mostly intact', () => {
    expect(escapeSubtitlePath('/tmp/sub.srt')).toBe('/tmp/sub.srt');
  });
});

describe('v3.5 · buildSubtitlesFilter', () => {
  it('builds full subtitles= filter with force_style', () => {
    const f = buildSubtitlesFilter('/tmp/a.srt', 'douyin');
    expect(f).toContain("subtitles='/tmp/a.srt'");
    expect(f).toContain('force_style=');
    expect(f).toContain('FontSize=56');
  });

  it('applies overrides', () => {
    const f = buildSubtitlesFilter('/tmp/a.srt', 'douyin', { fontSize: 90 });
    expect(f).toContain('FontSize=90');
  });

  it('escapes path inside filter', () => {
    const f = buildSubtitlesFilter('C:/x.srt', 'default');
    expect(f).toContain("C\\:/x.srt");
  });

  it('throws on empty path', () => {
    expect(() => buildSubtitlesFilter('', 'douyin')).toThrow(/empty/);
  });
});
