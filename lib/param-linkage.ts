/**
 * lib/param-linkage (v8.2) — 参数联动 / JSON↔可视化同步 (对标 CineMatrix「Parameter Linkage / JSON to Visual Sync」)
 *
 * 把项目的结构化参数 (每镜 ShotSpec + 连贯性 + 项目格式) 收成一份「可读可编辑的 JSON 文档」,
 * 与可视化 (分镜卡/时间线) 双向同步:
 *   - buildParamDoc(): 现状 → ParamDoc (全部 normalize)
 *   - paramDocToJson() / parseParamDoc(): JSON 字符串 ↔ ParamDoc (校验 + 容错)
 *   - diffParamDoc(): 算出哪些镜/格式/连贯性发生变化 (同步前预览影响面)
 */

import { normalizeShotSpec, type ShotSpec } from './cinematography';
import { normalizeContinuitySettings, type ContinuitySettings } from './continuity';
import { normalizeProjectFormat, type ProjectFormat } from './project-format';

export interface ParamDocShot {
  shotNumber: number;
  spec: ShotSpec;
}

export interface ParamDoc {
  format: ProjectFormat;
  continuity: ContinuitySettings;
  shots: ParamDocShot[];
}

export function buildParamDoc(input: {
  shots?: { shotNumber: number; cameraSpec?: any }[];
  continuity?: any;
  format?: any;
}): ParamDoc {
  const shots = (Array.isArray(input.shots) ? input.shots : [])
    .filter((s) => Number.isFinite(Number(s?.shotNumber)))
    .map((s) => ({ shotNumber: Number(s.shotNumber), spec: normalizeShotSpec(s.cameraSpec) }))
    .sort((a, b) => a.shotNumber - b.shotNumber);
  return {
    format: normalizeProjectFormat(input.format),
    continuity: normalizeContinuitySettings(input.continuity),
    shots,
  };
}

export function paramDocToJson(doc: ParamDoc): string {
  return JSON.stringify(doc, null, 2);
}

/** JSON 字符串 → ParamDoc (解析失败/字段非法都安全降级, 返回 error 供 UI 提示) */
export function parseParamDoc(text: string): { ok: boolean; doc?: ParamDoc; error?: string } {
  let raw: any;
  try {
    raw = JSON.parse(text);
  } catch (e: any) {
    return { ok: false, error: 'JSON 语法错误: ' + (e?.message || '无法解析') };
  }
  if (!raw || typeof raw !== 'object') return { ok: false, error: '顶层必须是对象' };
  const doc = buildParamDoc({
    shots: Array.isArray(raw.shots)
      ? raw.shots.map((s: any) => ({ shotNumber: Number(s?.shotNumber), cameraSpec: s?.spec }))
      : [],
    continuity: raw.continuity,
    format: raw.format,
  });
  return { ok: true, doc };
}

export interface ParamDiff {
  changedShots: number[];
  formatChanged: boolean;
  continuityChanged: boolean;
  total: number;
}

/** 算 a→b 的变化 (镜级按 spec JSON 比对) */
export function diffParamDoc(a: ParamDoc, b: ParamDoc): ParamDiff {
  const aMap = new Map(a.shots.map((s) => [s.shotNumber, JSON.stringify(s.spec)]));
  const changedShots: number[] = [];
  for (const s of b.shots) {
    if (aMap.get(s.shotNumber) !== JSON.stringify(s.spec)) changedShots.push(s.shotNumber);
  }
  const formatChanged = JSON.stringify(a.format) !== JSON.stringify(b.format);
  const continuityChanged = JSON.stringify(a.continuity) !== JSON.stringify(b.continuity);
  return {
    changedShots,
    formatChanged,
    continuityChanged,
    total: changedShots.length + (formatChanged ? 1 : 0) + (continuityChanged ? 1 : 0),
  };
}
