import { NextResponse } from 'next/server';
import { getUserFromRequest } from '@/app/api/auth/lib';
import { getOwnedProject } from '@/lib/repos/project-repo';
import { listAssetsByType, upsertAsset } from '@/lib/repos/asset-repo';
import { buildAnyTextPayload, parseAnyTextResponse } from '@/lib/anytext-cover';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

/**
 * v12.97.0 — AnyText 封面:POST {title?, scenePrompt?, aspectRatio?} → BYO AnyText 端点出
 * 「中文文字长在设计里」的封面,落 anytext_cover 资产。title 缺省取 publish_copy.coverTitle。
 * ANYTEXT_API_URL 未配 → 503 + 启用指引(不连累主链)。
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const payload = getUserFromRequest(request);
  if (!payload) return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
  if (!(await getOwnedProject(id, payload.sub))) return NextResponse.json({ message: 'Forbidden' }, { status: 403 });

  const apiUrl = process.env.ANYTEXT_API_URL;
  if (!apiUrl) {
    return NextResponse.json({
      message: 'AnyText 端点未配置',
      howto: '部署 AnyText(ModelScope iic/cv_anytext_text_generation_editing,本地 GPU 或创空间)后设 ANYTEXT_API_URL 指向其推理接口(POST JSON → {imageUrl|image_base64})。',
    }, { status: 503 });
  }

  const body = await request.json().catch(() => ({} as any));
  let title: string = (body?.title || '').trim();
  if (!title) {
    const parse = (s: string | null): any => { try { return s ? JSON.parse(s) : {}; } catch { return {}; } };
    const copies = await listAssetsByType(id, 'publish_copy');
    title = parse(copies[0]?.data)?.coverTitle || '';
  }
  if (!title) return NextResponse.json({ message: '缺 title(或先跑 publish-copy 生成 coverTitle)' }, { status: 400 });

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 240_000);
    let r: Response;
    try {
      r = await fetch(apiUrl, {
        method: 'POST', signal: controller.signal,
        headers: { 'Content-Type': 'application/json', ...(process.env.ANYTEXT_API_KEY ? { Authorization: `Bearer ${process.env.ANYTEXT_API_KEY}` } : {}) },
        body: JSON.stringify(buildAnyTextPayload({ title, scenePrompt: body?.scenePrompt, aspectRatio: body?.aspectRatio || '9:16' })),
      });
    } finally { clearTimeout(timer); }
    if (!r.ok) return NextResponse.json({ message: `AnyText 端点 HTTP ${r.status}` }, { status: 502 });
    const imageUrl = parseAnyTextResponse(await r.json().catch(() => null));
    if (!imageUrl) return NextResponse.json({ message: 'AnyText 返回无法解析出图片' }, { status: 502 });

    await upsertAsset({ projectId: id, type: 'anytext_cover', name: `AnyText封面: ${title}`, data: { title }, mediaUrls: [imageUrl], persistentUrl: imageUrl.startsWith('http') ? imageUrl : null });
    return NextResponse.json({ ok: true, title, imageUrl: imageUrl.slice(0, 200) });
  } catch (e) {
    return NextResponse.json({ message: `AnyText 调用失败: ${e instanceof Error ? e.message : e}`.slice(0, 150) }, { status: 502 });
  }
}
