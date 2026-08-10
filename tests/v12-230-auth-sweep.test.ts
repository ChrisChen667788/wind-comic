/**
 * v12.230 — 鉴权复扫收口回归锁。
 *
 * **本版起因是我自己的疏漏**:v12.218 命名为「鉴权总修」,但实际只修了对抗尽调**点名**的
 * 那几个端点(projects/[id]、assets、cost、characters、usage、health/providers 等),
 * 没有系统复扫 projects/[id] 整个目录。复扫后查出 32 个项目作用域路由仍无鉴权,
 * 其中 regenerate / rerun / export / lipsync / render-loop / chat 是**会花钱的写操作** ——
 * 任何人知道 projectId 就能烧掉属主的 API 额度。
 *
 * 本测试用「目录级不变量」兜底:projects/[id] 目录下递归找到的每个 route.ts,
 * 每个导出的 HTTP handler 都必须有项目作用域鉴权。这样以后**新增**路由忘了加守卫也会被逮住,
 * 而不是等下一次对抗评审。
 */
import { describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';

const ROOT = path.join(__dirname, '..');
const BASE = path.join(ROOT, 'app', 'api', 'projects', '[id]');

function walkRoutes(dir: string, acc: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walkRoutes(p, acc);
    else if (e.name === 'route.ts') acc.push(p);
  }
  return acc;
}

const ROUTES = walkRoutes(BASE);
const AUTH_RE = /requireProjectAccess|requireUser|getUserFromRequest|getOwnedProject/;
const AUTHISH_BODY = /requireProjectAccess|requireUser|getUserFromRequest|getOwnedProject|resolveUserId|canViewProject|canEditProject|canCommentProject/;

describe('v12.230 projects/[id]/** 鉴权不变量', () => {
  it('至少扫到 30 个路由文件(防 walk 逻辑坏掉后空跑变假绿)', () => {
    expect(ROUTES.length).toBeGreaterThanOrEqual(30);
  });

  it('每个路由文件都含项目作用域鉴权', () => {
    const bad = ROUTES.filter((f) => !AUTH_RE.test(fs.readFileSync(f, 'utf-8')))
      .map((f) => path.relative(ROOT, f));
    expect(bad).toEqual([]);
  });

  it('每个 handler 体内都有鉴权(逐 handler 查,能识别共享 helper 如 resolveUserId)', () => {
    // 按文件里 handler 的起止切片,逐段找鉴权标识 —— 比"整文件出现过一次"严格,
    // 又不会把 comments 那种「三个 handler 共用 resolveUserId」误判成缺口。
    const gaps: string[] = [];
    for (const f of ROUTES) {
      const src = fs.readFileSync(f, 'utf-8');
      const ms = [...src.matchAll(/export async function (GET|POST|PATCH|PUT|DELETE)\(/g)];
      for (let i = 0; i < ms.length; i++) {
        const start = ms[i].index!;
        const end = i + 1 < ms.length ? ms[i + 1].index! : src.length;
        if (!AUTHISH_BODY.test(src.slice(start, end))) {
          gaps.push(ms[i][1] + ' ' + path.relative(ROOT, f));
        }
      }
    }
    expect(gaps).toEqual([]);
  });

  /**
   * v12.312 豁免名单 —— 每条必须写 why。
   * 规则本身没错(别拿 view 放行写操作),但存在**合理例外**:
   * `commenter` 是本项目的一等角色,语义就是「可评论、不可编辑」。
   * 评论写入若要求 edit 级,这个角色直接被废掉。
   */
  const WRITE_VIEW_EXEMPT: Array<{ route: string; method: string; why: string }> = [
    {
      route: 'app/api/projects/[id]/comments/route.ts',
      method: 'POST',
      why: 'commenter 角色的语义就是「可评论不可编辑」;用 edit 级会让该角色无法评论。view 档覆盖 viewer/commenter/editor 三种项目成员,非成员仍 403 —— 这正是评论该有的边界',
    },
    {
      route: 'app/api/projects/[id]/export-platform/route.ts',
      method: 'POST',
      why: '形式是 POST、语义是读:把用户本就能观看的成片按指定画幅导出一份,不改任何项目数据。用 POST 只因要传画幅参数(16:9/9:16/1:1/4:5)。viewer 能看就该能导出,要 edit 级反而不合理',
    },
  ];

  it('写 handler 若用 requireProjectAccess,必须是 edit 级(不能拿 view 放行写操作)', () => {
    // 只针对「该写 handler 自己调了 requireProjectAccess」的情况判定 —— 
    // 有些老路由用 getUserFromRequest + 自有归属校验,那是另一套合法机制,不在此列。
    const weak: string[] = [];
    for (const f of ROUTES) {
      const src = fs.readFileSync(f, 'utf-8');
      const ms = [...src.matchAll(/export async function (GET|POST|PATCH|PUT|DELETE)\(/g)];
      for (let i = 0; i < ms.length; i++) {
        const method = ms[i][1];
        if (method === 'GET') continue;
        const start = ms[i].index!;
        const end = i + 1 < ms.length ? ms[i + 1].index! : src.length;
        const body = src.slice(start, end);
        if (/requireProjectAccess\(/.test(body) && /'view'/.test(body)) {
          const rel = path.relative(ROOT, f).replace(/\\/g, '/');
          const exempt = WRITE_VIEW_EXEMPT.some((e) => e.route === rel && e.method === method);
          if (!exempt) weak.push(method + ' ' + rel);
        }
      }
    }
    expect(weak, `仍有写 handler 用 view 档:${weak.join(', ')}`).toEqual([]);
  });

  it('豁免名单每条都要写 why,且路由真实存在(防豁免名单腐烂)', () => {
    for (const e of WRITE_VIEW_EXEMPT) {
      expect(fs.existsSync(path.join(ROOT, e.route)), `豁免了不存在的路由 ${e.route}`).toBe(true);
      expect(e.why.length, `${e.route} 的理由太短`).toBeGreaterThan(30);
    }
  });
});
