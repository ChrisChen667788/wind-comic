/**
 * v8.3 P6 — 故事模板「潮流图标」批量生成 (MiniMax image-01, 替代默认 emoji)
 *
 * 18 个内置模板各生成一枚 金色霓虹描边 emblem (统一风格, 暖墨黑底), 替代 ⚡🌸🔍… emoji。
 * 输出 public/template-icons/<id>.jpg (1:1)。并发 3, 跳过已存在, 单张失败不影响整批。
 *
 * Usage: npx tsx scripts/gen-template-icons.ts
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
const OUT = path.join(process.cwd(), 'public', 'template-icons');
const CONCURRENCY = 3;

// 统一风格 — bias 到 cyberpunk 测试图那种"粗描金色霓虹 emblem", 确保整套一致
const STYLE =
  'bold glowing gold and warm amber neon outline emblem, single centered symbol filling 55% of the frame, ' +
  'consistent thick line weight, soft amber glow, on deep charcoal #0A0A0B background with subtle radial vignette, ' +
  'minimalist premium flat vector icon, perfectly centered, symmetrical, ' +
  'absolutely no text, no letters, no words, no numbers, modern high-end app icon, cinematic';

// 每个模板的母题 (motif), 让 emblem 一眼可辨
const MOTIFS: Record<string, string> = {
  'power-fantasy': 'a rising phoenix wreathed in a lightning bolt, ascension',
  'sweet-romance': 'two intertwined hearts with a blooming rose',
  'mystery-thriller': 'a magnifying glass over a fingerprint',
  'xianxia-fantasy': 'a coiling oriental dragon around a slender sword',
  'cyberpunk': 'a cyborg android head with circuit lines',
  'post-apocalyptic': 'a cracked skull behind a radiation hazard trefoil',
  'campus-youth': 'a graduation cap with a small sparkle',
  'palace-intrigue': 'an ornate imperial phoenix crown',
  'urban-fantasy': 'a city skyline pierced by a glowing magic portal ring',
  'wuxia-martial': 'two crossed martial swords',
  'slice-of-life': 'a steaming coffee cup with a tiny leaf',
  'horror-thriller': 'a ghostly haunting mask',
  'sci-fi-space': 'a rocket arcing past a ringed planet and stars',
  'kids-cartoon': 'a cute rounded rabbit with a star',
  'historical-biopic': 'an unrolled ancient scroll with a quill',
  'animal-fable': 'a clever stylized fox head',
  'food-vlog': 'a steaming noodle bowl with chopsticks',
  'music-video': 'a musical note radiating sound waves',
};

function dest(id: string) { return path.join(OUT, `${id}.jpg`); }

async function genOne(id: string, motif: string): Promise<void> {
  const r = await fetch(`${MM_BASE}/image_generation`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${MM_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: 'image-01', prompt: `${motif}, ${STYLE}`, aspect_ratio: '1:1', n: 1 }),
  });
  const j: any = await r.json();
  if (!r.ok || j?.base_resp?.status_code !== 0) throw new Error(`${r.status} ${j?.base_resp?.status_msg || ''}`);
  const url = j?.data?.image_urls?.[0];
  if (!url) throw new Error('no url');
  const img = await fetch(url);
  if (!img.ok) throw new Error(`download ${img.status}`);
  fs.writeFileSync(dest(id), Buffer.from(await img.arrayBuffer()));
}

async function main() {
  if (!MM_KEY) { console.error('MINIMAX_API_KEY missing'); process.exit(1); }
  if (!fs.existsSync(OUT)) fs.mkdirSync(OUT, { recursive: true });
  const ids = Object.keys(MOTIFS).filter((id) => !fs.existsSync(dest(id)));
  console.log(`[icons] total=${Object.keys(MOTIFS).length} todo=${ids.length} concurrency=${CONCURRENCY}`);
  const failed: string[] = [];
  let done = 0, idx = 0;
  async function worker() {
    while (idx < ids.length) {
      const id = ids[idx++]; const t0 = Date.now();
      try { await genOne(id, MOTIFS[id]); done++; console.log(`  ✓ ${id} ${Date.now() - t0}ms [${done}/${ids.length}]`); }
      catch (e: any) { failed.push(id); console.log(`  ✗ ${id} ${e?.message || e}`); }
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  console.log(`\n[icons] DONE ok=${done} failed=${failed.length}${failed.length ? ' → ' + failed.join(',') : ''}`);
}
main();
