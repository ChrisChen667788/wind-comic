/**
 * 阶段二十八 v12.32.0 — 阶段耗时归因单测(注入时钟,不依赖真实时间)。
 */
import { describe, expect, it } from 'vitest';
import { StageTimer, summarizeTiming } from '@/lib/stage-timing';

/** 受控时钟:每次调用返回数组里的下一个值。 */
function fakeClock(seq: number[]) {
  let i = 0;
  return () => seq[Math.min(i++, seq.length - 1)];
}

describe('StageTimer', () => {
  it('start/end 记录耗时', () => {
    const t = new StageTimer(fakeClock([0, 1000])); // start=0, end=1000
    t.start('director');
    t.end('director');
    const b = t.breakdown();
    expect(b.totalMs).toBe(1000);
    expect(b.stages[0]).toMatchObject({ stage: 'director', durMs: 1000, pct: 100 });
    expect(b.slowest).toEqual({ stage: 'director', durMs: 1000 });
  });

  it('同名阶段多段累加', () => {
    const t = new StageTimer(fakeClock([0, 100, 200, 350])); // 两段:100 + 150
    t.start('video'); t.end('video');
    t.start('video'); t.end('video');
    const b = t.breakdown();
    expect(b.stages.find((s) => s.stage === 'video')!.durMs).toBe(250);
  });

  it('endAll 收掉还开着的阶段', () => {
    const t = new StageTimer(fakeClock([0, 500])); // start=0, endAll=500
    t.start('editor');
    t.endAll();
    expect(t.breakdown().stages[0]).toMatchObject({ stage: 'editor', durMs: 500 });
  });

  it('breakdown 按耗时降序 + 占比', () => {
    const t = new StageTimer(fakeClock([0, 1000, 1000, 4000])); // a=1000, b=3000
    t.start('a'); t.end('a');
    t.start('b'); t.end('b');
    const b = t.breakdown();
    expect(b.totalMs).toBe(4000);
    expect(b.stages.map((s) => s.stage)).toEqual(['b', 'a']); // 降序
    expect(b.stages[0].pct).toBe(75);
    expect(b.stages[1].pct).toBe(25);
    expect(b.slowest).toEqual({ stage: 'b', durMs: 3000 });
  });

  it('end 未 start 的阶段安全无操作', () => {
    const t = new StageTimer(fakeClock([0, 0]));
    t.end('never-started');
    expect(t.breakdown().totalMs).toBe(0);
  });
});

describe('summarizeTiming', () => {
  it('一行人话总结', () => {
    const t = new StageTimer(fakeClock([0, 1000, 1000, 4000]));
    t.start('a'); t.end('a');
    t.start('video'); t.end('video');
    const s = summarizeTiming(t.breakdown());
    expect(s).toContain('总 4.0s');
    expect(s).toContain('video 3.0s(75%)');
  });
});
