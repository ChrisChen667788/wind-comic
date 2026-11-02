/**
 * lib/server-misconfig (v13.11) —— 「服务端配错了」的统一出口:登录/注册不再 500,直接说原因。
 *
 * 自托管(NAS)实测的三种「首页正常、登录 500」:
 *   ① 没设 JWT_SECRET;② JWT_SECRET 用了 .env.example 的公开占位串
 *      → app/api/auth/lib.ts 的 getJwtSecret() 在生产环境抛错,而登录/注册签令牌时没接 → 500(只在密码对时);
 *   ③ 数据目录属主不是容器用户(1001:1001,群晖默认 1026:100)
 *      → lib/db.ts 在模块顶层开库,SQLITE_CANTOPEN 让所有 import 它的模块加载失败 → 密码对错都 500。
 *
 * 后补(v13.11 之后,DB_DRIVER=pg):④ PostgreSQL 连不上 / 账号密码不对 / 库不存在 / 没设 DATABASE_URL
 *   → 此前 pg 的原始错误一路抛到路由,登录裸 500;现在由 lib/db-driver 的 PG 驱动换成 DbUnreachableError。
 *
 * 机制只有一处:每类问题各抛一个**带标记的错误**(JwtSecretError / DbUnavailableError / DbUnreachableError),
 * `misconfigReason()` 认标记,`withMisconfigGuard()` 包住路由把它们翻成 503 + 原因 + 一行修法。
 * 认 `code` 而不是 instanceof —— Next 可能把本模块打进不同的 chunk,instanceof 跨实例不可靠。
 *
 * 对外只给原因代码和固定文案:不带路径、不带异常原文、不带密钥值(详情只进服务端日志)。
 * 本模块不依赖 next/server 和数据库 —— lib/db.ts 也要 import 它,不能反过来拖进别的东西。
 */

export type JwtSecretReason = 'jwt_secret_missing' | 'jwt_secret_weak';
export type MisconfigReason = JwtSecretReason | 'db_unavailable' | 'db_unreachable';

/** JWT_SECRET 在生产环境不可用(没设 / 公开占位串)。message 是给服务端日志看的原文。 */
export class JwtSecretError extends Error {
  readonly code = 'JWT_SECRET_INVALID';
  constructor(readonly reason: JwtSecretReason, message: string) {
    super(message);
    this.name = 'JwtSecretError';
  }
}

/** 数据库打不开(lib/db.ts 开库或建表时失败)。sqliteCode 例:SQLITE_CANTOPEN。 */
export class DbUnavailableError extends Error {
  readonly code = 'DB_UNAVAILABLE';
  constructor(readonly sqliteCode: string | undefined, detail: string) {
    super(`[db] 数据库不可用${sqliteCode ? `(${sqliteCode})` : ''}:${detail}`);
    this.name = 'DbUnavailableError';
  }
}

/**
 * DB_DRIVER=pg 时连不上 PostgreSQL 或没配好(lib/db-driver 的 PG 驱动抛)。
 * failure:'pg_not_installed' / 'database_url_missing',或 pg 原样给的网络错误码 / SQLSTATE(见 pgUnreachableCode)。
 * message 只进服务端日志;对外一律是 MISCONFIG_MESSAGES.db_unreachable,不带主机名、库名、账号和连接串。
 */
export class DbUnreachableError extends Error {
  readonly code = 'DB_UNREACHABLE';
  constructor(readonly failure: string, detail: string) {
    super(`[db] PostgreSQL 连不上或没配好(${failure}):${detail}`);
    this.name = 'DbUnreachableError';
  }
}

/**
 * 建连阶段 Node 的 socket / DNS 错误码(pg 原样透出):拒绝连接、域名解析不到、超时、主机/网络不可达。
 * EADDRNOTAVAIL / ENETUNREACH:容器里没有 IPv6 时 localhost 先试 ::1 就是这两个 ——
 * Node 双栈建连全失败抛 AggregateError,code 取的是**第一个**地址的错误码。
 * 这些码本身不说明对端是谁(连外网 API 失败也是 ECONNREFUSED),所以只由 PG 驱动在自己的调用上认,
 * misconfigReason 不直接认它们(见下方 v13.11 的「只认带标记的错误」)。
 */
const PG_NET_UNREACHABLE = new Set(['ECONNREFUSED', 'ENOTFOUND', 'EAI_AGAIN', 'ETIMEDOUT', 'EHOSTUNREACH', 'ENETUNREACH', 'EADDRNOTAVAIL']);
/**
 * PG 服务端在建连 / 鉴权阶段回的 SQLSTATE:28P01 密码错、28000 无此角色或 pg_hba 拒绝、3D000 库不存在、
 * 57P03 正在启动、53300 连接数满。SQL 语法错(42601)、唯一冲突(23505)、表不存在(42P01)不在内 —— 那是代码问题,照旧 500。
 */
const PG_CONNECT_SQLSTATE = new Set(['28P01', '28000', '3D000', '57P03', '53300']);

