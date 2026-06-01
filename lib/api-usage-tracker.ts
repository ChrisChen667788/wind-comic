/**
 * lib/api-usage-tracker (v2.17 P0.1)
 *
 * 监控所有外部 API 调用的成功率 + 配额耗尽信号, 用户在 dashboard 能看到
 * "Minimax 余额不足, 请充值" 这种关键告警, 而不是埋在控制台。
 *
 * 设计:
 *   - 写入是 best-effort (try/catch 吞掉, 不让监控本身炸创作链路)
 *   - 仅在失败时落 api_usage_events (避免成功也写, 写放大)
 *   - 失败匹配到 quota 模式 → 升级到 api_quota_alerts (1h 内同 provider 同类型聚合)
 *   - 提供 `withApiTracking(provider, model, fn)` wrapper 让服务层一行接入
 *
 * 已知 quota 模式 (per provider):
 *   minimax    : status_code === 1008 OR /余额不足|insufficient.balance/i
 *   minimax    : status_code === 2061 → plan not support model (auth_failed)
 *   openai     : http 429 OR /insufficient_quota|quota.*exceeded|余额/i
 *   midjourney : /credits.*insufficient|余额|task.*pending.*queue.*full/i
 *   veo        : /pre_consume_token_quota_failed|上游负载已饱和|分组.*饱和|saturated/i (saturated)
 *   kling      : http 401 / 403 → auth_failed; /credits/i → exhausted
 *   vidu       : /credit|余额|insufficient/i
 *   fal/comfy  : 同 openai 模式
 *
 * 不做的事:
 *   - 不做实时 push (用户去 admin 页面拉)
 *   - 不限流 (那是 plan-gate 的责任, 不在监控范畴)
 */

import { getDbDriver } from './db-driver';
import { nanoid } from 'nanoid';

export type ApiProvider =
  | 'minimax'
  | 'midjourney'
  | 'openai'
  | 'veo'
  | 'kling'
  | 'vidu'
  | 'fal'
  | 'comfyui'
  | 'xverse'
  | 'qingyuntop';

export type AlertType = 'exhausted' | 'saturated' | 'rate_limited' | 'auth_failed' | 'model_unavailable';

export interface ApiCallRecord {
  provider: ApiProvider;
  model?: string;
  method?: string;
  success: boolean;
  statusCode?: number;
  errorMessage?: string;
  durationMs?: number;
  projectId?: string;
  userId?: string;
  estCostCny?: number;
}

export interface QuotaAlert {
  id: string;
  provider: ApiProvider;
  model: string;
  alertType: AlertType;
  errorMessage: string;
  firstSeenAt: string;
  lastSeenAt: string;
  occurrenceCount: number;
  acknowledgedAt: string | null;
}

// ════════════════════════════════════════════════════════════════════
// 配额错误模式 — per provider 的"耗尽 / 饱和 / 限流 / 鉴权失败"判定
// ════════════════════════════════════════════════════════════════════

interface QuotaMatcher {
  type: AlertType;
  match: (statusCode?: number, errorMsg?: string) => boolean;
}

