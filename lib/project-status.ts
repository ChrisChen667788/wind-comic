/**
 * 项目状态的**唯一词表**(v12.433)。
 *
 * ## 起因
 *
 * `failed` 早就在库里存在了 —— `pipeline-worker` 的 `markProjectFailedIfTerminal`
 * 在 create 任务耗尽重试后就会写它(v12.21.0 起)。但列表页写的是
 * `statusConfig[p.status] || statusConfig.draft`:**词表里没有 failed,于是失败的项目
 * 被贴上「草稿」的标签**;项目详情页更简单粗暴,`status === 'completed' ? '已完成' : '制作中'`,
 * 失败的片子在那儿显示「制作中」,而它永远不会再动。
 *
 * 两个页面各写各的词表,就一定会漏同一个词。所以词表收在这里,页面只挑颜色。
 *
 * ## 为什么兜底不是「草稿」
 *
 * 一个不认识的状态,唯一诚实的说法是「不认识」。拿「草稿」兜底等于替库里的值编了个故事,
 * 而且**它掩盖的恰恰是新增的状态** —— 这次就是这么把 failed 藏了两个大版本。
 */

export type StatusTone = 'good' | 'warn' | 'bad' | 'muted';

export interface ProjectStatusMeta {
  key: string;
  label: string;
  tone: StatusTone;
  /** 这个状态还会继续往前跑吗 —— 决定要不要显示「进行中」的动效 */
  inProgress: boolean;
}

const TABLE: Record<string, ProjectStatusMeta> = {
  completed: { key: 'completed', label: '已完成', tone: 'good', inProgress: false },
  active: { key: 'active', label: '创作中', tone: 'warn', inProgress: true },
  failed: { key: 'failed', label: '生成失败', tone: 'bad', inProgress: false },
  draft: { key: 'draft', label: '草稿', tone: 'muted', inProgress: false },
  archived: { key: 'archived', label: '已下架', tone: 'muted', inProgress: false },
};

/** 词表里有的状态,按顺序列出(筛选栏用) */
export const PROJECT_STATUS_KEYS = Object.keys(TABLE);

export function projectStatusMeta(status?: string | null): ProjectStatusMeta {
  const k = (status || '').trim();
  if (k && Object.prototype.hasOwnProperty.call(TABLE, k)) return TABLE[k];
  // 不认识就说不认识,别拿「草稿」冒充
  // 原值要截短:库里塞进来的可能是任意长度的脏值,整条印到徽章上会撑破卡片(实测溢出)
  const shown = k.length > 14 ? `${k.slice(0, 14)}…` : k;
  return { key: 'unknown', label: k ? `状态未知(${shown})` : '状态未知', tone: 'muted', inProgress: false };
}

export function isProjectFailed(status?: string | null): boolean {
  return (status || '').trim() === 'failed';
}
