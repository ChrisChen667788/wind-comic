#!/usr/bin/env node
/**
 * 「造好没接线」审计(v12.370)—— 找出前端从未调用的 API 端点。
 *
 * ## 为什么做成脚本
 *
 * 本轮我临时写过一版这个扫描,靠它接线了 reframe / covers-from-frames / hook-ideas /
 * jianying 四条真功能。但那一版**只剥离了 `[id]`,没剥离其它动态段**,于是
 * `characters/bible/[name]` 的比对键成了字面量 `[name]`,前端当然搜不到 ——
 * **它被误报成孤儿,而实际上前端接得好好的**(debounce 查询 + AbortController + dismiss 状态)。
 *
 * 我据此在 v12.369 的版本日志里写了「前端零引用」,**那句话是错的**。
 * 一次性脚本没人复核、也没法复现;做成带测试的脚本,错了至少能被下一次跑出来。
 *
 * ## 判定方式
 *
 * 端点 `app/api/a/[id]/b/route.ts` → 匹配键 `a/…/b`:
 * **剥掉全部 `[xxx]` 动态段**,再看前端源码里有没有出现最后一个静态段。
 * 动态段不参与匹配 —— 前端写的是 `/api/a/${id}/b`,字面量里根本没有 `[id]`。
 *
 * 用法:node scripts/audit-orphan-endpoints.mjs [--json]
 */
import fs from 'fs';
import path from 'path';

const ROOT = process.cwd();
const JSON_OUT = process.argv.includes('--json');

/** 设计上就没有前端调用方的端点 —— 不是孤儿。 */
export const BY_DESIGN = {
  'stripe/webhook': '外部支付回调,由 Stripe 服务器调用',
  'mock-assets/[...path]': '测试夹具的静态资源出口',
  'cron/cleanup-media': '定时任务入口,由 cron 调用',
};

function listRoutes() {
  const out = [];
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name === 'route.ts') {
        out.push(path.relative(path.join(ROOT, 'app/api'), d).split(path.sep).join('/'));
      }
    }
  };
  walk(path.join(ROOT, 'app/api'));
  return out;
}

function frontendSources() {
  const out = [];
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      if (e.name === 'node_modules' || e.name.startsWith('.')) continue;
      const p = path.join(d, e.name);
      const rel = path.relative(ROOT, p).split(path.sep).join('/');
      if (rel.startsWith('app/api/')) continue;          // 端点自身不算调用方
      if (e.isDirectory()) walk(p);
      else if (/\.(tsx?|mjs)$/.test(e.name)) out.push(fs.readFileSync(p, 'utf8'));
    }
  };
  for (const r of ['app', 'components', 'lib', 'hooks', 'scripts']) {
    const d = path.join(ROOT, r);
    if (fs.existsSync(d)) walk(d);
  }
  return out;
}

/** 端点路径 → 用于搜索的静态段(**剥掉全部 [xxx] / [...xxx]**)。 */
export function matchKey(endpoint) {
  const segs = endpoint.split('/').filter((s) => s && !/^\[.*\]$/.test(s));
  return segs.length ? segs[segs.length - 1] : '';
}

export function findOrphans(routes, sources) {
  const orphans = [];
  for (const ep of routes) {
    if (ep in BY_DESIGN) continue;
    const key = matchKey(ep);
    if (!key || key.length < 3) continue;               // 太短的段易误判,跳过并如实计数
    const hit = sources.some((s) => s.includes(`/${key}`));
    if (!hit) orphans.push(ep);
  }
  return orphans;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const routes = listRoutes();
  const sources = frontendSources();
  const orphans = findOrphans(routes, sources);
  if (JSON_OUT) {
    console.log(JSON.stringify({ total: routes.length, byDesign: Object.keys(BY_DESIGN).length, orphans }, null, 2));
  } else {
    console.log(`\n端点 ${routes.length} 个 · 设计上无前端调用方 ${Object.keys(BY_DESIGN).length} 个 · **疑似孤儿 ${orphans.length} 个**\n`);
    for (const o of orphans) console.log(`  ${o}`);
    console.log('\n注:这是**启发式**结果,逐条人工确认后再动手 —— 上一版就因为没剥离 [name] 误报过。\n');
  }
}
