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
  /** v12.459:第一次采用片段重拍前自动记下的「原片」—— 采用它就是回退 */
  original: boolean;
  /** v12.459:补丁是引擎全挂后的静止图占位片(仅 MOCK_ENGINES 下会被记下) */
  patchIsAnimatic: boolean;
  /** v12.459:缝合产物实测时长(秒) */
  measuredDurationS?: number;
}

/** 记一条片段重拍 take(不动活动版 —— 采用前用户还能反悔) */
export async function recordSegmentTake(input: {
  projectId: string;
  shotNumber: number;
  fromS: number;
  toS: number;
  videoUrl: string;
  /** v12.459:缝合产物落盘后的持久地址 —— 采用时要连同它一起写进活动版 */
  persistentUrl?: string | null;
  prompt?: string;
  planSummary?: unknown;
  /** v12.459:溯源与标记(补丁原始地址、是否占位、实测时长、从哪一版缝的) */
  extra?: Record<string, unknown>;
  /** v12.459:「原片」快照 */
  original?: boolean;
}): Promise<{ takeId: string }> {
  const takeId = `segtake-${input.shotNumber}-${Date.now()}${input.original ? '-orig' : ''}`;
  await createAsset({
    projectId: input.projectId,
    type: SEG_TAKE_TYPE,
    id: takeId,
    name: input.original
      ? `片段重拍 · 镜 ${input.shotNumber} 原片`
      : `片段重拍 · 镜 ${input.shotNumber} ${input.fromS.toFixed(1)}-${input.toS.toFixed(1)}s`,
    data: {
      ...(input.extra || {}),
      fromS: input.fromS, toS: input.toS,
      prompt: input.prompt, plan: input.planSummary,
      original: !!input.original,
      createdAt: new Date().toISOString(),
    },
    mediaUrls: [input.videoUrl],
    persistentUrl: input.persistentUrl ?? null,
    shotNumber: input.shotNumber,
    version: 1,
  });
  return { takeId };
}

/**
 * v12.459:把只有外链的原片落到本地(data/media/seg-retakes),返回站内签名地址;失败返回 null。
 * 下载走 lib/media-local-path(safeFetch + 大小上限)。动态 import:本模块被很多路由引用,别让它们都背上下载依赖。
 */
