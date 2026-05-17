/**
 * v2.23 P0.4 — Dialogue coverage audit.
 */
import { describe, expect, it } from 'vitest';
import {
  detectDialogueScenes,
  auditDialogueCoverage,
  buildDialogueCoverageBlock,
} from '@/lib/dialogue-coverage';
import type { Script, ScriptShot } from '@/types/agents';

const mkShot = (n: number, partial: Partial<ScriptShot> = {}): ScriptShot => ({
  shotNumber: n,
  sceneDescription: '',
  action: '',
  emotion: '',
  characters: [],
  ...partial,
});

const mkScript = (shots: ScriptShot[]): Script => ({
  title: 't', synopsis: '', shots,
});

describe('v2.23 P0.4 · detectDialogueScenes', () => {
  it('connects adjacent dialogue shots in same location', () => {
    const shots = [
      mkShot(1, { dialogue: 'A 说', characters: ['alice'], sceneDescription: 'tavern' }),
      mkShot(2, { dialogue: 'B 说', characters: ['bob'], sceneDescription: 'tavern' }),
      mkShot(3, { dialogue: 'A 又说', characters: ['alice'], sceneDescription: 'tavern' }),
    ];
    const scenes = detectDialogueScenes(shots);
    expect(scenes.length).toBe(1);
    expect(scenes[0].shotCount).toBe(3);
    expect(scenes[0].characters.sort()).toEqual(['alice', 'bob']);
  });

  it('splits when location changes', () => {
    const shots = [
      mkShot(1, { dialogue: 'A', characters: ['alice'], sceneDescription: 'tavern' }),
      mkShot(2, { dialogue: 'B', characters: ['bob'], sceneDescription: 'forest' }),
    ];
    const scenes = detectDialogueScenes(shots);
    expect(scenes.length).toBe(2);
  });

  it('splits when a non-dialogue shot is in between', () => {
    const shots = [
      mkShot(1, { dialogue: 'A', characters: ['alice'], sceneDescription: 'tavern' }),
      mkShot(2, { action: 'transition', sceneDescription: 'tavern' }),
      mkShot(3, { dialogue: 'A again', characters: ['alice'], sceneDescription: 'tavern' }),
    ];
    const scenes = detectDialogueScenes(shots);
    expect(scenes.length).toBe(2);
  });

  it('single isolated dialogue shot is its own scene', () => {
    const shots = [mkShot(1, { dialogue: 'soliloquy', characters: ['alice'] })];
    const scenes = detectDialogueScenes(shots);
    expect(scenes.length).toBe(1);
    expect(scenes[0].shotCount).toBe(1);
    expect(scenes[0].isMultiCharacter).toBe(false);
  });

  it('detects close-up vs wide-only', () => {
    // 真实 Writer 输出格式: "venue, camera modifier" — 用 location field 也行
    const shots = [
      mkShot(1, { dialogue: 'A', characters: ['alice', 'bob'], sceneDescription: 'tavern, wide shot of both' }),
      mkShot(2, { dialogue: 'B', characters: ['alice', 'bob'], sceneDescription: 'tavern, long shot from behind' }),
    ];
    const scenes = detectDialogueScenes(shots);
    expect(scenes[0].isWideOnly).toBe(true);
    expect(scenes[0].hasCloseUp).toBe(false);

    const withCu = [
      mkShot(1, { dialogue: 'A', characters: ['alice', 'bob'], sceneDescription: 'tavern, wide shot' }),
      mkShot(2, { dialogue: 'B', characters: ['alice', 'bob'], sceneDescription: 'tavern, close-up of bob' }),
    ];
    const scenes2 = detectDialogueScenes(withCu);
    expect(scenes2[0].hasCloseUp).toBe(true);
    expect(scenes2[0].isWideOnly).toBe(false);
  });

  it('handles empty shots array', () => {
    expect(detectDialogueScenes([])).toEqual([]);
  });
});

