/**
 * lib/grader-config.ts — 独立评分上下文(v12.412)。
 *
 * ── 病象:同一个模型既生成又打分 ──────────────────────────────────────
 * `lib/vision-audit.ts` 用 `API_CONFIG.openai.*` 调视觉打分 ——
 * **和写分镜 prompt 的是同一个模型、同一套配置**。它给自己的产出打分。
 *
 * 好消息是提示词这一层是干净的:`buildAuditPrompt` 只喂「剧本要求 + 画面」,
 * 不含生成时的 prompt,所以没有措辞层面的暗示泄漏。
 * 但**模型层面的自我合理化**仍在:同一个模型对「我理解的『雨夜街头』」
 * 有一致的先验,它更容易认为自己画对了。
 *
 * ── 修法,以及一条刻意的克制 ──────────────────────────────────────────
 * 提供独立的 grader 配置(可指向另一家模型/另一个 key),
 * 但**默认回落到主配置**,零回归。
 *
 * 关键在于:**不许在没真正独立时宣称有独立 grader**。
 * 所以 `resolveGraderConfig()` 返回的 `independent` 是**算出来的**,不是配置项 ——
 * 只有当模型或端点确实不同,它才为 true;否则如实标 false 并说明原因,
 * 由调用方大声记日志。配了个开关就宣称「已用独立评分」,
 * 正是这个项目一直在消灭的那种假绿。
 */
import { API_CONFIG } from './config';

export interface GraderConfig {
  apiKey: string;
  baseURL: string | undefined;
  model: string;
  /** 是否**真的**是独立评分方(算出来的,不是配出来的) */
  independent: boolean;
  /** 为什么独立 / 为什么不独立 —— 直接可写进日志 */
  reason: string;
}

export function resolveGraderConfig(): GraderConfig {
  const mainKey = API_CONFIG.openai.apiKey || '';
  const mainBase = API_CONFIG.openai.baseURL;
  const mainModel = API_CONFIG.openai.model || '';

  const apiKey = process.env.GRADER_API_KEY || mainKey;
  const baseURL = process.env.GRADER_BASE_URL || mainBase;
  const model = process.env.GRADER_MODEL || mainModel;

  const modelDiffers = !!model && model !== mainModel;
  const endpointDiffers = !!process.env.GRADER_BASE_URL && process.env.GRADER_BASE_URL !== mainBase;
  const keyDiffers = !!process.env.GRADER_API_KEY && process.env.GRADER_API_KEY !== mainKey;

  const independent = modelDiffers || endpointDiffers || keyDiffers;
  const reason = independent
    ? `独立评分:${[
        modelDiffers ? `模型 ${model}(生成用 ${mainModel})` : '',
        endpointDiffers ? '端点不同' : '',
        keyDiffers ? '凭据不同' : '',
      ].filter(Boolean).join(' · ')}`
    : `**自评中**:评分与生成用的是同一个模型(${mainModel || '未配置'})——` +
      '同一模型对自己的产出有一致先验,更容易认为自己画对了。' +
      '设 GRADER_MODEL(或 GRADER_BASE_URL / GRADER_API_KEY)指向另一家即可真正独立。';

  return { apiKey, baseURL, model, independent, reason };
}
