/**
 * v12.406 — 把已接入的用满:Kling 3.0 一次调用出 6 个连贯镜头。
 *
 * ── 为什么这是「用满」而不是「新增」──────────────────────────────────
 * kling-v3 早就在 provider 注册表里了,我们一直只用它的单镜生成。
 * 竞品对比表第三列「我们用了多少」在这一行是 **0**。
 * 多镜的价值不只是省调用次数 —— 同一次生成内的镜间一致性由模型自己保证,
 * 比我们事后用角色 DNA + vision retry 去拼要稳。
 *
 * ── 官方约束是硬的(2026-09-03 核文档)────────────────────────────────
 * ≤6 镜(index 0–5)· 单镜 ≥3 秒 · 合计 ≤15 秒 · prompt ≤2500 字。
 * 越界不是「效果差一点」,是**整次调用被拒** —— 而一次多镜调用被拒 =
 * 6 个镜头一起没了,比单镜失败贵得多。所以规整在本地做。
 *
 * ── 这条测试最要紧的一条 ──────────────────────────────────────────────
 * **溢出的镜头必须被回传,不能静默丢弃。** 这个项目有过「清理任务把还在
 * 被引用的素材当孤儿删掉」的教训 —— 静默少几个镜头,成片看起来仍然「成功」,
 * 只是故事缺了一段,而没有任何地方会报错。
 */
import { describe, it, expect } from 'vitest';
import {
  planMultiShot, worthMultiShot, multiShotBody,
  KLING_MULTISHOT_MAX_SHOTS, KLING_MULTISHOT_MIN_SEC, KLING_MULTISHOT_TOTAL_MAX_SEC,
} from '@/lib/kling-multishot';
import fs from 'node:fs';

const shots = (n: number, sec = 3) =>
  Array.from({ length: n }, (_, i) => ({ prompt: `镜头 ${i}`, durationSec: sec }));

describe('v12.406 · Kling 多镜连贯', () => {
  it('请求体字段与官方 schema 一致', () => {
    const plan = planMultiShot(shots(3));
    const body = multiShotBody(plan) as any;
    expect(body.multi_shot).toBe(true);
    expect(body.shot_type).toBe('customize');
    expect(Array.isArray(body.multi_prompt)).toBe(true);
    expect(body.multi_prompt[0]).toEqual({ index: 0, prompt: '镜头 0', duration: 3 });
    // index 必须连续从 0 开始 —— 官方按 index 排序,跳号会错位
    expect(body.multi_prompt.map((p: any) => p.index)).toEqual([0, 1, 2]);
  });

  it('超过 6 镜时,多出来的必须回传而不是被丢掉', () => {
    const plan = planMultiShot(shots(9, 3));
    // 6 镜 × 3 秒 = 18 秒 > 15 秒上限,所以实际只能进 5 镜
    expect(plan.shots.length).toBeLessThanOrEqual(KLING_MULTISHOT_MAX_SHOTS);
    expect(plan.totalSec).toBeLessThanOrEqual(KLING_MULTISHOT_TOTAL_MAX_SEC);
    // 关键:进去的 + 溢出的 = 原始数量,一个都不能少
    expect(plan.shots.length + plan.overflow.length, '有镜头凭空消失了').toBe(9);
  });

  it('总时长上限优先于镜头数上限', () => {
    const plan = planMultiShot(shots(6, 4)); // 6×4=24s
    expect(plan.totalSec).toBeLessThanOrEqual(KLING_MULTISHOT_TOTAL_MAX_SEC);
    expect(plan.shots.length).toBeLessThan(6);
    expect(plan.shots.length + plan.overflow.length).toBe(6);
  });

  it('单镜时长被抬到官方下限 —— 低于它整次调用会被拒', () => {
    const plan = planMultiShot([{ prompt: 'a', durationSec: 1 }, { prompt: 'b', durationSec: 2 }]);
    for (const s of plan.shots) expect(s.duration).toBeGreaterThanOrEqual(KLING_MULTISHOT_MIN_SEC);
  });

  it('prompt 超长裁断而不是整次失败(官方 2500 字硬限)', () => {
    const plan = planMultiShot([{ prompt: 'x'.repeat(9999) }, { prompt: 'y'.repeat(9999) }]);
    for (const s of plan.shots) expect(s.prompt.length).toBeLessThanOrEqual(2450);
  });

  it('空 prompt 归入溢出,不会发出一个必然被拒的请求', () => {
    const plan = planMultiShot([{ prompt: '  ' }, { prompt: '真镜头' }, { prompt: '' }]);
    expect(plan.shots).toHaveLength(1);
    expect(plan.overflow).toHaveLength(2);
  });

  it('只剩 1 镜时不值得走多镜(单镜路径参数更全)', () => {
    expect(worthMultiShot(planMultiShot(shots(1)))).toBe(false);
    expect(worthMultiShot(planMultiShot(shots(2)))).toBe(true);
  });

  it('非 v3 模型必须提前拒绝 —— 否则字段被静默忽略,产出「看起来正常但只有一镜」的成片', () => {
    const src = fs.readFileSync('services/kling.service.ts', 'utf-8');
    const i = src.indexOf('async generateMultiShot');
    expect(i, '找不到多镜方法').toBeGreaterThan(0);
    const block = src.slice(i, i + 2500);
    expect(block, '窗口自证').toContain('multiShotBody');
    expect(block).toContain("startsWith('kling-v3')");
    expect(block, '没有提前拒绝的分支').toMatch(/throw new Error\(/);
  });

  it('多镜方法把 overflow 一起返回给调用方', () => {
    const src = fs.readFileSync('services/kling.service.ts', 'utf-8');
    const i = src.indexOf('async generateMultiShot');
    const block = src.slice(i, i + 3000);
    expect(block).toContain('plan');
    expect(block, '返回值里没有 plan —— 调用方就拿不到 overflow').toMatch(/return \{ videoUrl, plan, model \}/);
  });
});
