/**
 * v12.321 — 字体自托管,根治「构建期拉 Google Fonts」导致的 CI 假红。
 *
 * ── 病象 ──────────────────────────────────────────────────────────
 * CI 的 Build job 在本会话内连红两次(v12.316、v12.319),报的是
 *   Error while requesting resource
 *   [next]/internal/font/google/…module.css: Module not found:
 *     Can't resolve '@vercel/turbopack-next/internal/font/google/font'
 *   Turbopack build failed with 18 errors
 * 两次都不是代码问题 —— 是 GitHub runner 拉 Google Fonts 抖了一下。
 *
 * ── 为什么值得单独修 ──────────────────────────────────────────────
 * 失败长得**和真的模块解析回归一模一样**,两次我都先怀疑了自己的改动。
 * 一个会周期性误报、且误报形态酷似真故障的门禁,比没有门禁更费人。
 * `next/font/google` 的自托管承诺只覆盖**运行时**;下载发生在构建期。
 *
 * ── 这条测试锁什么 ────────────────────────────────────────────────
 * 改一次没用,得防住有人再引回去 —— 那会让 CI 重新变成看天吃饭。
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const read = (p: string) => fs.readFileSync(p, 'utf-8');
const stripComments = (t: string) =>
  t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

/** 全仓源码(排除 node_modules / .next / 构建产物) */
function sourceFiles(dir = '.', acc: string[] = []): string[] {
  const skip = new Set(['node_modules', '.next', '.git', 'data', 'renders', 'videos', 'assets', 'docs']);
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name.startsWith('.') && e.name !== '.') continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (skip.has(e.name)) continue;
      sourceFiles(p, acc);
    } else if (/\.(ts|tsx)$/.test(e.name)) acc.push(p);
  }
  return acc;
}

describe('v12.321 · 构建不再依赖外网字体', () => {
  it('**全仓不得再 import next/font/google** —— 它在构建期下载,CI 会周期性假红', () => {
    const offenders = sourceFiles()
      .filter((p) => /from ['"]next\/font\/google['"]/.test(stripComments(read(p))));
    expect(offenders, `仍在 import next/font/google: ${offenders.join(', ')}`).toEqual([]);
  });

  it('layout 改用 next/font/local', () => {
    const src = read('app/layout.tsx');
    expect(src).toMatch(/from ['"]next\/font\/local['"]/);
    expect(src).toContain('./fonts/plus-jakarta-sans.woff2');
    expect(src).toContain('./fonts/jetbrains-mono.woff2');
  });

  it('**字体文件真的在仓里**(声明了路径却没文件 = 构建照样炸)', () => {
    for (const f of ['app/fonts/plus-jakarta-sans.woff2', 'app/fonts/jetbrains-mono.woff2']) {
      expect(fs.existsSync(f), `缺文件 ${f}`).toBe(true);
      expect(fs.statSync(f).size, `${f} 太小,不像真字体`).toBeGreaterThan(8000);
    }
  });

  it('是合法 woff2(签名 wOF2),不是下歪的 HTML 错误页', () => {
    for (const f of ['app/fonts/plus-jakarta-sans.woff2', 'app/fonts/jetbrains-mono.woff2']) {
      const head = fs.readFileSync(f).subarray(0, 4).toString('hex');
      expect(head, `${f} 签名不对`).toBe('774f4632');
    }
  });

  it('**用可变字体覆盖原先逐字重的全部档位** —— 少一档就是静默变细/变粗', () => {
    const src = read('app/layout.tsx');
    // 原先 Jakarta 400–800、Mono 400–600,都必须落在声明的 wght 区间内
    const jak = src.match(/plus-jakarta-sans\.woff2[\s\S]{0,120}?weight:\s*"(\d+)\s+(\d+)"/);
    const mono = src.match(/jetbrains-mono\.woff2[\s\S]{0,120}?weight:\s*"(\d+)\s+(\d+)"/);
    expect(jak, '未声明 Jakarta 字重区间').toBeTruthy();
    expect(mono, '未声明 Mono 字重区间').toBeTruthy();
    expect(Number(jak![1])).toBeLessThanOrEqual(400);
    expect(Number(jak![2])).toBeGreaterThanOrEqual(800);
    expect(Number(mono![1])).toBeLessThanOrEqual(400);
    expect(Number(mono![2])).toBeGreaterThanOrEqual(600);
  });

  it('CSS 变量名没变(全站样式按 --font-jakarta / --font-mono 取字体)', () => {
    const src = read('app/layout.tsx');
    expect(src).toContain('--font-jakarta');
    expect(src).toContain('--font-mono');
  });

  it('测试环境 stub 的是 local,且没留下没人用的 google mock(死代码会烂)', () => {
    const setup = read('tests/setup.ts');
    expect(setup).toMatch(/vi\.mock\(['"]next\/font\/local['"]/);
    expect(stripComments(setup), 'google 已无人 import,mock 应一并移除')
      .not.toMatch(/vi\.mock\(['"]next\/font\/google['"]/);
  });
});

describe('v12.321 · 测试清单不得被外来文件截断', () => {
  it('**`.claude/**` 必须排除在 vitest 之外** —— 装进来的技能包自带 *.test.mjs', () => {
    const cfg = read('vitest.config.ts');
    expect(cfg, "未排除 .claude/**").toMatch(/exclude:\s*\[[^\]]*'\.claude\/\*\*'/s);
  });

  it('记下病象:收集期报错会把清单截断,而那个数字会进 README 徽章', () => {
    const cfg = read('vitest.config.ts');
    // 断言注释里留了病因,否则后人只会看到一行神秘的 exclude
    expect(cfg).toMatch(/ERR_INVALID_URL_SCHEME|截断/);
  });

  it('README 徽章的测试数与 vitest 实际声明数同源(靠 sync-doc-stats,不手填)', () => {
    const pkg = JSON.parse(read('package.json'));
    expect(Object.keys(pkg.scripts)).toContain('sync-readme');
    expect(fs.existsSync('scripts/sync-doc-stats.mjs')).toBe(true);
  });
});
