/**
 * v12.455 —— 节奏审计的真拦截。
 *
 * 起因:README 第 253 行和 docs/COMPETITIVE-GAP-2026-09.md 第 4 节写「节奏审计是可拦截的
 * 独立工程门禁」,代码里却是「非阻塞」(services/agents/writer-agent.ts 注释原话)。
 * 竞品台账以「可证伪」为卖点,自己先和代码打架。这一版把拦截补成真的。
 *
 * 这里的断言都落在「下游到底有没有跑」上,而不是「有没有发出一条提示」——
 * 只断言发了 error、不断言角色设计没被调用,正是会放过假门禁的那种测试。
 * 每个拦下的用例都配一个反面(同样的剧本在 warn / 放行 / 通过时确实继续往下走),
 * 否则「永远停」的实现也能让拦截用例全绿。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const h = vi.hoisted(() => ({
  calls: [] as string[],
  script: null as any,
  gate: null as any,
  cpScript: null as any,
  plan: { title: '测试', genre: '都市', characters: [], scenes: [], storyStructure: { totalShots: 3 } } as any,
}));

// 假编排器:set* 一律空操作;编剧之前的步骤给固定返回;编剧之后的任何 run* 都记账并抛错
// (抛错只是为了让流水线尽快收尾 —— 断言看的是「有没有被调用」)。
vi.mock('@/services/hybrid-orchestrator', () => {
  class HybridOrchestrator {
    onProgress: unknown = null;
    constructor() {
      return new Proxy(this, {
        get(t, prop) {
          if (prop in t) return (t as any)[prop];
          if (typeof prop !== 'string') return undefined;
          if (prop === 'then') return undefined;
          if (prop.startsWith('set')) return () => {};
          if (prop === 'getAllAgents') return () => [];
          if (prop === 'runDirector') return async () => h.plan;
          if (prop === 'runStyleBibleArtist') return async () => null;
          if (prop === 'runWriter') return async () => { h.calls.push('runWriter'); return JSON.parse(JSON.stringify(h.script)); };
          if (prop === 'waitForGate') return async () => h.gate ?? { action: 'continue' };
          return async () => { h.calls.push(prop); throw new Error('STOP_AFTER_GATE'); };
        },
        set(t, prop, v) { (t as any)[prop] = v; return true; },
      });
    }
  }
  return { HybridOrchestrator };
});

vi.mock('@/lib/pipeline-checkpoints', async (orig) => {
  const m = await orig<typeof import('@/lib/pipeline-checkpoints')>();
  return { ...m, loadCheckpoints: async () => ({ ...m.emptyCheckpoints(), plan: h.plan, script: h.cpScript }) };
});

import {
  resolvePacingGateMode, decidePacingGate, isChineseScriptText, pacingGateBlockMessage, gateScriptForProduction,
} from '@/lib/pacing-gate';
import { runCreatePipeline } from '@/lib/create-pipeline';
import { listAssetsByType } from '@/lib/repos/asset-repo';
import { getProject } from '@/lib/repos/project-repo';

// ── 夹具 ────────────────────────────────────────────────────────────────
/** 冲突强、两次情绪反转、首镜有钩子:普通口径和短剧口径都通过 */
const STRONG = {
  title: '背叛', synopsis: 's',
  shots: [
    { shotNumber: 1, action: '她突然撕碎合同,冷笑着质问对方', dialogue: '你竟然背叛我?', emotion: '愤怒' },
    { shotNumber: 2, action: '他当众揭穿阴谋,众人震惊', dialogue: '原来一切都是你安排的', emotion: '胜利的喜悦 激动' },
    { shotNumber: 3, action: '她猛地冲出门外追赶', dialogue: '站住!', emotion: '绝望 愤怒' },
  ],
};
/** 没有事件、没有情绪变化:任何口径都不通过 */
const WEAK = {
  title: '散步', synopsis: 's',
  shots: [
    { shotNumber: 1, action: '他走在街上', dialogue: '', emotion: '平静' },
    { shotNumber: 2, action: '他看了看天空', dialogue: '', emotion: '平静' },
    { shotNumber: 3, action: '他回到家里坐下', dialogue: '', emotion: '平静' },
  ],
};
const WEAK_EN = {
  title: 'Walk', synopsis: 's',
  shots: [
    { shotNumber: 1, action: 'He walks down the street', dialogue: 'Hello there', emotion: 'calm' },
    { shotNumber: 2, action: 'He looks at the sky', dialogue: '', emotion: 'calm' },
  ],
};
const WEAK_JA = {
  title: '散歩', synopsis: 's',
  shots: [{ shotNumber: 1, action: '彼はゆっくりと道を歩いている', dialogue: 'いい天気ですね', emotion: 'おだやか' }],
};

