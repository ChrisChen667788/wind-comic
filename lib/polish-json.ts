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
 * 多级降级 JSON 解析。
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

  // ── v2.13.2 Tier 2.5: 把全角"中文引号"先还原成 ASCII (LLM 经常混着用)
  // 注意只替换"出现在 ASCII " 之间"的全角引号 — 别把内嵌正文里真实的"说"字号给误改
  const dequoted = candidate
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'");
  try {
    const v = JSON.parse(dequoted);
    if (v && typeof v === 'object') return v;
  } catch {}

  // ── Tier 3: 修复字符串内部的裸控制字符 (\n \r \t) — 在 dequoted 基础上做
  try {
    const repaired = repairJsonStrings(dequoted);
    const v = JSON.parse(repaired);
    if (v && typeof v === 'object') return v;
  } catch {}

  // ── v2.13.2 Tier 3.5: 兜底用平衡-括号扫描更稳的截取
  const fixed = repairJsonStrings(dequoted);
  try {
    // 从第一个 { 开始扫直到平衡, 截到第一个完整对象
    const sliced = sliceFirstBalancedObject(fixed);
    if (sliced) {
      const v = JSON.parse(sliced);
      if (v && typeof v === 'object') return v;
    }
  } catch {}

  // ── Tier 4: 正则硬抽
  return extractFieldsByRegex(candidate);
}

/**
 * 从字符串中找到第一个完整平衡的 {...} 对象,返回该对象的子串。
 * 字符串内部的 { } 不计入栈, 用引号状态跟踪。
 */
export function sliceFirstBalancedObject(s: string): string | null {
  const start = s.indexOf('{');
  if (start === -1) return null;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < s.length; i++) {
    const c = s[i];
    if (escaped) { escaped = false; continue; }
    if (c === '\\' && inString) { escaped = true; continue; }
    if (c === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (c === '{') depth++;
    else if (c === '}') {
      depth--;
      if (depth === 0) return s.slice(start, i + 1);
    }
  }
  return null;
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
 *
 * v2.13.2 增强: 普通 regex 命中时如果 polished 长度过短(< 30 字符,
 * 八成是被中间某个未转义引号截断了), 改用"贪婪截到下一个根字段或对象末"的策略。
 */
export function extractFieldsByRegex(s: string): any | null {
  const result: any = {};

  // 1. 先尝试严格解析 polished 字段
  const pm = s.match(/"polished"\s*:\s*"((?:\\.|[^"\\])*)"/);
  if (pm) {
    try {
      result.polished = JSON.parse('"' + pm[1] + '"');
    } catch {
      result.polished = pm[1].replace(/\\n/g, '\n').replace(/\\"/g, '"').replace(/\\\\/g, '\\');
    }
  }

  // 2. 严格匹配命中但太短(疑似被未转义引号腰斩) → 用贪婪兜底
  // 寻找 "polished":" 起点, 一直读到下一个 ", "summary": / "notes": / "issues": / 对象末 } 之前
  if (!result.polished || result.polished.length < 30) {
    const startIdx = s.search(/"polished"\s*:\s*"/);
    if (startIdx >= 0) {
      const headMatch = s.slice(startIdx).match(/"polished"\s*:\s*"/);
      if (headMatch) {
        const valStart = startIdx + (headMatch.index ?? 0) + headMatch[0].length;
        // 找下一个根字段开头 (",\s*"summary" / "notes" / "issues" / "audit")
        const tailRegex = /",\s*"(?:summary|notes|issues|audit|polishedTitle|industry)"\s*:/;
        const tailMatch = s.slice(valStart).match(tailRegex);
        const valEnd = tailMatch && tailMatch.index !== undefined
          ? valStart + tailMatch.index
          : s.lastIndexOf('"', s.lastIndexOf('}'));
        if (valEnd > valStart) {
          const greedy = s.slice(valStart, valEnd);
          // 解码常见转义并尽力清理无终止引号导致的尾部杂质
          const decoded = greedy
            .replace(/\\n/g, '\n')
            .replace(/\\r/g, '\r')
            .replace(/\\t/g, '\t')
            .replace(/\\"/g, '"')
            .replace(/\\\\/g, '\\');
          if (decoded.length > (result.polished?.length || 0)) {
            result.polished = decoded;
            result._greedyFallback = true; // 给上层标记"是贪婪兜底,提示用户检查"
          }
        }
      }
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
