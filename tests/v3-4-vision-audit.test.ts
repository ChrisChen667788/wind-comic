/**
 * v3.4 — Vision Audit 单测 (纯函数 + 持久化, 不跑真 LLM).
 */

import { describe, it, expect } from 'vitest';
import {
  buildAuditPrompt,
  scoreToVerdict,
  normalizeAuditResult,
  aggregateFilmAudit,
  saveShotAudit,
  getProjectAudits,
  type ShotAuditResult,
} from '@/lib/vision-audit';
import { nanoid } from 'nanoid';

// ─── buildAuditPrompt ────────────────────────────────────────────────────────

describe('v3.4 · buildAuditPrompt', () => {
  it('includes only provided fields', () => {
    const p = buildAuditPrompt({ shotNumber: 3, sceneDescription: '雨夜街头', action: '男主推门' });
    expect(p).toContain('第 3 镜');
    expect(p).toContain('雨夜街头');
    expect(p).toContain('男主推门');
    expect(p).not.toContain('【台词】');
    expect(p).not.toContain('【情绪】');
  });
  it('includes all fields when present', () => {
    const p = buildAuditPrompt({ shotNumber: 1, sceneDescription: 's', action: 'a', dialogue: 'd', mood: 'm' });
    expect(p).toContain('【场景】');
    expect(p).toContain('【动作】');
    expect(p).toContain('【台词】');
    expect(p).toContain('【情绪】');
  });
});

// ─── scoreToVerdict ──────────────────────────────────────────────────────────

describe('v3.4 · scoreToVerdict', () => {
  it('maps thresholds', () => {
    expect(scoreToVerdict(90)).toBe('pass');
    expect(scoreToVerdict(75)).toBe('pass');
    expect(scoreToVerdict(74)).toBe('warn');
    expect(scoreToVerdict(50)).toBe('warn');
    expect(scoreToVerdict(49)).toBe('fail');
    expect(scoreToVerdict(0)).toBe('fail');
  });
});

// ─── normalizeAuditResult ────────────────────────────────────────────────────

describe('v3.4 · normalizeAuditResult', () => {
  it('clamps + maps verdict + fills shotNumber', () => {
    const r = normalizeAuditResult({
      score: 120, // over 100
      dimensions: { sceneMatch: 80, actionMatch: -5, moodMatch: 'x', composition: 60 },
      issues: ['崩坏', '', 42, '缺道具'],
      reasoning: 'z'.repeat(500),
    }, 7);
    expect(r.shotNumber).toBe(7);
    expect(r.score).toBe(100);
    expect(r.verdict).toBe('pass');
    expect(r.dimensions.actionMatch).toBe(0); // negative clamped
    expect(r.dimensions.moodMatch).toBe(0);   // NaN → 0
    expect(r.issues).toEqual(['崩坏', '缺道具']); // strings only
    expect(r.reasoning.length).toBeLessThanOrEqual(200);
  });
  it('handles totally empty raw', () => {
    const r = normalizeAuditResult({}, 1);
    expect(r.score).toBe(0);
    expect(r.verdict).toBe('fail');
    expect(r.issues).toEqual([]);
    expect(r.dimensions.sceneMatch).toBe(0);
  });
});

// ─── aggregateFilmAudit ──────────────────────────────────────────────────────

const mk = (shotNumber: number, score: number): ShotAuditResult => ({
  shotNumber, score, verdict: scoreToVerdict(score),
  dimensions: { sceneMatch: score, actionMatch: score, moodMatch: score, composition: score },
  issues: [], reasoning: '',
});

describe('v3.4 · aggregateFilmAudit', () => {
  it('empty → poor', () => {
    const s = aggregateFilmAudit([]);
    expect(s.shotCount).toBe(0);
    expect(s.verdict).toBe('poor');
    expect(s.weakestShots).toEqual([]);
  });
  it('averages + counts verdicts', () => {
    const s = aggregateFilmAudit([mk(1, 90), mk(2, 80), mk(3, 40)]);
    expect(s.shotCount).toBe(3);
    expect(s.avgScore).toBe(70); // (90+80+40)/3 = 70
    expect(s.passCount).toBe(2);
    expect(s.failCount).toBe(1);
  });
  it('weakestShots are the lowest, ascending', () => {
    const s = aggregateFilmAudit([mk(1, 90), mk(2, 30), mk(3, 60), mk(4, 45)], 2);
    expect(s.weakestShots).toEqual([{ shotNumber: 2, score: 30 }, { shotNumber: 4, score: 45 }]);
  });
  it('verdict excellent when all pass + avg >= 85', () => {
    expect(aggregateFilmAudit([mk(1, 90), mk(2, 88)]).verdict).toBe('excellent');
  });
  it('verdict good when low fail ratio + avg >= 70', () => {
    const shots = [mk(1, 80), mk(2, 78), mk(3, 72), mk(4, 75), mk(5, 76), mk(6, 74), mk(7, 73), mk(8, 71), mk(9, 79), mk(10, 40)];
    // 1 fail out of 10 = 0.1 ratio, avg ~ 71.8
    expect(aggregateFilmAudit(shots).verdict).toBe('good');
  });
  it('verdict poor when fail ratio > 0.34', () => {
    expect(aggregateFilmAudit([mk(1, 40), mk(2, 30), mk(3, 80)]).verdict).toBe('poor');
  });
});

// ─── persistence (真 SQLite) ─────────────────────────────────────────────────

describe('v3.4 · saveShotAudit / getProjectAudits', () => {
  it('saves and reads back', async () => {
    const pid = 'test-audit-' + nanoid();
    await saveShotAudit(pid, mk(1, 85));
    await saveShotAudit(pid, mk(2, 60));
    const audits = await getProjectAudits(pid);
    expect(audits).toHaveLength(2);
    expect(audits[0].shotNumber).toBe(1);
    expect(audits[0].score).toBe(85);
    expect(audits[1].verdict).toBe('warn');
  });

  it('UPSERT overwrites same shot', async () => {
    const pid = 'test-audit-' + nanoid();
    await saveShotAudit(pid, mk(1, 50));
    await saveShotAudit(pid, mk(1, 95)); // re-audit shot 1
    const audits = await getProjectAudits(pid);
    expect(audits).toHaveLength(1);
    expect(audits[0].score).toBe(95);
  });

  it('round-trips issues array', async () => {
    const pid = 'test-audit-' + nanoid();
    const r: ShotAuditResult = { ...mk(1, 40), issues: ['跑题', '缺人物'] };
    await saveShotAudit(pid, r);
    const back = await getProjectAudits(pid);
    expect(back[0].issues).toEqual(['跑题', '缺人物']);
  });

  it('empty project → empty array', async () => {
    expect(await getProjectAudits('nonexistent-' + nanoid())).toEqual([]);
  });
});
