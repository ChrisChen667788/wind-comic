/**
 * 视频引擎链序解析(v12.156.0)—— 主管线与单镜补渲共用的纯函数。
 *
 * 优先级:用户显式 provider > env `VIDEO_ENGINE_ORDER`(逗号序,如 "kling,minimax,veo")> 默认 Veo 打头。
 * 动机:MiniMax 刷新额度只够几镜、Kling 已充值 —— 主力引擎该由运营者一行 env 决定,
 * 而不是改代码。未知引擎名忽略;结果只含可用引擎;永不为空(除非 available 为空)。
 */
// v12.272:接入 HappyHorse(阿里,AA 双榜前五、单次联合生成视频+音频)。
// 默认链序**不动** —— 新引擎只有在 VIDEO_ENGINE_ORDER 显式列出或用户显式选择时才参与,
// 避免「装了新引擎就悄悄改变所有人出片结果」。
// ModelHub(Seedance 2.x 网关)同规则:默认链序不含,只在显式列出/选择时参与。
export type VideoEngineName = 'veo' | 'minimax' | 'kling' | 'happyhorse' | 'modelhub';

const DEFAULT_ORDER: VideoEngineName[] = ['veo', 'minimax', 'kling'];

export function parseEngineOrderEnv(raw: string | undefined | null): VideoEngineName[] {
  return (raw || '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter((s): s is VideoEngineName => s === 'veo' || s === 'minimax' || s === 'kling' || s === 'happyhorse' || s === 'modelhub');
}

/**
 * 解析最终链序:
 * @param provider  用户显式选择('veo'/'minimax'/'kling'/其他别名忽略)
 * @param available 当前可用引擎(有 key/服务实例的)
 * @param envOrder  parseEngineOrderEnv 的结果(调用方读 env 注入,保持纯函数)
 */
export function resolveEngineOrder(
  provider: string | undefined | null,
  available: VideoEngineName[],
  envOrder: VideoEngineName[] = [],
): VideoEngineName[] {
  const has = (e: VideoEngineName) => available.includes(e);
  const dedupe = (arr: VideoEngineName[]) => [...new Set(arr)].filter(has);

  // 别名归一:创作页可灵选项 id 是 'keling'(历史命名),veo3.1 是 Veo 的版本别名 ——
  // 此前主管线不认 'keling',用户显式选可灵被静默忽略(v12.157 live 发现)。
  let p = (provider || '').toLowerCase();
  if (p === 'keling') p = 'kling';
  if (p === 'veo3.1' || p === 'veo3') p = 'veo';
  if (p === 'happy-horse' || p === 'happyhorse1.1' || p === 'hh') p = 'happyhorse'; // v12.272 别名
  if (p === 'model-hub' || p === 'modelhub.cc') p = 'modelhub';
  if ((p === 'minimax' || p === 'veo' || p === 'kling' || p === 'happyhorse' || p === 'modelhub') && has(p as VideoEngineName)) {
    // 显式选择打头,其余按 env 序(无 env 按默认)补位兜底
    const rest = (envOrder.length ? envOrder : DEFAULT_ORDER).filter((e) => e !== p);
    return dedupe([p as VideoEngineName, ...rest, ...DEFAULT_ORDER]);
  }
  if (envOrder.length && envOrder.some(has)) {
    return dedupe([...envOrder, ...DEFAULT_ORDER]);
  }
  return dedupe(DEFAULT_ORDER);
}

/**
 * v12.178:对白镜引擎偏好 —— 带台词的镜优先「原生音视频/口型」引擎(Vidu Q3 / Kling Omni 等),
 * 回应「三步对齐 TTS」的方向性劣势。env `DIALOGUE_ENGINE` 指定(如 'veo' 表示走 unified 通道
 * 的 DIALOGUE_ENGINE_MODEL,或 'kling');未设 → 原链不动。纯函数,注入 env 可测。
 */
export function resolveEngineOrderForShot(
  base: VideoEngineName[],
  shot: { dialogue?: string | null } | null | undefined,
  env: Record<string, string | undefined> = process.env,
): VideoEngineName[] {
  const pref = (env.DIALOGUE_ENGINE || '').toLowerCase();
  const hasDialogue = !!(shot?.dialogue && shot.dialogue.trim().length >= 2);
  if (!hasDialogue || !pref) return base;
  const p = (pref === 'keling' ? 'kling' : pref) as VideoEngineName;
  if (!base.includes(p)) return base; // 偏好引擎不可用 → 不动
  return [p, ...base.filter((e) => e !== p)];
}
