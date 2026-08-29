/**
 * Pipeline 级结构化错误
 *
 * 用于 services/hybrid-orchestrator.ts、API 路由、SSE 流之间的统一契约：
 *   - `code`        — 机器可识别的错误码（ENGINE_UNAVAILABLE / SENSITIVE_INPUT / NETWORK ...）
 *   - `userMsg`     — 面向用户的中文提示（toast 直接展示）
 *   - `retryable`   — 该步骤是否支持"仅重试此步"（false 则必须回滚/重跑整条流程）
 *   - `stage`       — 所属阶段（script/character/scene/storyboard/video/compose/tts/music）
 *   - `cause`       — 原始错误（保留完整 stack，仅日志用）
 *
 * 前端 SSE 消费者应在收到 `type:'error'` 消息时，检查 `retryable`：
 *   true  → 展示 toast + "重试此步" 按钮（调用 /api/projects/:id/regenerate-shot 等子接口）
 *   false → 展示 toast + "重新开始" 按钮
 */

import { ARREARS_RE, SATURATED_RE, DISCONTINUED_RE } from './quota-vocab.mjs';

export type PipelineStage =
  | 'script'
  | 'character'
  | 'scene'
  | 'storyboard'
  | 'video'
  | 'tts'
  | 'music'
  | 'compose'
  | 'export'
  | 'unknown';

export type PipelineErrorCode =
  | 'ENGINE_UNAVAILABLE'      // 引擎未配置 / key 缺失
  | 'ENGINE_FAILED'           // 引擎返回失败但其它引擎还可重试
  | 'ALL_ENGINES_FAILED'      // 所有 fallback 均失败
  | 'SENSITIVE_INPUT'         // Minimax 1026 敏感词净化后仍失败
  | 'INVALID_RESPONSE'        // 上游返回结构非预期（无 URL / 无 audio）
  | 'NETWORK'                 // 网络超时 / fetch error
  | 'TIMEOUT'                 // 轮询超时
  | 'FFMPEG'                  // 本地合成失败
  | 'IO'                      // 文件读写失败
  | 'VALIDATION'              // 输入校验失败
  | 'DB'                      // SQLite 操作失败
  | 'PROVIDER_ARREARS'        // v12.376:上游欠费 —— 重试没用,要充值或换引擎
  | 'QUOTA_SATURATED'         // v12.376:配额/限流已满 —— 当次重试没用,等刷新或换引擎
  | 'PROVIDER_DISCONTINUED'   // v12.376:接口已对本账号停用 —— 充值和重试都没用
  | 'UNKNOWN';

export interface PipelineErrorOptions {
  userMsg: string;
  retryable?: boolean;
  stage?: PipelineStage;
  cause?: unknown;
  details?: Record<string, unknown>;
}

export class PipelineError extends Error {
  public readonly code: PipelineErrorCode;
  public readonly userMsg: string;
  public readonly retryable: boolean;
  public readonly stage: PipelineStage;
  public readonly details?: Record<string, unknown>;
  public readonly cause?: unknown;

  constructor(code: PipelineErrorCode, opts: PipelineErrorOptions) {
    super(opts.userMsg);
    this.name = 'PipelineError';
    this.code = code;
    this.userMsg = opts.userMsg;
    this.retryable = opts.retryable ?? true;
    this.stage = opts.stage ?? 'unknown';
    this.details = opts.details;
    this.cause = opts.cause;
  }

  toJSON() {
    return {
      name: this.name,
      code: this.code,
      userMsg: this.userMsg,
      retryable: this.retryable,
      stage: this.stage,
      details: this.details,
    };
  }
}

/**
 * 语法糖：`throw createError('SENSITIVE_INPUT', '内容含敏感词,请修改', { stage:'video', retryable:true })`
 */
export function createError(
  code: PipelineErrorCode,
  userMsg: string,
  opts: Omit<PipelineErrorOptions, 'userMsg'> = {},
): PipelineError {
  return new PipelineError(code, { ...opts, userMsg });
}