// ── 1. 纯函数 ───────────────────────────────────────────────────────────
describe('v12.455 · 档位:运维配置是下限,请求只能收紧', () => {
  it('没配 / 配错 → warn(保持 v2.21 起的原行为)', () => {
    expect(resolvePacingGateMode(undefined, {})).toBe('warn');
    expect(resolvePacingGateMode(undefined, { PACING_GATE: 'blok' })).toBe('warn');
    expect(resolvePacingGateMode(undefined, { PACING_GATE: ' BLOCK ' })).toBe('block');
  });
  it('请求可以从 warn 收紧到 block', () => {
    expect(resolvePacingGateMode('block', { PACING_GATE: 'warn' })).toBe('block');
    expect(resolvePacingGateMode('block', {})).toBe('block');
  });
  it('请求不能把运维设的 block 放松成 off / warn(否则带个字段就绕过门禁)', () => {
    expect(resolvePacingGateMode('off', { PACING_GATE: 'block' })).toBe('block');
    expect(resolvePacingGateMode('warn', { PACING_GATE: 'block' })).toBe('block');
  });
  it('请求字段写错 → 忽略,按运维配置', () => {
    expect(resolvePacingGateMode('nonsense', { PACING_GATE: 'off' })).toBe('off');
    expect(resolvePacingGateMode(42, { PACING_GATE: 'block' })).toBe('block');
  });
});

