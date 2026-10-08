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
  if (input.aspectRatio) parts.push(`--ar ${mjAspect(input.aspectRatio)}`);
  if (input.style) parts.push(`--style ${input.style}`);

  // 版本永远显式声明 —— 这是本次修复的核心:
  // 不声明就等于把「用哪一版、哪套参数生效」交给网关默认值,而它随时可能变。
  parts.push(`--v ${version}`);

  return parts.length ? ` ${parts.join(' ')}` : '';
}

// ═══════════════════════════════════════════════════════════════════════
// v12.471 — 参数只能在末尾、每个只出现一次;不认 MJ 语法的引擎不收它
// ═══════════════════════════════════════════════════════════════════════
//
// ── 病象 ──────────────────────────────────────────────────────────────
// lib/mckee-skill.ts 的出图模板把 `--ar 16:9 --s 250 …` 写死在正文末尾,
// 调用方又照真实画幅传 aspectRatio,service 再追加一个 `--ar`:
// 竖屏项目发给 MJ 的提示词里同时有 `--ar 16:9` 和 `--ar 9:16`。
// MJ 官方文档对「同一参数写两次」没有任何规定(Parameter List / Aspect Ratio 两页都没写,
// 2026-10-08 核),取前者、取后者还是报错都是未定义行为。
//
// 官方**写明了**的是另一条(Parameter List · Using Parameters):
//   「Place Parameters at the End: Always put parameters after your prompt text.」
//   并把 `vibrant California --ar 2:3 poppies`(参数后面还跟正文)列为错误写法。
// 而我们的模板参数在正文**中间** —— 编排器在模板后面还要接
// `. Character ID lock …` / `. STYLE LOCK …` / `, composition: …` / 用户的修改意见 ……
// 官方 No 页:`--no` 后面跟的是「the thing or list of things you don't want」,
// 所以角色模板 `--no t-shirt. Character ID lock: …` 这样拼,后面那串锚点词在 MJ 眼里
// 很可能都进了「不要画的东西」。
//
// 本地库 api_usage_events 里 2026-05-25 ~ 07-11 记了 169 次 `MJ failed: parameter error`
// (没存提示词原文,无法逐条归因;此后 MJ 渠道一直不可用,没有新数据)。
//
// ── 修法 ──────────────────────────────────────────────────────────────
// ① 模板不再写画幅(mckee-skill),画幅只由请求参数决定;
// ② MJ 出口(assembleMjPrompt)把正文里的参数**全部挪到末尾**、同名只留一个、
//    请求里给了的以请求为准 —— 库里存的旧提示词(都带 `--ar 16:9`)、用户手改的提示词
//    也一样被收拾干净;
// ③ 其他引擎的官方接口只有纯文本 prompt + 独立的尺寸/画幅字段,没有一家定义 `--` 语法:
//    发出前用 toPlainPrompt 转成纯文本 —— 画幅以字段为准、MJ 调参删掉,
//    `--no X` 的内容是画面语义,改写成普通文字 `no X` 保留(它们原来收到的就是这几个词)。

/** 官方 Parameter List 里要带值的参数(含别名)。表外的 `--xxx` 当开关处理:不吃后面的词,宁可少吃不多吃。 */
const VALUE_PARAMS = new Set([
  'ar', 'aspect', 'bs', 'c', 'chaos', 'cref', 'cw', 'end', 'iw', 'motion', 'no', 'oref', 'ow',
  'q', 'quality', 'r', 'repeat', 's', 'stylize', 'seed', 'sref', 'stop', 'style', 'sv', 'sw',
  'v', 'version', 'w', 'weird',
]);
/** 值可省略的参数(`--p` 用默认画像、`--niji` 用默认版本):后面那个词像取值(含数字的短码)才吃。 */
const OPTIONAL_VALUE_PARAMS = new Set(['p', 'profile', 'niji']);
/** 别名 → 规范名(官方写法「--aspect or --ar」等)。同名判定按规范名算。 */
const PARAM_ALIASES: Record<string, string> = {
  aspect: 'ar', chaos: 'c', profile: 'p', quality: 'q', repeat: 'r', stylize: 's', version: 'v', weird: 'w',
};
/**
 * `--no` 的一项最多几个词。我们自己只发单词项(`--no hoodie`),用户手写也就是 `blurry background`;
 * 再长就是被拼在参数后面的正文了 —— 例如分镜重试的 `--no watermark, IDENTICAL face structure to reference`。
 */
const NO_ITEM_MAX_WORDS = 3;

