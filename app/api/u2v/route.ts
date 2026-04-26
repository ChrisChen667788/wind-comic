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
import { API_CONFIG } from '@/lib/config';
import { persistAsset } from '@/lib/asset-storage';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300; // 上限 5 分钟,Minimax I2V 通常 1-3 分钟出

function resolveUserId(request: Request): string {
  const payload = getUserFromRequest(request);
  if (payload?.sub) return payload.sub;
  const firstUser = db.prepare('SELECT id FROM users LIMIT 1').get() as
    | { id: string }
    | undefined;
  return firstUser?.id || 'demo-user';
}

export async function POST(request: NextRequest) {
  const userId = resolveUserId(request);

  let body: any = {};
  try { body = await request.json(); } catch { /* swallow */ }

  const imageUrl = typeof body?.imageUrl === 'string' ? body.imageUrl.trim() : '';
  const prompt = typeof body?.prompt === 'string' ? body.prompt.trim() : '';
  const duration = [5, 6].includes(body?.duration) ? body.duration : 5;

  if (!imageUrl) return NextResponse.json({ error: '缺 imageUrl' }, { status: 400 });
  if (!prompt) return NextResponse.json({ error: '缺 prompt' }, { status: 400 });
  // 只允许 http(s) / data: / 内部 serve-file 路径,挡掉 file:// 之类
  if (!/^(https?:|data:|\/api\/serve-file)/i.test(imageUrl)) {
    return NextResponse.json({ error: 'imageUrl 协议非法' }, { status: 400 });
  }
  if (prompt.length > 500) {
    return NextResponse.json({ error: 'prompt 太长(上限 500 字)' }, { status: 400 });
  }

  if (!API_CONFIG.minimax.apiKey) {
    return NextResponse.json(
      { error: 'MINIMAX_API_KEY 未配置, 无法跑 I2V' },
      { status: 422 },
    );
  }

  try {
    // data URI 先 persistAsset → http URL,minimax 不接 data URI
    let resolvedImageUrl = imageUrl;
    if (imageUrl.startsWith('data:')) {
      const persisted = await persistAsset(imageUrl);
      if (!persisted) {
        return NextResponse.json({ error: 'data URI 落盘失败' }, { status: 422 });
      }
      // persistAsset 给的是 /api/serve-file?key=xxx 内部 URL — minimax 拿不到外网,需要绝对 URL。
      // 但本端点定位是 demo,生产环境推荐先把图传到外部 CDN 再调本端点。
      const host = request.headers.get('host') || 'localhost:3000';
      const proto = request.headers.get('x-forwarded-proto') || 'http';
      resolvedImageUrl = `${proto}://${host}${persisted.url}`;
    }

    const svc = new MinimaxService();
    const videoUrl = await svc.generateVideo(resolvedImageUrl, prompt, { duration });

    if (!videoUrl) {
      return NextResponse.json({ error: 'Minimax 返回空视频 URL' }, { status: 422 });
    }

    console.log(`[U2V] user=${userId} duration=${duration}s ok → ${videoUrl.slice(0, 80)}`);

    return NextResponse.json({
      videoUrl,
      duration,
      model: 'I2V-01',
    });
  } catch (e) {
    console.error('[U2V] failed:', e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'I2V 失败' },
      { status: 422 },
    );
  }
}
