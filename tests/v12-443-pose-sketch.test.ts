/**
 * v12.443 —— 姿态进构图:布局草图里画出四肢,坐/跪/蹲/躺的人头顶真的更低。
 *
 * v12.441 让姿态进了提示词,但草图里每个人还是「一根矩形 + 一个圆头」——
 * 坐着的人和站着的人画出来一模一样。而草图锁正是拿这张图去约束构图的:
 * 图里站着、提示词里坐着,两个口径打架,模型听谁的都不对。
 *
 * 两件事都是几何事实,不是美术:
 *   ① 头顶高度:坐 0.72、跪 0.62、蹲 0.55、躺 0.18 倍站立高 —— 直接改画面里的高度与景别;
 *   ② 四肢折线:草图能看出「他在干什么」。
 */
import { describe, it, expect } from 'vitest';
import zlib from 'node:zlib';
import { createHash } from 'node:crypto';
import { renderStageSketch } from '@/lib/stage-sketch';
import { POSE_SKELETONS, poseHeightFactor, poseSkeletonOf } from '@/lib/pose-skeleton';
import { POSE_PRESETS, projectScene, type StageScene, type PosePresetId } from '@/lib/stage-blocking';

/** 极简 PNG 解码 —— 本仓的编码器固定 truecolor 8bit、每行过滤器 0,所以解回来只需 inflate */
function decode(png: Buffer) {
  const width = png.readUInt32BE(16);
  const height = png.readUInt32BE(20);
  const idat: Buffer[] = [];
  let off = 8;
  while (off < png.length) {
    const len = png.readUInt32BE(off);
    const type = png.toString('ascii', off + 4, off + 8);
    if (type === 'IDAT') idat.push(png.subarray(off + 8, off + 8 + len));
    off += 12 + len;
  }
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = width * 3;
  const pixelHash = () => createHash('sha256').update(raw).digest('hex');
  const px = (x: number, y: number) => {
    const i = y * (stride + 1) + 1 + x * 3;
    return raw[i];   // 灰阶图,取 R 即可
  };
  return { width, height, px, pixelHash, isInk: (x: number, y: number) => px(x, y) < 200 };
}

const CAM = { x: 0, z: 0, yawDeg: 0, lens: '35' as const, heightM: 1.6 };
const one = (posePreset?: PosePresetId): StageScene => ({
  camera: CAM, aspect: '16:9',
  actors: [{ id: 'a', name: '林晚', x: 0, z: 5, posePreset }],
});

describe('v12.443 · 骨架表自检', () => {
  it('词表里每个姿态都有骨架,且参数在合理范围', () => {
    const ids = Object.keys(POSE_PRESETS) as PosePresetId[];
    expect(Object.keys(POSE_SKELETONS).sort()).toEqual(ids.sort());
    for (const id of ids) {
      const s = POSE_SKELETONS[id];
      expect(s.heightFactor, id).toBeGreaterThan(0);
      expect(s.heightFactor, id).toBeLessThanOrEqual(1);
      expect(s.torsoTop, id).toBeGreaterThan(s.torsoBottom);
      for (const limb of s.limbs) {
        expect(limb.length, `${id} 的肢体至少两点`).toBeGreaterThanOrEqual(2);
        for (const [x, y] of limb) {
          expect(Math.abs(x), `${id} 横向不该离谱`).toBeLessThanOrEqual(2);
          expect(y, `${id} 纵向在 0(脚)~1.3(高举过头)之间`).toBeGreaterThanOrEqual(-0.1);
          expect(y, id).toBeLessThanOrEqual(1.3);
        }
      }
    }
  });

  it('站/走/跑不改高度;坐跪蹲躺依次更低;未设与词表外按站立', () => {
    for (const id of ['standing', 'walking', 'running'] as PosePresetId[]) expect(poseHeightFactor(id)).toBe(1);
    const f = (id: PosePresetId) => poseHeightFactor(id);
    expect(f('sitting')).toBeLessThan(1);
    expect(f('kneeling')).toBeLessThan(f('sitting'));
    expect(f('crouching')).toBeLessThan(f('kneeling'));
    expect(f('lying')).toBeLessThan(f('crouching'));
    expect(poseHeightFactor(undefined)).toBe(1);
    expect(poseHeightFactor('moonwalk' as PosePresetId)).toBe(1);
    expect(poseSkeletonOf('toString' as PosePresetId), '原型链上的键不算姿态').toBeNull();
  });
});

