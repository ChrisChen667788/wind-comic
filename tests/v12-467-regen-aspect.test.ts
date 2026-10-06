/**
 * v12.467 · 单镜重生 / 自愈补拍 / 片段重拍 / 4K 重渲都按项目画幅出片。
 *
 * 病:整片管线(lib/create-pipeline)调 `orchestrator.setAspect(aspect)`;其余出片入口只调
 * `applyProjectContext`,而它只贯通画风与角色参考 —— 编排器停在默认 16:9。9:16 项目里点
 * 「重生这一镜」,引擎收到 16:9,出来一条横屏片接进竖屏成片。引擎全挂时回落的 Ken Burns
 * 占位片也写死 1280x720。自愈的自动重合成则反过来写死 9:16。
 *
 * 这里每条入口都**真跑**:真测试库里建项目和分镜,真路由、真编排器、真引擎链,只把 MiniMax
 * 换成记录入参的假服务 —— 断言的是引擎**收到**的画幅,不是源码里出现过 setAspect。
 * 每条都配一个 16:9 项目做对照,证明断言不是写死的值碰巧对上。
 */
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { nanoid } from 'nanoid';

const h = vi.hoisted(() => ({
  uid: 'u-v12467',
  minimax: [] as Array<{ frame: string; prompt: string; opts: Record<string, unknown> }>,
  minimaxFail: false,
  kenBurns: [] as Array<{ dims?: { w: number; h: number } }>,
  kling4k: [] as Array<Record<string, unknown> | undefined>,
  recompose: [] as Array<Record<string, unknown>>,
}));

