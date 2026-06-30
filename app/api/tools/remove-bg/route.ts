import { NextResponse } from 'next/server';
import { getUserFromRequest } from '@/app/api/auth/lib';
import { bgRemovalAvailable, removeBackground } from '@/lib/image-tools/bg-removal';
import fs from 'fs';
import path from 'path';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * v12.55.0 — 产品抠图工具(商用安全:rembg / 自托管 HTTP)。
 * POST { imageUrl, model? } → 透明 PNG 抠图,存 data/cutouts,回 serve URL。
 * 后端不可用(没装 rembg 也没配 BG_REMOVAL_URL)→ 503 + 启用指引(不连累主流程)。
 */
export async function POST(request: Request) {
  const payload = getUserFromRequest(request);
  if (!payload) return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });

  if (!bgRemovalAvailable()) {
    return NextResponse.json({
      message: '抠图后端未启用',
      howto: '二选一:① 部署机 pip install rembg(MIT,商用安全)使 PATH 有 rembg;② 自托管 rembg 服务并设 BG_REMOVAL_URL。',
    }, { status: 503 });
  }

  const body = await request.json().catch(() => ({} as any));
  const imageUrl: string = body?.imageUrl || '';
  if (!imageUrl) return NextResponse.json({ message: 'imageUrl 必填' }, { status: 400 });

  try {
    const outDir = path.join(process.cwd(), 'data', 'cutouts');
    const { outputPath, method } = await removeBackground(imageUrl, { model: body?.model, outputDir: outDir });
    if (!fs.existsSync(outputPath)) return NextResponse.json({ message: '抠图未产出文件' }, { status: 500 });
    const serveUrl = `/api/serve-file?path=${encodeURIComponent(outputPath)}`;
    return NextResponse.json({ ok: true, cutoutUrl: serveUrl, method });
  } catch (e) {
    return NextResponse.json({ message: `抠图失败: ${e instanceof Error ? e.message : String(e)}` }, { status: 500 });
  }
}