describe('v2.23 P0.4 · auditDialogueCoverage', () => {
  it('flags multi-char dialogue that is single-shot (needs reverse)', () => {
    const script = mkScript([
      mkShot(1, { dialogue: '你完蛋了', characters: ['alice', 'bob'], sceneDescription: 'office' }),
    ]);
    const r = auditDialogueCoverage(script);
    expect(r.needsReverseShot.length).toBe(1);
    expect(r.warnings.length).toBeGreaterThan(0);
    expect(r.warnings[0]).toMatch(/正反打/);
    expect(r.coverageScore).toBe(0);
  });

  it('flags multi-shot dialogue that is wide-only (needs CU)', () => {
    const script = mkScript([
      mkShot(1, { dialogue: 'A', characters: ['alice', 'bob'], sceneDescription: 'office, wide shot of both' }),
      mkShot(2, { dialogue: 'B', characters: ['alice', 'bob'], sceneDescription: 'office, full shot pulling back' }),
    ]);
    const r = auditDialogueCoverage(script);
    expect(r.needsCloseUp.length).toBe(1);
    expect(r.warnings.some((w) => w.includes('反应特写'))).toBe(true);
  });

  it('passes proper shot/reverse structure', () => {
    const script = mkScript([
      mkShot(1, { dialogue: 'A 说', characters: ['alice', 'bob'], sceneDescription: 'office, close-up alice' }),
      mkShot(2, { dialogue: 'B 反应', characters: ['alice', 'bob'], sceneDescription: 'office, close-up bob' }),
      mkShot(3, { dialogue: 'A 再说', characters: ['alice', 'bob'], sceneDescription: 'office, medium close alice' }),
    ]);
    const r = auditDialogueCoverage(script);
    expect(r.needsReverseShot.length).toBe(0);
    expect(r.needsCloseUp.length).toBe(0);
    expect(r.coverageScore).toBe(100);
  });

  it('single-character monologue does not need reverse', () => {
    const script = mkScript([
      mkShot(1, { dialogue: '心声', characters: ['alice'], sceneDescription: 'alice alone in room' }),
    ]);
    const r = auditDialogueCoverage(script);
    expect(r.needsReverseShot.length).toBe(0);
    expect(r.coverageScore).toBe(100); // 没多角色场景 → 100
  });

  it('coverage score is ratio of rule-satisfied multi-char scenes', () => {
    const script = mkScript([
      // multi-char 场景 1: 单镜缺反打
      mkShot(1, { dialogue: 'A1', characters: ['a', 'b'], sceneDescription: 'office, wide shot of both' }),
      // 间隔 — 非对话镜
      mkShot(2, { action: 'cut', sceneDescription: 'transition' }),
      // multi-char 场景 2: 良好 (有 CU + 多镜)
      mkShot(3, { dialogue: 'C1', characters: ['c', 'd'], sceneDescription: 'kitchen, close-up of c' }),
      mkShot(4, { dialogue: 'D1', characters: ['c', 'd'], sceneDescription: 'kitchen, close-up of d' }),
    ]);
    const r = auditDialogueCoverage(script);
    expect(r.multiCharSceneCount).toBe(2);
    expect(r.coverageScore).toBe(50); // 1/2 满足
  });

  it('empty script: coverageScore 100, no warnings', () => {
    const r = auditDialogueCoverage(mkScript([]));
    expect(r.coverageScore).toBe(100);
    expect(r.warnings).toEqual([]);
  });
});

describe('v2.23 P0.4 · buildDialogueCoverageBlock (Writer prompt)', () => {
  it('contains shot/reverse hard rule', () => {
    const block = buildDialogueCoverageBlock();
    expect(block).toContain('正反打');
    expect(block).toContain('2+ 角色对话');
    expect(block).toContain('CU/MCU');
    expect(block).toMatch(/reaction shot|反应/);
  });
});
