#!/usr/bin/env node
/**
 * 旧库画幅修复的手动入口(v13.3)—— 判据与执行都在 lib/legacy-aspect-repair.ts,本脚本只是开关。
 *
 * 应用启动后会在后台自动跑同一套修复(instrumentation.ts),一般不需要手动跑。
 * 想先看清会改什么、或者要撤销,用这里(从源码部署时;Docker 运行镜像不带 lib/ 源码,跑不了本脚本,
 * 靠的是启动时的自动修复,撤销请在源码环境里对同一个库执行 --restore)。
 *
 *   npm run repair:aspect                # 只预览:列出画幅不在 16:9 / 9:16 / 1:1 之内的项目与打算改成什么
 *   npm run repair:aspect -- --apply     # 执行,并记进 data/legacy-aspect-repaired.json
 *   npm run repair:aspect -- --restore   # 按账本撤销(之后被重跑改过画幅的项目不动)
 *
 * 用 Postgres 时带上与应用相同的 DB_DRIVER=pg 和 DATABASE_URL。
 */
import { repairLegacyAspects, restoreLegacyAspects, DEFAULT_LEDGER_PATH } from '../lib/legacy-aspect-repair.ts';

const apply = process.argv.includes('--apply');
const restore = process.argv.includes('--restore');

async function main() {
  if (restore) {
    const { restored, skipped } = await restoreLegacyAspects();
    console.log(`已撤销 ${restored.length} 个项目${skipped.length ? `;${skipped.length} 个之后被改过画幅,未动:${skipped.join(', ')}` : ''}`);
    return;
  }
  const { scanned, changes } = await repairLegacyAspects({ apply });
  if (!scanned) { console.log('没有画幅不在 16:9 / 9:16 / 1:1 之内的项目,无需修复。'); return; }
  for (const c of changes) {
    const mark = apply ? (c.applied ? '✓' : '·(期间被改过,跳过)') : '→';
    console.log(`  ${mark} ${c.id}: ${c.from ?? '空'} → ${c.to}   ${c.detail}`);
  }
  if (apply) {
    console.log(`已改正 ${changes.filter((c) => c.applied).length}/${scanned} 个。账本:${DEFAULT_LEDGER_PATH}`);
  } else {
    console.log(`共 ${scanned} 个待改正(只是预览,未改库)。确认后执行:npm run repair:aspect -- --apply`);
  }
}

main().then(() => process.exit(0), (e) => { console.error(e); process.exit(1); });
