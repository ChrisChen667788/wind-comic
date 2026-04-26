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
}

export interface ConsistencyPick {
  /** 用作 --cref 的图; 没拿到就 undefined */
  cref?: string;
  /** 用作 --sref 的图 */
  sref?: string;
  /** Midjourney --cw 参数, 25-125 — 锁脸/主角/配角分级 */
  cw: number;
  /** 这一次选用的来源标签, 仅作日志/调试 */
  reason: {
    crefSource: 'user-locked' | 'character-sheet' | 'first-character' | 'none';
    srefSource: 'location-anchor' | 'description-anchor' | 'fallback' | 'none';
    cwTier: 'locked' | 'protagonist' | 'supporting';
  };
}

/**
 * 从给定上下文选出最严格的 cref/sref/cw 组合。
 */
export function pickConsistencyRefs(ctx: ConsistencyContext): ConsistencyPick {
  // ── cref ─────────────────────────────────────────────
  let crefSource: ConsistencyPick['reason']['crefSource'] = 'none';
  let cref: string | undefined;
  if (ctx.primaryCharacterRefLocked && ctx.primaryCharacterRef) {
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
  if (ctx.primaryCharacterRefLocked) {
    cw = 125;            // 用户锁脸 — 最强 (MJ cw 上限通常 125)
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
    reason: { crefSource, srefSource, cwTier },
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
