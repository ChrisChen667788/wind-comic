/**
 * lib/shot-ref-video-store — 每镜「动作参考视频」的存取与**出片注入口**。v12.448。
 *
 * 单独一行 `project_assets(type='shot-ref-video', shot_number=N)`,不塞进分镜那一行的 data:
 * 分镜重生会整行重写分镜数据,参考视频夹在里面迟早被冲掉。与导演台站位(stage-scene)同一套路。
 *
 * **注入口只有 `refVideoOptsForShot` 一处** —— 整片生成、单镜重生(自愈 / 每日重跑 / 剪辑师重生共用)、
 * 审片重生三条路径都从这里取;这个仓在「改了主路径忘了旁路」上栽过太多次(见 twin-path-drift)。
 */
import { REF_VIDEO_LIMITS, refVideoToEngine, type RefVideoOutcome } from './ref-video';

export const SHOT_REF_VIDEO_TYPE = 'shot-ref-video';

export interface ShotRefVideo {
  shotNumber: number;
  /** http(s) 公网链接,或站内 /api/serve-file 地址(发送时转 base64) */
  url: string;
  source: 'link' | 'upload';
  durationSec?: number;
  /** 上传时超过 15 秒、已截取前 15 秒 */
  trimmedFrom?: number;
  width?: number;
  height?: number;
  sizeBytes?: number;
  updatedAt?: string;
}

/** 读某一镜的参考视频;没挂 / 存坏了 → null(绝大多数镜都没挂,属正常) */
export async function getShotRefVideo(projectId: string, shotNumber: number): Promise<ShotRefVideo | null> {
  const all = await listShotRefVideos(projectId);
  return all.find((r) => r.shotNumber === Number(shotNumber)) || null;
}

/** 列出项目里所有挂了参考视频的镜(镜头工坊给卡片打标用) */
export async function listShotRefVideos(projectId: string): Promise<ShotRefVideo[]> {
  const { listAssetsByType } = await import('./repos/asset-repo');
  const rows = await listAssetsByType(projectId, SHOT_REF_VIDEO_TYPE);
  const out: ShotRefVideo[] = [];
  for (const row of rows || []) {
    // 只认自己这一类:测试或别处的 mock 可能不按 type 过滤,别把导演台那行当成参考视频
    if ((row as any).type && (row as any).type !== SHOT_REF_VIDEO_TYPE) continue;
    try {
      const d = typeof (row as any).data === 'string' ? JSON.parse((row as any).data) : (row as any).data;
      if (!d || typeof d.url !== 'string' || !d.url.trim()) continue;
      out.push({ ...d, shotNumber: Number((row as any).shot_number), source: d.source === 'upload' ? 'upload' : 'link' });
    } catch { /* 存坏了当没挂 */ }
  }
  return out.sort((a, b) => a.shotNumber - b.shotNumber);
}

/** UPSERT(先查再插放同一事务 —— 同 stage-scene 的教训,v12.303) */
export async function saveShotRefVideo(projectId: string, v: ShotRefVideo): Promise<void> {
  const { getDbDriver } = await import('./db-driver');
  const payload = {
    url: v.url, source: v.source,
    ...(v.durationSec != null ? { durationSec: v.durationSec } : {}),
    ...(v.trimmedFrom != null ? { trimmedFrom: v.trimmedFrom } : {}),
    ...(v.width ? { width: v.width, height: v.height } : {}),
    ...(v.sizeBytes != null ? { sizeBytes: v.sizeBytes } : {}),
    updatedAt: new Date().toISOString(),
  };
  // 动态 import 放在事务外:事务期间每一次 await 都会让出执行权(SQLite 单连接上并发事务的问题见 v12.449)
  const { listAssetsByType, createAsset } = await import('./repos/asset-repo');
  await getDbDriver().transaction(async (tx: any) => {
    const rows = await listAssetsByType(projectId, SHOT_REF_VIDEO_TYPE, tx);
    const existing = (rows || []).find((r: any) => Number(r.shot_number) === Number(v.shotNumber));
    if (existing) {
      await tx.run(`UPDATE project_assets SET data = ?, updated_at = ? WHERE id = ?`,
        [JSON.stringify(payload), new Date().toISOString(), (existing as any).id]);
    } else {
      await createAsset({ projectId, type: SHOT_REF_VIDEO_TYPE, name: `ref-video-shot-${v.shotNumber}`, shotNumber: v.shotNumber, data: payload }, tx);
    }
  });
}

