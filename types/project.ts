
// 角色定义
export interface Character {
  name: string;
  description: string;
  visualDescription?: string;
  imageUrl?: string;
}

// 场景定义
export interface Scene {
  name: string;
  description: string;
  imageUrl?: string;
}

// 剧本镜头
export interface Shot {
  shotNumber: number;
  sceneDescription: string;
  characters: string[];
  dialogue: string;
  action: string;
  emotion: string;
}

// 编剧输出
export interface Script {
  title: string;
  synopsis: string;
  shots: Shot[];
}

// 分镜图
export interface Storyboard {
  shotNumber: number;
  imageUrl: string;
  prompt: string;
  planData?: {
    cameraAngle?: string;
    composition?: string;
    lighting?: string;
    colorTone?: string;
    characterAction?: string;
    transitionNote?: string;
  };
}

// 视频片段
export interface VideoClip {
  shotNumber: number;
  videoUrl: string;
}

// 项目状态
export type ProjectStatus = 'creating' | 'completed' | 'error' | 'in-progress' | 'failed';

// 项目数据
export interface Project {
  id: string;
  userId: string;
  title: string;
  idea: string;
  videoProvider: 'minimax' | 'vidu' | 'keling';
  status: ProjectStatus;
  createdAt: Date | string;
  updatedAt: Date | string;
}
