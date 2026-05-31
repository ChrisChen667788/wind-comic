/**
 * v9.0.3c — character-repo async (SQLite driver, 真 DB).
 */
import { describe, it, expect } from 'vitest';
import { nanoid } from 'nanoid';
import { getDbDriver } from '@/lib/db-driver';
import {
  createCharacter, getCharacter, listCharactersByUser,
  updateCharacter, updateCharacterProfile, deleteCharacter,
} from '@/lib/repos/character-repo';

async function seedUser(): Promise<string> {
  const id = 'cu-' + nanoid();
  await getDbDriver().run(
    `INSERT INTO users (id, email, password_hash, name, role, created_at) VALUES (?, ?, ?, ?, 'user', ?)`,
    [id, `${id}@t.local`, 'x', id, new Date().toISOString()],
  );
  return id;
}

describe('v9.0.3c · character-repo (async через DbDriver)', () => {
  it('create + get round-trip (JSON 字段 + 默认 usage_count=0)', async () => {
    const uid = await seedUser();
    const row = await createCharacter({
      userId: uid, name: '萧炎', description: '斗破', appearance: '黑袍',
      visualTags: ['少年', '炎决'], imageUrls: ['https://x/1.png'], styleKeywords: '玄幻',
    });
    expect(row.name).toBe('萧炎');
    expect(row.usage_count).toBe(0);
    const got = await getCharacter(row.id);
    expect(got?.user_id).toBe(uid);
    expect(JSON.parse(got!.visual_tags)).toEqual(['少年', '炎决']);
    expect(JSON.parse(got!.image_urls)).toEqual(['https://x/1.png']);
    expect(got?.profile).toBeNull();
  });

  it('listCharactersByUser 仅本人 + created_at DESC', async () => {
    const uid = await seedUser();
    await createCharacter({ userId: uid, name: 'A' });
    await new Promise((r) => setTimeout(r, 5));
    await createCharacter({ userId: uid, name: 'B' });
    const other = await seedUser();
    await createCharacter({ userId: other, name: '别人' });
    const list = await listCharactersByUser(uid);
    expect(list).toHaveLength(2);
    expect(list.every((c) => c.user_id === uid)).toBe(true);
    expect(list[0].name).toBe('B'); // 最新在前
  });

  it('updateCharacter 全字段更新 → 返回更新后的行', async () => {
    const uid = await seedUser();
    const row = await createCharacter({ userId: uid, name: 'old', description: 'od' });
    const before = row.updated_at;
    await new Promise((r) => setTimeout(r, 5));
    const updated = await updateCharacter(row.id, {
      name: 'new', description: 'nd', appearance: 'na',
      visualTags: ['t1'], imageUrls: ['u1'], styleKeywords: 'sk', usageCount: 3,
    });
    expect(updated?.name).toBe('new');
    expect(updated?.usage_count).toBe(3);
    expect(JSON.parse(updated!.visual_tags)).toEqual(['t1']);
    expect(updated?.updated_at).not.toBe(before);
  });

  it('updateCharacterProfile: 仅 profile / profile + imageUrls', async () => {
    const uid = await seedUser();
    const row = await createCharacter({ userId: uid, name: 'P', imageUrls: ['old.png'] });
    expect(await updateCharacterProfile(row.id, '{"bio":"x"}')).toBe(true);
    let got = await getCharacter(row.id);
    expect(got?.profile).toBe('{"bio":"x"}');
    expect(JSON.parse(got!.image_urls)).toEqual(['old.png']); // 未带 imageUrls → 不动

    expect(await updateCharacterProfile(row.id, '{"bio":"y"}', ['old.png', 'new.png'])).toBe(true);
    got = await getCharacter(row.id);
    expect(got?.profile).toBe('{"bio":"y"}');
    expect(JSON.parse(got!.image_urls)).toEqual(['old.png', 'new.png']);
  });

  it('deleteCharacter', async () => {
    const uid = await seedUser();
    const row = await createCharacter({ userId: uid, name: 'D' });
    expect(await deleteCharacter(row.id)).toBe(true);
    expect(await getCharacter(row.id)).toBeNull();
    expect(await deleteCharacter(row.id)).toBe(false); // 已删
  });
});
