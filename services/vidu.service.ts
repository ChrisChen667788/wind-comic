import { classifyPollStatus, terminalPollMessage } from '@/lib/poll-policy';
import { API_CONFIG } from '@/lib/config';

/**
 * services/vidu.service.ts — Vidu 官方 API(v12.403 重写)。
 *
 * ── 重写的原因:这条路径**从来就跑不通** ──────────────────────────────
 * v12.401 的竞品复核里,我为了核实「我们接的 Vidu 是哪一版」去读了这个文件,
 * 发现它**一个 model 字段都不传**。顺着官方字段表逐项对下来,错的远不止一处:
 *
 *   | 项目     | 旧实现                          | 官方                                    |
 *   |----------|----------------------------------|-----------------------------------------|
 *   | 创建端点 | `{base}/v1/video/generate`       | `https://api.vidu.com/ent/v2/img2video` |
 *   | 鉴权     | `Authorization: Bearer <key>`    | `Authorization: Token <key>`            |
 *   | 图片入参 | `image_url: "<url>"`(字符串)  | `images: ["<url>"]`(数组)             |
 *   | 模型     | **不传**                         | `model` **必填**                        |
 *   | 查询端点 | `{base}/v1/video/query/{id}`     | `{base}/ent/v2/tasks/{id}/creations`    |
 *   | 状态字段 | `status` + `completed/failed`    | `state` + `success/failed/queueing/…`   |
 *   | 取片     | `video_url`                      | `creations[].url`(24 小时有效)        |
 *
 * 六处全错 —— 也就是说它每次都失败、每次都静默回落到 Kling,所以没人发现。
 * 而 `app/api/u2v/route.ts` 还把结果标成 `model: 'Vidu-Q3-Pro-15s'`:
 * **决策日志里记着一件没发生过的事**。这个项目有「逐镜可审计决策日志」这项能力,
 * 一条撒谎的记录比没有记录更糟 —— 它会让复盘从错误的前提开始。
 *
 * 官方字段表(2026-09-02 核):
 *   https://platform.vidu.com/docs/image-to-video
 *   https://platform.vidu.com/docs/get-generation
 */

/** 官方允许的模型 id。顺序即优先级:默认取第一个能打的。 */
export const VIDU_MODELS = [
  'viduq3-pro',
  'viduq3-turbo',
  'viduq3-pro-fast',
  'viduq2-pro',
  'viduq2-turbo',
  'viduq1',
  'vidu2.0',
] as const;

/** 默认模型。Q3 Pro 才有短剧特效包与多主体锁定 —— 那正是我们要它的理由。 */
export const VIDU_DEFAULT_MODEL = 'viduq3-pro';

export function viduModel(): string {
  const m = process.env.VIDU_MODEL;
  return m && (VIDU_MODELS as readonly string[]).includes(m) ? m : VIDU_DEFAULT_MODEL;
}

/** 官方 state 机;`created/queueing/processing` 继续等,`success/failed` 终止。 */
export type ViduState = 'created' | 'queueing' | 'processing' | 'success' | 'failed';

export class ViduService {
  private apiKey: string;
  private baseURL: string;
  /** 本次实际发出的模型 —— 供调用方写进决策日志,而不是让它自己猜一个标签。 */
  public lastModel: string = VIDU_DEFAULT_MODEL;

  constructor() {
    this.apiKey = API_CONFIG.vidu.apiKey;
    // 官方主机是 api.vidu.com;历史默认值 api.vidu.ai 打不到官方接口。
    this.baseURL = process.env.VIDU_BASE_URL || 'https://api.vidu.com';
  }

  private headers(): Record<string, string> {
    // 官方用 `Token`,不是 `Bearer` —— 写错这里会得到 401,而 401 长得像「key 不对」,
    // 于是人会去换 key,换多少次都不对。
    return {
      Authorization: `Token ${this.apiKey}`,
      'Content-Type': 'application/json',
    };
  }

  /** 图生视频。images 是数组、model 必填 —— 两处都是旧实现漏掉的。 */
  async generateVideo(imageUrl: string, prompt: string, options?: {
    duration?: number;
    resolution?: string;
    movementAmplitude?: string;
    model?: string;
  }): Promise<string> {
    const model = options?.model || viduModel();
    this.lastModel = model;

    const body: Record<string, unknown> = {
      model,
      images: [imageUrl],
      prompt,
      duration: options?.duration ?? 5,
      resolution: options?.resolution || process.env.VIDU_RESOLUTION || '720p',
      movement_amplitude: options?.movementAmplitude || 'auto',
    };

    const response = await fetch(`${this.baseURL}/ent/v2/img2video`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Vidu API error (${response.status}) [${model}]: ${error.slice(0, 300)}`);
    }

    const data = await response.json();
    const taskId = data.task_id;
    if (!taskId) {
      throw new Error(`Vidu: 响应里没有 task_id [${model}]: ${JSON.stringify(data).slice(0, 300)}`);
    }

    console.log(`[Vidu] ${model} task created: ${taskId}`);
    return await this.pollResult(taskId, model);
  }

  private async pollResult(taskId: string, model: string, maxAttempts = 120): Promise<string> {
    for (let i = 0; i < maxAttempts; i++) {
      await this.sleep(5000);

      const response = await fetch(`${this.baseURL}/ent/v2/tasks/${encodeURIComponent(taskId)}/creations`, {
        method: 'GET',
        headers: this.headers(),
      });

      // v12.329:同 Keling —— 瞬时抖动不该丢掉已在生成的任务
      if (!response.ok) {
        if (classifyPollStatus(response.status) === 'terminal') {
          throw new Error(terminalPollMessage('Vidu', response.status));
        }
        continue;
      }

      const data = await response.json();
      const state = String(data.state ?? '') as ViduState;

      if (state === 'success') {
        const url = data.creations?.[0]?.url;
        if (url) return url;
        throw new Error(`Vidu 报 success 但 creations[0].url 为空 [${model}]`);
      }

      if (state === 'failed') {
        throw new Error(`Vidu 生成失败 [${model}]: ${data.err_code || data.error || 'unknown'}`);
      }

      // created / queueing / processing — 继续等待
    }

    throw new Error(`Vidu 生成超时 [${model}] (task=${taskId})`);
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
