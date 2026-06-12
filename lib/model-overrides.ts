/**
 * lib/model-overrides (v10.6.3 模型雷达) — 扫描采用的模型落库 + 运行时生效。
 *
 * 原则:API key 永远只走 .env.local;这里只覆盖**模型 ID**(非密钥)。
 * 生效链:applyModelOverride 同时写 process.env(立即生效,config.ts 的模型字段
 * 是 getter 每次读 env)+ 落 model_overrides 表;开机 loadModelOverridesIntoEnv
 * 重放(instrumentation),DB 覆盖值优先于 .env 默认 —— 它是用户在 UI 上的显式动作。
 * 回滚:每条覆盖记 prev_value,rollback 还原(prev 为空 = 当初没设 env → 删 env 回代码默认)。
 */
import { getDbDriver } from './db-driver';

export interface ModelOverrideRow {
  envKey: string;
  value: string;
  prevValue: string | null;
  updatedAt: string;
}

const nowIso = () => new Date().toISOString();

export async function listModelOverrides(): Promise<ModelOverrideRow[]> {
  const rows = await getDbDriver().query<any>(
    'SELECT env_key, value, prev_value, updated_at FROM model_overrides ORDER BY env_key',
  );
  return rows.map((r) => ({ envKey: r.env_key, value: r.value, prevValue: r.prev_value ?? null, updatedAt: r.updated_at }));
}

/** 应用覆盖:env 立即生效 + 落库(prev 只记"第一次覆盖前"的值,链式升级不丢最初基线)。 */
export async function applyModelOverride(envKey: string, value: string): Promise<ModelOverrideRow> {
  const drv = getDbDriver();
  const existing = await drv.get<any>('SELECT env_key, prev_value FROM model_overrides WHERE env_key = ?', [envKey]);
  const prev = existing ? existing.prev_value ?? null : process.env[envKey] ?? null;
  const t = nowIso();
  if (existing) {
    await drv.run('UPDATE model_overrides SET value = ?, updated_at = ? WHERE env_key = ?', [value, t, envKey]);
  } else {
    await drv.run('INSERT INTO model_overrides (env_key, value, prev_value, updated_at) VALUES (?, ?, ?, ?)', [envKey, value, prev, t]);
  }
  process.env[envKey] = value;
  return { envKey, value, prevValue: prev, updatedAt: t };
}

/** 回滚覆盖:还原最初基线(prev 为空 = 当初没设 env → 删 env 键回代码默认值)。 */
export async function rollbackModelOverride(envKey: string): Promise<boolean> {
  const drv = getDbDriver();
  const row = await drv.get<any>('SELECT prev_value FROM model_overrides WHERE env_key = ?', [envKey]);
  if (!row) return false;
  await drv.run('DELETE FROM model_overrides WHERE env_key = ?', [envKey]);
  if (row.prev_value != null && row.prev_value !== '') process.env[envKey] = row.prev_value;
  else delete process.env[envKey];
  return true;
}

/** 开机重放(instrumentation):DB 覆盖值写回 process.env。 */
export async function loadModelOverridesIntoEnv(): Promise<number> {
  try {
    const rows = await listModelOverrides();
    for (const r of rows) process.env[r.envKey] = r.value;
    return rows.length;
  } catch {
    return 0; // 表未建/驱动未就绪 — 静默(首次建库时序)
  }
}
