/**
 * v7.7 — lib/master-prompt 单测 (Master Prompt Generator + 风格/LUT/导演预设 + 术语表)
 */

import { describe, it, expect } from 'vitest';
import {
  FILM_LOOK_PRESETS, LUT_PRESETS, MOVEMENT_STYLE_PRESETS, GLOSSARY,
  DEFAULT_MASTER_PROMPT, normalizeMasterPrompt, compileMasterPrompt, describeMasterPrompt,
  getFilmLook, getLut, getMovementStyle,
} from '@/lib/master-prompt';

describe('预设 + 术语表', () => {
  it('三类引用预设非空、id 唯一、含真实引用', () => {
    for (const list of [FILM_LOOK_PRESETS, LUT_PRESETS, MOVEMENT_STYLE_PRESETS]) {
      expect(list.length).toBeGreaterThanOrEqual(6);
      const ids = list.map((p) => p.id);
      expect(new Set(ids).size).toBe(ids.length);
      expect(list.every((p) => p.label && p.ref && p.prompt)).toBe(true);
    }
    // 引用真实影片/胶片/导演
    expect(FILM_LOOK_PRESETS.some((p) => /Blade Runner/i.test(p.ref))).toBe(true);
    expect(LUT_PRESETS.some((p) => /Vision3/i.test(p.ref))).toBe(true);
    expect(MOVEMENT_STYLE_PRESETS.some((p) => /Villeneuve/i.test(p.ref))).toBe(true);
  });
  it('术语表含 PPM/VO/Rack Focus 等', () => {
    const terms = GLOSSARY.map((g) => g.term);
    expect(terms).toContain('PPM');
    expect(terms).toContain('VO');
    expect(terms).toContain('Rack Focus');
    expect(GLOSSARY.every((g) => g.def && g.def.length > 4)).toBe(true);
  });
  it('getters 命中', () => {
    expect(getFilmLook('br2049')?.ref).toMatch(/Blade Runner/);
    expect(getLut('vision3-500t')?.ref).toMatch(/Vision3/);
    expect(getMovementStyle('villeneuve')?.ref).toMatch(/Villeneuve/);
  });
});

describe('normalizeMasterPrompt', () => {
  it('空 → 默认', () => {
    expect(normalizeMasterPrompt(null)).toEqual(DEFAULT_MASTER_PROMPT);
    expect(normalizeMasterPrompt({})).toEqual(DEFAULT_MASTER_PROMPT);
  });
  it('非法预设 id → 回落; 合法保留; freeform 保留', () => {
    const out = normalizeMasterPrompt({ filmLook: 'NOPE', lut: 'fuji-eterna', movementStyle: 'X', coreConcept: '雨夜追凶', aspect: '16:9' });
    expect(out.filmLook).toBe(DEFAULT_MASTER_PROMPT.filmLook);
    expect(out.lut).toBe('fuji-eterna');
    expect(out.movementStyle).toBe(DEFAULT_MASTER_PROMPT.movementStyle);
    expect(out.coreConcept).toBe('雨夜追凶');
    expect(out.aspect).toBe('16:9');
  });
  it('超长字段截断', () => {
    const out = normalizeMasterPrompt({ coreConcept: 'x'.repeat(5000) });
    expect(out.coreConcept.length).toBeLessThanOrEqual(1000);
  });
});

describe('compileMasterPrompt', () => {
  it('含 Role/Task/Core Concept/Execution Parameters + 预设 prompt + 引用', () => {
    const out = compileMasterPrompt(normalizeMasterPrompt({ coreConcept: '用产品质感打动人', filmLook: 'br2049', lut: 'vision3-500t', movementStyle: 'villeneuve', aspect: '2.39:1' }));
    expect(out).toContain('# Role:');
    expect(out).toContain('# Task:');
    expect(out).toContain('## Core Concept');
    expect(out).toContain('用产品质感打动人');
    expect(out).toContain('## Execution Parameters');
    expect(out).toContain('Blade Runner 2049');     // look prompt
    expect(out).toContain('ref: Kodak Vision3 500T'); // lut ref
    expect(out).toContain('Villeneuve');            // movement
    expect(out).toContain('2.39:1');
  });
  it('coreConcept 为空 → 占位提示; extra 仅在有值时出现', () => {
    const noExtra = compileMasterPrompt({ ...DEFAULT_MASTER_PROMPT, coreConcept: '', extra: '' });
    expect(noExtra).toContain('(描述本片');
    expect(noExtra).not.toContain('Additional:');
    const withExtra = compileMasterPrompt({ ...DEFAULT_MASTER_PROMPT, extra: '强调环保理念' });
    expect(withExtra).toContain('Additional: 强调环保理念');
  });
});

describe('describeMasterPrompt', () => {
  it('含影片look/LUT/运镜中文标签 + 画幅', () => {
    const out = describeMasterPrompt(DEFAULT_MASTER_PROMPT);
    expect(out).toContain('赛博霓虹');
    expect(out).toContain('Vision3 500T');
    expect(out).toContain('维伦纽瓦慢推');
    expect(out).toContain('2.39:1');
  });
});
