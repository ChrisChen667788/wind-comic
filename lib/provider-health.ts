/**
 * v6.7 — 第三方 API / 网关健康分类 · 纯逻辑 (client-safe, 可单测)
 *
 * 把"探针的原始响应"(HTTP 状态 / 响应体 / MiniMax base_resp / 网关余额) 归一成
 * 一个可读的健康状态 (正常 / 额度用尽 / 鉴权失败 / 配置缺失 / 不可达 / 未配置) +
 * 处置建议. 真探针 (fetch) 在 /api/health/providers (服务端), 这里只做判定, 不碰密钥.
 */

export type HealthStatus =
  | 'ok'
  | 'out_of_credits'
  | 'auth_error'
  | 'misconfigured'
  | 'down'
  | 'not_configured';

export type ProviderKind = 'llm' | 'tts' | 'video' | 'image' | 'gateway';

export interface ProviderHealth {
  id: string;
  label: string;
  kind: ProviderKind;
  status: HealthStatus;
  detail: string;
  baseUrl?: string;
  balance?: { limitUsd?: number; usedUsd?: number; remainingUsd?: number };
  latencyMs?: number;
}

export const STATUS_META: Record<HealthStatus, { label: string; tone: 'ok' | 'warn' | 'bad' | 'muted'; action?: string }> = {
  ok: { label: '正常', tone: 'ok' },
  out_of_credits: { label: '额度用尽', tone: 'bad', action: '去充值' },
  auth_error: { label: '鉴权失败', tone: 'bad', action: '检查 Key' },
  misconfigured: { label: '配置缺失', tone: 'warn', action: '补配置' },
  down: { label: '不可达', tone: 'bad', action: '检查网络/服务' },
  not_configured: { label: '未配置', tone: 'muted', action: '可选接入' },
};

const PLACEHOLDER_RE = /^(your_|sk-xxx|<|changeme|placeholder|test[-_]?key|todo)/i;

/** 空 / 占位符 key 判定 (未配置). */
export function isPlaceholder(v?: string | null): boolean {
  if (!v) return true;
  const s = v.trim();
  if (!s) return true;
  return PLACEHOLDER_RE.test(s);
}

/** 命中"欠费/额度"语义的关键词 (中英). */
const CREDIT_RE = /(额度|余额|用尽|不足|欠费|insufficient|quota|balance|exceeded|out of credit|arrears|expired)/i;

function snippet(s: string): string {
  return (s || '').replace(/\s+/g, ' ').trim().slice(0, 140);
}

/** 通用 HTTP 探针归类 (OpenAI 兼容网关 / REST). */
export function classifyHttp(input: { httpStatus?: number; body?: string; error?: string }): { status: HealthStatus; detail: string } {
  const { httpStatus, body = '', error } = input;
  if (error) return { status: 'down', detail: snippet(error) || '请求异常' };
  if (httpStatus == null) return { status: 'down', detail: '无响应' };
  if (httpStatus === 200) return { status: 'ok', detail: 'HTTP 200' };
  if (httpStatus === 402) return { status: 'out_of_credits', detail: snippet(body) || 'HTTP 402' };
  if (httpStatus === 401 || httpStatus === 403) {
    if (CREDIT_RE.test(body)) return { status: 'out_of_credits', detail: snippet(body) };
    return { status: 'auth_error', detail: snippet(body) || `HTTP ${httpStatus}` };
  }
  if (httpStatus === 429) {
    if (CREDIT_RE.test(body)) return { status: 'out_of_credits', detail: snippet(body) };
    return { status: 'down', detail: '被限流 (429)' };
  }
  if (httpStatus >= 500) return { status: 'down', detail: `HTTP ${httpStatus}` };
  if (CREDIT_RE.test(body)) return { status: 'out_of_credits', detail: snippet(body) };
  return { status: 'down', detail: `HTTP ${httpStatus} ${snippet(body)}`.trim() };
}

/** MiniMax base_resp.status_code 归类 (0=成功; 1008/2054=余额; 1004 group 不匹配=配置). */
export function classifyMinimax(baseResp: { status_code?: number; status_msg?: string } | null | undefined): { status: HealthStatus; detail: string } {
  if (!baseResp || baseResp.status_code == null) return { status: 'down', detail: '无 base_resp' };
  const code = baseResp.status_code;
  const msg = baseResp.status_msg || '';
  if (code === 0) return { status: 'ok', detail: '正常' };
  if (code === 1008 || code === 2054) return { status: 'out_of_credits', detail: `${code} ${msg}` };
  // v7.0.1: 2056 = 临时限流窗口 (鉴权+模型都有效, 稍后自动恢复) → 视为已配置可用, 不算欠费
  if (code === 2056 || /usage limit reached|rate limit|5-hour|限流/i.test(msg)) {
    return { status: 'ok', detail: `已配置可用 · 当前限流窗口稍后恢复` };
  }
  if (code === 1004) {
    return /group/i.test(msg)
      ? { status: 'misconfigured', detail: `${code} ${msg} (GroupId 不匹配)` }
      : { status: 'auth_error', detail: `${code} ${msg}` };
  }
  if (CREDIT_RE.test(msg)) return { status: 'out_of_credits', detail: `${code} ${msg}` };
  return { status: 'down', detail: `${code} ${msg}` };
}

/** OpenAI 风格网关余额: subscription.hard_limit_usd + usage.total_usage(分) → 额度. */
export function extractGatewayBalance(
  sub: { hard_limit_usd?: number; soft_limit_usd?: number } | null | undefined,
  usageTotalCents?: number,
): { limitUsd?: number; usedUsd?: number; remainingUsd?: number } {
  const limitUsd = typeof sub?.hard_limit_usd === 'number' ? sub.hard_limit_usd : undefined;
  const usedUsd = typeof usageTotalCents === 'number' ? Math.round(usageTotalCents) / 100 : undefined;
  const remainingUsd = limitUsd != null && usedUsd != null ? Math.max(0, +(limitUsd - usedUsd).toFixed(2)) : undefined;
  return { limitUsd, usedUsd, remainingUsd };
}

/** 整体健康度: 有 bad → critical; 有 warn → warning; 否则 healthy. */
export function overallHealth(items: ProviderHealth[]): 'healthy' | 'warning' | 'critical' {
  const tones = items.map((i) => STATUS_META[i.status].tone);
  if (tones.includes('bad')) return 'critical';
  if (tones.includes('warn')) return 'warning';
  return 'healthy';
}
