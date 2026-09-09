/**
 * v12.428 —— 自托管视频端点:把「已接」变成「验过」。
 *
 * v12.411 加了通用适配器,竞品文档里记的是「✅ 已接(通用适配器)· 待用户配
 * SELFHOST_VIDEO_URL」。但那条通路**从来没有跑过任何流量** —— 没人配过端点,
 * 于是「已接」这个说法一直只有代码在背书,没有行为在背书。
 * 本仓吃过太多次这个亏:v12.403 的 Vidu 路径六处写错、从来没工作过却也没人发现;
 * v12.409 之后才有接线门禁。所以这里补一个**按契约起桩、让真适配器打过去**的测试。
 *
 * 覆盖契约的两半(自建服务两种写法都常见,只认一种会挡掉一半用户):
 *   · 同步:POST → { url } / { video_url }
 *   · 异步:POST → { task_id },再 GET {base}/{task_id} → { status, video_url }
 *
 * 顺带锁一件容易被忽略的事:**localhost 不能被 SSRF 防护挡掉**。
 * 自托管端点最常见的部署位置就是本机,挡了等于这个功能对多数人不存在。
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'node:http';
import type { AddressInfo } from 'node:net';

let server: http.Server;
let base = '';
let mode: 'sync' | 'async' = 'sync';
let received: any[] = [];

beforeAll(async () => {
  server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c) => chunks.push(c as Buffer));
    req.on('end', () => {
      res.setHeader('content-type', 'application/json');
      if (req.method === 'POST') {
        try { received.push(JSON.parse(Buffer.concat(chunks).toString() || '{}')); } catch { received.push(null); }
        return res.end(JSON.stringify(mode === 'sync'
          ? { url: `${base}/out.mp4` }
          : { task_id: 'job-1' }));
      }
      if ((req.url || '').includes('job-1')) {
        return res.end(JSON.stringify({ status: 'succeeded', video_url: `${base}/out.mp4` }));
      }
      res.statusCode = 404; res.end('{}');
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => { await new Promise<void>((r) => server.close(() => r())); });

async function run(m: 'sync' | 'async') {
  mode = m; received = [];
  process.env.SELFHOST_VIDEO_URL = base;
  process.env.SELFHOST_VIDEO_MODEL = 'wan-2.7';
  const { SelfhostVideoService } = await import('../services/selfhost-video.service');
  return new SelfhostVideoService().generateVideo('雨夜霓虹,女主回头', { durationSec: 5, aspectRatio: '9:16' });
}

describe('v12.428 自托管视频契约', () => {
  it('同步端点:POST 直接返回 url 就能拿到成片', async () => {
    const url = await run('sync');
    expect(url).toContain('/out.mp4');
  });

  // 超时给到 20s:适配器在**第一次轮询前**会先等一个 POLL_INTERVAL(5s),
  // vitest 默认超时正好也是 5s —— 第一版就这么假失败了一次,看着像代码坏了。
  // 顺带记一笔:对本机秒出的模型,这 5s 是纯等待,将来可考虑「先立即查一次再进入间隔」。
  it('异步端点:返回 task_id 后会轮询到 succeeded', async () => {
    const url = await run('async');
    expect(url).toContain('/out.mp4');
  }, 20_000);

  it('请求体符合文档里写的契约 —— 别文档一套、实现另一套', async () => {
    await run('sync');
    expect(received[0]).toMatchObject({
      prompt: '雨夜霓虹,女主回头',
      duration: 5,
      aspect_ratio: '9:16',
      model: 'wan-2.7',
    });
  });

  it('localhost 不被 SSRF 防护挡掉 —— 自托管最常见就是部署在本机', async () => {
    // 走到这里说明前面几条已经用 127.0.0.1 打通了;显式再断言一次,
    // 免得将来收紧 ssrf-guard 时把这个场景顺手一起封死却没人发现。
    expect(base).toMatch(/^http:\/\/127\.0\.0\.1:/);
    await expect(run('sync')).resolves.toBeTruthy();
  });

  it('没配端点时明确报错,不静默返回空串', async () => {
    delete process.env.SELFHOST_VIDEO_URL;
    const { SelfhostVideoService } = await import('../services/selfhost-video.service');
    await expect(new SelfhostVideoService().generateVideo('x')).rejects.toThrow(/未配置/);
    process.env.SELFHOST_VIDEO_URL = base;
  });
});

describe('v12.428 MJ 通道可用性:健康页不能替网关打包票', () => {
  const read = (p: string) => require('node:fs').readFileSync(require('node:path').join(process.cwd(), p), 'utf-8');

  it('MJ 有独立探测,不再被 optionalProvider 直接跳过', () => {
    const src = read('app/api/health/providers/route.ts');
    expect(src).toContain('probeMidjourney');
    // optionalProvider 对已配置的 key 返回 null,MJ 走它就永远不出现在健康页上
    expect(src).not.toMatch(/optionalProvider\(\s*'midjourney'/);
  });

  it('探测必须 await —— Promise 混进不 await 的数组会被序列化成空对象', () => {
    const src = read('app/api/health/providers/route.ts');
    // 第一版就是这么废的:Promise 是 truthy,过了 filter(Boolean),
    // 接口输出里既没有 id 也没有 status,和「没加探测」一模一样。
    expect(src).toMatch(/await\s+probeMidjourney\(/);
  });

  it('探测不能是会扣费的动作 —— 判据取模型清单,不提交任务', () => {
    const src = read('app/api/health/providers/route.ts');
    const win = src.slice(src.indexOf('async function probeMidjourney'), src.indexOf('/** 可选/未接入的 provider'));
    expect(win, '没截到 probeMidjourney').toContain('/v1/models');
    expect(win, '健康检查绝不能提交生成任务(通道可用时会真出图并计费)')
      .not.toContain('/mj/submit');
  });
});
