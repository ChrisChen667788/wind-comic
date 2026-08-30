/**
 * v12.309 — TTS 逐段串行,每段等上一段跑完。
 *
 * 6 个有台词的镜头 × 3-5s/次 = **18-30s 纯等待**,而这些调用彼此完全独立
 * (不同文本、不同 voiceId)。串行**不省钱**(TTS 按调用次数计费),只白耗时。
 *
 * ── 为什么这一版我先停手过一次 ──────────────────────────────────────────
 * 上一轮我明确说过「这个循环 130 行、是配音热路径,改坏就是每部片子的配音全废,
 * 剩余余量验不透,不硬上」。现在补做,做法是把风险压到最小:
 *
 * **生成并发、装配串行。** 每镜只返回结果对象(clip / duration / warnings / emits),
 * 全部结束后**按原下标顺序**统一写回共享数组。
 * 并发化最容易出的事故正是**输出不再确定** —— 完成顺序是乱的,若各自直接 push,
 * `voiceoverClips` / `audioWarnings` 的次序会随网络抖动而变:**同样的输入两次跑出不同的片子**。
 * 现在并发只影响耗时,产物逐字节确定。
 *
 * 并发上限刻意保守(默认 3):TTS 侧普遍有速率限制,开太大只会换来一片 429 再走静音兜底 ——
 * 那比串行更糟。可用 `TTS_CONCURRENCY` 调,夹在 1..6。
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';

const strip = (t: string) =>
  t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const SRC = strip(fs.readFileSync('services/agents/editor-agent.ts', 'utf-8'));

/** 复刻实现里的「有界并发 + 按下标装配」调度器,用于真跑对照 */
async function runPool<T, R>(
  items: T[],
  limit: number,
  fn: (t: T, i: number) => Promise<R>,
): Promise<R[]> {
  const slots: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      for (;;) {
        const i = next++;
        if (i >= items.length) return;
        slots[i] = await fn(items[i], i);
      }
    }),
  );
  return slots;
}

describe('v12.309 · 并发不改变输出顺序(本版最要命的风险)', () => {
  /** 故意让靠后的镜先完成 —— 越靠后越快 */
  const reversedTiming = (n: number) =>
    Array.from({ length: n }, (_, i) => ({ sn: i + 1, delay: (n - i) * 5 }));

  it('**按下标落位:无论谁先完成,镜序恒定**', async () => {
    const items = reversedTiming(6);
    const slots = await runPool(items, 3, async (t) => {
      await new Promise((r) => setTimeout(r, t.delay));
      return t.sn;
    });
    expect(slots).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it('对照:按完成顺序 push 会把镜序打乱(这就是必须避开的事故)', async () => {
    const items = reversedTiming(6);
    const byCompletion: number[] = [];
    await runPool(items, 3, async (t) => {
      await new Promise((r) => setTimeout(r, t.delay));
      byCompletion.push(t.sn);
      return t.sn;
    });
    expect(byCompletion, '完成顺序确实不是 1..6').not.toEqual([1, 2, 3, 4, 5, 6]);
  });

  it('确定性:同样的输入多跑几次,装配结果完全一致', async () => {
    const items = reversedTiming(8);
    const runs = await Promise.all([1, 2, 3].map(() =>
      runPool(items, 3, async (t) => { await new Promise((r) => setTimeout(r, t.delay)); return t.sn; })));
    expect(runs[1]).toEqual(runs[0]);
    expect(runs[2]).toEqual(runs[0]);
  });

  it('单镜失败不拖垮整批,且不在结果里留空洞', async () => {
    const items = [1, 2, 3, 4];
    const slots = await runPool(items, 2, async (n) => {
      if (n === 2) return { ok: false, sn: n };
      return { ok: true, sn: n };
    });
    expect(slots).toHaveLength(4);
    expect(slots.map((s: any) => s.sn)).toEqual([1, 2, 3, 4]);
    expect(slots.filter((s: any) => !s.ok)).toHaveLength(1);
  });

  it('并发确实生效:6 个各 30ms 的任务,limit=3 明显快于串行', async () => {
    const items = Array.from({ length: 6 }, (_, i) => i);
    const t0 = Date.now();
    await runPool(items, 3, async () => { await new Promise((r) => setTimeout(r, 30)); return 1; });
    const parallel = Date.now() - t0;
    expect(parallel, `串行需 ~180ms,limit=3 应在 ~60-120ms`).toBeLessThan(170);
  });

  it('limit 大于任务数时不起多余的 worker', async () => {
    const items = [1, 2];
    const slots = await runPool(items, 10, async (n) => n);
    expect(slots).toEqual([1, 2]);
  });
});

describe('v12.309 · 接线', () => {
  it('循环已改为有界并发(旧的 for-await 串行必须消失)', () => {
    expect(SRC, '旧串行循环仍在').not.toMatch(/for \(let i = 0; i < dialogueShots\.length; i\+\+\) \{\s*const t = dialogueShots\[i\];\s*try \{/);
    expect(SRC).toContain('const runShot = async (t: any, i: number)');
    expect(SRC).toContain('_slots[i] = await runShot(dialogueShots[i], i)');
  });

  it('**装配按原下标顺序**,不是按完成顺序', () => {
    const i = SRC.indexOf('for (let i = 0; i < dialogueShots.length; i++) {\n          const r = _slots[i];');
    expect(i, '未找到按序装配').toBeGreaterThan(0);
    const block = SRC.slice(i, i + 600);
    expect(block).toContain('voiceoverClips.push(r.clip)');
    expect(block).toContain('audioWarnings.push(w)');
  });

  it('runShot 内不得直接改共享数组(那会让顺序随网络抖动而变)', () => {
    const i = SRC.indexOf('const runShot = async');
    const j = SRC.indexOf('await Promise.all(', i);
    expect(i, '找不到 runShot').toBeGreaterThan(0);
    expect(j, '窗口右界在左界之前 —— 切出来是空串,下面三条 not.* 会全部静默通过').toBeGreaterThan(i);
    const body = SRC.slice(i, j);
    expect(body, '窗口自证').toContain('runShot');
    expect(body, 'runShot 内不该 push voiceoverClips').not.toContain('voiceoverClips.push');
    expect(body, 'runShot 内不该 push audioWarnings').not.toContain('audioWarnings.push');
    expect(body, 'emit 也要缓冲,否则聊天记录顺序随机').not.toContain("ctx.emit('agentTalk'");
  });

  it('并发上限保守且可调、有夹取(TTS 有速率限制,开太大只会换来 429)', () => {
    expect(SRC).toContain('TTS_CONCURRENCY');
    const i = SRC.indexOf('const _ttsLimit');
    const block = SRC.slice(i, i + 220);
    expect(block, '默认 3').toContain(': 3');
    expect(block, '上限夹到 6').toContain('Math.min(6');
  });

  it('单镜异常在 worker 层再兜一层,一个镜炸掉不拖垮整批', () => {
    const i = SRC.indexOf('_slots[i] = await runShot');
    const block = SRC.slice(Math.max(0, i - 200), i + 400);
    expect(block).toContain('catch');
  });

  it('进度仍随完成数推进(不是跑完才跳一次)', () => {
    const i = SRC.indexOf('_done++');
    expect(i).toBeGreaterThan(0);
    expect(SRC.slice(i, i + 200)).toContain('ctx.update(AgentRole.EDITOR');
  });
});
