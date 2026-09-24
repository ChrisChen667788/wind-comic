/**
 * v12.454 · 开机失败要**留在界面上**。
 *
 * 病象:开机请求非 200(实测 401;v12.448 新加的归属守卫会产生 403;还有 402 预算、429、断网)
 * 或 SSE 推来 error 时,创作工坊只弹一个几秒就消失的浮层。浮层一没,顶栏仍写着「创作中」、
 * 各节点仍是「等待编剧完成…」——**与「跑得慢」完全无法区分**,用户一直干等。
 * v12.433 修的是后端「不许把失败标成完成」,这是它的前端孪生。
 *
 * 这里既测判定逻辑,也**真渲染**顶栏状态行:本仓反复犯的是「状态写进了 store,界面没人读」,
 * 只扫源码的测试对那种缺陷是瞎的。
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { markPipelineFailed, failureReasonFromResponse, type FailableStore } from '@/lib/pipeline-failure';
import { PipelineStatusBadge } from '@/components/pipeline-status-badge';
import { useProjectWorkspaceStore } from '@/lib/store';
import { AgentRole } from '@/types/agents';

describe('v12.454 · 非 200 → 给人看的话', () => {
  it('按状态码说人话:401 让人重登、403 说没权限、402 说预算、429 说太频繁', () => {
    expect(failureReasonFromResponse(401)).toContain('登录');
    expect(failureReasonFromResponse(403)).toContain('权限');
    expect(failureReasonFromResponse(402)).toMatch(/余额|预算/);
    expect(failureReasonFromResponse(429)).toMatch(/频繁/);
  });

  it('服务端给了自己的话就用它(403 的「无权在该项目上创作」要原样到用户眼前)', () => {
    expect(failureReasonFromResponse(403, { error: '无权在该项目上创作' })).toBe('无权在该项目上创作');
    expect(failureReasonFromResponse(402, { guard: {}, error: '今日预算 ¥10 已用完' })).toBe('今日预算 ¥10 已用完');
  });

  it('没给话也没认识的状态码 → 带上状态码,不说空话', () => {
    expect(failureReasonFromResponse(500)).toContain('500');
  });

  it('服务端的话再长也截断(报错原文里可能带内部路径 / 栈)', () => {
    const long = 'x'.repeat(500);
    expect(failureReasonFromResponse(500, { message: long }).length).toBeLessThanOrEqual(120);
  });

  it('body 不是对象 / 字段不是字符串都不能崩', () => {
    expect(failureReasonFromResponse(500, null)).toContain('500');
    expect(failureReasonFromResponse(500, 'boom')).toContain('500');
    expect(failureReasonFromResponse(500, { message: 42 })).toContain('500');
  });
});

describe('v12.454 · 失败落到界面状态上', () => {
  const mkStore = () => {
    const calls: Array<[string, any]> = [];
    const store: FailableStore & { error: any; chat: any[] } = {
      nodes: [
        { id: 'node-writer', data: { status: 'completed' } },
        { id: 'node-character', data: { status: 'running' } },
        { id: 'node-video', data: { status: 'pending' } },
      ],
      updateNodeData: (id, data) => calls.push([id, data]),
      addChatMessage: (_r, m) => store.chat.push(m),
      setPipelineError: (e) => { store.error = e; },
      error: undefined,
      chat: [],
    };
    return { store, calls };
  };

  it('只有正在跑的那个节点变 error —— 没轮到的保持 pending(标红会谎报范围)', () => {
    const { store, calls } = mkStore();
    markPipelineFailed(store, { projectId: 'p1', agentRole: AgentRole.WRITER, reason: '登录已失效' });
    expect(calls).toEqual([['node-character', { status: 'error' }]]);
  });

  it('中断原因进 store(顶栏要读),并在对话流里留一条不会消失的系统消息', () => {
    const { store } = mkStore();
    markPipelineFailed(store, { projectId: 'p1', agentRole: AgentRole.WRITER, reason: '今日预算已用完', at: '2026-09-25T00:00:00.000Z' });
    expect(store.error).toEqual({ message: '今日预算已用完', at: '2026-09-25T00:00:00.000Z' });
    expect(store.chat).toHaveLength(1);
    expect(store.chat[0].content).toContain('今日预算已用完');
    expect(store.chat[0].projectId).toBe('p1');
  });
});

describe('v12.454 · 顶栏真的把中断显示出来(真渲染)', () => {
  const reset = () => useProjectWorkspaceStore.setState({ pipelineError: null, isProducing: false });
  beforeEach(reset);
  afterEach(() => { cleanup(); reset(); });

  it('没中断:照旧显示「创作中」', () => {
    render(<PipelineStatusBadge />);
    const el = screen.getByText('创作中');
    expect(el.getAttribute('data-pipeline-status')).toBe('idle');
  });

  it('中断了:顶栏变「已中断」并带上原因 —— 不是继续写着「创作中」', () => {
    useProjectWorkspaceStore.setState({ pipelineError: { message: '无权在该项目上创作', at: 'now' } });
    render(<PipelineStatusBadge />);
    const el = document.querySelector('[data-pipeline-status="error"]')!;
    expect(el, '顶栏没有把中断显示出来').not.toBeNull();
    expect(el.textContent).toContain('已中断');
    expect(el.textContent).toContain('无权在该项目上创作');
    expect(screen.queryByText('创作中')).toBeNull();
  });

  it('**在同一页里重新开机**(走 clearAgentOutputs,不走 resetWorkspace)要清掉上一次的中断标记', () => {
    useProjectWorkspaceStore.setState({ pipelineError: { message: '上一次失败了', at: 'now' } });
    useProjectWorkspaceStore.getState().clearAgentOutputs();
    render(<PipelineStatusBadge />);
    expect(document.querySelector('[data-pipeline-status="error"]'), '新一轮全程顶着上一次的「已中断」').toBeNull();
  });

  it('换项目重置工作台后,中断标记不会跟着带到下一个项目', () => {
    useProjectWorkspaceStore.setState({ pipelineError: { message: '上一个项目中断了', at: 'now' } });
    useProjectWorkspaceStore.getState().resetWorkspace();
    render(<PipelineStatusBadge />);
    expect(document.querySelector('[data-pipeline-status="error"]')).toBeNull();
  });
});

describe('v12.454 · 开机失败真的调了它(创作页接线)', () => {
  it('创作页在非 200 分支调 markPipelineFailed,而不是只 throw', async () => {
    const fs = await import('node:fs');
    const src = fs.readFileSync('app/dashboard/create/page.tsx', 'utf-8');
    const i = src.indexOf('if (!response.ok)');
    expect(i, '开机请求的非 200 分支不见了').toBeGreaterThan(0);
    expect(src.slice(i, i + 600)).toContain('markPipelineFailed');
    // SSE 的 error 事件同样要落到界面上
    const e = src.indexOf("case 'error':");
    expect(src.slice(e, e + 600)).toContain('markPipelineFailed');
  });
});
