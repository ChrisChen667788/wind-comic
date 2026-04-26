/**
 * lib/consistency-policy — 角色 / 场景一致性参考图选取策略 (集中决策)
 *
 * 解决用户反馈 #5: 角色一致性 + 场景一致性需要提升。
 *
 * 之前的问题:
 *   1. cref/sref 选取逻辑分散在 orchestrator 多处, 容易漏选或选错
 *   2. 场景匹配用的是 sceneDesc.includes(sceneName), 一旦场景名是"阁楼"
 *      但镜头里写"昏黄的房间", 就完全匹配不上, 用户看到镜头风格突变
 *   3. 用户上传的主角脸 (primaryCharacterRefLocked) 应该用更高 cw,
 *      但目前所有镜头都是 cw=100, 没区分
 *   4. cref 主图无法堆叠 — MJ 实际上 cref 只接 1 张, 但人物的"三视图 + 用户参考脸"
 *      合在一起做 referenceImages 链时优先级混乱
 *
 * 本模块的职责:
 *   · 给定一个 shot 和注册表, 返回应该用什么 cref / sref / cw
 *   · 严格遵守优先级:
 *       cref:  用户上传脸 > 该镜头出场角色的三视图 > 第一个角色三视图
 *       sref:  该镜头场景的概念图 > 同 location 之前镜头的渲染图 > 第一个场景概念图
 *       cw:    用户锁脸 → 125 (强约束); 普通主角色 → 100; 配角 → 80
 *   · 提供"场景锚点注册表"helper — orchestrator 可以在场景生成完后批量登记,
 *     storyboard 阶段直接通过 location 查锚点图, 不再做 substring 模糊匹配
 */

/**
 * v2.12 Phase 2: 多角色锁脸数据结构 — 与 projects.locked_characters JSON 列、
 * components/create/character-lock-section.tsx 的 LockedCharacter 共用同一个 shape。
 */
export interface LockedCharacter {
  /** 角色名 — 用于和 shot.characters 匹配 */
  name: string;
  /** 定位预设, 决定 cw */
  role: 'lead' | 'antagonist' | 'supporting' | 'cameo';
  /** Midjourney --cw 值, 25-125 */
  cw: number;
  /** persistAsset 后的稳定 URL */
  imageUrl: string;
  /**
   * v2.12 Sprint A.2: 上传脸瞬间用 GPT-4o Vision 反向抽到的 6 维档案
   * (性别/年龄段/肤色/体型/外貌/服饰/气质/特殊标记)。
   * 这里用 unknown 类型保持 consistency-policy 与 character-traits 解耦
   * (lib/character-traits.ts 导出的 CharacterTraits 才是真实 shape, 上层用 cast 即可)。
   * 缺省 = 用户没启用反向抽取, 编排器回退到不带 traits 的旧行为。
   */
  traits?: unknown;
}

export interface ConsistencyContext {
  /** 用户上传/锁定的主角脸参考图 URL, 没有就传 undefined */
  primaryCharacterRef?: string;
  /** primary ref 是否来自用户(锁定), 锁定时 cw 推到 125 */
  primaryCharacterRefLocked?: boolean;
  /** 角色名 → 三视图 URL */
  charUrlMap?: Map<string, string>;
  /** 场景锚点 — 优先 keyed by location/name, 二级 keyed by description-substring */
  sceneAnchors?: SceneAnchorRegistry;
  /** 当前镜头里出场的角色名 (来自 shot.characters) */
  shotCharacterNames?: string[];
  /** 当前镜头的 location 字段 (优先级最高的场景识别 key) */
  shotLocation?: string;
  /** 当前镜头的 sceneDescription, 用作场景锚点查找的 fallback */
  shotSceneDescription?: string;
  /** 兜底场景图 — 都查不到时拿第一张场景概念图 */
  fallbackSceneRef?: string;
  /** 是否包含主角 (用 shotCharacterNames[0] 是否在 protagonist 列表里判断, 决定 cw 等级) */
  isProtagonistShot?: boolean;
  /**
   * v2.12 Phase 2: 用户在创作工坊预先锁定的 1-3 个角色脸 + 名字 + 定位 + cw。
   * 优先级最高 — 当 shot.characters 里有任何一个名字能匹配上 lockedCharacters[].name,
   * 就用那个角色的 imageUrl 作为本镜 cref, cw 也用该角色自己的 cw(per-character,
   * 不再是全局 125)。其他匹配上的角色 image 会塞进 extraCrefs 供 referenceImages 用。
   */
  lockedCharacters?: LockedCharacter[];
}

