/**
 * v6.4 — 导演级全链路 · 流水线环节模型 (纯逻辑, client-safe, 可单测)
 *
 * 对标 火山剧创「导演级控片」: 把创作主流程抽象成 4 个环节 (剧本→资产→分镜→成片),
 * 由项目资产推每个环节状态 (空/就绪/待更新), 并算"重跑某环节会让哪些下游失效".
 * 导演台 UI 据此可视化 + 跳转编辑 + 下游影响提示.
 */

export type StageId = 'script' | 'assets' | 'storyboard' | 'final';

export interface StageDef {
  id: StageId;
  label: string;
  desc: string;
  /** 该环节对应的资产 type */
  assetTypes: string[];
  /** 编辑时跳转到项目页哪个 tab */
  editTab: string;
}

export const PIPELINE_STAGES: StageDef[] = [
  { id: 'script', label: '剧本', desc: '剧情结构 + 分场', assetTypes: ['script'], editTab: 'script' },
  { id: 'assets', label: '角色 / 场景', desc: '角色设定 + 场景设定', assetTypes: ['character', 'scene'], editTab: 'characters' },
  { id: 'storyboard', label: '分镜', desc: '逐镜画面', assetTypes: ['storyboard'], editTab: 'storyboard' },
  { id: 'final', label: '成片', desc: '视频成片', assetTypes: ['video'], editTab: 'videos' },
];

export type StageStatus = 'empty' | 'ready' | 'stale';

export interface PipelineStage extends StageDef {
  count: number;
  status: StageStatus;
  /** 该环节最新资产时间 (用于 stale 判定) */
  newest: string;
}

export interface StageAsset { type: string; updatedAt?: string }

/**
 * 由项目资产推 4 个环节状态.
 *   empty = 无资产; ready = 有且不旧; stale = 有但比某个上游环节旧 (上游改过, 本环节该重跑).
 */
export function derivePipelineStages(assets: StageAsset[]): PipelineStage[] {
  const raw = PIPELINE_STAGES.map((s) => {
    const mine = assets.filter((a) => s.assetTypes.includes(a.type));
    const newest = mine.reduce((m, a) => (a.updatedAt && a.updatedAt > m ? a.updatedAt : m), '');
    return { def: s, count: mine.length, newest };
  });

  return raw.map((s, i) => {
    let status: StageStatus = s.count > 0 ? 'ready' : 'empty';
    if (status === 'ready') {
      for (let j = 0; j < i; j++) {
        if (raw[j].newest && s.newest && raw[j].newest > s.newest) { status = 'stale'; break; }
      }
    }
    return { ...s.def, count: s.count, status, newest: s.newest };
  });
}

/** 重跑某环节会让其下游环节失效 (顺序在它之后的). */
export function downstreamStages(id: StageId): StageId[] {
  const order = PIPELINE_STAGES.map((s) => s.id);
  const i = order.indexOf(id);
  return i < 0 ? [] : order.slice(i + 1);
}

/** 重跑计划: 目标环节 + 会被影响 (需重生) 的下游环节. */
export function rerunPlan(id: StageId): { target: StageId; invalidates: StageId[] } {
  return { target: id, invalidates: downstreamStages(id) };
}

/** 整体进度: 已就绪 (ready+stale 都算"有产物") / 总环节. */
export function pipelineProgress(stages: PipelineStage[]): { produced: number; total: number; pct: number } {
  const produced = stages.filter((s) => s.status !== 'empty').length;
  const total = stages.length;
  return { produced, total, pct: total ? Math.round((produced / total) * 100) : 0 };
}
