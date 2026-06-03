/**
 * v3.4 — 端到端 LLM Vision Audit (每镜成片对剧本打分).
 *
 * cameo-vision 解决"角色像不像参考脸". 这文件解决一个更根本的问题:
 * **生成出来的画面, 到底对得上剧本写的吗?** —— 短剧最大的痛点是"AI 画了个不
 * 相干的东西", 用户得逐镜肉眼比对. 我们用一次便宜的 vision 调用给每镜打 0-100,
 * 标出"哪几镜画面跑题了", 把人从逐帧 review 里解放出来.
 *
 * 数据流:
 *   每镜: (成片关键帧图 + 该镜剧本: 场景/动作/台词/情绪) → Vision → 0-100 + 维度
 *   全片: 聚合所有镜 → 平均分 + 最差镜 + verdict
 *
 * 复用 cameo-vision 的 toVisionImageInput / safeParseJson, 不重复造轮子.
 * 纯函数 (buildAuditPrompt / normalizeAuditResult / aggregateFilmAudit) 单独导出,
 * 不依赖 LLM, 可单测.
 *
 * 持久化: lib/db.ts shot_vision_audits 表. API: app/api/projects/[id]/vision-audit.
 *
 * 单测: tests/v3-4-vision-audit.test.ts.
 */

import OpenAI from 'openai';
import { nanoid } from 'nanoid';
import { API_CONFIG } from './config';
import { toVisionImageInput, safeParseJson } from './cameo-vision';
import { now } from './db';
import { getDbDriver } from './db-driver';

export interface ShotScriptContext {
  shotNumber: number;
  /** 场景描述 (地点/环境). */
  sceneDescription?: string;
  /** 该镜应该发生的动作/事件. */
  action?: string;
  /** 台词 (帮助判断情绪/人物). */
  dialogue?: string;
  /** 情绪/氛围 hint. */
  mood?: string;
}

export interface ShotAuditDimensions {
  /** 场景对得上吗 (地点/环境/道具) 0-100. */
  sceneMatch: number;
  /** 动作/事件对得上吗 0-100. */
  actionMatch: number;
  /** 情绪/氛围对得上吗 0-100. */
  moodMatch: number;
  /** 构图质量 (与剧本无关的纯画面质量) 0-100. */
  composition: number;
}

export interface ShotAuditResult {
  shotNumber: number;
  /** 综合 0-100. */
  score: number;
  /** pass ≥75 / warn 50-74 / fail <50. */
  verdict: 'pass' | 'warn' | 'fail';
  dimensions: ShotAuditDimensions;
  /** 发现的具体问题 (画面里缺了什么 / 多了什么). */
  issues: string[];
  /** 一句话理由. */
  reasoning: string;
}

export interface FilmAuditSummary {
  avgScore: number;
  shotCount: number;
  passCount: number;
  warnCount: number;
  failCount: number;
  /** 最差的 N 镜 (score 升序), 给用户优先重生. */
  weakestShots: Array<{ shotNumber: number; score: number }>;
  verdict: 'excellent' | 'good' | 'needs-work' | 'poor';
}

// ─── Pure helpers (单测覆盖) ────────────────────────────────────────────────

const SYSTEM_PROMPT = `你是 AI 短剧的成片质检员。用户给你一张「成片关键帧」和这一镜的「剧本要求」。
任务: 判断画面到底对不对得上剧本写的内容。不要管艺术风格好坏, 只看"画面内容是否符合剧本描述"。

评估维度:
1. 场景 (sceneMatch): 地点/环境/关键道具对得上吗? 剧本写"雨夜街头", 画面是不是雨夜街头?
2. 动作 (actionMatch): 剧本写的动作/事件发生了吗? 剧本写"男主推开门", 画面里有没有这个动作?
3. 情绪 (moodMatch): 画面氛围 (光线/色调/人物表情) 对得上剧本情绪吗?
4. 构图 (composition): 纯画面质量 (与剧本无关) —— 主体清晰?构图稳?有无明显 AI 崩坏?

红灯 (写进 issues):
- 画面完全跑题 (剧本说室内, 画了室外)
- 关键人物/道具缺失
- 明显 AI 崩坏 (多手指/糊脸/扭曲)

严格按 JSON 输出 (只要 JSON, 不要 markdown 围栏):
{
  "score": 0-100 整数,
  "dimensions": { "sceneMatch": 0-100, "actionMatch": 0-100, "moodMatch": 0-100, "composition": 0-100 },
  "issues": ["问题1", "问题2"],
  "reasoning": "一句话, 80 字内"
}

score 标尺: ≥75 画面基本对得上 (pass), 50-74 部分跑偏 (warn), <50 严重跑题 (fail)`;

