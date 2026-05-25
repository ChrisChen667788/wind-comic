/**
 * v7.1 — lib/llm-client 单测
 *
 * 收口后的统一高可用 LLM 客户端有两块纯逻辑必须锁死, 否则"主→MiniMax 兜底"会悄悄失效:
 *   · buildLLMAttempts —— 尝试链构建 (创意=DeepSeek / 通用=主网关) → MiniMax 全局兜底,
 *     含「主 key 缺失」「兜底与主同 key 同模型则去重」等边界
 *   · stripThink       —— 剥离 reasoning 模型偶发的 <think>...</think>, 直接影响 JSON 解析成功率
 *
 * 这两个是纯函数, 不打网络, buildLLMAttempts 显式吃 cfg 参数 → 无需 mock 模块, 直接喂假配置。
 */

import { describe, it, expect } from 'vitest';
import { buildLLMAttempts, stripThink, isTransientLLMError } from '@/lib/llm-client';

/** 一份"齐全"的假配置: 主网关 + DeepSeek 创意 + MiniMax 兜底 三者都在 */
const FULL_CFG = {
  baseURL: 'https://gw.example/v1',
  apiKey: 'gw-key',
  model: 'claude-sonnet-x',
  creativeBaseURL: 'https://deepseek.example/v1',
  creativeApiKey: 'ds-key',
  creativeModel: 'deepseek-v4-pro',
  creativeFastModel: 'deepseek-v4-flash',
  fallbackBaseURL: 'https://minimax.example/v1',
  fallbackApiKey: 'mm-key',
  fallbackModel: 'MiniMax-M2.7',
};

describe('buildLLMAttempts', () => {
  it('useCreative=true → 主用 DeepSeek 创意端点, 兜底 MiniMax (顺序固定)', () => {
    const out = buildLLMAttempts(true, FULL_CFG);
    expect(out).toHaveLength(2);

    expect(out[0]).toEqual({
      baseURL: 'https://deepseek.example/v1',
      apiKey: 'ds-key',
      model: 'deepseek-v4-pro',
      label: '创意·DeepSeek',
    });
    // 兜底必须在第二位
    expect(out[1]).toEqual({
      baseURL: 'https://minimax.example/v1',
      apiKey: 'mm-key',
      model: 'MiniMax-M2.7',
      label: 'MiniMax兜底',
    });
  });

  it('useCreative=true + fast=true → 主用创意快档 (deepseek-v4-flash), 标签带"快"', () => {
    const out = buildLLMAttempts(true, FULL_CFG, true);
    expect(out).toHaveLength(2);
    expect(out[0]).toEqual({
      baseURL: 'https://deepseek.example/v1',
      apiKey: 'ds-key',
      model: 'deepseek-v4-flash',
      label: '创意·DeepSeek快',
    });
    expect(out[1].label).toBe('MiniMax兜底');
  });

  it('fast=true 但未配 creativeFastModel → 回落到 creativeModel (pro)', () => {
    const cfg = { ...FULL_CFG };
    delete (cfg as any).creativeFastModel;
    const out = buildLLMAttempts(true, cfg, true);
    expect(out[0].model).toBe('deepseek-v4-pro');
    expect(out[0].label).toBe('创意·DeepSeek快');
  });

  it('fast=false (默认) → 仍用 creativeModel (pro), 不受快档影响', () => {
    const out = buildLLMAttempts(true, FULL_CFG, false);
    expect(out[0].model).toBe('deepseek-v4-pro');
    expect(out[0].label).toBe('创意·DeepSeek');
  });

  it('fast 仅对 useCreative 生效; 通用档不受影响', () => {
    const out = buildLLMAttempts(false, FULL_CFG, true);
    expect(out[0].model).toBe('claude-sonnet-x');
    expect(out[0].label).toBe('通用');
  });

  it('useCreative=false → 主用通用主网关, 兜底 MiniMax', () => {
    const out = buildLLMAttempts(false, FULL_CFG);
    expect(out).toHaveLength(2);
    expect(out[0]).toEqual({
      baseURL: 'https://gw.example/v1',
      apiKey: 'gw-key',
      model: 'claude-sonnet-x',
      label: '通用',
    });
    expect(out[1].label).toBe('MiniMax兜底');
  });

  it('创意端点缺省时回落到通用 baseURL/apiKey/model (容错, 不至于空链)', () => {
    const cfg = {
      baseURL: 'https://gw.example/v1',
      apiKey: 'gw-key',
      model: 'claude-sonnet-x',
      // 故意不给 creative* —— 模拟只配了主网关、没单独配 DeepSeek 的环境
      fallbackBaseURL: 'https://minimax.example/v1',
      fallbackApiKey: 'mm-key',
      fallbackModel: 'MiniMax-M2.7',
    };
    const out = buildLLMAttempts(true, cfg);
    expect(out[0]).toEqual({
      baseURL: 'https://gw.example/v1',
      apiKey: 'gw-key',
      model: 'claude-sonnet-x',
      label: '创意·DeepSeek',
    });
    expect(out[1].label).toBe('MiniMax兜底');
  });

  it('无 fallbackApiKey → 不追加兜底 (只剩主)', () => {
    const cfg = { ...FULL_CFG, fallbackApiKey: '' };
    const out = buildLLMAttempts(true, cfg);
    expect(out).toHaveLength(1);
    expect(out[0].label).toBe('创意·DeepSeek');
  });

  it('兜底与主"同 key 且同模型" → 去重, 不重复打同一个端点', () => {
    const cfg = {
      ...FULL_CFG,
      creativeApiKey: 'same-key',
      creativeModel: 'same-model',
      fallbackApiKey: 'same-key',
      fallbackModel: 'same-model',
    };
    const out = buildLLMAttempts(true, cfg);
    expect(out).toHaveLength(1);
    expect(out[0].label).toBe('创意·DeepSeek');
  });

  it('兜底与主"同 key 但模型不同" → 仍追加兜底 (是个真兜底)', () => {
    const cfg = {
      ...FULL_CFG,
      creativeApiKey: 'same-key',
      creativeModel: 'deepseek-v4-pro',
      fallbackApiKey: 'same-key',
      fallbackModel: 'MiniMax-M2.7',
    };
    const out = buildLLMAttempts(true, cfg);
    expect(out).toHaveLength(2);
    expect(out[1].model).toBe('MiniMax-M2.7');
  });

  it('主 key 缺失但有兜底 → 仅兜底 (主 LLM 欠费时系统仍可用)', () => {
    const cfg = {
      baseURL: 'https://gw.example/v1',
      apiKey: '',
      model: 'claude-sonnet-x',
      creativeApiKey: '',
      creativeModel: 'deepseek-v4-pro',
      fallbackBaseURL: 'https://minimax.example/v1',
      fallbackApiKey: 'mm-key',
      fallbackModel: 'MiniMax-M2.7',
    };
    const out = buildLLMAttempts(true, cfg);
    expect(out).toHaveLength(1);
    expect(out[0].label).toBe('MiniMax兜底');
  });

  it('全空配置 → 空链 (上层据此报"LLM 未配置")', () => {
    const out = buildLLMAttempts(true, {
      baseURL: '', apiKey: '', model: '',
      creativeApiKey: '', creativeModel: '',
      fallbackApiKey: '', fallbackBaseURL: '', fallbackModel: '',
    });
    expect(out).toHaveLength(0);
  });
});

