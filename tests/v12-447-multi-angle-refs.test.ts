/**
 * v12.447 —— 多角度角色参考图:把一条**全程被剥**的链路接通,并且不许静默丢图。
 *
 * 装配层(lib/elements-registry)从 v12.12 起就会读 `refs` 并产出 `reference_image_urls`,
 * 可灵 service 也早就接了 —— 但**两道白名单**(lib/locked-characters 与 orchestrator.setLockedCharacters)
 * 只放行 name/role/cw/imageUrl/traits,于是角色的角度图永远到不了出片端:
 * 造好没接线,本仓最顽固的一类毛病(v12.438 的链路调研逐跳记过账)。
 *
 * 这里每一跳都真跑,而不是断言源码里出现过 `refs`。
 */
import { describe, it, expect, beforeAll, vi } from 'vitest';
import { sanitizeLockedCharacters, MAX_ANGLE_REFS, angleRefUrls, findAngleRefs } from '@/lib/locked-characters';
import { buildElementsRegistry, subjectReferencesFromMount, toKlingElements, type ElementsRegistry } from '@/lib/elements-registry';
import { refUsageFor, perCharacterCapacity } from '@/lib/ref-capability';

// 编排器模块很大,首次加载在负载下会超过单条测试的时限(实测 10s 超时)—— 统一在这里付掉,
// 后面各条里的 `await import(...)` 都命中缓存。
beforeAll(async () => { await import('@/services/hybrid-orchestrator'); }, 120000);

const FRONT = 'https://cdn.example/front.png';
const SIDE = 'https://cdn.example/side.png';
const BACK = 'https://cdn.example/back.png';
const TQ = 'https://cdn.example/tq.png';

describe('v12.447 · 第一道白名单(sanitizeLockedCharacters)', () => {
  const one = (refs: unknown) => sanitizeLockedCharacters([{ name: '林晚', role: 'lead', cw: 125, imageUrl: FRONT, refs }])[0];

  it('放行合法角度图,并归一化角色标签', () => {
    const c = one([{ role: 'side', url: SIDE }, { role: 'three_quarter', url: TQ }]);
    expect(c.refs).toEqual([{ role: 'side', url: SIDE }, { role: 'three_quarter', url: TQ }]);
  });

  it('脏值不进:非 http、与正面图重复、彼此重复、非数组', () => {
    expect(one([{ role: 'side', url: 'javascript:alert(1)' }])?.refs).toBeUndefined();
    expect(one([{ role: 'side', url: FRONT }])?.refs, '与正面图同一张不算角度图').toBeUndefined();
    expect(one([{ role: 'side', url: SIDE }, { role: 'detail', url: SIDE }])?.refs).toHaveLength(1);
    expect(one('not-an-array')?.refs).toBeUndefined();
    expect(one(undefined)?.refs, '没传就是没有(旧数据零影响)').toBeUndefined();
  });

  it('不认识的角色标签归到 detail 而不是把图丢掉(用户传了图却整张消失更糟)', () => {
    expect(one([{ role: 'weird', url: SIDE }])!.refs).toEqual([{ role: 'detail', url: SIDE }]);
  });

  it(`每角色最多 ${MAX_ANGLE_REFS} 张(与可灵 1 正面 + 3 参考同口径)`, () => {
    const many = Array.from({ length: 6 }, (_, i) => ({ role: 'side', url: `https://cdn.example/a${i}.png` }));
    expect(one(many)!.refs).toHaveLength(MAX_ANGLE_REFS);
  });
});

describe('v12.447 · 第二道白名单 + 装配层(真跑,不看源码)', () => {
  /** 真调 orchestrator.setLockedCharacters —— 模拟它的白名单语义等于没测它 */
  const throughOrchestrator = async (list: ReturnType<typeof sanitizeLockedCharacters>) => {
    const { HybridOrchestrator } = await import('@/services/hybrid-orchestrator');
    const self: any = {};
    (HybridOrchestrator.prototype as any).setLockedCharacters.call(self, list);
    return self.lockedCharacters as Array<Record<string, unknown>>;
  };

  it('角度图穿过两道白名单后进得了元素注册表,并产出 reference_image_urls', async () => {
    const sanitized = sanitizeLockedCharacters([
      { name: '林晚', role: 'lead', cw: 125, imageUrl: FRONT, refs: [{ role: 'side', url: SIDE }, { role: 'detail', url: BACK }] },
    ]);
    const locked = await throughOrchestrator(sanitized);
    expect((locked[0] as any).refs).toHaveLength(2);

    const reg: ElementsRegistry = buildElementsRegistry({
      characters: [{ name: '林晚', appearance: '白衬衫', imageUrl: FRONT, refs: (locked[0] as any).refs }],
    });
    const el = reg['@人物{林晚}'];
    expect(el, '角色应进注册表').toBeTruthy();
    expect(el.assets.length, '正面图 + 两张角度图').toBe(3);

    const mount = { characters: [el], scene: undefined, props: [] } as any;
    const subj = subjectReferencesFromMount(mount);
    expect(subj[0].imageUrl).toBe(FRONT);
    expect(subj[0].refImageUrls.sort()).toEqual([BACK, SIDE].sort());

    const kling = toKlingElements(mount);
    expect(kling.elements[0].frontal_image_url).toBe(FRONT);
    expect(kling.elements[0].reference_image_urls.sort()).toEqual([BACK, SIDE].sort());
  });

  it('没有角度图时与修前完全一样(只有一张正面图)', () => {
    const reg = buildElementsRegistry({ characters: [{ name: '林晚', imageUrl: FRONT }] });
    const mount = { characters: [reg['@人物{林晚}']], scene: undefined, props: [] } as any;
    expect(subjectReferencesFromMount(mount)[0].refImageUrls).toEqual([]);
    expect(toKlingElements(mount).elements[0].reference_image_urls).toEqual([]);
  });
});

