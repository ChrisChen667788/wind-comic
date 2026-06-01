/**
 * lib/cover-candidates (v9.1.3) — AI 竖屏封面候选: 提示词构建 + 主角推断 + 标题安全区几何.
 *
 * 按 片名 + 主角 + 画风 生成 N 张 9:16 封面候选的图像提示词 (3 种构图变体), 复用 MiniMax
 * image-01 (T2I, 768×1344) 出图。封面**不在图内渲染标题文字**(避免 AI 糊字, 沿用主管线"剥字"思路),
 * 标题由前端在「安全区」叠层预览 —— getTitleSafeArea() 给安全区几何 (相对百分比)。
 *
 * 纯函数, 单测 tests/v9-1-3-cover-candidates.test.ts。
 */

export const COVER_ASPECT = '9:16';

export interface CoverInput {
  title: string;
  protagonist?: string;
  style?: string;
  count?: number; // 默认 3, clamp 1-3
}

export interface CoverComposition {
  key: 'portrait' | 'dramatic' | 'symbolic';
  label: string; // 中文展示名
  prompt: string; // 完整英文图像提示 (含负向, 不画字)
}

/** 候选 = 构图 + 出图结果 (端点填 imageUrl / error)。 */
export interface CoverCandidate extends CoverComposition {
  imageUrl?: string;
  error?: string;
}

const COMPOSITIONS: Array<{ key: CoverComposition['key']; label: string; hint: string }> = [
  { key: 'portrait', label: '主角特写', hint: 'extreme close-up dramatic portrait of the {SUBJECT}, intense emotional expression, cinematic key light, shallow depth of field' },
  { key: 'dramatic', label: '冲突场面', hint: 'dynamic wide cinematic shot of the {SUBJECT} at the story’s central conflict, dramatic atmosphere, strong silhouette' },
  { key: 'symbolic', label: '意象象征', hint: 'symbolic poster of a single striking visual metaphor of the story featuring the {SUBJECT}, bold color blocking, moody lighting, centered subject' },
];

// 不在图内画任何文字 (标题前端叠层)。
const NEGATIVE = 'no text, no words, no letters, no chinese characters, no captions, no watermark, no logo';

/** 按 片名+主角+画风 产出 1-3 个构图变体的封面提示词。 */
export function buildCoverPrompts(input: CoverInput): CoverComposition[] {
  const count = Math.max(1, Math.min(3, Math.floor(input.count ?? 3)));
  const protagonist = (input.protagonist || '').trim();
  const style = (input.style || '').trim() || 'cinematic';
  const title = (input.title || '').trim();
  const subject = protagonist ? `protagonist ${protagonist}` : 'protagonist';

  return COMPOSITIONS.slice(0, count).map((c) => {
    const prompt = [
      `vertical 9:16 short-drama poster key art, ${style} style.`,
      c.hint.replace('{SUBJECT}', subject) + '.',
      title ? `mood evokes the story "${title}".` : '',
      'keep clean negative space in the top and bottom thirds for a title overlay; do NOT render any text in the image.',
      'ultra detailed, professional poster, high contrast, 4k.',
      `Negative: ${NEGATIVE}.`,
    ].filter(Boolean).join(' ');
    return { key: c.key, label: c.label, prompt };
  });
}

/**
 * 从分镜镜头推断主角 = 出现次数最多的角色名 (并列取首个出现的)。无角色 → ''。
 */
export function pickProtagonist(shots: Array<{ characters?: unknown }> | undefined): string {
  if (!Array.isArray(shots)) return '';
  const counts = new Map<string, number>();
  const order: string[] = [];
  for (const s of shots) {
    const chars = Array.isArray(s?.characters) ? s.characters : [];
    for (const raw of chars) {
      const name = typeof raw === 'string' ? raw.trim() : '';
      if (!name) continue;
      if (!counts.has(name)) order.push(name);
      counts.set(name, (counts.get(name) || 0) + 1);
    }
  }
  let best = '';
  let bestN = 0;
  for (const name of order) {
    const n = counts.get(name) || 0;
    if (n > bestN) { best = name; bestN = n; }
  }
  return best;
}

/**
 * 标题安全区 (9:16): 平台 UI (顶部状态栏 / 底部按钮区) 会遮挡边缘, 标题放中上"安全带"。
 * 返回相对封面的百分比矩形, 前端按此叠标题文字预览。
 */
export interface TitleSafeArea {
  topPct: number;
  leftPct: number;
  widthPct: number;
  heightPct: number;
}
export function getTitleSafeArea(): TitleSafeArea {
  // 顶部 12% 留给状态栏/留白; 标题带高 ~20%; 左右各留 8% 安全边。
  return { topPct: 12, leftPct: 8, widthPct: 84, heightPct: 20 };
}
