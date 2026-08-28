#!/usr/bin/env node
/**
 * 历史配额告警重分类(v12.348)。
 *
 * 旧词表把可灵的 1102「Account balance not enough」错记成 `rate_limited` ——
 * 因为它的 HTTP 状态是 429,而旧规则只认 credit/余额/insufficient,不认 balance/not enough。
 *
 * 后果不是标签难看:**「限流」的处置是等一会再试,「欠费」的处置是充值**,建议完全相反。
 * owner 的可灵账户从 2026-08-11 起就没钱了,告警表记了 ×18 次,而巡检一路报 OK ——
 * 17 天没人看出来。
 *
 * 本脚本按收口后的 `lib/quota-vocab.mjs` 重判历史行。**只看原文,不信旧标签**。
 *
 * 用法:node scripts/reclassify-quota-alerts.mjs [--dry]
 */
import Database from 'better-sqlite3';
import { ARREARS_RE, SATURATED_RE } from '../lib/quota-vocab.mjs';
const dry = process.argv.includes('--dry');
const db = new Database(new URL('../data/qfmj.db', import.meta.url).pathname);
const rows = db.prepare('SELECT id, provider, alert_type, error_message FROM api_quota_alerts').all();
let fixed = 0;
for (const r of rows) {
  const msg = String(r.error_message || '');
  let want = r.alert_type;
  if (ARREARS_RE.test(msg)) want = 'exhausted';
  else if (SATURATED_RE.test(msg)) want = 'saturated';
  if (want !== r.alert_type) {
    console.log(`  ${r.provider}: ${r.alert_type} → ${want}   ${msg.slice(0, 56)}`);
    if (!dry) db.prepare('UPDATE api_quota_alerts SET alert_type = ? WHERE id = ?').run(want, r.id);
    fixed++;
  }
}
console.log(`\n  ${dry ? '将改正' : '已改正'} ${fixed}/${rows.length} 条`);
