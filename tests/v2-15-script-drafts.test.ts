/**
 * Tests for v2.15 G9 — lib/script-drafts.ts + /api/script-drafts route
 *
 * 不打真 LLM, mock 全局 fetch (v7.1 起 script-drafts 走 callLLMWithFallback)。
 * 锁住:
 *   - count clamp (1..3)
 *   - 空 idea / 太短 → throw
 *   - 单次失败不阻塞其他 (Promise.allSettled)
 *   - 草稿温度阶梯 [0.7, 0.95, 1.2]
 *   - 路由 input validation + guardrail 集成
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// 标记全局 mock 行为
let MOCK_RESPONSE: 'ok' | 'throw' | 'invalid-json' | 'missing-shots' = 'ok';
let MOCK_TEMPS_SEEN: number[] = [];

// v7.1: script-drafts 改走 lib/llm-client.callLLMWithFallback (全局 fetch), 不再用 openai SDK。
// 因此这里改 mock fetch。配置只给主端点、不给 fallbackApiKey → buildLLMAttempts 只产 1 个尝试,
// 保证每稿恰好 1 次 LLM 调用 (温度阶梯断言精确, fallback 行为单独在 v7-1-llm-client.test 覆盖)。
vi.mock('@/lib/config', () => ({
  API_CONFIG: {
    openai: {
      apiKey: 'fake-key',
      baseURL: 'http://fake',
      model: 'fake-model',
      creativeModel: 'fake-creative-model',
      // 故意不配 fallbackApiKey → 单尝试
    },
  },
}));

import { generateScriptDrafts } from '@/lib/script-drafts';

let fetchSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  MOCK_RESPONSE = 'ok';
  MOCK_TEMPS_SEEN = [];
  fetchSpy = vi.spyOn(globalThis, 'fetch' as any).mockImplementation(async (_url: any, init: any) => {
    const body = init?.body ? JSON.parse(init.body) : {};
    const temp = body.temperature;
    MOCK_TEMPS_SEEN.push(temp);

    if (MOCK_RESPONSE === 'throw') throw new Error('LLM boom');

    let content: string;
    if (MOCK_RESPONSE === 'invalid-json') {
      content = 'not json at all';
    } else if (MOCK_RESPONSE === 'missing-shots') {
      content = JSON.stringify({ title: 'X' });
    } else {
      content = JSON.stringify({
        title: `Draft @ T=${temp}`,
        synopsis: '一段 1-2 句梗概',
        shots: [
          { shotNumber: 1, sceneDescription: '街角', action: '主角出场', emotion: '隐忍', characters: ['阿凯'] },
          { shotNumber: 2, sceneDescription: '街角', action: '对手出现', emotion: '震惊', characters: ['阿凯', '小白'], dialogue: '十年了。' },
        ],
      });
    }
    return new Response(JSON.stringify({ choices: [{ message: { content } }] }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  });
});

afterEach(() => {
  fetchSpy.mockRestore();
});

describe('generateScriptDrafts — input validation', () => {
  it('throws on empty idea', async () => {
    await expect(generateScriptDrafts({ idea: '', count: 1 })).rejects.toThrow(/不能为空/);
  });

  it('throws when idea < 5 chars', async () => {
    await expect(generateScriptDrafts({ idea: '太短', count: 1 })).rejects.toThrow(/至少 5/);
  });
});

describe('generateScriptDrafts — count + temperature ladder', () => {
  it('count=1 generates 1 draft at temp 0.7', async () => {
    const out = await generateScriptDrafts({ idea: '都市言情雨夜重逢', count: 1 });
    expect(out).toHaveLength(1);
    expect(out[0].temperatureUsed).toBe(0.7);
    expect(MOCK_TEMPS_SEEN).toEqual([0.7]);
    expect(out[0].script?.title).toContain('0.7');
  });

  it('count=2 generates 2 drafts at temps 0.7 + 0.95', async () => {
    const out = await generateScriptDrafts({ idea: '武侠剧场风云', count: 2 });
    expect(out).toHaveLength(2);
    expect(out.map((d) => d.temperatureUsed)).toEqual([0.7, 0.95]);
    expect(MOCK_TEMPS_SEEN.sort()).toEqual([0.7, 0.95]);
  });

  it('count=3 generates 3 drafts at full ladder 0.7 + 0.95 + 1.2', async () => {
    const out = await generateScriptDrafts({ idea: '科幻悬疑剧场', count: 3 });
    expect(out).toHaveLength(3);
    expect(out.map((d) => d.temperatureUsed)).toEqual([0.7, 0.95, 1.2]);
  });

  it('count > 3 clamps to 3', async () => {
    const out = await generateScriptDrafts({ idea: '校园恋爱故事', count: 99 });
    expect(out).toHaveLength(3);
  });

  it('count < 1 clamps to 1', async () => {
    const out = await generateScriptDrafts({ idea: '校园恋爱故事', count: 0 });
    expect(out).toHaveLength(1);
  });
});

describe('generateScriptDrafts — partial failure tolerance (Promise.allSettled)', () => {
  it('marks failed draft with errorMessage but still returns array of correct length', async () => {
    MOCK_RESPONSE = 'throw';
    const out = await generateScriptDrafts({ idea: '武侠剧场风云', count: 2 });
    expect(out).toHaveLength(2);
    expect(out.every((d) => d.errorMessage)).toBe(true);
    expect(out.every((d) => d.script === undefined)).toBe(true);
  });

  it('invalid LLM JSON → errorMessage on that draft', async () => {
    MOCK_RESPONSE = 'invalid-json';
    const out = await generateScriptDrafts({ idea: '武侠剧场风云', count: 1 });
    expect(out[0].errorMessage).toMatch(/无法解析|无效/);
  });

  it('LLM JSON missing shots[] → errorMessage', async () => {
    MOCK_RESPONSE = 'missing-shots';
    const out = await generateScriptDrafts({ idea: '武侠剧场风云', count: 1 });
    expect(out[0].errorMessage).toMatch(/title|shots/);
  });
});

describe('generateScriptDrafts — output normalization', () => {
  it('estimates word count from synopsis + shots', async () => {
    const out = await generateScriptDrafts({ idea: '都市言情雨夜重逢', count: 1 });
    expect(out[0].estimatedWords).toBeGreaterThan(0);
  });

  it('preserves user style in styleUsed', async () => {
    const out = await generateScriptDrafts({ idea: '都市言情雨夜重逢', style: '诗意水墨', count: 1 });
    expect(out[0].styleUsed).toBe('诗意水墨');
  });

  it('default style "cinematic" when not provided', async () => {
    const out = await generateScriptDrafts({ idea: '都市言情雨夜重逢', count: 1 });
    expect(out[0].styleUsed).toBe('cinematic');
  });

  it('every successful draft has unique draftId', async () => {
    const out = await generateScriptDrafts({ idea: '都市言情雨夜重逢', count: 3 });
    const ids = out.map((d) => d.draftId);
    expect(new Set(ids).size).toBe(3);
  });
});
