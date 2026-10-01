/**
 * lib/stage-sketch-store — 某一镜「当前那张构图草图」的读写(v12.462)。服务端专用(碰数据库与存储)。
 *
 * 为什么单独一层:草图有三个来源(导演台渲 / AI 画 / 用户上传),此前落库逻辑只写在 shot-sketch 路由里。
 * v12.462 起**保存站位**也要能重渲导演台草图 —— 否则会出现这种错位:用户渲了草图,又挪了人、存了站位,
 * 草图锁锁的还是旧构图,提示词里却是新站位,两个口径打架(本仓栽过五次的「同一语义两套口径」)。
 * 两个入口共用这里,落库口径只有一份。
 */
import type { StageSketchInfo } from './stage-blocking';

export const SHOT_SKETCH_TYPE = 'storyboard-sketch';

type Row = { id: string; shot_number?: number | null; data?: unknown; media_urls?: unknown; persistent_url?: string | null };

function sketchOf(row: Row): StageSketchInfo | null {
  let data: any = row.data;
  try { if (typeof data === 'string') data = JSON.parse(data); } catch { data = null; }
  let media: unknown = row.media_urls;
  try { if (typeof media === 'string') media = JSON.parse(media); } catch { media = []; }
  const url = row.persistent_url || (Array.isArray(media) && typeof media[0] === 'string' ? media[0] : '');
  if (!url) return null;
  return { url, mode: typeof data?.mode === 'string' ? data.mode : 'set' };
}

/** 读某镜当前的构图草图;没有就返回 null */
export async function getShotSketch(projectId: string, shotNumber: number): Promise<StageSketchInfo | null> {
  const { listAssetsByType } = await import('./repos/asset-repo');
  const rows = (await listAssetsByType(projectId, SHOT_SKETCH_TYPE)) as Row[];
  const mine = rows.filter((r) => Number(r.shot_number) === Number(shotNumber));
  // 落库时会先删同镜旧草图,正常只有一张;万一并发留下两张,取最后建的那张
  for (let i = mine.length - 1; i >= 0; i--) {
    const s = sketchOf(mine[i]);
    if (s) return s;
  }
  return null;
}

/**
 * 把一张草图记为某镜「当前那张」:先删同镜旧草图,再落盘(外链会过期,v12.347)并建资产。
 * 返回落库后的地址(持久化成功用本地地址,失败回退原地址)。
 */
export async function storeShotSketch(
  projectId: string, shotNumber: number, url: string, data: { mode: string; sketchMeta?: unknown },
): Promise<StageSketchInfo> {
  const { listAssetsByType, deleteAsset, createAsset } = await import('./repos/asset-repo');
  const existing = (await listAssetsByType(projectId, SHOT_SKETCH_TYPE)) as Row[];
  for (const a of existing.filter((x) => Number(x.shot_number) === Number(shotNumber))) {
    try { await deleteAsset(a.id); } catch { /* 删不掉旧的不拦新的 —— 读取时取最后一张 */ }
  }
  const { persistAsset } = await import('./asset-storage');
  const persisted = await persistAsset(url).catch(() => null);
  if (!persisted) console.warn(`[stage-sketch-store] 落盘失败,回退原地址(外链会过期):${String(url).slice(0, 80)}`);
  const finalUrl = persisted?.url || url;
  await createAsset({
    projectId, type: SHOT_SKETCH_TYPE, name: `Shot ${shotNumber} 构图草图`,
    data: { mode: data.mode, sketchMeta: data.sketchMeta ?? null },
    mediaUrls: [finalUrl], shotNumber, persistentUrl: persisted?.url || null,
  });
  return { url: finalUrl, mode: data.mode };
}

/**
 * 按库里的舞台渲一张布局草图并记为该镜当前草图。没摆过位返回 null。
 * 不花钱、不调引擎、确定性(同样的舞台渲出同样的像素)。
 */
export async function renderStageSketchForShot(
  projectId: string, shotNumber: number, sketchMetaOverride?: unknown,
): Promise<{ sketch: StageSketchInfo; sketchUrl: string } | null> {
  const { getStageScene } = await import('./stage-scene-store');
  const scene = await getStageScene(projectId, shotNumber);
  if (!scene) return null;
  const { renderStageSketch, sketchMetaFromScene } = await import('./stage-sketch');
  const { storagePut } = await import('./storage');
  const { frameSize } = await import('./stage-blocking');
  // v12.439:尺寸按**项目画幅**(getStageScene 已挂上 scene.aspect),与投影同源
  const { width, height } = frameSize(scene.aspect);
  const png = renderStageSketch(scene, { width, height });
  const put = await storagePut(png, 'image/png', '.png');
  // 镜头元数据也由舞台算出来 —— 与草图同源,不让用户再填一遍(调用方显式给了就用调用方的)
  const sketch = await storeShotSketch(projectId, shotNumber, put.url, { mode: 'stage', sketchMeta: sketchMetaOverride ?? sketchMetaFromScene(scene) });
  return { sketch, sketchUrl: put.url };
}
