/**
 * OpenRouter 图像生成档(v12.96.0,P0-2 图像跨网关兜底)。
 *
 * 病根:MJ 通道 parameter error 时图像只剩 minimax/kontext 同类网关档,整组翻车 → 分镜全占位
 * (实测 12 占位残片)。OpenRouter 聚合多家图像模型(gemini-flash-image 等)且 provider 级自动
 * failover —— 作图像链**最后真实档**(mock 之前)。
 *
 * API 形态:OpenAI chat/completions + `modalities:["image","text"]`,返回
 * choices[0].message.images[0].image_url.url(data:base64)。纯请求构造可单测。
 */

export function buildOpenRouterImageRequest(prompt: string, aspectRatio?: string, model?: string): {
  model: string; messages: Array<{ role: string; content: string }>; modalities: string[];
} {
  const aspectHint = aspectRatio === '9:16'
    ? ' Vertical 9:16 portrait composition.'
    : aspectRatio === '1:1' ? ' Square 1:1 composition.' : ' Wide 16:9 cinematic composition.';
  return {
    model: model || 'google/gemini-2.5-flash-image',
    messages: [{ role: 'user', content: `${prompt}${aspectHint}` }],
    modalities: ['image', 'text'],
  };
}

/** 生成一张图,返回 data:URI;未配 key / 失败 → ''(调用方落下一档)。 */
export async function generateOpenRouterImage(
  prompt: string,
  opts?: { aspectRatio?: string },
  env: NodeJS.ProcessEnv = process.env,
): Promise<string> {
  const key = env.OPENROUTER_API_KEY;
  if (!key) return '';
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 90_000);
    let r: Response;
    try {
      r = await fetch(`${env.OPENROUTER_BASE_URL || 'https://openrouter.ai/api/v1'}/chat/completions`, {
        method: 'POST',
        signal: controller.signal,
        headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(buildOpenRouterImageRequest(prompt, opts?.aspectRatio, env.OPENROUTER_IMAGE_MODEL)),
      });
    } finally { clearTimeout(timer); }
    if (!r.ok) {
      console.warn(`[OpenRouterImage] HTTP ${r.status}: ${(await r.text()).slice(0, 100)}`);
      return '';
    }
    const j: any = await r.json();
    const url = j?.choices?.[0]?.message?.images?.[0]?.image_url?.url || '';
    return typeof url === 'string' && (url.startsWith('data:image') || url.startsWith('http')) ? url : '';
  } catch (e) {
    console.warn('[OpenRouterImage] 失败:', e instanceof Error ? e.message : e);
    return '';
  }
}
