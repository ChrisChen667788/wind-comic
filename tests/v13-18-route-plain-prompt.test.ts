/**
 * v13.18 · 绕开注册表直调引擎的路由,用户写的提示词发出前转纯文本。
 *
 * 病:v12.472 / v13.9 收口的是「分镜提示词 → 视频引擎」,走编排器、视频注册表、图像注册表的都会转。
 * 但有几条路由**自己 new 引擎服务直接调**,提示词又来自请求体 —— 用户常把分镜出图的提示词整段贴进来
 * (`cinematic shot --ar 9:16 --no text --s 250`),修前原样发给 MiniMax / 可灵 / Vidu / Veo / fal Kontext。
 * 这几家画幅都走独立字段,没有一家定义 `--` 语法。护栏(checkAndSanitize)只查 PII 与注入、
 * 运镜增强(enhanceU2VMotionPrompt)只往后追加、试拍的 idea 清洗也不碰 `--`,一路都没人动它。
 * 2026-10-30 对抗复审点名 4K 重渲与 u2v(4K 已在 v13.9 修了,这里补上「用户自己传 prompt」那一侧);
 * 全仓排查又找出五条:u2v/stream、u2v-flf、preview-shot、tools/video-compare、regenerate-storyboard 的局部重绘。
 *
 * 门禁 video-prompt-must-be-plain 只认 `board.prompt` 直接传参,这些经变量中转的写法静态查不到,
 * 所以这里真跑路由,只把引擎换成记录入参的假服务:断言的是**引擎收到的提示词**,不是源码里出现过 toPlainPrompt。
 * 每条都同时断言用户写的正文还在、`--no X` 改写成了 `no X` —— 免得「发了个空串」也能满足「没有 --」。
 * MJ 语法用 /--[a-z]/i 判,不用 v12.472 的 /(^|\s)--[a-z]/:中文贴着 `--` 不打空格时(`雨夜街头--ar 9:16`)前面没有空白。
 */
import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';

const h = vi.hoisted(() => ({
  uid: 'u-v1318',
  calls: [] as Array<{ engine: string; prompt: string }>,
  klingFlfFails: false,
}));

