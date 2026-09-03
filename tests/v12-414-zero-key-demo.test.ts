/**
 * v12.414 — 差距不在功能,在第一分钟。
 *
 * ── 病象 ──────────────────────────────────────────────────────────────
 * 竞品复核**连着两轮**把「上手门槛」判为最大战略劣势,而且这一轮是逐条核过的:
 * Dockerfile 有(三阶段构建),但**没有预构建镜像、没有 demo 工程**,
 * Quick Start 仍然是「git clone → npm install → 手工编辑 .env.local 填至少
 * 3 个付费 API key → npm run dev」。零代码平台那边是浏览器打开就能出片。
 *
 * 好消息是底子早就有:`MOCK_ENGINES=1` + mock 三件套(确定性 SVG / 纯色短片 /
 * 正弦 WAV,零外部调用、零成本,且走**真实 provider 路径**)。缺的只是
 * 「一条命令把它跑起来」。
 *
 * ── 这条测试锁的是那条诚实,不只是那条命令 ────────────────────────────
 * demo 模式必须**写明产物是演示占位、不代表真实生成质量**。
 * 拿占位片冒充成片正是这个项目一直在消灭的那种事 —— v12.394 那次
 * Ken Burns 占位片被当成成片、导致续跑永久跳过,教训就在那里。
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';

const COMPOSE = fs.readFileSync('docker-compose.demo.yml', 'utf-8');
const SEED = fs.readFileSync('scripts/seed-demo.mjs', 'utf-8');

describe('v12.414 · 零 key 试用', () => {
  it('一条命令即可起,且**不需要任何 API key**', () => {
    expect(COMPOSE, '窗口自证:这不是 demo compose?').toContain('wind-comic-demo');
    expect(COMPOSE).toContain('MOCK_ENGINES: "1"');
    expect(COMPOSE).toMatch(/ports:[\s\S]*3100/);
    // 不该要求任何真实付费 key
    for (const k of ['OPENAI_API_KEY', 'MINIMAX_API_KEY', 'KELING_API_KEY', 'VEO_API_KEY']) {
      expect(COMPOSE.includes(k), `demo 不该要求 ${k}`).toBe(false);
    }
  });

  it('demo 必须写明是占位产物 —— 拿占位片冒充成片是这个项目一直在消灭的事', () => {
    expect(COMPOSE).toMatch(/不是真实生成质量|不代表真实生成质量/);
    expect(SEED).toMatch(/不代表真实生成质量/);
  });

  it('未开开关时什么都不做', () => {
    const out = execFileSync('node', ['scripts/seed-demo.mjs'], {
      encoding: 'utf-8',
      env: { ...process.env, SEED_DEMO_PROJECT: '0' },
    });
    expect(out).toContain('未开启');
  });

  it('真引擎模式下拒绝塞演示素材 —— 假素材不该污染真实项目列表', () => {
    const out = execFileSync('node', ['scripts/seed-demo.mjs'], {
      encoding: 'utf-8',
      env: { ...process.env, SEED_DEMO_PROJECT: '1', MOCK_ENGINES: '0' },
    });
    expect(out).toContain('已跳过');
  });

  it('演示工程塞不进去也不能阻断启动', () => {
    // 脚本内所有失败路径都要能走到 exit 0 / try-catch,而不是抛出去把容器搞挂
    expect(SEED).toMatch(/catch/);
    expect(SEED).toMatch(/process\.exit\(0\)/);
    expect(SEED.includes('process.exit(1)'), 'demo 塞不进去不该让启动失败').toBe(false);
  });

  it('README 的上手路径要把零 key 试用放在最前 —— 第一分钟才是差距所在', () => {
    for (const f of ['README.md', 'README.zh-CN.md']) {
      const src = fs.readFileSync(f, 'utf-8');
      expect(src, `${f} 里没提零 key 试用`).toContain('docker-compose.demo.yml');
    }
  });
});
