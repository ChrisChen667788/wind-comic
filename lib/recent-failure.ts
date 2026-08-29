/**
 * lib/recent-failure (v12.371) —— 把「系统已经记下来的失败原因」交给用户。
 *
 * 病根:`generateImage` 全链失败时只返回 mock/空,不带原因;调用方于是只能说
 * 「所有图像引擎都失败了,**请稍后再试**」。而真实原因常常是**稍后再试也没用**的那种:
 *   · `Token quota exhausted`(当日额度耗尽 → 该等明天或充值)
 *   · `MJ submit failed: 分组 …`(网关分组受限 → 该换通道)
 *   · `Minimax image-01 error (1026): input new_sensitive`(**prompt 被判敏感 → 该改文案**)
 * 三种处置完全不同,而「请稍后再试」对后两种是错的建议。
 *
 * 但这些原因**早就写进 `api_usage_events` 了** —— 只是没人把它交回给用户。
 * 这与 v12.348(巡检读运行时告警表)是同一手法:系统知道,就别让用户猜。
 */
import { db } from './db';

/** 图像链上的 provider —— 只看它们,免得把 LLM/TTS 的失败混进来。 */
const IMAGE_PROVIDERS = ['midjourney', 'minimax', 'fal', 'comfyui', 'openai', 'qingyuntop'];

export interface FailureHint {
  /** 原始报文(截断) */
  raw: string;
  provider: string;
  /** 归类后的可执行建议 */
  advice: string;
}

/** 报文 → 人能照做的下一步。判不出就返回 null,由调用方退回通用文案。 */
export function adviseFromError(msg: string): string | null {
  const t = String(msg || '');
  if (/quota|额度|balance|not enough|insufficient|用量上限/i.test(t)) {
    return '当日额度已耗尽 —— 等额度刷新或充值后再试,现在重试不会成功';
  }
  if (/1026|sensitive|敏感|违规|content.?policy/i.test(t)) {
    return 'prompt 被判为敏感内容 —— 需要改写该镜的描述文案,重试同一段文字不会成功';
  }
  if (/分组|group|无可用渠道|no available channel/i.test(t)) {
    return '网关分组不可用 —— 需要在网关侧切换通道或换 key,重试同一通道不会成功';
  }
  if (/timeout|timed out|ETIMEDOUT|ECONNRESET/i.test(t)) {
    return '上游超时 —— 这一类重试通常有效';
  }
  return null;
}

/**
 * 取最近一次图像链失败的原因。
 *
 * @param withinMs 只看这段时间内的(默认 5 分钟)—— 太旧的记录与本次失败无关,
 *                 拿它当原因反而会误导。
 */
export function recentImageFailure(withinMs = 5 * 60 * 1000): FailureHint | null {
  try {
    const since = new Date(Date.now() - withinMs).toISOString();
    const ph = IMAGE_PROVIDERS.map(() => '?').join(',');
    const row = db.prepare(
      `SELECT provider, error_message FROM api_usage_events
        WHERE success = 0 AND error_message IS NOT NULL
          AND provider IN (${ph}) AND created_at >= ?
        ORDER BY created_at DESC LIMIT 1`,
    ).get(...IMAGE_PROVIDERS, since) as { provider: string; error_message: string } | undefined;
    if (!row?.error_message) return null;
    return {
      raw: String(row.error_message).slice(0, 160),
      provider: row.provider,
      advice: adviseFromError(row.error_message) || '',
    };
  } catch {
    return null;   // 读不到就退回通用文案 —— 诊断信息拿不到,不该让主流程更糟
  }
}
