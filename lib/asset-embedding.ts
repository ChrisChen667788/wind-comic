/**
 * lib/asset-embedding (v12.2.2) — 资产向量化(阶段二十一,把 global_assets.embedding 死列通电)。
 *
 * 目标:让「跨集/跨项目找相似资产」从精确名匹配升级到语义向量检索,正面对标 OiiOii
 * 「角色高维特征向量 + 跨场景一致性」。
 *
 * BYO 哲学:
 *   - 嵌入源 = visual_anchors + DNA promptBlock + name + description(纯文本,轻依赖)。
 *   - `embedText` 走现有 OpenAI 兼容网关(text-embedding-3-small 类);无 key / MOCK / 失败
 *     → 返回 null,embedding 列保持空,检索退回精确名 + 文本匹配(诚实降级,UI 不假称已开)。
 *   - 余弦相似 + topK 是纯函数,资产量级小 → 内存算,不引 pgvector。
 *   - 维度/模型不一致的向量不可比 → 检索时按 model 过滤(见 global-asset-repo.findSimilarGlobalAssets)。
 */
import { API_CONFIG } from './config';

export interface EmbeddingResult {
  vector: number[];
  model: string;
  dim: number;
}

/** 余弦相似度(纯函数);非数组/维度不等/零向量 → 0。 */
export function cosineSimilarity(a: number[] | undefined | null, b: number[] | undefined | null): number {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length === 0 || a.length !== b.length) return 0;
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

/** 按余弦取 topK(降序),score ≤ minScore 剔除。纯函数。无 embedding 的候选记 0 分。 */
export function topKByCosine<T extends { embedding?: number[] | null }>(
  query: number[] | undefined | null,
  candidates: T[],
  opts?: { k?: number; minScore?: number },
): Array<{ item: T; score: number }> {
  const k = Math.max(1, opts?.k ?? 5);
  const min = opts?.minScore ?? 0;
  if (!Array.isArray(query) || query.length === 0) return [];
  return candidates
    .map((item) => ({ item, score: cosineSimilarity(query, item.embedding) }))
    .filter((x) => x.score > min)
    .sort((a, b) => b.score - a.score)
    .slice(0, k);
}

/**
 * 资产 → 嵌入源文本(纯函数):visual_anchors + DNA promptBlock + name + description。
 * 上限 2000 字符(嵌入 API token 友好)。空 → ''(调用方据此跳过)。
 */
export function buildEmbedSource(a: {
  name?: string;
  description?: string;
  visualAnchors?: string[];
  metadata?: Record<string, any> | null;
}): string {
  const parts: string[] = [];
  if (a.name) parts.push(a.name);
  if (a.description) parts.push(a.description);
  if (Array.isArray(a.visualAnchors)) parts.push(...a.visualAnchors.filter(Boolean));
  // DNA promptBlock 可能落在 metadata.bible.dna 或 metadata.dna
  const dnaBlock = a.metadata?.bible?.dna?.promptBlock || a.metadata?.dna?.promptBlock;
  if (typeof dnaBlock === 'string' && dnaBlock) parts.push(dnaBlock);
  return parts.filter(Boolean).join('. ').trim().slice(0, 2000);
}

/**
 * v12.2.3 确定性文本相似打分(无 embedding 时的兜底,纯函数,0–1)。
 * 信号取最大:名归一精确(1)> 名子串(0.7)> query 词在 名+描述+anchors 里的覆盖率(≤0.6)。
 */
