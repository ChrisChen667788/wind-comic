/**
 * v8.2 — lib/param-linkage 单测 (参数联动 / JSON↔可视化同步)
 */

import { describe, it, expect } from 'vitest';
import {
  buildParamDoc, paramDocToJson, parseParamDoc, diffParamDoc,
} from '@/lib/param-linkage';
import { DEFAULT_SHOT_SPEC } from '@/lib/cinematography';
import { DEFAULT_PROJECT_FORMAT } from '@/lib/project-format';

describe('buildParamDoc', () => {
  it('归一化镜头 spec + 排序 + 默认格式/连贯性', () => {
    const doc = buildParamDoc({
      shots: [{ shotNumber: 2, cameraSpec: { shotSize: 'CU' } }, { shotNumber: 1, cameraSpec: {} }],
    });
    expect(doc.shots.map((s) => s.shotNumber)).toEqual([1, 2]); // 已排序
    expect(doc.shots[1].spec.shotSize).toBe('CU');
    expect(doc.shots[0].spec.lighting).toBeDefined(); // 补默认 (v7.4)
    expect(doc.format).toEqual(DEFAULT_PROJECT_FORMAT);
    expect(doc.continuity.linkMode).toBe('match-cut');
  });
  it('非法 shotNumber 过滤', () => {
    const doc = buildParamDoc({ shots: [{ shotNumber: NaN as any, cameraSpec: {} }, { shotNumber: 3, cameraSpec: {} }] });
    expect(doc.shots.map((s) => s.shotNumber)).toEqual([3]);
  });
  it('空输入 → 空镜 + 默认', () => {
    const doc = buildParamDoc({});
    expect(doc.shots).toEqual([]);
    expect(doc.format).toEqual(DEFAULT_PROJECT_FORMAT);
  });
});

describe('paramDocToJson / parseParamDoc 往返', () => {
  it('round-trip 保真', () => {
    const doc = buildParamDoc({
      shots: [{ shotNumber: 1, cameraSpec: { shotSize: 'WS', lighting: { setup: 'low-key', keyTempK: 3200, contrast: 'high' } } }],
      continuity: { linkMode: 'last-frame', mainSeed: 42 },
      format: { aspectId: '9:16', fps: 30 },
    });
    const json = paramDocToJson(doc);
    const parsed = parseParamDoc(json);
    expect(parsed.ok).toBe(true);
    expect(parsed.doc).toEqual(doc);
  });
  it('JSON 语法错误 → ok:false + error', () => {
    const r = parseParamDoc('{ not json ');
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/JSON 语法/);
  });
  it('顶层非对象 → error', () => {
    expect(parseParamDoc('123').ok).toBe(false);
    expect(parseParamDoc('"x"').error).toMatch(/对象/);
  });
  it('缺字段也能解析 (容错补默认)', () => {
    const r = parseParamDoc('{"shots":[{"shotNumber":1}]}');
    expect(r.ok).toBe(true);
    expect(r.doc!.shots[0].spec).toEqual(DEFAULT_SHOT_SPEC);
  });
});

describe('diffParamDoc', () => {
  // 固定 continuity/format 基线 (避免随机种子导致 continuity 误判变化 — 真实场景下 next 由序列化文档解析而来, 种子已固定)
  const fixed = { continuity: { mainSeed: 1, auxSeed: 2 }, format: { aspectId: 'scope' } };
  const base = buildParamDoc({
    shots: [{ shotNumber: 1, cameraSpec: { shotSize: 'MS' } }, { shotNumber: 2, cameraSpec: { shotSize: 'WS' } }],
    ...fixed,
  });
  it('镜级变化检出', () => {
    const next = buildParamDoc({
      shots: [{ shotNumber: 1, cameraSpec: { shotSize: 'CU' } }, { shotNumber: 2, cameraSpec: { shotSize: 'WS' } }],
      ...fixed,
    });
    const d = diffParamDoc(base, next);
    expect(d.changedShots).toEqual([1]);
    expect(d.formatChanged).toBe(false);
    expect(d.continuityChanged).toBe(false);
    expect(d.total).toBe(1);
  });
  it('格式/连贯性变化检出', () => {
    const next = buildParamDoc({
      shots: [{ shotNumber: 1, cameraSpec: { shotSize: 'MS' } }, { shotNumber: 2, cameraSpec: { shotSize: 'WS' } }],
      format: { aspectId: '9:16' },
      continuity: { mainSeed: 1, auxSeed: 2, linkMode: 'hard-cut' },
    });
    const d = diffParamDoc(base, next);
    expect(d.changedShots).toEqual([]);
    expect(d.formatChanged).toBe(true);
    expect(d.continuityChanged).toBe(true);
    expect(d.total).toBe(2);
  });
  it('无变化 → total 0', () => {
    expect(diffParamDoc(base, base).total).toBe(0);
  });
});
