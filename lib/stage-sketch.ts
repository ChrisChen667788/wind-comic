/**
 * lib/stage-sketch — 把导演台舞台渲成**布局草图 PNG**。v12.317。
 *
 * ── 为什么是这条路 ────────────────────────────────────────────────
 * v12.316 让站位能被**说**准了,这一版让它能被**看**准。
 * 仓里早有一条现成通道:`buildSketchDirective` 会给模型下
 * 「[STORYBOARD LOCK] … The sketch defines LAYOUT ONLY —— 细节配色仍按提示词」。
 * **风格污染的问题上游已经解决过**,所以这里绝不新开一条参考图通道 ——
 * 直接喂进 `storyboard-sketch`,复用那份指令。
 *
 * 对比今天的草图来源:要么用户上传,要么**花钱让 AI 画一张**(还不保证画的正是你要的构图)。
 * 舞台渲出来的草图**免费、确定性、且天生与用户摆的位一致** —— 这正是导演台该有的产物。
 *
 * ── 为什么手写 PNG 编码而不是加 sharp/resvg ───────────────────────
 * 布局草图只有矩形、线、椭圆,不值得为它引入原生依赖:原生包要在 CI 五个 job
 * 和用户机器上各自编译,是这个 MIT 开源仓最不划算的一类负担。
 * Node 自带 zlib,PNG 容器本身只有 CRC32 + IDAT 两件事。
 *
 * ── 分工 ──────────────────────────────────────────────────────────
 * **本文件不做任何几何**。横向、纵向、景别、遮挡全部取自 `projectScene`。
 * 草图要画得对,就必须与提示词描述**同一套几何** —— 两边各算一套,
 * 就是本仓栽过五次的「同一语义两套口径」。
 */
import zlib from 'node:zlib';
import type { StageScene } from './stage-blocking';
import { projectScene, inferCameraAngle } from './stage-blocking';

// ── 最小 PNG 编码 ──────────────────────────────────────────────────

const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}

