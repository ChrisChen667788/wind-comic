/**
 * v13.6 · 零 key 演示的第一分钟 + 容器健康检查。
 *
 * ① 预算护栏:`docker compose -f docker-compose.demo.yml up` 打开就点「开机」,第一次创作就 402 ——
 *    「本次预估 ¥18.8 将越过硬上限 ¥5」。mock 三件套 estCostCny 都是 0,估价却按「未知引擎取最贵档」算。
 *    只在「mock 在主路 + 没有任何可用真引擎」时算 0;配了真 key 或显式关了插件链,护栏一分不让。
 * ② /api/health:首页 200 不代表能登录。数据库打不开 / 不可写、JWT 密钥缺失或是公开占位串 ——
 *    这几种「登录必 500」都要让健康检查变红,而且对外不泄露路径和异常原文。
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import fs from 'fs';
import { execFileSync } from 'child_process';
import { mockPipelineIsFree } from '@/lib/mock-cost';
import { listImageProviders } from '@/lib/image-providers/registry';
import { listVideoProviders } from '@/lib/video-providers/registry';
import { listTTSProviders } from '@/lib/tts-providers/registry';

const mock = (id: string) => ({ id, available: () => true });
const real = (id: string, on: boolean) => ({ id, available: () => on });

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('v13.6 · mockPipelineIsFree', () => {
  it('没开 MOCK_ENGINES → 不是免费(照常估价)', () => {
    vi.stubEnv('MOCK_ENGINES', '');
    expect(mockPipelineIsFree([mock('mock-video')])).toBe(false);
  });

  it('MOCK_ENGINES=1、mock 在主路、真引擎一个都不可用 → 免费', () => {
    vi.stubEnv('MOCK_ENGINES', '1');
    vi.stubEnv('PLUGIN_CHAIN_MODE', '');
    expect(mockPipelineIsFree([mock('mock-image'), mock('mock-video'), real('kling', false), real('minimax', false)])).toBe(true);
  });

  it('配了任何一个真引擎 → 不免费:mock 挂了链会落到它头上真扣费', () => {
    vi.stubEnv('MOCK_ENGINES', '1');
    vi.stubEnv('PLUGIN_CHAIN_MODE', '');
    expect(mockPipelineIsFree([mock('mock-video'), real('kling', false), real('minimax', true)])).toBe(false);
  });

  it('available() 抛错 = 判不准 = 当作可能花钱', () => {
    vi.stubEnv('MOCK_ENGINES', '1');
    vi.stubEnv('PLUGIN_CHAIN_MODE', '');
    const boom = { id: 'veo', available: () => { throw new Error('config parse'); } };
    expect(mockPipelineIsFree([mock('mock-video'), boom])).toBe(false);
  });

  it('显式 PLUGIN_CHAIN_MODE=off → mock 根本不走,不免费', () => {
    vi.stubEnv('MOCK_ENGINES', '1');
    vi.stubEnv('PLUGIN_CHAIN_MODE', 'off');
    expect(mockPipelineIsFree([mock('mock-video')])).toBe(false);
  });

  it('默认读的是三个真实注册表(与注入版同一判据)', () => {
    vi.stubEnv('MOCK_ENGINES', '1');
    vi.stubEnv('PLUGIN_CHAIN_MODE', '');
    const all = [...listImageProviders(), ...listVideoProviders(), ...listTTSProviders()];
    expect(all.some((p) => p.id === 'mock-video'), '窗口自证:注册表里没有 mock-video?').toBe(true);
    expect(all.filter((p) => !p.id.startsWith('mock-')).length, '窗口自证:注册表里没有真引擎?').toBeGreaterThan(3);
    const anyRealOn = all.some((p) => !p.id.startsWith('mock-') && (() => { try { return p.available(); } catch { return true; } })());
    expect(mockPipelineIsFree()).toBe(!anyRealOn);
  });

  it('凡是按流水线估价喂预算护栏的入口,都走 pipelineCostForBudget(只改主入口的话,重生一镜 / 批量生成仍被拦)', () => {
    const files = execFileSync('git', ['ls-files', 'app', 'lib', 'services'], { encoding: 'utf-8' })
      .split('\n').filter((f) => /\.(ts|tsx)$/.test(f));
    const users = files.filter((f) => /assertBudget\(/.test(fs.readFileSync(f, 'utf-8')));
    expect(users.length, '窗口自证:assertBudget 的调用方太少').toBeGreaterThan(8);
    // 估价模块自己、UI 的点击前估价(lib/action-cost,浏览器里跑、不进护栏)、判据模块之外,谁都不该直接拿它喂护栏
    const allowed = new Set(['lib/budget-estimate.ts', 'lib/action-cost.ts', 'lib/mock-cost.ts']);
    const direct = files.filter((f) => !allowed.has(f) && fs.readFileSync(f, 'utf-8').includes('estimatePipelineCostCny'));
    expect(direct, '这些文件直接用 estimatePipelineCostCny,零 key 演示会被按真引擎估价拦下').toEqual([]);
    const wired = files.filter((f) => fs.readFileSync(f, 'utf-8').includes('pipelineCostForBudget('));
    for (const f of ['app/api/create-stream/route.ts', 'lib/pipeline-worker.ts', 'app/api/series/[id]/generate/route.ts',
      'app/api/regenerate-shot/route.ts', 'app/api/projects/[id]/regenerate-shot/route.ts', 'app/api/projects/[id]/segment-retake/route.ts']) {
      expect(wired, `${f} 没接 pipelineCostForBudget`).toContain(f);
    }
  });

  it('pipelineCostForBudget:免费时 0,否则与 estimatePipelineCostCny 逐字相同', async () => {
    const { pipelineCostForBudget } = await import('@/lib/mock-cost');
    const { estimatePipelineCostCny } = await import('@/lib/budget-estimate');
    vi.stubEnv('MOCK_ENGINES', '');
    const input = { videoProvider: 'kling', shotCount: 3 };
    expect(pipelineCostForBudget(input)).toBe(estimatePipelineCostCny(input));
    expect(pipelineCostForBudget(input)).toBeGreaterThan(0);
  });
});

describe('v13.6 · GET /api/health', () => {
  async function hit() {
    const { GET } = await import('@/app/api/health/route');
    const res = await GET();
    const text = await res.text();
    return { status: res.status, text, body: JSON.parse(text) };
  }

  it('数据库可读写 + JWT 可用 → 200', async () => {
    const r = await hit();
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ ok: true, checks: { db: 'ok', auth: 'ok' } });
  });

  it('生产环境没设 JWT_SECRET → 503 jwt_secret_invalid(首页照样 200 的那种)', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('JWT_SECRET', '');
    const r = await hit();
    expect(r.status).toBe(503);
    expect(r.body.checks).toEqual({ db: 'ok', auth: 'fail' });
    expect(r.body.reasons).toEqual(['jwt_secret_invalid']);
  });

  it('生产环境用了 .env.example 的占位串 → 503', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('JWT_SECRET', 'change_me_to_a_random_32_char_string');
    const r = await hit();
    expect(r.status).toBe(503);
    expect(r.body.reasons).toEqual(['jwt_secret_invalid']);
  });

  it('数据目录不可写(NAS 上属主不是 1001)→ 503 db_not_writable,auth 记 unknown 而不是冤枉它', async () => {
    vi.spyOn(fs, 'accessSync').mockImplementation(() => { throw Object.assign(new Error('EACCES'), { code: 'EACCES' }); });
    const r = await hit();
    expect(r.status).toBe(503);
    expect(r.body.checks).toEqual({ db: 'fail', auth: 'unknown' });
    expect(r.body.reasons).toEqual(['db_not_writable']);
  });

  // 上面那条让 accessSync 一律抛错,目录与库文件两项检查少了哪一项都照样绿 —— 两侧各单独测一次。
  // 只 chown 了目录、没加 -R 的话,qfmj.db 还是原属主:目录可写、库文件不可写,登录照样 500。
  for (const side of ['file', 'dir'] as const) {
    it(`只有${side === 'file' ? '库文件' : '数据目录'}不可写 → 503 db_not_writable`, async () => {
      const path = await import('path');
      const { dbPath } = await import('@/lib/db');
      const target = side === 'file' ? dbPath : path.dirname(dbPath);
      const realAccess = fs.accessSync.bind(fs);
      let hitTarget = false;
      vi.spyOn(fs, 'accessSync').mockImplementation((p, mode) => {
        if (p === target) { hitTarget = true; throw Object.assign(new Error('EACCES'), { code: 'EACCES' }); }
        return realAccess(p, mode);
      });
      const r = await hit();
      expect(hitTarget, `窗口自证:健康检查没检查 ${side === 'file' ? '库文件' : '数据目录'}`).toBe(true);
      expect(r.status).toBe(503);
      expect(r.body.reasons).toEqual(['db_not_writable']);
    });
  }

  it('数据库打不开 → 503 db_unavailable;响应里不带路径、不带异常原文', async () => {
    vi.resetModules();
    vi.doMock('@/lib/db-driver', () => ({
      getDbDriver: () => { throw new Error('SqliteError: unable to open database file /app/data/qfmj.db'); },
    }));
    try {
      const r = await hit();
      expect(r.status).toBe(503);
      expect(r.body.checks).toEqual({ db: 'fail', auth: 'unknown' });
      expect(r.body.reasons).toEqual(['db_unavailable']);
      expect(r.text).not.toMatch(/Sqlite|qfmj\.db|\/app\/|unable to open/);
      expect(r.text).not.toContain(process.cwd());
    } finally {
      vi.doUnmock('@/lib/db-driver');
      vi.resetModules();
    }
  });

  it('不缓存(编排器每 30s 探一次,要的是此刻的状态)', async () => {
    const { GET } = await import('@/app/api/health/route');
    const res = await GET();
    expect(res.headers.get('cache-control')).toBe('no-store');
  });
});
