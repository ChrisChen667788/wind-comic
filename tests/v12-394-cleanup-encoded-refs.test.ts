/**
 * v12.394:每天 04:10,清理任务把**正在被引用的成片**当成孤儿删掉。
 *
 * `referencedBasenames()` 从 DB 的 persistent_url / media_urls 里抽文件名,
 * 用的是 `/([A-Za-z0-9._-]+\.(?:mp4|…))/g`。可 DB 里的成片 URL 是
 * `serveFilePathUrl()` 用 encodeURIComponent 生成的:
 *
 *   /api/serve-file?path=%2FUsers%2F…%2Fcomposed%2Ffinal-1788071173502.mp4&sig=…
 *
 * 字符类不含 `%`,匹配从 `2F` 起步 —— 抽出来的是 **`2Ffinal-1788071173502.mp4`**,
 * 而 `sweepDir` 比对的是磁盘上的真名 `final-1788071173502.mp4`。
 * **`referenced.has(f)` 恒为 false。**
 *
 * 而 `referenced.has()` 是这段清理逻辑**唯一**的保护(其余只有 mtime 阈值),
 * 保护恒假 = 所有被引用的成片过了 7 天照删不误。
 *
 * 实测(真实库 + 真实目录):composed 目录 16 个成片,**修复前受保护 0 个**;
 * 库里有 124 条这种 URL 编码形态的资产。owner 那次「30 个项目 534 个素材被清空」,
 * 机制就在这里 —— 当时只记下了现象和「删除类代码必须查引用」的教训,没找到这个正则。
 *
 * launchd 里 `com.qingfeng.windcomic.cleanup` 每天 04:10 真的在跑。
 */
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

const SRC = fs.readFileSync(path.join(process.cwd(), 'app/api/cron/cleanup-media/route.ts'), 'utf-8');
const code = SRC.split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');

/** 复刻修复后的抽名逻辑,用来测行为(route 里的函数没有导出) */
const RE = /([A-Za-z0-9._-]+\.(?:mp4|mov|webm|png|jpe?g|webp|mp3|wav|m4a|srt|edl|xml|aaf))/g;
function extract(raw: string, decode: boolean): Set<string> {
  const out = new Set<string>();
  if (!raw) return out;
  let d = raw;
  if (decode) { try { d = decodeURIComponent(raw); } catch { /* 保持原串 */ } }
  for (const blob of d === raw ? [raw] : [raw, d]) {
    RE.lastIndex = 0;
    for (const m of blob.matchAll(RE)) out.add(m[1]);
  }
  return out;
}

/** owner 库里的真实形态 */
const REAL_URL =
  '/api/serve-file?path=%2FUsers%2Fchenhaorui%2Fai-comic-studio%2Fdata%2Fcomposed%2Ffinal-1788071173502.mp4&sig=5581abcd';
const REAL_NAME = 'final-1788071173502.mp4';

describe('URL 编码路径里的文件名', () => {
  it('旧行为抽出的是带 2F 前缀的错名 —— 保护恒假', () => {
    const old = extract(REAL_URL, false);
    expect(old.has(REAL_NAME), '这就是文件被删的原因').toBe(false);
    expect(old.has('2F' + REAL_NAME), '抽出来的是这个').toBe(true);
  });

  it('修复后抽得到真名', () => {
    expect(extract(REAL_URL, true).has(REAL_NAME)).toBe(true);
  });

  it('未编码的 URL 照旧能抽到(不能为了修编码把普通的弄坏)', () => {
    const plain = '/api/serve-file?key=abc123&name=final-999.mp4';
    expect(extract(plain, true).has('final-999.mp4')).toBe(true);
    expect(extract(plain, true)).toEqual(extract(plain, false));
  });

  it('media_urls 的 JSON 数组形态也能抽', () => {
    const blob = JSON.stringify([REAL_URL, '/api/serve-file?key=k&x=cover-1.png']);
    const s = extract(blob, true);
    expect(s.has(REAL_NAME)).toBe(true);
    expect(s.has('cover-1.png')).toBe(true);
  });

  it('非法转义不抛错,退化为原行为 —— 至少不比以前差', () => {
    const bad = '/api/serve-file?path=%2Fbad%%2Ffinal-7.mp4';
    expect(() => extract(bad, true)).not.toThrow();
    // 解码失败时仍走原串,能抽到什么算什么
    expect(extract(bad, true).size).toBeGreaterThanOrEqual(extract(bad, false).size);
  });

  it('保护名单只会变大,不会变小 —— 它是白名单,宁可多留不可多删', () => {
    for (const u of [REAL_URL, '/api/serve-file?key=abc&f=a.mp4', 'https://cdn/x/b.png', '']) {
      const before = extract(u, false);
      const after = extract(u, true);
      for (const n of before) expect(after.has(n), `${n} 在修复后丢了`).toBe(true);
    }
  });
});

describe('route 接线', () => {
  it('抽名前先 decodeURIComponent', () => {
    const i = code.indexOf('referencedBasenames');
    const end = code.indexOf('return names;', i);
    expect(i).toBeGreaterThan(0);
    expect(end, '窗口右界找不到').toBeGreaterThan(i);
    const win = code.slice(i, end);
    expect(win, '窗口自证').toContain('matchAll');
    expect(win).toContain('decodeURIComponent');
  });

  it('解码失败要兜住 —— 孤立的 % 会让 decodeURIComponent 抛', () => {
    const i = code.indexOf('decodeURIComponent');
    const win = code.slice(Math.max(0, i - 120), i + 200);
    expect(win).toContain('try');
    expect(win).toContain('catch');
  });

  it('读不到引用时一个都不删 —— 这条既有保护不能被本版弄丢', () => {
    expect(code).toMatch(/referenced === null.*return/s);
  });

  it('被引用的文件永不删 —— 唯一的保护,断言它还在', () => {
    expect(code).toMatch(/referenced\.has\(f\)/);
  });
});
