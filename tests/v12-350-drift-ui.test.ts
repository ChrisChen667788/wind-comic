/**
 * v12.350:画风漂移检测接线 —— 端点从 v12.2.4 就在,前端一次都没调过。
 *
 * 放在「技术监看台」而不是评分面板,是有理由的:漂移是**客观可量化**的
 * (逐镜视觉 embedding 的余弦距离),和示波器同类;而既有的一致性评分是
 * LLM 对画面的主观描述。两者不该混在一处,否则用户分不清哪个是测量、哪个是判断。
 *
 * 它抓的是**渐进漂移**:每一镜单看都还行,但第 1 镜和第 11 镜已经不像同一部片。
 *
 * ⚠️ 诚实前提:本机未配 `IMAGE_EMBED_MODEL`,端点如实返回
 * `{available:false, reason}`。所以这一版交付的是**接线 + 正确的降级显示**,
 * 而不是「能看到漂移数字」。配上该模型后才有数值。
 */
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

const UI = fs.readFileSync(path.join(process.cwd(), 'components/project/monitor-tab.tsx'), 'utf8');
const PANEL = UI.slice(UI.indexOf('function DriftPanel'), UI.indexOf('export function MonitorTab'));

describe('v12.350 漂移面板接线', () => {
  it('确实调了 drift-check 端点', () => {
    expect(PANEL).toMatch(/\/api\/projects\/\$\{projectId\}\/drift-check/);
  });

  it('按需触发,不自动加载 —— 每张分镜都要 embedding,开销和费用都不小', () => {
    expect(PANEL).toMatch(/data-testid="drift-check-run"/);
    // 不应有 useEffect 自动拉取
    expect(PANEL).not.toMatch(/useEffect\(\(\) => \{[\s\S]{0,120}drift-check/);
  });

  it('**available:false 时如实说不可用并给出原因**,不假装算过', () => {
    expect(PANEL).toMatch(/!data\.available/);
    expect(PANEL).toMatch(/暂不可用/);
    expect(PANEL).toMatch(/data\.reason/);
  });

  it('失败有用户可见反馈(role=alert),不是只 console', () => {
    expect(PANEL).toMatch(/role="alert"/);
    expect(PANEL).toMatch(/setErr\(/);
    expect(PANEL).toMatch(/setErr\(j\?\.message/);
  });

  it('降级说明用 role=status,与错误区分开', () => {
    expect(PANEL).toMatch(/role="status"/);
  });

  it('进行中禁用按钮并复位(finally)', () => {
    expect(PANEL).toMatch(/disabled=\{busy\}/);
    expect(PANEL).toMatch(/finally \{[\s\S]{0,40}setBusy\(false\)/);
  });

  it('偏离镜要在图上被标出来,不能只报个平均值', () => {
    expect(PANEL).toMatch(/outlierSet/);
    expect(PANEL).toMatch(/outlierSet\.has\(x\.shotNumber\)/);
    expect(PANEL).toMatch(/bg-amber-400/);
  });

  it('没有偏离镜时也要明说,不留空白让人猜', () => {
    expect(PANEL).toMatch(/未发现明显偏离/);
  });

  it('柱高按最大值归一,且有最小可见高度(0 值不该消失)', () => {
    expect(PANEL).toMatch(/const maxDrift = Math\.max\(/);
    expect(PANEL).toMatch(/Math\.max\(3,/);
  });

  it('说清楚漂移是相对值 —— 避免用户拿两部片的数字互相比', () => {
    expect(PANEL).toMatch(/只在同一部片内可比/);
  });

  it('已挂进监看台', () => {
    expect(UI).toMatch(/<DriftPanel projectId=\{projectId\} \/>/);
  });

  it('图表有无障碍标签', () => {
    expect(PANEL).toMatch(/role="img"/);
    expect(PANEL).toMatch(/aria-label="逐镜漂移分值"/);
  });
});
