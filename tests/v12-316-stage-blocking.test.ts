/**
 * v12.316 — 导演台第一版:空间模型与投影(纯逻辑)。
 *
 * ── 这一版为什么先不写 3D 界面 ────────────────────────────────────
 * 竞品对比里差距最大的是 LibTV 的导演台。但它的价值**不在于能拖 3D**,
 * 而在于把「谁站哪、机位在哪、谁挡住谁」变成模型能准确理解的东西 ——
 * 这件事有两个产物,都不需要渲染器:
 *   ① 人手写不出来的**精确站位描述**(直接进提示词);
 *   ② **确定性的构图检查**(谁出画、谁被挡、机位是否穿模)。
 * 两样都**引擎无关**,与 BYO key 架构天然契合:换引擎不作废。
 * 3D 交互是这层之上的皮,晚一版不影响能力本身。
 *
 * ── 几何必须用能手算的数字锁死 ────────────────────────────────────
 * 「没报错」不等于「算对了」。下面的期望值都可以手工验证:
 * 35mm 镜头水平视角 = 2·atan(36/70) ≈ 54.4°;机位正前方的人 screenX = 0;
 * 偏 27.2°(半视角)的人恰好在画面边缘 screenX = ±1。
 */
import { describe, it, expect } from 'vitest';
import {
  projectScene, auditStaging, describeStaging,
  horizontalFovDeg, inferShotSize, inferCameraAngle,
  type StageScene,
} from '@/lib/stage-blocking';
import { stageDirectiveForShot } from '@/lib/stage-scene-store';

/** 机位在原点朝 +z;主体正前方 5 米 */
const base = (over: Partial<StageScene> = {}): StageScene => ({
  camera: { x: 0, z: 0, yawDeg: 0, lens: '35', heightM: 1.6 },
  actors: [{ id: 'A', name: '林晚', x: 0, z: 5 }],
  ...over,
});

describe('v12.316 · 镜头几何(可手算)', () => {
  it('35mm 全画幅水平视角 ≈ 54.4°', () => {
    expect(horizontalFovDeg('35')).toBeCloseTo(54.43, 1);
  });

  it('焦距越长视角越窄,且单调', () => {
    const f = ['18', '24', '35', '50', '85', '100'] as const;
    const fov = f.map((x) => horizontalFovDeg(x));
    for (let i = 1; i < fov.length; i++) expect(fov[i]).toBeLessThan(fov[i - 1]);
  });

  it('缺省焦距按 35mm,不炸', () => {
    expect(horizontalFovDeg(undefined)).toBeCloseTo(horizontalFovDeg('35'), 6);
  });
});

describe('v12.316 · 投影', () => {
  it('正前方的人落在画面正中(screenX = 0)', () => {
    const [p] = projectScene(base());
    expect(p.screenX).toBeCloseTo(0, 6);
    expect(p.inFrame).toBe(true);
    expect(p.thirds).toBe('center');
    expect(p.distanceM).toBeCloseTo(5, 3);
  });

  it('偏半个视角的人恰好在画面边缘(screenX ≈ ±1)', () => {
    const halfFov = horizontalFovDeg('35') / 2;            // ≈ 27.2°
    const d = 5;
    const x = d * Math.tan((halfFov * Math.PI) / 180);
    const [p] = projectScene(base({ actors: [{ id: 'A', x, z: d }] }));
    expect(p.screenX).toBeCloseTo(1, 2);
  });

  it('**机位背后的人一定出画**(不能因为角度绕回来就误判在画面里)', () => {
    const [p] = projectScene(base({ actors: [{ id: 'A', x: 0, z: -5 }] }));
    expect(p.inFrame).toBe(false);
    expect(p.thirds).toBe('off-frame');
  });

  it('机位转向后,原本正中的人跟着移出画面', () => {
    const straight = projectScene(base())[0];
    const turned = projectScene(base({ camera: { x: 0, z: 0, yawDeg: 40, lens: '35' } }))[0];
    expect(straight.inFrame).toBe(true);
    expect(turned.inFrame, '转 40° 超过半视角 27°').toBe(false);
  });

  it('遮挡:同方向更近的人挡住更远的人,反之不成立', () => {
    const s = base({
      actors: [
        { id: 'near', name: '陆沉', x: 0, z: 3 },
        { id: 'far', name: '林晚', x: 0, z: 6 },
      ],
    });
    const r = projectScene(s);
    const far = r.find((p) => p.id === 'far')!;
    const near = r.find((p) => p.id === 'near')!;
    expect(far.occludedBy).toEqual(['陆沉']);
    expect(near.occludedBy, '近的不会被远的挡').toEqual([]);
  });

  it('横向错开就不再遮挡', () => {
    const s = base({
      actors: [
        { id: 'near', name: '陆沉', x: 1.5, z: 3 },
        { id: 'far', name: '林晚', x: 0, z: 6 },
      ],
    });
    const far = projectScene(s).find((p) => p.id === 'far')!;
    expect(far.occludedBy).toEqual([]);
  });

  it('空场景不炸', () => {
    expect(projectScene(base({ actors: [] }))).toEqual([]);
  });
});

