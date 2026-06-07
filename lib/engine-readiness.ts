/**
 * lib/engine-readiness (v10.1.2) — 媒体引擎「演示模式就绪度」归一(纯函数,可单测)。
 *
 * 背景:除口型(v10.1.0 已零配置)外,图像/视频/TTS 引擎仍需 BYO key;没配时管线退化为
 * 占位/示意资产。本模块把"各引擎是否配了真实引擎"(由服务端各 provider 注册表 available()
 * 算好后传入)归一成一个就绪度报告 + demoMode 判定 + 启用提示,供前端「演示模式」提示用。
 * 这里只做判定与文案,绝不碰密钥。
 */
export type EngineKind = 'image' | 'video' | 'tts' | 'lipsync';

export interface EngineState {
  kind: EngineKind;
  ready: boolean;
  label: string;
  /** 未就绪时,启用真实引擎要配置的 env 提示 */
  enableHint: string;
}

export interface ReadinessReport {
  engines: EngineState[];
  /** 真实成片至少需要 图像 + 视频 引擎;缺任一 → 演示模式(产出占位/示意资产) */
  demoMode: boolean;
  readyCount: number;
  total: number;
}

const META: Record<EngineKind, { label: string; enableHint: string }> = {
  image: { label: '图像生成', enableHint: '配置 MINIMAX_API_KEY / VIDU_API_KEY 等图像引擎' },
  video: { label: '视频生成', enableHint: '配置 MINIMAX_API_KEY / VIDU_API_KEY / RUNWAY_API_KEY 等视频引擎' },
  tts: { label: '配音 TTS', enableHint: '配置 TTS 引擎密钥(MiniMax / ElevenLabs 等)' },
  lipsync: { label: '口型渲染', enableHint: '已零配置可用(本地 2D);配 LIPSYNC_API_URL 可换真引擎' },
};

const KINDS: EngineKind[] = ['image', 'video', 'tts', 'lipsync'];

export function computeReadiness(flags: Record<EngineKind, boolean>): ReadinessReport {
  const engines = KINDS.map<EngineState>((kind) => ({
    kind,
    ready: !!flags[kind],
    label: META[kind].label,
    enableHint: META[kind].enableHint,
  }));
  const readyCount = engines.filter((e) => e.ready).length;
  // 图像 + 视频 是真实成片的核心;缺任一即演示模式
  const demoMode = !(flags.image && flags.video);
  return { engines, demoMode, readyCount, total: engines.length };
}
