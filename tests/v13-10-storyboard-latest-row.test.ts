/**
 * v13.10 · 同一镜有多条分镜资产行时,所有读取方取同一行(最后插入的那行)。
 *
 * 病:重生分镜图、九宫格选定都**插入新行**,一镜可以有好几行(本机库 243 镜里 53 镜多行,最新行都是重生 / 选定行)。
 * 读取方三种口径并存 —— 取最新(按 updated_at)、取第一行(没有 ORDER BY 的 .get、按镜号排序后 .find、version DESC)、
 * 全取(同镜每行各付费出一次片 / 审一次图)。修法见 lib/storyboard-latest。
 *
 * 夹具专门排成「四种旧写法都会取错」:多行镜头按 旧行 A → 最新行 B → 较早重生行 C 的顺序插入;
 *   · A 最先插入(取第一行的读到 A),且 updated_at 最晚、version 最大(按 updated_at / version 取的也读到 A);
 *   · C 最后插入(进 Map 后写者赢的读到 C);
 *   · 只有按插入先后(created_at)取,才是 B。
 * 断言的是引擎 / 视觉模型 / 导出文件**收到**的东西,不是入口函数的返回值;付费入口同时断言每镜只调用一次。
 * 引擎全换成记录入参的假服务,不真调任何付费接口。
 */
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { nanoid } from 'nanoid';

const h = vi.hoisted(() => ({
  uid: 'u-v1310',
  minimax: [] as Array<{ frame: string; prompt: string }>,
  kling4k: [] as Array<{ frame: string; prompt: string }>,
  producer: [] as Array<{ shotNumber: number; imageUrl: string; prompt: string; planData?: Record<string, unknown> }>,
  images: [] as string[],
  cameoRefs: [] as string[][],
  audits: [] as Array<{ img: string; shotNumber: number; sceneDescription?: string }>,
  chats: [] as string[],
  embeds: [] as string[],
  faces: [] as string[],
  intro: [] as Array<{ coverImagePath?: string }>,
}));

