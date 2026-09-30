/**
 * v12.461 — Vidu 主机默认值只能有一份。
 *
 * ── 怎么发现的 ────────────────────────────────────────────────────────
 * v12.403 按官方字段表重写 vidu.service 时,把主机默认值改成了 api.vidu.com,
 * 但**写在 service 自己的构造函数里**;`lib/config.ts` 的 `API_CONFIG.vidu.baseURL`
 * 仍是历史默认 api.vidu.ai(打不到官方接口)。两份默认值一对一错,而错的那份
 * 恰好没有读者 —— 所以测试全绿、没人发现。它是一颗埋好的雷:谁先图方便接上
 * `API_CONFIG.vidu.baseURL`,流量就打到错的主机上,而症状只是「Vidu 又失败了,
 * 静默回落 Kling」,和 v12.403 之前一模一样。部署文档的默认值列也还写着 .ai。
 *
 * 修法:默认值只留 `lib/config.ts` 一处(getter,构造时读 env,保持 service 原来的时机),
 * service 改读它。
 *
 * ── 这条测试锁什么 ────────────────────────────────────────────────────
 * 1. 唯一默认值是官方主机,且 service 发出的请求真的打到它 —— 断言行为,不断言写法;
 * 2. 全仓源码(按 AST 取字符串字面量,不是 grep 原文)里 Vidu 主机只出现一次、在 config;
 *    `process.env.VIDU_BASE_URL` 也只有 config 读 —— 第二份默认值就是这么长出来的;
 * 3. 对外文档(DEPLOYMENT.md 环境变量表、.env.example)写的默认值与代码一致。
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import fs from 'node:fs';
import { execSync } from 'node:child_process';
import ts from 'typescript';
import { API_CONFIG } from '@/lib/config';
import { ViduService } from '@/services/vidu.service';

const OFFICIAL = 'https://api.vidu.com';

/**
 * 在「VIDU_BASE_URL = value(undefined 即未设置)」下执行 fn,结束后原样还原。
 * fn 返回 Promise 时等它落定再还原 —— 否则 env 在第一个 await 处就被换回去了。
 */
function withEnv<T>(value: string | undefined, fn: () => T): T {
  const prev = process.env.VIDU_BASE_URL;
  const restore = () => {
    if (prev === undefined) delete process.env.VIDU_BASE_URL;
    else process.env.VIDU_BASE_URL = prev;
  };
  if (value === undefined) delete process.env.VIDU_BASE_URL;
  else process.env.VIDU_BASE_URL = value;
  let out: T;
  try {
    out = fn();
  } catch (e) {
    restore();
    throw e;
  }
  if (out instanceof Promise) return out.finally(restore) as T;
  restore();
  return out;
}

