/**
 * /api/projects/[id]/drift-check (v12.2.4) — 身份漂移检测(阶段二十一收官)。
 *
 * GET → 对项目所有 storyboard 分镜图取视觉 embedding → detectDriftOutliers
 *   → 返回漂移最大的 outlier 镜(画风/角色跑偏),可喂最弱镜重生入口。
 * 确定、可量化、抓渐进漂移,补 scoreShotConsistency(LLM 文字判断)的不足。
 * BYO:未配 IMAGE_EMBED_MODEL / 无 key → { available:false, reason }(诚实降级,前端退回 LLM 评分)。
 * 读免鉴权(与项目其它只读端点一致)。
 */
import { NextRequest, NextResponse } from 'next/server';
import { listAssetsByType } from '@/lib/repos/asset-repo';
import { embedImage, hasImageEmbeddingKey } from '@/lib/asset-embedding';
import { detectDriftOutliers, type ShotEmbedding } from '@/lib/drift-detect';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function parseJson(raw: string | null | undefined): any {
  try { return raw ? JSON.parse(raw) : null; } catch { return null; }
}

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  if (!hasImageEmbeddingKey()) {
    return NextResponse.json({
      available: false,
      reason: '未配置图像嵌入(IMAGE_EMBED_MODEL),漂移检测退回逐镜 LLM 一致性评分',
    });
  }

  const rows = await listAssetsByType(id, 'storyboard');
  const shots = rows
    .map((r) => {
      const mediaUrls = parseJson((r as any).media_urls) || [];
      const url = (r as any).persistent_url || mediaUrls[0] || '';
      const shotNumber = (r as any).shot_number ?? parseJson((r as any).data)?.shotNumber;
      return { shotNumber, url };
    })
    .filter((s) => typeof s.shotNumber === 'number' && /^https?:\/\//.test(s.url));

  if (shots.length < 2) {
    return NextResponse.json({ available: false, reason: '可探测分镜图不足 2 张' });
  }

  // 并发(2 路)嵌入,避免压垮端点
  const embeddings: ShotEmbedding[] = [];
  const queue = [...shots];
  async function worker() {
    for (;;) {
      const s = queue.shift();
      if (!s) break;
      const emb = await embedImage(s.url);
      if (emb) embeddings.push({ shotNumber: s.shotNumber, vector: emb.vector });
    }
  }
  await Promise.all([worker(), worker()]);

  const drift = detectDriftOutliers(embeddings);
  if (!drift.available) {
    return NextResponse.json({ available: false, reason: '成功嵌入的分镜图不足 2 张(端点不兼容?),退回 LLM 评分' });
  }

  return NextResponse.json({
    available: true,
    embeddedCount: embeddings.length,
    totalShots: shots.length,
    meanDrift: Math.round(drift.meanDrift * 1000) / 1000,
    outliers: drift.outliers,            // 漂移最大的镜号(建议重生)
    scores: drift.scores.map((x) => ({ shotNumber: x.shotNumber, driftScore: Math.round(x.driftScore * 1000) / 1000 })),
  });
}