export interface MjParam {
  /** 规范名(别名已归一,如 aspect → ar) */
  name: string;
  /** 开关参数为空串;`--no` 为逗号分隔的各项 */
  value: string;
}

type MjSegment = { text: string } | { param: MjParam };

/** `--name` 前面必须是开头或空白(URL 里的 `a--b`、正文里的破折号不算) */
const PARAM_RE = /(^|\s)--([a-z][a-z0-9]*)(?=\s|$)/gi;
const VALUE_RE = /[ \t]+(\S+)/y;
const NO_WORD_RE = /[ \t]*([^\s,.;:!?()[\]{}"]+)/y;
const NO_COMMA_RE = /[ \t]*,/y;

function readValue(s: string, pos: number, optional: boolean): [string, number] {
  VALUE_RE.lastIndex = pos;
  const m = VALUE_RE.exec(s);
  if (!m || m[1].startsWith('--')) return ['', pos];
  // 粘在值后面的标点还给正文:`--s 250. Multi-lens prep …` 的句号属于下一句
  const value = m[1].replace(/[,.;:!?)\]]+$/, '');
  if (!value) return ['', pos];
  if (optional && !(/^[a-z0-9]+$/i.test(value) && /\d/.test(value))) return ['', pos];
  return [value, VALUE_RE.lastIndex - (m[1].length - value.length)];
}

/** `--no a, b c, d`:逗号分隔的若干项,项内词间只隔空格;遇句读、换行、方括号、下一个参数即止 */
function readNoList(s: string, pos: number): [string, number] {
  const items: string[] = [];
  let end = pos;
  let p = pos;
  for (;;) {
    const words: string[] = [];
    const wordEnds: number[] = [];
    let q = p;
    for (;;) {
      NO_WORD_RE.lastIndex = q;
      const w = NO_WORD_RE.exec(s);
      if (!w || w[1].startsWith('--')) break;
      words.push(w[1]);
      q = NO_WORD_RE.lastIndex;
      wordEnds.push(q);
    }
    if (!words.length) break;
    if (words.length > NO_ITEM_MAX_WORDS) {
      // 第一项就超长 = `--no` 后面直接接了正文:只认第一个词,其余还给正文
      if (!items.length) { items.push(words[0]); end = wordEnds[0]; }
      break;
    }
    items.push(words.join(' '));
    end = q;
    NO_COMMA_RE.lastIndex = q;
    if (!NO_COMMA_RE.exec(s)) break;
    p = NO_COMMA_RE.lastIndex;
  }
  return [items.join(', '), end];
}

function parseSegments(prompt: string): MjSegment[] {
  const segs: MjSegment[] = [];
  let cursor = 0;
  PARAM_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = PARAM_RE.exec(prompt))) {
    const start = m.index + m[1].length;
    segs.push({ text: prompt.slice(cursor, start) });
    const raw = m[2].toLowerCase();
    let pos = start + 2 + m[2].length;
    let value = '';
    if (raw === 'no') [value, pos] = readNoList(prompt, pos);
    else if (VALUE_PARAMS.has(raw) || OPTIONAL_VALUE_PARAMS.has(raw)) {
      [value, pos] = readValue(prompt, pos, OPTIONAL_VALUE_PARAMS.has(raw));
    }
    segs.push({ param: { name: PARAM_ALIASES[raw] || raw, value } });
    cursor = pos;
    PARAM_RE.lastIndex = pos;
  }
  segs.push({ text: prompt.slice(cursor) });
  return segs;
}

/** 在拿掉参数的地方把两段正文接上:空白归一,标点贴前文,不留「, .」这种残渣 */
function joinAt(left: string, right: string): string {
  let l = left.replace(/[ \t]+$/, '');
  const r = right.replace(/^[ \t]+/, '');
  if (!l) return r;
  if (!r) return l;
  if (/^[,.;:!?]/.test(r)) {
    if (/[,;:]$/.test(l)) l = l.slice(0, -1);
    return l + r;
  }
  if (r.startsWith('\n') || l.endsWith('\n')) return l + r;
  return `${l} ${r}`;
}

const tidy = (s: string) => s.trim().replace(/^[,.;:]+\s*/, '');

const hasMjSyntax = (s: string) => /(^|\s)--[a-z]/i.test(s);

/** 把提示词拆成正文与参数(参数按出现顺序,别名已归一)。正文里拿掉参数的地方已接好。 */
export function splitMjParams(prompt: string): { text: string; params: MjParam[] } {
  const segs = parseSegments(prompt);
  const params = segs.flatMap((s) => ('param' in s ? [s.param] : []));
  const text = tidy(segs.flatMap((s) => ('text' in s ? [s.text] : [])).reduce(joinAt, ''));
  return { text, params };
}

