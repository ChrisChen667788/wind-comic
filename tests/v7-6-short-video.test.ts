/**
 * v7.6 — lib/short-video 单测 (15s 短视频极速分镜)
 *
 * 锁住确定性逻辑: 三幕时长布局 / 节奏模板 / 运镜词库 / prompt 编译 / LLM 输出解析降级。
 * 这些是"结构由系统掌控, LLM 只填画面内容"的关键, 必须稳定。
 */

import { describe, it, expect } from 'vitest';
import {
  RHYTHM_TEMPLATES,
  CAMERA_MOVE_VOCAB,
  SHORT_DURATIONS,
  getRhythmTemplate,
  cameraMovesByPhase,
  getCameraMove,
  computeActLayout,
  defaultParams,
  rhythmDistribution,
  compileShotToVideoPrompt,
  buildShortVideoMessages,
  parseShortVideoPlan,
  type ActPhase,
} from '@/lib/short-video';

describe('computeActLayout', () => {
  it('15s 默认 20/60/20 → 三幕无缝衔接、末幕收到 15', () => {
    const acts = computeActLayout(15, [0.2, 0.6, 0.2]);
    expect(acts).toHaveLength(3);
    expect(acts[0]).toMatchObject({ phase: 'hook', startS: 0, endS: 3, pct: 20 });
    expect(acts[1]).toMatchObject({ phase: 'body', startS: 3, endS: 12, pct: 60 });
    expect(acts[2]).toMatchObject({ phase: 'climax', startS: 12, endS: 15, pct: 20 });
    // 衔接无缝
    expect(acts[0].endS).toBe(acts[1].startS);
    expect(acts[1].endS).toBe(acts[2].startS);
  });

  it('未归一的配比会被归一化', () => {
    const acts = computeActLayout(15, [2, 6, 2]); // sum=10
    expect(acts[0].endS).toBe(3);
    expect(acts[2].endS).toBe(15);
  });

  it('非法时长/配比 → 安全降级 (不崩)', () => {
    expect(computeActLayout(0)[2].endS).toBe(15); // duration<=0 → 15
    const bad = computeActLayout(30, [0, 0, 0]);   // ratios sum 0 → 默认 20/60/20
    expect(bad[0].endS).toBe(6);
    expect(bad[2].endS).toBe(30);
  });

  it('支持 30s / 60s', () => {
    expect(SHORT_DURATIONS).toContain(30);
    expect(computeActLayout(60)[2].endS).toBe(60);
  });
});

describe('节奏模板 + 运镜词库', () => {
  it('getRhythmTemplate 命中 + 未命中回落首个', () => {
    expect(getRhythmTemplate('blockbuster').label).toBe('视觉大片');
    expect(getRhythmTemplate('nope').id).toBe(RHYTHM_TEMPLATES[0].id);
    expect(getRhythmTemplate(null).id).toBe(RHYTHM_TEMPLATES[0].id);
  });

  it('每幕恰好 3 个运镜 (开场/叙事/结尾)', () => {
    for (const p of ['hook', 'body', 'climax'] as ActPhase[]) {
      expect(cameraMovesByPhase(p)).toHaveLength(3);
      expect(cameraMovesByPhase(p).every((m) => m.phase === p)).toBe(true);
    }
    expect(CAMERA_MOVE_VOCAB).toHaveLength(9);
  });

  it('getCameraMove 命中 + 缺失 undefined', () => {
    expect(getCameraMove('drone-flyover')?.cameraType).toBe('Flyover');
    expect(getCameraMove('nope')).toBeUndefined();
  });

  it('defaultParams 跟随节奏模板 (运动强度/速度)', () => {
    const p = defaultParams(getRhythmTemplate('blockbuster'));
    expect(p.motionIntensity).toBe(75);
    expect(p.cameraSpeed).toBe('fast');
    expect(p.aspectRatio).toBe('9:16'); // 竖屏默认
  });
});

