/**
 * v12.377:一次网络抖动,就能让当天的视频额度一个都用不上。
 *
 * 每日重跑脚本的判据是「产出了 Ken Burns 占位片」→ 推断「当日额度耗尽」→
 * 停掉本项目剩余镜头,并对后续项目一并关掉视频步骤(退出码 3)。
 * 但占位片只说明**这一镜失败了**:欠费、接口下线、网络抖动、敏感词拦截
 * 都会走到同一个回落分支。而「为什么降级」这条信息压根没出过 server ——
 * 编排器里每个引擎的报错只 console.error 打印,不收集;
 * 回落时返回的 isAnimatic:true 不带任何原因。
 *
 * 实测拿到的真实报文(强制走已欠费的可灵):
 *   kling   → 429 / 1102 Account balance not enough
 *   minimax → 2056 已达到 Token Plan 用量上限
 *   veo     → 401
 * 这三条以前一条都看不见,只有一句「引擎全部不可用」。
 */
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { shouldStopForQuota } from '@/lib/quota-vocab.mjs';

/** 实测抓到的真实报文,不是编的 */
const REAL_ARREARS = [
  { engine: 'kling', error: 'Kling API error (429): {"code":1102,"message":"Account balance not enough","request_id":"ef6bf569"}' },
  { engine: 'minimax', error: 'Minimax video-01 error (2056): 已达到 Token Plan 用量上限:请升级 Token Plan 套餐或购买积分补充用量。' },
  { engine: 'veo', error: 'Veo API error (401): {"error":{"message":"unauthorized"}}' },
];

describe('停不停整轮,照报文判', () => {
  it('真实欠费/配额报文 → 停(这是唯一该停的情形)', () => {
    const v = shouldStopForQuota(REAL_ARREARS);
    expect(v.stop).toBe(true);
    expect(v.reason).toBe('arrears');
  });

  it('只有 2056 配额满 → 停', () => {
    const v = shouldStopForQuota([{ engine: 'minimax', error: 'error 2056: rate limit exceeded' }]);
    expect(v.stop).toBe(true);
  });

  it('网络抖动 → **不停** —— 这正是白白浪费一天额度的那种情况', () => {
    const v = shouldStopForQuota([
      { engine: 'minimax', error: 'fetch failed' },
      { engine: 'kling', error: 'ETIMEDOUT' },
    ]);
    expect(v.stop).toBe(false);
    expect(v.reason).toBe('transient');
  });

  it('敏感词拦截 → 不停(是这一镜的内容问题,别的镜照跑)', () => {
    expect(shouldStopForQuota([{ engine: 'minimax', error: 'error 1026: sensitive content detected' }]).stop).toBe(false);
  });

  it('接口下线 → 不停整轮(换引擎还有戏,停了就一起陪葬)', () => {
    expect(shouldStopForQuota([{ engine: 'x', error: 'This API is no longer available to new users' }]).stop).toBe(false);
  });

  it('拿不到报文 → 保守停;没有证据时少花钱比多试错安全', () => {
    for (const f of [[], null, undefined, [{ engine: '', error: '' }]] as any[]) {
      const v = shouldStopForQuota(f);
      expect(v.stop, JSON.stringify(f)).toBe(true);
      expect(v.reason).toBe('no-evidence');
    }
  });

  it('畸形输入不抛错', () => {
    for (const f of ['字符串', 42, { a: 1 }, [null, undefined, 7]] as any[]) {
      expect(() => shouldStopForQuota(f)).not.toThrow();
    }
  });
});

describe('原因要一路带出 server', () => {
  it('编排器收集每个引擎的失败,而不只是打印', () => {
    const src = fs.readFileSync(path.join(process.cwd(), 'services/hybrid-orchestrator.ts'), 'utf-8');
    const start = src.indexOf('const engineFailures');
    expect(start).toBeGreaterThan(0);
    const end = src.indexOf('this.update(AgentRole.VIDEO_PRODUCER', start);
    expect(end).toBeGreaterThan(start);
    const win = src.slice(start, end);
    expect(win).toContain('engineFailures.push');
    // 空 URL 也是一种失败,不能只在 catch 里记
    expect(win.split('engineFailures.push').length - 1).toBeGreaterThanOrEqual(2);
  });

  it('报文截断长度要够 —— 判据全在 status_msg 里', () => {
    const src = fs.readFileSync(path.join(process.cwd(), 'services/hybrid-orchestrator.ts'), 'utf-8');
    const i = src.indexOf('const engineFailures');
    const win = src.slice(i, i + 1200);
    const m = win.match(/slice\(0,\s*(\d+)\)/);
    expect(m).toBeTruthy();
    expect(Number(m![1])).toBeGreaterThanOrEqual(300);
  });

  it('降级原因过得了 API 边界', () => {
    const src = fs.readFileSync(path.join(process.cwd(), 'app/api/projects/[id]/regenerate-shot/route.ts'), 'utf-8');
    // 这个文件里有两处 send('complete'):前一处是早退分支,后一处才是真实生成分支。
    // indexOf 会命中前者 —— 同一个坑我已经踩过一次,锚点必须从声明处往后找。
    const decl = src.indexOf('const engineFailures');
    expect(decl).toBeGreaterThan(0);
    const send = src.indexOf("send('complete'", decl);
    expect(send).toBeGreaterThan(decl);
    expect(src.slice(send, send + 600)).toContain('engineFailures');
  });

  it('脚本用统一判定函数,不再自己内联正则', () => {
    const src = fs.readFileSync(path.join(process.cwd(), 'scripts/rerun-project.mjs'), 'utf-8');
    expect(src).toContain('shouldStopForQuota');
    // 退出码 3 会让调用方对后续项目关掉视频步骤 —— 只有确认配额时才配拥有这个后果
    const i = src.indexOf('process.exit(3)');
    expect(i).toBeGreaterThan(0);
    const before = src.slice(Math.max(0, i - 400), i);
    expect(before).toContain('stat.quotaStop');
    expect(before).not.toContain('stat.animatic > 0');
  });
});
