/**
 * 阶段三十 v12.39.0 — 声音克隆纯函数(校验/规范化/请求体/解析,可单测)。
 *
 * 上传一段角色音样 → MiniMax voice_clone → 得到自定义 voice_id,之后 TTS 用这个 voice_id 配音 →
 * 跨集/跨语言保住同一角色音色(出海、品牌主播刚需)。竞品调研 KrillinAI/Evoars 的「声音克隆」即此。
 *
 * MiniMax 约束(2026 核实):voice_id 至少 8 位、字母+数字、字母开头。
 */

/** voice_id 合法性:≥8、仅字母数字、字母开头。 */
export function isValidVoiceId(id: string): boolean {
  return typeof id === 'string' && /^[a-zA-Z][a-zA-Z0-9]{7,}$/.test(id);
}

function hashStr(s: string): number { let h = 5381; for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0; return h; }

/**
 * 从角色名规范出一个合法 voice_id(确定性:同名同 id,可复现/可缓存)。
 * 非 ASCII 名(如「陆晚晚」)→ 取拉丁数字残余 + 'wc' 前缀 + hash 后缀补足 ≥8。
 */
export function normalizeVoiceId(name: string): string {
  const ascii = (name || '').replace(/[^a-zA-Z0-9]/g, '');
  let base = /^[a-zA-Z]/.test(ascii) ? ascii : 'wc' + ascii;
  base = base.slice(0, 16);
  const suffix = hashStr(name || 'voice').toString(36).slice(0, 6);
  if (base.length < 8) base = (base + suffix).slice(0, 16);
  // 确保字母开头(前缀已保证)+ 至少 8
  return base.length >= 8 ? base : (base + 'aaaaaaaa').slice(0, 8);
}

export interface VoiceCloneBody { file_id: string; voice_id: string; model: string; [k: string]: unknown }

/** 构造 voice_clone 请求体。model 默认 speech-02-hd(可 env 覆盖)。 */
export function buildVoiceCloneBody(fileId: string, voiceId: string, model?: string): VoiceCloneBody {
  if (!fileId) throw new Error('voice clone: file_id required');
  if (!isValidVoiceId(voiceId)) throw new Error(`voice clone: 非法 voice_id「${voiceId}」(需 ≥8、字母数字、字母开头)`);
  return { file_id: fileId, voice_id: voiceId, model: model || 'speech-02-hd' };
}

/** 解析 voice_clone 响应:base_resp 非 0 → throw;否则返回克隆好的 voice_id(= 入参 voice_id)。 */
export function parseVoiceCloneResponse(data: unknown, requestedVoiceId: string): { voiceId: string; demoAudio?: string } {
  const j = (data || {}) as { base_resp?: { status_code?: number; status_msg?: string }; voice_id?: string; demo_audio?: string };
  const code = j.base_resp?.status_code;
  if (code != null && code !== 0) throw new Error(`MiniMax voice_clone (${code}): ${j.base_resp?.status_msg || 'unknown'}`);
  return { voiceId: j.voice_id || requestedVoiceId, demoAudio: j.demo_audio };
}

/** 解析文件上传响应,取 file_id。 */
export function parseFileUploadResponse(data: unknown): string {
  const j = (data || {}) as { file?: { file_id?: string | number }; file_id?: string | number; base_resp?: { status_code?: number; status_msg?: string } };
  const code = j.base_resp?.status_code;
  if (code != null && code !== 0) throw new Error(`MiniMax file upload (${code}): ${j.base_resp?.status_msg || 'unknown'}`);
  const fid = j.file?.file_id ?? j.file_id;
  if (fid == null) throw new Error('MiniMax file upload: no file_id in response');
  return String(fid);
}
