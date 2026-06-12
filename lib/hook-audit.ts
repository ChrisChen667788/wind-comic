/**
 * lib/hook-audit (v10.6.2) — 钩子审计三指标(确定性启发式 + 可选 LLM assist)。
 *
 * 短剧的生死线是三处:开场 3 秒(不上钩就划走)、集尾(没悬念就不追更)、
 * 切镜卡点(跟不上拍就显业余)。节奏审计(lib/pacing-audit)已有整片冲突分/反转,
 * 本模块把这三处量化成独立指标,挂到 PacingAuditReport.hooks 并入节奏分析 tab:
 *
 *   - openingHook  开场 3 秒钩子分(0-10):OPENING_WINDOW_S 内镜头的
 *     冲突底分 × 0.4 + 钩子词命中 ×2(上限 4)+ 疑问/惊叹 +1 + 有对白 +1
 *   - cliffhanger  集尾悬念分(0-10):末镜悬念词命中 ×2(上限 4)+ 疑问收尾 +2
 *     + 末镜冲突分 ≥5 加 2 + 情绪非中性 +1 + 叙事节拍标注悬念 +1
 *   - bgmSync      BGM 卡点对齐率(0-1):切镜 out 时刻落在最近拍点
 *     ±BEAT_SNAP_WINDOW_S 内的比例;拍点来自 lib/beat-detect(ffmpeg 析拍)。
 *     无 BGM / 析不出拍 → available=false 诚实呈现,不给假分。
 *
 * 分层(与 docs/algorithms.md 同款 BYO 哲学):
 *   - 规则层(本文件,零 LLM):词典 + 纯算术,mock/无 key 全可跑
 *   - LLM assist(可选):配 LLM key 后由 assistHookAuditWithLLM 复核开场/集尾
 *     两个"判断型"指标,与规则分取均值;bgmSync 是测量值,LLM 不参与
 */

import type { Script, ScriptShot } from '@/types/agents';
import { scoreShotConflict, detectEmotionPolarity } from './pacing-audit';
import { findNearestBeat, BEAT_SNAP_WINDOW_S } from './beat-detect';

/** 开场钩子的考察窗口(秒)— 短剧划走决策发生在前 3 秒 */
export const OPENING_WINDOW_S = 3;

// 开场钩子词:危机 / 奇观 / 身份反差 / 倒计时 —— 一上来就抛"必须看下去的理由"
const HOOK_KEYWORDS = [
  '危机', '危险', '追杀', '爆炸', '坠落', '昏迷', '失忆', '绑架', '人质',
  '重生', '穿越', '回到', '系统', '金手指', '逆袭',
  '尸体', '血', '枪', '刀', '警笛', '警报', '倒计时',
  '婚礼', '葬礼', '离婚', '退婚', '私生子', '继承', '遗嘱',
  '神秘', '诡异', '消失', '失踪', '谜', 'secret', '黑屏',
];

// 集尾悬念词:cliffhanger 构件 —— 未解之事 / 突现人物 / 威胁预告 / 戛然而止
const CLIFFHANGER_KEYWORDS = [
  '突然', '出现', '消失', '回头', '回眸', '门开', '推门', '电话', '短信',
  '真相', '秘密', '身份', '原来', '竟然', '没想到',
  '未完', '未结', '下一集', '下集', 'cliffhanger', '留下', '戛然',
  '黑屏', '定格', '凝固', '僵住', '愣住',
  '威胁', '警告', 'predator', '逼近', '阴影', '注视', '盯着',
];

export interface HookMetric {
  /** 0-10 */
  score: number;
  /** 得分构成(中文,直接可呈现) */
  reasons: string[];
}

export interface BgmSyncMetric {
  /** 是否可测 — 无 BGM / 析不出拍点时 false(诚实呈现,UI 显示「未生成 BGM」) */
  available: boolean;
  /** 对齐率 0-1;不可测时 null */
  rate: number | null;
  alignedCuts: number;
  totalCuts: number;
  /** 判定窗口(秒),与 beat-detect 的 snap 窗口一致 */
  windowS: number;
}

export interface HookAuditResult {
  openingHook: HookMetric;
  cliffhanger: HookMetric;
  bgmSync: BgmSyncMetric;
  /** LLM 复核过开场/集尾分(配 key 时) */
  llmAssisted: boolean;
}

