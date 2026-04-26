/**
 * 风格库缩略图批量生成脚本 (v2.0 Sprint 0 D2)
 *
 * 消费 `lib/style-presets.ts` 中的 60 条 STYLE_PRESETS，通过 Midjourney API
 * 统一生成缩略图并下载到 `public/styles/<id>.jpg`。
 *
 * 统一 prompt 模板确保所有风格可对照：
 *   "a young woman walking in a city street, cinematic composition, {promptFragment} --ar 4:5 --v 6 --style raw"
 *
 * 特性：
 * - 4 并发（MJ 服务器友好）
 * - 断点续跑（跳过已存在的 .jpg）
 * - 每张独立 try/catch，单张失败不影响整批
 * - 失败列表最后汇总输出便于重跑
 *
 * Usage:
 *   npx tsx scripts/generate-style-thumbnails.ts
 *
 * 环境变量（从 .env.local 读取）：
 *   BANANA_API_KEY=xxx  (即 MJ proxy key)
 */

import fs from 'fs';
import path from 'path';
import { STYLE_PRESETS } from '../lib/style-presets';
import { MidjourneyService, hasMidjourney } from '../services/midjourney.service';

// ---------- 环境变量加载 ----------
function loadEnv() {
  const envPath = path.join(process.cwd(), '.env.local');
  if (!fs.existsSync(envPath)) return;
  const lines = fs.readFileSync(envPath, 'utf-8').split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx < 0) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    const val = trimmed.slice(eqIdx + 1).trim();
    if (!process.env[key]) process.env[key] = val;
  }
}
loadEnv();

// ---------- 配置 ----------
const OUTPUT_DIR = path.join(process.cwd(), 'public', 'styles');
const CONCURRENCY = 4;

// 统一 prompt 模板：同一主体（都市中年轻女性）+ 不同风格片段，保证可对比
const PROMPT_TEMPLATE = (promptFragment: string) =>
  `a young woman walking in a city street, cinematic composition, ${promptFragment} --ar 4:5 --v 6 --style raw`;

// ---------- 工具 ----------
function ensureDir(dir: string) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function thumbnailPath(id: string): string {
  return path.join(OUTPUT_DIR, `${id}.jpg`);
}

async function downloadImage(url: string, destPath: string): Promise<void> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Download ${res.status}: ${url.slice(0, 80)}`);
  const arrayBuffer = await res.arrayBuffer();
  fs.writeFileSync(destPath, Buffer.from(arrayBuffer));
}

// ---------- 并发池 ----------
async function runWithConcurrency<T, R>(
  items: T[],
  worker: (item: T, idx: number) => Promise<R>,
  concurrency: number,
): Promise<Array<R | { error: Error; item: T }>> {
  const results: Array<R | { error: Error; item: T }> = [];
  let nextIdx = 0;
  const activeJobs: Promise<void>[] = [];

  async function runNext(): Promise<void> {
    const idx = nextIdx++;
    if (idx >= items.length) return;
    try {
      const r = await worker(items[idx], idx);
      results[idx] = r;
    } catch (e) {
      results[idx] = { error: e as Error, item: items[idx] };
    }
    await runNext();
  }

  for (let i = 0; i < Math.min(concurrency, items.length); i++) {
    activeJobs.push(runNext());
  }
  await Promise.all(activeJobs);
  return results;
}

// ---------- 主流程 ----------
async function main() {
  if (!hasMidjourney()) {
    console.error('❌ BANANA_API_KEY not configured in .env.local');
    process.exit(1);
  }

  ensureDir(OUTPUT_DIR);

  // 断点续跑：过滤掉已存在的文件
  const pending = STYLE_PRESETS.filter(s => {
    if (fs.existsSync(thumbnailPath(s.id))) {
      console.log(`⏭️  ${s.id}: already exists, skipping`);
      return false;
    }
    return true;
  });

  console.log(`\n🎨 Generating ${pending.length}/${STYLE_PRESETS.length} style thumbnails via Midjourney`);
  console.log(`   Concurrency: ${CONCURRENCY}`);
  console.log(`   Output: ${OUTPUT_DIR}\n`);

  if (pending.length === 0) {
    console.log('✨ All thumbnails already generated. Nothing to do.');
    return;
  }

  const mjService = new MidjourneyService();
  const startTime = Date.now();

  const results = await runWithConcurrency(
    pending,
    async (preset, idx) => {
      const tag = `[${idx + 1}/${pending.length}] ${preset.id}`;
      const prompt = PROMPT_TEMPLATE(preset.promptFragment);
      console.log(`🖌️  ${tag}: submitting...`);
      const url = await mjService.generateImage(prompt);
      console.log(`   ⬇️  ${tag}: downloading...`);
      await downloadImage(url, thumbnailPath(preset.id));
      console.log(`✅ ${tag}: saved`);
      return { id: preset.id, url };
    },
    CONCURRENCY,
  );

  // ---------- 汇总 ----------
  const failures: Array<{ id: string; error: string }> = [];
  let ok = 0;
  for (const r of results) {
    if (r && typeof r === 'object' && 'error' in r) {
      const item = r.item as typeof STYLE_PRESETS[number];
      failures.push({ id: item.id, error: r.error.message });
    } else {
      ok++;
    }
  }

  const durationSec = ((Date.now() - startTime) / 1000).toFixed(0);
  console.log(`\n${'='.repeat(60)}`);
  console.log(`✨ Done in ${durationSec}s: ${ok}/${pending.length} successful`);
  if (failures.length > 0) {
    console.log(`\n❌ Failed (${failures.length}):`);
    for (const f of failures) {
      console.log(`   - ${f.id}: ${f.error}`);
    }
    console.log(`\n💡 Rerun this script to retry failed items (resume-safe).`);
  }
  console.log('='.repeat(60));
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
