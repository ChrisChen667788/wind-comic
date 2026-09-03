/**
 * v12.420 — v12.411「接了自托管端点」,而它在最自然的地址上**根本调不通**。
 *
 * ── 两个病,一个比一个难看 ────────────────────────────────────────────
 * ① **只给了契约,没给能跑的东西**(竞品复核记为 C14):想用 Wan 2.7 / LTX-2.5,
 *    用户还得自己写一个 HTTP 服务把推理脚本包成那份契约。接口有了,
 *    离真能用还差一层 —— 而那一层门槛不低。
 * ② **更难看的**:`lib/ssrf-guard` 默认拒绝 localhost / 内网地址(这是对的),
 *    而自托管端点最自然的地址就是 `http://localhost:8188/...` ——
 *    我在 `.env.example` 里写的示例正是它,**它被自己的守卫拒掉了**。
 *    v12.410 的自托管音乐同病。也就是说这两条「已接入」的路,一次都跑不通过。
 *
 * ── 修法里的取舍 ──────────────────────────────────────────────────────
 * 不用 `SSRF_ALLOW_PRIVATE=1`:那是**全局**开关且生产禁用 ——
 * 为一条端点把整道防线撤掉,是拿一个真实的安全边界换一个功能。
 *
 * 改成**极窄**的例外:origin 必须**逐字出现在**几个「部署者自己填」的 env 里。
 * SSRF 防的是「URL 来自不可信内容」,而这些 env 与请求内容无关 ——
 * 性质不同。判据落在 env 上,任何从内容里冒出来的 origin 都不可能命中。
 */
import { describe, it, expect, afterEach } from 'vitest';
import { assertOutboundUrlSafe, isOperatorConfiguredOrigin } from '@/lib/ssrf-guard';
import fs from 'node:fs';

const KEYS = ['SELFHOST_VIDEO_URL', 'MUSIC_SELFHOST_URL', 'LIPSYNC_API_URL', 'COMFYUI_URL', 'SSRF_ALLOW_PRIVATE'];
const saved: Record<string, string | undefined> = {};
for (const k of KEYS) saved[k] = process.env[k];
afterEach(() => {
  for (const k of KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k] as string;
  }
});

describe('v12.420 · 自托管参考实现 + 极窄 SSRF 例外', () => {
  it('没配 env 时,内网地址一律照拒(防线没被削弱)', async () => {
    for (const k of KEYS) delete process.env[k];
    for (const u of [
      'http://localhost:8188/generate',
      'http://127.0.0.1:9000/x',
      'http://169.254.169.254/latest/meta-data',
      'http://metadata.google.internal/x',
    ]) {
      const v = await assertOutboundUrlSafe(u);
      expect(v.ok, `${u} 不该被放行`).toBe(false);
    }
  });

  it('配了自托管 env 后,**那一个 origin** 放行 —— 这是 v12.411/410 能跑通的前提', async () => {
    for (const k of KEYS) delete process.env[k];
    process.env.SELFHOST_VIDEO_URL = 'http://localhost:8188/generate';
    expect((await assertOutboundUrlSafe('http://localhost:8188/generate')).ok).toBe(true);
    // 路径不同但同 origin —— 轮询用的就是同 origin 另一个路径,必须放行
    expect((await assertOutboundUrlSafe('http://localhost:8188/generate/abc')).ok).toBe(true);
  });

  it('例外精确到 origin:同主机不同端口仍拒,别的内网地址仍拒', async () => {
    for (const k of KEYS) delete process.env[k];
    process.env.SELFHOST_VIDEO_URL = 'http://localhost:8188/generate';
    expect((await assertOutboundUrlSafe('http://localhost:9999/x')).ok, '放行面不能扩到整台主机').toBe(false);
    expect((await assertOutboundUrlSafe('http://127.0.0.1:8188/x')).ok, '不同 host 就是不同 origin').toBe(false);
    expect((await assertOutboundUrlSafe('http://169.254.169.254/latest/meta-data')).ok, '云元数据永远不放行').toBe(false);
  });

  it('音乐 / 口型 / ComfyUI 的自托管端点同样被覆盖(只修视频就是旁路没跟上)', async () => {
    for (const k of KEYS) delete process.env[k];
    process.env.MUSIC_SELFHOST_URL = 'http://localhost:7865/generate';
    expect((await assertOutboundUrlSafe('http://localhost:7865/generate')).ok).toBe(true);
    expect((await assertOutboundUrlSafe('http://localhost:8188/generate')).ok, '没配的端口不该顺带放行').toBe(false);
  });

  it('env 里写的不是合法 URL 时不放行(不能因为写错就把内网打开)', () => {
    for (const k of KEYS) delete process.env[k];
    process.env.SELFHOST_VIDEO_URL = '这不是一个 URL';
    expect(isOperatorConfiguredOrigin('http://localhost:8188')).toBe(false);
  });

  it('参考实现存在,且**明说自己不含模型权重** —— 声称「一键跑起 Wan 2.7」会是谎话', () => {
    const srv = fs.readFileSync('selfhost/video/server.mjs', 'utf-8');
    const readme = fs.readFileSync('selfhost/video/README.md', 'utf-8');
    expect(srv, '窗口自证:这不是那个适配器?').toContain('/generate');
    expect(srv).toMatch(/不含模型权重/);
    expect(readme).toMatch(/不含模型权重/);
    // 契约两侧要对得上
    expect(srv).toContain('task_id');
    expect(srv).toMatch(/succeeded|processing/);
  });

  it('prompt 是外部输入 —— 起命令绝不能进 shell', () => {
    const srv = fs.readFileSync('selfhost/video/server.mjs', 'utf-8');
    expect(srv, '拼进 shell 就是命令注入').toContain('shell: false');
    expect(srv.includes('exec('), '用了 exec = 走 shell').toBe(false);
  });

  it('退出码 0 不等于出片了 —— 必须确认产物真的在', () => {
    const srv = fs.readFileSync('selfhost/video/server.mjs', 'utf-8');
    expect(srv).toContain('existsSync(out)');
    expect(srv, '「成功了但没有产物」是最难查的一类失败').toMatch(/产物不存在或为空/);
  });

  it('未配 VIDEO_CMD 时返回错误而不是空成功', () => {
    const srv = fs.readFileSync('selfhost/video/server.mjs', 'utf-8');
    // 锚点门禁抓到我这里第一版写错了:「VIDEO_CMD 未配置」在源文件里出现 2 次
    // (队列里的失败路径 + HTTP 503 分支),indexOf 只会命中第一处。
    // 换成 503 分支独有的那句文案 —— 语义唯一。
    const i = srv.indexOf('本服务只做编排,不自带模型权重');
    expect(i, '找不到 503 分支的说明文案').toBeGreaterThan(0);
    const block = srv.slice(Math.max(0, i - 400), i + 200);
    expect(block, '窗口自证').toContain('VIDEO_CMD');
    expect(block, '未配置时必须给错误码,而不是返回空成功').toContain('503');
  });
});
