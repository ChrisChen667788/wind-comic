/**
 * v12.317 — 导演台第二版:舞台渲成布局草图 PNG。
 *
 * v12.316 让站位能被**说**准,这一版让它能被**看**准。
 *
 * ── 为什么走既有 sketch 通道,而不是新开一条参考图 ────────────────
 * 把线稿草图塞进 `referenceImages`,模型很可能连草图的**画风**一起学走 ——
 * 那些参考位是给身份/风格用的。但仓里早就有解:`buildSketchDirective` 会下
 * 「[STORYBOARD LOCK] … the sketch defines LAYOUT ONLY,细节配色仍按提示词」。
 * 上游已经解决过的问题不该再解一遍,于是本版直接复用 `storyboard-sketch`。
 *
 * ── 为什么手写 PNG 编码 ───────────────────────────────────────────
 * 布局草图只有矩形/线/椭圆,不值得为它引入 sharp/resvg 这类原生依赖 ——
 * 原生包要在 CI 五个 job 和用户机器上各自编译,是这个 MIT 开源仓最不划算的负担。
 *
 * ── 本版顺手修掉的一个静默失效 ────────────────────────────────────
 * 草图进引擎那条**没过 `toEngineImage`**。原先两种来源(AI 生成 / 用户上传)
 * 恰好都是 http 所以没暴露;本地存储给的是 `/api/serve-file?key=…`,引擎够不着 ——
 * 提示词照样加了 [STORYBOARD LOCK],图却没送到,**草图锁静默失效**。
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import zlib from 'node:zlib';
import { renderStageSketch, encodePNG, sketchMetaFromScene } from '@/lib/stage-sketch';
import { projectScene, verticalFovDeg, type StageScene } from '@/lib/stage-blocking';

const strip = (t: string) =>
  t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const ORCH = strip(fs.readFileSync('services/hybrid-orchestrator.ts', 'utf-8'));
const ROUTE = strip(fs.readFileSync('app/api/projects/[id]/shot-sketch/route.ts', 'utf-8'));
const SKETCH = strip(fs.readFileSync('lib/stage-sketch.ts', 'utf-8'));

const scene = (over: Partial<StageScene> = {}): StageScene => ({
  camera: { x: 0, z: 0, yawDeg: 0, lens: '35', heightM: 1.6 },
  actors: [{ id: 'A', name: '林晚', x: 0, z: 5 }],
  ...over,
});

/** 解出 PNG 的宽高 —— IHDR 就在固定偏移,不需要解码库 */
function pngSize(buf: Buffer) {
  expect(buf.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
  expect(buf.subarray(12, 16).toString('ascii')).toBe('IHDR');
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

/** 把 IDAT 解回像素 —— 断言「画了什么」而不是「有没有报错」 */
function pngPixels(buf: Buffer, width: number, height: number) {
  let off = 8;
  const idat: Buffer[] = [];
  while (off < buf.length) {
    const len = buf.readUInt32BE(off);
    const type = buf.subarray(off + 4, off + 8).toString('ascii');
    if (type === 'IDAT') idat.push(buf.subarray(off + 8, off + 8 + len));
    off += 12 + len;
  }
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = width * 3;
  const px = (x: number, y: number) => {
    const i = y * (stride + 1) + 1 + x * 3;
    return [raw[i], raw[i + 1], raw[i + 2]] as [number, number, number];
  };
  return { raw, px };
}

describe('v12.317 · PNG 编码器自身是对的', () => {
  it('产出合法 PNG 签名与 IHDR 尺寸', () => {
    const buf = renderStageSketch(scene(), { width: 320, height: 180 });
    expect(pngSize(buf)).toEqual({ width: 320, height: 180 });
  });

  it('IEND 收尾(截断的 PNG 很多解码器会静默吃掉)', () => {
    const buf = renderStageSketch(scene(), { width: 128, height: 128 });
    expect(buf.subarray(buf.length - 8, buf.length - 4).toString('ascii')).toBe('IEND');
  });

  it('像素能原样解回来(编码不是「看起来像 PNG」而已)', () => {
    const rgb = new Uint8Array(2 * 2 * 3);
    rgb.set([255, 0, 0, 0, 255, 0, 0, 0, 255, 9, 9, 9]);
    const { px } = pngPixels(encodePNG(2, 2, rgb), 2, 2);
    expect(px(0, 0)).toEqual([255, 0, 0]);
    expect(px(1, 0)).toEqual([0, 255, 0]);
    expect(px(0, 1)).toEqual([0, 0, 255]);
    expect(px(1, 1)).toEqual([9, 9, 9]);
  });

  it('**同样的舞台渲出同样的字节** —— 确定性是它相对 AI 画草图的核心优势', () => {
    const a = renderStageSketch(scene(), { width: 200, height: 120 });
    const b = renderStageSketch(scene(), { width: 200, height: 120 });
    expect(a.equals(b)).toBe(true);
  });
});

describe('v12.317 · 画的内容与几何一致', () => {
  it('人物落在其 screenX 对应的横向位置', () => {
    const s = scene({ actors: [{ id: 'A', x: -2, z: 5 }] });
    const p = projectScene(s)[0];
    const W = 400, H = 240;
    const { px } = pngPixels(renderStageSketch(s, { width: W, height: H }), W, H);
    const expectedX = Math.round(((p.screenX + 1) / 2) * W);
    // 该列上应有深色人体;而画面另一侧的对称位置应仍是背景
    const colHasBody = (x: number) => {
      for (let y = 0; y < H; y++) { const [r] = px(x, y); if (r < 120) return true; }
      return false;
    };
    expect(colHasBody(expectedX), '人该在算出来的位置').toBe(true);
    expect(colHasBody(W - expectedX), '对侧不该凭空多个人').toBe(false);
  });

  it('**近大远小**:同样身高,近的画得更高', () => {
    const heightOf = (z: number) => {
      const W = 300, H = 200;
      const s = scene({ actors: [{ id: 'A', x: 0, z }] });
      const { px } = pngPixels(renderStageSketch(s, { width: W, height: H }), W, H);
      let n = 0;
      for (let y = 0; y < H; y++) { const [r] = px(Math.round(W / 2), y); if (r < 120) n++; }
      return n;
    };
    expect(heightOf(3)).toBeGreaterThan(heightOf(9));
  });

  it('远的先画、近的后画 —— 遮挡关系与 occludedBy 说的是同一件事', () => {
    const i = SKETCH.indexOf('.sort((a, b) => b.distanceM - a.distanceM)');
    expect(i, '必须按距离降序绘制').toBeGreaterThan(0);
  });

  it('出画的人不画进草图(否则草图与提示词自相矛盾)', () => {
    const s = scene({ actors: [{ id: 'A', x: 30, z: 1 }] });
    const W = 200, H = 120;
    const { px } = pngPixels(renderStageSketch(s, { width: W, height: H }), W, H);
    let dark = 0;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (px(x, y)[0] < 120) dark++;
    expect(dark, '画面里不该有人体').toBe(0);
  });

  it('**草图层不自己算几何**(与 v12.315 立的分工同一条)', () => {
    expect(SKETCH).toContain('projectScene');
    expect(SKETCH, '不该自己算视角').not.toMatch(/Math\.atan\(/);
    expect(SKETCH, '不该自己算距离').not.toMatch(/Math\.hypot\(/);
  });

  it('垂直视角与水平分开算(35mm 竖向 ≈ 37.8°)', () => {
    expect(verticalFovDeg('35')).toBeCloseTo(37.85, 1);
  });

  it('机位高度改变纵向投影(低机位仰视 → 人物顶得更高)', () => {
    const low = projectScene(scene({ camera: { x: 0, z: 0, yawDeg: 0, lens: '35', heightM: 0.4 } }))[0];
    const high = projectScene(scene({ camera: { x: 0, z: 0, yawDeg: 0, lens: '35', heightM: 3.0 } }))[0];
    expect(low.screenTop).toBeGreaterThan(high.screenTop);
  });

  it('镜头元数据由舞台算出,不让用户再填一遍', () => {
    const m = sketchMetaFromScene(scene());
    expect(m.shotSize).toBeTruthy();
    expect(['eye', 'low', 'high', 'overhead', 'dutch']).toContain(m.angle);
  });
});

describe('v12.317 · 接线:复用既有 sketch 通道,不新开参考图', () => {
  it('路由多了 stage 模式,且仍落同一个 storyboard-sketch 资产', () => {
    expect(ROUTE).toContain("'stage'");
    expect(ROUTE).toContain('renderStageSketch');
    expect(ROUTE).toContain("type: 'storyboard-sketch'");
  });

  it('**stage 模式不调引擎、不花钱**(这正是它相对 AI 画草图的优势)', () => {
    const i = ROUTE.indexOf("if (mode === 'stage')");
    const block = ROUTE.slice(i, ROUTE.indexOf("} else if (mode === 'set')", i));
    expect(i).toBeGreaterThan(0);
    expect(block, 'stage 分支不该调生成引擎').not.toContain('generateImage');
    expect(block).toContain('storagePut');
  });

  it('没摆过位时明确说,而不是渲一张空白图糊弄', () => {
    const i = ROUTE.indexOf("if (mode === 'stage')");
    const block = ROUTE.slice(i, ROUTE.indexOf("} else if (mode === 'set')", i));
    expect(block).toMatch(/409/);
    expect(block).toMatch(/还没在导演台摆过位/);
  });

  it('画幅比跟随请求(竖屏短剧不能拿横屏草图锁构图)', () => {
    const i = ROUTE.indexOf("if (mode === 'stage')");
    const block = ROUTE.slice(i, ROUTE.indexOf("} else if (mode === 'set')", i));
    expect(block).toContain("'9:16'");
    expect(block).toContain('aspectRatio');
  });

  it('**草图进引擎前过 toEngineImage** —— 否则本地图够不着,草图锁静默失效', () => {
    const i = ORCH.indexOf('mergeSketchIntoRefs(');
    const block = ORCH.slice(Math.max(0, i - 500), i + 120);
    expect(block).toContain('toEngineImage');
    expect(block, '转换失败也要退回原值,不能变成 undefined').toMatch(/\|\| opts\.sketchUrl/);
  });

  it('仍沿用 LAYOUT ONLY 那条指令,没另写一份', () => {
    expect(ORCH).toContain('buildSketchDirective');
    const lib = fs.readFileSync('lib/storyboard-sketch.ts', 'utf-8');
    expect(lib).toContain('LAYOUT ONLY');
  });
});
