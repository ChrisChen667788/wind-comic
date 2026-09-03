/**
 * v12.417 — 本地 5294 全绿,CI 却红。真因:两边的 Node 对 unhandled rejection 处理不同。
 *
 * ── 事情经过 ──────────────────────────────────────────────────────────
 * v12.407 / v12.411 的假时钟辅助函数写成:
 *
 *     const wrapped = p.then(onOk, onErr);
 *     for (...) await vi.advanceTimersByTimeAsync(5000);   // ← 在这期间 p 已经 reject
 *     return wrapped;                                       // ← 到这里才有人接
 *
 * `wrapped` 在推时钟的那段时间里是一个**已拒绝但还没人处理**的 promise。
 * 本机 Node 25 不报,CI 的 Node 20 报成 unhandled rejection → vitest
 * 「5293 passed / 0 failed / **1 error**」→ 退出码 1。
 *
 * 于是出现最难判的那种红:**没有一条测试失败,但整个 run 是失败的**。
 *
 * ── 修法不是「把那两处改对」──────────────────────────────────────────
 * 改对只解决这一次。真正的问题是**本地与 CI 的判定标准不一样** ——
 * 这正是 v12.325 那条教训(「本地全绿从来推不出 CI 会绿,除非本地跑的就是 CI 跑的」)
 * 在另一个维度上的重演:那次差的是门禁步骤,这次差的是 Node 运行时标志。
 *
 * 所以 `npm test` 显式带上 `--unhandled-rejections=strict`,让两边用同一套标准。
 * 已实测:旧写法退出码 1、新写法退出码 0。
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';

describe('v12.417 · unhandled rejection 的本地/CI 一致', () => {
  it('npm test 必须显式声明 strict —— 否则本地判定比 CI 宽松', () => {
    const pkg = JSON.parse(fs.readFileSync('package.json', 'utf-8'));
    const t = String(pkg.scripts?.test || '');
    expect(t, '窗口自证:test 脚本是空的?').toContain('vitest');
    expect(t, 'Node 版本一变,本地就会比 CI 宽松,而那种红「没有一条测试失败」').toContain('--unhandled-rejections=strict');
  });

  it('CI 跑的就是这个脚本 —— 两边必须是同一条命令', () => {
    const ci = fs.readFileSync('.github/workflows/ci.yml', 'utf-8');
    expect(ci, '窗口自证:CI 里找不到测试步骤').toMatch(/run:\s*npm test/);
  });

  it('两处假时钟辅助函数都不再留下「已拒绝但没人接」的 promise', () => {
    for (const f of ['tests/v12-407-veo-scene-extension.test.ts', 'tests/v12-411-selfhost-open-video.test.ts']) {
      const src = fs.readFileSync(f, 'utf-8');
      expect(src, `${f} 窗口自证:没有 runWithClock`).toContain('async function runWithClock');
      // 旧写法的特征:先 then 出一个 wrapped,推完时钟才 return 它
      expect(
        /const wrapped = p\.then\(/.test(src),
        `${f} 又退回了「推时钟期间无人接住」的写法`,
      ).toBe(false);
      // 新写法:立刻用回调接住,结果存进 outcome
      expect(src).toContain('outcome');
    }
  });
});
