#!/usr/bin/env node
/**
 * scripts/seed-demo.mjs — 首跑就有东西看(v12.414)。
 *
 * ## 为什么
 * 竞品复核连着两轮把「上手门槛」判为最大战略劣势。这一轮逐条核过:
 * Dockerfile 有,但**没有 demo 工程** —— 新用户第一眼看到的是一个空工作台,
 * 得先读文档、配 key、想一个点子,才可能看到第一帧画面。
 * 零代码平台那边是打开就有样例可玩。差距不在功能,在**第一分钟**。
 *
 * 这个脚本在 demo 模式下塞一个**已完成的示例项目**,
 * 让人一进来就能看到「剧本 → 分镜 → 成片」长什么样,再决定要不要配 key。
 *
 * ## 一条不能省的诚实
 * demo 项目里的素材是 MOCK_ENGINES 的确定性假产物(SVG / 纯色短片 / 正弦音)。
 * 标题与描述里**必须写明这是演示占位、不代表真实生成质量** ——
 * 拿占位片冒充成片,正是这个项目一直在消灭的那种事(v12.394 的 Ken Burns
 * 占位片曾被当成成片、导致续跑永久跳过,教训就在那里)。
 *
 * 幂等:已存在同名 demo 项目则跳过,不重复塞。
 */
import { randomUUID } from 'crypto';

const ENABLED = process.env.SEED_DEMO_PROJECT === '1';
const DEMO_TITLE = '【演示】月挂不下来 — Wind Comic 示例工程';

if (!ENABLED) {
  console.log('[seed-demo] 未开启(SEED_DEMO_PROJECT=1 才会塞演示工程)');
  process.exit(0);
}

if (process.env.MOCK_ENGINES !== '1') {
  // 真引擎模式下塞假素材会污染真实项目列表 —— 宁可不做
  console.log('[seed-demo] 只在 MOCK_ENGINES=1 的 demo 模式下运行,已跳过');
  process.exit(0);
}

const { db } = await import('../lib/db.js').catch(() => ({ db: null }));
if (!db) {
  console.log('[seed-demo] 拿不到 db 句柄,跳过(不影响启动)');
  process.exit(0);
}

try {
  const existing = db.prepare('SELECT id FROM projects WHERE title = ? LIMIT 1').get(DEMO_TITLE);
  if (existing) {
    console.log('[seed-demo] 演示工程已存在,跳过');
    process.exit(0);
  }

  const id = randomUUID();
  db.prepare(
    `INSERT INTO projects (id, title, idea, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    DEMO_TITLE,
    '一个关于「把月亮摘下来」的短剧示例。⚠️ 本工程中的画面/视频/配音均为演示占位' +
      '(mock 引擎确定性产出),**不代表真实生成质量**;配一个真实 API key 即可切换真引擎。',
    'demo',
    new Date().toISOString(),
    new Date().toISOString(),
  );
  console.log(`[seed-demo] ✅ 已塞入演示工程 ${id}`);
} catch (e) {
  // 演示工程塞不进去不该阻断启动
  console.log('[seed-demo] 跳过:', e instanceof Error ? e.message : e);
}
