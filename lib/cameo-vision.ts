/**
 * Cameo Vision Scorer (v2.11 #2)
 *
 * 让用户上传主角脸的那一刻就看到"这张图到底适不适合锁脸"的反馈。
 *
 * 为什么需要这个:
 *   传统流程是用户上传 → 生成 10 个镜头 → 发现"脸糊了/太小了/角度歪了"
 *   → 重新上传。一次试错 15 分钟 + 几块钱。
 *   我们把判断前置到上传瞬间 —— 用一次便宜的 vision 调用 (<$0.01)
 *   给 0-100 分 + 可执行改进建议,把用户从"试错循环"里拖出来。
 *
 * 输入:
 *   - imageUrl: http(s)://、/api/serve-file?key=xxx、data: URI 都行
 *
 * 输出:
 *   - score 0-100: 综合评分
 *   - dimensions: 分维度评分(清晰度/光线/角度/尺寸)
 *   - suggestions: 用户可直接采取的改进建议
 *   - warnings: 严重问题(遮挡/多人脸/非人脸等)
 *   - verdict: 'excellent' | 'good' | 'fair' | 'poor'
 *
 * 降级:
 *   Vision LLM 失败时返回 null(上游自行决定是否放行).
 *   不阻塞上传流程 —— 评分只是建议,用户硬要用也能用。
 *
 * 成本:
 *   gpt-4o / claude-sonnet-4 vision ≈ 1 image ≈ $0.005,
 *   200 次上传 ≈ $1,性价比吊打让用户重生整条视频。
 */

import OpenAI from 'openai';
import fs from 'fs';
import path from 'path';
import { API_CONFIG } from './config';
import { resolveByKey } from './asset-storage';

export interface CameoPreviewDimensions {
  /** 画面清晰度 0-100 */
  clarity: number;
  /** 光线条件 0-100 */
  lighting: number;
  /** 人脸角度 0-100 (正面为佳) */
  angle: number;
  /** 脸部尺寸占比 0-100 */
  size: number;
}

export interface CameoPreviewResult {
  score: number;                    // 综合 0-100
  verdict: 'excellent' | 'good' | 'fair' | 'poor';
  dimensions: CameoPreviewDimensions;
  suggestions: string[];            // 建议列表(中文,可直接展示)
  warnings: string[];               // 红灯警告
  /** LLM 一段话总结(可选用于 tooltip) */
  summary?: string;
}

const SYSTEM_PROMPT = `你是资深的 AI 视频制作顾问。用户上传了一张图片,打算用它作为 AI 视频生成里"主角脸"的参考图 (Cameo / subject_reference)。
请像专业摄影师一样评估:这张图适不适合作为"角色 IP 锁定"的基准?

评估维度:
1. 清晰度 (clarity): 5 官能否看清?是否有运动模糊 / 低分辨率?
2. 光线 (lighting): 光线是否均匀?脸是否被阴影遮挡?逆光?
3. 角度 (angle): 正面 > 3/4 侧 > 侧面 > 背面。正脸得分最高。
4. 尺寸 (size): 脸部占整图比例 —— 太小(<15%)难提取特征,太大(>80%)可能截脸。

红灯场景(写入 warnings):
- 画面里没有人脸 / 多张人脸
- 脸被口罩 / 墨镜 / 大面积头发遮挡
- 动漫 / 漫画头像(不适合真人视频)
- 模糊到 5 官识别不了

给出具体、可执行的改进建议(不要笼统说"请换一张更好的照片"),例如:
- "请拍摄正面照 (目前是 3/4 侧脸)"
- "请在自然光下重拍 (目前侧光过强)"
- "请靠近镜头,让脸部占画面 30% 以上"

严格按以下 JSON 结构输出(只输出 JSON,不要 markdown 代码块标记):
{
  "score": 0-100 的整数,
  "verdict": "excellent" | "good" | "fair" | "poor",
  "dimensions": {
    "clarity": 0-100,
    "lighting": 0-100,
    "angle": 0-100,
    "size": 0-100
  },
  "suggestions": ["建议1", "建议2"],
  "warnings": ["警告1"],
  "summary": "一句话总结"
}

verdict 映射参考: >=85 excellent, >=70 good, >=50 fair, <50 poor`;

/**
 * 把各种格式的 URL 转成 vision API 能消费的 image_url 串。
 * - http(s)://xxx → 原样返回
 * - /api/serve-file?key=xxx → 读本地文件转 data: URI
 * - /api/serve-file?path=xxx → 读本地文件转 data: URI
 * - data:image/... → 原样返回
 * - 其它本地绝对路径 → 读文件转 data: URI
 */
