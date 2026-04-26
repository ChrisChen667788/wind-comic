/**
 * Generate style preset preview images via Midjourney API
 *
 * 流程: imagine(4宫格) → U1 upscale(单图) → 保存URL
 *
 * Usage: npx tsx scripts/generate-style-previews.ts
 */
import fs from 'fs';
import path from 'path';

// Read .env.local manually (no dotenv dependency needed)
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

const MJ_BASE_URL = 'https://api.vectorengine.ai';
const MJ_API_KEY = process.env.BANANA_API_KEY || '';

if (!MJ_API_KEY || MJ_API_KEY.startsWith('your_')) {
  console.error('❌ BANANA_API_KEY not configured in .env.local');
  process.exit(1);
}

function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }

// Style presets with MJ-optimized prompts (单张高质量预览图)
const STYLE_PROMPTS: Record<string, string> = {
  'poetic-mist': 'A solitary figure walking through misty mountains at dawn, ethereal Chinese watercolor painting style, ink wash landscape, soft diffused light through fog, delicate brush strokes, silk scroll painting aesthetic, muted pastels with ink black accents, contemplative mood --ar 4:5 --v 6.1 --style raw',
  'neo-noir': 'A detective in a rain-soaked alley at night, neon signs reflecting in puddles, dramatic chiaroscuro lighting, film noir cinematography, high contrast shadows, vintage crime thriller aesthetic, dark moody atmosphere, grain texture --ar 4:5 --v 6.1 --style raw',
  'ink-wash': 'Ancient Chinese pavilion on a cliff edge with waterfall, traditional sumi-e ink painting, minimal brushwork, negative space composition, rice paper texture, Song Dynasty landscape painting style, flowing ink gradients, zen aesthetic --ar 4:5 --v 6.1 --style raw',
  'dreamwave': 'A girl floating through a surreal underwater dreamscape with bioluminescent creatures, vaporwave color palette, iridescent gradients, dreamy soft focus, pastel neon purple and pink hues, fantastical otherworldly atmosphere --ar 4:5 --v 6.1 --style raw',
  'cyber-neon': 'A cyberpunk city street at night with holographic advertisements, futuristic neon-lit skyscrapers, cybernetic characters, glowing circuitry patterns, electric blue and magenta palette, blade runner inspired, rain reflections --ar 4:5 --v 6.1 --style raw',
  'anime-3d': 'A young warrior standing before an ancient Chinese temple gate, 3D rendered in donghua animation style, dramatic lighting, Chinese mythology inspired, ornate armor design, volumetric god rays, CG animation quality --ar 4:5 --v 6.1 --style raw',
  'cinematic': 'A lone traveler on horseback crossing vast desert dunes at golden hour, cinematic wide angle lens, Roger Deakins cinematography, photorealistic, anamorphic lens flare, epic scale landscape, film grain, 35mm texture --ar 4:5 --v 6.1 --style raw',
  'ghibli': 'A cozy countryside cottage surrounded by wildflowers and butterflies, Studio Ghibli animation style, warm golden afternoon light, hand-painted watercolor textures, whimsical pastoral scene, Hayao Miyazaki inspired, gentle breeze --ar 4:5 --v 6.1 --style raw',
};

async function submitImagine(prompt: string, maxRetries = 5): Promise<string> {
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    if (attempt > 0) {
      const delay = 15000 * attempt;
      console.log(`   ⏳ Retry ${attempt}/${maxRetries} in ${delay / 1000}s...`);
      await sleep(delay);
    }

    const res = await fetch(`${MJ_BASE_URL}/mj/submit/imagine`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${MJ_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ prompt }),
    });
    const data = await res.json();
    if (data.code === 1 && data.result) {
      return data.result; // taskId
    }

    const errMsg = data.description || JSON.stringify(data);
    if (errMsg.includes('饱和') || errMsg.includes('限') || errMsg.includes('busy')) {
      console.log(`   ⚠️  Server busy: ${errMsg}`);
      continue;
    }
    throw new Error(`Submit failed: ${errMsg}`);
  }
  throw new Error('Max retries exceeded - server still busy');
}