/** pg 抛的错误是不是「连不上 / 进不去」:是就返回那个错误码,不是返回 null。PG 驱动据此换成 DbUnreachableError。 */
export function pgUnreachableCode(e: unknown): string | null {
  if (!e || typeof e !== 'object') return null;
  const { code, errors } = e as { code?: unknown; errors?: unknown };
  if (typeof code === 'string' && (PG_NET_UNREACHABLE.has(code) || PG_CONNECT_SQLSTATE.has(code))) return code;
  // AggregateError 的 code 只取第一个地址;第一个是别的码时,看其余地址里有没有连不上的
  if (Array.isArray(errors)) {
    for (const sub of errors) {
      const c = pgUnreachableCode(sub);
      if (c) return c;
    }
  }
  return null;
}

/**
 * 库能开、写的时候才失败的那几种(库文件属主不对但目录可写 → 只读打开,读得到写不进)。
 * 这些是 better-sqlite3 原样抛出的 SqliteError,不经过 DbUnavailableError —— 注册写库时会撞上。
 */
const SQLITE_NOT_WRITABLE = /^SQLITE_(CANTOPEN|READONLY|PERM)/;

export function misconfigReason(e: unknown): MisconfigReason | null {
  if (!e || typeof e !== 'object') return null;
  const { code, reason } = e as { code?: unknown; reason?: unknown };
  if (code === 'JWT_SECRET_INVALID' && (reason === 'jwt_secret_missing' || reason === 'jwt_secret_weak')) return reason;
  if (code === 'DB_UNAVAILABLE') return 'db_unavailable';
  if (code === 'DB_UNREACHABLE') return 'db_unreachable';
  if (typeof code === 'string' && SQLITE_NOT_WRITABLE.test(code)) return 'db_unavailable';
  return null;
}

/**
 * 登录页原样显示这几句 —— 读的人是普通用户,要能转给管理员;修法写成一行命令。
 * JWT 两种都以「服务端没配置 JWT_SECRET」开头:占位串等于没配(谁都能拿它伪造令牌)。
 */
export const MISCONFIG_MESSAGES: Record<MisconfigReason, string> = {
  jwt_secret_missing:
    '服务端没配置 JWT_SECRET,暂时无法登录。请管理员用 openssl rand -hex 32 生成一个值,填进部署环境的 JWT_SECRET,然后重启服务。',
  jwt_secret_weak:
    '服务端没配置 JWT_SECRET(现在填的是示例里的公开占位值,等于没配)。请管理员用 openssl rand -hex 32 生成一个新值替换,然后重启服务。',
  db_unavailable:
    '服务端数据库打不开,暂时无法登录。最常见的原因是挂载的数据目录对服务进程不可写:Docker 部署请管理员执行 sudo chown -R 1001:1001 <宿主机数据目录>,或改用 Docker 命名卷,然后重启容器。',
  db_unreachable:
    '服务端连不上数据库(PostgreSQL),暂时无法登录。请管理员检查:部署环境的 DATABASE_URL 是否填对(容器里连别的容器不能写 localhost)、数据库服务是否已启动、账号密码和库名是否正确;改了环境变量要重启服务,具体是哪一项见服务端日志。',
};

export interface MisconfigBody {
  code: 'server_misconfigured';
  reason: MisconfigReason;
  message: string;
}

/** 是配错就给 503 响应(并打一行服务端日志),不是就返回 null 让调用方照旧处理。 */
export function misconfiguredResponse(e: unknown, where: string): Response | null {
  const reason = misconfigReason(e);
  if (!reason) return null;
  // 日志里留原文(JWT 那句就是 getJwtSecret 的原话,排障文档教用户 grep 它);不打堆栈 —— 这不是代码 bug
  console.error(`[${where}] 503 server_misconfigured/${reason} —— ${e instanceof Error ? e.message : String(e)}`);
  const body: MisconfigBody = { code: 'server_misconfigured', reason, message: MISCONFIG_MESSAGES[reason] };
  return Response.json(body, { status: 503, headers: { 'Cache-Control': 'no-store' } });
}

/**
 * 包一个路由处理函数:配错 → 503;其他异常原样抛(交给 Next,照旧 500 + 堆栈进日志)。
 * 用包装而不是在每个路由里各写一遍 try/catch:登录、注册、/api/auth/me 走的是同一份判定。
 */
export function withMisconfigGuard<A extends unknown[]>(
  where: string,
  handler: (...args: A) => Promise<Response>,
): (...args: A) => Promise<Response> {
  return async (...args: A) => {
    try {
      return await handler(...args);
    } catch (e) {
      const res = misconfiguredResponse(e, where);
      if (res) return res;
      throw e;
    }
  };
}

/**
 * 数据库打不开时 lib/db.ts 导出的替身:任何一次使用都抛 DbUnavailableError,模块加载本身不失败。
 * `then` 和 Symbol 键放行 —— lib/db-driver 用 `import('./db').then(m => m.db)` 取连接,
 * Promise 会探 `.then` 判断是不是 thenable;console.log / util.inspect 会探 Symbol 键。
 */
export function unavailableDb<T extends object>(sqliteCode: string | undefined, detail: string): T {
  return new Proxy({} as T, {
    get(_target, prop) {
      if (prop === 'then' || typeof prop === 'symbol') return undefined;
      throw new DbUnavailableError(sqliteCode, detail);
    },
  });
}