describe('v12.316 · 景别与机位角由几何算出,而不是让人填', () => {
  it('同一焦距下越近景别越紧', () => {
    const order = ['ELS', 'WS', 'LS', 'MS', 'CU', 'ECU'];
    const sizes = [30, 12, 6, 3, 1.5, 0.6].map((d) => inferShotSize(d, '35'));
    for (let i = 1; i < sizes.length; i++) {
      expect(order.indexOf(sizes[i])).toBeGreaterThanOrEqual(order.indexOf(sizes[i - 1]));
    }
  });

  it('同一距离下长焦更紧(85mm 比 24mm 紧)', () => {
    const order = ['ELS', 'WS', 'LS', 'MS', 'CU', 'ECU'];
    expect(order.indexOf(inferShotSize(5, '85')))
      .toBeGreaterThan(order.indexOf(inferShotSize(5, '24')));
  });

  it('距离非法时不返回 NaN 景别', () => {
    for (const d of [0, -1, NaN]) expect(['ECU']).toContain(inferShotSize(d as number, '35'));
  });

  it('机位高度决定俯仰:1.6m 平视、0.5m 仰拍、2.2m 俯拍、3.5m 顶视', () => {
    expect(inferCameraAngle(1.6)).toBe('eye');
    expect(inferCameraAngle(0.5)).toBe('low');
    expect(inferCameraAngle(2.2)).toBe('high');
    expect(inferCameraAngle(3.5)).toBe('overhead');
  });
});

describe('v12.316 · 构图体检:问题在生成之前就说', () => {
  it('出画会被指出,并给出可操作的建议', () => {
    const issues = auditStaging(base({ actors: [{ id: 'A', name: '林晚', x: 8, z: 2 }] }));
    const off = issues.find((i) => i.kind === 'off-frame');
    expect(off).toBeTruthy();
    expect(off!.message).toContain('林晚');
    expect(off!.message, '要给出怎么办').toMatch(/转机位|更广/);
  });

  it('遮挡会被指出', () => {
    const issues = auditStaging(base({
      actors: [
        { id: 'n', name: '陆沉', x: 0, z: 3 },
        { id: 'f', name: '林晚', x: 0, z: 6 },
      ],
    }));
    expect(issues.some((i) => i.kind === 'occluded' && i.message.includes('林晚'))).toBe(true);
  });

  it('机位穿模会被指出', () => {
    const issues = auditStaging(base({ actors: [{ id: 'A', name: '林晚', x: 0.1, z: 0.1 }] }));
    expect(issues.some((i) => i.kind === 'camera-inside-actor')).toBe(true);
  });

  it('**全员出画时提示机位可能反了**(最常见的低级错)', () => {
    const issues = auditStaging(base({ actors: [{ id: 'A', x: 0, z: -5 }] }));
    expect(issues.some((i) => i.kind === 'empty-frame')).toBe(true);
  });

  it('构图正常时零告警(不制造噪声)', () => {
    expect(auditStaging(base())).toEqual([]);
  });
});

