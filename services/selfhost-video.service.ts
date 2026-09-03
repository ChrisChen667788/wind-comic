/**
 * services/selfhost-video.service.ts — **开源自托管**视频生成端点(v12.411)。
 *
 * ── 为什么这一版必须有 ────────────────────────────────────────────────
 * 本轮竞品复核把上一轮的 C2 断言**直接推翻**了。C2 原文是:
 * 「生成层已红海,开源侧质量进不了第一梯队,所以我们不在生成层竞争。」
 * 而截至 2026-09,这条已经不成立:
 *
 *   · **Wan 2.7**(阿里,2026-04,**Apache 2.0**):T2V/I2V/原生音频/声音克隆/
 *     指令编辑/首末帧,1080p 最长 15s;14B 模型 24GB 显存(RTX 4090 可跑)。
 *   · **LTX-2.5**(Lightricks,2026-08,宽松商业许可,年营收 <$1000 万免费商用):
 *     单次 diffusion 同步出音视频;FP8 量化后 16GB 显存即可跑。
 *     Artificial Analysis 榜上 I2V 第 3 / T2V 第 4,**高于闭源的 Sora 2 Pro**。
 *
 * 于是出现了一个很难看的事实:**这是一个 MIT 开源、主打「可自托管」的项目,
 * 而它的 provider 注册表里一个开源自托管生成端点都没有** —— 全是闭源商业 API。
 * 用户可以自托管这个应用,却必须为每一帧画面向别人付费、并接受别人的停服风险。
 *
 * 而停服风险不是假设:MiniMax Music 停过(410,无预告,见 v12.410);
 * Seedance 2.0 海外 API 因好莱坞版权停止函被中止过(2026-03,纠纷至今未解决)。
 *
 * ── 为什么做成通用适配器,而不是「Wan 2.7 service」──────────────────────
 * 这两个模型都在快速迭代(Wan 2.1→2.7 用了不到一年)。绑死某一个版本,
 * 下次升级就要重写一遍 —— 那正是 v12.402(MiniMax)、v12.403(Vidu)、
 * v12.404(MJ)这三版反复在还的债。
 *
 * 所以这里只约定一个**最小 HTTP 契约**,任何本地推理服务(ComfyUI 工作流包一层、
 * vLLM 风格的自建 server、Wan/LTX 官方推理脚本包一层)都能对上:
 *
 *   POST {SELFHOST_VIDEO_URL}
 *     { prompt, image_url?, duration, aspect_ratio, model? }
 *   → 同步:  { url } | { video_url } | { video_base64 }
 *   → 异步:  { task_id }  然后 GET {SELFHOST_VIDEO_URL}/{task_id} → 同上 + { status }
 *
 * 同步/异步都支持,是因为自建服务两种写法都常见;强行只认一种会把一半用户挡在门外。
 */
import { safeFetch } from '@/lib/ssrf-guard';

export function hasSelfhostVideo(): boolean {
  return !!process.env.SELFHOST_VIDEO_URL;
}

/** 自托管端点跑的是哪个模型 —— 只用于日志与决策记录,不参与请求构造。 */
export function selfhostVideoModel(): string {
  return process.env.SELFHOST_VIDEO_MODEL || 'selfhost';
}

export interface SelfhostVideoOptions {
  imageUrl?: string;
  durationSec?: number;
  aspectRatio?: string;
}

const POLL_INTERVAL_MS = 5000;

export class SelfhostVideoService {
  private baseURL: string;
  public lastModel: string;

  constructor() {
    this.baseURL = (process.env.SELFHOST_VIDEO_URL || '').replace(/\/+$/, '');
    this.lastModel = selfhostVideoModel();
  }

  async generateVideo(prompt: string, options?: SelfhostVideoOptions): Promise<string> {
    if (!this.baseURL) throw new Error('SELFHOST_VIDEO_URL 未配置');

    const body: Record<string, unknown> = {
      prompt,
      duration: Math.max(1, Math.round(options?.durationSec || 5)),
      aspect_ratio: options?.aspectRatio || '9:16',
      model: selfhostVideoModel(),
    };
    if (options?.imageUrl && /^https?:/.test(options.imageUrl)) body.image_url = options.imageUrl;

    const res = await safeFetch(this.baseURL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      throw new Error(`自托管视频服务 ${res.status}: ${(await res.text()).slice(0, 200)}`);
    }

    const data = await res.json();
    const direct = this.extractUrl(data);
    if (direct) return direct;

    const taskId = data?.task_id || data?.id;
    if (!taskId) {
      throw new Error(`自托管视频服务未返回可用结果(既无 url 也无 task_id):${JSON.stringify(data).slice(0, 200)}`);
    }
    return await this.poll(String(taskId));
  }

  private extractUrl(data: any): string | null {
    const url = data?.url || data?.video_url || data?.output?.url;
    if (typeof url === 'string' && url) return url;
    if (typeof data?.video_base64 === 'string' && data.video_base64) {
      return `data:video/mp4;base64,${data.video_base64}`;
    }
    return null;
  }

  private async poll(taskId: string): Promise<string> {
    const timeoutMs = Number(process.env.SELFHOST_VIDEO_TIMEOUT_MS) || 15 * 60_000;
    const attempts = Math.max(6, Math.round(timeoutMs / POLL_INTERVAL_MS));

    for (let i = 0; i < attempts; i++) {
      await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
      const res = await safeFetch(`${this.baseURL}/${encodeURIComponent(taskId)}`, { method: 'GET' });
      // 自建服务重启/冷启很常见 —— 瞬时非 200 不该把已经在跑的任务判死
      if (!res.ok) continue;

      const data = await res.json();
      const status = String(data?.status ?? '').toLowerCase();
      if (['failed', 'error', 'cancelled'].includes(status)) {
        throw new Error(`自托管视频生成失败:${data?.error || status}`);
      }
      const url = this.extractUrl(data);
      if (url) return url;
    }
    throw new Error(`自托管视频生成超时(task=${taskId};可调 SELFHOST_VIDEO_TIMEOUT_MS)`);
  }
}
