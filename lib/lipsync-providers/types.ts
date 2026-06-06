/**
 * lib/lipsync-providers/types (v9.6.9) — 阶段十六 T1 口型真渲染:LipSyncProvider 插件契约。
 *
 * 把 viseme 轨 / TTS 音频 + 说话人脸 → 真对口型的视频(wav2lip / SadTalker / MuseTalk 类引擎)。
 * 契约对齐 video-providers(id/priority/available/generate + registry 调度 + fallback),
 * 引擎可插拔、env 门控。registry: `lib/lipsync-providers/registry.ts`,内置: `builtins.ts`。
 */

export type ProgressCallback = (pct: number, msg?: string) => void;

export interface LipSyncGenerateInput {
  /** 驱动对象:说话人静态脸图(http/data image)或底板视频。 */
  faceUrl: string;
  /** 要对口型的音频(TTS 旁白 / 对白,http/data audio)。 */
  audioUrl: string;
  /** 可选:viseme 关键帧轨(支持关键帧驱动的引擎可用之细化)。来自 lipsync-plan.planVisemes。 */
  visemes?: Array<{ t: number; viseme: string; mouthOpen: number }>;
  /** 可选:哪一镜(日志 / 落库用)。 */
  shotNumber?: number;
  /** faceUrl 是视频底板时为 true(选 provider 时校验 supportsVideoDriver)。 */
  faceIsVideo?: boolean;
  onProgress?: ProgressCallback;
}

export interface LipSyncGenerateResult {
  /** 必填:对好口型的视频 url(http(s) 或 data: video/*)。 */
  videoUrl: string;
  /** 实际跑的 provider id。 */
  provider: string;
  durationSec?: number;
  upstreamId?: string;
  estCostCny?: number;
}

export interface LipSyncProvider {
  /** 唯一 id, kebab-case(如 "wav2lip-http" / "sadtalker" / "musetalk")。 */
  id: string;
  name: string;
  /** 调度优先级,数字小先选。 */
  priority: number;
  /** 是否支持视频底板驱动(否则只支持静态脸图)。faceIsVideo 时必须 true。 */
  supportsVideoDriver: boolean;
  /** 同步检查:env 是否配齐(registry 选链时同步调,勿做 I/O)。 */
  available: () => boolean;
  /** 真正干活。失败 throw,registry 自动 fallback 到下一个。 */
  generate: (input: LipSyncGenerateInput) => Promise<LipSyncGenerateResult>;
}

export interface LipSyncSelectInput {
  /** faceUrl 是否视频底板(决定是否要求 supportsVideoDriver)。 */
  needsVideoDriver?: boolean;
  /** 指定优先 provider id。 */
  prefer?: string;
  /** 排除的 provider id。 */
  exclude?: string[];
}
