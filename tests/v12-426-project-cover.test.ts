/**
 * v12.426 项目卡片全是渐变占位图 —— owner 看 README 截图时发现的。
 *
 * 根因不是「库里有垃圾项目」,而是**封面被冻结成了一次失败的快照**:
 *   create-pipeline.ts:942  const coverUrl = finalStoryboards[0]?.imageUrl || ''
 * 抄一次就再不重算。于是三种假封面被永久写死:
 *   ① 出图全挂时 hybrid-orchestrator 返回的 mockSvg(渐变 + 「Shot 1」字样);
 *   ② mock 引擎的产物服务 /api/mock-assets/*.svg;
 *   ③ 引擎直链里带 Expires= 的签名 URL(实测赤马斩龙那条 2026-06-17 就过期了)。
 * 实测 30 个项目里 12 个封面是 ①②,6 个是 ③;其中月挂不下来/宿命之柱/AI觉醒
 * 各有 11~12 张真分镜还活着 —— 用户重生过,封面却没人重算。
 *
 * 这些断言锁的是「卡片能不能显示真画面」,不是锁某个字符串怎么写。
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import {
  isMockPlaceholder, isGenericSample, isExpiredUrl, resolveProjectCovers, nextCoverIndex,
} from '../lib/project-cover';

const REAL = '/api/serve-file?key=9ff8299a6a82c4236029cebd106af478';
const REAL2 = '/api/serve-file?key=ab583ed61649ebb9550f8bfeb1f5bd45';
/** 实测样本:赤马斩龙冻结的封面,Expires 对应 2026-06-17。 */
const EXPIRED = 'https://hailuo-image-algeng-data.oss-cn-wulanchabu.aliyuncs.com/x.jpg?Expires=1781694879&sig=a';
const MOCK_DATA = 'data:image/svg+xml,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%3E%3C%2Fsvg%3E';
const MOCK_ROUTE = 'http://localhost:3000/api/mock-assets/image/2cf3b3d1.svg?ar=9%3A16&label=Shot%201';
const SAMPLE = '/styles/cyberpunk.jpg';

describe('v12.426 假封面的三种形态都要认出来', () => {
  it('mock 占位有两种形态,都算 mock', () => {
    expect(isMockPlaceholder(MOCK_DATA), 'data: 内联 SVG').toBe(true);
    // 第一版只认 data:,漏了这条 —— 绿皮书之约的卡片因此实拍出一块纯绿色矩形
    expect(isMockPlaceholder(MOCK_ROUTE), 'mock 引擎产物服务').toBe(true);
  });

  it('真画面与风格样张都不是 mock', () => {
    expect(isMockPlaceholder(REAL)).toBe(false);
    expect(isMockPlaceholder(SAMPLE)).toBe(false);
    expect(isMockPlaceholder(EXPIRED)).toBe(false);
  });

  it('空值按 mock 处理 —— 没有封面不能冒充有封面', () => {
    expect(isMockPlaceholder(null)).toBe(true);
    expect(isMockPlaceholder(undefined)).toBe(true);
    expect(isMockPlaceholder('')).toBe(true);
  });

  it('风格样张能被认出(能看,但不是本片的画面)', () => {
    expect(isGenericSample(SAMPLE)).toBe(true);
    expect(isGenericSample(REAL)).toBe(false);
  });

  it('签名链的过期时刻写在 query 里,读出来比较,不靠猜', () => {
    const now = Date.parse('2026-09-07T00:00:00Z');
    expect(isExpiredUrl(EXPIRED, now), '2026-06-17 已过期').toBe(true);
    expect(isExpiredUrl('https://x/a.jpg?Expires=4102444800', now), '2100 年才过期').toBe(false);
    expect(isExpiredUrl(REAL, now), '本地链没有 Expires').toBe(false);
    expect(isExpiredUrl(null, now)).toBe(false);
  });
});

