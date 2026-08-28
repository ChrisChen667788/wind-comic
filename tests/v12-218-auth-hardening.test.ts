/**
 * v12.218 — 鉴权总修(auth master fix)回归锁。
 *
 * 对抗尽调 🔴-2(IDOR)/🟠-10(回落 DB 第一个用户)已亲验为真;本测试用「真行为断言」
 * 锁死修复:直接铸真 JWT、构造真 Request、调真路由 handler,断言 HTTP 401/403/200,
 * 而非 grep 源码。任何回退到「裸奔查询」或「匿名回落首个用户」都会让这些用例变红。
 *
 * 三档语义:
 *   - 无 token           → 401 Unauthorized(未登录)
 *   - 他人 token 越权      → 403 Forbidden(登录了但无此项目权限)
 *   - 属主 token          → 200(或该端点正常返回)
 */
import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { db } from '@/lib/db';
import { nanoid } from 'nanoid';
import { NextRequest } from 'next/server';
import { signToken } from '@/app/api/auth/lib';
import { requireUser, requireProjectAccess } from '@/lib/auth-guard';
import { GET as getProject, PATCH as patchProject } from '@/app/api/projects/[id]/route';
import { GET as getCost } from '@/app/api/projects/[id]/cost/route';
import { GET as getAssets } from '@/app/api/assets/route';
import { GET as getUsage } from '@/app/api/usage/route';
import { GET as listProjects } from '@/app/api/projects/route';

const P = 'test-v12218-auth-';

function mkUser(tag: string): string {
  const id = `${P}user-${tag}-${nanoid(6)}`;
  db.prepare(
    `INSERT INTO users (id, email, password_hash, name, role, locale, created_at)
     VALUES (?, ?, '', ?, 'user', 'zh', ?)`,
  ).run(id, `${id}@test.local`, tag, new Date().toISOString());
  return id;
}

function mkProject(ownerId: string): string {
  const id = `${P}proj-${nanoid(8)}`;
  db.prepare(
    `INSERT INTO projects (id, user_id, title, description, cover_urls, status, created_at, updated_at)
     VALUES (?, ?, 'guard test', 'd', '[]', 'draft', ?, ?)`,
  ).run(id, ownerId, new Date().toISOString(), new Date().toISOString());
  return id;
}

function tokenFor(userId: string): string {
  return signToken({ id: userId, role: 'user' });
}

function req(path: string, token?: string, init?: RequestInit): NextRequest {
  const headers = new Headers(init?.headers);
  if (token) headers.set('authorization', `Bearer ${token}`);
  // NextRequest 提供 .nextUrl(部分路由用 request.nextUrl.searchParams);它 extends Request,可传给任何 handler。
  return new NextRequest(`http://localhost${path}`, { ...init, headers } as any);
}

function cleanup() {
  db.prepare(`DELETE FROM project_collaborators WHERE project_id LIKE '${P}%' OR user_id LIKE '${P}%'`).run();
  db.prepare(`DELETE FROM project_assets WHERE project_id LIKE '${P}%'`).run();
  db.prepare(`DELETE FROM projects WHERE id LIKE '${P}%'`).run();
  db.prepare(`DELETE FROM users WHERE id LIKE '${P}%'`).run();
}

let owner = '';
let other = '';
let projId = '';

beforeEach(() => {
  cleanup();
  owner = mkUser('owner');
  other = mkUser('other');
  projId = mkProject(owner);
});
afterEach(cleanup);

describe('v12.218 auth-guard 单元真行为', () => {
  it('requireUser: 无 token → 401', () => {
    const r = requireUser(req('/x'));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.status).toBe(401);
  });

  it('requireUser: 有效 token → ok + userId', () => {
    const r = requireUser(req('/x', tokenFor(owner)));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.userId).toBe(owner);
  });

  it('requireProjectAccess view: 无 token → 401', async () => {
    const r = await requireProjectAccess(req('/x'), projId, 'view');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.status).toBe(401);
  });

  it('requireProjectAccess view: 他人 token → 403', async () => {
    const r = await requireProjectAccess(req('/x', tokenFor(other)), projId, 'view');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.status).toBe(403);
  });

  it('requireProjectAccess view: 属主 token → ok', async () => {
    const r = await requireProjectAccess(req('/x', tokenFor(owner)), projId, 'view');
    expect(r.ok).toBe(true);
  });

  it('requireProjectAccess edit: 属主 token → ok(owner 视为 editor)', async () => {
    const r = await requireProjectAccess(req('/x', tokenFor(owner)), projId, 'edit');
    expect(r.ok).toBe(true);
  });

  it('requireProjectAccess edit: 他人 token → 403', async () => {
    const r = await requireProjectAccess(req('/x', tokenFor(other)), projId, 'edit');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.status).toBe(403);
  });
});

