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

  // v12.23.0(评审):预算护栏 —— 整片生成很重,批量更要拦,否则 force 反复重生会无上限超支。
  // 每集粗估 ¥6(图+视频+音),与单集管线同源预算控制。
  const { assertBudget } = await import('@/lib/budget-enforce');
  const b = await assertBudget({ userId, pendingCostCny: targets.length * 6 });
  if (!b.allow) return NextResponse.json({ error: b.guard.message, code: 'budget_exceeded', guard: b.guard }, { status: 402 });

  // 每集 → CreatePipelineInput(premise 作创意 + 继承锚点一致性资产)
  const inputFor = (ep: typeof targets[number]) => ({
    idea: (ep.description || ep.title || '').slice(0, 2000),
    projectId: ep.id,
    aspect: ep.aspect || '16:9',
    style: ep.style_id || undefined,
    primaryCharacterRef: ep.primary_character_ref || undefined,
    lockedCharacters: parseArr(ep.locked_characters),
    enableGates: false,
  });

  // 先标 active —— 前端轮询立即看到「生成中」,并防重复触发
  for (const ep of targets) await setEpisodeStatus(ep.id, 'active');

  // ── v12.19.0 持久任务队列(抗重启)──────────────────────────────────────────
  // PIPELINE_QUEUE=1:每集入 pipeline_jobs(与单集创作同一队列 + worker),进程重启由
  // recoverOrphanJobs 把在途 running 重入队续跑;失败按 attempts 重试。pipeline 收尾自标 completed。
  if (process.env.PIPELINE_QUEUE === '1') {
    const { enqueuePipelineJob } = await import('@/lib/repos/pipeline-job-repo');
    const { ensurePipelineWorker } = await import('@/lib/pipeline-worker');
    let queued = 0;
    for (const ep of targets) {
      try {
        await enqueuePipelineJob({ type: 'create', projectId: ep.id, userId, payload: inputFor(ep) });
        queued++;
      } catch (e) {
        // v12.23.0(评审):入队失败立即回退 draft,否则该集永远卡 active(无 job 可被 worker/孤儿扫描救)
        console.error(`[Series ${id}] 第 ${ep.episode_number} 集入队失败,回退 draft:`, e instanceof Error ? e.message : e);
        await setEpisodeStatus(ep.id, 'draft').catch(() => {});
      }
    }
    ensurePipelineWorker();
    return NextResponse.json({
      ok: true, started: queued, mode: 'queue',
      episodes: targets.map((t) => ({ id: t.id, episodeNumber: t.episode_number, title: t.title })),
    });
  }

  // ── 兜底:进程内 runPool(无队列;fire-and-forget,重启会丢在途)──────────────
  const concurrency = Math.max(1, Number(process.env.SERIES_CONCURRENCY) || 1);
  void (async () => {
    const { runCreatePipeline } = await import('@/lib/create-pipeline');
    const report = await runPool(
      targets,
      async (ep) => {
        try {
          await runCreatePipeline(inputFor(ep), () => {}); // 批量非交互:吞掉进度事件
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
    ok: true, started: targets.length, mode: 'inline', concurrency,
    episodes: targets.map((t) => ({ id: t.id, episodeNumber: t.episode_number, title: t.title })),
  });
}
