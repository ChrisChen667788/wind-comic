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
export const ARREARS_RE = /insufficient|欠费|余额不足|balance[^.]{0,20}?(not enough|insufficient|low|too low|不足|为零)|(account|余额|账户)[^.]{0,12}balance|quota.*(exceed|exhaust|deplet|run out)|(exceed|exhaust|deplet).*quota|credit.*(exhaust|deplet)|no.*credit|arrear|额度(不足|用尽|耗尽)|(额度|余额|配额|token|credit|quota)[^。,;]{0,8}(已)?(用完|用尽)|not enough|Token Plan 用量上限/i;

/**
 * 判「该接口已对本账号停用」——**充值和重试都没用**,只能换引擎或换方案。
 * v12.376:MiniMax Music 返回 HTTP 410 + status_code 2153:
 * 「This Music API is no longer available to new users」。
 * 注意它含 "no longer available" 而不是 "not available",原分类器的
 * `/not available/` 匹配不到,于是落进 UNKNOWN、retryable=true ——
 * 界面据此给出「重试」按钮,而这个调用永远不可能成功。
 */
export const DISCONTINUED_RE = /no longer available|discontinued|has been (retired|sunset|deprecated)|不再(提供|支持|可用)|已(下线|停用|停止服务)|sunset|2153/i;

/*
 * v12.376 的收紧:原词表里有裸的 `已用完|用尽`。它在 v12.348 的配额场景够用
 * (那里的报文本就来自配额告警),但本版把词表接进了**通用**错误分类器
 * `lib/pipeline-error.ts` —— 那里什么报文都会经过,「重试次数已用完」
 * 会被判成欠费,处置就从「换引擎」错成「去充值」。
 * 现在要求「用完/用尽」前面挨着额度/余额/配额/token/credit/quota 之一;
 * 「次数」刻意不收 —— 那正是最容易误伤的那个词。
 */

/** 判「上游饱和」(是排队问题,不是钱的问题 —— 处置是等/换引擎,不是充值)。 */
export const SATURATED_RE = /pre_consume_token_quota_failed|上游.{0,4}饱和|分组.{0,4}饱和|saturated|queue.*full|task.*pending.*queue|rate.?limit|too many requests|请求过于频繁|\b2056\b/i;

/** 判鉴权失败。 */
export const AUTH_FAIL_RE = /invalid.*(api.?key|token)|unauthorized|鉴权失败|认证失败|无效的?密钥/i;

/** 便捷判定:状态码 + 报文 → 是否欠费。402 一律算。 */
export function looksLikeArrears(statusCode, message) {
  if (statusCode === 402) return true;
  return ARREARS_RE.test(String(message || ''));
}