// 视频引擎链只留 MiniMax(假服务),与开发机上配了哪些 key 无关
vi.mock('@/lib/config', async (importOriginal) => {
  const m = await importOriginal<typeof import('@/lib/config')>();
  return {
    ...m,
    API_CONFIG: {
      ...m.API_CONFIG,
      minimax: { ...m.API_CONFIG.minimax, apiKey: 'test-minimax' },
      keling: { ...m.API_CONFIG.keling, apiKey: 'test-kling' }, // 4K 路由先验 key 才进流
    },
  };
});
vi.mock('@/services/minimax.service', async (importOriginal) => {
  const m = await importOriginal<typeof import('@/services/minimax.service')>();
  class MinimaxService {
    isImageAvailable() { return false; }
    isVideoAvailable() { return true; }
    async generateVideo(frame: string, prompt: string, opts: Record<string, unknown> = {}) {
      h.minimax.push({ frame, prompt, opts });
      if (h.minimaxFail) throw new Error('2056 已达到 Token Plan 用量上限');
      return 'https://cdn.example/regen.mp4';
    }
  }
  return { ...m, MinimaxService };
});
vi.mock('@/services/kling.service', async (importOriginal) => {
  const m = await importOriginal<typeof import('@/services/kling.service')>();
  class KlingService {
    async regenerateShotAt4K(_frame: string, _prompt: string, opts?: Record<string, unknown>) {
      h.kling4k.push(opts);
      return 'https://cdn.example/4k.mp4';
    }
  }
  return { ...m, KlingService, hasKling: () => false };
});
vi.mock('@/services/veo.service', async (importOriginal) => {
  const m = await importOriginal<typeof import('@/services/veo.service')>();
  return { ...m, hasVeo: () => false };
});
vi.mock('@/services/happyhorse.service', async (importOriginal) => {
  const m = await importOriginal<typeof import('@/services/happyhorse.service')>();
  return { ...m, getHappyHorseService: () => null };
});
// 引擎全挂时的 Ken Burns 末档:记下尺寸,不真跑 ffmpeg
vi.mock('@/services/video-composer', async (importOriginal) => {
  const m = await importOriginal<typeof import('@/services/video-composer')>();
  return {
    ...m,
    stillFrameToVideo: async (_img: string, _dur?: number, _dir?: string, _zoom?: string, dims?: { w: number; h: number }) => {
      h.kenBurns.push({ dims });
      const f = path.join(os.tmpdir(), `qf-animatic-v12467-${nanoid(6)}.mp4`);
      fs.writeFileSync(f, '');
      return f;
    },
  };
});
// 测试环境没有 LLM key → 项目级重生路由会进 demo 分支;这里要走真实分支
vi.mock('@/services/demo-orchestrator', async (importOriginal) => {
  const m = await importOriginal<typeof import('@/services/demo-orchestrator')>();
  return { ...m, isDemoMode: () => false };
});
vi.mock('@/lib/asset-storage', async (importOriginal) => {
  const m = await importOriginal<typeof import('@/lib/asset-storage')>();
  return { ...m, persistAsset: async (u: string) => ({ url: u }) };
});
vi.mock('@/lib/auth-guard', async (importOriginal) => {
  const m = await importOriginal<typeof import('@/lib/auth-guard')>();
  return { ...m, requireProjectAccess: async () => ({ ok: true, userId: h.uid }) };
});
vi.mock('@/app/api/auth/lib', async (importOriginal) => {
  const m = await importOriginal<typeof import('@/app/api/auth/lib')>();
  return { ...m, getUserFromRequest: () => ({ sub: h.uid }) };
});
vi.mock('@/lib/budget-enforce', async (importOriginal) => {
  const m = await importOriginal<typeof import('@/lib/budget-enforce')>();
  return { ...m, assertBudget: async () => ({ allow: true, guard: {} }) };
});
vi.mock('@/lib/plan-gate', async (importOriginal) => {
  const m = await importOriginal<typeof import('@/lib/plan-gate')>();
  return { ...m, checkPlan: () => ({ ok: true, userId: h.uid, current: 'pro', required: 'pro' }) };
});
// 片段重拍:取原片、截帧、缝合那一整段由 v12-459 的真库真 ffmpeg 用例守着;
// 这里只关心它交给编排器的那一步 —— 直接调路由注入的 generatePatch
vi.mock('@/services/segment-retake-run', async (importOriginal) => {
  const m = await importOriginal<typeof import('@/services/segment-retake-run')>();
  return {
    ...m,
    shotFinalDuration: async () => 8,
    projectFps: async () => 24,
    tryLockShot: () => () => {},
    runSegmentRetake: async (input: { shotNumber: number; prompt?: string }, deps: { generatePatch: (a: Record<string, unknown>) => Promise<unknown> }) => {
      const patch = await deps.generatePatch({ shotNumber: input.shotNumber, durationS: 3, firstFrameUrl: 'https://cdn.example/cut.png', promptExtra: input.prompt });
      return { patch };
    },
  };
});

import { db, now } from '@/lib/db';
import { createProject } from '@/lib/repos/project-repo';
import { createAsset } from '@/lib/repos/asset-repo';

const SHOT = 2;
const projects: Record<'9:16' | '16:9', string> = { '9:16': '', '16:9': '' };

async function seedProject(aspect: '9:16' | '16:9'): Promise<string> {
  const pid = (await createProject({ userId: h.uid, title: `画幅 ${aspect}`, description: 'd', coverUrls: [] }) as { id: string }).id;
  db.prepare('UPDATE projects SET aspect = ? WHERE id = ?').run(aspect, pid);
  await createAsset({
    projectId: pid, type: 'storyboard', name: `Shot ${SHOT}`, shotNumber: SHOT,
    mediaUrls: [`https://cdn.example/${aspect.replace(':', 'x')}-sb.png`], data: { description: '她回头看向门口' },
  });
  await createAsset({ projectId: pid, type: 'quality_report', name: '质检', data: { degradedShots: [SHOT] } });
  return pid;
}

