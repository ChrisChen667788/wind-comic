import { API_CONFIG } from '@/lib/config';

interface BananaResponse {
  id: string;
  message: string;
  created: number;
  apiVersion: string;
  modelOutputs: Array<{
    image_base64?: string;
    images?: string[];
  }>;
  finished: boolean;
}

export class BananaService {
  private apiKey: string;
  private modelKey: string;
  private baseURL: string;

  constructor() {
    this.apiKey = API_CONFIG.banana.apiKey;
    this.modelKey = API_CONFIG.banana.modelKey;
    this.baseURL = API_CONFIG.banana.baseURL;
  }

  // 生成图片
  async generateImage(prompt: string, options?: {
    negativePrompt?: string;
    width?: number;
    height?: number;
    numInferenceSteps?: number;
    guidanceScale?: number;
  }): Promise<string> {
    try {
      // 启动生成任务
      const startResponse = await fetch(`${this.baseURL}/start/v4`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          apiKey: this.apiKey,
          modelKey: this.modelKey,
          modelInputs: {
            prompt: prompt,
            negative_prompt: options?.negativePrompt || 'low quality, blurry, distorted',
            num_inference_steps: options?.numInferenceSteps || 30,
            guidance_scale: options?.guidanceScale || 7.5,
            width: options?.width || 1024,
            height: options?.height || 1024,
          },
        }),
      });

      if (!startResponse.ok) {
        throw new Error(`Banana API error: ${startResponse.statusText}`);
      }

      const startData = await startResponse.json();
      const callId = startData.callID;

      // 轮询结果
      const imageUrl = await this.pollResult(callId);
      return imageUrl;
    } catch (error) {
      console.error('Banana image generation error:', error);
      throw error;
    }
  }

  // 轮询结果
  private async pollResult(callId: string, maxAttempts = 60): Promise<string> {
    for (let i = 0; i < maxAttempts; i++) {
      await this.sleep(2000); // 等待 2 秒

      const checkResponse = await fetch(`${this.baseURL}/check/v4`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          apiKey: this.apiKey,
          callID: callId,
        }),
      });

      if (!checkResponse.ok) {
        throw new Error(`Banana check error: ${checkResponse.statusText}`);
      }

      const checkData: BananaResponse = await checkResponse.json();

      if (checkData.finished) {
        // 提取图片 URL
        const modelOutputs = checkData.modelOutputs[0];

        if (modelOutputs.images && modelOutputs.images.length > 0) {
          return modelOutputs.images[0];
        }

        if (modelOutputs.image_base64) {
          // 如果返回的是 base64，需要转换为 URL
          return `data:image/png;base64,${modelOutputs.image_base64}`;
        }

        throw new Error('No image found in response');
      }
    }

    throw new Error('Image generation timeout');
  }

  // 批量生成图片
  async generateImages(prompts: string[], options?: {
    negativePrompt?: string;
    width?: number;
    height?: number;
  }): Promise<string[]> {
    const results: string[] = [];

    for (const prompt of prompts) {
      const imageUrl = await this.generateImage(prompt, options);
      results.push(imageUrl);
    }

    return results;
  }

  // 辅助函数：延迟
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
