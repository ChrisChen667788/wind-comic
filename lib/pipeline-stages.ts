/**
 * v6.4 — 导演级全链路 · 流水线环节模型 (纯逻辑, client-safe, 可单测)
 *
 * 对标 火山剧创「导演级控片」: 把创作主流程抽象成 4 个环节 (剧本→资产→分镜→成片),
 * 由项目资产推每个环节状态 (空/就绪/待更新), 并算"重跑某环节会让哪些下游失效".
 * 导演台 UI 据此可视化 + 跳转编辑 + 下游影响提示.
 */

import { countPlaceholders } from './placeholder-provenance';

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
  /** v12.427: 其中有几条是示意图(引擎没出图时的占位)。不影响 status,只用于如实告知。 */
  placeholders: number;
}

export interface StageAsset {
  type: string;
  updatedAt?: string;
  /** v6.4.1: 资产 id (重跑端点用来标记/失效具体资产) */
  id?: string;
  /** v6.4.1: 显式失效标记 (上游重跑后端点置位 → 本环节直接 stale, 不依赖时间比较) */
  stale?: boolean;
  /** v12.427: 判「这条是不是示意图」用得到的字段 —— 由 isPlaceholderAsset 消费。
   *  isPlaceholder 是服务端在原始行上判好的结论,优先级最高。 */
  isPlaceholder?: boolean;
  data?: { provenance?: string } | null;
  mediaUrls?: string[] | null;
  media_urls?: string | null;
  persistentUrl?: string | null;
  persistent_url?: string | null;
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
    // v12.427:示意图**不翻成「未就绪」**。这个环节确实跑过了,产物也确实存在,
    // 只是内容不是真出图 —— 翻成未就绪会连累导出(用户想导一版草稿也导不了)。
    // 所以它是**另一个维度**:状态照旧,另报数,让界面能如实说「就绪,含 N 张示意图」。
    const placeholders = countPlaceholders(mine);
    return { def: s, count: mine.length, newest, flagged, placeholders };
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
    return { ...s.def, count: s.count, status, newest: s.newest, placeholders: s.placeholders };
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

/**
 * 导演台顶部那句提示。
 *
 * 抽成纯函数不是为了复用,是为了**可测**:原来这段三元表达式内联在组件里,
 * 测试只能断言源码里出现过 `PLACEHOLDER_LABEL` 字样 —— 把判断条件改成 `false`
 * (有示意图也照说「可导出成片」)那条断言依然绿。锁写法不锁行为,等于没锁。
 */
export function pipelineHint(stages: PipelineStage[], placeholderLabel: string): string {
  const next = stages.find((s) => s.status === 'empty') || stages.find((s) => s.status === 'stale');
  if (next) {
    return next.status === 'empty' ? `下一步 · 生成「${next.label}」` : `建议 · 重生「${next.label}」`;
  }
  const n = stages.reduce((acc, s) => acc + (s.placeholders || 0), 0);
  // 环节确实都跑过了,但其中若干张是引擎没出图时的示意图。
  // 不把状态翻成「未就绪」(那会连累导出),而是如实把数字说出来 ——
  // 此前这里一律显示「可导出成片」,一个全是示意图的项目也照说不误。
  return n > 0
    ? `全链路就绪 · 含 ${n} 张${placeholderLabel},重生即可替换`
    : '全链路就绪 · 可导出成片';
}
