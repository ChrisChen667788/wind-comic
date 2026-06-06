/**
 * /api/voice-sample · v9.7.7 (阶段十六 · 音色试听)
 *
 * POST { voiceId, text? } → 合成一句样例 → 落盘 → 返 audioUrl 供前端试听。
 * 无 TTS 引擎(缺 MINIMAX_API_KEY)→ 200 {configured:false} + 提示(不报错)。密钥只走 env。
 */
import { NextResponse } from 'next/server';
import { persistAsset } from '@/lib/asset-storage';

export const runtime = 'nodejs';

const SAMPLE_TEXT = '你好,这是音色试听效果。';

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as { voiceId?: string; text?: string };
  const voiceId = (body?.voiceId || '').trim();
  const text = (body?.text || '').trim() || SAMPLE_TEXT;
  if (!voiceId) return NextResponse.json({ ok: false, message: '缺 voiceId' }, { status: 400 });

  await import('@/lib/tts-providers/builtins'); // 注册内置 TTS provider
  const { dispatchTTSGenerate } = await import('@/lib/tts-providers/registry');
  const r = await dispatchTTSGenerate({ text, voiceId, language: 'zh-CN' });
  if (!r.result) {
    return NextResponse.json({ ok: false, configured: false, message: 'TTS 无可用引擎(需 MINIMAX_API_KEY)' });
  }
  const p = await persistAsset(r.result.audioUrl, { ext: '.mp3', contentType: 'audio/mpeg' });
  return NextResponse.json({ ok: true, audioUrl: p?.url || r.result.audioUrl, provider: r.result.provider });
}
