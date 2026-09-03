/**
 * v2.24 G — Lip-sync provider abstraction.
 *
 * 之前 lipsync.service.ts 硬绑 Kling. 现在抽成 provider 接口, 支持多家:
 *   - Kling (默认, 需 KELING_API_KEY)
 *   - Sync.so (备选, 行业标准 lip-sync 服务, 需 SYNCSO_API_KEY)
 *   - Hailuo 2.5+ (Minimax 自带 lipsync, 需 升级套餐 + MINIMAX_LIPSYNC_MODEL)
 *
 * Router 行为:
 *   - 按 LIPSYNC_PROVIDER env 选 (默认 'auto' = 按可用性顺序选)
 *   - 'auto': kling > syncso > hailuo (按市面口碑)
 *   - 任一 provider 失败 → 不 fallback (返原视频 + warning, 由调用方决定)
 *   - 让多家都可用时, 用户可在 env 强制选定
 */

import { API_CONFIG } from '@/lib/config';

function fetchWithTimeout(url: string, init: RequestInit, timeoutMs = 60_000): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return fetch(url, { ...init, signal: controller.signal }).finally(() => clearTimeout(timer));
}

function sleep(ms: number) { return new Promise((r) => setTimeout(r, ms)); }

export interface LipSyncResult {
  videoUrl: string;
  applied: boolean;
  warning?: string;
  /** 实际用的 provider, 调试 / 监控用 */
  provider?: string;
}

export type LipSyncProviderName = 'kling' | 'syncso' | 'hailuo';

export interface LipSyncProvider {
  name: LipSyncProviderName;
  isAvailable(): boolean;
  syncMouthToAudio(
    videoUrl: string,
    audioUrl: string,
    options?: { language?: 'zh' | 'en'; onProgress?: (p: number, s: string) => void },
  ): Promise<LipSyncResult>;
}

// ─── Kling lip-sync (原 LipSyncService) ──────────────────────────────────────
class KlingLipSyncProvider implements LipSyncProvider {
  name: LipSyncProviderName = 'kling';
  private apiKey = API_CONFIG.keling?.apiKey || '';
  private baseURL = API_CONFIG.keling?.baseURL || '';

  isAvailable(): boolean {
    if (!this.apiKey || this.apiKey.startsWith('your_')) return false;
    if (!this.baseURL) return false;
    return true;
  }

  async syncMouthToAudio(videoUrl: string, audioUrl: string, options?: { language?: 'zh' | 'en'; onProgress?: (p: number, s: string) => void }): Promise<LipSyncResult> {
    if (!this.isAvailable()) return { videoUrl, applied: false, warning: 'kling not configured', provider: this.name };
    try {
      // v12.212(live 抓获既有 bug):官方 lip-sync 的 audio_type 枚举是 'url'(非 'audio_url'),
      // 且必须带 mode:'audio2video' —— 旧 body 恒返 1201「audio_type value 'audio_url' is invalid」,
      // 于是 orchestrator 早已接入的口型同步一直静默降级到原视频、从未真正生效。零成本探测修正后 SUCCEED。
      // ⚠️ v12.215 真机实测(2026-07-13):①**音频/语音时长必须 ≥2s**,否则失败「Audio duration can not less than 2s」
      //    (≈15 字以上台词);②video_url 必须**公网可访问**(localhost/serve-file 取不到);③人物需清晰正面脸。
      //    真机验证(text2video 模式)口型随台词自然变化、出片带 aac 音轨,证实端到端可用。
      const body = {
        input: {
          video_url: videoUrl,
          mode: 'audio2video',
          audio_type: 'url',
          audio_url: audioUrl,
        },
      };
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
        return { videoUrl, applied: false, warning: `Kling ${response.status}: ${errText.slice(0, 150)}`, provider: this.name };
      }
      const data = await response.json();
      const taskId = data.data?.task_id || data.task_id || data.id;
      if (!taskId) {
        return { videoUrl, applied: false, warning: `Kling no task_id`, provider: this.name };
      }
      const syncedUrl = await this.pollResult(taskId, 60, options?.onProgress);
      if (!syncedUrl) return { videoUrl, applied: false, warning: 'Kling poll timeout', provider: this.name };
      return { videoUrl: syncedUrl, applied: true, provider: this.name };
    } catch (e) {
      return { videoUrl, applied: false, warning: e instanceof Error ? e.message : 'kling error', provider: this.name };
    }
  }

  private async pollResult(taskId: string, maxAttempts: number, onProgress?: (p: number, s: string) => void): Promise<string | null> {
    for (let i = 0; i < maxAttempts; i++) {
      await sleep(5000);
      try {
        const resp = await fetchWithTimeout(
          `${this.baseURL}/v1/videos/lip-sync/${taskId}`,
          { method: 'GET', headers: { 'Authorization': `Bearer ${this.apiKey}` } },
          15_000,
        );
        if (!resp.ok) continue;
        const data = await resp.json();
        const status = data.data?.task_status || data.task_status;
        onProgress?.(Math.round(((i + 1) / maxAttempts) * 100), status || 'polling');
        if (status === 'succeed' || status === 'completed' || status === 'success') {
          return data.data?.task_result?.videos?.[0]?.url
            || data.task_result?.videos?.[0]?.url
            || data.data?.video_url
            || data.video_url
            || null;
        }
        if (status === 'failed' || status === 'error') return null;
      } catch { /* ignore single attempt */ }
    }
    return null;
  }
}

