/**
 * POST /api/preview-shot · v2.18 P1.3 — "试拍" 1 镜端到端预览
 *
 * 不创项目、不持久化、不走完整 8-agent 编排。给用户一个低成本"vibe check":
 *   30-60s 内拿到 1 张分镜图 (MJ) + (可选) 1 段 5s I2V 视频 (Minimax),
 *   让 ta 决定要不要走完整 pipeline (5-15 分钟 + 真消耗算力)。
 *
 * 入参:
 *   { idea: string,             // ≥10 字
 *     style?: string,           // 例如 'Anime 3D' / 'Cinematic'
 *     aspect?: string,          // '16:9' | '9:16' | '2.35:1' ...
 *     videoToo?: boolean }      // 默认 true; false = 只出图, 更快
 *
 * 出参:
 *   200 → { imageUrl, videoUrl?, prompt, elapsedMs, warnings[] }
 *   400 → { error } (idea 缺 / 太短 / 注入)
 *   422 → { error } (上游全跑挂)
 *
 * 计费考量:
 *   - 一次 MJ + 一次 Minimax I2V ≈ 几毛钱, 远低于完整 pipeline (¥3-10)
 *   - 不挡免费用户 — 这是"决定要不要付费跑全流程"的关键引导
 *
 * 用法 (前端): create 页 ROLL 旁边的 "先试拍" 按钮 → /api/preview-shot →
 * modal 显示结果 → "采用这个风格走全流程" / "调整再试" / "放弃"
 */

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getUserFromRequest } from '../auth/lib';
import { MidjourneyService, hasMidjourney } from '@/services/midjourney.service';
import { MinimaxService } from '@/services/minimax.service';
import { API_CONFIG } from '@/lib/config';
import { checkPlan } from '@/lib/plan-gate';
import {
  getQuotaState,
  insertPreview,
  PREVIEW_DAILY_LIMIT,
  type Tier,
} from '@/lib/preview-history';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 180; // 3 分钟封顶 — 单图 + 单视频通常 30-90s

function resolveUserId(request: Request): string {
  const payload = getUserFromRequest(request);
  if (payload?.sub) return payload.sub;
  const firstUser = db.prepare('SELECT id FROM users ORDER BY created_at ASC LIMIT 1').get() as
    | { id: string }
    | undefined;
  return firstUser?.id || 'demo-user';
}

const ASPECT_TO_RATIO: Record<string, string> = {
  '16:9': '16:9',
  '9:16': '9:16',
  '1:1': '1:1',
  '2.35:1': '2.35:1',
  '4:3': '4:3',
};

