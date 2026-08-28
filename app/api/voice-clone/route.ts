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
import { persistAsset } from '@/lib/asset-storage';
import { recordConsent } from '@/lib/repos/consent-log-repo';

/**
 * v12.221 合规授权门:克隆他人声音属深度合成,须先取得并留存授权凭证。
 * body/form 必须带 consent:{authorized:true, purpose, ownerDeclaration};任一缺失 → 422。
 * 支持两种传法:JSON 里嵌 consent 对象,或 multipart 里 consent_authorized/consent_purpose/consent_owner_declaration 三字段。
 */
interface Consent { authorized: boolean; purpose: string; ownerDeclaration: string }
function parseConsent(raw: any): Consent | null {
  if (!raw || typeof raw !== 'object') return null;
  const authorized = raw.authorized === true || raw.authorized === 'true' || raw.authorized === '1';
  const purpose = typeof raw.purpose === 'string' ? raw.purpose.trim() : '';
  const ownerDeclaration = typeof raw.ownerDeclaration === 'string' ? raw.ownerDeclaration.trim() : '';
  if (!authorized || !purpose || !ownerDeclaration) return null;
  return { authorized, purpose: purpose.slice(0, 200), ownerDeclaration: ownerDeclaration.slice(0, 500) };
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 180;

export async function POST(request: NextRequest) {
  const payload = getUserFromRequest(request);
  if (!payload?.sub) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  // v12.221:先校验输入(含授权门),再查能力可用性 —— 无 consent 的请求一律 422,
  // 不因「本环境未启用克隆」而用 501 掩盖授权缺失(授权门是安全不变量,与 feature flag 无关)。

  // v12.208:直收 multipart 音样文件(前端无需先调独立上传端点)——落盘持久副本得 http URL 再克隆。
  // 保留旧 JSON { sampleUrl } 路径(外链音样)。
  let sampleUrl: string | undefined;
  let nameHint: string | undefined;
  let voiceIdHint: string | undefined;
  let consent: Consent | null = null;
  const ctype = request.headers.get('content-type') || '';
  if (ctype.includes('multipart/form-data')) {
    const form = await request.formData().catch(() => null);
    const file = form?.get('file');
    nameHint = (form?.get('name') as string) || undefined;
    voiceIdHint = (form?.get('voiceId') as string) || undefined;
    consent = parseConsent({
      authorized: form?.get('consent_authorized'),
      purpose: form?.get('consent_purpose'),
      ownerDeclaration: form?.get('consent_owner_declaration'),
    });
    if (!consent) return NextResponse.json({ error: '声音克隆需勾选授权声明并填写用途:缺少或未确认 consent(authorized/purpose/ownerDeclaration)' }, { status: 422 });
    if (!(file instanceof Blob)) return NextResponse.json({ error: '缺少音样文件 file' }, { status: 400 });
    if (file.size > 5 * 1024 * 1024) return NextResponse.json({ error: '音样需 ≤5MB' }, { status: 400 });
    const buf = Buffer.from(await file.arrayBuffer());
    const dataUri = `data:${(file as any).type || 'audio/mpeg'};base64,${buf.toString('base64')}`;
    const persisted = await persistAsset(dataUri, { ext: '.mp3', contentType: (file as any).type || 'audio/mpeg' });
    // persistAsset 返回站内 /api/serve-file?key= 相对 URL → 拼成绝对 http 供 MiniMax 拉取
    const rel = persisted?.url;
    if (!rel) return NextResponse.json({ error: '音样落盘失败' }, { status: 500 });
    const origin = new URL(request.url).origin;
    sampleUrl = rel.startsWith('http') ? rel : `${origin}${rel}`;
  } else {
    let body: { sampleUrl?: string; voiceId?: string; name?: string; consent?: any };
    try { body = await request.json(); } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }
    consent = parseConsent(body.consent);
    if (!consent) return NextResponse.json({ error: '声音克隆需带授权声明:缺少或未确认 consent{authorized:true, purpose, ownerDeclaration}' }, { status: 422 });
    sampleUrl = body.sampleUrl; nameHint = body.name; voiceIdHint = body.voiceId;
  }

  if (!sampleUrl || typeof sampleUrl !== 'string' || !/^https?:\/\//.test(sampleUrl)) {
    return NextResponse.json({ error: 'sampleUrl 必须是 http(s) URL(或上传 multipart 音样文件)' }, { status: 400 });
  }
  // 输入(含授权门)已过,此处才查能力可用性。
  if (!hasVoiceClone()) return NextResponse.json({ error: '声音克隆未启用:需配置官方 MiniMax 端点 + MINIMAX_API_KEY' }, { status: 501 });

  const voiceId = voiceIdHint && isValidVoiceId(voiceIdHint)
    ? voiceIdHint
    : normalizeVoiceId(nameHint || voiceIdHint || 'voice');

  // v12.221:克隆前先落授权凭证(合规追溯)。落库失败必须中止 —— 无凭证不得执行深度合成。
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
    || request.headers.get('x-real-ip') || null;
  try {
    await recordConsent({ userId: payload.sub, action: 'voice_clone', purpose: consent.purpose, ownerDeclaration: consent.ownerDeclaration, ip });
  } catch (e) {
    return NextResponse.json({ error: '授权凭证落库失败,已中止克隆(合规要求)' }, { status: 500 });
  }

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
