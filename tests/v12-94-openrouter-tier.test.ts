/**
 * v12.94 — OpenRouter 档(调研落地):LLM 兜底链 + 视觉兜底优先级。
 */
import { describe, it, expect } from 'vitest';
import { buildLLMAttempts } from '@/lib/llm-client';
import { resolveVisionFallback } from '@/lib/shot-quality-gate';

const CFG = {
  baseURL: 'https://gw/v1', apiKey: 'k1', model: 'claude-sonnet-4-20250514',
  creativeBaseURL: 'https://gw/v1', creativeApiKey: 'k1', creativeModel: 'claude-sonnet-4-20250514',
  altModels: ['claude-sonnet-4-6'],
  fallbackBaseURL: 'https://api.minimaxi.com/v1', fallbackApiKey: 'mk', fallbackModel: 'MiniMax-M3',
  openrouterApiKey: 'ork', openrouterBaseURL: 'https://openrouter.ai/api/v1', openrouterModel: 'anthropic/claude-sonnet-4',
};

describe('v12.94 · OpenRouter 档', () => {
  it('LLM 链顺序:主 → 同网关备用 → OpenRouter → MiniMax 慢兜底', () => {
    const chain = buildLLMAttempts(false, CFG);
    expect(chain.map((a) => a.label)).toEqual(['通用', '同网关备用·claude-sonnet-4-6', 'OpenRouter兜底', 'MiniMax兜底']);
    expect(chain[2].baseURL).toBe('https://openrouter.ai/api/v1');
  });

  it('无 OPENROUTER key → 链不含该档(旧行为零回归)', () => {
    const chain = buildLLMAttempts(false, { ...CFG, openrouterApiKey: '' });
    expect(chain.map((a) => a.label)).toEqual(['通用', '同网关备用·claude-sonnet-4-6', 'MiniMax兜底']);
  });

  it('视觉兜底优先级:显式 VISION_FALLBACK > OpenRouter > MiniMax', () => {
    expect(resolveVisionFallback({ VISION_FALLBACK_BASE_URL: 'https://x/v1', VISION_FALLBACK_API_KEY: 'v', OPENROUTER_API_KEY: 'o', MINIMAX_API_KEY: 'm' } as any)!.baseURL).toBe('https://x/v1');
    const or = resolveVisionFallback({ OPENROUTER_API_KEY: 'o', MINIMAX_API_KEY: 'm' } as any)!;
    expect(or.baseURL).toBe('https://openrouter.ai/api/v1');
    expect(or.model).toBe('anthropic/claude-sonnet-4');
    expect(resolveVisionFallback({ MINIMAX_API_KEY: 'm' } as any)!.model).toBe('abab7-chat-preview');
  });
});
