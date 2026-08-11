/**
 * v12.314 — 镜内片段重拍的缝合计划(对标 LibTV「片段重拍」)。
 *
 * 此前只能重生**整镜**:8 秒里错 2 秒也要整镜重抽,**四倍的浪费**。
 *
 * 但竞品宣传的「30 秒只错 2 秒就只重拍 2 秒」回避了两个硬问题,这里正面处理:
 *
 * **① 引擎有最短时长,2 秒的片段生成不出来。** HappyHorse 是 3–15s(v12.295 查证官方文档)。
 * 真实做法是按下限生成(3s)再裁出 2s —— 所以计划里把「向引擎请求多长」
 * 与「从生成物里取哪段」**分成两个量**。混为一谈的后果:要么请求被引擎拒,
 * 要么补丁比缺口长,整条时间轴顺移。
 *
 * **② 缝回后总时长必须一字不差地不变。** 一旦变了,xfade 压缩时间轴、配音 adelay、
 * 字幕起点、EDL record-in 全线错位 —— 这些在 v12.264/265/297 刚以「单一真源」对齐过。
 * `totalAfterS === shotDurationS` 是本模块的核心不变量,下面直接锁它。
 */
import { describe, it, expect } from 'vitest';
import { planSegmentRetake } from '@/lib/segment-retake';

const base = { shotDurationS: 8, fps: 24, engineMinDurationS: 3, engineMaxDurationS: 15 };

describe('v12.314 · 核心不变量:缝回后总时长不变', () => {
  it('中间开洞:总长恒等于原镜时长', () => {
    const p = planSegmentRetake({ ...base, fromS: 3, toS: 5 });
    expect(p.ok).toBe(true);
    expect(p.totalAfterS, '总长变了 → 下游 xfade/配音/字幕/EDL 全线错位').toBe(8);
    expect(p.head).toEqual({ fromS: 0, toS: 3 });
    expect(p.tail).toEqual({ fromS: 5, toS: 8 });
  });

  it('三段之和 === 原时长(头 + 补丁 + 尾)', () => {
    for (const [a, b] of [[0, 3], [2, 6], [5, 8], [1, 7]] as const) {
      const p = planSegmentRetake({ ...base, fromS: a, toS: b });
      const head = p.head ? p.head.toS - p.head.fromS : 0;
      const tail = p.tail ? p.tail.toS - p.tail.fromS : 0;
      const patch = p.patchToS - p.patchFromS;
      expect(head + patch + tail, `[${a},${b}] 三段和对不上`).toBeCloseTo(8, 6);
    }
  });

  it('从头拍到尾:没有头尾保留段,但总长仍不变', () => {
    const p = planSegmentRetake({ ...base, fromS: 0, toS: 8 });
    expect(p.head).toBeNull();
    expect(p.tail).toBeNull();
    expect(p.totalAfterS).toBe(8);
  });
});

describe('v12.314 · 引擎下限:请求时长与裁切区间是两个量', () => {
  it('**选区 2s 但引擎下限 3s → 请求 3s、只取前 2s**', () => {
    const p = planSegmentRetake({ ...base, fromS: 3, toS: 5 });
    expect(p.generateDurationS, '向引擎请求的时长要满足下限').toBe(3);
    expect(p.trimToS - p.trimFromS, '补丁只能是选区那么长').toBe(2);
    expect(p.padSeconds, '多生成的 1s 是要丢弃的').toBe(1);
    expect(p.patchToS - p.patchFromS, '成片里的缺口仍是 2s').toBe(2);
  });

  it('选区已达下限 → 不多生成', () => {
    const p = planSegmentRetake({ ...base, fromS: 2, toS: 5 });
    expect(p.generateDurationS).toBe(3);
    expect(p.padSeconds).toBe(0);
  });

  it('选区超过引擎上限 → 明确拒绝并说清怎么办', () => {
    const p = planSegmentRetake({ shotDurationS: 30, fps: 24, engineMinDurationS: 3, engineMaxDurationS: 15, fromS: 0, toS: 20 });
    expect(p.ok).toBe(false);
    expect(p.reason).toMatch(/上限/);
    expect(p.reason, '要告诉用户怎么办').toMatch(/分两次/);
  });

  it('不传引擎下限时按 3s 兜底(目前已知引擎里最宽松的)', () => {
    const p = planSegmentRetake({ shotDurationS: 8, fromS: 3, toS: 4 });
    expect(p.generateDurationS).toBe(3);
  });
});

