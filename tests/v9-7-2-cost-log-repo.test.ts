/**
 * v9.7.2 — cost-log-repo(首个 cost_log 生产写入器)+ TTS/口型成本估算 + 归类驱动 T3。
 */
import { describe, it, expect } from 'vitest';
import { nanoid } from 'nanoid';
import { getDbDriver } from '@/lib/db-driver';
import { recordCostLog, estimateTtsCostCny, estimateLipsyncCostCny } from '@/lib/repos/cost-log-repo';
import { classifyEngineCategory, costEventsFromCostLog, attributeCost } from '@/lib/cost-attribution';

async function seedUser(): Promise<string> {
  const id = 'clu-' + nanoid();
  await getDbDriver().run(
    `INSERT INTO users (id, email, password_hash, name, role, created_at) VALUES (?, ?, ?, ?, 'user', ?)`,
    [id, `${id}@t.local`, 'x', id, new Date().toISOString()],
  );
  return id;
}

describe('v9.7.2 · 成本估算', () => {
  it('TTS:有时长 ~¥0.02/s,否则按字 ~¥0.004/字', () => {
    expect(estimateTtsCostCny(10)).toBe(0.2);
    expect(estimateTtsCostCny(0, 50)).toBe(0.2);
  });
  it('口型:引擎值优先,否则 ~¥0.15/s,最低 ¥0.1', () => {
    expect(estimateLipsyncCostCny(0.5)).toBe(0.5);
    expect(estimateLipsyncCostCny(undefined, 4)).toBe(0.6);
    expect(estimateLipsyncCostCny(undefined, 0)).toBe(0.1);
  });
});

describe('v9.7.2 · engine 串归类(驱动 T3 成本面板)', () => {
  it('tts-* → tts;lipsync-* → lipsync', () => {
    expect(classifyEngineCategory('tts-minimax')).toBe('tts');
    expect(classifyEngineCategory('lipsync-wav2lip-http')).toBe('lipsync');
  });
});

describe('v9.7.2 · recordCostLog', () => {
  it('落库 + 项目维度归因(TTS + 口型 → T3)', async () => {
    const user = await seedUser();
    const pid = 'pcl-' + nanoid(8);
    expect(await recordCostLog({ userId: user, projectId: pid, engine: 'tts-minimax', durationSec: 5, costCny: 0.1 })).toBe(true);
    expect(await recordCostLog({ userId: user, projectId: pid, engine: 'lipsync-wav2lip-http', costCny: 0.3 })).toBe(true);
    const rows = await getDbDriver().query<any>(`SELECT engine, cost_cny FROM cost_log WHERE project_id = ?`, [pid]);
    const attr = attributeCost(costEventsFromCostLog(rows.map((r) => ({ engine: r.engine, costCny: Number(r.cost_cny) }))));
    expect(attr.totalCny).toBe(0.4);
    expect(attr.byCategory.map((c) => c.category).sort()).toEqual(['lipsync', 'tts']);
  });

  it('userId 缺失 / 负成本 → false(不插)', async () => {
    expect(await recordCostLog({ userId: null, engine: 'tts-x', costCny: 1 })).toBe(false);
    const user = await seedUser();
    expect(await recordCostLog({ userId: user, engine: 'tts-x', costCny: -5 })).toBe(false);
  });
});