/**
 * 把任意 unknown 错误映射为 PipelineError。
 * 已是 PipelineError → 原样返回；否则按消息特征推断 code + retryable。
 */
export function normalizeError(err: unknown, stage: PipelineStage = 'unknown'): PipelineError {
  if (err instanceof PipelineError) return err;

  const raw = err instanceof Error ? err : new Error(String(err));
  const msg = raw.message || '';

  // ── v12.376:先判「重试绝不会成功」的三种终局 ──────────────────────────
  // 病根:这三种此前全部落进 UNKNOWN,而 UNKNOWN 的 retryable 默认是 true。
  // 界面据 retryable 决定要不要给「重试」按钮(app/dashboard/create/page.tsx:694),
  // 于是用户对着一个永远不可能成功的调用反复点重试 —— 而这三种恰恰是
  // owner 当下天天遇到的:可灵 1102 欠费、MiniMax 2056 当日额度满、Music API 410 停用。
  //
  // 判定顺序照抄 quota-vocab 的既有教训:**欠费必须排在限流之前**
  // (可灵欠费返回 HTTP 429 + "Account balance not enough",按 429 判会先被限流吃掉);
  // 「已停用」比欠费更终局,排最前 —— 充值也救不回来。
  if (DISCONTINUED_RE.test(msg)) {
    return createError('PROVIDER_DISCONTINUED', '该接口已对本账号停用,充值和重试都无效,请改用其它引擎或自备素材', {
      stage, cause: raw, retryable: false,
    });
  }
  if (ARREARS_RE.test(msg)) {
    return createError('PROVIDER_ARREARS', '上游账户余额不足,重试不会成功 —— 请充值或改用其它引擎', {
      stage, cause: raw, retryable: false,
    });
  }
  if (SATURATED_RE.test(msg)) {
    return createError('QUOTA_SATURATED', '上游配额已满或触发限流,稍后(通常次日刷新)再试,或改用其它引擎', {
      stage, cause: raw, retryable: false,
    });
  }

  // 启发式归类
  if (/1026|sensitive/i.test(msg)) {
    return createError('SENSITIVE_INPUT', '内容含敏感词,已自动改写但仍被拦截,请手动调整描述', {
      stage, cause: raw, retryable: true,
    });
  }
  if (/timeout|timed out|ETIMEDOUT/i.test(msg)) {
    return createError('TIMEOUT', '上游服务响应超时,请稍后重试此步', {
      stage, cause: raw, retryable: true,
    });
  }
  if (/fetch failed|ECONNRESET|ENOTFOUND|network/i.test(msg)) {
    return createError('NETWORK', '网络异常,请检查连接后重试此步', {
      stage, cause: raw, retryable: true,
    });
  }
  if (/no URL in response|INVALID_RESPONSE|invalid URL/i.test(msg)) {
    return createError('INVALID_RESPONSE', '上游返回格式异常,已自动切换备用引擎', {
      stage, cause: raw, retryable: true,
    });
  }
  if (/not available|not configured|missing key/i.test(msg)) {
    return createError('ENGINE_UNAVAILABLE', '该引擎不可用,请检查 API Key 配置', {
      stage, cause: raw, retryable: false,
    });
  }
  if (/ffmpeg/i.test(msg)) {
    return createError('FFMPEG', '视频合成失败,请检查素材完整性后重试', {
      stage, cause: raw, retryable: true,
    });
  }

  return createError('UNKNOWN', msg || '未知错误', { stage, cause: raw, retryable: true });
}

/**
 * 把 PipelineError 序列化为 SSE event payload。
 * 使用方：`send('error', toSsePayload(err))`
 */
export function toSsePayload(err: unknown) {
  const pe = err instanceof PipelineError ? err : normalizeError(err);
  return {
    code: pe.code,
    userMsg: pe.userMsg,
    retryable: pe.retryable,
    stage: pe.stage,
    details: pe.details,
  };
}
