/**
 * v2.21 P1.2 — Character DNA: vision-extracted 8-维 character signature.
 *
 * 问题: 即使 Style Bible + cref/sref 都给了, 跨镜头主角的具体长相 (眼型 / 嘴型
 * / 下颌) 仍会 drift, 因为 MJ/Minimax 在不同 prompt 下对"同一参考图"的解读不同.
 *
 * 解法: 给每个角色的三视图过一次 vision API, 抽出 8 个 STRUCTURED 字段
 * (eye shape / jaw / nose / mouth / hair style / hair color / skin tone /
 * signature outfit element), 拼成一段紧凑的"角色 DNA prompt", 在每个该角色出场
 * 的 shot prompt 里都注入. 模型同时收到 参考图 + 自然语言 anchor, 两层锁定.
 *
 * 设计:
 *   - 异步, 非阻塞: CharacterDesigner 完成后启动, 失败 / 没 key 不影响主流程
 *   - 缓存: 同 character imageUrl 只抽 1 次, 多次出场重用
 *   - 输出极短 (~120 字), 给 Minimax 1500 字 cap 留余地
 */

import OpenAI from 'openai';
import { API_CONFIG } from './config';

export interface CharacterDna {
  /** 角色名 — 一致性核验用 */
  name: string;
  /** 原始三视图 URL — 缓存 key + 调用方核对 */
  sourceImageUrl: string;
  /** 8 维结构化签名 — 来源 vision LLM 抽取 */
  signature: {
    eyeShape?: string;        // e.g. "almond, slightly upturned"
    jawShape?: string;        // e.g. "soft oval, defined chin"
    noseShape?: string;       // e.g. "straight bridge, slight upturn"
    mouthShape?: string;      // e.g. "thin lips, curved smile"
    hairStyle?: string;       // e.g. "long ponytail with side bangs"
    hairColor?: string;       // e.g. "deep black with auburn highlights"
    skinTone?: string;        // e.g. "fair, cool undertone"
    signatureOutfit?: string; // e.g. "silver jade pendant + crimson hanfu collar"
  };
  /** 一段拼好的、可直接塞 prompt 的 DNA 描述 (中英混合可) */
  promptBlock: string;
}

const SYSTEM_PROMPT = `你是 AI 视频后期的角色识别师。
用户给你一张「角色概念三视图」, 你要从中提炼出 8 维稳定特征, 让后续 AI 模型生成同角色其他姿态时能"对照画".

输出严格 JSON, 不要任何额外文字:
{
  "eyeShape": "...",        // 1 句话描述 5 官细节, 例: "almond, slightly upturned, double eyelid"
  "jawShape": "...",        // 例: "soft oval with defined chin"
  "noseShape": "...",       // 例: "straight bridge with slight upturn"
  "mouthShape": "...",      // 例: "thin lips, curved natural smile"
  "hairStyle": "...",       // 发型 + 长度 + 是否扎起, 例: "long ponytail with side bangs"
  "hairColor": "...",       // 发色 + 高光, 例: "deep black with auburn highlights"
  "skinTone": "...",        // 肤色 + 冷暖, 例: "fair, cool undertone"
  "signatureOutfit": "..."  // 该角色标志性的服饰元素 1-2 件 (最辨识的), 例: "silver jade pendant + crimson hanfu collar"
}

每个字段 ≤ 60 字符 英文, 描述视觉特征而不是情绪 / 气质. 拒绝 "beautiful" / "elegant" 等抽象词.
未识别的字段写空字符串 "" — 不要用 null.`;

/**
 * 从 vision JSON 输出归一化成 CharacterDna.signature.
 * 删空字段, slice 长字段, 拒非 string.
 */
function normalizeSignature(raw: any): CharacterDna['signature'] {
  if (!raw || typeof raw !== 'object') return {};
  const out: CharacterDna['signature'] = {};
  const keys: (keyof CharacterDna['signature'])[] = [
    'eyeShape', 'jawShape', 'noseShape', 'mouthShape',
    'hairStyle', 'hairColor', 'skinTone', 'signatureOutfit',
  ];
  for (const k of keys) {
    const v = raw[k];
    if (typeof v === 'string' && v.trim().length > 0) {
      out[k] = v.trim().slice(0, 80);
    }
  }
  return out;
}

/**
 * 把签名拼成可直接塞 prompt 的简短描述.
 * 格式: "<name> visual DNA: eyeShape=..., jaw=..., hair=..., outfit=..."
 * 控制在 200 字以内, 适合给 image gen 在 prompt 末尾拼.
 */
export function buildPromptBlock(name: string, sig: CharacterDna['signature']): string {
  const fields: string[] = [];
  if (sig.eyeShape) fields.push(`eyes: ${sig.eyeShape}`);
  if (sig.jawShape) fields.push(`jaw: ${sig.jawShape}`);
  if (sig.noseShape) fields.push(`nose: ${sig.noseShape}`);
  if (sig.mouthShape) fields.push(`mouth: ${sig.mouthShape}`);
  if (sig.hairStyle) fields.push(`hair: ${sig.hairStyle}`);
  if (sig.hairColor) fields.push(`hair color: ${sig.hairColor}`);
  if (sig.skinTone) fields.push(`skin: ${sig.skinTone}`);
  if (sig.signatureOutfit) fields.push(`signature: ${sig.signatureOutfit}`);
  if (fields.length === 0) return '';
  const joined = fields.join('; ');
  // 上限 200 字符 (留余地给后续 prompt 拼接)
  const body = joined.length > 200 ? joined.slice(0, 200) : joined;
  return `${name} visual DNA: ${body}`;
}

