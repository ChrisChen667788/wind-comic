/**
 * v10.6.3 — 模型雷达单测。
 *
 * 覆盖:版本向量/档位权重/同家族择优(护栏:档位不降/快档锁档/版本不倒退)、
 * 注入假清单的全链扫描(升级建议/已最新/来源不可用)、
 * model_overrides 落库 + env 生效 + 回滚基线、config.ts 模型 getter 免重启生效。
 */
import { afterEach, describe, expect, it } from 'vitest';
import {
  tierWeight, versionVector, compareVersions, pickBest,
  scanLatestModels, MODULE_TARGETS,
} from '@/lib/model-scan';
import { applyModelOverride, rollbackModelOverride, listModelOverrides, loadModelOverridesIntoEnv } from '@/lib/model-overrides';
import { API_CONFIG } from '@/lib/config';

describe('v10.6.3 · 版本/档位排序(纯函数)', () => {
  it('versionVector:常见模型 ID 的数字序列', () => {
    expect(versionVector('veo3.1-pro')).toEqual([3, 1]);
    expect(versionVector('claude-sonnet-4-6')).toEqual([4, 6]);
    expect(versionVector('MiniMax-M2.7')).toEqual([2, 7]);
    expect(versionVector('deepseek-v4-flash')).toEqual([4]);
  });

  it('tierWeight:pro/ultra 主档 3,turbo/hd 中档 2,flash/lite 快档 1,无标记 2', () => {
    expect(tierWeight('deepseek-v4-pro')).toBe(3);
    expect(tierWeight('speech-02-hd')).toBe(2);
    expect(tierWeight('deepseek-v4-flash')).toBe(1);
    expect(tierWeight('MiniMax-M2.7')).toBe(2);
  });

  it('compareVersions:字典序,短向量补 0', () => {
    expect(compareVersions([4, 6], [4, 5])).toBe(1);
    expect(compareVersions([3, 1], [4])).toBe(-1);
    expect(compareVersions([2, 7], [2, 7])).toBe(0);
  });
});

describe('v10.6.3 · pickBest(同家族择优 + 护栏)', () => {
  it('更高版本同档 → 升级;无更优 → null', () => {
    expect(pickBest('deepseek-v4-pro', ['deepseek-v4-pro', 'deepseek-v5-pro'])).toBe('deepseek-v5-pro');
    expect(pickBest('deepseek-v5-pro', ['deepseek-v4-pro', 'deepseek-v5-pro'])).toBeNull();
  });

  it('护栏:档位不降 —— pro 不会被 flash 顶掉(哪怕版本更高)', () => {
    expect(pickBest('deepseek-v4-pro', ['deepseek-v5-flash'])).toBeNull();
  });

  it('护栏:快档锁档(keepTier)—— flash 只升 flash,不升 pro', () => {
    expect(pickBest('deepseek-v4-flash', ['deepseek-v5-pro', 'deepseek-v5-flash'], { keepTier: true })).toBe('deepseek-v5-flash');
    expect(pickBest('deepseek-v4-flash', ['deepseek-v5-pro'], { keepTier: true })).toBeNull();
  });

  it('护栏:版本不倒退;同版本只接受档位更高', () => {
    expect(pickBest('veo3.1-pro', ['veo3', 'veo2-pro'])).toBeNull();
    expect(pickBest('veo3.1', ['veo3.1-pro'])).toBe('veo3.1-pro');
    expect(pickBest('MiniMax-M2.7', ['MiniMax-M3.2', 'MiniMax-M2.8'])).toBe('MiniMax-M3.2');
  });

  it('多候选取最强:版本优先,再比档位', () => {
    expect(pickBest('veo3.1-pro', ['veo3.1-pro', 'veo4', 'veo4-pro'])).toBe('veo4-pro');
  });
});

