/**
 * 基址归一化 —— v12.333。
 *
 * ── 为什么这必须有个单一出处 ──────────────────────────────────────────
 * 「base 里到底该不该带版本段」是一条**跨文件的约定**,而不是各自的实现细节:
 * MiniMax 的三个消费方(`lib/config.ts` → minimax.service、`services/voice-clone.service.ts`、
 * `lib/shot-quality-gate.ts`)调用点全都自己拼 `/v1/xxx`,所以 base **必须不带** `/v1`。
 * 这条约定此前没有出处,于是各写一套:happyhorse.service 记得剪 `/v1`,MiniMax 三处
 * 一个字都没剪。用户照聚合商文档粘一个以 `/v1` 结尾的地址进来(几乎所有网关文档都这么写),
 * 整条链路就变成 `/v1/v1/video_generation` —— 全线 404,且没有任何一行日志说得清原因。
 *
 * 这不是假想:v12.333 排查 MiniMax 时,我自己的探测脚本正是少拼了 `/v1` 打到 404,
 * 于是把「路径拼错」误判成「端点不存在」。同一颗地雷用户也会踩,只是他不会来问我。
 *
 * ── stripApiVersion 为什么是显式开关 ─────────────────────────────────
 * 反过来的供应商同样多:`OPENAI_BASE_URL=https://api.openai.com/v1`、
 * OpenRouter 的 `https://openrouter.ai/api/v1` —— 它们的调用点只接 `/chat/completions`,
 * base 里的 `/v1` **是必需的**,剪掉就全坏。所以剪版本段只能由知道自家调用点怎么拼的
 * 那一方显式要求,绝不能做成默认行为。
 */

export interface NormalizeBaseURLOptions {
  /** 调用点自己带版本段时置 true(如 MiniMax:`${base}/v1/...`),会剪掉 base 末尾的 `/v1`。 */
  stripApiVersion?: boolean;
}

/** 剪掉末尾斜杠(可选再剪版本段)。空输入返回空串 —— 缺省值由调用方在传入前决定。 */
export function normalizeBaseURL(raw: string | undefined | null, opts: NormalizeBaseURLOptions = {}): string {
  let s = (raw ?? '').trim().replace(/\/+$/, '');
  if (opts.stripApiVersion) s = s.replace(/\/v\d+$/, '');
  return s;
}
