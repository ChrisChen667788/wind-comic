/**
 * lib/slim-prompts (v9.2.2) — 草稿 / 极速场景的精简 system prompt.
 *
 * 完整 McKee 编剧提示 = 9153 字 (8.9KB), 让"快档" deepseek-v4-flash 单稿要 ~50-70s
 * (输入大 + 推理负担重)。草稿对比这类"快比稿"只需「三幕骨架 + 严格 JSON 契约」,
 * 不需要完整理论展开。本模块给 ~0.5KB 精简版, 目标单稿 flash <20s。
 *
 * 设计取舍: 保留决定短剧质量的最小要素 —— 钩子(前 3 秒) / 三幕推进 / 中段反转 /
 *   结尾悬念 / 可拍视觉 / 短促潜台词对白; 砍掉理论讲解、长范例、大段枚举。
 *   完整 McKee 仍由质量优先的主管线 runWriter 承担 (用户选定草稿后回到 create-stream)。
 *
 * 纯函数, 单测 tests/v9-2-2-slim-prompts.test.ts (骨架要素 + 体积上限 + JSON 契约)。
 */

export interface SlimWriterOptions {
  minShots?: number;
  maxShots?: number;
  /** 进 prompt 尾部的附注 (如 "草稿 #2 · 温度 0.95") */
  note?: string;
}

/** 草稿严格 JSON 输出契约 (与 lib/script-drafts 的 normalizeShots 字段对齐)。 */
export const DRAFT_JSON_CONTRACT =
  '严格输出 JSON (无 markdown、无 ```、前后无任何解释文字):\n' +
  '{"title": string, "synopsis": string(1-2句), "shots": [\n' +
  '  {"shotNumber": number(从1起), "sceneDescription": string, "action": string, "emotion": string, "characters": string[], "dialogue"?: string, "visualPrompt": string}\n' +
  ']}';

/**
 * 精简编剧 system prompt — 三幕短剧骨架 + 严格 JSON 契约 (草稿对比 / 快比稿用)。
 * 体积约为完整 McKee 的 ~6%, 让 flash 单稿稳定 <20s。
 */
export function getSlimWriterPrompt(style: string, opts: SlimWriterOptions = {}): string {
  const minShots = Math.max(1, Math.floor(opts.minShots ?? 4));
  const maxShots = Math.max(minShots, Math.floor(opts.maxShots ?? 8));
  const safeStyle = (style || '').trim() || 'cinematic';
  const lines = [
    `你是资深短剧编剧。用 ${minShots}-${maxShots} 个镜头写一部高密度竖屏短剧, 画风: ${safeStyle}。`,
    '',
    '三幕结构 (紧凑, 不铺垫):',
    '1. 钩子 — 前 3 秒即冲突或悬念, 一上来就抓人。',
    '2. 升级 — 每镜推进, 制造对立与代价; 中段安排一次反转。',
    '3. 收束 — 推到情绪峰值, 结尾留反差 / 悬念钩子。',
    '',
    '每镜要求: 动作与情绪明确; 对白短促、有潜台词; 少用旁白; 视觉具体可拍。',
    '',
    DRAFT_JSON_CONTRACT,
  ];
  if (opts.note) lines.push('', `附注: ${opts.note}`);
  return lines.join('\n');
}
