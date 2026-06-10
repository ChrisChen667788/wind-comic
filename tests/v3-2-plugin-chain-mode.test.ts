/**
 * v3.2 P3.1 — Plugin-chain mode env reader + counters.
 *
 * 闸门测试: env 解析 (off / shadow / primary / 任何其他都 off), 采样率 clamp.
 */

import { describe, expect, it, afterEach, beforeEach } from 'vitest';
import {
  getPluginChainMode,
  getShadowSampleRate,
  shouldSampleShadow,
  pluginChainStats,
} from '@/lib/plugin-chain-mode';

const savedEnv = { ...process.env };

beforeEach(() => {
  delete process.env.PLUGIN_CHAIN_MODE;
  delete process.env.PLUGIN_CHAIN_SHADOW_RATE;
  delete process.env.MOCK_ENGINES; // v10.4.0: mode 解析新增 MOCK_ENGINES 维度
  pluginChainStats.reset();
});

afterEach(() => {
  Object.keys(process.env).forEach((k) => delete process.env[k]);
  Object.assign(process.env, savedEnv);
});

describe('v3.2 P3.1 · getPluginChainMode', () => {
  it('defaults to off when env not set', () => {
    expect(getPluginChainMode()).toBe('off');
  });
  it('parses "primary"', () => {
    process.env.PLUGIN_CHAIN_MODE = 'primary';
    expect(getPluginChainMode()).toBe('primary');
  });
  it('parses "shadow"', () => {
    process.env.PLUGIN_CHAIN_MODE = 'shadow';
    expect(getPluginChainMode()).toBe('shadow');
  });
  it('is case-insensitive + trimmed', () => {
    process.env.PLUGIN_CHAIN_MODE = '  PRIMARY  ';
    expect(getPluginChainMode()).toBe('primary');
  });
  it('falls back to off on unknown value (safest default)', () => {
    process.env.PLUGIN_CHAIN_MODE = 'YOLO';
    expect(getPluginChainMode()).toBe('off');
  });
  it('empty string → off', () => {
    process.env.PLUGIN_CHAIN_MODE = '';
    expect(getPluginChainMode()).toBe('off');
  });

  // v10.4.0: mock 引擎隐含 primary(mock 必须经 plugin chain 才会被走到)
  it('MOCK_ENGINES=1 且未显式设 mode → 隐含 primary', () => {
    process.env.MOCK_ENGINES = '1';
    expect(getPluginChainMode()).toBe('primary');
  });
  it('显式 PLUGIN_CHAIN_MODE=off 优先于 MOCK_ENGINES 隐含', () => {
    process.env.MOCK_ENGINES = '1';
    process.env.PLUGIN_CHAIN_MODE = 'off';
    expect(getPluginChainMode()).toBe('off');
  });
  it('显式 shadow 优先于 MOCK_ENGINES 隐含', () => {
    process.env.MOCK_ENGINES = '1';
    process.env.PLUGIN_CHAIN_MODE = 'shadow';
    expect(getPluginChainMode()).toBe('shadow');
  });
});

describe('v3.2 P3.1 · getShadowSampleRate', () => {
  it('defaults to 0.05 (5%)', () => {
    expect(getShadowSampleRate()).toBe(0.05);
  });
  it('parses numeric env', () => {
    process.env.PLUGIN_CHAIN_SHADOW_RATE = '0.25';
    expect(getShadowSampleRate()).toBe(0.25);
  });
  it('clamps below 0', () => {
    process.env.PLUGIN_CHAIN_SHADOW_RATE = '-1';
    expect(getShadowSampleRate()).toBe(0);
  });
  it('clamps above 1', () => {
    process.env.PLUGIN_CHAIN_SHADOW_RATE = '5';
    expect(getShadowSampleRate()).toBe(1);
  });
  it('non-numeric → default 0.05', () => {
    process.env.PLUGIN_CHAIN_SHADOW_RATE = 'lots';
    expect(getShadowSampleRate()).toBe(0.05);
  });
});

describe('v3.2 P3.1 · shouldSampleShadow', () => {
  it('returns true when rng < rate', () => {
    process.env.PLUGIN_CHAIN_SHADOW_RATE = '0.5';
    expect(shouldSampleShadow(() => 0.3)).toBe(true);
    expect(shouldSampleShadow(() => 0.6)).toBe(false);
  });
  it('rate=0 always false', () => {
    process.env.PLUGIN_CHAIN_SHADOW_RATE = '0';
    expect(shouldSampleShadow(() => 0)).toBe(false);
  });
  it('rate=1 always true', () => {
    process.env.PLUGIN_CHAIN_SHADOW_RATE = '1';
    expect(shouldSampleShadow(() => 0.99)).toBe(true);
  });
});

describe('v3.2 P3.1 · pluginChainStats', () => {
  it('counters start at 0', () => {
    const s = pluginChainStats.snapshot();
    expect(s.primaryHits).toBe(0);
    expect(s.shadowSampled).toBe(0);
    expect(s.errors).toEqual({});
  });
  it('records and snapshots', () => {
    pluginChainStats.recordPrimaryHit();
    pluginChainStats.recordPrimaryHit();
    pluginChainStats.recordPrimaryFallback();
    pluginChainStats.recordShadowSampled();
    pluginChainStats.recordShadowAgreed();
    pluginChainStats.recordError('image:timeout');
    pluginChainStats.recordError('image:timeout');
    pluginChainStats.recordError('video:429');
    const s = pluginChainStats.snapshot();
    expect(s.primaryHits).toBe(2);
    expect(s.primaryFallbacks).toBe(1);
    expect(s.shadowSampled).toBe(1);
    expect(s.shadowAgreed).toBe(1);
    expect(s.errors['image:timeout']).toBe(2);
    expect(s.errors['video:429']).toBe(1);
  });
  it('snapshot returns a copy (mutation safe)', () => {
    pluginChainStats.recordPrimaryHit();
    const s1 = pluginChainStats.snapshot();
    s1.primaryHits = 99;
    s1.errors['injected'] = 1;
    const s2 = pluginChainStats.snapshot();
    expect(s2.primaryHits).toBe(1);
    expect(s2.errors['injected']).toBeUndefined();
  });
  it('reset zeros everything', () => {
    pluginChainStats.recordPrimaryHit();
    pluginChainStats.recordError('x');
    pluginChainStats.reset();
    const s = pluginChainStats.snapshot();
    expect(s.primaryHits).toBe(0);
    expect(s.errors).toEqual({});
  });
  it('error key is truncated to 40 chars', () => {
    const longKind = 'a'.repeat(200);
    pluginChainStats.recordError(longKind);
    const s = pluginChainStats.snapshot();
    const keys = Object.keys(s.errors);
    expect(keys[0].length).toBeLessThanOrEqual(40);
  });
});
