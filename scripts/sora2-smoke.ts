/**
 * sora2-smoke.ts — 通过 真正的 VeoService 走一次 sora-2 端到端生成
 *
 * 目的: 证明 services/veo.service.ts 这条线 (env → config → 创建任务 → 轮询 → 提取 result_url)
 * 在 qingyuntop 真实网关上能完整跑通,而不是只验证裸 API。
 *
 * 用法:
 *   npx tsx scripts/sora2-smoke.ts
 *   PROMPT="..." npx tsx scripts/sora2-smoke.ts
 *   DURATION=8 npx tsx scripts/sora2-smoke.ts
 */

// 加载 .env.local (Next.js 的 process.env 注入仅在 dev/build 时生效, 这里手动加载)
import { readFileSync, existsSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const envPath = path.join(__dirname, '..', '.env.local');
if (existsSync(envPath)) {
  const lines = readFileSync(envPath, 'utf-8').split(/\r?\n/);
  for (const line of lines) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) {
      process.env[m[1]] = m[2].replace(/^"(.*)"$/, '$1');
    }
  }
}

async function main() {
  // 必须在 import VeoService 之前加载完 env (上方已做)
  const { VeoService, hasVeo } = await import('../services/veo.service.ts');

  const PROMPT = process.env.PROMPT
    || 'A serene Chinese garden at sunset, a white crane standing gracefully by the lotus pond, soft cinematic lighting, slow camera push-in, peaceful atmosphere';
  const DURATION = Number(process.env.DURATION || 4);

  console.log('╔══════════════════════════════════════════════════════════════╗');
  console.log('║ 🎬 sora-2 smoke test (通过真实 VeoService)                    ║');
  console.log('╚══════════════════════════════════════════════════════════════╝');
  console.log(`  base    : ${process.env.VEO_BASE_URL}`);
  console.log(`  model   : ${process.env.VEO_MODEL}`);
  console.log(`  format  : ${process.env.VEO_API_FORMAT}`);
  console.log(`  duration: ${DURATION}s`);
  console.log(`  prompt  : ${PROMPT.slice(0, 80)}...`);
  console.log('');

  if (!hasVeo()) {
    console.error('❌ hasVeo() == false, VEO_API_KEY 未配置或非法');
    process.exit(1);
  }

  const svc = new VeoService();

  const t0 = Date.now();
  let lastStatus = '';
  let lastProgress = -1;

  try {
    const url = await svc.generateVideoFromText(PROMPT, {
      duration: DURATION,
      onProgress: (progress: number, status: string) => {
        // 仅在变化时打印, 减少噪声
        if (progress !== lastProgress || status !== lastStatus) {
          const elapsed = ((Date.now() - t0) / 1000).toFixed(0);
          console.log(`  [${elapsed.padStart(3)}s] status=${status.padEnd(12)} progress=${progress}%`);
          lastProgress = progress;
          lastStatus = status;
        }
      },
    });

    const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
    console.log('');
    console.log('╔══════════════════════════════════════════════════════════════╗');
    console.log('║ ✅ 端到端 SUCCESS                                              ║');
    console.log('╚══════════════════════════════════════════════════════════════╝');
    console.log(`  耗时    : ${elapsed}s`);
    console.log(`  videoUrl: ${url}`);

    // 进一步验证 URL 可访问 (HEAD)
    try {
      const head = await fetch(url, { method: 'HEAD' });
      console.log(`  HEAD    : ${head.status} ${head.headers.get('content-type') || '?'} ${head.headers.get('content-length') || '?'} bytes`);
    } catch (e) {
      console.log(`  HEAD    : (跳过, ${(e as Error).message})`);
    }

    process.exit(0);
  } catch (e) {
    const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
    console.error('');
    console.error('╔══════════════════════════════════════════════════════════════╗');
    console.error('║ ❌ 端到端 FAILED                                               ║');
    console.error('╚══════════════════════════════════════════════════════════════╝');
    console.error(`  耗时: ${elapsed}s`);
    console.error(`  错误: ${(e as Error).message}`);
    process.exit(2);
  }
}

main();
