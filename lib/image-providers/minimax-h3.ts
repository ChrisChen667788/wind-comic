import { H3_IMAGE_TIMEOUT_MS, h3ImageSettings } from '../minimax-h3-image';
import { registerImageProvider } from './registry';

registerImageProvider({
  id: 'minimax-h3',
  name: 'MiniMax H3 text to image',
  supportsRefs: false,
  maxRefImages: 0,
  priority: 60,
  available: () => !!h3ImageSettings(),
  async generate({ prompt, aspectRatio }) {
    const settings = h3ImageSettings();
    if (!settings) throw new Error('MiniMax H3 image generation is unavailable');

    // H3 bills successful requests even if the client disconnects. Submit once.
    const response = await fetch(settings.endpoint, {
      method: 'POST',
      signal: AbortSignal.timeout(H3_IMAGE_TIMEOUT_MS),
      headers: { Authorization: `Bearer ${settings.apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: settings.model,
        prompt,
        n: 1,
        response_format: 'url',
        aspect_ratio: aspectRatio === '2.35:1' ? '47:20' : aspectRatio,
      }),
    });
    const body = await response.json();
    const image = body?.data?.[0];
    if (!response.ok || body?.error || image?.error) {
      const message = body?.error?.message || image?.error?.message || response.statusText;
      throw new Error(`MiniMax H3 image generation failed (HTTP ${response.status}): ${message}`);
    }
    if (typeof image?.url !== 'string' || !/^https?:\/\//.test(image.url)) {
      throw new Error('MiniMax H3 returned no image URL');
    }
    return { imageUrl: image.url, provider: 'minimax-h3', upstreamId: body.request_id };
  },
});
