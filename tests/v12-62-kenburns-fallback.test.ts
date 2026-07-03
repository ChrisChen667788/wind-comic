/**
 * v12.62 — 失败镜 Ken Burns 兜底:画幅感知滤镜纯函数。
 * 病根:引擎偶发错误让 10 分镜只成 3 视频 → 16s 残片;且旧 zoompan 写死 s=1280x720,
 * 竖屏项目兜底片会被画布 crop 掉 ~70% 宽。
 */
import { describe, it, expect } from 'vitest';
import { kenBurnsFilter } from '@/services/video-composer';

describe('v12.62 · kenBurnsFilter 画幅感知', () => {
  it('缺省 = 旧行为逐字段(1280x720、4x 上采样、zoom-in)', () => {
    const vf = kenBurnsFilter('in', 120);
    expect(vf).toContain('scale=5120:2880:force_original_aspect_ratio=increase');
    expect(vf).toContain('crop=5120:2880');
    expect(vf).toContain('s=1280x720');
    expect(vf).toContain("z='min(zoom+0.0008,1.3)'");
    expect(vf.endsWith('format=yuv420p')).toBe(true);
  });

  it('竖屏 720x1280:上采样画布同比例 2880x5120,输出 s=720x1280', () => {
    const vf = kenBurnsFilter('in', 96, 720, 1280);
    expect(vf).toContain('scale=2880:5120');
    expect(vf).toContain('crop=2880:5120');
    expect(vf).toContain('s=720x1280');
  });

  it('zoom-out 与 pan 表达式各不同;pan 带帧数插值', () => {
    expect(kenBurnsFilter('out', 100)).toContain("if(eq(on,1),1.3");
    const pan = kenBurnsFilter('pan', 77);
    expect(pan).toContain("z='1.2'");
    expect(pan).toContain('/77');
  });

  it('fps 透传进 zoompan', () => {
    expect(kenBurnsFilter('in', 100, 1280, 720, 30)).toContain('fps=30');
  });
});
