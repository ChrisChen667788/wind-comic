/**
 * lib/edit-style (v12.0.4) — 一句指令调剪辑风格(阶段二十 A 收官,BYO)。
 *
 * 用户一句话(「快节奏燃向」/「慢叙抒情」/「像短视频爆款」)→ 风格参数,调制 v12.0.1–.3
 * 的确定性剪辑管线(情绪压缩力度 + 转场软硬偏置)。对标 CutClaw「一句指令调风格」。
 *
 * 两层(BYO 哲学):
 *   - 规则层(零配置):关键词字典 → 快/慢/中速,任何时候可跑。
 *   - LLM 层(可选):配 LLM key 时把自由文本(「王家卫式」「抖音卡点」)映射成风格参数,
 *     失败/无 key → 回退规则层。
 * 纯函数部分可单测;LLM 部分失败安全降级。
 */

export interface EditStyle {
  pace: 'fast' | 'medium' | 'slow';
  /** 情绪压缩力度倍率:fast 压更狠(1.4)、slow 压更轻(0.5)、medium 1.0 */
  compressionBias: number;
  /** 转场软硬偏置:-1(全软:dissolve/fade)~ +1(全硬:cut),0 中性 */
  cutBias: number;
  label: string;
  source: 'rule' | 'llm' | 'default';
}

export const DEFAULT_EDIT_STYLE: EditStyle = { pace: 'medium', compressionBias: 1.0, cutBias: 0, label: '默认(中速)', source: 'default' };
const FAST: EditStyle = { pace: 'fast', compressionBias: 1.4, cutBias: 0.6, label: '快节奏燃向', source: 'rule' };
const SLOW: EditStyle = { pace: 'slow', compressionBias: 0.5, cutBias: -0.6, label: '慢叙抒情', source: 'rule' };
const MEDIUM: EditStyle = { pace: 'medium', compressionBias: 1.0, cutBias: 0, label: '中速', source: 'rule' };

const FAST_WORDS = ['快', '燃', '爽', '热血', '紧凑', '卡点', '动感', '炸', '激烈', '打斗', '追逐', '高能', '爆款', '抖音', '鬼畜', 'mv', 'rush', 'fast'];
const SLOW_WORDS = ['慢', '抒情', '舒缓', '文艺', '治愈', '唯美', '温柔', '沉静', '空镜', '留白', '安静', '悠长', '王家卫', '诗意', 'slow'];

/** 规则解析(确定性):关键词命中多者胜;无命中/空 → 默认中速。 */
export function resolveEditStyleRule(instruction?: string): EditStyle {
  const t = (instruction || '').toLowerCase();
  if (!t.trim()) return DEFAULT_EDIT_STYLE;
  const fast = FAST_WORDS.filter((w) => t.includes(w)).length;
  const slow = SLOW_WORDS.filter((w) => t.includes(w)).length;
  if (fast > slow) return FAST;
  if (slow > fast) return SLOW;
  return MEDIUM;
}

/** clamp 风格参数到合法区间(LLM 输出守卫)。 */
function sanitize(raw: any, instruction: string): EditStyle | null {
  if (!raw || typeof raw !== 'object') return null;
  const pace = ['fast', 'medium', 'slow'].includes(raw.pace) ? raw.pace : null;
  if (!pace) return null;
  const cb = typeof raw.compressionBias === 'number' && Number.isFinite(raw.compressionBias)
    ? Math.max(0.4, Math.min(1.6, raw.compressionBias)) : (pace === 'fast' ? 1.4 : pace === 'slow' ? 0.5 : 1.0);
  const cut = typeof raw.cutBias === 'number' && Number.isFinite(raw.cutBias)
    ? Math.max(-1, Math.min(1, raw.cutBias)) : (pace === 'fast' ? 0.6 : pace === 'slow' ? -0.6 : 0);
  const label = typeof raw.label === 'string' && raw.label.trim() ? raw.label.trim().slice(0, 24) : `${pace}`;
  return { pace, compressionBias: cb, cutBias: cut, label, source: 'llm' };
}

/**
 * 解析剪辑风格:配 LLM key + 非 MOCK → 让 LLM 把自由文本映射成风格参数(白名单 sanitize),
 * 失败/无 key/MOCK → 回退规则层。纯文本指令,无副作用风险。
 */
export async function resolveEditStyle(instruction?: string): Promise<EditStyle> {
  const text = (instruction || '').trim();
  if (!text) return DEFAULT_EDIT_STYLE;
  const rule = resolveEditStyleRule(text);
  try {
    const { API_CONFIG } = await import('./config');
    const key = API_CONFIG.openai.apiKey;
    if (!key || key.startsWith('your_') || process.env.MOCK_ENGINES === '1') return rule;
    const { callLLMWithFallback } = await import('./llm-client');
    const res = await callLLMWithFallback({
      system:
        '你把用户的剪辑风格指令映射成参数。只输出 JSON:{"pace":"fast|medium|slow","compressionBias":0.4-1.6(快剪>1压更狠/慢叙<1),"cutBias":-1到1(正=硬切多/负=叠化柔),"label":"风格中文短名"}。',
      user: text,
      jsonMode: true, maxTokens: 200, timeoutMs: 15_000,
    });
    if (!res.ok || !res.content) return rule;
    const parsed = sanitize(JSON.parse(res.content), text);
    return parsed || rule;
  } catch {
    return rule;
  }
}
