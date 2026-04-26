/**
 * Project Quality Scores (v2.11 #4)
 *
 * Writer-Editor 闭环数据访问层。
 *
 * 写入:Editor 成片后调用 insertQualityScore 持久化 3 维评分 + 叙述 + 采样帧。
 * 读取:Writer 下一轮调用 getLatestQualityScore 拿最近一次评分,
 *      对"分<70 的维度"注入针对性 cue,让新一轮输出针对性地补弱点。
 *
 * 为什么要按维度拆:
 *   只给一个综合分的话 Writer 只会"整体再努力",补不到点上。
 *   分开存(连贯 / 光影 / 脸),Writer 可以精准地:
 *     - 脸低 → 强化面部特征描写 + 保持参考图
 *     - 光影低 → 在场景描写里显式标注光源位置 + 色温
 *     - 连贯低 → 要求镜头衔接写明过渡动作 + 复述道具
 */

import { db, now } from './db';
import { nanoid } from 'nanoid';

export interface QualityScoreDimensions {
  overall: number;         // 综合 0-100
  continuity: number;      // 连贯度
  lighting: number;        // 光影
  face: number;            // 脸相似
}

export interface QualityScoreSuggestions {
  continuity: string[];
  lighting: string[];
  face: string[];
}

export interface QualityScoreRow extends QualityScoreDimensions {
  id: string;
  projectId: string;
  narrative: string;
  sampleFrames: string[];
  suggestions: QualityScoreSuggestions;
  createdAt: string;
}

export interface InsertQualityScoreInput {
  projectId: string;
  overall: number;
  continuity: number;
  lighting: number;
  face: number;
  narrative: string;
  sampleFrames: string[];
  suggestions: QualityScoreSuggestions;
}

