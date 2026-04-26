/**
 * 提示词过滤工具
 * 用于过滤可能触发 Midjourney 敏感词检测的内容
 */

// Midjourney 常见敏感词列表
const SENSITIVE_WORDS = [
  // 暴力相关
  'blood', 'gore', 'violence', 'weapon', 'gun', 'knife', 'sword', 'kill', 'death', 'dead',
  'murder', 'fight', 'battle', 'war', 'explosion', 'bomb',

  // 成人内容
  'nude', 'naked', 'sexy', 'erotic', 'adult', 'nsfw',

  // 政治敏感
  'political', 'protest', 'revolution',

  // 其他可能触发的词
  'horror', 'scary', 'terrifying', 'nightmare',
];

// 替换映射表
const WORD_REPLACEMENTS: Record<string, string> = {
  'blood': 'red liquid',
  'gore': 'dramatic scene',
  'violence': 'action',
  'weapon': 'tool',
  'gun': 'device',
  'knife': 'blade',
  'sword': 'blade',
  'kill': 'defeat',
  'death': 'end',
  'dead': 'still',
  'murder': 'conflict',
  'fight': 'confrontation',
  'battle': 'encounter',
  'war': 'conflict',
  'explosion': 'burst of light',
  'bomb': 'device',
  'horror': 'mysterious',
  'scary': 'mysterious',
  'terrifying': 'intense',
  'nightmare': 'dream',
};

/**
 * 过滤提示词中的敏感词
 */
export function filterSensitiveWords(prompt: string): string {
  let filtered = prompt;

  // 逐个替换敏感词
  for (const [word, replacement] of Object.entries(WORD_REPLACEMENTS)) {
    const regex = new RegExp(`\\b${word}\\b`, 'gi');
    filtered = filtered.replace(regex, replacement);
  }

  return filtered;
}

/**
 * 检测提示词是否包含敏感词
 */
export function hasSensitiveWords(prompt: string): boolean {
  const lowerPrompt = prompt.toLowerCase();
  return SENSITIVE_WORDS.some(word => {
    const regex = new RegExp(`\\b${word}\\b`, 'i');
    return regex.test(lowerPrompt);
  });
}

/**
 * 优化 Midjourney 提示词
 * - 过滤敏感词
 * - 添加安全的风格描述
 */
export function optimizeMidjourneyPrompt(prompt: string): string {
  // 1. 过滤敏感词
  let optimized = filterSensitiveWords(prompt);

  // 2. 添加安全的风格描述
  const safeStyles = [
    'cinematic lighting',
    'professional photography',
    'high quality',
    'detailed',
    'artistic',
  ];

  // 如果提示词中没有风格描述，添加一些
  if (!optimized.includes('style') && !optimized.includes('cinematic')) {
    optimized += `, ${safeStyles.join(', ')}`;
  }

  return optimized;
}
