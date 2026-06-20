/**
 * POST /api/series/[id]/generate (阶段二十六 · v12.18.0) —— 逐集自动批量生成。
 *
 * 用 runPool(有界并发)驱动整季生成:每集走既有单集管线 `runCreatePipeline`(premise 作创意,
 * 继承锚点的画风/锁脸/主角参考 → 跨集一致)。后台 fire-and-forget(持久 Node server 下存活),
 * 立即返回 started 数;前端轮询 `GET /api/series/[id]` 看各集 draft→active→completed。
 *
 * 安全:登录 + 只动本人名下该系列的集。body.force=true 可重生已出的集。
 * 并发由 SERIES_CONCURRENCY 调(默认 1,逐集串行 —— 整片生成很重,避免轰炸上游/超预算)。
 */
import { NextResponse } from 'next/server';
import { getUserFromRequest } from '../../../auth/lib';
import { listSeriesEpisodesFull, setEpisodeStatus } from '@/lib/repos/series-repo';
import { selectGeneratableEpisodes } from '@/lib/series';
import { runPool } from '@/lib/season-orchestrator';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

function parseArr(raw: string | null | undefined): any[] { try { const v = raw ? JSON.parse(raw) : []; return Array.isArray(v) ? v : []; } catch { return []; } }

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const payload = getUserFromRequest(request);
  if (!payload?.sub) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const userId = payload.sub;

  let body: any = {}; try { body = await request.json(); } catch {}
  const force = body?.force === true;

  const all = await listSeriesEpisodesFull(id, userId);
  if (all.length === 0) return NextResponse.json({ error: '系列无剧集(或非本人)' }, { status: 404 });
  const targets = selectGeneratableEpisodes(all, { force });
  if (targets.length === 0) {
    return NextResponse.json({ ok: true, started: 0, message: '没有待生成的剧集(都已生成或正在生成)' });
  }

  const concurrency = Math.max(1, Number(process.env.SERIES_CONCURRENCY) || 1);
  // 先标 active —— 前端轮询立即看到「生成中」,并防重复触发
  for (const ep of targets) await setEpisodeStatus(ep.id, 'active');

  // 后台批量跑(不 await;持久 server 下存活)。每集独立 try,失败回退 draft 可重试。
  void (async () => {
    const { runCreatePipeline } = await import('@/lib/create-pipeline');
    const report = await runPool(
      targets,
      async (ep) => {
        try {
          await runCreatePipeline(
            {
              idea: (ep.description || ep.title || '').slice(0, 2000),
              projectId: ep.id,
              aspect: ep.aspect || '16:9',
              style: ep.style_id || undefined,
              primaryCharacterRef: ep.primary_character_ref || undefined,
              lockedCharacters: parseArr(ep.locked_characters),
              enableGates: false,
            },
            () => {}, // 批量非交互:吞掉进度事件
          );
          await setEpisodeStatus(ep.id, 'completed');
          return true;
        } catch (e) {
          console.error(`[Series ${id}] 第 ${ep.episode_number} 集生成失败:`, e instanceof Error ? e.message : e);
          await setEpisodeStatus(ep.id, 'draft'); // 回退,可重试
          throw e;
        }
      },
      {
        concurrency,
        continueOnError: true,
        onSettle: (r) => console.log(`[Series ${id}] 结算 #${r.index} ok=${r.ok}${r.error ? ' err=' + r.error.slice(0, 80) : ''}`),
      },
    );
    console.log(`[Series ${id}] 批量生成完成:成功 ${report.ok}/${report.total}`);
  })().catch((e) => console.error(`[Series ${id}] 批量生成顶层异常:`, e));

  return NextResponse.json({
    ok: true,
    started: targets.length,
    concurrency,
    episodes: targets.map((t) => ({ id: t.id, episodeNumber: t.episode_number, title: t.title })),
  });
}
