/**
 * v2.21 P1.3 — Lip-sync 服务 (Kling lip-sync API).
 *
 * 漫剧/短剧的"talking head"镜头, 视频里嘴型对不上 TTS 对白是最大违和源.
 * Kling 提供 lip-sync API: 给视频 URL + 音频 URL, 服务端把视频里说话人的嘴型
 * 重新对齐到音频. 输出新视频 URL.
 *
 * 行为契约:
 *   - 没 KELING_API_KEY → isAvailable() 返 false, syncMouthToAudio 直接返原视频 URL + warning
 *   - 有 key 但 API 失败 → throw, 调用方应该 catch + 用原视频
 *   - 成功 → 返新视频 URL (Kling 的 CDN)
 *
 * 调用时机 (在 orchestrator 里):
 *   - 仅对有 dialogue 的 shot 跑
 *   - 仅在视频成片完毕 + 对白 TTS 已生成后
 *   - 失败 fallback 到原视频 + audioWarning, 不阻塞 final cut
 *
 * 性能:
 *   - 单次 lip-sync 通常 30-90s
 *   - 串行跑 (KELING API 并发限制), 6 镜会拉长成片时间 3-9 分钟
 *   - 可由调用方在 orchestrator 里关掉 (env LIPSYNC_DISABLED=1)
 */

// v2.24 G: API_CONFIG / fetch / sleep 移到 lipsync-providers.ts
import { selectProvider, listAvailableProviders } from '@/services/lipsync-providers';

export interface LipSyncOptions {
  /** 嘴型对齐的语言 — Kling 支持 zh / en, 默认 zh */
  language?: 'zh' | 'en';
  /** 进度回调 */
  onProgress?: (progress: number, status: string) => void;
}

export interface LipSyncResult {
  /** 同步后的视频 URL — 失败时 = 原 videoUrl */
  videoUrl: string;
  /** 是否真正做了 sync (false = 跳过 / fallback) */
  applied: boolean;
  /** fallback / 失败原因, 给前端提示 + 日志 */
  warning?: string;
}

export class LipSyncService {
  /** env LIPSYNC_DISABLED=1 可全局关闭 (省钱 / 调试) */
  private disabled: boolean;

  constructor() {
    this.disabled = process.env.LIPSYNC_DISABLED === '1';
  }

  /**
   * 当前环境是否能跑 lip-sync. v2.24 G: 走 provider router, 任一 provider 可用即可.
   */
  isAvailable(): boolean {
    if (this.disabled) return false;
    return !!selectProvider();
  }

  /** v2.24 G: 列出哪些 provider 当前可用 (admin / status banner 用) */
  listProviders(): string[] {
    return listAvailableProviders();
  }

  /**
   * 把视频里说话人的嘴型对齐到给定音频. 失败容错 — 任何错误都返原视频.
   *
   * @param videoUrl  原视频 URL (必须 http, 数据 URI 不支持 — Kling 要从 URL 抓)
   * @param audioUrl  对应的 TTS 音频 URL
   * @param options   可选: 语言 / 进度回调
   */
  async syncMouthToAudio(
    videoUrl: string,
    audioUrl: string,
    options?: LipSyncOptions,
  ): Promise<LipSyncResult> {
    // Pre-flight
    if (this.disabled) {
      return { videoUrl, applied: false, warning: 'lip-sync 已 disable (LIPSYNC_DISABLED=1)' };
    }
    if (!videoUrl || !audioUrl) {
      return { videoUrl, applied: false, warning: 'videoUrl / audioUrl 缺失' };
    }
    if (!videoUrl.startsWith('http') || !audioUrl.startsWith('http')) {
      return { videoUrl, applied: false, warning: 'lip-sync 需要 http URL, data:/本地路径 不支持' };
    }

    // v2.24 G: 走 provider router
    const provider = selectProvider();
    if (!provider) {
      return {
        videoUrl, applied: false,
        warning: '无 lip-sync provider 可用 (设 KELING_API_KEY / SYNCSO_API_KEY / MINIMAX_API_KEY 任一)',
      };
    }

    console.log(`[LipSync] 启动 (${provider.name}) — video:`, videoUrl.slice(0, 60), ' audio:', audioUrl.slice(0, 60));
    const result = await provider.syncMouthToAudio(videoUrl, audioUrl, options);
    if (result.applied) {
      console.log(`[LipSync] ✅ ${provider.name} 成功:`, result.videoUrl.slice(0, 80));
    } else {
      console.warn(`[LipSync] ${provider.name} 失败:`, result.warning);
    }
    return result;
  }

  // v2.24 G: pollResult 已迁移到 lipsync-providers.ts (每 provider 自带)
}

/**
 * Singleton — 全 orchestrator 共用一个 service 实例, 不重复读 env.
 */
let _instance: LipSyncService | null = null;
export function getLipSyncService(): LipSyncService {
  if (!_instance) _instance = new LipSyncService();
  return _instance;
}
