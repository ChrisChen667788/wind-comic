/**
 * v12.465 · 导演台两条真浏览器走查进 CI(解析 ci.yml,不 grep 原文 —— 注释里出现过不算接上了)。
 *
 * 之前它们只在本机跑:以为 CI 给不了真 WebGL 和真 MediaPipe。实际 WebGL 走 Chrome 自带的软件渲染,
 * MediaPipe 的 wasm / 模型都在仓库里。但有三处一错就会「CI 里跑了、却没测到」或「CI 里必挂」:
 *   ① 服务器带 NODE_ENV=test → lib/db 用随机库,走查直连的 data/qfmj.db 不是服务器那份 → 找不到 demo 账号;
 *   ② 没开软件 WebGL → 3D 视口整块退回 2D,3D 那条走查只剩失败路;
 *   ③ 假引擎没开 → 渲草图、保存时的副作用会去碰真接口。
 */
import { describe, it, expect, vi } from 'vitest';
import fs from 'node:fs';
import { parse } from 'yaml';

const wf = parse(fs.readFileSync('.github/workflows/ci.yml', 'utf-8')) as { jobs: Record<string, any> };
const job = wf.jobs['e2e-director-stage'];
const steps: any[] = job?.steps ?? [];
const runStep = steps.find((s) => typeof s.run === 'string' && s.run.includes('playwright test'));

describe('v12.465 · 导演台走查在 CI 里真的跑', () => {
  it('job 存在,跑的正是导演台走查与 3D 走查两条 spec', () => {
    expect(job, 'ci.yml 里应有 e2e-director-stage').toBeTruthy();
    expect(runStep.run).toContain('e2e/director-stage.spec.ts');
    expect(runStep.run).toContain('e2e/stage3d.spec.ts');
    expect(runStep.run).toContain('--project=desktop');
  });

  it('**不设 NODE_ENV=test**、开软件 WebGL、开假引擎、密钥与走查一致', () => {
    const env = runStep.env ?? {};
    expect('NODE_ENV' in env, 'NODE_ENV=test 会让服务器用随机库').toBe(false);
    expect(env.E2E_SOFTWARE_GL).toBe('1');
    expect(env.MOCK_ENGINES).toBe('1');
    expect(typeof env.JWT_SECRET).toBe('string');
  });

  it('装的是 chrome 通道(playwright.config 用 channel: chrome)', () => {
    expect(steps.some((s) => typeof s.run === 'string' && /playwright install .*chrome/.test(s.run))).toBe(true);
  });

  it('playwright.config:E2E_SOFTWARE_GL=1 才加软件渲染参数(本机有 GPU 不加)', async () => {
    const load = async (flag?: string) => {
      const prev = process.env.E2E_SOFTWARE_GL;
      if (flag === undefined) delete process.env.E2E_SOFTWARE_GL; else process.env.E2E_SOFTWARE_GL = flag;
      try {
        vi.resetModules();   // 配置在加载时读环境变量
        const mod = await import('../playwright.config');
        return mod.default.use?.launchOptions?.args as string[] | undefined;
      } finally {
        if (prev === undefined) delete process.env.E2E_SOFTWARE_GL; else process.env.E2E_SOFTWARE_GL = prev;
      }
    };
    // 三个缺一不可:--use-angle=swiftshader 选软件后端,--enable-unsafe-swiftshader 允许它出 WebGL,--ignore-gpu-blocklist 防被黑名单挡掉
    expect(await load('1')).toEqual(expect.arrayContaining(['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist']));
    expect(await load()).toBeUndefined();
  });
});
