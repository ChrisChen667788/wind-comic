#!/usr/bin/env node
/**
 * XVERSE-Ent 编剧基准测试
 *
 * 用法:
 *   node scripts/xverse-benchmark.mjs                  # 默认 demo idea
 *   IDEA="一个赛博朋克侦探的孤独之夜" node scripts/xverse-benchmark.mjs
 *   SHOTS=8 node scripts/xverse-benchmark.mjs
 *
 * 环境变量:
 *   XVERSE_BASE_URL  (默认 http://localhost:8000/v1)
 *   XVERSE_MODEL     (默认 xverse/XVERSE-Ent-A5.7B)
 *   XVERSE_FAST_MODEL(默认 xverse/XVERSE-Ent-A4.2B)
 *   XVERSE_API_KEY   (可选)
 *
 * 输出 JSON 报告至 stdout，包含 Pass1/Pass2 耗时与剧本统计。
 *
 * 与 hybrid-orchestrator.runWriter() 共享同一套 prompt + 同一套子进程调用脚本，
 * 仅作为"无 Next.js 上下文"的快速验证入口。
 */

import { execFile } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const scriptPath = path.join(__dirname, 'xverse-call.mjs');

const BASE_URL = process.env.XVERSE_BASE_URL || 'http://localhost:8000/v1';
const API_KEY = process.env.XVERSE_API_KEY || '';
const MODEL = process.env.XVERSE_MODEL || 'xverse/XVERSE-Ent-A5.7B';
const FAST_MODEL = process.env.XVERSE_FAST_MODEL || 'xverse/XVERSE-Ent-A4.2B';
const IDEA = process.env.IDEA || '一个落魄少年在乱世重逢恩师，却被迫做出最艰难的抉择';
const TARGET_SHOTS = Number(process.env.SHOTS || 6);
const TIMEOUT = Number(process.env.TIMEOUT || 180000);

async function callXVerse({ system, user, model, json, maxTokens = 4096, temperature = 0.85 }) {
  const payload = {
    baseURL: BASE_URL,
    apiKey: API_KEY,
    model,
    system,
    user,
    maxTokens,
    timeout: TIMEOUT,
    temperature,
    topP: 0.9,
    responseFormat: json ? 'json_object' : undefined,
  };
  return new Promise((resolve) => {
    const t0 = Date.now();
    const child = execFile('node', [scriptPath], {
      timeout: TIMEOUT + 10_000,
      maxBuffer: 16 * 1024 * 1024,
    }, (err, stdout) => {
      if (err) {
        return resolve({ ok: false, error: err.killed ? 'timeout' : err.message, ms: Date.now() - t0 });
      }
      try {
        const parsed = JSON.parse(stdout);
        resolve({ ...parsed, ms: Date.now() - t0 });
      } catch {
        resolve({ ok: false, error: 'bad child stdout', ms: Date.now() - t0 });
      }
    });
    child.stdin.write(JSON.stringify(payload));
    child.stdin.end();
  });
}

function safeJSONParse(text) {
  if (!text) return null;
  try { return JSON.parse(text); } catch {/* fallthrough */}
  const s = text.indexOf('{'); const e = text.lastIndexOf('}');
  if (s >= 0 && e > s) {
    try { return JSON.parse(text.slice(s, e + 1)); } catch {/* ignore */}
  }
  return null;
}

const PASS1_SYS = `你是一位精通分镜的中文编剧。请先分析素材，规划镜头拆分方案。

【硬性规则】
- 你必须规划 ${TARGET_SHOTS} 到 ${TARGET_SHOTS + 4} 个镜头
- 一个场景通常拆分为 2-5 个镜头（每段重要对话/动作/情绪转折 = 1 个镜头）

【输出格式（纯文本，不要 JSON）】
首行写："共规划 N 个镜头"
然后逐行列出：
镜头1: [场景名] - [核心内容] - 角色:[名字] - 台词:"[原文台词]"
`;

const PASS2_SYS = `你是一位精通罗伯特·麦基方法论的顶级AI编剧。
请基于用户创意和镜头规划，输出严格的 JSON 剧本。

## 输出格式（严格JSON）
{
  "title": "...",
  "logline": "...",
  "synopsis": "...",
  "theme": "...",
  "incitingIncident": "...",
  "emotionCurve": { "overall": "...", "temperatures": [..] },
  "characterArcs": [{ "name": "...", "arc": "...", "desire": "...", "need": "...", "flaw": "...", "paradox": "...", "speechPattern": "..." }],
  "shots": [
    {
      "shotNumber": 1, "act": 1, "storyBeat": "...",
      "sceneDescription": "（120-200字，五感细节）",
      "visualPrompt": "（≥60 个英文单词的具体提示词）",
      "characters": ["..."], "dialogue": "...", "subtext": "...",
      "action": "...", "emotion": "...", "emotionTemperature": 0,
      "beat": "从 X 到 Y", "cameraWork": "...", "soundDesign": "...",
      "duration": 8
    }
  ]
}

shots 数组必须有 ${TARGET_SHOTS}-${TARGET_SHOTS + 4} 个镜头。`;

