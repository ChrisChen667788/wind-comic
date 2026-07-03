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