const QUOTA_MATCHERS: Record<ApiProvider, QuotaMatcher[]> = {
  minimax: [
    { type: 'exhausted', match: (sc, msg) =>
        sc === 1008 || /余额不足|insufficient.*balance|账户余额/i.test(msg || '') },
    // v2.22 fix: 2061 ("your current token plan not support model") 不是鉴权问题,
    // 是该模型在用户当前套餐里不可用 — 跟 401/403 鉴权失败语义完全不同, 单独标 model_unavailable.
    // 1004 还是真鉴权失败 (invalid token).
    { type: 'model_unavailable', match: (sc, msg) =>
        sc === 2061 || /token plan not support|plan.*not.*support.*model/i.test(msg || '') },
    { type: 'auth_failed', match: (sc) => sc === 1004 },
    { type: 'rate_limited', match: (sc, msg) =>
        sc === 429 || /rate.?limit|too.?many.?requests/i.test(msg || '') },
  ],
  openai: [
    { type: 'exhausted', match: (sc, msg) =>
        /insufficient_quota|quota.*exceeded|user.*quota.*not.*enough|余额/i.test(msg || '') },
    { type: 'rate_limited', match: (sc, msg) =>
        sc === 429 || /rate.?limit|too.?many.?requests/i.test(msg || '') },
    { type: 'auth_failed', match: (sc) => sc === 401 || sc === 403 },
  ],
  midjourney: [
    { type: 'exhausted', match: (sc, msg) =>
        /credits?.*insufficient|insufficient.*credit|余额/i.test(msg || '') },
    { type: 'saturated', match: (sc, msg) =>
        /queue.*full|task.*pending.*queue|上游.*饱和/i.test(msg || '') },
    { type: 'rate_limited', match: (sc) => sc === 429 },
  ],
  veo: [
    { type: 'saturated', match: (sc, msg) =>
        /pre_consume_token_quota_failed|上游负载已饱和|分组.*饱和|saturated/i.test(msg || '') },
    { type: 'rate_limited', match: (sc, msg) =>
        sc === 429 || /rate.?limit/i.test(msg || '') },
    { type: 'exhausted', match: (sc, msg) => /insufficient_quota|余额/i.test(msg || '') },
  ],
  kling: [
    { type: 'exhausted', match: (sc, msg) => /credit|余额|insufficient/i.test(msg || '') },
    { type: 'auth_failed', match: (sc) => sc === 401 || sc === 403 },
    { type: 'rate_limited', match: (sc) => sc === 429 },
  ],
  vidu: [
    { type: 'exhausted', match: (sc, msg) => /credit|余额|insufficient/i.test(msg || '') },
    { type: 'auth_failed', match: (sc) => sc === 401 || sc === 403 },
    { type: 'rate_limited', match: (sc) => sc === 429 },
  ],
  fal: [
    { type: 'exhausted', match: (sc, msg) => /credit|insufficient|余额/i.test(msg || '') },
    { type: 'auth_failed', match: (sc) => sc === 401 || sc === 403 },
  ],
  comfyui: [
    { type: 'saturated', match: (sc, msg) =>
        /queue.*full|busy|saturated/i.test(msg || '') },
  ],
  xverse: [
    { type: 'rate_limited', match: (sc) => sc === 429 },
    { type: 'exhausted', match: (sc, msg) => /quota|余额/i.test(msg || '') },
  ],
  qingyuntop: [
    { type: 'saturated', match: (sc, msg) =>
        /上游.*饱和|分组.*饱和|saturated|pre_consume/i.test(msg || '') },
    { type: 'exhausted', match: (sc, msg) => /quota|余额|insufficient/i.test(msg || '') },
    { type: 'rate_limited', match: (sc) => sc === 429 },
  ],
};

/** 判断一次失败是不是配额类问题 — 返回 alert_type, null = 普通失败不告警 */
export function detectQuotaError(
  provider: ApiProvider,
  statusCode?: number,
  errorMessage?: string,
): AlertType | null {
  const matchers = QUOTA_MATCHERS[provider];
  if (!matchers) return null;
  for (const m of matchers) {
    if (m.match(statusCode, errorMessage)) return m.type;
  }
  return null;
}

// ════════════════════════════════════════════════════════════════════
// 写入 API
// ════════════════════════════════════════════════════════════════════

/**
 * 落一条 API 调用记录。仅在 success=false 时写 api_usage_events
 * (减少写量)。同时检测配额错误 → 触发 quota alert 升级。
 *
 * 失败时不抛 — 监控本身不能让创作链路炸。
 */
