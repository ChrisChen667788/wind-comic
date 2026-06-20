/**
 * v12.17.0(阶段二十六 多集生成)— 系列剧规划纯逻辑。
 */
import { describe, it, expect } from 'vitest';
import { seriesEpisodeTitle, validateSeriesInput, buildSeriesPlan, deriveSeriesId, selectGeneratableEpisodes } from '@/lib/series';

describe('v12.17.0 · seriesEpisodeTitle', () => {
  it('带/不带本集名', () => {
    expect(seriesEpisodeTitle('冷焰笼', 2, '困兽')).toBe('冷焰笼 第2集 困兽');
    expect(seriesEpisodeTitle('冷焰笼', 3)).toBe('冷焰笼 第3集');
  });
});

describe('v12.17.0 · validateSeriesInput', () => {
  it('空/缺 premise/超 50 集 → 拒;合法 → 过', () => {
    expect(validateSeriesInput([]).ok).toBe(false);
    expect(validateSeriesInput([{ premise: '' }]).ok).toBe(false);
    expect(validateSeriesInput(Array.from({ length: 51 }, () => ({ premise: 'x' }))).ok).toBe(false);
    expect(validateSeriesInput([{ premise: '主角觉醒' }]).ok).toBe(true);
  });
});

describe('v12.17.0 · buildSeriesPlan', () => {
  const episodes = [{ title: '困兽', premise: '铁笼初战' }, { premise: '复仇' }];

  it('集号从 startEpisode 递增 + 继承锚点一致性 + 归一画幅', () => {
    const specs = buildSeriesPlan({
      seriesId: 'series-x', seriesTitle: '冷焰笼', episodes,
      anchor: { aspect: '9:16', styleId: 'gritty', primaryCharacterRef: 'http://c.png', lockedCharacters: '[{"name":"沈夜"}]' },
      startEpisode: 2,
    });
    expect(specs.map((s) => s.episodeNumber)).toEqual([2, 3]);
    expect(specs[0].title).toBe('冷焰笼 第2集 困兽');
    expect(specs[1].title).toBe('冷焰笼 第3集');
    expect(specs[0].seriesId).toBe('series-x');
    expect(specs[0].aspect).toBe('9:16');
    expect(specs[0].styleId).toBe('gritty');
    expect(specs[0].primaryCharacterRef).toBe('http://c.png');
    expect(specs[0].lockedCharacters).toBe('[{"name":"沈夜"}]');
  });

  it('无锚点 → 集号从 1、一致性字段 null、画幅默认归一', () => {
    const specs = buildSeriesPlan({ seriesId: 's', seriesTitle: 'T', episodes });
    expect(specs[0].episodeNumber).toBe(1);
    expect(specs[0].styleId).toBeNull();
    expect(specs[0].primaryCharacterRef).toBeNull();
    expect(specs[0].aspect).toBe('16:9'); // 未给 → 默认横屏
  });
});

describe('v12.17.0 · deriveSeriesId', () => {
  it('从锚点项目 id 稳定派生', () => {
    expect(deriveSeriesId('proj-123')).toBe('series-proj-123');
  });
});

describe('v12.18.0/v12.21.0 · selectGeneratableEpisodes(批量生成挑集)', () => {
  const eps = [
    { id: 'a', status: 'draft' }, { id: 'b', status: 'active' },
    { id: 'c', status: 'completed' }, { id: 'd', status: 'draft' },
    { id: 'e', status: 'failed' },
  ];
  it('默认取 draft + failed(可重试),跳过生成中/已完成', () => {
    expect(selectGeneratableEpisodes(eps).map((e) => e.id)).toEqual(['a', 'd', 'e']);
  });
  it('force=true 重生除「生成中」外的所有集', () => {
    expect(selectGeneratableEpisodes(eps, { force: true }).map((e) => e.id)).toEqual(['a', 'c', 'd', 'e']);
  });
});