const normText = (s: string) => (s || '').toLowerCase().replace(/[\s,.，。、:：;；!！?？\-—()（）\[\]【】<>《》「」『』"'""'']/g, '').trim();

export function textMatchScore(
  query: string,
  asset: { name?: string; description?: string; visualAnchors?: string[] },
): number {
  const q = normText(query);
  if (!q) return 0;
  const name = normText(asset.name || '');
  if (name && name === q) return 1;
  if (name && q.length >= 2 && (name.includes(q) || q.includes(name))) return 0.7;
  // 词覆盖率:query 切成 CJK 2-gram + latin 词,在 名+描述+anchors 拼串里命中的比例
  const hay = normText([asset.name, asset.description, ...(asset.visualAnchors || [])].filter(Boolean).join(''));
  if (!hay) return 0;
  const toks = queryTokens(query);
  if (toks.length === 0) return 0;
  const hit = toks.filter((t) => hay.includes(t)).length;
  return Math.min(0.6, (hit / toks.length) * 0.6);
}

/** query → 匹配单元:CJK 连续段切 2-gram(解决「银发剑客」整段难命中)+ latin 词(≥3,小写)。 */
function queryTokens(query: string): string[] {
  const out: string[] = [];
  for (const run of query.match(/[一-龥]{2,}/g) || []) {
    for (let i = 0; i < run.length - 1; i++) out.push(run.slice(i, i + 2));
  }
  for (const w of query.match(/[a-zA-Z]{3,}/g) || []) out.push(w.toLowerCase());
  return out;
}

/** 嵌入模型(env 可换;模型雷达采用后免重启)。 */
export function embedModel(): string {
  return process.env.OPENAI_EMBED_MODEL || 'text-embedding-3-small';
}

/** 图像嵌入模型(BYO,漂移检测用);未配 → 无图像 embedding 能力。 */
export function imageEmbedModel(): string | null {
  return process.env.IMAGE_EMBED_MODEL || null;
}

/** 是否具备 BYO 图像嵌入能力(配了 IMAGE_EMBED_MODEL + 有 key + 非 MOCK)。 */
export function hasImageEmbeddingKey(): boolean {
  return !!imageEmbedModel() && hasEmbeddingKey();
}

/**
 * BYO 图像嵌入(漂移检测用)。需显式配 `IMAGE_EMBED_MODEL`(多模态嵌入端点,OpenAI 兼容);
 * 未配 / 无 key / MOCK / 失败 / 非 http(s) → null(诚实降级:调用方退回 LLM 评分)。
 * 端点可独立配 `IMAGE_EMBED_BASE_URL`。
 */
export async function embedImage(imageUrl: string): Promise<EmbeddingResult | null> {
  const model = imageEmbedModel();
  if (!model || !hasEmbeddingKey()) return null;
  if (!imageUrl || !/^https?:\/\//.test(imageUrl)) return null;
  try {
    const OpenAI = (await import('openai')).default;
    const client = new OpenAI({
      apiKey: API_CONFIG.openai.apiKey,
      baseURL: process.env.IMAGE_EMBED_BASE_URL || process.env.OPENAI_EMBED_BASE_URL || API_CONFIG.openai.baseURL,
    });
    // 多模态嵌入端点惯例:input 传图像 URL(具体网关可能要 data-URI / {image} 包装,失败即降级)
    const resp = await (client as any).embeddings.create({ model, input: imageUrl });
    const vector = resp?.data?.[0]?.embedding;
    if (!Array.isArray(vector) || vector.length === 0) return null;
    return { vector, model, dim: vector.length };
  } catch (e) {
    console.warn('[AssetEmbedding] embedImage failed (degrade to LLM score):', e instanceof Error ? e.message : e);
    return null;
  }
}

/** 是否具备 BYO 嵌入能力(有真 key + 非 MOCK)。 */
export function hasEmbeddingKey(): boolean {
  const k = API_CONFIG.openai.apiKey;
  return !!k && !k.startsWith('your_') && process.env.MOCK_ENGINES !== '1';
}

/**
 * BYO 文本嵌入。无 key / MOCK / 空文本 / 失败 → null(诚实降级,调用方据此保持 embedding 空)。
 * 嵌入端点可独立配 `OPENAI_EMBED_BASE_URL`(部分网关嵌入与对话不同源)。
 */
export async function embedText(text: string): Promise<EmbeddingResult | null> {
  if (!text || !text.trim() || !hasEmbeddingKey()) return null;
  try {
    const OpenAI = (await import('openai')).default;
    const client = new OpenAI({
      apiKey: API_CONFIG.openai.apiKey,
      baseURL: process.env.OPENAI_EMBED_BASE_URL || API_CONFIG.openai.baseURL,
    });
    const model = embedModel();
    const resp = await client.embeddings.create({ model, input: text.slice(0, 8000) });
    const vector = (resp as any)?.data?.[0]?.embedding;
    if (!Array.isArray(vector) || vector.length === 0) return null;
    return { vector, model, dim: vector.length };
  } catch (e) {
    console.warn('[AssetEmbedding] embedText failed (degrade to text match):', e instanceof Error ? e.message : e);
    return null;
  }
}
