/**
 * lib/voice-routing (v9.7.4) — 批量配音音色按角色路由(纯逻辑,零依赖于 DB)。
 *
 * 之前 shot-audio 全片一个嗓;这里按角色名给每个角色稳定的音色。
 *
 * **v12.296 起,音色选择本身不在这个文件里** —— 一律委托 `character-studio.resolveCastVoices`
 * (全仓唯一入口)。本文件只保留它真正独有的价值:**优先级链**
 * `force(全片强制) > overrides(用户手动指定) > routing(自动) > default`。
 *
 * 为什么收口:原来这里自带一套「按首次出现顺序在池内轮转」的选路,与成片主链路各算各的,
 * 实测 8/8 角色拿到不同音色且性别都反了 —— 用户重配一镜就换嗓。
 * 单测 tests/v9-7-4-voice-routing.test.ts、tests/v12-296-voice-single-entry.test.ts。
 */
import { VOICE_CATALOG, resolveCastVoices, type VoiceMeta } from './character-studio';
import { genderFromNameHints } from './tts-prosody';

export const DEFAULT_VOICE_ID = 'narrator_male_cn';

// v12.296:词表收口到 lib/tts-prosody(唯一定义)—— 原本这里与那边各一套,
// 「戊姑」「己嫂」在这里判 female、在那边判 unknown,同一角色音色与韵律的性别对不上。

export type RoutedGender = 'male' | 'female' | 'unknown';

/** 从角色名推性别(常见中文称谓 hint;无 hint → unknown)。 */
export function inferGenderFromName(name: string): RoutedGender {
  return genderFromNameHints(name) || 'unknown';
}

/**
 * 给一组角色名(允许重复 / 空)分配音色。返回 Map<角色名, voiceId>。
 *
 * v12.296:**选路本身已收口到 `character-studio.resolveCastVoices`**,这里只是转发。
 *
 * 原实现按「首次出现顺序 + 池内轮转」发音色 —— 推不出性别的中文人名(绝大多数)直接拿全池第 n 个,
 * 与角色本身毫无关系。实测 8 个角色**全部**与成片主链路不一致,**且性别都反了**:
 *   顾行舟 成片 `student_male_cn` / 这里 `young_female_cn`;小囡 `mature_female_cn` / `narrator_male_cn`。
 * 后果:用户重配某一镜音频,那个角色在这一镜就换了性别。
 *
 * v12.229 立的「每角色独立音色」是真实需求,**没有被牺牲** —— 新实现是「先取该角色的偏好音色,
 * 撞车才在**同性别**候选里按名字散列另挑」,既保住独立性,又不会再出现性别相反的分配。
 */
export function buildVoiceRouting(
  names: string[],
  catalog: VoiceMeta[] = VOICE_CATALOG,
  /** v12.346:剧本推断出的性别线索,优先于姓名词表。不传 = 与之前完全一致。 */
  hints?: Map<string, { gender?: 'male' | 'female'; ageGroup?: string }>,
): Map<string, string> {
  const map = new Map<string, string>();
  const pool = catalog.length ? catalog : VOICE_CATALOG;
  for (const [n, id] of resolveCastVoices(names, pool, hints)) map.set(n, id || DEFAULT_VOICE_ID);
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
