/**
 * v12.448 · 一键出片(/api/create-stream)校验 projectId 归属(对抗复查第三轮挖出,早就存在)。
 *
 * 此前路由只要求登录:projectId 由客户端给,流水线见项目已存在就 UPDATE 风格 / 锁定角色并往里写全套素材 ——
 * 任何登录用户填别人的项目号,就能用自己的创意覆写别人的项目。
 * 新建时前端是先生成 `proj-<时间戳>` 再传上来的,那时项目还不存在 —— 这条路必须照常放行。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const m = vi.hoisted(() => ({
  access: { ok: true } as any,
  checked: [] as Array<{ pid: string; level: string }>,
  normalized: 0,
  existing: new Set<string>(['victim-proj', 'my-proj']),
}));

vi.mock('@/app/api/auth/lib', () => ({ getUserFromRequest: () => ({ sub: 'u-caller', role: 'user' }) }));
vi.mock('@/lib/budget-enforce', () => ({ assertBudget: async () => ({ allow: true, guard: { level: 'none', allow: true, message: '' } }) }));
vi.mock('@/lib/repos/project-repo', async (orig) => ({
  ...(await orig() as any),
  getProject: async (id: string) => (m.existing.has(id) ? { id, userId: id === 'my-proj' ? 'u-caller' : 'u-victim' } : null),
}));
vi.mock('@/lib/auth-guard', async (orig) => ({
  ...(await orig() as any),
  requireProjectAccess: async (_r: unknown, pid: string, level: string) => { m.checked.push({ pid, level }); return m.access; },
}));
// 越过归属检查之后的第一个计费动作就是创意扩写(LLM)。让它回一个「太单薄」的结果,路由就在 thin-idea 闸门 400 收住,
// 不会真的跑流水线 —— 我们要验的只是「有没有走到计费那一步」
vi.mock('@/lib/idea-normalizer', () => ({
  normalizeIdea: async (raw: string) => { m.normalized++; return { normalized: raw.slice(0, 5), hint: 'stub', didLlmExpand: false, detectedGenres: [] }; },
}));

beforeEach(() => { m.access = { ok: true }; m.checked = []; m.normalized = 0; });

const post = (body: Record<string, unknown>) => new Request('http://localhost/api/create-stream', {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ idea: '古装复仇:被灭门的少女十年后回到京城,一步步揭开当年真相', ...body }),
});

describe('v12.448 · create-stream 校验 projectId 归属', () => {
  it('别人的项目 → 403,且在任何计费调用之前就拒', async () => {
    m.access = { ok: false, status: 403, message: 'Forbidden' };
    const { POST } = await import('@/app/api/create-stream/route');
    const res = await POST(post({ projectId: 'victim-proj' }) as any);
    expect(res.status).toBe(403);
    expect(m.checked).toEqual([{ pid: 'victim-proj', level: 'edit' }]);
    expect(m.normalized, '被拒之前就跑了创意扩写(LLM 计费)').toBe(0);
  });

  it('自己的已有项目(重跑)→ 查了编辑权限,放行', async () => {
    const { POST } = await import('@/app/api/create-stream/route');
    const res = await POST(post({ projectId: 'my-proj' }) as any);
    expect(res.status).not.toBe(403);
    expect(m.checked).toEqual([{ pid: 'my-proj', level: 'edit' }]);
    expect(m.normalized).toBe(1);
  });

  it('新建:前端生成的项目号还不存在 → 不查归属,照常放行(不能把新建拦死)', async () => {
    const { POST } = await import('@/app/api/create-stream/route');
    const res = await POST(post({ projectId: 'proj-1758260000000' }) as any);
    expect(res.status).not.toBe(403);
    expect(m.checked).toEqual([]);
    expect(m.normalized).toBe(1);
  });

  it('没带项目号 → 不查归属,照常放行', async () => {
    const { POST } = await import('@/app/api/create-stream/route');
    const res = await POST(post({}) as any);
    expect(res.status).not.toBe(403);
    expect(m.checked).toEqual([]);
    expect(m.normalized).toBe(1);
  });
});
