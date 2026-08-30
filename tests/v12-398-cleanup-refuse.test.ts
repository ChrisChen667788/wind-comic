/**
 * v12.398:保护名单认不出 `?key=` 形态,以及「一个都没被引用」时应该停手。
 *
 * 接着 v12.394 往下查:那版修好了 URL 编码路径,但**引用集仍然认不出内容寻址的引用**。
 * storage 是内容寻址的 —— 磁盘上叫 `<sha256>.mp4`,而 DB 里存的是 `?key=<sha256>`,
 * **URL 里没有扩展名**,而抽名正则要求后缀,一个都抓不到。
 * 实测:613 条引用是 key 形态;`data/storage/assets` 里 160 个文件,
 * 按当时的引用集**受保护数是 0**。它今天不在清理列表里(只扫 composed / exports / media),
 * 所以还没出事 —— 但哪天有人把 storage 加进来,160 个素材会一次删光。
 * 补上 key 形态后:**0 → 149**。
 *
 * 更要紧的是第二件事:**加一道自检**。
 * v12.394 那个 bug 的形态是「保护名单恒空」—— 每一个被引用的成片都被判成孤儿,
 * 那次 owner 丢了 30 个项目 534 个素材。而一个非空目录里「一个文件都没被引用」,
 * 在正常运行的系统里几乎不可能 —— 远比「引用集算错了」更不可能。
 * 与其相信自己的正则,不如在这一刻停手:**少清一次磁盘,总好过再删一次素材**。
 *
 * 如果这道自检早就在,v12.394 那个 bug 根本不会造成损失。
 */
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

const SRC = fs.readFileSync(path.join(process.cwd(), 'app/api/cron/cleanup-media/route.ts'), 'utf-8');
const code = SRC.split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');

/** 复刻修复后的抽名逻辑(route 里的函数没导出) */
const RE = /([A-Za-z0-9._-]+\.(?:mp4|mov|webm|png|jpe?g|webp|mp3|wav|m4a|srt|edl|xml|aaf))/g;
const KEY_RE = /key=([0-9a-zA-Z_-]{8,})/g;
const EXTS = ['mp4', 'mov', 'webm', 'png', 'jpg', 'jpeg', 'webp', 'mp3', 'wav', 'm4a', 'srt'];
function refsOf(raw: string): Set<string> {
  const out = new Set<string>();
  if (!raw) return out;
  let d = raw;
  try { d = decodeURIComponent(raw); } catch { /* 保持原串 */ }
  for (const blob of d === raw ? [raw] : [raw, d]) {
    RE.lastIndex = 0;
    for (const m of blob.matchAll(RE)) out.add(m[1]);
    KEY_RE.lastIndex = 0;
    for (const m of blob.matchAll(KEY_RE)) {
      out.add(m[1]);
      for (const e of EXTS) out.add(`${m[1]}.${e}`);
    }
  }
  return out;
}

describe('内容寻址的引用', () => {
  const KEY = '01687382d5895e2d5f00cde8a68b8a30';

  it('?key= 形态能认出磁盘上的真实文件名(URL 里根本没有扩展名)', () => {
    const s = refsOf(`/api/serve-file?key=${KEY}`);
    expect(s.has(`${KEY}.mp4`), '磁盘上就叫这个名字').toBe(true);
    expect(s.has(KEY), 'key 本身也收进保护名单').toBe(true);
  });

  it('修复前抓不到 —— 抽名正则要求后缀,而 key 形态没有', () => {
    const raw = `/api/serve-file?key=${KEY}`;
    RE.lastIndex = 0;
    expect([...raw.matchAll(RE)].length, '这就是 160 个文件受保护数为 0 的原因').toBe(0);
  });

  it('media_urls 里混着两种形态时都要认', () => {
    const blob = JSON.stringify([
      `/api/serve-file?key=${KEY}`,
      '/api/serve-file?path=%2Fx%2Fcomposed%2Ffinal-9.mp4&sig=a',
    ]);
    const s = refsOf(blob);
    expect(s.has(`${KEY}.mp4`)).toBe(true);
    expect(s.has('final-9.mp4')).toBe(true);
  });

  it('太短的 key 不收 —— 免得把 `key=1` 这类查询参数当成资产', () => {
    expect(refsOf('/x?key=abc').size).toBe(0);
  });
});

describe('「一个都没被引用」时拒绝清理', () => {
  it('自检存在,且拒绝时返回 refused', () => {
    // v12.399 修订:那版把内联的判定抽成了共享的 shouldRefuseSweep()(asset-storage
    // 那条清理路径要用同一份)。原断言锁的是内联写法 `tally.total > 0 && ...` ——
    // 行为一字未改、断言却红了。锁写法不锁行为,又一次。
    // 现在验的是「自检在、且它的结论会变成 refused」。
    expect(code, '自检不见了').toMatch(/shouldRefuseSweep\(|referenced === 0/);
    expect(code).toContain('refused: true');
  });

  it('遍历只统计、删除挪到自检之后 —— 边走边删的话发现时已经晚了', () => {
    const walkAt = code.indexOf('const walk =');
    const unlinkAt = code.indexOf('fs.unlinkSync');
    const guardAt = code.indexOf('tally.referenced === 0');
    expect(walkAt).toBeGreaterThan(0);
    expect(guardAt, '自检必须在删除之前').toBeLessThan(unlinkAt);
    // walk 内部不该有 unlink
    const walkBody = code.slice(walkAt, code.indexOf('walk(dir);', walkAt));
    expect(walkBody, '窗口自证').toContain('readdirSync');
    expect(walkBody, '遍历里不该删任何东西').not.toContain('unlinkSync');
  });

  it('dryRun 也走同一条自检 —— 否则演练与真跑对不上', () => {
    // 窗口要从自检**开头**往后切 —— refused 在它后面几行,往前 300 字符是遍历循环。
    // (第一版就是往前切的,自证断言当场把它拦下了。)
    const i = code.indexOf('shouldRefuseSweep(');
    expect(i, '找不到自检').toBeGreaterThan(0);
    const win = code.slice(i, i + 700);
    expect(win, '窗口自证').toContain('refused');
    expect(win, '自检不该被 dryRun 绕过').not.toMatch(/if\s*\(\s*!?\s*dryRun\s*\)[^\n]*(refuse|referenced)/);
  });

  it('读不到引用时一个都不删 —— v12.394 引入的既有保护还在', () => {
    expect(code).toMatch(/referenced === null.*return/s);
  });

  it('拒绝时说清「几乎必然是引用集算错了」,而不是含糊报个错', () => {
    expect(SRC).toMatch(/一个都没被引用/);
    expect(SRC, '要指向 v12.394 那次事故,让人知道这不是理论风险').toMatch(/v12\.394/);
  });
});
