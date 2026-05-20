/**
 * v4.1 — Agent 编排工作流 (定义 + 校验 + 拓扑排序).
 *
 * 把现在写死的 Director→Writer→...→Producer 流水线变成可配置的 DAG, 为拖拽式
 * agent 编排 IDE 打地基. 用户能自定义: 跳过某 agent / 并行 Cameo+Editor / 插自定义步.
 *
 * 这一版交付"图定义 + 校验 + 拓扑排序 + 持久化" (可测核心). 执行引擎接 orchestrator
 * 留 v4.1.1.
 *
 * 单测: tests/v4-1-agent-workflow.test.ts.
 */

import { nanoid } from 'nanoid';
import { db, now } from './db';

export type StepKind =
  | 'director' | 'writer' | 'style_bible' | 'character_designer'
  | 'scene_designer' | 'storyboard' | 'video_producer' | 'editor' | 'producer'
  | 'custom';

export interface WorkflowNode {
  id: string;
  kind: StepKind;
  label: string;
  /** 依赖的上游节点 id (这些跑完才能跑本节点). */
  dependsOn: string[];
  /** 步骤参数 (model / temperature / 自定义 prompt 等). */
  config?: Record<string, unknown>;
}

export interface WorkflowGraph {
  id: string;
  name: string;
  nodes: WorkflowNode[];
}

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

/** 步骤目录: 每种 agent 步的产出/消费契约, 给 UI 调色板 + 校验提示. */
export const STEP_CATALOG: Record<StepKind, {
  label: string;
  produces: string[];
  consumes: string[];
  description: string;
}> = {
  director:           { label: 'AI 导演',     produces: ['plan'],        consumes: ['idea'],            description: '分析创意, 制定拍摄计划' },
  writer:             { label: 'AI 编剧',     produces: ['script'],      consumes: ['plan'],            description: '把计划写成分镜剧本' },
  style_bible:        { label: '风格圣经',    produces: ['styleBible'],  consumes: ['plan'],            description: '锁定全片美术风格' },
  character_designer: { label: '角色设计',    produces: ['characters'],  consumes: ['script'],          description: '设计角色形象' },
  scene_designer:     { label: '场景设计',    produces: ['scenes'],      consumes: ['script'],          description: '设计场景图' },
  storyboard:         { label: '分镜师',      produces: ['storyboards'], consumes: ['script', 'characters', 'scenes'], description: '逐镜画分镜图' },
  video_producer:     { label: '视频制作',    produces: ['videos'],      consumes: ['storyboards'],     description: '分镜图转视频' },
  editor:             { label: '剪辑师',      produces: ['cut'],         consumes: ['videos'],          description: '配音/配乐/字幕/合成' },
  producer:           { label: '制片人',      produces: ['final'],       consumes: ['cut'],             description: '终审 + 成片确认' },
  custom:             { label: '自定义步',    produces: [],              consumes: [],                  description: '用户自定义脚本步骤' },
};

// ─── 校验 (纯函数) ──────────────────────────────────────────────────────────

export function validateWorkflow(g: WorkflowGraph): ValidationResult {
  const errors: string[] = [];
  if (!g || typeof g !== 'object') return { valid: false, errors: ['workflow 不是对象'] };
  if (!g.name || !g.name.trim()) errors.push('工作流名称不能为空');
  if (!Array.isArray(g.nodes)) return { valid: false, errors: ['nodes 必须是数组'] };
  if (g.nodes.length === 0) errors.push('工作流至少要有一个步骤');

  const ids = new Set<string>();
  for (const n of g.nodes) {
    if (!n.id || !n.id.trim()) { errors.push('存在没有 id 的节点'); continue; }
    if (ids.has(n.id)) errors.push(`节点 id 重复: ${n.id}`);
    ids.add(n.id);
    if (!STEP_CATALOG[n.kind]) errors.push(`节点 ${n.id} 的 kind 未知: ${n.kind}`);
    if (!Array.isArray(n.dependsOn)) { errors.push(`节点 ${n.id} 的 dependsOn 必须是数组`); continue; }
    if (n.dependsOn.includes(n.id)) errors.push(`节点 ${n.id} 不能依赖自己`);
  }
  // 依赖必须指向存在的节点
  for (const n of g.nodes) {
    if (!Array.isArray(n.dependsOn)) continue;
    for (const dep of n.dependsOn) {
      if (!ids.has(dep)) errors.push(`节点 ${n.id} 依赖了不存在的节点: ${dep}`);
    }
  }
  // 环检测 (借 topoSort)
  if (errors.length === 0) {
    const topo = topoSort(g);
    if (!topo.ok) errors.push(topo.error);
  }
  return { valid: errors.length === 0, errors };
}

