/**
 * v9.7.16 — 模板评分 / 收藏(template-repo,真 SQLite 往返)。
 */
import { describe, it, expect } from 'vitest';
import { nanoid } from 'nanoid';
import { extractTemplate } from '@/lib/template-market';
import {
  saveTemplate, getTemplate, rateTemplate, getUserRating, toggleFavorite, listFavoriteIds, listFavoriteTemplates,
} from '@/lib/repos/template-repo';

const mkTemplate = () => saveTemplate({ template: extractTemplate({ id: 'x', title: 'RateMe', style: 'anime' }) });

describe('v9.7.16 · 评分', () => {
  it('多用户评分聚合 + 去重 re-rate + getUserRating', async () => {
    const t = await mkTemplate();
    const uA = 'u-' + nanoid(6); const uB = 'u-' + nanoid(6);
    expect(await rateTemplate(t.id, uA, 4)).toEqual({ avg: 4, count: 1 });
    expect(await rateTemplate(t.id, uB, 2)).toEqual({ avg: 3, count: 2 }); // (4+2)/2
    expect(await rateTemplate(t.id, uA, 5)).toEqual({ avg: 3.5, count: 2 }); // 去重:uA 改 4→5 → (5+2)/2
    expect(await getUserRating(t.id, uA)).toBe(5);
    expect((await getTemplate(t.id))?.ratingAvg).toBe(3.5);
    expect((await getTemplate(t.id))?.ratingCount).toBe(2);
  });
  it('评分夹紧 1-5 + 不存在模板 → null', async () => {
    const t = await mkTemplate();
    expect((await rateTemplate(t.id, 'u1', 9))?.avg).toBe(5);  // 夹到 5
    expect(await rateTemplate('tpl_missing', 'u1', 3)).toBeNull();
  });
});

describe('v9.7.16 · 收藏', () => {
  it('收藏 / 取消 + 我的收藏列表', async () => {
    const t = await mkTemplate();
    const u = 'u-' + nanoid(6);
    expect(await toggleFavorite(u, t.id, true)).toBe(true);
    expect(await listFavoriteIds(u)).toContain(t.id);
    expect((await listFavoriteTemplates(u)).map((x) => x.id)).toContain(t.id);
    expect(await toggleFavorite(u, t.id, false)).toBe(false);
    expect(await listFavoriteIds(u)).not.toContain(t.id);
  });
  it('重复收藏幂等(ON CONFLICT DO NOTHING)', async () => {
    const t = await mkTemplate();
    const u = 'u-' + nanoid(6);
    await toggleFavorite(u, t.id, true);
    await toggleFavorite(u, t.id, true);
    expect((await listFavoriteIds(u)).filter((id) => id === t.id)).toHaveLength(1);
  });
});
