# Effect Application Skill

## 基本信息

- **名称**: `effect-application`
- **类型**: 高级应用
- **优先级**: 中
- **适用场景**: 漫画后期制作

## 描述

为漫画图片应用各种特效和滤镜，提升视觉效果。

## 功能特性

1. **漫画风格滤镜**: 应用不同的漫画风格
2. **色调调整**: 调整图片色调和氛围
3. **特效叠加**: 添加光效、粒子等特效
4. **边框和装饰**: 添加漫画边框和装饰元素
5. **批量处理**: 批量应用特效到多张图片

## API 接口

```typescript
interface EffectApplicationParams {
  // 输入图片
  inputPath: string;

  // 特效类型
  effectType: 'style' | 'tone' | 'border' | 'particle';

  // 特效参数
  effectParams: {
    // 风格滤镜
    style?: 'manga' | 'webtoon' | 'vintage' | 'modern';

    // 色调
    tone?: 'warm' | 'cool' | 'dramatic' | 'soft';

    // 强度
    intensity?: number; // 0-100

    // 边框样式
    borderStyle?: 'classic' | 'modern' | 'none';
  };

  // 输出选项
  outputPath?: string;
  quality?: 'draft' | 'standard' | 'high';
}

interface EffectApplicationResult {
  success: boolean;
  outputPath: string;
  metadata: {
    effectApplied: string;
    processingTime: number;
  };
}
```

## 使用示例

### 应用漫画风格
```typescript
const result = await applyEffect({
  inputPath: 'scene-01.png',
  effectType: 'style',
  effectParams: {
    style: 'manga',
    intensity: 80
  }
});
```

### 调整色调
```typescript
const result = await applyEffect({
  inputPath: 'scene-02.png',
  effectType: 'tone',
  effectParams: {
    tone: 'dramatic',
    intensity: 70
  }
});
```

### 添加边框
```typescript
const result = await applyEffect({
  inputPath: 'panel.png',
  effectType: 'border',
  effectParams: {
    borderStyle: 'classic'
  }
});
```

## 预设特效

### 漫画风格
- **manga**: 日式漫画风格
- **webtoon**: 韩国网络漫画风格
- **vintage**: 复古漫画风格
- **modern**: 现代漫画风格

### 色调预设
- **warm**: 温暖色调（适合温馨场景）
- **cool**: 冷色调（适合科幻、悬疑场景）
- **dramatic**: 戏剧性色调（适合冲突场景）
- **soft**: 柔和色调（适合浪漫场景）

## 应用场景

- 统一漫画风格
- 营造场景氛围
- 增强视觉冲击力
- 快速后期处理
