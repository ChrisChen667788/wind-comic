/**
 * v12.5.0(#4)— 工坊「进行中任务」全局追踪 store(切模块/刷新不丢任务)。
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { useActiveGenerationStore } from '@/lib/store';

const KEY = 'qfmj-active-generation';

describe('v12.5.0 · useActiveGenerationStore', () => {
  beforeEach(() => {
    localStorage.clear();
    useActiveGenerationStore.getState().finish();
  });

  it('start 登记任务 + 持久化到 localStorage', () => {
    useActiveGenerationStore.getState().start({ projectId: 'p1', idea: '霓虹雨夜' });
    const cur = useActiveGenerationStore.getState().current;
    expect(cur?.projectId).toBe('p1');
    expect(cur?.phase).toBe('构思中');
    expect(JSON.parse(localStorage.getItem(KEY)!).projectId).toBe('p1');
  });

  it('setPhase 更新阶段 + 同步落库', () => {
    useActiveGenerationStore.getState().start({ projectId: 'p1', idea: 'x' });
    useActiveGenerationStore.getState().setPhase('渲染分镜');
    expect(useActiveGenerationStore.getState().current?.phase).toBe('渲染分镜');
    expect(JSON.parse(localStorage.getItem(KEY)!).phase).toBe('渲染分镜');
  });

  it('finish 清空 store + localStorage', () => {
    useActiveGenerationStore.getState().start({ projectId: 'p1', idea: 'x' });
    useActiveGenerationStore.getState().finish();
    expect(useActiveGenerationStore.getState().current).toBeNull();
    expect(localStorage.getItem(KEY)).toBeNull();
  });

  it('hydrate 从 localStorage 恢复(刷新/重进后仍在)', () => {
    localStorage.setItem(KEY, JSON.stringify({ projectId: 'p9', idea: '复活', phase: '出片', startedAt: Date.now() }));
    useActiveGenerationStore.getState().hydrate();
    expect(useActiveGenerationStore.getState().current?.projectId).toBe('p9');
  });

  it('hydrate 丢弃超 30 分钟的陈旧任务(防永久悬挂)', () => {
    localStorage.setItem(KEY, JSON.stringify({ projectId: 'old', idea: 'x', phase: '出片', startedAt: Date.now() - 31 * 60 * 1000 }));
    useActiveGenerationStore.getState().hydrate();
    expect(useActiveGenerationStore.getState().current).toBeNull();
    expect(localStorage.getItem(KEY)).toBeNull();
  });

  it('setPhase 在无任务时是安全 no-op', () => {
    useActiveGenerationStore.getState().setPhase('x');
    expect(useActiveGenerationStore.getState().current).toBeNull();
  });
});
