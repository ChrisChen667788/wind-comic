/**
 * v8.3 P6.3 — mode 卡 + LOOK chips「金色霓虹」图标批量生成 (MiniMax image-01).
 * 同 templates 风格: 金色描边 emblem on 暖墨黑底, 替代默认 emoji。
 *   mode → public/mode-icons/<id>.jpg ; LOOK → public/look-icons/<id>.jpg
 * Usage: npx tsx scripts/gen-mode-look-icons.ts
 */
import fs from 'fs';
import path from 'path';

function loadEnv() {
  const p = path.join(process.cwd(), '.env.local');
  if (!fs.existsSync(p)) return;
  for (const line of fs.readFileSync(p, 'utf-8').split('\n')) {
    const t = line.trim(); if (!t || t.startsWith('#')) continue;
    const i = t.indexOf('='); if (i < 0) continue;
    const k = t.slice(0, i).trim(); const v = t.slice(i + 1).trim().replace(/^["']|["']$/g, '');
    if (!process.env[k]) process.env[k] = v;
  }
}
loadEnv();

const MM_KEY = process.env.MINIMAX_API_KEY || '';
const MM_BASE = 'https://api.minimaxi.com/v1';
const CONCURRENCY = 3;
const STYLE =
  'bold glowing gold and warm amber neon outline emblem, single centered symbol filling 55% of the frame, ' +
  'consistent thick line weight, soft amber glow, on deep charcoal #0A0A0B background with subtle radial vignette, ' +
  'minimalist premium flat vector icon, perfectly centered, symmetrical, ' +
  'absolutely no text, no letters, no words, no numbers, modern high-end app icon, cinematic';

const JOBS: { dir: string; id: string; motif: string }[] = [
  // ── mode 卡 (5) ──
  { dir: 'mode-icons', id: 'episodic', motif: 'a stack of three film frames / TV series episodes' },
  { dir: 'mode-icons', id: 'mv', motif: 'a musical note merged with a sound waveform' },
  { dir: 'mode-icons', id: 'quick', motif: 'a lightning bolt crossing a stopwatch, speed' },
  { dir: 'mode-icons', id: 'comic-to-video', motif: 'a comic panel transforming into a play button' },
  { dir: 'mode-icons', id: 'ip-derivative', motif: 'a character bust silhouette with a sparkle, IP branching' },
  // ── LOOK chips (8) ──
  { dir: 'look-icons', id: 'poetic-mist', motif: 'a misty mountain peak with an ink brush stroke' },
  { dir: 'look-icons', id: 'neo-noir', motif: 'a detective fedora hat with venetian blind shadow lines' },
  { dir: 'look-icons', id: 'ink-wash', motif: 'a bamboo stalk with a calligraphy brush stroke' },
  { dir: 'look-icons', id: 'dreamwave', motif: 'a surreal swirling dream wave' },
  { dir: 'look-icons', id: 'cyber-neon', motif: 'a neon cyber grid horizon with a sun' },
  { dir: 'look-icons', id: 'anime-3d', motif: 'a stylized paper lantern with a star' },
  { dir: 'look-icons', id: 'cinematic', motif: 'a film clapperboard / cinema camera' },
  { dir: 'look-icons', id: 'ghibli', motif: 'a single leaf drifting beside a soft cloud' },
];

function dest(dir: string, id: string) { return path.join(process.cwd(), 'public', dir, `${id}.jpg`); }

async function genOne(j: { dir: string; id: string; motif: string }): Promise<void> {
  const r = await fetch(`${MM_BASE}/image_generation`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${MM_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: 'image-01', prompt: `${j.motif}, ${STYLE}`, aspect_ratio: '1:1', n: 1 }),
  });
  const d: any = await r.json();
  if (!r.ok || d?.base_resp?.status_code !== 0) throw new Error(`${r.status} ${d?.base_resp?.status_msg || ''}`);
  const url = d?.data?.image_urls?.[0];
  if (!url) throw new Error('no url');
  const img = await fetch(url);
  if (!img.ok) throw new Error(`download ${img.status}`);
  fs.writeFileSync(dest(j.dir, j.id), Buffer.from(await img.arrayBuffer()));
}

async function main() {
  if (!MM_KEY) { console.error('MINIMAX_API_KEY missing'); process.exit(1); }
  for (const d of ['mode-icons', 'look-icons']) fs.mkdirSync(path.join(process.cwd(), 'public', d), { recursive: true });
  const todo = JOBS.filter((j) => !fs.existsSync(dest(j.dir, j.id)));
  console.log(`[mode/look] total=${JOBS.length} todo=${todo.length} concurrency=${CONCURRENCY}`);
  const failed: string[] = []; let done = 0, idx = 0;
  async function worker() {
    while (idx < todo.length) {
      const j = todo[idx++]; const t0 = Date.now();
      try { await genOne(j); done++; console.log(`  ✓ ${j.dir}/${j.id} ${Date.now() - t0}ms [${done}/${todo.length}]`); }
      catch (e: any) { failed.push(`${j.dir}/${j.id}`); console.log(`  ✗ ${j.dir}/${j.id} ${e?.message || e}`); }
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  console.log(`\n[mode/look] DONE ok=${done} failed=${failed.length}${failed.length ? ' → ' + failed.join(',') : ''}`);
}
main();
