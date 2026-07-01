/**
 * 逐镜风格质量门禁(P0-1,v12.60.0)。
 *
 * 病根:健康出片时仍有**少数镜头随机崩**——有的镜是真·仿真人,有的镜突然变 3D 塑料感 / 烤入乱码文字 /
 * 脸手畸变(实测满血仿真人冷萃广告:多数镜好,个别镜 3D+乱码)。cameo-retry 只管「角色一致性(需 cref)」,
 * 不管「仿真人度 / 烤字 / 画质崩坏」。本门禁补这层:VLM 给每镜图打分,不达标→重生(图是杠杆,视频继承),
 * 把「碰运气」变成「有质量下限」。vision 挂了(网络/无 key)→ 放行不阻塞主流程。
 *
 * 纯逻辑(解析 + 判定)可单测;真正调 VLM 在 scoreShotStyle(复用 cameo-vision 的 vision 入口)。
 */
import { API_CONFIG } from '@/lib/config';

export interface ShotStyleScore {
  photoreal: number;      // 0-100:真人实拍照片质感=90+;3D/CGI/卡通/插画/塑料感=40 以下
  hasBakedText: boolean;  // 画面是否被「画」进文字/字幕(尤其 AI 糊字/乱码假字)
  quality: number;        // 0-100:脸崩/多指/肢体畸变/严重伪影,越干净越高
  issues: string[];
}

const clamp = (n: number): number => Math.max(0, Math.min(100, Math.round(Number(n) || 0)));

export const SHOT_GATE_SYSTEM_PROMPT = `你是广告成片质检员。看这张广告分镜画面,严格只输出一个 JSON 对象(不要 markdown 包裹):
{
  "photoreal": 整数 0-100,   // 真人实拍照片质感=90+;明显 3D 渲染/CGI/卡通/插画/游戏引擎/塑料感=40 以下
  "hasBakedText": true/false, // 画面里是否被"画"进了文字/字幕/标语(尤其 AI 生成的糊字、乱码假英文、假中文)。真实自然场景里清晰真实的招牌不算;AI 糊字/乱码算 true
  "quality": 整数 0-100,     // 综合画质:有无脸部崩坏、多指/畸形手、肢体扭曲、严重伪影,越干净越高
  "issues": ["简短中文问题, 最多 4 条"]
}`;

/** 解析 VLM 返回(容忍字符串/对象/多余字段)。非法 → null。纯函数。 */
export function parseShotGate(raw: unknown): ShotStyleScore | null {
  let j: any = raw;
  if (typeof raw === 'string') {
    try { j = JSON.parse(raw); } catch {
      const m = raw.match(/\{[\s\S]*\}/);
      if (!m) return null;
      try { j = JSON.parse(m[0]); } catch { return null; }
    }
  }
  if (!j || typeof j !== 'object' || typeof j.photoreal !== 'number') return null;
  return {
    photoreal: clamp(j.photoreal),
    hasBakedText: j.hasBakedText === true || j.hasBakedText === 'true',
    quality: typeof j.quality === 'number' ? clamp(j.quality) : 100,
    issues: Array.isArray(j.issues) ? j.issues.map((x: unknown) => String(x)).slice(0, 4) : [],
  };
}

export interface ShotGateOpts {
  requirePhotoreal?: boolean; // 商业仿真人片=true(否则不查 3D)
  photorealMin?: number;      // 默认 70
  qualityMin?: number;        // 默认 55
}

/** 是否过关 + 不过关的原因(供重生 prompt 定向补强)。纯函数,可单测。 */
export function shotGatePass(s: ShotStyleScore, opts: ShotGateOpts = {}): { pass: boolean; reasons: string[] } {
  const reasons: string[] = [];
  const photorealMin = opts.photorealMin ?? 70;
  const qualityMin = opts.qualityMin ?? 55;
  if (opts.requirePhotoreal && s.photoreal < photorealMin) reasons.push(`3d`);
  if (s.hasBakedText) reasons.push(`baked-text`);
  if (s.quality < qualityMin) reasons.push(`low-quality`);
  return { pass: reasons.length === 0, reasons };
}

/** 原因码 → 重生 prompt 补强片段。纯函数。 */
export function gateFixHint(reasons: string[]): string {
  const bits: string[] = [];
  if (reasons.includes('3d')) bits.push('photorealistic real photography, real human skin with pores, absolutely NO 3d render / NO cgi / NO cartoon / NO illustration');
  if (reasons.includes('baked-text')) bits.push('absolutely NO text, NO letters, NO captions, NO signage anywhere in the frame');
  if (reasons.includes('low-quality')) bits.push('anatomically correct hands and face, no distortion, no artifacts, sharp clean detail');
  return bits.join(', ');
}

/** 调 VLM 给单张镜头图打分。无 key / vision 挂 → null(调用方放行)。 */
export async function scoreShotStyle(imageUrl: string): Promise<ShotStyleScore | null> {
  if (!API_CONFIG.openai.apiKey) return null;
  const { toVisionImageInput } = await import('@/lib/cameo-vision');
  const visionInput = await toVisionImageInput(imageUrl);
  if (!visionInput) return null;
  try {
    const OpenAI = (await import('openai')).default;
    const client = new OpenAI({ apiKey: API_CONFIG.openai.apiKey, baseURL: API_CONFIG.openai.baseURL });
    const resp = await client.chat.completions.create({
      model: API_CONFIG.openai.model,
      response_format: { type: 'json_object' },
      max_tokens: 300,
      messages: [
        { role: 'system', content: SHOT_GATE_SYSTEM_PROMPT },
        { role: 'user', content: [{ type: 'text', text: '质检这张广告画面' }, { type: 'image_url', image_url: { url: visionInput } }] as any },
      ],
    });
    return parseShotGate(resp.choices?.[0]?.message?.content || '');
  } catch (e) {
    console.warn('[ShotGate] score failed:', e instanceof Error ? e.message : e);
    return null;
  }
}

/**
 * 门禁闭环:打分 → 不达标 → regenerate → 再打分,最多 maxRetries 次。
 * vision 打分为 null(挂了)→ 直接放行(不阻塞出片)。返回最终图 + 前后分。
 */
export async function evaluateShotStyle(input: {
  imageUrl: string;
  gateOpts?: ShotGateOpts;
  maxRetries?: number;
  regenerate: (attempt: number, fixHint: string, reasons: string[]) => Promise<string>;
}): Promise<{ finalUrl: string; retried: boolean; firstScore: ShotStyleScore | null; finalScore: ShotStyleScore | null; reasons: string[] }> {
  const maxRetries = Math.max(0, Math.min(input.maxRetries ?? 1, 2));
  let url = input.imageUrl;
  const first = await scoreShotStyle(url);
  let cur = first;
  let retried = false;
  let reasons: string[] = [];
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    if (!cur) break; // vision 挂 → 放行
    const v = shotGatePass(cur, input.gateOpts);
    if (v.pass) break;
    reasons = v.reasons;
    let newUrl = '';
    try { newUrl = await input.regenerate(attempt, gateFixHint(v.reasons), v.reasons); } catch { break; }
    if (!newUrl || newUrl === url) break;
    url = newUrl;
    retried = true;
    cur = await scoreShotStyle(url);
  }
  return { finalUrl: url, retried, firstScore: first, finalScore: cur, reasons };
}
