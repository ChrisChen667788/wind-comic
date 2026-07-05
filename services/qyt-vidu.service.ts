/**
 * Vidu(经 qingyuntop 网关,v12.104.0)——视频链扩容第一条新通道。
 *
 * 背景:veo 通道死(503 无渠道)、minimax 队列慢,视频供给单点化。qingyuntop 探测确认
 * viduq3 走 **Vidu 官方专属接口**(网关原样转发):
 *   - POST /ent/v2/text2video  {model, prompt, duration, aspect_ratio}
 *   - POST /ent/v2/img2video   {model, images:[url], prompt, duration, aspect_ratio}
 *   - GET  /ent/v2/tasks/{id}/creations → {state: created|queueing|processing|success|failed, creations:[{url}]}
 * 探测实录:路径正确(429 saturated=通道瞬时饱和,而非 Invalid URL/禁止调用)。
 * 复用 OPENAI_API_KEY/OPENAI_BASE_URL 的 origin;QYT_VIDU_DISABLE=1 可关。
 */
import { API_CONFIG } from '@/lib/config';

const POLL_INTERVAL_MS = 8_000;
const POLL_TIMEOUT_MS = Number(process.env.QYT_VIDU_POLL_TIMEOUT_MS) || 6 * 60_000;

function gatewayOrigin(): string {
  try { return new URL(API_CONFIG.openai.baseURL).origin; } catch { return 'https://api.qingyuntop.top'; }
}

export function hasQytVidu(): boolean {
  return !!API_CONFIG.openai.apiKey && process.env.QYT_VIDU_DISABLE !== '1';
}

export class QytViduService {
  private key = API_CONFIG.openai.apiKey;
  private base = gatewayOrigin();
  private model = process.env.QYT_VIDU_MODEL || 'viduq3';

  async generateVideo(imageUrl: string, prompt: string, options?: {
    duration?: number; aspectRatio?: string;
  }): Promise<string> {
    const hasImage = !!imageUrl && imageUrl.startsWith('http');
    const path = hasImage ? '/ent/v2/img2video' : '/ent/v2/text2video';
    const body: Record<string, unknown> = {
      model: this.model,
      prompt: prompt.slice(0, 1500),
      duration: Math.min(Math.max(options?.duration || 5, 4), 8),
      aspect_ratio: options?.aspectRatio || '9:16',
    };
    if (hasImage) body.images = [imageUrl];

    const r = await fetch(`${this.base}${path}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const j: any = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(`QytVidu create HTTP ${r.status}: ${JSON.stringify(j).slice(0, 160)}`);
    const taskId = j.task_id || j.id || j.data?.task_id;
    if (!taskId) throw new Error(`QytVidu: no task_id: ${JSON.stringify(j).slice(0, 160)}`);
    console.log(`[QytVidu] ${this.model} task created: ${taskId} (${hasImage ? 'i2v' : 't2v'})`);

    const t0 = Date.now();
    while (Date.now() - t0 < POLL_TIMEOUT_MS) {
      await new Promise((res) => setTimeout(res, POLL_INTERVAL_MS));
      const q = await fetch(`${this.base}/ent/v2/tasks/${encodeURIComponent(taskId)}/creations`, {
        headers: { Authorization: `Bearer ${this.key}` },
      });
      const qj: any = await q.json().catch(() => ({}));
      const state = qj.state || qj.status || qj.data?.state;
      if (state === 'success' || state === 'completed') {
        const url = qj.creations?.[0]?.url || qj.data?.creations?.[0]?.url || qj.video_url;
        if (url) { console.log(`[QytVidu] ✅ ${this.model} 出片`); return url; }
        throw new Error(`QytVidu: success 但无 url: ${JSON.stringify(qj).slice(0, 160)}`);
      }
      if (state === 'failed' || state === 'error') {
        throw new Error(`QytVidu 生成失败: ${JSON.stringify(qj.err_code || qj).slice(0, 160)}`);
      }
      console.log(`[QytVidu] poll: state=${state || '?'}`);
    }
    throw new Error(`QytVidu timeout (${Math.round(POLL_TIMEOUT_MS / 60000)}min)`);
  }
}
