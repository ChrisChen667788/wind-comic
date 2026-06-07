/**
 * v9.6.4 — 融门禁:口型就绪度并入 quality-gate + 口型重拍提示(lipSyncReshootHints)。
 */
import { describe, it, expect } from 'vitest';
import { evaluateQualityGate, type FilmAuditLike, type QualityDimsLike } from '@/lib/quality-gate';
import { buildLipSyncPlan, lipSyncReshootHints, type DialogueLine } from '@/lib/lipsync-plan';

const line = (over: Partial<DialogueLine>): DialogueLine => ({ shotNumber: 1, text: '你好', ...over });
const goodDims: QualityDimsLike = { overall: 88, continuity: 85, lighting: 86, face: 90 };

describe('v9.6.4 · quality-gate 口型融合', () => {
  it('口型 block(无其它信号)→ 不是「无数据」, level warn + 口型进偏弱维度', () => {
    const g = evaluateQualityGate({ lipSync: { lines: 4, readiness: 45, level: 'block' } });
    expect(g.level).toBe('warn');
    expect(g.ready).toBe(true); // 口型是增强维度,不硬拦
    expect(g.failedDimensions).toContain('口型');
    expect(g.reasons.join()).toMatch(/口型多处对不上/);
  });

  it('口型 warn → warn 原因', () => {
    const g = evaluateQualityGate({ qualityScore: goodDims, lipSync: { lines: 3, readiness: 68, level: 'warn' } });
    expect(g.level).toBe('warn');
    expect(g.reasons.join()).toMatch(/口型部分对不上/);
  });

  it('口型 pass + 成片达标 → 仍 pass(不引入口型原因)', () => {
    const g = evaluateQualityGate({ qualityScore: goodDims, lipSync: { lines: 5, readiness: 95, level: 'pass' } });
    expect(g.level).toBe('pass');
    expect(g.failedDimensions).not.toContain('口型');
  });

  it('口型 none(无对白)+ 无其它 → 回到「无数据」warn', () => {
    const g = evaluateQualityGate({ lipSync: { lines: 0, readiness: 0, level: 'none' } });
    expect(g.message).toMatch(/未质检/);
  });

  it('口型只升 warn,不覆盖真 block:Vision poor + 口型 block → 仍 block 且 reasons 含口型', () => {
    const fa: FilmAuditLike = {
      avgScore: 40, shotCount: 10, failCount: 5,
      weakestShots: [{ shotNumber: 2, score: 30 }], verdict: 'poor',
    };
    const g = evaluateQualityGate({ filmAudit: fa, lipSync: { lines: 4, readiness: 40, level: 'block' } });
    expect(g.level).toBe('block');
    expect(g.failedDimensions).toContain('口型');
  });

  it('非破坏性:不传 lipSync → 行为不变(成片达标 pass)', () => {
    const g = evaluateQualityGate({ qualityScore: goodDims });
    expect(g.level).toBe('pass');
  });
});

describe('v9.7.14 · 口型-音频对齐进门禁', () => {
  it('实测有弱镜 → warn + 「口型对齐」进偏弱维度(增强维度不硬拦)', () => {
    const g = evaluateQualityGate({ qualityScore: goodDims, lipAudioAlign: { measuredShots: 5, weakShots: 2, avgScore: 58 } });
    expect(g.level).toBe('warn');
    expect(g.ready).toBe(true);
    expect(g.failedDimensions).toContain('口型对齐');
    expect(g.reasons.join()).toMatch(/对不上声音/);
  });
  it('无弱镜但均分偏低 → warn', () => {
    const g = evaluateQualityGate({ qualityScore: goodDims, lipAudioAlign: { measuredShots: 4, weakShots: 0, avgScore: 70 } });
    expect(g.level).toBe('warn');
    expect(g.reasons.join()).toMatch(/对齐均分偏低/);
  });
  it('均分高 + 无弱镜 → 不引入对齐原因(pass)', () => {
    const g = evaluateQualityGate({ qualityScore: goodDims, lipAudioAlign: { measuredShots: 6, weakShots: 0, avgScore: 90 } });
    expect(g.level).toBe('pass');
    expect(g.failedDimensions).not.toContain('口型对齐');
  });
  it('measuredShots 0 + 无其它 → 回「无数据」warn(非破坏)', () => {
    const g = evaluateQualityGate({ lipAudioAlign: { measuredShots: 0, weakShots: 0, avgScore: 0 } });
    expect(g.message).toMatch(/未质检/);
  });
});

describe('v9.6.4 · lipSyncReshootHints', () => {
  const wide = line({ shotNumber: 1, speaker: 'A', text: '你好啊', onScreen: ['A'], shotSize: 'wide shot 远景', startSec: 0, endSec: 3 });       // 70
  const overflow = line({ shotNumber: 2, speaker: 'A', text: '这是一句非常长的台词需要说很久很久很久', onScreen: ['A'], startSec: 0, endSec: 1 }); // 80
  const offscreen = line({ shotNumber: 3, speaker: 'B', text: '喂', onScreen: ['A'], startSec: 0, endSec: 3 });                                    // 50
  const ok = line({ shotNumber: 4, speaker: 'A', text: '好', onScreen: ['A'], shotSize: '近景', startSec: 0, endSec: 3 });                          // 100

  it('对不上的句 → 可执行重拍提示(可对齐度升序,最差在前 + 对症修法)', () => {
    const r = lipSyncReshootHints(buildLipSyncPlan([wide, overflow, offscreen, ok]));
    expect(r.count).toBe(3);
    expect(r.shots.map((s) => s.shotNumber)).toEqual([3, 1, 2]); // 50 < 70 < 80
    expect(r.shots[0]).toMatchObject({ reason: '画外音' });
    expect(r.shots[0].focusHint).toMatch(/出镜|旁白/);
    expect(r.shots[1].reason).toBe('景别过远');
    expect(r.shots[1].focusHint).toMatch(/MCU|CU|特写/);
    expect(r.shots[2].reason).toMatch(/溢出/);
    expect(r.shots[2].focusHint).toMatch(/放慢|加长|拆/);
  });

  it('全部对得上 → count 0 + 无需重拍', () => {
    const r = lipSyncReshootHints(buildLipSyncPlan([ok]));
    expect(r.count).toBe(0);
    expect(r.message).toMatch(/无需重拍/);
  });

  it('maxShots 截断', () => {
    const r = lipSyncReshootHints(buildLipSyncPlan([wide, overflow, offscreen]), { maxShots: 2 });
    expect(r.shots).toHaveLength(2);
  });
});
