import { readFileSync } from "fs";
import { resolve } from "path";

// ── 1. Load .env.local manually ──────────────────────────────────────────────
const envPath = resolve(new URL(".", import.meta.url).pathname, "../.env.local");
console.log(`Loading env from: ${envPath}\n`);

const envContent = readFileSync(envPath, "utf-8");
for (const line of envContent.split("\n")) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("#")) continue;
  const eqIdx = trimmed.indexOf("=");
  if (eqIdx === -1) continue;
  const key = trimmed.slice(0, eqIdx).trim();
  let value = trimmed.slice(eqIdx + 1).trim();
  // Strip surrounding quotes
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    value = value.slice(1, -1);
  }
  process.env[key] = value;
}

const MINIMAX_API_KEY = process.env.MINIMAX_API_KEY;
const BANANA_API_KEY = process.env.BANANA_API_KEY;

console.log(`MINIMAX_API_KEY present: ${!!MINIMAX_API_KEY} (length: ${MINIMAX_API_KEY?.length ?? 0})`);
console.log(`BANANA_API_KEY present: ${!!BANANA_API_KEY} (length: ${BANANA_API_KEY?.length ?? 0})`);
console.log("─".repeat(70));

// Helper: sleep
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Helper: log full response
async function logResponse(label, res) {
  console.log(`\n${"═".repeat(70)}`);
  console.log(`  ${label}`);
  console.log(`${"═".repeat(70)}`);
  console.log(`Status: ${res.status} ${res.statusText}`);
  console.log(`Headers:`);
  for (const [k, v] of res.headers.entries()) {
    console.log(`  ${k}: ${v}`);
  }
  const text = await res.text();
  let parsed;
  try {
    parsed = JSON.parse(text);
    console.log(`Body (JSON):\n${JSON.stringify(parsed, null, 2)}`);
  } catch {
    console.log(`Body (raw):\n${text}`);
  }
  return parsed ?? text;
}

// ── 2. Test Minimax Image Generation ─────────────────────────────────────────
async function testMinimaxImage() {
  console.log("\n\n▶ TEST: Minimax Image Generation");
  try {
    const res = await fetch("https://api.minimaxi.com/v1/image_generation", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${MINIMAX_API_KEY}`,
      },
      body: JSON.stringify({
        model: "image-01",
        prompt: "a warrior in ancient Chinese armor, cinematic",
        prompt_optimizer: true,
        width: 1024,
        height: 1024,
      }),
    });
    return await logResponse("Minimax Image Generation", res);
  } catch (err) {
    console.error("Minimax Image Generation NETWORK ERROR:", err.message);
    return null;
  }
}

// ── 3. Test MJ Imagine Submit ────────────────────────────────────────────────
async function testMJImagine() {
  console.log("\n\n▶ TEST: MJ Imagine Submit");
  try {
    const res = await fetch("https://api.vectorengine.ai/mj/submit/imagine", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${BANANA_API_KEY}`,
      },
      body: JSON.stringify({
        prompt: "a warrior in armor, cinematic --ar 1:1 --v 6.1",
      }),
    });
    return await logResponse("MJ Imagine Submit", res);
  } catch (err) {
    console.error("MJ Imagine Submit NETWORK ERROR:", err.message);
    return null;
  }
}

// ── 4. Poll MJ result & test upscale ─────────────────────────────────────────
async function pollMJAndUpscale(taskId) {
  console.log(`\n\n▶ TEST: MJ Poll for task ${taskId}`);
  const maxAttempts = 30;
  for (let i = 0; i < maxAttempts; i++) {
    console.log(`  Polling attempt ${i + 1}/${maxAttempts}...`);
    try {
      const res = await fetch(`https://api.vectorengine.ai/mj/task/${taskId}/fetch`, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${BANANA_API_KEY}`,
        },
      });
      const body = await logResponse(`MJ Poll attempt ${i + 1}`, res);
      if (body && (body.status === "SUCCESS" || body.failReason)) {
        console.log(`\nTask finished with status: ${body.status}`);
        if (body.status === "SUCCESS") {
          // Test upscale
          return await testMJUpscale(taskId);
        }
        return body;
      }
    } catch (err) {
      console.error(`  Poll error: ${err.message}`);
    }
    await sleep(10000); // wait 10s between polls
  }
  console.log("  Polling timed out after 30 attempts.");
  return null;
}

async function testMJUpscale(taskId) {
  console.log(`\n\n▶ TEST: MJ Upscale (simple-change) for task ${taskId}`);
  try {
    const res = await fetch("https://api.vectorengine.ai/mj/submit/simple-change", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${BANANA_API_KEY}`,
      },
      body: JSON.stringify({
        content: `${taskId} U1`,
      }),
    });
    return await logResponse("MJ Upscale (simple-change)", res);
  } catch (err) {
    console.error("MJ Upscale NETWORK ERROR:", err.message);
    return null;
  }
}

// ── 5. Test Minimax Video Generation ─────────────────────────────────────────
async function testMinimaxVideo() {
  console.log("\n\n▶ TEST: Minimax Video Generation");
  try {
    const res = await fetch("https://api.minimaxi.com/v1/video_generation", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${MINIMAX_API_KEY}`,
      },
      body: JSON.stringify({
        model: "S2V-01",
        prompt: "a person walking",
        subject_reference: [
          {
            type: "character",
            image: [
              "https://image2.midjourneycloud.com/95703217-40ec-4d13-a316-d99ba867ba30_0_0.png",
            ],
          },
        ],
      }),
    });
    return await logResponse("Minimax Video Generation", res);
  } catch (err) {
    console.error("Minimax Video Generation NETWORK ERROR:", err.message);
    return null;
  }
}

// ── Run all tests ────────────────────────────────────────────────────────────
async function main() {
  console.log(`\nStarting API diagnostics at ${new Date().toISOString()}\n`);

  // Test 1: Minimax image
  await testMinimaxImage();

  // Test 2: MJ imagine
  const mjResult = await testMJImagine();

  // Test 3: If MJ imagine succeeded, poll and upscale
  if (mjResult && mjResult.code === 1) {
    const taskId = mjResult.result;
    console.log(`\nMJ imagine returned task ID: ${taskId}`);
    await pollMJAndUpscale(taskId);
  } else {
    console.log("\n⚠ MJ imagine did not return code===1, skipping poll/upscale.");
  }

  // Test 4: Minimax video
  await testMinimaxVideo();

  console.log(`\n\n${"═".repeat(70)}`);
  console.log("  ALL TESTS COMPLETE");
  console.log(`${"═".repeat(70)}\n`);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