/** 构造 service 并截下它发出的第一个请求的 URL(第一个请求就让它失败,不走轮询) */
async function firstRequestUrl(): Promise<string> {
  const urls: string[] = [];
  vi.stubGlobal('fetch', vi.fn(async (url: unknown) => {
    urls.push(String(url));
    return { ok: false, status: 418, text: async () => 'stop' } as unknown as Response;
  }));
  const svc = new ViduService();
  await expect(svc.generateVideo('https://x/first.png', '一个镜头')).rejects.toThrow(/418/);
  expect(urls, '应当恰好发出一个请求').toHaveLength(1);
  return urls[0];
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('v12.461 · Vidu 主机默认值单一真源', () => {
  it('唯一默认值是官方主机 api.vidu.com', () => {
    expect(withEnv(undefined, () => API_CONFIG.vidu.baseURL)).toBe(OFFICIAL);
  });

  it('service 的请求打到 config 给的主机 —— 未配置时是官方主机', async () => {
    const url = await withEnv(undefined, () => firstRequestUrl());
    expect(url).toBe(`${OFFICIAL}/ent/v2/img2video`);
  });

  it('进程起来之后再设 VIDU_BASE_URL,config 与 service 一起跟随(不是模块加载时就冻结)', async () => {
    const custom = 'https://vidu-proxy.example.test';
    await withEnv(custom, async () => {
      expect(API_CONFIG.vidu.baseURL).toBe(custom);
      expect(await firstRequestUrl()).toBe(`${custom}/ent/v2/img2video`);
    });
  });

  describe('全仓源码扫描(AST)', () => {
    const files = execSync('git ls-files', { encoding: 'utf-8', maxBuffer: 64 * 1024 * 1024 })
      .split('\n')
      .filter((f) => /\.(ts|tsx|js|mjs|cjs)$/.test(f))
      .filter((f) => !/^(tests|e2e)\//.test(f) && !f.includes('node_modules/'))
      .filter((f) => fs.existsSync(f));

    /** 字符串字面量里出现 Vidu 主机的位置 */
    const hostHits: string[] = [];
    /** 读 process.env.VIDU_BASE_URL 的位置 */
    const envReads: string[] = [];

    for (const f of files) {
      const text = fs.readFileSync(f, 'utf-8');
      // 预筛只为省时间:两类命中都必然含有这个子串(大小写不敏感)
      if (!/vidu/i.test(text)) continue;
      const sf = ts.createSourceFile(f, text, ts.ScriptTarget.Latest, true,
        f.endsWith('x') ? ts.ScriptKind.TSX : f.endsWith('.ts') ? ts.ScriptKind.TS : ts.ScriptKind.JS);
      const at = (n: ts.Node) => `${f}:${sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1}`;
      const isProcessEnv = (e: ts.Expression) => e.getText(sf).replace(/\s/g, '') === 'process.env';
      const visit = (n: ts.Node): void => {
        if ((ts.isStringLiteralLike(n) || ts.isTemplateLiteralToken(n)) && /api\.vidu\./i.test(n.text)) {
          hostHits.push(at(n));
        }
        if (ts.isPropertyAccessExpression(n) && n.name.text === 'VIDU_BASE_URL' && isProcessEnv(n.expression)) {
          envReads.push(at(n));
        }
        if (ts.isElementAccessExpression(n) && ts.isStringLiteralLike(n.argumentExpression)
          && n.argumentExpression.text === 'VIDU_BASE_URL' && isProcessEnv(n.expression)) {
          envReads.push(at(n));
        }
        if (ts.isBindingElement(n) && (n.propertyName ?? n.name).getText(sf) === 'VIDU_BASE_URL') {
          envReads.push(at(n));
        }
        ts.forEachChild(n, visit);
      };
      visit(sf);
    }

    it('扫描的数据源本身可用(否则「没扫到」会被当成「没问题」)', () => {
      expect(files.length).toBeGreaterThan(500);
      expect(files).toContain('lib/config.ts');
      expect(files).toContain('services/vidu.service.ts');
    });

    it('Vidu 主机在源码字面量里只出现一次,且就在 lib/config.ts', () => {
      expect(hostHits).toHaveLength(1);
      expect(hostHits[0]).toMatch(/^lib\/config\.ts:\d+$/);
    });

    it('只有 lib/config.ts 读 process.env.VIDU_BASE_URL', () => {
      expect(envReads).toHaveLength(1);
      expect(envReads[0]).toMatch(/^lib\/config\.ts:\d+$/);
    });
  });

  describe('对外文档的默认值与代码一致', () => {
    const codeDefault = withEnv(undefined, () => API_CONFIG.vidu.baseURL);

    it('DEPLOYMENT.md 环境变量表的「默认值」列', () => {
      const rows = fs.readFileSync('docs/DEPLOYMENT.md', 'utf-8')
        .split('\n')
        .filter((l) => l.trim().startsWith('|'))
        .map((l) => l.split('|').slice(1, -1).map((c) => c.trim().replace(/^`|`$/g, '')));
      const row = rows.filter((cells) => cells[0] === 'VIDU_BASE_URL');
      expect(row, '环境变量表里应当恰好有一行 VIDU_BASE_URL').toHaveLength(1);
      expect(row[0][2]).toBe(codeDefault);
    });

    it('.env.example 里的示例值', () => {
      const values = fs.readFileSync('.env.example', 'utf-8')
        .split('\n')
        .map((l) => l.match(/^\s*VIDU_BASE_URL=(.*)$/)?.[1]?.trim())
        .filter((v): v is string => v !== undefined);
      expect(values).toEqual([codeDefault]);
    });
  });
});
