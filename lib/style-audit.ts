/**
 * v2.23 P0.1 — Style Bible Vision Audit.
 *
 * 问题:
 *   v2.20 P0.1 引入了 Style Bible Frame, 但只是把它当 sref 喂给后续 image gen.
 *   模型对 sref 的"听话度"不稳定 — 仍然会出现 shot 1 是冷蓝调, shot 4 突然变暖橘
 *   的画风漂移. 当前没有任何机制验证"这镜真的对得上全片基调吗".
 *
 * 解法:
 *   类似 cameo-retry (脸像不像), 加一个"画风对得上吗"的 vision 审计.
 *   每镜渲染完, 让 vision LLM 对比该镜 vs styleBible 帧的 4 个维度:
 *     1. palette — 色彩调色板是否相近 (主调色 / 强调色 / 背景色 hue)
 *     2. lighting — 光线方向 + 软硬 + 强度
 *     3. colorTemperature — 色温 (暖橙 / 中性 / 冷蓝)
 *     4. texture — 渲染语言 (cel-shaded / painterly / photoreal / 颗粒度)
 *   综合分 <70 自动重生, <85 给 warning 但不重生.
 *
 * 设计:
 *   - 没有 styleAnchorImageUrl 时直接 skip (degraded path 不触发)
 *   - mock / data: 图跳过 (vision 抓不到 base64)
 *   - 失败容错: 任一步 throw 都返 null, 调用方按"无 audit 数据"处理
 *   - 与 cameo-retry 平级: 两个 audit 都跑, 任一不达标都触发重生 (但不级联)
 */

import OpenAI from 'openai';
import { API_CONFIG } from './config';

export interface StyleAuditDimensions {
  /** 0-100 — 色彩调色板 (hue 集合) 相似度 */
  palette: number;
  /** 0-100 — 光线方向 / 软硬 / 强度 一致性 */
  lighting: number;
  /** 0-100 — 色温 (warm/neutral/cool) 一致性 */
  colorTemperature: number;
  /** 0-100 — 渲染语言 (cel-shaded / painterly / photoreal) + 颗粒度 一致性 */
  texture: number;
}

export interface StyleAuditResult {
  /** 综合分数 0-100 (min of dimensions) */
  score: number;
  /** 是否达标 — 由阈值决定 */
  passed: boolean;
  /** 是否触发重生 — 低于 critical 阈值 (默认 70) */
  shouldRegen: boolean;
  /** 4 维分项 */
  dimensions: StyleAuditDimensions;
  /** vision LLM 一句话说明 */
  reasoning: string;
}

export interface StyleAuditOptions {
  /** 触发重生的硬阈值 — 默认 70 */
  regenThreshold?: number;
  /** "passed" 的软阈值 — 默认 85 (低于此但 ≥regenThreshold 给 warning 但不重生) */
  passThreshold?: number;
}

const SYSTEM_PROMPT = `你是 AI 视频后期的画风一致性审核员.
用户给你两张图:
  · 第一张是「Style Bible 帧」 — 全片视觉锚点, 定义了画风/色调/光线/材质
  · 第二张是「待审核镜头」 — 实际生成的某一镜

任务: 评估第二张图的"视觉语言"是否对得上第一张, 不管画面内容 / 角色 / 主体不同.
专注 4 维:
  1. palette — 主色调 / 强调色 / 背景色 是否相近 (容忍内容差异)
  2. lighting — 光线方向 / 软硬 / 强度 (硬光-柔光-散射)
  3. colorTemperature — 色温段 (暖橙/中性/冷蓝)
  4. texture — 渲染语言 (cel-shaded / painterly / photoreal) + 颗粒度

评分标尺 (重要):
  90-100: 完全一致, 像同一组镜头
  80-89: 整体对齐, 1 维小偏 (例如光线略不同但调色板一致)
  70-79: 明显偏离 1-2 维 (例如色温从暖变冷, 或材质从手绘变写实)
  <70: 像完全不同的剧 — 强烈建议重生

严格输出 JSON, 不要任何额外文字:
{
  "dimensions": {
    "palette": 0-100,
    "lighting": 0-100,
    "colorTemperature": 0-100,
    "texture": 0-100
  },
  "reasoning": "1 句话, 60 字以内, 说明最大偏差点 / 或为什么一致"
}`;