export function insertQualityScore(input: InsertQualityScoreInput): QualityScoreRow {
  const row: QualityScoreRow = {
    id: `qs_${nanoid(12)}`,
    projectId: input.projectId,
    overall: clamp(input.overall),
    continuity: clamp(input.continuity),
    lighting: clamp(input.lighting),
    face: clamp(input.face),
    narrative: input.narrative || '',
    sampleFrames: Array.isArray(input.sampleFrames) ? input.sampleFrames : [],
    suggestions: {
      continuity: arr(input.suggestions?.continuity),
      lighting: arr(input.suggestions?.lighting),
      face: arr(input.suggestions?.face),
    },
    createdAt: now(),
  };
  db.prepare(`
    INSERT INTO project_quality_scores
      (id, project_id, overall_score, continuity_score, lighting_score, face_score,
       narrative, sample_frames, suggestions, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    row.id,
    row.projectId,
    row.overall,
    row.continuity,
    row.lighting,
    row.face,
    row.narrative,
    JSON.stringify(row.sampleFrames),
    JSON.stringify(row.suggestions),
    row.createdAt,
  );
  return row;
}

/** 取某项目最近一次评分,没有返回 null */
export function getLatestQualityScore(projectId: string): QualityScoreRow | null {
  const raw = db.prepare(`
    SELECT id, project_id, overall_score, continuity_score, lighting_score, face_score,
           narrative, sample_frames, suggestions, created_at
    FROM project_quality_scores
    WHERE project_id = ?
    ORDER BY created_at DESC
    LIMIT 1
  `).get(projectId) as any;
  if (!raw) return null;
  return mapRow(raw);
}

/** 取项目全部历史评分(用于"迭代历史"展示) */
export function listQualityScores(projectId: string): QualityScoreRow[] {
  const rows = db.prepare(`
    SELECT id, project_id, overall_score, continuity_score, lighting_score, face_score,
           narrative, sample_frames, suggestions, created_at
    FROM project_quality_scores
    WHERE project_id = ?
    ORDER BY created_at DESC
  `).all(projectId) as any[];
  return rows.map(mapRow);
}

function mapRow(raw: any): QualityScoreRow {
  return {
    id: raw.id,
    projectId: raw.project_id,
    overall: raw.overall_score,
    continuity: raw.continuity_score,
    lighting: raw.lighting_score,
    face: raw.face_score,
    narrative: raw.narrative || '',
    sampleFrames: safeParseArray(raw.sample_frames),
    suggestions: safeParseSuggestions(raw.suggestions),
    createdAt: raw.created_at,
  };
}

function safeParseArray(s: string | null): string[] {
  if (!s) return [];
  try {
    const v = JSON.parse(s);
    return Array.isArray(v) ? v.filter((x) => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

function safeParseSuggestions(s: string | null): QualityScoreSuggestions {
  const empty: QualityScoreSuggestions = { continuity: [], lighting: [], face: [] };
  if (!s) return empty;
  try {
    const v = JSON.parse(s);
    return {
      continuity: arr(v?.continuity),
      lighting: arr(v?.lighting),
      face: arr(v?.face),
    };
  } catch {
    return empty;
  }
}

function arr(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x) => typeof x === 'string' && x.trim().length > 0) : [];
}

function clamp(n: unknown, lo = 0, hi = 100): number {
  const v = typeof n === 'number' ? n : Number(n);
  if (!isFinite(v)) return 0;
  return Math.max(lo, Math.min(hi, Math.round(v)));
}

/**
 * 把最近一次评分翻译成 Writer 的系统提示补丁 —— "低维度" 靠具体 cue 补齐。
 *
 * 规则:
 *   - 分 >= 70: 不追加任何指示(说明这维已经 OK,让模型保持原状)
 *   - 分 < 70:  把对应维度的加强 cue 挂进 prompt,并带上上次的 narrative / suggestions
 *
 * 返回一段可直接拼接进 Writer / Screenwriter system prompt 的中文段落。
 * 没有历史评分或没有"偏弱维度"时返回空字符串。
 */
export function buildWriterFeedbackHint(score: QualityScoreRow | null): string {
  if (!score) return '';
  const weak: string[] = [];
  const THRESH = 70;

  if (score.face < THRESH) {
    weak.push(
      `【脸相似度偏低 (${score.face}/100)】上一版跨镜主角脸有漂移。` +
      `请在每场戏的主角描写里明确写出:发型 + 脸型 + 眼睛 + 肤色 + 标志性服饰,` +
      `哪怕同一段落重复出现也不要省略,帮助视频模型锁定 identity。` +
      suggestionLine(score.suggestions.face),
    );
  }

  if (score.lighting < THRESH) {
    weak.push(
      `【光影一致性偏低 (${score.lighting}/100)】上一版光线跳变明显。` +
      `请在每个场景开头用一句话明确:光源方向 (正/侧/顶/逆)、` +
      `光质 (硬光/柔光)、色温 (暖黄/冷蓝/中性),全片保持同一 key/fill ratio。` +
      suggestionLine(score.suggestions.lighting),
    );
  }

  if (score.continuity < THRESH) {
    weak.push(
      `【镜头衔接偏低 (${score.continuity}/100)】上一版前后镜头跳接生硬。` +
      `请在连续两场戏之间:(a) 复述上一场景末的道具/动作,` +
      `(b) 给出清晰的过渡动词(走向 / 递出 / 转身),让镜头之间有动作钩子。` +
      suggestionLine(score.suggestions.continuity),
    );
  }

  if (weak.length === 0) return '';

  const header =
    `⚠️ 上一版成片评分反馈(${score.createdAt.slice(0, 10)}):` +
    `综合 ${score.overall}/100,` +
    `连贯 ${score.continuity}、光影 ${score.lighting}、脸 ${score.face}。` +
    `请针对以下偏弱维度做针对性改写:`;
  const tail = score.narrative
    ? `\n\n上一版 Editor 总结:${score.narrative.slice(0, 280)}`
    : '';
  return `\n\n${header}\n\n${weak.join('\n\n')}${tail}\n`;
}

function suggestionLine(list: string[]): string {
  if (!list || list.length === 0) return '';
  return ` Editor 上次的具体建议:${list.slice(0, 3).join(' / ')}.`;
}
