import { classifyPollStatus, terminalPollMessage } from '@/lib/poll-policy';
import { API_CONFIG } from '@/lib/config';
import { fetchWithTimeout } from '@/lib/fetch-timeout';

interface KelingResponse {
  code: number;
  message: string;
  data: {
    task_id: string;
    task_status: 'submitted' | 'processing' | 'succeed' | 'failed';
    task_status_msg?: string;
    created_at: number;
    updated_at: number;
    task_result?: {
      videos: Array<{
        id: string;
        url: string;
        duration: number;
      }>;
    };
  };
}

export class KelingService {
  private apiKey: string;
  private baseURL: string;

  constructor() {
    this.apiKey = API_CONFIG.keling.apiKey;
    this.baseURL = API_CONFIG.keling.baseURL;
  }

  // 图生视频
  async generateVideo(imageUrl: string, prompt: string, options?: {
    duration?: number;
    cfgScale?: number;
  }): Promise<string> {
    try {
      // 启动视频生成任务
      // v12.304:裸 fetch 无超时 —— 网关接受 TCP 却不回 HTTP 时会挂到 OS socket 超时(数分钟)
      const response = await fetchWithTimeout(`${this.baseURL}/v1/videos/image2video`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model_name: 'kling-v1',
          image_url: imageUrl,
          prompt: prompt,
          duration: options?.duration || 5,
          cfg_scale: options?.cfgScale || 0.5,
          mode: 'std',
        }),
      });

      if (!response.ok) {
        const error = await response.text();
        throw new Error(`Keling API error: ${error}`);
      }

      const data: KelingResponse = await response.json();

      if (data.code !== 0) {
        throw new Error(`Keling API error: ${data.message}`);
      }

      const taskId = data.data.task_id;

      // 轮询结果
      const videoUrl = await this.pollResult(taskId);
      return videoUrl;
    } catch (error) {
      console.error('Keling video generation error:', error);
      throw error;
    }
  }

  // 轮询结果
  private async pollResult(taskId: string, maxAttempts = 120): Promise<string> {
    for (let i = 0; i < maxAttempts; i++) {
      await this.sleep(5000); // 等待 5 秒

      // v12.304:轮询同理 —— fetch 挂住会让整个 for 循环卡在第一次迭代,
      // maxAttempts × 5s 那套「10 分钟上限」形同虚设
      const response = await fetchWithTimeout(`${this.baseURL}/v1/videos/image2video/${taskId}`, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
        },
      });

      // v12.329:原先任何非 200 都 throw —— 轮询中一次瞬时 429/502 就把**上游其实
      // 还在跑**的任务整个丢掉,钱已经花了、结果扔了。改为区分永久与瞬时。
      if (!response.ok) {
        if (classifyPollStatus(response.status) === 'terminal') {
          throw new Error(terminalPollMessage('Keling', response.status));
        }
        continue;   // 瞬时:上游忙或抖了一下,任务多半还在跑
      }

      const data: KelingResponse = await response.json();

      if (data.code !== 0) {
        throw new Error(`Keling query error: ${data.message}`);
      }

      if (data.data.task_status === 'succeed' && data.data.task_result?.videos) {
        return data.data.task_result.videos[0].url;
      }

      if (data.data.task_status === 'failed') {
        throw new Error(`Video generation failed: ${data.data.task_status_msg}`);
      }
    }

    throw new Error('Video generation timeout');
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
