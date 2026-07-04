/**
 * AnyText 封面/海报(v12.97.0,调研落地 P1-4)。
 *
 * AnyText(ModelScope iic/cv_anytext_text_generation_editing,阿里开源)能把**正确的中文文字**
 * 直接"长"在扩散图像里 —— 超越 ffmpeg drawtext 的排版质感(文字随光影/材质融入设计)。
 * 部署形态多样(ModelScope 创空间/本地 GPU/自托管 API),故走 **BYO 推理端点**:
 * `ANYTEXT_API_URL` 指向用户自己的 AnyText 服务(POST JSON,返回 image url/base64);
 * 未配 → 503 + 启用指引,主链零依赖。纯 payload/解析可单测。
 */

export interface AnyTextCoverInput {
  title: string;        // 封面大字(AnyText 渲染进画面)
  scenePrompt?: string; // 背景画面描述(英文更稳),缺省电商海报风
  aspectRatio?: '9:16' | '16:9' | '1:1';
}

/** 构造 AnyText 请求 payload(通用形态:prompt 内嵌引号文字 = AnyText 的文字控制约定)。 */
export function buildAnyTextPayload(input: AnyTextCoverInput): {
  prompt: string; texts: string[]; width: number; height: number;
} {
  const title = (input.title || '').trim().slice(0, 16);
  const scene = (input.scenePrompt || 'premium e-commerce product poster background, clean studio lighting, soft gradient').slice(0, 300);
  const dims = input.aspectRatio === '16:9' ? { width: 1280, height: 720 }
    : input.aspectRatio === '1:1' ? { width: 1024, height: 1024 }
    : { width: 720, height: 1280 };
  return {
    // AnyText 约定:prompt 里用双引号包住要渲染的文字
    prompt: `${scene}, elegant Chinese typography poster with text "${title}"`,
    texts: [title],
    ...dims,
  };
}

/** 解析 BYO 端点返回(容忍 {imageUrl} / {image_base64} / {images:[...]} / {output:{...}})。 */
export function parseAnyTextResponse(j: any): string | null {
  if (!j || typeof j !== 'object') return null;
  const cand = j.imageUrl || j.image_url || j.url
    || (Array.isArray(j.images) ? j.images[0] : null)
    || j.output?.imageUrl || j.output?.image_url
    || (j.image_base64 ? `data:image/png;base64,${j.image_base64}` : null)
    || (j.output?.image_base64 ? `data:image/png;base64,${j.output.image_base64}` : null);
  if (typeof cand !== 'string' || !cand) return null;
  return cand.startsWith('http') || cand.startsWith('data:image') ? cand : null;
}
