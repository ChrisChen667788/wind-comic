/**
 * v12.392:昨晚 20:00 的定时重跑,跑的是旧代码。
 *
 * owner 的 dev server 从 8/29 10:38 起就没重启过,而 v12.377 的编排器改动是
 * 15:17 提交的 —— 中间差了近五个小时。我在改完那一刻手工实测,拿到了新加的
 * `engineFailures`(kling / minimax / veo 三条真实报文);当晚定时任务跑**同一条路径**,
 * 拿到的却是 `undefined`,于是走进 v12.377 自己加的「拿不到失败报文,保守处理」
 * 兜底,白白停掉了当轮的视频重跑。
 *
 * 这类问题最难查的地方:**它不是代码错了,而是「你以为在跑的代码」和
 * 「实际在跑的代码」不是一个东西**。日志、行为、响应字段全都指向别处 ——
 * 我一路查到编排器有几个 return 点,才想起去看进程启动时间。
 * 长期运行的 dev server + 定时任务的组合,能让这种脱节静默地持续好几天。
 *
 * ── 第一版设计是错的,记下来 ──────────────────────────────────────
 * 最先写的 build-info 是「模块加载时定格 version,和磁盘 package.json 比对」。
 * 它测不出任何东西:那个 route 是**新建的**,Next 刚编译它,定格值永远等于当前值。
 * **在 HMR 模型下,新模块永远是新的 —— 一个刚出生的哨兵报不出别人有多老。**
 * 能反映「进程有多老」的只有进程级事实:启动时刻。
 */
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

const ROOT = process.cwd();
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), 'utf-8');
const ROUTE = read('app/api/build-info/route.ts');
const CRON = read('scripts/rerun-cron.sh');
const code = ROUTE.split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');

describe('build-info 报的是进程级事实', () => {
  it('用 process.uptime() 反推启动时刻,而不是模块加载时刻', () => {
    expect(code).toContain('process.uptime()');
    expect(code).toContain('processStartedAt');
  });

  it('**不**再拿模块里定格的 version 当判据 —— 新模块永远是新的', () => {
    expect(code, '第一版就是这么写的,测不出任何东西').not.toMatch(/PROCESS_VERSION/);
    expect(code, '也不该自己下 stale 结论 —— 它没有代码改动时间这一半信息').not.toMatch(/stale/);
  });

  it('只回元信息,不碰项目数据 —— 所以无鉴权是合理的', () => {
    for (const forbidden of ['db.prepare', 'listAssetsByType', 'process.env.']) {
      expect(code, `build-info 不该出现 ${forbidden}`).not.toContain(forbidden);
    }
    // 已在文件里写明豁免理由,付费门禁据此放行
    expect(ROUTE).toMatch(/paid-gate:\s*ok\s*—/);
  });

  it('判断权交给调用方 —— 端点只报事实', () => {
    // 「进程有多老」需要两半信息:进程启动时刻(只有进程知道)
    // 和代码最后改动时刻(只有 git 知道)。端点给前一半,脚本合成后一半。
    expect(code).not.toContain('git ');
  });
});

describe('定时任务跑之前先核对', () => {
  it('请求 build-info 并与 git 最后提交时间比对', () => {
    expect(CRON).toContain('/api/build-info');
    expect(CRON).toMatch(/git .*log -1 --format=%cI/);
  });

  it('比对在 rerun-daily **之前** —— 事后才说等于没说', () => {
    const checkAt = CRON.indexOf('/api/build-info');
    const runAt = CRON.indexOf('bash scripts/rerun-daily.sh');
    expect(checkAt).toBeGreaterThan(0);
    expect(runAt).toBeGreaterThan(checkAt);
  });

  it('只报警不中止 —— 停掉等于当天什么都不做,图像步骤仍有价值', () => {
    const i = CRON.indexOf('STALE_WARN=');
    const win = CRON.slice(i, CRON.indexOf('bash scripts/rerun-daily.sh', i));
    expect(win, '窗口自证').toContain('build-info');
    expect(win, '不该在这里 exit').not.toMatch(/^\s*exit\s+\d/m);
  });

  it('结尾再报一次 —— 长日志里开头那行会被淹掉', () => {
    const endAt = CRON.indexOf('rerun-daily 退出码');
    expect(endAt).toBeGreaterThan(0);
    expect(CRON.slice(endAt, endAt + 200)).toContain('STALE_WARN');
  });

  it('curl 失败不阻断整轮 —— 核对是增强项', () => {
    expect(CRON).toMatch(/curl -sf[^\n]*build-info[^\n]*2>\/dev\/null/);
    const i = CRON.indexOf('BUILD_INFO=');
    expect(CRON.slice(i, i + 400), '拿不到就跳过核对,不该让整轮失败').toMatch(/if \[ -n "\$BUILD_INFO" \]/);
  });
});
