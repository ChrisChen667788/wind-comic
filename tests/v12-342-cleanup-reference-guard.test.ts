/**
 * v12.342 — 清理前必须查引用:这个函数曾删掉用户 30 个项目的全部素材。
 *
 * ## 事故经过(真事,不是假想)
 * owner 报「历史项目视频全都播不了」。排查:
 *   · `project_assets` 里 406 条 `serve-file?key=…` 引用,磁盘上**零命中**
 *   · 分镜 34 / 角色 51 / 场景 102 / 视频 168 / 成片 24 —— **在盘数全部为 0**
 *   · 本机、四块外置盘、废纸篓、Time Machine 全部没有;原始引擎外链 403 过期
 *   · `data/composed` 也已清空,而库里仍有 33 条指向它的引用
 *
 * 根因:`lib/asset-storage.cleanup()` 只看 `mtimeMs < cutoff` 就 `unlinkSync`,
 * **完全不查文件是否仍被引用**;函数头还写着「清理策略(未实装)」,
 * 而 `/api/cron/cleanup-media` 早已在调它(storage 30 天 / composed·exports 7 天 / media 14 天)。
 * 于是用户的成片有了「保质期」,而他毫不知情。`unlinkSync` 不进废纸篓 —— **不可恢复**。
 *
 * ## 这个文件锁的不变式
 * ① 被引用的文件**永不删除**,不管多老;
 * ② 读引用失败时**一个都不删** —— 删除不可逆,占磁盘可逆;
 * ③ 端点侧的 sweepDir 同样受引用保护(composed 是成片,不是「可再生中间物」)。
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const AS = fs.readFileSync('lib/asset-storage.ts', 'utf-8');
const CRON = fs.readFileSync('app/api/cron/cleanup-media/route.ts', 'utf-8');

describe('v12.342 · 核心不变式:被引用的文件永不删除', () => {
  it('引用命中的分支在龄检查**之前**(否则老文件仍会被删)', () => {
    const i = AS.indexOf('export function cleanup');
    const body = AS.slice(i, i + 2200);
    const iRef = body.indexOf('referenced.has(key)');
    const iAge = body.indexOf('stat.mtimeMs >= cutoff');
    expect(iRef, '找不到引用检查').toBeGreaterThan(0);
    expect(iAge, '找不到龄检查').toBeGreaterThan(0);
    expect(iRef, '引用检查必须排在龄检查之前').toBeLessThan(iAge);
  });

  it('读引用失败 → 整轮不删(而不是「读不到就当没引用」)', () => {
    const i = AS.indexOf('let referenced: Set<string>');
    const block = AS.slice(i, i + 500);
    expect(block).toMatch(/catch/);
    expect(block, '失败必须直接 return,不能继续往下删').toMatch(/return \{ removed: 0/);
  });

  it('key 从文件名剥扩展名得到,与 storagePut 的 `${key}${ext}` 命名对应', () => {
    expect(AS).toMatch(/replace\(\/\\\.\[\^\.\]\*\$\/, ''\)/);
  });

  it('引用来源同时认 persistent_url 与 media_urls(只看一个会漏)', () => {
    const i = AS.indexOf('export function listReferencedKeys');
    const fn = AS.slice(i, i + 900);
    expect(fn).toContain('persistent_url');
    expect(fn).toContain('media_urls');
  });
});

describe('v12.342 · 端点侧的三个目录同样受保护', () => {
  it('sweepDir 接收引用集合,并在龄检查前跳过被引用文件', () => {
    const i = CRON.indexOf('function sweepDir');
    const fn = CRON.slice(i, i + 1200);
    expect(fn).toMatch(/referenced\.has\(f\)/);
    const iRef = fn.indexOf('referenced.has(f)');
    const iAge = fn.indexOf('st.mtimeMs < cutoff');
    expect(iRef).toBeLessThan(iAge);
  });

  it('引用取不到时 sweepDir 直接返回 0,不删任何东西', () => {
    const i = CRON.indexOf('function sweepDir');
    expect(CRON.slice(i, i + 400)).toMatch(/referenced === null\) return \{ removed: 0/);
  });

  it('composed / exports / media 三处都传了引用集合(漏一个就等于没修)', () => {
    // 按**整行**取,不用 [^)]* —— path.join(...) 的内层右括号会把它截断(v12.337 踩过同一个坑)
    const lines = CRON.split('\n');
    for (const d of ['composed', 'exports', 'media']) {
      const line = lines.find((l) => l.trim().startsWith(`${d}: sweepDir(`));
      expect(line, `${d} 找不到调用`).toBeTruthy();
      expect(line!, `${d} 没传引用集合`).toMatch(/,\s*refs\)/);
    }
  });

  it('干跑走同一条逻辑 —— 否则 dryRun 报告永远是 0,看不出真实影响面', () => {
    expect(CRON).toMatch(/cleanup\(\{ maxAgeDays: 30, dryRun \}\)/);
  });
});

describe('v12.342 · 真删一遍:被引用的必须活下来', () => {
  let dir = '';
  beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cleanup-test-')); });
  afterEach(() => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch {} });

  /** 复刻 cleanup 的判定,用真文件验证语义(不依赖真实库)。 */
  function sweep(referenced: Set<string> | null, maxAgeDays: number) {
    if (referenced === null) return { removed: 0, skipped: 0 };
    const cutoff = Date.now() - maxAgeDays * 86400_000;
    let removed = 0, skipped = 0;
    for (const f of fs.readdirSync(dir)) {
      const p = path.join(dir, f);
      const st = fs.statSync(p);
      const key = f.replace(/\.[^.]*$/, '');
      if (referenced.has(key)) { skipped++; continue; }
      if (st.mtimeMs >= cutoff) continue;
      fs.unlinkSync(p); removed++;
    }
    return { removed, skipped };
  }

  it('一个被引用的老文件 + 一个无引用的老文件 → 只删后者', () => {
    const old = Date.now() - 100 * 86400_000;
    for (const n of ['keep123.mp4', 'orphan456.mp4']) {
      fs.writeFileSync(path.join(dir, n), 'x');
      fs.utimesSync(path.join(dir, n), old / 1000, old / 1000);
    }
    const r = sweep(new Set(['keep123']), 30);
    expect(r).toEqual({ removed: 1, skipped: 1 });
    expect(fs.existsSync(path.join(dir, 'keep123.mp4')), '被引用的文件被删了').toBe(true);
    expect(fs.existsSync(path.join(dir, 'orphan456.mp4'))).toBe(false);
  });

  it('引用集合为 null(读库失败)→ 一个都不删', () => {
    const old = Date.now() - 100 * 86400_000;
    fs.writeFileSync(path.join(dir, 'a.mp4'), 'x');
    fs.utimesSync(path.join(dir, 'a.mp4'), old / 1000, old / 1000);
    expect(sweep(null, 30)).toEqual({ removed: 0, skipped: 0 });
    expect(fs.existsSync(path.join(dir, 'a.mp4'))).toBe(true);
  });

  it('**修复前的行为会删掉被引用文件** —— 证明这条修复不是摆设', () => {
    const old = Date.now() - 100 * 86400_000;
    fs.writeFileSync(path.join(dir, 'keep123.mp4'), 'x');
    fs.utimesSync(path.join(dir, 'keep123.mp4'), old / 1000, old / 1000);
    // 旧逻辑:只看 mtime
    let removedOld = 0;
    for (const f of fs.readdirSync(dir)) {
      if (fs.statSync(path.join(dir, f)).mtimeMs < Date.now() - 30 * 86400_000) removedOld++;
    }
    expect(removedOld, '旧逻辑确实会删掉这个被引用的文件').toBe(1);
  });
});

