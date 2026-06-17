/**
 * POST /api/u2v · Sprint C.1 — 单图 → 视频(Image-to-Video)独立功能
 *
 * 不进创作工坊主管线 —— 用户上传一张静帧 + 文本提示, 直接走 Minimax I2V-01
 * 拿到一段 5s 视频 URL 返回。给 "我有一张图想动起来" 这种轻量场景用。
 *
 * 入参:
 *   { imageUrl: string,        // http(s) / data: / /api/serve-file?key=xxx
 *     prompt: string,          // 描述如何让画面动 ("人物缓缓抬头" 等)
 *     duration?: 5 | 6 }       // 默认 5s
 *
 * 出参:
 *   200 → { videoUrl: string, duration: number, model: 'I2V-01' }
 *   400 → { error } (缺字段 / imageUrl 协议非法)
 *   422 → { error } (Minimax 配置缺 / 上游失败)
 *
 * Auth: JWT 优先, 缺时 fallback 到 DB 第一个用户(Demo 模式)。
 */

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getUserFromRequest } from '../auth/lib';
import { MinimaxService } from '@/services/minimax.service';
import { KlingService } from '@/services/kling.service';
import { ViduService } from '@/services/vidu.service';
import { API_CONFIG } from '@/lib/config';
import { persistAsset } from '@/lib/asset-storage';
import { checkPlan, planRejection, requiredTierForVideoDuration } from '@/lib/plan-gate';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300; // 上限 5 分钟,Minimax I2V 通常 1-3 分钟出

/**
 * v2.14 P0.4: duration → 模型路由表。
 *   5/6s  → Minimax I2V-01 (现有主力)
 *   10s   → Kling Master   (kling-v1, mode=professional)
 *   15s   → Vidu Q3 Pro    (16s 上限内最接近)
 * 每档若主模型挂掉, 自动降级链: Kling/Vidu → Minimax 5s 兜底, 让用户至少拿到一段视频。
 */
