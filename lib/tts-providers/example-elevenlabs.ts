/**
 * v3.2 P2 — TTSProvider 二开范本: ElevenLabs.
 *
 * 接入步骤:
 *   1. .env.local: ENABLE_ELEVENLABS=1, ELEVENLABS_API_KEY=xxx
 *   2. import './example-elevenlabs' 一次 (或扔 TTS_PROVIDERS_DIR 由 autoDiscover 加载)
 *   3. 调度链按 priority 自动包含 ElevenLabs
 *
 * 接 OpenAI gpt-4o-mini-tts / Azure Cognitive 也是一样模板.
 */

import { registerTTSProvider } from './registry';
import type { TTSGenerateInput } from './types';

if (process.env.ENABLE_ELEVENLABS === '1' && process.env.ELEVENLABS_API_KEY) {
  registerTTSProvider({
    id: 'elevenlabs',
    name: 'ElevenLabs (multilingual v2)',
    priority: 90,    // 比 minimax 高 (100), 命中时优先
    supportsEmotion: false,         // ElevenLabs 通过 voice 选择, 不显式吃 emotion
    supportsCloning: true,          // ← 卖点
    supportsStreaming: true,
    maxTextLen: 5_000,
    supportedLanguages: [],          // [] = 任何语言
    available: () => !!process.env.ELEVENLABS_API_KEY,
    async generate(input: TTSGenerateInput) {
      const key = process.env.ELEVENLABS_API_KEY!;
      const base = process.env.ELEVENLABS_BASE_URL || 'https://api.elevenlabs.io';

      const res = await fetch(`${base}/v1/text-to-speech/${encodeURIComponent(input.voiceId)}`, {
        method: 'POST',
        headers: {
          'xi-api-key': key,
          'Content-Type': 'application/json',
          Accept: 'audio/mpeg',
        },
        body: JSON.stringify({
          text: input.text,
          model_id: 'eleven_multilingual_v2',
          voice_settings: {
            stability: 0.5,
            similarity_boost: 0.75,
          },
        }),
        signal: AbortSignal.timeout(60_000),
      });
      if (!res.ok) {
        throw new Error(`elevenlabs ${res.status}: ${(await res.text()).slice(0, 200)}`);
      }
      const buf = Buffer.from(await res.arrayBuffer());
      const audioUrl = `data:audio/mpeg;base64,${buf.toString('base64')}`;

      // ElevenLabs 不返回 duration — 用文本长度估算 (中文 ~4 char/s, 英文 ~10 char/s)
      const chineseChars = (input.text.match(/[一-龥]/g) || []).length;
      const otherChars = input.text.length - chineseChars;
      const duration = Math.max(1, chineseChars / 4 + otherChars / 10);

      return {
        audioUrl,
        duration,
        subtitle: [{
          start: 0,
          end: duration,
          text: input.text,
          character: input.character,
        }],
        provider: 'elevenlabs',
      };
    },
  });
  console.log('[TTSProviders] elevenlabs registered (priority 90)');
}
