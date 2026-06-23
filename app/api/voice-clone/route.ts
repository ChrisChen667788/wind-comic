/**
 * POST /api/voice-clone · 阶段三十 v12.39.0
 *
 * 上传角色音样 → 克隆出自定义 voice_id(MiniMax),之后填进角色配音即可跨集/跨语言保音色。
 * body: { sampleUrl:string(http,先经 /api/upload 落盘), voiceId?:string, name?:string }
 * 200 → { ok, voiceId, demoAudio?, note }
 *
 * 登录必需。诚实:本环境无音样未端到端验证(纯函数有测);voiceId 需 ≥8、字母数字、字母开头。
 */
import { NextRequest, NextResponse } from 'next/server';
import { getUserFromRequest } from '../auth/lib';
import { isValidVoiceId, normalizeVoiceId } from '@/lib/voice-clone';
import { hasVoiceClone, cloneVoice } from '@/services/voice-clone.service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 180;

export async function POST(request: NextRequest) {
  const payload = getUserFromRequest(request);
  if (!payload?.sub) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!hasVoiceClone()) return NextResponse.json({ error: '声音克隆未启用:需配置官方 MiniMax 端点 + MINIMAX_API_KEY' }, { status: 501 });

  let body: { sampleUrl?: string; voiceId?: string; name?: string };
  try { body = await request.json(); } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }

  const sampleUrl = body.sampleUrl;
  if (!sampleUrl || typeof sampleUrl !== 'string' || !/^https?:\/\//.test(sampleUrl)) {
    return NextResponse.json({ error: 'sampleUrl 必须是 http(s) URL(先经 /api/upload 落盘)' }, { status: 400 });
  }
  const voiceId = body.voiceId && isValidVoiceId(body.voiceId)
    ? body.voiceId
    : normalizeVoiceId(body.name || body.voiceId || 'voice');

  try {
    const result = await cloneVoice({ sampleUrl, voiceId });
    return NextResponse.json({
      ok: true,
      voiceId: result.voiceId,
      demoAudio: result.demoAudio,
      note: '把这个 voiceId 填进角色配音(TTS voiceId)即可跨集/跨语言保住同一音色',
    });
  } catch (e) {
    return NextResponse.json({ error: (e instanceof Error ? e.message : String(e)).slice(0, 200) }, { status: 502 });
  }
}
