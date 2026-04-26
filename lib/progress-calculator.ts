/**
 * 总体进度计算工具
 * 用于计算整个创作流程的总体进度
 */

// 各个阶段的权重（总和为100）
export const STAGE_WEIGHTS = {
  DIRECTOR: 5,        // 导演分析：5%
  WRITER: 15,         // 编剧创作：15%
  CHARACTER: 10,      // 角色设计：10%
  SCENE: 10,          // 场景设计：10%
  STORYBOARD: 20,     // 分镜绘制：20%
  VIDEO: 30,          // 视频生成：30%（最耗时）
  EDITOR: 5,          // 剪辑合成：5%
  REVIEW: 5,          // 导演审核：5%
};

// 阶段状态
export type StageStatus = 'pending' | 'running' | 'completed' | 'error';

// 阶段进度
export interface StageProgress {
  stage: keyof typeof STAGE_WEIGHTS;
  status: StageStatus;
  progress: number; // 0-100
}

/**
 * 计算总体进度
 * @param stages 各个阶段的进度
 * @returns 总体进度（0-100）
 */
export function calculateOverallProgress(stages: StageProgress[]): number {
  let totalProgress = 0;

  for (const stage of stages) {
    const weight = STAGE_WEIGHTS[stage.stage];
    const stageContribution = (stage.progress / 100) * weight;
    totalProgress += stageContribution;
  }

  return Math.round(totalProgress);
}

/**
 * 根据状态消息推断当前阶段和进度
 */
export function inferStageFromMessage(message: string): {
  stage: keyof typeof STAGE_WEIGHTS;
  progress: number;
} | null {
  if (message.includes('导演') && message.includes('分析')) {
    return { stage: 'DIRECTOR', progress: 50 };
  }
  if (message.includes('编剧') && message.includes('剧本')) {
    return { stage: 'WRITER', progress: 50 };
  }
  if (message.includes('角色设计师')) {
    return { stage: 'CHARACTER', progress: 50 };
  }
  if (message.includes('场景设计师')) {
    return { stage: 'SCENE', progress: 50 };
  }
  if (message.includes('分镜师')) {
    return { stage: 'STORYBOARD', progress: 50 };
  }
  if (message.includes('视频') && message.includes('生成')) {
    return { stage: 'VIDEO', progress: 50 };
  }
  if (message.includes('剪辑师') || message.includes('剪辑合成')) {
    return { stage: 'EDITOR', progress: 50 };
  }
  if (message.includes('导演') && message.includes('审核')) {
    return { stage: 'REVIEW', progress: 50 };
  }
  return null;
}

/**
 * 创建初始阶段进度
 */
export function createInitialStages(): StageProgress[] {
  return [
    { stage: 'DIRECTOR', status: 'pending', progress: 0 },
    { stage: 'WRITER', status: 'pending', progress: 0 },
    { stage: 'CHARACTER', status: 'pending', progress: 0 },
    { stage: 'SCENE', status: 'pending', progress: 0 },
    { stage: 'STORYBOARD', status: 'pending', progress: 0 },
    { stage: 'VIDEO', status: 'pending', progress: 0 },
    { stage: 'EDITOR', status: 'pending', progress: 0 },
    { stage: 'REVIEW', status: 'pending', progress: 0 },
  ];
}
