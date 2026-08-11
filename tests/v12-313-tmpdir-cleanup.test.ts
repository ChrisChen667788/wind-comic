/**
 * v12.313 — 临时目录在异常路径不清,一次失败泄漏 100MB–1GB。
 *
 * 三处(`reframeVideo` / `concatVideos` / `concatVideosSimple`)都是
 * `mkdtempSync` 建目录、把源视频下载进去、ffmpeg 出错就直接 `reject` —— 目录永远没人删。
 *
 * 量级:整季拼接失败会留下**所有已下载的分集**(10 集 × 100MB ≈ 1GB),
 * 而整季拼接恰恰是最容易因某一集损坏而失败的操作;
 * `concatVideosSimple` 更严重 —— 它的成品写在 `persistentOutputDir`,
 * tmpDir 里**全是中间产物**,所以**每次调用都泄漏**(8 片 × 20-50MB)。
 *
 * ── 审计的修法建议里漏了一个关键区别 ──────────────────────────────
 * 这些函数的目录是 `outputDir || mkdtempSync(...)`:**调用方传进来的目录归调用方所有**,
 * 删它就是删别人的东西。所以清理必须带 `ownsTmp` 判断 —— 只清自己建的。
 * 另外 `reframeVideo` / `concatVideos` 的**产物就在 tmpDir 里**,成功时不能删;
 * 只有 `concatVideosSimple` 因产物在别处,成功也该清。三者行为刻意不同。
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const strip = (t: string) =>
  t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const SRC = strip(fs.readFileSync('services/video-composer.ts', 'utf-8'));

/** 取某个导出函数的函数体(到下一个顶层 export 为止)—— 窗口开大会切进邻居,这轮栽过 */
/** 只取某个 .on('xxx', ...) 处理器自身 —— 不能用固定字符窗口:
 *  `.on('end', ...)` 之后紧跟 `.on('error', ...)`,窗口一大就把邻居的 cleanup 匹配进来。 */
const handlerOf = (body: string, ev: string) => {
  const i = body.indexOf(`.on('${ev}'`);
  if (i < 0) return '';
  const j = body.indexOf(".on('", i + 6);
  return body.slice(i, j < 0 ? body.indexOf('.run()', i) : j);
};

const bodyOf = (name: string) => {
  const i = SRC.indexOf(`export async function ${name}(`);
  if (i < 0) return '';
  const j = SRC.indexOf('\nexport ', i + 10);
  return SRC.slice(i, j < 0 ? undefined : j);
};

describe('v12.313 · 只清自己建的目录', () => {
  it('三处都记录了「目录是不是自己建的」', () => {
    for (const fn of ['reframeVideo', 'concatVideos', 'concatVideosSimple']) {
      expect(bodyOf(fn), `${fn} 缺 _ownsTmp`).toContain('_ownsTmp');
    }
  });

  it('清理函数把 owned 当**前置条件**,不是事后判断', () => {
    const i = SRC.indexOf('function cleanupOwnedTmp');
    expect(i, '未找到清理函数').toBeGreaterThan(0);
    const body = SRC.slice(i, i + 500);
    expect(body).toMatch(/if \(!owned \|\| !dir\) return/);
  });

  it('清理失败不抛错(清不掉不该反过来把出片打挂)', () => {
    const i = SRC.indexOf('function cleanupOwnedTmp');
    const body = SRC.slice(i, i + 500);
    expect(body).toContain('catch');
    expect(body).toMatch(/console\.warn/);
  });

  it('用 recursive+force,避免目录非空或已被删时抛错', () => {
    const i = SRC.indexOf('function cleanupOwnedTmp');
    expect(SRC.slice(i, i + 500)).toMatch(/recursive: true, force: true/);
  });
});

describe('v12.313 · 三处的清理时机刻意不同', () => {
  it('reframeVideo:**只在失败时清**(成功时产物就在目录里)', () => {
    const b = bodyOf('reframeVideo');
    expect(handlerOf(b, 'error'), 'error 分支要清').toContain('cleanupOwnedTmp');
    expect(handlerOf(b, 'end'), 'end 分支不能清 —— 产物在目录里').not.toContain('cleanupOwnedTmp');
  });

  it('reframeVideo:源不存在这条早退路径也要清(否则下载好的源白留)', () => {
    const b = bodyOf('reframeVideo');
    const i = b.indexOf('源不存在');
    expect(b.slice(Math.max(0, i - 200), i)).toContain('cleanupOwnedTmp');
  });

  it('concatVideos:同样只在失败时清', () => {
    const b = bodyOf('concatVideos');
    expect(handlerOf(b, 'error')).toContain('cleanupOwnedTmp');
    expect(handlerOf(b, 'end')).not.toContain('cleanupOwnedTmp');
  });

  it('**concatVideosSimple:成功也要清** —— 产物在 persistentOutputDir,tmpDir 全是中间产物', () => {
    const b = bodyOf('concatVideosSimple');
    expect(handlerOf(b, 'end'), 'end 分支必须清').toContain('cleanupOwnedTmp');
    expect(handlerOf(b, 'error'), 'error 分支也要清').toContain('cleanupOwnedTmp');
    expect(b, '产物确实不在 tmpDir').toContain('persistentOutputDir');
  });
});

describe('v12.313 · 清理行为真跑一遍', () => {
  /** 复刻 cleanupOwnedTmp 的语义,验证「不删别人的目录」这条前置条件 */
  const cleanup = (dir: string, owned: boolean) => {
    if (!owned || !dir) return;
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* 不抛 */ }
  };

  it('owned=true:目录连同内容一起删掉', () => {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), 'v313-own-'));
    fs.writeFileSync(path.join(d, 'clip-0.mp4'), 'x');
    cleanup(d, true);
    expect(fs.existsSync(d)).toBe(false);
  });

  it('**owned=false:一个字节都不动**(调用方传进来的目录归调用方)', () => {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), 'v313-caller-'));
    fs.writeFileSync(path.join(d, 'keep.mp4'), 'x');
    cleanup(d, false);
    expect(fs.existsSync(d), '删了别人的目录').toBe(true);
    expect(fs.existsSync(path.join(d, 'keep.mp4'))).toBe(true);
    fs.rmSync(d, { recursive: true, force: true });
  });

  it('目录已不存在时不抛错(重复清理 / 外部先删了)', () => {
    const d = path.join(os.tmpdir(), 'v313-gone-' + process.pid);
    expect(() => cleanup(d, true)).not.toThrow();
  });

  it('空路径不误删当前目录', () => {
    expect(() => cleanup('', true)).not.toThrow();
  });
});