beforeAll(async () => {
  db.prepare(`INSERT OR IGNORE INTO users (id, email, password_hash, name, role, created_at) VALUES (?, ?, ?, ?, 'user', ?)`)
    .run(h.uid, `${h.uid}@test.local`, 'x', '画幅', now());
  projects['9:16'] = await seedProject('9:16');
  projects['16:9'] = await seedProject('16:9');
});

const savedMock = process.env.MOCK_ENGINES;
beforeEach(() => {
  delete process.env.MOCK_ENGINES; // 开着它单镜重生会整条换成本地假片(v12.459),就测不到引擎入参了
  h.minimax.length = 0; h.kenBurns.length = 0; h.kling4k.length = 0; h.recompose.length = 0;
  h.minimaxFail = false;
});
afterEach(() => {
  if (savedMock === undefined) delete process.env.MOCK_ENGINES; else process.env.MOCK_ENGINES = savedMock;
  vi.unstubAllGlobals();
});

const jsonReq = (url: string, body: unknown) => new Request(url, {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
}) as any;
const params = (id: string) => ({ params: Promise.resolve({ id }) });

/** 读完 SSE,返回全部事件 */
async function events(res: Response): Promise<Array<{ type: string; data: any }>> {
  const text = await res.text();
  return text.split('\n').filter((l) => l.startsWith('data: ')).map((l) => JSON.parse(l.slice(6)));
}

/** 每条入口:9:16 项目引擎收到 9:16,16:9 项目收到 16:9 */
const ASPECTS = ['9:16', '16:9'] as const;

describe('v12.467 · 出片入口都按项目画幅', () => {
  describe.each(ASPECTS)('%s 项目', (aspect) => {
    it('项目页单镜重生(/api/projects/[id]/regenerate-shot):引擎收到项目画幅', async () => {
      const { POST } = await import('@/app/api/projects/[id]/regenerate-shot/route');
      const pid = projects[aspect];
      const ev = await events(await POST(jsonReq(`http://localhost/api/projects/${pid}/regenerate-shot`, {
        shotNumber: SHOT, duration: 5, description: '她回头看向门口', videoProvider: 'minimax',
      }), params(pid)));
      expect(ev.find((e) => e.type === 'complete')?.data?.videoUrl).toBe('https://cdn.example/regen.mp4');
      expect(h.minimax).toHaveLength(1);
      expect(h.minimax[0].opts.aspectRatio).toBe(aspect);
    }, 60_000);

    it('全局单镜重生(/api/regenerate-shot,video-node / 拉片表 / 审片走这条)', async () => {
      const { POST } = await import('@/app/api/regenerate-shot/route');
      const pid = projects[aspect];
      const ev = await events(await POST(jsonReq('http://localhost/api/regenerate-shot', {
        projectId: pid, shotNumber: SHOT, videoProvider: 'minimax',
      })));
      expect(ev.some((e) => e.type === 'error'), JSON.stringify(ev.filter((e) => e.type === 'error'))).toBe(false);
      expect(h.minimax).toHaveLength(1);
      expect(h.minimax[0].opts.aspectRatio).toBe(aspect);
    }, 60_000);

    it('自愈补拍(heal-shots):补拍的镜按项目画幅;自动重合成也按项目画幅(原写死 9:16)', async () => {
      vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => {
        h.recompose.push(JSON.parse(String(init?.body || '{}')));
        return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }));
      const { POST } = await import('@/app/api/projects/[id]/heal-shots/route');
      const pid = projects[aspect];
      const res = await POST(jsonReq(`http://localhost/api/projects/${pid}/heal-shots`, {
        heal: true, recompose: true, videoProvider: 'minimax',
      }), params(pid));
      const body = await res.json();
      expect(body.healedCount, JSON.stringify(body)).toBe(1);
      expect(h.minimax).toHaveLength(1);
      expect(h.minimax[0].opts.aspectRatio).toBe(aspect);
      expect(h.recompose).toHaveLength(1);
      expect(h.recompose[0].aspect).toBe(aspect);
    }, 60_000);

    it('片段重拍(segment-retake)的补丁按项目画幅生成', async () => {
      const { POST } = await import('@/app/api/projects/[id]/segment-retake/route');
      const pid = projects[aspect];
      const res = await POST(jsonReq(`http://localhost/api/projects/${pid}/segment-retake`, {
        shotNumber: SHOT, fromS: 2, toS: 5, videoProvider: 'minimax',
      }), params(pid));
      expect(res.status, JSON.stringify(await res.clone().json())).toBe(200);
      expect(h.minimax).toHaveLength(1);
      expect(h.minimax[0].frame).toBe('https://cdn.example/cut.png'); // 确实是补丁这一路,不是别处的调用
      expect(h.minimax[0].opts.aspectRatio).toBe(aspect);
    }, 60_000);

    it('4K 重渲(regenerate-shot-4k)把项目画幅交给可灵', async () => {
      const { POST } = await import('@/app/api/projects/[id]/regenerate-shot-4k/route');
      const pid = projects[aspect];
      const ev = await events(await POST(jsonReq(`http://localhost/api/projects/${pid}/regenerate-shot-4k`, { shotNumber: SHOT }), params(pid)));
      expect(ev.find((e) => e.type === 'completed')).toBeTruthy();
      expect(h.kling4k).toHaveLength(1);
      expect(h.kling4k[0]?.aspectRatio).toBe(aspect);
    }, 60_000);

    it('引擎全挂 → Ken Burns 占位片也是项目画幅(原写死 1280x720)', async () => {
      h.minimaxFail = true;
      const { POST } = await import('@/app/api/projects/[id]/regenerate-shot/route');
      const pid = projects[aspect];
      const ev = await events(await POST(jsonReq(`http://localhost/api/projects/${pid}/regenerate-shot`, {
        shotNumber: SHOT, duration: 5, description: '她回头看向门口', videoProvider: 'minimax',
      }), params(pid)));
      expect(ev.find((e) => e.type === 'complete')?.data?.isAnimatic).toBe(true);
      expect(h.kenBurns).toHaveLength(1);
      expect(h.kenBurns[0].dims).toEqual(aspect === '9:16' ? { w: 720, h: 1280 } : { w: 1280, h: 720 });
    }, 60_000);
  });
});

