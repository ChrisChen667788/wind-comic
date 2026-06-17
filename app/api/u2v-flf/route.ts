/**
 * POST /api/u2v-flf · v2.14 P0.3 — 首尾帧融合视频生成
 *
 * 用户给两张图(首帧 + 尾帧)+ 一句运动描述, Kling 自动补中间运动。
 * 失败时降级到普通 I2V (用 firstFrame 单图走 /api/u2v 的相同链路)。
 *
 * 入参:
 *   { firstFrameUrl: string,    // http(s) / data: / /api/serve-file?key=xxx
 *     lastFrameUrl:  string,    // 同上
 *     prompt: string,           // 运动描述, 如 "镜头从左推到右"
 *     duration?: 5 | 10 }       // 默认 5s, Kling FLF 上限 10s
 *
 * 出参:
 *   200 → { videoUrl, duration, model: 'Kling-FLF' | 'Minimax-I2V-01-fallback' }
 *   400 → { error } (缺字段 / 协议非法)
 *   422 → { error } (Kling 配置缺 + Minimax 也跑不通时)
 */

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getUserFromRequest } from '../auth/lib';
import { KlingService } from '@/services/kling.service';
import { MinimaxService } from '@/services/minimax.service';
import { API_CONFIG } from '@/lib/config';
import { persistAsset } from '@/lib/asset-storage';
import { checkPlan, planRejection, requiredTierForVideoDuration } from '@/lib/plan-gate';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

function resolveUserId(request: Request): string {
  const payload = getUserFromRequest(request);
  if (payload?.sub) return payload.sub;
  const firstUser = db.prepare('SELECT id FROM users ORDER BY created_at ASC LIMIT 1').get() as
    | { id: string }
    | undefined;
  return firstUser?.id || 'demo-user';
}

