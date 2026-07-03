/**
 * 广告合规检查(v12.65.0)——《广告法》绝对化用语 + 虚假承诺红线。
 *
 * 电商/广告成片里「最/第一/顶级/国家级/根治」等词是硬红线:平台(抖音/小红书/淘宝)审核会拒,
 * 市监还可罚款(《广告法》第九条)。AI 编剧极易顺嘴写出「最好用的精华水」。本模块:
 *   - checkAdCompliance(text) → 命中的违禁词 + 类别(检测,报告用)
 *   - sanitizeAdCopy(text)   → 自动替换成安全表达(台词/字幕/CTA 落地前过一遍)
 * 纯函数,零依赖,可单测。词表按「绝对化 / 极限承诺 / 医疗化妆品红线」分组,替换词保语感。
 */

export interface ComplianceHit {
  word: string;
  category: '绝对化用语' | '极限承诺' | '医疗功效红线';
  replacement: string;
  index: number;
}

/** 违禁词 → 安全替换(顺序即优先级,长词在前防子串误替)。 */
const RULES: Array<{ re: RegExp; word: string; category: ComplianceHit['category']; replacement: string }> = [
  // ── 绝对化用语(广告法第九条)──
  { re: /最好用/g, word: '最好用', category: '绝对化用语', replacement: '很好用' },
  { re: /最强/g, word: '最强', category: '绝对化用语', replacement: '出色' },
  { re: /最佳/g, word: '最佳', category: '绝对化用语', replacement: '优选' },
  { re: /最先进/g, word: '最先进', category: '绝对化用语', replacement: '先进' },
  { re: /最优/g, word: '最优', category: '绝对化用语', replacement: '优质' },
  { re: /第一品牌/g, word: '第一品牌', category: '绝对化用语', replacement: '人气品牌' },
  { re: /全网第一/g, word: '全网第一', category: '绝对化用语', replacement: '全网热销' },
  { re: /销量第一/g, word: '销量第一', category: '绝对化用语', replacement: '销量领先' },
  { re: /行业第一/g, word: '行业第一', category: '绝对化用语', replacement: '行业领先' },
  { re: /世界级/g, word: '世界级', category: '绝对化用语', replacement: '高水准' },
  { re: /国家级/g, word: '国家级', category: '绝对化用语', replacement: '高规格' },
  { re: /顶级/g, word: '顶级', category: '绝对化用语', replacement: '高端' },
  { re: /极品/g, word: '极品', category: '绝对化用语', replacement: '精品' },
  { re: /独一无二/g, word: '独一无二', category: '绝对化用语', replacement: '独具特色' },
  { re: /空前绝后/g, word: '空前绝后', category: '绝对化用语', replacement: '难得一见' },
  // ── 极限承诺 ──
  { re: /百分之百|100%有效/g, word: '百分之百', category: '极限承诺', replacement: '高效' },
  { re: /永不(反弹|复发|褪色)/g, word: '永不…', category: '极限承诺', replacement: '持久' },
  { re: /立竿见影/g, word: '立竿见影', category: '极限承诺', replacement: '见效快' },
  { re: /(无效)?全额?退款保证/g, word: '退款保证', category: '极限承诺', replacement: '售后无忧' },
  // ── 医疗/化妆品功效红线(化妆品不得宣称医疗功效)──
  { re: /根治/g, word: '根治', category: '医疗功效红线', replacement: '改善' },
  { re: /治愈/g, word: '治愈', category: '医疗功效红线', replacement: '呵护' },
  { re: /治疗/g, word: '治疗', category: '医疗功效红线', replacement: '护理' },
  { re: /消炎/g, word: '消炎', category: '医疗功效红线', replacement: '舒缓' },
  { re: /杀菌/g, word: '杀菌', category: '医疗功效红线', replacement: '清洁' },
  { re: /抗癌|防癌/g, word: '抗癌', category: '医疗功效红线', replacement: '健康' },
];

/** 检测:返回全部命中(不修改文本)。 */
export function checkAdCompliance(text: string): ComplianceHit[] {
  const hits: ComplianceHit[] = [];
  if (!text) return hits;
  for (const r of RULES) {
    r.re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = r.re.exec(text)) !== null) {
      hits.push({ word: m[0], category: r.category, replacement: r.replacement, index: m.index });
      if (m.index === r.re.lastIndex) r.re.lastIndex++;
    }
  }
  return hits;
}

/** 净化:违禁词替换为安全表达。返回 {text, hits}。 */
export function sanitizeAdCopy(text: string): { text: string; hits: ComplianceHit[] } {
  const hits = checkAdCompliance(text);
  if (hits.length === 0) return { text, hits };
  let out = text;
  for (const r of RULES) {
    r.re.lastIndex = 0;
    out = out.replace(r.re, r.replacement);
  }
  return { text: out, hits };
}

/** 对剧本 shots 的台词逐镜净化(就地修改),返回命中汇总。 */
export function sanitizeScriptDialogues(shots: Array<{ dialogue?: string }>): ComplianceHit[] {
  const all: ComplianceHit[] = [];
  for (const s of shots || []) {
    if (!s?.dialogue) continue;
    const { text, hits } = sanitizeAdCopy(s.dialogue);
    if (hits.length > 0) {
      s.dialogue = text;
      all.push(...hits);
    }
  }
  return all;
}
