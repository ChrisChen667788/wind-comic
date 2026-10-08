/**
 * scripts/probe-sketch-engines.ts — 草图锁的**真调**验证(v12.465)。会花钱:每个引擎出一张图。
 *
 * 渲一张有辨识度的导演台布局草图(近处大人在左下、远处小人在右上,高机位 +「对准人物」压下俯仰),
 * 用本仓真实的请求格式分别送各引擎;提示词里**不写**谁在左谁在右 —— 出图若照草图摆,说明引擎真看到并用了草图。
 * 用的是 .env.local 里你自己配的 key;**不打印任何密钥**,只记录 主机+路径、状态码、请求体概要。
 *
 * 用法(必须带 --yes,防误跑扣费):
 *   npx tsx scripts/probe-sketch-engines.ts --yes seedream kontext mj
 *   引擎:minimax(草图当人像参考,预期不跟构图)| minimax-face(真人照参考,验请求格式)| mj | seedream | kontext
 *   产物:草图与各家出图写到 /tmp/sketch-probe-<时间>/(或 PROBE_OUT 指定的目录),肉眼对照构图。
 *
 * v12.465 时的结果:MiniMax 修好 image_file 格式后出图成功、但不跟草图构图;MJ(vectorengine)503 无可用渠道,
 * Seedream(qingyuntop)401 额度耗尽,kontext(vectorengine)429 上游饱和 —— 账号恢复后用本脚本补验。
 */
import fs from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
if (!args.includes('--yes')) {
  console.log('这个脚本会真调出图引擎并扣额度(每家一张)。确认后加 --yes 再跑,例如:npx tsx scripts/probe-sketch-engines.ts --yes seedream');
  process.exit(1);
}
const which = new Set(args.filter((a) => a !== '--yes'));
const OUT = process.env.PROBE_OUT || path.join('/tmp', `sketch-probe-${new Date().toISOString().replace(/[:.]/g, '-')}`);
fs.mkdirSync(OUT, { recursive: true });

