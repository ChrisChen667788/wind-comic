/**
 * 阶段二十九 v12.33.0 — 九宫格候选帧「变异引擎」(纯函数,可单测)。
 *
 * 调研里反复出现、用户点名喜欢的设计:一镜先出 N 个候选关键帧 → 网格对比一眼挑最优 →
 * 选中帧作首帧 seed 去生成视频。把 AI 随机性从「碰运气」变「筛选池」,直接降废片率 + 省 API 钱。
 *
 * 本模块只管「怎么让 N 个候选有意义地不同」+ 网格排布 + 选定校验;真正的图生/落库在 endpoint 层。
 * 变异思路:不改内容,只在**构图/机位/景别**上给每格一个不同取向(导演挑「读法」最好的那张),
 * 并各给一个确定性 seed(同输入同输出,可复现、可缓存)。
 */

export type CandidateCount = 4 | 6 | 9;

/** 9 个构图/机位取向(英文片段进 prompt;中文 label 给 UI)。按视觉差异度排序,取前 N 个。 */
export const CANDIDATE_VARIANTS: Array<{ label: string; fragment: string }> = [
  { label: '三分法·左', fragment: 'rule-of-thirds composition, subject on the left third' },
  { label: '中心对称', fragment: 'centered symmetrical composition' },
  { label: '低角度英雄', fragment: 'dramatic low-angle hero shot looking up' },
  { label: '过肩', fragment: 'over-the-shoulder framing' },
  { label: '大远景', fragment: 'wide establishing shot, environment dominant' },
  { label: '情绪特写', fragment: 'tight emotional close-up' },
  { label: '荷兰角', fragment: 'subtle dutch-tilt dynamic angle' },
  { label: '右留白', fragment: 'strong negative space on the right' },
  { label: '框中框', fragment: 'frame-within-a-frame composition' },
];

export interface CandidateFrame {
  id: string;            // cand-1 .. cand-N(稳定 id)
  index: number;         // 0-based
  variantLabel: string;  // 中文取向名(UI 展示)
  prompt: string;        // basePrompt + 该取向片段(送图生)
  seed: number;          // 确定性 seed(可复现/可缓存)
  imageUrl?: string;     // 生成后回填
}

/** 把候选数夹到允许档(4/6/9);非法/缺省 → 9(九宫格)。 */
export function clampCandidateCount(n?: number): CandidateCount {
  if (n === 4 || n === 6 || n === 9) return n;
  if (typeof n === 'number') {
    if (n <= 4) return 4;
    if (n <= 6) return 6;
  }
  return 9;
}

/** N → 网格行列(9→3×3,6→3×2,4→2×2;通用回退 cols=ceil(√N))。 */
export function gridDimensions(n: number): { cols: number; rows: number } {
  if (n === 9) return { cols: 3, rows: 3 };
  if (n === 6) return { cols: 3, rows: 2 };
  if (n === 4) return { cols: 2, rows: 2 };
  const cols = Math.max(1, Math.ceil(Math.sqrt(Math.max(1, n))));
  return { cols, rows: Math.ceil(Math.max(1, n) / cols) };
}

/** 确定性 seed:从 basePrompt 派生一个稳定基数(djb2),+ 索引 → 每格不同但可复现。 */
function hashSeed(s: string): number {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
  return h % 1_000_000;
}

export interface BuildCandidatesOptions {
  count?: number;       // 目标候选数(夹到 4/6/9)
  baseSeed?: number;    // 显式基数(不给则从 prompt 派生)
}

/**
 * 纯函数:给一个镜头的基础 prompt 生成 N 个**构图各异**的候选请求。确定性、可复现。
 */
export function buildCandidatePrompts(basePrompt: string, opts: BuildCandidatesOptions = {}): CandidateFrame[] {
  const base = (basePrompt || '').trim();
  const n = clampCandidateCount(opts.count);
  const seed0 = typeof opts.baseSeed === 'number' && opts.baseSeed >= 0 ? Math.floor(opts.baseSeed) : hashSeed(base || 'candidate');
  const out: CandidateFrame[] = [];
  for (let i = 0; i < n; i++) {
    const v = CANDIDATE_VARIANTS[i % CANDIDATE_VARIANTS.length];
    const prompt = base ? `${base}, ${v.fragment}` : v.fragment;
    out.push({ id: `cand-${i + 1}`, index: i, variantLabel: v.label, prompt, seed: (seed0 + i * 7919) % 1_000_000 });
  }
  return out;
}

/** 选定校验:返回被选候选;非法 id → throw(供 endpoint 做 400)。 */
export function validatePick(candidates: Pick<CandidateFrame, 'id'>[], pickedId: string): void {
  if (!candidates.some((c) => c.id === pickedId)) {
    throw new Error(`无效候选 id: ${pickedId}(可选:${candidates.map((c) => c.id).join(', ')})`);
  }
}
