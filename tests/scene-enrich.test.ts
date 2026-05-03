/**
 * Tests for lib/scene-enrich (v2.13.5)
 *
 * 锁住"用 Writer 真实 shots 加厚 plan.scenes 描述"的核心修复路径,
 * 这是用户反馈"角色/场景设计与剧本无关"的根因之一。
 */

import { describe, it, expect } from 'vitest';
import { enrichScenesFromWriterScript } from '@/lib/scene-enrich';
import type { Script } from '@/types/agents';

const baseScript: Script = {
  title: '雨夜重逢',
  synopsis: '十年后, 警察阿凯在雨夜街角认出当年的逃犯小白',
  shots: [
    {
      shotNumber: 1, sceneDescription: '雨夜街角, 霓虹灯映在湿漉漉的柏油路上',
      action: '阿凯撑黑伞, 走向街角', emotion: '隐忍', characters: ['阿凯'],
    } as any,
    {
      shotNumber: 2, sceneDescription: '雨夜街角', action: '小白蹲在路灯下系鞋带, 抬头与阿凯对视',
      emotion: '震惊', characters: ['小白', '阿凯'], dialogue: '十年了。',
    } as any,
    {
      shotNumber: 3, sceneDescription: '审讯室, 白炽灯', action: '阿凯把档案拍在桌上',
      emotion: '压抑', characters: ['阿凯', '小白'], dialogue: '说吧。',
    } as any,
    {
      shotNumber: 4, sceneDescription: '审讯室', action: '小白苦笑, 慢慢摇头',
      emotion: '释然', characters: ['小白'],
    } as any,
  ],
};

const plan = [
  { id: 'sc-1', location: '雨夜街角', description: '街角, 雨夜' },
  { id: 'sc-2', location: '审讯室', description: '审讯室, 灯光' },
];

describe('enrichScenesFromWriterScript', () => {
  it('appends [剧本细节] from matching shots when location is in shot.sceneDescription', () => {
    const out = enrichScenesFromWriterScript(plan, baseScript);
    expect(out).toHaveLength(2);
    expect(out[0].description).toContain('[剧本细节]');
    expect(out[0].description).toContain('阿凯撑黑伞');
    // 第二段 dialogue 也带进来
    expect(out[0].description).toContain('十年了');
  });

  it('matches case-insensitively (LOC vs loc)', () => {
    const planMixed = [{ id: 's', location: 'LIVING Room', description: 'x' }];
    const scriptMixed: Script = {
      title: 't', synopsis: 's',
      shots: [
        { shotNumber: 1, sceneDescription: 'living room sunset', action: 'boy reads', emotion: '', characters: [] } as any,
      ],
    };
    const out = enrichScenesFromWriterScript(planMixed, scriptMixed);
    expect(out[0].description).toContain('boy reads');
  });

  it('falls back to ordered slicing when no location keyword matches', () => {
    const planNoMatch = [
      { id: 's1', location: '宇宙飞船', description: '飞船' },
      { id: 's2', location: '火星基地', description: '基地' },
    ];
    const out = enrichScenesFromWriterScript(planNoMatch, baseScript);
    // 4 shots / 2 scenes → 每段 2 shots
    expect(out[0].description).toContain('阿凯撑黑伞'); // shot 1
    expect(out[1].description).toContain('阿凯把档案拍在桌上'); // shot 3 action
  });

  it('caps to 3 snippets per scene to avoid prompt blowup', () => {
    const manyShots: Script = {
      title: 't', synopsis: 's',
      shots: Array.from({ length: 10 }, (_, i) => ({
        shotNumber: i + 1,
        sceneDescription: '同一地点', action: `动作${i + 1}`, emotion: '', characters: [],
      })) as any,
    };
    const single = [{ id: 's', location: '同一地点', description: 'x' }];
    const out = enrichScenesFromWriterScript(single, manyShots);
    const matches = (out[0].description.match(/\[镜\d+\]/g) || []).length;
    expect(matches).toBe(3);
  });

  it('is idempotent — running twice does not double-append', () => {
    const once = enrichScenesFromWriterScript(plan, baseScript);
    const twice = enrichScenesFromWriterScript(once, baseScript);
    // [剧本细节] 标记只出现一次
    expect((twice[0].description.match(/\[剧本细节\]/g) || []).length).toBe(1);
  });

  it('returns input unchanged when script is null/undefined', () => {
    expect(enrichScenesFromWriterScript(plan, null)).toEqual(plan);
    expect(enrichScenesFromWriterScript(plan, undefined)).toEqual(plan);
  });

  it('returns input unchanged when script.shots is empty/missing', () => {
    expect(enrichScenesFromWriterScript(plan, { title: 't', synopsis: 's', shots: [] })).toEqual(plan);
    // @ts-expect-error - 故意传错形 (用户数据可能缺字段)
    expect(enrichScenesFromWriterScript(plan, { title: 't', synopsis: 's' })).toEqual(plan);
  });

  it('returns empty array unchanged', () => {
    expect(enrichScenesFromWriterScript([], baseScript)).toEqual([]);
  });

  it('preserves arbitrary extra fields on scene (visual, genre, etc.)', () => {
    const planExtras = [{
      id: 'sc-1', location: '雨夜街角', description: '街角',
      visual: { lighting: 'noir' }, customField: 42,
    }];
    const out = enrichScenesFromWriterScript(planExtras, baseScript);
    expect((out[0] as any).visual).toEqual({ lighting: 'noir' });
    expect((out[0] as any).customField).toBe(42);
  });

  it('handles shots without dialogue (only action) gracefully', () => {
    // baseScript.shots[0] has no dialogue; the snippet should not include "·"
    const out = enrichScenesFromWriterScript(plan, baseScript);
    // shot 1 alone (no dlg) → snippet ends after action, no trailing punctuation
    expect(out[0].description).toMatch(/\[镜1\] 阿凯撑黑伞[^·]*?(?:\/|$)/);
  });
});
