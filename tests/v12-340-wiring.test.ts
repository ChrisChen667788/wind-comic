/**
 * v12.340 — 两条纯接线:算了却没人消费的东西,接到用户看得见的地方。
 *
 * ① **连续性主表**:`editor-agent` 自 v12.16.0 就 `emit('continuitySheet', …)`,
 *    而前端 SSE switch **一直没有对应 case** —— 事件落进 default 被静默丢弃。
 *    跨镜光照漂移、画幅/帧率不一致这些出片前该看见的隐患,算了却从不呈现。
 * ② **发布预检**:`GET /publish-preflight` 早就在,`lib/create-pipeline` 内部用了,
 *    但**前端零消费方** —— 于是「这条片子在抖音会不会因为时长/画幅被拒」
 *    只有真发出去撞墙才知道。
 *
 * 两条都只改消费方,不动被调用侧。
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';

const CREATE = fs.readFileSync('app/dashboard/create/page.tsx', 'utf-8');
const PANEL = fs.readFileSync('components/project/distribution-panel.tsx', 'utf-8');
const AGENT = fs.readFileSync('services/agents/editor-agent.ts', 'utf-8');
const ROUTE = fs.readFileSync('app/api/projects/[id]/publish-preflight/route.ts', 'utf-8');

describe('v12.340 · 连续性主表不再被静默丢弃', () => {
  it('前提校验:editor-agent 确实 emit 了这个事件(不是我凭空加消费方)', () => {
    expect(AGENT).toMatch(/emit\('continuitySheet'/);
  });

  it('SSE switch 有对应 case', () => {
    expect(CREATE).toMatch(/case 'continuitySheet'/);
  });

  it('落法与既有 pacingAudit 同源(挂 script 资产的 data),不另起一套', () => {
    const i = CREATE.indexOf("case 'continuitySheet'");
    const block = CREATE.slice(i, i + 700);
    expect(block).toContain("s.assets.find(a => a.type === 'script')");
    expect(block).toContain('continuitySheet:');
  });

  it('有隐患时**点名说清楚**,不是只报个数', () => {
    const i = CREATE.indexOf("case 'continuitySheet'");
    const block = CREATE.slice(i, i + 900);
    expect(block, '要把 issues 内容带出来').toMatch(/issues\.slice\(/);
    expect(block).toContain('addChatMessage');
  });

  it('没有隐患时不打扰用户(不无条件发消息)', () => {
    const i = CREATE.indexOf("case 'continuitySheet'");
    const block = CREATE.slice(i, i + 900);
    expect(block, '发消息必须在 issues 非空的条件里').toMatch(/if \(issues\.length\)/);
  });
});

describe('v12.340 · 发布预检接进面板', () => {
  it('前提校验:端点是 GET,返回 { ok, meta, platforms }', () => {
    expect(ROUTE).toMatch(/export async function GET/);
    expect(ROUTE).toMatch(/platforms: preflightAll\(meta\)/);
  });

  it('面板真的去调它了(此前零消费方)', () => {
    expect(PANEL).toContain('publish-preflight');
  });

  it('**读的是 platforms 字段** —— 不是想当然的 results', () => {
    expect(PANEL).toMatch(/j\?\.platforms/);
    expect(PANEL, 'results 是我第一版猜错的字段名').not.toMatch(/j\?\.results/);
  });

  it('每个平台卡上有预检徽章', () => {
    expect(PANEL).toMatch(/data-testid=\{`preflight-\$\{p\.platform\}`\}/);
  });

  it('阻断项摊开写,不藏在悬停 title 里', () => {
    expect(PANEL, 'issues 要渲染成列表').toMatch(/pf\.issues\.map\(/);
  });

  it('发布前拦一道,但**不剥夺用户坚持发布的权利**(平台规则会变,预检也可能保守)', () => {
    const i = PANEL.indexOf('async function publish(');
    const block = PANEL.slice(i, i + 600);
    expect(block).toMatch(/if \(pf && !pf\.pass\)/);
    expect(block, '要给确认而不是硬拦').toContain('window.confirm');
    expect(block).toMatch(/if \(!ok\) return;/);
  });

  it('预检拉取失败不打断发布流程(404「还没成片」是正常状态,不是错误)', () => {
    // 断言窗口按**语义**界定:从预检 effect 开头切到它的依赖数组,
    // 而不是围绕 URL 出现位置猜一个字符数(第一版就是这么取错的)。
    const i = PANEL.indexOf('publish-preflight');
    const end = PANEL.indexOf('}, [projectId]);', i);
    expect(end, '找不到预检 effect 的结尾').toBeGreaterThan(i);
    const block = PANEL.slice(i, end);
    expect(block).toContain('setPreflightNote');
    expect(block, '不该把预检失败塞进主错误态').not.toMatch(/setErr\(/);
  });

  it('子组件按 props 拿本平台结论,不自己去父作用域找', () => {
    expect(PANEL).toMatch(/pf\?: PreflightRow/);
    expect(PANEL).toMatch(/pf=\{preflight\?\.find\(/);
  });
});
