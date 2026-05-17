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

import { API_CONFIG } from '@/lib/config';

function fetchWithTimeout(url: string, init: RequestInit, timeoutMs = 60_000): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return fetch(url, { ...init, signal: controller.signal }).finally(() => clearTimeout(timer));
}

function sleep(ms: number) { return new Promise((r) => setTimeout(r, ms)); }

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
  private apiKey: string;
  private baseURL: string;
  /** env LIPSYNC_DISABLED=1 可全局关闭 (省钱 / 调试) */
  private disabled: boolean;

  constructor() {
    this.apiKey = API_CONFIG.keling?.apiKey || '';
    this.baseURL = API_CONFIG.keling?.baseURL || '';
    this.disabled = process.env.LIPSYNC_DISABLED === '1';
  }

  /**
   * 当前环境是否能跑 lip-sync. 没 key / disabled → false, 调用方应跳过.
   */
  isAvailable(): boolean {
    if (this.disabled) return false;
    if (!this.apiKey || this.apiKey.startsWith('your_')) return false;
    if (!this.baseURL) return false;
    return true;
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
    // Pre-flight 检查
    if (!this.isAvailable()) {
      return {
        videoUrl,
        applied: false,
        warning: this.disabled
          ? 'lip-sync 已 disable (LIPSYNC_DISABLED=1)'
          : 'KELING_API_KEY 未配置, lip-sync 跳过',
      };
    }
    if (!videoUrl || !audioUrl) {
      return { videoUrl, applied: false, warning: 'videoUrl / audioUrl 缺失' };
    }
    if (!videoUrl.startsWith('http') || !audioUrl.startsWith('http')) {
      return { videoUrl, applied: false, warning: 'lip-sync 需要 http URL, data:/本地路径 不支持' };
    }

    console.log('[LipSync] 启动 — video:', videoUrl.slice(0, 60), ' audio:', audioUrl.slice(0, 60));

    const language = options?.language || 'zh';
    const body: Record<string, any> = {
      // Kling lip-sync API endpoint (公开 API 在 /v1/videos/lip-sync)
      // 字段名以 Kling 官方文档为准, 若不匹配 / 上游 4xx, 调用方 catch fallback.
      input: {
        video_url: videoUrl,
        audio_type: 'audio_url',
        audio_url: audioUrl,
        language,
      },
    };

    try {
      const response = await fetchWithTimeout(
        `${this.baseURL}/v1/videos/lip-sync`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${this.apiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(body),
        },
        30_000,
      );

      if (!response.ok) {
        const errText = await response.text().catch(() => '');
        return {
          videoUrl,
          applied: false,
          warning: `Kling lip-sync API ${response.status}: ${errText.slice(0, 150)}`,
        };
      }

      const data = await response.json();
      const taskId = data.data?.task_id || data.task_id || data.id;
      if (!taskId) {
        return {
          videoUrl,
          applied: false,
          warning: `Kling lip-sync 无 task_id: ${JSON.stringify(data).slice(0, 150)}`,
        };
      }

      const syncedUrl = await this.pollResult(taskId, 60, options?.onProgress);
      if (!syncedUrl) {
        return { videoUrl, applied: false, warning: 'Kling lip-sync poll 超时' };
      }

      console.log('[LipSync] ✅ 成功:', syncedUrl.slice(0, 80));
      return { videoUrl: syncedUrl, applied: true };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.warn('[LipSync] 失败, 降级到原视频:', msg);
      return { videoUrl, applied: false, warning: `lip-sync failed: ${msg.slice(0, 150)}` };
    }
  }

  /**
   * 轮询 Kling 任务结果 — 与 KlingService.pollResult 类似但只关心 lip-sync 视频 URL.
   * 失败时返 null 让上层降级.
   */
  private async pollResult(
    taskId: string,
    maxAttempts = 60,
    onProgress?: (progress: number, status: string) => void,
  ): Promise<string | null> {
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      await sleep(5000);
      try {
        const response = await fetchWithTimeout(
          `${this.baseURL}/v1/videos/lip-sync/${taskId}`,
          {
            method: 'GET',
            headers: { 'Authorization': `Bearer ${this.apiKey}` },
          },
          15_000,
        );
        if (!response.ok) continue; // 偶发 5xx 容忍, 下一轮再试

        const data = await response.json();
        const status = data.data?.task_status || data.task_status;
        const progress = Math.round(((attempt + 1) / maxAttempts) * 100);
        onProgress?.(progress, status || 'polling');

        if (status === 'succeed' || status === 'completed' || status === 'success') {
          // Kling 视频结果通常在 task_result.videos[0].url
          const url =
            data.data?.task_result?.videos?.[0]?.url ||
            data.task_result?.videos?.[0]?.url ||
            data.data?.video_url ||
            data.video_url;
          if (url) return url;
          return null;
        }
        if (status === 'failed' || status === 'error') {
          console.warn(`[LipSync] task ${taskId} ${status}`);
          return null;
        }
      } catch (e) {
        // 网络抖动容忍, 继续 poll
        console.warn(`[LipSync] poll attempt ${attempt}: ${e instanceof Error ? e.message : e}`);
      }
    }
    return null; // 超时
  }
}

/**
 * Singleton — 全 orchestrator 共用一个 service 实例, 不重复读 env.
 */
let _instance: LipSyncService | null = null;
export function getLipSyncService(): LipSyncService {
  if (!_instance) _instance = new LipSyncService();
  return _instance;
}