export interface ConsistencyPick {
  /** 用作 --cref 的图; 没拿到就 undefined */
  cref?: string;
  /** 用作 --sref 的图 */
  sref?: string;
  /** Midjourney --cw 参数, 25-125 — 锁脸/主角/配角分级 */
  cw: number;
  /**
   * v2.12 Phase 2: 当一个 shot 里同时出现多个 lockedCharacters,
   * 第一个匹配作 cref(决定 cw),其余匹配的 image URL 放这里,
   * 上层可以塞进 MJ 的 referenceImages / Minimax subjectReferences。
   */
  extraCrefs?: string[];
  /** 这一次选用的来源标签, 仅作日志/调试 */
  reason: {
    crefSource: 'matched-locked' | 'user-locked' | 'character-sheet' | 'first-character' | 'none';
    srefSource: 'location-anchor' | 'description-anchor' | 'fallback' | 'none';
    cwTier: 'matched-locked' | 'locked' | 'protagonist' | 'supporting';
    /** v2.12 Phase 2: 命中的 lockedCharacter.name(便于日志/调试) */
    matchedLockedName?: string;
  };
}

/**
 * v2.12 Phase 2 — 把 shot 出场角色名匹配到 lockedCharacters[]。
 * 匹配规则(按优先级):
 *   1. exact normalized match (大小写/标点空格归一)
 *   2. substring 双向(锁定名 ≥2 字符,避免单字误匹配)
 *
 * 返回 [primary, ...extras]:
 *   primary 是首个匹配项(决定 cref + cw),extras 是其他匹配项(供 referenceImages)。
 *
 * 没有任何匹配返回空数组。
 *
 * 导出供 tests/locked-characters-match.test.ts 直接消费。
 */
export function matchLockedCharactersInShot(
  shotCharNames: string[] | undefined,
  lockedCharacters: LockedCharacter[] | undefined,
): LockedCharacter[] {
  if (!lockedCharacters?.length || !shotCharNames?.length) return [];
  const seen = new Set<string>();
  const out: LockedCharacter[] = [];

  // 优先 exact normalized,再 substring;遍历 shot 角色名,每个名字尝试找一个 locked 匹配
  for (const shotName of shotCharNames) {
    if (!shotName || typeof shotName !== 'string') continue;
    const norm = normalizeKey(shotName);
    if (!norm) continue;

    // 1. exact normalized
    let hit = lockedCharacters.find(lc => !seen.has(lc.name) && normalizeKey(lc.name) === norm);
    // 2. substring (locked name 至少 2 字符,避免"安"匹配所有人)
    if (!hit) {
      hit = lockedCharacters.find(lc => {
        if (seen.has(lc.name)) return false;
        const lcNorm = normalizeKey(lc.name);
        if (lcNorm.length < 2) return false;
        return norm.includes(lcNorm) || lcNorm.includes(norm);
      });
    }
    if (hit) {
      seen.add(hit.name);
      out.push(hit);
    }
  }
  return out;
}

/**
 * 从给定上下文选出最严格的 cref/sref/cw 组合。
 */
