/**
 * v12.356:导演评审接线 —— 以及接线时当场抓到的一个假绿。
 *
 * **接线部分**:`director-review` 是 SSE 流式端点,前端零引用。
 * `components/nodes/review-node` 能渲染评审结果,却**没有任何东西触发它** ——
 * 有渲染器、没触发器。这一版补的正是那个触发器,放在「导演台」(它就是全链路控片的位置)。
 *
 * **更要紧的部分**:实测第一次跑就发现 LLM 超时后,端点**照样发出 `review` 事件**:
 *
 *     review: 评分=75 · 达标=true · 摘要「抱歉,出现了错误: Request timed out.」
 *
 * 病根是 `overallScore: parsed?.overallScore ?? 75` + `passed: … >= 75` ——
 * **把兜底默认值放在「结论」上,就是在编结论**。用户看到一块绿牌子,而审片从未发生。
 * 这与 v12.344 的 Ken Burns 占位片是同一族病:降级伪装成成功。
 */
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

const read = (rel: string) => fs.readFileSync(path.join(process.cwd(), rel), 'utf8');
const ROUTE = read('app/api/projects/[id]/director-review/route.ts');
const UI = read('components/director-console.tsx');

describe('v12.356 评审没发生时不许发结论', () => {
  /** 只看**代码行**:说明注释里引用了旧写法,断言不该被自己的注释绊倒。 */
  const CODE = ROUTE.split('\n')
    .filter((l) => { const t = l.trimStart(); return !t.startsWith('//') && !t.startsWith('*') && !t.startsWith('/*'); })
    .join('\n');

  it('不再用 ?? 75 兜底评分', () => {
    expect(CODE).not.toMatch(/overallScore: parsed\?\.overallScore \?\? 75/);
    expect(CODE).not.toMatch(/passed: \(parsed\?\.overallScore \?\? 75\) >= 75/);
  });

  it('解析失败且内容像报错 → 发 error 而不是 review', () => {
    expect(ROUTE).toMatch(/const looksFailed/);
    expect(ROUTE).toMatch(/code: 'review_incomplete'/);
    // 必须真的 return,不能发完 error 又接着发 review
    const win = ROUTE.slice(ROUTE.indexOf('if (looksFailed)'), ROUTE.indexOf('const score ='));
    expect(win).toMatch(/controller\.close\(\);/);
    expect(win).toMatch(/return;/);
  });

  it('识别覆盖中英文两种报错措辞 + 空输出', () => {
    expect(ROUTE).toMatch(/!fullContent\.trim\(\)/);
    expect(ROUTE).toMatch(/出现了错误\|timed out\|timeout\|error\|失败/);
  });

  it('有内容但解析不出结构 → 分数为 null,**不编一个**', () => {
    expect(ROUTE).toMatch(/const score = typeof parsed\?\.overallScore === 'number' \? parsed\.overallScore : null/);
    expect(ROUTE).toMatch(/overallScore: score,/);
  });

  it('分数缺失时 passed 也是 null —— 不敢说达标', () => {
    expect(ROUTE).toMatch(/passed: score === null \? null : score >= 75/);
    expect(ROUTE).toMatch(/scored: score !== null/);
  });
});

describe('v12.356 前端三态', () => {
  it('类型上承认 overallScore / passed 可为 null', () => {
    expect(UI).toMatch(/overallScore: number \| null/);
    expect(UI).toMatch(/passed: boolean \| null/);
  });

  it('**不能用 Number(x) || 0** —— 会把「没评分」变成「0 分」', () => {
    expect(UI).not.toMatch(/Number\(d\.overallScore\) \|\| 0/);
    expect(UI).toMatch(/typeof d\.overallScore === 'number' \? d\.overallScore : null/);
  });

  it('第三态不画绿牌(那正是原实现的假绿)', () => {
    expect(UI).toMatch(/review\.passed === null \? '' : review\.passed \? 'cinema-chip-green'/);
    expect(UI).toContain('未给出评分');
    expect(UI).toContain('模型未返回结构化评分');
  });
});

describe('v12.356 SSE 接线', () => {
  const WIN = UI.slice(UI.indexOf('async function runDirectorReview'), UI.indexOf('  return ('));

  it('有触发按钮', () => {
    expect(UI).toMatch(/data-testid="director-review-run"/);
  });

  it('逐事件处理 status / content / review / error 四种', () => {
    for (const t of ['status', 'content', 'review', 'error']) expect(WIN).toContain(`'${t}'`);
  });

  it('**边收边显示** —— 审片要一分钟,不能让人干转圈', () => {
    expect(WIN).toMatch(/setReviewStream/);
    expect(UI).toMatch(/\{reviewStream && \(/);
  });

  it('流结束却没拿到结论要如实说,不留空面板', () => {
    expect(WIN).toMatch(/if \(!gotReview\)/);
    expect(WIN).toContain('评审流已结束但没有返回结论');
  });

  it('错误用 role=alert、进行中用 role=status', () => {
    expect(UI).toMatch(/role="alert"[\s\S]{0,120}reviewErr/);
    expect(UI).toMatch(/\{reviewing && \([\s\S]{0,140}role="status"/);
  });

  it('进行中禁用并在 finally 复位', () => {
    expect(UI).toMatch(/disabled=\{reviewing\}/);
    expect(WIN).toMatch(/finally \{[\s\S]{0,80}setReviewing\(false\)/);
  });

  it('说清「这是判断不是测量」,并指向客观仪表', () => {
    expect(UI).toContain('这是 LLM 对全片资产的整体判断');
    expect(UI).toContain('客观测量见监看台');
  });
});
