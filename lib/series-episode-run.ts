/**
 * lib/series-episode-run.ts(v12.455)—— 整季批量「进程内路径」跑一集,并如实回写这一集的状态。
 *
 * 病象:app/api/series/[id]/generate 的进程内路径以前这样写:
 *   await runCreatePipeline(input, () => {});   // 空回调,吞掉所有事件
 *   await setEpisodeStatus(ep.id, 'completed'); // 返回了就算完成
 * 而流水线的失败语义是「发 error 事件后正常返回」(SSE 语义,不抛 —— pipeline-worker 也正是靠
 * 「有没有发过 error」判失败)。于是节奏门禁拦下的集、剧本没生成出来的集、一条片都没出的集,
 * 在这条路径上全被写成 completed。更糟的是一集就是一个项目,setEpisodeStatus 改的就是 projects.status,
 * 会把流水线自己如实写下的 failed(v12.433)再覆盖回 completed。
 *
 * 现在与 worker 同一判据:发过 error → 这一集失败,状态记 failed(整季页仍可重生,
 * selectGeneratableEpisodes 收 failed),并抛出让批量统计计入失败;抛异常的老路径保持回退 draft。
 */

export type PipelineRunner = (input: any, emit: (type: string, data: unknown) => void) => Promise<unknown>;
export type EpisodeStatusWriter = (episodeId: string, status: string) => Promise<void>;

export async function runSeriesEpisodeOnce(
  episodeId: string,
  input: unknown,
  deps: { runCreatePipeline: PipelineRunner; setEpisodeStatus: EpisodeStatusWriter },
): Promise<true> {
  let pipelineError = '';
  try {
    await deps.runCreatePipeline(input, (type, data) => {
      if (type === 'error') pipelineError = String((data as { message?: unknown })?.message ?? 'pipeline error');
    });
  } catch (e) {
    await deps.setEpisodeStatus(episodeId, 'draft'); // 回退,可重试(原行为)
    throw e;
  }
  if (pipelineError) {
    await deps.setEpisodeStatus(episodeId, 'failed');
    throw new Error(pipelineError);
  }
  await deps.setEpisodeStatus(episodeId, 'completed');
  return true;
}