export async function routeVideoByDuration(
  imageUrl: string,
  prompt: string,
  duration: number,
  onProgress?: (pct: number, msg?: string) => void,  // v4.1.4: Kling 真实进度回调
): Promise<{ videoUrl: string; model: string }> {
  // 5/6s → Minimax 主路径
  if (duration === 5 || duration === 6) {
    const svc = new MinimaxService();
    const v = await svc.generateVideo(imageUrl, prompt, { duration });
    return { videoUrl: v, model: 'Minimax-I2V-01' };
  }
  // 10s → Kling Master, 失败回 Minimax 6s
  if (duration === 10) {
    if (API_CONFIG.keling.apiKey && !API_CONFIG.keling.apiKey.startsWith('your_')) {
      try {
        const k = new KlingService();
        const v = await k.generateVideo(imageUrl, prompt, { duration: 10, mode: 'professional', onProgress });
        return { videoUrl: v, model: 'Kling-Master-10s' };
      } catch (e) {
        console.warn('[U2V] Kling 10s failed, falling back to Minimax 6s:', e instanceof Error ? e.message : e);
      }
    }
    const svc = new MinimaxService();
    const v = await svc.generateVideo(imageUrl, prompt, { duration: 6 });
    return { videoUrl: v, model: 'Minimax-I2V-01-fallback-6s' };
  }
  // 15s → Vidu Q3 Pro, 失败回 Kling 10s, 再失败回 Minimax 6s
  if (duration === 15) {
    if (API_CONFIG.vidu.apiKey && !API_CONFIG.vidu.apiKey.startsWith('your_')) {
      try {
        const vd = new ViduService();
        const v = await vd.generateVideo(imageUrl, prompt, { duration: 15 });
        return { videoUrl: v, model: 'Vidu-Q3-Pro-15s' };
      } catch (e) {
        console.warn('[U2V] Vidu 15s failed, trying Kling 10s:', e instanceof Error ? e.message : e);
      }
    }
    if (API_CONFIG.keling.apiKey && !API_CONFIG.keling.apiKey.startsWith('your_')) {
      try {
        const k = new KlingService();
        const v = await k.generateVideo(imageUrl, prompt, { duration: 10, mode: 'professional', onProgress });
        return { videoUrl: v, model: 'Kling-Master-10s-fallback' };
      } catch (e) {
        console.warn('[U2V] Kling 10s also failed, falling back to Minimax 6s:', e instanceof Error ? e.message : e);
      }
    }
    const svc = new MinimaxService();
    const v = await svc.generateVideo(imageUrl, prompt, { duration: 6 });
    return { videoUrl: v, model: 'Minimax-I2V-01-fallback-6s' };
  }
  // 不在白名单 → 5s 默认
  const svc = new MinimaxService();
  const v = await svc.generateVideo(imageUrl, prompt, { duration: 5 });
  return { videoUrl: v, model: 'Minimax-I2V-01-default-5s' };
}

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

  const imageUrl = typeof body?.imageUrl === 'string' ? body.imageUrl.trim() : '';
  const rawPrompt = typeof body?.prompt === 'string' ? body.prompt.trim() : '';
  // v2.14 P0.4: 长镜头模式 — 5/6/10/15s, 后端按 duration 选模型 (无效值兜底 5s)
  const duration = [5, 6, 10, 15].includes(body?.duration) ? body.duration : 5;
  // v2.14 P0.2: 镜头语言预设 id (来自 CAMERA_LANGUAGE_PRESETS), 可空
  const cameraPreset = typeof body?.cameraPreset === 'string' ? body.cameraPreset : null;

  if (!imageUrl) return NextResponse.json({ error: '缺 imageUrl' }, { status: 400 });
  if (!rawPrompt) return NextResponse.json({ error: '缺 prompt' }, { status: 400 });
  // 只允许 http(s) / data: / 内部 serve-file 路径,挡掉 file:// 之类
  if (!/^(https?:|data:|\/api\/serve-file)/i.test(imageUrl)) {
    return NextResponse.json({ error: 'imageUrl 协议非法' }, { status: 400 });
  }
  if (rawPrompt.length > 500) {
    return NextResponse.json({ error: 'prompt 太长(上限 500 字)' }, { status: 400 });
  }

  // v12.4.1: 预算硬上限护栏 —— 接入主管线视频端点(放在生成前,超限不发生费用)。
  {
    const { assertBudget } = await import('@/lib/budget-enforce');
    const b = await assertBudget({ userId, pendingCostCny: Math.max(1.8, duration * 0.3) });
    if (!b.allow) return NextResponse.json({ error: b.guard.message, code: 'budget_exceeded', guard: b.guard }, { status: 402 });
  }

  // v2.16 P0.1: 计费 gate — 阻止免费用户消费 Kling/Vidu 高单价 API。
  // 5/6s → free / 10s → creator / 15s → pro (Vidu ¥0.3/秒, 100 次烧 ¥2700+)。
  const requiredTier = requiredTierForVideoDuration(duration);
  if (requiredTier !== 'free') {
    const gate = checkPlan(request, requiredTier);
    if (!gate.ok) {
      console.warn(`[u2v] plan-gate blocked: user=${gate.userId} tier=${gate.current} req=${requiredTier} duration=${duration}`);
      return planRejection(gate.current, gate.required);
    }
  }

  // v2.13.4: 安全闸门 + 提示词增强(运动描述加运镜词汇)
  const { checkAndSanitize } = await import('@/lib/prompt-guardrails');
  const verdict = checkAndSanitize(rawPrompt, { task: 'u2v-motion' });
  if (!verdict.ok) {
    console.warn(`[u2v] guardrail blocked: ${verdict.category}/${verdict.reason}`);
    return NextResponse.json({ error: verdict.userMessage, category: verdict.category }, { status: 400 });
  }
  const { enhanceU2VMotionPrompt } = await import('@/lib/prompt-templates');
  const prompt = enhanceU2VMotionPrompt(verdict.sanitized, cameraPreset || undefined);

  if (!API_CONFIG.minimax.apiKey) {
    return NextResponse.json(
      { error: 'MINIMAX_API_KEY 未配置, 无法跑 I2V' },
      { status: 422 },
    );
  }

  try {
    // v2.13.5: 把任何"非外网绝对 URL"的输入都转成绝对 URL,
    //   - data: URI → 落盘 → 绝对 URL
    //   - /api/serve-file?key=xxx 相对路径 → 拼绝对 URL
    //   - http(s):// 直链 → 原样透传
    // 之前只处理了 data: 路径, 用户从前一步上传产物里拿到的 /api/serve-file 相对 URL
    // 直接送进 Minimax 后被静默忽略,导致"参考图变 T2V"问题。
    let resolvedImageUrl = imageUrl;
    const host = request.headers.get('host') || 'localhost:3000';
    const proto = request.headers.get('x-forwarded-proto') || 'http';
    const toAbsolute = (rel: string) =>
      rel.startsWith('http') ? rel : `${proto}://${host}${rel.startsWith('/') ? '' : '/'}${rel}`;

    if (imageUrl.startsWith('data:')) {
      const persisted = await persistAsset(imageUrl);
      if (!persisted) {
        return NextResponse.json({ error: 'data URI 落盘失败' }, { status: 422 });
      }
      // persistAsset 给的是 /api/serve-file?key=xxx 内部 URL — minimax 拿不到外网,需要绝对 URL。
      // 但本端点定位是 demo,生产环境推荐先把图传到外部 CDN 再调本端点。
      resolvedImageUrl = toAbsolute(persisted.url);
    } else if (!imageUrl.startsWith('http')) {
      // 相对路径(/api/serve-file?key=xxx 等)→ 拼绝对 URL,Minimax 才能 fetch
      resolvedImageUrl = toAbsolute(imageUrl);
    }
    console.log(`[U2V] image source resolved: ${imageUrl.slice(0, 60)} → ${resolvedImageUrl.slice(0, 80)}`);

    // v2.14 P0.4: 长镜头模式路由 — 5/6s → Minimax I2V-01, 10s → Kling Master, 15s → Vidu Q3 Pro。
    // 每档失败时降级到下一档(优先长镜头不可得 → 5s I2V 兜底)。
    const { videoUrl, model } = await routeVideoByDuration(resolvedImageUrl, prompt, duration);
    if (!videoUrl) {
      return NextResponse.json({ error: '所有可用模型都返回空视频 URL' }, { status: 422 });
    }
    console.log(`[U2V] user=${userId} duration=${duration}s model=${model} ok → ${videoUrl.slice(0, 80)}`);
    return NextResponse.json({ videoUrl, duration, model });
  } catch (e) {
    console.error('[U2V] failed:', e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'I2V 失败' },
      { status: 422 },
    );
  }
}
