/**
 * v12.297 — 导出的剪辑线时间轴仍是**纯累加**,没减掉每次溶解的重叠。
 *
 * 病根在 `lib/xfade-timeline` 的注释里写得明明白白 ——「配音按 durations 纯累加、不减转场重叠
 * → 逐镜滞后 Σ effectiveTd」。**v12.264/265 在成片里修掉了它,v12.277 做导出时又原样犯了一遍。**
 *
 * 为什么 EDL 里「看起来自洽」却仍然错:画面轨与音轨在文件里都按绝对秒排,看着对齐;
 * 但 NLE **应用 D(溶解)事件时,画面轨会因重叠而压缩**,音轨不会 —— 于是配音相对画面逐镜后移。
 * n 镜项目最大偏 (n−1)×转场时长:6 镜 × 0.5s = 2.5s,足够让口型彻底脱节。
 *
 * 修法:导出侧改用与成片同一份 `computeXfadeTimeline`(v12.265 立的单一真源),
 * 覆盖三处此前各自纯累加的地方:EDL 的 record-in、FCPXML 的 start/end、以及配音起点与节奏标记。
 * 为此把该函数从 `services/video-composer`(拖着 ffmpeg 依赖)抽到 `lib/xfade-timeline`。
 */
import { describe, it, expect } from 'vitest';
import {
  buildEDL, buildFCPXML, xfadeRecordStarts, xfadeRecordStartsSec, type EdlShot,
} from '@/lib/edl-export';
import { computeXfadeTimeline } from '@/lib/xfade-timeline';

/** 6 镜 × 5s,镜间 0.5s 溶解 —— 复核给的失败场景原型 */
const SIX: EdlShot[] = Array.from({ length: 6 }, (_, i) => ({
  name: `Shot 0${i + 1}`,
  durationS: 5,
  transition: i === 0 ? '' : 'cross-dissolve',
  transitionDurationS: i === 0 ? 0 : 0.5,
}));

describe('v12.297 · 压缩时间轴取代纯累加', () => {
  it('对照:纯累加会让第 6 镜起点比实际晚 2.5s((n−1)×转场时长)', () => {
    const naive = SIX.reduce((acc: number[], s, i) => {
      acc.push(i === 0 ? 0 : acc[i - 1] + SIX[i - 1].durationS); return acc;
    }, []);
    const real = xfadeRecordStartsSec(SIX);
    expect(naive[5]).toBe(25);
    expect(real[5]).toBe(22.5);
    expect(naive[5] - real[5], '5 次转场 × 0.5s').toBeCloseTo(2.5, 6);
  });

  it('与成片同源:逐镜起点 === computeXfadeTimeline 的结果', () => {
    const tds = SIX.map((s, i) => (i === 0 ? 0 : 0.5));
    const { clipStartSec } = computeXfadeTimeline(SIX.map((s) => s.durationS), tds);
    expect(xfadeRecordStartsSec(SIX)).toEqual(clipStartSec);
  });

  it('硬切不压缩(cut/flash-cut/空值重叠为 0)', () => {
    for (const t of ['cut', 'flash-cut', '', undefined]) {
      const shots: EdlShot[] = [
        { name: 'A', durationS: 4 },
        { name: 'B', durationS: 4, transition: t as any, transitionDurationS: 0.9 },
      ];
      expect(xfadeRecordStartsSec(shots)[1], `transition=${t}`).toBe(4);
    }
  });

  it('未回写 transitionDurationS 的老项目沿用 0.5s 兜底(行为不倒退)', () => {
    const shots: EdlShot[] = [
      { name: 'A', durationS: 4 },
      { name: 'B', durationS: 4, transition: 'cross-dissolve' },
    ];
    expect(xfadeRecordStartsSec(shots)[1]).toBe(3.5);
  });

  it('首镜恒为 0,且不会被负偏移', () => {
    expect(xfadeRecordStartsSec(SIX)[0]).toBe(0);
    const weird: EdlShot[] = [{ name: 'A', durationS: 1, transition: 'cross-dissolve', transitionDurationS: 99 }];
    expect(xfadeRecordStartsSec(weird)[0]).toBe(0);
  });

  it('转场比镜头还长时不产生倒退的时间轴(起点单调不减)', () => {
    const shots: EdlShot[] = [
      { name: 'A', durationS: 2 },
      { name: 'B', durationS: 2, transition: 'cross-dissolve', transitionDurationS: 10 },
      { name: 'C', durationS: 2, transition: 'cross-dissolve', transitionDurationS: 10 },
    ];
    const st = xfadeRecordStartsSec(shots);
    for (let i = 1; i < st.length; i++) expect(st[i]).toBeGreaterThanOrEqual(st[i - 1]);
  });

  it('空输入不炸', () => {
    expect(xfadeRecordStartsSec([])).toEqual([]);
    expect(xfadeRecordStarts([], 24)).toEqual([]);
  });
});

