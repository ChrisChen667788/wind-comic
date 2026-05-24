/**
 * v6.0 — 角色资产中心 (Character Studio) 纯逻辑单测.
 */

import { describe, it, expect } from 'vitest';
import type { CharacterTraits } from '@/lib/character-traits';
import type { CharacterDna } from '@/lib/character-dna';
import {
  TURNAROUND_VIEWS,
  VOICE_CATALOG,
  buildTurnaroundPrompts,
  pickVoiceForCharacter,
  composeCharacterBio,
  buildCharacterProfile,
} from '@/lib/character-studio';

function traits(p: Partial<CharacterTraits> = {}): CharacterTraits {
  return {
    name: '林小满', gender: 'female', ageGroup: '青年',
    build: '纤细中等身高', skinTone: '白皙', appearance: '黑长直发, 瓜子脸, 眼神倔强',
    costume: '素白校服', personality: '倔强 隐忍', signature: '左腕红绳', confident: true,
    ...p,
  };
}

describe('v6.0 · buildTurnaroundPrompts', () => {
  it('默认出全部四视图, 顺序 front→three_quarter→side→back', () => {
    const out = buildTurnaroundPrompts({ name: '阿река' });
    expect(out.map((v) => v.id)).toEqual(['front', 'three_quarter', 'side', 'back']);
    expect(out).toHaveLength(TURNAROUND_VIEWS.length);
  });

  it('每条 prompt 含 名字 + 机位指令 + 一致性约束(model sheet)', () => {
    const out = buildTurnaroundPrompts({ name: '林小满', style: '国风动漫' });
    const front = out.find((v) => v.id === 'front')!;
    expect(front.prompt).toContain('林小满');
    expect(front.prompt).toContain('front view');
    expect(front.prompt).toContain('character model sheet');
    expect(front.prompt).toContain('国风动漫');
    const back = out.find((v) => v.id === 'back')!;
    expect(back.prompt).toContain('back view');
  });

  it('注入 DNA promptBlock 作身份锁', () => {
    const out = buildTurnaroundPrompts({ name: '林小满', dnaPromptBlock: '林小满 visual DNA: eyes: almond; hair: long ponytail' });
    expect(out[0].prompt).toContain('visual DNA');
  });

  it('views 参数可只出指定视图', () => {
    const out = buildTurnaroundPrompts({ name: 'X', views: ['front', 'side'] });
    expect(out.map((v) => v.id)).toEqual(['front', 'side']);
  });

  it('空名字也不崩 (退化成 the character)', () => {
    const out = buildTurnaroundPrompts({ name: '' });
    expect(out[0].prompt).toContain('the character');
  });
});

describe('v6.0 · pickVoiceForCharacter', () => {
  it('青年女 → 青年女声 (matched)', () => {
    const r = pickVoiceForCharacter(traits({ gender: 'female', ageGroup: '青年' }));
    expect(r.voiceId).toBe('young_female_cn');
    expect(r.matched).toBe(true);
  });
  it('中年男 → 成熟男声', () => {
    expect(pickVoiceForCharacter(traits({ gender: 'male', ageGroup: '中年' })).voiceId).toBe('narrator_male_cn');
  });
  it('童年女 → 青年女声 (童年归 young 桶)', () => {
    expect(pickVoiceForCharacter(traits({ gender: 'female', ageGroup: '童年' })).voiceId).toBe('young_female_cn');
  });
  it('性别 unknown + 年龄未明示 → 兜底 (matched=false)', () => {
    const r = pickVoiceForCharacter(traits({ gender: 'unknown', ageGroup: '未明示' }));
    expect(r.matched).toBe(false);
    expect(VOICE_CATALOG.some((v) => v.id === r.voiceId)).toBe(true);
  });
  it('null traits → 兜底不崩', () => {
    expect(pickVoiceForCharacter(null).voiceId).toBeTruthy();
  });
  it('只有性别命中 (年龄未明示) 也算 matched', () => {
    const r = pickVoiceForCharacter(traits({ gender: 'male', ageGroup: '未明示' }));
    expect(r.matched).toBe(true);
    expect(VOICE_CATALOG.find((v) => v.id === r.voiceId)!.gender).toBe('male');
  });
});

describe('v6.0 · composeCharacterBio', () => {
  it('含名字 + 年龄性别 + 外观, 跳过未明示字段', () => {
    const bio = composeCharacterBio(traits({ costume: '未明示', signature: '未明示' }));
    expect(bio).toContain('林小满');
    expect(bio).toContain('青年女性');
    expect(bio).toContain('黑长直发');
    expect(bio).not.toContain('未明示');
    expect(bio).not.toContain('常着'); // costume 未明示 → 不出"常着"句
  });
  it('全未明示时只剩名字句, 不硬凑', () => {
    const bio = composeCharacterBio(traits({
      gender: 'unknown', ageGroup: '未明示', build: '未明示', skinTone: '未明示',
      appearance: '未明示', costume: '未明示', personality: '未明示', signature: '未明示',
    }));
    expect(bio).toBe('林小满。');
  });
});

describe('v6.0 · buildCharacterProfile', () => {
  it('打包小传 + 音色 + 多视角 + 身份块', () => {
    const p = buildCharacterProfile({ traits: traits(), style: 'cinematic realism' });
    expect(p.name).toBe('林小满');
    expect(p.bio).toContain('林小满');
    expect(p.voiceId).toBe('young_female_cn');
    expect(p.turnaround).toHaveLength(4);
    expect(p.identityBlock).toContain('林小满');
    expect(p.turnaround[0].prompt).toContain('cinematic realism');
  });

  it('dna.promptBlock 优先作身份块, 并注入 turnaround', () => {
    const dna: CharacterDna = {
      name: '林小满', sourceImageUrl: 'http://x/y.png',
      signature: { eyeShape: 'almond', hairStyle: 'long ponytail' },
      promptBlock: '林小满 visual DNA: eyes: almond; hair: long ponytail',
    };
    const p = buildCharacterProfile({ name: '林小满', traits: traits(), dna });
    expect(p.identityBlock).toBe(dna.promptBlock);
    expect(p.turnaround[0].prompt).toContain('visual DNA');
  });

  it('无 traits 无 dna 也不崩 (名字兜底 + 仍出四视图)', () => {
    const p = buildCharacterProfile({ name: '无名氏' });
    expect(p.name).toBe('无名氏');
    expect(p.bio).toBe('无名氏。');
    expect(p.turnaround).toHaveLength(4);
    expect(p.voiceId).toBeTruthy();
  });
});
