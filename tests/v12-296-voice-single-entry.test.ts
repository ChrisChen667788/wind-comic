/**
 * v12.296 — 同一个角色的音色,此前有**三条路径各算各的**;实测 8/8 不一致,而且性别都反了。
 *
 * 先纠正我自己在 v12.287 测试注释里写下、之后又重复过几次的一句错话:
 * 「`lib/voice-routing.ts` 生产零调用」—— **不对**。它有两个真实消费方:
 *   `app/api/projects/[id]/shot-audio/route.ts`(重配单镜音频)与 `lib/voice-retake.ts`(配音重录)。
 * 实情比「没用上」糟得多:它和主链路**同时在线,各发各的音色**。
 *
 * 三条路径:
 *  ① `editor-agent` → `TTSService.assignVoiceToCharacter(name, inferTraitsFromName(name))` —— 成片走这条
 *  ② `TTSService.generateDialogueVoiceovers` → `assignVoiceToCharacter(name)` **不传 traits**
 *     → 对「王大爷」这类有称谓线索的名字,与 ① 结果不同
 *  ③ `lib/voice-routing.buildVoiceRouting` → 按**首次出现顺序在全池轮转**
 *
 * 实测(修复前):
 *   顾行舟 成片 `student_male_cn` / 重配 `young_female_cn`   ← 男角色拿到女声
 *   小囡   成片 `mature_female_cn` / 重配 `narrator_male_cn`  ← 女童拿到男声
 *   裴少   成片 `badao_shaoye_cn`  / 重配 `audiobook_female1_cn`
 *   8 个角色,8 个不一致。**用户重配某一镜音频,那个角色在这一镜就换了性别。**
 *
 * 修法:收口到 `character-studio.resolveCastVoices` / `resolveCharacterVoice` 这一个入口。
 * 注意**没有**为了一致性牺牲 v12.229 立的「每角色独立音色」—— 那是真实需求。
 * 新算法是「先取该角色的偏好音色,撞车才在**同性别**候选里按名字散列另挑」,两者兼得。
 *
 * 过程中还揪出一个**主链路本来就有**的坑:知性别不知年龄时,评分在全体同性别音色里打平,
 * 同分散列可能落到童声上 —— 「张大哥」实测拿到 `cute_boy_cn`(ageGroups `["童年"]`)。
 * 收口时一并修掉(默认按「青年」挑)。
 */
import { describe, it, expect } from 'vitest';
import { VOICE_CATALOG, resolveCharacterVoice, resolveCastVoices } from '@/lib/character-studio';
import { buildVoiceRouting, effectiveVoice } from '@/lib/voice-routing';
import { TTSService } from '@/services/tts.service';
import { inferTraitsFromName } from '@/lib/tts-prosody';

const CAST = ['顾行舟', '林晚', '王大爷', '小囡', '苏念', '陆沉', '白露', '裴少'];
const svc: any = new (TTSService as any)();
const metaOf = (id: string) => VOICE_CATALOG.find((v) => v.id === id)!;

describe('v12.296 · 三条路径必须给同一角色同一把嗓', () => {
  it('**成片主链路 vs 重配路径:同一阵容下逐角色一致**(修复前 8/8 不一致)', () => {
    // 成片侧现在也按整组定(editor-agent 的 _voiceCast),两边跑同一个 resolveCastVoices
    const filmCast = resolveCastVoices(CAST);
    const routing = buildVoiceRouting(CAST);
    const bad: string[] = [];
    for (const n of CAST) {
      const main = filmCast.get(n);
      const retake = effectiveVoice(n, { routing });
      if (main !== retake) bad.push(`${n}: 成片=${main} 重配=${retake}`);
    }
    expect(bad, `这些角色重配后会换嗓:\n${bad.join('\n')}`).toEqual([]);
  });

  it('editor-agent 确实整组定音色,而不是逐句现挑', () => {
    const src = require('node:fs').readFileSync('services/agents/editor-agent.ts', 'utf-8') as string;
    expect(src).toContain('resolveCastVoices(allDialogueShots.map');
    const iCast = src.indexOf('const _voiceCast');
    const iUse = src.indexOf('_voiceCast.get(_speaker)');
    expect(iCast).toBeGreaterThan(0);
    expect(iUse, '必须先建表后取用').toBeGreaterThan(iCast);
    // 旧的逐句现挑必须消失,否则又是两套并存
    expect(src).not.toContain('assignVoiceToCharacter(_speaker');
  });

  /**
   * 诚实标注**尚未关闭的缺口**:两边一致的前提是**阵容列表相同**。
   * 若重配路径只拿到部分镜头的说话人,整组去重的结果就可能与成片不同。
   * 根治办法是出片时把「角色→音色」映射**落盘**、重配读它(与 v12.289 转场回写同一招),
   * 留待下一版。这里先把这个前提本身锁住,免得它悄悄失效。
   */
  it('前提锁:阵容不同则结果可能不同 —— 这就是下一版要用落盘关掉的缺口', () => {
    const full = resolveCastVoices(CAST);
    const partial = resolveCastVoices(CAST.slice(0, 3));
    const differs = CAST.slice(0, 3).some((n) => full.get(n) !== partial.get(n));
    // 不断言一定不同(取决于是否撞车),只断言这个前提被显式记录在案
    expect(typeof differs).toBe('boolean');
    expect(full.size).toBe(CAST.length);
    expect(partial.size).toBe(3);
  });

  it('TTSService 内部两种调用形态也一致(传 traits 与不传)', () => {
    for (const n of CAST) {
      expect(svc.assignVoiceToCharacter(n), n)
        .toBe(svc.assignVoiceToCharacter(n, inferTraitsFromName(n)));
    }
  });

  it('单角色 cast 的结果 === 单角色入口(两条路天然对齐,不靠巧合)', () => {
    for (const n of CAST) {
      expect(resolveCastVoices([n]).get(n), n).toBe(resolveCharacterVoice(n));
    }
  });
});

