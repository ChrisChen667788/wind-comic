/**
 * v8.3 P5 — 风格画廊缩略图批量生成 (MiniMax image-01, 替代已下线的 banana/MJ)
 *
 * 消费 lib/style-presets.ts 的 STYLE_PRESETS, 统一主体 + 各风格 promptFragment,
 * 经 MiniMax image-01 生成, 下载到 public/styles/<id>.jpg。
 *   - 并发 3 (MiniMax 友好) · 断点续跑 (跳过已存在) · 单张失败不影响整批 · 末尾汇总
 *
 * Usage: npx tsx scripts/gen-style-thumbs.ts
 */
import fs from 'fs';
import path from 'path';
import { STYLE_PRESETS } from '../lib/style-presets';

function loadEnv() {
  const p = path.join(process.cwd(), '.env.local');
  if (!fs.existsSync(p)) return;
  for (const line of fs.readFileSync(p, 'utf-8').split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const i = t.indexOf('=');
    if (i < 0) continue;
    const k = t.slice(0, i).trim();
    const v = t.slice(i + 1).trim().replace(/^["']|["']$/g, '');
    if (!process.env[k]) process.env[k] = v;
  }
}
loadEnv();

const MM_KEY = process.env.MINIMAX_API_KEY || '';
const MM_BASE = 'https://api.minimaxi.com/v1';
const OUT = path.join(process.cwd(), 'public', 'styles');
const CONCURRENCY = 3;

// 统一主体 (人物 + 环境兼顾, 跨写实/动漫/艺术/复古/实验都成立), 叠各风格片段保证可对比
const PROMPT = (frag: string) =>
  `A lone young woman standing on a city rooftop at dusk overlooking the skyline, evocative mood, strong composition, ${frag}`;

function dest(id: string) { return path.join(OUT, `${id}.jpg`); }

async function genOne(id: string, frag: string): Promise<void> {
  const r = await fetch(`${MM_BASE}/image_generation`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${MM_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: 'image-01', prompt: PROMPT(frag).slice(0, 1400), aspect_ratio: '4:3', n: 1 }),
  });
  const j: any = await r.json();
  if (!r.ok || j?.base_resp?.status_code !== 0) {
    throw new Error(`image-01 ${r.status} ${j?.base_resp?.status_msg || JSON.stringify(j).slice(0, 120)}`);
  }
  const url = j?.data?.image_urls?.[0];
  if (!url) throw new Error('no image url');
  const img = await fetch(url);
  if (!img.ok) throw new Error(`download ${img.status}`);
  fs.writeFileSync(dest(id), Buffer.from(await img.arrayBuffer()));
}

async function main() {
  if (!MM_KEY) { console.error('MINIMAX_API_KEY missing'); process.exit(1); }
  if (!fs.existsSync(OUT)) fs.mkdirSync(OUT, { recursive: true });

  const todo = STYLE_PRESETS.filter((s) => !fs.existsSync(dest(s.id)));
  console.log(`[styles] total=${STYLE_PRESETS.length} todo=${todo.length} (skip existing) concurrency=${CONCURRENCY}`);

  const failed: { id: string; err: string }[] = [];
  let done = 0;
  let idx = 0;
  async function worker() {
    while (idx < todo.length) {
      const s = todo[idx++];
      const t0 = Date.now();
      try {
        await genOne(s.id, s.promptFragment);
        done++;
        console.log(`  ✓ ${s.id} (${s.nameEn}) ${Date.now() - t0}ms  [${done}/${todo.length}]`);
      } catch (e: any) {
        failed.push({ id: s.id, err: e?.message || String(e) });
        console.log(`  ✗ ${s.id} ${e?.message || e}`);
      }
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));

  console.log(`\n[styles] DONE ok=${done} failed=${failed.length}`);
  if (failed.length) console.log('failed:', failed.map((f) => f.id).join(', '));
}
main();
