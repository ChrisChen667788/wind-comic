/**
 * v12.372:敏感词净化器对中文是**空操作** —— 1026 重试从写出来那天起就是死的。
 *
 * 顺着 v12.371 的日志继续查:`api_usage_events` 里有两条
 * `Minimax image-01 error (1026): input new_sensitive`。而代码里 1026 的处理
 * **看起来很完整** —— 视频 / 视频Fast / 图像 / 多参考图,四条路径都有
 * 「用净化后的 prompt 自动重试一次」。
 *
 * 但净化器的每一条规则都长这样:
 * ```js
 * [/\b(血腥|鲜血|流血)\b/g, '红色液体']
 * ```
 * **JS 的 `\b` 是「`[A-Za-z0-9_]` 与非词字符之间的边界」,而中文字符不是词字符** ——
 * `\b血腥\b` 在纯中文里**永远匹配不上**。实测 5 条典型 prompt:**0 条被改动**。
 *
 * 所以那个「重试一次」拿的是**逐字节相同的原文**:白白多打一次上游、多等一轮,
 * 结果必然还是 1026。**代码写得很完整,却一次都没生效过。**
 *
 * 修的时候避开刚清理过的两个坑(v12.358~v12.366):不用单字(裸 `枪` 会命中
 * 「水枪/枪法」)、**长的备选排前面**(JS 交替是 leftmost-first,`枪|手枪` 会把
 * 「手枪」切成「手+能量装置」)。
 */
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { sanitizePromptForMinimax } from '@/services/minimax.service';

describe('v12.372 中文净化真的生效', () => {
  it.each([
    ['画面血腥,地上有尸体', ['红色液体', '倒下的身影']],
    ['他掏出手枪射击', ['能量装置']],
    ['半裸的身体', ['身披薄纱']],
    ['爆炸的火光中他倒下', ['能量迸发']],
    ['用冲锋枪扫射', ['能量装置']],
    ['他吸食海洛因', ['神秘物质']],
  ])('%s 被改写', (src, wants) => {
    const out = sanitizePromptForMinimax(src);
    expect(out).not.toBe(src);
    for (const w of wants) expect(out).toContain(w);
  });

  it('**「手枪」不能被切成「手+能量装置」** —— 长备选必须排前面', () => {
    expect(sanitizePromptForMinimax('他掏出手枪')).toBe('他掏出能量装置');
    expect(sanitizePromptForMinimax('举起冲锋枪')).toBe('举起能量装置');
  });
});

describe('v12.372 不误伤(避开单字坑)', () => {
  it.each([
    '水枪玩具很好玩',
    '他的枪法很准',
    '血压偏高需要注意',
    '这是一部喜剧,笑点密集',
    '大麻烦来了',
  ])('%s 不被改写', (src) => {
    expect(sanitizePromptForMinimax(src)).toBe(src);
  });
});

describe('v12.372 实现约束', () => {
  const SRC = fs.readFileSync(path.join(process.cwd(), 'services/minimax.service.ts'), 'utf8');
  const table = SRC.slice(SRC.indexOf('const SENSITIVE_REPLACEMENTS'), SRC.indexOf('export function sanitizePromptForMinimax'));
  const code = table.split('\n').filter((l) => {
    const t = l.trimStart();
    return !t.startsWith('//') && !t.startsWith('*') && !t.startsWith('/*');
  }).join('\n');

  it('规则里不得再出现包裹中文的 `\\b`', () => {
    expect(code).not.toMatch(/\\b\(?[一-龥]/);
  });

  it('不得有单字备选项(裸 `枪` 会命中水枪/枪法)', () => {
    for (const l of code.split('\n')) {
      expect(l.match(/[(|][一-龥][|)]/g) || []).toEqual([]);
    }
  });

  it('把「JS 的 \\b 对中文无效」这条写进代码 —— 否则下次还会这么写', () => {
    expect(table).toMatch(/中文字符不是词字符/);
    expect(table).toMatch(/leftmost-\*\*first\*\*|leftmost-first/);
  });

  it('四条 1026 重试路径仍在(修的是净化器,不是重试机制)', () => {
    expect((SRC.match(/retryCount === 0/g) || []).length).toBeGreaterThanOrEqual(4);
  });
});