async function main() {
  console.error(`╔══════════════════════════════════════════════════════════╗`);
  console.error(`║ XVERSE-Ent 编剧基准测试`);
  console.error(`║   IDEA  : ${IDEA}`);
  console.error(`║   MODEL : ${MODEL}`);
  console.error(`║   FAST  : ${FAST_MODEL}`);
  console.error(`║   URL   : ${BASE_URL}`);
  console.error(`║   SHOTS : ${TARGET_SHOTS}`);
  console.error(`╚══════════════════════════════════════════════════════════╝`);

  // ── Pass 1: 镜头规划（A4.2B）
  console.error(`\n[1/2] Pass1 镜头规划（${FAST_MODEL}）...`);
  const t1 = Date.now();
  const pass1 = await callXVerse({
    system: PASS1_SYS,
    user: `用户创意：${IDEA}`,
    model: FAST_MODEL,
    json: false,
    maxTokens: 1500,
    temperature: 0.6,
  });
  const pass1Ms = Date.now() - t1;
  if (!pass1.ok) {
    console.error(`❌ Pass1 失败: ${pass1.error}`);
    process.exit(1);
  }
  const planShotCount = (pass1.content.match(/镜头\s*\d+/g) || []).length;
  console.error(`   ✅ ${pass1Ms}ms · 规划 ${planShotCount} 个镜头`);

  // ── Pass 2: 完整 JSON（A5.7B）
  console.error(`\n[2/2] Pass2 结构化剧本（${MODEL}）...`);
  const t2 = Date.now();
  const pass2 = await callXVerse({
    system: PASS2_SYS,
    user: `用户创意：${IDEA}\n\n══ Pass1 镜头规划 ══\n${pass1.content}\n\n请严格按照规划生成 JSON，shots 数组必须有 ${planShotCount || TARGET_SHOTS} 个镜头。`,
    model: MODEL,
    json: true,
    maxTokens: 8192,
  });
  const pass2Ms = Date.now() - t2;
  if (!pass2.ok) {
    console.error(`❌ Pass2 失败: ${pass2.error}`);
    process.exit(1);
  }
  const script = safeJSONParse(pass2.content);
  if (!script) {
    console.error(`❌ Pass2 JSON 解析失败`);
    console.error(pass2.content.slice(0, 500));
    process.exit(2);
  }
  console.error(`   ✅ ${pass2Ms}ms · ${(pass2.content.length / 1000).toFixed(1)}KB`);

  // ── 报告
  const report = {
    ok: true,
    idea: IDEA,
    model: { creative: MODEL, fast: FAST_MODEL },
    timing: {
      pass1Ms,
      pass2Ms,
      totalMs: pass1Ms + pass2Ms,
    },
    plannedShots: planShotCount,
    scriptStats: {
      title: script.title,
      logline: script.logline,
      shotsCount: script.shots?.length || 0,
      avgSceneDescChars: script.shots?.length
        ? Math.round(script.shots.reduce((s, x) => s + (x.sceneDescription?.length || 0), 0) / script.shots.length)
        : 0,
      avgVisualPromptWords: script.shots?.length
        ? Math.round(script.shots.reduce((s, x) => s + (x.visualPrompt?.split(/\s+/).length || 0), 0) / script.shots.length)
        : 0,
      hasSubtext: script.shots?.every(s => s.subtext) || false,
      hasEmotionCurve: !!(script.emotionCurve?.temperatures?.length),
      themeLength: (script.theme || '').length,
      synopsisLength: (script.synopsis || '').length,
    },
    usage: { pass1: pass1.usage, pass2: pass2.usage },
  };

  console.error(`\n────────────────────────────────────────────────────────────`);
  console.error(` 总耗时: ${(report.timing.totalMs / 1000).toFixed(1)}s`);
  console.error(` 镜头数: ${report.scriptStats.shotsCount}`);
  console.error(` 标题  : ${report.scriptStats.title}`);
  console.error(` 平均场景描写: ${report.scriptStats.avgSceneDescChars} 字`);
  console.error(` 平均视觉提示: ${report.scriptStats.avgVisualPromptWords} 单词`);
  console.error(` 全部带潜文本: ${report.scriptStats.hasSubtext ? '✅' : '❌'}`);
  console.error(`────────────────────────────────────────────────────────────`);

  // stdout: 完整 JSON 报告
  process.stdout.write(JSON.stringify({ report, script }, null, 2));
}

main().catch((e) => {
  console.error(`❌ benchmark 异常:`, e);
  process.exit(99);
});
