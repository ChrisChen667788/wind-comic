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
import { requireProjectAccess } from '@/lib/auth-guard';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function parseJson(raw: string | null | undefined): any {
  try { return raw ? JSON.parse(raw) : null; } catch { return null; }
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  // v12.230(鉴权复扫收口):v12.218「鉴权总修」只修了对抗报告点名的端点,
  // 未系统复扫 projects/[id]/** —— 本路由当时漏网,任何人知道 projectId 即可调用。
  const _g = await requireProjectAccess(request, id, 'view');
  if (!_g.ok) return NextResponse.json({ message: _g.message }, { status: _g.status });


  // v12.368:**两个问题一起修。**
  //
  // ① 没配 IMAGE_EMBED_MODEL 就直接返回不可用 —— v12.350 把面板接了线,
  //    却因此永远显示「暂不可用」,等于接了个看不到数字的按钮。
  //    现在降级到**本地签名**(ffmpeg 把图缩到 8×8 取 RGB,192 维),
  //    零 API、零额度。能力边界如实标注,见下方 `method` 字段。
  //
  // ② 原来只收 `^https?://` 的 URL,而本项目的分镜图是 `/api/serve-file?key=…`
  //    ——**即使配了嵌入模型,也会 0 张合格**,直接报「分镜图不足 2 张」。
  //    这是个静默失效:看起来像「素材不够」,其实是过滤条件写错了。
  const useEmbedding = hasImageEmbeddingKey();

  const rows = await listAssetsByType(id, 'storyboard');
  const shots = rows
    .map((r) => {
      const mediaUrls = parseJson((r as any).media_urls) || [];
      const url = (r as any).persistent_url || mediaUrls[0] || '';
      const shotNumber = (r as any).shot_number ?? parseJson((r as any).data)?.shotNumber;
      return { shotNumber, url };
    })
    .filter((s) => typeof s.shotNumber === 'number' && !!s.url);

  if (shots.length < 2) {
    return NextResponse.json({ available: false, reason: '可探测分镜图不足 2 张' });
  }

  const embeddings: ShotEmbedding[] = [];

  if (useEmbedding) {
    // 并发(2 路)嵌入,避免压垮端点。远端嵌入只吃 http(s)。
    const queue = shots.filter((s) => /^https?:\/\//.test(s.url));
    async function worker() {
      for (;;) {
        const s = queue.shift();
        if (!s) break;
        const emb = await embedImage(s.url);
        if (emb) embeddings.push({ shotNumber: s.shotNumber, vector: emb.vector });
      }
    }
    await Promise.all([worker(), worker()]);
  }

  // 远端嵌入没配、或一张都没成功(比如素材全是本地 serve-file)→ 本地签名兜底
  let method: 'embedding' | 'local-signature' = 'embedding';
  if (embeddings.length < 2) {
    const { resolveByKey } = await import('@/lib/asset-storage');
    const { imageSignatures } = await import('@/lib/image-signature');
    const local = shots.map((s) => {
      const m = String(s.url).match(/key=([0-9a-zA-Z_-]+)/);
      return { shot: s, absPath: m ? resolveByKey(m[1])?.absPath || '' : '' };
    }).filter((x) => !!x.absPath);

    if (local.length >= 2) {
      const sigs = await imageSignatures(local.map((x) => x.absPath));
      embeddings.length = 0;
      sigs.forEach((v, i) => { if (v) embeddings.push({ shotNumber: local[i].shot.shotNumber, vector: v }); });
      method = 'local-signature';
    }
  }

  const drift = detectDriftOutliers(embeddings);
  if (!drift.available) {
    return NextResponse.json({ available: false, reason: '成功嵌入的分镜图不足 2 张(端点不兼容?),退回 LLM 评分' });
  }

  return NextResponse.json({
    available: true,
    // v12.368:**说清这组数字是怎么来的**。本地签名抓调色/明暗/构图跑偏,
    // 抓不到「同色调下人物的脸变了」—— 那需要语义模型。不标注就会被当成等价物。
    method,
    methodNote: method === 'local-signature'
      ? '本地色彩/构图签名(未配 IMAGE_EMBED_MODEL)—— 能发现调色与构图跑偏,发现不了同色调下的人物走形'
      : '语义嵌入',
    embeddedCount: embeddings.length,
    totalShots: shots.length,
    meanDrift: Math.round(drift.meanDrift * 1000) / 1000,
    outliers: drift.outliers,            // 漂移最大的镜号(建议重生)
    scores: drift.scores.map((x) => ({ shotNumber: x.shotNumber, driftScore: Math.round(x.driftScore * 1000) / 1000 })),
  });
}
