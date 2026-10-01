/**
 * 镜头语言草图锁(v12.135.0,issue #2 调研落地 —— 可选,默认关)。
 *
 * 背景:字节 Seedance / 快手 Kling 都靠「多角度参考图建身份 + 首帧/参考图约束构图」提升可控性;
 * 腾讯智影(已停服)的做法是脚本→AI 分镜面板→合成。真正可落地的结构约束技术 = ControlNet
 * (scribble/lineart)或首帧 img2img。本模块是**引擎侧地基**:当某镜带一张手绘/AI 草图且开启草图锁时,
 * 把草图作**首要构图参考**并入 refs + 追加「锁定构图/机位/角色位置」提示,让出图模型遵循草图的空间布局。
 *
 * 默认关(`STORYBOARD_SKETCH_LOCK=1` 或按请求显式 opt-in)。当前用参考图通道(软构图约束,复用 v12.133
 * 修好的真图输入);未来 ComfyUI ControlNet 可做刚性硬锁(见 sketchApplyMode 的 'controlnet' 档)。
 * 纯逻辑,可单测。
 */

import { isInlineImage } from './image-router';

export const SKETCH_LOCK_ENV = 'STORYBOARD_SKETCH_LOCK';

/** 是否启用草图锁(默认关):本次请求显式 opt-in 优先,否则看 env。 */
export function shouldSketchLock(env: NodeJS.ProcessEnv = process.env, requestOptIn?: boolean): boolean {
  if (requestOptIn === true) return true;
  if (requestOptIn === false) return false;   // 显式关优先于 env
  return env[SKETCH_LOCK_ENV] === '1';
}

export interface SketchCameraMeta { shotSize?: string; angle?: string; movement?: string }

/** 草图约束提示(纯):令出图模型严格遵循参考草图的构图/机位/角色位置,细节/配色/画风仍由 prompt 决定。 */
export function buildSketchDirective(meta?: SketchCameraMeta): string {
  const extra = [
    meta?.shotSize ? `shot size: ${meta.shotSize}` : '',
    meta?.angle ? `camera angle: ${meta.angle}` : '',
    meta?.movement ? `camera move: ${meta.movement}` : '',
  ].filter(Boolean).join('; ');
  return ` [STORYBOARD LOCK] Strictly follow the composition, framing, subject placement and camera angle of the provided reference storyboard sketch${extra ? ` (${extra})` : ''}. The sketch defines LAYOUT ONLY — render full detail, color and style from the prompt, but keep the sketch's spatial arrangement.`;
}

/**
 * 把草图作为**首要构图参考**并入 refs(置最前、去重、限 4;既非 http 也非内联图的丢弃)。
 * v12.463:保留内联图 —— 本地存储下草图经 toEngineImage 转成 base64,修前在这里被当成「非 http」丢掉,
 * 草图锁从没把草图送到过引擎。认不认得内联图由各引擎按 image-router.refsForEngine 自己取。
 */
export function mergeSketchIntoRefs(sketchUrl: string, refs?: string[]): string[] {
  const merged = [sketchUrl, ...(refs || [])].filter((u) => typeof u === 'string' && (u.startsWith('http') || isInlineImage(u)));
  const seen = new Set<string>();
  return merged.filter((u) => (seen.has(u) ? false : (seen.add(u), true))).slice(0, 4);
}

/**
 * v12.136 AI 草图生成 prompt(纯):把镜头场景 + 机位元数据 → 「粗线稿黑白分镜草图」出图 prompt。
 * 刻意压低细节/配色(只要构图),这样它作构图参考时不会污染最终成片的画风。
 */
export function buildSketchGenPrompt(sceneDescription: string, meta?: SketchCameraMeta): string {
  const cam = [
    meta?.shotSize ? `shot size: ${meta.shotSize}` : '',
    meta?.angle ? `camera angle: ${meta.angle}` : '',
    meta?.movement ? `camera move: ${meta.movement}` : '',
  ].filter(Boolean).join(', ');
  const scene = (sceneDescription || '').trim().slice(0, 400) || 'a single shot';
  return `Rough black-and-white storyboard thumbnail sketch, loose pencil line art, monochrome, no color, minimal shading, simple clean composition lines. Scene: ${scene}.${cam ? ` Camera — ${cam}.` : ''} Show only layout: framing, character placement and scale within the frame, foreground/background blocking. Storyboard panel style, not a finished illustration.`;
}

/** 每引擎的草图施加方式(纯):comfyui+ControlNet→硬锁;主流 image 引擎→构图参考图;其余→不适用。 */
export type SketchApplyMode = 'controlnet' | 'reference' | 'none';
export function sketchApplyMode(engine: string, comfyControlNet = false): SketchApplyMode {
  if (comfyControlNet && engine === 'comfyui') return 'controlnet';
  if (['falflux', 'kontext', 'mj', 'minimax-multi', 'minimax-single', 'seedream'].includes(engine)) return 'reference';
  return 'none';
}

/**
 * v12.463:这张草图到底送不送得到出图引擎。送不到就**不追加**草图锁的提示 ——
 * 「Strictly follow … the provided reference storyboard sketch」而图根本没给,只会让模型去猜一张不存在的图。
 *  - http:照旧(能取图的引擎自己取);
 *  - 内联图(本地存储):只有 MiniMax / fal 认得,两家都不可用就送不到;
 *  - 其它(没转成功的站内相对地址等):送不到。
 */
export function sketchDeliverable(engSketch: string, avail: { falAvailable: boolean; minimaxAvailable: boolean }): boolean {
  if (engSketch.startsWith('http')) return true;
  if (isInlineImage(engSketch) && (avail.falAvailable || avail.minimaxAvailable)) return true;
  console.warn(`[SketchLock] 草图送不到出图引擎(${isInlineImage(engSketch) ? '本地草图只有 MiniMax / fal 收得了,两家都没配' : '地址引擎取不到'})—— 这次不加草图锁提示,按普通重生出图`);
  return false;
}
