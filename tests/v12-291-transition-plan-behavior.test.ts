/**
 * v12.291 — 转场计划从「源码里 grep 得到」升级为「行为可测」。
 *
 * 本版不是新功能,是**对抗式复核给 v12.289 打的补丁**。复核（4 维找问题 + 逐条证伪，
 * 10 个 agent 撞会话限额死了 8 个，故按「没跑完≠干净」由我自己逐条复验）给出三条,
 * 每条都附了「把功能改坏但测试仍绿」的具体改法:
 *
 *  ① 首镜那段 `if (typeof validClips[0]?.shotNumber === 'number')` 改成 `if (false)` ——
 *     源码窗口里 `validClips[0]` 与 `transition: ''` 两个字符串都还在,正则照样匹配,测试绿;
 *     而任意成片的首镜都会保留设计转场,EDL 给第一镜编一条「无物可溶」的入场溶解。
 *  ② 删掉多镜 resolve 出口的 `renderedTransitions,` 一行 —— 出现次数 6→5,`≥5` 仍满足,测试绿;
 *     运行时 `result.renderedTransitions` 变 undefined,回写静默 no-op,导出退回设计值。
 *  ③ 把 `applyRenderedTransitions(timeline, result.renderedTransitions)` 的第二个实参
 *     换成常量 `[]` —— 旧断言只检查「调用在 composeVideo 之后」,测试绿;回写永远收到空数组。
 *
 * 三条的修法各不相同,不是一招通吃:
 *  ① → 把内联循环抽成纯函数 `computeTransitionPlan`,直接测真行为(本文件);
 *  ② → 把 `ComposeResult.renderedTransitions` 改为**必填**,删掉即 `tsc` 报错(已实测验证);
 *  ③ → 把整个实参锁进断言,而不只是函数名。
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { computeTransitionPlan } from '@/services/video-composer';
import { applyRenderedTransitions } from '@/lib/edit-rhythm';
import { buildEDL, isDissolveTransition } from '@/lib/edl-export';

const clipsOf = (n: number) => Array.from({ length: n }, (_, i) => ({ shotNumber: i + 1 }));
const base = {
  keyShots: new Set<number>(),
  highlights: [] as Array<{ shotNumber: number; editStrategy: { transitionDuration?: number } }>,
  td: 0.5,
};

describe('v12.291 · 首镜永远没有入场转场', () => {
  it('首镜回传空转场、零时长(复核给的 `if (false)` 破法在这里必然翻车)', () => {
    const p = computeTransitionPlan({
      ...base, clips: clipsOf(3), transitionNames: ['', 'dissolve', 'dissolve'], durations: [4, 4, 4],
    });
    expect(p.renderedTransitions[0]).toEqual({ shotNumber: 1, transition: '', transitionDurationS: 0 });
    expect(p.effectiveTds[0]).toBe(0);
    expect(p.transitionOf[0]).toBe('');
  });

  it('端到端:首镜的设计转场被清掉,EDL 不再给第一镜编入场溶解', () => {
    const timeline: any[] = [
      { shotNumber: 1, transition: 'cross-dissolve' },
      { shotNumber: 2, transition: 'cross-dissolve' },
    ];
    const p = computeTransitionPlan({
      ...base, clips: clipsOf(2), transitionNames: ['', 'cut'], durations: [4, 4],
    });
    applyRenderedTransitions(timeline, p.renderedTransitions);
    expect(isDissolveTransition(timeline[0].transition), '首镜不该是溶解').toBe(false);
    const edl = buildEDL(timeline.map((t, i) => ({
      name: `Shot 0${i + 1}`, durationS: 4, transition: t.transition, transitionDurationS: t.transitionDurationS,
    })), 24);
    expect(edl).not.toContain('EFFECT NAME: CROSS DISSOLVE');
  });

  it('首镜没有 shotNumber 时不硬塞一条脏记录', () => {
    const p = computeTransitionPlan({
      ...base, clips: [{}, { shotNumber: 2 }], transitionNames: ['', 'dissolve'], durations: [4, 4],
    });
    expect(p.renderedTransitions.every((r) => typeof r.shotNumber === 'number')).toBe(true);
    expect(p.renderedTransitions[0].shotNumber).toBe(2);
  });

  it('空输入不炸', () => {
    const p = computeTransitionPlan({ ...base, clips: [], transitionNames: [], durations: [] });
    expect(p).toEqual({ effectiveTds: [], transitionOf: [], renderedTransitions: [] });
  });
});

describe('v12.291 · 转场时长的三条规则都是真跑出来的', () => {
  it('硬切固定 0.1s(cut 与 flash-cut 都算)', () => {
    for (const t of ['cut', 'flash-cut']) {
      const p = computeTransitionPlan({
        ...base, clips: clipsOf(2), transitionNames: ['', t], durations: [6, 6],
      });
      expect(p.effectiveTds[1], t).toBe(0.1);
      expect(p.renderedTransitions[1].transitionDurationS).toBe(0.1);
    }
  });

  it('关键镜的柔转场加长 1.3×', () => {
    const plain = computeTransitionPlan({
      ...base, clips: clipsOf(2), transitionNames: ['', 'fade'], durations: [6, 6],
    });
    const key = computeTransitionPlan({
      ...base, keyShots: new Set([2]), clips: clipsOf(2), transitionNames: ['', 'fade'], durations: [6, 6],
    });
    expect(key.effectiveTds[1]).toBeCloseTo(plain.effectiveTds[1] * 1.3, 6);
  });

  it('关键镜若是硬切则不加长(硬切没有「郑重入场」可言)', () => {
    const p = computeTransitionPlan({
      ...base, keyShots: new Set([2]), clips: clipsOf(2), transitionNames: ['', 'cut'], durations: [6, 6],
    });
    expect(p.effectiveTds[1]).toBe(0.1);
  });

  it('**一律被 min(前后镜时长)/2 夹住** —— 否则 xfade 会吃掉整镜', () => {
    const p = computeTransitionPlan({
      ...base, clips: clipsOf(3), transitionNames: ['', 'fade', 'fade'],
      highlights: [
        { shotNumber: 2, editStrategy: { transitionDuration: 99 } },
        { shotNumber: 3, editStrategy: { transitionDuration: 99 } },
      ],
      durations: [4, 1.2, 4],
    });
    // 推荐 99s,但相邻最短镜只有 1.2s → 夹到 0.6
    expect(p.effectiveTds[1], '受第 2 镜 1.2s 约束').toBe(0.6);
    expect(p.effectiveTds[2], '同样受 1.2s 约束').toBe(0.6);
  });

  it('夹子只在推荐值确实过长时生效(不会把正常时长压小)', () => {
    const p = computeTransitionPlan({
      ...base, clips: clipsOf(2), transitionNames: ['', 'fade'], durations: [4, 1.2],
    });
    // 默认 td=0.5 本就小于夹值 0.6 → 取 0.5,而不是被抬到 0.6
    expect(p.effectiveTds[1]).toBe(0.5);
  });

  it('高光分析推荐的时长会被采纳(不是恒用默认 td)', () => {
    const p = computeTransitionPlan({
      ...base, clips: clipsOf(2), transitionNames: ['', 'fade'],
      highlights: [{ shotNumber: 2, editStrategy: { transitionDuration: 0.8 } }],
      durations: [6, 6],
    });
    expect(p.effectiveTds[1]).toBe(0.8);
  });
});

describe('v12.291 · 转场类型的来源优先级', () => {
  it('selectTransitions 的结果优先于 timeline 里的设计值', () => {
    const p = computeTransitionPlan({
      ...base, clips: [{ shotNumber: 1 }, { shotNumber: 2, transition: 'cross-dissolve' }],
      transitionNames: ['', 'wipeleft'], durations: [4, 4],
    });
    expect(p.renderedTransitions[1].transition).toBe('wipeleft');
  });

  it('selectTransitions 没给值时才退回设计值', () => {
    const p = computeTransitionPlan({
      ...base, clips: [{ shotNumber: 1 }, { shotNumber: 2, transition: 'dip-to-black' }],
      transitionNames: [], durations: [4, 4],
    });
    expect(p.renderedTransitions[1].transition).toBe('dip-to-black');
  });

  it('两者都没有 → dissolve 兜底', () => {
    const p = computeTransitionPlan({
      ...base, clips: clipsOf(2), transitionNames: [], durations: [4, 4],
    });
    expect(p.renderedTransitions[1].transition).toBe('dissolve');
  });
});

describe('v12.291 · 回传与实际渲染必须同源', () => {
  it('每条回传的时长 === 对应镜的 effectiveTds(两者不能各算各的)', () => {
    const p = computeTransitionPlan({
      ...base, keyShots: new Set([3]), clips: clipsOf(5),
      transitionNames: ['', 'dissolve', 'fade', 'cut', 'wipeleft'],
      highlights: [{ shotNumber: 4, editStrategy: { transitionDuration: 0.9 } }],
      durations: [5, 3, 4, 2, 6],
    });
    for (let i = 1; i < 5; i++) {
      const rt = p.renderedTransitions.find((r) => r.shotNumber === i + 1)!;
      expect(rt.transitionDurationS, `第 ${i + 1} 镜时长`).toBe(p.effectiveTds[i]);
    }
  });

  it('回传条数 = 镜数(首镜也在内),shotNumber 一一对应且不重不漏', () => {
    const p = computeTransitionPlan({
      ...base, clips: clipsOf(5), transitionNames: [], durations: [4, 4, 4, 4, 4],
    });
    expect(p.renderedTransitions.map((r) => r.shotNumber)).toEqual([1, 2, 3, 4, 5]);
  });

  it('镜号不连续(中间镜视频失败被过滤)时,回传按真实镜号而非下标', () => {
    const p = computeTransitionPlan({
      ...base, clips: [{ shotNumber: 1 }, { shotNumber: 3 }, { shotNumber: 7 }],
      transitionNames: ['', 'fade', 'cut'], durations: [4, 4, 4],
    });
    expect(p.renderedTransitions.map((r) => r.shotNumber)).toEqual([1, 3, 7]);
    expect(p.renderedTransitions[2].transitionDurationS).toBe(0.1);
  });
});

// ═══════════════════════════════════════════════════════════════
// v12.291 · VERSIONS.md 抬头纳入自动同步(全仓最后一处手工维护的版本号)
// 边界必须是结构性的:第一条表格行以下全是历史陈述,一个字都不能动 ——
// v12.276 我就是用脚本改 VERSIONS.md 伤过历史记录,那次是靠逐行看 diff 才发现的。
// ═══════════════════════════════════════════════════════════════
describe('v12.291 · VERSIONS.md 抬头同步不得越界', () => {
  const VERSIONS = readFileSync('VERSIONS.md', 'utf-8');

  it('抬头的版本号与 package.json 一致(此前每次发版靠人记)', () => {
    const v = JSON.parse(readFileSync('package.json', 'utf-8')).version as string;
    const short = `v${v.split('.').slice(0, 2).join('.')}`;
    const head = VERSIONS.slice(0, VERSIONS.search(/^\| \*\*v[0-9]/m));
    expect(head).toContain(`(**${short}**)`);
    expect(head).toContain(`截至 **${short}**`);
  });

  it('历史正文里的旧测试数原封不动(v12.276 被脚本改坏过一次)', () => {
    expect(VERSIONS, '历史事实,改掉等于让文档说谎').toContain('2135');
    expect(VERSIONS).toContain('2712');
  });

  it('同步脚本对 VERSIONS.md 只处理抬头区', () => {
    const SRC = readFileSync('scripts/sync-doc-stats.mjs', 'utf-8');
    const i = SRC.indexOf('function syncVersionsHeader');
    expect(i, '未找到抬头专用同步函数').toBeGreaterThan(0);
    const fn = SRC.slice(i, i + 900);
    // 必须以「第一条表格行」为界,且界外原样透传
    expect(fn).toMatch(/findIndex.*\| \\\*\\\*v\[0-9\]|\/\^\\\| \\\*\\\*v\[0-9\]\//);
    expect(fn).toContain('lines.slice(firstRow)');
    // 找不到版本表时必须放弃,而不是全文乱改
    expect(fn).toMatch(/firstRow < 0.*return text/s);
  });
});
