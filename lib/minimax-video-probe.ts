/**
 * v12.452 · MiniMax **视频**探针(健康页)。
 *
 * 病象:健康页对 MiniMax 只探 TTS。TTS 在 Token Plan 上是好的 → 页面上 MiniMax 一片绿,
 * 而视频默认模型 H3 在 Token Plan 上**根本用不了**(2013「TokenPlan 或 Credit 暂不支持 MiniMax-H3 系列模型」):
 * 出片靠 v12.446 起的回落改用 Hailuo-2.3,参考视频动作迁移(v12.448)整项用不了 —— 这些健康页一个字都没有。
 *
 * **零成本**:发一个**内容为空**的请求 —— 没有任何提示词或素材,不可能生成东西,只让它走到模型/套餐校验。
 *
 * ⚠️ 上游校验顺序会变,不能想当然。2026-09-18 首测时 `{model}` 一个字段就能走到套餐校验;
 * **2026-09-22 复测已变成「格式绑定 → 模型/套餐 → 内容语义」**:缺任一必填字段都先被绑定层拒,
 * 真模型与**根本不存在的模型名**回的是同一句 `binding: expr_path=content, missing required parameter` ——
 * 草稿版把它当成「过了套餐校验」,于是把用不了的 H3 报成了绿(对照实验当场抓到)。现在:
 *   POST /v2/video_generation { model:'MiniMax-H3', content:[], duration:4, resolution:'768P' }
 *        → 400「invalid params, TokenPlan 或 Credit 暂不支持 MiniMax-H3 系列模型 (2013)」(套餐不支持)
 *   同上但 model 为不存在的名字 → 400「invalid params, 该模型暂不支持 /v2/video_generation (2013)」
 *   POST /v1/video_generation { model:'MiniMax-Hailuo-2.3' } → 200 + 2013「text to video: prompt can't be empty」(在套餐内)
 * 判「在套餐内」**必须有正向信号**:错误说的是**内容/提示词为空**(说明已经过了模型与套餐两关)。
 * 绑定层报缺字段、「模型不支持该接口」、读不懂的回复 —— 一律不报绿,原文照登,让人去看。
 * 万一哪天上游对空内容请求也建了任务(会扣费),探针当场自停,之后不再发请求 —— 健康检查绝不能是个会扣费的动作。
 *
 * 判定只认报文语义,复用 `isModelUnavailableError`(出片回落用的同一份),不按错误码认:2013 是通用参数错误码。
 */
import { classifyHttp, classifyMinimax, isPlaceholder, type ProviderHealth, type ProviderKind } from './provider-health';
import { LEGACY_VIDEO_MODEL, apiVersionFor, defaultVideoModel, isModelUnavailableError, videoCreatePath } from './minimax-video-api';

export type ProbeResponse = { httpStatus?: number; body?: string; error?: string };
export type ProbeFetch = (url: string, init: RequestInit) => Promise<ProbeResponse>;

/** 探针意外建过任务 → 本进程内不再发任何视频探测请求 */
let selfStopped: string | null = null;
export function resetVideoProbeForTest(): void { selfStopped = null; }

type Assessment =
  | { kind: 'in_plan'; message: string }          // 被参数校验拒:模型在套餐内
  | { kind: 'plan_blocked'; message: string }     // 套餐不支持
  | { kind: 'task_created'; taskId: string }      // 意外建了任务
  | { kind: 'health'; status: ProviderHealth['status']; detail: string }; // 鉴权 / 额度 / 不可达等,原样归类

/** v1 报错在 base_resp 里(HTTP 200);V2 报错是 { type:'error', error:{ message } }(HTTP 400),错误码只在 message 末尾的括号里 */
export function readMinimaxReply(body?: string): { code?: number; message: string; taskId?: string } {
  let j: any = null;
  try { j = body ? JSON.parse(body) : null; } catch { /* 不是 JSON */ }
  const message = String(j?.base_resp?.status_msg || j?.error?.message || j?.message || body || '').slice(0, 300);
  const raw = j?.base_resp?.status_code ?? (/\((\d{3,5})\)\s*$/.exec(message)?.[1]);
  const code = raw == null || raw === '' ? undefined : Number(raw);
  // 两版创建接口成功时都回 task_id(出片代码同样只认它);报错体里可能带请求号之类的 id,不能当成任务号
  const taskId = typeof j?.task_id === 'string' && j.task_id ? j.task_id : undefined;
  return { code: Number.isFinite(code) ? code : undefined, message, taskId };
}

/** 上游格式绑定层拒了(缺字段/类型错)—— 请求根本没走到模型与套餐那两关 */
const BINDING_RE = /binding:\s*expr_path=(\w+)/i;
/** 模型名本身不被该接口认(配错模型名 / 接口不对) */
const MODEL_UNSUPPORTED_RE = /该模型暂不支持|model[^,.;]*not (?:found|exist|supported)|unknown model|invalid model/i;
/** 正向信号:错误说的是内容/提示词为空 —— 只有过了模型与套餐两关才会走到这一步 */
const CONTENT_STAGE_RE = /prompt can'?t be empty|prompt is (?:empty|required)|content[^,.;]*(?:empty|required|at least)|(?:提示词|内容)[^,.;]*(?:为空|不能为空|必填)/i;

