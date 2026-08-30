/**
 * v12.328 — 逐帧检视:把「坏在哪一帧」找出来,并直接交给片段重拍。
 *
 * ── 先说没做什么(以及为什么)────────────────────────────────────
 * 竞品对标里写的是「逐帧拉片」。但本仓 **v11.1.1 就有拉片能力**
 * (`lib/pull-sheet-job`:场景切分 → 逐镜抽中帧 → 可选 Vision 打标 → 无 key 时
 * 诚实降级)。**再造一个「分析参考片」纯属重复**。
 * 真正缺的是另一头:v12.315 的片段重拍要用户给 `fromS`/`toS`,而界面上**没有任何
 * 东西让他看清坏在哪一帧** —— 只能凭记忆估个秒数。这一版补的是这条链。
 *
 * ── 全版最关键的一条不变量 ────────────────────────────────────────
 * **用户看到的那一帧,必须就是重拍会切的那一帧。**
 * 它有两个前提,任缺其一都会静默出错(错得看不出来,只体现为成片抖一下):
 *   ① **同一套帧吸附**:本模块从 `segment-retake` 导入 `snapToFrame`,不自己写
 *      `Math.round(sec*fps)/fps`。两份实现迟早在边界差一帧。
 *   ② **精确 seek**:抽帧的 `-ss` 必须放在 `-i` **之后**。既有
 *      `scene-split.extractFrameAt` 用的是 `seekInput()`(`-ss` 在 `-i` 前)——
 *      只能定位到关键帧,做拉片中帧够用,逐帧检视绝对不行。
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import { planFrameStrip, frameRangeToSeconds } from '@/lib/frame-strip';
import { planSegmentRetake, snapToFrame } from '@/lib/segment-retake';

const strip = (t: string) =>
  t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const SVC = strip(fs.readFileSync('services/frame-strip.service.ts', 'utf-8'));
const LIB = strip(fs.readFileSync('lib/frame-strip.ts', 'utf-8'));
const ROUTE = strip(fs.readFileSync('app/api/projects/[id]/frame-strip/route.ts', 'utf-8'));

describe('v12.328 · 时间戳规划', () => {
  it('窗口内逐帧,首尾都在', () => {
    const p = planFrameStrip({ shotDurationS: 8, fromS: 3, toS: 3.5, fps: 24 });
    expect(p.ok).toBe(true);
    expect(p.timestamps[0]).toBeCloseTo(3, 6);
    expect(p.timestamps[p.timestamps.length - 1]).toBeCloseTo(3.5, 6);
    expect(p.thinned, '半秒窗口不该被抽稀').toBe(false);
  });

  it('**超过上限时抽稀,但如实标注**(否则用户以为看的是每一帧)', () => {
    const p = planFrameStrip({ shotDurationS: 8, fps: 24, maxFrames: 40 });
    expect(p.thinned).toBe(true);
    expect(p.step).toBeGreaterThan(1);
    expect(p.frameIndexes.length).toBeLessThanOrEqual(41);   // 40 + 补回的末帧
  });

  it('抽稀时**末帧仍在列** —— 用户常要选到区间末尾', () => {
    const p = planFrameStrip({ shotDurationS: 8, fps: 24, maxFrames: 7 });
    const last = p.frameIndexes[p.frameIndexes.length - 1];
    expect(last).toBe(Math.round(8 * 24) - 1);
  });

  it('越界与空区间给人话,不是 NaN', () => {
    expect(planFrameStrip({ shotDurationS: 0 }).reason).toMatch(/先出一次片/);
    expect(planFrameStrip({ shotDurationS: 8, fromS: 5, toS: 5 }).reason).toMatch(/为空/);
    expect(planFrameStrip({ shotDurationS: 8, fromS: 5, toS: 4 }).reason).toMatch(/为空/);
    expect(planFrameStrip({ shotDurationS: 8, fromS: NaN }).ok).toBe(false);
  });

  it('to 超出成片时长会被夹到时长内(不给出不存在的帧)', () => {
    const p = planFrameStrip({ shotDurationS: 8, fromS: 7.5, toS: 99, fps: 24 });
    expect(p.ok).toBe(true);
    expect(Math.max(...p.timestamps)).toBeLessThan(8);
  });
});

describe('v12.328 · **看到的那一帧 = 重拍会切的那一帧**(核心不变量)', () => {
  it('帧区间换算含末帧(选中第 j 帧意味着包含它)', () => {
    const r = frameRangeToSeconds(72, 95, 24);
    expect(r.fromS).toBeCloseTo(3, 6);
    expect(r.toS).toBeCloseTo(4, 6);   // 96/24,不是 95/24
  });

  it('换算出的区间**直接喂给 planSegmentRetake 能过**,且切点分毫不差', () => {
    const fps = 24;
    const { fromS, toS } = frameRangeToSeconds(72, 95, fps);
    const plan = planSegmentRetake({ shotDurationS: 8, fromS, toS, fps });
    expect(plan.ok, plan.reason).toBe(true);
    expect(plan.patchFromS).toBeCloseTo(fromS, 6);
    expect(plan.patchToS).toBeCloseTo(toS, 6);
    expect(plan.totalAfterS, '重拍后总时长必须不变').toBeCloseTo(8, 6);
  });

  it('**复用同一个 snapToFrame**,不另写一份(两份实现迟早差一帧)', () => {
    expect(LIB).toMatch(/from '\.\/segment-retake'/);
    expect(LIB).toContain('snapToFrame');
    expect(LIB, '本模块不许自己算帧吸附').not.toMatch(/Math\.round\([^)]*fps\)\s*\/\s*fps/);
  });

  it('任意帧号换算后都落在帧栅格上(不会出现半帧切点)', () => {
    for (const fps of [24, 25, 30]) {
      for (const f of [0, 1, 47, 123]) {
        const { fromS, toS } = frameRangeToSeconds(f, f + 5, fps);
        expect(fromS).toBeCloseTo(snapToFrame(fromS, fps), 9);
        expect(toS).toBeCloseTo(snapToFrame(toS, fps), 9);
      }
    }
  });
});

describe('v12.328 · 抽帧精度(这条错了看不出来,只体现为成片抖一下)', () => {
  it('**`-ss` 放在 `-i` 之后 = 精确 seek**', () => {
    expect(SVC).toContain('setStartTime');
    expect(SVC, 'seekInput 是输入前 seek,只到关键帧').not.toContain('seekInput');
  });

  it('代码里写明了为什么不能用 seekInput', () => {
    const raw = fs.readFileSync('services/frame-strip.service.ts', 'utf-8');
    expect(raw).toMatch(/关键帧/);
    expect(raw).toMatch(/extractFrameAt|scene-split/);
  });

  it('执行层不做任何时间计算(时间戳全来自规划层)', () => {
    expect(SVC, '执行层不该自己算帧').not.toMatch(/\/\s*fps|fps\s*\*/);
  });

  it('**逐帧失败只丢那一帧**,不整批失败', () => {
    expect(SVC).toMatch(/failed\.push/);
    expect(SVC).toMatch(/failed: failed/);
  });

  it('并发下按下标落位,保证帧序与时间戳严格对应', () => {
    expect(SVC).toMatch(/out\[i\] = /);
    expect(SVC, '不能靠 push 的先后决定顺序').not.toMatch(/frames\.push\(/);
  });
});

