/**
 * v2.23 P0.1 — Style Audit (画风一致性视觉审计).
 *
 * Vision LLM 调用 mock 隔离, 只验我们的解析 / 阈值 / hint 生成逻辑.
 */
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/config', () => ({
  API_CONFIG: {
    openai: { apiKey: '', baseURL: '', model: 'test-model' },
  },
}));

const mockCreate = vi.fn();
vi.mock('openai', () => ({
  default: class OpenAI {
    chat = { completions: { create: mockCreate } };
  },
}));

import {
  auditShotStyle,
  buildRegenHintFromAudit,
  type StyleAuditResult,
} from '@/lib/style-audit';

describe('v2.23 P0.1 · auditShotStyle preconditions', () => {
  it('returns null when no OPENAI_API_KEY', async () => {
    const r = await auditShotStyle('https://shot.png', 'https://bible.png');
    expect(r).toBeNull();
  });

  it('returns null when shot image is data: URI', async () => {
    const r = await auditShotStyle('data:image/png;base64,xxx', 'https://bible.png');
    expect(r).toBeNull();
  });

  it('returns null when bible image is data: URI', async () => {
    const r = await auditShotStyle('https://shot.png', 'data:image/png;base64,xxx');
    expect(r).toBeNull();
  });

  it('returns null when either image is missing', async () => {
    expect(await auditShotStyle('', 'https://bible.png')).toBeNull();
    expect(await auditShotStyle('https://shot.png', '')).toBeNull();
  });
});

describe('v2.23 P0.1 · buildRegenHintFromAudit (hint generator)', () => {
  function mkAudit(dims: Partial<StyleAuditResult['dimensions']>): StyleAuditResult {
    return {
      score: 50,
      passed: false,
      shouldRegen: true,
      reasoning: 'test',
      dimensions: {
        palette: 80, lighting: 80, colorTemperature: 80, texture: 80,
        ...dims,
      },
    };
  }

  it('weakest = palette → hint mentions palette', () => {
    const hint = buildRegenHintFromAudit(mkAudit({ palette: 50 }));
    expect(hint).toContain('palette');
    expect(hint).toMatch(/50.*100|100/);
  });

  it('weakest = colorTemperature → hint mentions color temp', () => {
    const hint = buildRegenHintFromAudit(mkAudit({ colorTemperature: 40 }));
    expect(hint).toContain('color temperature');
    expect(hint).toContain('warm/neutral/cool');
  });

  it('weakest = lighting → hint mentions lighting direction', () => {
    const hint = buildRegenHintFromAudit(mkAudit({ lighting: 35 }));
    expect(hint).toContain('lighting');
  });

  it('weakest = texture → hint mentions render language', () => {
    const hint = buildRegenHintFromAudit(mkAudit({ texture: 30 }));
    expect(hint).toContain('rendering language');
    expect(hint).toContain('cel-shaded');
  });

  it('all dims equal → picks palette (first in order)', () => {
    const hint = buildRegenHintFromAudit(mkAudit({}));
    expect(hint).toContain('palette');
  });
});