describe('v12.455 · 判定', () => {
  it('不达标:warn 档只提示,block 档拦,block + 显式放行记为 override', () => {
    const warn = decidePacingGate({ script: WEAK, mode: 'warn', dramaMode: false });
    expect(warn.verdict).toBe('warn');
    expect(warn.reasons.length).toBeGreaterThan(0);
    expect(decidePacingGate({ script: WEAK, mode: 'block', dramaMode: false }).verdict).toBe('block');
    expect(decidePacingGate({ script: WEAK, mode: 'block', dramaMode: false, override: true }).verdict).toBe('override');
  });
  it('达标:block 档也放行(否则「永远拦」的实现也能让拦截用例全绿)', () => {
    const d = decidePacingGate({ script: STRONG, mode: 'block', dramaMode: true });
    expect(d.verdict).toBe('pass');
    expect(d.report?.passed).toBe(true);
  });
  it('off 档不审;拉片复刻不审', () => {
    expect(decidePacingGate({ script: WEAK, mode: 'off', dramaMode: false })).toMatchObject({ verdict: 'skip', report: null });
    const r = decidePacingGate({ script: WEAK, mode: 'block', dramaMode: false, replica: true });
    expect(r.verdict).toBe('skip');
    expect(r.reasons[0]).toContain('拉片复刻');
  });
  it('非中文剧本不审:冲突词典只有中文,否则 block 档会把英文/日文剧本全部误拦', () => {
    expect(isChineseScriptText(WEAK_EN)).toBe(false);
    expect(isChineseScriptText(WEAK_JA)).toBe(false);
    expect(isChineseScriptText(WEAK)).toBe(true);
    const en = decidePacingGate({ script: WEAK_EN, mode: 'block', dramaMode: false });
    expect(en.verdict).toBe('skip');
    expect(en.reasons[0]).toContain('只覆盖中文');
    expect(decidePacingGate({ script: WEAK_JA, mode: 'block', dramaMode: false }).verdict).toBe('skip');
  });
  it('中文剧本里英文人名很多,仍按中文审(拉丁文按词数算,不按字母数 —— 对抗复查挖出的绕过)', () => {
    const names = { shots: Array.from({ length: 6 }, (_, i) => ({
      shotNumber: i + 1, action: `Alexander Thompson 走向 Jennifer Lee`, dialogue: '走吧', emotion: '平静',
    })) };
    // 按字母数:每镜 32 个字母 vs 6 个汉字,旧判据(汉字×4 ≥ 字母)会判成「非中文」而跳过门禁
    expect(isChineseScriptText(names)).toBe(true);
    expect(decidePacingGate({ script: names, mode: 'block', dramaMode: false }).verdict).toBe('block');
  });
  it('短英文缩写 / 分镜术语多的中文剧本仍按中文审(复查挖出:按词 1:1 计会把 AI、CU 这类都算成整字)', () => {
    const tech = { shots: [
      { shotNumber: 1, action: 'CU: 林晓盯着 AI 屏幕', dialogue: 'VR 系统崩了', emotion: 'SFX 平静' },
      { shotNumber: 2, action: 'INT. 机房 - DAY. POV 镜头推近', dialogue: 'OK', emotion: 'MCU 平静' },
    ] };
    expect(isChineseScriptText(tech)).toBe(true); // 常见写法:汉字 20、英文词 9
    // 区分度用例:汉字 10、英文词 11(全是短缩写)。按词 1:1 计(10 ≥ 11 假)会误判成非中文而跳过门禁;
    // 折半计(20 ≥ 11)按中文审 —— 这条就是为抓住「1:1 计」那个回归写的
    const abbrevHeavy = { shots: [{ shotNumber: 1, action: 'AI VR UI UX HR IP PR QA CEO CTO 新品发布会开场了', dialogue: 'OK', emotion: '平静' }] };
    expect(isChineseScriptText(abbrevHeavy)).toBe(true);
    expect(decidePacingGate({ script: abbrevHeavy, mode: 'block', dramaMode: false }).verdict).toBe('block');
  });
  it('反面 · 动作行本身是英文、只夹几个汉字的剧本,仍按非中文跳过', () => {
    const en = { shots: [{ shotNumber: 1, action: 'He meets 李明 at the park and they talk', dialogue: 'Nice to meet you', emotion: 'calm' }] };
    expect(isChineseScriptText(en)).toBe(false);
  });
  it('中文剧本里夹少量英文品牌名,仍按中文审', () => {
    const mixed = { shots: [{ action: '他在 iPhone 发布会上走来走去', dialogue: '', emotion: '平静' }] };
    expect(isChineseScriptText(mixed)).toBe(true);
    expect(decidePacingGate({ script: mixed, mode: 'block', dramaMode: false }).verdict).toBe('block');
  });
  it('审计跑不出结果:block 档按拦下算(fail-closed),warn 档只提示', () => {
    const b = decidePacingGate({ script: { title: 'x' }, mode: 'block', dramaMode: false });
    expect(b.verdict).toBe('block');
    expect(b.report).toBeNull();
    expect(b.reasons[0]).toContain('没能跑出结果');
    expect(decidePacingGate({ script: null, mode: 'warn', dramaMode: false }).verdict).toBe('warn');
  });
  it('空剧本(有分镜但没文字)在 block 档被拦,不会被当成「没法判断」放过去', () => {
    const empty = { shots: [{ shotNumber: 1, action: '', dialogue: '', emotion: '' }] };
    expect(decidePacingGate({ script: empty, mode: 'block', dramaMode: false }).verdict).toBe('block');
  });
  it('短剧口径更严:同一剧本普通口径能过的,短剧口径可能不过', () => {
    const mild = { shots: [
      { shotNumber: 1, action: '她走进房间', dialogue: '你来了', emotion: '欢喜' }, // 「开心」不在极性词典里
      { shotNumber: 2, action: '他突然摔门离开', dialogue: '我受够了', emotion: '愤怒' },
    ] };
    expect(decidePacingGate({ script: mild, mode: 'block', dramaMode: false }).verdict).toBe('pass');
    expect(decidePacingGate({ script: mild, mode: 'block', dramaMode: true }).verdict).toBe('block');
  });
  it('口径沿用编剧阶段那份报告的 dramaMode(与界面上显示的审计一致),而不是重新按题材猜', () => {
    const mild = { shots: [
      { shotNumber: 1, action: '她走进房间', dialogue: '你来了', emotion: '欢喜' },
      { shotNumber: 2, action: '他突然摔门离开', dialogue: '我受够了', emotion: '愤怒' },
    ] };
    const env = { PACING_GATE: 'block' };
    // 编剧报告标短剧口径 → 按严格口径拦,哪怕题材/创意看不出是短剧
    expect(gateScriptForProduction({ ...mild, pacingReport: { dramaMode: true } }, { genre: '科普', idea: '介绍太阳系', env }).verdict).toBe('block');
    // 反面:编剧报告标普通口径 → 按普通口径放行,哪怕题材像短剧
    expect(gateScriptForProduction({ ...mild, pacingReport: { dramaMode: false } }, { genre: '短剧', idea: '霸总逆袭短剧', env }).verdict).toBe('pass');
  });
  it('拦截提示说清停在哪、为什么、怎么继续;原因多于 3 条时给总数', () => {
    const msg = pacingGateBlockMessage({ reasons: ['a', 'b', 'c', 'd'] });
    expect(msg).toContain('角色设计之前');
    expect(msg).toContain('a;b;c');
    expect(msg).not.toContain('d;');
    expect(msg).toContain('共 4 条');
    expect(msg).toContain('pacingOverride');
  });
});

