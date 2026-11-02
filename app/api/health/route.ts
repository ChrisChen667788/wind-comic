/**
 * GET /api/health (v13.6) — 容器健康检查:**登录真正依赖的两件事**能不能用。
 *
 * 病象(NAS 实测,v13.1 官方镜像):首页 200、`docker ps` 显示 healthy,登录却一律 500。
 * Docker HEALTHCHECK 只探 `/` —— 首页是静态壳,不碰数据库也不签令牌,所以三种「登录 500」全都探不出来:
 *   ① 数据目录属主不是容器用户(1001:1001,群晖默认 1026:100)→ SQLite `unable to open database file`;
 *   ② 没设 JWT_SECRET → 生产环境 fail-fast;
 *   ③ JWT_SECRET 用了 .env.example 的公开占位串 → 黑名单拒用。
 * 健康检查绿着,用户只看到「登录失败」,排查要靠翻日志。
 *
 * 这里只做两件便宜的事:数据库跑一句 `SELECT 1`(SQLite 再确认数据目录与库文件可写 —— 能读不能写时
 * 登录照样 500);签一枚不外发的令牌(三条 JWT 密钥规则全在 signToken 里,复用它而不是另抄一份)。
 * 不打外网、不读引擎 key —— 那是 /api/health/providers 的事,网关抖一下不该让编排器把容器判死重启。
 *
 * 对外只给原因代码,不给路径和异常原文;详情只进服务端日志,且只在状态变化时打一次(每 30s 探一次,别刷屏)。
 *
 * v13.11:原因代码与登录/注册的 503 用同一套(lib/server-misconfig):`jwt_secret_missing` / `jwt_secret_weak` /
 * `db_unavailable`,外加只有这里探的 `db_not_writable`。v13.6 的 `jwt_secret_invalid` 拆成了前两个。
 * 库打不开不再拖垮鉴权库的加载,所以 JWT 也照查 —— 两个问题同时存在时一次报全。
 *
 * v13.11 后补:`DB_DRIVER=pg` 时 PostgreSQL 连不上 / 鉴权失败 / 没设 DATABASE_URL 报 `db_unreachable`(此前笼统报
 * `db_unavailable`,而登录是裸 500);与登录 503 同一判定(PG 驱动抛的 DbUnreachableError)。
 */
import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import { misconfigReason } from '@/lib/server-misconfig';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type CheckState = 'ok' | 'fail' | 'unknown';

let lastLogged = '';

function logOnChange(key: string, line: string): void {
  if (key === lastLogged) return;
  lastLogged = key;
  if (line) console.error(line);
}

export async function GET() {
  let db: CheckState = 'fail';
  let auth: CheckState = 'unknown';
  const reasons: string[] = [];
  const details: string[] = [];

  try {
    const { getDbDriver } = await import('@/lib/db-driver');
    const driver = getDbDriver();
    await driver.get('SELECT 1 AS ok');
    if (driver.dialect === 'sqlite') {
      const { dbPath } = await import('@/lib/db');
      try {
        fs.accessSync(path.dirname(dbPath), fs.constants.W_OK);
        fs.accessSync(dbPath, fs.constants.W_OK);
      } catch {
        reasons.push('db_not_writable');
        throw new Error(`数据目录或库文件不可写(容器用户 uid ${process.getuid?.() ?? '?'})`);
      }
    }
    db = 'ok';
  } catch (e) {
    if (!reasons.length) reasons.push(misconfigReason(e) === 'db_unreachable' ? 'db_unreachable' : 'db_unavailable');
    details.push(`db: ${e instanceof Error ? e.message : String(e)}`);
  }

  // v13.11 前鉴权库随数据库一起加载失败,库打不开时这里只能标 unknown;现在 lib/db 不再在加载期抛错,照查
  try {
    const { signToken } = await import('@/app/api/auth/lib');
    signToken({ id: 'healthcheck', role: 'member' });
    auth = 'ok';
  } catch (e) {
    auth = 'fail';
    const reason = misconfigReason(e);
    reasons.push(reason === 'jwt_secret_missing' || reason === 'jwt_secret_weak' ? reason : 'auth_unavailable');
    details.push(`auth: ${e instanceof Error ? e.message : String(e)}`);
  }

  const ok = db === 'ok' && auth === 'ok';
  logOnChange(
    ok ? 'ok' : reasons.join(','),
    ok ? '' : `[health] 不健康(${reasons.join(', ')}):${details.join(' | ')} —— 排查见 docs/DEPLOYMENT.md「Docker 与 NAS 自托管」`,
  );
  return NextResponse.json(
    { ok, checks: { db, auth }, ...(ok ? {} : { reasons }) },
    { status: ok ? 200 : 503, headers: { 'Cache-Control': 'no-store' } },
  );
}