describe('v12.467 · 项目上下文解析', () => {
  it('只认 数字:数字(与 setAspect 同一判据);2.35:1、空串、非字符串都不贯通', async () => {
    const { parseProjectContext, parseProjectAspect } = await import('@/lib/orchestrator-project-context');
    expect(parseProjectContext({ aspect: ' 9:16 ' }).aspect).toBe('9:16');
    expect(parseProjectContext({ aspect: '2.35:1' }).aspect).toBeUndefined();
    expect(parseProjectContext({ aspect: '' }).aspect).toBeUndefined();
    expect(parseProjectContext({ aspect: null }).aspect).toBeUndefined();
    expect(parseProjectAspect(916)).toBeUndefined();
  });

  it('PROJECT_CONTEXT_COLUMNS 取的列真的存在(否则各入口的 SELECT 会抛、被 catch 吞掉,画幅静默丢失)', async () => {
    const { PROJECT_CONTEXT_COLUMNS, parseProjectContext } = await import('@/lib/orchestrator-project-context');
    const row = db.prepare(`SELECT ${PROJECT_CONTEXT_COLUMNS} FROM projects WHERE id = ?`).get(projects['9:16']);
    expect(parseProjectContext(row as never).aspect).toBe('9:16');
  });
});

describe('v12.467 · 可灵 4K 请求体带上画幅', () => {
  it('regenerateShotAt4K({ aspectRatio }) → body.aspect_ratio', async () => {
    const { KlingService } = await vi.importActual<typeof import('@/services/kling.service')>('@/services/kling.service');
    const bodies: Array<Record<string, unknown>> = [];
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => {
      bodies.push(JSON.parse(String(init?.body || '{}')));
      return new Response('nope', { status: 500 }); // 建任务就失败,不进轮询
    }));
    const k = new KlingService();
    (k as unknown as { apiKey: string }).apiKey = 'test-kling';
    await expect(k.regenerateShotAt4K('https://cdn.example/f.png', 'p', { aspectRatio: '9:16' })).rejects.toThrow(/500/);
    await expect(k.regenerateShotAt4K('https://cdn.example/f.png', 'p')).rejects.toThrow(/500/);
    expect(bodies[0].aspect_ratio).toBe('9:16');
    expect('aspect_ratio' in bodies[1]).toBe(false); // 不传就不带,不擅自塞默认值
  });
});

