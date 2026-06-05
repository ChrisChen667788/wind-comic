/**
 * v9.6.5 — cost-attribution 接真实计费数据:engine 归类 + cost_log → 事件映射 + 端到端归因。
 */
import { describe, it, expect } from 'vitest';
import { classifyEngineCategory, costEventsFromCostLog, attributeCost } from '@/lib/cost-attribution';

describe('v9.6.5 · classifyEngineCategory', () => {
  it('视频 / 图像 / TTS 引擎归类', () => {
    expect(classifyEngineCategory('minimax/video-01')).toBe('video');
    expect(classifyEngineCategory('kling-v1')).toBe('video');
    expect(classifyEngineCategory('hailuo')).toBe('video');
    expect(classifyEngineCategory('minimax/image-01')).toBe('image');
    expect(classifyEngineCategory('flux-dev')).toBe('image');
    expect(classifyEngineCategory('sdxl')).toBe('image');
    expect(classifyEngineCategory('minimax/speech-01')).toBe('tts');
    expect(classifyEngineCategory('cosyvoice')).toBe('tts');
  });
  it('LLM 引擎归类', () => {
    expect(classifyEngineCategory('gpt-4o')).toBe('llm');
    expect(classifyEngineCategory('claude-3-5')).toBe('llm');
    expect(classifyEngineCategory('qwen-max')).toBe('llm');
    expect(classifyEngineCategory('deepseek-chat')).toBe('llm');
  });
  it('口型引擎 + 顺序敏感:gpt-sovits → tts 而非 llm', () => {
    expect(classifyEngineCategory('wav2lip')).toBe('lipsync');
    expect(classifyEngineCategory('sadtalker')).toBe('lipsync');
    expect(classifyEngineCategory('gpt-sovits')).toBe('tts'); // 含 gpt 但先命中 tts
  });
  it('空 / 未知 → other', () => {
    expect(classifyEngineCategory('')).toBe('other');
    expect(classifyEngineCategory('mystery-9000')).toBe('other');
  });
});

describe('v9.6.5 · costEventsFromCostLog + 端到端归因', () => {
  it('cost_log 行 → 事件(category 由 engine 归类 + label)', () => {
    const ev = costEventsFromCostLog([
      { engine: 'minimax/video-01', costCny: 7 },
      { engine: 'gpt-4o', costCny: 1 },
    ]);
    expect(ev[0]).toMatchObject({ category: 'video', costCny: 7, label: 'minimax/video-01' });
    expect(ev[1].category).toBe('llm');
  });
  it('容错空 / 缺字段', () => {
    expect(costEventsFromCostLog([])).toEqual([]);
    expect(costEventsFromCostLog(undefined as never)).toEqual([]);
    expect(costEventsFromCostLog([{ engine: null, costCny: null }])[0]).toMatchObject({ category: 'other', costCny: 0 });
  });
  it('接 attributeCost → 总价 + 降序占比', () => {
    const a = attributeCost(costEventsFromCostLog([
      { engine: 'minimax/video-01', costCny: 7 },
      { engine: 'minimax/image-01', costCny: 2 },
      { engine: 'gpt-4o', costCny: 1 },
    ]));
    expect(a.totalCny).toBe(10);
    expect(a.byCategory[0].category).toBe('video');
    expect(a.byCategory[0].pct).toBe(70);
    expect(a.topCategory?.category).toBe('video');
  });
});
