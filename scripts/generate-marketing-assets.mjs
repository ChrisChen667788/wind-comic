#!/usr/bin/env node
/**
 * Wind Comic — marketing asset generator.
 *
 * Generates README banner, logo, and OG card via any OpenAI-compatible
 * image-generation endpoint. Defaults to qingyuntop with flux.1-kontext-pro.
 *
 * Usage:
 *   QINGYUNTOP_API_KEY=sk-... node scripts/generate-marketing-assets.mjs
 *   # or
 *   OPENAI_API_KEY=sk-... OPENAI_BASE_URL=https://api.openai.com/v1 \
 *     IMAGE_MODEL=dall-e-3 node scripts/generate-marketing-assets.mjs
 *
 * Outputs to ./assets/.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'assets');

const API_KEY =
  process.env.QINGYUNTOP_API_KEY ||
  process.env.OPENAI_API_KEY ||
  '';
const BASE_URL =
  process.env.QINGYUNTOP_BASE_URL ||
  process.env.OPENAI_BASE_URL ||
  'https://api.qingyuntop.top';
const MODEL = process.env.IMAGE_MODEL || 'flux.1-kontext-pro';

if (!API_KEY) {
  console.error('✗ Set QINGYUNTOP_API_KEY (or OPENAI_API_KEY) in env.');
  process.exit(1);
}

/** Cinematic, high-quality prompts for Wind Comic brand identity. */
const ASSETS = [
  {
    name: 'banner.png',
    size: '1024x1024',
    prompt:
      'Ultra-wide cinematic banner for an AI short-drama studio called Wind Comic. ' +
      'Deep midnight blue background fading to ink-black, dramatic golden-amber wind streaks ' +
      'flowing horizontally across the frame, faint storyboard panels visible as a ghosted layer, ' +
      'tiny silhouette of a noir detective in profile on the right third, ' +
      'minimalist, no text, no watermark, photorealistic film-grain, IMAX aspect, 8k.',
  },
  {
    name: 'logo.png',
    size: '1024x1024',
    prompt:
      'Logo mark for Wind Comic, an AI cinematic studio. ' +
      'Single bold capital "W" formed by three flowing wind strokes in gold on a deep midnight-blue circle, ' +
      'inspired by Chinese ink-brush calligraphy meeting modern minimalist app icons, ' +
      'centered, symmetrical, vector-clean edges, no text, no background pattern, app-icon ready.',
  },
  {
    name: 'og-card.png',
    size: '1024x1024',
    prompt:
      'Social-media open-graph card for Wind Comic. ' +
      'Three cinematic comic-book panels in a horizontal triptych: ' +
      'left panel a screenwriter at a desk in warm lamplight, ' +
      'center panel a director silhouetted against a film set lit in golden-hour light, ' +
      'right panel a final-cut close-up of a character looking off-camera with cinematic shallow depth of field. ' +
      'Each panel framed in thin gold borders, deep midnight-blue gutters between panels. ' +
      'No text, no watermark, no logos, photorealistic style, 16:9 composition.',
  },
  {
    name: 'demo-storyboard.png',
    size: '1024x1024',
    prompt:
      'Mock UI screenshot of an AI storyboarding app called Wind Comic. ' +
      'Dark mode interface, six storyboard cards arranged in a 3x2 grid, ' +
      'each card showing a cinematic scene from a noir detective short film: ' +
      'rainy alley, neon Hong Kong street, smoky bar, close-up of a face, gunshot moment, ending wide. ' +
      'Above each card a small green/yellow consistency badge. ' +
      'Sidebar on left with agent chat avatars. Top bar shows "Wind Comic / Project: Rainy Reunion". ' +
      'Photorealistic UI mockup style, sharp pixel-perfect render, 16:9.',
  },
];

async function generateOne(asset) {
  const url = `${BASE_URL.replace(/\/$/, '')}/v1/images/generations`;
  console.log(`→ generating ${asset.name} (${MODEL})...`);

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: MODEL,
      prompt: asset.prompt,
      n: 1,
      size: asset.size,
    }),
    // 4-minute ceiling — image gen can take a while on busy gateways
    signal: AbortSignal.timeout(240_000),
  });

  if (!res.ok) {
    const errBody = await res.text().catch(() => '');
    throw new Error(`${asset.name} failed (${res.status}): ${errBody.slice(0, 200)}`);
  }

  const json = await res.json();
  const datum = json?.data?.[0];
  if (!datum) throw new Error(`${asset.name}: empty response`);

  let buffer;
  if (datum.b64_json) {
    buffer = Buffer.from(datum.b64_json, 'base64');
  } else if (datum.url) {
    const imgRes = await fetch(datum.url);
    if (!imgRes.ok) throw new Error(`${asset.name}: download failed (${imgRes.status})`);
    buffer = Buffer.from(await imgRes.arrayBuffer());
  } else {
    throw new Error(`${asset.name}: response had neither b64_json nor url`);
  }

  await fs.mkdir(OUT, { recursive: true });
  const outPath = path.join(OUT, asset.name);
  await fs.writeFile(outPath, buffer);
  console.log(`  ✓ wrote ${path.relative(ROOT, outPath)} (${buffer.length} bytes)`);
}

async function main() {
  console.log(`Wind Comic asset generator — model=${MODEL} base=${BASE_URL}\n`);
  for (const asset of ASSETS) {
    try {
      await generateOne(asset);
    } catch (err) {
      console.error(`  ✗ ${asset.name}: ${err.message}`);
    }
  }
  console.log('\ndone.');
}

main().catch((err) => {
  console.error('fatal:', err);
  process.exit(1);
});