describe('v12.342 · 素材丢了要说出来,不能一片空白', () => {
  const VP = fs.readFileSync('components/ui/video-player.tsx', 'utf-8');

  it('<video> 挂了 onError(此前 6 处播放器有 4 处完全没有)', () => {
    expect(VP).toMatch(/onError=\{handleError\}/);
  });

  it('**区分「文件没了」和「一时加载不出来」** —— 两者对用户意义完全不同', () => {
    const i = VP.indexOf('const handleError');
    const fn = VP.slice(i, i + 800);
    expect(fn, '404 要说素材已丢失').toMatch(/404[\s\S]{0,80}已丢失/);
    expect(fn, '403 要说过期/无权').toMatch(/403/);
    expect(fn, '网络不可达要单独说').toMatch(/网络不可达/);
  });

  it('提示对读屏可见,且带上出问题的 src(便于排查)', () => {
    expect(VP).toMatch(/role="alert"/);
    expect(VP).toMatch(/\{src\}/);
  });

  it('换 src 要清掉旧错误(否则修好后仍挂着上一条报错)', () => {
    expect(VP).toMatch(/useEffect\(\(\) => \{ setLoadError\(''\) \}, \[src\]\)/);
  });

  it('覆盖层的定位父级确实是 relative(absolute inset-0 才有意义)', () => {
    const iRoot = VP.indexOf('cn("relative');
    const iOverlay = VP.indexOf('absolute inset-0');
    expect(iRoot, '根容器不是 relative,覆盖层会飘走').toBeGreaterThan(0);
    expect(iRoot).toBeLessThan(iOverlay);
  });
});