describe('stripThink', () => {
  it('剥离开头的 <think>...</think>, 保留正文', () => {
    expect(stripThink('<think>盘算一下</think>{"a":1}')).toBe('{"a":1}');
  });

  it('剥离跨行 think 块', () => {
    const s = '<think>\n第一步\n第二步\n</think>\n实际答案';
    expect(stripThink(s)).toBe('实际答案');
  });

  it('大小写不敏感 (<THINK> / <Think>)', () => {
    expect(stripThink('<THINK>x</THINK>ok')).toBe('ok');
    expect(stripThink('<Think>y</Think>ok')).toBe('ok');
  });

  it('多个 think 块全部剥离 (全局)', () => {
    expect(stripThink('<think>a</think>A<think>b</think>B')).toBe('AB');
  });

  it('无 think 块 → 仅 trim', () => {
    expect(stripThink('  纯正文  ')).toBe('纯正文');
  });

  it('空 / null / undefined → 空串, 不抛', () => {
    expect(stripThink('')).toBe('');
    expect(stripThink(undefined as any)).toBe('');
    expect(stripThink(null as any)).toBe('');
  });
});

describe('isTransientLLMError', () => {
  it('过载/限流/5xx 类 → true (应退避重试同端点)', () => {
    expect(isTransientLLMError('Service is too busy. We advise users to switch...')).toBe(true);
    expect(isTransientLLMError('rate limit exceeded')).toBe(true);
    expect(isTransientLLMError('LLM 429')).toBe(true);
    expect(isTransientLLMError('LLM 503')).toBe(true);
    expect(isTransientLLMError('upstream overload')).toBe(true);
    expect(isTransientLLMError('请稍后再试')).toBe(true);
    expect(isTransientLLMError('服务繁忙')).toBe(true);
  });

  it('非瞬时错误 → false (应直接切兜底, 不空转重试)', () => {
    expect(isTransientLLMError('insufficient balance')).toBe(false);
    expect(isTransientLLMError('invalid api key')).toBe(false);
    expect(isTransientLLMError('model not found')).toBe(false);
    expect(isTransientLLMError('')).toBe(false);
  });

  it('timeout 故意不算瞬时 (重试同端点代价高, 直接切兜底更划算)', () => {
    expect(isTransientLLMError('timeout')).toBe(false);
  });
});
