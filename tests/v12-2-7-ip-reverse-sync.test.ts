/**
 * v12.2.7 — IP 反向同步(阶段二十一 B):token 撤销 → 扇出失效到导入方 character_library 行
 * (标 stale=1 + 给行主人发通知)。走真 SQLite。
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { issueIpToken, revokeIpToken, fanOutTokenInvalidation } from '@/lib/repos/cameo-ip-repo';
import { getDbDriver } from '@/lib/db-driver';

let OWNER = '';
let IMPORTER = '';
const CHAR_ID = 'ip-rev-char-owner';
const IMPORTED_ID = 'ip-rev-char-imported';

async function pickUsers() {
  const us = await getDbDriver().query<{ id: string }>('SELECT id FROM users ORDER BY created_at ASC LIMIT 2');
  OWNER = us[0]?.id || 'demo-user';
  IMPORTER = us[1]?.id || OWNER;
}
async function seedChar(id: string, userId: string, sourceToken?: string) {
  const ts = new Date().toISOString();
  await getDbDriver().run(
    `INSERT OR REPLACE INTO character_library (id, user_id, name, description, appearance, visual_tags, image_urls, style_keywords, usage_count, created_at, updated_at, source_token_id, stale)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [id, userId, '银发剑客', '', '', '[]', '[]', '', 0, ts, ts, sourceToken ?? null, 0],
  );
}

describe('v12.2.7 · IP 反向同步', () => {
  beforeAll(async () => {
    await pickUsers();
    await seedChar(CHAR_ID, OWNER);                 // 角色本体(owner 的)
  });

  it('撤销 token → 导入行标 stale + 发通知', async () => {
    const token = await issueIpToken({ characterId: CHAR_ID, ownerId: OWNER, name: '银发剑客', visibility: 'public', license: 'cc', terms: '', royaltyCny: 0 } as any);
    await seedChar(IMPORTED_ID, IMPORTER, token.id); // importer 导入了该 token

    const before = await getDbDriver().get<{ c: number }>('SELECT COUNT(*) c FROM notifications WHERE recipient_user_id = ? AND type = ?', [IMPORTER, 'ip_revoked']);
    const ok = await revokeIpToken(token.id, OWNER);
    expect(ok).toBe(true);

    const row = await getDbDriver().get<{ stale: number }>('SELECT stale FROM character_library WHERE id = ?', [IMPORTED_ID]);
    expect(Number(row?.stale)).toBe(1);             // 导入行已标 stale

    const after = await getDbDriver().get<{ c: number }>('SELECT COUNT(*) c FROM notifications WHERE recipient_user_id = ? AND type = ?', [IMPORTER, 'ip_revoked']);
    expect(Number(after?.c)).toBe(Number(before?.c) + 1); // importer 收到一条 ip_revoked 通知

    // 清理
    await getDbDriver().run('DELETE FROM character_library WHERE id IN (?,?)', [CHAR_ID, IMPORTED_ID]).catch(() => {});
  });

  it('无导入方 → fanOut 返回 0(不崩、不发通知)', async () => {
    const token = await issueIpToken({ characterId: 'ip-rev-noimport', ownerId: OWNER, name: '孤角', visibility: 'public', license: 'cc', terms: '', royaltyCny: 0 } as any);
    const n = await fanOutTokenInvalidation(token, 'revoked');
    expect(n).toBe(0);
  });
});
