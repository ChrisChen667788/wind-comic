/**
 * v12.370:修好我自己的测量工具 —— 它把接好线的端点误报成了孤儿。
 *
 * 本轮我临时写过一版「造好没接线」扫描,靠它接线了 reframe / covers-from-frames /
 * hook-ideas / 剪映导出四条真功能 —— **那部分成果是实的**。
 *
 * 但那一版**只剥离了 `[id]`,没剥离其它动态段**。于是 `characters/bible/[name]`
 * 的比对键成了字面量 `[name]`,前端源码里当然搜不到 —— 被误报成孤儿,
 * **而实际上前端接得好好的**(debounce 查询 + AbortController + dismiss 状态)。
 *
 * 我据此在 **v12.369 的版本日志和提交信息里写了「前端零引用」——那句话是错的**,
 * 已在该条目下加更正说明。v12.369 的实质(数据覆盖率 2/73、回填 49 条)不受影响。
 *
 * 教训不是「扫描不可靠」,而是:**一次性脚本没人复核、也没法复现**。
 * 做成带测试的脚本,错了至少能被下一次跑出来。
 */
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { matchKey, findOrphans, BY_DESIGN } from '@/scripts/audit-orphan-endpoints.mjs';

describe('v12.370 匹配键:必须剥掉全部动态段', () => {
  it.each([
    ['characters/bible/[name]', 'bible'],
    ['projects/[id]/reframe', 'reframe'],
    ['cameo-ip/[tokenId]', 'cameo-ip'],
    ['mock-assets/[...path]', 'mock-assets'],
    ['projects/[id]/covers/from-frames', 'from-frames'],
    ['tools/remove-bg', 'remove-bg'],
  ])('%s → %s', (ep, want) => {
    expect(matchKey(ep)).toBe(want);
  });

  it('**旧实现的具体错误**:只剥 [id] 会把 [name] 当成静态段', () => {
    const buggy = (ep: string) => ep.replace('[id]', '').replace('//', '/').replace(/^\/|\/$/g, '').split('/').pop();
    expect(buggy('characters/bible/[name]')).toBe('[name]');   // 旧:错
    expect(matchKey('characters/bible/[name]')).toBe('bible');  // 新:对
  });

  it('全是动态段时返回空(调用方应跳过,而不是拿空串去搜)', () => {
    expect(matchKey('[id]/[name]')).toBe('');
  });
});

describe('v12.370 孤儿判定', () => {
  it('前端出现该段就不算孤儿', () => {
    expect(findOrphans(['projects/[id]/reframe'], ['fetch(`/api/projects/${id}/reframe`)'])).toEqual([]);
  });

  it('前端没出现才算孤儿', () => {
    expect(findOrphans(['tools/remove-bg'], ['无关代码'])).toEqual(['tools/remove-bg']);
  });

  it('**设计上就没有前端调用方的不算孤儿**,且每条写明理由', () => {
    expect(findOrphans(['stripe/webhook'], ['无关代码'])).toEqual([]);
    for (const [k, why] of Object.entries(BY_DESIGN)) {
      expect((why as string).length, `${k} 缺理由`).toBeGreaterThan(8);
    }
  });

  it('过短的段跳过 —— 易误判,宁可漏报也别谎报', () => {
    expect(findOrphans(['a/[id]/ab'], ['无关代码'])).toEqual([]);
  });
});

describe('v12.370 真实仓库上的结果', () => {
  const SRC = fs.readFileSync(path.join(process.cwd(), 'scripts/audit-orphan-endpoints.mjs'), 'utf8');

  it('把「误报过一次」和原因写进脚本头', () => {
    expect(SRC).toMatch(/只剥离了 `\[id\]`,没剥离其它动态段/);
    expect(SRC).toMatch(/那句话是错的/);
  });

  it('输出提醒这是启发式,要逐条人工确认', () => {
    expect(SRC).toContain('逐条人工确认后再动手');
  });

  it('characters/bible 不在孤儿名单里(它接好线了)', async () => {
    const { execSync } = await import('child_process');
    const out = execSync('node scripts/audit-orphan-endpoints.mjs --json', { cwd: process.cwd() }).toString();
    const { orphans } = JSON.parse(out) as { orphans: string[] };
    expect(orphans).not.toContain('characters/bible/[name]');
    expect(orphans).not.toContain('cameo-ip/[tokenId]');
  });
});