/** RGB8 像素缓冲 → PNG。无滤波(filter 0),草图是大色块,压缩率足够。 */
export function encodePNG(width: number, height: number, rgb: Uint8Array): Buffer {
  const stride = width * 3;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0;
    Buffer.from(rgb.buffer, rgb.byteOffset + y * stride, stride).copy(raw, y * (stride + 1) + 1);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;    // bit depth
  ihdr[9] = 2;    // color type: truecolor
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// ── 画布 ───────────────────────────────────────────────────────────

type RGB = [number, number, number];

class Canvas {
  buf: Uint8Array;
  constructor(readonly w: number, readonly h: number, bg: RGB = [255, 255, 255]) {
    this.buf = new Uint8Array(w * h * 3);
    for (let i = 0; i < w * h; i++) {
      this.buf[i * 3] = bg[0]; this.buf[i * 3 + 1] = bg[1]; this.buf[i * 3 + 2] = bg[2];
    }
  }
  px(x: number, y: number, c: RGB) {
    const xi = Math.round(x), yi = Math.round(y);
    if (xi < 0 || yi < 0 || xi >= this.w || yi >= this.h) return;
    const i = (yi * this.w + xi) * 3;
    this.buf[i] = c[0]; this.buf[i + 1] = c[1]; this.buf[i + 2] = c[2];
  }
  rect(x0: number, y0: number, x1: number, y1: number, c: RGB) {
    const a = Math.max(0, Math.floor(Math.min(x0, x1)));
    const b = Math.min(this.w - 1, Math.ceil(Math.max(x0, x1)));
    const t = Math.max(0, Math.floor(Math.min(y0, y1)));
    const d = Math.min(this.h - 1, Math.ceil(Math.max(y0, y1)));
    for (let y = t; y <= d; y++) for (let x = a; x <= b; x++) this.px(x, y, c);
  }
  vline(x: number, c: RGB) { for (let y = 0; y < this.h; y++) this.px(x, y, c); }
  hline(y: number, c: RGB) { for (let x = 0; x < this.w; x++) this.px(x, y, c); }
  disc(cx: number, cy: number, r: number, c: RGB) {
    for (let y = Math.floor(cy - r); y <= Math.ceil(cy + r); y++) {
      for (let x = Math.floor(cx - r); x <= Math.ceil(cx + r); x++) {
        if ((x - cx) ** 2 + (y - cy) ** 2 <= r * r) this.px(x, y, c);
      }
    }
  }
}

export interface StageSketchOptions {
  width?: number;
  height?: number;
  /** 画三分线参考(默认画;它同时提示模型这是构图草图而非成片) */
  thirds?: boolean;
}

const GUIDE: RGB = [200, 200, 200];
const OUTLINE: RGB = [30, 30, 30];
const HORIZON: RGB = [170, 170, 170];

/**
 * 渲染**相机视角**的布局草图。
 *
 * 刻意画成灰阶粗块:草图要表达的只有「谁在哪、多大、谁在前」。
 * 画得越像成片,模型越可能连它的画风一起学走 —— 而画风该由提示词决定。
 *
 * 近的后画 → **前后遮挡关系天然正确**,与 `occludedBy` 说的是同一件事。
 */
export function renderStageSketch(scene: StageScene, opts: StageSketchOptions = {}): Buffer {
  const W = Math.max(64, Math.floor(opts.width ?? 960));
  const H = Math.max(64, Math.floor(opts.height ?? 540));
  const cv = new Canvas(W, H);

  if (opts.thirds !== false) {
    cv.vline(Math.round(W / 3), GUIDE);
    cv.vline(Math.round((2 * W) / 3), GUIDE);
    cv.hline(Math.round(H / 3), GUIDE);
    cv.hline(Math.round((2 * H) / 3), GUIDE);
  }

  // 地平线 = 机位高度所在的视线水平 → 归一化纵向 0
  cv.hline(Math.round(H / 2), HORIZON);

  const projected = projectScene(scene)
    .filter((p) => p.inFrame)
    .sort((a, b) => b.distanceM - a.distanceM);   // 远 → 近,近的覆盖远的

  // 归一化(+1 顶 / -1 底)→ 像素 y
  const toY = (n: number) => ((1 - n) / 2) * H;
  const toX = (n: number) => ((n + 1) / 2) * W;

  for (const p of projected) {
    const yTop = toY(p.screenTop);
    const yBot = toY(p.screenBottom);
    const bodyH = Math.abs(yBot - yTop);
    if (bodyH < 2) continue;                       // 太小画不出,略过好过画成噪点
    const x = toX(p.screenX);
    const bodyW = Math.max(2, bodyH * 0.26);       // 人体宽高比约 1:4

    // 越近越深 —— 让纵深在灰阶里也读得出来
    const near = Math.max(0, Math.min(1, 1 - p.distanceM / 12));
    const tone = Math.round(150 - near * 90);
    const fill: RGB = [tone, tone, tone];

    const headR = Math.max(1, bodyH * 0.09);
    const shoulderY = yTop + headR * 2.2;
    cv.rect(x - bodyW / 2, shoulderY, x + bodyW / 2, yBot, fill);
    cv.disc(x, yTop + headR, headR, fill);

    // 描边:与背景/彼此分开,模型才读得出这是几个独立主体
    cv.rect(x - bodyW / 2, shoulderY, x - bodyW / 2 + 1, yBot, OUTLINE);
    cv.rect(x + bodyW / 2 - 1, shoulderY, x + bodyW / 2, yBot, OUTLINE);
  }

  return encodePNG(W, H, cv.buf);
}

/** 该镜草图配套的镜头元数据 —— 复用既有 sketchMeta 口径,不新造字段 */
export function sketchMetaFromScene(scene: StageScene) {
  const projected = projectScene(scene).filter((p) => p.inFrame);
  const nearest = projected.slice().sort((a, b) => a.distanceM - b.distanceM)[0];
  return {
    shotSize: nearest?.shotSize,
    angle: inferCameraAngle(scene.camera.heightM ?? 1.6),
  };
}
