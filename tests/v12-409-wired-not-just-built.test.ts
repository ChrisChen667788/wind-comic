/**
 * v12.409 — 我在讲「造好没接线」的那一版里,自己又犯了一次。
 *
 * ── 事情经过 ──────────────────────────────────────────────────────────
 * v12.407 给 VeoService 加了 `generateExtended()`(Scene Extension);
 * v12.408 给弱镜修复加了 `repair-strategy` 分流,并在说明里写下
 * 「**造好不接线正是这一版要治的病本身**」。
 *
 * 然后竞品复核的 agent 逐处 grep 后当场指出:
 * `generateExtended()` 全仓零命中、`editImage()` 全仓零命中、`repairs` 无人消费。
 * 我自己核了一遍 —— **它是对的**。`editImage` 唯一的搜索命中,
 * 是我在 v12.408 里写的那句「它零调用方」的注释。
 *
 * ── 所以这条测试锁的是「调用链」,不是「能力存在」──────────────────────
 * 能力存在是上一版就有的,它不构成任何保证。这里断言的是:
 * 主管线/端点里**确实有一条路会走到它**。
 * 这类断言必须锁在消费方,锁在生产方等于什么都没锁。
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';

const strip = (src: string) =>
  src.replace(/\/\*[\s\S]*?\*\//g, '')
     .split('\n').filter((l) => !l.trim().startsWith('//'))
     .map((l) => l.replace(/(?<!:)\/\/.*$/, ''))
     .join('\n');

const ORCH = strip(fs.readFileSync('services/hybrid-orchestrator.ts', 'utf-8'));
const REGEN = strip(fs.readFileSync('app/api/projects/[id]/regenerate-storyboard/route.ts', 'utf-8'));

describe('v12.409 · 造好了必须接上线', () => {
  it('Veo Scene Extension 在主管线里有真实调用点', () => {
    // 窗口自证:先确认读到的确实是含 Veo 分支的编排器
    expect(ORCH, '编排器里找不到 Veo 分支 —— 结构变了就得同步这条').toContain("engine === 'veo'");
    expect(ORCH, 'generateExtended 仍然零调用 —— 造好没接线').toContain('generateExtended(');
  });

  it('Veo 时长不再写死 8 秒 —— 剧本要 15s 却只出 8s 且不报错', () => {
    const i = ORCH.indexOf("engine === 'veo'");
    const block = ORCH.slice(i, i + 1800);
    expect(block).toContain('generateExtended');
    expect(block, '又写回 duration: 8 了').not.toMatch(/duration:\s*8\b/);
  });

  it('续接是多次生成 —— 必须有段数上限,不能无限拉长账单', () => {
    const i = ORCH.indexOf('generateExtended(');
    const block = ORCH.slice(Math.max(0, i - 900), i + 300);
    expect(block).toContain('VEO_MAX_SEGMENTS');
    expect(block, '只在剧本确实要更长时才续接').toMatch(/wantSec\s*>\s*VEO_SEGMENT_SEC/);
  });

  it('Kontext 局部重绘在重生端点里有真实调用点', () => {
    expect(REGEN, '窗口自证:这不是分镜重生端点?').toContain('persistStoryboard');
    expect(REGEN, 'editImage 仍然零调用 —— 造好没接线').toContain('editImage(');
    expect(REGEN, '分流决策必须真的被调用,而不只是被定义').toContain('chooseRepairStrategy(');
  });

  it('局部重绘失败必须回落整张重生 —— 修不成不能变成这一镜没了', () => {
    const i = REGEN.indexOf('editImage(');
    expect(i, '找不到 editImage 调用点').toBeGreaterThan(0);
    const block = REGEN.slice(Math.max(0, i - 400), i + 900);
    expect(block, '窗口自证').toContain('editImage');
    expect(block, '没有 try/catch = 局部重绘一失败整镜就没了').toMatch(/catch/);
    expect(block, '要说清回落').toContain('回落');
  });

  it('不给修复上下文时行为与历史完全一致(零回归)', () => {
    // 只有 repair.baseImageUrl 是 http 才可能走局部重绘;否则一律整张重生。
    expect(REGEN).toMatch(/repair\?\.baseImageUrl\?\.startsWith\('http'\)/);
  });
});
