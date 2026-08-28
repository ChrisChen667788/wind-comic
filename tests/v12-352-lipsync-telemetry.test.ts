/**
 * v12.352:口型这一路一条遥测都没有 —— admin 面板上它是空的。
 *
 * 迭代方案里这条写的是「G5 withLipSyncPlugin」。**照着做会是花架子**,原因:
 *
 * `withXxxPlugin(input, fallback)` 的语义是「插件链当 primary,orchestrator 老路径当
 * fallback」。但 lipsync **本来就是走注册表调度的**(`dispatchLipSyncGenerate`),
 * 没有另一条老路径 —— plugin 与 fallback 会是同一个函数,模式(off/shadow/primary)
 * 因此毫无意义。更要命的是 `getPluginChainMode()` 默认返回 `'off'`,而 `runWithPlugin`
 * 在 off 时直接 `return fallback()`,**连遥测都不落**。套上 wrapper,面板还是空的。
 *
 * 所以真正该补的是**在真实调用点落账**,与 plugin mode 无关。
 * wrapper 仍然加了(补齐四路对称,给将来的自定义 provider 用),但它不是这一版的实质。
 */
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

const read = (rel: string) => fs.readFileSync(path.join(process.cwd(), rel), 'utf8');

describe('v12.352 lipsync 遥测', () => {
  const ROUTE = read('app/api/projects/[id]/lipsync/render/route.ts');

  it('真实调用点落遥测(不依赖 plugin mode)', () => {
    expect(ROUTE).toMatch(/recordPluginEvent\(\{/);
    expect(ROUTE).toMatch(/kind: 'lipsync'/);
  });

  it('成败都要落,不能只记成功的(否则成功率恒 100%)', () => {
    expect(ROUTE).toMatch(/outcome: result \? 'primary_hit' : 'primary_fallback'/);
  });

  it('记耗时 —— 面板要看的就是 latency', () => {
    expect(ROUTE).toMatch(/const _lsT0 = Date\.now\(\)/);
    expect(ROUTE).toMatch(/latencyMs: Date\.now\(\) - _lsT0/);
  });

  it('失败时把链上各 provider 的原因带上', () => {
    expect(ROUTE).toMatch(/tried\.map\(\(t\) => t\.error\)/);
  });

  it('遥测是 fire-and-forget,不能拖垮渲染', () => {
    expect(ROUTE).toMatch(/void recordPluginEvent/);
  });

  it('把「为什么不套 wrapper」写在代码里,免得后人再照方案加一遍', () => {
    expect(ROUTE).toMatch(/花架子/);
    expect(ROUTE).toMatch(/默认 mode 是 `off`/);
  });
});

describe('v12.352 类型与 wrapper 补齐', () => {
  it('PluginEventKind 含 lipsync', () => {
    expect(read('lib/plugin-chain-telemetry.ts')).toMatch(/PluginEventKind = 'image' \| 'video' \| 'tts' \| 'lipsync'/);
  });

  it('withLipSyncPlugin 存在且走同一个 runWithPlugin 核心', () => {
    const R = read('lib/plugin-chain-router.ts');
    expect(R).toMatch(/export async function withLipSyncPlugin/);
    expect(R).toMatch(/runWithPlugin\('lipsync'/);
  });

  it('全失败时抛错(才能触发 fallback / 记 primary_fallback)', () => {
    const R = read('lib/plugin-chain-router.ts');
    const win = R.slice(R.indexOf('async function tryLipSyncPlugin'));
    expect(win).toMatch(/if \(!r\.result\)/);
    expect(win).toMatch(/throw new Error/);
  });

  it('文件头说明已从「三个」更新为「四个」—— 注释也是要维护的', () => {
    expect(read('lib/plugin-chain-router.ts')).toMatch(/四个 `withXxxPlugin`/);
  });
});
