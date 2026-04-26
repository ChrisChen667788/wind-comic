/**
 * 润色结果 JSON 解析 —— 三级降级工具。
 *
 * 抽离自 app/api/polish-script/route.ts, 独立成 lib 模块原因:
 *   1. 纯函数逻辑, 易测 (对应 tests/polish-parser.test.ts)
 *   2. 未来 Editor 评分 / Writer 输出等其他环节若遇到同类"LLM JSON 结构损坏"场景可以直接复用
 *
 * 为什么需要这个:
 *   第三方聚合网关(qingyuntop 等)对 response_format: json_object 执行不严,
 *   Claude / GPT 在包含中文长文本的字段里经常塞进真实换行符 (0x0A),
 *   直接 JSON.parse 会抛。按以下顺序兜底:
 *     Tier 1: strict JSON.parse
 *     Tier 2: 去 markdown 围栏 + 取最外层 {...}, 再 strict
 *     Tier 3: 修复字符串内裸换行/制表符, 再 strict
 *     Tier 4: 正则硬抽 polished / summary / notes
 */

/**
 * 三级降级 JSON 解析。
 * 返回值里存在 polished(string)视为成功;全失败返回 null。
 */
export function robustJsonParse(raw: string): any | null {
  // ── Tier 1: 原样解析
  try {
    const v = JSON.parse(raw);
    if (v && typeof v === 'object') return v;
  } catch {}

  // ── Tier 2: 去掉 markdown 围栏 + 取最外层 {...}
  const cleaned = raw
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();
  const m = cleaned.match(/\{[\s\S]*\}/);
  const candidate = m ? m[0] : cleaned;
  try {
    const v = JSON.parse(candidate);
    if (v && typeof v === 'object') return v;
  } catch {}

  // ── Tier 3: 修复字符串内部的裸控制字符 (\n \r \t)
  try {
    const repaired = repairJsonStrings(candidate);
    const v = JSON.parse(repaired);
    if (v && typeof v === 'object') return v;
  } catch {}

  // ── Tier 4: 正则硬抽
  return extractFieldsByRegex(candidate);
}

/**
 * 扫一遍字符串, 跟踪是否在 JSON 字符串内部,
 * 遇到裸 \n \r \t 就替换成转义序列, 让 JSON.parse 能接受。
 */
export function repairJsonStrings(s: string): string {
  let out = '';
  let inString = false;
  let escaped = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (escaped) {
      out += c;
      escaped = false;
      continue;
    }
    if (c === '\\' && inString) {
      out += c;
      escaped = true;
      continue;
    }
    if (c === '"') {
      inString = !inString;
      out += c;
      continue;
    }
    if (inString) {
      if (c === '\n') { out += '\\n'; continue; }
      if (c === '\r') { out += '\\r'; continue; }
      if (c === '\t') { out += '\\t'; continue; }
    }
    out += c;
  }
  return out;
}

/**
 * 最后一道防线: 结构彻底坏掉时, 正则抽 polished / summary / notes。
 */
export function extractFieldsByRegex(s: string): any | null {
  const result: any = {};
  const pm = s.match(/"polished"\s*:\s*"((?:\\.|[^"\\])*)"/);
  if (pm) {
    try {
      result.polished = JSON.parse('"' + pm[1] + '"');
    } catch {
      result.polished = pm[1].replace(/\\n/g, '\n').replace(/\\"/g, '"').replace(/\\\\/g, '\\');
    }
  }
  const sm = s.match(/"summary"\s*:\s*"((?:\\.|[^"\\])*)"/);
  if (sm) {
    try { result.summary = JSON.parse('"' + sm[1] + '"'); }
    catch { result.summary = sm[1].replace(/\\n/g, '\n').replace(/\\"/g, '"'); }
  }
  const nm = s.match(/"notes"\s*:\s*(\[[\s\S]*?\])/);
  if (nm) {
    try {
      const arr = JSON.parse(nm[1]);
      if (Array.isArray(arr)) result.notes = arr;
    } catch {}
  }
  return result.polished ? result : null;
}

/**
 * 彻底解析失败时, 把 JSON 外壳剥掉, 尽量给用户一段能读的正文,
 * 而不是 {"polished":"..."} 的 raw 字符串。
 */
export function stripJsonWrapper(raw: string): string {
  const pm = raw.match(/"polished"\s*:\s*"((?:\\.|[^"\\])*)"/);
  if (pm) {
    try { return JSON.parse('"' + pm[1] + '"'); }
    catch { return pm[1].replace(/\\n/g, '\n').replace(/\\"/g, '"').replace(/\\\\/g, '\\'); }
  }
  return raw
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .replace(/^\s*\{\s*/, '')
    .replace(/\s*\}\s*$/, '')
    .trim();
}