// ── 2. 真跑流水线:断言「下游有没有被调用」 ─────────────────────────────────
const DOWNSTREAM = ['runCharacterDesigner', 'runSceneDesigner', 'runStoryboardArtist'];

async function run(opts: { script: any; env?: string; input?: Record<string, unknown>; resume?: boolean; gate?: any; cpScript?: any }) {
  h.calls.length = 0;
  h.script = opts.script;
  h.gate = opts.gate ?? null;
  h.cpScript = opts.cpScript ?? null;
  if (opts.env === undefined) delete process.env.PACING_GATE; else process.env.PACING_GATE = opts.env;
  const events: Array<{ type: string; data: any }> = [];
  const projectId = `pg455-${Math.random().toString(36).slice(2, 10)}`;
  await runCreatePipeline(
    { idea: '一个关于背叛与复仇的都市短剧,女主当众揭穿未婚夫的阴谋', projectId, ...(opts.input ?? {}) } as any,
    (type, data) => { events.push({ type, data }); },
    opts.resume ? { resume: true } : undefined,
  );
  const errors = events.filter((e) => e.type === 'error').map((e) => e.data);
  const gateEv = events.find((e) => e.type === 'pacingGate')?.data;
  const statuses = events.filter((e) => e.type === 'status').map((e) => String(e.data?.message ?? ''));
  return { projectId, events, errors, gateEv, statuses, downstream: h.calls.filter((c) => DOWNSTREAM.includes(c)) };
}

// 这两组要加载真实的流水线 / 编排器模块,机器负载高时单条可超过默认 10s(实测负载 260 时超时)
describe('v12.455 · 流水线:block 档不达标就真的停', { timeout: 60_000 }, () => {
  const saved = process.env.PACING_GATE;
  beforeEach(() => { delete process.env.PACING_GATE; });
  afterEach(() => { if (saved === undefined) delete process.env.PACING_GATE; else process.env.PACING_GATE = saved; });

  it('拦下:角色/场景/分镜一个都没调用,发终态 error,项目标 failed,剧本连同结论落库', async () => {
    const r = await run({ script: WEAK, env: 'block' });
    expect(r.downstream).toEqual([]);
    const blocked = r.errors.find((e) => e.code === 'PACING_GATE_BLOCKED');
    expect(blocked).toBeTruthy();
    expect(blocked.terminal).toBe(true);
    expect(blocked.retryable).toBe(false);
    expect(blocked.message).toContain('角色设计之前');
    expect(r.gateEv).toMatchObject({ mode: 'block', verdict: 'block', passed: false });
    expect((await getProject(r.projectId))?.status).toBe('failed');
    const rows = await listAssetsByType(r.projectId, 'script');
    expect(rows.length).toBe(1); // 幂等写,没有重复行
    const data = JSON.parse(String(rows[0].data));
    expect(data.pacingGate).toMatchObject({ mode: 'block', verdict: 'block' });
    expect(data.pacingReport?.passed).toBe(false);
    expect(data.shots?.length).toBe(3);
  });

  it('反面 · 同样的弱剧本在默认 warn 档照常往下走(原行为不变)', async () => {
    const r = await run({ script: WEAK });
    expect(r.downstream).toContain('runCharacterDesigner');
    expect(r.errors.find((e) => e.code === 'PACING_GATE_BLOCKED')).toBeUndefined();
    expect(r.gateEv).toMatchObject({ mode: 'warn', verdict: 'warn' });
  });

  it('反面 · block 档下达标的剧本照常往下走', async () => {
    const r = await run({ script: STRONG, env: 'block' });
    expect(r.downstream).toContain('runCharacterDesigner');
    expect(r.errors.find((e) => e.code === 'PACING_GATE_BLOCKED')).toBeUndefined();
    expect(r.gateEv).toMatchObject({ verdict: 'pass' });
  });

  it('请求里带 pacingGate:"off" 放松不了运维设的 block', async () => {
    const r = await run({ script: WEAK, env: 'block', input: { pacingGate: 'off' } });
    expect(r.downstream).toEqual([]);
    expect(r.errors.some((e) => e.code === 'PACING_GATE_BLOCKED')).toBe(true);
  });

  it('请求可以单次收紧:服务端 warn,请求 block → 拦', async () => {
    const r = await run({ script: WEAK, input: { pacingGate: 'block' } });
    expect(r.downstream).toEqual([]);
  });

  it('显式放行:继续往下走,并且留痕(状态提示 + 剧本资产记为 override)', async () => {
    const r = await run({ script: WEAK, env: 'block', input: { pacingOverride: true } });
    expect(r.downstream).toContain('runCharacterDesigner');
    expect(r.statuses.some((s) => s.includes('已按你的确认'))).toBe(true);
    const data = JSON.parse(String((await listAssetsByType(r.projectId, 'script'))[0].data));
    expect(data.pacingGate?.verdict).toBe('override');
  });

  it('pacingOverride 必须是字面 true(字符串 "true" 不算放行)', async () => {
    const r = await run({ script: WEAK, env: 'block', input: { pacingOverride: 'true' } });
    expect(r.downstream).toEqual([]);
  });

  it('续跑装载的是同一份不达标剧本 → 照样拦(续跑不是绕过门禁的后门)', async () => {
    const r = await run({ script: STRONG, cpScript: WEAK, env: 'block', resume: true });
    expect(h.calls).not.toContain('runWriter'); // 确实走的是续跑装载的剧本
    expect(r.downstream).toEqual([]);
    expect(r.errors.some((e) => e.code === 'PACING_GATE_BLOCKED')).toBe(true);
  });

  it('人工闸门里改成达标剧本 → 按改后的剧本审,放行(不拿编剧那份旧报告拦人)', async () => {
    const r = await run({
      script: WEAK, env: 'block', input: { enableGates: true },
      gate: { action: 'edit', editedData: JSON.parse(JSON.stringify(STRONG)) },
    });
    expect(r.downstream).toContain('runCharacterDesigner');
    expect(r.gateEv).toMatchObject({ verdict: 'pass' });
  });

  it('人工闸门「超时自动放行」不会让不达标剧本溜过去(节奏门禁不复用 waitForGate)', async () => {
    const r = await run({ script: WEAK, env: 'block', input: { enableGates: true }, gate: { action: 'continue' } });
    expect(r.downstream).toEqual([]);
  });

  it('非中文剧本在 block 档不误拦,并明说这次门禁没生效', async () => {
    const r = await run({ script: WEAK_EN, env: 'block' });
    expect(r.downstream).toContain('runCharacterDesigner');
    expect(r.statuses.some((s) => s.includes('节奏门禁这次没有生效'))).toBe(true);
    expect(r.gateEv).toMatchObject({ verdict: 'skip' });
  });

  it('拉片复刻在 block 档不拦(剧本结构来自原片)', async () => {
    const r = await run({ script: WEAK, env: 'block', input: { replicaScript: JSON.parse(JSON.stringify(WEAK)) } });
    expect(h.calls).not.toContain('runWriter');
    expect(r.downstream).toContain('runCharacterDesigner');
  });
});

