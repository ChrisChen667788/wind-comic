/**
 * 「这一趟到底算跑成了没有」—— 唯一判据(v12.433)。
 *
 * ## 为什么要有这个文件
 *
 * 修前 `create-pipeline` 第 944 行**无条件**写 `status: 'completed'`。视频生成整段被
 * `try/catch` 包着,catch 里只 `send('status', '视频生成出错，继续下一步...')` —— 那是
 * 一条会滚走的进度消息,不是失败信号。于是「八个镜头一条视频都没出来」和「顺利完片」
 * 在库里、在列表页、在项目详情页写的是同一个词:**已完成**。
 *
 * 真库里就有活样本:`proj-1786416520904` 状态 completed、0 条 video、8 张 media_urls 为空的
 * storyboard;它自己的 timeline 质检里写着「❌ 0 个有效视频片段, 成片无法合成」、
 * healthScore=20 —— 而全仓没有任何 UI 读那句话。10 个 completed 项目里有 1 个是这样。
 *
 * ## 为什么判据要单独成文件
 *
 * 两条路径要用同一个判据:SSE 直通(路由里直接 await runCreatePipeline)和队列
 * (pipeline-worker 认领 job)。worker 侧靠「有没有发过 error 事件」判失败,SSE 侧没有 worker,
 * 只能自己写状态。判据散成两份就一定会漂 —— 这个仓库为「同一语义两份实现」栽过很多次。
 *
 * ## 为什么只判「全军覆没」,不判「部分失败」
 *
 * 出了 3/8 镜也不该叫圆满,但那已经由 v12.427~v12.431 那条线负责(示意图/示意片标记、
 * 导出告警、列表页徽章),用户看得见。这里只处理**最恶劣的一档**:一条都没出,却写着完成。
 * 把「部分」也拉进 failed 会让大量正常项目变红,反而把真失败淹掉。
 */

export type PipelineStatus = 'completed' | 'failed';

export type PipelineVerdict =
  | { status: 'completed' }
  | { status: 'failed'; reason: string };

export interface PipelineTally {
  /** 剧本里有几镜(0 = 连分镜都没生成出来) */
  shotCount: number;
  /** 真出了图的分镜数(有 imageUrl 才算) */
  storyboardsWithImage: number;
  /** 真出了片的镜数(有 videoUrl 才算) */
  videoCount: number;
}

/**
 * 判定。理由要写得能直接给用户看 —— 「失败了」不够,得说清失败在哪一段,
 * 否则用户只能重跑碰运气。
 */
export function judgePipelineOutcome(t: PipelineTally): PipelineVerdict {
  const shots = num(t.shotCount);
  const boards = num(t.storyboardsWithImage);
  const videos = num(t.videoCount);

  if (shots <= 0) {
    return { status: 'failed', reason: '剧本没有产出任何分镜,后面几步都没有东西可做' };
  }
  if (videos <= 0) {
    // 分镜图也全空 → 上游就断了,和「有图但出片失败」是两回事,重跑的着手点不同
    return boards <= 0
      ? { status: 'failed', reason: `${shots} 镜一条视频都没出来,分镜图也全是空的(生图那一段就断了)` }
      : { status: 'failed', reason: `${shots} 镜一条视频都没出来(分镜图出了 ${boards} 张,断在出片这一段)` };
  }
  return { status: 'completed' };
}

/** 非数字/负数/NaN 一律当 0 —— 别让 undefined 悄悄变成「有产出」。 */
function num(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : 0;
}

/**
 * 库里一行项目算不算「标着完成其实什么都没出」。修复脚本和门禁共用,
 * 免得两处各写各的判据。
 */
export function isFalselyCompleted(row: {
  status?: string | null;
  videoCount?: number;
  storyboardCount?: number;
}): boolean {
  if (row.status !== 'completed') return false;
  if (num(row.videoCount) > 0) return false;
  // 一个分镜都没有的项目可能是纯剧本草稿,不在本判据管辖内 —— 只抓「摆开了架势却零产出」
  return num(row.storyboardCount) > 0;
}

/**
 * 库里一批资产行里,**真有东西**的有几条(v12.433)。
 *
 * 行存在 ≠ 有产物:真库里就有 8 行 storyboard 而 `media_urls` 全是 `[]` 的项目。
 * 所以按「取得出一个非空 URL」算,和流水线内存里 `v.videoUrl` 那条判据同义 ——
 * 修复脚本与流水线共用这一份,免得线上判一套、修复判另一套。
 *
 * 注意:降级出的示意片(Ken Burns)**算产出**。它是次品不是没有,
 * 由 v12.427~v12.431 那条线负责标出来;这里只管「一条都没有」这一档。
 */
export function countUsableAssets(
  rows: Array<{ media_urls?: string | null; persistent_url?: string | null }>,
): number {
  return rows.filter((r) => {
    if (r.persistent_url && String(r.persistent_url).trim()) return true;
    const raw = r.media_urls;
    if (!raw) return false;
    try {
      const arr = JSON.parse(String(raw));
      return Array.isArray(arr) && arr.some((u) => typeof u === 'string' && u.trim());
    } catch {
      return false;
    }
  }).length;
}
