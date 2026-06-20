/**
 * CONTINUITY 主表(Phase 3 · v12.16.0)。
 *
 * 对标工业级分镜模板的「CONTINUITY 主表行」(ShotID/Scene/StylePack/Light/AspectRatio/FPS):
 * 把全片的「连续性契约」收成一行行结构化记录,既能展示,又能**校验跨镜一致性**
 * (同场景光照漂移、画幅/帧率不统一、风格包缺失),把「跨镜像两部片」的隐患在出片前抓出来。
 *
 * 纯函数,不碰网络/DB。
 */

import { normalizeVideoAspect } from '@/lib/video-aspect';

export interface ContinuityRow {
  /** 镜号,如 "S01" */
  shotId: string;
  /** 所在场景(名/描述前缀) */
  scene: string;
  /** 全片风格包(styleKeywords) */
  stylePack: string;
  /** 本镜主光(shot 显式 → 全局兜底) */
  light: string;
  /** 画幅 */
  aspectRatio: string;
  /** 帧率 */
  fps: number;
}

interface ShotLike {
  shotNumber: number;
  sceneDescription?: string;
  lightingIntent?: string;
  globalLighting?: string;
}

const sceneKey = (s?: string): string => (s || '').trim().replace(/（延续）|\(continued\)/gi, '').slice(0, 24) || '(未命名场景)';

/** 构建 CONTINUITY 主表:每镜一行,全局风格/画幅/帧率统一,场景/光照逐镜。 */
export function buildContinuitySheet(input: {
  shots: ShotLike[];
  stylePack?: string;
  aspectRatio?: string;
  fps?: number;
}): ContinuityRow[] {
  const aspect = normalizeVideoAspect(input.aspectRatio);
  const fps = input.fps && input.fps > 0 ? input.fps : 24;
  const stylePack = (input.stylePack || '').trim();
  return (input.shots || []).map((s) => ({
    shotId: `S${String(s.shotNumber).padStart(2, '0')}`,
    scene: sceneKey(s.sceneDescription),
    stylePack,
    light: (s.lightingIntent || s.globalLighting || '').trim() || '(未指定)',
    aspectRatio: aspect,
    fps,
  }));
}

export interface ContinuityValidation {
  passed: boolean;
  issues: string[];
}

/** 校验跨镜一致性:画幅/帧率必须统一、同场景光照应一致、风格包不应缺失。 */
export function validateContinuity(rows: ContinuityRow[]): ContinuityValidation {
  const issues: string[] = [];
  if (rows.length === 0) return { passed: true, issues };

  // 1) 画幅/帧率统一
  const aspects = [...new Set(rows.map((r) => r.aspectRatio))];
  if (aspects.length > 1) issues.push(`画幅不统一:${aspects.join(' / ')}`);
  const fpses = [...new Set(rows.map((r) => r.fps))];
  if (fpses.length > 1) issues.push(`帧率不统一:${fpses.join(' / ')} fps`);

  // 2) 风格包缺失
  if (!rows[0].stylePack) issues.push('风格包(StylePack)为空 —— 跨镜画风无锚点');

  // 3) 同场景光照一致性
  const byScene = new Map<string, ContinuityRow[]>();
  for (const r of rows) {
    const arr = byScene.get(r.scene) || [];
    arr.push(r);
    byScene.set(r.scene, arr);
  }
  for (const [scene, group] of byScene) {
    const lights = [...new Set(group.filter((r) => r.light !== '(未指定)').map((r) => r.light))];
    if (lights.length > 1) {
      issues.push(`场景「${scene}」内光照不一致(${group.map((r) => r.shotId).join('/')}):${lights.join(' vs ')}`);
    }
  }

  return { passed: issues.length === 0, issues };
}
