/**
 * v7.3 — lib/continuity 单测 (连贯性 + 种子锁)
 *
 * 锁住确定性内核: 安全解析 / 种子派生(锁定全链路复用、未锁可复现) / 生成指令编译 / 连贯性 chips。
 */

import { describe, it, expect } from 'vitest';
import {
  LINK_MODES, FACEID_STRENGTHS, SEED_MAX,
  generateSeed, defaultContinuitySettings, normalizeContinuitySettings,
  faceIdWeight, seedForShot, compileContinuityDirectives, computeContinuityTags, describeContinuity,
  type ContinuitySettings,
} from '@/lib/continuity';

describe('预设', () => {
  it('LINK_MODES 三种 + id 唯一', () => {
    expect(LINK_MODES.map((m) => m.id)).toEqual(['hard-cut', 'match-cut', 'last-frame']);
    expect(LINK_MODES.every((m) => m.label && m.prompt)).toBe(true);
  });
  it('FACEID_STRENGTHS 四档, weight 递增', () => {
    expect(FACEID_STRENGTHS.map((f) => f.id)).toEqual(['off', 'low', 'medium', 'high']);
    expect(FACEID_STRENGTHS.map((f) => f.weight)).toEqual([0, 0.3, 0.6, 0.9]);
  });
});

describe('generateSeed / default', () => {
  it('种子在 [0, SEED_MAX)', () => {
    for (let i = 0; i < 20; i++) {
      const s = generateSeed();
      expect(s).toBeGreaterThanOrEqual(0);
      expect(s).toBeLessThan(SEED_MAX);
      expect(Number.isInteger(s)).toBe(true);
    }
  });
  it('默认: 锁种子 / match-cut / 强度 0.6 / 服装+光照锁 / FaceID high', () => {
    const d = defaultContinuitySettings();
    expect(d.seedLocked).toBe(true);
    expect(d.linkMode).toBe('match-cut');
    expect(d.continuityStrength).toBe(0.6);
    expect(d.clothingLock && d.lightingLock).toBe(true);
    expect(d.faceIdStrength).toBe('high');
  });
});

describe('normalizeContinuitySettings — 安全解析', () => {
  it('空 → 合理默认 (含随机种子)', () => {
    const n = normalizeContinuitySettings(null);
    expect(n.linkMode).toBe('match-cut');
    expect(n.continuityStrength).toBe(0.6);
    expect(n.mainSeed).toBeGreaterThanOrEqual(0);
  });
  it('非法 linkMode / faceId / 强度 → 回落; 合法保留', () => {
    const n = normalizeContinuitySettings({ linkMode: 'NOPE', faceIdStrength: 'X', continuityStrength: 5, mainSeed: 123, seedLocked: false });
    expect(n.linkMode).toBe('match-cut');
    expect(n.faceIdStrength).toBe('high');
    expect(n.continuityStrength).toBe(1); // clamp
    expect(n.mainSeed).toBe(123);
    expect(n.seedLocked).toBe(false);
  });
  it('强度负数 → 0; 小数四舍五入到 2 位', () => {
    expect(normalizeContinuitySettings({ continuityStrength: -1 }).continuityStrength).toBe(0);
    expect(normalizeContinuitySettings({ continuityStrength: 0.666 }).continuityStrength).toBe(0.67);
  });
  it('布尔字段缺省 → true (锁优先)', () => {
    const n = normalizeContinuitySettings({});
    expect(n.clothingLock).toBe(true);
    expect(n.lightingLock).toBe(true);
    expect(n.seedLocked).toBe(true);
  });
});

describe('seedForShot', () => {
  const base: ContinuitySettings = { ...defaultContinuitySettings(), mainSeed: 1000, seedLocked: true };
  it('锁定 → 所有镜复用主种子', () => {
    expect(seedForShot(base, 0)).toBe(1000);
    expect(seedForShot(base, 5)).toBe(1000);
  });
  it('未锁 → 每镜不同但可复现 (主种子 + 镜号*质数)', () => {
    const unlocked = { ...base, seedLocked: false };
    expect(seedForShot(unlocked, 0)).toBe(1000);
    expect(seedForShot(unlocked, 1)).toBe(1000 + 7919);
    expect(seedForShot(unlocked, 1)).toBe(seedForShot(unlocked, 1)); // 可复现
    expect(seedForShot(unlocked, 2)).not.toBe(seedForShot(unlocked, 1));
  });
});

