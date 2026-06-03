/**
 * v4.1 — Agent 编排工作流单测 (校验 + 拓扑排序 + 持久化).
 */

import { describe, it, expect } from 'vitest';
import { nanoid } from 'nanoid';
import {
  validateWorkflow,
  topoSort,
  defaultWorkflow,
  STEP_CATALOG,
  saveWorkflow,
  getWorkflow,
  listWorkflows,
  deleteWorkflow,
  type WorkflowGraph,
} from '@/lib/agent-workflow';

const wf = (nodes: WorkflowGraph['nodes'], name = 'WF'): WorkflowGraph => ({
  id: 'wf_' + nanoid(8), name, nodes,
});

// ─── validateWorkflow ───────────────────────────────────────────────────────

describe('v4.1 · validateWorkflow', () => {
  it('accepts the default workflow', () => {
    expect(validateWorkflow(defaultWorkflow()).valid).toBe(true);
  });

  it('rejects empty name', () => {
    const g = wf([{ id: 'a', kind: 'director', label: 'd', dependsOn: [] }], '');
    expect(validateWorkflow(g).valid).toBe(false);
  });

  it('rejects empty nodes', () => {
    expect(validateWorkflow(wf([])).errors.some((e) => e.includes('至少'))).toBe(true);
  });

  it('rejects duplicate ids', () => {
    const g = wf([
      { id: 'x', kind: 'director', label: 'd', dependsOn: [] },
      { id: 'x', kind: 'writer', label: 'w', dependsOn: [] },
    ]);
    expect(validateWorkflow(g).errors.some((e) => e.includes('重复'))).toBe(true);
  });

  it('rejects unknown kind', () => {
    const g = wf([{ id: 'a', kind: 'wizardry' as any, label: 'x', dependsOn: [] }]);
    expect(validateWorkflow(g).errors.some((e) => e.includes('kind'))).toBe(true);
  });

  it('rejects self-dependency', () => {
    const g = wf([{ id: 'a', kind: 'director', label: 'd', dependsOn: ['a'] }]);
    expect(validateWorkflow(g).errors.some((e) => e.includes('依赖自己'))).toBe(true);
  });

  it('rejects dangling dependency', () => {
    const g = wf([{ id: 'a', kind: 'writer', label: 'w', dependsOn: ['ghost'] }]);
    expect(validateWorkflow(g).errors.some((e) => e.includes('不存在'))).toBe(true);
  });

  it('detects cycles', () => {
    const g = wf([
      { id: 'a', kind: 'director', label: 'd', dependsOn: ['b'] },
      { id: 'b', kind: 'writer', label: 'w', dependsOn: ['a'] },
    ]);
    expect(validateWorkflow(g).errors.some((e) => e.includes('循环'))).toBe(true);
  });
});

// ─── topoSort ───────────────────────────────────────────────────────────────

describe('v4.1 · topoSort', () => {
  it('produces parallel levels', () => {
    // director → (writer, style) both depend on director → can run in parallel
    const g = wf([
      { id: 'd', kind: 'director', label: 'd', dependsOn: [] },
      { id: 'w', kind: 'writer', label: 'w', dependsOn: ['d'] },
      { id: 's', kind: 'style_bible', label: 's', dependsOn: ['d'] },
    ]);
    const r = topoSort(g);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.levels[0]).toEqual(['d']);
      expect(r.levels[1]).toEqual(['s', 'w']); // sorted
    }
  });

  it('default workflow topo-sorts cleanly', () => {
    const r = topoSort(defaultWorkflow());
    expect(r.ok).toBe(true);
    if (r.ok) {
      // first level is director only
      expect(r.levels[0]).toEqual(['director']);
      // last level is producer
      expect(r.levels[r.levels.length - 1]).toEqual(['producer']);
    }
  });

  it('returns error on cycle', () => {
    const g = wf([
      { id: 'a', kind: 'director', label: 'a', dependsOn: ['b'] },
      { id: 'b', kind: 'writer', label: 'b', dependsOn: ['a'] },
    ]);
    const r = topoSort(g);
    expect(r.ok).toBe(false);
  });

  it('all independent nodes → single level', () => {
    const g = wf([
      { id: 'a', kind: 'custom', label: 'a', dependsOn: [] },
      { id: 'b', kind: 'custom', label: 'b', dependsOn: [] },
    ]);
    const r = topoSort(g);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.levels).toEqual([['a', 'b']]);
  });
});

// ─── catalog ────────────────────────────────────────────────────────────────

describe('v4.1 · STEP_CATALOG', () => {
  it('covers every StepKind used in default workflow', () => {
    for (const n of defaultWorkflow().nodes) {
      expect(STEP_CATALOG[n.kind]).toBeDefined();
    }
  });
  it('each entry has label + description', () => {
    for (const k of Object.keys(STEP_CATALOG)) {
      const e = STEP_CATALOG[k as keyof typeof STEP_CATALOG];
      expect(e.label.length).toBeGreaterThan(0);
      expect(e.description.length).toBeGreaterThan(0);
    }
  });
});

// ─── persistence ────────────────────────────────────────────────────────────

describe('v4.1 · saveWorkflow / get / list / delete', () => {
  it('saves a valid workflow', async () => {
    const user = 'u-' + nanoid();
    const g = defaultWorkflow('我的流水线');
    g.id = 'wf_' + nanoid(8);
    const saved = await saveWorkflow(user, g);
    expect(saved.name).toBe('我的流水线');
    expect((await getWorkflow(g.id))?.userId).toBe(user);
  });

  it('refuses to save an invalid workflow', async () => {
    const g = wf([{ id: 'a', kind: 'director', label: 'd', dependsOn: ['a'] }]);
    await expect(saveWorkflow('u', g)).rejects.toThrow(/校验失败/);
  });

  it('update by same owner works; other owner rejected', async () => {
    const owner = 'owner-' + nanoid();
    const g = defaultWorkflow();
    g.id = 'wf_' + nanoid(8);
    await saveWorkflow(owner, g);
    g.name = '改名了';
    expect((await saveWorkflow(owner, g)).name).toBe('改名了');
    await expect(saveWorkflow('intruder', g)).rejects.toThrow(/创建者/);
  });

  it('lists owner workflows', async () => {
    const owner = 'owner-list-' + nanoid();
    const a = defaultWorkflow('A'); a.id = 'wf_' + nanoid(8);
    const b = defaultWorkflow('B'); b.id = 'wf_' + nanoid(8);
    await saveWorkflow(owner, a);
    await saveWorkflow(owner, b);
    expect(await listWorkflows(owner)).toHaveLength(2);
  });

  it('delete by owner; non-owner rejected', async () => {
    const owner = 'owner-del-' + nanoid();
    const g = defaultWorkflow(); g.id = 'wf_' + nanoid(8);
    await saveWorkflow(owner, g);
    await expect(deleteWorkflow(g.id, 'nope')).rejects.toThrow(/创建者/);
    expect(await deleteWorkflow(g.id, owner)).toBe(true);
    expect(await getWorkflow(g.id)).toBeNull();
  });
});
