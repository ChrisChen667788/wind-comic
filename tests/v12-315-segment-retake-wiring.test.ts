/**
 * v12.315 — 片段重拍接上执行层、take 历史与 API(v12.314 只落了纯逻辑计划)。
 *
 * ── 分层的理由 ────────────────────────────────────────────────────
 * 所有边界判断(引擎下限、帧对齐、总时长不变)留在 v12.314 的纯函数里可测;
 * 执行层**不做任何时长算术**,只照计划切与缝。一旦执行层也开始算,
 * 就又是「同一语义两套口径」—— 这个仓已经在转场/音色/称谓词表/相对时间/
 * fetchWithTimeout 上栽过五次,不能再添一笔。测试直接锁这条分工。
 *
 * ── 缝合为什么用 concat demuxer 而不是 filter concat ──────────────
 * `-c copy` 让**保留段是原片的字节拷贝**:用户只改了 2 秒,另外 6 秒不该跟着劣化一代。
 * 代价是三段编码参数必须一致,所以补丁段先按原片参数归一(normalizePatch)。
 * 用 filter concat 会把整镜重编码 —— 那正是这个功能要省掉的浪费。
 *
 * ── v12.314 的不变量换来的好处 ────────────────────────────────────
 * 缝合后该镜时长一字不变,于是压缩时间轴、配音 adelay、字幕起点、EDL record-in
 * **全都不用重算**(那是 v12.264/265/297 花三版对齐出来的)。
 * 下游只需作废两样:成片、以及**该镜**的口型对齐分 ——
 * 画面换了,「口型对得上」的结论就不可信,而 publish-readiness 拿它做发布门禁,
 * 不摘掉会**错误放行**(与 v12.306 丢分误放行同一类风险)。
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import { planSegmentRetake } from '@/lib/segment-retake';

const strip = (t: string) =>
  t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const SVC = strip(fs.readFileSync('services/segment-retake.service.ts', 'utf-8'));
const TAKE = strip(fs.readFileSync('lib/shot-segment-retake.ts', 'utf-8'));
const ROUTE = strip(fs.readFileSync('app/api/projects/[id]/segment-retake/route.ts', 'utf-8'));
const VOICE = strip(fs.readFileSync('lib/voice-retake.ts', 'utf-8'));

describe('v12.315 · 执行层不做时长算术(分工边界)', () => {
  it('切点全部取自 plan,执行层不自己算', () => {
    expect(SVC).toContain('plan.head.fromS');
    expect(SVC).toContain('plan.trimFromS');
    // 不得出现「自己推导补丁长度」的算式
    expect(SVC, '执行层不该再算 generateDuration').not.toMatch(/generateDurationS\s*=/);
    expect(SVC, '执行层不该再做帧吸附').not.toMatch(/Math\.round\([^)]*fps\)\s*\/\s*fps/);
  });

  it('计划不通过时直接抛,不硬着头皮切', () => {
    const i = SVC.indexOf('export async function executeSegmentRetake');
    const block = SVC.slice(i, i + 500);
    expect(block).toMatch(/if \(!plan\?\.ok\) throw/);
    expect(block, '要把人话原因带出去').toContain('plan?.reason');
  });

  it('缝合走 concat demuxer + -c copy(保留段零损失)', () => {
    expect(SVC).toContain("'-f', 'concat'");
    expect(SVC).toMatch(/'-c',\s*'copy'/);
  });

  it('补丁段先按原片参数归一,否则 concat 拼不了', () => {
    expect(SVC).toContain('normalizePatch');
    const i = SVC.indexOf('async function normalizePatch');
    const block = SVC.slice(i, i + 1600);
    expect(block, '要对齐分辨率').toMatch(/scale=/);
    expect(block, '要对齐帧率').toMatch(/fps=/);
    expect(block, '要对齐音频').toMatch(/-ar|aac/);
  });

  it('切片用精确定位(setStartTime 在 input 之后)', () => {
    const i = SVC.indexOf('async function cutSegment');
    const block = SVC.slice(i, i + 500);
    expect(block).toContain('setStartTime');
    expect(block).toContain('setDuration');
  });

  it('失败时清掉自建临时目录,但不动调用方传进来的(v12.313 的教训)', () => {
    expect(SVC).toContain('const ownsTmp = !input.outputDir');
    const i = SVC.indexOf('const cleanup');
    expect(SVC.slice(i, i + 220)).toContain('if (!ownsTmp) return');
  });
});

describe('v12.315 · take 历史与 voice-retake 同构', () => {
  it('沿用 TAKE/ACTIVE 两类型的结构,不另起一套', () => {
    expect(TAKE).toContain('SEG_TAKE_TYPE');
    expect(TAKE).toContain('SEG_ACTIVE_TYPE');
    expect(VOICE, '对照:老的那套还在').toContain('TAKE_TYPE');
  });

  it('建 take 不动活动版(采用前用户能反悔)', () => {
    const i = TAKE.indexOf('export async function recordSegmentTake');
    const block = TAKE.slice(i, TAKE.indexOf('export async function listSegmentTakes'));
    expect(block).toContain('createAsset');
    expect(block, '建 take 阶段不该改活动版').not.toContain('updateAssetBySelector');
  });

  it('列表标出已采用的那条,且新→旧', () => {
    const i = TAKE.indexOf('export async function listSegmentTakes');
    const block = TAKE.slice(i, TAKE.indexOf('export async function adoptSegmentTake'));
    expect(block).toContain('adoptedSegmentTakeId');
    expect(block).toMatch(/sort\(/);
  });

  it('**采用后作废该镜口型分** —— 否则发布门禁会错误放行', () => {
    const i = TAKE.indexOf('export async function adoptSegmentTake');
    const block = TAKE.slice(i);
    expect(block).toContain('lipsync-align');
    expect(block, '要按镜号精准摘,不是整表清空').toContain('delete scores[String(shotNumber)]');
  });

  it('成片作废,但**不**触发时间轴重算(时长没变)', () => {
    const i = TAKE.indexOf('export async function adoptSegmentTake');
    const block = TAKE.slice(i);
    expect(block).toContain("'final_video'");
    expect(block, '时长不变 → 不该去动 timeline').not.toContain("listAssetsByType(projectId, 'timeline')");
  });

  it('只动该镜,不波及其它镜', () => {
    const i = TAKE.indexOf('export async function adoptSegmentTake');
    const block = TAKE.slice(i);
    expect(block).toMatch(/setAssetsStaleByShots\(projectId, \[[^\]]*\], \[shotNumber\]/);
  });

  it('活动版不存在时明确报错,不静默建一条', () => {
    const i = TAKE.indexOf('export async function adoptSegmentTake');
    const block = TAKE.slice(i, i + 1200);
    expect(block).toMatch(/changed === 0/);
    expect(block).toMatch(/无法采用/);
  });
});

describe('v12.315 · API 路由', () => {
  it('**写操作要 editor 级**(会花钱,不能像 regenerate-shot 那样裸奔)', () => {
    const i = ROUTE.indexOf('export async function POST');
    const block = ROUTE.slice(i, i + 500);
    expect(block).toMatch(/requireProjectAccess\(request, id, 'edit'\)/);
  });

  it('读历史用 view 级', () => {
    const i = ROUTE.indexOf('export async function GET');
    const block = ROUTE.slice(i, i + 400);
    expect(block).toMatch(/requireProjectAccess\(request, id, 'view'\)/);
  });

  it('**时长读 timeline 终值,不读 script 设计值**(v12.298 的口径)', () => {
    const i = ROUTE.indexOf('async function shotFinalDuration');
    const block = ROUTE.slice(i, i + 500);
    expect(block).toContain("listAssetsByType(projectId, 'timeline')");
    expect(block, '不能退回 script').not.toContain("'script'");
  });

  it('计划不通过时**先拒再说**,不去花钱调引擎', () => {
    const iPlan = ROUTE.indexOf('planSegmentRetake({');
    const iPatch = ROUTE.indexOf('patchUrl');
    expect(iPlan).toBeGreaterThan(0);
    expect(iPatch, '取补丁必须在算计划之后').toBeGreaterThan(iPlan);
    expect(ROUTE.slice(iPlan, iPatch)).toMatch(/if \(!plan\.ok\) return/);
  });

  it('支持 dryRun:框选时实时预演,不产生费用', () => {
    expect(ROUTE).toContain('dryRun');
    const i = ROUTE.indexOf('body?.dryRun');
    expect(ROUTE.slice(i, i + 160)).toContain('plan');
  });

  it('没出过片的镜给人话提示,不是 500', () => {
    const i = ROUTE.indexOf('shotDurationS');
    const block = ROUTE.slice(i, i + 500);
    expect(block).toMatch(/409/);
    expect(block).toMatch(/先出一次片/);
  });
});

describe('v12.315 · 端到端:计划与执行的契约对得上', () => {
  it('计划给出的三段拼起来 === 原时长(执行层照抄即可)', () => {
    const p = planSegmentRetake({ shotDurationS: 8, fromS: 3, toS: 5, fps: 24 });
    expect(p.ok).toBe(true);
    const head = p.head ? p.head.toS - p.head.fromS : 0;
    const patch = p.patchToS - p.patchFromS;
    const tail = p.tail ? p.tail.toS - p.tail.fromS : 0;
    expect(head + patch + tail).toBeCloseTo(8, 6);
    expect(p.totalAfterS).toBeCloseTo(8, 6);
  });

  it('引擎下限导致多生成时,裁出来的仍恰好等于缺口', () => {
    const p = planSegmentRetake({ shotDurationS: 8, fromS: 3, toS: 5, fps: 24, engineMinDurationS: 3 });
    expect(p.generateDurationS).toBeGreaterThanOrEqual(3);
    expect(p.trimToS - p.trimFromS).toBeCloseTo(p.patchToS - p.patchFromS, 6);
    expect(p.padSeconds).toBeCloseTo(p.generateDurationS - (p.patchToS - p.patchFromS), 6);
  });

  it('从头重拍时没有 head,拍到尾时没有 tail', () => {
    const a = planSegmentRetake({ shotDurationS: 8, fromS: 0, toS: 3, fps: 24 });
    expect(a.head).toBeNull();
    const b = planSegmentRetake({ shotDurationS: 8, fromS: 5, toS: 8, fps: 24 });
    expect(b.tail).toBeNull();
  });
});