export function assessProbe(r: ProbeResponse): Assessment {
  if (r.error || r.httpStatus == null) return { kind: 'health', ...classifyHttp(r) };
  const { code, message, taskId } = readMinimaxReply(r.body);
  if (taskId) return { kind: 'task_created', taskId };
  if (isModelUnavailableError(message)) return { kind: 'plan_blocked', message };
  // 401/403/429/5xx:鉴权、限流、宕机 —— 交给通用归类(它认得「额度」字样)
  if (r.httpStatus !== 200 && r.httpStatus !== 400) return { kind: 'health', ...classifyHttp(r) };
  if (code != null && code !== 0 && code !== 2013) return { kind: 'health', ...classifyMinimax({ status_code: code, status_msg: message }) };
  const bound = BINDING_RE.exec(message);
  if (bound) {
    return { kind: 'health', status: 'misconfigured', detail: `探测请求被上游格式校验拒(缺 ${bound[1]}),没走到套餐校验 —— 上游接口变了,探针需要更新:${message.slice(0, 120)}` };
  }
  if (MODEL_UNSUPPORTED_RE.test(message)) {
    return { kind: 'health', status: 'misconfigured', detail: `模型名不被该接口认,检查 MINIMAX_VIDEO_MODEL:${message.slice(0, 120)}` };
  }
  if (code === 2013 && CONTENT_STAGE_RE.test(message)) return { kind: 'in_plan', message };
  // 说不清的一律不报「正常」,原文照登
  return { kind: 'health', status: 'misconfigured', detail: `无法判读的回复,请人工确认:${message.slice(0, 160) || `HTTP ${r.httpStatus}`}` };
}

/**
 * 探测请求体:过得了格式绑定,但**没有任何可生成的内容**。
 * v2(H3)绑定层要求 content/duration/resolution 都在;v1 的 Hailuo 缺 prompt 就停在内容语义那一步。
 */
export function probeBody(model: string): Record<string, unknown> {
  return apiVersionFor(model) === 'v2'
    ? { model, content: [], duration: 4, resolution: '768P' }
    : { model };
}

export async function probeMinimaxVideo(opts: {
  baseUrl: string;
  key?: string;
  fetch: ProbeFetch;
  model?: string;
}): Promise<ProviderHealth> {
  const model = opts.model || defaultVideoModel();
  const base = { id: 'minimax-video', label: `MiniMax 视频 · ${model}`, kind: 'video' as ProviderKind, baseUrl: opts.baseUrl };
  if (isPlaceholder(opts.key)) return { ...base, status: 'not_configured', detail: '未设置 MINIMAX_API_KEY' };
  if (!/minimaxi?\.(com|io)/i.test(opts.baseUrl)) {
    return { ...base, status: 'misconfigured', detail: `MINIMAX_BASE_URL 不是官方端点,视频接口用不了(与出片代码同一判据)` };
  }
  if (selfStopped) return { ...base, status: 'misconfigured', detail: `视频探针已自停:${selfStopped}` };

  const post = (m: string) => opts.fetch(`${opts.baseUrl}${videoCreatePath(m)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${opts.key}` },
    body: JSON.stringify(probeBody(m)),
  });
  const stop = (m: string, taskId: string): ProviderHealth => {
    selfStopped = `空内容探测 ${m} 竟建了任务(${taskId.slice(0, 24)}),上游校验规则变了 —— 为免扣费探针已自停,请反馈维护者`;
    return { ...base, status: 'misconfigured', detail: selfStopped };
  };

  const t0 = Date.now();
  const a = assessProbe(await post(model));
  const latencyMs = Date.now() - t0;
  if (a.kind === 'task_created') return { ...stop(model, a.taskId), latencyMs };
  if (a.kind === 'health') return { ...base, status: a.status, detail: a.detail, latencyMs };
  if (a.kind === 'in_plan') return { ...base, status: 'ok', latencyMs, detail: `${model} 在当前套餐内(空内容探测已过模型与套餐校验,未建任务、不计费)` };

  // 默认模型套餐不支持
  if (apiVersionFor(model) !== 'v2' || model === LEGACY_VIDEO_MODEL) {
    return { ...base, status: 'misconfigured', latencyMs, detail: `当前套餐用不了 ${model}:${a.message.slice(0, 120)}` };
  }
  // H3 用不了 → 出片会回落 legacy。回落那条通不通,决定这是「受限」还是「用不了」
  const b = assessProbe(await post(LEGACY_VIDEO_MODEL));
  if (b.kind === 'task_created') return { ...stop(LEGACY_VIDEO_MODEL, b.taskId), latencyMs };
  if (b.kind === 'in_plan') {
    return {
      ...base, status: 'plan_limited', latencyMs,
      detail: `当前套餐用不了 ${model}(只能按量付费)· 出片自动改用 ${LEGACY_VIDEO_MODEL} · 参考视频动作迁移用不了`,
    };
  }
  if (b.kind === 'plan_blocked') {
    return { ...base, status: 'misconfigured', latencyMs, detail: `当前套餐 ${model} 与回落的 ${LEGACY_VIDEO_MODEL} 都用不了` };
  }
  return { ...base, status: b.status, latencyMs, detail: `${model} 套餐不支持;回落的 ${LEGACY_VIDEO_MODEL} 也不通:${b.detail}` };
}
