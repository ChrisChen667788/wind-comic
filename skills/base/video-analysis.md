# Video Analysis Skill

## 基本信息

- **名称**: `video-analysis`
- **类型**: 基础能力
- **优先级**: 中
- **适用场景**: 视频素材处理

## 描述

分析视频内容，提取关键帧，用于漫画创作的参考素材。

## 功能特性

1. **关键帧提取**: 智能识别视频中的关键时刻
2. **场景分割**: 自动分割视频场景
3. **动作识别**: 识别人物动作和表情
4. **构图分析**: 分析镜头构图和角度

## API 接口

```typescript
interface VideoAnalysisParams {
  videoPath: string;
  analysisType: 'keyframes' | 'scenes' | 'actions';
  frameCount?: number;
}

interface VideoAnalysisResult {
  keyframes: Array<{
    timestamp: number;
    framePath: string;
    description: string;
  }>;
  scenes: Array<{
    startTime: number;
    endTime: number;
    description: string;
  }>;
}
```

## 使用场景

- 从视频中提取漫画参考素材
- 分析动画片段用于漫画创作
- 提取角色表情和动作参考
