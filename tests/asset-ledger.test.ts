/**
 * v10.6.1 — 资产连续性台账单测。
 * 验收核心编码:「改一件服装描述 → 台账标出受影响镜头清单」。
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { nanoid } from 'nanoid';
import { db, now } from '@/lib/db';
import { buildLedger, mergeLedger, applyDescriptionChange, addManualEntry } from '@/lib/asset-ledger';
import { createAsset, setAssetsStaleByShots } from '@/lib/repos/asset-repo';

const SHOTS = [
  { shotNumber: 1, scene: '霓虹雨巷', character: '程一帆', description: '雨夜全景', dialogue: '…' },
  { shotNumber: 2, scene: '霓虹雨巷', character: '程一帆', description: '示波器与旧照片', dialogue: '…' },
  { shotNumber: 3, scene: '城市天台', character: '苏雨眠', description: '逆光剪影', dialogue: '…' },
  { shotNumber: 4, scene: '城市天台', character: '程一帆', description: '对峙,攥紧旧照片', dialogue: '…' },
];
const CHARS = [
  { name: '程一帆', appearance: '黑色工装外套、深灰围巾' },
  { name: '苏雨眠', appearance: '米白风衣、黑伞' },
];
const SCENES = [{ name: '霓虹雨巷', description: '霓虹招牌层叠' }, { name: '城市天台', description: '发射塔' }];

describe('v10.6.1 · buildLedger 登记三来源', () => {
  const ledger = buildLedger({ shots: SHOTS, characters: CHARS, scenes: SCENES, keyProps: ['旧照片'] });

  it('服装:每角色一条,引用镜 = 出场镜', () => {
    const cyf = ledger.entries.find((e) => e.id === 'costume:程一帆')!;
    expect(cyf.shotNumbers).toEqual([1, 2, 4]);
    expect(cyf.description).toContain('工装外套');
    expect(ledger.entries.find((e) => e.id === 'costume:苏雨眠')!.shotNumbers).toEqual([3]);
  });

  it('场景:引用镜按 scene 字段', () => {
    expect(ledger.entries.find((e) => e.id === 'scene:霓虹雨巷')!.shotNumbers).toEqual([1, 2]);
    expect(ledger.entries.find((e) => e.id === 'scene:城市天台')!.shotNumbers).toEqual([3, 4]);
  });

  it('道具:按描述词匹配', () => {
    expect(ledger.entries.find((e) => e.id === 'prop:旧照片')!.shotNumbers).toEqual([2, 4]);
  });
});

describe('v10.6.1 · 验收:改服装描述 → 受影响镜头清单', () => {
  it('改「程一帆 · 服装」→ 清单 = [1,2,4]', () => {
    const ledger = buildLedger({ shots: SHOTS, characters: CHARS, scenes: SCENES });
    const r = applyDescriptionChange(ledger, 'costume:程一帆', '深蓝雨衣、无围巾')!;
    expect(r.affectedShots).toEqual([1, 2, 4]);
    expect(r.entry.description).toBe('深蓝雨衣、无围巾');
    // 原 ledger 不被原地改(纯函数)
    expect(ledger.entries.find((e) => e.id === 'costume:程一帆')!.description).toContain('工装外套');
  });

  it('条目不存在 → null', () => {
    expect(applyDescriptionChange({ entries: [] }, 'x', 'y')).toBeNull();
  });
});

describe('v10.6.1 · merge / 手动登记', () => {
  it('重建合并:人工描述保留、手动条目保留', () => {
    let ledger = buildLedger({ shots: SHOTS, characters: CHARS, scenes: SCENES });
    ledger = applyDescriptionChange(ledger, 'costume:程一帆', '人工校准过的描述')!.ledger;
    ledger = addManualEntry(ledger, { kind: 'prop', name: '发报机' }, SHOTS);
    const merged = mergeLedger(ledger, buildLedger({ shots: SHOTS, characters: CHARS, scenes: SCENES }));
    expect(merged.entries.find((e) => e.id === 'costume:程一帆')!.description).toBe('人工校准过的描述');
    expect(merged.entries.find((e) => e.id === 'prop:发报机')).toBeTruthy();
  });

  it('手动登记同名幂等', () => {
    let l = addManualEntry({ entries: [] }, { kind: 'prop', name: '黑伞' }, SHOTS);
    expect(addManualEntry(l, { kind: 'prop', name: '黑伞' }, SHOTS)).toBe(l);
  });
});

describe('v10.6.1 · setAssetsStaleByShots(真 DB)', () => {
  let projectId: string;
  beforeAll(async () => {
    const uid = 'u-' + nanoid();
    db.prepare(`INSERT INTO users (id, email, password_hash, name, role, created_at) VALUES (?, ?, ?, ?, 'user', ?)`)
      .run(uid, `${uid}@test.local`, 'x', uid, now());
    projectId = 'proj-' + nanoid();
    db.prepare(`INSERT INTO projects (id, user_id, title, description, cover_urls, status, created_at, updated_at) VALUES (?, ?, 'l', '', '[]', 'active', ?, ?)`)
      .run(projectId, uid, now(), now());
    for (const n of [1, 2, 3]) {
      await createAsset({ projectId, type: 'storyboard', name: `镜头 ${n}`, data: {}, shotNumber: n });
    }
  });

  it('只失效命中镜号,其余不动', async () => {
    const changed = await setAssetsStaleByShots(projectId, ['storyboard'], [1, 3], true);
    expect(changed).toBe(2);
    // asset-repo COLS 不含 stale 列(读侧未暴露)→ 直查 DB
    const rows = db.prepare("SELECT shot_number, stale FROM project_assets WHERE project_id = ? AND type = 'storyboard'").all(projectId) as any[];
    const staleByShot = Object.fromEntries(rows.map((r: any) => [r.shot_number, r.stale]));
    expect(staleByShot[1]).toBe(1);
    expect(staleByShot[2]).toBe(0);
    expect(staleByShot[3]).toBe(1);
  });

  it('空数组零操作', async () => {
    expect(await setAssetsStaleByShots(projectId, [], [1], true)).toBe(0);
    expect(await setAssetsStaleByShots(projectId, ['storyboard'], [], true)).toBe(0);
  });
});
