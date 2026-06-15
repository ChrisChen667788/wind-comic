/**
 * v12.2.5 — 锁脸角色归一表(阶段二十一 B):upsertLockedCharacters 幂等 + getLockedCharactersByName 索引查。
 * 走真 SQLite(与其它 repo 单测一致)。
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { upsertLockedCharacters, getLockedCharactersByName, insertProjectFull, deleteProjectCascade } from '@/lib/repos/project-repo';
import { getDbDriver } from '@/lib/db-driver';

const P1 = 'plc-test-proj-1';
const P2 = 'plc-test-proj-2';
let USER = '';

describe('v12.2.5 · project_locked_characters 归一表', () => {
  beforeAll(async () => {
    const u = await getDbDriver().get<{ id: string }>('SELECT id FROM users ORDER BY created_at ASC LIMIT 1');
    USER = u?.id || 'demo-user';
    await deleteProjectCascade(P1).catch(() => {});
    await deleteProjectCascade(P2).catch(() => {});
  });

  it('insertProjectFull 双写归一表 + getLockedCharactersByName 索引查', async () => {
    await insertProjectFull({
      id: P1, userId: USER, title: 't1', description: 'd',
      lockedCharacters: [
        { name: '林小满', role: 'lead', cw: 125, imageUrl: 'http://x/1' },
        { name: '陈淮安', role: 'supporting', cw: 80, imageUrl: 'http://x/2' },
      ],
    } as any);
    const hits = await getLockedCharactersByName('林小满');
    expect(hits.some((h) => h.projectId === P1 && h.cw === 125 && h.role === 'lead')).toBe(true);
  });

  it('幂等:同项目重复 upsert 不翻倍(UNIQUE 守卫 + DELETE+INSERT)', async () => {
    await upsertLockedCharacters(P1, [{ name: '林小满', role: 'lead', cw: 100, imageUrl: 'http://x/1b' }]);
    await upsertLockedCharacters(P1, [{ name: '林小满', role: 'lead', cw: 110, imageUrl: 'http://x/1c' }]);
    const rows = await getDbDriver().query<{ c: number }>('SELECT COUNT(*) c FROM project_locked_characters WHERE project_id = ?', [P1]);
    expect(Number(rows[0].c)).toBe(1);                       // 不翻倍
    const hits = await getLockedCharactersByName('林小满');
    expect(hits.find((h) => h.projectId === P1)?.cw).toBe(110); // 最后一次胜
  });

  it('跨项目同名:getLockedCharactersByName 返回多个项目', async () => {
    await insertProjectFull({ id: P2, userId: USER, title: 't2', description: 'd', lockedCharacters: [{ name: '林小满', role: 'lead', cw: 125, imageUrl: 'http://y' }] } as any);
    const hits = await getLockedCharactersByName('林小满');
    expect(new Set(hits.map((h) => h.projectId)).size).toBeGreaterThanOrEqual(2);
  });

  it('脏数据(缺 name)跳过;空列表清空', async () => {
    await upsertLockedCharacters(P2, [{ role: 'lead' } as any, { name: '  ', cw: 1 } as any]);
    expect(await getLockedCharactersByName('林小满').then((h) => h.some((x) => x.projectId === P2))).toBe(false);
  });

  it('deleteProjectCascade 清归一行', async () => {
    await deleteProjectCascade(P1);
    const rows = await getDbDriver().query<{ c: number }>('SELECT COUNT(*) c FROM project_locked_characters WHERE project_id = ?', [P1]);
    expect(Number(rows[0].c)).toBe(0);
    await deleteProjectCascade(P2).catch(() => {});
  });
});
