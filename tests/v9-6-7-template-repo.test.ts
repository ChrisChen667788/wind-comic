/**
 * v9.6.7 — template-repo (async, SQLite driver, 真 DB):film_templates 落库 + 市场检索 + use 计数。
 */
import { describe, it, expect } from 'vitest';
import { nanoid } from 'nanoid';
import { extractTemplate } from '@/lib/template-market';
import { saveTemplate, getTemplate, listMarketTemplates, listOwnerTemplates, recordTemplateUse } from '@/lib/repos/template-repo';

describe('v9.6.7 · template-repo', () => {
  it('saveTemplate + getTemplate 往返(payload/elements/tags/质量分)', async () => {
    const tpl = extractTemplate({
      id: 'x', title: '  我的模板  ', style: 'American Comic', genre: '热血',
      elements: [{ role: 'character', count: 2 }], pacingTone: '快节奏', shotCount: 24,
      signals: { publishLevel: 'pass' }, sourceProjectId: 'p1',
    });
    const saved = await saveTemplate({ template: tpl, ownerId: 'owner-A', payload: { style: 'american-comic', references: [{ id: 'r1' }], voiceOverrides: { 女主: 'young_female_cn' }, previewVideoUrl: '/x/shot1.mp4' }, visibility: 'public' });
    expect(saved.id).toMatch(/^tpl_/);
    expect(saved.quality).toBe(90);
    const got = await getTemplate(saved.id);
    expect(got?.title).toBe('我的模板');
    expect(got?.payload?.style).toBe('american-comic');
    expect(got?.payload?.references).toEqual([{ id: 'r1' }]);
    expect(got?.payload?.voiceOverrides).toEqual({ 女主: 'young_female_cn' }); // v9.7.9 音色入模板
    expect(got?.payload?.previewVideoUrl).toBe('/x/shot1.mp4'); // v9.7.12 预览片入模板
    expect(got?.elements).toEqual([{ role: 'character', count: 2 }]);
    expect(got?.tags).toEqual(expect.arrayContaining(['American Comic', '热血', '快节奏', '角色']));
    expect(got?.visibility).toBe('public');
  });

  it('listMarketTemplates 只返公开 + 质量降序', async () => {
    const uniq = 'mk-' + nanoid(8);
    await saveTemplate({ template: extractTemplate({ id: 'a', title: 'A', style: uniq, signals: { publishLevel: 'block' } }), visibility: 'public' }); // 40
    await saveTemplate({ template: extractTemplate({ id: 'b', title: 'B', style: uniq, signals: { publishLevel: 'pass' } }), visibility: 'public' });  // 90
    await saveTemplate({ template: extractTemplate({ id: 'c', title: 'C', style: uniq, signals: { publishLevel: 'warn' } }), visibility: 'private' }); // 私有,排除
    const market = await listMarketTemplates({ style: uniq });
    expect(market.map((t) => t.title)).toEqual(['B', 'A']);
  });

  it('listOwnerTemplates 按 owner', async () => {
    const owner = 'own-' + nanoid(8);
    await saveTemplate({ template: extractTemplate({ id: 'o', title: 'OwnerTpl', style: 'x' }), ownerId: owner });
    const mine = await listOwnerTemplates(owner);
    expect(mine).toHaveLength(1);
    expect(mine[0].title).toBe('OwnerTpl');
  });

  it('recordTemplateUse 自增 + 不存在 → false', async () => {
    const s = await saveTemplate({ template: extractTemplate({ id: 'u', title: 'U', style: 'x' }) });
    expect(await recordTemplateUse(s.id)).toBe(true);
    expect((await getTemplate(s.id))?.useCount).toBe(1);
    expect(await recordTemplateUse('tpl_missing')).toBe(false);
  });
});
