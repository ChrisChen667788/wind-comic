/**
 * lib/asset-ledger (v10.6.1) — 资产级连续性台账(纯函数核心,可单测)。
 *
 * 从业者真实痛点:同一件外套跨 30 镜不变色、同一房间道具摆位不漂移 —— 锁脸/风格圣经
 * 管「人脸与画风」,台账管「物」:把 服装/场景/道具 登记成条目,记录每条被哪些镜头
 * 引用;**改一条描述 → 立刻给出受影响镜头清单**(调用方据此把对应分镜/视频置 stale 待重渲)。
 *
 * 登记三来源(确定性,零 LLM):
 *   - costume:每角色一条;引用镜 = shot.character 命中 或 描述/台词提到该角色名
 *   - scene:每场景一条;引用镜 = shot.scene 命中 或 描述提到场景名
 *   - prop:调用方传入的关键道具词(模板 keyElements / 手动登记);引用镜 = 描述/台词含词
 * 自动条目可随项目重建;手动条目(source='manual')重建时保留。
 *
 * 漂移检测分层(与 docs/algorithms.md 同款 BYO 哲学):
 *   - 启发式(零配置,本版):描述变更 → 受影响镜头置 stale 待复核/重渲
 *   - BYO Vision(后续):配视觉模型 key 后,可对受影响镜头图做「条目描述 vs 画面」比对打分
 */

export type LedgerKind = 'costume' | 'scene' | 'prop';

export interface LedgerEntry {
  id: string;
  kind: LedgerKind;
  name: string;
  description: string;
  /** 引用该资产的镜号(去重升序) */
  shotNumbers: number[];
  source: 'auto' | 'manual';
}

export interface AssetLedger {
  entries: LedgerEntry[];
}

export interface ShotLike {
  shotNumber: number;
  scene?: string;
  character?: string;
  description?: string;
  dialogue?: string;
}

export interface CharacterLike {
  name: string;
  appearance?: string;
  costume?: string;
  description?: string;
}

export interface SceneLike {
  name: string;
  description?: string;
}

function shotText(s: ShotLike): string {
  return `${s.description || ''}\n${s.dialogue || ''}`;
}

function shotsMentioning(shots: ShotLike[], term: string, field?: 'character' | 'scene'): number[] {
  const hit = new Set<number>();
  for (const s of shots) {
    if (field && (s[field] || '').includes(term)) hit.add(s.shotNumber);
    else if (shotText(s).includes(term)) hit.add(s.shotNumber);
    else if (field && shotText(s).includes(term)) hit.add(s.shotNumber);
  }
  return Array.from(hit).sort((a, b) => a - b);
}

export function buildLedger(input: {
  shots: ShotLike[];
  characters: CharacterLike[];
  scenes: SceneLike[];
  /** 关键道具词(模板 keyElements / 既有手动条目名) */
  keyProps?: string[];
}): AssetLedger {
  const entries: LedgerEntry[] = [];
  for (const c of input.characters) {
    if (!c.name) continue;
    entries.push({
      id: `costume:${c.name}`,
      kind: 'costume',
      name: `${c.name} · 服装`,
      description: c.costume || c.appearance || c.description || '',
      shotNumbers: shotsMentioning(input.shots, c.name, 'character'),
      source: 'auto',
    });
  }
  for (const sc of input.scenes) {
    if (!sc.name) continue;
    entries.push({
      id: `scene:${sc.name}`,
      kind: 'scene',
      name: sc.name,
      description: sc.description || '',
      shotNumbers: shotsMentioning(input.shots, sc.name, 'scene'),
      source: 'auto',
    });
  }
  for (const p of input.keyProps || []) {
    const term = p.trim();
    if (!term) continue;
    entries.push({
      id: `prop:${term}`,
      kind: 'prop',
      name: term,
      description: '',
      shotNumbers: shotsMentioning(input.shots, term),
      source: 'auto',
    });
  }
  return { entries };
}

/** 重建合并:auto 条目以重建为准(描述若被人工改过则保留人工值);manual 条目原样保留。 */
export function mergeLedger(prev: AssetLedger | null, rebuilt: AssetLedger): AssetLedger {
  if (!prev?.entries?.length) return rebuilt;
  const prevById = new Map(prev.entries.map((e) => [e.id, e]));
  const merged: LedgerEntry[] = rebuilt.entries.map((e) => {
    const old = prevById.get(e.id);
    // 人工改过的描述优先(描述是台账的"事实陈述",重建不应抹掉人工校准)
    return old && old.description && old.description !== e.description
      ? { ...e, description: old.description }
      : e;
  });
  const rebuiltIds = new Set(rebuilt.entries.map((e) => e.id));
  for (const e of prev.entries) {
    if (e.source === 'manual' && !rebuiltIds.has(e.id)) merged.push(e);
  }
  return { entries: merged };
}

/**
 * 验收核心:改一条描述 → 返回新台账 + 受影响镜头清单。
 * 调用方据 affectedShots 把对应 storyboard/video 置 stale(待重渲/复核)。
 */
export function applyDescriptionChange(
  ledger: AssetLedger,
  entryId: string,
  newDescription: string,
): { ledger: AssetLedger; entry: LedgerEntry; affectedShots: number[] } | null {
  const idx = ledger.entries.findIndex((e) => e.id === entryId);
  if (idx < 0) return null;
  const entry: LedgerEntry = { ...ledger.entries[idx], description: newDescription };
  const entries = [...ledger.entries];
  entries[idx] = entry;
  return { ledger: { entries }, entry, affectedShots: entry.shotNumbers };
}

/** 手动登记一条(道具为主);引用镜按描述词即时扫描。 */
export function addManualEntry(
  ledger: AssetLedger,
  input: { kind: LedgerKind; name: string; description?: string },
  shots: ShotLike[],
): AssetLedger {
  const name = input.name.trim().slice(0, 40);
  if (!name) return ledger;
  const id = `${input.kind}:${name}`;
  if (ledger.entries.some((e) => e.id === id)) return ledger;
  return {
    entries: [
      ...ledger.entries,
      {
        id, kind: input.kind, name,
        description: (input.description || '').slice(0, 300),
        shotNumbers: shotsMentioning(shots, name),
        source: 'manual',
      },
    ],
  };
}
