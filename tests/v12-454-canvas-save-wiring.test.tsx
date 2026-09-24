/**
 * v12.454 · 画布**真渲染**:拖动结束要真的把位置存出去,进来要真的把存过的位置用上。
 *
 * 为什么单开一个文件真渲染:纯逻辑测试(防抖器、校验、路由)全绿,而「组件到底有没有把
 * onNodeDragStop 接到保存上」它们一条都管不着 —— 变异验证里把组件里那一行调用删掉,
 * 17 条纯逻辑测试全绿放行。本仓最常见的坏法正是这个:能力写好了,没接线。
 *
 * ReactFlow 在 jsdom 里要量画布尺寸,渲染真的流图既慢又脆 —— 所以把 ReactFlow 换成
 * 只捕获 props 的桩件:**被捕获的回调就是组件真正交给流图的那个**,照样能证明接线在。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, act } from '@testing-library/react';
import { useProjectWorkspaceStore } from '@/lib/store';
import { AgentRole } from '@/types/agents';

const captured = vi.hoisted(() => ({ props: null as any, toasts: [] as any[] }));

vi.mock('@/components/ui/toast-provider', () => ({
  useToast: () => ({ showToast: (t: any) => captured.toasts.push(t) }),
}));

vi.mock('@xyflow/react', async (orig) => {
  const actual = await orig() as any;
  return {
    ...actual,
    // 只替掉画布本体:不渲染 children(Background/Controls 需要流图上下文),其余 hook 用真的
    ReactFlow: (props: any) => { captured.props = props; return <div data-testid="flow" />; },
  };
});

const node = (id: string, x: number, y: number) => ({
  id, type: 'script', position: { x, y },
  data: { label: id, status: 'pending', agentRole: AgentRole.WRITER },
});

describe('v12.454 · 画布拖完真的存(真渲染)', () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    captured.props = null; captured.toasts = [];
    fetchMock = vi.fn(async (_url: string, init?: any) =>
      new Response(JSON.stringify({ positions: init?.method === 'PATCH' ? {} : { 'node-video': { x: 700, y: 120 } } }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    useProjectWorkspaceStore.setState({
      currentProject: { id: 'p-canvas', title: 't' } as any,
      nodes: [node('node-writer', 0, 0), node('node-video', 10.4, -20.6)] as any,
      assets: [],
    });
  });
  afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.useRealTimers(); });

  it('拖动结束 → PATCH 把位置送出去(坐标取整、带 keepalive)', async () => {
    const { PipelineCanvas } = await import('@/components/pipeline-canvas');
    render(<PipelineCanvas />);
    expect(captured.props, '画布没渲染出来').not.toBeNull();
    expect(typeof captured.props.onNodeDragStop, 'onNodeDragStop 没接上流图').toBe('function');

    await act(async () => { captured.props.onNodeDragStop(); });
    await act(async () => { await new Promise(r => setTimeout(r, 700)); }); // 等过防抖窗口

    const patches = fetchMock.mock.calls.filter(([, init]) => (init as any)?.method === 'PATCH');
    expect(patches, '拖完没有把布局存出去').toHaveLength(1);
    const [url, init] = patches[0] as [string, any];
    expect(url).toContain('/api/projects/p-canvas/canvas-layout');
    expect(init.keepalive).toBe(true);
    expect(JSON.parse(init.body).positions['node-video']).toEqual({ x: 10, y: -21 });
  });

  it('位置以拖动回调带回的为准 —— 闭包里的 nodes 可能还是拖动前那一帧', async () => {
    const { PipelineCanvas } = await import('@/components/pipeline-canvas');
    render(<PipelineCanvas />);
    await act(async () => { await new Promise(r => setTimeout(r, 50)); });
    // ReactFlow 回调传回的是本次被拖节点的**最新**位置
    await act(async () => { captured.props.onNodeDragStop({}, { id: 'node-video', position: { x: 321.6, y: 654.4 } }); });
    await act(async () => { await new Promise(r => setTimeout(r, 700)); });
    const patch = fetchMock.mock.calls.filter(([, init]) => (init as any)?.method === 'PATCH').at(-1) as [string, any];
    expect(JSON.parse(patch[1].body).positions['node-video'], '存的不是拖完的位置').toEqual({ x: 322, y: 654 });
  });

  it('换项目:新项目不能继承上一个项目的坐标(八个节点 id 在所有项目里都一样)', async () => {
    const { PipelineCanvas } = await import('@/components/pipeline-canvas');
    const { rerender } = render(<PipelineCanvas />);
    await act(async () => { await new Promise(r => setTimeout(r, 50)); });
    expect(captured.props.nodes.find((n: any) => n.id === 'node-video').position).toEqual({ x: 700, y: 120 }); // A 的布局
    // 换到没存过布局的项目 B
    fetchMock.mockImplementation(async () => new Response(JSON.stringify({ positions: {} }), { status: 200 }));
    await act(async () => {
      useProjectWorkspaceStore.setState({
        currentProject: { id: 'p-other', title: 'B' } as any,
        nodes: [node('node-writer', 0, 0), node('node-video', 1440, 0)] as any,
      });
      await new Promise(r => setTimeout(r, 80));
    });
    rerender(<PipelineCanvas />);
    await act(async () => { await new Promise(r => setTimeout(r, 50)); });
    expect(captured.props.nodes.find((n: any) => n.id === 'node-video').position, 'B 项目顶着 A 项目的布局').toEqual({ x: 1440, y: 0 });
  });

  it('保存被接口拒掉时,当场告诉用户 —— 不能拖完照样跟手、刷新才发现没存上', async () => {
    fetchMock.mockImplementation(async (_url: string, init?: any) => init?.method === 'PATCH'
      ? new Response(JSON.stringify({ error: 'node-writer.x 超出 ±100000' }), { status: 400 })
      : new Response(JSON.stringify({ positions: {} }), { status: 200 }));
    const { PipelineCanvas } = await import('@/components/pipeline-canvas');
    render(<PipelineCanvas />);
    await act(async () => { captured.props.onNodeDragStop(); });
    await act(async () => { await new Promise(r => setTimeout(r, 700)); });
    expect(captured.toasts, '保存失败了却什么都没说').toHaveLength(1);
    expect(JSON.stringify(captured.toasts[0])).toContain('超出');
  });

  it('进来时把存过的位置读回来用上(否则刷新还是回默认布局)', async () => {
    const { PipelineCanvas } = await import('@/components/pipeline-canvas');
    render(<PipelineCanvas />);
    await act(async () => { await new Promise(r => setTimeout(r, 50)); });
    const got = captured.props.nodes.find((n: any) => n.id === 'node-video');
    expect(got.position, '读回来的位置没用上').toEqual({ x: 700, y: 120 });
  });

  it('布局先读回来、节点随后才从 store 填进来(打开项目时的真实顺序)—— 位置不能被默认布局盖掉', async () => {
    // 画布挂载时 store 里还没有节点:项目数据是异步来的,而布局接口通常先回
    useProjectWorkspaceStore.setState({ nodes: [] as any });
    const { PipelineCanvas } = await import('@/components/pipeline-canvas');
    render(<PipelineCanvas />);
    await act(async () => { await new Promise(r => setTimeout(r, 50)); }); // 布局已读回
    await act(async () => {
      useProjectWorkspaceStore.setState({
        nodes: [node('node-writer', 0, 0), { ...node('node-video', 10.4, -20.6), data: { label: 'node-video', status: 'running', agentRole: AgentRole.WRITER } }] as any,
      });
      await new Promise(r => setTimeout(r, 20));
    });
    const got = captured.props.nodes.find((n: any) => n.id === 'node-video');
    expect(got.data.status, '状态没跟上').toBe('running');
    expect(got.position, '存过的位置被默认布局盖掉了').toEqual({ x: 700, y: 120 });
  });
});