describe('v12.328 · API', () => {
  it('**读取用 view 级**(不调引擎、不花钱;对照 segment-retake 的 POST 要 edit)', () => {
    const i = ROUTE.indexOf('export async function GET');
    expect(ROUTE.slice(i, i + 400)).toMatch(/requireProjectAccess\(request, id, 'view'\)/);
  });

  it('时长读 timeline 终值,与 segment-retake 同口径', () => {
    expect(ROUTE).toContain("listAssetsByType(projectId, 'timeline')");
    const i = ROUTE.indexOf('async function shotFinalDuration');
    expect(ROUTE.slice(i, i + 400), '不能退回 script 设计值').not.toContain("'script'");
  });

  it('没出过片给 409 + 人话,不是 500', () => {
    expect(ROUTE).toMatch(/409/);
    expect(ROUTE).toMatch(/先出一次片/);
  });

  it('规划不通过就直接返回,不去做无谓解码', () => {
    const iPlan = ROUTE.indexOf('planFrameStrip({');
    const iExtract = ROUTE.indexOf('extractFrames');
    expect(iPlan).toBeGreaterThan(0);
    expect(iExtract).toBeGreaterThan(iPlan);
    expect(ROUTE.slice(iPlan, iExtract)).toMatch(/if \(!plan\.ok\) return/);
  });

  it('响应里带 retakeHint —— 直接可交给片段重拍', () => {
    expect(ROUTE).toContain('retakeHint');
    expect(ROUTE).toContain('frameRangeToSeconds');
  });

  it('抽稀与失败帧都如实回报(不假装完整)', () => {
    expect(ROUTE).toContain('thinned');
    expect(ROUTE).toContain('failedFrames');
  });
});

describe('v12.328 · 本地读盘必须走验签入口(消费方门禁当场拦下过)', () => {
  it('**不得直接读 ?path=** —— 「签了前门,漏了侧门」是 v12.237 的原话', () => {
    expect(ROUTE, '直接取 ?path= 读盘 = 任意文件读取面')
      .not.toMatch(/searchParams\.get\(['"]path['"]\)/);
    expect(ROUTE).toContain('resolveVerifiedServeFilePath');
  });

  it('key 形态仍可解析(persistAsset 洗过的 URL 只带 key)', () => {
    expect(ROUTE).toContain('resolveByKey');
  });

  it('解析不出就返回 null,不退化成「当作裸路径」', () => {
    const i = ROUTE.indexOf('async function shotVideoPath');
    const _end = ROUTE.indexOf('export async function GET');
    expect(i, '找不到 shotVideoPath').toBeGreaterThan(0);
    expect(_end, '窗口右界在左界之前').toBeGreaterThan(i);
    const block = ROUTE.slice(i, _end);
    expect(block, '窗口自证').toContain('shotVideoPath');
    expect(block, '兜底不能把任意字符串当路径用').not.toMatch(/return url/);
  });

  it('记下了为什么不能照抄 video-composer 的写法', () => {
    const raw = fs.readFileSync('app/api/projects/[id]/frame-strip/route.ts', 'utf-8');
    expect(raw).toMatch(/验签入口/);
    expect(raw).toMatch(/侧门|任意文件/);
  });
});
