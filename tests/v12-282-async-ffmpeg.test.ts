/**
 * v12.282 — 出片热路径的 `execSync` 改 async(事件循环不再被冻死)。
 *
 * 实测证据(10ms 心跳定时器):
 *   execSync         → ffmpeg 190ms,**心跳触发 0 次**(定时器一次都没跑,进程完全冻结)
 *   execFile + await → ffmpeg  99ms,心跳 9 次,最大停顿 12ms
 * 修复后真跑 `applyTwoPassLoudnorm`(两遍 ffmpeg,163ms):心跳 14 次、最大停顿 12ms。
 *
 * 为什么要紧:`attachTextCard`(3 次 ffmpeg)与 `applyTwoPassLoudnorm`(2 次)都是 **async 函数**,
 * 却在体内同步阻塞。自托管多人实例上,一个人合成会让**所有人的请求与 SSE 全卡住** ——
 * 而自托管正是本项目对外声明的卖点之一。
 */
import { describe, it, expect } from 'vitest';
import fs from 'fs';

const SRC = fs.readFileSync('services/video-composer.ts', 'utf-8');

describe('v12.282 · 热路径不得再用 execSync', () => {
  it('attachTextCard / applyTwoPassLoudnorm 体内无 execSync', () => {
    // 用「下一个行首 export」切函数体 —— 早先用 indexOf('export ') 会切进注释里的 export 字样
    const bodyOf = (name: string): string => {
      const start = SRC.indexOf(`export async function ${name}`);
      expect(start, `找不到 ${name}`).toBeGreaterThan(0);
      const rest = SRC.slice(start + 10);
      const nextIdx = rest.search(/\nexport (async )?function /);
      return nextIdx > 0 ? rest.slice(0, nextIdx) : rest;
    };
    // 只看**代码行**:注释里提到 execSync 是在解释病根(如「原为 execSync,会冻住事件循环」),
    // 那是要保留的说明,不该被当成违规 —— 早先直接 toContain 就撞上了自己写的注释。
    const codeOnly = (body: string) => body.split('\n')
      .filter((l) => { const t = l.trim(); return !t.startsWith('//') && !t.startsWith('*') && !t.startsWith('/*'); })
      .map((l) => l.replace(/\/\/.*$/, ''))   // 行尾注释也要剥:`const sh = sh$; // 原为 execSync…`
      .join('\n');
    expect(codeOnly(bodyOf('attachTextCard'))).not.toContain('execSync');
    expect(codeOnly(bodyOf('applyTwoPassLoudnorm'))).not.toContain('execSync');
  });

  it('提供 async 执行器 sh$ 且基于 promisify(exec)', () => {
    expect(SRC).toContain('const execAsync = promisify(_execCb)');
    expect(SRC).toMatch(/async function sh\$\(cmd: string\)/);
    expect(SRC).toContain('await execAsync(cmd');
  });

  it('每处调用都 await(漏 await 等于并发失控 + 错误吞掉)', () => {
    // 抓「sh$(」或「sh(」出现但前面没有 await 的行(排除定义行与注释)
    const bad = SRC.split('\n').filter((l) => {
      const t = l.trim();
      if (t.startsWith('*') || t.startsWith('//')) return false;
      if (t.includes('function sh$') || t.includes('const sh = sh$')) return false;
      return /(^|[^a-zA-Z])sh\$?\(`/.test(t) && !t.includes('await ');
    });
    expect(bad, `以下调用缺 await:\n${bad.join('\n')}`).toEqual([]);
  });

  it('composer 里一处 execSync 都不剩(v13.8 起二进制路径由 lib/ffmpeg-bin 解析,不再起 shell 跑 which)', () => {
    const lines = SRC.split('\n')
      .map((l, i) => ({ n: i + 1, l }))
      .filter((x) => /execSync\(/.test(x.l) && !x.l.trim().startsWith('*') && !x.l.trim().startsWith('//'));
    // 自证扫的是那个文件:合成里用到 ffmpeg 的地方都从入口取路径
    expect(SRC).toContain("from '@/lib/ffmpeg-bin'");
    expect(SRC).toContain('const ff = resolveFFmpegPath();');
    expect(lines.map((x) => `${x.n}: ${x.l.trim()}`)).toEqual([]);
  });

  it('保留实测数据说明(防后人为「省一个 await」改回同步)', () => {
    const i = SRC.indexOf('async function sh$');
    const block = SRC.slice(Math.max(0, i - 1400), i);
    expect(block).toMatch(/心跳/);
    expect(block).toMatch(/事件循环/);
  });
});
