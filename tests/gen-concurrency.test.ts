/**
 * 阶段二十八 v12.32.0 — 可调并发解析单测。默认 2 → 零回归。
 */
import { describe, expect, it, afterEach } from 'vitest';
import { resolveConcurrency, GEN_CONCURRENCY_MAX } from '@/lib/gen-concurrency';

const KEYS = ['GEN_CONCURRENCY', 'GEN_CONCURRENCY_SCENE', 'GEN_CONCURRENCY_STORYBOARD', 'GEN_CONCURRENCY_VIDEO'];
function clearEnv() { for (const k of KEYS) delete process.env[k]; }
afterEach(clearEnv);

describe('resolveConcurrency', () => {
  it('什么都不设 → 默认 2(零回归)', () => {
    clearEnv();
    expect(resolveConcurrency('scene')).toBe(2);
    expect(resolveConcurrency('storyboard')).toBe(2);
    expect(resolveConcurrency('video')).toBe(2);
  });

  it('单阶段 env 覆盖全局', () => {
    clearEnv();
    process.env.GEN_CONCURRENCY = '3';
    process.env.GEN_CONCURRENCY_VIDEO = '5';
    expect(resolveConcurrency('video')).toBe(5);     // 单阶段优先
    expect(resolveConcurrency('storyboard')).toBe(3); // 落全局
  });

  it('夹到 [1,8]', () => {
    clearEnv();
    process.env.GEN_CONCURRENCY_VIDEO = '99';
    expect(resolveConcurrency('video')).toBe(GEN_CONCURRENCY_MAX);
    process.env.GEN_CONCURRENCY_VIDEO = '0'; // 非正 → 当未设 → 默认 2
    expect(resolveConcurrency('video')).toBe(2);
  });

  it('itemCount 封顶(不开超过任务数的并发)', () => {
    clearEnv();
    process.env.GEN_CONCURRENCY_VIDEO = '6';
    expect(resolveConcurrency('video', 2)).toBe(2);
    expect(resolveConcurrency('video', 10)).toBe(6);
  });

  it('非法 env(空/非数字)被忽略', () => {
    clearEnv();
    process.env.GEN_CONCURRENCY_SCENE = 'abc';
    expect(resolveConcurrency('scene')).toBe(2);
    process.env.GEN_CONCURRENCY_SCENE = '  ';
    expect(resolveConcurrency('scene')).toBe(2);
  });
});
