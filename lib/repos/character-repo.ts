/**
 * v9.0.3c — 角色库仓库 (async, 走 DbDriver).
 *
 * PG 迁移阶段十一新建 repo 第三个: character_library 域 (用户的可复用角色档案)。
 * SQLite/PG 双驱动, 占位符统一 `?`。返回 **原始行** (snake_case) —— 路由各自做
 * snake→camel + JSON.parse 映射, 迁移时改动最小。
 * 旧路由的 demo 行为保留: update/delete 按 id (无 owner 守卫)。
 *
 * 单测: tests/v9-0-3c-character-repo.test.ts.
 */
import { nanoid } from 'nanoid';
import { getDbDriver } from '../db-driver';

export interface CharacterRow {
  id: string;
  user_id: string;
  name: string;
  description: string;
  appearance: string;
  visual_tags: string;     // JSON
  image_urls: string;      // JSON
  style_keywords: string;
  usage_count: number;
  profile: string | null;          // v6.0.1
  source_token_id: string | null;  // v4.0.1 (cameo import)
  created_at: string;
  updated_at: string;
}

export async function getCharacter(id: string): Promise<CharacterRow | null> {
  return getDbDriver().get<CharacterRow>('SELECT * FROM character_library WHERE id = ?', [id]);
}

export async function listCharactersByUser(userId: string): Promise<CharacterRow[]> {
  return getDbDriver().query<CharacterRow>(
    'SELECT * FROM character_library WHERE user_id = ? ORDER BY created_at DESC', [userId],
  );
}

export interface CreateCharacterInput {
  id?: string;
  userId: string;
  name: string;
  description?: string;
  appearance?: string;
  visualTags?: string[];
  imageUrls?: string[];
  styleKeywords?: string;
}

export async function createCharacter(input: CreateCharacterInput): Promise<CharacterRow> {
  const id = input.id || nanoid();
  const ts = new Date().toISOString();
  await getDbDriver().run(
    `INSERT INTO character_library
      (id, user_id, name, description, appearance, visual_tags, image_urls, style_keywords, usage_count, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id, input.userId, input.name, input.description ?? '', input.appearance ?? '',
      JSON.stringify(input.visualTags ?? []), JSON.stringify(input.imageUrls ?? []),
      input.styleKeywords ?? '', 0, ts, ts,
    ],
  );
  const row = await getCharacter(id);
  if (!row) throw new Error('createCharacter: 插入后读取失败');
  return row;
}

export interface UpdateCharacterFields {
  name: string;
  description: string;
  appearance: string;
  visualTags: string[];
  imageUrls: string[];
  styleKeywords: string;
  usageCount: number;
}

/** 全字段更新 (PUT). 调用方已用现值兜底每个字段. 返回更新后的行. */
export async function updateCharacter(id: string, f: UpdateCharacterFields): Promise<CharacterRow | null> {
  await getDbDriver().run(
    `UPDATE character_library SET
       name = ?, description = ?, appearance = ?, visual_tags = ?, image_urls = ?,
       style_keywords = ?, usage_count = ?, updated_at = ?
     WHERE id = ?`,
    [
      f.name, f.description, f.appearance, JSON.stringify(f.visualTags), JSON.stringify(f.imageUrls),
      f.styleKeywords, f.usageCount, new Date().toISOString(), id,
    ],
  );
  return getCharacter(id);
}

/** v6.0.1 角色资产中心: 落 profile JSON; 若带 imageUrls 则一并更新 image_urls. */
export async function updateCharacterProfile(id: string, profileJson: string, imageUrls?: string[]): Promise<boolean> {
  const ts = new Date().toISOString();
  let r;
  if (imageUrls !== undefined) {
    r = await getDbDriver().run(
      'UPDATE character_library SET profile = ?, image_urls = ?, updated_at = ? WHERE id = ?',
      [profileJson, JSON.stringify(imageUrls), ts, id],
    );
  } else {
    r = await getDbDriver().run(
      'UPDATE character_library SET profile = ?, updated_at = ? WHERE id = ?',
      [profileJson, ts, id],
    );
  }
  return r.changes > 0;
}

export async function deleteCharacter(id: string): Promise<boolean> {
  const r = await getDbDriver().run('DELETE FROM character_library WHERE id = ?', [id]);
  return r.changes > 0;
}
