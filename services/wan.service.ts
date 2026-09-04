/**
 * services/wan.service.ts — 阿里 **Wan 3.0**:目前唯一无版权纠纷的 30s 原生单镜路径(v12.422)。
 *
 * ── 为什么是它,而不是质量更强的 Seedance 2.5 ──────────────────────────
 * 两家都做到了 **30 秒真·单次生成**(不是拼接 —— 这一点经多源独立复核确认)。
 * 但 v12.415 曾**明确写下**「不接 Seedance 2.5:好莱坞六大停止函纠纷未和解,接入有法律风险」。
 *
 * 本轮复核到的新情况:2026-08 字节与 MPA 签了版权谅解备忘录(输出层过滤 + 面部屏蔽 +
 * C2PA Content Credentials),截至 2026-09-04 无美国联邦诉讼、API 未受限。
 * **但那份备忘录明确不处理训练数据侵权责任** —— 风险是降低了,不是消除了。
 *
 * 那是一个关于产品法律风险的判断,不该由我单方面推翻一条写下来的决定。
 * 所以这一版接 Wan 3.0:同样 30s 原生、公开 API、无版权纠纷,
 * 而 Seedance 2.5 的状态变化如实上报,由 owner 定夺。
 *
 * ── 一条必须说清的更正 ────────────────────────────────────────────────
 * v12.411 建自托管适配器时,我把 Wan 当成「Apache-2.0 权重开放」的代表。
 * **对 Wan 3.0 而言这是错的**:它的 GitHub 仓库虽挂 Apache-2.0,但截至 2026-09-01
 * 只有 README,没有任何 checkpoint、推理实现或 model card —— **权重从未发布,无法自托管**。
 * Wan 3.0 是纯 API-only 闭源模型。(Wan 2.2 有开放权重,但单次上限约 15s,到不了 30s。)
 *
 * ── 成本必须被看见 ────────────────────────────────────────────────────
 * 1080P 约 ¥1.2/输出秒 —— **一条 30s 成片 ≈ ¥36**,是注册表里最贵的引擎。
 * 一部 8–11 镜的短剧若全用 30s,单片成本就是三四百元。
 * 所以费率进了 `VIDEO_RATE_CNY_PER_SEC`,让 v12.413 的任务预算闸真能拦住它 ——
 * 否则它会按 ¥0.3/s 的默认兜底费率被低估 4 倍,预算形同虚设。
 *
 * 官方字段表(2026-09-04 核):
 *   https://www.alibabacloud.com/help/en/model-studio/wan3-video-generation-api-reference
 *   POST {base}/api/v1/services/aigc/video-generation/video-synthesis
 *     header: Authorization: Bearer sk-… · X-DashScope-Async: enable
 *     { model, input: { prompt, media: [{type,url}] }, parameters: { duration, resolution, ratio, audio } }
 *     → { output: { task_id, task_status } }
 *   GET {base}/api/v1/tasks/{task_id} → { output: { task_status, video_url } }
 *   task_status: PENDING → RUNNING → SUCCEEDED | FAILED | CANCELED | UNKNOWN
 */
import { safeFetch } from '@/lib/ssrf-guard';

/** 官方 model id。prime 是高级档,更贵。 */
export const WAN_MODELS = ['wan3.0-video', 'wan3.0-video-prime'] as const;
/** 官方 duration 枚举:整数 2–30,或 -1 让模型自己定。 */
export const WAN_DURATION_MIN = 2;
export const WAN_DURATION_MAX = 30;
const WAN_RESOLUTIONS = ['480P', '720P', '1080P'] as const;
const WAN_RATIOS = ['adaptive', '16:9', '4:3', '1:1', '3:4', '9:16'] as const;

export function hasWan(): boolean {
  const k = process.env.WAN_API_KEY || '';
  return !!k && !k.startsWith('your_');
}

export function wanModel(): string {
  const m = process.env.WAN_MODEL;
  // 乱填就回落默认,而不是把一个必然 400 的请求送出去
  return m && (WAN_MODELS as readonly string[]).includes(m) ? m : 'wan3.0-video';
}

export function wanResolution(): string {
  const r = process.env.WAN_RESOLUTION;
  return r && (WAN_RESOLUTIONS as readonly string[]).includes(r) ? r : '720P';
}