export async function POST(request: NextRequest) {
  const userId = resolveUserId(request);

  let body: any = {};
  try { body = await request.json(); } catch { /* swallow */ }

  const firstFrameUrl = typeof body?.firstFrameUrl === 'string' ? body.firstFrameUrl.trim() : '';
  const lastFrameUrl = typeof body?.lastFrameUrl === 'string' ? body.lastFrameUrl.trim() : '';
  const rawPrompt = typeof body?.prompt === 'string' ? body.prompt.trim() : '';
  const duration: 5 | 10 = body?.duration === 10 ? 10 : 5;
  const cameraPreset = typeof body?.cameraPreset === 'string' ? body.cameraPreset : null;

  if (!firstFrameUrl) return NextResponse.json({ error: '缺 firstFrameUrl' }, { status: 400 });
  if (!lastFrameUrl) return NextResponse.json({ error: '缺 lastFrameUrl' }, { status: 400 });
  if (!rawPrompt) return NextResponse.json({ error: '缺 prompt' }, { status: 400 });
  for (const url of [firstFrameUrl, lastFrameUrl]) {
    if (!/^(https?:|data:|\/api\/serve-file)/i.test(url)) {
      return NextResponse.json({ error: 'frame URL 协议非法' }, { status: 400 });
    }
  }
  if (rawPrompt.length > 500) {
    return NextResponse.json({ error: 'prompt 太长(上限 500 字)' }, { status: 400 });
  }

  // v12.4.1: 预算硬上限护栏 —— FLF 视频端点接入(生成前拦,超限不发生费用)。
  {
    const { assertBudget } = await import('@/lib/budget-enforce');
    const b = await assertBudget({ userId, pendingCostCny: Math.max(1.8, duration * 0.3) });
    if (!b.allow) return NextResponse.json({ error: b.guard.message, code: 'budget_exceeded', guard: b.guard }, { status: 402 });
  }

  // v2.16 P0.1: 计费 gate — FLF 默认 5s 免费; 用户挑 10s FLF (走 Kling 重) 走 creator+
  const requiredTier = requiredTierForVideoDuration(duration);
  if (requiredTier !== 'free') {
    const gate = checkPlan(request, requiredTier);
    if (!gate.ok) {
      console.warn(`[u2v-flf] plan-gate blocked: user=${gate.userId} tier=${gate.current} req=${requiredTier} duration=${duration}`);
      return planRejection(gate.current, gate.required);
    }
  }

  // v2.13.4 安全闸门 + v2.14 P0.2 镜头语言增强
  const { checkAndSanitize } = await import('@/lib/prompt-guardrails');
  const verdict = checkAndSanitize(rawPrompt, { task: 'u2v-motion' });
  if (!verdict.ok) {
    console.warn(`[u2v-flf] guardrail blocked: ${verdict.category}/${verdict.reason}`);
    return NextResponse.json({ error: verdict.userMessage, category: verdict.category }, { status: 400 });
  }
  const { enhanceU2VMotionPrompt } = await import('@/lib/prompt-templates');
  const prompt = enhanceU2VMotionPrompt(verdict.sanitized, cameraPreset || undefined);

  // Kling 是首选; 没配就直接降级到 Minimax 单图 I2V (用 firstFrame)
  const klingReady =
    API_CONFIG.keling.apiKey && !API_CONFIG.keling.apiKey.startsWith('your_');
  const minimaxReady =
    API_CONFIG.minimax.apiKey && !API_CONFIG.minimax.apiKey.startsWith('your_');

  if (!klingReady && !minimaxReady) {
    return NextResponse.json(
      { error: 'KELING_API_KEY / MINIMAX_API_KEY 都未配置, 无法生成视频' },
      { status: 422 },
    );
  }

  try {
    // 把所有"非外网绝对 URL"标准化成绝对 http URL (Minimax/Kling 都不能 fetch 相对 URL)
    const host = request.headers.get('host') || 'localhost:3000';
    const proto = request.headers.get('x-forwarded-proto') || 'http';
    const toAbsolute = (rel: string) =>
      rel.startsWith('http') ? rel : `${proto}://${host}${rel.startsWith('/') ? '' : '/'}${rel}`;

    const resolveOne = async (raw: string): Promise<string> => {
      if (raw.startsWith('data:')) {
        const persisted = await persistAsset(raw);
        if (!persisted) throw new Error('data URI 落盘失败');
        return toAbsolute(persisted.url);
      }
      if (!raw.startsWith('http')) return toAbsolute(raw);
      return raw;
    };

    const [firstAbs, lastAbs] = await Promise.all([
      resolveOne(firstFrameUrl),
      resolveOne(lastFrameUrl),
    ]);
    console.log(`[U2V-FLF] frames resolved: ${firstAbs.slice(0, 60)} → ${lastAbs.slice(0, 60)}`);

    // ── 首选:Kling 首尾帧 ──
    if (klingReady) {
      try {
        const k = new KlingService();
        const videoUrl = await k.generateFirstLastFrame(firstAbs, lastAbs, prompt, {
          duration,
          mode: 'professional',
        });
        if (videoUrl) {
          console.log(`[U2V-FLF] user=${userId} Kling FLF ok → ${videoUrl.slice(0, 80)}`);
          return NextResponse.json({ videoUrl, duration, model: 'Kling-FLF' });
        }
      } catch (e) {
        console.warn('[U2V-FLF] Kling failed, fallback to Minimax single-frame I2V:', e instanceof Error ? e.message : e);
      }
    }

    // ── 兜底:Minimax 单图 I2V (只用 firstFrame, 不真融合, 但至少有视频) ──
    if (minimaxReady) {
      const svc = new MinimaxService();
      const videoUrl = await svc.generateVideo(firstAbs, prompt, { duration: duration === 10 ? 6 : 5 });
      if (!videoUrl) {
        return NextResponse.json({ error: 'Minimax 兜底也返回空 URL' }, { status: 422 });
      }
      console.log(`[U2V-FLF] user=${userId} Minimax fallback ok → ${videoUrl.slice(0, 80)}`);
      return NextResponse.json({
        videoUrl,
        duration: duration === 10 ? 6 : 5,
        model: 'Minimax-I2V-01-fallback',
        warning: 'Kling FLF 不可用, 已降级到 Minimax 单图 I2V (只用首帧, 不真做首尾帧融合)',
      });
    }

    return NextResponse.json({ error: '所有可用视频引擎都失败' }, { status: 422 });
  } catch (e) {
    console.error('[U2V-FLF] failed:', e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'FLF 失败' },
      { status: 422 },
    );
  }
}
