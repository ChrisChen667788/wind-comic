/**
 * v12.399:同一道防线,两条清理路径都得有。
 *
 * 这个仓库有**两套**删文件的逻辑,都由同一个 cron(每天 04:10)触发,
 * 都以「有没有被引用」为唯一保护:
 *   · `cleanup-media` 的 `sweepDir()` —— 扫 composed / exports / media,按**文件名**比对
 *   · `asset-storage` 的 `cleanup()`  —— 扫 storage/assets,按**内容寻址 key** 比对
 *
 * v12.394 的事故形态是**保护名单恒空**(抽名正则与磁盘真名永远对不上),
 * owner 那次丢了 30 个项目 534 个素材。v12.398 给 sweepDir 加了自检 ——
 * 但 asset-storage 那条**没有**,而它管着 160 个素材文件。
 * 同一个病要犯第二次的话,第二次就是它。
 *
 * 判据朴素但有效:**一个非空目录里「一个文件都没被引用」,
 * 几乎必然是引用集算错了,而不是真有那么多孤儿。**
 * 正常系统里磁盘文件绝大多数都挂在某条记录下;「全都是孤儿」这种结论,
 * 更可能是判定坏了而不是事实。少清一次磁盘是可逆的,删错文件不是。
 */
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { shouldRefuseSweep } from '@/lib/cleanup-guard';

const read = (p: string) => fs.readFileSync(path.join(process.cwd(), p), 'utf-8');
const codeOf = (s: string) => s.split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');

describe('守卫的判定', () => {
  it('非空目录 + 一个都没被引用 → 拒绝', () => {
    const v = shouldRefuseSweep({ total: 160, referenced: 0 }, 'storage/assets');
    expect(v.refuse).toBe(true);
    expect(v.reason).toMatch(/一个都没被引用/);
    expect(v.reason, '要指向真实事故,让人知道这不是理论风险').toMatch(/v12\.394/);
  });

  it('有任何一个被引用 → 放行(不是「全都被引用才放行」)', () => {
    // 目录里确实会有孤儿,那是正常的;守卫只拦「一个都没有」这种不可能的情况
    expect(shouldRefuseSweep({ total: 160, referenced: 1 }, 'x').refuse).toBe(false);
    expect(shouldRefuseSweep({ total: 160, referenced: 149 }, 'x').refuse).toBe(false);
  });

  it('空目录 → 放行(没什么可删也没什么可判)', () => {
    expect(shouldRefuseSweep({ total: 0, referenced: 0 }, 'x').refuse).toBe(false);
  });

  it('畸形输入不抛错,按 0 处理', () => {
    for (const t of [null, undefined, {}, { total: NaN, referenced: NaN }] as any[]) {
      expect(() => shouldRefuseSweep(t, 'x')).not.toThrow();
      expect(shouldRefuseSweep(t, 'x').refuse).toBe(false);
    }
  });

  it('位置描述出现在理由里 —— 报错要说清是哪个目录', () => {
    expect(shouldRefuseSweep({ total: 5, referenced: 0 }, 'data/composed').reason).toContain('data/composed');
  });
});

describe('两条清理路径都接了同一份守卫', () => {
  it.each([
    ['app/api/cron/cleanup-media/route.ts', 'sweepDir'],
    ['lib/asset-storage.ts', 'storage cleanup'],
  ])('%s 走 shouldRefuseSweep', (file) => {
    expect(codeOf(read(file))).toContain('shouldRefuseSweep');
  });

  it('两处都是「先统计、后删除」—— 边走边删的话发现时已经晚了', () => {
    for (const f of ['app/api/cron/cleanup-media/route.ts', 'lib/asset-storage.ts']) {
      const code = codeOf(read(f));
      const guardAt = code.indexOf('shouldRefuseSweep(');
      const unlinkAt = code.indexOf('unlinkSync');
      expect(guardAt, `${f} 找不到守卫`).toBeGreaterThan(0);
      expect(unlinkAt, `${f} 找不到删除`).toBeGreaterThan(0);
      expect(guardAt, `${f} 的守卫排在删除之后 = 发现时已经删了`).toBeLessThan(unlinkAt);
    }
  });

  it('storage 侧拒绝时返回 aborted,不假装「删了 0 个」', () => {
    const code = codeOf(read('lib/asset-storage.ts'));
    const i = code.indexOf('verdict.refuse');
    expect(i).toBeGreaterThan(0);
    const win = code.slice(i, i + 320);
    expect(win, '窗口自证').toContain('return');
    expect(win, '「removed:0」和「拒绝执行」是两回事,调用方得能分辨').toContain('aborted');
  });

  it('两处「读不到引用就不删」的既有保护都还在', () => {
    expect(codeOf(read('app/api/cron/cleanup-media/route.ts'))).toMatch(/referenced === null.*return/s);
    expect(codeOf(read('lib/asset-storage.ts'))).toMatch(/读引用失败/);
  });
});
