/**
 * v13.9 · 分镜文字两种存法(description / prompt),每个读取方都读得到。
 *
 * 病:创建页 / 主管线把分镜文字写进 data.description;重生分镜图、九宫格选定**插入新行**,只写 data.prompt。
 * 读取方各认一种 —— 本机库 243 镜里 53 镜的最新分镜行只有 prompt,于是:
 *   · 续跑管线的视频阶段拿到空串,分镜渲染阶段还把空串回写进这一镜**所有**分镜行;
 *   · 项目页「改一镜」退化成只按那句话重画;创建页「重试镜头 N」(只发 shotNumber)给引擎发空提示词;
 *   · 4K 重渲发给可灵的是资产名「镜头 3」;Cameo 重画让 MJ 按「Shot 3」出图;
 *   · 视觉质检、导演审核读空;决策日志反过来只认 prompt。
 *
 * 这里每条入口都**真跑**:真测试库、真路由、真编排器(只把整段管线里出图 / 剪辑 / 审片这几步换成记录器),
 * 引擎换成记录入参的假服务 —— 断言的是引擎 / MJ / 视觉质检**收到**的文字,不是 storyboardText 的返回值。
 * 每条都用两种分镜行各跑一遍:只有 description 的(创建页写法)、只有 prompt 的(重生 / 选定写法);
 * 断言正文在、MJ 参数不在,免得「发了个空串」也能满足「没有 --ar」。
 *
 * 不在这里管的:同一镜有多行时各读取方「取哪一行」口径不一(有的取最新、有的取第一行、有的全取),那是另一件事。
 */
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { nanoid } from 'nanoid';

