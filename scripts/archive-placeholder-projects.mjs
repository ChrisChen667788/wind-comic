#!/usr/bin/env node
/**
 * 把「只剩占位图、没有真作品」的项目下架(v12.426)。
 *
 * ## 为什么需要
 *
 * owner 反馈 README 里「我的项目」截图全是渐变占位卡。实测 30 个项目:
 *   · 5 个是真作品(活资产 23~33),2 个是演示工程 —— 这 7 个封面都能正常加载;
 *   · 23 个要下架:16 个是脚本/e2e 造的夹具,另外 8 个是 owner 真实创作,
 *     但媒体文件被那次「只看 mtime 不查引用」的定时清理删光了(v12.394/v12.398 修过
 *     清理逻辑,但已删的找不回来)—— 两组有重叠。
 *
 * ## 为什么是「下架」不是「删除」
 *
 * 下架只改 projects.status='archived'(setProjectArchived,一条 UPDATE,无级联、不碰磁盘),
 * 项目从主列表移走但「已下架」筛选里还在,一键可恢复。而删除会连分镜/视频/配音一起抹掉,
 * 不可逆 —— 这个仓库刚因为不可逆删除丢过 30 个项目 534 个素材,不该再赌一次。
 *
 * 特别注意:下架**不会**让素材更容易被清理删掉。cleanup-media 的保护名单
 * referencedBasenames() 查的是全部 project_assets,不按项目状态过滤(已核实)。
 *
 * ## 跑法
 *   node scripts/archive-placeholder-projects.mjs              # 默认只预览,不改任何东西
 *   node scripts/archive-placeholder-projects.mjs --apply      # 真的下架
 *   node scripts/archive-placeholder-projects.mjs --restore    # 把本脚本下架过的全部恢复
 *
 * ## 判据(两条,任一命中即下架)
 *
 * A. **封面一张都加载不出来**。接口给的是有序候选串(用户定版 → 冻结封面 → 本片第 1 镜
 *    → 本片视频),逐个实测 fetch;全挂说明这项目在列表里就是一张占位卡 ——
 *    正是 owner 说的「只有占位符」。
 * B. **ID 是夹具形态**(ad- / ev-ad- / dd-verify- / sketchlock- / kling-full-)。
 *    这些是脚本与 e2e 造的,不是 owner 的创作。
 *
 * 活性一律实测(fetch 看是否 200),不看库里有没有记录 —— 记录还在、文件早没了,
 * 正是这批项目的实际情况。
 */
import fs from 'node:fs';
import path from 'node:path';

const BASE = process.env.CAPTURE_BASE || 'http://localhost:3000';
const TOKEN_FILE = process.env.QFMJ_TOKEN_FILE || '/tmp/tok.json';
const LEDGER = path.join(process.cwd(), '.tools', 'archived-projects.json');
/** 夹具形态的 ID 前缀 —— 脚本/e2e 造的项目,不是 owner 的创作。 */
const FIXTURE_ID = /^(ad-|ev-ad-|dd-verify-|sketchlock-|kling-full-)/;
/** 演示工程永远保留 —— 它们是「无 key 也能逛完整工作台」的入口。 */
const KEEP = new Set(['proj-demo-v10', 'qfmj-demo-showcase']);

const apply = process.argv.includes('--apply');
const restore = process.argv.includes('--restore');

function auth() {
  const { token } = JSON.parse(fs.readFileSync(TOKEN_FILE, 'utf-8'));
  return { cookie: `qfmj-session=${token}`, Authorization: `Bearer ${token}` };
}

const alive = async (h, u) => {
  if (!u || u.startsWith('data:')) return false;
  try {
    const r = await fetch(u.startsWith('http') ? u : `${BASE}${u}`, { headers: { ...h, range: 'bytes=0-64' } });
    return r.ok;
  } catch { return false; }
};

async function setArchived(h, id, archived) {
  const r = await fetch(`${BASE}/api/projects/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: { ...h, 'content-type': 'application/json' },
    body: JSON.stringify({ status: archived ? 'archived' : 'completed' }),
  });
  return r.ok;
}

async function main() {
  const h = auth();

  if (restore) {
    if (!fs.existsSync(LEDGER)) { console.log('没有账本,本脚本没下架过任何项目。'); return; }
    const ids = JSON.parse(fs.readFileSync(LEDGER, 'utf-8'));
    let ok = 0;
    for (const id of ids) if (await setArchived(h, id, false)) ok++;
    console.log(`已恢复 ${ok}/${ids.length} 个项目到主列表。`);
    return;
  }

  const rows = await (await fetch(`${BASE}/api/projects`, { headers: h })).json();
  if (!Array.isArray(rows)) throw new Error('取项目列表失败:' + JSON.stringify(rows).slice(0, 120));

  const plan = [];
  for (const p of rows) {
    if (p.status === 'archived') continue;
    if (KEEP.has(p.id)) continue;

    let coverOk = false;
    for (const u of p.covers || []) if (await alive(h, u)) { coverOk = true; break; }
    const isFixture = FIXTURE_ID.test(p.id);
    if (coverOk && !isFixture) continue;

    plan.push({
      id: p.id,
      reason: !coverOk && isFixture ? '夹具 + 无可用封面' : !coverOk ? '无可用封面(只剩占位卡)' : '夹具项目',
      title: String(p.title || '').replace(/\s+/g, ' ').slice(0, 26),
    });
  }

  console.log(`扫描 ${rows.length} 个项目,拟下架 ${plan.length} 个:`);
  for (const p of plan) console.log(`  ${p.id.padEnd(24)} ${p.reason.padEnd(22)} ${p.title}`);

  if (!apply) {
    console.log('\n这是预览。真的下架请加 --apply;下架后可用 --restore 全部恢复。');
    return;
  }

  fs.mkdirSync(path.dirname(LEDGER), { recursive: true });
  const done = [];
  for (const p of plan) if (await setArchived(h, p.id, true)) done.push(p.id);
  fs.writeFileSync(LEDGER, JSON.stringify(done, null, 2));
  console.log(`\n已下架 ${done.length}/${plan.length} 个;账本写入 ${path.relative(process.cwd(), LEDGER)}`);
  console.log('恢复:node scripts/archive-placeholder-projects.mjs --restore');
}

main().catch((e) => { console.error(e); process.exit(1); });