/**
 * 对一对图做画风审计. 失败返 null (调用方走"无数据"路径).
 */
export async function auditShotStyle(
  shotImageUrl: string,
  styleBibleUrl: string,
  options?: StyleAuditOptions,
): Promise<StyleAuditResult | null> {
  // 不能 audit 的场景: 任一图缺失 / 非 http (vision 抓不到 svg/mock)
  if (!shotImageUrl || !styleBibleUrl) return null;
  if (!shotImageUrl.startsWith('http') || !styleBibleUrl.startsWith('http')) {
    return null;
  }
  if (!API_CONFIG.openai.apiKey) {
    console.warn('[StyleAudit] OPENAI_API_KEY missing, skip audit');
    return null;
  }

  const regenThreshold = options?.regenThreshold ?? 70;
  const passThreshold = options?.passThreshold ?? 85;

  const client = new OpenAI({
    apiKey: API_CONFIG.openai.apiKey,
    baseURL: API_CONFIG.openai.baseURL,
  });

  try {
    const resp = await client.chat.completions.create({
      model: API_CONFIG.openai.model,
      temperature: 0.2,
      response_format: { type: 'json_object' },
      max_tokens: 400,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        {
          role: 'user',
          content: [
            { type: 'text', text: '第一张: Style Bible. 第二张: 待审核镜头. 按 system 评 4 维.' },
            { type: 'image_url', image_url: { url: styleBibleUrl } },
            { type: 'image_url', image_url: { url: shotImageUrl } },
          ],
        },
      ],
    });

    const raw = resp.choices?.[0]?.message?.content?.toString().trim();
    if (!raw) return null;
    let cleaned = raw.replace(/^```(?:json)?\s*\n?/, '').replace(/\n?\s*```\s*$/, '').trim();
    let parsed: any;
    try { parsed = JSON.parse(cleaned); } catch { return null; }

    const d = parsed?.dimensions;
    if (!d || typeof d !== 'object') return null;
    const clamp = (n: any): number =>
      typeof n === 'number' && Number.isFinite(n) ? Math.max(0, Math.min(100, Math.round(n))) : 50;
    const dimensions: StyleAuditDimensions = {
      palette: clamp(d.palette),
      lighting: clamp(d.lighting),
      colorTemperature: clamp(d.colorTemperature ?? d.color_temperature),
      texture: clamp(d.texture),
    };
    // 综合分 = min — 任一维度崩 = 整体崩
    const score = Math.min(
      dimensions.palette,
      dimensions.lighting,
      dimensions.colorTemperature,
      dimensions.texture,
    );
    const reasoning = typeof parsed.reasoning === 'string'
      ? parsed.reasoning.slice(0, 120)
      : '';

    return {
      score,
      dimensions,
      passed: score >= passThreshold,
      shouldRegen: score < regenThreshold,
      reasoning,
    };
  } catch (e) {
    console.warn('[StyleAudit] vision call failed:', e instanceof Error ? e.message : e);
    return null;
  }
}

/**
 * 找到分数最低的维度, 给重生 prompt 加针对性 hint.
 * 例如 palette=60 → "match the Style Bible's primary palette (warm amber/jade)"
 */
export function buildRegenHintFromAudit(
  audit: StyleAuditResult,
): string {
  const d = audit.dimensions;
  const weakest = (['palette', 'lighting', 'colorTemperature', 'texture'] as const)
    .reduce((min, k) => (d[k] < d[min] ? k : min), 'palette' as const);
  const hints: Record<keyof StyleAuditDimensions, string> = {
    palette: 'match the Style Bible\'s primary color palette exactly, same hue family',
    lighting: 'match the Style Bible\'s lighting direction and softness (same key light angle, same shadow falloff)',
    colorTemperature: 'match the Style Bible\'s color temperature (warm/neutral/cool); avoid drifting to opposite end',
    texture: 'match the Style Bible\'s rendering language (cel-shaded / painterly / photoreal) and grain texture',
  };
  return `Style alignment correction: weakest dim was ${weakest} (score ${d[weakest]}/100). ${hints[weakest]}`;
}
