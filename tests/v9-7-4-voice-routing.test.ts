/**
 * v9.7.4 — lib/voice-routing 单测(角色 → 音色:性别推断 + 稳定互异路由)。
 */
import { describe, it, expect } from 'vitest';
import { inferGenderFromName, buildVoiceRouting, voiceForCharacter, effectiveVoice, DEFAULT_VOICE_ID } from '@/lib/voice-routing';
import { VOICE_CATALOG, resolveCharacterVoice } from '@/lib/character-studio';

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
  /**
   * v12.296 更新:原断言锁的是 4 个**具体 id**(young_female_cn / narrator_female_cn /
   * young_male_cn / narrator_male_cn)—— 那是旧「首 4 档轮转」的产物,而不是契约本身。
   * 收口到 resolveCastVoices 后 id 变了,但真正要守的三件事一件没少,现在直接锁它们:
   * 性别正确、同性别不撞嗓、且**与成片主链路给同一角色的结果一致**(这才是本版的病根)。
   */
  it('同性别多角色分到不同音色(不撞嗓),且性别正确', () => {
    const r = buildVoiceRouting(['小红姐', '王妈妈', '张大哥', '李先生']);
    const genderOf = (n: string) => VOICE_CATALOG.find((v) => v.id === r.get(n))!.gender;
    expect(genderOf('小红姐')).toBe('female');
    expect(genderOf('王妈妈')).toBe('female');
    expect(genderOf('张大哥')).toBe('male');
    expect(genderOf('李先生')).toBe('male');
    expect(r.get('小红姐')).not.toBe(r.get('王妈妈'));     // 两女不同嗓
    expect(r.get('张大哥')).not.toBe(r.get('李先生'));     // 两男不同嗓
  });

  it('不给成年角色配童声(旧实现同分散列会落到 cute_boy_cn)', () => {
    const r = buildVoiceRouting(['张大哥', '李先生', '王妈妈']);
    for (const n of ['张大哥', '李先生', '王妈妈']) {
      const meta = VOICE_CATALOG.find((v) => v.id === r.get(n))!;
      expect(meta.ageGroups, `${n} 拿到 ${meta.id}(${meta.ageGroups?.join('|')})`).not.toEqual(['童年']);
    }
  });

  it('确定性:同名永远同嗓 + 重复/空名跳过', () => {
    const a = buildVoiceRouting(['英雄', '', '英雄', '反派']);
    const b = buildVoiceRouting(['英雄', '反派']);
    expect(a.get('英雄')).toBe(b.get('英雄'));   // 跨调用稳定
    expect(a.has('')).toBe(false);                // 空名不入表
  });

  /**
   * v12.229 更新:原断言锁的是「仅 2 女声 → 第三人 idx2 % 2 = 0 回绕撞嗓」,
   * 那是当时音色目录只有 4 档(男女各 2)的**限制**,而不是想要的行为。
   * 本版把目录扩到 22 档并加了全局去重,同性别第三人现在拿得到独立音色 ——
   * 断言随之改为锁「不撞嗓」这个新契约(语义方向相反,但正是这一版要达成的目标)。
   */
  it('同性别第三人拿到独立音色(目录扩容 + 全局去重后不再回绕撞嗓)', () => {
    const r = buildVoiceRouting(['甲姐', '乙妹', '丙娘']);
    const ids = ['甲姐', '乙妹', '丙娘'].map((n) => r.get(n));
    expect(new Set(ids).size).toBe(3);
  });
});

describe('v9.7.4 · voiceForCharacter', () => {
  it('有路由用路由,无名兜底默认', () => {
    const r = buildVoiceRouting(['张大哥']);
    // v12.296:单角色时必须与全仓唯一入口一致 —— 这正是「重配一镜换嗓」的病根所在
    expect(voiceForCharacter('张大哥', r)).toBe(resolveCharacterVoice('张大哥'));
    expect(voiceForCharacter('')).toBe(DEFAULT_VOICE_ID);
  });
});

describe('v9.7.7 · effectiveVoice 优先级', () => {
  const routing = buildVoiceRouting(['张大哥']);
  const auto = resolveCharacterVoice('张大哥');   // v12.296:不再写死 id,锁的是优先级本身
  it('force > override > routing > default', () => {
    expect(effectiveVoice('张大哥', { force: 'narrator_female_cn', overrides: { 张大哥: 'young_female_cn' }, routing })).toBe('narrator_female_cn');
    expect(effectiveVoice('张大哥', { overrides: { 张大哥: 'young_female_cn' }, routing })).toBe('young_female_cn');
    expect(effectiveVoice('张大哥', { routing })).toBe(auto);
    expect(effectiveVoice('路人', { routing })).toBe(DEFAULT_VOICE_ID);
    expect(effectiveVoice('', {})).toBe(DEFAULT_VOICE_ID);
  });
});