describe('compileContinuityDirectives', () => {
  it('首镜跳过 link-mode 衔接语; 含 FaceID/服装/光照', () => {
    const d = compileContinuityDirectives(defaultContinuitySettings(), { shotIndex: 0, isFirstShot: true });
    expect(d.prompt).toContain('FaceID');
    expect(d.prompt).toContain('wardrobe');
    expect(d.prompt).toContain('lighting');
    expect(d.prompt).not.toContain('match cut'); // 首镜无上一镜
  });
  it('非首镜 match-cut → 含匹配切衔接语 + seed/faceWeight', () => {
    const s: ContinuitySettings = { ...defaultContinuitySettings(), mainSeed: 777, seedLocked: true };
    const d = compileContinuityDirectives(s, { shotIndex: 2, isFirstShot: false });
    expect(d.prompt.toLowerCase()).toContain('match cut');
    expect(d.seed).toBe(777);
    expect(d.faceWeight).toBe(0.9);
  });
  it('hard-cut 不产生衔接语; faceId off → 无身份约束', () => {
    const s: ContinuitySettings = { ...defaultContinuitySettings(), linkMode: 'hard-cut', faceIdStrength: 'off' };
    const d = compileContinuityDirectives(s, { shotIndex: 1, isFirstShot: false });
    expect(d.prompt).not.toContain('cut');
    expect(d.prompt).not.toContain('FaceID');
    expect(d.faceWeight).toBe(0);
  });
  it('强度极值 → 严格 / 宽松语', () => {
    expect(compileContinuityDirectives({ ...defaultContinuitySettings(), continuityStrength: 0.9 }, { isFirstShot: true }).prompt).toContain('strict');
    expect(compileContinuityDirectives({ ...defaultContinuitySettings(), continuityStrength: 0.2 }, { isFirstShot: true }).prompt).toContain('loose');
  });
});

describe('computeContinuityTags', () => {
  it('全锁 + 有角色/环境 + 非首镜 → 多 chips', () => {
    const tags = computeContinuityTags(defaultContinuitySettings(), { hasCharacter: true, hasEnvironment: true, isFirstShot: false });
    const ids = tags.map((t) => t.id);
    expect(ids).toContain('character');
    expect(ids).toContain('clothing');
    expect(ids).toContain('environment');
    expect(ids).toContain('lighting');
    expect(ids).toContain('time');
    expect(ids).toContain('seed');
  });
  it('首镜 → 无"动作/帧级连续" chip', () => {
    const tags = computeContinuityTags(defaultContinuitySettings(), { hasCharacter: true, isFirstShot: true });
    expect(tags.map((t) => t.id)).not.toContain('time');
  });
  it('last-frame → 帧级连续 标签', () => {
    const tags = computeContinuityTags({ ...defaultContinuitySettings(), linkMode: 'last-frame' }, { isFirstShot: false });
    expect(tags.find((t) => t.id === 'time')?.label).toBe('帧级连续');
  });
  it('faceId off → 无角色锁定 chip', () => {
    const tags = computeContinuityTags({ ...defaultContinuitySettings(), faceIdStrength: 'off' }, { hasCharacter: true });
    expect(tags.map((t) => t.id)).not.toContain('character');
  });
});

describe('describeContinuity', () => {
  it('含链接模式 + 强度 + 种子锁 + FaceID', () => {
    const out = describeContinuity({ ...defaultContinuitySettings(), mainSeed: 42, seedLocked: true });
    expect(out).toContain('匹配切');
    expect(out).toContain('强度 0.6');
    expect(out).toContain('#42');
    expect(out).toContain('FaceID 高');
  });
});
