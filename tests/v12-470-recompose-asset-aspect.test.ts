/**
 * v12.470 · 重合成成片 / 场景图重生按项目画幅。
 *
 * 与 v12.467(出片入口不读 projects.aspect)同病,但不属出片生成,留到这一版:
 *
 * 1. recompose 请求不带 aspect 时缺省写死 16:9。对话式编辑(/dashboard/edit-chat)把
 *    `planExecution` 出的 `plan.recompose` 原样 POST,而它只在「改画幅」意图时才写 aspect ——
 *    9:16 项目只说「删掉第 2 镜」,成片就被按 16:9 重合成:竖屏素材塞进横屏画布,左右补黑边。
 * 2. 场景图重生写死 16:9。整片管线的场景设计用的是项目画幅,项目页也按项目画幅框场景图;
 *    本机 9:16 项目里还在盘上的 17 张场景图全是这里重生出的 1344x768。
 *
 * 路由都**真跑**:真测试库里建 9:16 / 16:9 两个项目做对照,只把合成器和出图引擎换成记录入参的假实现
 * —— 断言的是合成器 / 引擎**收到**的画幅,以及落库的成片记录。
 */
import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';

const h = vi.hoisted(() => ({
  uid: 'u-v12470',
  composed: [] as Array<{ aspect?: string; clips: number }>,
  cards: [] as Array<{ w: number; h: number }>,
  images: [] as Array<{ prompt: string; aspectRatio?: string; sref?: string }>,
}));

vi.mock('@/app/api/auth/lib', async (importOriginal) => {
  const m = await importOriginal<typeof import('@/app/api/auth/lib')>();
  return { ...m, getUserFromRequest: () => ({ sub: h.uid }) };
});
vi.mock('@/lib/budget-enforce', async (importOriginal) => {
  const m = await importOriginal<typeof import('@/lib/budget-enforce')>();
  return { ...m, assertBudget: async () => ({ allow: true, guard: {} }) };
});
vi.mock('@/lib/asset-storage', async (importOriginal) => {
  const m = await importOriginal<typeof import('@/lib/asset-storage')>();
  return { ...m, persistAsset: async (u: string) => ({ url: u }) };
});
// 合成器:记下画幅,不真跑 ffmpeg(合成本身由 v12.49 / v12.374 等用例守着)
vi.mock('@/services/video-composer', async (importOriginal) => {
  const m = await importOriginal<typeof import('@/services/video-composer')>();
  return {
    ...m,
    composeVideo: async (opts: { aspect?: string; clips: unknown[] }) => {
      h.composed.push({ aspect: opts.aspect, clips: opts.clips.length });
      return { outputPath: '/tmp/qf-v12470-final.mp4', totalDuration: 8, hasMusic: false, hasVoiceover: false, renderedTransitions: [] };
    },
    appendEndCard: async (p: string, o: { w: number; h: number }) => { h.cards.push({ w: o.w, h: o.h }); return { outputPath: p, appended: true }; },
    prependHookCard: async (p: string, o: { w: number; h: number }) => { h.cards.push({ w: o.w, h: o.h }); return { outputPath: p, appended: true }; },
  };
});
// 出图:内置引擎换成一个记录入参的假引擎,注册表的选路照常真跑
vi.mock('@/lib/image-providers/builtins', async () => {
  const reg = await import('@/lib/image-providers/registry');
  reg.registerImageProvider({
    id: 'rec-v12470', name: 'recorder', supportsRefs: true, maxRefImages: 8, priority: -1000,
    available: () => true,
    generate: async (input) => {
      h.images.push({ prompt: input.prompt, aspectRatio: input.aspectRatio, sref: input.sref });
      return { imageUrl: 'https://cdn.example/regen.png', provider: 'rec-v12470' };
    },
  });
  return {};
});

import { db, now } from '@/lib/db';
import { createProject } from '@/lib/repos/project-repo';
import { createAsset, listAssetsByType } from '@/lib/repos/asset-repo';
import { planExecution } from '@/lib/edit-intent-execute';

type Aspect = '9:16' | '16:9';
const ASPECTS: Aspect[] = ['9:16', '16:9'];
const OTHER: Record<Aspect, Aspect> = { '9:16': '16:9', '16:9': '9:16' };
const DIMS: Record<string, { width: number; height: number }> = {
  '9:16': { width: 720, height: 1280 },
  '16:9': { width: 1280, height: 720 },
};
const projects: Record<Aspect, string> = { '9:16': '', '16:9': '' };