/**
 * 拓扑排序 (Kahn). 返回分层 levels — 每层内的节点可并行跑.
 * 有环时返回 { ok:false }.
 */
export function topoSort(g: WorkflowGraph):
  | { ok: true; levels: string[][] }
  | { ok: false; error: string } {
  const nodes = g.nodes;
  const indeg = new Map<string, number>();
  const adj = new Map<string, string[]>();
  for (const n of nodes) { indeg.set(n.id, 0); adj.set(n.id, []); }
  for (const n of nodes) {
    for (const dep of (n.dependsOn || [])) {
      if (!adj.has(dep)) continue; // 悬空依赖已在 validate 报过
      adj.get(dep)!.push(n.id);
      indeg.set(n.id, (indeg.get(n.id) || 0) + 1);
    }
  }
  const levels: string[][] = [];
  let frontier = nodes.filter((n) => (indeg.get(n.id) || 0) === 0).map((n) => n.id);
  let seen = 0;
  while (frontier.length > 0) {
    levels.push([...frontier].sort());
    const next: string[] = [];
    for (const id of frontier) {
      seen++;
      for (const m of (adj.get(id) || [])) {
        indeg.set(m, (indeg.get(m) || 0) - 1);
        if (indeg.get(m) === 0) next.push(m);
      }
    }
    frontier = next;
  }
  if (seen !== nodes.length) {
    return { ok: false, error: '工作流存在循环依赖 (cycle)' };
  }
  return { ok: true, levels };
}

/** 默认流水线 (= 现在写死的顺序), 给"新建工作流"做模板. */
export function defaultWorkflow(name = '标准流水线'): WorkflowGraph {
  const n = (id: string, kind: StepKind, dependsOn: string[]): WorkflowNode => ({
    id, kind, label: STEP_CATALOG[kind].label, dependsOn,
  });
  return {
    id: 'wf_' + nanoid(10),
    name,
    nodes: [
      n('director', 'director', []),
      n('writer', 'writer', ['director']),
      n('style', 'style_bible', ['director']),
      n('chars', 'character_designer', ['writer']),
      n('scenes', 'scene_designer', ['writer']),
      n('board', 'storyboard', ['chars', 'scenes', 'style']),
      n('video', 'video_producer', ['board']),
      n('edit', 'editor', ['video']),
      n('producer', 'producer', ['edit']),
    ],
  };
}

// ─── 持久化 ───────────────────────────────────────────────────────────────

export interface StoredWorkflow {
  id: string;
  userId: string;
  name: string;
  graph: WorkflowGraph;
  createdAt: string;
  updatedAt: string;
}

function mapRow(r: any): StoredWorkflow {
  return {
    id: r.id, userId: r.user_id, name: r.name,
    graph: JSON.parse(r.graph_json),
    createdAt: r.created_at, updatedAt: r.updated_at,
  };
}

/** 保存 (新建或更新). 校验不过抛错. owner 不匹配抛错. */
export function saveWorkflow(userId: string, graph: WorkflowGraph): StoredWorkflow {
  const v = validateWorkflow(graph);
  if (!v.valid) throw new Error('工作流校验失败: ' + v.errors.join('; '));
  const existing = db.prepare(`SELECT * FROM agent_workflows WHERE id = ?`).get(graph.id) as any;
  const ts = now();
  if (existing) {
    if (existing.user_id !== userId) throw new Error('只有创建者能修改工作流');
    db.prepare(`UPDATE agent_workflows SET name=?, graph_json=?, updated_at=? WHERE id=?`)
      .run(graph.name, JSON.stringify(graph), ts, graph.id);
  } else {
    db.prepare(`INSERT INTO agent_workflows (id, user_id, name, graph_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)`)
      .run(graph.id, userId, graph.name, JSON.stringify(graph), ts, ts);
  }
  return getWorkflow(graph.id)!;
}

export function getWorkflow(id: string): StoredWorkflow | null {
  const r = db.prepare(`SELECT * FROM agent_workflows WHERE id = ?`).get(id) as any;
  return r ? mapRow(r) : null;
}

export function listWorkflows(userId: string): StoredWorkflow[] {
  const rows = db.prepare(`SELECT * FROM agent_workflows WHERE user_id = ? ORDER BY updated_at DESC`).all(userId) as any[];
  return rows.map(mapRow);
}

export function deleteWorkflow(id: string, userId: string): boolean {
  const wf = getWorkflow(id);
  if (!wf) return false;
  if (wf.userId !== userId) throw new Error('只有创建者能删除工作流');
  db.prepare(`DELETE FROM agent_workflows WHERE id = ?`).run(id);
  return true;
}
