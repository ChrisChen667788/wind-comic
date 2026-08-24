/**
 * lib/voice-cast — 把成片当时的「角色 → 音色」定妆表落盘(v12.338)。
 *
 * ## 为什么需要它
 *
 * 音色是**按整集阵容分配**的:`buildVoiceRouting` 走 `resolveCastVoices`,
 * 按角色**首次出现顺序在音色池里轮转**,好让同一集里两个角色不撞音。
 * 也就是说,一个角色分到哪把嗓子,**取决于阵容里还有谁、以及谁先出场**。
 *
 * 出片时用的是全集阵容,单句重录(lib/voice-retake)也刻意加载整集剧本重建路由,
 * 所以只要剧本没变,两边是一致的 —— 这一点当前代码是对的。
 *
 * **漏洞在剧本变了之后**:成片当时用的那套分配**从来没被记录下来**。
 * 用户出片之后改剧本(加一个角色、删一句话导致某人不再有台词、给角色改名),
 * 阵容顺序一变,轮转结果整体错位 —— 此时去重录某一句,拿到的音色与成片里那个人
 * **不是同一把嗓子**,而系统不会有任何报警,用户只能靠耳朵发现。
 * VERSIONS.md 在 v12.291 就写下了这个缺口与解法:「出片时把映射落盘、重配读它
 * (与 v12.289 转场回写同一招)—— 留待后续版本」。这一版就是那个后续版本。
 *
 * ## 定妆表的语义
 *
 * 它记录的是**成片事实**,不是配置:这一集已经播出去的声音就是这样。所以
 *   · 已在表里的角色,后续一律读表,不再参与轮转(哪怕阵容变了);
 *   · 表里没有的新角色,在**避开已占用音色**的前提下分配,并写回表;
 *   · 用户手动覆盖(voice-overrides)优先级仍在定妆表之上 —— 那是人的明确意志。
 */
import { buildVoiceRouting } from './voice-routing';
import { listAssetsByType, upsertAsset } from './repos/asset-repo';

export const VOICE_CAST_TYPE = 'voice-cast';

export interface VoiceCastRecord {
  /** 角色名 → 音色 id */
  cast: Record<string, string>;
  savedAt: string;
}

/** 解析结果 —— `added` 是本次新分配、需要写回定妆表的部分。 */
export interface CastResolution {
  map: Map<string, string>;
  added: Record<string, string>;
}

/**
 * **纯函数**:在已落盘的定妆表基础上解析整组角色的音色。
 *
 * @param names    本次需要音色的角色名(可含重复/空串)
 * @param persisted 已落盘的定妆表(没有则传 {} / null)
 */
export function resolveWithCast(
  names: string[],
  persisted: Record<string, string> | null | undefined,
): CastResolution {
  const locked = { ...(persisted || {}) };
  const map = new Map<string, string>();
  const clean = [...new Set((names || []).map((n) => (n || '').trim()).filter(Boolean))];

  // ① 表里有的,直接锁定 —— 这是成片事实,阵容怎么变都不改
  const fresh: string[] = [];
  for (const n of clean) {
    if (locked[n]) map.set(n, locked[n]);
    else fresh.push(n);
  }
  if (fresh.length === 0) return { map, added: {} };

  // ② 新角色:先按既有算法算一遍,再把**与已占用音色冲突**的往后顺延,
  //    避免新人和老人撞音(轮转算法本身只在「一次性拿到全部阵容」时才保证不撞)。
  const taken = new Set(Object.values(locked));
  const routed = buildVoiceRouting(fresh);
  const pool = [...new Set([...buildVoiceRouting(clean).values(), ...routed.values()])];
  const added: Record<string, string> = {};
  for (const n of fresh) {
    let v = routed.get(n) || '';
    if (!v || taken.has(v)) {
      const free = pool.find((p) => !taken.has(p));
      v = free || v || pool[0] || '';
    }
    if (v) taken.add(v);
    map.set(n, v);
    added[n] = v;
  }
  return { map, added };
}

/** 读定妆表;没有返回 null(调用方据此决定是否回填)。 */
export async function loadVoiceCast(projectId: string): Promise<Record<string, string> | null> {
  try {
    const rows = await listAssetsByType(projectId, VOICE_CAST_TYPE);
    const raw = rows[0]?.data;
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
    const cast = parsed?.cast;
    return cast && typeof cast === 'object' ? cast as Record<string, string> : null;
  } catch {
    return null;   // 表坏了不该让配音链路挂掉 —— 退回按阵容轮转,与本版之前的行为一致
  }
}

/**
 * 合并写回定妆表(只增不改)。
 * **只增不改**是刻意的:已经出片的角色音色不能被后续写入悄悄改掉,
 * 那会让「定妆」二字失去意义。要改音色请走 voice-overrides(人的明确意志)。
 */
export async function saveVoiceCast(projectId: string, entries: Record<string, string>): Promise<Record<string, string>> {
  const existing = (await loadVoiceCast(projectId)) || {};
  const merged = { ...existing };
  let changed = false;
  for (const [name, voice] of Object.entries(entries || {})) {
    const n = (name || '').trim();
    if (!n || !voice) continue;
    if (!merged[n]) { merged[n] = voice; changed = true; }
  }
  if (changed) {
    const rec: VoiceCastRecord = { cast: merged, savedAt: new Date().toISOString() };
    await upsertAsset({
      projectId, type: VOICE_CAST_TYPE, name: 'voice-cast', data: rec,
    } as any);
  }
  return merged;
}

/**
 * 一步到位:解析音色并把新分配的写回定妆表。
 * 出片与重录都走它 —— 两边同一出处,才谈得上一致。
 */
export async function resolveAndPersistCast(projectId: string, names: string[]): Promise<Map<string, string>> {
  const persisted = await loadVoiceCast(projectId);
  const { map, added } = resolveWithCast(names, persisted);
  if (Object.keys(added).length) await saveVoiceCast(projectId, added);
  return map;
}
