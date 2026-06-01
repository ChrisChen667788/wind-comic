/**
 * v9.1.1 — 分发包生成端点.
 *
 * GET  → 已落库的分发包 (project_assets type='distribution') 或 null
 * POST { platforms: PlatformId[] } → 读剧本 → buildDistributionPrompt → LLM (fast)
 *        → parseDistributionPack → 覆盖落库 → 返回 pack + 纯文本 + degraded
 */
import { NextRequest, NextResponse } from 'next/server';
import { listAssetsByType, deleteAssetsByType, createAsset } from '@/lib/repos/asset-repo';
import { getProject } from '@/lib/repos/project-repo';
import { callLLMWithFallback } from '@/lib/llm-client';
import {
  buildDistributionPrompt, parseDistributionPack, distributionPackToText,
  isPlatformId, type PlatformId,
} from '@/lib/distribution';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const rows = await listAssetsByType(id, 'distribution');
  if (!rows.length) return NextResponse.json({ pack: null });
  try { return NextResponse.json({ pack: JSON.parse(rows[0].data) }); }
  catch { return NextResponse.json({ pack: null }); }
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const proj = await getProject(id);
  if (!proj) return NextResponse.json({ error: '项目不存在' }, { status: 404 });

  const body = await request.json().catch(() => ({} as any));
  const requested: PlatformId[] = (Array.isArray(body?.platforms) ? body.platforms : []).filter(isPlatformId);
  const platforms: PlatformId[] = requested.length ? requested : (['douyin', 'xiaohongshu', 'shipinhao'] as PlatformId[]);

  // 读剧本资产 (synopsis/题材/钩子); 缺则退回 project meta
  let title = proj.title;
  let synopsis = proj.description || '';
  let genre = '';
  let hooks: string[] = [];
  const scripts = await listAssetsByType(id, 'script');
  if (scripts.length) {
    try {
      const d = JSON.parse(scripts[0].data || '{}');
      if (d.title) title = d.title;
      if (d.synopsis) synopsis = d.synopsis;
      if (d.theme) genre = d.theme;
      if (Array.isArray(d.shots)) {
        hooks = d.shots.map((s: any) => s?.dialogue || s?.beat).filter(Boolean).slice(0, 5);
      }
    } catch { /* 用 project meta 兜底 */ }
  }
  if (!synopsis || synopsis.trim().length < 8) {
    return NextResponse.json({ error: '该项目还没有可用剧本/梗概, 先生成剧本再做分发包' }, { status: 400 });
  }

  const prompt = buildDistributionPrompt({ title, synopsis, genre, hooks, platforms });
  const res = await callLLMWithFallback({
    system: '你是资深短剧分发运营, 精通各平台标题/标签/钩子玩法。严格只输出 JSON, 不要任何多余文字。',
    user: prompt,
    fast: true,
  });
  if (!res.ok || !res.content) {
    return NextResponse.json({ error: res.error || 'LLM 生成失败, 请稍后再试' }, { status: 502 });
  }

  const pack = parseDistributionPack(res.content, platforms);

  // 覆盖式落库 (一项目一份分发包)
  const data = { ...pack, platformsRequested: platforms, generatedAt: new Date().toISOString() };
  await deleteAssetsByType(id, 'distribution');
  await createAsset({ projectId: id, type: 'distribution', name: '分发包', data });

  return NextResponse.json({ pack, text: distributionPackToText(pack), degraded: pack.degraded });
}