function countHits(text: string, dict: string[]): number {
  if (!text) return 0;
  let n = 0;
  for (const w of dict) if (text.includes(w)) n++;
  return n;
}

function shotText(s: ScriptShot): string {
  return `${s.sceneDescription || ''} ${s.action || ''} ${s.dialogue || ''} ${s.emotion || ''}`;
}

/**
 * 开场窗口内的镜头:按镜头粒度截取 —— 起始时刻落在 OPENING_WINDOW_S 内的镜头
 * 整镜计入(至少含第 1 镜)。确定性近似:不按时间比例裁剪文本,首镜极短时
 * 第 2 镜的后段内容也会参与评分,换来零歧义、可单测的窗口语义。
 */
function openingShots(shots: ScriptShot[]): ScriptShot[] {
  const out: ScriptShot[] = [];
  let t = 0;
  for (const s of shots) {
    if (out.length > 0 && t >= OPENING_WINDOW_S) break;
    out.push(s);
    t += typeof s.duration === 'number' && s.duration > 0 ? s.duration : 5;
  }
  return out;
}

/** 开场 3 秒钩子分(0-10,确定性) */
export function openingHookScore(shots: ScriptShot[]): HookMetric {
  const window = openingShots(shots);
  if (window.length === 0) return { score: 0, reasons: ['无镜头'] };
  const text = window.map(shotText).join(' ');
  const reasons: string[] = [];
  let score = 0;

  const conflict = Math.max(...window.map(scoreShotConflict));
  const conflictPart = Math.round(conflict * 0.4);
  score += conflictPart;
  reasons.push(`开场冲突底分 ${conflict}/10 → +${conflictPart}`);

  const hookHits = countHits(text, HOOK_KEYWORDS);
  if (hookHits > 0) {
    const part = Math.min(4, hookHits * 2);
    score += part;
    reasons.push(`钩子要素命中 ${hookHits} 处(危机/奇观/反差)→ +${part}`);
  } else {
    reasons.push('未命中钩子要素 — 开场缺"必须看下去的理由"');
  }

  if (/[?？!！]/.test(text)) {
    score += 1;
    reasons.push('含疑问/惊叹 — 有抛问意识 → +1');
  }
  if (window.some((s) => s.dialogue && s.dialogue.trim())) {
    score += 1;
    reasons.push('开场即有对白(有戏)→ +1');
  }

  return { score: Math.min(10, score), reasons };
}

/** 集尾悬念分(0-10,确定性) */
export function cliffhangerScore(shots: ScriptShot[]): HookMetric {
  const last = shots[shots.length - 1];
  if (!last) return { score: 0, reasons: ['无镜头'] };
  const text = shotText(last);
  const reasons: string[] = [];
  let score = 0;

  const hits = countHits(text, CLIFFHANGER_KEYWORDS);
  if (hits > 0) {
    const part = Math.min(4, hits * 2);
    score += part;
    reasons.push(`悬念构件命中 ${hits} 处(突现/未解/威胁)→ +${part}`);
  } else {
    reasons.push('末镜无悬念构件 — 像"完美收尾",观众没有追更理由');
  }

  // 只认对白以问号收尾 — 场景描述里的疑问修辞不算"留问号"(否则假阳性 +2)
  if (/[?？]」?\s*$/.test((last.dialogue || '').trim())) {
    score += 2;
    reasons.push('疑问收尾(留问号)→ +2');
  }

  const conflict = scoreShotConflict(last);
  if (conflict >= 5) {
    score += 2;
    reasons.push(`末镜冲突分 ${conflict}/10(情绪推到峰值)→ +2`);
  }

  if (detectEmotionPolarity(text) !== 0) {
    score += 1;
    reasons.push('末镜情绪非中性 → +1');
  }

  const beatNote = `${last.storyBeat || ''} ${last.beat || ''}`;
  if (/悬念|钩子|cliffhanger/i.test(beatNote)) {
    score += 1;
    reasons.push('叙事节拍明确标注悬念收尾 → +1');
  }

  return { score: Math.min(10, score), reasons };
}

