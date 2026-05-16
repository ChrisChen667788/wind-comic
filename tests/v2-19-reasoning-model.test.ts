/**
 * v2.19 P1.2 — Reasoning model detection
 *
 * Locks the regex used by callLLM to decide if a model is a reasoning model
 * (MiniMax-M2 / deepseek-r1 / o1 / o3 etc) and deserves a longer default
 * timeout (420s vs 300s). Getting this wrong on either side wastes quota:
 *   - false-positive: normal model gets 420s budget, may hang longer than needed
 *   - false-negative: reasoning model gets 300s, times out mid-think, wasted call
 */
import { describe, expect, it } from 'vitest';
import { isReasoningModelName } from '@/services/hybrid-orchestrator';

describe('v2.19 P1.2 · isReasoningModelName', () => {
  it.each([
    ['MiniMax-M2', true],
    ['minimax-m2', true],
    ['MiniMax-M2-Pro', true],
    ['some-m2', true],
    ['deepseek-r1', true],
    ['deepseek-r1-distill', true],
    ['o1', true],
    ['o1-mini', true],
    ['o1-preview', true],
    ['o3', true],
    ['o3-mini', true],
    ['o4', true],
    ['o4-mini', true],
    ['my-reasoning-pro', true],
  ])('matches reasoning model: %s', (model, expected) => {
    expect(isReasoningModelName(model)).toBe(expected);
  });

  it.each([
    ['gpt-4', false],
    ['gpt-4o', false],
    ['claude-opus-4-6', false],
    ['claude-sonnet-4-20250514', false],
    ['MiniMax-Hailuo-2.3', false],
    ['m2x-rocket', false],         // m2 not word-bounded
    ['boom2bust', false],          // m2 not word-bounded
    ['orca-model', false],         // 'o' followed by other letters
    ['o1ce', false],                // o1 not standalone
    ['', false],
    [null, false],
    [undefined, false],
  ])('does not match non-reasoning: %s', (model, expected) => {
    expect(isReasoningModelName(model as string | null | undefined)).toBe(expected);
  });
});