export function pickConsistencyRefs(ctx: ConsistencyContext): ConsistencyPick {
  // ── cref ─────────────────────────────────────────────
  let crefSource: ConsistencyPick['reason']['crefSource'] = 'none';
  let cref: string | undefined;
  let extraCrefs: string[] | undefined;
  let matchedLocked: LockedCharacter | undefined;

  // v2.12 Phase 2: 优先看 lockedCharacters 是否能匹配上本镜出场角色 —
  // 命中即用该角色自己的 imageUrl + cw(per-character),其他匹配上的塞 extraCrefs。
  const matched = matchLockedCharactersInShot(ctx.shotCharacterNames, ctx.lockedCharacters);
  if (matched.length > 0) {
    matchedLocked = matched[0];
    cref = matchedLocked.imageUrl;
    crefSource = 'matched-locked';
    if (matched.length > 1) {
      extraCrefs = matched.slice(1).map(m => m.imageUrl).filter(Boolean);
    }
  } else if (ctx.primaryCharacterRefLocked && ctx.primaryCharacterRef) {
    cref = ctx.primaryCharacterRef;
    crefSource = 'user-locked';
  } else if (ctx.charUrlMap && ctx.shotCharacterNames) {
    for (const name of ctx.shotCharacterNames) {
      const u = ctx.charUrlMap.get(name);
      if (u) { cref = u; crefSource = 'character-sheet'; break; }
    }
  }
  if (!cref && ctx.charUrlMap && ctx.charUrlMap.size > 0) {
    cref = Array.from(ctx.charUrlMap.values())[0];
    crefSource = 'first-character';
  }
  if (!cref && ctx.primaryCharacterRef) {
    // 即使没锁定, primary ref 也比 nothing 好
    cref = ctx.primaryCharacterRef;
    crefSource = 'first-character';
  }

  // ── sref ─────────────────────────────────────────────
  let srefSource: ConsistencyPick['reason']['srefSource'] = 'none';
  let sref: string | undefined;
  if (ctx.sceneAnchors && ctx.shotLocation) {
    const u = ctx.sceneAnchors.lookupByLocation(ctx.shotLocation);
    if (u) { sref = u; srefSource = 'location-anchor'; }
  }
  if (!sref && ctx.sceneAnchors && ctx.shotSceneDescription) {
    const u = ctx.sceneAnchors.lookupByDescriptionSubstring(ctx.shotSceneDescription);
    if (u) { sref = u; srefSource = 'description-anchor'; }
  }
  if (!sref && ctx.fallbackSceneRef) {
    sref = ctx.fallbackSceneRef;
    srefSource = 'fallback';
  }

  // ── cw 分级 ──────────────────────────────────────────
  let cw: number;
  let cwTier: ConsistencyPick['reason']['cwTier'];
  if (matchedLocked) {
    // v2.12 Phase 2: per-character cw — 主角 125, 对手 125, 配角 100, 客串 80,
    // 由用户在创作工坊里通过"定位"下拉指定;clamp 进 MJ 合法范围
    cw = Math.max(25, Math.min(125, Math.round(matchedLocked.cw)));
    cwTier = 'matched-locked';
  } else if (ctx.primaryCharacterRefLocked) {
    cw = 125;            // 用户单角色锁脸 — 最强 (MJ cw 上限通常 125)
    cwTier = 'locked';
  } else if (ctx.isProtagonistShot) {
    cw = 100;            // 主角镜头默认
    cwTier = 'protagonist';
  } else {
    cw = 80;             // 配角放松一点 — 防止 MJ 把所有人都画成主角脸
    cwTier = 'supporting';
  }

  return {
    cref,
    sref,
    cw,
    extraCrefs,
    reason: { crefSource, srefSource, cwTier, matchedLockedName: matchedLocked?.name },
  };
}

/**
 * 场景锚点注册表 — 编排阶段把每个 location 第一次出现时生成的图登记进去,
 * 后续同 location 的镜头直接拿来当 sref, 一次注册全片复用。
 *
 * 用法:
 *   const reg = new SceneAnchorRegistry();
 *   reg.register('阁楼', { url, description: '黄昏阁楼,侧逆光,...' });
 *   reg.lookupByLocation('阁楼') // → url
 *   reg.lookupByDescriptionSubstring('阁楼黄昏') // → url
 */
export class SceneAnchorRegistry {
  private byLocation = new Map<string, string>();
  private entries: Array<{ location: string; description?: string; url: string }> = [];

  register(location: string, payload: { url: string; description?: string }): void {
    if (!location || !payload?.url) return;
    const norm = normalizeKey(location);
    // 同 location 多次注册时, 保留首张 (作为该地点的"基线锚点", 防风格漂移)
    if (!this.byLocation.has(norm)) {
      this.byLocation.set(norm, payload.url);
      this.entries.push({ location: norm, description: payload.description, url: payload.url });
    }
  }

  lookupByLocation(location: string | undefined | null): string | undefined {
    if (!location) return undefined;
    return this.byLocation.get(normalizeKey(location));
  }

  /**
   * 描述模糊匹配 —— 当 location 字段缺失时,根据 sceneDescription 子串匹配场景名。
   * 比 includes(name) 更鲁棒 — 双向 + 标点空格归一。
   */
  lookupByDescriptionSubstring(desc: string | undefined | null): string | undefined {
    if (!desc) return undefined;
    const normDesc = normalizeKey(desc);
    for (const entry of this.entries) {
      const normLoc = entry.location;
      if (normDesc.includes(normLoc) || normLoc.includes(normDesc.slice(0, 12))) {
        return entry.url;
      }
      if (entry.description) {
        const normED = normalizeKey(entry.description);
        if (normED.length >= 6 && normDesc.includes(normED.slice(0, 6))) {
          return entry.url;
        }
      }
    }
    return undefined;
  }

  size(): number {
    return this.entries.length;
  }
}

/** 把场景名/描述统一成"小写 + 去标点 + 去空格", 让匹配少受标点干扰 */
function normalizeKey(s: string): string {
  return s
    .toLowerCase()
    .replace(/[\s,.，。、:：;；!！?？\-—()（）\[\]【】<>《》"'""'']/g, '')
    .trim();
}
