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

export interface StageAsset {
  type: string;
  updatedAt?: string;
  /** v6.4.1: 资产 id (重跑端点用来标记/失效具体资产) */
  id?: string;
  /** v6.4.1: 显式失效标记 (上游重跑后端点置位 → 本环节直接 stale, 不依赖时间比较) */
  stale?: boolean;
}

/**
 * 由项目资产推 4 个环节状态.
 *   empty = 无资产; ready = 有且不旧;
 *   stale = 有但 (a) 被显式标记失效 (v6.4.1 重跑), 或 (b) 比某个上游环节旧 (上游改过, 本环节该重跑).
 */
export function derivePipelineStages(assets: StageAsset[]): PipelineStage[] {
  const raw = PIPELINE_STAGES.map((s) => {
    const mine = assets.filter((a) => s.assetTypes.includes(a.type));
    const newest = mine.reduce((m, a) => (a.updatedAt && a.updatedAt > m ? a.updatedAt : m), '');
    const flagged = mine.some((a) => a.stale);
    return { def: s, count: mine.length, newest, flagged };
  });

  return raw.map((s, i) => {
    let status: StageStatus = s.count > 0 ? 'ready' : 'empty';
    if (status === 'ready') {
      if (s.flagged) {
        status = 'stale';
      } else {
        for (let j = 0; j < i; j++) {
          if (raw[j].newest && s.newest && raw[j].newest > s.newest) { status = 'stale'; break; }
        }
      }
    }
    return { ...s.def, count: s.count, status, newest: s.newest };
  });
}

/** 资产 type → 所属环节 id (没归属返回 null). */
export function stageOfType(type: string): StageId | null {
  const s = PIPELINE_STAGES.find((st) => st.assetTypes.includes(type));
  return s ? s.id : null;
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

export interface RerunPlan {
  target: StageId;
  /** 重跑 target 后需失效/重生的下游环节 */
  invalidates: StageId[];
  /** 下游环节里需要被标记失效的具体资产 id (有 id 的才算) */
  affectedAssetIds: string[];
  /** 执行序: 先 target 再逐个下游 */
  sequence: StageId[];
}

/**
 * v6.4.1: 由当前项目资产 + 目标环节算一份"重跑计划".
 * 重跑某环节 → 它本身重生 + 所有下游环节失效 (其资产需重新生成).
 */
export function buildRerunPlan(assets: StageAsset[], target: StageId): RerunPlan {
  const invalidates = downstreamStages(target);
  const invSet = new Set<StageId>(invalidates);
  const affectedAssetIds = assets
    .filter((a) => {
      if (!a.id) return false;
      const st = stageOfType(a.type);
      return st != null && invSet.has(st);
    })
    .map((a) => a.id!);
  return { target, invalidates, affectedAssetIds, sequence: [target, ...invalidates] };
}

/** 整体进度: 已就绪 (ready+stale 都算"有产物") / 总环节. */
export function pipelineProgress(stages: PipelineStage[]): { produced: number; total: number; pct: number } {
  const produced = stages.filter((s) => s.status !== 'empty').length;
  const total = stages.length;
  return { produced, total, pct: total ? Math.round((produced / total) * 100) : 0 };
}
