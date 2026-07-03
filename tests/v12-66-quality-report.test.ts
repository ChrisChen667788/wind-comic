/**
 * v12.66 — 成片质检报告:防线事件账本汇总。
 */
import { describe, it, expect } from 'vitest';
import { summarizeQualityLedger } from '@/lib/quality-report';

describe('v12.66 · summarizeQualityLedger', () => {
  it('零事件 → 满分 + 一次成型摘要', () => {
    const r = summarizeQualityLedger([]);
    expect(r.healthScore).toBe(100);
    expect(r.totalEvents).toBe(0);
    expect(r.summary).toContain('一次成型');
    expect(r.affectedShots).toEqual([]);
  });

  it('重生类扣 5/次,兜底类扣 12/次,下限 20', () => {
    expect(summarizeQualityLedger([{ shot: 1, kind: 'shot-gate', detail: '3d' }]).healthScore).toBe(95);
    expect(summarizeQualityLedger([{ shot: 1, kind: 'kenburns-fallback', detail: 'in' }]).healthScore).toBe(88);
    const many = Array.from({ length: 20 }, (_, i) => ({ shot: i + 1, kind: 'kenburns-fallback', detail: 'in' }));
    expect(summarizeQualityLedger(many).healthScore).toBe(20);
  });

  it('affectedShots 去重升序;degradedShots 只含兜底镜;shot=0 不计', () => {
    const r = summarizeQualityLedger([
      { shot: 3, kind: 'cameo-retry', detail: '60→85' },
      { shot: 1, kind: 'kenburns-fallback', detail: 'pan' },
      { shot: 3, kind: 'shot-gate', detail: 'baked-text' },
      { shot: 0, kind: 'compliance', detail: '最强' },
    ]);
    expect(r.affectedShots).toEqual([1, 3]);
    expect(r.degradedShots).toEqual([1]);
    expect(r.byKind['cameo-retry']).toBe(1);
    expect(r.byKind['compliance']).toBe(1);
  });

  it('中文摘要按类聚合', () => {
    const r = summarizeQualityLedger([
      { shot: 1, kind: 'cameo-retry', detail: '' },
      { shot: 2, kind: 'cameo-retry', detail: '' },
      { shot: 4, kind: 'kenburns-fallback', detail: 'in' },
    ]);
    expect(r.summary).toContain('2 镜一致性重生');
    expect(r.summary).toContain('1 镜静图动画兜底');
  });
});

describe('v12.91 · 缺镜如实记账(修「残片报 100 分」实测坑)', () => {
  it('missing-video 扣 15/镜、计入 degradedShots、摘要打 ⚠️ 首位', () => {
    const r = summarizeQualityLedger([
      { shot: 4, kind: 'missing-video', detail: 'no-image-for-fallback' },
      { shot: 5, kind: 'missing-video', detail: 'no-image-for-fallback' },
      { shot: 1, kind: 'cameo-retry', detail: '' },
    ]);
    expect(r.healthScore).toBe(100 - 15 - 15 - 5);
    expect(r.degradedShots).toEqual([4, 5]);
    expect(r.summary.startsWith('⚠️ 2 镜缺失')).toBe(true);
  });

  it('9 镜缺失(实测 juicer 场景)→ 健康分打到下限 20,绝不是 100', () => {
    const events = Array.from({ length: 9 }, (_, i) => ({ shot: i + 4, kind: 'missing-video', detail: '' }));
    const r = summarizeQualityLedger(events);
    expect(r.healthScore).toBe(20);
    expect(r.summary).toContain('9 镜缺失');
  });
});
