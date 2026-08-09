/**
 * v12.298 — 「设计值 vs 成片值」的**第二层**:时长。
 *
 * v12.277 修的是「导出读 script 还是读 timeline」;v12.289/292/293 修的是转场。
 * 但 timeline 里的 `duration` **本身就不是成片值** —— 合成时它还会被改三次:
 *   ① 情绪调速(`applyEmotionPacing`,高张力镜最多压到 0.6×)
 *   ② 卡点吸附(`snapDurationsToBeatsClamped`)
 *   ③ 逐镜变速(`durations[i] /= speed`)
 * 三步都在 `composeVideo` 内部,**从不回传**。10 镜项目实测可累计漂 6.6s ——
 * 剪辑师按 EDL 找第 8 镜入点,画面早就过去了。
 *
 * 同一处还有第二个坑:`editResult.totalDuration` 是**出片前**按设计时长求和算的。
 * 8 镜 × 5s = 40s,而情绪调速压 8s + 7 次 xfade × 0.5s 压 3.5s → 成片实际 28.5s。
 * 这个 40s 会写进 final_video 元数据、进前端展示、进平台发布预检的时长合规判断。
 *
 * 修法与 v12.289 完全同构:composeVideo 回传 `renderedDurations`(必填,删掉即 tsc 报错),
 * editor-agent 用共享纯函数 `applyRenderedDurations` 写回 timeline,并把 totalDuration
 * 换成成片真值(设计值保留为 `designedTotalDuration`,配乐生成仍需要它)。
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import { applyRenderedDurations } from '@/lib/edit-rhythm';
import { buildEDL, xfadeRecordStartsSec, type EdlShot } from '@/lib/edl-export';

const stripComments = (t: string) =>
  t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const EDITOR = stripComments(fs.readFileSync('services/agents/editor-agent.ts', 'utf-8'));
const COMPOSER = stripComments(fs.readFileSync('services/video-composer.ts', 'utf-8'));

const mkTimeline = () => ([
  { shotNumber: 1, duration: 5 },
  { shotNumber: 2, duration: 5 },
  { shotNumber: 3, duration: 5 },
  { shotNumber: 4, duration: 5 },
] as any[]);

describe('v12.298 · applyRenderedDurations 回写', () => {
  it('把设计时长改成成片终值', () => {
    const tl = mkTimeline();
    const n = applyRenderedDurations(tl, [
      { shotNumber: 2, durationS: 3.5 },
      { shotNumber: 3, durationS: 4.2 },
    ]);
    expect(n).toBe(2);
    expect(tl[1].duration).toBe(3.5);
    expect(tl[2].duration).toBe(4.2);
    expect(tl[0].duration, '未回传的镜不动').toBe(5);
  });

  it('**按 shotNumber 对齐,不是下标**(合成端过滤掉了无效视频镜)', () => {
    const tl = mkTimeline();
    applyRenderedDurations(tl, [{ shotNumber: 3, durationS: 2.1 }]);
    expect(tl.find((t) => t.shotNumber === 3)!.duration).toBe(2.1);
    expect(tl.find((t) => t.shotNumber === 1)!.duration).toBe(5);
  });

  it('零回归:无回传 / 空数组 / null 一个字段都不动', () => {
    for (const r of [undefined, null, []] as any[]) {
      const tl = mkTimeline();
      const before = JSON.stringify(tl);
      expect(applyRenderedDurations(tl, r)).toBe(0);
      expect(JSON.stringify(tl)).toBe(before);
    }
    expect(() => applyRenderedDurations(null as any, [])).not.toThrow();
  });

  it('脏数据不落盘(缺镜号 / 非有限值 / 非正数)', () => {
    const tl = mkTimeline();
    applyRenderedDurations(tl, [
      { durationS: 3 } as any,
      { shotNumber: 2, durationS: NaN },
      { shotNumber: 3, durationS: 0 },
      { shotNumber: 4, durationS: -1 },
    ]);
    expect(tl.every((t) => t.duration === 5), '一个脏值都不该写进去').toBe(true);
  });

  it('亚秒精度不被抹掉(变速后几乎全是小数)', () => {
    const tl = mkTimeline();
    applyRenderedDurations(tl, [{ shotNumber: 1, durationS: 5.714285 }]);
    expect(tl[0].duration).toBeCloseTo(5.714285, 6);
  });
});

describe('v12.298 · 端到端:导出的每镜时长与成片一致', () => {
  it('回写前后 EDL 的时间码确实不同(否则本版无病可修)', () => {
    const mkShots = (tl: any[]): EdlShot[] => tl.map((t) => ({
      name: `Shot 0${t.shotNumber}`, durationS: t.duration, transition: t.shotNumber === 1 ? '' : 'cut',
    }));
    const design = mkTimeline();
    const real = mkTimeline();
    // 情绪调速把第 2、3 镜压到 3.5s
    applyRenderedDurations(real, [{ shotNumber: 2, durationS: 3.5 }, { shotNumber: 3, durationS: 3.5 }]);

    expect(xfadeRecordStartsSec(mkShots(design))).toEqual([0, 5, 10, 15]);
    expect(xfadeRecordStartsSec(mkShots(real))).toEqual([0, 5, 8.5, 12]);
    expect(buildEDL(mkShots(design), 24)).not.toBe(buildEDL(mkShots(real), 24));
  });

  it('累计漂移可观:4 镜就差 3s,10 镜项目实测 6.6s', () => {
    const design = mkTimeline();
    const real = mkTimeline();
    applyRenderedDurations(real, [2, 3, 4].map((sn) => ({ shotNumber: sn, durationS: 4 })));
    const last = (tl: any[]) => tl.reduce((a, t) => a + t.duration, 0);
    expect(last(design) - last(real)).toBe(3);
  });
});

describe('v12.298 · 接线(两条出片路径都要回写)', () => {
  it('ComposeResult.renderedDurations 是**必填** —— 删掉任一 resolve 出口即 tsc 报错', () => {
    const i = COMPOSER.indexOf('export interface ComposeResult');
    const block = COMPOSER.slice(i, i + 1200);
    expect(block).toMatch(/renderedDurations: RenderedDuration\[\];/);
    expect(block, '写成可选就检测不到删除了').not.toMatch(/renderedDurations\?:/);
  });

  it('回传在 durations 终值定型之后构建(否则拿到的还是中间值)', () => {
    const iPlan = COMPOSER.indexOf('computeTransitionPlan({');
    const iDur = COMPOSER.indexOf('const renderedDurations: RenderedDuration[]');
    expect(iPlan).toBeGreaterThan(0);
    expect(iDur, '必须在 computeTransitionPlan 之后').toBeGreaterThan(iPlan);
    // 逐镜变速(最后一次改写)在更前面
    expect(COMPOSER.indexOf('durations[i] = durations[i] / speed')).toBeLessThan(iDur);
  });

  it('主路径与降级路径都回写时长(v12.292 的教训:别只接主路)', () => {
    expect(EDITOR).toContain('applyRenderedDurations(timeline as any[], result.renderedDurations)');
    expect(EDITOR).toContain('applyRenderedDurations(timeline as any[], simpleResult.renderedDurations)');
  });

  it('totalDuration 改用成片真值,设计值另存(配乐生成仍要用设计值)', () => {
    expect(EDITOR).toContain('let actualTotalDuration = totalDuration');
    expect(EDITOR).toContain('actualTotalDuration = result.totalDuration');
    expect(EDITOR).toContain('totalDuration: actualTotalDuration');
    expect(EDITOR).toContain('designedTotalDuration: totalDuration');
  });

  it('配乐仍按设计总时长生成(它在出片前跑,用成片值是不可能的)', () => {
    const i = EDITOR.indexOf('musicPrompt');
    expect(EDITOR.slice(i, i + 200)).toContain('${totalDuration}');
  });
});