vi.mock('@/lib/config', async (importOriginal) => {
  const m = await importOriginal<typeof import('@/lib/config')>();
  return {
    ...m,
    API_CONFIG: {
      ...m.API_CONFIG,
      minimax: { ...m.API_CONFIG.minimax, apiKey: 'test-minimax' },
      keling: { ...m.API_CONFIG.keling, apiKey: 'test-kling' },
    },
  };
});
vi.mock('@/services/minimax.service', async (importOriginal) => {
  const m = await importOriginal<typeof import('@/services/minimax.service')>();
  class MinimaxService {
    isImageAvailable() { return false; }
    isVideoAvailable() { return true; }
    async generateVideo(frame: string, prompt: string) {
      h.minimax.push({ frame, prompt });
      return 'https://cdn.example/regen.mp4';
    }
  }
  return { ...m, MinimaxService };
});
vi.mock('@/services/kling.service', async (importOriginal) => {
  const m = await importOriginal<typeof import('@/services/kling.service')>();
  class KlingService {
    async regenerateShotAt4K(frame: string, prompt: string) {
      h.kling4k.push({ frame, prompt });
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
vi.mock('@/services/video-composer', async (importOriginal) => {
  const m = await importOriginal<typeof import('@/services/video-composer')>();
  return {
    ...m,
    stillFrameToVideo: async () => {
      const f = path.join(os.tmpdir(), `qf-animatic-v1310-${nanoid(6)}.mp4`);
      fs.writeFileSync(f, '');
      return f;
    },
    // 发布预检只关心内容审计这一段;成片完整性由 v12 的真 ffprobe 用例守
    probeVideoIntegrity: async () => ({ ok: true, width: 1080, height: 1920, durationSec: 20, hasAudio: true, sizeBytes: 1000 }),
  };
});
vi.mock('@/services/intro-outro', () => ({
  wrapWithIntroOutro: async (src: string, opts: { coverImagePath?: string }) => {
    h.intro.push({ coverImagePath: opts.coverImagePath });
    return src;
  },
}));
// 编排器用真的;只把出图、整段视频生产、剪辑、审片换成记录器 —— 单镜重生(regenerateShot)仍是真代码
vi.mock('@/services/hybrid-orchestrator', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/services/hybrid-orchestrator')>();
  class HybridOrchestrator extends real.HybridOrchestrator {
    constructor() {
      super();
      const self = this as unknown as Record<string, unknown>;
      self.generateImage = async (prompt: string) => { h.images.push(prompt); return 'https://cdn.example/redraw.png'; };
    }
    async runVideoProducer(storyboards: Array<{ shotNumber: number; imageUrl: string; prompt: string; planData?: Record<string, unknown> }>): Promise<never[]> {
      for (const b of storyboards) h.producer.push({ shotNumber: b.shotNumber, imageUrl: b.imageUrl, prompt: b.prompt, planData: b.planData });
      return [];
    }
    async runEditor(): Promise<never> { throw new Error('editor-stubbed'); }
    async runDirectorReview(): Promise<never> { throw new Error('review-stubbed'); }
  }
  return { ...real, HybridOrchestrator };
});
vi.mock('@/services/demo-orchestrator', async (importOriginal) => {
  const m = await importOriginal<typeof import('@/services/demo-orchestrator')>();
  return { ...m, isDemoMode: () => false };
});
vi.mock('@/services/agent-chat.service', () => {
  class AgentChatService {
    async *chat(_role: unknown, prompt: string) {
      h.chats.push(prompt);
      yield { type: 'content', content: '{"overallScore": 80, "summary": "ok"}' };
    }
  }
  return { AgentChatService };
});
vi.mock('@/services/cameo-retry', async (importOriginal) => {
  const m = await importOriginal<typeof import('@/services/cameo-retry')>();
  return {
    ...m,
    // 不评分(付费视觉调用),直接按「分低、要重画」走一次 —— 被测的是重画用的提示词和 sref 参考链
    evaluateAndRetry: async (input: { sameCharacterRecentShots?: string[]; regenerate: (cw: number, refs: string[]) => Promise<string> }) => {
      h.cameoRefs.push([...(input.sameCharacterRecentShots ?? [])]);
      const url = await input.regenerate(120, []);
      return { finalImageUrl: url, finalScore: 90, firstScore: 40, retried: true, finalCw: 120, reasoning: 'r', needsHumanReview: false };
    },
  };
});
vi.mock('@/lib/vision-audit', async (importOriginal) => {
  const m = await importOriginal<typeof import('@/lib/vision-audit')>();
  return {
    ...m,
    auditShotVsScript: async (img: string, ctx: { shotNumber: number; sceneDescription?: string }) => {
      h.audits.push({ img, shotNumber: ctx.shotNumber, sceneDescription: ctx.sceneDescription });
      return null;
    },
    getProjectAudits: async () => [],
  };
});
vi.mock('@/lib/asset-embedding', async (importOriginal) => {
  const m = await importOriginal<typeof import('@/lib/asset-embedding')>();
  return {
    ...m,
    hasImageEmbeddingKey: () => true,
    embedImage: async (url: string) => { h.embeds.push(url); return { vector: [h.embeds.length, 1, 0.5] }; },
  };
});
vi.mock('@/lib/lipsync-providers', async (importOriginal) => {
  const m = await importOriginal<typeof import('@/lib/lipsync-providers')>();
  return {
    ...m,
    lipSyncEngineConfigured: () => true,
    // 记下人脸就失败 —— 不进任何真实口型服务
    dispatchLipSyncGenerate: async (input: { faceUrl: string }) => { h.faces.push(input.faceUrl); return { result: null, tried: [] }; },
  };
});
vi.mock('@/lib/asset-storage', async (importOriginal) => {
  const m = await importOriginal<typeof import('@/lib/asset-storage')>();
  return { ...m, persistAsset: async (u: string) => ({ url: u }) };
});
vi.mock('@/lib/auth-guard', async (importOriginal) => {
  const m = await importOriginal<typeof import('@/lib/auth-guard')>();
  return { ...m, requireProjectAccess: async () => ({ ok: true, userId: h.uid }), requireUser: () => ({ ok: true, userId: h.uid }) };
});
vi.mock('@/app/api/auth/lib', async (importOriginal) => {
  const m = await importOriginal<typeof import('@/app/api/auth/lib')>();
  return { ...m, getUserFromRequest: () => ({ sub: h.uid }) };
});
vi.mock('@/lib/budget-enforce', async (importOriginal) => {
  const m = await importOriginal<typeof import('@/lib/budget-enforce')>();
  return { ...m, assertBudget: async () => ({ allow: true, guard: {} }) };
});
vi.mock('@/lib/paid-endpoint-guard', async (importOriginal) => {
  const m = await importOriginal<typeof import('@/lib/paid-endpoint-guard')>();
  return { ...m, guardPaidEndpoint: async () => ({ ok: true }) };
});
vi.mock('@/lib/plan-gate', async (importOriginal) => {
  const m = await importOriginal<typeof import('@/lib/plan-gate')>();
  return { ...m, checkPlan: () => ({ ok: true, userId: h.uid, current: 'pro', required: 'pro' }) };
});
vi.mock('@/services/segment-retake-run', async (importOriginal) => {
  const m = await importOriginal<typeof import('@/services/segment-retake-run')>();
  return {
    ...m,
    shotFinalDuration: async () => 8,
    projectFps: async () => 24,
    shotSourceFps: async () => 24,
    tryLockShot: () => () => {},
    // 截帧失败的情形:补丁首帧退回这一镜的分镜图 —— 这样首帧和文字两样都看得到
    runSegmentRetake: async (input: { shotNumber: number; prompt?: string }, deps: { generatePatch: (a: Record<string, unknown>) => Promise<unknown> }) => {
      const patch = await deps.generatePatch({ shotNumber: input.shotNumber, durationS: 3, firstFrameUrl: '', promptExtra: input.prompt });
      return { patch };
    },
  };
});

import { NextRequest } from 'next/server';
import { db, now } from '@/lib/db';
import { createProject } from '@/lib/repos/project-repo';
import { createAsset, listAssetsByType, listProjectAssets } from '@/lib/repos/asset-repo';
import { serveFilePathUrl } from '@/lib/serve-file-sign';
import {
  latestStoryboardByShot, latestStoryboardForShot, SHOT_LEVEL_KEYS,
} from '@/lib/storyboard-latest';

// ── 夹具 ──────────────────────────────────────────────────────────────────────
const T = { june: '2026-06-01T00:00:00.000Z', july: '2026-07-01T00:00:00.000Z', aug: '2026-08-01T00:00:00.000Z', sep: '2026-09-01T00:00:00.000Z' };
const img = (tag: string) => `https://cdn.example/${tag}.png`;
/** 每镜「当前」那行的正文(不带 MJ 参数)—— 引擎收到的提示词里必须有它 */
const NEW = {
  1: '她在车门合上前回头看向站台',
  2: '天台逆光剪影他把发报机天线拉到最长',
  3: '码头俯拍两人隔着集装箱对峙',
} as const;
const STALE = ['旧稿一', '中间稿一', '旧稿二', '中间稿二']; // 被替换掉的行的正文,哪个都不该出现
const MJ_SYNTAX = /(^|\s)--[a-z]/i;
const PLAN1 = { cameraAngle: '低角度仰拍', lighting: '冷色侧逆光' };

type Row = { id: string };
async function sb(pid: string, shot: number, name: string, data: Record<string, unknown>, media: string, at: { created: string; updated: string; version: number }): Promise<string> {
  const r = await createAsset({ projectId: pid, type: 'storyboard', name, shotNumber: shot, mediaUrls: [media], data }) as Row;
  db.prepare('UPDATE project_assets SET created_at = ?, updated_at = ?, version = ? WHERE id = ?').run(at.created, at.updated, at.version, r.id);
  return r.id;
}
/** 旧行 A → 最新行 B → 较早重生行 C(见文件头) */
async function multiRowShot(pid: string, shot: 1 | 2, opts: { aMedia?: string } = {}) {
  const tag = shot === 1 ? '一' : '二';
  const a = await sb(pid, shot, `镜头 ${shot}`,
    { description: `旧稿${tag}:站台远景人群 --ar 16:9 --s 250`, ...(shot === 1 ? { planData: PLAN1, duration: 6, cameraSpec: { shotSize: 'MS' } } : { duration: 4 }), cameoScore: 31 },
    opts.aMedia ?? img(`sb-${shot}-a`), { created: T.june, updated: T.sep, version: 2 });
  const b = await sb(pid, shot, shot === 1 ? `Shot 1(九宫格选定 c7)` : 'Shot 2 (re-gen)',
    shot === 1 ? { prompt: `${NEW[1]} --ar 16:9 --no text`, picked: true, fromCandidate: 'c7' } : { prompt: `${NEW[2]}, cinematic --ar 16:9 --no watermark`, regenerated: true },
    img(`sb-${shot}-b`), { created: T.aug, updated: T.aug, version: 1 });
  const c = await sb(pid, shot, `Shot ${shot} (re-gen)`,
    { prompt: `中间稿${tag}:车厢俯拍 --ar 16:9`, regenerated: true, ...(shot === 1 ? { duration: 7 } : { fromCandidate: 'c2' }) },
    img(`sb-${shot}-c`), { created: T.july, updated: T.july, version: 3 });
  return { a, b, c };
}

/** 主项目:镜 1、2 多行,镜 3 单行;镜 2、3 有视频,镜 1 没有(导出时退回分镜图) */
async function seedProject(title: string, opts: { videos?: boolean } = {}) {
  const pid = (await createProject({ userId: h.uid, title, description: 'd', coverUrls: [] }) as { id: string }).id;
  await createAsset({ projectId: pid, type: 'character', name: '林晚', mediaUrls: [img('char')], data: { description: '主角' } });
  await createAsset({
    projectId: pid, type: 'script', name: '剧本',
    data: { title, synopsis: 's', shots: [1, 2, 3].map((n) => ({ shotNumber: n, duration: 5, sceneDescription: `剧本镜 ${n}`, dialogue: n === 1 ? '你终于来了' : '' })) },
  });
  const rows1 = await multiRowShot(pid, 1);
  // 镜 2 的旧行是出图失败时的示意图(mock 素材)—— 重生之后它已不在片子里,导出审计不该再算它
  const rows2 = await multiRowShot(pid, 2, { aMedia: '/api/mock-assets/storyboard-2.png' });
  await sb(pid, 3, '镜头 3', { description: `${NEW[3]} --ar 16:9 --cw 90`, duration: 5 }, img('sb-3'), { created: T.june, updated: T.june, version: 1 });
  if (opts.videos !== false) {
    for (const n of [2, 3]) {
      await createAsset({ projectId: pid, type: 'video', name: `视频 ${n}`, shotNumber: n, mediaUrls: [`https://cdn.example/v-${n}.mp4`], data: { duration: 5, status: 'completed' } });
    }
  }
  return { pid, rows1, rows2 };
}

let P = '';
let ROWS1: { a: string; b: string; c: string };
let ROWS2: { a: string; b: string; c: string };

beforeAll(async () => {
  db.prepare(`INSERT OR IGNORE INTO users (id, email, password_hash, name, role, created_at) VALUES (?, ?, ?, ?, 'user', ?)`)
    .run(h.uid, `${h.uid}@test.local`, 'x', '多行分镜', now());
  const s = await seedProject('同镜多行分镜');
  P = s.pid; ROWS1 = s.rows1; ROWS2 = s.rows2;
});

const savedMock = process.env.MOCK_ENGINES;
beforeEach(() => {
  delete process.env.MOCK_ENGINES; // 开着它单镜重生会整条换成本地假片(v12.459),就测不到引擎入参了
  for (const k of ['minimax', 'kling4k', 'producer', 'images', 'cameoRefs', 'audits', 'chats', 'embeds', 'faces', 'intro'] as const) h[k].length = 0;
});
afterEach(() => {
  if (savedMock === undefined) delete process.env.MOCK_ENGINES; else process.env.MOCK_ENGINES = savedMock;
});

const jsonReq = (url: string, body: unknown) => new NextRequest(url, {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
});
const getReq = (url: string) => new NextRequest(url);
const params = (id: string) => ({ params: Promise.resolve({ id }) });
async function events(res: Response): Promise<Array<{ type: string; data: any }>> {
  const text = await res.text();
  return text.split('\n').filter((l) => l.startsWith('data: ')).map((l) => JSON.parse(l.slice(6)));
}
function expectCurrentText(prompt: string | undefined, n: 1 | 2 | 3, opts: { plain?: boolean } = {}) {
  const p = prompt ?? '';
  expect(p, `收到的文字里没有镜 ${n} 当前那行的正文`).toContain(NEW[n]);
  for (const s of STALE) expect(p, `收到的文字里混进了被替换的行「${s}」`).not.toContain(s);
  if (opts.plain !== false) expect(p).not.toMatch(MJ_SYNTAX);
}

// ── 夹具自检:确实是「四种旧写法都会取错」的形状 ─────────────────────────────
describe('v13.10 · 夹具自检', () => {
  it('库里按镜号排序时,多行镜头的第一行是旧行 A、最后一行是较早重生行 C;updated_at / version 最大的是 A', async () => {
    const rows = await listAssetsByType(P, 'storyboard');
    for (const [shot, ids] of [[1, ROWS1], [2, ROWS2]] as const) {
      const mine = rows.filter((r) => r.shot_number === shot);
      expect(mine.map((r) => r.id)).toEqual([ids.a, ids.b, ids.c]);
      expect([...mine].sort((x, y) => y.updated_at.localeCompare(x.updated_at))[0].id).toBe(ids.a);
      expect([...mine].sort((x, y) => y.version - x.version)[0].id).not.toBe(ids.b);
    }
  });
});

// ── 入口函数本身 ──────────────────────────────────────────────────────────────
describe('v13.10 · latestStoryboardByShot', () => {
  const row = (id: string, shot: number | null, created: string, updated = created, data: unknown = {}) =>
    ({ id, type: 'storyboard', project_id: 'p', shot_number: shot, created_at: created, updated_at: updated, data });

  it('按插入先后取:旧行后来被改过一个字段(updated_at 更晚)也不会翻身', () => {
    const out = latestStoryboardByShot([row('old', 1, T.june, T.sep), row('new', 1, T.aug)]);
    expect(out.map((r) => r.id)).toEqual(['new']);
  });

  it('created_at 并列看 updated_at,再并列看 id;全都一样时输入里靠后的赢 —— 同一批数据两次结果相同', () => {
    expect(latestStoryboardByShot([row('a', 1, T.aug, T.sep), row('b', 1, T.aug, T.aug)])[0].id).toBe('a');
    expect(latestStoryboardByShot([row('a', 1, T.aug), row('b', 1, T.aug)])[0].id).toBe('b');
    expect(latestStoryboardByShot([row('b', 1, T.aug), row('a', 1, T.aug)])[0].id).toBe('b');
    const same = [{ ...row('', 1, T.aug), name: 'x' }, { ...row('', 1, T.aug), name: 'y' }];
    expect((latestStoryboardByShot(same)[0] as { name: string }).name).toBe('y');
  });

  it('镜头级字段(planData / duration / cameraSpec…)从较新的旧行沿用;图本身的字段(文字、cameo 评分)不沿用', () => {
    const out = latestStoryboardByShot([
      row('a', 1, T.june, T.june, JSON.stringify({ description: '旧', planData: PLAN1, duration: 6, cameraSpec: { s: 1 }, cameoScore: 30 })),
      row('c', 1, T.july, T.july, JSON.stringify({ prompt: '中', duration: 7 })),
      row('b', 1, T.aug, T.aug, JSON.stringify({ prompt: '新' })),
    ]);
    const d = JSON.parse(out[0].data as string);
    expect(d).toEqual({ prompt: '新', planData: PLAN1, duration: 7, cameraSpec: { s: 1 } });
    expect(SHOT_LEVEL_KEYS).toContain('planData');
  });

  it('data 是对象就还给对象、不改输入;最新行自己有的字段不被覆盖', () => {
    const a = row('a', 1, T.june, T.june, { planData: PLAN1, duration: 6 });
    const b = row('b', 1, T.aug, T.aug, { prompt: '新', duration: 9 });
    const out = latestStoryboardByShot([a, b]);
    expect(out[0].data).toEqual({ prompt: '新', duration: 9, planData: PLAN1 });
    expect(b.data).toEqual({ prompt: '新', duration: 9 });
  });

  it('只看分镜行;不同项目分开取;没有镜号的行原样保留;按镜号升序', () => {
    const out = latestStoryboardByShot([
      { ...row('v', 1, T.sep), type: 'video' },
      row('p1-2', 2, T.june),
      { ...row('p2-1', 1, T.june), project_id: 'q' },
      row('p1-1', 1, T.june),
      row('loose', null, T.june),
    ]);
    expect(out.map((r) => r.id)).toEqual(['p1-1', 'p2-1', 'p1-2', 'loose']);
    expect(latestStoryboardForShot([row('x', 4, T.june), row('y', 4, T.aug)], 4)?.id).toBe('y');
  });

  it('前端行(camelCase)同一口径', () => {
    const out = latestStoryboardByShot([
      { id: 'a', type: 'storyboard', shotNumber: 1, createdAt: T.june, updatedAt: T.sep },
      { id: 'b', type: 'storyboard', shotNumber: 1, createdAt: T.aug, updatedAt: T.aug },
    ]);
    expect(out.map((r) => r.id)).toEqual(['b']);
  });
});

// ── 出片入口:引擎收到最新行的首帧和文字,每镜只调用一次 ──────────────────────
describe('v13.10 · 单镜重生 / 4K / 片段重拍 / 自愈:引擎收到当前那行', () => {
  it('全局单镜重生(/api/regenerate-shot,shotNumber)', async () => {
    const { POST } = await import('@/app/api/regenerate-shot/route');
    const ev = await events(await POST(jsonReq('http://localhost/api/regenerate-shot', { projectId: P, shotNumber: 1, videoProvider: 'minimax' })));
    expect(ev.some((e) => e.type === 'error'), JSON.stringify(ev.filter((e) => e.type === 'error'))).toBe(false);
    expect(h.minimax).toHaveLength(1);
    expect(h.minimax[0].frame).toBe(img('sb-1-b'));
    expectCurrentText(h.minimax[0].prompt, 1);
  }, 60_000);

  it('项目级单镜重生(创建页「重试镜头 N」)', async () => {
    const { pid } = await seedProject('项目级重生'); // 它会给镜 1 upsert 出视频行,另起项目免得影响后面「镜 1 没有视频」的导出用例
    const { POST } = await import('@/app/api/projects/[id]/regenerate-shot/route');
    const ev = await events(await POST(jsonReq(`http://localhost/api/projects/${pid}/regenerate-shot`, { shotNumber: 1, videoProvider: 'minimax' }), params(pid)));
    expect(ev.some((e) => e.type === 'error'), JSON.stringify(ev.filter((e) => e.type === 'error'))).toBe(false);
    expect(h.minimax).toHaveLength(1);
    expect(h.minimax[0].frame).toBe(img('sb-1-b'));
    expectCurrentText(h.minimax[0].prompt, 1);
  }, 60_000);

  it('4K 重渲', async () => {
    const { POST } = await import('@/app/api/projects/[id]/regenerate-shot-4k/route');
    const ev = await events(await POST(jsonReq(`http://localhost/api/projects/${P}/regenerate-shot-4k`, { shotNumber: 1 }), params(P)));
    expect(ev.find((e) => e.type === 'completed'), JSON.stringify(ev)).toBeTruthy();
    expect(h.kling4k).toHaveLength(1);
    expect(h.kling4k[0].frame).toBe(img('sb-1-b'));
    expectCurrentText(h.kling4k[0].prompt, 1);
  }, 60_000);

  it('片段重拍:截帧失败时补丁首帧退回分镜图,文字和首帧都是当前那行', async () => {
    const { POST } = await import('@/app/api/projects/[id]/segment-retake/route');
    const res = await POST(jsonReq(`http://localhost/api/projects/${P}/segment-retake`, { shotNumber: 2, fromS: 1, toS: 4, videoProvider: 'minimax' }), params(P));
    expect(res.status, JSON.stringify(await res.clone().json())).toBe(200);
    expect(h.minimax).toHaveLength(1);
    expect(h.minimax[0].frame).toBe(img('sb-2-b'));
    expectCurrentText(h.minimax[0].prompt, 2);
  }, 60_000);

  it('自愈补拍(heal-shots):每镜一次,首帧是当前那行', async () => {
    const { pid } = await seedProject('自愈'); // 会写质检、给镜 1 建视频行,另起项目
    await createAsset({ projectId: pid, type: 'quality_report', name: '质检', data: { degradedShots: [1, 2], healthScore: 40 } });
    const { POST } = await import('@/app/api/projects/[id]/heal-shots/route');
    const res = await POST(jsonReq(`http://localhost/api/projects/${pid}/heal-shots`, { heal: true, videoProvider: 'minimax' }), params(pid));
    expect(res.status, await res.clone().text()).toBe(200);
    expect(h.minimax.map((c) => c.frame).sort()).toEqual([img('sb-1-b'), img('sb-2-b')]);
  }, 60_000);

  it('批量补渲失败镜头(failed-videos,force):每镜一次,首帧和文字是当前那行', async () => {
    const { POST } = await import('@/app/api/regenerate-shot/route');
    const ev = await events(await POST(jsonReq('http://localhost/api/regenerate-shot', { projectId: P, stage: 'failed-videos', force: true, videoProvider: 'minimax' })));
    expect(ev.find((e) => e.type === 'batchDone')?.data?.ok, JSON.stringify(ev.filter((e) => /error/i.test(e.type)))).toBe(2);
    expect(h.minimax).toHaveLength(2); // 视频行只有镜 2、3
    const c2 = h.minimax.find((c) => c.frame === img('sb-2-b'));
    expect(c2, JSON.stringify(h.minimax.map((c) => c.frame))).toBeTruthy();
    expectCurrentText(c2?.prompt, 2);
  }, 60_000);

  it('整阶段重做视频(stage=video):每镜只交一次给视频生产,带当前那行的图和文字,镜头级 planData 从旧行沿用', async () => {
    const { POST } = await import('@/app/api/regenerate-shot/route');
    await events(await POST(jsonReq('http://localhost/api/regenerate-shot', { projectId: P, stage: 'video', videoProvider: 'minimax' })));
    expect(h.producer.map((p) => p.shotNumber), '同一镜被交了多次 —— 每行各出一次付费视频').toEqual([1, 2, 3]);
    expect(h.producer.map((p) => p.imageUrl)).toEqual([img('sb-1-b'), img('sb-2-b'), img('sb-3')]);
    for (const n of [1, 2, 3] as const) expectCurrentText(h.producer[n - 1].prompt, n, { plain: false });
    expect(h.producer[0].planData).toEqual(PLAN1);
  }, 60_000);

  it('口型渲染:说话人脸取当前那行(原来 version DESC 取到旧行)', async () => {
    const { POST } = await import('@/app/api/projects/[id]/lipsync/render/route');
    const res = await POST(jsonReq(`http://localhost/api/projects/${P}/lipsync/render`, {
      shotNumber: 1, audioUrl: 'https://cdn.example/a.mp3', visemes: [{ t: 0, viseme: 'A', mouthOpen: 0.5 }],
    }), params(P));
    expect(res.status).toBe(502); // 假引擎记下人脸就失败
    expect(h.faces).toEqual([img('sb-1-b')]);
  }, 60_000);
});

describe('v13.10 · 付费审图 / 重画:每镜一次,用当前那行', () => {
  it('视觉质检:每镜一次视觉调用,审的是当前那行的图和文字', async () => {
    const { POST } = await import('@/app/api/projects/[id]/vision-audit/run/route');
    await POST(jsonReq(`http://localhost/api/projects/${P}/vision-audit/run`, {}), params(P));
    expect(h.audits.map((a) => a.shotNumber).sort(), '同一镜审了多次').toEqual([1, 2, 3]);
    const a1 = h.audits.find((a) => a.shotNumber === 1);
    expect(a1?.img).toBe(img('sb-1-b'));
    expectCurrentText(a1?.sceneDescription, 1, { plain: false });
  }, 60_000);

  it('跑偏检测:每镜嵌入一次,嵌的是当前那行的图', async () => {
    const { GET } = await import('@/app/api/projects/[id]/drift-check/route');
    const res = await GET(getReq(`http://localhost/api/projects/${P}/drift-check`), params(P));
    expect(res.status).toBe(200);
    expect([...h.embeds].sort()).toEqual([img('sb-1-b'), img('sb-2-b'), img('sb-3')]);
  }, 60_000);

  it('Cameo 重画:MJ 按当前那行的文字重画,sref 参考链不含旧稿;评分写回当前那行', async () => {
    const { pid, rows2 } = await seedProject('Cameo 重画'); // 会把重画的图写回分镜行,另起项目
    const { POST } = await import('@/app/api/projects/[id]/cameo-retry-storyboard/route');
    const res = await POST(jsonReq(`http://localhost/api/projects/${pid}/cameo-retry-storyboard`, { shotNumbers: [2] }), params(pid));
    expect(res.status, JSON.stringify(await res.clone().json())).toBe(200);
    expect(h.images).toHaveLength(1);
    expect(h.images[0]).toContain(NEW[2]);
    for (const s of STALE) expect(h.images[0]).not.toContain(s);
    expect(h.cameoRefs).toEqual([[img('sb-1-b'), img('sb-3')]]);
    const dataOf = (id: string) => JSON.parse((db.prepare('SELECT data FROM project_assets WHERE id = ?').get(id) as { data: string }).data);
    expect(dataOf(rows2.b).cameoBatchAt, '评分没写进当前那行').toBeTruthy();
    expect(dataOf(rows2.a).cameoBatchAt).toBeUndefined();
    expect(dataOf(rows2.c).cameoBatchAt).toBeUndefined();
  }, 60_000);

  it('导演审核:分镜摘要每镜一条,是当前那行的文字', async () => {
    const { POST } = await import('@/app/api/projects/[id]/director-review/route');
    await events(await POST(jsonReq(`http://localhost/api/projects/${P}/director-review`, {}), params(P)));
    expect(h.chats).toHaveLength(1);
    for (const n of [1, 2, 3] as const) {
      expect(h.chats[0]).toContain(`镜头${n}: ${NEW[n]}`);
      expect(h.chats[0].split(`镜头${n}: `).length - 1, `镜头${n} 在摘要里出现了不止一次`).toBe(1);
    }
    for (const s of STALE) expect(h.chats[0]).not.toContain(s);
  }, 60_000);
});

describe('v13.10 · 续跑断点 / 决策日志 / 素材标题', () => {
  it('续跑断点:每镜一条,当前那行的图和文字,planData / duration 沿用旧行', async () => {
    const { loadCheckpoints } = await import('@/lib/pipeline-checkpoints');
    const cp = await loadCheckpoints(P);
    expect(cp.storyboardPlans.map((s) => s.shotNumber)).toEqual([1, 2, 3]);
    const s1 = cp.storyboardPlans[0];
    expect(s1.imageUrl).toBe(img('sb-1-b'));
    expectCurrentText(s1.prompt, 1, { plain: false });
    expect(s1.planData).toEqual(PLAN1);
    expect(s1.duration).toBe(7); // 最新行没有时长,沿用较新的旧行(C 的 7,不是 A 的 6、也不是默认 10)
  });

  it('决策日志:提示词与「九宫格选定」都按当前那行记', async () => {
    const { buildDecisionLog } = await import('@/lib/decision-log');
    const log = buildDecisionLog({ costRows: [], assets: await listProjectAssets(P) });
    const s1 = log.shots.find((s) => s.shotNumber === 1);
    const s2 = log.shots.find((s) => s.shotNumber === 2);
    expectCurrentText(s1?.prompt, 1, { plain: false });
    expect(s1?.pickedFromCandidate).toBe('c7');
    expectCurrentText(s2?.prompt, 2, { plain: false });
    expect(s2?.pickedFromCandidate, '镜 2 当前那行是重生行,不是九宫格选定').toBeUndefined();
  });

  it('素材库标题:视频借的是这一镜当前那行分镜的描述', async () => {
    const { buildStoryboardIndex, assetDisplayTitle } = await import('@/lib/asset-title');
    const rows = (await listProjectAssets(P)).map((a) => ({
      id: a.id, type: a.type, name: a.name, projectId: a.project_id, shotNumber: a.shot_number,
      data: JSON.parse(a.data), createdAt: a.created_at, updatedAt: a.updated_at,
    }));
    const idx = buildStoryboardIndex(rows);
    expect(assetDisplayTitle({ type: 'video', name: '视频 2', projectId: P, shotNumber: 2, data: {} }, idx)).toContain('天台逆光剪影');
  });
});

describe('v13.10 · 导出 / 预检 / 拉片单 / 时间线:用当前那行,示意图审计不算已被替换的行', () => {
  it('FCPXML(export-edl):没有视频的镜退回分镜图时是当前那行;审计头 0 处示意图', async () => {
    const { GET } = await import('@/app/api/projects/[id]/export-edl/route');
    const res = await GET(getReq(`http://localhost/api/projects/${P}/export-edl?format=fcpxml`), params(P));
    expect(res.status).toBe(200);
    const xml = await res.text();
    expect(xml).toContain(img('sb-1-b'));
    expect(xml).not.toContain(img('sb-1-a'));
    expect(xml).not.toContain(img('sb-1-c'));
    expect(res.headers.get('X-QFMJ-Placeholder-Count')).toBe('0');
  });

  it('AAF:同上', async () => {
    const { GET } = await import('@/app/api/projects/[id]/export-aaf/route');
    const res = await GET(getReq(`http://localhost/api/projects/${P}/export-aaf`), params(P));
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toContain(img('sb-1-b'));
    expect(body).not.toContain(img('sb-1-a'));
    expect(res.headers.get('X-QFMJ-Placeholder-Count')).toBe('0');
  });

  it('剪映草稿:示意图审计 0 处', async () => {
    const { POST } = await import('@/app/api/projects/[id]/export-jianying/route');
    const res = await POST(jsonReq(`http://localhost/api/projects/${P}/export-jianying`, { clips: [{ path: '/tmp/a.mp4', durationSec: 5 }] }), params(P));
    expect(res.status).toBe(200);
    expect((await res.json()).placeholderAudit.count).toBe(0);
  });

  it('拉片单:每镜缩略图是当前那行', async () => {
    const { GET } = await import('@/app/api/projects/[id]/pull-sheet/route');
    const res = await GET(getReq(`http://localhost/api/projects/${P}/pull-sheet`), params(P));
    expect(res.status).toBe(200);
    const sheet = await res.json();
    const shots = (sheet.sheet ?? sheet).shots as Array<{ shotNumber: number; thumbnail: string | null }>;
    expect(shots.map((s) => s.thumbnail)).toEqual([img('sb-1-b'), img('sb-2-b'), img('sb-3')]);
  });

  it('拉片单存模板:模板预览图是首镜当前那行', async () => {
    const { POST } = await import('@/app/api/projects/[id]/pull-sheet/save-template/route');
    const res = await POST(jsonReq(`http://localhost/api/projects/${P}/pull-sheet/save-template`, {}), params(P));
    expect(res.status, await res.clone().text()).toBe(200);
    const { templateId } = await res.json();
    const row = db.prepare('SELECT payload FROM film_templates WHERE id = ?').get(templateId) as { payload: string };
    expect(JSON.parse(row.payload).previewUrl).toBe(img('sb-1-b'));
  });

  it('项目存模板:市场卡片预览是首镜当前那行', async () => {
    const { POST } = await import('@/app/api/projects/[id]/save-template/route');
    const res = await POST(jsonReq(`http://localhost/api/projects/${P}/save-template`, {}), params(P));
    expect(res.status, await res.clone().text()).toBe(200);
    expect((await res.json()).template.payload.previewUrl).toBe(img('sb-1-b'));
  });

  it('时间线:每镜缩略图是当前那行', async () => {
    const { GET } = await import('@/app/api/projects/[id]/timeline/route');
    const res = await GET(getReq(`http://localhost/api/projects/${P}/timeline`), params(P));
    const body = await res.json();
    expect(body.shots.map((s: { thumbnailUrl?: string }) => s.thumbnailUrl)).toEqual([img('sb-1-b'), img('sb-2-b'), img('sb-3')]);
  });

  it('项目列表:封面首选首镜当前那行;已被替换的示意图分镜不计入示意图徽章', async () => {
    const { GET } = await import('@/app/api/projects/route');
    const list = await (await GET(new Request('http://localhost/api/projects'))).json() as Array<{ id: string; covers: string[]; placeholderCount: number }>;
    const me = list.find((p) => p.id === P);
    expect(me?.covers[0]).toBe(img('sb-1-b'));
    expect(me?.placeholderCount).toBe(0);
  });

  it('项目详情 API 吐 createdAt(项目页按它在前端取当前那行)', async () => {
    const { GET } = await import('@/app/api/projects/[id]/route');
    const body = await (await GET(getReq(`http://localhost/api/projects/${P}`), params(P))).json();
    const boards = (body.assets as Array<{ type: string; id: string; createdAt?: string }>).filter((a) => a.id === ROWS1.b);
    expect(boards[0]?.createdAt).toBe(T.aug);
  });
});

describe('v13.10 · 写回分镜的入口写进当前那行', () => {
  const dataOf = (id: string) => JSON.parse((db.prepare('SELECT data FROM project_assets WHERE id = ?').get(id) as { data: string }).data);

  it('shot-spec:机位规格写进当前那行,旧行不动', async () => {
    const { POST } = await import('@/app/api/projects/[id]/shot-spec/route');
    const res = await POST(jsonReq(`http://localhost/api/projects/${P}/shot-spec`, { shotNumber: 2, cameraSpec: { shotSize: 'CU', movement: 'dolly-in' } }), params(P));
    expect(res.status).toBe(200);
    expect(dataOf(ROWS2.b).cameraSpec?.shotSize).toBe('CU');
    expect(dataOf(ROWS2.a).cameraSpec).toBeUndefined();
    expect(dataOf(ROWS2.c).cameraSpec).toBeUndefined();
  });

  it('param-sync:每镜 spec 写进当前那行', async () => {
    const { POST } = await import('@/app/api/projects/[id]/param-sync/route');
    const res = await POST(jsonReq(`http://localhost/api/projects/${P}/param-sync`, { doc: { shots: [{ shotNumber: 1, spec: { shotSize: 'WS' } }] } }), params(P));
    expect(res.status).toBe(200);
    expect(dataOf(ROWS1.b).cameraSpec?.shotSize).toBe('WS');
    expect(dataOf(ROWS1.a).cameraSpec?.shotSize).toBe('MS'); // 旧行原来的值不动
    expect(dataOf(ROWS1.c).cameraSpec).toBeUndefined();
  });
});

describe('v13.10 · 另起项目才测得到的几处', () => {
  it('渲染进度(render-loop):没出视频的镜按当前那行算尝试次数', async () => {
    const { pid } = await seedProject('渲染进度', { videos: false });
    const { GET } = await import('@/app/api/projects/[id]/render-loop/route');
    const body = await (await GET(getReq(`http://localhost/api/projects/${pid}/render-loop?snapshot=1`), params(pid))).json();
    const s1 = body.shots.find((s: { shotNumber: number }) => s.shotNumber === 1);
    expect(s1.attempts, '尝试次数读的是旧行(A 的 version 2)或较早重生行(C 的 version 3)').toBe(1);
  });

  it('mp4 导出片头封面 + 发布预检:都用当前那行 / 审计不算已被替换的行', async () => {
    const pid = (await createProject({ userId: h.uid, title: '片头封面', description: 'd', coverUrls: [] }) as { id: string }).id;
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'v1310-'));
    const file = (n: string) => { const f = path.join(dir, n); fs.writeFileSync(f, n); return f; };
    const local = (n: string) => serveFilePathUrl(file(n));
    const at = (created: string, updated = created, version = 1) => ({ created, updated, version });
    await sb(pid, 1, '镜头 1', { description: '旧稿一' }, local('a.png'), at(T.june, T.sep, 2));
    await sb(pid, 1, 'Shot 1 (re-gen)', { prompt: NEW[1] }, local('b.png'), at(T.aug));
    await sb(pid, 1, 'Shot 1 (re-gen)', { prompt: '中间稿一' }, local('c.png'), at(T.july, T.july, 3));
    await sb(pid, 2, '镜头 2', { description: '旧稿二' }, '/api/mock-assets/storyboard-2.png', at(T.june, T.sep, 2));
    await sb(pid, 2, 'Shot 2 (re-gen)', { prompt: NEW[2] }, local('d.png'), at(T.aug));
    const finalUrl = local('final.mp4');
    await createAsset({ projectId: pid, type: 'final_video', name: '成片', mediaUrls: [finalUrl], persistentUrl: finalUrl, data: {} });

    const exp = await import('@/app/api/projects/[id]/export/route');
    const res = await exp.GET(getReq(`http://localhost/api/projects/${pid}/export?type=mp4&intro=1`), params(pid));
    expect(res.status, await res.clone().text()).toBe(200);
    expect(h.intro).toHaveLength(1);
    expect(h.intro[0].coverImagePath).toBe(path.join(dir, 'b.png'));
    expect(res.headers.get('X-QFMJ-Placeholder-Count')).toBe('0');

    const pre = await import('@/app/api/projects/[id]/publish-preflight/route');
    const r2 = await pre.GET(getReq(`http://localhost/api/projects/${pid}/publish-preflight`), params(pid));
    expect(r2.status, await r2.clone().text()).toBe(200);
    expect((await r2.json()).contentAudit.placeholders).toBe(0);
  });
});
