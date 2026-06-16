/**
 * lib/language-detect (v12.6.1 · #2) — 目标语种检测 + 贯穿生成的语种约束。
 *
 * 用户反馈:生成前要按输入语种限制语种(避免台词/旁白语种漂移或中英混杂)。
 * 这里从用户创意文本自动判语种,贯穿:Writer 台词/旁白/场景描述 + TTS 声音 + 口型 + 字幕。
 * visualPrompt 仍保持英文 —— 它喂视频引擎(英文 prompt 引擎质量最佳),不属「内容语种」。
 */
export type TargetLanguage = 'zh' | 'en';

/** 从创意文本判主语种:几乎纯拉丁→en,含相当量 CJK→zh(漫剧默认 zh)。 */
export function detectLanguage(text: string | null | undefined): TargetLanguage {
  if (!text) return 'zh';
  const cjk = (text.match(/[一-鿿぀-ヿ가-힯]/g) || []).length;
  const latin = (text.match(/[a-zA-Z]/g) || []).length;
  if (cjk === 0 && latin > 0) return 'en';      // 纯拉丁 → 英文
  if (cjk === 0 && latin === 0) return 'zh';     // 无字母(纯标点/数字)→ 默认中文
  // CJK 信息密度高:CJK 字数 ×4 ≥ 拉丁字母数 即判中文(容忍少量英文品牌名/术语)
  return cjk * 4 >= latin ? 'zh' : 'en';
}

/** TTS 语种码(minimax / openai 兼容)。 */
export function ttsLangCode(lang: TargetLanguage): string {
  return lang === 'en' ? 'en-US' : 'zh-CN';
}

/** 口型对齐语种码。 */
export function lipsyncLangCode(lang: TargetLanguage): 'zh' | 'en' {
  return lang === 'en' ? 'en' : 'zh';
}

export function languageDisplayName(lang: TargetLanguage): string {
  return lang === 'en' ? 'English' : '简体中文';
}

/** 注入 Writer prompt 的语种铁律块 —— 锁台词/旁白/场景描述语种,visualPrompt 仍英文。 */
export function buildLanguageDirective(lang: TargetLanguage): string {
  if (lang === 'en') {
    return `

## 🌐 OUTPUT LANGUAGE = ENGLISH (hard rule)
All \`dialogue\`, narration, \`sceneDescription\`, \`subtext\`, \`action\` and any on-screen text MUST be natural English. Do NOT output Chinese in these fields.
Exception: \`visualPrompt\` and \`beats[].action\`/\`camera\` stay English as usual (they feed the video engine).`;
  }
  return `

## 🌐 输出语种 = 简体中文(铁律)
所有 \`dialogue\` / 旁白 / \`sceneDescription\` / \`subtext\` / \`action\` / 屏幕文字必须用简体中文,**不要混入整句英文**。
例外:\`visualPrompt\` 仍用英文(喂视频引擎);\`beats[].action\`/\`camera\` 也用英文。`;
}
