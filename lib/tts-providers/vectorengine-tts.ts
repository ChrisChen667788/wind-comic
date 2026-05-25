/**
 * v6.9 — vectorengine TTS provider (补全配音).
 *
 * 现有 minimax-tts 被 MINIMAX_GROUP_ID 占位卡住 (配置缺失). vectorengine 的 OpenAI 兼容
 * /v1/audio/speech (gpt-4o-mini-tts) 实测可直接出 mp3 → 作为 TTS 主路径, minimax 兜底.
 * 优先级 50 < minimax-tts(100) → dispatchTTSGenerate 先选它.
 */

import { registerTTSProvider } from './registry';
import type { TTSGenerateInput } from './types';

/** 项目内 voiceId (narrator_male_cn 等) → OpenAI tts voice. 纯函数, 可单测. */
export function mapVoiceToOpenAI(voiceId?: string): string {
  const v = (voiceId || '').toLowerCase();
  if (/female|woman|girl|女/.test(v)) return 'nova';
  if (/male|man|boy|男/.test(v)) return 'onyx';
  return 'alloy';
}

function veCreds(): { key: string; base: string } {
  const key = process.env.VECTORENGINE_API_KEY || process.env.KELING_API_KEY || '';
  const base = process.env.VECTORENGINE_BASE_URL || process.env.KELING_BASE_URL || 'https://api.vectorengine.ai';
  return { key, base };
}

registerTTSProvider({
  id: 'vectorengine-tts',
  name: 'vectorengine TTS (gpt-4o-mini-tts)',
  priority: 50, // < minimax-tts(100) → 主路径; minimax 兜底
  supportsEmotion: false,
  supportsCloning: false,
  supportsStreaming: false,
  maxTextLen: 4000,
  supportedLanguages: [], // 任意语言
  available: () => !!(process.env.VECTORENGINE_API_KEY || process.env.KELING_API_KEY),
  async generate(input: TTSGenerateInput) {
    const { key, base } = veCreds();
    if (!key) throw new Error('vectorengine TTS: no key');
    const model = process.env.VE_TTS_MODEL || 'gpt-4o-mini-tts';
    const res = await fetch(`${base}/v1/audio/speech`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        input: input.text,
        voice: mapVoiceToOpenAI(input.voiceId),
        response_format: 'mp3',
        ...(input.speed ? { speed: input.speed } : {}),
      }),
      signal: AbortSignal.timeout(60_000),
    });
    if (!res.ok) throw new Error(`vectorengine TTS ${res.status}: ${(await res.text()).slice(0, 100)}`);
    const buf = Buffer.from(await res.arrayBuffer());
    if (!buf.length) throw new Error('vectorengine TTS: empty audio');
    const audioUrl = `data:audio/mpeg;base64,${buf.toString('base64')}`;
    const duration = Math.max(1, Math.ceil((input.text || '').length / 4.5)); // 中文 ~4.5 字/秒
    return {
      audioUrl,
      duration,
      subtitle: [{ start: 0, end: duration, text: input.text, character: input.character }],
      provider: 'vectorengine-tts',
    };
  },
});

console.log('[TTSProviders] vectorengine-tts registered (gpt-4o-mini-tts, primary)');
