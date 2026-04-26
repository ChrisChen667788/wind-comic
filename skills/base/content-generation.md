# Content Generation Skill

## 基本信息

- **名称**: `content-generation`
- **类型**: 基础能力
- **优先级**: 高
- **适用场景**: 漫画脚本和对话生成

## 描述

为漫画创作提供内容生成能力，包括故事脚本、对话文本、角色设定等。

## 功能特性

1. **故事脚本生成**: 根据主题生成完整的漫画故事
2. **对话生成**: 为角色生成自然的对话
3. **角色设定**: 生成角色背景和性格描述
4. **分镜脚本**: 生成详细的分镜描述

## API 接口

```typescript
interface ComicContentParams {
  contentType: 'story' | 'dialogue' | 'character' | 'storyboard';

  // 故事主题
  theme?: string;

  // 角色信息
  characters?: Array<{
    name: string;
    personality: string;
  }>;

  // 场景信息
  scene?: {
    location: string;
    mood: string;
  };

  // 风格偏好
  style?: {
    tone: 'serious' | 'humorous' | 'dramatic';
    length: 'short' | 'medium' | 'long';
  };
}

interface ContentGenerationResult {
  content: string;
  metadata: {
    wordCount: number;
    characterCount: number;
  };
}
```

## 使用示例

### 生成漫画故事
```typescript
const result = await generateContent({
  contentType: 'story',
  theme: '科幻冒险',
  style: {
    tone: 'dramatic',
    length: 'medium'
  }
});
```

### 生成角色对话
```typescript
const dialogue = await generateContent({
  contentType: 'dialogue',
  characters: [
    { name: '小明', personality: '勇敢、乐观' },
    { name: '小红', personality: '聪明、谨慎' }
  ],
  scene: {
    location: '废弃工厂',
    mood: '紧张'
  }
});
```

## 应用场景

- 快速生成漫画故事大纲
- 为现有场景生成对话
- 创建角色设定文档
- 生成详细的分镜脚本
