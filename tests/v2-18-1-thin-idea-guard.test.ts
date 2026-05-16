/**
 * Tests for v2.18.1 — thin-idea guard at /api/create-stream
 *
 * 锁:
 *   - 18 字 + 无题材线索的 idea → 400 + category=thin-idea (不再走 Director/Writer 占位)
 *   - 长但有题材的 idea (古装+复仇) → 通过 thin-idea guard, 进入正常创作流程 (我们这里只验 401/403/422 不会先于 thin-idea 拒)
 */

import { describe, it, expect, vi } from 'vitest';

// ↓ create-stream 路由文件依赖很多服务 — 我们只 stub 关键模块, 让它跑到 thin-idea 分支
vi.mock('@/lib/db', () => ({
  db: {
    prepare: () => ({
      get: () => ({ id: 'test-user' }),
      run: () => ({ changes: 1 }),
      all: () => [],
    }),
  },
  now: () => new Date().toISOString(),
}));

vi.mock('@/lib/idea-normalizer', () => ({
  // 模拟 normalize: rule-only 不扩写, 把 idea 直接传回
  normalizeIdea: async (raw: string) => ({
    normalized: raw.trim(),
    hint: '已做基础清洗',
    didLlmExpand: false,
    detectedGenres: raw.includes('古装') || raw.includes('复仇') ? ['古装/武侠'] : [],
  }),
}));

vi.mock('@/services/hybrid-orchestrator', () => ({
  HybridOrchestrator: class {
    onProgress: any;
    setTemplate() {}
    setUserStyle() {}
    setCameraDefault() {}
    setPrimaryCharacterRef() {}
    setLockedCharacters() {}
    setProjectId() {}
    setWriterScript() {}
    getAllAgents() { return []; }
    runDirector() { return Promise.resolve({}); }
    runWriter() { return Promise.resolve({ shots: [] }); }
    runCharacterDesigner() { return Promise.resolve([]); }
    runSceneDesigner() { return Promise.resolve([]); }
  },
  activeOrchestrators: new Map(),
}));

const importPost = async () => {
  vi.resetModules();
  const mod = await import('@/app/api/create-stream/route');
  return mod.POST;
};

const mkReq = (body: unknown) =>
  new Request('http://localhost/api/create-stream', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', host: 'localhost:3000' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  }) as any;

describe('/api/create-stream thin-idea guard (v2.18.1)', () => {
  it('400 + category=thin-idea when idea < 30 chars AND no genre detected', async () => {
    const POST = await importPost();
    const res = await POST(mkReq({ idea: '一部AI短片' })); // 6 chars, no genre kw
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.category).toBe('thin-idea');
    // v2.18.1 文案: "创意只有 N 字 ..." (旧版本是 "简短")
    expect(body.error).toMatch(/字|简短/);
  });

  it('idea 10-30 chars BUT has genre keyword → passes thin-idea guard (continues to safety/pipeline)', async () => {
    const POST = await importPost();
    // v2.18.1: hard reject <10 chars 不论 genre; 这条用 >=10 但 <30 字 + 题材关键词来验软门
    const res = await POST(mkReq({ idea: '古装复仇短剧的精彩故事' })); // 11 chars, 含'古装' 触发题材识别
    // 不应被 thin-idea 拦; 可能被其他闸门 (例如 SSE stream 启动) 影响, 但 status != 400 with thin-idea
    if (res.status === 400) {
      const body = await res.json();
      expect(body.category).not.toBe('thin-idea');
    }
  });

  it('long idea > 30 chars passes thin-idea guard regardless of genre', async () => {
    const POST = await importPost();
    const longIdea = '一个不知道什么题材的故事但是有 30 字以上写得很长 我希望生成一些什么有趣的内容出来';
    const res = await POST(mkReq({ idea: longIdea }));
    if (res.status === 400) {
      const body = await res.json();
      expect(body.category).not.toBe('thin-idea');
    }
  });

  it('still 400 with original message when idea totally missing', async () => {
    const POST = await importPost();
    const res = await POST(mkReq({}));
    expect(res.status).toBe(400);
    const body = await res.json();
    // 原有的 "请提供故事创意" 错误, 不是 thin-idea
    expect(body.error).toContain('故事创意');
  });
});