async function seedProject(aspect: Aspect): Promise<string> {
  const pid = (await createProject({ userId: h.uid, title: `画幅 ${aspect}`, description: 'd', coverUrls: [] }) as { id: string }).id;
  db.prepare('UPDATE projects SET aspect = ? WHERE id = ?').run(aspect, pid);
  for (const n of [1, 2, 3]) {
    await createAsset({
      projectId: pid, type: 'video', name: `视频 ${n}`, shotNumber: n,
      mediaUrls: [`https://cdn.example/${n}.mp4`], persistentUrl: `https://cdn.example/${n}.mp4`, data: { duration: 3 },
    });
  }
  await createAsset({ projectId: pid, type: 'scene', name: '旧仓库', data: { description: '堆满木箱的旧仓库', location: '旧仓库' }, mediaUrls: ['https://cdn.example/scene.png'] });
  await createAsset({ projectId: pid, type: 'character', name: '阿青', data: { description: '少女', appearance: '短发,青色外套' }, mediaUrls: ['https://cdn.example/char.png'] });
  await createAsset({ projectId: pid, type: 'styleBible', name: '风格', data: {}, mediaUrls: ['https://cdn.example/bible.png'], persistentUrl: 'https://cdn.example/bible.png' });
  return pid;
}

beforeAll(async () => {
  db.prepare(`INSERT OR IGNORE INTO users (id, email, password_hash, name, role, created_at) VALUES (?, ?, ?, ?, 'user', ?)`)
    .run(h.uid, `${h.uid}@test.local`, 'x', '画幅', now());
  projects['9:16'] = await seedProject('9:16');
  projects['16:9'] = await seedProject('16:9');
});
beforeEach(() => { h.composed.length = 0; h.cards.length = 0; h.images.length = 0; });

const jsonReq = (url: string, body: unknown) => new Request(url, {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
}) as any;
const params = (id: string) => ({ params: Promise.resolve({ id }) });

async function recompose(pid: string, body: unknown) {
  const { POST } = await import('@/app/api/projects/[id]/recompose/route');
  const res = await POST(jsonReq(`http://localhost/api/projects/${pid}/recompose`, body), params(pid));
  const json = await res.json();
  expect(res.status, JSON.stringify(json)).toBe(200);
  return json;
}

async function finalVideoData(pid: string) {
  const rows = await listAssetsByType(pid, 'final_video');
  expect(rows).toHaveLength(1);
  return JSON.parse(rows[0].data || '{}');
}

describe('v12.470 · 重合成成片按项目画幅', () => {
  describe.each(ASPECTS)('%s 项目', (aspect) => {
    const pid = () => projects[aspect];

    it('对话式编辑只删一镜(计划里没有 aspect)→ 按项目画幅重合成,成片记录与之一致', async () => {
      const plan = planExecution([{ op: 'dropShot', shotNumber: 2 }]);
      expect(plan.recompose && 'aspect' in plan.recompose, '前提:删镜意图本来就不带画幅').toBe(false);
      const json = await recompose(pid(), plan.recompose); // edit-chat 页就是这样原样 POST 的
      expect(h.composed).toEqual([{ aspect, clips: 2 }]);
      expect({ width: json.width, height: json.height }).toEqual(DIMS[aspect]);
      const fv = await finalVideoData(pid());
      expect(fv.aspect).toBe(aspect);
      expect({ width: fv.width, height: fv.height }).toEqual(DIMS[aspect]);
    });

    it('只换字幕风格 + 加片尾卡:卡也按项目画幅的尺寸出', async () => {
      const plan = planExecution([{ op: 'setCaptionStyle', value: 'karaoke' }]);
      await recompose(pid(), { ...plan.recompose, endCard: { title: '下集见' } });
      expect(h.composed[0].aspect).toBe(aspect);
      expect(h.cards).toEqual([{ w: DIMS[aspect].width, h: DIMS[aspect].height }]);
    });

    it('明确要求换画幅时仍以请求为准(改画幅意图不能被项目画幅顶掉)', async () => {
      const plan = planExecution([{ op: 'setAspect', value: OTHER[aspect] }]);
      await recompose(pid(), plan.recompose);
      expect(h.composed[0].aspect).toBe(OTHER[aspect]);
      expect((await finalVideoData(pid())).aspect).toBe(OTHER[aspect]);
    });

    it('请求里的画幅认不出(空串 / 非比例)→ 按项目画幅,不再落到 16:9', async () => {
      for (const bad of ['', 'vertical', 916]) {
        h.composed.length = 0;
        await recompose(pid(), { aspect: bad });
        expect(h.composed[0].aspect, `aspect=${JSON.stringify(bad)}`).toBe(aspect);
      }
    });
  });

  it('引擎出不了的比例按横竖就近归档,成片记录写实际画幅(原来照记 2.35:1、画布却是 1280x720)', async () => {
    const pid = projects['9:16'];
    await recompose(pid, { aspect: '2.35:1' });
    expect(h.composed[0].aspect).toBe('16:9');
    const fv = await finalVideoData(pid);
    expect(fv.aspect).toBe('16:9');
    expect({ width: fv.width, height: fv.height }).toEqual(DIMS['16:9']);
  });
});