async function toVisionImageInput(imageUrl: string): Promise<string | null> {
  if (!imageUrl) return null;

  if (imageUrl.startsWith('http://') || imageUrl.startsWith('https://')) {
    return imageUrl;
  }
  if (imageUrl.startsWith('data:')) {
    return imageUrl;
  }

  // /api/serve-file?key=xxx  或  ?path=xxx
  if (imageUrl.startsWith('/api/serve-file')) {
    const u = new URL(imageUrl, 'http://localhost');
    const key = u.searchParams.get('key');
    const p = u.searchParams.get('path');
    let absPath: string | null = null;
    let ext = '';
    if (key) {
      const r = resolveByKey(key);
      if (!r) return null;
      absPath = r.absPath;
      ext = r.ext;
    } else if (p && fs.existsSync(p)) {
      absPath = p;
      ext = path.extname(p);
    }
    if (!absPath) return null;
    const buf = fs.readFileSync(absPath);
    const mime =
      ext === '.png' ? 'image/png'
      : ext === '.webp' ? 'image/webp'
      : ext === '.gif' ? 'image/gif'
      : 'image/jpeg';
    return `data:${mime};base64,${buf.toString('base64')}`;
  }

  // 本地绝对路径
  if (fs.existsSync(imageUrl)) {
    const buf = fs.readFileSync(imageUrl);
    const ext = path.extname(imageUrl).toLowerCase();
    const mime =
      ext === '.png' ? 'image/png'
      : ext === '.webp' ? 'image/webp'
      : ext === '.gif' ? 'image/gif'
      : 'image/jpeg';
    return `data:${mime};base64,${buf.toString('base64')}`;
  }

  return null;
}

/**
 * 对一张图做 Cameo 适配度评分。
 *
 * @param imageUrl 任意格式的图 URL(见 toVisionImageInput)
 * @returns 评分结果,失败返回 null
 */
export async function scoreCameoImage(imageUrl: string): Promise<CameoPreviewResult | null> {
  if (!imageUrl) return null;
  if (!API_CONFIG.openai.apiKey) {
    console.warn('[CameoVision] OPENAI_API_KEY missing, skip scoring');
    return null;
  }

  const visionInput = await toVisionImageInput(imageUrl);
  if (!visionInput) {
    console.warn('[CameoVision] cannot resolve image url:', imageUrl.slice(0, 80));
    return null;
  }

  const client = new OpenAI({
    apiKey: API_CONFIG.openai.apiKey,
    baseURL: API_CONFIG.openai.baseURL,
  });

  try {
    const resp = await client.chat.completions.create({
      model: API_CONFIG.openai.model,
      temperature: 0.3,  // 评分要稳定,不要创意
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        {
          role: 'user',
          content: [
            { type: 'text', text: '请按照 system 的 JSON 结构评估这张主角脸参考图。' },
            { type: 'image_url', image_url: { url: visionInput } },
          ],
        },
      ],
      max_tokens: 600,
    });

    const raw = resp.choices?.[0]?.message?.content?.toString().trim();
    if (!raw) return null;

    const parsed = safeParseJson(raw);
    if (!parsed) return null;

    return normalizeResult(parsed);
  } catch (e) {
    console.warn('[CameoVision] score failed:', e instanceof Error ? e.message : e);
    return null;
  }
}

// ────────────────────────────────────────────────────────────────────
// Sprint A.1 · 镜头一致性评分 (生成图 vs 参考图)
// ────────────────────────────────────────────────────────────────────
//
// scoreCameoImage 解决的是"用户上传的脸适不适合做参考"
// scoreShotConsistency 解决的是"生成的镜头到底像不像参考脸"
// 两者数据流不同, 拆成两个函数避免 prompt 互相污染。

export interface ShotConsistencyDimensions {
  /** 5 官 / 脸型相似度 0-100 */
  face: number;
  /** 服饰 / 造型一致性 0-100 */
  outfit: number;
  /** 整体身份感 (体态/气质) 0-100 */
  identity: number;
}

export interface ShotConsistencyResult {
  /** 综合一致性分数 0-100, 即 Sprint A.1 的判断依据 (<75 触发重生) */
  score: number;
  /** 三维分项, 给将来的"哪一项最差"诊断用 */
  dimensions: ShotConsistencyDimensions;
  /** LLM 一句话说明为什么是这个分 (会被持久化到 storyboard.cameoReason) */
  reasoning: string;
}

const CONSISTENCY_SYSTEM_PROMPT = `你是 AI 视频后期的角色一致性审核员。
用户给你两张图:
  · 第一张是「参考图」 (主角脸的基准, 应该长什么样)
  · 第二张是「生成图」 (本镜头实际生成的画面)

任务: 评估生成图里的人物 (如果有多个, 评估主体角色) 和参考图是不是同一个人。
不要管艺术风格 / 镜头距离 / 表情差异, 只看身份特征:
  - 5 官位置/比例 / 脸型骨相
  - 发色 / 发型大类 (短发 vs 长发, 直 vs 卷)
  - 肤色 / 年龄段
  - 服饰造型 (大类: 西装 / 古装 / T 恤等, 不必到颜色)
  - 整体气质 (身材体型 / 气场)

评分标尺 (重要):
  90-100: 几乎一致, 路人都认得是同一个人
  75-89:  明显是同一个人, 局部小差异 (可接受, 不重生)
  60-74:  有些像但有 1-2 处明显走样 (推荐重生)
  40-59:  只有大致方向, 5 官走样严重 (必须重生)
  0-39:   完全不像, 像是另一个人

特殊情况:
  - 生成图里完全没有人 → score=50, dimensions 全 50, reasoning 说明
  - 参考图本身不是人脸 → score=70 (不可比, 不扣分)

严格按以下 JSON 输出 (只要 JSON, 不要 markdown 围栏):
{
  "score": 0-100 整数,
  "dimensions": {
    "face": 0-100,
    "outfit": 0-100,
    "identity": 0-100
  },
  "reasoning": "一句话, 80 字以内"
}`;

