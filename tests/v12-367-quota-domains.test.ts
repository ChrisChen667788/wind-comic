/**
 * v12.367:视频额度尽了就整轮停 —— 白白浪费掉当天的**图像**额度。
 *
 * 两套额度是分开的(实测:视频耗尽当天,角色/场景/分镜仍在正常出图),
 * 但每日重跑一遇到占位片就 `exit 0` 退出整轮。实测代价:
 *   项目 1 完成、项目 2 卡在视频阶段 → **项目 3/4/5 一张图都没有**
 *   合计 **53 张**图像资产被卡住,而当天的出图配额就这么放掉了。
 *
 * 更要紧的是**分镜图正是明天视频的 i2v 首帧** —— 先备好,明天的视频额度才花得到刀刃上;
 * 否则明天还得先花时间出图,再出视频,等于两天只推进一天的量。
 *
 * 修:视频额度耗尽 → **只跳过视频步骤**,后续项目改跑 `--only=chars,scenes,boards`。
 */
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

const read = (rel: string) => fs.readFileSync(path.join(process.cwd(), rel), 'utf8');
const PROJ = read('scripts/rerun-project.mjs');
const DAILY = read('scripts/rerun-daily.sh');

describe('v12.367 单项目:视频尽了只跳视频', () => {
  it('占位片只 break 视频循环,不再整轮退出', () => {
    // v12.377 修订:原断言锁的是那句日志的**完整字面量**。本版把「为什么停」
    // 换成了按真实报文判(欠费/配额才停),文案随之改成动态拼接 —— 意图未变、
    // 字面量变了。改为验意图:停的是「本项目剩余镜头」,且明说图像步骤继续。
    const i = PROJ.indexOf('跳过本项目剩余镜头');
    expect(i).toBeGreaterThan(0);
    expect(PROJ.slice(i, i + 60)).toContain('图像类步骤继续');
    // 「只停视频」的实证:停的是 for 循环(break),不是进程(exit)
    const win = PROJ.slice(Math.max(0, i - 400), i + 200);
    expect(win).toContain('break;');
    expect(win).not.toContain('process.exit');
  });

  it('退出码 3 的语义改成「视频额度尽」,并说明调用方该怎么做', () => {
    expect(PROJ).toMatch(/退出码有语义:3 = 当日\*\*视频\*\*额度已耗尽/);
    expect(PROJ).toContain('后续项目将只跑图像步骤');
  });

  it('把「两套额度是分开的」写进代码 —— 这是整个改动的前提', () => {
    expect(PROJ).toMatch(/图像额度是\*\*另一套\*\*/);
    expect(PROJ).toMatch(/i2v 首帧/);
  });
});

describe('v12.367 每日驱动:降级而不是停机', () => {
  it('收到 3 不再 exit,而是置标志继续', () => {
    expect(DAILY).toMatch(/VIDEO_BUDGET_LEFT=0/);
    // 旧写法:收到 3 直接 exit 0
    expect(DAILY).not.toMatch(/code" -eq 3 \][\s\S]{0,120}exit 0/);
  });

  it('降级后跑的是图像三步,不含 videos', () => {
    expect(DAILY).toContain('--only=chars,scenes,boards');
    const _at = DAILY.indexOf('VIDEO_BUDGET_LEFT" -eq 1');
    expect(_at, '找不到额度分支').toBeGreaterThan(0);
    const win = DAILY.slice(_at);
    expect(win, '窗口自证').toContain('--only=');
    expect(win).not.toMatch(/--only=[a-z,]*videos/);
  });

  it('降级状态要让人看得见(标题和收尾都标注)', () => {
    expect(DAILY).toContain('仅图像 —— 视频额度已耗尽');
    expect(DAILY).toContain('图像步骤已尽量跑完');
  });

  it('普通失败仍然继续下一个,且**不再把 3 当成普通失败重复报警**', () => {
    expect(DAILY).toMatch(/code" -ne 0 \] && \[ "\$code" -ne 3 \]/);
  });
});

describe('v12.367 手动入口要先探活', () => {
  it('rerun-daily 自带探活 —— 它是给人手动跑的', () => {
    expect(DAILY).toMatch(/curl -sf -o \/dev\/null --max-time 5 http:\/\/localhost:3000\//);
    expect(DAILY).toContain('dev server 没在跑');
  });

  it('探活失败要给出**两条可执行的下一步**,而不是只报错', () => {
    expect(DAILY).toContain('npm run dev');
    expect(DAILY).toContain('scripts/rerun-cron.sh');
  });

  it('探活在开跑之前(否则每个项目都会喷一段 ECONNREFUSED 栈)', () => {
    const iCheck = DAILY.indexOf('dev server 没在跑');
    const iLoop = DAILY.indexOf('for entry in');
    expect(iCheck).toBeGreaterThan(-1);
    expect(iCheck).toBeLessThan(iLoop);
  });
});
