/**
 * 阶段三十 v12.39.0 — MiniMax 声音克隆服务(网络;纯函数在 lib/voice-clone.ts)。
 *
 * 流程:下载音样 → MiniMax 文件上传(purpose=voice_clone)→ file_id → /v1/voice_clone → 自定义 voice_id。
 * 之后该 voice_id 可直接喂 t2a_v2(generateSpeech 的 voiceId)做配音 → 跨集/跨语言保音色。
 *
 * 诚实:本环境无音样,未做端到端真验证;请求体/响应解析为纯函数有单测(lib/voice-clone)。
 */
import { buildVoiceCloneBody, parseVoiceCloneResponse, parseFileUploadResponse, isValidVoiceId } from '@/lib/voice-clone';

function key(): string { return process.env.MINIMAX_API_KEY || ''; }
function base(): string { return (process.env.MINIMAX_BASE_URL || 'https://api.minimaxi.com').replace(/\/+$/, ''); }

/** 仅官方 minimaxi.com/io 端点 + 有 key 才可用(聚合网关不暴露 voice_clone)。 */
export function hasVoiceClone(): boolean {
  return !!key() && /minimaxi?\.(com|io)/i.test(base());
}

export interface CloneVoiceOptions { sampleUrl: string; voiceId: string; model?: string }

export async function cloneVoice(opts: CloneVoiceOptions): Promise<{ voiceId: string; demoAudio?: string }> {
  if (!hasVoiceClone()) throw new Error('voice clone 不可用:MINIMAX_API_KEY 缺失或非官方端点');
  if (!isValidVoiceId(opts.voiceId)) throw new Error(`非法 voice_id「${opts.voiceId}」`);
  const groupQ = process.env.MINIMAX_GROUP_ID ? `?GroupId=${encodeURIComponent(process.env.MINIMAX_GROUP_ID)}` : '';

  // 1. 下载音样
  const dl = await fetch(opts.sampleUrl);
  if (!dl.ok) throw new Error(`下载音样失败 ${dl.status}`);
  const buf = Buffer.from(await dl.arrayBuffer());

  // 2. 上传到 MiniMax(multipart, purpose=voice_clone)
  const form = new FormData();
  form.append('purpose', 'voice_clone');
  form.append('file', new Blob([buf]), 'voice-sample.mp3');
  const up = await fetch(`${base()}/v1/files/upload${groupQ}`, {
    method: 'POST', headers: { Authorization: `Bearer ${key()}` }, body: form,
    signal: AbortSignal.timeout(60_000),
  });
  if (!up.ok) throw new Error(`文件上传失败 ${up.status}: ${(await up.text()).slice(0, 160)}`);
  const fileId = parseFileUploadResponse(await up.json());

  // 3. 克隆
  const cl = await fetch(`${base()}/v1/voice_clone${groupQ}`, {
    method: 'POST', headers: { Authorization: `Bearer ${key()}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(buildVoiceCloneBody(fileId, opts.voiceId, opts.model || process.env.MINIMAX_TTS_MODEL)),
    signal: AbortSignal.timeout(120_000),
  });
  if (!cl.ok) throw new Error(`voice_clone 失败 ${cl.status}: ${(await cl.text()).slice(0, 160)}`);
  return parseVoiceCloneResponse(await cl.json(), opts.voiceId);
}
