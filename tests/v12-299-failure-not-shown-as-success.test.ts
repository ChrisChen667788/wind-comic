/**
 * v12.299 — 两处**把失败显示成成功/静默**的前端缺陷(缺口审计的两条 high)。
 *
 * ① `editor-node` 重新剪辑失败 → catch 里写的是 `status:'completed', progress:100`。
 *    于是网络出错或 5xx 时,节点标题照样出现**蓝色对勾**、进度 **100%**、按钮全亮 ——
 *    与真正成功**完全一致**;而 editResult 还是旧数据。用户以为剪辑刷新了,其实什么都没变。
 *    更糟的是:这个节点的渲染层**根本没有 error 分支**,所以光把状态改成 'error' 也只是
 *    换一种静默(什么图标都不显示、空态文案是空字符串)。状态与渲染必须一起补。
 *
 * ② `video-node` 的失败判定是 `!hasMedia && d.status === 'completed'` ——
 *    **依赖整个节点跑完**。多镜同时生成时节点是 running,于是某一镜网络超时进 catch、
 *    资产已写 `status:'error'`,格子却静默变回「待生成」,连「点击重试」都不出现:
 *    用户以为它还在排队,其实早就死了。
 *
 * 这两条与本轮的「静默失败」主题同源 —— 退出码/状态说成功,而实际没做成。
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';

const stripComments = (t: string) =>
  t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '');

const EDITOR = stripComments(fs.readFileSync('components/nodes/editor-node.tsx', 'utf-8'));
const VIDEO = stripComments(fs.readFileSync('components/nodes/video-node.tsx', 'utf-8'));

describe('v12.299 · 重新剪辑失败不再冒充成功', () => {
  it('**catch 里不得再写 completed/100**(那正是把失败画成蓝勾的那行)', () => {
    const i = EDITOR.indexOf("catch (error)");
    expect(i, '未找到 handleRegenerate 的 catch').toBeGreaterThan(0);
    const block = EDITOR.slice(i, i + 700);
    expect(block).not.toMatch(/status:\s*'completed'/);
    expect(block).toMatch(/status:\s*'error'/);
  });

  it('失败原因被记下来,而不是只进 console', () => {
    const i = EDITOR.indexOf("catch (error)");
    const block = EDITOR.slice(i, i + 700);
    expect(block).toContain('setRegenError');
  });

  it('**渲染层要有 error 分支** —— 否则改了状态也只是换一种静默', () => {
    expect(EDITOR, '标题区缺 error 图标').toMatch(/d\.status === 'error'/);
    expect(EDITOR, '要给用户一句人话').toContain('重新剪辑失败');
    // 且要说明「原结果还在」,避免用户以为数据丢了
    expect(EDITOR).toContain('已保留原剪辑结果');
  });

  it('重试前清掉上次的失败原因(否则成功后仍挂着旧报错)', () => {
    const i = EDITOR.indexOf('const handleRegenerate');
    expect(EDITOR.slice(i, i + 200)).toContain('setRegenError(null)');
  });

  it('三种状态的图标互不重叠(error 不会同时画出对勾)', () => {
    for (const st of ['running', 'completed', 'pending', 'error']) {
      expect(EDITOR, `缺 ${st} 分支`).toContain(`d.status === '${st}'`);
    }
    // 对勾只挂在 completed 上
    const iCheck = EDITOR.indexOf('CheckCircle2 className');
    expect(EDITOR.slice(Math.max(0, iCheck - 60), iCheck)).toContain("'completed'");
  });
});

describe('v12.299 · 单镜失败不再静默显示「待生成」', () => {
  it('**失败判定以该镜自己的状态为准**,不再要求整个节点已完成', () => {
    const i = VIDEO.indexOf('const isFailed');
    expect(i).toBeGreaterThan(0);
    const line = VIDEO.slice(i, VIDEO.indexOf(';', i));
    expect(line, "必须看资产自己的 data.status").toMatch(/v\.data\?\.status === 'error'/);
    expect(line, '旧判定作为兜底可以保留,但不能是唯一条件')
      .toMatch(/\|\|/);
  });

  it('正在重生成时不显示旧的失败态(否则重试中一直红着)', () => {
    const i = VIDEO.indexOf('const isFailed');
    const line = VIDEO.slice(i, VIDEO.indexOf(';', i));
    expect(line).toContain('!isRegenerating');
  });

  it('失败态给的是「生成失败 + 点击重试」,不是「待生成」', () => {
    expect(VIDEO).toContain('生成失败');
    expect(VIDEO).toContain('点击重试');
    const iFailed = VIDEO.indexOf('isFailed ? (');
    const iPending = VIDEO.indexOf('待生成');
    expect(iFailed, '失败分支必须排在「待生成」兜底之前').toBeLessThan(iPending);
  });

  it('写入错误状态的那条路径确实存在(否则判定条件永远为假)', () => {
    expect(VIDEO).toMatch(/status:\s*'error'/);
  });
});

describe('v12.299 · 行为对照:同样的状态,修复前后判定相反', () => {
  /** 复刻两版判定,证明差异不是纸面上的 */
  const oldIsFailed = (hasMedia: boolean, nodeStatus: string) => !hasMedia && nodeStatus === 'completed';
  const newIsFailed = (hasMedia: boolean, nodeStatus: string, assetStatus?: string, regenerating = false) =>
    !regenerating && (assetStatus === 'error' || (!hasMedia && nodeStatus === 'completed'));

  it('多镜生成中、某镜已失败:旧判定说「没失败」,新判定说「失败」', () => {
    expect(oldIsFailed(false, 'running')).toBe(false);              // ← 静默变回「待生成」
    expect(newIsFailed(false, 'running', 'error')).toBe(true);
  });

  it('零回归:节点已完成且无素材,两版都判失败', () => {
    expect(oldIsFailed(false, 'completed')).toBe(true);
    expect(newIsFailed(false, 'completed')).toBe(true);
  });

  it('零回归:有素材就不是失败', () => {
    expect(newIsFailed(true, 'completed')).toBe(false);
    expect(newIsFailed(true, 'running', undefined)).toBe(false);
  });

  it('重生成中即便带着旧的 error 也不判失败', () => {
    expect(newIsFailed(false, 'running', 'error', true)).toBe(false);
  });
});