/** 构造给 vision 的剧本上下文文本. 纯函数. */
export function buildAuditPrompt(ctx: ShotScriptContext): string {
  const parts: string[] = [`第 ${ctx.shotNumber} 镜的剧本要求:`];
  if (ctx.sceneDescription) parts.push(`【场景】${ctx.sceneDescription}`);
  if (ctx.action) parts.push(`【动作】${ctx.action}`);
  if (ctx.dialogue) parts.push(`【台词】${ctx.dialogue}`);
  if (ctx.mood) parts.push(`【情绪】${ctx.mood}`);
  parts.push('请按 system 的 JSON 结构, 评估这张成片关键帧画面对不对得上以上剧本要求。');
  return parts.join('\n');
}

const clamp = (n: unknown): number => {
  const v = typeof n === 'number' ? n : Number(n);
  if (!Number.isFinite(v)) return 0;
  return Math.max(0, Math.min(100, Math.round(v)));
};

/** verdict 映射. 纯函数. */
export function scoreToVerdict(score: number): ShotAuditResult['verdict'] {
  if (score >= 75) return 'pass';
  if (score >= 50) return 'warn';
  return 'fail';
}

/** 把 LLM 原始输出规范化成 ShotAuditResult. 纯函数, 防字段缺失/越界. */
export function normalizeAuditResult(raw: any, shotNumber: number): ShotAuditResult {
  const score = clamp(raw?.score);
  const arr = (v: unknown) =>
    Array.isArray(v) ? v.filter((s) => typeof s === 'string' && s.trim().length > 0).slice(0, 6) : [];
  return {
    shotNumber,
    score,
    verdict: scoreToVerdict(score),
    dimensions: {
      sceneMatch: clamp(raw?.dimensions?.sceneMatch),
      actionMatch: clamp(raw?.dimensions?.actionMatch),
      moodMatch: clamp(raw?.dimensions?.moodMatch),
      composition: clamp(raw?.dimensions?.composition),
    },
    issues: arr(raw?.issues),
    reasoning: typeof raw?.reasoning === 'string' ? raw.reasoning.slice(0, 200) : '',
  };
}

/** 聚合全片. 纯函数. */
export function aggregateFilmAudit(results: ShotAuditResult[], weakestN = 3): FilmAuditSummary {
  const shotCount = results.length;
  if (shotCount === 0) {
    return { avgScore: 0, shotCount: 0, passCount: 0, warnCount: 0, failCount: 0, weakestShots: [], verdict: 'poor' };
  }
  const sum = results.reduce((acc, r) => acc + r.score, 0);
  const avgScore = Math.round(sum / shotCount);
  const passCount = results.filter((r) => r.verdict === 'pass').length;
  const warnCount = results.filter((r) => r.verdict === 'warn').length;
  const failCount = results.filter((r) => r.verdict === 'fail').length;
  const weakestShots = [...results]
    .sort((a, b) => a.score - b.score)
    .slice(0, weakestN)
    .map((r) => ({ shotNumber: r.shotNumber, score: r.score }));

  // verdict: 没有 fail 且平均 ≥85 excellent; 没 fail 且 ≥70 good; 有少量 fail 或平均偏低 needs-work; 大量 fail poor
  const failRatio = failCount / shotCount;
  let verdict: FilmAuditSummary['verdict'];
  if (failCount === 0 && avgScore >= 85) verdict = 'excellent';
  else if (failRatio <= 0.1 && avgScore >= 70) verdict = 'good';
  else if (failRatio <= 0.34) verdict = 'needs-work';
  else verdict = 'poor';

  return { avgScore, shotCount, passCount, warnCount, failCount, weakestShots, verdict };
}