describe('v12.316 · 站位描述(直接进提示词)', () => {
  it('把三分位、景别、距离、遮挡一次说清', () => {
    const text = describeStaging(base({
      actors: [
        { id: 'n', name: '陆沉', x: -1.2, z: 3 },
        { id: 'f', name: '林晚', x: 1.0, z: 6 },
      ],
    }));
    expect(text).toContain('陆沉');
    expect(text).toContain('林晚');
    expect(text).toMatch(/中景|特写|全景|远景/);
    expect(text).toMatch(/米/);
    expect(text, '要说明机位俯仰').toMatch(/平视|仰拍|俯拍|顶视/);
  });

  it('**描述随站位变化而变** —— 用户改一下就重新成文,不用自己组织语言', () => {
    const a = describeStaging(base({ actors: [{ id: 'A', name: '林晚', x: -2, z: 5 }] }));
    const b = describeStaging(base({ actors: [{ id: 'A', name: '林晚', x: 2, z: 5 }] }));
    expect(a).not.toBe(b);
    expect(a).toMatch(/左/);
    expect(b).toMatch(/右/);
  });

  it('近的人先说(观众先看到的先描述)', () => {
    const text = describeStaging(base({
      actors: [
        { id: 'f', name: '远的', x: 0.8, z: 8 },
        { id: 'n', name: '近的', x: -0.8, z: 2 },
      ],
    }));
    expect(text.indexOf('近的')).toBeLessThan(text.indexOf('远的'));
  });

  it('画外的人不写进描述(否则给模型错误信息)', () => {
    const text = describeStaging(base({
      actors: [
        { id: 'in', name: '在画里', x: 0, z: 5 },
        { id: 'out', name: '在画外', x: 20, z: 1 },
      ],
    }));
    expect(text).toContain('在画里');
    expect(text).not.toContain('在画外');
  });

  it('全员出画时返回空串,而不是编一句假的', () => {
    expect(describeStaging(base({ actors: [{ id: 'A', x: 0, z: -5 }] }))).toBe('');
  });

  it('复用既有词表(景别/机位角),不新造一套说法', () => {
    const src = require('node:fs').readFileSync('lib/stage-blocking.ts', 'utf-8') as string;
    expect(src).toMatch(/from '\.\/cinematography'/);
    expect(src).toMatch(/ShotSize/);
    expect(src).toMatch(/CameraAngle/);
  });
});

