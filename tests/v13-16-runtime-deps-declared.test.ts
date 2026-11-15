/**
 * v13.16:运行时代码 import 的 npm 包,必须在 package.json 的 dependencies(或 optionalDependencies)里声明。
 *
 * 起因:`lib/server-proxy.ts` 在配了 HTTPS_PROXY 时 `await import('undici')` 装代理 dispatcher(instrumentation 启动时调),
 * 但 undici 从没声明过 —— 只因为 devDependency jsdom 依赖它、被提升到 node_modules 顶层才「碰巧在」。
 * 实测(v13.16 发版说明有细节):Turbopack 构建时把 undici 内联进 .next,构建后再 `npm ci --omit=dev`
 * 不受影响;可**构建时**解析不到它,Turbopack 只给 warning,把 import 编译成运行时必抛 MODULE_NOT_FOUND
 * 的桩,catch 再吞成 '' —— 服务端照旧直连,只走代理的网关全部超时,日志里一个字没有。
 * 之前没出事,只是因为 TS 类型检查碰巧也找不到 undici 的类型、把构建拦下了。
 * 而 better-sqlite3 / sharp / puppeteer 等外部包(.next/node_modules 里的软链)是**运行时**才从
 * node_modules 加载的 —— 对它们,只装生产依赖时装不装上直接决定功能在不在。
 *
 * 这份测试管三件事:
 * 1. **解析**(不是 grep)运行时目录里每个文件的 import / export from / import() / require / require.resolve,
 *    包名必须已声明;只用作类型的导入不算(编译后擦除)。故意不进生产依赖的登记在 DEV_ONLY,
 *    并要求「try 里的动态 import」—— 装不上时接口要能报错,而不是整个模块加载失败。
 * 2. lockfile 里这些包都不带 `dev: true` —— `npm ci --omit=dev` 就是按这个标记跳过的。
 * 3. undici:≥ 7.30.1(GHSA-xjj6-f33q-929c 修复版,不许回退)且停在 7.x(8.x 要求 Node ≥ 22.19,本仓还支持 Node 20);
 *    并真跑:Node 自带的全局 fetch 经 installServerProxy 装上的 dispatcher 走本地代理(CI 的 Node 20 / 22 各跑一遍)。
 *
 * 环境用默认的 jsdom(tests/setup.ts 要 window);jsdom 不带 fetch,`fetch` 仍是 Node 自带的那个 —— 第一条真跑用例的对照组会证明这一点。
 */
