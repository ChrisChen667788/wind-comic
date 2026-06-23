/**
 * 阶段三十 v12.38.0 — 剪映草稿导出映射单测(纯函数)。
 */
import { describe, expect, it } from 'vitest';
import { buildJianYingDraft, buildJianYingMeta } from '@/lib/jianying-export';

describe('buildJianYingDraft', () => {
  it('视频轨:按序累积时间码(微秒),总时长=各镜之和', () => {
    const d = buildJianYingDraft({ clips: [{ path: '/a.mp4', durationSec: 3 }, { path: '/b.mp4', durationSec: 5 }] }) as any;
    expect(d.duration).toBe(8_000_000);
    const vt = d.tracks.find((t: any) => t.type === 'video');
    expect(vt.segments.length).toBe(2);
    expect(vt.segments[0].target_timerange).toEqual({ start: 0, duration: 3_000_000 });
    expect(vt.segments[1].target_timerange).toEqual({ start: 3_000_000, duration: 5_000_000 });
    expect(d.materials.videos.length).toBe(2);
  });

  it('画布/帧率默认 1920x1080@30,可覆盖', () => {
    const d = buildJianYingDraft({ clips: [{ path: '/a.mp4', durationSec: 1 }] }) as any;
    expect(d.canvas_config).toMatchObject({ width: 1920, height: 1080 });
    expect(d.fps).toBe(30);
    const d2 = buildJianYingDraft({ clips: [{ path: '/a.mp4', durationSec: 1 }], width: 1080, height: 1920, fps: 24 }) as any;
    expect(d2.canvas_config).toMatchObject({ width: 1080, height: 1920 });
    expect(d2.fps).toBe(24);
  });

  it('配音 → 音频轨,按 startSec 对齐(微秒)', () => {
    const d = buildJianYingDraft({ clips: [{ path: '/a.mp4', durationSec: 5 }], voiceovers: [{ path: '/vo1.mp3', startSec: 0.5, durationSec: 2 }] }) as any;
    const at = d.tracks.find((t: any) => t.type === 'audio');
    expect(at.segments[0].target_timerange).toEqual({ start: 500_000, duration: 2_000_000 });
    expect(d.materials.audios.length).toBe(1);
  });

  it('BGM → 独立音频轨,铺满全片、音量 0.3', () => {
    const d = buildJianYingDraft({ clips: [{ path: '/a.mp4', durationSec: 4 }], bgm: { path: '/bgm.mp3', durationSec: 60 } }) as any;
    const audioTracks = d.tracks.filter((t: any) => t.type === 'audio');
    expect(audioTracks.length).toBe(1);
    expect(audioTracks[0].segments[0].volume).toBe(0.3);
    expect(audioTracks[0].segments[0].target_timerange.duration).toBe(4_000_000); // 铺满成片
  });

  it('字幕 → 文本轨', () => {
    const d = buildJianYingDraft({ clips: [{ path: '/a.mp4', durationSec: 5 }], subtitles: [{ text: '你好', startSec: 1, durationSec: 2 }] }) as any;
    const tt = d.tracks.find((t: any) => t.type === 'text');
    expect(tt.segments.length).toBe(1);
    expect(d.materials.texts[0].content).toBe('你好');
  });

  it('无配音/BGM/字幕 → 只有视频轨', () => {
    const d = buildJianYingDraft({ clips: [{ path: '/a.mp4', durationSec: 1 }] }) as any;
    expect(d.tracks.map((t: any) => t.type)).toEqual(['video']);
  });
});

describe('buildJianYingMeta', () => {
  it('最小 meta 字段', () => {
    const m = buildJianYingMeta('片子', 'draft-1', 8_000_000) as any;
    expect(m).toMatchObject({ draft_name: '片子', draft_id: 'draft-1', tm_duration: 8_000_000 });
  });
});
