/**
 * v11.1.1 — 场景切分纯函数单测(零 IO;ffmpeg 路径由 e2e 用真视频覆盖)。
 */
import { describe, expect, it } from 'vitest';
import { parseShowinfoTimes, splitToShots, MAX_SHOTS } from '@/lib/scene-split';
import { validateVisionLabel } from '@/lib/pull-sheet';

describe('v11.1.1 · parseShowinfoTimes', () => {
  it('从 showinfo stderr 提取 pts_time:去重 + 升序;非法值跳过', () => {
    const stderr = [
      '[Parsed_showinfo_1 @ 0x1] n: 0 pts: 12800 pts_time:8.533 fmt:yuv420p',
      '[Parsed_showinfo_1 @ 0x1] n: 1 pts: 3840 pts_time:2.56 fmt:yuv420p',
      '[Parsed_showinfo_1 @ 0x1] n: 2 pts_time:8.533 重复帧',
      'frame= 120 fps= 60 q=-0.0 size=N/A',
    ].join('\n');
    expect(parseShowinfoTimes(stderr)).toEqual([2.56, 8.533]);
    expect(parseShowinfoTimes('no markers here')).toEqual([]);
  });
});

describe('v11.1.1 · splitToShots', () => {
  it('无切点 → 单镜整片;切点成段,时间轴连续', () => {
    expect(splitToShots(10, []).shots).toEqual([
      { shotNumber: 1, startSec: 0, endSec: 10, durationSec: 10 },
    ]);
    const { shots } = splitToShots(10, [4, 7]);
    expect(shots.map((s) => [s.startSec, s.endSec])).toEqual([[0, 4], [4, 7], [7, 10]]);
  });

  it('碎镜(< minShotSec)并入前段;首段过短并入后段', () => {
    // 4 → 4.3 只有 0.3s(快闪过切)→ 并入前段
    const { shots } = splitToShots(10, [4, 4.3]);
    expect(shots.map((s) => [s.startSec, s.endSec])).toEqual([[0, 4.3], [4.3, 10]]);
    // 片头黑场 0.4s → 首段并入后段
    const r2 = splitToShots(10, [0.4, 5]);
    expect(r2.shots.map((s) => [s.startSec, s.endSec])).toEqual([[0, 5], [5, 10]]);
  });

  it('越界/重复切点被过滤;镜数超护栏截断并标记', () => {
    const { shots } = splitToShots(10, [-1, 0, 5, 5, 12]);
    expect(shots.map((s) => [s.startSec, s.endSec])).toEqual([[0, 5], [5, 10]]);

    const manyCuts = Array.from({ length: 100 }, (_, i) => (i + 1) * 2); // 2s 一切,共 100 切
    const r = splitToShots(300, manyCuts);
    expect(r.truncated).toBe(true);
    expect(r.shots.length).toBe(MAX_SHOTS);
  });

  it('非法时长 → 空表不抛', () => {
    expect(splitToShots(0, [1, 2]).shots).toEqual([]);
  });
});

describe('v11.1.1 · validateVisionLabel(打标白名单)', () => {
  it('白名单字段收取 + trim/截断;越界字段(声音/运镜等单帧不可判)丢弃', () => {
    const label = validateVisionLabel({
      description: '  办公室对峙  ',
      shotSize: '中景',
      lightingIntent: 'x'.repeat(300),
      scoreMood: '编造的音乐情绪',     // 单帧无声 → 丢弃
      cameraMovement: '编造的运镜',    // 静帧不可判 → 丢弃
      characters: ['老板', '  员工 ', 42],
      junk: 'nope',
    });
    expect(label.description).toBe('办公室对峙');
    expect(label.shotSize).toBe('中景');
    expect(label.lightingIntent!.length).toBe(200);
    expect((label as any).scoreMood).toBeUndefined();
    expect((label as any).cameraMovement).toBeUndefined();
    expect(label.characters).toEqual(['老板', '员工']);
  });

  it('非对象 / 空对象 → {} 不抛', () => {
    expect(validateVisionLabel(null)).toEqual({});
    expect(validateVisionLabel('str')).toEqual({});
    expect(validateVisionLabel({ description: '   ' })).toEqual({});
  });
});