// ── 3. 第二条创作入口:HybridOrchestrator.startProduction ─────────────────────
describe('v12.455 · startProduction 也守同一道门', { timeout: 60_000 }, () => {
  const saved = process.env.PACING_GATE;
  afterEach(() => { if (saved === undefined) delete process.env.PACING_GATE; else process.env.PACING_GATE = saved; });

  async function makeOrchestrator(script: any) {
    const { HybridOrchestrator } = await vi.importActual<typeof import('@/services/hybrid-orchestrator')>('@/services/hybrid-orchestrator');
    const o = new HybridOrchestrator() as any;
    const called: string[] = [];
    // 实例级桩(不改原型):编剧之前给固定返回,之后的每一步都只记账
    o.runDirector = async () => h.plan;
    o.runStyleBibleArtist = async () => null;
    o.runWriter = async () => JSON.parse(JSON.stringify(script));
    for (const m of ['runCharacterDesigner', 'runSceneDesigner', 'runStoryboardArtist', 'runStoryboardRenderer', 'runVideoProducer', 'runEditor']) {
      o[m] = async () => { called.push(m); return []; };
    }
    o.runDirectorReview = async () => { called.push('runDirectorReview'); return { passed: true }; };
    return { o, called };
  }

  it('block 档不达标:抛 PACING_GATE_BLOCKED,出图/视频一步都不走', async () => {
    process.env.PACING_GATE = 'block';
    const { o, called } = await makeOrchestrator(WEAK);
    await expect(o.startProduction('一个关于背叛的都市短剧', 'minimax')).rejects.toMatchObject({ code: 'PACING_GATE_BLOCKED' });
    expect(called).toEqual([]);
  });

  it('反面 · 默认档同一剧本照常走完', async () => {
    delete process.env.PACING_GATE;
    const { o, called } = await makeOrchestrator(WEAK);
    await o.startProduction('一个关于背叛的都市短剧', 'minimax');
    expect(called).toContain('runCharacterDesigner');
    expect(called).toContain('runVideoProducer');
  });
});