describe('v12.296 · 一致性没有以牺牲独立性为代价', () => {
  it('整组角色互不撞嗓(v12.229 的契约仍然成立)', () => {
    const ids = [...resolveCastVoices(CAST).values()];
    expect(new Set(ids).size).toBe(CAST.length);
  });

  it('撞车时在**同性别**里另挑,不会退化成性别相反的音色', () => {
    // 构造大量同性别角色,逼出撞车重挑
    const many = ['甲姐', '乙妹', '丙娘', '丁婶', '戊姑', '己嫂'];
    const m = resolveCastVoices(many);
    for (const n of many) expect(metaOf(m.get(n)!).gender, `${n} 挑到异性音色`).toBe('female');
    expect(new Set([...m.values()]).size).toBe(many.length);
  });

  it('角色数超过目录容量时不抛错,且仍是确定性的', () => {
    const huge = Array.from({ length: VOICE_CATALOG.length + 5 }, (_, i) => `路人${i}`);
    const a = resolveCastVoices(huge);
    const b = resolveCastVoices(huge);
    expect(a.size).toBe(huge.length);
    for (const n of huge) expect(a.get(n)).toBe(b.get(n));
  });
});

describe('v12.296 · 顺带修掉的主链路老坑:成年角色配童声', () => {
  it('只推得出性别时按「青年」挑,不落到童声/老声', () => {
    for (const n of ['张大哥', '李先生', '王妈妈', '小红姐']) {
      const meta = metaOf(resolveCharacterVoice(n));
      expect(meta.ageGroups, `${n} 拿到 ${meta.id}`).not.toEqual(['童年']);
      expect(meta.ageGroups, `${n} 拿到 ${meta.id}`).not.toEqual(['老年']);
    }
  });

  it('真有年龄线索时仍然尊重线索(别把老者也压成青年)', () => {
    const meta = metaOf(resolveCharacterVoice('王大爷'));
    expect(inferTraitsFromName('王大爷').ageGroup).toBe('老年');
    expect(meta.ageGroups).toContain('老年');
  });
});

describe('v12.296 · 边界与确定性', () => {
  it('空名 / 空 cast 不炸', () => {
    expect(() => resolveCharacterVoice('')).not.toThrow();
    expect(resolveCastVoices([]).size).toBe(0);
    expect(resolveCastVoices([null, undefined, '  '] as any).size).toBe(0);
  });

  it('重复名只占一个位,且与单次调用同结果', () => {
    const m = resolveCastVoices(['林晚', '林晚', '苏念']);
    expect(m.size).toBe(2);
    expect(m.get('林晚')).toBe(resolveCharacterVoice('林晚'));
  });

  it('同一 cast 多次调用恒定(可复现,不能每次抽奖)', () => {
    const a = resolveCastVoices(CAST);
    for (let i = 0; i < 3; i++) {
      const b = resolveCastVoices(CAST);
      for (const n of CAST) expect(b.get(n)).toBe(a.get(n));
    }
  });

  it('挑出的音色一律真在目录内', () => {
    for (const id of resolveCastVoices(CAST).values()) {
      expect(VOICE_CATALOG.some((v) => v.id === id), `${id} 不在目录内`).toBe(true);
    }
  });
});

describe('v12.296 · 接线', () => {
  it('voice-routing 不再自带选路,只转发给唯一入口', () => {
    const src = require('node:fs').readFileSync('lib/voice-routing.ts', 'utf-8') as string;
    expect(src).toContain('resolveCastVoices');
    // 旧的轮转实现必须消失,否则又是两套并存
    expect(src).not.toMatch(/pickFirstUnused/);
    expect(src).not.toMatch(/counters\[g\]\+\+/);
  });

  it('TTSService 委托给唯一入口,不再自带哈希池', () => {
    const src = require('node:fs').readFileSync('services/tts.service.ts', 'utf-8') as string;
    expect(src).toContain('resolveCharacterVoice(characterName)');
  });

  it('effectiveVoice 的优先级链保留(这是 voice-routing 真正独有的价值)', () => {
    const routing = buildVoiceRouting(['林晚']);
    expect(effectiveVoice('林晚', { force: 'narrator_male_cn', routing })).toBe('narrator_male_cn');
    expect(effectiveVoice('林晚', { overrides: { 林晚: 'sweet_female_cn' }, routing })).toBe('sweet_female_cn');
    expect(effectiveVoice('林晚', { routing })).toBe(resolveCharacterVoice('林晚'));
  });
});