describe('v10.6.3 · scanLatestModels(注入假清单)', () => {
  const FAKE: Record<string, string[] | null> = {
    primary: ['claude-sonnet-4-6', 'claude-sonnet-5', 'claude-opus-5', 'gpt-x'],
    creative: ['deepseek-v4-pro', 'deepseek-v5-pro', 'deepseek-v5-flash', 'deepseek-v4-flash'],
    fallback: ['MiniMax-M2.7', 'MiniMax-M3', 'MiniMax-Music-2.6', 'speech-02-hd', 'speech-03-hd'],
    xverse: null,       // 自托管未起 → 来源不可用
    qingyuntop: ['veo3.1-pro', 'veo4-pro', 'sora-2-pro', 'vidu-q2'],
    vectorengine: null,
  };

  it('同家族升级建议正确;跨家族(opus/gpt)绝不掺入;不可用来源如实标注', async () => {
    const report = await scanLatestModels(async (source) => FAKE[source] ?? null);
    const by = Object.fromEntries(report.results.map((r) => [r.module, r]));

    expect(by['primary-llm'].latest).toBe('claude-sonnet-5');     // 锁 Sonnet 档,opus 不掺入
    expect(by['creative-llm'].latest).toBe('deepseek-v5-pro');
    expect(by['creative-fast-llm'].latest).toBe('deepseek-v5-flash'); // 快档锁档
    expect(by['llm-fallback'].latest).toBe('MiniMax-M3');
    expect(by['llm-fallback'].familyCandidates).toBe(2); // Music 系不入家族(\d 收紧)
    expect(by['video-veo'].latest).toBe('veo4-pro');
    expect(by['tts-minimax'].latest).toBe('speech-03-hd');
    expect(by['xverse'].status).toBe('source-unavailable');
    expect(report.unscannable.length).toBeGreaterThan(0);          // fal/ComfyUI 诚实标不可扫
  });

  it('清单与现配置一致 → 全部已最新', async () => {
    const report = await scanLatestModels(async (source) =>
      source === 'creative' ? ['deepseek-v4-pro', 'deepseek-v4-flash'] : null);
    const cr = report.results.find((r) => r.module === 'creative-llm')!;
    expect(cr.status).toBe('up-to-date');
    expect(cr.latest).toBeNull();
  });

  it('MODULE_TARGETS 与 config 默认一致(漂移守卫)', () => {
    const t = Object.fromEntries(MODULE_TARGETS.map((x) => [x.envKey, x.defaultModel]));
    expect(t['OPENAI_MODEL']).toBe('claude-sonnet-4-6');
    expect(t['OPENAI_CREATIVE_MODEL']).toBe('deepseek-v4-pro');
    expect(t['VEO_MODEL']).toBe('veo3.1-pro');
  });
});

describe('v10.6.3 · 覆盖落库 + 免重启生效 + 回滚', () => {
  const KEY = 'OPENAI_CREATIVE_MODEL';

  afterEach(async () => {
    // 清理:回滚到无覆盖 + 还原 env
    await rollbackModelOverride(KEY).catch(() => {});
    delete process.env[KEY];
  });

  it('applyModelOverride:env 立即生效(config getter 同步读到)+ 落库记 prev', async () => {
    delete process.env[KEY];
    expect(API_CONFIG.openai.creativeModel).toBe('deepseek-v4-pro'); // 代码默认

    const row = await applyModelOverride(KEY, 'deepseek-v5-pro');
    expect(row.prevValue).toBeNull(); // 当初没设 env
    expect(process.env[KEY]).toBe('deepseek-v5-pro');
    expect(API_CONFIG.openai.creativeModel).toBe('deepseek-v5-pro'); // getter 免重启生效

    const rows = await listModelOverrides();
    expect(rows.find((r) => r.envKey === KEY)?.value).toBe('deepseek-v5-pro');
  });

  it('链式升级 prev 保最初基线;回滚还原(空基线 = 删 env 回代码默认)', async () => {
    delete process.env[KEY];
    await applyModelOverride(KEY, 'deepseek-v5-pro');
    const second = await applyModelOverride(KEY, 'deepseek-v6-pro');
    expect(second.prevValue).toBeNull(); // 仍是最初基线,不是 v5

    const ok = await rollbackModelOverride(KEY);
    expect(ok).toBe(true);
    expect(process.env[KEY]).toBeUndefined();
    expect(API_CONFIG.openai.creativeModel).toBe('deepseek-v4-pro');
    expect((await listModelOverrides()).find((r) => r.envKey === KEY)).toBeUndefined();
  });

  it('开机重放:DB 覆盖写回 env', async () => {
    await applyModelOverride(KEY, 'deepseek-v5-pro');
    delete process.env[KEY]; // 模拟重启后 env 干净
    const n = await loadModelOverridesIntoEnv();
    expect(n).toBeGreaterThanOrEqual(1);
    expect(process.env[KEY]).toBe('deepseek-v5-pro');
  });
});