/** 提交 upscale 请求（从四宫格中提取单张图片）*/
async function submitUpscale(imagineTaskId: string, index: 1 | 2 | 3 | 4 = 1): Promise<string> {
  // 方法1: simple-change
  const res = await fetch(`${MJ_BASE_URL}/mj/submit/simple-change`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${MJ_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ content: `${imagineTaskId} U${index}` }),
  });
  const data = await res.json();
  if (data.code === 1 && data.result) {
    return data.result; // upscale taskId
  }

  // 方法2: action endpoint (fallback)
  console.log(`   simple-change failed: ${data.description}, trying action...`);
  const taskRes = await fetch(`${MJ_BASE_URL}/mj/task/${imagineTaskId}/fetch`, {
    headers: { 'Authorization': `Bearer ${MJ_API_KEY}` },
  });
  const taskData = await taskRes.json();
  const buttons = taskData.buttons || [];
  const btn = buttons.find((b: any) =>
    b.customId?.includes(`upsample::${index}`) || b.emoji === `U${index}`
  );

  if (!btn?.customId) {
    throw new Error(`No U${index} button found in task ${imagineTaskId}`);
  }

  const actionRes = await fetch(`${MJ_BASE_URL}/mj/submit/action`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${MJ_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ customId: btn.customId, taskId: imagineTaskId }),
  });
  const actionData = await actionRes.json();
  if (actionData.code === 1 && actionData.result) {
    return actionData.result;
  }
  throw new Error(`Action upscale failed: ${actionData.description || JSON.stringify(actionData)}`);
}

async function pollResult(taskId: string): Promise<string> {
  for (let i = 0; i < 72; i++) { // 6 min timeout
    await sleep(5000);
    const res = await fetch(`${MJ_BASE_URL}/mj/task/${taskId}/fetch`, {
      headers: { 'Authorization': `Bearer ${MJ_API_KEY}` },
    });
    if (!res.ok) throw new Error(`Fetch error: ${res.status}`);
    const data = await res.json();
    if (data.status === 'SUCCESS' && data.imageUrl) return data.imageUrl;
    if (data.status === 'FAILURE') throw new Error(`Failed: ${data.failReason}`);
    process.stdout.write(`  ${data.progress || '...'}\r`);
  }
  throw new Error('Timeout');
}

async function main() {
  const outputPath = path.join(process.cwd(), 'public', 'style-previews.json');

  // Load existing results (resume support)
  let results: Record<string, string> = {};
  if (fs.existsSync(outputPath)) {
    try { results = JSON.parse(fs.readFileSync(outputPath, 'utf-8')); } catch {}
  }

  const entries = Object.entries(STYLE_PROMPTS);
  console.log(`\n🎨 Generating ${entries.length} style previews via Midjourney (imagine → U1 upscale → single image)...\n`);

  for (let idx = 0; idx < entries.length; idx++) {
    const [id, prompt] = entries[idx];
    if (results[id] && results[id].startsWith('http')) {
      console.log(`✅ ${id}: already generated, skipping`);
      continue;
    }

    console.log(`🖌️  [${idx + 1}/${entries.length}] ${id}: submitting imagine...`);
    try {
      // Step 1: Imagine → 四宫格
      const imagineTaskId = await submitImagine(prompt);
      console.log(`   Imagine task: ${imagineTaskId}, polling...`);
      const gridImageUrl = await pollResult(imagineTaskId);
      console.log(`   ✅ 四宫格: ${gridImageUrl.slice(0, 60)}...`);

      // Step 2: U1 Upscale → 单张图片
      console.log(`   🔍 Upscaling U1...`);
      const upscaleTaskId = await submitUpscale(imagineTaskId, 1);
      console.log(`   Upscale task: ${upscaleTaskId}, polling...`);
      const singleImageUrl = await pollResult(upscaleTaskId);

      results[id] = singleImageUrl;
      console.log(`✅ ${id}: ${singleImageUrl.slice(0, 80)}...`);

      // Save after each success (resume-safe)
      fs.writeFileSync(outputPath, JSON.stringify(results, null, 2));

      // Wait between requests to avoid overloading
      console.log(`   Cooling down 10s...`);
      await sleep(10000);
    } catch (e: any) {
      console.error(`❌ ${id}: ${e.message}`);
      results[id] = '';
    }
  }

  fs.writeFileSync(outputPath, JSON.stringify(results, null, 2));
  console.log(`\n✨ Done! Results saved to ${outputPath}`);
  console.log(`   ${Object.values(results).filter(Boolean).length}/${entries.length} successful`);
}

main().catch(e => { console.error(e); process.exit(1); });
