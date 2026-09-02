/**
 * lib/kling-multishot.ts — Kling 3.0 多镜连贯(v12.406)。
 *
 * ── 为什么值得做 ──────────────────────────────────────────────────────
 * 我们现在的做法是**逐镜生成 + 靠角色 DNA 拼一致性**:每个镜头一次调用,
 * 镜与镜之间的连贯全靠 prompt 里的锚点句和 vision retry 去挽救。
 * Kling 3.0 支持在**一次调用里出最多 6 个连贯镜头** —— 同一次生成内的一致性
 * 是模型自己保证的,比我们事后拼要稳,而且省调用次数。
 *
 * 这属于竞品对比表第三列「我们用了多少」为 0 的那一行:
 * 能力早就接进来了(provider 注册表里就是 kling-v3),只是从没调用过。
 *
 * ── 官方约束(2026-09-03 核文档)──────────────────────────────────────
 *   multi_shot: true          启用多镜
 *   shot_type: 'customize'    自定义分镜(而非让模型自己切)
 *   multi_prompt: [{ index, prompt, duration }]
 *     · index 0–5,**最多 6 镜**
 *     · 单镜 **≥3 秒**
 *     · 合计 **≤15 秒**
 *     · prompt ≤2500 字(与单镜同限,v12.197 实测 1201 报错)
 *
 * 这三条约束是硬的:越界不是「效果差一点」,是整次调用被拒。
 * 而一次多镜调用被拒 = 6 个镜头一起没了,比单镜失败贵得多 ——
 * 所以宁可在本地先规整成合法输入,也不要把一个必然失败的请求送出去。
 */

export const KLING_MULTISHOT_MAX_SHOTS = 6;
export const KLING_MULTISHOT_MIN_SEC = 3;
export const KLING_MULTISHOT_TOTAL_MAX_SEC = 15;
export const KLING_PROMPT_MAX_CHARS = 2450; // 官方 2500,留一点余量(与单镜路径一致)

export interface ShotSpec {
  prompt: string;
  durationSec?: number;
}

export interface MultiShotPlan {
  /** 能一次出的镜头(已规整为合法输入) */
  shots: Array<{ index: number; prompt: string; duration: number }>;
  /** 放不进本次调用、需要另外单独生成的镜头(**必须回传给调用方,不能悄悄丢**) */
  overflow: ShotSpec[];
  totalSec: number;
}

/**
 * 把一串镜头规整成一次合法的 Kling 多镜调用。
 *
 * **溢出的镜头会被原样回传**,而不是截断丢弃 ——
 * 这个项目有过「清理任务把还在被引用的素材当孤儿删掉」的教训:
 * 静默丢东西的代价,永远比多返回一个字段大。
 */
export function planMultiShot(shots: ShotSpec[]): MultiShotPlan {
  const out: MultiShotPlan['shots'] = [];
  const overflow: ShotSpec[] = [];
  let total = 0;

  for (const s of shots) {
    const prompt = (s.prompt || '').slice(0, KLING_PROMPT_MAX_CHARS);
    if (!prompt.trim()) { overflow.push(s); continue; }

    // 单镜下限是硬的:低于 3 秒整次调用被拒
    const want = Math.max(KLING_MULTISHOT_MIN_SEC, Math.round(s.durationSec ?? KLING_MULTISHOT_MIN_SEC));

    if (out.length >= KLING_MULTISHOT_MAX_SHOTS || total + want > KLING_MULTISHOT_TOTAL_MAX_SEC) {
      overflow.push(s);
      continue;
    }
    out.push({ index: out.length, prompt, duration: want });
    total += want;
  }

  return { shots: out, overflow, totalSec: total };
}

/** 一次多镜调用是否值得走(只剩 1 个镜头就没必要,单镜路径参数更全)。 */
export function worthMultiShot(plan: MultiShotPlan): boolean {
  return plan.shots.length >= 2;
}

/** 组装请求体片段。model_name / aspect_ratio 等由调用方按既有逻辑填。 */
export function multiShotBody(plan: MultiShotPlan): Record<string, unknown> {
  return {
    multi_shot: true,
    shot_type: 'customize',
    multi_prompt: plan.shots,
  };
}
