/**
 * v9.4.3 — lib/reference-elements 单测(多参 Elements:结构化角色 + 路由进 cref/sref/DNA + 完整度引导)。
 */
import { describe, it, expect } from 'vitest';
import {
  inferElementRole, bindElements, elementCompleteness, MAX_PER_ELEMENT_ROLE,
  clampElementWeight, ELEMENT_WEIGHT_DEFAULT,
  type ReferenceElement,
} from '@/lib/reference-elements';

let n = 0;
const mk = (over: Partial<ReferenceElement>): ReferenceElement => ({
  id: `e${n++}`, kind: 'image', url: `http://x/${n}.png`, name: 'ref', ...over,
});

describe('v9.4.3 · inferElementRole', () => {
  it('显式 elementRole 最高优先', () => {
    expect(inferElementRole(mk({ elementRole: 'prop', kind: 'image', role: '风格' }))).toBe('prop');
  });
  it('音频 → voice, 视频 → motion', () => {
    expect(inferElementRole(mk({ kind: 'audio' }))).toBe('voice');
    expect(inferElementRole(mk({ kind: 'video' }))).toBe('motion');
  });
  it('图片按自由文本关键词推断', () => {
    expect(inferElementRole(mk({ role: '风格参考' }))).toBe('style');
    expect(inferElementRole(mk({ label: '长安夜市场景' }))).toBe('scene');
    expect(inferElementRole(mk({ name: '唐刀道具' }))).toBe('prop');
    expect(inferElementRole(mk({ label: '女主角脸' }))).toBe('character');
  });
  it('图片无线索 → 默认 character', () => {
    expect(inferElementRole(mk({ name: 'untitled' }))).toBe('character');
  });
});

describe('v9.4.3 · bindElements', () => {
  it('按角色路由到对应数组', () => {
    const b = bindElements([
      mk({ label: '女主', elementRole: 'character', url: 'http://x/c.png' }),
      mk({ label: '画风', elementRole: 'style', url: 'http://x/s.png' }),
      mk({ label: '场景', elementRole: 'scene', url: 'http://x/sc.png' }),
      mk({ kind: 'audio', elementRole: 'voice', url: 'http://x/v.mp3' }),
    ]);
    expect(b.crefImages).toEqual(['http://x/c.png']);
    expect(b.srefImages).toEqual(['http://x/s.png']);
    expect(b.sceneImages).toEqual(['http://x/sc.png']);
    expect(b.voiceAudios).toEqual(['http://x/v.mp3']);
    expect(b.routed).toBe(4);
  });

  it('超角色上限的元素被丢弃(character 上限 4)', () => {
    const many = Array.from({ length: 7 }, (_, i) => mk({ elementRole: 'character', url: `http://x/c${i}.png` }));
    const b = bindElements(many);
    expect(b.crefImages).toHaveLength(MAX_PER_ELEMENT_ROLE.character);
    expect(b.byRole.character).toHaveLength(4);
  });

  it('跳过无 url 的元素 + 容错空输入', () => {
    const b = bindElements([mk({ url: '' }), mk({ elementRole: 'style' })]);
    expect(b.routed).toBe(1);
    expect(bindElements(undefined as unknown as ReferenceElement[]).routed).toBe(0);
  });

  it('byRole 里每个元素被标上推断出的 elementRole', () => {
    const b = bindElements([mk({ role: '风格参考' })]);
    expect(b.byRole.style[0].elementRole).toBe('style');
  });
});

describe('v9.4.3 · elementCompleteness', () => {
  it('空 → score 0 / empty + 三条补全提示', () => {
    const c = elementCompleteness([]);
    expect(c.score).toBe(0);
    expect(c.level).toBe('empty');
    expect(c.hints.length).toBe(3);
    expect(c.hints.join()).toMatch(/角色.*风格.*场景|角色/);
  });

  it('只有角色 → 40 / minimal + 仍提示加风格/场景', () => {
    const c = elementCompleteness([mk({ elementRole: 'character' })]);
    expect(c.score).toBe(40);
    expect(c.level).toBe('minimal');
    expect(c.hints.join()).toMatch(/风格/);
    expect(c.hints.join()).toMatch(/场景/);
  });

  it('角色+风格+场景 → 85 / rich + 齐全提示', () => {
    const c = elementCompleteness([
      mk({ elementRole: 'character' }), mk({ elementRole: 'style' }), mk({ elementRole: 'scene' }),
    ]);
    expect(c.score).toBe(85);
    expect(c.level).toBe('rich');
    expect(c.hints[0]).toMatch(/齐全|一键成片/);
  });

  it('道具/运镜/音色合计加分 ≤ 15 且封顶 100', () => {
    const c = elementCompleteness([
      mk({ elementRole: 'character' }), mk({ elementRole: 'style' }), mk({ elementRole: 'scene' }),
      mk({ elementRole: 'prop' }), mk({ elementRole: 'motion', kind: 'video' }), mk({ elementRole: 'voice', kind: 'audio' }),
    ]);
    expect(c.score).toBe(100); // 40+25+20+15
    expect(c.counts.prop).toBe(1);
  });
});

describe('v9.4.9 · 元素强度 (cw)', () => {
  it('clampElementWeight: 夹紧 25-125 / 四舍五入 / NaN→默认', () => {
    expect(clampElementWeight(10)).toBe(25);
    expect(clampElementWeight(200)).toBe(125);
    expect(clampElementWeight(87.6)).toBe(88);
    expect(clampElementWeight(NaN)).toBe(ELEMENT_WEIGHT_DEFAULT);
    expect(clampElementWeight('abc')).toBe(ELEMENT_WEIGHT_DEFAULT);
  });

  it('bindElements 暴露首个角色元素的 primaryCharacterWeight(夹紧)', () => {
    const b = bindElements([
      mk({ elementRole: 'character', weight: 130 }),
      mk({ elementRole: 'character', weight: 60 }),
      mk({ elementRole: 'style', weight: 100 }),
    ]);
    expect(b.primaryCharacterWeight).toBe(125); // 首个角色 130 → 夹紧 125
  });

  it('无角色 weight → primaryCharacterWeight undefined', () => {
    expect(bindElements([mk({ elementRole: 'character' })]).primaryCharacterWeight).toBeUndefined();
    expect(bindElements([mk({ elementRole: 'style', weight: 100 })]).primaryCharacterWeight).toBeUndefined();
  });
});
