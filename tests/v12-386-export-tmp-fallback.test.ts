/**
 * v12.386:整季导出的「兜底 URL」,在响应发出前就被自己的 finally 删掉了。
 *
 * `POST /api/series/:id/export` 把各集视频 concat 到一个 `mkdtempSync` 临时目录,
 * 然后 persistAsset 落到永久存储。原代码的注释写着
 * 「失败兜底用 tmp serve-file URL」—— 而那个兜底是**自相矛盾**的:
 *
 *   try   { … const videoUrl = persisted?.url || tmpUrl; return Response.json({ videoUrl }) }
 *   finally { fs.rmSync(tmpDir, { recursive: true }) }
 *
 * finally 在 Response 交给 Next 发出**之前**就跑完了。客户端拿到的链接指向一个
 * 已经被删掉的文件 —— 点下载即 404;而且这条死链还被 upsertAsset 写进库,
 * 重进页面依然打不开。ffmpeg 辛苦拼好的整季文件此时已经没了,只能整季重导。
 *
 * 要与别处的 `persisted?.url || 远程URL` 区分开:那些兜底的是引擎 CDN 外链,
 * 会过期但几天内能用,是**降级**;兜底到自己马上要删的临时文件,是**兜了个空**。
 */
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

const P = 'app/api/series/[id]/export/route.ts';
const src = fs.readFileSync(path.join(process.cwd(), P), 'utf-8');
const code = src.split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');

describe('落盘失败不兜空', () => {
  it('不再用 tmpUrl 兜底 —— 那个文件在响应发出前就没了', () => {
    expect(code, 'tmpUrl 只该用作 persistAsset 的输入,不该成为返回给客户端的地址')
      .not.toMatch(/persisted\?\.url\s*\|\|\s*tmpUrl/);
  });

  it('落盘失败 → 显式 502,且文案说清「临时文件即将被清理」', () => {
    const i = code.indexOf('persistAsset(tmpUrl');
    expect(i).toBeGreaterThan(0);
    const win = code.slice(i, i + 700);
    expect(win).toMatch(/if\s*\(!persisted\?\.url\)/);
    expect(win).toContain('502');
    expect(src).toMatch(/临时文件即将被清理/);
    expect(src).toContain('season_persist_failed');
  });

  it('失败时**不写库** —— 写一条死链进去,以后每次打开都是坏的', () => {
    const guardAt = code.indexOf('season_persist_failed');
    const upsertAt = code.indexOf('upsertAsset(');
    expect(guardAt).toBeGreaterThan(0);
    expect(upsertAt).toBeGreaterThan(0);
    expect(guardAt, '守卫必须排在写库之前').toBeLessThan(upsertAt);
  });

  it('成功路径写的是持久 URL,不是可能为 null 的表达式', () => {
    const i = code.indexOf('upsertAsset(');
    const win = code.slice(i, i + 400);
    expect(win).toContain("type: 'season_video'");
    expect(win, 'persistentUrl 不该再写成 `persisted?.url || null`').not.toMatch(/persistentUrl:\s*persisted\?\.url\s*\|\|\s*null/);
  });

  it('finally 仍然清理临时目录 —— 修的是兜底,不是清理', () => {
    // 别把「防磁盘泄漏」一起改掉:tmpDir 该删,只是不能把它当成返回地址
    expect(code).toMatch(/finally\s*\{/);
    expect(code).toContain('fs.rmSync(tmpDir');
  });
});

describe('这条不变量的边界(别一刀切)', () => {
  it('兜底到**远程外链**是合理降级,不在本条禁止之列', () => {
    // series/cover 兜底到引擎返回的 imageUrl —— 会过期但当下能用,和本 bug 性质不同。
    // 这条断言存在的意义是:防止后人读了本版就把所有 `|| 兜底` 一律删掉。
    const cover = fs.readFileSync(path.join(process.cwd(), 'app/api/series/[id]/cover/route.ts'), 'utf-8');
    expect(cover).toMatch(/persisted\?\.url\s*\|\|\s*gen\.result\.imageUrl/);
  });

  it('本路由自己不再有任何指向 tmpDir 的对外 URL', () => {
    // serveFilePathUrl(outputPath) 仍然存在(它是 persistAsset 的入参),
    // 但它不能出现在 Response 或 upsertAsset 的参数里
    const respAt = code.indexOf('NextResponse.json({ ok: true');
    expect(respAt).toBeGreaterThan(0);
    expect(code.slice(respAt, respAt + 200)).not.toContain('tmpUrl');
  });
});
