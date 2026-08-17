/**
 * v12.284 — 节奏审计 → 编剧反馈闭环。
 *
 * 病根:`buildWriterFeedbackHint` 只看 **face / lighting / continuity** 三个**画面**维度;
 * 节奏诊断(拖沓段/高开低走/开场弱/时长呆板)**从不回流编剧** ——
 * 审计能指出「第 3~5 镜拖沓」,下一轮生成却完全不知道。**诊断出来了,却没进闭环。**
 *
 * 依赖 v12.278(pacingReport 随 script 落库)才拿得到上一版数据 —— 那一版是这一版的前置。
 */
import { describe, it, expect, vi } from 'vitest';
import { buildPacingFeedbackHint, hasPacingFeedback } from '@/lib/pacing-feedback';
import { auditScript } from '@/lib/pacing-audit';

const mkScript = (rows: Array<{ act: string; emo: string; d?: string; dur: number }>) =>
  ({ shots: rows.map((a, i) => ({ shotNumber: i + 1, sceneDescription: '', action: a.act, emotion: a.emo, characters: ['A'], dialogue: a.d, duration: a.dur })) }) as any;

const BAD = mkScript([
  { act: '她一巴掌打过去,怒吼撕破婚约', emo: '愤怒', d: '你竟敢背叛我!', dur: 4 },
  { act: '他跪地哀求,场面失控', emo: '绝望', d: '求你别走', dur: 4 },
  { act: '两人走在路上', emo: '平静', dur: 4 },
  { act: '她看着窗外', emo: '平静', dur: 4 },
  { act: '他喝了口水', emo: '平静', dur: 4 },
  { act: '天亮了', emo: '平静', dur: 4 },
]);

describe('v12.284 · 审计结论 → 写作指令', () => {
  it('端到端:真 auditScript 的结论能变成可执行的写作要求', () => {
    const report: any = auditScript(BAD, { dramaMode: true });
    const hint = buildPacingFeedbackHint({ report });
    expect(hint.length).toBeGreaterThan(0);
    expect(hint).toContain('拖沓');
    expect(hint).toContain('第 3~6 镜');   // 指到具体镜号区间
    expect(hint).toContain('高开低走');
  });

  it('写成**正向要求**而非罗列错误(LLM 对「做什么」响应更好)', () => {
    const hint = buildPacingFeedbackHint({ report: auditScript(BAD, { dramaMode: true }) as any });
    expect(hint).toMatch(/本版/);          // 每条都落到"本版该怎么写"
    expect(hint).toMatch(/事件发生|留到后段/);
  });

  it('不把「平均分/斜率」这类对编剧无操作性的数字塞进 prompt', () => {
    const hint = buildPacingFeedbackHint({ report: auditScript(BAD, { dramaMode: true }) as any });
    expect(hint).not.toMatch(/斜率|averageConflictScore|平均分/);
  });

  it('四类诊断各自给出不同指令', () => {
    const mk = (v2: any) => buildPacingFeedbackHint({ report: { v2 } as any });
    expect(mk({ shape: { shape: 'no-climax' } })).toContain('顶点');
    expect(mk({ shape: { shape: 'flat' } })).toContain('升级链条');
    expect(mk({ opening: { passed: false, sampled: 2, avgScore: 1.5 } })).toContain('第一镜就要有钩子');
    // ⚠️ cv=0 是「全片等长」这个**最呆板**的情况,必须报警;早先源码用 `cv > 0` 排除无数据,
    // 把它一并排除了 —— 判别应看 sampled(样本不足才是无数据)。
    expect(mk({ durationRhythm: { cv: 0.0, sampled: 6 } })).toContain('疏密对比');
    expect(mk({ durationRhythm: { cv: 0.0, sampled: 2 } }), '样本不足不该猜').toBe('');
    expect(mk({ durationRhythm: { cv: 0.5, sampled: 6, longestRun: 4 } })).toContain('长镜连排');
  });

  it('注入条数有上限(不挤占 prompt 预算把创作空间压没)', () => {
    const hint = buildPacingFeedbackHint({
      report: {
        v2: {
          shape: { shape: 'front-loaded', peakIndex: 1 },
          dragSegments: [{ fromShot: 3, toShot: 5, length: 3, avgScore: 1 }],
          opening: { passed: false, sampled: 2, avgScore: 1 },
          durationRhythm: { cv: 0.01, longestRun: 5 },
        },
      } as any,
    });
    expect(hint.split('\n- ').length - 1).toBeLessThanOrEqual(4);
  });

  it('无报告 / 节奏健康 → 空串(不给 LLM 添噪声)', () => {
    expect(buildPacingFeedbackHint({ report: null })).toBe('');
    expect(buildPacingFeedbackHint({ report: undefined as any })).toBe('');
    expect(buildPacingFeedbackHint({ report: {} as any })).toBe('');
    expect(buildPacingFeedbackHint({ report: { v2: {} } as any })).toBe('');
    expect(hasPacingFeedback({ report: null })).toBe(false);
  });
});

describe('v12.284 · 行为:反馈真的进了 LLM 的 user 消息', () => {
  it('有上一版拖沓诊断时,runWriter 的 callLLM 实参含该指令', async () => {
    // 用 v12.263 起沿用的做法:mock ctx 真跑 runWriter,验它**实际发出**的 user 消息
    vi.resetModules();
    vi.doMock('@/lib/pacing-feedback', async (orig) => {
      const real: any = await (orig as any)();
      return { ...real, getLatestPacingReport: async () => auditScript(BAD, { dramaMode: true }) };
    });
    const { runWriter } = await import('@/services/agents/writer-agent');
    const calls: string[] = [];
    const ctx: any = {
      parsedScript: null, originalIdea: '复仇', projectId: 'p-1', template: null,
      characterAppearanceMap: {}, qualityLedger: [], openai: {},
      emit: () => {}, update: () => {},
      callLLM: (_s: string, usr: string) => { calls.push(usr); return Promise.resolve(''); },
      fallbackScript: () => ({ title: 'fb', shots: [] }),
      targetLanguage: () => 'zh',
    };
    const plan: any = {
      theme: 't', genre: '剧情', style: '写实', logline: 'x', synopsis: 'x',
      characters: [{ name: '张三', appearance: '青年男性' }],
      scenes: [{ location: '室内', description: 's', dialogues: [] }],
      storyStructure: { totalShots: 6 },
    };
    await runWriter(ctx, plan).catch(() => { /* 只验注入 */ });
    expect(calls.some((u) => u.includes('上一版节奏诊断'))).toBe(true);
    vi.doUnmock('@/lib/pacing-feedback');
  });

  it('接线锁:writer-agent 引用了反馈构造器且失败不阻塞', () => {
    const src = require('fs').readFileSync('services/agents/writer-agent.ts', 'utf-8');
    expect(src).toContain('buildPacingFeedbackHint');
    expect(src).toContain('getLatestPacingReport');
    const i = src.indexOf('getLatestPacingReport(ctx.projectId)');
    expect(src.slice(Math.max(0, i - 500), i + 900)).toContain('非阻塞');
  });
});