/**
 * v12.418:Sync.so 模型不再写死。
 *
 * 此前硬编 `lipsync-1.9.0-beta` —— **一个 beta 版**,而官方当前主线是 lipsync-2 /
 * lipsync-2-pro。这是本轮反复出现的同一个病(MiniMax 钉在 legacy、Vidu 不传 model、
 * MJ 不声明版本):**把版本写死,然后忘掉它**。beta 版尤其危险:它随时可能下线,
 * 而下线后返回的错误长得像「参数不对」,人会去查请求体。
 *
 * 官方枚举(2026-09-03 核 https://sync.so/docs/api-reference/api/generate-api/create):
 *   sync-3 · lipsync-2 · lipsync-2-pro · lipsync-1.9.0-beta · react-1
 */
const SYNCSO_MODELS = ['lipsync-2', 'lipsync-2-pro', 'sync-3', 'lipsync-1.9.0-beta', 'react-1'] as const;
const SYNCSO_SYNC_MODES = ['bounce', 'loop', 'cut_off', 'silence', 'remap'] as const;

export function syncSoModel(): string {
  const m = process.env.SYNCSO_MODEL;
  // 乱填就回落默认,而不是把一个必然 400 的请求送出去
  return m && (SYNCSO_MODELS as readonly string[]).includes(m) ? m : 'lipsync-2';
}

export function syncSoSyncMode(): string {
  const m = process.env.SYNCSO_SYNC_MODE;
  return m && (SYNCSO_SYNC_MODES as readonly string[]).includes(m) ? m : 'bounce';
}

// ─── Sync.so (https://sync.so) — 业内 lipsync 专家 ─────────────────────────────
class SyncSoLipSyncProvider implements LipSyncProvider {
  name: LipSyncProviderName = 'syncso';
  private apiKey = process.env.SYNCSO_API_KEY || '';
  private baseURL = process.env.SYNCSO_BASE_URL || 'https://api.sync.so';

  isAvailable(): boolean {
    return !!this.apiKey && !this.apiKey.startsWith('your_');
  }

  async syncMouthToAudio(videoUrl: string, audioUrl: string, options?: { language?: 'zh' | 'en'; onProgress?: (p: number, s: string) => void }): Promise<LipSyncResult> {
    if (!this.isAvailable()) return { videoUrl, applied: false, warning: 'syncso not configured', provider: this.name };
    try {
      // Sync.so API v2: POST /v2/generate
      const resp = await fetchWithTimeout(
        `${this.baseURL}/v2/generate`,
        {
          method: 'POST',
          headers: {
            'x-api-key': this.apiKey,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model: syncSoModel(),
            input: [
              { type: 'video', url: videoUrl },
              { type: 'audio', url: audioUrl },
            ],
            options: {
              output_format: 'mp4',
              // v12.418:此前写死 'cut_off' —— 视频长于音频时**把画面截掉**。
              // 短剧里那是可见的:一镜播到一半没了。'bounce' 让画面回弹填满音频时长,
              // 观感上远好过硬切。可用 SYNCSO_SYNC_MODE 覆盖(官方枚举:
              // bounce | loop | cut_off | silence | remap)。
              sync_mode: syncSoSyncMode(),
            },
          }),
        },
        30_000,
      );
      if (!resp.ok) {
        const errText = await resp.text().catch(() => '');
        return { videoUrl, applied: false, warning: `Sync.so ${resp.status}: ${errText.slice(0, 150)}`, provider: this.name };
      }
      const data = await resp.json();
      const jobId = data.id || data.job_id;
      if (!jobId) return { videoUrl, applied: false, warning: 'Sync.so no job id', provider: this.name };
      const syncedUrl = await this.pollResult(jobId, 60, options?.onProgress);
      if (!syncedUrl) return { videoUrl, applied: false, warning: 'Sync.so poll timeout', provider: this.name };
      return { videoUrl: syncedUrl, applied: true, provider: this.name };
    } catch (e) {
      return { videoUrl, applied: false, warning: e instanceof Error ? e.message : 'syncso error', provider: this.name };
    }
  }

  private async pollResult(jobId: string, maxAttempts: number, onProgress?: (p: number, s: string) => void): Promise<string | null> {
    for (let i = 0; i < maxAttempts; i++) {
      await sleep(5000);
      try {
        const resp = await fetchWithTimeout(
          `${this.baseURL}/v2/generate/${jobId}`,
          { method: 'GET', headers: { 'x-api-key': this.apiKey } },
          15_000,
        );
        if (!resp.ok) continue;
        const data = await resp.json();
        const status = (data.status || '').toLowerCase();
        onProgress?.(Math.round(((i + 1) / maxAttempts) * 100), status || 'polling');
        if (status === 'completed' || status === 'success') {
          return data.outputUrl || data.output_url || data.result?.url || null;
        }
        if (status === 'failed' || status === 'error' || status === 'rejected') return null;
      } catch { /* ignore */ }
    }
    return null;
  }
}

