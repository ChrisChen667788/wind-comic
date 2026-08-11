/**
 * lib/shot-segment-retake — 镜内片段重拍的 **take 历史层**(v12.315)。
 *
 * 刻意与 `lib/voice-retake` 同构(TAKE_TYPE / ACTIVE_TYPE、建 take → 采用 take →
 * 精准作废下游),因为这个仓已经证明过:同一种语义各写一套的代价极高
 * (转场两套、音色三套、称谓词表五处、相对时间两份、fetchWithTimeout 两份)。
 *
 * ── v12.314 的不变量在这里换来一个实打实的好处 ─────────────────────────
 * 缝合后 `totalAfterS === shotDurationS`,**该镜时长一字不变**。于是:
 *   · 压缩时间轴(computeXfadeTimeline)不用重算
 *   · 配音 adelay / 字幕起点 / EDL record-in 全部不受影响
 *   · 其余镜头的位置纹丝不动
 * 这正是 v12.264/265/297 花三个版本对齐出来的东西 —— 片段重拍不去破坏它,
 * 就不必赔上一次全片重算。**下游只需作废两样:成片、以及该镜的口型对齐分。**
 *
 * 为什么口型分必须作废:画面换了,原来那条「口型与音频对得上」的结论就不再可信,
 * 而 publish-readiness 拿它做发布门禁 —— 不摘掉会让门禁**错误地放行**
 * (与 v12.306 里 lipsync-align 丢分导致误放行是同一类风险)。
 */

import {
  createAsset, getAsset, listAssetsByType, updateAssetBySelector,
  updateAssetDataInProject, setAssetsStaleByShots,
} from './repos/asset-repo';

export const SEG_TAKE_TYPE = 'shot-video-take';
export const SEG_ACTIVE_TYPE = 'video';

const parseJson = (raw: string | null | undefined): any => {
  try { return raw ? JSON.parse(raw) : null; } catch { return null; }
};

export interface SegmentTakeRecord {
  takeId: string;
  shotNumber: number;
  /** 重拍区间(秒,相对该镜开头) */
  fromS: number;
  toS: number;
  prompt?: string;
  videoUrl: string;
  createdAt: string;
  adopted: boolean;
}

/** 记一条片段重拍 take(不动活动版 —— 采用前用户还能反悔) */
export async function recordSegmentTake(input: {
  projectId: string;
  shotNumber: number;
  fromS: number;
  toS: number;
  videoUrl: string;
  prompt?: string;
  planSummary?: unknown;
}): Promise<{ takeId: string }> {
  const takeId = `segtake-${input.shotNumber}-${Date.now()}`;
  await createAsset({
    projectId: input.projectId,
    type: SEG_TAKE_TYPE,
    id: takeId,
    name: `片段重拍 · 镜 ${input.shotNumber} ${input.fromS.toFixed(1)}-${input.toS.toFixed(1)}s`,
    data: {
      fromS: input.fromS, toS: input.toS,
      prompt: input.prompt, plan: input.planSummary,
      createdAt: new Date().toISOString(),
    },
    mediaUrls: [input.videoUrl],
    shotNumber: input.shotNumber,
    version: 1,
  });
  return { takeId };
}

/** 列出某镜的片段重拍历史(新→旧,标出当前采用的那条) */
export async function listSegmentTakes(projectId: string, shotNumber?: number): Promise<SegmentTakeRecord[]> {
  const rows = await listAssetsByType(projectId, SEG_TAKE_TYPE);
  const active = await listAssetsByType(projectId, SEG_ACTIVE_TYPE);
  const adoptedIds = new Set(
    active.map((a) => parseJson(a.data)?.adoptedSegmentTakeId).filter(Boolean),
  );
  return rows
    .filter((r) => shotNumber == null || r.shot_number === shotNumber)
    .map((r) => {
      const d = parseJson(r.data) || {};
      return {
        takeId: r.id,
        shotNumber: r.shot_number ?? 0,
        fromS: Number(d.fromS) || 0,
        toS: Number(d.toS) || 0,
        prompt: d.prompt,
        videoUrl: (parseJson(r.media_urls) || [])[0] || '',
        createdAt: String(d.createdAt || r.created_at),
        adopted: adoptedIds.has(r.id),
      };
    })
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}

/**
 * 采用某条片段重拍:把缝合后的成片设为该镜活动版,并精准作废下游。
 *
 * **只动该镜** —— 与 voice-retake 的 adoptTake 同一纪律。
 */
export async function adoptSegmentTake(projectId: string, takeId: string): Promise<{
  ok: boolean; shotNumber?: number; videoUrl?: string; invalidated?: string[]; error?: string;
}> {
  const take = await getAsset(takeId);
  if (!take || take.project_id !== projectId || take.type !== SEG_TAKE_TYPE || take.shot_number == null) {
    return { ok: false, error: '片段重拍记录不存在' };
  }
  const shotNumber = take.shot_number;
  const mediaUrls = parseJson(take.media_urls) || [];
  if (!mediaUrls[0]) return { ok: false, error: '该记录没有可用的视频地址' };

  const data = { ...(parseJson(take.data) || {}), adoptedSegmentTakeId: takeId };
  const changed = await updateAssetBySelector(
    projectId, { type: SEG_ACTIVE_TYPE, shotNumber },
    { mediaUrls, data, bumpVersion: true },
  );
  if (changed === 0) {
    return { ok: false, error: `镜 ${shotNumber} 还没有视频活动版,无法采用片段重拍` };
  }

  const invalidated: string[] = [];

  // ① 成片作废 —— 它内含旧画面。时长没变,所以只是「要重合成」,不是「时间轴要重算」。
  try {
    const finals = await listAssetsByType(projectId, 'final_video');
    for (const f of finals) {
      await updateAssetDataInProject(f.id, projectId, { ...(parseJson(f.data) || {}), stale: true });
    }
    if (finals.length) invalidated.push('final_video');
  } catch { /* 作废失败不该让采用整体失败 */ }

  // ② 该镜口型分作废 —— 画面换了,「口型对得上」的结论不再可信;
  //    publish-readiness 拿它做门禁,不摘会错误放行(同 v12.306 的风险)。
  try {
    const alignRows = await listAssetsByType(projectId, 'lipsync-align');
    for (const row of alignRows) {
      const d = parseJson(row.data) || {};
      const scores = { ...(d.scores || {}) };
      if (scores[String(shotNumber)] !== undefined) {
        delete scores[String(shotNumber)];
        await updateAssetDataInProject(row.id, projectId, { ...d, scores });
        invalidated.push(`lipsync-align#${shotNumber}`);
      }
    }
  } catch { /* 同上 */ }

  // ③ 该镜的其它派生物按既有机制标 stale(只动这一镜)
  try {
    const n = await setAssetsStaleByShots(projectId, ['storyboard'], [shotNumber], true);
    if (n > 0) invalidated.push(`storyboard#${shotNumber}`);
  } catch { /* 同上 */ }

  return { ok: true, shotNumber, videoUrl: mediaUrls[0], invalidated };
}
