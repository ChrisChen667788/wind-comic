/**
 * lib/voice-routing (v9.7.4) — 批量配音音色按角色路由(纯逻辑,零依赖于 DB)。
 *
 * 之前 shot-audio 全片一个嗓;这里按角色名给每个角色**稳定且互异**的音色:
 *   - 从角色名推性别(常见称谓 hint),选性别匹配的音色池;
 *   - 同性别多角色在池内轮转(避免撞嗓),未知性别在全部音色里轮转;
 *   - 首次出现顺序决定分配 → 确定性(同名永远同嗓、跨镜一致)。
 * 复用 character-studio 的 `VOICE_CATALOG`(青年/成熟 × 男/女 + gender/ageGroups/tone)。
 * 单测 tests/v9-7-4-voice-routing.test.ts。
 */
import { VOICE_CATALOG, type VoiceMeta } from './character-studio';

export const DEFAULT_VOICE_ID = 'narrator_male_cn';

const FEMALE_HINT = /女|姐|妹|妈|母|婆|姑|娘|嫂|奶|妃|公主|小姐|夫人|姨|嬷|娥|婷|丽|芳/;
const MALE_HINT = /男|哥|弟|爸|父|叔|伯|爷|先生|少爷|公子|郎|侠|帝|将军|大叔/;

export type RoutedGender = 'male' | 'female' | 'unknown';

/** 从角色名推性别(常见中文称谓 hint;无 hint → unknown)。 */
export function inferGenderFromName(name: string): RoutedGender {
  const n = (name || '').trim();
  if (!n) return 'unknown';
  const female = FEMALE_HINT.test(n);
  const male = MALE_HINT.test(n);
  if (female && !male) return 'female';
  if (male && !female) return 'male';
  return 'unknown';
}

/**
 * 给一组角色名(允许重复 / 空)分配音色:首次出现顺序 + 性别池内轮转 → 稳定互异。
 * 返回 Map<角色名, voiceId>。
 */
export function buildVoiceRouting(names: string[], catalog: VoiceMeta[] = VOICE_CATALOG): Map<string, string> {
  const map = new Map<string, string>();
  const pool = catalog.length ? catalog : [];
  const males = pool.filter((v) => v.gender === 'male');
  const females = pool.filter((v) => v.gender === 'female');
  const counters = { male: 0, female: 0, unknown: 0 };

  for (const raw of Array.isArray(names) ? names : []) {
    const n = (raw || '').trim();
    if (!n || map.has(n)) continue;
    const g = inferGenderFromName(n);
    const bucket = g === 'female' ? (females.length ? females : pool)
      : g === 'male' ? (males.length ? males : pool)
        : pool;
    const idx = counters[g]++;
    const pick = bucket.length ? bucket[idx % bucket.length] : null;
    map.set(n, pick?.id || DEFAULT_VOICE_ID);
  }
  return map;
}

/** 单角色取音色(基于全片路由;名缺 → 默认)。便于无路由场景兜底。 */
export function voiceForCharacter(name: string, routing?: Map<string, string>): string {
  const n = (name || '').trim();
  if (!n) return DEFAULT_VOICE_ID;
  if (routing && routing.has(n)) return routing.get(n)!;
  return buildVoiceRouting([n]).get(n) || DEFAULT_VOICE_ID;
}

/**
 * 有效音色优先级:全片强制 force > 用户手动覆盖 overrides[角色] > 自动路由 routing > 默认。
 */
export function effectiveVoice(
  speaker: string,
  opts: { force?: string; overrides?: Record<string, string>; routing?: Map<string, string> } = {},
): string {
  if (opts.force && opts.force.trim()) return opts.force.trim();
  const n = (speaker || '').trim();
  if (n && opts.overrides && opts.overrides[n]) return opts.overrides[n];
  if (n && opts.routing && opts.routing.has(n)) return opts.routing.get(n)!;
  return DEFAULT_VOICE_ID;
}
