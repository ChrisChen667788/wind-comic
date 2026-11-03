/**
 * v12.262 — 神类瘦身下半:runEditor 从 hybrid-orchestrator 抽到 services/agents/editor-agent.ts。
 * 行为逐字节保持;此处锁「已抽出 + orchestrator 委派 + 无残留裸 this」。至此 orchestrator 5517→4167 行。
 */
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import { runEditor } from '@/services/agents/editor-agent';

describe('v12.262 · runEditor 抽离', () => {
  it('editor-agent 导出 runEditor(ctx, videos, script)', () => {
    expect(typeof runEditor).toBe('function');
    expect(runEditor.length).toBe(4); // (ctx, videos, script, opts) —— v13.13 加了可选 opts.projectId(只用来取成片帧率)
  });
  it('orchestrator 只保留委派,不再内联实现', () => {
    const o = fs.readFileSync('services/hybrid-orchestrator.ts', 'utf-8');
    expect(o).toContain("import { runEditor as runEditorAgent, type EditorAgentCtx } from './agents/editor-agent'");
    expect(o).toContain('return runEditorAgent(this as unknown as EditorAgentCtx, videos, script, opts)'); // v13.13 透传 opts
  });
  it('抽出的模块无残留裸 this(sed 转换完整)', () => {
    const e = fs.readFileSync('services/agents/editor-agent.ts', 'utf-8');
    const codeThis = e.split('\n').filter(l => !l.trim().startsWith('*') && !l.trim().startsWith('//') && /\bthis\./.test(l));
    expect(codeThis).toEqual([]);
  });
  it('orchestrator 明显瘦身(< 4500 行,原 5517)', () => {
    const lines = fs.readFileSync('services/hybrid-orchestrator.ts', 'utf-8').split('\n').length;
    expect(lines).toBeLessThan(4500);
  });
});
