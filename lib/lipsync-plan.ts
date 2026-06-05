/**
 * lib/lipsync-plan (v9.6.1) — 阶段十六 T1 配音口型:口型(viseme)关键帧轨 + 可对齐度评分。
 *
 * 缺口:已有 TTS prosody(`tts-prosody`)、对白覆盖(`dialogue-coverage`)、时间轴(`narration-timeline`),
 * 但**没有把台词落成口型时间轴**。本 lib 纯逻辑补上:
 *   1. `estimateSpeechSeconds(text, speed)` —— 从文本估语音时长(语速可调,复用 prosody.speed)。
 *   2. `planVisemes(line)` —— 把一句对白在其镜头时间窗里切成 viseme 关键帧(口型 + 张口量 0..1),
 *      供下游驱动嘴部动画 / 渲染器。**粗粒度、结构驱动**(无音素器,确定性,留真 phonemizer 后续细化)。
 *   3. `scoreLineAlignment(line)` —— 口型**可对齐度**:说话人是否在画面、景别够不够拍脸、台词时长是否溢出镜头窗。
 *   4. `buildLipSyncPlan(lines)` —— 聚合成 每句计划 + 整片就绪度(pass/warn/block,复用 quality-gate 词汇)+ 最弱句 + 提示。
 *
 * 与既有模块正交且融合:复用 prosody 语速、沿用 dialogue-coverage 的景别判定语义、套 quality-gate 的就绪度分级。
 * 纯函数、client 可直引。单测 tests/v9-6-1-lipsync-plan.test.ts。
 */

import type { ScriptShot } from '@/types/agents';
import { commonCharVowel, type MouthVowel } from './pinyin-viseme';

/** 紧凑 viseme 集(口型类):静默/闭嘴 · 双唇闭合(m/b/p)· 唇齿(f/v)· 五个元音开口形。 */
export type Viseme = 'sil' | 'MBP' | 'FV' | 'aa' | 'E' | 'I' | 'O' | 'U';

/** 各 viseme 的张口量(0 闭合 ~ 1 全开),驱动嘴部动画的 jaw-open 包络。 */
export const VISEME_OPENNESS: Record<Viseme, number> = {
  sil: 0, MBP: 0, FV: 0.15, aa: 1, E: 0.65, I: 0.4, O: 0.6, U: 0.45,
};

export interface VisemeKeyframe {
  /** 距本句起点的秒数 */
  t: number;
  viseme: Viseme;
  /** 张口量 0..1 */
  mouthOpen: number;
}

/** 一句对白的最小形状(API 层把 ScriptShot 映射成它,lib 保持纯)。 */
export interface DialogueLine {
  shotNumber: number;
  /** 说话人(约定 characters[0]) */
  speaker?: string;
  text: string;
  /** 该镜在成片时间轴上的起止(秒);缺省则用估时窗 [0, est] */
  startSec?: number;
  endSec?: number;
  /** 镜头景别文本(判断脸是否够大可对口型) */
  shotSize?: string;
  /** prosody 语速(影响时长),默认 1 */
  speed?: number;
  /** 该镜在场角色,用于判断说话人是否在画面 */
  onScreen?: string[];
}

const CJK = /[一-鿿㐀-䶿]/;
const LATIN_VOWEL: Record<string, Viseme> = { a: 'aa', e: 'E', i: 'I', o: 'O', u: 'U', y: 'I' };
/** 主元音 → viseme(CJK 音素器命中常用字时用)。 */
const VOWEL_TO_VISEME: Record<MouthVowel, Viseme> = { a: 'aa', o: 'O', e: 'E', i: 'I', u: 'U' };
/** CJK 未收录字 → 按码点确定性循环开口形(粗粒度兜底,非随机)。 */
const CJK_CYCLE: Viseme[] = ['aa', 'E', 'I', 'O', 'U'];

