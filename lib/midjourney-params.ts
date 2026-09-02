/**
 * lib/midjourney-params.ts — Midjourney 参数构造(v12.404)。
 *
 * ── 病象:我们从不指定版本,所以不知道自己在哪一版 ──────────────────────
 * `services/midjourney.service.ts:81` 一直在发 `--cref <url> --cw <n>`,
 * 而**全仓没有任何一处声明过 MJ 版本** —— 走的是网关默认。
 *
 * 官方在 V7 用 **Omni Reference**(`--oref` + `--ow`,1–1000 默认 100)取代了
 * V6 的 Character Reference(`--cref` + `--cw`),且 Character Reference 文档里
 * 直接叫 V7 用户改用 Omni Reference。
 *
 * 两件事叠在一起的后果:**如果网关默认是 V7,我们发的 `--cref` 就是个无效参数**,
 * 而 MJ 不会因为多了个不认识的参数而报错 —— 它照样出图,只是角色不锁了。
 * 于是「角色锁脸」这项能力可能早已在 MJ 路径上静默失效,而我们从产物上看不出来:
 * 出的图依然好看,只是不是同一个人。这正是那条老教训的形态 ——
 * **上游静默忽略不认识的字段,失败长得像成功**。
 *
 * ── 修法:不猜,声明 ──────────────────────────────────────────────────
 * ① 每次请求**显式带上 `--v`**,让版本成为我们决定的事,而不是网关决定的事;
 * ② 参数按版本切:V7 → `--oref/--ow`,V6.x → `--cref/--cw`;
 * ③ 越界值夹住 —— MJ 对越界参数同样是「不报错但不按你想的来」。
 *
 * 官方文档(2026-09-02 核):https://docs.midjourney.com/hc/en-us/articles/36285124473997-Omni-Reference
 *
 * ⚠️ 本轮无 MJ 额度,**未做真机验证**。所以这里只做「让行为变得确定且可声明」,
 * 不声称「角色一致性已修复」—— 那需要出图比对才能下结论。
 */

/** 默认版本。MJ 当前主线是 7;可用 MJ_VERSION 覆盖(如网关只开通到 6.1)。 */
export const MJ_DEFAULT_VERSION = '7';

export function mjVersion(): string {
  const v = (process.env.MJ_VERSION || MJ_DEFAULT_VERSION).trim();
  // 只接受 数字[.数字] 形态,避免把任意字符串拼进 prompt
  return /^\d+(\.\d+)?$/.test(v) ? v : MJ_DEFAULT_VERSION;
}

/** V7 起用 Omni Reference。 */
export function usesOmniReference(version: string): boolean {
  return parseFloat(version) >= 7;
}

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, Math.round(n)));

export interface MjParamInput {
  /** 角色/主体参考图 URL */
  cref?: string;
  /** 风格参考图 URL */
  sref?: string;
  aspectRatio?: string;
  style?: string;
  /** V6 的 character weight,0–100 */
  cw?: number;
  /** V7 的 omni weight,1–1000(默认 100;>400 官方说结果不可预测) */
  ow?: number;
  /** 覆盖版本(测试用);不传则读 env */
  version?: string;
}

/**
 * 返回要追加到 prompt 后面的参数串(含前导空格;无参数时返回空串)。
 * 顺序固定,便于断言与日志比对。
 */
export function buildMjParams(input: MjParamInput): string {
  const version = input.version || mjVersion();
  const parts: string[] = [];

  if (input.cref) {
    if (usesOmniReference(version)) {
      parts.push(`--oref ${input.cref}`);
      parts.push(`--ow ${clamp(input.ow ?? 100, 1, 1000)}`);
    } else {
      parts.push(`--cref ${input.cref}`);
      parts.push(`--cw ${clamp(input.cw ?? 100, 0, 100)}`);
    }
  }
  if (input.sref) parts.push(`--sref ${input.sref}`);
  if (input.aspectRatio) parts.push(`--ar ${input.aspectRatio}`);
  if (input.style) parts.push(`--style ${input.style}`);

  // 版本永远显式声明 —— 这是本次修复的核心:
  // 不声明就等于把「用哪一版、哪套参数生效」交给网关默认值,而它随时可能变。
  parts.push(`--v ${version}`);

  return parts.length ? ` ${parts.join(' ')}` : '';
}