export async function deleteShotRefVideo(projectId: string, shotNumber: number): Promise<boolean> {
  const { getDbDriver } = await import('./db-driver');
  const r = await getDbDriver().run(
    `DELETE FROM project_assets WHERE project_id = ? AND type = ? AND shot_number = ?`,
    [projectId, SHOT_REF_VIDEO_TYPE, Number(shotNumber)],
  );
  return Number((r as any)?.changes ?? 0) > 0;
}

export type RefVideoEvent = { shotNumber: number } & RefVideoOutcome;

/** 给人看的一句话(进度对话流 / 重生状态行 / 服务端日志共用同一口径) */
export function refVideoNoticeText(e: RefVideoEvent): string {
  return e.status === 'sent'
    ? `🎬 第 ${e.shotNumber} 镜按参考视频的动作出片(MiniMax H3,参考图 ${e.imagesSent} 张${e.imagesDropped ? `,另有 ${e.imagesDropped} 张超出上限未发` : ''})`
    : `⚠️ 第 ${e.shotNumber} 镜的参考视频没用上:${e.reason}`;
}

/**
 * **出片注入口**:这一镜挂了参考视频就返回要并进 MiniMax 选项的两个字段;没挂返回 `{}`。
 *
 * - 挂了但用不了(本地文件被清理、超内联上限):当场 `report` 一条 ignored,返回 `{}` 照常出片
 * - 能用:返回 `referenceVideoUrl`(引擎可取形态)与 `onRefOutcome`(服务层用它回报「发出去了 / 被忽略了」)
 * - 查库出错:返回 `{}` —— 增强项不能把出片打挂
 *
 * `onNoRef`:这一镜**最终没用 H3 参考视频出片**时调用(没挂 / 挂了用不了 / 服务层回报被忽略)——
 * 那时出片走旧接口,编排器要照常上报 S2V 丢了几张角度图(v12.447)。一处判定,三条出片路径共用。
 */
export async function refVideoOptsForShot(
  projectId: string | undefined | null,
  shotNumber: number,
  report: (e: RefVideoEvent) => void,
  onNoRef: () => void = () => {},
): Promise<{ referenceVideoUrl?: string; onRefOutcome?: (o: RefVideoOutcome) => void }> {
  const noRef = () => { try { onNoRef(); } catch { /* 上报出错不影响出片 */ } };
  const safeReport = (o: RefVideoOutcome) => {
    const e = { shotNumber: Number(shotNumber), ...o } as RefVideoEvent;
    if (o.status === 'ignored') console.warn(`[RefVideo] ${refVideoNoticeText(e)}`);
    try { report(e); } catch { /* 上报出错不影响出片 */ }
  };
  if (!projectId || !Number.isFinite(Number(shotNumber))) { noRef(); return {}; }
  let row: ShotRefVideo | null = null;
  try { row = await getShotRefVideo(projectId, Number(shotNumber)); } catch { noRef(); return {}; }
  if (!row) { noRef(); return {}; }
  const { serveFileToLocalPath } = await import('./first-frame');
  const engine = await refVideoToEngine(row.url, serveFileToLocalPath); // 不抛:读盘异常也转成「用不了 + 原因」
  if (!engine.ok) {
    safeReport({ status: 'ignored', reason: engine.reason });
    noRef();
    return {};
  }
  return {
    referenceVideoUrl: engine.url,
    onRefOutcome: (o) => { safeReport(o); if (o.status === 'ignored') noRef(); },
  };
}

export { REF_VIDEO_LIMITS };
