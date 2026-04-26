#!/usr/bin/env node
/**
 * 视频生成 API 探测脚本
 *
 * 逐一尝试 qingyuntop 聚合网关上的视频模型，报告哪些可用。
 *
 * 用法:
 *   node scripts/video-probe.mjs
 *   node scripts/video-probe.mjs --quick        # 只测 sora-2
 *   node scripts/video-probe.mjs --all          # 测全部候选模型
 *   node scripts/video-probe.mjs --models sora-2,veo3.1-fast
 *
 * 环境变量:
 *   QINGYUNTOP_API_KEY 或 VEO_API_KEY   必填
 *   QINGYUNTOP_BASE_URL 或 VEO_BASE_URL 默认 https://api.qingyuntop.top
 *   PROBE_TIMEOUT_MS                    默认 180000（3 分钟）
 *   PROBE_POLL_INTERVAL_MS              默认 5000
 *
 * 输出：控制台彩色表格 + stdout JSON（可重定向到文件）
 */

import { readFileSync, existsSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// ── 加载 .env.local（不依赖 dotenv，自己解析） ──
const __dirname = path.dirname(fileURLToPath(import.meta.url));
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

const API_KEY = process.env.QINGYUNTOP_API_KEY || process.env.VEO_API_KEY || '';
const BASE_URL = (process.env.QINGYUNTOP_BASE_URL || process.env.VEO_BASE_URL || 'https://api.qingyuntop.top').replace(/\/$/, '');
const TIMEOUT_MS = Number(process.env.PROBE_TIMEOUT_MS || 180000);
const POLL_MS = Number(process.env.PROBE_POLL_INTERVAL_MS || 5000);

if (!API_KEY) {
  console.error('❌ 缺少 QINGYUNTOP_API_KEY / VEO_API_KEY，请先在 .env.local 设置');
  process.exit(1);
}

// ── 候选模型列表 ──
// format: 'openai' = POST /v1/videos + GET /v1/videos/<id>
// format: 'unified' = POST /v1/video/create + GET /v1/video/query?id=<id>
const CANDIDATES = [
  // 已实测稳定
  { model: 'sora-2',         format: 'openai',  seconds: '4',  size: '720x1280', tier: 'primary' },
  // 谷歌系列
  { model: 'veo3.1-fast',    format: 'unified', duration: 4, tier: 'primary' },
  { model: 'veo3.1',         format: 'unified', duration: 4, tier: 'secondary' },
  { model: 'veo3-fast',      format: 'unified', duration: 4, tier: 'secondary' },
  { model: 'veo2-fast',      format: 'unified', duration: 4, tier: 'secondary' },
  // 字节/Minimax/Vidu 等（通过 unified 协议）
  { model: 'MiniMax-Hailuo-02',            format: 'unified', duration: 6, tier: 'tertiary' },
  { model: 'doubao-seedance-1-0-lite-t2v-250428', format: 'unified', duration: 5, tier: 'tertiary' },
  { model: 'viduq1',         format: 'unified', duration: 4, tier: 'tertiary' },
];

// ── CLI 参数 ──
const args = process.argv.slice(2);
let models = CANDIDATES;
if (args.includes('--quick')) {
  models = CANDIDATES.filter(c => c.model === 'sora-2');
} else if (args.includes('--all')) {
  models = CANDIDATES;
} else {
  const idx = args.indexOf('--models');
  if (idx >= 0 && args[idx + 1]) {
    const want = args[idx + 1].split(',').map(s => s.trim());
    models = CANDIDATES.filter(c => want.includes(c.model));
    if (models.length === 0) {
      console.error(`❌ --models 未匹配任何候选: ${want.join(', ')}`);
      console.error(`可选: ${CANDIDATES.map(c => c.model).join(', ')}`);
      process.exit(1);
    }
  } else {
    // 默认只跑 primary
    models = CANDIDATES.filter(c => c.tier === 'primary');
  }
}

const PROMPT = 'A serene Chinese garden at sunset, a white crane standing gracefully by the lotus pond, cinematic lighting, soft camera push-in, peaceful atmosphere';

// ── HTTP 工具 ──
async function httpJSON(url, init, timeoutMs = 30_000) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const resp = await fetch(url, { ...init, signal: ctl.signal });
    const text = await resp.text();
    let json = null;
    try { json = JSON.parse(text); } catch { /* not json */ }
    return { ok: resp.ok, status: resp.status, text, json };
  } finally {
    clearTimeout(t);
  }
}

// ── 创建任务 ──
async function createTask(cand) {
  if (cand.format === 'openai') {
    const body = { model: cand.model, prompt: PROMPT, seconds: cand.seconds || '4', size: cand.size || '720x1280' };
    const r = await httpJSON(`${BASE_URL}/v1/videos`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!r.ok) return { ok: false, step: 'create', status: r.status, error: (r.text || '').slice(0, 300) };
    const id = r.json?.id || r.json?.task_id;
    if (!id) return { ok: false, step: 'create', error: 'no id', body: r.text?.slice(0, 300) };
    return { ok: true, id, initial: r.json };
  } else {
    const body = { model: cand.model, prompt: PROMPT };
    if (cand.duration) body.duration = cand.duration;
    const r = await httpJSON(`${BASE_URL}/v1/video/create`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!r.ok) return { ok: false, step: 'create', status: r.status, error: (r.text || '').slice(0, 300) };
    const id = r.json?.id || r.json?.task_id;
    if (!id) return { ok: false, step: 'create', error: 'no id', body: r.text?.slice(0, 300) };
    return { ok: true, id, initial: r.json };
  }
}