/** 去注释后,找出所有 `.regenerateShot(` 调用所在的文件 */
function walk(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { if (e.name !== 'node_modules') walk(p, out); }
    else if (/\.(ts|tsx)$/.test(e.name) && !/\.test\.tsx?$/.test(e.name)) out.push(p);
  }
  return out;
}

describe('v12.467 · 以后新加的重生入口也走同一个口', () => {
  it('凡是调用 .regenerateShot( 的入口都经 applyProjectContext 贯通项目上下文(含画幅)', async () => {
    const { stripComments } = await import('@/lib/consumer-gate/scan');
    // 例外必须写理由
    const ALLOW: Record<string, string> = {
      'services/agents/editor-agent.ts': '剪辑师烤字重生的 ctx 就是整片管线里的编排器,画幅已由 create-pipeline setAspect',
      'services/hybrid-orchestrator.ts': '定义处',
      'services/agent-orchestrator.ts': '旧编排器的定义处(只给 /api/create 用,不读项目)',
      'services/demo-orchestrator.ts': 'demo 定义处',
    };
    const callers = ['app', 'lib', 'services'].flatMap((d) => walk(d))
      .filter((f) => /\.regenerateShot\(/.test(stripComments(fs.readFileSync(f, 'utf-8'))));
    expect(callers.length, '一个调用方都没扫到 —— 扫描本身坏了').toBeGreaterThanOrEqual(4);
    const missing = callers
      .filter((f) => !ALLOW[f])
      .filter((f) => !/\bapplyProjectContext\(/.test(stripComments(fs.readFileSync(f, 'utf-8'))));
    expect(missing, '这些入口自己拼项目上下文,会漏画幅(v12.467)或角色参考(v12.132)').toEqual([]);
  });

  it('编排器里每一处 Ken Burns 占位片都带尺寸(第 5 个实参)', () => {
    const src = (fs.readFileSync('services/hybrid-orchestrator.ts', 'utf-8'));
    const calls: string[] = [];
    let from = 0;
    for (;;) {
      const i = src.indexOf('await stillFrameToVideo(', from);
      if (i < 0) break;
      // 按括号配平取出整个实参表
      let depth = 0; let j = i + 'await stillFrameToVideo'.length;
      for (; j < src.length; j++) {
        if (src[j] === '(') depth++;
        else if (src[j] === ')') { depth--; if (depth === 0) break; }
      }
      calls.push(src.slice(i + 'await stillFrameToVideo('.length, j));
      from = j;
    }
    expect(calls.length, '编排器里一处 Ken Burns 都没找到 —— 改名了?').toBeGreaterThanOrEqual(2);
    const topLevelArgs = (s: string) => {
      let depth = 0; let n = 1;
      for (const c of s) { if ('([{'.includes(c)) depth++; else if (')]}'.includes(c)) depth--; else if (c === ',' && depth === 0) n++; }
      return n;
    };
    for (const c of calls) expect(topLevelArgs(c), `缺尺寸:stillFrameToVideo(${c.slice(0, 80)}…)`).toBe(5);
  });
});
