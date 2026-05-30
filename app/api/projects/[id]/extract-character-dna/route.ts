/**
 * POST /api/projects/[id]/extract-character-dna · v2.24 D
 *
 * 重抽某个角色的 DNA — vision LLM 重跑 8 维特征抽取, 不重生角色图.
 * 用户场景: 第 1 次抽 DNA 时 vision 抽得不全 (e.g. eyeShape 空), 重抽看能否补全.
 *
 * body: { characterName: string }
 * 200 → { dna: { signature, filledCount, totalCount, missing, promptBlock } }
 * 404 → 角色 asset 不存在 / 没有图
 * 502 → vision 调用失败 / 没 OPENAI_API_KEY
 */

import { NextRequest, NextResponse } from 'next/server';
import { db, now } from '@/lib/db';
import { extractCharacterDna } from '@/lib/character-dna';
import { updateAsset } from '@/lib/repos/asset-repo';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: projectId } = await params;
  let body: { characterName?: string } = {};
  try { body = await request.json(); } catch { /* allow empty */ }
  const characterName = body?.characterName?.trim();
  if (!characterName) {
    return NextResponse.json({ error: 'characterName required' }, { status: 400 });
  }

  // 查 character asset
  const row = db.prepare(
    `SELECT id, media_urls, data FROM project_assets
     WHERE project_id = ? AND type = 'character' AND name = ?
     ORDER BY updated_at DESC LIMIT 1`,
  ).get(projectId, characterName) as { id: string; media_urls: string; data: string } | undefined;
  if (!row) {
    return NextResponse.json({ error: '角色不存在' }, { status: 404 });
  }
  let imageUrl: string | null = null;
  try {
    const urls = JSON.parse(row.media_urls || '[]');
    if (Array.isArray(urls) && urls[0] && typeof urls[0] === 'string') imageUrl = urls[0];
  } catch { /* ignore */ }
  if (!imageUrl || !imageUrl.startsWith('http')) {
    return NextResponse.json({ error: '角色图不存在或非 http URL, vision 无法抽取' }, { status: 404 });
  }

  const dna = await extractCharacterDna(characterName, imageUrl);
  if (!dna) {
    return NextResponse.json({ error: 'vision 抽取失败 — 检查 OPENAI_API_KEY 或网络' }, { status: 502 });
  }

  // 写回 asset.data.dna (merge, 不丢 description/appearance)
  let mergedData: any = {};
  try { mergedData = row.data ? JSON.parse(row.data) : {}; } catch { /* ignore */ }
  const sig = dna.signature;
  const dims: (keyof typeof sig)[] = [
    'eyeShape', 'jawShape', 'noseShape', 'mouthShape',
    'hairStyle', 'hairColor', 'skinTone', 'signatureOutfit',
  ];
  const filled = dims.filter((k) => sig[k] && (sig[k] as string).length > 0);
  const missing = dims.filter((k) => !sig[k] || (sig[k] as string).length === 0);
  mergedData.dna = {
    signature: sig,
    filledCount: filled.length,
    totalCount: dims.length,
    missing,
    extractedAt: now(),
  };
  await updateAsset(row.id, { data: mergedData });

  return NextResponse.json({
    dna: {
      signature: sig,
      filledCount: filled.length,
      totalCount: dims.length,
      missing,
      promptBlock: dna.promptBlock,
    },
  });
}