describe('compileShotToVideoPrompt', () => {
  it('拼入 风格 + 画面 + 景别词 + 运镜片段 + 8k', () => {
    const out = compileShotToVideoPrompt({
      frameContent: 'rainy cyberpunk slum',
      shotSize: 'WS',
      cameraMove: getCameraMove('drone-flyover'),
      style: 'film noir',
      cameraSpeed: 'fast',
    });
    expect(out).toContain('film noir');
    expect(out).toContain('rainy cyberpunk slum');
    expect(out).toContain('wide shot');
    expect(out).toContain('drone flyover');
    expect(out).toContain('8k');
  });

  it('缺运镜也能编译 (过滤空段)', () => {
    const out = compileShotToVideoPrompt({ frameContent: 'x', shotSize: 'CU', style: '', cameraSpeed: 'slow' });
    expect(out).toContain('close up');
    expect(out).not.toContain(', ,');
  });
});

describe('buildShortVideoMessages', () => {
  it('system 含三幕 JSON 契约 + 恰好 3 shot 约束', () => {
    const { system, user } = buildShortVideoMessages({
      idea: '雨夜侦探', style: 'noir', durationS: 15, rhythm: getRhythmTemplate('suspense'),
    });
    expect(system).toMatch(/hook[\s\S]*body[\s\S]*climax/);
    expect(system).toContain('恰好 3 个 shot');
    expect(user).toContain('雨夜侦探');
    expect(user).toContain('15s');
  });
});

describe('parseShortVideoPlan', () => {
  const validRaw = {
    title: '雨夜追凶',
    shots: [
      { phase: 'hook', frameContent: '暴雨贫民窟', aiPrompt: 'cyberpunk slum heavy rain neon' },
      { phase: 'body', frameContent: '侦探点烟', aiPrompt: 'detective lighting a cigarette' },
      { phase: 'climax', frameContent: '踩灭烟头', aiPrompt: 'boot stepping on cigarette' },
    ],
  };

  it('合法输入 → 3 镜对齐三幕 + 时间轴正确 + 标题', () => {
    const plan = parseShortVideoPlan(validRaw, { idea: '雨夜侦探', style: 'noir', durationS: 15, rhythmId: 'suspense' });
    expect(plan.title).toBe('雨夜追凶');
    expect(plan.shots).toHaveLength(3);
    expect(plan.shots.map((s) => s.phase)).toEqual(['hook', 'body', 'climax']);
    expect(plan.shots[0]).toMatchObject({ index: 1, timeStartS: 0, timeEndS: 3, shotSize: 'WS' });
    expect(plan.shots[2]).toMatchObject({ index: 3, timeEndS: 15, shotSize: 'CU' });
    // 每镜挂上该幕默认运镜 + AI prompt 融合 LLM 文案
    expect(plan.shots[0].cameraType).toBe('Reveal'); // hook 首个运镜
    expect(plan.shots[0].aiPrompt).toContain('cyberpunk slum heavy rain neon');
    expect(plan.shots[0].aiPrompt).toContain('8k');
  });

  it('LLM 缺字段 → 占位降级, 仍出 3 镜不抛错', () => {
    const plan = parseShortVideoPlan({}, { idea: '测试创意', style: '', durationS: 15, rhythmId: 'emotion' });
    expect(plan.shots).toHaveLength(3);
    expect(plan.title).toBe('测试创意');
    expect(plan.style).toBe('cinematic');
    expect(plan.shots[1].frameContent).toContain('第 2 幕');
  });

  it('节奏模板影响时长配比 (emotion 25/60/15)', () => {
    const plan = parseShortVideoPlan(validRaw, { idea: 'x'.repeat(50), style: '', durationS: 20, rhythmId: 'emotion' });
    expect(plan.acts[0].endS).toBe(5);   // 20 * 0.25
    expect(plan.acts[2].endS).toBe(20);
    expect(plan.title.length).toBeLessThanOrEqual(40);
  });

  it('rhythmDistribution → 环形图数据 (三幕 pct)', () => {
    const plan = parseShortVideoPlan(validRaw, { idea: 'x', style: '', durationS: 15, rhythmId: 'suspense' });
    const dist = rhythmDistribution(plan);
    expect(dist.map((d) => d.phase)).toEqual(['hook', 'body', 'climax']);
    expect(dist.reduce((s, d) => s + d.pct, 0)).toBe(100);
  });
});
