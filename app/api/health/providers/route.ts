import { NextRequest, NextResponse } from 'next/server';
import {
  isPlaceholder, classifyHttp, classifyMinimax, extractGatewayBalance, overallHealth,
  type ProviderHealth, type ProviderKind,
} from '@/lib/provider-health';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const PROBE_TIMEOUT = 10_000;
const CACHE_TTL = 60_000;
let cache: { at: number; payload: any } | null = null;

async function timedFetch(url: string, opts: RequestInit = {}): Promise<{ httpStatus?: number; body?: string; error?: string }> {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), PROBE_TIMEOUT);
  try {
    const res = await fetch(url, { ...opts, signal: ctl.signal });
    return { httpStatus: res.status, body: await res.text() };
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  } finally { clearTimeout(t); }
}

function tryJson(s?: string): any { try { return s ? JSON.parse(s) : null; } catch { return null; } }

/** 一个 provider 探测 — 返回 ProviderHealth, 永不回传 key. */
async function probeMinimaxLLM(): Promise<ProviderHealth> {
  const llmModel = process.env.OPENAI_MODEL || 'default';
  const base = { id: 'primary-llm', label: `主 LLM · ${llmModel} (编剧/导演)`, kind: 'llm' as ProviderKind, baseUrl: process.env.OPENAI_BASE_URL };
  const key = process.env.OPENAI_API_KEY;
  if (isPlaceholder(key)) return { ...base, status: 'not_configured', detail: '未设置 OPENAI_API_KEY' };
  const t0 = Date.now();
  const r = await timedFetch(`${process.env.OPENAI_BASE_URL || 'https://api.minimaxi.com/v1'}/chat/completions`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
    body: JSON.stringify({ model: process.env.OPENAI_MODEL || 'MiniMax-M2', messages: [{ role: 'user', content: 'hi' }], max_tokens: 1 }),
  });
  const j = tryJson(r.body);
  const cls = j?.base_resp ? classifyMinimax(j.base_resp) : classifyHttp(r);
  return { ...base, ...cls, latencyMs: Date.now() - t0 };
}

async function probeMinimaxTTS(): Promise<ProviderHealth> {
  const base = { id: 'minimax-tts', label: 'MiniMax TTS (语音/解说音轨)', kind: 'tts' as ProviderKind, baseUrl: process.env.MINIMAX_BASE_URL };
  const key = process.env.MINIMAX_API_KEY;
  if (isPlaceholder(key)) return { ...base, status: 'not_configured', detail: '未设置 MINIMAX_API_KEY' };
  if (isPlaceholder(process.env.MINIMAX_GROUP_ID)) {
    return { ...base, status: 'misconfigured', detail: 'MINIMAX_GROUP_ID 未设置 (控制台获取后填入)' };
  }
  const t0 = Date.now();
  const r = await timedFetch(`${process.env.MINIMAX_BASE_URL || 'https://api.minimaxi.com'}/v1/t2a_v2?GroupId=${process.env.MINIMAX_GROUP_ID}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
    body: JSON.stringify({ model: 'speech-2.5-hd-preview', text: '测试', stream: false, voice_setting: { voice_id: 'male-qn-qingse', speed: 1, vol: 1, pitch: 0 }, audio_setting: { format: 'mp3' } }),
  });
  const j = tryJson(r.body);
  const cls = j?.base_resp ? classifyMinimax(j.base_resp) : classifyHttp(r);
  return { ...base, ...cls, latencyMs: Date.now() - t0 };
}

async function probeGateway(id: string, label: string, baseUrl: string, key?: string): Promise<ProviderHealth> {
  const base = { id, label, kind: 'gateway' as ProviderKind, baseUrl };
  if (isPlaceholder(key)) return { ...base, status: 'not_configured', detail: '未设置 API Key' };
  const auth = { Authorization: `Bearer ${key}` };
  const t0 = Date.now();
  const [models, sub, usage] = await Promise.all([
    timedFetch(`${baseUrl}/v1/models`, { headers: auth }),
    timedFetch(`${baseUrl}/v1/dashboard/billing/subscription`, { headers: auth }),
    timedFetch(`${baseUrl}/v1/dashboard/billing/usage?start_date=2020-01-01&end_date=2099-01-01`, { headers: auth }),
  ]);
  const cls = classifyHttp(models);
  const subJ = tryJson(sub.body);
  const usageJ = tryJson(usage.body);
  const balance = extractGatewayBalance(subJ, typeof usageJ?.total_usage === 'number' ? usageJ.total_usage : undefined);
  return { ...base, ...cls, balance, latencyMs: Date.now() - t0 };
}

/** 可选/未接入的 provider — 仅看 key 是否配置, 不打网络. */
function optionalProvider(id: string, label: string, kind: ProviderKind, key?: string): ProviderHealth | null {
  if (!isPlaceholder(key)) return null; // 已配置的会单独探测
  return { id, label, kind, status: 'not_configured', detail: '未接入 (可选)' };
}

export async function GET(request: NextRequest) {
  const fresh = request.nextUrl.searchParams.get('fresh') === '1';
  if (!fresh && cache && Date.now() - cache.at < CACHE_TTL) {
    return NextResponse.json({ ...cache.payload, cached: true });
  }

  // vectorengine 探测用仍指向它的 KELING_* (VEO_* 可能已被 repoint 到 qingyuntop)
  const veBase = process.env.KELING_BASE_URL || 'https://api.vectorengine.ai';
  const veKey = process.env.KELING_API_KEY || process.env.VEO_API_KEY;

  const probes = await Promise.all([
    probeMinimaxLLM(),
    probeMinimaxTTS(),
    probeGateway('qingyuntop', 'qingyuntop 网关 (Vidu/聚合视频)', process.env.QINGYUNTOP_BASE_URL || 'https://api.qingyuntop.top', process.env.QINGYUNTOP_API_KEY),
    probeGateway('vectorengine', 'vectorengine 网关 (Keling/Veo 视频)', veBase, veKey),
  ]);

  // 未接入的可选 provider (仅提示)
  const optionals = [
    optionalProvider('midjourney', 'Midjourney (图像)', 'image', process.env.MJ_API_KEY),
    optionalProvider('fal-flux', 'fal / FLUX (图像一致性)', 'image', process.env.FAL_KEY),
    optionalProvider('elevenlabs', 'ElevenLabs (配音)', 'tts', process.env.ELEVENLABS_API_KEY),
    optionalProvider('runway', 'Runway (视频)', 'video', process.env.RUNWAY_API_KEY),
  ].filter(Boolean) as ProviderHealth[];

  const providers = [...probes, ...optionals];
  const payload = {
    overall: overallHealth(probes), // 整体只看已配置的核心 provider
    checkedAt: new Date().toISOString(),
    providers,
  };
  cache = { at: Date.now(), payload };
  return NextResponse.json({ ...payload, cached: false });
}
