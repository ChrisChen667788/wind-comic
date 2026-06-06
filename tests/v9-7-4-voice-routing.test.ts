/**
 * v9.7.4 — lib/voice-routing 单测(角色 → 音色:性别推断 + 稳定互异路由)。
 */
import { describe, it, expect } from 'vitest';
import { inferGenderFromName, buildVoiceRouting, voiceForCharacter, effectiveVoice, DEFAULT_VOICE_ID } from '@/lib/voice-routing';

describe('v9.7.4 · inferGenderFromName', () => {
  it('称谓 hint 推性别', () => {
    expect(inferGenderFromName('小红姐')).toBe('female');
    expect(inferGenderFromName('王妈妈')).toBe('female');
    expect(inferGenderFromName('张大哥')).toBe('male');
    expect(inferGenderFromName('李先生')).toBe('male');
  });
  it('无 hint / 空 → unknown', () => {
    expect(inferGenderFromName('阿强')).toBe('unknown');
    expect(inferGenderFromName('')).toBe('unknown');
  });
});

describe('v9.7.4 · buildVoiceRouting', () => {
  it('同性别多角色分到不同音色(不撞嗓)', () => {
    const r = buildVoiceRouting(['小红姐', '王妈妈', '张大哥', '李先生']);
    expect(r.get('小红姐')).toBe('young_female_cn');
    expect(r.get('王妈妈')).toBe('narrator_female_cn');
    expect(r.get('小红姐')).not.toBe(r.get('王妈妈'));     // 两女不同嗓
    expect(r.get('张大哥')).toBe('young_male_cn');
    expect(r.get('李先生')).toBe('narrator_male_cn');
    expect(r.get('张大哥')).not.toBe(r.get('李先生'));     // 两男不同嗓
  });

  it('确定性:同名永远同嗓 + 重复/空名跳过', () => {
    const a = buildVoiceRouting(['英雄', '', '英雄', '反派']);
    const b = buildVoiceRouting(['英雄', '反派']);
    expect(a.get('英雄')).toBe(b.get('英雄'));   // 跨调用稳定
    expect(a.has('')).toBe(false);                // 空名不入表
  });

  it('同性别第三人在音色池内回绕(仅 2 女声)', () => {
    const r = buildVoiceRouting(['甲姐', '乙妹', '丙娘']);
    expect(r.get('丙娘')).toBe(r.get('甲姐'));     // idx2 % 2 = 0 回绕
  });
});

describe('v9.7.4 · voiceForCharacter', () => {
  it('有路由用路由,无名兜底默认', () => {
    const r = buildVoiceRouting(['张大哥']);
    expect(voiceForCharacter('张大哥', r)).toBe('young_male_cn');
    expect(voiceForCharacter('')).toBe(DEFAULT_VOICE_ID);
  });
});

describe('v9.7.7 · effectiveVoice 优先级', () => {
  const routing = buildVoiceRouting(['张大哥']); // 张大哥 → young_male_cn
  it('force > override > routing > default', () => {
    expect(effectiveVoice('张大哥', { force: 'narrator_female_cn', overrides: { 张大哥: 'young_female_cn' }, routing })).toBe('narrator_female_cn');
    expect(effectiveVoice('张大哥', { overrides: { 张大哥: 'young_female_cn' }, routing })).toBe('young_female_cn');
    expect(effectiveVoice('张大哥', { routing })).toBe('young_male_cn');
    expect(effectiveVoice('路人', { routing })).toBe(DEFAULT_VOICE_ID);
    expect(effectiveVoice('', {})).toBe(DEFAULT_VOICE_ID);
  });
});