// .env.local → process.env(已在环境里的优先);不回显任何值
if (fs.existsSync('.env.local')) {
  for (const line of fs.readFileSync('.env.local', 'utf8').split('\n')) {
    const m = line.trim().match(/^([A-Z0-9_]+)=(.*)$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].trim().replace(/^['"]|['"]$/g, '');
  }
}
if (process.env.MOCK_ENGINES === '1') { console.log('MOCK_ENGINES=1 时不会真调,先去掉它'); process.exit(1); }

const log = (...a: unknown[]) => console.log('[probe]', ...a);
const shorten = (_k: string, v: unknown) => (typeof v === 'string' && v.length > 120 ? `${v.slice(0, 40)}…(${v.length} chars)` : v);

async function main() {
  // 本机经代理上网时,Node 的 fetch 默认不读 HTTPS_PROXY —— 与 dev server 一样装上(没配代理就是直连)
  await (await import('@/lib/server-proxy')).installServerProxy();
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (input: any, init?: any) => {
    const u = new URL(typeof input === 'string' ? input : input.url);
    let body = '';
    if (typeof init?.body === 'string') { try { body = ' body=' + JSON.stringify(JSON.parse(init.body), shorten).slice(0, 600); } catch { /* 非 JSON */ } }
    const res = await realFetch(input, init);
    log(init?.method || 'GET', u.host + u.pathname, '→', res.status, body);
    return res;
  }) as typeof fetch;

  const { renderStageSketch, sketchMetaFromScene } = await import('@/lib/stage-sketch');
  const { frameSize, aimPitchDeg, projectScene } = await import('@/lib/stage-blocking');
  const { buildSketchDirective } = await import('@/lib/storyboard-sketch');
  const scene: any = {
    aspect: '9:16',
    camera: { x: 0, z: 0, yawDeg: 0, lens: '35', heightM: 2.6 },
    actors: [{ id: 'a', name: 'Lin', x: -0.55, z: 2.6 }, { id: 'b', name: 'Lu', x: 0.85, z: 7.5 }],
  };
  scene.camera.pitchDeg = aimPitchDeg(scene);
  const { width, height } = frameSize('9:16');
  const png = renderStageSketch(scene, { width, height });
  fs.writeFileSync(path.join(OUT, 'sketch.png'), png);
  const sketch = `data:image/png;base64,${png.toString('base64')}`;
  const base = 'Cinematic film still, rainy night city street with neon reflections on wet asphalt, a young woman in a red raincoat and a man in a dark long coat, photorealistic, moody lighting';
  const prompt = base + buildSketchDirective(sketchMetaFromScene(scene));
  log(`草图 ${width}×${height},俯仰 ${scene.camera.pitchDeg}°,人物都在画内: ${projectScene(scene).every((p: any) => p.inFrame)};产物目录 ${OUT}`);

  const save = async (name: string, url: string) => {
    if (url.startsWith('data:')) { fs.writeFileSync(path.join(OUT, name), Buffer.from(url.split(',')[1], 'base64')); return; }
    if (!/^https?:/.test(url)) { log(name, '本地地址', url); return; }
    fs.writeFileSync(path.join(OUT, name), Buffer.from(await (await realFetch(url)).arrayBuffer()));
  };
  const run = async (name: string, fn: () => Promise<string>) => {
    if (!which.has(name)) return;
    const t0 = Date.now();
    try {
      const url = await fn();
      log(`✅ ${name} ${((Date.now() - t0) / 1000).toFixed(1)}s`);
      await save(`${name}.img`, url);
    } catch (e) {
      log(`❌ ${name} ${((Date.now() - t0) / 1000).toFixed(1)}s:`, (e instanceof Error ? e.message : String(e)).slice(0, 500));
    }
  };

  await run('minimax', async () => new (await import('@/services/minimax.service')).MinimaxService().generateImageWithRefs(prompt, [sketch], { aspectRatio: '9:16' }));
  await run('minimax-face', async () => {
    const face = 'data:image/jpeg;base64,' + fs.readFileSync('public/styles/portrait-natural.jpg').toString('base64');
    return new (await import('@/services/minimax.service')).MinimaxService().generateImageWithRefs(base, [face], { aspectRatio: '9:16' });
  });
  await run('mj', async () => new (await import('@/services/midjourney.service')).MidjourneyService().generateImage(prompt, { aspectRatio: '9:16', imagePrompts: [sketch], skipUpscale: true }));

  const gateway = async (baseUrl: string, key: string, body: Record<string, unknown>) => {
    if (!key) throw new Error('没配这个网关的 key');
    const res = await fetch(`${baseUrl}/v1/images/generations`, {
      method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body), signal: AbortSignal.timeout(180_000),
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${text.slice(0, 300)}`);
    const d = JSON.parse(text).data?.[0];
    if (d?.b64_json) return `data:image/png;base64,${d.b64_json}`;
    if (d?.url) return d.url as string;
    throw new Error(`没返回图: ${text.slice(0, 200)}`);
  };
  const { API_CONFIG } = await import('@/lib/config');
  // Seedream:故意要横版 —— 参考图生图的输出跟随参考图尺寸(v12.148 实测),出来是竖版即说明草图被吃进去了
  await run('seedream', () => gateway(API_CONFIG.qingyuntop.baseURL, API_CONFIG.qingyuntop.apiKey, {
    model: process.env.IMAGE_SEEDREAM_MODEL || 'doubao-seedream-4-5-251128', prompt, n: 1, size: '1280x720', image: sketch,
  }));
  // kontext:要方图 —— Kontext 按输入图比例出图,出来是竖版即说明草图被吃进去了
  await run('kontext', () => gateway('https://api.vectorengine.ai', API_CONFIG.openai.apiKey, {
    model: 'flux.1-kontext-pro', prompt, n: 1, size: '1024x1024', image_url: sketch, image_urls: [sketch],
  }));
  log('完成。对照 sketch.png 看各家出图的构图;MJ 返回的是四宫格。');
}
main().catch((e) => { log('出错:', e instanceof Error ? e.message : e); process.exit(1); });
