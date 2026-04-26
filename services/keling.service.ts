import { API_CONFIG } from '@/lib/config';

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
      const response = await fetch(`${this.baseURL}/v1/videos/image2video`, {
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

      const response = await fetch(`${this.baseURL}/v1/videos/image2video/${taskId}`, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
        },
      });

      if (!response.ok) {
        throw new Error(`Keling query error: ${response.statusText}`);
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
