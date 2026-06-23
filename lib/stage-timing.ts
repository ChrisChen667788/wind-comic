/**
 * 阶段二十八 v12.32.0 — 阶段耗时归因(纯函数,可单测)。
 *
 * 补「成本归因(cost-attribution)」的另一半:**时间**去哪了。记录每个阶段
 * (director/writer/storyboard/video/editor…)的墙钟耗时,产出占比 + 最慢阶段,
 * 让用户/运维一眼看出「哪个环节卡住」。时钟可注入 → 测试不依赖真实时间。
 */

export interface StageTiming {
  stage: string;
  durMs: number;
}

export interface TimingBreakdown {
  totalMs: number;
  stages: Array<StageTiming & { pct: number }>; // 按耗时降序;pct = 占总时长百分比(0-100,1 位小数)
  slowest?: StageTiming;
}

export class StageTimer {
  private now: () => number;
  private open = new Map<string, number>();
  private done: StageTiming[] = [];

  constructor(now: () => number = () => Date.now()) {
    this.now = now;
  }

  /** 开一个阶段计时(同名再开会覆盖起点,容忍重复 start)。 */
  start(stage: string): void {
    this.open.set(stage, this.now());
  }

  /** 收一个阶段;同名多段累加(一个阶段被分多次进入也能合计)。 */
  end(stage: string): void {
    const s = this.open.get(stage);
    if (s == null) return;
    this.open.delete(stage);
    this.done.push({ stage, durMs: Math.max(0, this.now() - s) });
  }

  /** 收掉所有还开着的阶段(收尾兜底,防最后一个阶段漏收)。 */
  endAll(): void {
    for (const [stage, s] of this.open) {
      this.done.push({ stage, durMs: Math.max(0, this.now() - s) });
    }
    this.open.clear();
  }

  /** 聚合:同名阶段合并求和,按耗时降序,算占比 + 最慢。 */
  breakdown(): TimingBreakdown {
    const merged = new Map<string, number>();
    for (const { stage, durMs } of this.done) {
      merged.set(stage, (merged.get(stage) || 0) + durMs);
    }
    const totalMs = [...merged.values()].reduce((a, b) => a + b, 0);
    const stages = [...merged.entries()]
      .map(([stage, durMs]) => ({ stage, durMs, pct: totalMs > 0 ? Math.round((durMs / totalMs) * 1000) / 10 : 0 }))
      .sort((a, b) => b.durMs - a.durMs);
    return { totalMs, stages, slowest: stages[0] ? { stage: stages[0].stage, durMs: stages[0].durMs } : undefined };
  }
}

/** 人话一行总结:「总 128.4s · 视频 70.1s(54.6%)· 分镜 25.3s(19.7%)…」 */
export function summarizeTiming(b: TimingBreakdown): string {
  const s = (ms: number) => (ms / 1000).toFixed(1) + 's';
  const head = `总 ${s(b.totalMs)}`;
  const parts = b.stages.map((x) => `${x.stage} ${s(x.durMs)}(${x.pct}%)`);
  return [head, ...parts].join(' · ');
}