describe('v12.297 · 秒→帧只转一次(v12.277 栽过的精度坑)', () => {
  it('亚秒时长不被先取整再转帧', () => {
    const shots: EdlShot[] = [
      { name: 'A', durationS: 3.5 },
      { name: 'B', durationS: 3.5, transition: 'cut' },
    ];
    // 3.5s @24fps = 84 帧;若先 Math.round(3.5)=4 再 ×24 会得到 96
    expect(xfadeRecordStarts(shots, 24)[1]).toBe(84);
  });

  it('帧版本 === 秒版本 × fps(不是各自算一遍)', () => {
    const sec = xfadeRecordStartsSec(SIX);
    const frm = xfadeRecordStarts(SIX, 24);
    sec.forEach((s, i) => expect(frm[i]).toBe(Math.round(s * 24)));
  });
});

/** 先剥注释再匹配 —— 否则解释病根的注释会把断言弄红(v12.240 的教训,这次又踩了一下) */
const stripComments = (t: string) =>
  t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

describe('v12.297 · 三处输出都用上了压缩时间轴', () => {
  it('EDL 的 record-in:第 6 镜落在 22.5s 而非 25s', () => {
    const edl = buildEDL(SIX, 24, 'T');
    expect(edl, '22.5s = 00:00:22:12 @24fps').toContain('00:00:22:12');
    expect(edl, '25s 是纯累加的错值').not.toContain('00:00:25:00');
  });

  it('FCPXML 的 start/end 同样压缩,总长也跟着对', () => {
    const xml = buildFCPXML(SIX, 24, 'T');
    expect(xml).toContain('<start>540</start>');          // 22.5s × 24
    expect(xml).not.toContain('<start>600</start>');       // 25s × 24(错值)
    expect(xml).toContain('<duration>660</duration>');     // 总长 27.5s × 24
  });

  it('配音起点跟着画面走(导出路由把 startS 交给同一份时间轴)', () => {
    const src = stripComments(require('node:fs')
      .readFileSync('app/api/projects/[id]/export-edl/route.ts', 'utf-8') as string);
    expect(src).toContain('xfadeRecordStartsSec(shots)');
    expect(src, '纯累加必须消失').not.toMatch(/cursor \+= sh\.durationS/);
  });

  it('节奏审计标记也走压缩时间轴(否则「第 3~5 镜拖沓」标错位置)', () => {
    const src = stripComments(require('node:fs')
      .readFileSync('app/api/projects/[id]/export-edl/route.ts', 'utf-8') as string);
    const i = src.indexOf('pacingReportToMarkers');
    expect(src.slice(Math.max(0, i - 300), i + 120)).toContain('xfadeRecordStartsSec');
    expect(src.slice(Math.max(0, i - 300), i + 120), '旧的 cur += 累加必须消失')
      .not.toMatch(/cur \+= sh\.durationS/);
  });
});

describe('v12.297 · 单一真源没有被复制成第二份', () => {
  it('computeXfadeTimeline 只有一处实现,video-composer 只是重导出', () => {
    const fs = require('node:fs');
    const lib = fs.readFileSync('lib/xfade-timeline.ts', 'utf-8') as string;
    const comp = fs.readFileSync('services/video-composer.ts', 'utf-8') as string;
    expect(lib).toContain('export function computeXfadeTimeline');
    expect(comp, 'video-composer 不该再自带一份实现').not.toContain('export function computeXfadeTimeline');
    expect(comp).toContain("export { computeXfadeTimeline } from '@/lib/xfade-timeline'");
  });

  it('抽出的 lib 是零依赖纯函数(导出侧不该被 ffmpeg 依赖拖下水)', () => {
    const lib = require('node:fs').readFileSync('lib/xfade-timeline.ts', 'utf-8') as string;
    expect(lib).not.toMatch(/^import .*ffmpeg/m);
    expect(lib).not.toMatch(/^import /m);
  });
});