// ── 查询任务 ──
async function queryTask(cand, id) {
  if (cand.format === 'openai') {
    const r = await httpJSON(`${BASE_URL}/v1/videos/${encodeURIComponent(id)}`, {
      headers: { 'Authorization': `Bearer ${API_KEY}` },
    }, 15_000);
    if (!r.ok) return { ok: false, status: r.status, error: (r.text || '').slice(0, 300) };
    return { ok: true, data: r.json };
  } else {
    const r = await httpJSON(`${BASE_URL}/v1/video/query?id=${encodeURIComponent(id)}`, {
      headers: { 'Authorization': `Bearer ${API_KEY}` },
    }, 15_000);
    if (!r.ok) return { ok: false, status: r.status, error: (r.text || '').slice(0, 300) };
    return { ok: true, data: r.json };
  }
}

// ── 状态归一 ──
function normalizeStatus(s) {
  const x = String(s || '').toLowerCase();
  if (['completed', 'succeed', 'success', 'finished'].includes(x)) return 'completed';
  if (['failed', 'cancelled', 'canceled', 'error', 'video_generation_failed'].includes(x)) return 'failed';
  return 'processing';
}

function extractUrl(d) {
  return d?.video_url
    || d?.result_url
    || d?.result?.video_url
    || d?.result?.url
    || d?.task_result?.videos?.[0]?.url
    || d?.output?.video_url
    || d?.output?.url
    || null;
}

// ── 单个模型探测 ──
async function probe(cand) {
  const t0 = Date.now();
  process.stderr.write(`\n🔎 [${cand.model}]  format=${cand.format}\n`);

  const c = await createTask(cand);
  if (!c.ok) {
    process.stderr.write(`   ❌ create failed (step=${c.step}): ${c.error || c.body}\n`);
    return { model: cand.model, format: cand.format, ok: false, step: 'create', error: c.error || c.body, ms: Date.now() - t0 };
  }
  process.stderr.write(`   ✓ created: ${c.id}\n`);

  const deadline = Date.now() + TIMEOUT_MS;
  let attempts = 0;
  while (Date.now() < deadline) {
    attempts++;
    await new Promise(r => setTimeout(r, POLL_MS));
    const q = await queryTask(cand, c.id);
    if (!q.ok) {
      process.stderr.write(`   ⚠ poll #${attempts} http-error: ${q.status} ${q.error}\n`);
      continue;
    }
    const rawStatus = q.data?.status || 'unknown';
    const norm = normalizeStatus(rawStatus);
    const prog = q.data?.progress ?? '-';
    process.stderr.write(`   … poll #${attempts}: ${rawStatus} (${prog}%)\n`);

    if (norm === 'completed') {
      const url = extractUrl(q.data);
      if (url) {
        process.stderr.write(`   ✅ done in ${((Date.now() - t0) / 1000).toFixed(1)}s\n`);
        process.stderr.write(`   🎬 ${url.slice(0, 100)}...\n`);
        return { model: cand.model, format: cand.format, ok: true, url, ms: Date.now() - t0, attempts };
      } else {
        return { model: cand.model, format: cand.format, ok: false, error: 'completed but no url', ms: Date.now() - t0 };
      }
    }
    if (norm === 'failed') {
      const err = q.data?.error || q.data?.fail_reason || rawStatus;
      process.stderr.write(`   ❌ failed: ${typeof err === 'string' ? err : JSON.stringify(err).slice(0, 200)}\n`);
      return { model: cand.model, format: cand.format, ok: false, error: err, ms: Date.now() - t0 };
    }
  }
  return { model: cand.model, format: cand.format, ok: false, error: 'timeout', ms: Date.now() - t0 };
}

// ── 主函数 ──
async function main() {
  process.stderr.write(`╔═══════════════════════════════════════════════════════════════╗\n`);
  process.stderr.write(`║ 🎬 Video Probe — qingyuntop 聚合网关视频 API 探测\n`);
  process.stderr.write(`║   URL : ${BASE_URL}\n`);
  process.stderr.write(`║   KEY : ${API_KEY.slice(0, 12)}...${API_KEY.slice(-6)}\n`);
  process.stderr.write(`║   候选: ${models.map(m => m.model).join(', ')}\n`);
  process.stderr.write(`╚═══════════════════════════════════════════════════════════════╝\n`);

  const results = [];
  for (const cand of models) {
    const r = await probe(cand);
    results.push(r);
  }

  // 汇总
  process.stderr.write(`\n╔═══════════════════════════════════════════════════════════════╗\n`);
  process.stderr.write(`║ 探测结果汇总\n`);
  process.stderr.write(`╚═══════════════════════════════════════════════════════════════╝\n`);
  for (const r of results) {
    const icon = r.ok ? '✅' : '❌';
    const time = `${(r.ms / 1000).toFixed(1)}s`.padStart(7);
    const err = r.ok ? '' : ` · ${typeof r.error === 'string' ? r.error.slice(0, 60) : JSON.stringify(r.error).slice(0, 60)}`;
    process.stderr.write(`   ${icon}  ${r.model.padEnd(40)}  ${time}${err}\n`);
  }

  // stdout: 完整 JSON
  process.stdout.write(JSON.stringify({
    ok: results.some(r => r.ok),
    baseURL: BASE_URL,
    results,
    summary: {
      total: results.length,
      passed: results.filter(r => r.ok).length,
      failed: results.filter(r => !r.ok).length,
      fastest: results.filter(r => r.ok).sort((a, b) => a.ms - b.ms)[0]?.model || null,
    },
  }, null, 2));

  process.exit(results.some(r => r.ok) ? 0 : 2);
}

main().catch((e) => {
  console.error('❌ probe 脚本异常:', e);
  process.exit(99);
});