describe('v12.314 · 帧对齐(v12.277 那类精度病不能重演)', () => {
  it('非帧边界的选区被吸附到帧栅格', () => {
    const p = planSegmentRetake({ ...base, fromS: 3.017, toS: 5.009 });
    // 24fps:1 帧 = 1/24 ≈ 0.041667s
    expect(p.patchFromS * 24, '起点应落在整帧上').toBeCloseTo(Math.round(3.017 * 24), 6);
    expect(p.patchToS * 24).toBeCloseTo(Math.round(5.009 * 24), 6);
  });

  it('吸附后仍保持总长不变(吸附不能把时间轴撑长)', () => {
    const p = planSegmentRetake({ ...base, fromS: 3.017, toS: 5.009 });
    const head = p.head ? p.head.toS - p.head.fromS : 0;
    const tail = p.tail ? p.tail.toS - p.tail.fromS : 0;
    expect(head + (p.patchToS - p.patchFromS) + tail).toBeCloseTo(8, 6);
  });

  it('不同帧率各自对齐(60fps 的栅格更细)', () => {
    const p24 = planSegmentRetake({ ...base, fps: 24, fromS: 3.03, toS: 5 });
    const p60 = planSegmentRetake({ ...base, fps: 60, fromS: 3.03, toS: 5 });
    expect(p24.patchFromS).not.toBe(p60.patchFromS);
    expect(p60.patchFromS * 60).toBeCloseTo(Math.round(3.03 * 60), 6);
  });
});

describe('v12.314 · 边界与拒绝', () => {
  it('选区不足一帧 → 拒绝并提示拉长', () => {
    const p = planSegmentRetake({ ...base, fromS: 3, toS: 3.01 });
    expect(p.ok).toBe(false);
    expect(p.reason).toMatch(/一帧|拉长/);
  });

  it('越界的起止被夹回镜头范围内', () => {
    const p = planSegmentRetake({ ...base, fromS: -5, toS: 99 });
    expect(p.ok).toBe(true);
    expect(p.patchFromS).toBe(0);
    expect(p.patchToS).toBe(8);
  });

  it('镜头时长无效 → 拒绝,不产出一个假计划', () => {
    for (const d of [0, -1, NaN, undefined as any]) {
      const p = planSegmentRetake({ ...base, shotDurationS: d, fromS: 1, toS: 2 });
      expect(p.ok, `时长 ${d} 不该被接受`).toBe(false);
    }
  });

  it('起止时间非法 → 拒绝', () => {
    expect(planSegmentRetake({ ...base, fromS: NaN, toS: 5 }).ok).toBe(false);
    expect(planSegmentRetake({ ...base, fromS: 3, toS: NaN }).ok).toBe(false);
  });

  it('倒着选(to < from)→ 拒绝,不静默交换,**且报错要说对原因**', () => {
    const p = planSegmentRetake({ ...base, fromS: 5, toS: 3 });
    expect(p.ok, '静默交换会让用户以为选对了').toBe(false);
    // 落到「不足一帧」那条会让用户以为是选太短,而实际是拖反了 —— 文案错等于没报错
    expect(p.reason, `实际报的是:${p.reason}`).toMatch(/拖反|起止/);
    expect(p.reason).not.toMatch(/不足一帧/);
  });

  it('被拒时不返回半个可用计划(防调用方误用)', () => {
    const p = planSegmentRetake({ ...base, fromS: 5, toS: 3 });
    expect(p.head).toBeNull();
    expect(p.tail).toBeNull();
    expect(p.generateDurationS).toBe(0);
    expect(p.totalAfterS).toBe(0);
  });
});

describe('v12.314 · 纯函数与零依赖', () => {
  it('同样输入恒定同样输出', () => {
    const a = planSegmentRetake({ ...base, fromS: 3, toS: 5 });
    for (let i = 0; i < 3; i++) {
      expect(planSegmentRetake({ ...base, fromS: 3, toS: 5 })).toEqual(a);
    }
  });

  it('不改动入参', () => {
    const input = { ...base, fromS: 3, toS: 5 };
    const snapshot = JSON.stringify(input);
    planSegmentRetake(input);
    expect(JSON.stringify(input)).toBe(snapshot);
  });

  it('模块零 import(导出侧/前端都能直接用)', () => {
    const src = require('node:fs').readFileSync('lib/segment-retake.ts', 'utf-8') as string;
    expect(src).not.toMatch(/^import /m);
  });
});