vi.mock('@/lib/config', async (importOriginal) => {
  const m = await importOriginal<typeof import('@/lib/config')>();
  return {
    ...m,
    API_CONFIG: {
      ...m.API_CONFIG,
      minimax: { ...m.API_CONFIG.minimax, apiKey: 'test-minimax' },
      keling: { ...m.API_CONFIG.keling, apiKey: 'test-kling' },
      vidu: { ...m.API_CONFIG.vidu, apiKey: 'test-vidu' },
    },
  };
});
const OK = 'https://cdn.example/ok.mp4';
const rec = (engine: string, prompt: string) => { h.calls.push({ engine, prompt }); return OK; };
vi.mock('@/services/minimax.service', async (importOriginal) => {
  const m = await importOriginal<typeof import('@/services/minimax.service')>();
  class MinimaxService {
    async generateVideo(_frame: string, prompt: string) { return rec('minimax', prompt); }
  }
  return { ...m, MinimaxService };
});
vi.mock('@/services/kling.service', async (importOriginal) => {
  const m = await importOriginal<typeof import('@/services/kling.service')>();
  class KlingService {
    async generateVideo(_frame: string, prompt: string) { return rec('kling', prompt); }
    async generateFirstLastFrame(_first: string, _last: string, prompt: string) {
      if (h.klingFlfFails) throw new Error('kling-flf-down');
      return rec('kling-flf', prompt);
    }
    async regenerateShotAt4K(_frame: string, prompt: string) { return rec('kling-4k', prompt); }
  }
  return { ...m, KlingService, hasKling: () => true };
});
vi.mock('@/services/vidu.service', async (importOriginal) => {
  const m = await importOriginal<typeof import('@/services/vidu.service')>();
  class ViduService {
    lastModel = 'viduq3-pro';
    async generateVideo(_frame: string, prompt: string) { return rec('vidu', prompt); }
  }
  return { ...m, ViduService };
});
vi.mock('@/services/veo.service', async (importOriginal) => {
  const m = await importOriginal<typeof import('@/services/veo.service')>();
  class VeoService {
    async generateVideo(_frame: string, prompt: string) { return rec('veo', prompt); }
  }
  return { ...m, VeoService, hasVeo: () => true };
});
vi.mock('@/services/midjourney.service', async (importOriginal) => {
  const m = await importOriginal<typeof import('@/services/midjourney.service')>();
  // 试拍 / 引擎对比的首帧:MJ 认参数语法,出图这一步不在本版范围,只给一张图让后面的视频引擎跑起来
  class MidjourneyService {
    async generateImage(): Promise<string> { return 'https://cdn.example/frame.png'; }
  }
  return { ...m, MidjourneyService, hasMidjourney: () => true };
});
vi.mock('@/services/fal-flux.service', async (importOriginal) => {
  const m = await importOriginal<typeof import('@/services/fal-flux.service')>();
  class FalFluxService {
    async editImage(_base: string, prompt: string) { h.calls.push({ engine: 'fal-kontext', prompt }); return 'https://cdn.example/edited.png'; }
  }
  return { ...m, FalFluxService };
});
// 分镜重生:局部重绘成功就提前返回,编排器只需要能构造、能设参数;整张重生出图不在这里断言
vi.mock('@/services/hybrid-orchestrator', () => ({
  HybridOrchestrator: class {
    setUserStyle() {}
    setPrimaryCharacterRef() {}
    setAspect() {}
    async generateImage(prompt: string) { h.calls.push({ engine: 'orchestrator-image', prompt }); return 'https://cdn.example/full.png'; }
  },
}));
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
vi.mock('@/lib/paid-endpoint-guard', async (importOriginal) => {
  const m = await importOriginal<typeof import('@/lib/paid-endpoint-guard')>();
  return { ...m, guardPaidEndpoint: async () => ({ ok: true, userId: h.uid }) };
});
vi.mock('@/lib/budget-enforce', async (importOriginal) => {
  const m = await importOriginal<typeof import('@/lib/budget-enforce')>();
  return { ...m, assertBudget: async () => ({ allow: true, guard: {} }) };
});
vi.mock('@/lib/plan-gate', async (importOriginal) => {
  const m = await importOriginal<typeof import('@/lib/plan-gate')>();
  return { ...m, checkPlan: () => ({ ok: true, userId: h.uid, current: 'pro', required: 'pro' }) };
});

import { db, now } from '@/lib/db';
import { createAsset } from '@/lib/repos/asset-repo';

const MJ_SYNTAX = /--[a-z]/i;

/**
 * 两种真实写法:英文分镜提示词(参数在末尾、带 `--no`),和中文贴着 `--` 不打空格、参数夹在正文中间。
 * keep 是引擎收到的提示词里必须还在的东西(正文、`--no X` 改写成的 `no X`)。
 */
const INPUTS = [
  { name: '英文分镜提示词', text: 'cinematic shot of a girl turning back in the rain --ar 9:16 --no text --s 250', keep: ['cinematic shot of a girl turning back in the rain', 'no text'] },
  { name: '中文贴着 --', text: '雨夜街头--ar 9:16 她回头', keep: ['雨夜街头', '她回头'] },
] as const;

function expectPlain(engine: string, keep: readonly string[]) {
  const got = h.calls.filter((c) => c.engine === engine);
  expect(got, `${engine} 应被调用一次;实际调用:${JSON.stringify(h.calls.map((c) => c.engine))}`).toHaveLength(1);
  const p = got[0].prompt;
  expect(p, `${engine} 收到的提示词还有 MJ 参数语法`).not.toMatch(MJ_SYNTAX);
  for (const k of keep) expect(p, `${engine} 收到的提示词丢了「${k}」`).toContain(k);
  return p;
}