/**
 * 比对一张"生成的镜头图"和一张"角色参考图", 判断角色身份一致性。
 *
 * @param shotImageUrl   本次生成的镜头图 URL (storyboard 输出)
 * @param referenceImageUrl 角色参考图 URL (cref 来源, 用户锁定脸 / 三视图 / 第一张角色图)
 * @param characterName  可选, 角色名, 写进 prompt 里增强 LLM 上下文
 * @returns 评分结果, 任一图无法解析或 LLM 失败 → null (上层应"信任原图, 不重生")
 */
export async function scoreShotConsistency(
  shotImageUrl: string,
  referenceImageUrl: string,
  characterName?: string,
): Promise<ShotConsistencyResult | null> {
  if (!shotImageUrl || !referenceImageUrl) return null;
  if (!API_CONFIG.openai.apiKey) {
    console.warn('[CameoConsistency] OPENAI_API_KEY missing, skip');
    return null;
  }

  const [shotInput, refInput] = await Promise.all([
    toVisionImageInput(shotImageUrl),
    toVisionImageInput(referenceImageUrl),
  ]);
  if (!shotInput || !refInput) {
    console.warn('[CameoConsistency] cannot resolve one of the images');
    return null;
  }

  const client = new OpenAI({
    apiKey: API_CONFIG.openai.apiKey,
    baseURL: API_CONFIG.openai.baseURL,
  });

  try {
    const resp = await client.chat.completions.create({
      model: API_CONFIG.openai.model,
      temperature: 0.2, // 稳定性 > 创意
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: CONSISTENCY_SYSTEM_PROMPT },
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text: characterName
                ? `请评估第二张图里的角色「${characterName}」与第一张参考图的一致性, 严格按 JSON 输出。`
                : '请评估第二张图里的主体角色与第一张参考图的一致性, 严格按 JSON 输出。',
            },
            { type: 'image_url', image_url: { url: refInput } },
            { type: 'image_url', image_url: { url: shotInput } },
          ],
        },
      ],
      max_tokens: 300,
    });

    const raw = resp.choices?.[0]?.message?.content?.toString().trim();
    if (!raw) return null;

    const parsed = safeParseJson(raw);
    if (!parsed) return null;

    const clamp = (n: unknown) => {
      const v = typeof n === 'number' ? n : Number(n);
      if (!isFinite(v)) return 0;
      return Math.max(0, Math.min(100, Math.round(v)));
    };
    return {
      score: clamp(parsed.score),
      dimensions: {
        face: clamp(parsed.dimensions?.face),
        outfit: clamp(parsed.dimensions?.outfit),
        identity: clamp(parsed.dimensions?.identity),
      },
      reasoning: typeof parsed.reasoning === 'string'
        ? parsed.reasoning.slice(0, 200)
        : '',
    };
  } catch (e) {
    console.warn('[CameoConsistency] score failed:', e instanceof Error ? e.message : e);
    return null;
  }
}

function safeParseJson(raw: string): any | null {
  try {
    return JSON.parse(raw);
  } catch {
    // 有时模型会带 markdown fence,兜底剥离
    const m = raw.match(/\{[\s\S]*\}/);
    if (!m) return null;
    try { return JSON.parse(m[0]); } catch { return null; }
  }
}

/**
 * 把 LLM 输出规范化为 CameoPreviewResult,防止字段缺失或越界。
 */
function normalizeResult(raw: any): CameoPreviewResult {
  const clamp = (n: unknown, lo = 0, hi = 100) => {
    const v = typeof n === 'number' ? n : Number(n);
    if (!isFinite(v)) return 0;
    return Math.max(lo, Math.min(hi, Math.round(v)));
  };
  const arr = (v: unknown) =>
    Array.isArray(v) ? v.filter((s) => typeof s === 'string' && s.trim().length > 0) : [];
  const score = clamp(raw?.score);
  let verdict: CameoPreviewResult['verdict'];
  if (typeof raw?.verdict === 'string' && ['excellent', 'good', 'fair', 'poor'].includes(raw.verdict)) {
    verdict = raw.verdict;
  } else {
    verdict = score >= 85 ? 'excellent' : score >= 70 ? 'good' : score >= 50 ? 'fair' : 'poor';
  }
  return {
    score,
    verdict,
    dimensions: {
      clarity: clamp(raw?.dimensions?.clarity),
      lighting: clamp(raw?.dimensions?.lighting),
      angle: clamp(raw?.dimensions?.angle),
      size: clamp(raw?.dimensions?.size),
    },
    suggestions: arr(raw?.suggestions).slice(0, 5),
    warnings: arr(raw?.warnings).slice(0, 5),
    summary: typeof raw?.summary === 'string' ? raw.summary : undefined,
  };
}