describe('v12.316 · **接线**:造好没接线是这个仓最顽固的病(本轮已撞 8 次)', () => {
  const fs2 = require('node:fs');
  const strip = (t: string) => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  const ORCH = strip(fs2.readFileSync('services/hybrid-orchestrator.ts', 'utf-8')) as string;
  const ROUTE = strip(fs2.readFileSync('app/api/projects/[id]/stage/route.ts', 'utf-8')) as string;
  const STORE = strip(fs2.readFileSync('lib/stage-scene-store.ts', 'utf-8')) as string;

  it('编排器真的把站位接进了 enhancedPrompt(否则这版等于没做)', () => {
    expect(ORCH).toContain('stageDirectiveForShot');
    expect(ORCH).toMatch(/enhancedPrompt \+= staging/);
  });

  it('**注入点在角色外观/动作/台词之前**(靠前的 token 注意力最高)', () => {
    const iStage = ORCH.indexOf('enhancedPrompt += staging');
    const iChar = ORCH.indexOf('enhancedPrompt += charDescSegment');
    const iAction = ORCH.indexOf("enhancedPrompt += `. Action:");
    expect(iStage).toBeGreaterThan(0);
    expect(iStage).toBeLessThan(iChar);
    expect(iStage).toBeLessThan(iAction);
  });

  it('没摆过位的镜零影响(绝大多数镜都没摆,不能改坏老项目)', () => {
    expect(stageDirectiveForShot(null)).toBe('');
    expect(stageDirectiveForShot(undefined)).toBe('');
    expect(stageDirectiveForShot({ actors: [], camera: { x: 0, z: 0, yawDeg: 0 } })).toBe('');
  });

  it('读舞台失败不把出片打挂(增强项不是必需项)', () => {
    const i = ORCH.indexOf('stageDirectiveForShot');
    const block = ORCH.slice(Math.max(0, i - 400), i + 300);
    expect(block).toContain('try {');
    expect(block).toContain('catch');
  });

  it('**注入的是英文**(visualPrompt 全链路英文,混中文会被当画面文字渲染)', () => {
    const d = stageDirectiveForShot({
      camera: { x: 0, z: 0, yawDeg: 0, lens: '35' },
      actors: [{ id: 'A', name: 'Lin', x: 0, z: 5 }],
    });
    expect(d).toMatch(/Staging:/);
    expect(d, '不该出现中文').not.toMatch(/[一-龥]/);
  });

  it('写要 edit 级、读要 view 级(改构图会改变后续出片,只读协作者不该能改)', () => {
    const iPost = ROUTE.indexOf('export async function POST');
    expect(ROUTE.slice(iPost, iPost + 400)).toMatch(/requireProjectAccess\(request, id, 'edit'\)/);
    const iGet = ROUTE.indexOf('export async function GET');
    expect(ROUTE.slice(iGet, iGet + 400)).toMatch(/requireProjectAccess\(request, id, 'view'\)/);
  });

  it('dryRun 只算不存(拖动预览不能每帧写库)', () => {
    const i = ROUTE.indexOf('body?.dryRun');
    const iSave = ROUTE.indexOf('await saveStageScene', i);
    expect(i).toBeGreaterThan(0);
    expect(iSave, 'dryRun 判断必须在落库之前').toBeGreaterThan(i);
    // 窗口按语义收边到落库那一行 —— 固定字符数会切进后面的分支(这轮第七次栽在窗口上)
    const block = ROUTE.slice(i, iSave);
    expect(block).toContain('dryRun: true');
    expect(block, 'dryRun 要直接 return,不能落到后面的保存').toMatch(/return NextResponse\.json/);
  });

  it('把**真正会进提示词的那句**回给前端(所见即所得)', () => {
    expect(ROUTE).toMatch(/directive/);
    expect(ROUTE).toContain('stageDirectiveForShot');
  });

  it('有问题也存 —— 出画/遮挡有时是故意的(与 v12.294「只报不拦」同一取舍)', () => {
    const i = ROUTE.indexOf('await saveStageScene');
    expect(i, '找不到 saveStageScene 调用点').toBeGreaterThan(0);
    const before = ROUTE.slice(Math.max(0, i - 300), i);
    expect(before.length, '窗口为空,下面那条 not.* 会静默通过').toBeGreaterThan(0);
    expect(before, '不该因为体检有问题就拒存').not.toMatch(/issues\.length[^\n]*return/);
  });

  it('**upsert 走事务**(并发保存否则会插出两条,该镜从此看运气挑一条)', () => {
    expect(STORE).toMatch(/transaction\(async/);
    const i = STORE.indexOf('transaction(async');
    const block = STORE.slice(i, i + 700);
    expect(block, '查与插必须在同一事务里').toContain('listAssetsByType');
    expect(block).toContain('createAsset');
  });

  it('存坏的数据当没设过处理,不把出片打挂', () => {
    const i = STORE.indexOf('export async function getStageScene');
    const block = STORE.slice(i, STORE.indexOf('export async function saveStageScene'));
    expect(block).toContain('catch');
    expect(block).toMatch(/return null/);
  });
});
