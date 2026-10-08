/**
 * v7.4 — 结构化光影 + 摄影机/镜头模拟 (ShotSpec 扩展) + 项目级格式预设 单测
 */

import { describe, it, expect } from 'vitest';
import {
  LIGHTING_SETUPS, CONTRAST_LEVELS, COLOR_TEMPS, CAMERA_BODIES, LENS_SERIES,
  T_STOPS, ISO_OPTIONS, ND_OPTIONS, WB_PRESETS, DEFAULT_LIGHTING, DEFAULT_CAMERA,
  DEFAULT_SHOT_SPEC, normalizeShotSpec, compileShotSpecToPrompt, describeShotSpec,
  colorTempWord, getLightingSetup,
} from '@/lib/cinematography';
import {
  COLOR_SPACES, FRAME_RATES, DEFAULT_PROJECT_FORMAT,
  normalizeProjectFormat, withColorSpaceClause, describeFormat,
} from '@/lib/project-format';

describe('v7.4 光影/摄影机 预设', () => {
  it('光影 setups / 摄影机机身 / 镜头系列 非空且 id 唯一', () => {
    for (const list of [LIGHTING_SETUPS, CAMERA_BODIES, LENS_SERIES]) {
      const ids = list.map((p) => p.id);
      expect(new Set(ids).size).toBe(ids.length);
      expect(list.length).toBeGreaterThan(0);
    }
    expect(CONTRAST_LEVELS).toHaveLength(3);
    expect(COLOR_TEMPS.length).toBeGreaterThanOrEqual(5);
  });
  it('colorTempWord 取最近预设', () => {
    expect(colorTempWord(2800)).toContain('warm');
    expect(colorTempWord(6500)).toContain('cold');
    expect(colorTempWord(5500)).toContain('daylight'); // 最近 5600
  });
});

describe('ShotSpec 向后兼容 (含 lighting/camera)', () => {
  it('DEFAULT_SHOT_SPEC 含 lighting + camera', () => {
    expect(DEFAULT_SHOT_SPEC.lighting).toEqual(DEFAULT_LIGHTING);
    expect(DEFAULT_SHOT_SPEC.camera).toEqual(DEFAULT_CAMERA);
  });
  it('旧 spec (无 lighting/camera) normalize → 补默认, 不破坏既有字段', () => {
    const out = normalizeShotSpec({ shotSize: 'CU', angle: 'low' });
    expect(out.shotSize).toBe('CU');
    expect(out.lighting).toEqual(DEFAULT_LIGHTING);
    expect(out.camera).toEqual(DEFAULT_CAMERA);
  });
  it('非法 lighting/camera 字段逐项回落', () => {
    const out = normalizeShotSpec({ lighting: { setup: 'NOPE', keyTempK: 9999, contrast: 'X' }, camera: { body: 'NOPE', tStop: 99, iso: 7, nd: 'zz', wb: 1 } });
    expect(out.lighting.setup).toBe(DEFAULT_LIGHTING.setup);
    expect(out.lighting.keyTempK).toBe(DEFAULT_LIGHTING.keyTempK);
    expect(out.camera.body).toBe(DEFAULT_CAMERA.body);
    expect(out.camera.tStop).toBe(DEFAULT_CAMERA.tStop);
    expect(out.camera.nd).toBe('none');
  });
  it('合法 lighting/camera 保留', () => {
    const out = normalizeShotSpec({ lighting: { setup: 'low-key', keyTempK: 3200, contrast: 'high' }, camera: { body: 'alexa65', lensSeries: 'panavision-c', tStop: 1.4, iso: 1600, nd: '0.6', wb: 3200 } });
    expect(out.lighting).toEqual({ setup: 'low-key', keyTempK: 3200, contrast: 'high' });
    expect(out.camera).toEqual({ body: 'alexa65', lensSeries: 'panavision-c', tStop: 1.4, iso: 1600, nd: '0.6', wb: 3200 });
  });
});

describe('compileShotSpecToPrompt 含光影 + 摄影机', () => {
  it('低调 + Alexa65 + Panavision → 片段含对应描述', () => {
    const out = compileShotSpecToPrompt(normalizeShotSpec({
      lighting: { setup: 'low-key', keyTempK: 3200, contrast: 'high' },
      camera: { body: 'alexa65', lensSeries: 'panavision-c', tStop: 1.4, iso: 800, nd: '0.6', wb: 3200 },
    }));
    expect(out).toContain('low-key');
    expect(out).toContain('warm tungsten'); // 3200K
    expect(out).toContain('high contrast');
    expect(out).toContain('Alexa 65');
    expect(out).toContain('anamorphic');
    expect(out).toContain('T-stop 1.4');
    expect(out).toContain('ISO 800');
    expect(out).toContain('ND 0.6');
  });
  it('ND=none 不出现 ND 段; 中反差不产生空段', () => {
    const out = compileShotSpecToPrompt(DEFAULT_SHOT_SPEC);
    expect(out).not.toContain('ND none');
    expect(out).not.toContain(', ,');
  });
});

describe('describeShotSpec 含光影 (非自然时)', () => {
  it('low-key → 摘要含 低调; natural → 不含光影标', () => {
    expect(describeShotSpec(normalizeShotSpec({ lighting: { setup: 'low-key', keyTempK: 5600, contrast: 'medium' } }))).toContain(getLightingSetup('low-key')!.short);
    expect(describeShotSpec(DEFAULT_SHOT_SPEC)).not.toContain('自然');
  });
});

describe('lib/project-format', () => {
  // v12.464:画幅预设(FORMAT_PRESETS / aspectId / aspectRatioOf)已删 —— 没有任何生成代码读它,
  // 项目画幅只有 projects.aspect 一处(见 tests/v12-464-format-bar-aspect)。
  it('预设非空 + 帧率含 24/120', () => {
    expect(COLOR_SPACES.some((c) => c.id === 'aces')).toBe(true);
    expect(FRAME_RATES).toContain(24);
    expect(FRAME_RATES).toContain(120);
  });
  // v12.466:色彩接进出图、安全框接上叠层之后,默认值改为「不指定 / 关」—— 没保存过格式的项目出图与预览不变
  it('默认: 不指定色彩 + 24fps + 安全框关', () => {
    expect(DEFAULT_PROJECT_FORMAT).toEqual({ colorSpaceId: 'none', fps: 24, safeArea: false });
  });
  it('normalize 非法回落 / 合法保留', () => {
    expect(normalizeProjectFormat(null)).toEqual(DEFAULT_PROJECT_FORMAT);
    const out = normalizeProjectFormat({ colorSpaceId: 'NOPE', fps: 999, safeArea: false });
    expect(out.colorSpaceId).toBe('none'); // 回落
    expect(out.fps).toBe(24);
    expect(out.safeArea).toBe(false);
  });
  // v12.466:compileFormatPrompt(全仓零调用,且往静帧里写帧率)换成只管色彩的 withColorSpaceClause
  it('withColorSpaceClause + describeFormat', () => {
    const f = { colorSpaceId: 'aces', fps: 120, safeArea: true };
    const p = withColorSpaceClause('a hero', f.colorSpaceId);
    expect(p).toContain('ACES');
    expect(p).not.toContain('fps');
    expect(describeFormat(f)).toContain('ACES 1.3');
    expect(describeFormat(f)).toContain('120fps');
  });
});