export async function POST(request: NextRequest) {
  const userId = resolveUserId(request);

  let body: any = {};
  try { body = await request.json(); } catch { /* swallow */ }

  const rawIdea = typeof body?.idea === 'string' ? body.idea.trim() : '';
  const style = typeof body?.style === 'string' ? body.style.trim().slice(0, 80) : 'Cinematic';
  const aspectInput = typeof body?.aspect === 'string' ? body.aspect.trim() : '16:9';
  const aspect = ASPECT_TO_RATIO[aspectInput] || '16:9';
  const videoToo = body?.videoToo !== false; // 默认 true

  if (!rawIdea) return NextResponse.json({ error: '缺 idea' }, { status: 400 });
  if (rawIdea.length < 10) return NextResponse.json({ error: 'idea 至少 10 个字符' }, { status: 400 });
  if (rawIdea.length > 2000) return NextResponse.json({ error: 'idea 太长(上限 2000)' }, { status: 400 });

  // v2.18 P2.1: rate-limit — 按 tier × day 算配额
  // 用 checkPlan 借现成 user→tier 映射 (即便用户当前层不需 plan-gate, 这里只读 tier)
  const tierProbe = checkPlan(request, 'free');
  const userTier: Tier = (tierProbe.current as Tier) || 'free';
  const quota = await getQuotaState(userId, userTier);
  if (quota.blocked) {
    return NextResponse.json(
      {
        error: `今天的试拍次数已用完 (${quota.used}/${quota.limit}, ${userTier} 档每天 ${quota.limit} 次). 升级会增加配额, 也欢迎明天再试。`,
        rateLimit: {
          tier: userTier,
          used: quota.used,
          limit: quota.limit,
          remaining: 0,
        },
      },
      { status: 429 }, // Too Many Requests
    );
  }

  // v2.13.4 安全闸门 (复用)
  const { checkAndSanitize } = await import('@/lib/prompt-guardrails');
  const verdict = checkAndSanitize(rawIdea, { task: 'creation' });
  if (!verdict.ok) {
    console.warn(`[preview-shot] guardrail blocked: ${verdict.category}/${verdict.reason}`);
    return NextResponse.json(
      { error: verdict.userMessage, category: verdict.category },
      { status: 400 },
    );
  }

  // v2.18: 规则清洗 (不调 LLM, 试拍要快)
  const { normalizeIdeaRule } = await import('@/lib/idea-normalizer');
  const cleanedIdea = normalizeIdeaRule(verdict.sanitized);

  // 拼一个简短的视觉 prompt — 不调 LLM, 直接用 idea + 画风模板
  // 故意保持 ≤ 200 字, 让上游 API 快速吃下不超 token
  const visualPrompt = buildPreviewVisualPrompt(cleanedIdea, style, aspect);

  console.log(`[preview-shot] user=${userId} style=${style} aspect=${aspect} videoToo=${videoToo} prompt="${visualPrompt.slice(0, 80)}..."`);

  // v9.3.4: 预算护栏硬拦截 — 到月度硬上限则拦 (试拍粗估: 图 ~¥0.3, +视频段 ~¥1.5)
  const { assertBudget } = await import('@/lib/budget-enforce');
  const budgetCheck = await assertBudget({ userId, pendingCostCny: videoToo ? 1.8 : 0.3 });
  if (!budgetCheck.allow) {
    return NextResponse.json(
      { error: budgetCheck.guard.message, guard: budgetCheck.guard },
      { status: 402 }, // Payment Required — 月度预算硬上限
    );
  }

  const t0 = Date.now();
  const warnings: string[] = [];

  // ── Step 1: MJ 出 1 张分镜图 ──
  let imageUrl = '';
  if (!hasMidjourney()) {
    return NextResponse.json(
      { error: 'MIDJOURNEY 未配置, 试拍依赖 MJ 出图' },
      { status: 422 },
    );
  }
  try {
    const mj = new MidjourneyService();
    imageUrl = await mj.generateImage(visualPrompt, {
      aspectRatio: aspect,
      // 试拍跳过 upscale, 直接拿 grid 即可 (省时间, 成本低)
      skipUpscale: true,
    });
    if (!imageUrl) throw new Error('MJ 返回空 imageUrl');
    console.log(`[preview-shot] image done: ${imageUrl.slice(0, 80)}`);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json(
      { error: `试拍出图失败: ${msg.slice(0, 200)}` },
      { status: 422 },
    );
  }

  // ── Step 2 (optional): Minimax I2V 1 段 5s ──
  let videoUrl: string | undefined;
  if (videoToo) {
    if (!API_CONFIG.minimax.apiKey) {
      warnings.push('MINIMAX_API_KEY 未配置, 跳过视频生成 (只返图片)');
    } else {
      try {
        const motionPrompt = `${visualPrompt}\n\nCamera: subtle slow push-in, smooth ease-in-out. ` +
          `Maintain photographic realism, preserve original lighting and color palette of the input image. ` +
          `Avoid: morphing artifacts, face distortion, hand mutation.`;
        const minimax = new MinimaxService();
        videoUrl = await minimax.generateVideo(imageUrl, motionPrompt, { duration: 5 });
        if (!videoUrl) throw new Error('Minimax 返回空 videoUrl');
        console.log(`[preview-shot] video done: ${videoUrl.slice(0, 80)}`);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        warnings.push(`视频生成失败 (但图片成功): ${msg.slice(0, 120)}`);
        // 不阻塞 — 至少把图给用户
      }
    }
  }

  const elapsedMs = Date.now() - t0;
  console.log(`[preview-shot] user=${userId} done in ${elapsedMs}ms, image=ok, video=${videoUrl ? 'ok' : 'skip/fail'}`);

  // v2.18 P2.2: 持久化到 preview_history (供 rate-limit 计数 + UI 历史面板用)
  let savedId: string | undefined;
  try {
    const saved = await insertPreview({
      userId,
      idea: cleanedIdea,
      style,
      aspect,
      imageUrl,
      videoUrl: videoUrl || null,
      prompt: visualPrompt,
      elapsedMs,
      warnings,
    });
    savedId = saved.id;
  } catch (e) {
    console.warn('[preview-shot] persist history failed (non-fatal):', e instanceof Error ? e.message : e);
  }

  // 重新拉一次配额 (insertPreview 后 used+1) — 让前端能立即更新 chip
  const updatedQuota = await getQuotaState(userId, userTier);

  return NextResponse.json({
    historyId: savedId,
    imageUrl,
    videoUrl,
    prompt: visualPrompt,
    style,
    aspect,
    elapsedMs,
    warnings,
    rateLimit: {
      tier: userTier,
      used: updatedQuota.used,
      limit: updatedQuota.limit,
      remaining: updatedQuota.remaining,
    },
  });
}

/**
 * 把 idea + style + aspect 拼成一句"可直接喂 MJ"的视觉 prompt。
 * 故意省略 character / scene 多 reference 等高级特性 — 试拍重点是"风格 vibe", 不是"角色一致性"。
 */
function buildPreviewVisualPrompt(idea: string, style: string, aspect: string): string {
  // 取 idea 第一句 / 前 100 字作为镜头主体
  const firstSentence = idea.split(/[。.!?！?\n]/)[0].slice(0, 120) || idea.slice(0, 120);
  const styleHint = style && style !== 'Cinematic' ? `, ${style} style` : ', cinematic style';
  const aspectHint = `, ${aspect} aspect ratio`;
  return `A single key shot from a short drama: ${firstSentence}${styleHint}${aspectHint}, ` +
    `professional cinematography, dramatic lighting, high detail, masterpiece quality.`;
}
