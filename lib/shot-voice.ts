/**
 * v12.374:给一个镜头挑「谁在说话」的音色。
 *
 * 起因是 recompose 的配音重生**从来没成功过一次** —— 它硬编码
 * `voiceId: 'female-zh'`,而 MiniMax 的回包是
 * `{"base_resp":{"status_code":2054,"status_msg":"voice id not exist"}}`。
 * 调用点外面套着 `catch { console.warn }`,于是失败一路静默,
 * 接口照样 200,只是配音数永远是 0。
 *
 * `female-zh` 并不是 MiniMax 的音色,它是主管线里**无角色名时的兜底占位**。
 * editor-agent 早在 v12.288/v12.296 就把主链路改成按角色名走
 * VOICE_CATALOG(22 档,每档带 `minimax` 字段映射到真实音色),
 * 那条注释甚至明说了这两个写死 id「**不在 VOICE_CATALOG 内**」。
 * 但 recompose 是另一个入口,没跟着改 —— 同一语义两份实现,
 * 主路径修好、旁路继续坏,而且坏得没有声音。
 *
 * 所以这里定的规矩只有一条,也是唯一值得锁的行为:
 * **返回值必须是 VOICE_CATALOG 里真实存在的 id** —— 包括兜底那一支。
 * 兜底最容易被写成一个「看起来合理」的字符串,而这正是本 bug 的成因。
 */

import { VOICE_CATALOG, resolveCharacterVoice, type VoiceMeta } from './character-studio';

/** 无法确定说话人时的记名对象。走 resolveCharacterVoice 而不是写死 id —— 保证兜底也落在目录内。 */
export const NARRATOR_KEY = '旁白';

export interface ShotVoiceInput {
  /** 明确的说话人(timeline 项有时带) */
  speaker?: string | null;
  /** 本镜出场角色;**只有恰好一人时**才拿来当说话人 */
  characters?: unknown;
}

function cleanName(v: unknown): string {
  return typeof v === 'string' ? v.trim() : '';
}

/**
 * 判定顺序:显式 speaker → 单角色镜的那一位 → 旁白。
 *
 * 多角色镜**不猜**:两个人在场时,台词归谁全靠猜,猜错就是给角色换嗓,
 * 比统一用旁白音更糟。这和 v12.346 里「只让单角色镜为性别投票」是同一条判据 ——
 * 单人在场是客观事实,多人在场时的归属是推测。
 */
export function pickShotVoice(
  shot: ShotVoiceInput | null | undefined,
  catalog: VoiceMeta[] = VOICE_CATALOG,
): string {
  const speaker = cleanName(shot?.speaker);
  if (speaker) return resolveCharacterVoice(speaker, catalog);

  const chars = Array.isArray(shot?.characters)
    ? (shot!.characters as unknown[]).map(cleanName).filter(Boolean)
    : [];
  if (chars.length === 1) return resolveCharacterVoice(chars[0], catalog);

  return resolveCharacterVoice(NARRATOR_KEY, catalog);
}

/** 该 id 是否真的在目录内。调用方在把音色交给 provider 前可以自查。 */
export function isKnownVoiceId(id: string | null | undefined, catalog: VoiceMeta[] = VOICE_CATALOG): boolean {
  return !!id && catalog.some((v) => v.id === id);
}
