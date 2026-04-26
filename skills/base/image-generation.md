# Image Generation Skill

## 基本信息

- **名称**: `image-generation`
- **类型**: 基础能力
- **优先级**: 高
- **适用场景**: AI 漫画工作室

## 描述

为 AI 漫画工作室提供图片生成能力，支持根据文本描述生成漫画场景、角色和背景。

## 功能特性

1. **文生图**: 根据文本描述生成漫画场景
2. **图生图**: 基于参考图片生成变体
3. **风格控制**: 支持多种漫画风格（日漫、美漫、国漫等）
4. **角色一致性**: 保持角色在不同场景中的一致性
5. **批量生成**: 支持批量生成多个场景

## API 接口

### 生成漫画场景

```typescript
interface ComicSceneGenerationParams {
  // 场景描述
  prompt: string;

  // 漫画风格
  style?: 'japanese' | 'american' | 'chinese' | 'webtoon';

  // 参考图片（可选）
  referenceImage?: string;

  // 角色信息（保持一致性）
  characters?: Array<{
    name: string;
    description: string;
    referenceImage?: string;
  }>;

  // 生成参数
  width?: number;
  height?: number;
  quality?: 'draft' | 'standard' | 'high';
}
```

### 返回值

```typescript
interface ImageGenerationResult {
  success: boolean;
  imagePath: string;
  metadata: {
    width: number;
    height: number;
    style: string;
    generationTime: number;
  };
}
```

## 使用示例

### 示例 1: 生成漫画场景
