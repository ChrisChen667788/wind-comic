/**
 * v12.456.1 · 缝合输出的帧率必须显式钉在原片上。
 *
 * v12.456 的 filter graph 以 `concat` 收尾,输出帧率交给 ffmpeg 自己推断。
 * 在 CI 用的 ffmpeg-static Linux 静态版上,concat 的输出链路不带帧率,ffmpeg 按默认 25fps 出片:
 * 24fps 的 8 秒镜出来 199 帧、保留段整体错位(PSNR 21.5dB)。本机的 ffmpeg 恰好推断对了,
 * 真跑 ffmpeg 的测试在本地全绿 —— 所以这里再加一道**不依赖 ffmpeg 构建**的结构断言。
 */
import { describe, it, expect } from 'vitest';
import { planSegmentRetake } from '@/lib/segment-retake';
import { buildStitchGraph } from '@/services/segment-retake.service';

const plan = planSegmentRetake({ shotDurationS: 8, fromS: 3, toS: 5, fps: 24, engineMinDurationS: 3 } as any);
const src = (fps: string, withAudio: boolean): any => ({
  width: 320, height: 180, fps, sar: '1', colorOptions: [],
  audio: withAudio ? { sampleRate: 48000, layout: 'mono', encoder: 'aac', bitrate: '128000' } : null,
});

describe('v12.456.1 · 缝合输出帧率钉在原片上', () => {
  it('夹具计划有效且三段都在', () => {
    expect(plan.ok).toBe(true);
    expect(plan.head).not.toBeNull();
    expect(plan.tail).not.toBeNull();
  });

  it.each([
    ['24', true], ['24', false], ['30000/1001', true], ['25', false],
  ])('原片 %s fps(有音轨=%s):concat 之后接 fps=原片帧率,且 [outv] 只从它出来', (fps, withAudio) => {
    const { filters } = buildStitchGraph(plan as any, src(fps, withAudio), true);
    const last = filters[filters.length - 1];
    expect(last).toBe(`[catv]fps=${fps}[outv]`);
    const concat = filters.find((f) => f.includes('concat='));
    expect(concat, 'concat 的视频输出不能直接叫 [outv](那样 fps 就被绕过了)').toMatch(/\[catv\]/);
    expect(concat).not.toMatch(/\[outv\]/);
    expect(filters.filter((f) => f.includes('[outv]')), '[outv] 只能有一个来源').toHaveLength(1);
  });

  it('有理数帧率原样传递,不被取整', () => {
    const { filters } = buildStitchGraph(plan as any, src('30000/1001', true), true);
    expect(filters[filters.length - 1]).toContain('fps=30000/1001');
    expect(filters.join(';')).not.toMatch(/fps=30(?![0-9/])/);
  });
});
