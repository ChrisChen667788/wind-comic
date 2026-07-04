/**
 * v12.96 — OpenRouter 图像档:请求构造 + 无 key 短路。
 */
import { describe, it, expect } from 'vitest';
import { buildOpenRouterImageRequest, generateOpenRouterImage } from '@/lib/image-providers/openrouter-image';

describe('v12.96 · openrouter-image', () => {
  it('请求构造:modalities 带 image + 画幅提示注入 + 模型可覆盖', () => {
    const b = buildOpenRouterImageRequest('a coffee bottle', '9:16');
    expect(b.model).toBe('google/gemini-2.5-flash-image');
    expect(b.modalities).toEqual(['image', 'text']);
    expect(b.messages[0].content).toContain('a coffee bottle');
    expect(b.messages[0].content).toContain('9:16 portrait');
    expect(buildOpenRouterImageRequest('x', '16:9', 'my/model').model).toBe('my/model');
    expect(buildOpenRouterImageRequest('x', '1:1').messages[0].content).toContain('1:1');
  });

  it('无 OPENROUTER_API_KEY → 空串短路(不发请求,链落下一档)', async () => {
    expect(await generateOpenRouterImage('x', {}, {} as any)).toBe('');
  });
});
