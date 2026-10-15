/**
 * v13.0 · 跨大版本(v12 → v13)时发版工具不能静默停摆;ModelScope 同步的令牌改成隐藏输入。
 *
 * ① sync-doc-stats 的两条自述位置正则原来写死 `v12`:升到 13.0.0 后「v2.0 → v12.473」「v12.473 · 6539 单测」
 *   都匹配不上,对外文案就永远停在 v12.x,而 --check 也看不出(没有可替换的就「一致」)。
 * ② ms:sync 原来只读环境变量,要用户把占位符换成令牌再跑 —— 占位文字被原样执行过两次;
 *   现在没有环境变量就在终端里隐藏输入。按键处理抽成纯函数测;非 TTY 下不挂起、直接报缺令牌。
 */
import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { syncVersionRefs } from '../scripts/sync-doc-stats.mjs';
import { applyTokenKeystrokes, tokenProblem } from '../scripts/modelscope-sync.mjs';

describe('v13.0 · 自述位置的版本号跨大版本也能同步', () => {
  it('「v2.0 → v12.473」→「v2.0 → v13.0」;补丁段整段吃掉', () => {
    expect(syncVersionRefs('8 个月, v2.0 → v12.473, 6539 个单测', 'v13.0')).toBe('8 个月, v2.0 → v13.0, 6539 个单测');
    expect(syncVersionRefs('v2.0 → v12.455.1.1.1', 'v13.0')).toBe('v2.0 → v13.0');
  });
  it('幂等;不在「v2.0 →」后面的历史版本号不动(正常侧)', () => {
    const once = syncVersionRefs('v2.0 → v12.473', 'v13.0');
    expect(syncVersionRefs(once, 'v13.0')).toBe(once);
    const hist = '片段重拍 *(v12.315)* 起,v12.465 加了俯仰';
    expect(syncVersionRefs(hist, 'v13.0')).toBe(hist);
  });
});

describe('v13.0 · ms:sync 令牌隐藏输入', () => {
  it('bracketed paste 包着的整段粘贴 + 回车 → 取到令牌', () => {
    expect(applyTokenKeystrokes('', '\x1b[200~ms-abc123\x1b[201~\r')).toEqual({ buf: 'ms-abc123', done: true, abort: false });
  });
  it('分块到达、退格、Ctrl-C', () => {
    const a = applyTokenKeystrokes('', 'ms-ab');
    expect(a).toEqual({ buf: 'ms-ab', done: false, abort: false });
    const b = applyTokenKeystrokes(a.buf, 'x\u007fc\n');
    expect(b).toEqual({ buf: 'ms-abc', done: true, abort: false });
    expect(applyTokenKeystrokes('ms-a', '\u0003').abort).toBe(true);
  });
  it('Ctrl-D 在 raw 模式下是 0x04 字节:当放弃处理,不能悄悄拼进令牌', () => {
    expect(applyTokenKeystrokes('ms-a', '\u0004')).toEqual({ buf: '', done: false, abort: true });
    expect(applyTokenKeystrokes('', 'ms-ab\u0004cd\r').abort, '夹在中间也一样').toBe(true);
  });
  it('粘成「变量名=令牌」要拦下并说清楚;正常令牌放行', () => {
    expect(tokenProblem('MODELSCOPE_API_TOKEN=ms-abc')).toMatch(/变量名=令牌/);
    expect(tokenProblem('ms-0123456789abcdef')).toBeNull();
  });
  it('**非交互环境不挂起**:没有环境变量、stdin 不是 TTY → 立刻报缺令牌退出 2', () => {
    let code = 0; let err = '';
    try {
      execFileSync(process.execPath, ['scripts/modelscope-sync.mjs'], {
        env: { ...process.env, MODELSCOPE_API_TOKEN: '' }, stdio: ['pipe', 'pipe', 'pipe'], timeout: 20_000, input: '',
      });
    } catch (e: any) { code = e.status; err = String(e.stderr); }
    expect(code).toBe(2);
    expect(err).toContain('缺 MODELSCOPE_API_TOKEN');
  });
});
