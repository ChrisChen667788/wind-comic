/**
 * lib/grader-config.ts — 独立评分上下文(v12.412 建,**v12.419 订正**)。
 *
 * ── v12.412 比错了对象,报了一条不成立的告警 ────────────────────────────
 * 那一版说「Vision Audit 和写分镜 prompt 的是同一个模型,它在给自己的产出打分」,
 * 于是拿 grader 与 `API_CONFIG.openai.model` 比,不同才算独立。
 *
 * **但被评的内容不是 `model` 写的。** 逐处追下来:
 *   · 剧本 / 分镜 / visualPrompt 由 `writer-agent` 出,它调
 *     `ctx.callLLM(..., useCreativeModel = true)` → 走 `creativeModel`;
 *   · Vision Audit 用 `API_CONFIG.openai.model`(通用档)。
 *
 * 本机实测:`OPENAI_CREATIVE_MODEL=claude-fable-5`、`OPENAI_MODEL=claude-opus-5` ——
 * **本来就是两个模型**。也就是说 v12.412 之后,每跑一次审计都会打印一句
 * 「**自评中**」的告警,而那件事并不成立。
 *
 * 一条不成立的告警不是「稳妥」,它是**噪音**:每次都响的告警,到真出问题那次也没人看。
 * 这和 v12.418 里那道误报的近重复检测、v12.400 里「会误报的门禁只会训练人忽略门禁」
 * 是同一条教训 —— 只不过这次误报的是我自己上一版加的东西。
 *
 * ── 订正后的判据 ──────────────────────────────────────────────────────
 * 「独立」的定义是:**评分方 ≠ 产出被评内容的那一方**。所以比的对象是
 * `creativeModel`(剧本作者),而不是 `model`。
 * 三条任一不同即为独立:模型、端点、凭据。
 *
 * 仍然保留的那条克制:`independent` 是**算出来的**,不是配置项 ——
 * 把 GRADER_MODEL 设成与作者同一个模型时它仍为 false。
 * 加个开关很容易,不许在没真正独立时宣称有独立 grader 才是难的那半。
 */
import { API_CONFIG } from './config';

export interface GraderConfig {
  apiKey: string;
  baseURL: string | undefined;
  model: string;
  /** 是否**真的**独立于「产出被评内容的那一方」(算出来的,不是配出来的) */
  independent: boolean;
  /** 被评内容的作者模型 —— 判独立性的比较基准 */
  authorModel: string;
  /** 为什么独立 / 为什么不独立 —— 直接可写进日志 */
  reason: string;
  /** v12.419:自动选用了哪条现成的独立路径(空 = 没走自动挑选) */
  autoPicked?: string;
}

export function resolveGraderConfig(): GraderConfig {
  const cfg = API_CONFIG.openai;

  // 被评的是剧本/分镜,作者是 creativeModel —— 这才是判独立性该比的对象。
  // v12.412 错在拿 cfg.model(通用档,也就是 grader 自己)去比,自然永远"不独立"。
  const authorModel = cfg.creativeModel || cfg.model || '';
  const authorBase = cfg.creativeBaseURL || cfg.baseURL;
  const authorKey = cfg.creativeApiKey || cfg.apiKey || '';

  // v12.419:**默认就选一个与作者不同的评分方**,而不是等人去配。
  //
  // 通用档(cfg.model)通常已经与 creativeModel 不同,那本身就够独立了。
  // 但当两者被配成同一个模型时,此前只能报「自评中」然后照样自评 ——
  // 告警是对的,可它没解决问题。而仓库里**早就有**一条完全独立的路:
  // `LLM_FALLBACK_*`(独立域名 + 独立 key + 不同模型,主 LLM 挂了时的兜底)。
  // 评分是轻量只读的活儿,拿它来当判官不需要新增任何配置。
  //
  // 顺序:显式 GRADER_* > 通用档(若已异于作者)> fallback 链 > 只能自评时如实告警。
  const explicitModel = process.env.GRADER_MODEL;
  const generalDiffersFromAuthor = !!cfg.model && cfg.model !== authorModel;

  let apiKey = process.env.GRADER_API_KEY || cfg.apiKey || '';
  let baseURL = process.env.GRADER_BASE_URL || cfg.baseURL;
  let model = explicitModel || cfg.model || '';
  let autoPicked = '';

  if (!explicitModel && !generalDiffersFromAuthor) {
    const fbModel = (cfg as { fallbackModel?: string }).fallbackModel;
    const fbBase = (cfg as { fallbackBaseURL?: string }).fallbackBaseURL;
    const fbKey = (cfg as { fallbackApiKey?: string }).fallbackApiKey;
    // 只在这条路真的配齐、且模型确实不同于作者时才用它 —— 否则不如老实报自评
    if (fbModel && fbKey && fbModel !== authorModel) {
      model = fbModel;
      baseURL = process.env.GRADER_BASE_URL || fbBase || baseURL;
      apiKey = process.env.GRADER_API_KEY || fbKey;
      autoPicked = 'LLM_FALLBACK 链';
    }
  }

  const modelDiffers = !!model && model !== authorModel;
  const endpointDiffers = !!baseURL && !!authorBase && baseURL !== authorBase;
  const keyDiffers = !!apiKey && !!authorKey && apiKey !== authorKey;

  const independent = modelDiffers || endpointDiffers || keyDiffers;
  const reason = independent
    ? `独立评分${autoPicked ? `(自动选用 ${autoPicked})` : ''}:${[
        modelDiffers ? `评分 ${model} vs 剧本作者 ${authorModel}` : '',
        endpointDiffers ? '端点不同' : '',
        keyDiffers ? '凭据不同' : '',
      ].filter(Boolean).join(' · ')}`
    : `**自评中**:评分与剧本作者是同一个模型(${authorModel || '未配置'})——` +
      '同一模型对自己的产出有一致先验,更容易认为自己画对了。' +
      '设 GRADER_MODEL(或 GRADER_BASE_URL / GRADER_API_KEY)指向另一家即可真正独立。';

  return { apiKey, baseURL, model, independent, authorModel, reason, autoPicked: autoPicked || undefined };
}