// ─── Hailuo 2.5+ lip-sync (Minimax 自带) ────────────────────────────────────
class HailuoLipSyncProvider implements LipSyncProvider {
  name: LipSyncProviderName = 'hailuo';
  private apiKey = API_CONFIG.minimax?.apiKey || '';
  private baseURL = API_CONFIG.minimax?.baseURL || '';
  private model = process.env.MINIMAX_LIPSYNC_MODEL || 'lipsync-01';

  isAvailable(): boolean {
    return !!this.apiKey && !this.apiKey.startsWith('your_') && !!this.baseURL;
  }

  async syncMouthToAudio(videoUrl: string, audioUrl: string, options?: { language?: 'zh' | 'en'; onProgress?: (p: number, s: string) => void }): Promise<LipSyncResult> {
    if (!this.isAvailable()) return { videoUrl, applied: false, warning: 'hailuo not configured', provider: this.name };
    try {
      const resp = await fetchWithTimeout(
        `${this.baseURL}/v1/lipsync_generation`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${this.apiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model: this.model,
            video_url: videoUrl,
            audio_url: audioUrl,
          }),
        },
        30_000,
      );
      if (!resp.ok) {
        const errText = await resp.text().catch(() => '');
        return { videoUrl, applied: false, warning: `Hailuo ${resp.status}: ${errText.slice(0, 150)}`, provider: this.name };
      }
      const data = await resp.json();
      if (data.base_resp?.status_code && data.base_resp.status_code !== 0) {
        return {
          videoUrl, applied: false,
          warning: `Hailuo (${data.base_resp.status_code}): ${data.base_resp.status_msg}`,
          provider: this.name,
        };
      }
      const taskId = data.task_id || data.data?.task_id;
      if (!taskId) return { videoUrl, applied: false, warning: 'Hailuo no task_id', provider: this.name };
      const syncedUrl = await this.pollResult(taskId, 60, options?.onProgress);
      if (!syncedUrl) return { videoUrl, applied: false, warning: 'Hailuo poll timeout', provider: this.name };
      return { videoUrl: syncedUrl, applied: true, provider: this.name };
    } catch (e) {
      return { videoUrl, applied: false, warning: e instanceof Error ? e.message : 'hailuo error', provider: this.name };
    }
  }

  private async pollResult(taskId: string, maxAttempts: number, onProgress?: (p: number, s: string) => void): Promise<string | null> {
    for (let i = 0; i < maxAttempts; i++) {
      await sleep(5000);
      try {
        const resp = await fetchWithTimeout(
          `${this.baseURL}/v1/query/lipsync_generation?task_id=${taskId}`,
          { method: 'GET', headers: { 'Authorization': `Bearer ${this.apiKey}` } },
          15_000,
        );
        if (!resp.ok) continue;
        const data = await resp.json();
        const status = (data.status || data.data?.status || '').toLowerCase();
        onProgress?.(Math.round(((i + 1) / maxAttempts) * 100), status || 'polling');
        if (status === 'success' || status === 'completed') {
          return data.video_url || data.data?.video_url || data.file?.download_url || null;
        }
        if (status === 'failed' || status === 'fail') return null;
      } catch { /* ignore */ }
    }
    return null;
  }
}

// ─── Router ─────────────────────────────────────────────────────────────────
const PROVIDERS = {
  kling: new KlingLipSyncProvider(),
  syncso: new SyncSoLipSyncProvider(),
  hailuo: new HailuoLipSyncProvider(),
} as const;

/**
 * 选 provider — 按 LIPSYNC_PROVIDER env 优先, 没设走 auto (按 kling > syncso > hailuo).
 * 返 null 表示没任何可用 provider.
 */
export function selectProvider(): LipSyncProvider | null {
  const preferred = (process.env.LIPSYNC_PROVIDER || 'auto').toLowerCase() as LipSyncProviderName | 'auto';
  if (preferred !== 'auto' && preferred in PROVIDERS) {
    const p = PROVIDERS[preferred as LipSyncProviderName];
    if (p.isAvailable()) return p;
  }
  // auto: 按顺序找第 1 个可用的
  for (const name of ['kling', 'syncso', 'hailuo'] as const) {
    if (PROVIDERS[name].isAvailable()) return PROVIDERS[name];
  }
  return null;
}

/** 列出所有可用的 provider, 给 admin UI / 健康检查用. */
export function listAvailableProviders(): LipSyncProviderName[] {
  return (['kling', 'syncso', 'hailuo'] as const).filter((n) => PROVIDERS[n].isAvailable());
}
