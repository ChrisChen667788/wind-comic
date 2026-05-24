/**
 * v6.2 — 长篇智能拆解 + 叙事模式 (Story Intake) · 纯逻辑核心 (client-safe, 可单测)
 *
 * 对标 万镜一刻「智能解析模式」(长篇小说自动拆解分集) + 叙事模式 (对白/第一人称/旁白).
 * 这里做确定性拆分 (优先认章节标记, 否则按长度打包) + 叙事模式定义 (注入剧本生成的指令
 * + TTS/字幕提示). LLM 增强拆分 (按情节高潮分集) 可后续叠加; 本核心无网络/DB, 便于测试.
 */

// ──────────────────────────────────────────────────────────────────────
// 1) 长篇 → 分集
// ──────────────────────────────────────────────────────────────────────

export interface Episode {
  /** 1-based 集号 */
  index: number;
  title: string;
  text: string;
  charCount: number;
}

export interface SplitOptions {
  /** 单集目标字数 (无章节标记时按此打包) */
  targetChars?: number;
  /** 最大集数 (仅对"按长度打包"生效; 章节标记优先) */
  maxEpisodes?: number;
  /** 末集过短则并入上一集的阈值 */
  minChars?: number;
}

export const DEFAULT_TARGET_CHARS = 2000;

// 章节/集 标记行: 第X章/回/集/节/幕 · Chapter/Episode/Part N · markdown 标题
const MARKER_RE = /^[ \t]*(?:第\s*[0-9０-９一二三四五六七八九十百千两]+\s*[章回集节幕][^\n]*|(?:chapter|episode|ep|part)\s+\d+[^\n]*|#{1,3}\s+\S[^\n]*)$/gim;

function cap(s: string, n: number): string {
  const t = s.replace(/^#{1,3}\s+/, '').trim();
  return t.length > n ? t.slice(0, n) : t;
}

function reindex(eps: Episode[]): Episode[] {
  return eps.map((e, i) => ({ ...e, index: i + 1, charCount: e.text.length }));
}

/** 把文本切成"单元": 段落 > 行 > 句子 (逐级降级, 保证长无换行文本也能切). */
function toUnits(text: string): string[] {
  const paras = text.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
  if (paras.length > 1) return paras;
  const lines = text.split(/\n/).map((l) => l.trim()).filter(Boolean);
  if (lines.length > 1) return lines;
  // 单段长文 → 按句末标点切
  const sents = text.split(/(?<=[。!?！？.])\s*/).map((s) => s.trim()).filter(Boolean);
  return sents.length > 1 ? sents : [text.trim()].filter(Boolean);
}

/**
 * 长篇文本 → 分集. 优先认章节标记 (≥2 个才算); 否则按目标字数贪心打包.
 */
export function splitIntoEpisodes(text: string, opts: SplitOptions = {}): Episode[] {
  const src = (text || '').trim();
  if (!src) return [];

  // ── 路径 A: 有显式章节标记 ──
  const markers = [...src.matchAll(MARKER_RE)];
  if (markers.length >= 2) {
    const eps: Episode[] = [];
    const pre = src.slice(0, markers[0].index ?? 0).trim();
    if (pre.length >= 80) eps.push({ index: 0, title: '开篇', text: pre, charCount: pre.length });
    for (let i = 0; i < markers.length; i++) {
      const start = markers[i].index ?? 0;
      const end = i + 1 < markers.length ? (markers[i + 1].index ?? src.length) : src.length;
      const seg = src.slice(start, end).trim();
      if (!seg) continue;
      const firstLine = seg.split('\n')[0];
      eps.push({ index: 0, title: cap(firstLine, 40) || `第${eps.length + 1}集`, text: seg, charCount: seg.length });
    }
    return reindex(eps);
  }

  // ── 路径 B: 无标记, 按长度打包 ──
  let target = opts.targetChars ?? DEFAULT_TARGET_CHARS;
  if (opts.maxEpisodes && opts.maxEpisodes > 0) {
    target = Math.max(target, Math.ceil(src.length / opts.maxEpisodes));
  }
  const units = toUnits(src);
  const eps: Episode[] = [];
  let buf = '';
  for (const u of units) {
    if (buf && buf.length + u.length + 1 > target) {
      eps.push({ index: 0, title: `第${eps.length + 1}集`, text: buf, charCount: buf.length });
      buf = u;
    } else {
      buf = buf ? `${buf}\n${u}` : u;
    }
  }
  if (buf) eps.push({ index: 0, title: `第${eps.length + 1}集`, text: buf, charCount: buf.length });

  // 末集过短 → 并入上一集
  const minChars = opts.minChars ?? Math.floor(target * 0.3);
  if (eps.length > 1 && eps[eps.length - 1].charCount < minChars) {
    const last = eps.pop()!;
    eps[eps.length - 1].text += `\n${last.text}`;
  }
  return reindex(eps);
}

// ──────────────────────────────────────────────────────────────────────
// 2) 叙事模式
// ──────────────────────────────────────────────────────────────────────

export type NarrationMode = 'dialogue' | 'first_person' | 'narrator';

export interface NarrationModeDef {
  id: NarrationMode;
  label: string;
  description: string;
  /** 注入剧本/分镜生成的指令 */
  directive: string;
  /** 解说/旁白由谁的声音念 (映射 tts 角色) */
  ttsRole: 'character' | 'protagonist' | 'narrator';
  /** 是否额外生成一条解说音轨 (走 tts-prosody + subtitle-burn) */
  generatesNarrationTrack: boolean;
}

export const NARRATION_MODES: NarrationModeDef[] = [
  {
    id: 'dialogue',
    label: '对白驱动',
    description: '以角色对白推进剧情,旁白最少',
    directive: '以角色对白为主推进剧情,尽量减少旁白;每个镜头优先展现对话与动作。',
    ttsRole: 'character',
    generatesNarrationTrack: false,
  },
  {
    id: 'first_person',
    label: '第一人称解说',
    description: '主角第一人称口吻串场解说',
    directive: '用主角第一人称("我")口吻做串场解说,解说与对白交替,增强代入感。',
    ttsRole: 'protagonist',
    generatesNarrationTrack: true,
  },
  {
    id: 'narrator',
    label: '第三人称旁白',
    description: '全知旁白讲述,适合快节奏短剧',
    directive: '用第三人称全知旁白讲述剧情进展,旁白简洁有力,适配快节奏短剧。',
    ttsRole: 'narrator',
    generatesNarrationTrack: true,
  },
];

export const DEFAULT_NARRATION: NarrationMode = 'dialogue';

/** 取叙事模式定义 (未知 id 兜底对白驱动). */
export function getNarrationMode(id: string | null | undefined): NarrationModeDef {
  return NARRATION_MODES.find((m) => m.id === id) ?? NARRATION_MODES[0];
}

/** 取注入剧本生成的叙事指令. */
export function buildNarrationDirective(id: string | null | undefined): string {
  return getNarrationMode(id).directive;
}
