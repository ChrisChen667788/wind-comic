/**
 * Tests for v2.14 P0.2 — 镜头语言预设 + enhanceU2VMotionPrompt 的 cameraPreset 参数
 */

import { describe, it, expect } from 'vitest';
import {
  CAMERA_LANGUAGE_PRESETS,
  getCameraPreset,
  enhanceU2VMotionPrompt,
} from '@/lib/prompt-templates';

describe('CAMERA_LANGUAGE_PRESETS', () => {
  it('declares all 12 presets the v2.14 P0.2 spec calls for', () => {
    const ids = CAMERA_LANGUAGE_PRESETS.map((p) => p.id);
    expect(ids).toEqual([
      'push-in', 'pull-out', 'orbit', 'dolly-zoom', 'whip-pan', 'crash-zoom',
      'handheld', 'locked-tripod', 'crane-up', 'tilt-down', 'tracking', 'arc',
    ]);
  });

  it('every preset has id / label / en / desc / prompt', () => {
    for (const p of CAMERA_LANGUAGE_PRESETS) {
      expect(p.id).toMatch(/^[a-z-]+$/);
      expect(p.label.length).toBeGreaterThan(0);
      expect(p.en.length).toBeGreaterThan(0);
      expect(p.desc.length).toBeGreaterThan(0);
      expect(p.prompt).toContain('Camera:');
    }
  });
});

describe('getCameraPreset', () => {
  it('returns preset by id', () => {
    expect(getCameraPreset('orbit')?.label).toBe('环绕');
  });
  it('returns undefined for unknown id', () => {
    expect(getCameraPreset('not-a-real-id')).toBeUndefined();
  });
  it('handles null/undefined/empty gracefully', () => {
    expect(getCameraPreset(undefined)).toBeUndefined();
    expect(getCameraPreset(null)).toBeUndefined();
    expect(getCameraPreset('')).toBeUndefined();
  });
});

describe('enhanceU2VMotionPrompt — cameraPreset integration', () => {
  it('appends preset prompt when user selects a chip', () => {
    const out = enhanceU2VMotionPrompt('人物缓缓抬头', 'dolly-zoom');
    expect(out).toContain('人物缓缓抬头');
    expect(out).toContain('Vertigo'); // dolly-zoom 预设里有 "Vertigo effect"
  });

  it('preset overrides default push-in when no manual camera term in user text', () => {
    const out = enhanceU2VMotionPrompt('人物抬头', 'orbit');
    expect(out).toContain('orbit'); // preset 加了 orbit
    // 默认的 "subtle slow push-in" 不应再出现
    expect(out).not.toContain('subtle slow push-in');
  });

  it('still adds default push-in when no preset and no manual camera term', () => {
    const out = enhanceU2VMotionPrompt('人物抬头');
    expect(out).toContain('subtle slow push-in');
  });

  it('does NOT add default push-in when user already wrote a camera term', () => {
    const out = enhanceU2VMotionPrompt('Slow push-in on the actor');
    // 用户已写 push-in → 不重复添加默认 Camera 行 (只 realism + avoid 兜底行)
    expect((out.match(/Camera:/g) || []).length).toBe(0);
  });

  it('passing unknown preset id falls back to default behavior', () => {
    const out = enhanceU2VMotionPrompt('人物抬头', 'not-a-real-id');
    expect(out).toContain('subtle slow push-in');
  });

  it('always appends realism + anti-artifact guard regardless of preset', () => {
    const withPreset = enhanceU2VMotionPrompt('test', 'whip-pan');
    const withoutPreset = enhanceU2VMotionPrompt('test');
    for (const o of [withPreset, withoutPreset]) {
      expect(o).toContain('photographic realism');
      expect(o).toContain('Avoid');
    }
  });

  it('returns empty string for empty input regardless of preset', () => {
    expect(enhanceU2VMotionPrompt('', 'orbit')).toBe('');
    expect(enhanceU2VMotionPrompt('   ', 'orbit')).toBe('');
  });
});