/** 画幅:项目比例能对上官方枚举就用,否则 adaptive(跟随首帧)。 */
export function wanRatio(aspect?: string): string {
  return aspect && (WAN_RATIOS as readonly string[]).includes(aspect) ? aspect : 'adaptive';
}

/** 夹到官方允许区间。-1 是官方的「你替我定」,原样放行。 */
export function clampWanDuration(sec?: number): number {
  const n = Number(sec);
  if (n === -1) return -1;
  if (!Number.isFinite(n)) return 5;
  return Math.min(WAN_DURATION_MAX, Math.max(WAN_DURATION_MIN, Math.round(n)));
}

export interface WanGenerateOptions {
  imageUrl?: string;
  durationSec?: number;
  aspectRatio?: string;
  /** 原生音频,官方默认 true */
  audio?: boolean;
  onProgress?: (pct: number, msg?: string) => void;
}

const POLL_MS = 5000;

export class WanService {
  private apiKey: string;
  private baseURL: string;
  public lastModel: string;

  constructor() {
    this.apiKey = process.env.WAN_API_KEY || '';
    // 区域化域名:新加坡/北京等各不相同,故必须可配
    this.baseURL = (process.env.WAN_BASE_URL || 'https://dashscope.aliyuncs.com').replace(/\/+$/, '');
    this.lastModel = wanModel();
  }

  async generateVideo(prompt: string, options?: WanGenerateOptions): Promise<string> {
    if (!this.apiKey) throw new Error('WAN_API_KEY 未配置');

    const model = wanModel();
    this.lastModel = model;

    const media: Array<{ type: string; url: string }> = [];
    if (options?.imageUrl && /^https?:/.test(options.imageUrl)) {
      media.push({ type: 'first_frame', url: options.imageUrl });
    }

    const body = {
      model,
      input: {
        prompt,
        ...(media.length ? { media } : {}),
      },
      parameters: {
        duration: clampWanDuration(options?.durationSec),
        resolution: wanResolution(),
        ratio: wanRatio(options?.aspectRatio),
        audio: options?.audio !== false,
      },
    };

    options?.onProgress?.(5, `提交 Wan ${model}…`);
    const res = await safeFetch(`${this.baseURL}/api/v1/services/aigc/video-generation/video-synthesis`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        // 官方要求:不带这个头就是同步调用,而 30s 视频根本等不完
        'X-DashScope-Async': 'enable',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      throw new Error(`Wan ${res.status}: ${(await res.text()).slice(0, 200)}`);
    }

    const created = await res.json();
    const taskId = created?.output?.task_id;
    if (!taskId) {
      throw new Error(`Wan 未返回 task_id:${JSON.stringify(created).slice(0, 200)}`);
    }
    return await this.poll(String(taskId), options?.onProgress);
  }

  private async poll(taskId: string, onProgress?: (p: number, m?: string) => void): Promise<string> {
    const timeoutMs = Number(process.env.WAN_TIMEOUT_MS) || 15 * 60_000;
    const attempts = Math.max(6, Math.round(timeoutMs / POLL_MS));

    for (let i = 0; i < attempts; i++) {
      await new Promise((r) => setTimeout(r, POLL_MS));
      const q = await safeFetch(`${this.baseURL}/api/v1/tasks/${encodeURIComponent(taskId)}`, {
        method: 'GET',
        headers: { Authorization: `Bearer ${this.apiKey}` },
      });
      // 瞬时抖动不该把已经在跑、已经计费的任务判死
      if (!q.ok) continue;

      const data = await q.json();
      const status = String(data?.output?.task_status ?? '').toUpperCase();
      onProgress?.(Math.min(95, 10 + i * 3), `Wan ${status || '处理中'}`);

      if (status === 'SUCCEEDED') {
        const url = data?.output?.video_url;
        if (!url) throw new Error('Wan 报 SUCCEEDED 但没有 video_url');
        onProgress?.(100, '完成');
        return url;
      }
      if (status === 'FAILED' || status === 'CANCELED') {
        throw new Error(`Wan ${status}:${data?.output?.message || data?.message || '未给原因'}`);
      }
      // PENDING / RUNNING / UNKNOWN → 继续等
    }
    throw new Error(`Wan 生成超时(task=${taskId};可调 WAN_TIMEOUT_MS)`);
  }
}
