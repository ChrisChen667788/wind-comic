/**
 * lib/video-engine-chain (v12.8.1) — 视频引擎兜底链的控制流(含软熔断),抽出来可单测。
 *
 * orchestrator 的视频生成是「按 engineOrder 逐个引擎试,失败落下一个」。v12.8.0 给这条链
 * 加了软熔断(冷却中的引擎跳过 + 致命失败标冷却),但那段逻辑埋在 4000 行 orchestrator 里没法直接测。
 * 这里把**控制流**抽成纯函数:每个引擎的具体调用(minimax/veo/kling 各自参数)留在 `attempt`
 * 回调里,本函数只管「跳过冷却中的 → 试 → 校验 URL → 失败标熔断 → 下一个」。
 */
export interface EngineChainDeps {
  /** 同步查健康(冷却中返回 false → 跳过)。 */
  isHealthy: (id: string) => boolean;
  /** 失败时按错误文本判定要不要熔断。 */
  markFatal: (id: string, errMsg: string) => void;
  /** 校验引擎返回的 URL 是否有效。 */
  isValidUrl: (url: string) => boolean;
  onSkip?: (engine: string) => void;
  onAttempt?: (engine: string) => void;
  onFail?: (engine: string, errMsg: string) => void;
}

export interface EngineChainResult {
  /** 成功出片的 URL;全失败为 ''。 */
  videoUrl: string;
  /** 真正出片的引擎;全失败为 null。 */
  engine: string | null;
  /** 因冷却被跳过的引擎(可观测)。 */
  skipped: string[];
}

/**
 * 按 engineOrder 逐引擎试,带软熔断。
 * - 冷却中(`!isHealthy`)→ 跳过(记入 skipped),不浪费一次调用。
 * - `attempt(engine)` 返回 URL:有效 → 成功返回;无效 → 当失败处理。
 * - `attempt` 抛错或返回无效 URL → `markFatal`(auth/配额/饱和会被冷却)→ 试下一个。
 * - 全部走完没成功 → { videoUrl:'', engine:null }(上层走降级)。
 */
export async function runVideoEngineChain(
  engineOrder: string[],
  attempt: (engine: string) => Promise<string>,
  deps: EngineChainDeps,
): Promise<EngineChainResult> {
  const skipped: string[] = [];
  for (const engine of engineOrder) {
    if (!deps.isHealthy(engine)) {
      skipped.push(engine);
      deps.onSkip?.(engine);
      continue;
    }
    deps.onAttempt?.(engine);
    try {
      const url = await attempt(engine);
      if (url && deps.isValidUrl(url)) {
        return { videoUrl: url, engine, skipped };
      }
      throw new Error(`${engine} 返回的视频 URL 无效`);
    } catch (e) {
      const errMsg = e instanceof Error ? e.message : String(e);
      deps.markFatal(engine, errMsg);
      deps.onFail?.(engine, errMsg);
    }
  }
  return { videoUrl: '', engine: null, skipped };
}
