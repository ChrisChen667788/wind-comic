/**
 * v12.301 — Dashboard「最近动态」是三条**写死的假事件**。
 *
 * 所有用户看到的都是同一份:「剧本智能拆解完成 5 分钟前」「镜头 12 渲染成功 25 分钟前」
 * 「分镜一致性检查通过 1 小时前」—— **包括刚注册、还没跑过任何任务的新用户**。
 * 这不是"占位数据没删",是产品在对用户说谎:第一次打开就看到三条属于别人的成功记录。
 *
 * 改为读该用户真实的 `generations`(接口本身按 `user_id` 过滤,不会串用户);
 * 没有记录时给**诚实空态**,而不是编三条。
 *
 * 顺带收口相对时间:仓里已有**两份**内联实现(PolishHistoryPanel / LatestPolishBanner),
 * 而且「超过一天怎么显示」的口径还不一致(一个带时分、一个只到日)。
 * Dashboard 要用时与其写第三份,不如抽成 `lib/relative-time` ——
 * 这个仓被「同一逻辑多份实现」坑过太多次(转场两套、音色三套、称谓词表五处)。
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import { timeAgoZh } from '@/lib/relative-time';

const strip = (t: string) =>
  t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '');
const DASH = strip(fs.readFileSync('app/dashboard/page.tsx', 'utf-8'));

describe('v12.301 · 假动态必须消失', () => {
  it('三条写死的事件文案一个都不许留(注释里解释病根不算)', () => {
    for (const fake of ['剧本智能拆解完成', '镜头 12 渲染成功', '分镜一致性检查通过']) {
      expect(DASH, `${fake} 仍写死在渲染里`).not.toContain(fake);
    }
  });

  it('写死的相对时间也不许留', () => {
    expect(DASH).not.toContain("'5 分钟前'");
    expect(DASH).not.toContain("'25 分钟前'");
    expect(DASH).not.toContain("'1 小时前'");
  });

  it('动态来自真实生成记录,且时间用共享工具算', () => {
    expect(DASH).toContain('const activity = generations.map');
    expect(DASH).toContain('timeAgoZh(g?.createdAt)');
  });

  it('**新用户看到诚实空态**,不是三条假成功', () => {
    expect(DASH).toContain('activity.length > 0');
    expect(DASH).toContain('还没有动态');
  });

  it('状态色有真实语义(失败要能看出来,不能一律绿)', () => {
    const i = DASH.indexOf('const activity = generations.map');
    const block = DASH.slice(i, i + 800);
    expect(block).toMatch(/failed/);
    expect(block).toContain('bg-red-400');
    expect(block).toContain('bg-emerald-400');
  });

  it('数据源按用户过滤(否则会串到别人的记录)', () => {
    const api = fs.readFileSync('app/api/generations/route.ts', 'utf-8');
    expect(api).toContain('WHERE user_id = ?');
  });
});

describe('v12.301 · timeAgoZh 行为', () => {
  const NOW = new Date('2026-08-09T12:00:00Z').getTime();
  const ago = (min: number) => new Date(NOW - min * 60000).toISOString();

  it('分钟 / 小时分档', () => {
    expect(timeAgoZh(ago(0), NOW)).toBe('刚刚');
    expect(timeAgoZh(ago(0.5), NOW)).toBe('刚刚');
    expect(timeAgoZh(ago(5), NOW)).toBe('5 分钟前');
    expect(timeAgoZh(ago(59), NOW)).toBe('59 分钟前');
    expect(timeAgoZh(ago(60), NOW)).toBe('1 小时前');
    expect(timeAgoZh(ago(23 * 60), NOW)).toBe('23 小时前');
  });

  it('超过一天走日期;withTime 决定带不带时分(两处旧实现的口径差异)', () => {
    const d = timeAgoZh(ago(48 * 60), NOW);
    const dt = timeAgoZh(ago(48 * 60), NOW, { withTime: true });
    expect(d).not.toMatch(/分钟前|小时前|刚刚/);
    expect(dt.length, '带时分的应更长').toBeGreaterThan(d.length);
  });

  it('**未来时间不显示成负数**(时钟偏差 / 服务端时区)', () => {
    expect(timeAgoZh(new Date(NOW + 60000).toISOString(), NOW)).toBe('刚刚');
  });

  it('空值 / 非法输入返回空串,不炸也不显示 Invalid Date', () => {
    for (const bad of [null, undefined, '', 'not-a-date', NaN] as any[]) {
      const r = timeAgoZh(bad, NOW);
      expect(r === '' || !r.includes('Invalid'), `输入 ${String(bad)} 得到 ${r}`).toBe(true);
    }
  });

  it('接受 ISO 字符串 / Date / 毫秒数三种输入', () => {
    expect(timeAgoZh(ago(5), NOW)).toBe('5 分钟前');
    expect(timeAgoZh(new Date(NOW - 5 * 60000), NOW)).toBe('5 分钟前');
    expect(timeAgoZh(NOW - 5 * 60000, NOW)).toBe('5 分钟前');
  });
});

describe('v12.301 · 相对时间收口成一份', () => {
  it('两处旧的内联实现已改为调用共享工具', () => {
    for (const f of ['components/polish/PolishHistoryPanel.tsx', 'components/polish/LatestPolishBanner.tsx']) {
      const s = fs.readFileSync(f, 'utf-8');
      expect(s, `${f} 未接共享工具`).toContain('timeAgoZh(');
      expect(s).toMatch(/import \{ timeAgoZh \} from '@\/lib\/relative-time'/);
    }
  });

  it('**不许再出现第四份**:这三个文件里不得残留自算分钟数的实现', () => {
    const bad: string[] = [];
    for (const f of [
      'app/dashboard/page.tsx',
      'components/polish/PolishHistoryPanel.tsx',
      'components/polish/LatestPolishBanner.tsx',
    ]) {
      const s = strip(fs.readFileSync(f, 'utf-8'));
      if (/\/ 60000\)/.test(s) && /分钟前/.test(s)) bad.push(f);
    }
    expect(bad, `这些文件仍自算相对时间:\n${bad.join('\n')}`).toEqual([]);
  });

  it('共享工具是零依赖纯函数', () => {
    const s = fs.readFileSync('lib/relative-time.ts', 'utf-8');
    expect(s).not.toMatch(/^import /m);
  });
});
