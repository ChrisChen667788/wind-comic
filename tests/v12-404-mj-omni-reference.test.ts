/**
 * v12.404 — 角色锁脸可能早已在 MJ 路径上静默失效,而产物看不出来。
 *
 * ── 病象 ──────────────────────────────────────────────────────────────
 * `midjourney.service.ts` 一直发 `--cref <url> --cw <n>`,而**全仓从没声明过 MJ 版本**。
 * 官方在 V7 用 Omni Reference(`--oref` + `--ow`)取代了 V6 的 Character Reference,
 * 且 Character Reference 文档直接叫 V7 用户改用 Omni Reference。
 *
 * 如果网关默认是 V7,`--cref` 就是个无效参数 —— 而 **MJ 不会因为多了个不认识的参数而报错**,
 * 它照样出图,只是角色不锁了。于是产物依然好看,只是不是同一个人。
 * 这就是那条老教训的形态:上游静默忽略不认识的字段,**失败长得像成功**。
 *
 * ── 这条测试锁什么 ────────────────────────────────────────────────────
 * 锁「版本与参数必须成对且显式」。核心不是「用 oref 还是 cref」——
 * 而是**不许再出现「不声明版本却假定某套参数生效」**这件事本身。
 *
 * ⚠️ 本轮无 MJ 额度,未做真机出图验证。所以这里只断言请求形态,
 * 不断言「一致性已修复」—— 那需要出图比对,属于下一轮真机验收。
 */
import { describe, it, expect } from 'vitest';
import { buildMjParams, mjVersion, usesOmniReference, MJ_DEFAULT_VERSION } from '@/lib/midjourney-params';
import fs from 'node:fs';

/**
 * 剥注释:块注释、整行 `//`、**以及尾随 `//`**。
 * 只剥前两种是不够的 —— 本条测试第一次跑就被 `cref?: string;  // --cref …`
 * 这样一行尾随注释绊住。`(?<!:)` 是为了别把 URL 里的 `://` 当成注释起点。
 */
const stripComments = (src: string) =>
  src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((l) => !l.trim().startsWith('//'))
    .map((l) => l.replace(/(?<!:)\/\/.*$/, ''))
    .join('\n');

describe('v12.404 · MJ Omni Reference', () => {
  it('每个请求都显式声明版本 —— 不声明就是把行为交给网关默认值', () => {
    expect(buildMjParams({})).toContain('--v ');
    expect(buildMjParams({ aspectRatio: '9:16' })).toContain(`--v ${MJ_DEFAULT_VERSION}`);
  });

  it('V7 用 --oref/--ow,V6 用 --cref/--cw —— 两套不能混', () => {
    const v7 = buildMjParams({ cref: 'https://x/a.png', version: '7' });
    expect(v7).toContain('--oref https://x/a.png');
    expect(v7).toContain('--ow 100');
    expect(v7).not.toContain('--cref');
    expect(v7).not.toContain('--cw');

    const v6 = buildMjParams({ cref: 'https://x/a.png', version: '6.1' });
    expect(v6).toContain('--cref https://x/a.png');
    expect(v6).toContain('--cw 100');
    expect(v6).not.toContain('--oref');
    expect(v6).not.toContain('--ow');
  });

  it('权重按各自版本的合法区间夹住(越界时 MJ 同样不报错,只是不按你想的来)', () => {
    expect(buildMjParams({ cref: 'u', version: '7', ow: 99999 })).toContain('--ow 1000');
    expect(buildMjParams({ cref: 'u', version: '7', ow: 0 })).toContain('--ow 1');
    expect(buildMjParams({ cref: 'u', version: '6.1', cw: 500 })).toContain('--cw 100');
    expect(buildMjParams({ cref: 'u', version: '6.1', cw: -3 })).toContain('--cw 0');
  });

  it('版本判定:>=7 走 Omni', () => {
    expect(usesOmniReference('7')).toBe(true);
    expect(usesOmniReference('7.1')).toBe(true);
    expect(usesOmniReference('6.1')).toBe(false);
    expect(usesOmniReference('5.2')).toBe(false);
  });

  it('MJ_VERSION 只接受数字形态,乱填不会被拼进 prompt', () => {
    const prev = process.env.MJ_VERSION;
    try {
      process.env.MJ_VERSION = '6.1';
      expect(mjVersion()).toBe('6.1');
      process.env.MJ_VERSION = '--fast; rm -rf';
      expect(mjVersion(), '乱填就照拼 = 把任意字符串塞进 prompt').toBe(MJ_DEFAULT_VERSION);
    } finally {
      if (prev === undefined) delete process.env.MJ_VERSION;
      else process.env.MJ_VERSION = prev;
    }
  });

  it('sref / ar / style 依旧照发(别修一个参数弄丢另外三个)', () => {
    const p = buildMjParams({ sref: 'https://s/1.png', aspectRatio: '9:16', style: 'raw' });
    expect(p).toContain('--sref https://s/1.png');
    expect(p).toContain('--ar 9:16');
    expect(p).toContain('--style raw');
  });

  it('service 不得再自己拼参数 —— 版本与参数的对应关系只能有一个出处', () => {
    const src = stripComments(fs.readFileSync('services/midjourney.service.ts', 'utf-8'));
    // 窗口自证:确认读到的是接了模块之后的版本
    expect(src).toContain('buildMjParams(');
    expect(src.includes('--cref'), 'service 里又自己拼 --cref 了').toBe(false);
    expect(src.includes('--oref'), 'service 里又自己拼 --oref 了').toBe(false);
  });
});