import { describe, it, expect, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import http from 'http';
import net from 'net';
import { builtinModules } from 'module';
import ts from 'typescript';

const ROOT = process.cwd();
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const PKG = JSON.parse(read('package.json'));
const LOCK = JSON.parse(read('package-lock.json'));

// ─── 扫描器 ────────────────────────────────────────────────────────────────

type Kind = 'import' | 'export' | 'import=' | 'import()' | 'require' | 'require.resolve';
interface Hit { file: string; line: number; spec: string; kind: Kind; inTry: boolean }

/** 一份源码里运行时会加载的模块说明符;说明符不是字面量的动态加载只记行号(扫描器看不见它加载什么)。 */
function scanSource(file: string, code: string): { hits: Hit[]; nonLiteral: number[] } {
  const sf = ts.createSourceFile(file, code, ts.ScriptTarget.Latest, true);
  const hits: Hit[] = [];
  const nonLiteral: number[] = [];
  const lineOf = (n: ts.Node) => sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1;
  const add = (spec: string, n: ts.Node, kind: Kind, inTry: boolean) => hits.push({ file, line: lineOf(n), spec, kind, inTry });

  const visit = (n: ts.Node, inTry: boolean): void => {
    if (ts.isTryStatement(n)) {
      visit(n.tryBlock, true);
      if (n.catchClause) visit(n.catchClause, inTry);
      if (n.finallyBlock) visit(n.finallyBlock, inTry);
      return;
    }
    // 函数体换了执行时机,外层的 try 不一定罩得住它 —— 保守地当作不在 try 里
    if (ts.isFunctionLike(n)) inTry = false;

    if (ts.isImportDeclaration(n)) {
      const c = n.importClause;
      const typeOnly = !!c && (c.isTypeOnly || (!c.name && !!c.namedBindings && ts.isNamedImports(c.namedBindings)
        && c.namedBindings.elements.length > 0 && c.namedBindings.elements.every((e) => e.isTypeOnly)));
      if (!typeOnly && ts.isStringLiteral(n.moduleSpecifier)) add(n.moduleSpecifier.text, n, 'import', inTry);
    } else if (ts.isExportDeclaration(n) && n.moduleSpecifier && ts.isStringLiteral(n.moduleSpecifier)) {
      const typeOnly = n.isTypeOnly || (!!n.exportClause && ts.isNamedExports(n.exportClause)
        && n.exportClause.elements.length > 0 && n.exportClause.elements.every((e) => e.isTypeOnly));
      if (!typeOnly) add(n.moduleSpecifier.text, n, 'export', inTry);
    } else if (ts.isImportEqualsDeclaration(n) && ts.isExternalModuleReference(n.moduleReference) && !n.isTypeOnly) {
      const e = n.moduleReference.expression;
      if (ts.isStringLiteral(e)) add(e.text, n, 'import=', inTry);
    } else if (ts.isCallExpression(n)) {
      const e = n.expression;
      const kind: Kind | null =
        e.kind === ts.SyntaxKind.ImportKeyword ? 'import()'
        : ts.isIdentifier(e) && e.text === 'require' ? 'require'
        : ts.isPropertyAccessExpression(e) && ts.isIdentifier(e.expression) && e.expression.text === 'require' && e.name.text === 'resolve' ? 'require.resolve'
        : null;
      if (kind) {
        const a = n.arguments[0];
        if (a && ts.isStringLiteralLike(a)) add(a.text, n, kind, inTry);
        else nonLiteral.push(lineOf(n));
      }
    }
    ts.forEachChild(n, (c) => visit(c, inTry));
  };
  visit(sf, false);
  return { hits, nonLiteral };
}

const BUILTIN = new Set(builtinModules);
/** 说明符 → npm 包名;相对路径、`@/` 别名、Node 内置返回 null。 */
function packageOf(spec: string): string | null {
  if (spec.startsWith('.') || spec.startsWith('/') || spec.startsWith('@/') || spec.startsWith('node:')) return null;
  const name = spec.startsWith('@') ? spec.split('/').slice(0, 2).join('/') : spec.split('/')[0];
  return BUILTIN.has(name) ? null : name;
}

/** 进 Next 服务端 / 客户端包的代码。`@/` 别名指向的顶层目录都要在这里(下面有用例校验)。 */
const RUNTIME_DIRS = ['app', 'components', 'lib', 'services', 'hooks', 'stores', 'types'];
/** `next start` 运行时加载的根文件;middleware.ts / proxy.ts 是 Next 16 前后两种叫法,存在才扫。 */
const RUNTIME_FILES = ['instrumentation.ts', 'next.config.ts', 'middleware.ts', 'proxy.ts'];

let cached: { files: string[]; hits: Hit[]; nonLiteral: Map<string, number[]> } | null = null;
function scanRuntime() {
  if (cached) return cached;
  const files: string[] = [];
  const walk = (rel: string) => {
    const abs = path.join(ROOT, rel);
    if (fs.statSync(abs).isDirectory()) {
      for (const e of fs.readdirSync(abs)) if (e !== 'node_modules') walk(path.join(rel, e));
    } else if (/\.(ts|tsx|js|jsx|mjs|cjs)$/.test(rel) && !rel.endsWith('.d.ts')) {
      files.push(rel.split(path.sep).join('/'));
    }
  };
  for (const d of RUNTIME_DIRS) walk(d);
  for (const f of RUNTIME_FILES) if (fs.existsSync(path.join(ROOT, f))) walk(f);
  const hits: Hit[] = [];
  const nonLiteral = new Map<string, number[]>();
  for (const f of files) {
    const r = scanSource(f, read(f));
    hits.push(...r.hits);
    if (r.nonLiteral.length) nonLiteral.set(f, r.nonLiteral);
  }
  cached = { files, hits, nonLiteral };
  return cached;
}

// ─── 登记表 ────────────────────────────────────────────────────────────────

/** 运行时用到、但故意不进生产依赖的包:必须仍在 devDependencies、只在这些文件里、只用 try 里的动态 import。 */
const DEV_ONLY: Record<string, { files: string[]; why: string }> = {
  puppeteer: {
    files: ['app/api/projects/[id]/pull-sheet/route.ts'],
    why: '剧本册 PDF 导出要整套 Chrome(安装时另下 ~150MB),不进生产依赖;import 失败时接口回 500 并提示改用 md / csv 导出',
  },
};

/** 说明符不是字面量的动态加载 —— 扫描器看不见它加载什么,新出现一处就要有人看一眼。 */
const NON_LITERAL: Record<string, string> = {
  'lib/db-driver.ts': "变量里是 'pg'(已在 dependencies);用变量是为了不让打包器在构建期解析",
  'lib/telemetry.ts': '@sentry/nextjs:可选、未声明;只在配了 SENTRY_DSN 时加载,失败被 .catch 兜住',
  'lib/image-providers/registry.ts': '用户放在本地的插件文件(file:// URL),不是 npm 包',
  'lib/tts-providers/registry.ts': '用户放在本地的插件文件,不是 npm 包',
  'lib/video-providers/registry.ts': '用户放在本地的插件文件,不是 npm 包',
};

const declared = new Set([...Object.keys(PKG.dependencies ?? {}), ...Object.keys(PKG.optionalDependencies ?? {})]);
const runtimePackages = () => [...new Set(scanRuntime().hits.map((h) => packageOf(h.spec)).filter((p): p is string => !!p))].sort();

// ─── 用例 ──────────────────────────────────────────────────────────────────

describe('v13.16 扫描器自检 —— 门禁本身不能假绿', () => {
  const pkgs = (code: string) => scanSource('x.ts', code).hits.map((h) => packageOf(h.spec)).filter(Boolean);

  it('各种写法都抓得到:多行 import、副作用 import、export from、import()、require、require.resolve、import = require', () => {
    const code = `
      import {
        a,
        b,
      } from 'multi-line-pkg';
      import 'side-effect-pkg/style.css';
      export * from 'reexport-pkg';
      export { x } from '@scope/named/sub';
      import def, { type T } from 'mixed-pkg';
      import X = require('eq-pkg');
      async function f() {
        const m = await import('dyn-pkg');
        const r = require('req-pkg/deep/file.js');
        return require.resolve('resolve-pkg/package.json');
      }`;
    expect(pkgs(code)).toEqual([
      'multi-line-pkg', 'side-effect-pkg', 'reexport-pkg', '@scope/named', 'mixed-pkg', 'eq-pkg', 'dyn-pkg', 'req-pkg', 'resolve-pkg',
    ]);
  });

  it('只用作类型的导入不算 —— 编译后被擦掉,运行时不加载', () => {
    const code = `
      import type { A } from 'type-only-a';
      import { type B, type C } from 'type-only-b';
      export type { D } from 'type-only-c';
      type E = import('type-only-d').E;`;
    expect(pkgs(code)).toEqual([]);
  });

  it('相对路径、@/ 别名、Node 内置(含 node: 前缀和 fs/promises 这类子路径)不算包', () => {
    const code = `import fs from 'fs'; import fsp from 'fs/promises'; import { join } from 'node:path';
      import y from './y'; import z from '@/lib/z';`;
    expect(pkgs(code)).toEqual([]);
  });

  it('注释和字符串里出现的包名不算 —— 这正是不用 grep 的原因', () => {
    expect(pkgs(`// import x from 'comment-pkg'\nconst s = "require('string-pkg')";`)).toEqual([]);
  });

  it('说明符不是字面量的动态加载单独报出来', () => {
    expect(scanSource('x.ts', `const n = 'pg';\nawait import(n);\nrequire(n);`).nonLiteral).toEqual([2, 3]);
  });

  it('try 块里的 import() 标成 inTry;函数体里的另算(执行时机不同)', () => {
    const { hits } = scanSource('x.ts', `
      try { await import('in-try'); } catch {}
      await import('no-try');
      try { const f = async () => import('in-fn'); } catch {}`);
    expect(hits.map((h) => [h.spec, h.inTry])).toEqual([['in-try', true], ['no-try', false], ['in-fn', false]]);
  });
});

describe('v13.16 运行时代码 import 的包都已声明', () => {
  it('扫描确实覆盖了运行时代码(正向信号:扫不到东西不能算绿)', () => {
    const { files } = scanRuntime();
    expect(files.length).toBeGreaterThan(500);
    expect(files).toContain('lib/server-proxy.ts');
    expect(files).toContain('instrumentation.ts');
    expect(runtimePackages()).toEqual(expect.arrayContaining(['next', 'react', 'undici', 'yjs']));
  });

  it('@/ 别名指向的顶层目录都在扫描范围里 —— 新加目录不会漏扫', () => {
    const tops = new Set(scanRuntime().hits.filter((h) => h.spec.startsWith('@/')).map((h) => h.spec.split('/')[1]));
    expect([...tops].filter((t) => !RUNTIME_DIRS.includes(t))).toEqual([]);
  });

  it('每个包都在 dependencies / optionalDependencies 里(只靠别的包间接装上不算)', () => {
    const undeclared = scanRuntime().hits
      .map((h) => ({ h, p: packageOf(h.spec) }))
      .filter((x): x is { h: Hit; p: string } => !!x.p && !declared.has(x.p) && !(x.p in DEV_ONLY))
      .map(({ h, p }) => `${h.file}:${h.line} ${h.kind} '${h.spec}' → ${p}${PKG.devDependencies?.[p] ? '(只在 devDependencies)' : '(package.json 里没有)'}`);
    expect(undeclared, '运行时 import 了没声明的包;只靠别的包间接装上,换安装方式或那个包不再依赖它时就会找不到').toEqual([]);
  });

  it('DEV_ONLY 登记项:仍只在 devDependencies、只在登记的文件里、只用 try 里的动态 import', () => {
    for (const [p, { files }] of Object.entries(DEV_ONLY)) {
      expect(PKG.devDependencies?.[p], `${p} 已不在 devDependencies,把它从 DEV_ONLY 删掉`).toBeDefined();
      expect(declared.has(p), `${p} 已进生产依赖,把它从 DEV_ONLY 删掉`).toBe(false);
      const sites = scanRuntime().hits.filter((h) => packageOf(h.spec) === p);
      expect([...new Set(sites.map((h) => h.file))].sort()).toEqual([...files].sort());
      for (const h of sites) {
        expect({ at: `${h.file}:${h.line}`, kind: h.kind, inTry: h.inTry }).toEqual({ at: `${h.file}:${h.line}`, kind: 'import()', inTry: true });
      }
    }
  });

  it('说明符不是字面量的动态加载只出现在登记过的文件里', () => {
    expect([...scanRuntime().nonLiteral.keys()].sort()).toEqual(Object.keys(NON_LITERAL).sort());
    expect(PKG.dependencies.pg, "lib/db-driver.ts 用变量加载 'pg',它必须已声明").toBeDefined();
  });
});

describe('v13.16 lockfile:只装生产依赖时这些包也会装上', () => {
  it('lockfile 根条目与 package.json 的声明一致(改了 package.json 没重生成 lockfile 会在这里红)', () => {
    const root = LOCK.packages[''];
    expect(root.dependencies).toEqual(PKG.dependencies);
    expect(root.optionalDependencies ?? {}).toEqual(PKG.optionalDependencies ?? {});
  });

  it('运行时 import 的每个包在 lockfile 里都不带 dev: true(npm ci --omit=dev 按这个标记跳过)', () => {
    const bad = runtimePackages()
      .filter((p) => !(p in DEV_ONLY))
      .filter((p) => !LOCK.packages[`node_modules/${p}`] || LOCK.packages[`node_modules/${p}`].dev === true);
    expect(bad).toEqual([]);
  });
});

/** `^7.30.1` → [7, 30, 1];不是 caret 的写法返回 null(这里要求 caret,方便判断大版本)。 */
const caret = (range: string) => {
  const m = /^\^(\d+)\.(\d+)\.(\d+)$/.exec(range ?? '');
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
};
const atLeast = (v: number[], min: number[]) => v[0] !== min[0] ? v[0] > min[0] : v[1] !== min[1] ? v[1] > min[1] : v[2] >= min[2];

describe('v13.16 undici:声明、范围与真跑', () => {
  it('在 dependencies 里,不在 devDependencies 里', () => {
    expect(PKG.dependencies.undici).toBeDefined();
    expect(PKG.devDependencies?.undici).toBeUndefined();
  });

  it('下限 ≥ 7.30.1 —— 不许回退到 GHSA-xjj6-f33q-929c 修复之前', () => {
    const v = caret(PKG.dependencies.undici);
    expect(v, `undici 的范围要写成 ^x.y.z,现在是 ${PKG.dependencies.undici}`).not.toBeNull();
    expect(atLeast(v!, [7, 30, 1])).toBe(true);
    const locked = LOCK.packages['node_modules/undici'].version.split('.').map(Number);
    expect(atLeast(locked, [7, 30, 1])).toBe(true);
  });

  it('停在 7.x:8.x 要求 Node ≥ 22.19,而本仓 engines / Docker / CI 还支持 Node 20', () => {
    // 解锁条件:三处都不再有 Node 20 时,这条会提示可以升 8.x
    const engineMin = Number(/(\d+)/.exec(PKG.engines.node)![1]);
    const dockerNode = Number(/ARG NODE_VERSION=(\d+)/.exec(read('Dockerfile'))![1]);
    const ciHas20 = /node-version:\s*\[[^\]]*\b20\.x/.test(read('.github/workflows/ci.yml'));
    const supportsNode20 = engineMin < 22 || dockerNode < 22 || ciHas20;
    expect(supportsNode20, '已不再支持 Node 20:可以把 undici 升到 8.x 并改这条').toBe(true);
    expect(caret(PKG.dependencies.undici)![0]).toBe(7);
    expect(LOCK.packages['node_modules/undici'].version.split('.')[0]).toBe('7');
  });

  it('overrides 用 $undici 引用,不另写范围(与直接依赖不一致时 npm 报 EOVERRIDE)', () => {
    expect(PKG.overrides.undici).toBe('$undici');
  });

  const PROXY_ENV = ['HTTPS_PROXY', 'https_proxy', 'HTTP_PROXY', 'http_proxy', 'ALL_PROXY', 'all_proxy'];
  const DISPATCHER = Symbol.for('undici.globalDispatcher.1');
  const g = globalThis as unknown as Record<symbol, { close?: () => Promise<void> } | undefined>;
  const withProxyEnv = async (proxy: string, fn: () => Promise<void>) => {
    const saved = Object.fromEntries(PROXY_ENV.map((k) => [k, process.env[k]]));
    for (const k of PROXY_ENV) delete process.env[k];
    process.env.HTTPS_PROXY = proxy;
    try { await fn(); } finally {
      for (const k of PROXY_ENV) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
    }
  };
  const listen = (s: net.Server) => new Promise<number>((r) => s.listen(0, '127.0.0.1', () => r((s.address() as net.AddressInfo).port)));

  it('真跑:installServerProxy 装上后,Node 自带的全局 fetch 经本地代理出去(装之前不经过 —— 对照组)', async () => {
    const target = http.createServer((req, res) => res.end(`target:${req.url}`));
    const seen: string[] = [];
    const sockets = new Set<net.Socket>();
    const proxy = http.createServer((req, res) => { seen.push(`${req.method} ${req.url}`); res.writeHead(502).end(); });
    proxy.on('connection', (s) => sockets.add(s));
    proxy.on('connect', (req, client: net.Socket, head) => {
      seen.push(`CONNECT ${req.url}`);
      const [host, port] = String(req.url).split(':');
      const up = net.connect(Number(port), host, () => {
        client.write('HTTP/1.1 200 Connection Established\r\n\r\n');
        up.write(head);
        up.pipe(client);
        client.pipe(up);
      });
      sockets.add(up);
      up.on('error', () => client.destroy());
      client.on('error', () => up.destroy());
    });
    const tPort = await listen(target);
    const pPort = await listen(proxy);
    const before = g[DISPATCHER];
    vi.resetModules();
    const mod = await import('@/lib/server-proxy');
    mod.__resetServerProxyForTest();
    try {
      await withProxyEnv(`http://127.0.0.1:${pPort}`, async () => {
        // 对照组:还没装,直连
        expect(await (await fetch(`http://127.0.0.1:${tPort}/direct`)).text()).toBe('target:/direct');
        expect(seen).toEqual([]);

        expect(await mod.installServerProxy()).toBe(`http://127.0.0.1:${pPort}`);
        expect(await (await fetch(`http://127.0.0.1:${tPort}/via-proxy`)).text()).toBe('target:/via-proxy');
        expect(seen).toEqual([`CONNECT 127.0.0.1:${tPort}`]);
      });
    } finally {
      // 还原全局 dispatcher —— 测试文件同进程串行跑,别让后面的测试也走这个代理
      if (g[DISPATCHER] !== before) await g[DISPATCHER]?.close?.().catch(() => {});
      g[DISPATCHER] = before;
      mod.__resetServerProxyForTest();
      for (const s of sockets) s.destroy();
      target.closeAllConnections();
      await Promise.all([target, proxy].map((s) => new Promise((r) => s.close(r))));
    }
  });

  it('真跑反面:undici 加载失败时不抛、返回空串并打 warn,地址里的密码不进日志', async () => {
    const before = g[DISPATCHER];
    vi.resetModules();
    vi.doMock('undici', () => { throw new Error("Cannot find package 'undici'"); });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const mod = await import('@/lib/server-proxy');
      mod.__resetServerProxyForTest();
      await withProxyEnv('http://user:s3cret@127.0.0.1:9', async () => {
        await expect(mod.installServerProxy()).resolves.toBe('');
      });
      expect(warn).toHaveBeenCalledTimes(1);
      const msg = String(warn.mock.calls[0][0]);
      expect(msg).toContain('装不上');
      expect(msg).toContain('//***@127.0.0.1:9');
      expect(msg).not.toContain('s3cret');
      expect(g[DISPATCHER]).toBe(before);
      mod.__resetServerProxyForTest();
    } finally {
      warn.mockRestore();
      vi.doUnmock('undici');
      vi.resetModules();
    }
  });

  it('日志里的代理地址去掉账号密码,没有账号密码的原样', async () => {
    const { proxyForLog } = await import('@/lib/server-proxy');
    expect(proxyForLog('http://user:pa:ss@proxy.local:7890')).toBe('http://***@proxy.local:7890');
    expect(proxyForLog('http://127.0.0.1:7890')).toBe('http://127.0.0.1:7890');
    expect(proxyForLog('socks5://u@h:1080')).toBe('socks5://***@h:1080');
    expect(proxyForLog('http://u:p@ss@h:1/x@y')).toBe('http://***@h:1/x@y'); // 密码里带 @ 也要整段盖住
  });
});
