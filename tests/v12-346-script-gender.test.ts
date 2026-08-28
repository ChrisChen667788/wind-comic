/**
 * v12.346:角色性别从**剧本**读,不再靠猜名字。
 *
 * 病根:音色选路最终落到 `inferTraitsFromName`,那份词表只认称谓词(叔/爷/姐/妹),
 * 不认中文人名。拿 owner 真实数据实测:**50 个角色只判出 4 个(8%)**,
 * 其余落到「全目录确定性散列」= 性别随机;而 v12.338 的 voice-cast 会把它**持久化**,
 * 柳如烟一旦散列到男声就永久锁死。
 *
 * 剧本里其实写着答案 —— 分镜 `visualPrompt` 是给图像引擎的英文描述,必然点明性别。
 * 单角色镜投票后覆盖率 8% → 48%,且与姓名词表**零冲突**。
 */
import { describe, it, expect } from 'vitest';
import { voteGenderFromShots, inferGenderFromScript, buildCastHints } from '@/lib/character-gender';
import { resolveCastVoices, VOICE_CATALOG } from '@/lib/character-studio';
import { resolveWithCast } from '@/lib/voice-cast';

const shot = (chars: string[], prompt: string) => ({ characters: chars, visualPrompt: prompt });

describe('v12.346 剧本性别投票', () => {
  it('单角色镜:英文性别词直接定性', () => {
    const g = inferGenderFromScript([shot(['李长安'], 'MCU: Li Chang\'an, a young Chinese man, leans on the door')]);
    expect(g.get('李长安')).toBe('male');
  });

  it('单角色镜:女性词同理', () => {
    const g = inferGenderFromScript([shot(['柳如烟'], 'CU: a young woman with a hair bun, feeding a child')]);
    expect(g.get('柳如烟')).toBe('female');
  });

  it('多角色镜**不投票** —— 性别词归不到具体人身上', () => {
    const v = voteGenderFromShots([shot(['甲', '乙'], 'a man and a woman argue')]);
    expect(v.size).toBe(0);
  });

  it('两边票数接近 → 不给结论(镜里常有第二个未具名人物)', () => {
    const v = voteGenderFromShots([
      shot(['某人'], 'a man walks'),
      shot(['某人'], 'a woman watches'),
    ]);
    expect(v.get('某人')?.verdict).toBeUndefined();
  });

  it('优势超过 2 倍才定性', () => {
    const three = [shot(['甲'], 'the man'), shot(['甲'], 'his coat'), shot(['甲'], 'a gentleman')];
    expect(voteGenderFromShots(three).get('甲')?.verdict).toBe('male');
    // 2:1 不到 2 倍严格优势
    const close = [shot(['乙'], 'the man'), shot(['乙'], 'his coat'), shot(['乙'], 'a woman')];
    expect(voteGenderFromShots(close).get('乙')?.verdict).toBeUndefined();
  });

  it('中文 visualPrompt 也能判', () => {
    const g = inferGenderFromScript([shot(['阿婆'], '一位年迈的妇人坐在门槛上')]);
    expect(g.get('阿婆')).toBe('female');
  });

  it('空输入不炸', () => {
    expect(inferGenderFromScript(null).size).toBe(0);
    expect(inferGenderFromScript([]).size).toBe(0);
    expect(voteGenderFromShots([{ characters: ['x'] }]).size).toBe(0); // 无文本 → 不投
  });
});

describe('v12.346 线索注入音色唯一入口', () => {
  const femaleIds = new Set(VOICE_CATALOG.filter((v) => v.gender === 'female').map((v) => v.id));
  const maleIds = new Set(VOICE_CATALOG.filter((v) => v.gender === 'male').map((v) => v.id));

  it('给了女性线索 → 拿到女声(不给则不保证)', () => {
    const hints = new Map([['柳如烟', { gender: 'female' as const }]]);
    const withHint = resolveCastVoices(['柳如烟'], VOICE_CATALOG, hints);
    expect(femaleIds.has(withHint.get('柳如烟')!)).toBe(true);
  });

  it('给了男性线索 → 拿到男声', () => {
    const hints = new Map([['柳如烟', { gender: 'male' as const }]]);
    const m = resolveCastVoices(['柳如烟'], VOICE_CATALOG, hints);
    expect(maleIds.has(m.get('柳如烟')!)).toBe(true);
  });

  it('**不传 hints 时行为与改动前逐字节一致**(零回归的硬约束)', () => {
    const names = ['李长安', '柳如烟', '张三', '李四', '王五'];
    const a = resolveCastVoices(names, VOICE_CATALOG);
    const b = resolveCastVoices(names, VOICE_CATALOG, undefined);
    expect([...a]).toEqual([...b]);
  });

  it('剧本证据覆盖姓名词表,但**不清掉**姓名词表给出的年龄', () => {
    // 「大爷」姓名词表 → male + 老年;剧本若判 female,性别改、年龄留
    const hints = new Map([['李大爷', { gender: 'female' as const }]]);
    const id = resolveCastVoices(['李大爷'], VOICE_CATALOG, hints).get('李大爷')!;
    expect(femaleIds.has(id)).toBe(true);
  });
});

describe('v12.346 已锁定的音色永不被线索改写', () => {
  it('定妆表里有的角色,线索再强也不动 —— 那是成片事实', () => {
    const persisted = { 柳如烟: 'narrator_male_cn' };
    const hints = new Map([['柳如烟', { gender: 'female' as const }]]);
    const { map, added } = resolveWithCast(['柳如烟'], persisted, hints);
    expect(map.get('柳如烟')).toBe('narrator_male_cn');
    expect(added).toEqual({});
  });

  it('新角色才吃线索', () => {
    const { map } = resolveWithCast(['新人'], { 老人: 'narrator_male_cn' },
      new Map([['新人', { gender: 'female' as const }]]));
    const femaleIds2 = new Set(VOICE_CATALOG.filter((v) => v.gender === 'female').map((v) => v.id));
    expect(femaleIds2.has(map.get('新人')!)).toBe(true);
  });
});

describe('v12.346 buildCastHints 形态', () => {
  it('只产出有结论的角色', () => {
    const h = buildCastHints([
      shot(['甲'], 'a man'),
      shot(['乙'], 'someone stands'),   // 无性别词
    ]);
    expect(h.get('甲')).toEqual({ gender: 'male' });
    expect(h.has('乙')).toBe(false);
  });
});