describe('v12.470 · 广告包装车间:画幅可选,不选就跟随项目(原写死 9:16)', () => {
  /** ad-workshop 经 fetch 打本站接口:recompose 转给真路由,其余三步给个空壳 */
  async function workshop(pid: string, body: unknown) {
    const recomposeRoute = await import('@/app/api/projects/[id]/recompose/route');
    const sent: Array<Record<string, unknown>> = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      if (String(url).endsWith(`/api/projects/${pid}/recompose`)) {
        sent.push(JSON.parse(String(init?.body || '{}')));
        return recomposeRoute.POST(jsonReq(String(url), JSON.parse(String(init?.body || '{}'))), params(pid));
      }
      const stub = String(url).includes('hook-ideas') ? { ok: true, hooks: ['钩子一', '钩子二'] } : { ok: true };
      return new Response(JSON.stringify(stub), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }));
    try {
      const { POST } = await import('@/app/api/projects/[id]/ad-workshop/route');
      const res = await POST(jsonReq(`http://localhost/api/projects/${pid}/ad-workshop`, body), params(pid));
      return { json: await res.json(), sent };
    } finally {
      vi.unstubAllGlobals();
    }
  }

  describe.each(ASPECTS)('%s 项目', (aspect) => {
    it('不选画幅(导演控制台默认「跟随项目」)→ 按项目画幅包装,结果里回报实际画幅', async () => {
      const { json, sent } = await workshop(projects[aspect], { platform: 'douyin' });
      expect(json.steps.recompose, JSON.stringify(json.steps.recompose)).toMatchObject({ ok: true, aspect });
      expect('aspect' in sent[0], '画幅只在 recompose 一处解析,车间不再自带缺省').toBe(false);
      expect(h.composed.map((c) => c.aspect)).toEqual([aspect]);
      // Hook 卡与变体卡都按成片尺寸出
      expect(new Set(h.cards.map((c) => `${c.w}x${c.h}`))).toEqual(new Set([`${DIMS[aspect].width}x${DIMS[aspect].height}`]));
    });

    it('选了别的画幅 → 按所选出片', async () => {
      const { json } = await workshop(projects[aspect], { platform: 'douyin', aspect: OTHER[aspect] });
      expect(json.steps.recompose.aspect).toBe(OTHER[aspect]);
      expect(h.composed.map((c) => c.aspect)).toEqual([OTHER[aspect]]);
    });
  });
});

describe('v12.470 · 场景图重生按项目画幅,角色图保持竖构图', () => {
  async function regen(pid: string, body: { type: 'scene' | 'character'; name: string }) {
    const { POST } = await import('@/app/api/projects/[id]/regenerate-asset-image/route');
    const res = await POST(jsonReq(`http://localhost/api/projects/${pid}/regenerate-asset-image`, body), params(pid));
    const json = await res.json();
    expect(res.status, JSON.stringify(json)).toBe(200);
    return json;
  }

  describe.each(ASPECTS)('%s 项目', (aspect) => {
    it('流水线画布场景节点的「重生」(只发 type + name)→ 引擎收到项目画幅', async () => {
      const json = await regen(projects[aspect], { type: 'scene', name: '旧仓库' }); // components/nodes/scene-node.tsx 的请求体
      expect(json.imageUrl).toBe('https://cdn.example/regen.png');
      expect(h.images).toHaveLength(1);
      expect(h.images[0].prompt).toContain('旧仓库'); // 确是场景这一路
      expect(h.images[0].sref).toBe('https://cdn.example/bible.png');
      expect(h.images[0].aspectRatio).toBe(aspect);
    });

    it('角色图重生不跟项目画幅,两种项目都是 3:4(项目页按竖构图框角色)', async () => {
      await regen(projects[aspect], { type: 'character', name: '阿青' });
      expect(h.images).toHaveLength(1);
      expect(h.images[0].aspectRatio).toBe('3:4');
    });
  });
});