const post = (url: string, body: unknown) =>
  new Request(`http://localhost${url}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }) as any;
const params = (id: string) => ({ params: Promise.resolve({ id }) });

const T = Date.now();
const PID = `p1318-${T}`;

beforeAll(async () => {
  db.prepare(`INSERT OR IGNORE INTO users (id, email, password_hash, name, role, created_at) VALUES (?, ?, ?, ?, 'user', ?)`)
    .run(h.uid, 'u1318@test.local', 'x', 'u1318', now());
  db.prepare(`INSERT OR IGNORE INTO projects (id, user_id, title, status, aspect, created_at, updated_at) VALUES (?, ?, 'v13.18', 'draft', '9:16', ?, ?)`)
    .run(PID, h.uid, now(), now());
  await createAsset({
    projectId: PID, type: 'storyboard', name: '镜头 1', shotNumber: 1,
    data: { description: '码头俯拍两人隔着集装箱对峙 --ar 16:9 --no text' }, mediaUrls: ['https://cdn.example/sb1.png'],
  });
});

beforeEach(() => {
  h.calls.length = 0;
  h.klingFlfFails = false;
});

describe('v13.18 · 图生视频(/api/u2v):三档时长的引擎都收到纯文本', () => {
  for (const input of INPUTS) {
    for (const [duration, engine] of [[5, 'minimax'], [10, 'kling'], [15, 'vidu']] as const) {
      it(`${input.name} · ${duration}s → ${engine}`, async () => {
        const { POST } = await import('@/app/api/u2v/route');
        const res = await POST(post('/api/u2v', { imageUrl: 'https://cdn.example/still.png', prompt: input.text, duration }));
        expect(res.status, await res.clone().text()).toBe(200);
        expectPlain(engine, input.keep);
      });
    }
  }

  it('选了运镜预设:预设照常追加,正文仍是纯文本', async () => {
    const { POST } = await import('@/app/api/u2v/route');
    const res = await POST(post('/api/u2v', { imageUrl: 'https://cdn.example/still.png', prompt: INPUTS[1].text, duration: 5, cameraPreset: 'push-in' }));
    expect(res.status).toBe(200);
    const p = expectPlain('minimax', INPUTS[1].keep);
    expect(p.length, '运镜增强照常追加').toBeGreaterThan(INPUTS[1].text.length);
  });

  it('没有 MJ 语法的提示词:正文一字不改地打头(正常侧)', async () => {
    const plain = '她缓缓抬头看向窗外的雨';
    const { POST } = await import('@/app/api/u2v/route');
    const res = await POST(post('/api/u2v', { imageUrl: 'https://cdn.example/still.png', prompt: plain, duration: 5 }));
    expect(res.status).toBe(200);
    expect(expectPlain('minimax', [plain]).startsWith(plain)).toBe(true);
  });
});

describe('v13.18 · 图生视频 SSE 版(/api/u2v/stream)', () => {
  for (const input of INPUTS) {
    it(`${input.name} → minimax`, async () => {
      const { POST } = await import('@/app/api/u2v/stream/route');
      const res = await POST(post('/api/u2v/stream', { imageUrl: 'https://cdn.example/still.png', prompt: input.text, duration: 5 }));
      const sse = await res.text();
      expect(sse, '流里应有完成事件').toContain(OK);
      expectPlain('minimax', input.keep);
    });
  }
});

describe('v13.18 · 首尾帧(/api/u2v-flf)', () => {
  for (const input of INPUTS) {
    it(`${input.name} → 可灵首尾帧`, async () => {
      const { POST } = await import('@/app/api/u2v-flf/route');
      const res = await POST(post('/api/u2v-flf', { firstFrameUrl: 'https://cdn.example/a.png', lastFrameUrl: 'https://cdn.example/b.png', prompt: input.text }));
      expect(res.status, await res.clone().text()).toBe(200);
      expectPlain('kling-flf', input.keep);
    });
  }

  it('可灵失败退到 MiniMax 单图:兜底收到的也是纯文本', async () => {
    h.klingFlfFails = true;
    const { POST } = await import('@/app/api/u2v-flf/route');
    const res = await POST(post('/api/u2v-flf', { firstFrameUrl: 'https://cdn.example/a.png', lastFrameUrl: 'https://cdn.example/b.png', prompt: INPUTS[1].text }));
    expect(res.status).toBe(200);
    expectPlain('minimax', INPUTS[1].keep);
  });
});

describe('v13.18 · 试拍(/api/preview-shot)的视频段', () => {
  for (const input of INPUTS) {
    it(`${input.name} → minimax`, async () => {
      const { POST } = await import('@/app/api/preview-shot/route');
      const res = await POST(post('/api/preview-shot', { idea: input.text, aspect: '9:16' }));
      expect(res.status, await res.clone().text()).toBe(200);
      expectPlain('minimax', input.keep);
    });
  }

  it('**先转用户的 idea 再拼模板**:`--no` 不会吞掉模板里逗号隔开的词', async () => {
    // 拼好再转:`girl --no text, cinematic style, 9:16 aspect ratio, …` 会被改写成「no cinematic style, no 9:16 aspect ratio」
    const { POST } = await import('@/app/api/preview-shot/route');
    const res = await POST(post('/api/preview-shot', { idea: 'a girl walks through the night market --no text', aspect: '9:16' }));
    expect(res.status).toBe(200);
    const p = expectPlain('minimax', ['a girl walks through the night market', 'no text', 'cinematic style', '9:16 aspect ratio']);
    expect(p).not.toMatch(/no (cinematic style|9:16 aspect ratio|professional cinematography)/);
  });
});

describe('v13.18 · 引擎对比工具(/api/tools/video-compare)', () => {
  for (const input of INPUTS) {
    it(`${input.name} → Veo / MiniMax / 可灵`, async () => {
      const { POST } = await import('@/app/api/tools/video-compare/route');
      const res = await POST(post('/api/tools/video-compare', { idea: input.text, aspect: '9:16', providers: ['veo', 'minimax', 'kling'] }));
      expect(res.status, await res.clone().text()).toBe(200);
      for (const engine of ['veo', 'minimax', 'kling']) expectPlain(engine, input.keep);
    });
  }

  it('**style 也是用户写的**:先转再拼,`--no blur` 不会把后面的「vertical 9:16」改写成「no vertical 9:16」', async () => {
    const { POST } = await import('@/app/api/tools/video-compare/route');
    const res = await POST(post('/api/tools/video-compare', { idea: '雨夜街头她回头看向镜头', style: 'film noir --no blur', aspect: '9:16', providers: ['minimax'] }));
    expect(res.status).toBe(200);
    const p = expectPlain('minimax', ['雨夜街头她回头看向镜头', 'film noir', 'no blur', 'vertical 9:16']);
    expect(p).not.toContain('no vertical');
  });
});

describe('v13.18 · 分镜重生的局部重绘(fal Kontext 不走图像注册表)', () => {
  const regen = async (body: Record<string, unknown>) => {
    const { POST } = await import('@/app/api/projects/[id]/regenerate-storyboard/route');
    const res = await POST(post(`/api/projects/${PID}/regenerate-storyboard`, { shotNumber: 1, ...body }), params(PID));
    return res.text();
  };
  const repair = { baseImageUrl: 'https://cdn.example/sb1.png', score: 72, weakestDimension: 'composition' };

  for (const input of INPUTS) {
    it(`没给 focusHint、拿出图提示词兜底:${input.name}`, async () => {
      const sse = await regen({ customPrompt: input.text, repair });
      expect(sse, '应走局部重绘并完成').toContain('"mode":"edit"');
      expectPlain('fal-kontext', input.keep);
    });
  }

  it('给了 focusHint(审片建议)也一样转', async () => {
    // `--no` 前要有空格:v13.14 起中文紧贴的 `--no …` 留作正文(`雨夜--no way out` 是一句话),只有类型明确的 `--ar 9:16` 这类紧贴才认
    const sse = await regen({ customPrompt: 'a rainy street at night, cinematic', repair: { ...repair, focusHint: '把她的手从口袋里拿出来 --no gloves --ar 16:9' } });
    expect(sse).toContain('"mode":"edit"');
    expectPlain('fal-kontext', ['把她的手从口袋里拿出来', 'no gloves']);
  });
});

describe('v13.18 · 4K 重渲(用户自己传 prompt 的一侧;库里分镜文字那一侧由 v13-9 守)', () => {
  for (const input of INPUTS) {
    it(`${input.name} → 可灵 4K`, async () => {
      const { POST } = await import('@/app/api/projects/[id]/regenerate-shot-4k/route');
      const res = await POST(post(`/api/projects/${PID}/regenerate-shot-4k`, { shotNumber: 1, prompt: input.text }), params(PID));
      const sse = await res.text();
      expect(sse, '流里应有完成事件').toContain('"type":"completed"');
      const p = expectPlain('kling-4k', input.keep);
      expect(p, '传了 prompt 就用它,不该回落到库里的分镜文字').not.toContain('码头俯拍');
    });
  }
});

describe('v13.18 · 门禁 route-engine-call-must-be-registered', () => {
  const ID = 'route-engine-call-must-be-registered';
  const load = async () => {
    const { CONTRACTS } = await import('@/lib/consumer-gate/contracts');
    const c = CONTRACTS.find((x) => x.id === ID);
    expect(c, '契约在表里').toBeTruthy();
    return c!;
  };
  /** 与 scan.ts 同一判法:剥注释后逐行匹配 */
  const hits = async (src: string) => {
    const { stripComments } = await import('@/lib/consumer-gate/scan');
    const c = await load();
    return stripComments(src).split('\n').filter((l) => new RegExp(c.forbid.source, c.forbid.flags.replace('g', '')).test(l));
  };

  it('登记的每个文件今天确实直调了引擎(白名单不是空头支票,也没烂掉)', async () => {
    const fs = await import('node:fs');
    const c = await load();
    expect(c.allow.length).toBeGreaterThanOrEqual(6);
    for (const a of c.allow) {
      expect(fs.existsSync(a.file), a.file).toBe(true);
      expect((await hits(fs.readFileSync(a.file, 'utf-8'))).length, `${a.file} 没有命中 —— 已改走注册表就该从白名单删掉`).toBeGreaterThan(0);
    }
  });

  it('**新路由自己 new 引擎直调:门禁当场报出来**(反面);写在注释里的不算(正面)', async () => {
    const fs = await import('node:fs');
    const os = await import('node:os');
    const path = await import('node:path');
    const { runConsumerGate } = await import('@/lib/consumer-gate/scan');
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'v1318-gate-'));
    try {
      const dir = path.join(root, 'app/api/new-thing');
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, 'route.ts'), [
        "import { MinimaxService } from '@/services/minimax.service';",
        'export async function POST(req: Request) {',
        '  const body = await req.json();',
        '  // 注释里提到 svc.generateVideo(img, body.prompt) 不算',
        '  const text = body.prompt.trim();',
        "  return new MinimaxService().generateVideo('https://x/a.png', text, { duration: 5 });",
        '}',
      ].join('\n'));
      const v = runConsumerGate(root).filter((x) => x.contractId === ID);
      expect(v.map((x) => `${x.file}:${x.line}`)).toEqual(['app/api/new-thing/route.ts:6']);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('首尾帧 / 4K / 局部重绘这几个方法名也拦', async () => {
    for (const line of ['k.generateFirstLastFrame(a, b, p)', 'await k.regenerateShotAt4K(img, p, {})', 'new FalFluxService().editImage(u, p)', 'vd.generateVideoWithElements(refs, p)']) {
      expect(await hits(line), line).toHaveLength(1);
    }
    expect(await hits('orchestrator.regenerateShot(n, sb, {})'), '编排器入口不拦').toHaveLength(0);
  });
});
