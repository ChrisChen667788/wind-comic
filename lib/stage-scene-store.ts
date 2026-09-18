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
    return withProjectAspect(projectId, { ...data, shotNumber: Number(shotNumber) });
  } catch {
    // 存坏了不该把出片打挂 —— 当没设过处理(下游退回原有提示词逻辑)
    return null;
  }
}

/**
 * v12.439:给舞台挂上**项目画幅** —— 画幅注入口只有这一处。
 *
 * 画幅决定画面宽高比,进而决定谁在画内、景别多大。它**不存进舞台数据**:
 * 画幅是项目的属性,用户改了项目画幅,舞台就该跟着变;存一份副本迟早和项目对不上。
 * 编排器、草图、GET/POST 体检都经 `getStageScene` 或这里取,口径不会分叉。
 *
 * 真库 32 个项目里 27 个是 9:16 —— 之前几何一律按 36×24 横向底片算,竖屏项目
 * 左右视角被算宽了近一倍,画外的人被当成画内写进提示词。
 *
 * 查项目失败不连累舞台:退回不带画幅(旧口径 36×24),总好过整镜站位丢掉。
 */
export async function withProjectAspect<T extends StageScene>(projectId: string, scene: T): Promise<T> {
  try {
    const { getProject } = await import('./repos/project-repo');
    const aspect = (await getProject(projectId))?.aspect;
    return typeof aspect === 'string' && aspect.trim() ? { ...scene, aspect } : scene;
  } catch {
    return scene;
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
 * v12.440:给某镜的视频提示词挂上导演台站位指令 —— **所有出片路径的唯一注入口**。
 *
 * 修前只有编排器主管线(整片生成)读舞台;单镜重生、自愈补拍、4K 重渲、剪辑师烤字重生
 * 四条路径直接用分镜描述出片,**完全不看导演台** —— 而导演台保存成功后提示的是
 * 「该镜后续出片会带上这份站位」。用户最常见的用法恰恰是「摆完位 → 重生这一镜」。
 *
 * - 没摆过位 / 读失败:原样返回(增强项,不能把出片打挂)
 * - 提示词里已经带了站位段:不重复追加
 */
export async function withStageDirective(projectId: string | undefined | null, shotNumber: number, prompt: string): Promise<string> {
  const base = prompt || '';
  if (!projectId || !Number.isFinite(Number(shotNumber)) || base.includes('. Staging:')) return base;
  try {
    const { stageDirectiveForShot } = await import('./stage-blocking');
    const staging = stageDirectiveForShot(await getStageScene(projectId, Number(shotNumber)));
    return staging ? base + staging : base;
  } catch {
    return base;
  }
}

/**
 * v12.318:`stageDirectiveForShot` 已移进 `stage-blocking`(纯几何层)。
 *
 * 原因是踩出来的:本文件动态 `import('./db-driver')` 看似 client-safe,
 * **但 webpack 仍会静态分析动态 import 并把 better-sqlite3 打进客户端包** ——
 * 导演台界面一引用本文件,整个项目页就 `Module not found: fs` 直接 500。
 * 而当时 17 条源码断言全绿:UI 只靠 tsc + 读源码断言,证明不了它能打开。
 *
 * 保留再导出,让服务端调用方(编排器)不必改导入路径,注入口径仍只有一处。
 */
export { stageDirectiveForShot } from './stage-blocking';

/** 给界面用的中文说明 + 体检结果(不进提示词) */
export function stageReport(scene: StageScene) {
  return { description: describeStaging(scene), issues: auditStaging(scene) };
}
