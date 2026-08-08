/**
 * v12.287 — 角色音色选路重做:22 档目录终于能真正用上(此前恒定只用 4 档)。
 *
 * 这条打脸我自己的 v12.274 —— 那版给 **22 档音色**逐档配了专属韵律,
 * 但主配音链路上**另外 18 档永远轮不到**。挖下去发现是**两层病**:
 *
 * ① `TTSService.assignVoiceToCharacter`(**真正生效的那个**)是在 4 个 `DEFAULT_VOICES` 里
 *    **按名字哈希**挑 —— 完全无视性别与年龄(老年男角可拿到「青年女声」),
 *    且与建角色时 `pickVoiceForCharacter` 的挑选结果**互不相干**。
 * ② 连「好的」那个 `pickVoiceForCharacter` 也只能挑出 4 档 —— 它用 `score > bestScore`,
 *    **同分时永远取目录第一个**,而前 4 档兼容音色恰好覆盖全部 10 种性别×年龄组合。
 *
 * 另注:仓里还躺着第三套 `lib/voice-routing.ts` 的 `voiceForCharacter` / `effectiveVoice`
 * (支持 force > overrides > routing > default 优先级),**生产零调用** —— 三套并存各写各的。
 */
import { describe, it, expect } from 'vitest';
import { VOICE_CATALOG, pickVoiceForCharacter } from '@/lib/character-studio';
import { TTSService } from '@/services/tts.service';

const GENDERS = ['male', 'female'] as const;
const AGES = ['童年', '少年', '青年', '中年', '老年'] as const;
const NAMES = ['林晚', '苏念', '沈清', '白露', '顾行舟', '陆沉', '裴少', '江野'];

describe('v12.287 · pickVoiceForCharacter 同分散列', () => {
  it('零回归:不传 name 时仍取「第一个」,结果与旧版一致(4 档兼容音色)', () => {
    const used = new Set<string>();
    for (const g of GENDERS) for (const a of AGES) {
      used.add(pickVoiceForCharacter({ gender: g, ageGroup: a } as any).voiceId);
    }
    expect(used.size).toBe(4);
    expect([...used].sort()).toEqual(
      ['narrator_female_cn', 'narrator_male_cn', 'young_female_cn', 'young_male_cn'].sort(),
    );
  });

  it('传 name 后,同性别同年龄的多个角色不再撞同一把嗓子', () => {
    const picks = NAMES.slice(0, 4).map((n) =>
      pickVoiceForCharacter({ gender: 'female', ageGroup: '青年' } as any, undefined, n).voiceId);
    expect(new Set(picks).size, '修复前恒为 1').toBeGreaterThan(1);
  });

  it('目录覆盖面显著打开(修复前 10 种组合只能挑出 4 档)', () => {
    const all = new Set<string>();
    for (const g of GENDERS) for (const a of AGES) for (const n of NAMES) {
      all.add(pickVoiceForCharacter({ gender: g, ageGroup: a } as any, undefined, n).voiceId);
    }
    expect(all.size).toBeGreaterThanOrEqual(15);
    expect(all.size).toBeLessThanOrEqual(VOICE_CATALOG.length);
  });

  it('确定性:同名同 traits 多次调用恒定同音色(可复现,不能每次抽奖)', () => {
    const t = { gender: 'female', ageGroup: '青年' } as any;
    const a = pickVoiceForCharacter(t, undefined, '林晚').voiceId;
    for (let i = 0; i < 5; i++) {
      expect(pickVoiceForCharacter(t, undefined, '林晚').voiceId).toBe(a);
    }
  });

  it('散列不越界:挑中的必须仍是并列最高分候选(性别匹配不能被打散)', () => {
    for (const n of NAMES) {
      const v = pickVoiceForCharacter({ gender: 'male', ageGroup: '中年' } as any, undefined, n).voiceId;
      const meta = VOICE_CATALOG.find((x) => x.id === v)!;
      expect(meta.gender, `${n} 挑到了性别不符的音色 ${v}`).toBe('male');
    }
  });
});

describe('v12.287 · assignVoiceToCharacter 不再只在 4 档里哈希', () => {
  const svc: any = new (TTSService as any)();

  it('有 traits → 走与建角色同一套挑选(性别正确)', () => {
    for (const [n, g] of [['老张头', 'male'], ['小囡', 'female'], ['陈教授', 'male']] as const) {
      const v = svc.assignVoiceToCharacter(n, { gender: g, ageGroup: '中年' });
      const meta = VOICE_CATALOG.find((x) => x.id === v)!;
      expect(meta, `${n} 挑出的音色不在目录内`).toBeTruthy();
      expect(meta.gender).toBe(g);
    }
  });

  it('无 traits → 在**全目录**内哈希,而不是只在 4 个默认音色里', () => {
    const picked = new Set(NAMES.map((n) => svc.assignVoiceToCharacter(n)));
    const legacy4 = new Set(['narrator_male_cn', 'narrator_female_cn', 'young_male_cn', 'young_female_cn']);
    // 至少有一个落在旧的 4 档之外 —— 证明候选池真的扩大了
    expect([...picked].some((v) => !legacy4.has(v))).toBe(true);
    for (const v of picked) expect(VOICE_CATALOG.some((x) => x.id === v)).toBe(true);
  });

  it('给了性别 → 分池后哈希,不会挑出异性音色', () => {
    for (const n of NAMES) {
      const v = svc.assignVoiceToCharacter(n, { gender: 'female' });
      expect(VOICE_CATALOG.find((x) => x.id === v)!.gender).toBe('female');
    }
  });

  it('确定性保持:同名多次调用恒定', () => {
    const a = svc.assignVoiceToCharacter('顾行舟');
    for (let i = 0; i < 5; i++) expect(svc.assignVoiceToCharacter('顾行舟')).toBe(a);
  });

  it('空名/无目录不炸', () => {
    expect(() => svc.assignVoiceToCharacter('')).not.toThrow();
    expect(VOICE_CATALOG.some((x) => x.id === svc.assignVoiceToCharacter(''))).toBe(true);
  });
});
