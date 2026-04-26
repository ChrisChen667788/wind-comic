import { API_CONFIG } from '@/lib/config';

interface ViduResponse {
  task_id: string;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  video_url?: string;
  error?: string;
}

export class ViduService {
  private apiKey: string;
  private baseURL: string;

  constructor() {
    this.apiKey = API_CONFIG.vidu.apiKey;
    this.baseURL = API_CONFIG.vidu.baseURL;
  }

  // 图生视频
  async generateVideo(imageUrl: string, prompt: string, options?: {
    duration?: number;
    style?: string;
  }): Promise<string> {
    try {
      // 启动视频生成任务
      const response = await fetch(`${this.baseURL}/v1/video/generate`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          image_url: imageUrl,
          prompt: prompt,
          duration: options?.duration || 4,
          style: options?.style || 'realistic',
        }),
      });

      if (!response.ok) {
        const error = await response.text();
        throw new Error(`Vidu API error: ${error}`);
      }

      const data = await response.json();
      const taskId = data.task_id;

      // 轮询结果
      const videoUrl = await this.pollResult(taskId);
      return videoUrl;
    } catch (error) {
      console.error('Vidu video generation error:', error);
      throw error;
    }
  }

  // 轮询结果
  private async pollResult(taskId: string, maxAttempts = 120): Promise<string> {
    for (let i = 0; i < maxAttempts; i++) {
      await this.sleep(5000); // 等待 5 秒

      const response = await fetch(`${this.baseURL}/v1/video/query/${taskId}`, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
        },
      });

      if (!response.ok) {
        throw new Error(`Vidu query error: ${response.statusText}`);
      }

      const data: ViduResponse = await response.json();

      if (data.status === 'completed' && data.video_url) {
        return data.video_url;
      }

      if (data.status === 'failed') {
        throw new Error(`Video generation failed: ${data.error}`);
      }
    }

    throw new Error('Video generation timeout');
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
