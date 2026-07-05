/**
 * v12.67 — BGM 自动闪避:sidechain 滤镜构造 + 启用判定。
 */
import { describe, it, expect } from 'vitest';
import { buildDuckingFilters, shouldDuck } from '@/lib/audio-ducking';

describe('v12.67 · BGM ducking', () => {
  it('buildDuckingFilters:asplit 复制配音 + sidechaincompress 压 BGM', () => {
    const d = buildDuckingFilters('[musicvol]', '[vomix]');
    expect(d.filters[0]).toBe('[vomix]asplit=2[duck_sc][duck_vo]');
    expect(d.filters[1]).toContain('[musicvol][duck_sc]sidechaincompress=');
    expect(d.filters[1]).toContain('threshold=0.02');
    expect(d.filters[1]).toContain('ratio=6');
    expect(d.musicOut).toBe('[duck_music]');
    expect(d.voOut).toBe('[duck_vo]');
  });

  it('单段配音标签(非 vomix)同样可作 sidechain 源', () => {
    const d = buildDuckingFilters('[musicvol]', '[vo0]');
    expect(d.filters[0].startsWith('[vo0]asplit=2')).toBe(true);
  });

  it('shouldDuck:BGM+配音齐备才开;env 可关', () => {
    expect(shouldDuck(true, 3, {} as any)).toBe(true);
    expect(shouldDuck(false, 3, {} as any)).toBe(false);
    expect(shouldDuck(true, 0, {} as any)).toBe(false);
    expect(shouldDuck(true, 3, { BGM_DUCK_DISABLE: '1' } as any)).toBe(false);
  });
});

describe('v12.110 · 响度归一', () => {
  it('buildLoudnormFilter:-14 LUFS/-1.5 dBTP,标签接续正确', async () => {
    const { buildLoudnormFilter } = await import('@/lib/audio-ducking');
    expect(buildLoudnormFilter('[outa]')).toBe('[outa]loudnorm=I=-14:TP=-1.5:LRA=11[anorm]');
    expect(buildLoudnormFilter('[outfinal]', '[x]')).toBe('[outfinal]loudnorm=I=-14:TP=-1.5:LRA=11[x]');
  });
  it('shouldLoudnorm:默认开,env 可关', async () => {
    const { shouldLoudnorm } = await import('@/lib/audio-ducking');
    expect(shouldLoudnorm({} as any)).toBe(true);
    expect(shouldLoudnorm({ AUDIO_LOUDNORM_DISABLE: '1' } as any)).toBe(false);
  });
});
