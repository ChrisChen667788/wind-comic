/**
 * Tests for v2.11 #4 Writer-Editor closed loop data layer.
 *
 * 覆盖:
 *   1. insertQualityScore 正确落盘,字段序列化/反序列化对称
 *   2. getLatestQualityScore 总是取最新一条(按 createdAt DESC)
 *   3. listQualityScores 返回整条历史
 *   4. buildWriterFeedbackHint:
 *      - null score → ''
 *      - 所有维度 >= 70 → ''
 *      - 某维度 < 70 → 返回包含该维度诊断的文本
 *      - 多维度低分 → 各自段落都出现
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  insertQualityScore,
  getLatestQualityScore,
  listQualityScores,
  buildWriterFeedbackHint,
} from '@/lib/quality-scores';
import { db, now } from '@/lib/db';
import { nanoid } from 'nanoid';

// 测试用固定用户 id —— 先插入满足 projects.user_id FK,多 case 共享
const TEST_USER_ID = 'qs-test-user';
function ensureTestUser() {
  const existing = db.prepare('SELECT id FROM users WHERE id = ?').get(TEST_USER_ID);
  if (existing) return;
  db.prepare(`INSERT INTO users (id, email, password_hash, name, role, created_at) VALUES (?, ?, ?, ?, ?, ?)`)
    .run(TEST_USER_ID, `qs-test-${Date.now()}@test.local`, 'x', 'QS Tester', 'user', now());
}

// 在测试库里插个临时 project,满足 FK
function freshProjectId(): string {
  ensureTestUser();
  const id = `test_proj_${nanoid(8)}`;
  const t = now();
  db.prepare(`INSERT INTO projects (id, user_id, title, description, cover_urls, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(id, TEST_USER_ID, 'test project', '', '[]', 'active', t, t);
  return id;
}

describe('quality-scores (v2.11 #4)', () => {
  let projectId = '';

  beforeEach(() => {
    // 每个 case 新 project,隔离历史
    projectId = freshProjectId();
  });

  it('insertQualityScore persists and round-trips', () => {
    const row = insertQualityScore({
      projectId,
      overall: 82,
      continuity: 85,
      lighting: 60,
      face: 90,
      narrative: '主角脸锁得很稳,但第 4-5 shot 光线跳变明显',
      sampleFrames: ['/api/serve-file?key=aaa', '/api/serve-file?key=bbb'],
      suggestions: {
        continuity: [],
        lighting: ['统一暖色调', '减少第 4 shot 的顶光强度'],
        face: [],
      },
    });
    expect(row.id).toMatch(/^qs_/);
    expect(row.overall).toBe(82);
    expect(row.lighting).toBe(60);

    const got = getLatestQualityScore(projectId);
    expect(got).not.toBeNull();
    expect(got!.overall).toBe(82);
    expect(got!.sampleFrames).toHaveLength(2);
    expect(got!.suggestions.lighting).toContain('统一暖色调');
  });

  it('getLatestQualityScore returns the most recent by createdAt', async () => {
    insertQualityScore({
      projectId, overall: 60, continuity: 60, lighting: 60, face: 60,
      narrative: 'v1', sampleFrames: [],
      suggestions: { continuity: [], lighting: [], face: [] },
    });
    // 等 5ms 以便 ISO 时间字符串不同 —— 对 SQLite lexicographic sort 关键
    await new Promise((r) => setTimeout(r, 5));
    insertQualityScore({
      projectId, overall: 88, continuity: 85, lighting: 90, face: 90,
      narrative: 'v2 after rewrite', sampleFrames: [],
      suggestions: { continuity: [], lighting: [], face: [] },
    });

    const latest = getLatestQualityScore(projectId);
    expect(latest?.overall).toBe(88);
    expect(latest?.narrative).toBe('v2 after rewrite');

    const all = listQualityScores(projectId);
    expect(all).toHaveLength(2);
    expect(all[0].overall).toBe(88);
    expect(all[1].overall).toBe(60);
  });

  it('clamps out-of-range dimensions to [0,100]', () => {
    const row = insertQualityScore({
      projectId,
      overall: 250,    // → 100
      continuity: -5,  // → 0
      lighting: 75.7,  // → 76 (round)
      face: NaN,       // → 0
      narrative: '',
      sampleFrames: [],
      suggestions: { continuity: [], lighting: [], face: [] },
    });
    expect(row.overall).toBe(100);
    expect(row.continuity).toBe(0);
    expect(row.lighting).toBe(76);
    expect(row.face).toBe(0);
  });
});

describe('buildWriterFeedbackHint (v2.11 #4)', () => {
  it('returns empty string for null score', () => {
    expect(buildWriterFeedbackHint(null)).toBe('');
  });

  it('returns empty string when all dimensions >= 70', () => {
    const hint = buildWriterFeedbackHint({
      id: 'x', projectId: 'p', createdAt: '2026-04-21T00:00:00Z',
      overall: 80, continuity: 75, lighting: 72, face: 88,
      narrative: 'all good', sampleFrames: [],
      suggestions: { continuity: [], lighting: [], face: [] },
    });
    expect(hint).toBe('');
  });

  it('injects face-focused hint when face < 70', () => {
    const hint = buildWriterFeedbackHint({
      id: 'x', projectId: 'p', createdAt: '2026-04-21T00:00:00Z',
      overall: 65, continuity: 80, lighting: 80, face: 40,
      narrative: '脸在第 5 shot 跳了',
      sampleFrames: [],
      suggestions: {
        continuity: [], lighting: [],
        face: ['每段主角台词前复述发型 + 瞳色', '保留 subject_reference 贯穿全片'],
      },
    });
    expect(hint).toContain('脸相似度偏低');
    expect(hint).toContain('40/100');
    expect(hint).toContain('每段主角台词前复述发型');
    expect(hint).not.toContain('光影一致性偏低');
    expect(hint).not.toContain('镜头衔接偏低');
    expect(hint).toContain('脸在第 5 shot 跳了');  // narrative echoed
  });

  it('stacks multiple weak dimensions', () => {
    const hint = buildWriterFeedbackHint({
      id: 'x', projectId: 'p', createdAt: '2026-04-21T00:00:00Z',
      overall: 40, continuity: 50, lighting: 55, face: 45,
      narrative: '',
      sampleFrames: [],
      suggestions: { continuity: [], lighting: [], face: [] },
    });
    expect(hint).toContain('脸相似度偏低');
    expect(hint).toContain('光影一致性偏低');
    expect(hint).toContain('镜头衔接偏低');
  });

  it('threshold is strict: 70 and above counts as OK', () => {
    const hint = buildWriterFeedbackHint({
      id: 'x', projectId: 'p', createdAt: '2026-04-21T00:00:00Z',
      overall: 70, continuity: 70, lighting: 70, face: 70,
      narrative: '', sampleFrames: [],
      suggestions: { continuity: [], lighting: [], face: [] },
    });
    expect(hint).toBe('');
  });
});