/**
 * 调 vision LLM, 给一张角色三视图抽 DNA. 失败返回 null (调用方 fallback).
 */
export async function extractCharacterDna(
  name: string,
  imageUrl: string,
): Promise<CharacterDna | null> {
  if (!name || !imageUrl) return null;
  if (!API_CONFIG.openai.apiKey) {
    console.warn('[CharacterDna] OPENAI_API_KEY missing, skip extraction');
    return null;
  }
  // 只接受能给 vision 模型的 URL 形式 (http/https or data:)
  if (!imageUrl.startsWith('http') && !imageUrl.startsWith('data:')) {
    console.warn(`[CharacterDna] skip non-fetchable url: ${imageUrl.slice(0, 60)}`);
    return null;
  }

  const client = new OpenAI({
    apiKey: API_CONFIG.openai.apiKey,
    baseURL: API_CONFIG.openai.baseURL,
  });

  try {
    const resp = await client.chat.completions.create({
      model: API_CONFIG.openai.model,
      temperature: 0.2,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        {
          role: 'user',
          content: [
            { type: 'text', text: `角色名: ${name}. 请按 system 的 JSON 结构抽 DNA.` },
            { type: 'image_url', image_url: { url: imageUrl } },
          ],
        },
      ],
      max_tokens: 500,
    });

    const raw = resp.choices?.[0]?.message?.content?.toString().trim();
    if (!raw) return null;

    // 剥掉可能的 markdown fence
    let cleaned = raw;
    cleaned = cleaned.replace(/^```(?:json)?\s*\n?/, '').replace(/\n?\s*```\s*$/, '').trim();
    let parsed: any;
    try { parsed = JSON.parse(cleaned); } catch { return null; }

    const sig = normalizeSignature(parsed);
    if (Object.keys(sig).length === 0) return null; // 一个字段都没抽到, 当失败

    return {
      name,
      sourceImageUrl: imageUrl,
      signature: sig,
      promptBlock: buildPromptBlock(name, sig),
    };
  } catch (e) {
    console.warn(`[CharacterDna] ${name} extraction failed:`, e instanceof Error ? e.message : e);
    return null;
  }
}

/**
 * 批量抽 DNA — 并发 2 路, 失败的角色返回 null 不影响其他.
 */
export async function extractCharacterDnaBatch(
  chars: Array<{ name: string; imageUrl: string }>,
): Promise<Map<string, CharacterDna>> {
  const out = new Map<string, CharacterDna>();
  const CONCURRENCY = 2;
  const queue = chars.filter((c) => c.name && c.imageUrl);
  const workers: Promise<void>[] = [];
  for (let w = 0; w < Math.min(CONCURRENCY, queue.length); w++) {
    workers.push((async () => {
      while (queue.length > 0) {
        const item = queue.shift();
        if (!item) break;
        const dna = await extractCharacterDna(item.name, item.imageUrl);
        if (dna) out.set(item.name, dna);
      }
    })());
  }
  await Promise.all(workers);
  return out;
}

/**
 * v12.2.0 角色名归一 —— 与 consistency-policy 的 normalizeKey 同源(大小写/标点/空格归一)。
 * 导出供 dnaMap 命中匹配 + 跨集资产记忆复用(阶段二十一)。
 */
export function normalizeCharacterName(s: string): string {
  return (s || '')
    .toLowerCase()
    .replace(/[\s,.，。、:：;；!！?？\-—()（）\[\]【】<>《》「」『』"'""'']/g, '')
    .trim();
}

/**
 * v12.2.0 在 dnaMap 里给一个 shot 角色名找 DNA —— 复用 matchLockedCharactersInShot 的策略:
 *   1. 原样精确(快路径)2. 归一精确 3. 子串双向(≥2 字符,避免单字误匹配)。
 * 修「林小满(镜头)vs 小满(dnaMap)」这类静默漏注入。
 */
export function matchDnaForName(name: string, dnaMap: Map<string, CharacterDna>): CharacterDna | undefined {
  if (!name || dnaMap.size === 0) return undefined;
  const exact = dnaMap.get(name);
  if (exact) return exact;
  const norm = normalizeCharacterName(name);
  if (!norm) return undefined;
  let substrHit: CharacterDna | undefined;
  for (const [key, dna] of dnaMap) {
    const k = normalizeCharacterName(key);
    if (k === norm) return dna;                                  // 归一精确优先
    if (!substrHit && k.length >= 2 && norm.length >= 2 && (k.includes(norm) || norm.includes(k))) substrHit = dna;
  }
  return substrHit;                                              // 子串兜底
}

/**
 * 在 shot prompt 末尾拼 DNA — 仅当 shot 出场的角色在 dnaMap 里命中时才注入.
 * 多角色同框时拼接所有命中角色, 各占 1 段, 用 ' | ' 分隔. 同一 DNA 命中多个别名只拼一次.
 */
export function injectDnaIntoPrompt(
  basePrompt: string,
  shotCharacters: string[] | undefined,
  dnaMap: Map<string, CharacterDna>,
): string {
  if (!Array.isArray(shotCharacters) || shotCharacters.length === 0) return basePrompt;
  if (dnaMap.size === 0) return basePrompt;
  const blocks: string[] = [];
  const usedBlocks = new Set<string>();
  for (const name of shotCharacters) {
    const dna = matchDnaForName(name, dnaMap);
    if (dna?.promptBlock && !usedBlocks.has(dna.promptBlock)) { blocks.push(dna.promptBlock); usedBlocks.add(dna.promptBlock); }
  }
  if (blocks.length === 0) return basePrompt;
  return `${basePrompt}. ${blocks.join(' | ')}`;
}
