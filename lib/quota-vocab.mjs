/**
 * 配额/欠费措辞词表(v12.348)—— **全仓唯一一份**。
 *
 * 病根:同一语义原本有两份实现,而且**好的那份没被复用**。
 *   · `scripts/api-health-audit.mjs` 的 `detectArrears` 覆盖 balance / not enough / quota exhausted…
 *   · `lib/api-usage-tracker.ts` 的 kling 规则只认 `/credit|余额|insufficient/`
 * 可灵欠费的原文是 **"Account balance not enough"** —— 三个词一个都不沾,
 * 于是落到兜底的 `rate_limited`(因为 HTTP 是 429)。
 *
 * 后果不是「标签难看」:**「限流」的处置是等一会再试,「欠费」的处置是充值** ——
 * 建议完全相反。owner 的可灵账户从 2026-08-11 起就没钱了(告警表 ×18 次),
 * 而巡检一直报 OK、告警一直写 rate_limited,**17 天没人看出来**。
 *
 * 用 .mjs 是为了让 TS(allowJs)和纯 node 脚本都能 import 同一份 —— 不再各写各的。
 */

/**
 * 判「欠费/额度耗尽」的措辞。
 *
 * 收录时的两条教训:
 * · 青云top 额度耗尽返回 **HTTP 401** + "Token quota exhausted" —— 既不是 402
 *   也不含 insufficient,首版漏了 `quota.*exhaust`,把欠费误判成鉴权失败,
 *   处置建议错成「重新生成 key」(实际该充值)。
 * · 可灵返回 **HTTP 429** + "Account balance not enough" —— 429 会先被限流规则吃掉,
 *   所以**欠费判定必须排在限流之前**。
 */
export const ARREARS_RE = /insufficient|欠费|余额不足|balance|quota.*(exceed|exhaust|deplet|run out)|(exceed|exhaust|deplet).*quota|credit.*(exhaust|deplet)|no.*credit|arrear|额度(不足|用尽|耗尽)|已用完|用尽|not enough|Token Plan 用量上限/i;

/** 判「上游饱和」(是排队问题,不是钱的问题 —— 处置是等/换引擎,不是充值)。 */
export const SATURATED_RE = /pre_consume_token_quota_failed|上游.{0,4}饱和|分组.{0,4}饱和|saturated|queue.*full|task.*pending.*queue/i;

/** 判鉴权失败。 */
export const AUTH_FAIL_RE = /invalid.*(api.?key|token)|unauthorized|鉴权失败|认证失败|无效的?密钥/i;

/** 便捷判定:状态码 + 报文 → 是否欠费。402 一律算。 */
export function looksLikeArrears(statusCode, message) {
  if (statusCode === 402) return true;
  return ARREARS_RE.test(String(message || ''));
}