async function persistOriginalCopy(projectId: string, shotNumber: number, url: string): Promise<{ url: string } | null> {
  try {
    const [{ resolveLocalMediaPath }, { persistentMediaDir }, { serveFilePathUrl }, fs, path] = await Promise.all([
      import('./media-local-path'), import('./media-persist'), import('./serve-file-sign'), import('fs'), import('path'),
    ]);
    const src = await resolveLocalMediaPath(url, { allowRemote: true, ext: '.mp4', maxBytes: 512 * 1024 * 1024 });
    if (!src) return null;
    try {
      const out = path.join(persistentMediaDir('seg-retakes'), `segtake-orig-${projectId}-${shotNumber}-${Date.now()}.mp4`);
      await fs.promises.copyFile(src.path, out);
      return { url: serveFilePathUrl(out) };
    } finally {
      if (src.tempFile) { try { fs.unlinkSync(src.tempFile); } catch { /* 删不掉不阻塞 */ } }
    }
  } catch (e) {
    console.warn(`[segment-retake] 原片落盘失败,只记外链:${e instanceof Error ? e.message.slice(0, 120) : e}`);
    return null;
  }
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
        videoUrl: r.persistent_url || (parseJson(r.media_urls) || [])[0] || '',
        createdAt: String(d.createdAt || r.created_at),
        adopted: adoptedIds.has(r.id),
        original: d.original === true,
        patchIsAnimatic: d.patchIsAnimatic === true,
        measuredDurationS: Number.isFinite(Number(d.measuredDurationS)) ? Number(d.measuredDurationS) : undefined,
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
  /** v12.459:回退到的原片只有外链(当时落盘失败)—— 可能已过期,前端要如实提示 */
  warning?: string;
}> {
  const take = await getAsset(takeId);
  if (!take || take.project_id !== projectId || take.type !== SEG_TAKE_TYPE || take.shot_number == null) {
    return { ok: false, error: '片段重拍记录不存在' };
  }
  const shotNumber = take.shot_number;
  const mediaUrls = parseJson(take.media_urls) || [];
  if (!mediaUrls[0]) return { ok: false, error: '该记录没有可用的视频地址' };
  const takeData = parseJson(take.data) || {};

  const active = (await listAssetsByType(projectId, SEG_ACTIVE_TYPE)).find((r) => r.shot_number === shotNumber);
  if (!active) return { ok: false, error: `镜 ${shotNumber} 还没有视频活动版,无法采用片段重拍` };
  const activeData = parseJson(active.data) || {};

  // v12.459:第一次采用前把**当前活动版**记成「原片」take —— 采用它就是回退。
  // 不记的话,活动版一被覆盖,原片地址就只剩在旧 take 里(若有),多数情况下彻底丢失;
  // 而且原片文件不再被任何行引用,04:10 的清理任务会把它当孤儿删掉。
  const takes = await listAssetsByType(projectId, SEG_TAKE_TYPE);
  const hasOriginal = takes.some((t) => t.shot_number === shotNumber && parseJson(t.data)?.original === true);
  if (!hasOriginal && !activeData.adoptedSegmentTakeId) {
    const origUrl = active.persistent_url || (parseJson(active.media_urls) || [])[0] || '';
    if (origUrl) {
      // 原片只有引擎外链(当年落盘失败,persistent_url 为空)时,那条链几天后就 403 ——
      // 先把它落到本地再记,否则「回退到原片」几天后回退到的是一条死链。落不下来就如实标记。
      const kept = active.persistent_url ? null : await persistOriginalCopy(projectId, shotNumber, origUrl);
      await recordSegmentTake({
        projectId, shotNumber, fromS: 0, toS: Number(activeData.duration) || 0,
        videoUrl: kept?.url || (parseJson(active.media_urls) || [])[0] || origUrl,
        persistentUrl: kept?.url ?? active.persistent_url ?? null,
        original: true,
        extra: { activeData, ...(!active.persistent_url && !kept ? { originalRemoteOnly: true } : {}) },
      });
    }
  }

  // v12.459 修两处 v12.315 起的老毛病:
  //  ① 只改了 media_urls、没改 persistent_url —— 而重新合成、逐帧检视、各类导出一律
  //     `persistent_url || media_urls[0]`,于是采用了等于没采用,成片里还是旧画面;
  //  ② 用 take 的 data **整个替换**活动版的 data —— 该镜的 duration / status 随之丢失,
  //     重新合成时时长退回默认 8 秒。现在保留活动版原有字段,只叠加采用标记。
  //  回退到「原片」时,恢复当时快照下来的整份 data(含 isAnimatic 等来源标记)。
  const base = takeData.original === true && takeData.activeData ? takeData.activeData : activeData;
  const data: Record<string, unknown> = { ...base, adoptedSegmentTakeId: takeId };
  // 占位标记跟着**这一版画面**走,不跟着活动版旧 data 走:缝合时已算好 resultIsAnimatic ——
  // 补丁是占位片,或原片是占位片而只重拍了其中一段(其余仍是静止图缓推)→ 仍是占位;
  // 整镜换成真补丁 → 不再是占位。不这样做,真补丁替掉整镜后补渲名单仍会反复重拍它(对抗复查挖出),
  // 反过来只补了一秒的占位镜又会被当成已修好。回退到原片时恢复快照里的原值。
  if (takeData.original !== true) {
    if (takeData.resultIsAnimatic === true || takeData.patchIsAnimatic === true) data.isAnimatic = true;
    else if (takeData.resultIsAnimatic === false) delete data.isAnimatic;
  }
  const changed = await updateAssetBySelector(
    projectId, { type: SEG_ACTIVE_TYPE, shotNumber },
    { mediaUrls, persistentUrl: take.persistent_url ?? null, data, bumpVersion: true },
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

  return {
    ok: true, shotNumber, videoUrl: take.persistent_url || mediaUrls[0], invalidated,
    ...(takeData.original === true && takeData.originalRemoteOnly === true
      ? { warning: '原片当时没能落盘,只存了引擎外链 —— 若链接已过期,这一镜需要重新生成' }
      : {}),
  };
}
