/**
 * v12.289 — 导出的剪辑线终于与成片一致:成片**实际**转场回写 timeline。
 *
 * 这条打脸我自己的 v12.277 —— 那版把转场接进了 EDL/AAF 导出,却**没核对哪份转场才是权威**。
 * 实情是全片有**两套**转场,各写各的:
 *
 *   ① `editor-agent` 出片前定的**设计值** → 存进 timeline → **导出读的是这份**
 *      其兜底分支是 `transition = i % 2 === 0 ? 'cross-dissolve' : 'cut'` —— **按镜号奇偶**,与剧情无关;
 *   ② `video-composer` 合成时 `selectTransitions(...)` 按**张力曲线 + 关键镜**重挑 → **成片用的是这份**,
 *      时长还被 `min(相邻时长)/2` 夹过。
 *
 * 更糟:`transitionDurationS` 在生产端**从没有任何代码写过**,EDL 导出恒走 `?? 0.5` 兜底。
 * 于是剪辑线里写「溶解 0.5s」,成片里可能是硬切、也可能是 1.3× 长的 fade。
 * 与 v12.277 修的「设计时长 vs 成片时长」是同一类病,只是换到了转场上。
 */
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import { selectTransitions, applyRenderedTransitions } from '@/lib/edit-rhythm';
import { buildEDL, isDissolveTransition, type EdlShot } from '@/lib/edl-export';

const EDITOR_SRC = fs.readFileSync('services/agents/editor-agent.ts', 'utf-8');
const COMPOSER_SRC = fs.readFileSync('services/video-composer.ts', 'utf-8');

/** 复刻 editor-agent 的奇偶兜底,用于对照 */
const parityTransition = (i: number) => (i % 2 === 0 ? 'cross-dissolve' : 'cut');

describe('v12.289 · 病根:设计转场与成片转场确实分叉', () => {
  // 一条明确的张力曲线:平 → 陡升 → 峰值 → 回落
  const clips = [
    { shotNumber: 1, tensionLevel: 2, emotionTemperature: 1, hasDialogue: true },
    { shotNumber: 2, tensionLevel: 2, emotionTemperature: 1, hasDialogue: true },
    { shotNumber: 3, tensionLevel: 8, emotionTemperature: 6, hasDialogue: false },
    { shotNumber: 4, tensionLevel: 9, emotionTemperature: 9, hasDialogue: false },
    { shotNumber: 5, tensionLevel: 3, emotionTemperature: 2, hasDialogue: true },
  ];

  it('对照:奇偶兜底与剧情毫无关系(张力曲线怎么变,它都不变)', () => {
    const flat = clips.map((_, i) => parityTransition(i));
    const spiky = clips.map((_, i) => parityTransition(i)); // 同一组下标 → 必然同结果
    expect(flat).toEqual(spiky);
    expect(new Set(flat).size, '奇偶只有两种取值').toBe(2);
  });

  it('成片端 selectTransitions 会挑出与奇偶完全不同的一组', () => {
    const real = selectTransitions(clips as any, new Set([4]));
    const design = clips.map((_, i) => parityTransition(i));
    // 首镜无入场转场,从第 2 镜起比
    const diff = real.slice(1).filter((t, k) => t !== design[k + 1]).length;
    expect(diff, '两套转场至少有一镜不同 —— 否则本版无病可修').toBeGreaterThan(0);
  });

  it('成片端能挑出奇偶压根产不出的转场类型', () => {
    const real = selectTransitions(clips as any, new Set([4]));
    const parityVocab = new Set(['cross-dissolve', 'cut']);
    expect(real.slice(1).some((t) => !parityVocab.has(t))).toBe(true);
  });
});

