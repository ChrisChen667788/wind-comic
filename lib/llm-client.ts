/**
 * v7.1 — 统一 LLM 调用客户端 (高可用): 主 → MiniMax 全局兜底 + 超时 + <think> 剥离.
 *
 * 各模块 (剧本润色 / 草稿对比 / 等) 之前各自 fetch, 超时/兜底/解析不一致 → 不稳定.
 * 这里收口成一个 helper: 任何主 LLM 异常/欠费/超时 → 自动落 MiniMax, 首个成功即返回.
 * 注: orchestrator 的 callLLM 走子进程 (绕 Turbopack), 逻辑相同但独立实现.
 */

import { API_CONFIG } from './config';

export interface LLMAttempt { baseURL: string; apiKey: string; model: string; label: string; }

/**
 * 构建尝试链: 主 (创意=DeepSeek / 通用=主网关) → MiniMax 全局兜底. 纯函数, 可单测.
 * fast=true 且 useCreative 时, 主用创意"快档"模型 (deepseek-v4-flash) —— 推理 token 少、秒级响应,
 * 适合"快草稿/润色basic"; 默认 false 用 creativeModel (deepseek-v4-pro, 质量优先).
 */
export function buildLLMAttempts(useCreative: boolean, cfg: any = API_CONFIG.openai, fast = false): LLMAttempt[] {
  const creativeModel = fast
    ? (cfg.creativeFastModel || cfg.creativeModel || cfg.model)
    : (cfg.creativeModel || cfg.model);
  const primary = useCreative
    ? { baseURL: cfg.creativeBaseURL || cfg.baseURL, apiKey: cfg.creativeApiKey || cfg.apiKey, model: creativeModel, label: fast ? '创意·DeepSeek快' : '创意·DeepSeek' }
    : { baseURL: cfg.baseURL, apiKey: cfg.apiKey, model: cfg.model, label: '通用' };
  const out: LLMAttempt[] = [];
  if (primary.apiKey) out.push(primary);
  // v12.61.0 P0-2:同网关备用模型 —— 主模型 429/503 时先切同网关这些健康模型(秒级、同 key),
  // 再落慢的 MiniMax 兜底(推理模型 40-100s)。与 primary 同 base/key、跳过同名/重复。
  if (primary.apiKey) {
    for (const alt of (cfg.altModels || [])) {
      if (alt && alt !== primary.model && !out.some((a: LLMAttempt) => a.model === alt && a.baseURL === primary.baseURL)) {
        out.push({ baseURL: primary.baseURL, apiKey: primary.apiKey, model: alt, label: `同网关备用·${alt}` });
      }
    }
  }
  if (cfg.fallbackApiKey && (cfg.fallbackApiKey !== primary.apiKey || cfg.fallbackModel !== primary.model)) {
    out.push({ baseURL: cfg.fallbackBaseURL, apiKey: cfg.fallbackApiKey, model: cfg.fallbackModel, label: 'MiniMax兜底' });
  }
  return out;
}

/** 剥离 reasoning 模型的 <think>...</think> 块 (deepseek/minimax 等偶发). 纯函数. */
export function stripThink(s: string): string {
  return (s || '').replace(/<think>[\s\S]*?<\/think>\s*/gi, '').trim();
}

/**
 * 判断是否"瞬时可重试"错误 (上游过载/限流/5xx) —— 这类错误退避后重试同一端点往往即恢复,
 * 比立刻切到慢速兜底 (MiniMax 推理模型 40-75s) 体验好得多。
 * 注意: 故意不含 'timeout' —— 超时重试同端点代价高, 直接切兜底更划算。
 */
export function isTransientLLMError(msg: string): boolean {
  return /too busy|rate.?limit|\b429\b|\b500\b|\b502\b|\b503\b|\b504\b|overload|temporarily|try again|service unavailable|繁忙|过载|稍后/i.test(msg || '');
}

export interface LLMCallOpts {
  system: string;
  user: string;
  /** true=创意主LLM(DeepSeek), false=通用(主网关). 两者都兜底 MiniMax */
  useCreative?: boolean;
  /** true=创意快档(deepseek-v4-flash, 秒级/推理少), 仅 useCreative 时生效 */
  fast?: boolean;
  maxTokens?: number;
  /** 单次尝试超时 (ms), 默认 150s */
  timeoutMs?: number;
  temperature?: number;
  /** 要求 response_format json_object */
  jsonMode?: boolean;
  /** 每个端点遇"瞬时错误"(过载/限流/5xx)时退避重试次数, 默认 1 (即最多打 2 次该端点再切兜底) */
  retriesPerAttempt?: number;
}

export interface LLMCallResult {
  ok: boolean;
  content?: string;
  model?: string;
  error?: string;
  /** 是否走了兜底 (主失败) */
  usedFallback?: boolean;
  attemptsTried?: string[];
}

/** 调 LLM, 主→MiniMax 兜底, 首个成功即返回; 内置超时 + <think> 剥离. */
export async function callLLMWithFallback(opts: LLMCallOpts): Promise<LLMCallResult> {
  const attempts = buildLLMAttempts(!!opts.useCreative, API_CONFIG.openai, !!opts.fast);
  if (attempts.length === 0) return { ok: false, error: 'LLM 未配置 (缺 DEEPSEEK_API_KEY / OPENAI_API_KEY)' };
  const timeoutMs = opts.timeoutMs ?? 150_000;
  const retries = Math.max(0, opts.retriesPerAttempt ?? 1);
  const tried: string[] = [];
  let lastErr = 'no attempt';

  for (let i = 0; i < attempts.length; i++) {
    const a = attempts[i];
    // 同一端点上: 遇"瞬时错误"退避重试, 退避 (attempt+1)*0.8s; 非瞬时/超时则直接切下一个端点
    for (let attempt = 0; attempt <= retries; attempt++) {
      const tag = attempt > 0 ? `${a.label}#${attempt + 1}` : a.label;
      tried.push(tag);
      const ctl = new AbortController();
      const tm = setTimeout(() => ctl.abort(), timeoutMs);
      try {
        const body: Record<string, any> = {
          model: a.model,
          messages: [{ role: 'system', content: opts.system }, { role: 'user', content: opts.user }],
          max_tokens: opts.maxTokens ?? 4096,
        };
        if (opts.temperature != null) body.temperature = opts.temperature;
        if (opts.jsonMode) body.response_format = { type: 'json_object' };
        const r = await fetch(`${a.baseURL}/chat/completions`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${a.apiKey}`, 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
          signal: ctl.signal,
        });
        clearTimeout(tm);
        const j = await r.json().catch(() => null);
        const content = stripThink(j?.choices?.[0]?.message?.content || '');
        if (r.ok && content) {
          return { ok: true, content, model: a.model, usedFallback: i > 0, attemptsTried: tried };
        }
        lastErr = j?.error?.message || `LLM ${r.status}`;
        console.warn(`[llm-client] ${tag} 失败: ${lastErr}`);
      } catch (e: any) {
        clearTimeout(tm);
        lastErr = e?.name === 'AbortError' ? 'timeout' : (e?.message || String(e));
        console.warn(`[llm-client] ${tag} 异常: ${lastErr}`);
      }
      // 仅"瞬时错误 + 还有重试余量"才退避重试同端点; 否则跳出去打下一个端点 (兜底)
      if (attempt < retries && isTransientLLMError(lastErr)) {
        await new Promise((res) => setTimeout(res, 800 * (attempt + 1)));
        continue;
      }
      break;
    }
  }
  return { ok: false, error: lastErr, attemptsTried: tried };
}
