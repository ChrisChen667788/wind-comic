/**
 * lib/stage-scene-store — 导演台场景的存取与**提示词注入口径**。v12.316。
 *
 * 拆成独立一层的原因:`lib/stage-blocking` 是零依赖纯几何(能在浏览器里跑,
 * 供 3D 界面实时预览用),这里才碰数据库。两边混在一起,前端就得连带打包 asset-repo。
 *
 * **注入口径只有这一处。** 编排器、重生单镜、未来的导演台预览都从
 * `stageDirectiveForShot` 取同一句话 —— 否则又是「同一语义两套口径」,
 * 这个仓已经在转场、音色、称谓词表、相对时间、fetchWithTimeout 上栽过五次。
 */
import type { StageScene } from './stage-blocking';
import { describeStaging, auditStaging, projectScene } from './stage-blocking';

export const STAGE_SCENE_TYPE = 'stage-scene';

export interface StoredStageScene extends StageScene {
  shotNumber: number;
  updatedAt?: string;
}

/** 读某一镜的舞台场景;没设过就返回 null(绝大多数镜都没设,属正常) */
export async function getStageScene(projectId: string, shotNumber: number): Promise<StoredStageScene | null> {
  const { listAssetsByType } = await import('./repos/asset-repo');
  const rows = await listAssetsByType(projectId, STAGE_SCENE_TYPE);
  const row = (rows || []).find((r: any) => Number(r.shot_number) === Number(shotNumber));
  if (!row) return null;
  try {
    const data = typeof (row as any).data === 'string' ? JSON.parse((row as any).data) : (row as any).data;
    if (!data?.camera || !Array.isArray(data?.actors)) return null;
    return { ...data, shotNumber: Number(shotNumber) };
  } catch {
    // 存坏了不该把出片打挂 —— 当没设过处理(下游退回原有提示词逻辑)
    return null;
  }
}

/**
 * UPSERT 单镜舞台场景。
 *
 * **「先查再插」必须在同一事务里** —— 否则两次并发保存都读到「不存在」,双双插入,
 * 该镜出现两条 stage-scene,`getStageScene` 从此看运气挑一条。
 * v12.303 正是在这类 upsert 上栽过(当时我错误地想用唯一索引解决,而同一张表
 * 既有 upsert 又有 append 语义,表级约束是错的工具;事务才是)。
 */
export async function saveStageScene(projectId: string, scene: StoredStageScene): Promise<void> {
  const { getDbDriver } = await import('./db-driver');
  const payload = { actors: scene.actors, camera: scene.camera, updatedAt: new Date().toISOString() };
  await getDbDriver().transaction(async (tx: any) => {
    const { listAssetsByType, createAsset } = await import('./repos/asset-repo');
    const rows = await listAssetsByType(projectId, STAGE_SCENE_TYPE, tx);
    const existing = (rows || []).find((r: any) => Number(r.shot_number) === Number(scene.shotNumber));
    if (existing) {
      await tx.run(
        `UPDATE project_assets SET data = ?, updated_at = ? WHERE id = ?`,
        [JSON.stringify(payload), new Date().toISOString(), (existing as any).id],
      );
    } else {
      await createAsset({
        projectId, type: STAGE_SCENE_TYPE, name: `stage-shot-${scene.shotNumber}`,
        shotNumber: scene.shotNumber, data: payload,
      }, tx);
    }
  });
}

/**
 * 该镜的**站位指令** —— 唯一注入口径。
 *
 * 刻意返回英文:`visualPrompt` 全链路是英文(v12.6.1 定的口径,中文只锁台词/旁白/TTS/口型),
 * 混中文进去会让非中文引擎把它当画面文字渲染 —— 与 v2.22 那次 CJK 乱码同一类坑。
 */
export function stageDirectiveForShot(scene: StageScene | null | undefined): string {
  if (!scene?.camera || !Array.isArray(scene.actors) || scene.actors.length === 0) return '';
  const projected = projectScene(scene);
  const inFrame = projected.filter((p) => p.inFrame);
  if (inFrame.length === 0) return '';

  const POS: Record<string, string> = {
    left: 'at frame left', 'center-left': 'left of center', center: 'at frame center',
    'center-right': 'right of center', right: 'at frame right', 'off-frame': '',
  };
  const SIZE: Record<string, string> = {
    ECU: 'extreme close-up', CU: 'close-up', MS: 'medium shot',
    LS: 'full shot', WS: 'wide shot', ELS: 'extreme wide shot',
  };
  const parts = inFrame
    .slice()
    .sort((a, b) => a.distanceM - b.distanceM)
    .map((p) => {
      const occ = p.occludedBy.length ? `, partially occluded by ${p.occludedBy.join(' and ')}` : '';
      return `${p.name || p.id} ${POS[p.thirds]} in ${SIZE[p.shotSize]}${occ}`;
    });
  return `. Staging: ${parts.join('; ')}`;
}

/** 给界面用的中文说明 + 体检结果(不进提示词) */
export function stageReport(scene: StageScene) {
  return { description: describeStaging(scene), issues: auditStaging(scene) };
}