describe('v12.289 · applyRenderedTransitions 回写', () => {
  const mkTimeline = () => [
    { shotNumber: 1, transition: 'cross-dissolve' },
    { shotNumber: 2, transition: 'cut' },
    { shotNumber: 3, transition: 'cross-dissolve' },
    { shotNumber: 4, transition: 'cut' },
    { shotNumber: 5, transition: 'cross-dissolve' },
  ] as any[];

  it('类型与时长都被改成成片实际值', () => {
    const tl = mkTimeline();
    const n = applyRenderedTransitions(tl, [
      { shotNumber: 2, transition: 'fadeblack', transitionDurationS: 0.72 },
      { shotNumber: 3, transition: 'cut', transitionDurationS: 0.1 },
    ]);
    expect(n).toBe(2);
    expect(tl[1]).toMatchObject({ transition: 'fadeblack', transitionDurationS: 0.72 });
    expect(tl[2]).toMatchObject({ transition: 'cut', transitionDurationS: 0.1 });
  });

  it('**按 shotNumber 对齐,不是下标** —— 合成端跳过了无效视频镜', () => {
    const tl = mkTimeline();
    // 假设第 2、4 镜视频失败被过滤,合成里只剩 1/3/5 → 回传的是 3、5(首镜无入场转场)
    applyRenderedTransitions(tl, [
      { shotNumber: 3, transition: 'wipeleft', transitionDurationS: 0.4 },
      { shotNumber: 5, transition: 'fade', transitionDurationS: 0.9 },
    ]);
    expect(tl.find((t) => t.shotNumber === 3)!.transition).toBe('wipeleft');
    expect(tl.find((t) => t.shotNumber === 5)!.transition).toBe('fade');
    // 若按下标写,第 2、3 号镜会被误改
    expect(tl.find((t) => t.shotNumber === 2)!.transition).toBe('cut');
    expect(tl.find((t) => t.shotNumber === 2)!.transitionDurationS).toBeUndefined();
  });

  it('未回传的镜(视频失败被过滤等)一个字段都不动', () => {
    const tl = mkTimeline();
    applyRenderedTransitions(tl, [{ shotNumber: 4, transition: 'radial', transitionDurationS: 0.5 }]);
    expect(tl[0]).toEqual({ shotNumber: 1, transition: 'cross-dissolve' });
    expect(tl[0].transitionDurationS).toBeUndefined();
  });

  it('首镜以空转场回传 → 清掉设计值(成片首镜无入场转场)', () => {
    const tl = mkTimeline();
    const n = applyRenderedTransitions(tl, [
      { shotNumber: 1, transition: '', transitionDurationS: 0 },
      { shotNumber: 2, transition: 'fade', transitionDurationS: 0.6 },
    ]);
    expect(n).toBe(2);
    expect(tl[0].transition).toBe('');
    expect(tl[0].transitionDurationS).toBe(0);
    expect(isDissolveTransition(tl[0].transition), '空转场不该被当成溶解').toBe(false);
  });

  it('零回归:无回传 / 空数组 / null 一律不改不炸', () => {
    for (const rendered of [undefined, null, []] as any[]) {
      const tl = mkTimeline();
      const before = JSON.stringify(tl);
      expect(applyRenderedTransitions(tl, rendered)).toBe(0);
      expect(JSON.stringify(tl)).toBe(before);
    }
    expect(() => applyRenderedTransitions(null as any, [])).not.toThrow();
    expect(applyRenderedTransitions(undefined as any, [{ shotNumber: 1, transition: 'cut', transitionDurationS: 1 }])).toBe(0);
  });

  it('脏数据不落进 timeline(缺 shotNumber / 非字符串转场)', () => {
    const tl = mkTimeline();
    applyRenderedTransitions(tl, [
      { transition: 'fade', transitionDurationS: 0.5 } as any,
      { shotNumber: 3, transition: null, transitionDurationS: 0.5 } as any,
    ]);
    expect(tl.every((t) => ['cross-dissolve', 'cut'].includes(t.transition))).toBe(true);
  });

  it('时长非有限值时只改类型,不写脏时长', () => {
    const tl = mkTimeline();
    applyRenderedTransitions(tl, [{ shotNumber: 2, transition: 'fade', transitionDurationS: NaN }]);
    expect(tl[1].transition).toBe('fade');
    expect(tl[1].transitionDurationS).toBeUndefined();
  });
});