function charViseme(ch: string): Viseme | null {
  if (/\s/.test(ch)) return null;                 // 空白:跳过
  if (/[，。！？、；:,.!?;…—-]/.test(ch)) return 'sil'; // 标点:闭口停顿
  const lower = ch.toLowerCase();
  if (CJK.test(ch)) {
    const v = commonCharVowel(ch);                // v9.6.3 提保真:常用字 → 真主元音
    if (v) return VOWEL_TO_VISEME[v];
    return CJK_CYCLE[ch.charCodeAt(0) % CJK_CYCLE.length]; // 未收录字兜底
  }
  if (LATIN_VOWEL[lower]) return LATIN_VOWEL[lower];
  if ('mbp'.includes(lower)) return 'MBP';
  if ('fv'.includes(lower)) return 'FV';
  if (/[a-z]/.test(lower)) return 'sil';          // 其它辅音:近闭
  return null;
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const round2 = (n: number) => Math.round(n * 100) / 100;
const round3 = (n: number) => Math.round(n * 1000) / 1000;

/**
 * 估语音时长(秒)。CJK 约 4 字/秒、拉丁约按词 0.32s,标点加停顿;再除以语速。
 */
export function estimateSpeechSeconds(text: string, speed = 1): number {
  const t = (text || '').trim();
  if (!t) return 0;
  let sec = 0;
  let latinRun = 0;
  const flushLatin = () => { if (latinRun > 0) { sec += Math.max(1, Math.round(latinRun / 4)) * 0.32; latinRun = 0; } };
  for (const ch of t) {
    if (CJK.test(ch)) { flushLatin(); sec += 0.25; }
    else if (/[，。！？、；,.!?;…—]/.test(ch)) { flushLatin(); sec += 0.18; }
    else if (/\s/.test(ch)) { flushLatin(); }
    else { latinRun += 1; }
  }
  flushLatin();
  const sp = typeof speed === 'number' && speed > 0 ? speed : 1;
  return round2(Math.max(0.2, sec / sp));
}

/** 本句的时间窗 [start, end](秒)。给了 start/end 用之,否则用估时窗 [0, est]。 */
function lineWindow(line: DialogueLine): { start: number; end: number } {
  const est = estimateSpeechSeconds(line.text, line.speed);
  const hasStart = typeof line.startSec === 'number' && line.startSec >= 0;
  const hasEnd = typeof line.endSec === 'number' && line.endSec! > (line.startSec ?? 0);
  const start = hasStart ? line.startSec! : 0;
  const end = hasEnd ? line.endSec! : start + est;
  return { start, end: Math.max(start + 0.2, end) };
}

/**
 * 把一句对白切成 viseme 关键帧(距句起点的相对秒)。窗内按"发音单元"(非空白字符)均分,
 * 每单元落一帧(viseme + 张口量),句尾补一帧 `sil` 闭嘴。粗粒度但确定。
 */
export function planVisemes(line: DialogueLine): VisemeKeyframe[] {
  const { start, end } = lineWindow(line);
  const dur = end - start;
  const units: Viseme[] = [];
  for (const ch of (line.text || '')) {
    const v = charViseme(ch);
    if (v) units.push(v);
  }
  if (units.length === 0) return [{ t: 0, viseme: 'sil', mouthOpen: 0 }];
  const step = dur / units.length;
  const frames: VisemeKeyframe[] = units.map((v, i) => ({
    t: round3(i * step),
    viseme: v,
    mouthOpen: VISEME_OPENNESS[v],
  }));
  frames.push({ t: round3(dur), viseme: 'sil', mouthOpen: 0 }); // 句尾闭嘴
  return frames;
}

export interface LineAlignment {
  shotNumber: number;
  /** 可对齐度 0-100 */
  score: number;
  /** 说话人是否在画面(未知则 true 不罚) */
  speakerOnScreen: boolean;
  /** 景别是否够拍脸(非纯远/全景) */
  faceVisible: boolean;
  /** 台词估时是否塞得进镜头窗 */
  durationFits: boolean;
  /** 是否值得做口型(score ≥ 60) */
  alignable: boolean;
  issues: string[];
}

const WIDE_ONLY = (s: string) =>
  /wide|long shot|full shot|establishing|远景|全景|大全/i.test(s) && !/close|cu\b|mcu|medium|特写|近景|中景/i.test(s);

/** 单句口型可对齐度评分。 */
export function scoreLineAlignment(line: DialogueLine): LineAlignment {
  const issues: string[] = [];
  const speaker = (line.speaker || '').trim();
  const onScreen = Array.isArray(line.onScreen) ? line.onScreen : null;
  const speakerOnScreen = !speaker || !onScreen ? true : onScreen.includes(speaker);
  const shotSize = (line.shotSize || '').trim();
  const faceVisible = shotSize ? !WIDE_ONLY(shotSize) : true;

  const { start, end } = lineWindow(line);
  const windowLen = end - start;
  const hadExplicitWindow = typeof line.endSec === 'number' && typeof line.startSec === 'number';
  const speechLen = estimateSpeechSeconds(line.text, line.speed);
  const durationFits = !hadExplicitWindow ? true : speechLen <= windowLen * 1.15;

  let score = 100;
  if (!speakerOnScreen) { score -= 50; issues.push(`说话人「${speaker}」不在画面 —— 画外音无脸可对口型(可改为出镜或转旁白)`); }
  if (!faceVisible) { score -= 30; issues.push(`景别「${shotSize}」过远 —— 脸太小,口型对不上(建议补一镜 MCU/CU)`); }
  if (!durationFits) { score -= 20; issues.push(`台词约 ${speechLen}s 超过镜头窗 ${round2(windowLen)}s —— 口型会被截断(放慢语速 / 加长镜头 / 拆句)`); }
  score = clamp(score, 0, 100);

  return {
    shotNumber: line.shotNumber,
    score,
    speakerOnScreen,
    faceVisible,
    durationFits,
    alignable: score >= 60,
    issues,
  };
}

export type LipSyncLevel = 'none' | 'pass' | 'warn' | 'block';

export interface LinePlan {
  shotNumber: number;
  speaker?: string;
  text: string;
  windowSec: { start: number; end: number };
  visemes: VisemeKeyframe[];
  alignment: LineAlignment;
}

export interface LipSyncPlan {
  /** 对白镜数 */
  lines: number;
  perLine: LinePlan[];
  /** 整片口型就绪度 0-100(各句可对齐度均值;无对白镜 → 0) */
  readiness: number;
  level: LipSyncLevel;
  /** 最弱句(可对齐度最低) */
  weakest: LinePlan | null;
  /** 汇总提示(中文) */
  hints: string[];
}

function levelOf(lines: number, readiness: number): LipSyncLevel {
  if (lines === 0) return 'none';
  if (readiness >= 80) return 'pass';
  if (readiness >= 60) return 'warn';
  return 'block';
}

/**
 * 聚合整片口型计划:每句 viseme 轨 + 可对齐度,整片就绪度 + 最弱句 + 提示。
 */
export function buildLipSyncPlan(lines: DialogueLine[]): LipSyncPlan {
  const list = (Array.isArray(lines) ? lines : []).filter((l) => l && (l.text || '').trim());
  if (list.length === 0) {
    return { lines: 0, perLine: [], readiness: 0, level: 'none', weakest: null, hints: ['无对白镜 —— 口型不适用(纯旁白 / 无台词)'] };
  }
  const perLine: LinePlan[] = list.map((line) => {
    const { start, end } = lineWindow(line);
    return {
      shotNumber: line.shotNumber,
      speaker: line.speaker,
      text: line.text,
      windowSec: { start: round2(start), end: round2(end) },
      visemes: planVisemes(line),
      alignment: scoreLineAlignment(line),
    };
  });
  const readiness = Math.round(perLine.reduce((n, p) => n + p.alignment.score, 0) / perLine.length);
  const weakest = perLine.reduce<LinePlan | null>((w, p) => (!w || p.alignment.score < w.alignment.score ? p : w), null);

  const hints: string[] = [];
  const offScreen = perLine.filter((p) => !p.alignment.speakerOnScreen).length;
  const tooWide = perLine.filter((p) => !p.alignment.faceVisible).length;
  const overflow = perLine.filter((p) => !p.alignment.durationFits).length;
  if (offScreen) hints.push(`${offScreen} 句为画外音(说话人不在画面),口型无处可对`);
  if (tooWide) hints.push(`${tooWide} 句镜头过远,脸太小口型对不准 —— 补特写`);
  if (overflow) hints.push(`${overflow} 句台词时长溢出镜头窗 —— 放慢语速或加长镜头`);
  if (!hints.length) hints.push(`口型就绪:${perLine.length} 句对白说话人在画面 + 景别够 + 时长合身,可驱动嘴部动画`);

  return { lines: perLine.length, perLine, readiness, level: levelOf(perLine.length, readiness), weakest, hints };
}

export interface LipSyncReshoot {
  shotNumber: number;
  score: number;
  /** 主问题(画外音 / 景别过远 / 台词溢出) */
  reason: string;
  /** 怎么修(可执行重拍提示) */
  focusHint: string;
}

export interface LipSyncReshootPlan {
  /** 需重拍/调整的对白镜(可对齐度升序,最差在前) */
  shots: LipSyncReshoot[];
  count: number;
  message: string;
}

/**
 * 把口型计划里「对不上」的句子转成可执行重拍提示(融进重拍计划 / 「去工坊重拍」)。
 * 优先级:画外音 > 景别过远 > 台词溢出。默认最多 8 条。
 */
export function lipSyncReshootHints(plan: LipSyncPlan, opts: { maxShots?: number } = {}): LipSyncReshootPlan {
  const maxShots = typeof opts.maxShots === 'number' && opts.maxShots > 0 ? opts.maxShots : 8;
  const weak = (plan?.perLine || []).filter((p) => p.alignment.issues.length > 0);
  const sorted = [...weak].sort((a, b) => a.alignment.score - b.alignment.score).slice(0, maxShots);

  const shots: LipSyncReshoot[] = sorted.map((p) => {
    const who = p.speaker || '说话人';
    const a = p.alignment;
    let reason: string; let focusHint: string;
    if (!a.speakerOnScreen) {
      reason = '画外音';
      focusHint = `把「${who}」拍进画面(出镜),或这句改走旁白 / 画外音处理 —— 否则无脸可对口型`;
    } else if (!a.faceVisible) {
      reason = '景别过远';
      focusHint = `补一镜 MCU/CU 拍「${who}」面部,口型才对得上`;
    } else {
      reason = '台词溢出镜头窗';
      focusHint = `放慢语速或加长该镜时长,避免口型被截断;长句可拆成两镜`;
    }
    return { shotNumber: p.shotNumber, score: a.score, reason, focusHint };
  });

  return {
    shots,
    count: shots.length,
    message: shots.length ? `${shots.length} 句对白口型对不上,建议重拍 / 调整` : '口型全部对得上,无需重拍',
  };
}

/**
 * 把分镜数组映射成对白行(顺序累加镜头时间窗)。type-only 引 ScriptShot,client 安全。
 * 说话人取 characters[0];onScreen 取整 characters;窗用 duration 顺序累加(缺省每镜 3s)。
 */
export function dialogueLinesFromShots(shots: ScriptShot[]): DialogueLine[] {
  const list = Array.isArray(shots) ? shots : [];
  const out: DialogueLine[] = [];
  let cursor = 0;
  for (const s of list) {
    const dur = typeof s.duration === 'number' && s.duration > 0 ? s.duration : 3;
    const start = cursor;
    cursor += dur;
    const text = (s.dialogue || '').trim();
    if (!text) continue; // 只收有对白的镜
    const chars = Array.isArray(s.characters) ? s.characters : [];
    out.push({
      shotNumber: s.shotNumber,
      speaker: chars[0],
      text,
      startSec: start,
      endSec: start + dur,
      shotSize: s.shotSize,
      onScreen: chars,
    });
  }
  return out;
}