/**
 * BGM 卡点对齐率:每个镜头的 out 时刻(累计时长)找最近拍点,
 * 距离 ≤ windowS 算对齐。拍点数组来自 lib/beat-detect.detectBeats(升序秒)。
 */
export function beatAlignmentRate(
  durations: number[],
  beats: number[],
  windowS: number = BEAT_SNAP_WINDOW_S,
): BgmSyncMetric {
  if (durations.length === 0 || beats.length === 0) {
    return { available: false, rate: null, alignedCuts: 0, totalCuts: durations.length, windowS };
  }
  let t = 0;
  let aligned = 0;
  for (const d of durations) {
    t += d > 0 ? d : 5;
    const nearest = findNearestBeat(t, beats);
    if (nearest !== null && Math.abs(nearest - t) <= windowS) aligned++;
  }
  return {
    available: true,
    rate: aligned / durations.length,
    alignedCuts: aligned,
    totalCuts: durations.length,
    windowS,
  };
}

/**
 * 三指标一次算齐。bgmBeats 缺省(Writer 阶段 BGM 未生成)→ bgmSync 标不可测,
 * Editor 阶段真 BGM 落盘后由 orchestrator 用 beatAlignmentRate 回填。
 */
export function auditHooks(script: Script, opts?: { bgmBeats?: number[] }): HookAuditResult {
  const shots = Array.isArray(script.shots) ? script.shots : [];
  const durations = shots.map((s) => (typeof s.duration === 'number' && s.duration > 0 ? s.duration : 5));
  return {
    openingHook: openingHookScore(shots),
    cliffhanger: cliffhangerScore(shots),
    bgmSync: beatAlignmentRate(durations, opts?.bgmBeats ?? []),
    llmAssisted: false,
  };
}

/**
 * 可选 LLM assist:复核开场/集尾两个判断型指标,与规则分取均值(规则分是锚,
 * LLM 只能拉 ±5 以内)。无 key / MOCK_ENGINES=1 / 调用失败 → 原样返回规则结果。
 */
export async function assistHookAuditWithLLM(script: Script, rule: HookAuditResult): Promise<HookAuditResult> {
  const { API_CONFIG } = await import('./config');
  const key = API_CONFIG.openai.apiKey;
  if (!key || key.startsWith('your_') || process.env.MOCK_ENGINES === '1') return rule;

  try {
    const { callLLMWithFallback } = await import('./llm-client');
    const shots = Array.isArray(script.shots) ? script.shots : [];
    const first = shots.slice(0, 2).map((s) => shotText(s)).join('\n');
    const last = shots.length > 0 ? shotText(shots[shots.length - 1]) : '';
    const res = await callLLMWithFallback({
      system:
        '你是短剧节奏审片人。给开场钩子(前3秒能否留住划走的观众)和集尾悬念(能否让观众追下一集)各打 0-10 分。' +
        '只输出 JSON:{"opening":分,"openingWhy":"一句话","cliffhanger":分,"cliffhangerWhy":"一句话"}',
      user: `【开场镜头】\n${first}\n\n【末镜】\n${last}`,
      jsonMode: true,
      maxTokens: 300,
      timeoutMs: 20_000,
    });
    if (!res.ok || !res.content) return rule;
    const parsed = JSON.parse(res.content);
    const clamp = (v: unknown): number | null =>
      typeof v === 'number' && Number.isFinite(v) ? Math.max(0, Math.min(10, Math.round(v))) : null;
    const llmOpening = clamp(parsed.opening);
    const llmCliff = clamp(parsed.cliffhanger);
    if (llmOpening === null && llmCliff === null) return rule;

    const blend = (m: HookMetric, llm: number | null, why: unknown): HookMetric =>
      llm === null
        ? m
        : {
            score: Math.round((m.score + llm) / 2),
            reasons: [...m.reasons, `LLM 复核 ${llm}/10${typeof why === 'string' && why ? `:${why.slice(0, 80)}` : ''}`],
          };
    return {
      ...rule,
      openingHook: blend(rule.openingHook, llmOpening, parsed.openingWhy),
      cliffhanger: blend(rule.cliffhanger, llmCliff, parsed.cliffhangerWhy),
      llmAssisted: true,
    };
  } catch {
    return rule;
  }
}
