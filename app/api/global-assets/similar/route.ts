/**
 * /api/global-assets/similar (v12.2.3) — 跨集/跨项目「找相似资产」。
 *
 * GET ?q=<text>&type=character&k=5
 *   有 embedding key → 把 q 嵌入 → findSimilarGlobalAssets(向量余弦,按 model+dim 过滤)。
 *   无 key/MOCK/失败 → findSimilarGlobalAssetsByText(确定性文本兜底)。两路都按 user 隔离。
 *
 * 返回 { mode:'vector'|'text', results:[{ id,name,type,thumbnail,score,bible? }] }。
 * 用于建角色时 surface「你库里已有相似角色」→ 一键复用(防重复建 + 跨集漂移)。
 */
import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getUserFromRequest } from '../../auth/lib';
import { findSimilarGlobalAssets, findSimilarGlobalAssetsByText } from '@/lib/repos/global-asset-repo';
import { embedText } from '@/lib/asset-embedding';
import type { GlobalAsset, GlobalAssetType } from '@/types/agents';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const VALID_TYPES: GlobalAssetType[] = ['character', 'scene', 'style', 'prop', 'template'];

function resolveUserId(request: Request): string {
  const payload = getUserFromRequest(request);
  if (payload?.sub) return payload.sub;
  const firstUser = db.prepare('SELECT id FROM users ORDER BY created_at ASC LIMIT 1').get() as { id: string } | undefined;
  return firstUser?.id || 'demo-user';
}

function shape(r: { asset: GlobalAsset; score: number }) {
  const bible = (r.asset.metadata as any)?.bible;
  return {
    id: r.asset.id,
    name: r.asset.name,
    type: r.asset.type,
    thumbnail: r.asset.thumbnail || bible?.imageUrl || '',
    score: Math.round(r.score * 100) / 100,
    bible: bible ? { imageUrl: bible.imageUrl, role: bible.role, sampleFaces: bible.sampleFaces, hasDna: !!bible.dna?.promptBlock } : undefined,
  };
}

export async function GET(request: NextRequest) {
  try {
    const userId = resolveUserId(request);
    const q = (request.nextUrl.searchParams.get('q') || '').trim();
    const typeParam = request.nextUrl.searchParams.get('type') || undefined;
    const type = typeParam && (VALID_TYPES as string[]).includes(typeParam) ? (typeParam as GlobalAssetType) : undefined;
    const k = Math.min(Math.max(Number(request.nextUrl.searchParams.get('k') || 5), 1), 20);
    if (!q) return NextResponse.json({ mode: 'text', results: [] });

    // 优先向量(BYO);embedText 无 key/MOCK/失败 → null → 退回文本兜底
    const emb = await embedText(q);
    if (emb) {
      const vec = await findSimilarGlobalAssets(userId, { vector: emb.vector, model: emb.model }, { type, k, minScore: 0.3 });
      if (vec.length > 0) return NextResponse.json({ mode: 'vector', results: vec.map(shape) });
      // 向量库为空(还没嵌入过任何资产)→ 也退回文本,保证有结果
    }
    const text = await findSimilarGlobalAssetsByText(userId, q, { type, k, minScore: 0.3 });
    return NextResponse.json({ mode: 'text', results: text.map(shape) });
  } catch (e) {
    console.error('[global-assets/similar] failed:', e instanceof Error ? e.message : e);
    return NextResponse.json({ mode: 'text', results: [], error: 'similar lookup failed' }, { status: 200 });
  }
}