describe('v12.443 · 姿态改变画面里的高度', () => {
  it('坐着的人头顶比站着低,脚底不变(人没飞起来)', () => {
    const stand = projectScene(one('standing'))[0];
    const sit = projectScene(one('sitting'))[0];
    expect(sit.screenTop).toBeLessThan(stand.screenTop);
    expect(sit.screenBottom).toBeCloseTo(stand.screenBottom, 6);
    // 机位 1.6m 时坐着的头顶(1.22m)低于镜头水平线 → screenTop 为负,这本身就是「更低」的表现
    expect(stand.screenTop).toBeGreaterThan(0);
    expect(sit.screenTop).toBeLessThan(0);
  });

  it('没设姿态 = 站立(旧数据零影响)', () => {
    const none = projectScene(one())[0];
    const stand = projectScene(one('standing'))[0];
    expect(none.screenTop).toBeCloseTo(stand.screenTop, 9);
    expect('posePreset' in none, '未设姿态不该多出这个键').toBe(false);
    expect(projectScene(one('sitting'))[0].posePreset).toBe('sitting');
  });

  // v12.445 迁移:原本断言「躺下改变景别」。浏览器实测发现那是错的 —— 躺着的人被判成「大远景」,
  // 可他没有变远变小。景别是「这个人在画面里占多大」,由身量与距离决定;姿态只改轮廓。
  it('躺下不改变景别(人没变远变小),但轮廓确实变矮了', () => {
    expect(projectScene(one('lying'))[0].shotSize).toBe(projectScene(one('standing'))[0].shotSize);
    expect(projectScene(one('lying'))[0].screenTop).toBeLessThan(projectScene(one('standing'))[0].screenTop);
  });
});

describe('v12.443 · 草图画出四肢', () => {
  const render = (s: StageScene) => decode(renderStageSketch(s, { width: 320, height: 180 }));

  it('**没设姿态的草图逐像素不变**(基线取自 v12.442 的代码)', () => {
    const scene: StageScene = {
      camera: CAM, aspect: '16:9',
      actors: [{ id: 'a', name: '林晚', x: -1, z: 4 }, { id: 'b', name: '陆沉', x: 1.2, z: 6, heightM: 1.8 }],
    };
    // 锁**解码后的像素**而不是 PNG 文件字节:PNG 是 zlib 压缩的,不同 Node 版本的 zlib
    // 输出不同 —— 本机 Node 25 与 CI 的 Node 22 算出的文件哈希就不一样(这条最初写成文件
    // 哈希,本机绿、CI 红)。像素才是这条测试真正要锁的东西。
    expect(render(scene).pixelHash()).toBe('489f210758485e4abf6f5db3ef0bbfb01d640213ee52322c50e4c27913355a3b');
  });

  it('举手:肩线以上、躯干之外有墨(站立时那片是空的)', () => {
    const stand = render(one('standing'));
    const raised = render(one('arm-raised'));
    const p = projectScene(one('standing'))[0];
    const cx = Math.round(((p.screenX + 1) / 2) * 320);
    const yTop = Math.round(((1 - p.screenTop) / 2) * 180);
    // 严格取头顶线**以上**:站立时那里只能是空白(头顶就是画面里这个人的最高点)
    const band = (img: ReturnType<typeof decode>) => {
      let n = 0;
      for (let y = Math.max(0, yTop - 14); y < yTop; y++) {
        for (let x = cx + 4; x < Math.min(320, cx + 30); x++) if (img.isInk(x, y)) n++;
      }
      return n;
    };
    expect(band(stand), '站立时头顶右上方应是空白').toBe(0);
    expect(band(raised), '举手应在那片画出手臂').toBeGreaterThan(5);
  });

  it('指向:手臂水平伸出,横向比站立宽出一截', () => {
    // 跳过地平线那一行 —— 它是横贯整幅的参考线(灰度 170,也算「墨」),不跳的话谁的宽度都是满幅
    const widthOf = (id: PosePresetId) => {
      const img = render(one(id));
      let min = 320, max = 0;
      for (let y = 0; y < 180; y++) {
        if (Math.abs(y - 90) <= 1) continue;
        for (let x = 0; x < 320; x++) if (img.isInk(x, y)) { if (x < min) min = x; if (x > max) max = x; }
      }
      return max - min;
    };
    expect(widthOf('pointing')).toBeGreaterThan(widthOf('standing') + 8);
  });

  it('躺倒:墨集中在画面下部,且横向跨度明显大于纵向', () => {
    const img = render(one('lying'));
    let min = 320, max = 0, top = 180, bottom = 0;
    for (let y = 0; y < 180; y++) for (let x = 0; x < 320; x++) if (img.isInk(x, y) && Math.abs(y - 90) > 2) {
      if (x < min) min = x; if (x > max) max = x;
      if (y < top) top = y; if (y > bottom) bottom = y;
    }
    expect(max - min, '横向跨度').toBeGreaterThan((bottom - top) * 2);
    expect(top, '躺着的人应该在地平线以下').toBeGreaterThan(90);
    // 躺下的人横着占的长度 ≈ 他站着时的身高 —— 若按压缩后的高度算横向长度,会缩成一小块
    const stand = render(one('standing'));
    let sTop = 180, sBot = 0;
    for (let y = 0; y < 180; y++) {
      if (Math.abs(y - 90) <= 1) continue;
      for (let x = 0; x < 320; x++) if (stand.isInk(x, y)) { if (y < sTop) sTop = y; if (y > sBot) sBot = y; }
    }
    expect(max - min, '躺着的长度不该明显短于站着的身高').toBeGreaterThan((sBot - sTop) * 0.7);
  });

  it('十五个姿态各画各的:两两之间的图都不相同', () => {
    const hashes = (Object.keys(POSE_PRESETS) as PosePresetId[]).map((id) =>
      createHash('sha256').update(renderStageSketch(one(id), { width: 320, height: 180 })).digest('hex'));
    expect(new Set(hashes).size).toBe(hashes.length);
  });
});
