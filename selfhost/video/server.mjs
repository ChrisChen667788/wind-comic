#!/usr/bin/env node
/**
 * selfhost/video/server.mjs — 自托管视频端点的**参考实现**(v12.420)。
 *
 * ## 为什么需要它
 * v12.411 接通了「自托管开源生成端点」,但只给了一份 **HTTP 契约** ——
 * 用户想用 Wan 2.7 / LTX-2.5,还得自己写一个服务把推理脚本包成那个契约。
 * 竞品复核把这条记成了 C14:「接了但没到位」——
 * 接口有了,离用户真能用还差一层,而那一层的门槛不低。
 *
 * 这个文件就是那一层:一个零依赖(只用 node 内置模块)的适配器,
 * 把「你本地已有的推理命令」暴露成 Wind Comic 认的端点。
 *
 * ## 它不做什么(重要)
 * **它不含模型权重,也不替你装推理环境。** 它做的是编排:
 * 收请求 → 起一个你指定的命令 → 把产出的 mp4 交回去。
 * 声称「一键跑起 Wan 2.7」会是谎话:权重几十 GB、显存要求实打实,
 * 那些必须由用户自己准备。这里只消灭「还得自己写一个 HTTP 服务」这一步。
 *
 * ## 用法
 *   VIDEO_CMD='python /models/wan2.7/infer.py --prompt {prompt} --out {out} --seconds {duration}' \
 *   node selfhost/video/server.mjs
 *
 * 占位符会被替换:{prompt} {out} {duration} {aspect} {image} {model}
 * 命令跑完后 {out} 那个文件必须存在 —— 否则本服务如实报错,不返回空成功。
 *
 * 然后在 Wind Comic 侧:
 *   SELFHOST_VIDEO_URL=http://localhost:8188/generate
 *   SELFHOST_VIDEO_MODEL=wan2.7
 *
 * ## 契约(与 services/selfhost-video.service.ts 一致)
 *   POST /generate  { prompt, image_url?, duration, aspect_ratio, model? }
 *     → { task_id }
 *   GET  /generate/{task_id}
 *     → { status: 'processing'|'succeeded'|'failed', url?, error? }
 *
 * 走异步是因为视频推理动辄几分钟:同步返回会让上游的 HTTP 超时先到,
 * 而那时任务其实还在跑 —— 白烧一次算力。
 */
import http from 'node:http';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';

const PORT = Number(process.env.PORT) || 8188;
const VIDEO_CMD = process.env.VIDEO_CMD || '';
const OUT_DIR = process.env.OUT_DIR || path.join(os.tmpdir(), 'wind-comic-selfhost');
/** 单个任务最长跑多久 —— 超了杀掉,免得挂死占住显存 */
const TASK_TIMEOUT_MS = Number(process.env.TASK_TIMEOUT_MS) || 20 * 60_000;
/** 同时最多跑几个 —— 显存是硬约束,并发跑只会一起 OOM */
const MAX_CONCURRENT = Number(process.env.MAX_CONCURRENT) || 1;

fs.mkdirSync(OUT_DIR, { recursive: true });

/** task_id → { status, url, error, startedAt } */
const tasks = new Map();
let running = 0;
const queue = [];

const json = (res, code, body) => {
  const s = JSON.stringify(body);
  res.writeHead(code, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(s) });
  res.end(s);
};

