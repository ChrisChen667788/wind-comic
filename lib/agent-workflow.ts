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
import { validateWorkflow, type WorkflowGraph } from './agent-workflow-core';

// 纯核心 (类型 / STEP_CATALOG / validateWorkflow / topoSort / defaultWorkflow) 已拆到
// agent-workflow-core.ts (client-safe). 这里 re-export 保持既有 import 路径不变.
export * from './agent-workflow-core';

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