// ─── LLM call ───────────────────────────────────────────────────────────────

/**
 * 对一镜成片关键帧做剧本符合度评分. 失败返 null (不阻塞流程).
 */
export async function auditShotVsScript(
  shotImageUrl: string,
  ctx: ShotScriptContext,
): Promise<ShotAuditResult | null> {
  if (!shotImageUrl) return null;
  if (!API_CONFIG.openai.apiKey) {
    console.warn('[VisionAudit] OPENAI_API_KEY missing, skip');
    return null;
  }
  const visionInput = await toVisionImageInput(shotImageUrl);
  if (!visionInput) {
    console.warn('[VisionAudit] cannot resolve image:', shotImageUrl.slice(0, 80));
    return null;
  }

  const client = new OpenAI({ apiKey: API_CONFIG.openai.apiKey, baseURL: API_CONFIG.openai.baseURL });
  try {
    const resp = await client.chat.completions.create({
      model: API_CONFIG.openai.model,
      temperature: 0.2,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        {
          role: 'user',
          content: [
            { type: 'text', text: buildAuditPrompt(ctx) },
            { type: 'image_url', image_url: { url: visionInput } },
          ],
        },
      ],
      max_tokens: 400,
    });
    const rawText = resp.choices?.[0]?.message?.content?.toString().trim();
    if (!rawText) return null;
    const parsed = safeParseJson(rawText);
    if (!parsed) return null;
    return normalizeAuditResult(parsed, ctx.shotNumber);
  } catch (e) {
    console.warn('[VisionAudit] audit failed:', e instanceof Error ? e.message : e);
    return null;
  }
}

// ─── Persistence ────────────────────────────────────────────────────────────

/** 落一条镜头审核结果. UPSERT — 同 project+shot 重审会覆盖. */
export async function saveShotAudit(projectId: string, r: ShotAuditResult): Promise<void> {
  try {
    const driver = getDbDriver();
    await driver.run(`DELETE FROM shot_vision_audits WHERE project_id = ? AND shot_number = ?`, [projectId, r.shotNumber]);
    await driver.run(
      `INSERT INTO shot_vision_audits
        (id, project_id, shot_number, score, verdict, scene_match, action_match, mood_match, composition, issues, reasoning, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        nanoid(), projectId, r.shotNumber, r.score, r.verdict,
        r.dimensions.sceneMatch, r.dimensions.actionMatch, r.dimensions.moodMatch, r.dimensions.composition,
        JSON.stringify(r.issues), r.reasoning, now(),
      ],
    );
  } catch (e) {
    console.warn('[VisionAudit] saveShotAudit failed:', e instanceof Error ? e.message : e);
  }
}

/** 读一个项目全部镜头审核结果 (shot_number 升序). */
export async function getProjectAudits(projectId: string): Promise<ShotAuditResult[]> {
  try {
    const rows = await getDbDriver().query(
      `SELECT * FROM shot_vision_audits WHERE project_id = ? ORDER BY shot_number ASC`,
      [projectId],
    ) as any[];
    return rows.map((row) => ({
      shotNumber: row.shot_number,
      score: row.score,
      verdict: row.verdict,
      dimensions: {
        sceneMatch: row.scene_match,
        actionMatch: row.action_match,
        moodMatch: row.mood_match,
        composition: row.composition,
      },
      issues: safeJsonArray(row.issues),
      reasoning: row.reasoning || '',
    }));
  } catch {
    return [];
  }
}

function safeJsonArray(s: unknown): string[] {
  if (typeof s !== 'string') return [];
  try {
    const v = JSON.parse(s);
    return Array.isArray(v) ? v.filter((x) => typeof x === 'string') : [];
  } catch {
    return [];
  }
}
