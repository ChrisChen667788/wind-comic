/**
 * v13.15 — 粘贴标记被拆在两块里送来,令牌就进不去。
 *
 * 实测(10-28,Claude 桌面版的终端面板):粘贴令牌后报
 * 「MODELSCOPE_API_TOKEN 第 1 个字符不是可打印 ASCII(共 45 个字符)」。
 * 令牌是 39 个字符,多出来的 6 个正好是 bracketed paste 的开头标记 `ESC[200~` ——
 * 终端把 ESC 单独作为一块送来,`[200~令牌…` 是下一块。v13.0 的 applyTokenKeystrokes
 * 只在**单块**里剥标记,两块各自都凑不成完整标记,于是原样拼进了令牌。
 * 同一台机器上,用修好的脚本重跑一次就上传成功了(ModelScope 10-28 14:14 更新到 v13.4)。
 *
 * 锁的是:无论标记怎么拆,回车时拿到的都是原令牌;且 v13.0 那几条正常行为不变。
 */
import { describe, it, expect } from 'vitest';
import { applyTokenKeystrokes, tokenProblem } from '../scripts/modelscope-sync.mjs';

// 39 个字符、形如真令牌的占位串(dummy,全 0)
const DUMMY = `ms-${'0'.repeat(8)}-0000-0000-0000-${'0'.repeat(12)}`;
const S = '\x1b[200~';
const E = '\x1b[201~';

/** 按块喂给按键处理,返回回车那一刻的结果;没回车就返回 null */
function feed(chunks: string[]) {
  let buf = '';
  for (const c of chunks) {
    const r = applyTokenKeystrokes(buf, c);
    if (r.abort) return { abort: true, buf: r.buf };
    buf = r.buf;
    if (r.done) return { abort: false, buf };
  }
  return null;
}

describe('v13.15 · 粘贴标记跨块也能剥掉', () => {
  it.each([
    ['ESC 单独一块(实测形态)', ['\x1b', `[200~${DUMMY}${E}`, '\r']],
    ['逐字节送达', [...`${S}${DUMMY}${E}\r`]],
    ['开头标记拆成三段', ['\x1b[', '20', `0~${DUMMY}${E}\r`]],
    ['结束标记被拆开', [`${S}${DUMMY}\x1b`, '[201~', '\r']],
    ['粘贴内容自带回车,结束标记还没到', ['\x1b', `[200~${DUMMY}\r${E}`]],
  ])('%s → 得到原令牌并通过预检', (_name, chunks) => {
    const r = feed(chunks as string[]);
    expect(r).not.toBeNull();
    expect(r!.abort).toBe(false);
    expect(r!.buf).toBe(DUMMY);
    expect(tokenProblem(r!.buf)).toBeNull();
  });

  it('正常侧不变:整块粘贴、手敲、退格、Ctrl-C', () => {
    expect(feed([`${S}${DUMMY}${E}\r`])!.buf).toBe(DUMMY);
    expect(feed([DUMMY, '\r'])!.buf).toBe(DUMMY);
    expect(feed(['ms-ab', 'x\u007fc\n'])!.buf).toBe('ms-abc');
    expect(feed(['ms-a', '\u0003'])!.abort).toBe(true);
  });

  it('漏网的 ESC 要给出能照做的提示,而且不回显令牌', () => {
    const msg = tokenProblem(`${S}${DUMMY}`);
    expect(msg).toMatch(/第 1 个字符/);
    expect(msg).toMatch(/控制符/);
    expect(msg).not.toContain(DUMMY);
  });
});