/**
 * 带小数的画幅换成整数比:官方 Aspect Ratio 页「--ar cannot contain decimals.
 * Use 139:100 instead of 1.39:1.」—— `2.35:1` 发出去是无效参数。
 */
export function mjAspect(ratio: string): string {
  const m = /^(\d+(?:\.\d+)?):(\d+(?:\.\d+)?)$/.exec(ratio.trim());
  if (!m || !ratio.includes('.')) return ratio.trim();
  const decimals = Math.max(...[m[1], m[2]].map((x) => (x.split('.')[1] || '').length));
  const scale = 10 ** decimals;
  let a = Math.round(parseFloat(m[1]) * scale);
  let b = Math.round(parseFloat(m[2]) * scale);
  const gcd = (x: number, y: number): number => (y ? gcd(y, x % y) : x);
  const g = gcd(a, b) || 1;
  a /= g;
  b /= g;
  return `${a}:${b}`;
}

/** 同名参数只留最后出现的那个;`--no` 各项合并成官方写法的一个列表(去重、保序) */
function mergeMjParams(params: MjParam[]): MjParam[] {
  const merged = new Map<string, MjParam>();
  const noItems: string[] = [];
  for (const p of params) {
    if (p.name === 'no') {
      for (const it of p.value.split(/\s*,\s*/)) {
        if (it && !noItems.some((x) => x.toLowerCase() === it.toLowerCase())) noItems.push(it);
      }
      if (!merged.has('no')) merged.set('no', p);
      continue;
    }
    // 缺值的带值参数(如 `--s` 后面直接是句号)原样发出去只会是无效参数
    if (VALUE_PARAMS.has(p.name) && !p.value) continue;
    merged.delete(p.name);
    merged.set(p.name, p);
  }
  const hasRef = (n: string) => merged.has(n);
  return [...merged.values()].flatMap((p) => {
    if (p.name === 'no') return noItems.length ? [{ name: 'no', value: noItems.join(', ') }] : [];
    // 只有权重没有参考图的 `--cw` / `--ow` 没有意义(旧分镜模板写死过 `--cw 90`)
    if (p.name === 'cw' && !hasRef('cref')) return [];
    if (p.name === 'ow' && !hasRef('oref')) return [];
    return [p];
  });
}

function renderMjParam(p: MjParam): string {
  if (!p.value) return `--${p.name}`;
  return `--${p.name} ${p.name === 'ar' ? mjAspect(p.value) : p.value}`;
}

/**
 * MJ 出口:正文在前,参数全部在末尾、每个只出现一次。
 * 请求里给了的(画幅、参考图、版本、风格)以请求为准,正文里的同名参数丢掉 ——
 * 所以无论正文从哪来(模板、库里存的旧提示词、用户手改),最终只有一个 `--ar`,且等于请求画幅。
 */
export function assembleMjPrompt(prompt: string, input: MjParamInput): string {
  const version = input.version || mjVersion();
  const tail = buildMjParams({ ...input, version });
  const { text, params } = splitMjParams(prompt);
  const owned = new Set<string>(['v']);
  if (input.aspectRatio) owned.add('ar');
  if (input.sref) owned.add('sref');
  if (input.style) owned.add('style');
  // 请求给了角色参考:两套写法(V6 cref/cw、V7 oref/ow)都归请求,正文里的不留
  if (input.cref) for (const n of ['cref', 'cw', 'oref', 'ow']) owned.add(n);
  const body = mergeMjParams(params.filter((p) => !owned.has(p.name))).map(renderMjParam);
  return [text, ...body].filter(Boolean).join(' ') + tail;
}

/**
 * 非 MJ 引擎出口:去掉 MJ 参数语法。画幅以请求字段为准(正文里的 `--ar` 直接删),
 * `--s` / `--v` / `--cw` / 参考图 URL 等 MJ 调参删掉;`--no X` 改写成普通文字 `no X` 留在原处。
 * 没有 MJ 语法的提示词逐字不变。
 */
export function toPlainPrompt(prompt: string): string {
  if (!hasMjSyntax(prompt)) return prompt;
  const pieces = parseSegments(prompt).map((s) => {
    if ('text' in s) return s.text;
    if (s.param.name !== 'no' || !s.param.value) return '';
    return `, no ${s.param.value.split(/\s*,\s*/).join(', no ')}`;
  });
  return tidy(pieces.reduce(joinAt, ''));
}
