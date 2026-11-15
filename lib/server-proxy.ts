/**
 * lib/server-proxy (v12.357) —— 让**服务端**的 fetch 认系统代理。
 *
 * 病根:Node 的 fetch(undici)**默认不读 `HTTPS_PROXY` 等环境变量**。
 * 本机全局挂着 ClashX,`api.vectorengine.ai` 只能经代理到达 ——
 * 于是 Next.js 服务里每一次打该网关的 LLM 调用都超时。
 *
 * 表现极具迷惑性:
 * - `curl` **2.2 秒**就返回(curl 认 `*_proxy` 环境变量);
 * - 服务端同一个模型、同一把 key,**必然 `Request timed out`**;
 * - 而走 OpenRouter 的端点(如 hook-ideas)一切正常 —— 那个域名不需要代理。
 * 于是看起来像「导演这个功能坏了」,实际是**整条经该网关的 LLM 通路在服务端不可达**。
 *
 * `scripts/api-health-audit.mjs` 的文件头早就记着这个坑,并且在脚本里装了 ProxyAgent ——
 * **但只装在那个脚本里,服务端从来没装过**。「知识写在一处、消费方在另一处」是本仓的老毛病。
 *
 * 另一条实测教训(同样来自那个脚本):把 `process.env.NODE_USE_ENV_PROXY='1'` 写在代码里
 * **无效** —— undici 启动时就读完了该开关,进程内再设已经太晚。必须显式装 dispatcher。
 *
 * v13.16:`undici` 必须是 package.json 的 **dependencies**。之前没声明,只靠 devDependency jsdom
 * 间接装上。Turbopack 在 `next build` 时把 undici 内联进产物,所以构建后再裁掉开发依赖不受影响;
 * 但**构建时**解析不到它(jsdom 哪天不再依赖它、或用 pnpm 这类不提升间接依赖的安装方式),
 * Turbopack 只给一条 warning,把下面的 import 编译成运行时必抛 MODULE_NOT_FOUND 的桩,
 * 这里再静默返回 '' —— 服务端照旧直连、日志一个字没有(目前只是碰巧被 TS 类型检查拦下)。
 * 现在装不上会打 warn;依赖声明由 tests/v13-16-* 锁住。
 */

let installed = false;

/** 读代理地址(大小写变体都认,与 curl 的行为一致)。 */
export function proxyFromEnv(env: NodeJS.ProcessEnv = process.env): string {
  return (
    env.HTTPS_PROXY || env.https_proxy ||
    env.HTTP_PROXY || env.http_proxy ||
    env.ALL_PROXY || env.all_proxy ||
    ''
  ).trim();
}

/** 打日志用:代理地址里的账号密码换成 ***(`http://user:pass@host:port` 很常见)。 */
export function proxyForLog(proxy: string): string {
  return proxy.replace(/\/\/[^/]*@/, '//***@');
}

/**
 * 幂等安装。返回实际装上的代理地址;没配代理或装不上返回 ''。
 *
 * **不抛异常** —— 代理装不上不该让整个服务起不来;拿不到就退回直连,
 * 只是某些域名会不可达(与修复前一致,不会更糟)。但**配了却装不上要说出来**(见文件头 v13.16)。
 */
export async function installServerProxy(): Promise<string> {
  if (installed) return proxyFromEnv();
  const proxy = proxyFromEnv();
  if (!proxy) return '';
  try {
    const { ProxyAgent, setGlobalDispatcher } = await import('undici');
    setGlobalDispatcher(new ProxyAgent(proxy));
    installed = true;
    return proxy;
  } catch (e) {
    console.warn(`[proxy] 配了代理 ${proxyForLog(proxy)} 但装不上,服务端 fetch 仍直连:${e instanceof Error ? e.message : String(e)}`);
    return '';
  }
}

/** 仅供测试:重置安装状态。 */
export function __resetServerProxyForTest() { installed = false; }
