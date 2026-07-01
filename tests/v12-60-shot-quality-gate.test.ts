/**
 * v12.60 — 逐镜风格质量门禁(P0-1)纯逻辑:VLM 打分解析 + 过关判定 + 重生补强 hint。
 */
import { describe, it, expect } from 'vitest';
import { parseShotGate, shotGatePass, gateFixHint } from '@/lib/shot-quality-gate';

describe('v12.60 · 逐镜质量门禁纯逻辑', () => {
  it('parseShotGate:合法 JSON → 结构化 + clamp + 字段兜底', () => {
    const s = parseShotGate('{"photoreal":95,"hasBakedText":false,"quality":88,"issues":["a"]}');
    expect(s).toEqual({ photoreal: 95, hasBakedText: false, quality: 88, issues: ['a'] });
    expect(parseShotGate({ photoreal: 120, hasBakedText: 'true' })!.photoreal).toBe(100); // clamp
    expect(parseShotGate({ photoreal: 50 })!.quality).toBe(100); // quality 缺 → 100
    expect(parseShotGate({ photoreal: 50, hasBakedText: 'true' })!.hasBakedText).toBe(true); // 字符串 true
  });

  it('parseShotGate:markdown 包裹/杂文里抠 JSON;非法 → null', () => {
    expect(parseShotGate('```json\n{"photoreal":80}\n```')!.photoreal).toBe(80);
    expect(parseShotGate('评分如下 {"photoreal":60,"quality":70} 完毕')!.photoreal).toBe(60);
    expect(parseShotGate('no json here')).toBeNull();
    expect(parseShotGate({ nope: 1 })).toBeNull();
  });

  it('shotGatePass:3D(photoreal 低)/烤字/低画质分别拦;全好放行', () => {
    const good = { photoreal: 92, hasBakedText: false, quality: 80, issues: [] };
    expect(shotGatePass(good, { requirePhotoreal: true }).pass).toBe(true);
    expect(shotGatePass({ ...good, photoreal: 45 }, { requirePhotoreal: true }).reasons).toContain('3d');
    expect(shotGatePass({ ...good, hasBakedText: true }, { requirePhotoreal: true }).reasons).toContain('baked-text');
    expect(shotGatePass({ ...good, quality: 40 }, { requirePhotoreal: true }).reasons).toContain('low-quality');
  });

  it('requirePhotoreal=false 时不查 3D(非仿真人片放行)', () => {
    const r = shotGatePass({ photoreal: 20, hasBakedText: false, quality: 80, issues: [] }, { requirePhotoreal: false });
    expect(r.pass).toBe(true);
    expect(r.reasons).not.toContain('3d');
  });

  it('gateFixHint:按原因给定向补强(禁 3D / 禁文字 / 修畸变)', () => {
    expect(gateFixHint(['3d'])).toMatch(/photorealistic/i);
    expect(gateFixHint(['3d'])).toMatch(/NO 3d render/i);
    expect(gateFixHint(['baked-text'])).toMatch(/NO text/i);
    expect(gateFixHint(['low-quality'])).toMatch(/hands and face|distortion/i);
    expect(gateFixHint(['3d', 'baked-text']).length).toBeGreaterThan(gateFixHint(['3d']).length);
  });
});
