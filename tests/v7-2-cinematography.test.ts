/**
 * v7.2 — lib/cinematography 单测 (单镜头电影摄影规格)
 *
 * 锁住: 枚举完整性 / 安全解析(前后兼容) / 历史 cameraAngle 映射 / prompt 编译 / 中文摘要。
 * 这些是"每个分镜的驾驶舱控件"的确定性内核, 必须稳定。
 */

import { describe, it, expect } from 'vitest';
import {
  SHOT_SIZES, CAMERA_ANGLES, LENS_PRESETS, MOVEMENTS, FOCUS_PRESETS, ATMOSPHERES,
  DEFAULT_SHOT_SPEC, normalizeShotSpec, seedSpecFromCameraAngle,
  compileShotSpecToPrompt, describeShotSpec,
  getShotSize, getLens,
  type ShotSpec,
} from '@/lib/cinematography';

describe('预设词表', () => {
  it('六组预设非空且 id 唯一', () => {
    for (const list of [SHOT_SIZES, CAMERA_ANGLES, LENS_PRESETS, MOVEMENTS, FOCUS_PRESETS, ATMOSPHERES]) {
      expect(list.length).toBeGreaterThan(0);
      const ids = list.map((p) => p.id);
      expect(new Set(ids).size).toBe(ids.length);
      expect(list.every((p) => p.label && p.short)).toBe(true);
    }
  });
  it('getters 命中', () => {
    expect(getShotSize('CU')?.label).toBe('特写');
    expect(getLens('anamorphic')?.short).toBe('Anam');
  });
});

describe('normalizeShotSpec — 安全解析', () => {
  it('空/非法 → 全默认, 不抛', () => {
    expect(normalizeShotSpec(null)).toEqual(DEFAULT_SHOT_SPEC);
    expect(normalizeShotSpec({})).toEqual(DEFAULT_SHOT_SPEC);
    expect(normalizeShotSpec('garbage' as any)).toEqual(DEFAULT_SHOT_SPEC);
  });
  it('非法字段逐项回落默认, 合法字段保留', () => {
    const out = normalizeShotSpec({ shotSize: 'CU', angle: 'NOPE', lens: '85', motion: 999 });
    expect(out.shotSize).toBe('CU');
    expect(out.angle).toBe(DEFAULT_SHOT_SPEC.angle); // 非法回落
    expect(out.lens).toBe('85');
    expect(out.motion).toBe(100); // clamp
  });
  it('motion 负数 / 非数字 → clamp/默认', () => {
    expect(normalizeShotSpec({ motion: -5 }).motion).toBe(0);
    expect(normalizeShotSpec({ motion: 'x' }).motion).toBe(DEFAULT_SHOT_SPEC.motion);
    expect(normalizeShotSpec({ motion: 42.6 }).motion).toBe(43);
  });
});

describe('seedSpecFromCameraAngle — 历史中文机位映射', () => {
  it('景别中文 → shotSize', () => {
    expect(seedSpecFromCameraAngle('特写').shotSize).toBe('CU');
    expect(seedSpecFromCameraAngle('远景').shotSize).toBe('WS');
    expect(seedSpecFromCameraAngle('中景').shotSize).toBe('MS');
  });
  it('俯/仰拍 → angle', () => {
    expect(seedSpecFromCameraAngle('俯拍').angle).toBe('high');
    expect(seedSpecFromCameraAngle('仰拍').angle).toBe('low');
  });
  it('跟拍/手持 → movement (+手持提运动)', () => {
    expect(seedSpecFromCameraAngle('跟拍').movement).toBe('dolly');
    const hh = seedSpecFromCameraAngle('手持');
    expect(hh.movement).toBe('handheld');
    expect(hh.motion).toBeGreaterThan(DEFAULT_SHOT_SPEC.motion);
  });
  it('未知/空 → 默认起点', () => {
    expect(seedSpecFromCameraAngle('').shotSize).toBe(DEFAULT_SHOT_SPEC.shotSize);
    expect(seedSpecFromCameraAngle(undefined).angle).toBe(DEFAULT_SHOT_SPEC.angle);
  });
});

describe('compileShotSpecToPrompt', () => {
  it('拼入 景别/机位/镜头/运镜/焦点/氛围 + 运动语', () => {
    const spec: ShotSpec = { shotSize: 'CU', angle: 'low', lens: '85', movement: 'push-in', focus: 'rack', atmosphere: 'rain', motion: 80 };
    const out = compileShotSpecToPrompt(spec);
    expect(out).toContain('close up');
    expect(out).toContain('low angle');
    expect(out).toContain('85mm');
    expect(out).toContain('push-in');
    expect(out).toContain('rack focus');
    expect(out).toContain('heavy rain');
    expect(out).toContain('high motion energy');
  });
  it('atmosphere=clear 不产生空段 (通透 prompt 为空)', () => {
    const out = compileShotSpecToPrompt({ ...DEFAULT_SHOT_SPEC, atmosphere: 'clear' });
    expect(out).not.toContain(', ,');
    expect(out.length).toBeGreaterThan(0);
  });
  it('低运动 → minimal calm motion', () => {
    expect(compileShotSpecToPrompt({ ...DEFAULT_SHOT_SPEC, motion: 10 })).toContain('minimal calm motion');
  });
});

describe('describeShotSpec — 中文摘要', () => {
  it('含景别+机位+镜头+运镜+焦点; clear 氛围不显示', () => {
    const out = describeShotSpec({ shotSize: 'MS', angle: 'eye', lens: '50', movement: 'dolly', focus: 'shallow', atmosphere: 'clear', motion: 35 });
    expect(out).toContain('中景');
    expect(out).toContain('50mm');
    expect(out).toContain('移动');
    expect(out).not.toContain('通透');
  });
  it('非 clear 氛围会拼到末尾', () => {
    expect(describeShotSpec({ ...DEFAULT_SHOT_SPEC, atmosphere: 'neon' })).toContain('霓虹');
  });
});
