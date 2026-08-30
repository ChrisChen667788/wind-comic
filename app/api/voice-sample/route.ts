/**
 * /api/voice-sample · v9.7.7 (阶段十六 · 音色试听)
 *
 * POST { voiceId, text? } → 合成一句样例 → 落盘 → 返 audioUrl 供前端试听。
 * 无 TTS 引擎(缺 MINIMAX_API_KEY)→ 200 {configured:false} + 提示(不报错)。密钥只走 env。
 */
import { NextResponse } from 'next/server';
import { guardPaidEndpoint } from '@/lib/paid-endpoint-guard';
import { persistAsset } from '@/lib/asset-storage';

export const runtime = 'nodejs';

const SAMPLE_TEXT = '你好,这是音色试听效果。';

/** 试听文本上限 —— 够听清音色即可,再长只是白烧额度 */
const SAMPLE_TEXT_MAX = 200;

export async function POST(request: Request) {
  // v12.382:付费端点必须先过守卫(鉴权 + 预算)。此前**完全没有鉴权** ——
  // 裸 curl 就能用 owner 的 key 去调 MiniMax TTS,费用全记在他账上,
  // 而且因为没有登录态,cost-log 连一条记录都写不下,发现时只剩「余额怎么没了」。
  // 同类端点(narration/synthesize、cameo/preview、character-traits/from-face)早就加了,
  // 这几个是漏网的。
  const _paid = await guardPaidEndpoint(request, { pendingCostCny: 0.05 });
  if (!_paid.ok) return _paid.response;
  const body = (await request.json().catch(() => ({}))) as { voiceId?: string; text?: string };
  const voiceId = (body?.voiceId || '').trim();
  // v12.382:试听用的文本必须截断。这是「音色试听」端点,SAMPLE_TEXT 才 13 个字,
  // 而 body.text 原来毫无长度上限 —— 传 5 万字进来照样合成,按字符计费全打在
  // owner 的 MiniMax 账上。试听不需要长文本,超出的部分只会烧钱。
  const text = ((body?.text || '').trim() || SAMPLE_TEXT).slice(0, SAMPLE_TEXT_MAX);
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