const h = vi.hoisted(() => ({
  uid: 'u-v1309',
  minimax: [] as Array<{ frame: string; prompt: string }>,
  kling4k: [] as string[],
  producer: [] as Array<{ shotNumber: number; prompt: string }>,
  images: [] as string[],
  audits: [] as Array<{ shotNumber: number; sceneDescription?: string }>,
  chats: [] as string[],
  mj: [] as string[],
  mjOn: false,
}));

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
    async regenerateShotAt4K(_frame: string, prompt: string) {
      h.kling4k.push(prompt);
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
vi.mock('@/services/midjourney.service', async (importOriginal) => {
  const m = await importOriginal<typeof import('@/services/midjourney.service')>();
  class MidjourneyService {
    // video-compare 出首帧这一步:记下提示词就失败,后面的付费引擎一个都不进
    async generateImage(prompt: string): Promise<string> { h.mj.push(prompt); throw new Error('stop-after-prompt'); }
  }
  return { ...m, MidjourneyService, hasMidjourney: () => h.mjOn };
});
vi.mock('@/services/video-composer', async (importOriginal) => {
  const m = await importOriginal<typeof import('@/services/video-composer')>();
  return {
    ...m,
    stillFrameToVideo: async () => {
      const f = path.join(os.tmpdir(), `qf-animatic-v1309-${nanoid(6)}.mp4`);
      fs.writeFileSync(f, '');
      return f;
    },
  };
});
// 编排器用真的;只把出图、整段视频生产、剪辑、审片换成记录器 / 空实现 —— 单镜重生(regenerateShot)仍是真代码
vi.mock('@/services/hybrid-orchestrator', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/services/hybrid-orchestrator')>();
  class HybridOrchestrator extends real.HybridOrchestrator {
    constructor() {
      super();
      const self = this as unknown as Record<string, unknown>;
      self.generateImage = async (prompt: string) => { h.images.push(prompt); return 'https://cdn.example/redraw.png'; };
    }
    async runVideoProducer(storyboards: Array<{ shotNumber: number; prompt: string }>): Promise<never[]> {
      for (const b of storyboards) h.producer.push({ shotNumber: b.shotNumber, prompt: b.prompt });
      return [];
    }
    async runEditor(): Promise<never> { throw new Error('editor-stubbed'); }
    async runDirectorReview(): Promise<never> { throw new Error('review-stubbed'); }
  }
  return { ...real, HybridOrchestrator };
});
// 测试环境没有 LLM key → 项目级重生、导演审核会进 demo 分支;这里要走真实分支
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
    // 不评分(那是付费视觉调用),直接按「分低、要重画」走一次 regenerate —— 被测的是重画用的提示词
    evaluateAndRetry: async (input: { regenerate: (cw: number, refs: string[]) => Promise<string> }) => {
      const url = await input.regenerate(120, []);
      return { finalImageUrl: url, finalScore: 90, firstScore: 40, retried: true, finalCw: 120, reasoning: 'r', needsHumanReview: false };
    },
  };
});
vi.mock('@/lib/vision-audit', async (importOriginal) => {
  const m = await importOriginal<typeof import('@/lib/vision-audit')>();
  return {
    ...m,
    auditShotVsScript: async (_img: string, ctx: { shotNumber: number; sceneDescription?: string }) => {
      h.audits.push({ shotNumber: ctx.shotNumber, sceneDescription: ctx.sceneDescription });
      return null;
    },
    getProjectAudits: async () => [],
  };
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
vi.mock('@/lib/paid-endpoint-guard', async (importOriginal) => {
  const m = await importOriginal<typeof import('@/lib/paid-endpoint-guard')>();
  return { ...m, guardPaidEndpoint: async () => ({ ok: true }) };
});
vi.mock('@/lib/plan-gate', async (importOriginal) => {
  const m = await importOriginal<typeof import('@/lib/plan-gate')>();
  return { ...m, checkPlan: () => ({ ok: true, userId: h.uid, current: 'pro', required: 'pro' }) };
});
// 片段重拍:取原片、截帧、缝合由 v12-459 的真库真 ffmpeg 用例守着;这里只关心交给编排器的那一步
vi.mock('@/services/segment-retake-run', async (importOriginal) => {
  const m = await importOriginal<typeof import('@/services/segment-retake-run')>();
  return {
    ...m,
    shotFinalDuration: async () => 8,
    projectFps: async () => 24,
    shotSourceFps: async () => 24, // v13.4 起按原片帧率(会下载原片);不换掉就会去拉 cdn.example
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
import { storyboardText } from '@/lib/storyboard-text';

/**
 * 三镜,对应库里的三种形状。正文都带 MJ 参数 —— 本机库 233 条 description、56 条 prompt-only 行都是这样。
 *   1:只有 description(创建页 / 主管线写法)
 *   2:只有 prompt(只有一行,重生分镜图写法)
 *   3:老的 description 行 + 后插的 prompt 行(九宫格选定之后 —— 那 53 镜的真实形状;只给「取最新行」的读取方用)
 */
const SHOTS = {
  1: { body: '雨夜巷口她撑着红伞回头看向镜头', data: { description: '雨夜巷口她撑着红伞回头看向镜头 --ar 16:9 --s 250 --no text' } },
  2: { body: '天台逆光剪影他把发报机天线拉到最长', data: { prompt: '天台逆光剪影他把发报机天线拉到最长, cinematic --ar 16:9 --no text --no watermark', regenerated: true } },
  3: { body: '码头俯拍两人隔着集装箱对峙', data: { prompt: '码头俯拍两人隔着集装箱对峙 --ar 16:9 --cw 90', picked: true, fromCandidate: 'c4' } },
} as const;
const OLD_SHOT3 = '旧稿仓库门口的远景';
const MJ_SYNTAX = /(^|\s)--[a-z]/i;
type ShotNo = 1 | 2;
const BOTH: ShotNo[] = [1, 2];
const frameOf = (n: number) => `https://cdn.example/sb-${n}.png`;

let pid = '';

beforeAll(async () => {
  db.prepare(`INSERT OR IGNORE INTO users (id, email, password_hash, name, role, created_at) VALUES (?, ?, ?, ?, 'user', ?)`)
    .run(h.uid, `${h.uid}@test.local`, 'x', '分镜文字', now());
  pid = (await createProject({ userId: h.uid, title: '分镜文字两种存法', description: 'd', coverUrls: [] }) as { id: string }).id;
  await createAsset({ projectId: pid, type: 'character', name: '林晚', mediaUrls: ['https://cdn.example/char.png'], data: { description: '主角' } });
  for (const n of [1, 2] as const) {
    await createAsset({ projectId: pid, type: 'storyboard', name: `镜头 ${n}`, shotNumber: n, mediaUrls: [frameOf(n)], data: SHOTS[n].data });
    await createAsset({ projectId: pid, type: 'video', name: `视频 ${n}`, shotNumber: n, mediaUrls: [`https://cdn.example/v-${n}.mp4`], data: { duration: 5, status: 'completed' } });
  }
  const old = await createAsset({ projectId: pid, type: 'storyboard', name: '镜头 3', shotNumber: 3, mediaUrls: ['https://cdn.example/sb-3-old.png'], data: { description: OLD_SHOT3 } }) as { id: string };
  db.prepare('UPDATE project_assets SET updated_at = ? WHERE id = ?').run('2026-01-01T00:00:00.000Z', old.id);
  await createAsset({ projectId: pid, type: 'storyboard', name: 'Shot 3(九宫格选定 c4)', shotNumber: 3, mediaUrls: [frameOf(3)], data: SHOTS[3].data });
});

const savedMock = process.env.MOCK_ENGINES;
beforeEach(() => {
  delete process.env.MOCK_ENGINES; // 开着它单镜重生会整条换成本地假片(v12.459),就测不到引擎入参了
  for (const k of ['minimax', 'kling4k', 'producer', 'images', 'audits', 'chats', 'mj'] as const) h[k].length = 0;
  h.mjOn = false;
});
afterEach(() => {
  if (savedMock === undefined) delete process.env.MOCK_ENGINES; else process.env.MOCK_ENGINES = savedMock;
  vi.unstubAllGlobals();
});

const jsonReq = (url: string, body: unknown) => new Request(url, {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
}) as any;
const params = (id: string) => ({ params: Promise.resolve({ id }) });
async function events(res: Response): Promise<Array<{ type: string; data: any }>> {
  const text = await res.text();
  return text.split('\n').filter((l) => l.startsWith('data: ')).map((l) => JSON.parse(l.slice(6)));
}
/** 视频引擎收到的提示词:正文在、MJ 参数不在 */
function expectPlainBody(prompt: string | undefined, n: 1 | 2 | 3) {
  expect(prompt ?? '', '引擎收到的提示词里没有分镜正文').toContain(SHOTS[n].body);
  expect(prompt ?? '').not.toMatch(MJ_SYNTAX);
}

describe('v13.9 · 单镜重生 / 片段重拍 / 4K:引擎收到这一镜的分镜文字', () => {
  describe.each(BOTH)('镜 %i', (n) => {
    it('创建页「重试镜头 N」(项目级单镜重生,只发 shotNumber)', async () => {
      const { POST } = await import('@/app/api/projects/[id]/regenerate-shot/route');
      const ev = await events(await POST(jsonReq(`http://localhost/api/projects/${pid}/regenerate-shot`, { shotNumber: n, videoProvider: 'minimax' }), params(pid)));
      expect(ev.some((e) => e.type === 'error'), JSON.stringify(ev.filter((e) => e.type === 'error'))).toBe(false);
      expect(h.minimax).toHaveLength(1);
      expect(h.minimax[0].frame).toBe(frameOf(n));
      expectPlainBody(h.minimax[0].prompt, n);
    }, 60_000);

    it('自然语言「改一镜」(editNote):在原分镜文字上合并,不是只按这句话重画', async () => {
      const { POST } = await import('@/app/api/projects/[id]/regenerate-shot/route');
      const ev = await events(await POST(jsonReq(`http://localhost/api/projects/${pid}/regenerate-shot`, {
        shotNumber: n, videoProvider: 'minimax', editNote: '改成清晨薄雾',
      }), params(pid)));
      expect(ev.map((e) => String(e.data?.message ?? '')).join('\n')).not.toContain('找不到这一镜的原描述');
      expect(h.minimax).toHaveLength(1);
      expectPlainBody(h.minimax[0].prompt, n);
      expect(h.minimax[0].prompt).toContain('清晨薄雾');
    }, 60_000);

    it('全局单镜重生(/api/regenerate-shot,视频节点 / 拉片表 / 审片走这条)', async () => {
      const { POST } = await import('@/app/api/regenerate-shot/route');
      const ev = await events(await POST(jsonReq('http://localhost/api/regenerate-shot', { projectId: pid, shotNumber: n, videoProvider: 'minimax' })));
      expect(ev.some((e) => e.type === 'error'), JSON.stringify(ev.filter((e) => e.type === 'error'))).toBe(false);
      expect(h.minimax).toHaveLength(1);
      expectPlainBody(h.minimax[0].prompt, n);
    }, 60_000);

    it('片段重拍(segment-retake)的补丁', async () => {
      const { POST } = await import('@/app/api/projects/[id]/segment-retake/route');
      const res = await POST(jsonReq(`http://localhost/api/projects/${pid}/segment-retake`, {
        shotNumber: n, fromS: 2, toS: 5, videoProvider: 'minimax',
      }), params(pid));
      expect(res.status, JSON.stringify(await res.clone().json())).toBe(200);
      expect(h.minimax).toHaveLength(1);
      expect(h.minimax[0].frame).toBe('https://cdn.example/cut.png'); // 确实是补丁这一路
      expectPlainBody(h.minimax[0].prompt, n);
    }, 60_000);

    it('4K 重渲:可灵收到的是分镜文字转成的纯文本,不是资产名', async () => {
      const { POST } = await import('@/app/api/projects/[id]/regenerate-shot-4k/route');
      const ev = await events(await POST(jsonReq(`http://localhost/api/projects/${pid}/regenerate-shot-4k`, { shotNumber: n }), params(pid)));
      expect(ev.find((e) => e.type === 'completed'), JSON.stringify(ev)).toBeTruthy();
      expect(h.kling4k).toHaveLength(1);
      expectPlainBody(h.kling4k[0], n);
      expect(h.kling4k[0]).not.toContain(`镜头 ${n}`);
    }, 60_000);
  });

  it('批量补渲失败镜头(failed-videos,force 全量):每镜都带自己的分镜文字', async () => {
    const { POST } = await import('@/app/api/regenerate-shot/route');
    const ev = await events(await POST(jsonReq('http://localhost/api/regenerate-shot', { projectId: pid, stage: 'failed-videos', force: true, videoProvider: 'minimax' })));
    expect(ev.find((e) => e.type === 'batchDone')?.data?.ok, JSON.stringify(ev.filter((e) => /error/i.test(e.type)))).toBe(2);
    for (const n of BOTH) expectPlainBody(h.minimax.find((c) => c.frame === frameOf(n))?.prompt, n);
  }, 60_000);

  it('九宫格选定之后(老 description 行 + 新 prompt 行):取最新行的读取方用的是新那行的文字', async () => {
    const regen = await import('@/app/api/projects/[id]/regenerate-shot/route');
    await events(await regen.POST(jsonReq(`http://localhost/api/projects/${pid}/regenerate-shot`, { shotNumber: 3, videoProvider: 'minimax' }), params(pid)));
    const k4 = await import('@/app/api/projects/[id]/regenerate-shot-4k/route');
    await events(await k4.POST(jsonReq(`http://localhost/api/projects/${pid}/regenerate-shot-4k`, { shotNumber: 3 }), params(pid)));
    expect(h.minimax).toHaveLength(1);
    expectPlainBody(h.minimax[0].prompt, 3);
    expectPlainBody(h.kling4k[0], 3);
    expect(h.minimax[0].prompt + h.kling4k[0]).not.toContain(OLD_SHOT3);
  }, 60_000);
});

describe('v13.9 · 整阶段重做视频 / Cameo 重画 / 视觉质检 / 导演审核', () => {
  it('整阶段重做视频(stage=video):交给 runVideoProducer 的每镜都带分镜文字', async () => {
    const { POST } = await import('@/app/api/regenerate-shot/route');
    await events(await POST(jsonReq('http://localhost/api/regenerate-shot', { projectId: pid, stage: 'video', videoProvider: 'minimax' })));
    for (const n of BOTH) {
      const b = h.producer.find((p) => p.shotNumber === n);
      expect(b?.prompt ?? '', `镜 ${n} 交给视频生产的提示词是空的`).toContain(SHOTS[n].body);
    }
  }, 60_000);

  it.each(BOTH)('Cameo 重画分镜图(镜 %i):MJ 按分镜文字重画,不是按「Shot N」', async (n) => {
    const { POST } = await import('@/app/api/projects/[id]/cameo-retry-storyboard/route');
    const res = await POST(jsonReq(`http://localhost/api/projects/${pid}/cameo-retry-storyboard`, { shotNumbers: [n] }), params(pid));
    expect(res.status, JSON.stringify(await res.clone().json())).toBe(200);
    expect(h.images).toHaveLength(1);
    expect(h.images[0]).toContain(SHOTS[n].body);
    expect(h.images[0]).not.toMatch(new RegExp(`^Shot ${n}\\b`));
  }, 60_000);

  it('视觉质检:每镜交给视觉模型的画面描述都不是空的', async () => {
    const { POST } = await import('@/app/api/projects/[id]/vision-audit/run/route');
    await POST(jsonReq(`http://localhost/api/projects/${pid}/vision-audit/run`, {}), params(pid));
    for (const n of BOTH) {
      expect(h.audits.find((a) => a.shotNumber === n)?.sceneDescription ?? '', `镜 ${n} 的画面描述是空的`).toContain(SHOTS[n].body);
    }
  }, 60_000);

  it('导演审核:交给模型的分镜摘要里每镜都有文字', async () => {
    const { POST } = await import('@/app/api/projects/[id]/director-review/route');
    await events(await POST(jsonReq(`http://localhost/api/projects/${pid}/director-review`, {}), params(pid)));
    expect(h.chats).toHaveLength(1);
    for (const n of BOTH) expect(h.chats[0]).toContain(`镜头${n}: ${SHOTS[n].body}`);
  }, 60_000);
});

describe('v13.9 · 续跑管线(lib/pipeline-checkpoints)', () => {
  it('视频阶段拿到每镜的分镜文字;分镜渲染阶段的回写不再把文字抹成空串', async () => {
    const rid = (await createProject({ userId: h.uid, title: '续跑', description: 'd', coverUrls: [] }) as { id: string }).id;
    await createAsset({ projectId: rid, type: 'plan', name: '导演计划', data: { title: 't', genre: '悬疑', characters: [], scenes: [], storyStructure: { totalShots: 3 } } });
    await createAsset({ projectId: rid, type: 'script', name: '剧本', data: { title: 't', synopsis: 's', shots: [1, 2, 3].map((n) => ({ shotNumber: n, duration: 5, sceneDescription: '', dialogue: '' })) } });
    await createAsset({ projectId: rid, type: 'styleBible', name: 'Style Bible', mediaUrls: ['https://cdn.example/bible.png'], data: { url: 'https://cdn.example/bible.png' } });
    await createAsset({ projectId: rid, type: 'character', name: '林晚', mediaUrls: ['https://cdn.example/char.png'], data: { description: '主角', appearance: '短发' } });
    await createAsset({ projectId: rid, type: 'scene', name: '巷口', mediaUrls: ['https://cdn.example/scene.png'], data: { description: '雨夜', location: '巷口' } });
    for (const n of [1, 2] as const) {
      await createAsset({ projectId: rid, type: 'storyboard', name: `镜头 ${n}`, shotNumber: n, mediaUrls: [frameOf(n)], data: SHOTS[n].data });
    }
    const old = await createAsset({ projectId: rid, type: 'storyboard', name: '镜头 3', shotNumber: 3, mediaUrls: ['https://cdn.example/sb-3-old.png'], data: { description: OLD_SHOT3 } }) as { id: string };
    db.prepare('UPDATE project_assets SET updated_at = ? WHERE id = ?').run('2026-01-01T00:00:00.000Z', old.id);
    await createAsset({ projectId: rid, type: 'storyboard', name: 'Shot 3(九宫格选定 c4)', shotNumber: 3, mediaUrls: [frameOf(3)], data: SHOTS[3].data });

    const { runCreatePipeline } = await import('@/lib/create-pipeline');
    await runCreatePipeline({ idea: '雨夜电台修理工追查三年前的火灾真相', projectId: rid, videoProvider: 'minimax' } as never, () => {}, { resume: true });

    for (const n of [1, 2, 3] as const) {
      const b = h.producer.find((p) => p.shotNumber === n);
      expect(b?.prompt ?? '', `续跑交给视频生产的镜 ${n} 是空串`).toContain(SHOTS[n].body);
    }
    const rows = db.prepare(`SELECT shot_number, data FROM project_assets WHERE project_id = ? AND type = 'storyboard'`).all(rid) as Array<{ shot_number: number; data: string }>;
    expect(rows).toHaveLength(4);
    for (const r of rows) expect(storyboardText(r.data), `镜 ${r.shot_number} 的一行分镜文字被回写成了空串`).not.toBe('');
  }, 120_000);
});

describe('v13.9 · 决策日志 / 素材标题 / 引擎对比工具', () => {
  it('决策日志:两种存法的镜都有提示词(原来只认 prompt)', async () => {
    const { buildDecisionLog } = await import('@/lib/decision-log');
    const log = buildDecisionLog({
      costRows: [],
      assets: [
        { type: 'storyboard', shot_number: 1, data: JSON.stringify(SHOTS[1].data) },
        { type: 'storyboard', shot_number: 2, data: JSON.stringify(SHOTS[2].data) },
      ],
    });
    expect(log.shots.find((s) => s.shotNumber === 1)?.prompt).toContain(SHOTS[1].body);
    expect(log.shots.find((s) => s.shotNumber === 2)?.prompt).toContain(SHOTS[2].body);
  });

  it('素材标题与出片侧同一判定:description 只有空白时退到 prompt', async () => {
    const { assetDisplayTitle } = await import('@/lib/asset-title');
    expect(assetDisplayTitle({ type: 'storyboard', name: '镜头 9', data: { description: '   ', prompt: '城墙上的旗被风扯成一条线' } }))
      .toContain('城墙上的旗');
  });

  it('两个字段都有时 description 优先(剧本里的分镜描述更完整;prompt 多半是给 MJ 出图写的那句)', () => {
    const both = { description: '老人在晨光里给盆栽浇水,水珠挂在叶尖', prompt: 'old man watering bonsai --ar 16:9 --no text' };
    expect(storyboardText(both)).toBe(both.description);
    expect(storyboardText(JSON.stringify(both)), 'data 是 JSON 字符串时同一判定').toBe(both.description);
  });

  it.each([['16:9', 'horizontal'], ['1:1', 'square'], ['9:16', 'vertical']])('video-compare:%s 的出图提示词写 %s(原来一律写 vertical)', async (aspect, word) => {
    h.mjOn = true;
    const { POST } = await import('@/app/api/tools/video-compare/route');
    const res = await POST(jsonReq('http://localhost/api/tools/video-compare', { idea: '一位老人在晨光里给盆栽浇水', aspect }));
    expect(res.status).toBe(422); // 假 MJ 记下提示词就失败,不进付费引擎
    expect(h.mj).toHaveLength(1);
    expect(h.mj[0]).toContain(`${word} ${aspect}`);
  });
});

describe('v13.9 · 可灵四个出口共用同一个 2450 字上限', () => {
  it('4K 与 Elements 多图参考的请求体也裁到上限(原来只有图生视频 / 首尾帧裁)', async () => {
    const { KlingService } = await vi.importActual<typeof import('@/services/kling.service')>('@/services/kling.service');
    const { KLING_PROMPT_MAX_CHARS } = await import('@/lib/kling-multishot');
    const bodies: Array<Record<string, unknown>> = [];
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => {
      bodies.push(JSON.parse(String(init?.body || '{}')));
      return new Response('nope', { status: 500 }); // 建任务就失败,不进轮询
    }));
    const k = new KlingService();
    (k as unknown as { apiKey: string }).apiKey = 'test-kling';
    const long = '镜'.repeat(3748); // 本机库最长的一条分镜文字
    await expect(k.regenerateShotAt4K('https://cdn.example/f.png', long)).rejects.toThrow(/500/);
    await expect(k.generateVideoWithElements(['https://cdn.example/a.png'], long)).rejects.toThrow();
    expect(bodies).toHaveLength(2);
    for (const b of bodies) expect(String(b.prompt).length).toBe(KLING_PROMPT_MAX_CHARS);
  });
});