export async function recordApiCall(rec: ApiCallRecord): Promise<void> {
  try {
    if (!rec.success) {
      const id = nanoid();
      const now = new Date().toISOString();
      const errMsg = (rec.errorMessage || '').slice(0, 200);
      await getDbDriver().run(
        `INSERT INTO api_usage_events
         (id, provider, model, method, success, status_code, error_message, duration_ms, project_id, user_id, est_cost_cny, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          id,
          rec.provider,
          rec.model || '',
          rec.method || '',
          0,
          rec.statusCode ?? null,
          errMsg,
          rec.durationMs ?? 0,
          rec.projectId ?? null,
          rec.userId ?? null,
          rec.estCostCny ?? 0,
          now,
        ],
      );

      // 配额错误升级到 alerts 表
      const alertType = detectQuotaError(rec.provider, rec.statusCode, errMsg);
      if (alertType) {
        await upsertQuotaAlert(rec.provider, rec.model || '', alertType, errMsg, now);
      }
    }
    // 成功不写 (写放大太大), 想要全量统计去 cost_log 表
  } catch (e) {
    // 监控失败不能让业务挂. 静默。
    console.warn('[api-usage] recordApiCall failed (suppressed):', e instanceof Error ? e.message : e);
  }
}

/** 同 provider+alert_type 1 小时内聚合 (occurrence_count++); 否则插新行 */
async function upsertQuotaAlert(
  provider: ApiProvider,
  model: string,
  alertType: AlertType,
  errorMessage: string,
  now: string,
): Promise<void> {
  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const existing = await getDbDriver().get(
    `SELECT id, occurrence_count FROM api_quota_alerts
       WHERE provider = ? AND alert_type = ?
         AND acknowledged_at IS NULL
         AND last_seen_at > ?
       ORDER BY last_seen_at DESC LIMIT 1`,
    [provider, alertType, oneHourAgo],
  ) as { id: string; occurrence_count: number } | undefined;

  if (existing) {
    await getDbDriver().run(
      `UPDATE api_quota_alerts
       SET last_seen_at = ?, occurrence_count = ?, error_message = ?, model = ?
       WHERE id = ?`,
      [now, existing.occurrence_count + 1, errorMessage, model, existing.id],
    );
  } else {
    await getDbDriver().run(
      `INSERT INTO api_quota_alerts
       (id, provider, model, alert_type, error_message, first_seen_at, last_seen_at, occurrence_count)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [nanoid(), provider, model, alertType, errorMessage, now, now, 1],
    );
  }

  // 控制台提示一次, 让运维 tail logs 能看到
  console.warn(
    `[api-usage] 🚨 ${provider}/${model || '*'} alert=${alertType}: ${errorMessage.slice(0, 100)}`,
  );
}

// ════════════════════════════════════════════════════════════════════
// 查询 API
// ════════════════════════════════════════════════════════════════════

/** 列出活跃告警 (未 ack, last_seen 在指定窗口内). 默认 1 小时窗口 */
export async function listActiveQuotaAlerts(opts?: {
  windowMs?: number;
  provider?: ApiProvider;
}): Promise<QuotaAlert[]> {
  const windowMs = opts?.windowMs ?? 60 * 60 * 1000;
  const since = new Date(Date.now() - windowMs).toISOString();
  const filters = ['acknowledged_at IS NULL', 'last_seen_at > ?'];
  const params: any[] = [since];
  if (opts?.provider) {
    filters.push('provider = ?');
    params.push(opts.provider);
  }
  const rows = (await getDbDriver().query(
    `SELECT id, provider, model, alert_type, error_message,
              first_seen_at, last_seen_at, occurrence_count, acknowledged_at
       FROM api_quota_alerts
       WHERE ${filters.join(' AND ')}
       ORDER BY last_seen_at DESC
       LIMIT 50`,
    params,
  )) as any[];

  return rows.map((r) => ({
    id: r.id,
    provider: r.provider,
    model: r.model || '',
    alertType: r.alert_type,
    errorMessage: r.error_message || '',
    firstSeenAt: r.first_seen_at,
    lastSeenAt: r.last_seen_at,
    occurrenceCount: r.occurrence_count,
    acknowledgedAt: r.acknowledged_at,
  }));
}

/** 标记一个告警 ack (用户在 admin 页点了"知道了") */
export async function acknowledgeQuotaAlert(id: string): Promise<void> {
  await getDbDriver().run(
    'UPDATE api_quota_alerts SET acknowledged_at = ? WHERE id = ?',
    [new Date().toISOString(), id],
  );
}

/** 最近 N 小时内某 provider 的失败率 (用于"是不是该提前 fallback") */
export async function getRecentFailureRate(
  provider: ApiProvider,
  windowMs: number = 10 * 60 * 1000,
): Promise<{ total: number; failed: number; rate: number }> {
  const since = new Date(Date.now() - windowMs).toISOString();
  // 我们只记失败, 所以 rate 计算需要 cost_log 取分母 — 简化: 仅返回失败次数,
  // 调用方自己判 (>=3 失败 in 10min 视为不健康)
  const row = (await getDbDriver().get(
    `SELECT COUNT(*) AS failed FROM api_usage_events
       WHERE provider = ? AND created_at > ? AND success = 0`,
    [provider, since],
  )) as { failed: number };
  const failed = Number(row?.failed ?? 0);
  return { total: failed, failed, rate: failed > 0 ? 1 : 0 };
}

// ════════════════════════════════════════════════════════════════════
// withApiTracking — 方便 service 一行接入
// ════════════════════════════════════════════════════════════════════

/**
 * 用法:
 *   return withApiTracking(
 *     { provider: 'minimax', model: 'I2V-01', method: 'generateVideo', projectId },
 *     async () => {
 *       const resp = await fetch(...);
 *       const data = await resp.json();
 *       if (data.base_resp?.status_code !== 0) {
 *         throw new ApiCallError(data.base_resp.status_code, data.base_resp.status_msg);
 *       }
 *       return data.video_url;
 *     },
 *   );
 *
 * 抛错时自动 record + 重抛, 调用方按原 try/catch 处理。
 * 成功不写表 (太多写)。
 */
export class ApiCallError extends Error {
  constructor(
    public readonly statusCode: number | undefined,
    message: string,
  ) {
    super(message);
    this.name = 'ApiCallError';
  }
}

export async function withApiTracking<T>(
  meta: {
    provider: ApiProvider;
    model?: string;
    method?: string;
    projectId?: string;
    userId?: string;
    estCostCny?: number;
  },
  fn: () => Promise<T>,
): Promise<T> {
  const t0 = Date.now();
  try {
    const result = await fn();
    return result;
  } catch (e) {
    const durationMs = Date.now() - t0;
    const statusCode = e instanceof ApiCallError ? e.statusCode : undefined;
    const errorMessage = e instanceof Error ? e.message : String(e);
    await recordApiCall({
      ...meta,
      success: false,
      statusCode,
      errorMessage,
      durationMs,
    });
    throw e;
  }
}
