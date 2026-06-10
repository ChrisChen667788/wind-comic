/**
 * v3.2 P2 — TTSProvider 内置 adapter:
 *   1. minimax-tts    (Minimax T2A-v2 / speech-2.8-hd, 默认)
 *
 * Minimax 一家就够覆盖 99% 短剧 TTS 场景 (中文 + 4 个 default voice + emotion).
 * 其他引擎 (ElevenLabs / OpenAI gpt-4o-mini-tts) 在 example-elevenlabs.ts 里给二开范本.
 */

import { registerTTSProvider } from './registry';
import type { TTSGenerateInput } from './types';
import './vectorengine-tts'; // v6.9: vectorengine gpt-4o-mini-tts (主), minimax 兜底
import '@/lib/mock-providers'; // v10.4.0: mock 三件套常驻注册(MOCK_ENGINES=1 才 available)

let ttsSvc: any = null;
async function getTTSService() {
  if (ttsSvc) return ttsSvc;
  const m = await import('@/services/tts.service');
  if (!process.env.MINIMAX_API_KEY) return null;
  ttsSvc = new (m as any).TTSService();
  return ttsSvc;
}

// ─── Provider: Minimax T2A-v2 ─────────────────────────────────────────────
registerTTSProvider({
  id: 'minimax-tts',
  name: 'Minimax T2A-v2 (speech-2.8-hd)',
  priority: 100,
  supportsEmotion: true,
  supportsCloning: false,
  supportsStreaming: false,
  maxTextLen: 5_000,
  supportedLanguages: ['zh-CN', 'en-US'],  // T2A-v2 实际支持更多, 这里列常用两个
  available: () => !!process.env.MINIMAX_API_KEY,
  async generate(input: TTSGenerateInput) {
    const svc = await getTTSService();
    if (!svc) throw new Error('Minimax TTS service unavailable');
    const r = await svc.generateVoiceover(input.text, {
      voiceId: input.voiceId,
      speed: input.speed,
      volume: input.volume,
      pitch: input.pitch,
      emotion: input.emotion,
    });
    if (!r || !r.audioUrl) throw new Error('Minimax TTS returned empty audioUrl');
    // r.subtitle 可能没有 character — 补一下方便调用方拼字幕
    const subtitle = (r.subtitle || []).map((s: any) => ({
      ...s,
      character: s.character ?? input.character,
    }));
    return {
      audioUrl: r.audioUrl,
      duration: r.duration ?? 0,
      subtitle,
      provider: 'minimax-tts',
    };
  },
});

console.log('[TTSProviders] 1 built-in registered (minimax-tts)');
