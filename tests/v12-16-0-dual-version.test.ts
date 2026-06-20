/**
 * v12.16.0(Phase 3)— 双版本重构图滤镜 + CONTINUITY 主表。
 */
import { describe, it, expect } from 'vitest';
import { buildReframeFilterComplex, dimsForAspect } from '@/lib/video-reframe';
import { buildContinuitySheet, validateContinuity } from '@/lib/continuity-sheet';

describe('v12.16.0 · 双版本重构图滤镜', () => {
  it('dimsForAspect:竖屏 720x1280 / 横屏 1280x720 / 方 1024', () => {
    expect(dimsForAspect('9:16')).toEqual({ w: 720, h: 1280 });
    expect(dimsForAspect('16:9')).toEqual({ w: 1280, h: 720 });
    expect(dimsForAspect('1:1')).toEqual({ w: 1024, h: 1024 });
  });
  it('blur-pad:背景模糊 + 前景缩入 + 居中叠加', () => {
    const { filter, w, h } = buildReframeFilterComplex('16:9', 'blur-pad');
    expect(w).toBe(1280); expect(h).toBe(720);
    expect(filter).toContain('gblur=sigma=20');
    expect(filter).toContain('overlay=(W-w)/2:(H-h)/2');
    expect(filter).toMatch(/\[vout\]$/);
  });
  it('crop:放大裁满,无模糊背景', () => {
    const { filter } = buildReframeFilterComplex('9:16', 'crop');
    expect(filter).toContain('crop=720:1280');
    expect(filter).not.toContain('gblur');
  });
});

describe('v12.16.0 · CONTINUITY 主表', () => {
  const shots = [
    { shotNumber: 1, sceneDescription: '锈蚀铁笼格斗台', lightingIntent: '冷调侧逆硬光' },
    { shotNumber: 2, sceneDescription: '锈蚀铁笼格斗台（延续）', lightingIntent: '冷调侧逆硬光' },
    { shotNumber: 3, sceneDescription: '锈蚀铁笼格斗台', lightingIntent: '暖调顺光' }, // 同场景光照漂移
  ];

  it('buildContinuitySheet:镜号补零、场景归一、全局画幅/帧率/风格', () => {
    const rows = buildContinuitySheet({ shots, stylePack: 'gritty 动作电影', aspectRatio: '9:16', fps: 60 });
    expect(rows[0].shotId).toBe('S01');
    expect(rows[0].scene).toBe('锈蚀铁笼格斗台');
    expect(rows[1].scene).toBe('锈蚀铁笼格斗台'); // 「（延续）」被归一
    expect(rows[0].aspectRatio).toBe('9:16');
    expect(rows[0].fps).toBe(60);
    expect(rows[0].stylePack).toBe('gritty 动作电影');
  });

  it('validateContinuity:抓同场景光照漂移', () => {
    const rows = buildContinuitySheet({ shots, stylePack: 'x', aspectRatio: '9:16' });
    const v = validateContinuity(rows);
    expect(v.passed).toBe(false);
    expect(v.issues.some((i) => i.includes('光照不一致'))).toBe(true);
  });

  it('validateContinuity:风格包空 → 报缺锚点;一致则通过', () => {
    const ok = buildContinuitySheet({ shots: [shots[0], shots[1]], stylePack: 'x', aspectRatio: '9:16' });
    expect(validateContinuity(ok).passed).toBe(true);
    const noStyle = buildContinuitySheet({ shots: [shots[0]], stylePack: '', aspectRatio: '9:16' });
    expect(validateContinuity(noStyle).issues.some((i) => i.includes('StylePack'))).toBe(true);
  });
});