describe('v12.447 · 引擎吃不下的必须说出来', () => {
  it('可灵:未开 Elements 每角色只发 1 张,如实报出忽略了几张', () => {
    expect(perCharacterCapacity('kling', {})).toBe(1);
    expect(perCharacterCapacity('kling', { KLING_ELEMENTS: '1' })).toBe(4);
    const off = refUsageFor('kling', [3], {});
    expect(off.used).toBe(1);
    expect(off.dropped).toBe(3);
    expect(off.reason).toContain('KLING_ELEMENTS=1');
    const on = refUsageFor('kling', [3], { KLING_ELEMENTS: '1' });
    expect(on.dropped).toBe(0);
    expect(on.used).toBe(4);
  });

  it('MiniMax 旧接口:S2V-01 默认只锁第 1 个角色、1 张正面;原因里点明 H3 能收 9 张', () => {
    // v12.448 更正:此前断言「两个角色各 1 张」(used=2)—— 锁的是错行为。S2V-01 默认只锁第 1 个角色
    // (MINIMAX_S2V_MAX_SUBJECTS 不设 = 1,v12.9.0 的既定取舍),第 2 个角色连正面图都不发。
    const u = refUsageFor('minimax', [2, 1], {});
    expect(u.used).toBe(1);         // 只有第 1 个角色的正面图发出去
    expect(u.unlocked).toBe(1);     // 第 2 个角色没被锁
    expect(u.dropped).toBe(3);      // 3 张角度图被忽略(只数角度图)
    expect(u.reason).toContain('只锁第 1 个角色');
    expect(u.reason).toContain('另有 1 个角色没被锁');
    // 显式放开到 2 个主体:两个角色各发 1 张正面
    const two = refUsageFor('minimax', [2, 1], { MINIMAX_S2V_MAX_SUBJECTS: '2' });
    expect(two.used).toBe(2);
    expect(two.unlocked).toBe(0);
    expect(two.dropped).toBe(3);
    expect(u.reason).toContain('H3');
    // 不能让人以为换个套餐就行:H3 只走按量付费(2026-09-18 核实)
    expect(u.reason).toContain('按量付费');
  });

  it('没有角度图时不报(别制造噪音)', () => {
    expect(refUsageFor('minimax', [0, 0], {}).dropped).toBe(0);
    expect(refUsageFor('kling', [], {}).dropped).toBe(0);
  });

  it('reportRefUsage 真跑:该报时报、不该报时闭嘴(不是只看源码里有这个函数)', async () => {
    const { HybridOrchestrator } = await import('@/services/hybrid-orchestrator');
    const call = (engine: string, subjects: any[]) => {
      const events: any[] = [];
      const self: any = { emit: (n: string, p: unknown) => events.push([n, p]) };
      (HybridOrchestrator.prototype as any).reportRefUsage.call(self, engine, subjects, 7);
      return events;
    };
    const dropped = call('minimax', [{ refImageUrls: [SIDE, BACK] }]);
    expect(dropped).toHaveLength(1);
    expect(dropped[0][0]).toBe('refUsage');
    expect(dropped[0][1]).toMatchObject({ shotNumber: 7, engine: 'minimax', dropped: 2 });

    expect(call('minimax', [{ refImageUrls: [] }]), '没有角度图就别报').toHaveLength(0);
    expect(call('kling', []), '没有角色就别报').toHaveLength(0);
  });

  it('两条出片路径都在发给引擎前报(扫源码前先去掉注释,免得被注释掉的调用糊弄)', () => {
    const raw = require('node:fs').readFileSync('services/hybrid-orchestrator.ts', 'utf-8') as string;
    const code = raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
    const calls = [...code.matchAll(/this\.reportRefUsage\('(\w+)'/g)].map((m) => m[1]);
    expect(new Set(calls), 'minimax 与 kling 两条路径都要报').toEqual(new Set(['minimax', 'kling']));
  });
});

describe('v12.447 · 编排器共用的取图助手', () => {
  it('angleRefUrls 只放行 http(s) —— 绕过净化写进库的老数据里混着 data:/相对路径也不能发给引擎', () => {
    expect(angleRefUrls([{ url: 'data:image/png;base64,xx' }, { url: SIDE }, { url: '/api/serve-file?key=a' }, { url: 42 }, {}])).toEqual([SIDE]);
    expect(angleRefUrls(undefined)).toEqual([]);
  });
  it('findAngleRefs 按名字取,不会张冠李戴;没有就是 undefined', () => {
    const locked = [
      { name: '林晚', refs: [{ role: 'side', url: SIDE }] },
      { name: '陆沉' },
      { name: '墨七', refs: [] },
    ];
    expect(findAngleRefs(locked, '林晚')).toEqual([{ role: 'side', url: SIDE }]);
    expect(findAngleRefs(locked, '陆沉'), '陆沉没有角度图,不能拿到林晚的').toBeUndefined();
    expect(findAngleRefs(locked, '墨七'), '空数组按「没有」算').toBeUndefined();
    expect(findAngleRefs(locked, '不存在')).toBeUndefined();
  });
});

describe('v12.447 · 单镜重生也带角度图(修前只给一张正面图)', () => {
  it('getLockedSubjectReferences 输出 refImageUrls', async () => {
    const { HybridOrchestrator } = await import('@/services/hybrid-orchestrator');
    const fake: any = { lockedCharacters: [
      { name: '林晚', role: 'lead', cw: 125, imageUrl: FRONT, refs: [{ role: 'side', url: SIDE }] },
      { name: '陆沉', role: 'antagonist', cw: 125, imageUrl: 'https://cdn.example/b.png' },
    ] };
    const out = (HybridOrchestrator.prototype as any).getLockedSubjectReferences.call(fake);
    expect(out[0].refImageUrls).toEqual([SIDE]);
    // 绕过净化写进库的老数据:非 http 的角度图不能发给引擎
    const legacy: any = { lockedCharacters: [{ name: '林晚', role: 'lead', cw: 125, imageUrl: FRONT, refs: [{ role: 'side', url: 'data:image/png;base64,xx' }, { role: 'detail', url: BACK }] }] };
    expect((HybridOrchestrator.prototype as any).getLockedSubjectReferences.call(legacy)[0].refImageUrls).toEqual([BACK]);
    expect('refImageUrls' in out[1], '没有角度图的角色不该多出空字段').toBe(false);
  });
});

describe('v12.447 · 存库 → 单镜重生的整段往返(修前重生只拿到一张正面图)', () => {
  it('建项目存的 JSON 经 parseProjectContext/applyProjectContext 回来,角度图还在', async () => {
    const { parseProjectContext, applyProjectContext } = await import('@/lib/orchestrator-project-context');
    const { HybridOrchestrator } = await import('@/services/hybrid-orchestrator');

    // 1) 建项目:create-pipeline 把 sanitize 后的数组整串 JSON.stringify 进 projects.locked_characters
    const sanitized = sanitizeLockedCharacters([
      { name: '林晚', role: 'lead', cw: 125, imageUrl: FRONT, refs: [{ role: 'side', url: SIDE }, { role: 'detail', url: BACK }] },
    ]);
    const stored = JSON.stringify(sanitized);

    // 2) 重生:读回该列 → 灌进一个全新的编排器
    const ctx = parseProjectContext({ locked_characters: stored } as any);
    const orch: any = {};
    orch.setUserStyle = () => {};
    orch.setPrimaryCharacterRef = () => {};
    orch.setLockedCharacters = (HybridOrchestrator.prototype as any).setLockedCharacters.bind(orch);
    applyProjectContext(orch, ctx);

    // 3) 重生发给引擎的主体参考
    const subj = (HybridOrchestrator.prototype as any).getLockedSubjectReferences.call(orch);
    expect(subj).toHaveLength(1);
    expect(subj[0].imageUrl).toBe(FRONT);
    expect(subj[0].refImageUrls.sort(), '整段往返后角度图一张不能少').toEqual([BACK, SIDE].sort());
  });

  it('非法 JSON 不炸,老项目(没有 refs 的列)照常只给正面图', async () => {
    const { parseProjectContext } = await import('@/lib/orchestrator-project-context');
    expect(parseProjectContext({ locked_characters: '{坏' } as any).lockedCharacters).toEqual([]);
    const old = parseProjectContext({ locked_characters: JSON.stringify([{ name: '林晚', role: 'lead', cw: 125, imageUrl: FRONT }]) } as any);
    expect((old.lockedCharacters[0] as any).refs).toBeUndefined();
  });
});

describe('v12.447 · 重生路径也要报「忽略了几张」(每日重跑与「重生这一镜」都走这里)', () => {
  /** 真跑重生,只把引擎与主体参考换成假的;emit 收集事件,reportRefUsage 用真实现 */
  const fakeOrch = async (subjects: any[], extra: Record<string, unknown> = {}) => {
    const { HybridOrchestrator } = await import('@/services/hybrid-orchestrator');
    const events: any[] = [];
    const engineCalls: string[] = [];
    const fake: any = {
      projectId: '', primaryCharacterRef: '', update: () => {},
      emit: (n: string, p: unknown) => events.push([n, p]),
      getLockedSubjectReferences: () => subjects,
      videoAspect: () => '16:9',
      minimaxService: { generateVideo: async () => { engineCalls.push('minimax'); return 'https://cdn.example/v.mp4'; } },
      ...extra,
    };
    fake.reportRefUsage = (HybridOrchestrator.prototype as any).reportRefUsage.bind(fake);
    return { HybridOrchestrator, fake, events, engineCalls, refEvents: () => events.filter((e) => e[0] === 'refUsage') };
  };
  const WITH_ANGLES = [{ type: 'character', imageUrl: FRONT, name: '林晚', refImageUrls: [SIDE, BACK] }];
  const FRONT_ONLY = [{ type: 'character', imageUrl: FRONT, name: '林晚' }];
  const board = { shotNumber: 4, imageUrl: 'https://cdn.example/f.png', prompt: 'she turns away' };

  it('regenerateShot 走 MiniMax:角度图被忽略就报,带上镜号', async () => {
    const o = await fakeOrch(WITH_ANGLES);
    await (o.HybridOrchestrator.prototype as any).regenerateShot.call(o.fake, 4, board, { videoProvider: 'minimax' });
    expect(o.engineCalls).toEqual(['minimax']);
    expect(o.refEvents()).toHaveLength(1);
    expect(o.refEvents()[0][1]).toMatchObject({ engine: 'minimax', shotNumber: 4, dropped: 2 });
  }, 20000);

  it('regenerateShot 另一侧:没有角度图不报;链序前面的引擎先成功、没轮到 MiniMax 也不报', async () => {
    const a = await fakeOrch(FRONT_ONLY);
    await (a.HybridOrchestrator.prototype as any).regenerateShot.call(a.fake, 4, board, { videoProvider: 'minimax' });
    expect(a.engineCalls).toEqual(['minimax']);
    expect(a.refEvents(), '只有正面图,没什么可忽略的').toHaveLength(0);

    const b = await fakeOrch(WITH_ANGLES, { veoService: { generateVideo: async () => 'https://cdn.example/veo.mp4' } });
    await (b.HybridOrchestrator.prototype as any).regenerateShot.call(b.fake, 4, board, { videoProvider: 'veo' });
    expect(b.engineCalls, 'Veo 先成功,MiniMax 根本没被调').toEqual([]);
    expect(b.refEvents(), '没发给 MiniMax,就谈不上 MiniMax 忽略了什么').toHaveLength(0);
  }, 20000);

  it('上报本身出错(比如推送连接已断、回调抛错)绝不拖垮出片', async () => {
    const o = await fakeOrch(WITH_ANGLES);
    o.fake.emit = () => { throw new Error('SSE 已关闭'); };
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const clip = await (o.HybridOrchestrator.prototype as any).regenerateShot.call(o.fake, 4, board, { videoProvider: 'minimax' });
      expect(o.engineCalls, '上报炸了也得照常发给引擎').toEqual(['minimax']);
      expect(clip.videoUrl).toBe('https://cdn.example/v.mp4');
      expect(warn.mock.calls.map((a) => String(a[0])).join('\n')).toContain('上报失败');
    } finally { warn.mockRestore(); }
  }, 20000);

  it('审片反馈后的重生(executeReviewFeedback)同样要报', async () => {
    const o = await fakeOrch(WITH_ANGLES);
    const review = { items: [{ severity: 'critical', stage: 'video', shotNumber: 4, issue: '人物漂移' }] };
    const out = await (o.HybridOrchestrator.prototype as any).executeReviewFeedback.call(
      o.fake, review, { shots: [] }, [board], [{ shotNumber: 4, videoUrl: 'https://cdn.example/old.mp4' }],
    );
    expect(o.engineCalls).toEqual(['minimax']);
    expect(out.videos[0].videoUrl).toBe('https://cdn.example/v.mp4');
    expect(o.refEvents()).toHaveLength(1);
    expect(o.refEvents()[0][1]).toMatchObject({ engine: 'minimax', shotNumber: 4, dropped: 2 });
  }, 20000);
});
