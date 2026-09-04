/**
 * v12.422 — 剧本要 30s,成片是 10s,而没有任何一行说时长被降过。
 *
 * ── 两个并排躺着的毛病 ────────────────────────────────────────────────
 * ① **plugin-chain 路径写死 `durationSec: 8`**,而同一函数里的 legacy 路径用的是
 *    `shot?.duration`。后果:注册表里做得了更长的引擎(LTX 20s / Vidu 16s /
 *    Seedance 15s / 自托管 15s)**从来没被要求过超过 8 秒**,整套 `maxDurationSec`
 *    过滤形同虚设。
 *
 *    这是 v12.409 那个 bug 的**同胞**:那次修了 legacy 路径里 Veo 的 `duration: 8`,
 *    漏了旁边这条一模一样的行 ——「改了主路径忘旁路」,又一次。
 *
 * ② **链为空时 `tried` 是空数组**。实测确认:两个 provider(上限 10s / 20s)时请求 30s,
 *    链空、result=null、tried=[]。上游把 `tried` 拼成原因,拼出来是空串,于是报
 *    「video plugin chain empty / all-failed: **no providers**」——
 *    这句话把人往错的方向引(像是没配 key 或引擎全挂),而真因是个静态可知的事实:
 *    没有任何引擎做得了这个时长。然后 `runWithPlugin` 静默 fallback,出一个短片。
 *
 * ── 这条测试锁什么 ────────────────────────────────────────────────────
 * 不锁「支持 30s」——那要等端点开放,不是代码能决定的。
 * 锁的是**诚实**:要多长就请求多长;给不了就说清楚给不了、以及最长能给多少。
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
  registerVideoProvider, clearVideoProviders, selectProviders,
  dispatchVideoGenerate, diagnoseEmptyChain,
} from '@/lib/video-providers/registry';
import fs from 'node:fs';

const mk = (id: string, cap: number, over: Record<string, unknown> = {}) => ({
  id, name: id, priority: 10,
  supportsImage2Video: true, supportsText2Video: true,
  supportsLastFrame: false, supportsSubjectReference: false,
  maxDurationSec: cap, available: () => true,
  generate: async () => ({ videoUrl: `https://x/${id}.mp4`, provider: id }),
  ...over,
}) as any;

beforeEach(() => clearVideoProviders());

describe('v12.422 · 时长诚实', () => {
  it('链为空时不再交出空 tried —— 空 tried 会被上游拼成「no providers」', async () => {
    registerVideoProvider(mk('a', 10));
    registerVideoProvider(mk('b', 20));
    const r = await dispatchVideoGenerate({ prompt: 'p', durationSec: 30 } as any);
    expect(r.result).toBeNull();
    expect(r.tried.length, '空 tried = 上游只能报「no providers」,把人往错方向引').toBeGreaterThan(0);
    expect(r.tried[0].error, '要说清是时长的问题').toContain('30');
  });

  it('诊断要分得清「时长不够」和「引擎都挂了」—— 这两者的处置完全不同', () => {
    registerVideoProvider(mk('a', 10));
    registerVideoProvider(mk('b', 20));
    const d = diagnoseEmptyChain({ hasFirstFrame: false, hasLastFrame: false, hasSubjectReference: false, durationSec: 30 } as any);
    expect(d.availableCount, '引擎是可用的').toBe(2);
    expect(d.wouldMatchIgnoringDuration, '去掉时长条件就能选出来 → 时长是唯一原因').toBeGreaterThan(0);
    expect(d.maxAvailableDurationSec).toBe(20);
    expect(d.reason).toContain('没有任何可用引擎支持这么长');
    expect(d.reason, '要给出最长能做多少,人才知道该把时长降到多少').toContain('20');
  });

  it('一个 provider 都没配时,说的是「没配」而不是「时长不够」', () => {
    registerVideoProvider(mk('a', 10, { available: () => false }));
    const d = diagnoseEmptyChain({ hasFirstFrame: false, hasLastFrame: false, hasSubjectReference: false, durationSec: 5 } as any);
    expect(d.availableCount).toBe(0);
    expect(d.reason).toContain('不可用');
    expect(d.reason).not.toContain('没有任何可用引擎支持这么长');
  });

  it('能力不匹配(要首尾帧但没人支持)也要说对原因', () => {
    registerVideoProvider(mk('a', 30));
    const d = diagnoseEmptyChain({ hasFirstFrame: true, hasLastFrame: true, hasSubjectReference: false, durationSec: 5 } as any);
    expect(d.reason).toContain('能力要求');
    expect(d.reason).not.toContain('没有任何可用引擎支持这么长');
  });

  it('时长够时行为完全不变(零回归)', async () => {
    registerVideoProvider(mk('a', 10));
    registerVideoProvider(mk('b', 20));
    expect(selectProviders({ hasFirstFrame: false, durationSec: 20 } as any).map((p) => p.id)).toEqual(['b']);
    const r = await dispatchVideoGenerate({ prompt: 'p', durationSec: 10 } as any);
    expect(r.result?.videoUrl).toBe('https://x/a.mp4');
  });

  it('**两条路径的时长来源必须一致** —— 这个错已经犯过两次', () => {
    const src = fs.readFileSync('services/hybrid-orchestrator.ts', 'utf-8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .split('\n').filter((l) => !l.trim().startsWith('//'))
      .map((l) => l.replace(/(?<!:)\/\/.*$/, '')).join('\n');

    // 窗口自证:确认读到的是含 plugin-chain 调用的那份
    expect(src, '找不到 withVideoPlugin 调用').toContain('withVideoPlugin(');

    // v12.409 修了 legacy 路径的 `duration: 8`,v12.422 修了 plugin 路径的 `durationSec: 8`。
    // 两处都不许再出现写死的 8 秒 —— 剧本写多长就该要多长。
    expect(src.includes('durationSec: 8'), 'plugin-chain 路径又写死 8 秒了').toBe(false);
    expect(/duration:\s*8\b/.test(src), 'legacy 路径又写死 8 秒了').toBe(false);

    // 且请求时长确实来自剧本
    expect(src).toContain('wantDurationSec');
    expect(src).toMatch(/wantDurationSec\s*=\s*Math\.max\(1,\s*Math\.round\(Number\(shot\?\.duration\)/);
  });

  it('剧本时长超出全链上限时,必须在日志里说出来 —— 不能静默出短片', () => {
    const src = fs.readFileSync('services/hybrid-orchestrator.ts', 'utf-8');
    const i = src.indexOf('wantDurationSec > 8');
    expect(i, '没有任何地方检查请求时长是否超上限').toBeGreaterThan(0);
    const block = src.slice(i, i + 1400);
    expect(block).toContain('diagnoseEmptyChain');
    // 要让人看见 —— 只写 console 不够,这个项目的教训是「通向不了人的告警等于没有」
    expect(block, '只记 console 不够,得让用户看见').toContain("emit('agentTalk'");
    // 诊断失败不该阻断出片
    expect(block).toContain('catch');
  });
});

// ─────────────────────────────────────────────────────────────────────────
// v12.422 第二部分:30s 原生单镜 —— 前提核实之后
//
// roadmap 上这一项写着「等国产端点开放 API,或自托管权重跑通」。所以第一步是
// **核实前提到底成没成立**,而不是假定成立就动手。六路并行调研 + 24 条独立二次
// 复核的结论:
//   · 条件 A(公开 API 有 ≥30s 原生单次)—— **成立**:
//     Seedance 2.5(2026-07-31)与 Wan 3.0(2026-08-24)都做到了,且都经复核确认
//     是「一次调用直出的连续片段」,不是 Scene Extension 那种拼接。
//   · 条件 B(开源权重能跑 30s)—— **不成立**:LTX-2.5 Fast 上限 20s、Wan 2.2 约 15s,
//     而 Wan 3.0 的权重**从未发布**(GitHub 仓库挂着 Apache-2.0,却只有一个 README)。
//
// 选 Wan 3.0 而不是质量更强的 Seedance 2.5,是因为 v12.415 明确写过「不接 Seedance
// 2.5:好莱坞六大停止函纠纷未和解」。本轮查到 2026-08 字节与 MPA 签了备忘录,
// 但**它明确不处理训练数据侵权责任** —— 风险降低而非消除。那是关于产品法律风险的
// 判断,不该由我单方面推翻一条写下来的决定。
// ─────────────────────────────────────────────────────────────────────────
describe('v12.422 · 30s 原生单镜', () => {
  it('虚报的时长上限已按**实际钉住的端点**修正', async () => {
    const src = fs.readFileSync('lib/video-providers/builtins.ts', 'utf-8');
    const capOf = (id: string) => {
      const i = src.indexOf(`id: '${id}',`);
      expect(i, `找不到 provider ${id}`).toBeGreaterThan(0);
      const j = src.indexOf('maxDurationSec:', i);
      return src.slice(j, src.indexOf('\n', j));
    };
    // Veo 3.1 单次枚举只有 4/6/8 —— 60s+ 是 Scene Extension 拼的,不是单次能力
    expect(capOf('veo'), 'Veo 单次上限严格是 8s,写 10 就是虚报').toContain('8');
    expect(capOf('veo')).not.toMatch(/:\s*10\b/);
    // 我们钉的 LTX 是 Pro 变体(枚举 6/8/10),20s 属于没钉的 /fast
    expect(capOf('ltx'), 'LTX Pro 变体上限 10s,写 20 是替一个没在调的端点说大话').toContain('10');
  });

  it('虚报为什么现在才要紧 —— 因为本版开始真按剧本要时长了', () => {
    // 以前所有请求都写死 8s,虚报的那几秒永远不会被行使;
    // 改成按剧本要时长之后,虚报就变成「选中一个做不到的引擎,然后交回一个短片」。
    const src = fs.readFileSync('services/hybrid-orchestrator.ts', 'utf-8');
    expect(src).toContain('wantDurationSec');
    expect(src).toMatch(/durationSec:\s*wantDurationSec/);
  });

  it('30s 路径接的是 Wan 3.0,且上限就是 30', () => {
    const src = fs.readFileSync('lib/video-providers/builtins.ts', 'utf-8');
    const i = src.indexOf("id: 'wan',");
    expect(i, '没注册 Wan provider').toBeGreaterThan(0);
    const block = src.slice(i, i + 1200);
    expect(block).toContain('maxDurationSec: 30');
    expect(block).toContain('WanService');
    // 最贵的引擎,不该排在常规引擎前面
    const pr = /priority:\s*(\d+)/.exec(block);
    expect(pr, '取不到优先级').not.toBeNull();
    expect(Number(pr![1]), '¥1.2/s 的引擎排到常规引擎前面会烧钱').toBeGreaterThan(60);
  });

  it('duration 夹在官方枚举区间内,-1(模型自定)原样放行', async () => {
    const { clampWanDuration, WAN_DURATION_MAX, WAN_DURATION_MIN } = await import('@/services/wan.service');
    expect(clampWanDuration(30)).toBe(30);
    expect(clampWanDuration(999)).toBe(WAN_DURATION_MAX);
    expect(clampWanDuration(0)).toBe(WAN_DURATION_MIN);
    expect(clampWanDuration(-1), '-1 是官方的「你替我定」,不该被夹成 2').toBe(-1);
  });

  it('model / resolution 乱填要回落,而不是把必然 400 的请求送出去', async () => {
    const { wanModel, wanResolution } = await import('@/services/wan.service');
    const prev = { m: process.env.WAN_MODEL, r: process.env.WAN_RESOLUTION };
    try {
      process.env.WAN_MODEL = 'wan3.0-video-prime';
      expect(wanModel()).toBe('wan3.0-video-prime');
      process.env.WAN_MODEL = 'wan-nonexistent';
      expect(wanModel()).toBe('wan3.0-video');
      process.env.WAN_RESOLUTION = '4K'; // 官方没有 4K 档
      expect(wanResolution()).toBe('720P');
    } finally {
      if (prev.m === undefined) delete process.env.WAN_MODEL; else process.env.WAN_MODEL = prev.m;
      if (prev.r === undefined) delete process.env.WAN_RESOLUTION; else process.env.WAN_RESOLUTION = prev.r;
    }
  });

  it('**费率不能被低估** —— 否则 v12.413 的预算闸拦不住它', async () => {
    const { videoRateForProvider, estimateVideoCostCny } = await import('@/lib/repos/cost-log-repo');
    const rate = videoRateForProvider('wan');
    expect(rate, 'wan 没进费率表 → 落到 ¥0.3 默认兜底,低估 4 倍').toBeGreaterThan(0.3);
    // 一条 30s 长镜的真实量级:几十元,不是几元
    expect(estimateVideoCostCny(30, rate)).toBeGreaterThan(30);
  });

  it('未配 key 时不可用 —— 整条链行为与此前完全一致(零回归)', async () => {
    const prev = process.env.WAN_API_KEY;
    try {
      delete process.env.WAN_API_KEY;
      const { hasWan } = await import('@/services/wan.service');
      expect(hasWan()).toBe(false);
      process.env.WAN_API_KEY = 'your_wan_key_here'; // 占位符不算配了
      expect(hasWan()).toBe(false);
    } finally {
      if (prev === undefined) delete process.env.WAN_API_KEY; else process.env.WAN_API_KEY = prev;
    }
  });

  it('异步头不能漏 —— 30s 视频等不完同步调用', () => {
    const src = fs.readFileSync('services/wan.service.ts', 'utf-8');
    expect(src).toContain("'X-DashScope-Async': 'enable'");
    // 用户可配的 base URL,必须走逐跳重验的 safeFetch
    expect(src).toContain('safeFetch(');
    const stripped = src.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
    expect(stripped.includes('await fetch('), '裸 fetch 默认 redirect:follow,可被 302 到内网').toBe(false);
  });
});
