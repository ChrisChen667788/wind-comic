/**
 * v12.288 — 出片链路的音色按**角色**定,不再按**台词情绪**猜。
 *
 * 本版揭出的是整条音色链上最要命的一环 —— 前面 v12.229(扩到 22 档)、v12.274(逐档配韵律)、
 * v12.287(打开选路覆盖面)修的都是**支路**;真正出片的 `editor-agent` 里写的是:
 *
 *     const _gender = t.emotion.match(/温柔|哭|委屈|姐|妹|母/) ? 'female' : 'male';
 *     voiceId: _gender === 'female' ? 'female-zh' : 'male-zh'
 *
 * 三重问题:
 *   ① 性别从**这句台词的情绪**推 → **同一个角色会在镜与镜之间换嗓**(这句「温柔」女声、下句「愤怒」男声);
 *   ② 全片只有 2 个写死 id,且**不在 VOICE_CATALOG 内** —— 前三版的成果一个都没用上;
 *   ③ `t.speaker`(角色名)**就在手边**,同一处的 prosody 纠偏(v12.203)早就在用它了。
 */
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import { TTSService } from '@/services/tts.service';
import { VOICE_CATALOG } from '@/lib/character-studio';
import { inferTraitsFromName, characterProsodyBias } from '@/lib/tts-prosody';

const SRC = fs.readFileSync('services/agents/editor-agent.ts', 'utf-8');
const svc: any = new (TTSService as any)();
/** 复刻旧逻辑,用于对照 */
const oldPick = (emotion: string) => (emotion.match(/温柔|哭|委屈|姐|妹|母/) ? 'female-zh' : 'male-zh');

describe('v12.288 · 同一角色全片恒定同音色(旧逻辑会换嗓)', () => {
  const EMOTIONS = ['愤怒', '温柔', '绝望', '冷静', '哭泣'];

  it('对照:旧逻辑同一角色在不同情绪下确实会换嗓', () => {
    expect(new Set(EMOTIONS.map(oldPick)).size, '旧逻辑本就该是坏的').toBeGreaterThan(1);
  });

  it('新逻辑:同一角色跨 5 种情绪恒定一把嗓', () => {
    const picks = EMOTIONS.map(() => svc.assignVoiceToCharacter('顾行舟', inferTraitsFromName('顾行舟')));
    expect(new Set(picks).size).toBe(1);
  });

  it('不同角色仍能区分(不是一刀切成同一个)', () => {
    const names = ['顾行舟', '林晚', '王大爷', '小囡'];
    const picks = names.map((n) => svc.assignVoiceToCharacter(n, inferTraitsFromName(n)));
    expect(new Set(picks).size, '旧逻辑上限 2').toBeGreaterThan(2);
    for (const v of picks) expect(VOICE_CATALOG.some((x) => x.id === v), `${v} 不在目录内`).toBe(true);
  });

  it('挑出的音色必须真在 VOICE_CATALOG 内(旧的 female-zh/male-zh 压根不在)', () => {
    expect(VOICE_CATALOG.some((x) => x.id === 'female-zh')).toBe(false);
    expect(VOICE_CATALOG.some((x) => x.id === 'male-zh')).toBe(false);
    const v = svc.assignVoiceToCharacter('林晚', inferTraitsFromName('林晚'));
    expect(VOICE_CATALOG.some((x) => x.id === v)).toBe(true);
  });
});

describe('v12.288 · 角色名推断与 prosody 同源', () => {
  it('有明确称谓线索时推得出性别/年龄', () => {
    expect(inferTraitsFromName('王大爷')).toEqual({ gender: 'male', ageGroup: '老年' });
    expect(inferTraitsFromName('男孩')).toEqual({ gender: 'male', ageGroup: '童年' });
    expect(inferTraitsFromName('老张头').ageGroup).toBe('老年');
  });

  it('诚实:多数中文人名判不出 → 返回空,由调用方退回哈希(不瞎猜)', () => {
    for (const n of ['顾行舟', '林晚', '苏念']) {
      expect(inferTraitsFromName(n)).toEqual({});
    }
    expect(inferTraitsFromName('')).toEqual({});
    expect(inferTraitsFromName(null)).toEqual({});
  });

  it('与 prosody 口径一致:老者名同时触发「慢语速」与「老年音色」', () => {
    // 词表共用 —— 若哪天两处分叉,这条会红
    expect(characterProsodyBias('王大爷').speedMul).toBeLessThan(1.0);
    expect(inferTraitsFromName('王大爷').ageGroup).toBe('老年');
  });

  it('推出老年 → 挑到的音色其年龄段应覆盖老年', () => {
    const v = svc.assignVoiceToCharacter('王大爷', inferTraitsFromName('王大爷'));
    const meta = VOICE_CATALOG.find((x) => x.id === v)!;
    expect(meta.gender).toBe('male');
    expect(meta.ageGroups).toContain('老年');
  });
});

describe('v12.288 · 接线与降级', () => {
  // v12.296 更新:选音色从「逐句现挑 assignVoiceToCharacter(_speaker)」改成
  // 「整组一次性定好的 _voiceCast 里取」—— 逐句挑看不到全片阵容,与重配路径天生对不齐。
  it('editor-agent 用 speaker 选音色,两个 TTS 通道用同一把嗓', () => {
    expect(SRC).toContain('const _speaker');
    expect(SRC).toContain('_voiceCast.get(_speaker)');
    // plugin 通道与注册表通道都必须用 _voiceId,不能一个新一个旧
    expect((SRC.match(/voiceId: _voiceId/g) || []).length).toBe(2);
  });

  it('无角色名(旁白等)退回旧的情绪兜底,不炸', () => {
    expect(SRC).toMatch(/let _voiceId = _gender === 'female' \? 'female-zh' : 'male-zh'/);
    expect(SRC).toContain('if (_speaker)');
  });

  it('取音色失败不阻塞配音', () => {
    // 阵容表构建本身包 try/catch(失败退空表),取用处再退回单角色入口且同样包 catch
    const iCast = SRC.indexOf('const _voiceCast');
    expect(SRC.slice(iCast, iCast + 400)).toContain('catch');
    const iUse = SRC.indexOf('_voiceCast.get(_speaker)');
    expect(SRC.slice(iUse, iUse + 800)).toContain('catch');
  });

  it('保留病根说明(防后人以为是冗余分支删掉)', () => {
    const i = SRC.indexOf('v12.288:角色音色按');
    const block = SRC.slice(i, i + 800);
    expect(block).toMatch(/换嗓|情绪/);
    expect(block).toContain('t.speaker');
  });
});
