/**
 * v6.0.1 修复回归 — 历史项目图片/视频无法查看.
 *
 * 根因: v4.2.3 异步化 asset-repo 时, listProjectAssets 的 SELECT 列漏了 persistent_url,
 * 导致 /api/projects/[id] 拿不到持久化副本 URL, normalizeAssetRow 回退到已过期的外链
 * media_urls → 历史项目所有图/视频 404. 本测试钉死: repo 必须选出 persistent_url,
 * 且 normalizeAssetRow 用本地副本顶替过期外链.
 */

import { describe, it, expect } from 'vitest';
import { nanoid } from 'nanoid';
import { db, now } from '@/lib/db';
import { listProjectAssets, getAsset } from '@/lib/repos/asset-repo';
import { normalizeAssetRow } from '@/lib/asset-storage';

function seed(persistentUrl: string | null, mediaUrls: string[]): { pid: string; aid: string } {
  const uid = 'u-' + nanoid();
  db.prepare(`INSERT INTO users (id, email, password_hash, name, role, created_at) VALUES (?, ?, ?, ?, 'user', ?)`)
    .run(uid, `${uid}@test.local`, 'x', 'n', now());
  const pid = 'proj-' + nanoid();
  db.prepare(`INSERT INTO projects (id, user_id, title, description, cover_urls, status, created_at, updated_at) VALUES (?, ?, 't', '', '[]', 'draft', ?, ?)`)
    .run(pid, uid, now(), now());
  const aid = 'a-' + nanoid();
  db.prepare(`INSERT INTO project_assets (id, project_id, type, name, data, media_urls, persistent_url, shot_number, version, created_at, updated_at)
              VALUES (?, ?, 'image', 'shot1', '{}', ?, ?, 1, 1, ?, ?)`)
    .run(aid, pid, JSON.stringify(mediaUrls), persistentUrl, now(), now());
  return { pid, aid };
}

describe('v6.0.1 · 历史项目媒体可见性 (persistent_url 回归)', () => {
  it('listProjectAssets 选出 persistent_url 列 (此前漏选 → 回归根因)', async () => {
    const { pid } = seed('/api/serve-file?key=abc1234567890def', ['https://cdn.expired/x.png']);
    const rows = await listProjectAssets(pid);
    expect(rows).toHaveLength(1);
    expect(rows[0].persistent_url).toBe('/api/serve-file?key=abc1234567890def');
  });

  it('normalizeAssetRow 用本地持久副本顶替过期外链 (历史项目能看图)', async () => {
    const persistent = '/api/serve-file?key=deadbeefdeadbeef';
    const { pid } = seed(persistent, ['https://cdn.midjourney.expired/abc.png']);
    const [row] = await listProjectAssets(pid);
    const { mediaUrls, persistentUrl } = normalizeAssetRow(row);
    expect(persistentUrl).toBe(persistent);
    expect(mediaUrls[0]).toBe(persistent); // 过期外链被本地副本顶替, 不再 404
  });

  it('无 persistent_url 时正常回退到 media_urls (未持久化的新资产)', async () => {
    const { pid } = seed(null, ['https://cdn.live/x.png']);
    const [row] = await listProjectAssets(pid);
    const { mediaUrls, persistentUrl } = normalizeAssetRow(row);
    expect(persistentUrl).toBeNull();
    expect(mediaUrls[0]).toBe('https://cdn.live/x.png');
  });

  it('getAsset 同样带 persistent_url', async () => {
    const { aid } = seed('/api/serve-file?key=cafecafecafecafe', ['https://x/y.png']);
    const a = await getAsset(aid);
    expect(a?.persistent_url).toBe('/api/serve-file?key=cafecafecafecafe');
  });
});