describe('v12.289 · 导出到 EDL 后确实是成片那份', () => {
  const fps = 24;
  const mkShots = (tl: any[]): EdlShot[] =>
    tl.map((t) => ({
      name: `Shot ${String(t.shotNumber).padStart(2, '0')}`,
      durationS: 4,
      transition: t.transition,
      transitionDurationS: t.transitionDurationS,
    }));

  /** 未回写时 timeline 里躺着的设计值(奇偶兜底,且无 transitionDurationS) */
  const designTl = () => [
    { shotNumber: 1, transition: 'cross-dissolve' },
    { shotNumber: 2, transition: 'cross-dissolve' },
  ] as any[];

  it('修复前:时长恒被兜底成 0.5s(12 帧),且首镜多出一条无物可溶的入场溶解', () => {
    const edl = buildEDL(mkShots(designTl()), fps);
    expect(edl).toContain('D    012'); // 0.5 * 24 —— 与成片实际时长无关
    expect(edl.slice(0, edl.indexOf('Shot 02'))).toContain('EFFECT NAME: CROSS DISSOLVE');
  });

  it('修复后:导出的转场帧数 = 成片实际时长,首镜不再有假转场', () => {
    const tl = designTl();
    applyRenderedTransitions(tl, [
      { shotNumber: 1, transition: '', transitionDurationS: 0 },
      { shotNumber: 2, transition: 'fadeblack', transitionDurationS: 1.25 },
    ]);
    const edl = buildEDL(mkShots(tl), fps);
    expect(edl).toContain('D    030'); // 1.25 * 24
    expect(edl).not.toContain('D    012');
    expect(edl.slice(0, edl.indexOf('Shot 01'))).not.toContain('EFFECT NAME: CROSS DISSOLVE');
  });

  it('成片是硬切时,剪辑线也必须是硬切(此前会写成溶解)', () => {
    const tl = designTl();
    expect(isDissolveTransition(tl[1].transition), '修复前:剪辑线说溶解').toBe(true);
    applyRenderedTransitions(tl, [
      { shotNumber: 1, transition: '', transitionDurationS: 0 },
      { shotNumber: 2, transition: 'cut', transitionDurationS: 0.1 },
    ]);
    expect(isDissolveTransition(tl[1].transition), '成片其实是硬切').toBe(false);
    expect(buildEDL(mkShots(tl), fps)).not.toContain('EFFECT NAME: CROSS DISSOLVE');
  });
});

describe('v12.289 · 接线', () => {
  it('合成端在算 effectiveTds 的同一趟循环里记录实际转场(不另起一套)', () => {
    const i = COMPOSER_SRC.indexOf('const renderedTransitions: RenderedTransition[] = []');
    expect(i, '未找到回传数组').toBeGreaterThan(0);
    const block = COMPOSER_SRC.slice(i, i + 1400);
    expect(block).toContain('effectiveTds[i] =');
    expect(block).toContain('renderedTransitions.push');
    // 存语义名(pick),不能存 mapTransition 后的 ffmpeg 名 —— EDL 认的是语义名
    expect(block).toMatch(/transition: pick/);
  });

  it('首镜以空转场回传(否则导出仍会给第一镜编一条入场溶解)', () => {
    const i = COMPOSER_SRC.indexOf('const renderedTransitions: RenderedTransition[] = []');
    const block = COMPOSER_SRC.slice(i, i + 700);
    expect(block).toMatch(/validClips\[0\]/);
    expect(block).toMatch(/transition: ''/);
  });

  it('回写后再合成(recompose)是稳定的:硬切不会漂成溶解', () => {
    // 回写把 'cut' 存进 timeline;recompose 时它作为 explicit 传给 selectTransitions,
    // 而 selectTransitions 只对 cut/flash-cut 认 explicit → 仍是硬切,不来回摇摆。
    const clips = [
      { shotNumber: 1, tensionLevel: 3, emotionTemperature: 1, hasDialogue: true },
      { shotNumber: 2, tensionLevel: 4, emotionTemperature: 2, hasDialogue: true, explicit: 'cut' },
    ];
    expect(selectTransitions(clips as any)[1]).toBe('cut');
  });

  it('两个 resolve 出口都带回传(单镜路径给空数组,不是 undefined)', () => {
    expect((COMPOSER_SRC.match(/renderedTransitions/g) || []).length).toBeGreaterThanOrEqual(5);
    expect(COMPOSER_SRC).toContain('renderedTransitions: [], // v12.289 单镜成片无转场');
  });

  it('editor-agent 在成片后、timeline 落盘前回写,且用共享纯函数', () => {
    expect(EDITOR_SRC).toContain('applyRenderedTransitions');
    const iApply = EDITOR_SRC.indexOf('applyRenderedTransitions(timeline');
    const iCompose = EDITOR_SRC.indexOf('const result = await composeVideo({');
    expect(iCompose).toBeGreaterThan(0);
    expect(iApply, '回写必须在 composeVideo 之后').toBeGreaterThan(iCompose);
  });

  it('回写失败不阻塞出片', () => {
    const i = EDITOR_SRC.indexOf('applyRenderedTransitions');
    expect(EDITOR_SRC.slice(i - 200, i + 300)).toContain('catch');
  });

  it('保留病根说明(防后人以为是冗余分支删掉)', () => {
    const i = EDITOR_SRC.indexOf('v12.289');
    const block = EDITOR_SRC.slice(i, i + 700);
    expect(block).toMatch(/奇偶|selectTransitions/);
    expect(block).toContain('shotNumber');
  });
});