describe('v12.426 候选串的优先级', () => {
  it('mock 永远不进候选 —— 出图失败不能冒充成片长这样', () => {
    const out = resolveProjectCovers([
      { source: 'stored', url: MOCK_DATA },
      { source: 'storyboard', url: MOCK_ROUTE },
    ]);
    expect(out).toEqual([]);
  });

  it('用户定版 > 冻结封面 > 本片分镜 > 本片视频', () => {
    const out = resolveProjectCovers([
      { source: 'video', url: '/v.mp4' },
      { source: 'storyboard', url: REAL },
      { source: 'stored', url: REAL2 },
      { source: 'chosen', url: '/chosen.jpg' },
    ]);
    expect(out).toEqual(['/chosen.jpg', REAL2, REAL, '/v.mp4']);
  });

  it('已过期的签名链排到最后 —— 否则每次都先打一发必 404 的请求', () => {
    // stored 的优先级本来高于 storyboard,但它已经过期,应让位给永久链接
    const out = resolveProjectCovers([
      { source: 'stored', url: EXPIRED },
      { source: 'storyboard', url: REAL },
    ]);
    expect(out[0], '首选必须是能加载的那张').toBe(REAL);
    expect(out[out.length - 1]).toBe(EXPIRED);
  });

  it('通用风格样张排在本片自有画面之后', () => {
    const out = resolveProjectCovers([
      { source: 'stored', url: SAMPLE },
      { source: 'video', url: REAL },
    ]);
    expect(out[0]).toBe(REAL);
    expect(out[1]).toBe(SAMPLE);
  });

  it('样张仍好过没有 —— 只有它时照样给出来', () => {
    expect(resolveProjectCovers([{ source: 'stored', url: SAMPLE }])).toEqual([SAMPLE]);
  });

  it('同一张出现在多个来源时去重,且保留最高优先级的位置', () => {
    const out = resolveProjectCovers([
      { source: 'video', url: REAL },
      { source: 'stored', url: REAL },
    ]);
    expect(out).toEqual([REAL]);
  });
});

describe('v12.426 调用方确实接上了(不是造好没接线)', () => {
  const read = (p: string) => fs.readFileSync(path.join(process.cwd(), p), 'utf-8');

  it('项目列表接口用解析结果,不再直接吐 cover_urls', () => {
    const src = read('app/api/projects/route.ts');
    expect(src).toContain('resolveProjectCovers');
    const code = src.replace(/\/\*[\s\S]*?\*\//g, '').split('\n')
      .map((l) => l.replace(/--.*$/, '').replace(/\/\/.*$/, '')).join('\n');
    // GET 里不能再有「covers: 直接解析 cover_urls」这种写法(POST 回显新建项目不算)
    const getPart = code.slice(0, code.indexOf('export async function POST'));
    // 窗口自证:否定断言在切歪的窗口上必然通过(空串/错段),先证明确实切到了 GET。
    expect(getPart, 'GET 段没切到').toContain('export async function GET');
    expect(getPart, 'GET 段没切到解析调用').toContain('resolveProjectCovers');
    expect(getPart).not.toMatch(/covers:\s*safeJsonParse<string\[\]>\(r\.cover_urls/);
  });

  it('卡片走的是 nextCoverIndex,回退行为可测(不是只在源码里找字样)', () => {
    const src = read('app/dashboard/projects/page.tsx');
    expect(src).toContain('nextCoverIndex(');
    expect(src).toContain('coverList');
  });

  it('分镜子查询按镜号排序 —— 封面该是第 1 镜,不是随便一张', () => {
    const sql = read('app/api/projects/route.ts');
    // 只写 toMatch(/ORDER BY shot_number/) 是不够的:视频那条子查询也有同样的排序,
    // 把分镜那条改坏了断言照样绿(实测变异⑨没转红)。锚到 storyboard 子查询本身。
    const sb = sql.slice(sql.indexOf("type = 'storyboard'"), sql.indexOf('AS storyboard_media'));
    expect(sb, '没截到 storyboard 子查询').toContain('ORDER BY');
    expect(sb).toMatch(/ORDER BY shot_number ASC, updated_at DESC/);
  });
});

describe('v12.426 候选串回退的推进', () => {
  it('一张张往后走,走完给 null', () => {
    expect(nextCoverIndex(0, 3)).toBe(1);
    expect(nextCoverIndex(1, 3)).toBe(2);
    expect(nextCoverIndex(2, 3), '最后一张之后没有了').toBeNull();
  });

  it('没有候选时直接 null,不会指向空数组', () => {
    expect(nextCoverIndex(0, 0)).toBeNull();
  });

  it('下标脏了也不越界 —— dataset 里存的是字符串,可能是 NaN', () => {
    expect(nextCoverIndex(Number.NaN, 3), '脏值时从头来').toBe(0);
    expect(nextCoverIndex(Number.NaN, 0)).toBeNull();
    expect(nextCoverIndex(-5, 3)).toBe(0);
    expect(nextCoverIndex(99, 3)).toBeNull();
  });
});
