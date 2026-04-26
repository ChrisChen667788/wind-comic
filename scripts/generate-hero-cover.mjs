#!/usr/bin/env node
/**
 * 主页英雄封面生成脚本
 *
 * 一次性生成:
 *   1. public/hero-cover.jpg  - 1920x1080 cinematic cover (Minimax image-01 / vectorengine flux)
 *   2. public/hero-loop.mp4   - 2-3s I2V 无缝循环动画 (Minimax I2V-01 / Veo)
 *
 * 用法:
 *   node scripts/generate-hero-cover.mjs           # 使用默认 prompt
 *   node scripts/generate-hero-cover.mjs "自定义 prompt"
 *
 * 依赖环境变量: MINIMAX_API_KEY 或 VECTORENGINE_API_KEY (二选一即可)
 * 产出会覆盖已有文件; 如果失败会保留前一次产出不动。
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');
const PUBLIC_DIR = path.join(REPO_ROOT, 'public');

// ── 加载 .env.local ──
const envPath = path.join(REPO_ROOT, '.env.local');
if (fs.existsSync(envPath)) {
  const envRaw = fs.readFileSync(envPath, 'utf-8');
  for (const line of envRaw.split('\n')) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)\s*=\s*(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
  }
}

const DEFAULT_HERO_PROMPT =
  'Cinematic wide-angle establishing shot, a lone mounted warrior on horseback in majestic misty mountain landscape, epic atmospheric light rays piercing through morning fog, golden hour backlighting, volumetric mist rolling through valleys, dramatic depth of field, 3D-rendered Chinese ink-painting meets Pixar cinematic quality, ultra high detail, 8K, matte painting, sweeping panoramic vista, silhouette of rider against glowing horizon, professional film still, rich atmospheric haze, painterly cloud formations, 16:9 aspect ratio, hero banner composition';

const customPrompt = process.argv.slice(2).join(' ').trim();
const heroPrompt = customPrompt || DEFAULT_HERO_PROMPT;

const MINIMAX_KEY = process.env.MINIMAX_API_KEY;
const VE_KEY = process.env.VECTORENGINE_API_KEY || process.env.OPENAI_API_KEY;
const VE_BASE = 'https://api.vectorengine.ai';

async function generateCoverImage() {
  console.log('[hero] 🎨 Generating cinematic cover image...');
  console.log(`[hero] prompt: ${heroPrompt.slice(0, 100)}...`);

  // ── 优先 Minimax image-01 (出图快, 16:9 支持完善) ──
  if (MINIMAX_KEY) {
    console.log('[hero] → using Minimax image-01');
    const res = await fetch('https://api.minimax.chat/v1/image_generation', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${MINIMAX_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'image-01',
        prompt: heroPrompt,
        prompt_optimizer: true,
        width: 1920,
        height: 1080,
      }),
    });
    const data = await res.json();
    const url = data?.data?.image_urls?.[0];
    if (url) {
      console.log(`[hero] ✅ Minimax returned: ${url.slice(0, 80)}...`);
      return url;
    }
    console.warn('[hero] ⚠️ Minimax did not return image, falling through');
    console.warn(JSON.stringify(data).slice(0, 200));
  }

  // ── Fallback: vectorengine flux.1-kontext-pro ──
  if (VE_KEY) {
    console.log('[hero] → using vectorengine flux.1-kontext-pro');
    const res = await fetch(`${VE_BASE}/v1/images/generations`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${VE_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'flux.1-kontext-pro',
        prompt: heroPrompt,
        n: 1,
        size: '1920x1080',
      }),
    });
    const data = await res.json();
    const url = data?.data?.[0]?.url;
    if (url) {
      console.log(`[hero] ✅ flux returned: ${url.slice(0, 80)}...`);
      return url;
    }
    const b64 = data?.data?.[0]?.b64_json;
    if (b64) {
      const outBuf = Buffer.from(b64, 'base64');
      const outPath = path.join(PUBLIC_DIR, 'hero-cover.jpg');
      fs.writeFileSync(outPath, outBuf);
      console.log(`[hero] ✅ flux base64 saved directly: ${outPath}`);
      return `file://${outPath}`;
    }
  }

  throw new Error('No image API key available (set MINIMAX_API_KEY or VECTORENGINE_API_KEY)');
}

async function downloadTo(url, outPath) {
  if (url.startsWith('file://')) return; // 已经是本地
  console.log(`[hero] ⬇️  Downloading ${url.slice(0, 60)}... → ${outPath}`);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Download failed: ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  fs.writeFileSync(outPath, buf);
  console.log(`[hero] ✅ saved ${outPath} (${(buf.length / 1024).toFixed(0)} KB)`);
}

async function pollMinimaxTask(taskId, maxPolls = 80) {
  for (let i = 0; i < maxPolls; i++) {
    await new Promise(r => setTimeout(r, 6000));
    const qRes = await fetch(`https://api.minimax.chat/v1/query/video_generation?task_id=${taskId}`, {
      headers: { 'Authorization': `Bearer ${MINIMAX_KEY}` },
    });
    const q = await qRes.json();
    const status = q?.status;
    console.log(`[hero] poll ${i + 1}/${maxPolls}: ${status}`);
    if (status === 'Success' || status === 'success') {
      const fileId = q.file_id;
      const fRes = await fetch(`https://api.minimax.chat/v1/files/retrieve?file_id=${fileId}`, {
        headers: { 'Authorization': `Bearer ${MINIMAX_KEY}` },
      });
      const f = await fRes.json();
      const fileUrl = f?.file?.download_url;
      if (fileUrl) return fileUrl;
    }
    if (status === 'Fail' || status === 'fail') {
      throw new Error(`Minimax video failed: ${JSON.stringify(q).slice(0, 200)}`);
    }
  }
  throw new Error('Minimax video polling timed out');
}

async function tryMinimaxVideo(model, body, label) {
  console.log(`[hero] → trying Minimax ${label}`);
  const submitRes = await fetch('https://api.minimax.chat/v1/video_generation', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${MINIMAX_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, ...body }),
  });
  const submitData = await submitRes.json();
  const taskId = submitData?.task_id;
  if (!taskId) {
    const errCode = submitData?.base_resp?.status_code;
    const errMsg = submitData?.base_resp?.status_msg || 'unknown';
    throw new Error(`Minimax ${label} rejected (code=${errCode}): ${errMsg}`);
  }
  console.log(`[hero] Minimax ${label} task_id: ${taskId}, polling...`);
  return pollMinimaxTask(taskId);
}

async function tryVeoVideo(prompt, imageUrl) {
  if (!VE_KEY) return null;
  console.log('[hero] → trying vectorengine Veo 3.1');
  // 异步任务: POST /v1/video/create → 轮询 /v1/video/query
  const createRes = await fetch(`${VE_BASE}/v1/video/create`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${VE_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'veo3.1',
      prompt,
      first_frame_image: imageUrl,
      duration: 4,
    }),
  });
  const createData = await createRes.json();
  if (!createRes.ok) {
    throw new Error(`Veo create failed (${createRes.status}): ${JSON.stringify(createData).slice(0, 200)}`);
  }
  const taskId = createData?.id || createData?.task_id;
  if (!taskId) throw new Error(`Veo: no task_id in response: ${JSON.stringify(createData).slice(0, 200)}`);
  console.log(`[hero] Veo task_id: ${taskId}, polling...`);

  for (let i = 0; i < 60; i++) {
    await new Promise(r => setTimeout(r, 8000));
    const qRes = await fetch(`${VE_BASE}/v1/video/query?id=${taskId}`, {
      headers: { 'Authorization': `Bearer ${VE_KEY}` },
    });
    const q = await qRes.json();
    const status = q?.status;
    console.log(`[hero] veo poll ${i + 1}/60: ${status} (progress=${q?.progress || 0})`);
    if (status === 'completed' || status === 'succeed' || status === 'success') {
      return q?.video_url || q?.result_url || q?.result?.video_url;
    }
    if (status === 'failed' || status === 'video_generation_failed') {
      throw new Error(`Veo video failed: ${JSON.stringify(q?.error || q).slice(0, 200)}`);
    }
  }
  throw new Error('Veo polling timed out');
}

async function generateLoopVideo(coverImageUrl) {
  console.log('[hero] 🎬 Generating 2-3s looping video from cover...');

  // Seamlessly looping, very subtle motion — website hero background
  const loopPrompt =
    'Very slow, subtle, seamlessly looping ambient motion. Light mist drifts gently across the scene from left to right, soft parallax on distant peaks, atmospheric haze breathes softly. Keep composition completely static — camera does not move. Only atmospheric elements (mist, light rays, subtle particles) drift. Designed to loop forever as a hero background. 2-3 seconds, no cuts, no zoom, no pan.';

  if (MINIMAX_KEY) {
    // Pass 1: I2V-01 (best quality, but may 2061 on free tier)
    try {
      return await tryMinimaxVideo('I2V-01', {
        prompt: loopPrompt,
        first_frame_image: coverImageUrl,
      }, 'I2V-01 (图生视频)');
    } catch (e) {
      console.warn(`[hero] ⚠️ I2V-01: ${e.message}`);
    }

    // Pass 2: MiniMax-Hailuo-2.3 I2V (usually on standard plan)
    try {
      return await tryMinimaxVideo('MiniMax-Hailuo-2.3', {
        prompt: loopPrompt,
        first_frame_image: coverImageUrl,
      }, 'Hailuo-2.3 (I2V)');
    } catch (e) {
      console.warn(`[hero] ⚠️ Hailuo-2.3 I2V: ${e.message}`);
    }

    // Pass 3: MiniMax-Hailuo-2.3 T2V (pure text — most permissive)
    try {
      return await tryMinimaxVideo('MiniMax-Hailuo-2.3', {
        prompt: `${loopPrompt}. Scene reference: misty mountain landscape with a lone horseback rider silhouette against golden sunrise, cinematic wide shot, atmospheric haze rolling through valleys, 3D-rendered Chinese ink-painting style.`,
      }, 'Hailuo-2.3 (T2V fallback)');
    } catch (e) {
      console.warn(`[hero] ⚠️ Hailuo-2.3 T2V: ${e.message}`);
    }
  }

  // Pass 4: vectorengine Veo 3.1
  try {
    const url = await tryVeoVideo(loopPrompt, coverImageUrl);
    if (url) return url;
  } catch (e) {
    console.warn(`[hero] ⚠️ Veo: ${e.message}`);
  }

  console.warn('[hero] ⚠️ All video paths exhausted; homepage will use static cover only');
  return null;
}

async function main() {
  if (!fs.existsSync(PUBLIC_DIR)) fs.mkdirSync(PUBLIC_DIR, { recursive: true });

  try {
    const coverUrl = await generateCoverImage();
    const coverPath = path.join(PUBLIC_DIR, 'hero-cover.jpg');
    await downloadTo(coverUrl, coverPath);

    const videoUrl = await generateLoopVideo(coverUrl);
    if (videoUrl) {
      const videoPath = path.join(PUBLIC_DIR, 'hero-loop.mp4');
      await downloadTo(videoUrl, videoPath);
      console.log('[hero] 🎉 All done. Cover + loop ready in public/');
    } else {
      console.log('[hero] 🖼️  Cover ready (public/hero-cover.jpg). Video loop skipped — homepage will use static image.');
    }
  } catch (e) {
    console.error('[hero] ❌ Failed:', e.message || e);
    process.exit(1);
  }
}

main();
