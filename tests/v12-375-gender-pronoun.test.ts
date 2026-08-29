/**
 * v12.375:柳如烟被配成了「霸道男声」。
 *
 * v12.346 的性别投票读的是分镜的 `visualPrompt` + `sceneDescription`,
 * 中文词表只认名词性称谓(男人/少女/母亲…),英文词表却一直认代词(his/her)。
 * 中英不对称,而 v12.346 的实测集 visualPrompt 全是英文 —— 缺口没露出来。
 * 柳如烟那两个单角色镜的英文 prompt 恰好只写了名字和衣饰
 * (`silver bracelet on wrist`、`pale cyan shirt`),中文里明明白白写着
 * 「残阳勾勒出**她**侧脸轮廓」—— 0 票,于是散列成了男声。
 *
 * 另一半:v12.374 我在 shot-voice 里直接调 resolveCharacterVoice,
 * 而全片音色本该由 voice-cast 统一发放 —— 等于在已有两份实现之外又造了第三份,
 * 重配一镜就可能换嗓,正是 v12.338 花力气防的事。
 */
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { voteGenderFromShots, inferGenderFromScript } from '@/lib/character-gender';
import { pickShotVoice, pickShotSpeaker, isKnownVoiceId, NARRATOR_KEY } from '@/lib/shot-voice';

const shot = (characters: string[], sceneDescription: string, visualPrompt = '') =>
  ({ characters, sceneDescription, visualPrompt });

describe('中文代词进词表', () => {
  it('「她」投女票,「他」投男票', () => {
    expect(inferGenderFromScript([shot(['甲'], '残阳勾勒出她侧脸轮廓')]).get('甲')).toBe('female');
    expect(inferGenderFromScript([shot(['乙'], '他喉结上下滚动')]).get('乙')).toBe('male');
  });

  it('柳如烟的真实镜头文本(原来 0 票)现在判得出女性', () => {
    const real = [
      shot(['柳如烟'], '柳如烟攥紧衣角,指节因用力而发白微微颤抖。室内渐暗,残阳勾勒出她侧脸轮廓,眼中隐隐闪现泪光。',
        'Slow dolly-in on 85mm lens, CU front-facing: Liu Ruyan gripping fabric of pale cyan shirt tightly, silver bracelet on wrist trembling'),
    ];
    const v = voteGenderFromShots(real).get('柳如烟');
    expect(v?.female).toBe(1);
    expect(v?.male).toBe(0);
    expect(v?.verdict).toBe('female');
  });

  it('「其他」「吉他」里的「他」不算男票 —— 这两个词在剧本里很常见', () => {
    for (const text of ['其他人陆续离场', '远处传来吉他声', '其他线索都断了,只剩吉他还在响']) {
      const v = voteGenderFromShots([shot(['丙'], text)]).get('丙');
      expect(v?.male, `「${text}」误判为男`).toBe(0);
    }
  });

  it('「他们」「她们」是复数,归属不清,不投票', () => {
    const v1 = voteGenderFromShots([shot(['丁'], '他们并肩走进院子')]).get('丁');
    expect(v1?.male).toBe(0);
    const v2 = voteGenderFromShots([shot(['戊'], '她们低声交谈')]).get('戊');
    expect(v2?.female).toBe(0);
  });

  it('代词不绕过「只认单角色镜」这条既有约束', () => {
    const v = voteGenderFromShots([shot(['甲', '乙'], '她转身看向他')]);
    expect(v.size).toBe(0);
  });

  it('两边票数接近时仍不给结论(单角色镜里常混进旁人的代词)', () => {
    const shots = [
      shot(['己'], '他推门而入,她正坐在窗边'),
      shot(['己'], '他放下茶盏,她抬眼'),
    ];
    expect(voteGenderFromShots(shots).get('己')?.verdict).toBeUndefined();
  });

  it('名词性称谓照旧有效(没有被代词替换掉)', () => {
    expect(inferGenderFromScript([shot(['庚'], '一位妇人立于门前')]).get('庚')).toBe('female');
    expect(inferGenderFromScript([shot(['辛'], 'young Chinese man with bronze tan complexion')]).get('辛')).toBe('male');
  });
});

describe('shot-voice:音色向唯一入口领,不自己挑', () => {
  it('cast 命中优先 —— 成片与重配单镜必须同一个嗓', () => {
    const cast = new Map([['柳如烟', 'young_female_cn']]);
    expect(pickShotVoice({ characters: ['柳如烟'] }, cast)).toBe('young_female_cn');
  });

  it('cast 里的脏数据不放行 —— 历史记录里可能躺着 female-zh', () => {
    const dirty = new Map([['柳如烟', 'female-zh'], ['李长安', '']]);
    const v1 = pickShotVoice({ characters: ['柳如烟'] }, dirty);
    expect(v1).not.toBe('female-zh');
    expect(isKnownVoiceId(v1)).toBe(true);
    expect(isKnownVoiceId(pickShotVoice({ characters: ['李长安'] }, dirty))).toBe(true);
  });

  it('没有 cast 时退回按名解析,结果仍在目录内', () => {
    for (const c of [undefined, null, new Map()] as any[]) {
      expect(isKnownVoiceId(pickShotVoice({ characters: ['柳如烟'] }, c))).toBe(true);
    }
  });

  it('pickShotSpeaker 只回答「谁在说」:显式 speaker > 单角色 > 旁白', () => {
    expect(pickShotSpeaker({ speaker: '李长安', characters: ['柳如烟'] })).toBe('李长安');
    expect(pickShotSpeaker({ characters: ['柳如烟'] })).toBe('柳如烟');
    expect(pickShotSpeaker({ characters: ['柳如烟', '李长安'] })).toBe(NARRATOR_KEY);
    expect(pickShotSpeaker(null)).toBe(NARRATOR_KEY);
  });

  it('cast 按说话人取,而不是按镜头里第一个角色', () => {
    const cast = new Map([['李长安', 'young_male_cn'], ['柳如烟', 'young_female_cn']]);
    expect(pickShotVoice({ speaker: '柳如烟', characters: ['李长安'] }, cast)).toBe('young_female_cn');
  });
});

describe('recompose 接线', () => {
  const src = fs.readFileSync(path.join(process.cwd(), 'app/api/projects/[id]/recompose/route.ts'), 'utf-8');
  const code = src.split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');

  it('重生配音前先向 voice-cast 领整片音色表', () => {
    // 锚点要语义唯一:`for (const c of clips)` 在上面的广告净化段先出现过一次,
    // indexOf 会命中那一处,窗口长度变负 → 切出空串 → 断言以错误的理由红。
    const start = code.indexOf('tts-providers/builtins');
    const end = code.indexOf('dispatchTTSGenerate', start);
    expect(start).toBeGreaterThan(0);
    expect(end).toBeGreaterThan(start);   // 窗口无效必须显式失败,不能悄悄变成空串
    expect(code.slice(start, end)).toContain('resolveAndPersistCast');
  });

  it('领表失败不阻塞重生 —— 音色表是增强项', () => {
    const i = code.indexOf('resolveAndPersistCast(');
    const win = code.slice(i, i + 400);
    expect(win).toContain('catch');
  });

  it('挑音色时把 cast 传下去了(否则领了也白领)', () => {
    expect(code).toContain('pickShotVoice(c, cast)');
  });
});
