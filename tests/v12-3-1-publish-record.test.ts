/**
 * v12.3.1 — 发布记录仓库(阶段二十二)。走真 SQLite(publish_records 无 FK)。
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { recordPublish, listPublishRecords } from '@/lib/repos/publish-record-repo';
import { getDbDriver } from '@/lib/db-driver';

const P = 'pubrec-test-proj';

describe('v12.3.1 · publish-record-repo', () => {
  beforeAll(async () => {
    await getDbDriver().run('DELETE FROM publish_records WHERE project_id = ?', [P]);
  });

  it('recordPublish 落行 + 字段回读', async () => {
    const r = await recordPublish({ projectId: P, platform: 'douyin', status: 'packaged', shareUrl: '/share/abc', title: '钩子标题' });
    expect(r.id).toMatch(/^pub_/);
    expect(r.platform).toBe('douyin');
    expect(r.status).toBe('packaged');
    expect(r.shareUrl).toBe('/share/abc');
    expect(r.publishedAt).toBeNull();              // packaged 不写 publishedAt
  });

  it("status='published' 自动写 publishedAt", async () => {
    const r = await recordPublish({ projectId: P, platform: 'bilibili', status: 'published' });
    expect(r.status).toBe('published');
    expect(typeof r.publishedAt).toBe('string');
  });

  it('listPublishRecords 新到旧', async () => {
    const list = await listPublishRecords(P);
    expect(list.length).toBeGreaterThanOrEqual(2);
    // 最新一条(bilibili/published)在前
    expect(list[0].platform).toBe('bilibili');
    expect(list.every((x) => x.projectId === P)).toBe(true);
    await getDbDriver().run('DELETE FROM publish_records WHERE project_id = ?', [P]);
  });
});