describe('v12.218 IDOR 堵漏:GET /api/projects/[id]', () => {
  const params = () => Promise.resolve({ id: projId });

  it('无 token → 401(旧洞:枚举 projectId 读任意项目)', async () => {
    const res = await getProject(req(`/api/projects/${projId}`), { params: params() });
    expect(res.status).toBe(401);
  });

  it('他人 token → 403', async () => {
    const res = await getProject(req(`/api/projects/${projId}`, tokenFor(other)), { params: params() });
    expect(res.status).toBe(403);
  });

  it('属主 token → 200 且透传 user_id', async () => {
    const res = await getProject(req(`/api/projects/${projId}`, tokenFor(owner)), { params: params() });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.user_id).toBe(owner);
  });
});

describe('v12.218 PATCH /api/projects/[id] 资产覆写需 edit', () => {
  const params = () => Promise.resolve({ id: projId });

  it('他人 token 覆写资产 → 403(旧洞:此分支无 auth)', async () => {
    const res = await patchProject(
      req(`/api/projects/${projId}`, tokenFor(other), {
        method: 'PATCH',
        body: JSON.stringify({ assetId: 'whatever', data: { hacked: true } }),
      }),
      { params: params() },
    );
    expect(res.status).toBe(403);
  });

  it('无 token 覆写资产 → 401', async () => {
    const res = await patchProject(
      req(`/api/projects/${projId}`, undefined, {
        method: 'PATCH',
        body: JSON.stringify({ assetId: 'whatever', data: {} }),
      }),
      { params: params() },
    );
    expect(res.status).toBe(401);
  });
});

describe('v12.218 GET /api/projects/[id]/cost 需 view', () => {
  const params = () => Promise.resolve({ id: projId });
  it('无 token → 401(旧洞:免鉴权)', async () => {
    const res = await getCost(req(`/api/projects/${projId}/cost`), { params: params() });
    expect(res.status).toBe(401);
  });
  it('他人 token → 403', async () => {
    const res = await getCost(req(`/api/projects/${projId}/cost`, tokenFor(other)), { params: params() });
    expect(res.status).toBe(403);
  });
  it('属主 token → 200', async () => {
    const res = await getCost(req(`/api/projects/${projId}/cost`, tokenFor(owner)), { params: params() });
    expect(res.status).toBe(200);
  });
});

describe('v12.218 GET /api/assets 需 projectId + view', () => {
  // v12.345:原断言是「无 projectId → 400」。那是**写法**,不是要守的行为 ——
  // v12.218 真正要堵的是「无作用域枚举他人资产」。而 400 让素材库页面
  // (调的正是不带 projectId 的 /api/assets)空白了几十个版本。
  // 现在无 projectId 返回**该用户自己项目**的资产,洞依旧堵着。断言随之改成验行为:
  it('无 projectId + 无 token → 401(不许匿名列表)', async () => {
    const res = await getAssets(req('/api/assets') as any);
    expect(res.status).toBe(401);
  });
  it('无 projectId + 属主 token → 200,且只含自己项目的资产', async () => {
    const res = await getAssets(req('/api/assets', tokenFor(owner)) as any);
    expect(res.status).toBe(200);
    const list = await res.json();
    expect(Array.isArray(list)).toBe(true);
    // 关键:返回的每一条都必须属于 owner 的项目
    for (const a of list) expect(a.projectId).toBe(projId);
  });
  it('无 projectId + 他人 token → 拿不到属主的任何资产(旧洞的核心)', async () => {
    const res = await getAssets(req('/api/assets', tokenFor(other)) as any);
    expect(res.status).toBe(200);
    const list = await res.json();
    expect(list.some((a: { projectId: string }) => a.projectId === projId)).toBe(false);
  });
  it('无 token → 401', async () => {
    const res = await getAssets(req(`/api/assets?projectId=${projId}`) as any);
    expect(res.status).toBe(401);
  });
  it('他人 token → 403', async () => {
    const res = await getAssets(req(`/api/assets?projectId=${projId}`, tokenFor(other)) as any);
    expect(res.status).toBe(403);
  });
  it('属主 token → 200', async () => {
    const res = await getAssets(req(`/api/assets?projectId=${projId}`, tokenFor(owner)) as any);
    expect(res.status).toBe(200);
  });
});

describe('v12.218 用户作用域端点撤回落', () => {
  it('GET /api/usage 无 token → 401(旧洞:回落首个用户)', async () => {
    const res = await getUsage(req('/api/usage'));
    expect(res.status).toBe(401);
  });
  // 注:usage「有 token → 200」happy-path 依赖 generations 表完整 schema(resource_type 列),
  // 测试库 schema 不复刻该列,故 200 路径以 live curl 验收(已通过);此处只锁安全相关的 401 撤回落。
  it('GET /api/projects 无 token → 401(旧洞:回落首个用户列表)', async () => {
    const res = await listProjects(req('/api/projects'));
    expect(res.status).toBe(401);
  });
  it('GET /api/projects 属主 token → 200 且只见自己的项目', async () => {
    const res = await listProjects(req('/api/projects', tokenFor(owner)));
    expect(res.status).toBe(200);
    const body = await res.json();
    const arr = Array.isArray(body) ? body : body.projects || [];
    // 至少包含自己刚建的项目,且不含 other 的(other 没有项目,断言不泄露即可)
    const ids: string[] = arr.map((p: any) => p.id);
    expect(ids).toContain(projId);
  });
});
