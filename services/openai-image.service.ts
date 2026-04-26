import OpenAI from 'openai';
import { API_CONFIG } from '@/lib/config';

export class OpenAIImageService {
  private openai: OpenAI;

  constructor() {
    this.openai = new OpenAI({
      apiKey: API_CONFIG.openai.apiKey,
      baseURL: API_CONFIG.openai.baseURL,
    });
  }

  // 生成图片
  async generateImage(prompt: string, options?: {
    size?: '1024x1024' | '1536x1024' | '1024x1536';
    quality?: 'low' | 'medium' | 'high';
    n?: number;
  }): Promise<string> {
    try {
      const response = await this.openai.images.generate({
        model: 'gpt-image-1',
        prompt,
        size: options?.size || '1024x1024',
        quality: options?.quality || 'medium',
        n: options?.n || 1,
      });

      const imageData = response.data?.[0];
      if (!imageData) throw new Error('No image data in response');

      // gpt-image-1 返回 b64_json
      if (imageData.b64_json) {
        return `data:image/png;base64,${imageData.b64_json}`;
      }

      // 或者返回 url
      if (imageData.url) {
        return imageData.url;
      }

      throw new Error('No image data in response');
    } catch (error: any) {
      console.error('OpenAI image generation error:', error?.message || error);

      // 如果 gpt-image-1 不可用，尝试 dall-e-3
      try {
        console.log('Falling back to dall-e-3...');
        const response = await this.openai.images.generate({
          model: 'dall-e-3',
          prompt,
          size: '1024x1024',
          quality: 'standard',
          n: 1,
        });

        if (response.data?.[0]?.url) {
          return response.data[0].url;
        }
        if (response.data?.[0]?.b64_json) {
          return `data:image/png;base64,${response.data[0].b64_json}`;
        }
      } catch (fallbackError: any) {
        console.error('DALL-E 3 fallback also failed:', fallbackError?.message);
      }

      throw error;
    }
  }

  // 批量生成
  async generateImages(prompts: string[], options?: {
    size?: '1024x1024' | '1536x1024' | '1024x1536';
  }): Promise<string[]> {
    const results: string[] = [];
    for (const prompt of prompts) {
      const url = await this.generateImage(prompt, options);
      results.push(url);
    }
    return results;
  }
}
