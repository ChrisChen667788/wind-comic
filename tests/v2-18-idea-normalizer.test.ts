/**
 * Tests for v2.18 — lib/idea-normalizer
 *
 * 锁:
 *   - 规则清洗: 全角→半角 / 重复标点 / 空白折叠 / trim
 *   - ideaIsRich 阈值
 *   - normalizeIdea ruleOnly=true 永远不调 LLM
 *   - 信息充足时跳过 LLM (didLlmExpand=false)
 *   - 信息不足 + LLM 可用时调 LLM (mocked)
 *   - LLM 失败 fallback 到规则结果
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { normalizeIdeaRule, ideaIsRich, normalizeIdea } from '@/lib/idea-normalizer';

// 默认无 OpenAI key — 让 LLM expand 路径走"无 key 直接返 null"的兜底
let MOCK_LLM_RESPONSE: { expanded: string; genre: string } | null = null;
let MOCK_LLM_THROWS = false;
let MOCK_HAS_KEY = false;

vi.mock('@/lib/config', () => ({
  get API_CONFIG() {
    return {
      openai: {
        apiKey: MOCK_HAS_KEY ? 'fake-key' : '',
        baseURL: 'http://fake',
        model: 'fake-model',
      },
    };
  },
}));

vi.mock('openai', () => {
  return {
    default: class FakeOpenAI {
      chat = {
        completions: {
          create: async () => {
            if (MOCK_LLM_THROWS) throw new Error('llm boom');
            return {
              choices: [
                {
                  message: {
                    content: MOCK_LLM_RESPONSE
                      ? JSON.stringify(MOCK_LLM_RESPONSE)
                      : '',
                  },
                },
              ],
            };
          },
        },
      };
    },
  };
});

beforeEach(() => {
  MOCK_LLM_RESPONSE = null;
  MOCK_LLM_THROWS = false;
  MOCK_HAS_KEY = false;
});

describe('normalizeIdeaRule', () => {
  it('returns "" for empty / non-string', () => {
    expect(normalizeIdeaRule('')).toBe('');
    expect(normalizeIdeaRule(null as any)).toBe('');
    expect(normalizeIdeaRule(undefined as any)).toBe('');
  });

  it('full-width → half-width for ASCII range', () => {
    expect(normalizeIdeaRule('a＝b＋c')).toBe('a=b+c');
    expect(normalizeIdeaRule('Hello！')).toBe('Hello!');
  });

  it('keeps Chinese chars intact', () => {
    expect(normalizeIdeaRule('古装言情')).toBe('古装言情');
  });

  it('dedupes repeated punctuation (3+ → 2)', () => {
    expect(normalizeIdeaRule('真的!!!!太棒了')).toBe('真的!!太棒了');
    expect(normalizeIdeaRule('什么???你说啥')).toBe('什么??你说啥');
  });

  it('Chinese commas dedupe', () => {
    expect(normalizeIdeaRule('啊，，，好的')).toBe('啊，好的');
  });

  it('4+ dots → ellipsis', () => {
    expect(normalizeIdeaRule('等等....')).toBe('等等...');
    expect(normalizeIdeaRule('等等..........')).toBe('等等...');
  });

  it('multi-spaces → single', () => {
    expect(normalizeIdeaRule('hello    world')).toBe('hello world');
  });

  it('3+ newlines fold to 2', () => {
    expect(normalizeIdeaRule('段一\n\n\n\n段二')).toBe('段一\n\n段二');
  });

  it('trims leading/trailing whitespace', () => {
    expect(normalizeIdeaRule('   啊  ')).toBe('啊');
  });
});

describe('ideaIsRich', () => {
  it('true: ≥ 50 chars + has genre + protagonist or conflict', () => {
    // 实际拼到 60+ 字, 含古装/少年/复仇
    const idea = '一个古装宫廷里的少年皇子, 在母亲被毒杀后开始秘密复仇, 一步步揭开背后的阴谋, 最终在朱雀大街上完成对决';
    expect(ideaIsRich(idea)).toBe(true);
  });

  it('false: short and no clear genre', () => {
    expect(ideaIsRich('随便弄一个故事')).toBe(false);
  });

  it('false: long but missing genre/protagonist/conflict signals', () => {
    expect(ideaIsRich('我想要那种东西其他东西什么都行就那样吧好了')).toBe(false);
  });

  it('true: 120+ chars regardless of keyword presence', () => {
    expect(ideaIsRich('a'.repeat(125))).toBe(true);
  });
});

describe('normalizeIdea — ruleOnly path', () => {
  it('never calls LLM when ruleOnly=true', async () => {
    MOCK_HAS_KEY = true;
    MOCK_LLM_RESPONSE = { expanded: 'should not be used', genre: '古装' };
    const r = await normalizeIdea('   啊！！！  ', { ruleOnly: true });
    expect(r.didLlmExpand).toBe(false);
    expect(r.normalized).toBe('啊!!');
  });

  it('returns empty result for empty input', async () => {
    const r = await normalizeIdea('', { ruleOnly: true });
    expect(r.normalized).toBe('');
    expect(r.didLlmExpand).toBe(false);
  });
});

describe('normalizeIdea — info-rich short-circuits LLM', () => {
  it('rich idea: didLlmExpand=false even when LLM available', async () => {
    MOCK_HAS_KEY = true;
    const idea = '一个古装宫廷里的少年皇子, 在母亲被毒杀后开始秘密复仇, 一步步揭开背后的阴谋, 最终在朱雀大街上完成对决';
    const r = await normalizeIdea(idea);
    expect(r.didLlmExpand).toBe(false);
    expect(r.detectedGenres.length).toBeGreaterThan(0);
  });
});

describe('normalizeIdea — LLM expansion when info-thin', () => {
  it('thin idea + key present: triggers LLM, didLlmExpand=true', async () => {
    MOCK_HAS_KEY = true;
    MOCK_LLM_RESPONSE = {
      expanded: '在唐朝长安城的一个雨夜, 失去家人的少年剑客踏上复仇之旅, ' +
                '逐渐发现仇人是当年护送母亲入宫的师父, 最后在朱雀大街上完成对决, ' +
                '握剑的手颤抖, 但他没有犹豫, 师恩与血仇之间他选择了正义。',
      genre: '古装',
    };
    const r = await normalizeIdea('一个剑客');
    expect(r.didLlmExpand).toBe(true);
    expect(r.normalized).toContain('唐朝');
    expect(r.detectedGenres).toContain('古装');
  });

  it('thin idea + LLM throws: falls back to rule result', async () => {
    MOCK_HAS_KEY = true;
    MOCK_LLM_THROWS = true;
    const r = await normalizeIdea('一个剑客');
    expect(r.didLlmExpand).toBe(false);
    expect(r.normalized).toBe('一个剑客');
  });

  it('thin idea + no API key: falls back to rule result, didLlmExpand=false', async () => {
    MOCK_HAS_KEY = false;
    const r = await normalizeIdea('一个剑客');
    expect(r.didLlmExpand).toBe(false);
    expect(r.normalized).toBe('一个剑客');
  });

  it('LLM expanded text shorter than 80% of original → reject and fall back', async () => {
    MOCK_HAS_KEY = true;
    MOCK_LLM_RESPONSE = { expanded: '太短', genre: '古装' };
    const r = await normalizeIdea('一个剑客的复仇故事');
    expect(r.didLlmExpand).toBe(false);
    // 应当返回规则结果, 不是 LLM 的"太短"
    expect(r.normalized).toBe('一个剑客的复仇故事');
  });

  it('LLM expanded text > 600 chars: truncate to 600', async () => {
    MOCK_HAS_KEY = true;
    MOCK_LLM_RESPONSE = { expanded: 'X' + 'x'.repeat(700), genre: '科幻' };
    const r = await normalizeIdea('科幻');
    expect(r.didLlmExpand).toBe(true);
    expect(r.normalized.length).toBe(600);
  });

  it('forceLlmExpand: bypasses ideaIsRich short-circuit', async () => {
    MOCK_HAS_KEY = true;
    MOCK_LLM_RESPONSE = {
      expanded: '在古装宫廷扩写后的版本, 主角是少年皇子, 母亲被毒杀后开始秘密复仇, 在大臣中间寻找凶手, 暗中布局, ' +
                '最终用一场盛大宴会揭开真相, 完成复仇并继位皇帝, 但失去了所爱之人, 留下苍凉余韵。',
      genre: '古装',
    };
    const richIdea = '一个古装宫廷里的少年皇子, 在母亲被毒杀后开始秘密复仇, 一步步揭开背后的阴谋, 最终完成对决';
    const r = await normalizeIdea(richIdea, { forceLlmExpand: true });
    expect(r.didLlmExpand).toBe(true);
  });
});