/** 占位符替换。**用参数数组而不是 shell 字符串** —— prompt 是用户输入,拼进 shell 就是命令注入。 */
function buildArgv(spec, vars) {
  const parts = spec.match(/"[^"]*"|'[^']*'|\S+/g) || [];
  return parts.map((raw) => {
    const t = raw.replace(/^["']|["']$/g, '');
    return t.replace(/\{(prompt|out|duration|aspect|image|model)\}/g, (_, k) => String(vars[k] ?? ''));
  });
}

function pump() {
  while (running < MAX_CONCURRENT && queue.length) {
    const job = queue.shift();
    running++;
    runJob(job).finally(() => { running--; pump(); });
  }
}

async function runJob({ id, body }) {
  const out = path.join(OUT_DIR, `${id}.mp4`);
  const argv = buildArgv(VIDEO_CMD, {
    prompt: body.prompt || '',
    out,
    duration: String(body.duration ?? 5),
    aspect: body.aspect_ratio || '9:16',
    image: body.image_url || '',
    model: body.model || process.env.SELFHOST_VIDEO_MODEL || '',
  });
  if (!argv.length) {
    tasks.set(id, { status: 'failed', error: 'VIDEO_CMD 未配置(本服务只编排,不自带推理)' });
    return;
  }

  console.log(`[selfhost] ${id} → ${argv[0]} …(${argv.length - 1} 个参数)`);
  await new Promise((resolve) => {
    // shell:false —— prompt 来自外部,绝不进 shell
    const child = spawn(argv[0], argv.slice(1), { shell: false, stdio: ['ignore', 'pipe', 'pipe'] });
    let stderrTail = '';
    child.stderr.on('data', (d) => { stderrTail = (stderrTail + d.toString()).slice(-2000); });
    child.stdout.on('data', (d) => process.stdout.write(`[${id}] ${d}`));

    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      tasks.set(id, { status: 'failed', error: `推理超时(${Math.round(TASK_TIMEOUT_MS / 60000)} 分钟),已杀掉以释放显存` });
    }, TASK_TIMEOUT_MS);

    child.on('error', (e) => {
      clearTimeout(timer);
      tasks.set(id, { status: 'failed', error: `起不来:${e.message}` });
      resolve();
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (tasks.get(id)?.status === 'failed') return resolve();
      // 退出码 0 不代表出片了 —— 必须确认文件真的在,否则就是「成功了但没有产物」
      if (code === 0 && fs.existsSync(out) && fs.statSync(out).size > 0) {
        tasks.set(id, { status: 'succeeded', url: `/files/${id}.mp4` });
      } else {
        tasks.set(id, {
          status: 'failed',
          error: code === 0
            ? `退出码 0 但产物不存在或为空(${out})—— 命令里的 {out} 是否被用上了?`
            : `退出码 ${code}${stderrTail ? `:${stderrTail.slice(-400)}` : ''}`,
        });
      }
      resolve();
    });
  });
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);

  if (req.method === 'GET' && url.pathname === '/health') {
    return json(res, 200, {
      ok: true,
      cmdConfigured: !!VIDEO_CMD,
      running,
      queued: queue.length,
      maxConcurrent: MAX_CONCURRENT,
    });
  }

  // 取片:上游拿到的是相对 url,这里把它变成真文件
  if (req.method === 'GET' && url.pathname.startsWith('/files/')) {
    const name = path.basename(url.pathname);
    const f = path.join(OUT_DIR, name);
    // 只允许取本服务自己产出的文件名形态,避免路径穿越
    if (!/^[A-Za-z0-9_-]+\.mp4$/.test(name) || !fs.existsSync(f)) return json(res, 404, { error: 'not found' });
    res.writeHead(200, { 'Content-Type': 'video/mp4', 'Content-Length': fs.statSync(f).size });
    return fs.createReadStream(f).pipe(res);
  }

  if (req.method === 'GET' && url.pathname.startsWith('/generate/')) {
    const id = path.basename(url.pathname);
    const t = tasks.get(id);
    if (!t) return json(res, 404, { status: 'failed', error: 'unknown task' });
    return json(res, 200, {
      status: t.status,
      // 回绝对 url —— 上游校验 http 开头
      ...(t.url ? { url: `${process.env.PUBLIC_BASE_URL || `http://localhost:${PORT}`}${t.url}` } : {}),
      ...(t.error ? { error: t.error } : {}),
    });
  }

  if (req.method === 'POST' && url.pathname === '/generate') {
    let raw = '';
    req.on('data', (d) => {
      raw += d;
      if (raw.length > 1_000_000) { req.destroy(); }
    });
    req.on('end', () => {
      let body;
      try { body = JSON.parse(raw || '{}'); } catch { return json(res, 400, { error: 'invalid JSON' }); }
      if (!body.prompt || typeof body.prompt !== 'string') return json(res, 400, { error: 'prompt 必填' });
      if (!VIDEO_CMD) {
        // 说清楚它为什么不能干活 —— 而不是返回一个空成功让上游以为出片了
        return json(res, 503, { error: 'VIDEO_CMD 未配置。本服务只做编排,不自带模型权重与推理环境;请指定你本地已有的推理命令。' });
      }
      const id = crypto.randomUUID().replace(/-/g, '').slice(0, 16);
      tasks.set(id, { status: 'processing', startedAt: Date.now() });
      queue.push({ id, body });
      pump();
      return json(res, 200, { task_id: id });
    });
    return;
  }

  json(res, 404, { error: 'not found' });
});

server.listen(PORT, () => {
  console.log(`[selfhost] 视频适配器已启动:http://localhost:${PORT}`);
  console.log(`[selfhost] VIDEO_CMD ${VIDEO_CMD ? '已配置' : '**未配置** —— /generate 会返回 503 并说明原因'}`);
  console.log(`[selfhost] 产物目录 ${OUT_DIR} · 并发上限 ${MAX_CONCURRENT} · 单任务超时 ${Math.round(TASK_TIMEOUT_MS / 60000)} 分钟`);
  console.log('[selfhost] 在 Wind Comic 侧设 SELFHOST_VIDEO_URL=http://localhost:' + PORT + '/generate');
});
