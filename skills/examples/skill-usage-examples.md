# Skills 使用示例

本文档提供 AI Comic Studio 中各个 Skill 的实际使用场景和组合使用示例。

## 单一 Skill 使用

### 1. 图片生成 (Image Generation)

#### 场景 1: 生成漫画场景
```typescript
// 生成一个科幻城市场景
const scene = await generateImage({
  prompt: '未来科幻城市，高楼林立，飞行汽车穿梭，霓虹灯闪烁',
  style: 'japanese',
  width: 1920,
  height: 1080,
  quality: 'high'
});
```

#### 场景 2: 生成角色
```typescript
// 生成主角角色
const character = await generateImage({
  prompt: '年轻的女性侦探，短发，穿着风衣，眼神坚定',
  style: 'manga',
  characters: [{
    name: '林雪',
    description: '25岁女侦探，聪明冷静'
  }]
});
```

#### 场景 3: 基于参考图生成变体
```typescript
// 基于草图生成完整场景
const refined = await generateImage({
  mode: 'image-to-image',
  referenceImage: 'sketch-01.jpg',
  prompt: '将草图转换为完整的漫画场景，日式漫画风格',
  style: 'japanese'
});
```

### 2. 内容生成 (Content Generation)

#### 场景 1: 生成故事大纲
```typescript
const story = await generateContent({
  contentType: 'story',
  theme: '科幻悬疑',
  style: {
    tone: 'dramatic',
    length: 'medium'
  }
});
```

#### 场景 2: 生成角色对话
```typescript
const dialogue = await generateContent({
  contentType: 'dialogue',
  characters: [
    { name: '林雪', personality: '冷静、理性' },
    { name: '张伟', personality: '热情、冲动' }
  ],
  scene: {
    location: '废弃工厂',
    mood: '紧张'
  }
});
```

#### 场景 3: 生成分镜脚本
```typescript
const storyboard = await generateContent({
  contentType: 'storyboard',
  theme: '追逐场景',
  style: {
    tone: 'dramatic',
    length: 'short'
  }
});
```

### 3. 特效应用 (Effect Application)

#### 场景 1: 应用漫画风格
```typescript
const styled = await applyEffect({
  inputPath: 'scene-raw.png',
  effectType: 'style',
  effectParams: {
    style: 'manga',
    intensity: 85
  }
});
```

#### 场景 2: 调整场景氛围
```typescript
const atmospheric = await applyEffect({
  inputPath: 'night-scene.png',
  effectType: 'tone',
  effectParams: {
    tone: 'dramatic',
    intensity: 75
  }
});
```

## 组合使用场景

### 工作流 1: 完整漫画创作流程

```typescript
// 步骤 1: 生成故事脚本
const story = await generateContent({
  contentType: 'story',
  theme: '科幻冒险',
  style: { tone: 'dramatic', length: 'medium' }
});

// 步骤 2: 生成分镜脚本
const storyboard = await generateContent({
  contentType: 'storyboard',
  theme: story.content
});

// 步骤 3: 为每个分镜生成图片
const scenes = [];
for (const panel of storyboard.panels) {
  const scene = await generateImage({
    prompt: panel.description,
    style: 'japanese',
    quality: 'high'
  });
  scenes.push(scene);
}

// 步骤 4: 应用统一风格
const styledScenes = [];
for (const scene of scenes) {
  const styled = await applyEffect({
    inputPath: scene.imagePath,
    effectType: 'style',
    effectParams: { style: 'manga', intensity: 80 }
  });
  styledScenes.push(styled);
}

// 步骤 5: 生成对话
const dialogues = await generateContent({
  contentType: 'dialogue',
  characters: story.characters,
  scene: storyboard.panels[0]
});
```

### 工作流 2: 角色一致性创作

```typescript
// 步骤 1: 创建角色设定
const character = {
  name: '小明',
  description: '12岁男孩，黑色短发，穿蓝色T恤',
  personality: '勇敢、好奇'
};

// 步骤 2: 生成角色参考图
const characterRef = await generateImage({
  prompt: character.description,
  style: 'japanese',
  quality: 'high'
});

// 步骤 3: 在不同场景中保持角色一致
const scene1 = await generateImage({
  prompt: '小明在教室里',
  style: 'japanese',
  characters: [{
    name: character.name,
    description: character.description,
    referenceImage: characterRef.imagePath
  }]
});

const scene2 = await generateImage({
  prompt: '小明在操场上奔跑',
  style: 'japanese',
  characters: [{
    name: character.name,
    description: character.description,
    referenceImage: characterRef.imagePath
  }]
});
```

### 工作流 3: 视频素材转漫画

```typescript
// 步骤 1: 分析视频提取关键帧
const analysis = await analyzeVideo({
  videoPath: 'reference-video.mp4',
  analysisType: 'keyframes',
  frameCount: 10
});

// 步骤 2: 将关键帧转换为漫画风格
const comicFrames = [];
for (const keyframe of analysis.keyframes) {
  const comic = await generateImage({
    mode: 'image-to-image',
    referenceImage: keyframe.framePath,
    prompt: '转换为日式漫画风格',
    style: 'japanese'
  });
  comicFrames.push(comic);
}

// 步骤 3: 应用统一特效
const finalFrames = [];
for (const frame of comicFrames) {
  const final = await applyEffect({
    inputPath: frame.imagePath,
    effectType: 'tone',
    effectParams: { tone: 'dramatic', intensity: 70 }
  });
  finalFrames.push(final);
}
```

## 最佳实践

### 1. 保持角色一致性
- 为主要角色创建详细的参考图
- 在所有场景中使用相同的角色描述
- 保存角色参考图路径供后续使用

### 2. 风格统一
- 在项目开始时确定漫画风格
- 对所有场景应用相同的风格参数
- 使用批量处理保持一致性

### 3. 内容规划
- 先生成完整的故事大纲
- 再细化到分镜脚本
- 最后生成具体场景

### 4. 迭代优化
- 使用 draft 质量快速预览
- 确认效果后使用 high 质量生成
- 保存中间结果便于调整

## 性能优化

### 批量处理
```typescript
// 并行生成多个场景
const scenes = await Promise.all([
  generateImage({ prompt: 'scene 1', style: 'japanese' }),
  generateImage({ prompt: 'scene 2', style: 'japanese' }),
  generateImage({ prompt: 'scene 3', style: 'japanese' })
]);
```

### 缓存复用
```typescript
// 缓存角色参考图
const characterCache = new Map();

function getCharacterRef(character) {
  if (!characterCache.has(character.name)) {
    const ref = await generateImage({
      prompt: character.description,
      style: 'japanese'
    });
    characterCache.set(character.name, ref);
  }
  return characterCache.get(character.name);
}
```

## 故障排除

### 常见问题

1. **生成结果不符合预期**
   - 优化提示词描述
   - 提供参考图片
   - 调整风格参数

2. **角色不一致**
   - 使用角色参考图
   - 保持描述一致
   - 增加角色特征描述

3. **处理速度慢**
   - 使用 draft 质量预览
   - 批量并行处理
   - 缓存常用资源

4. **风格不统一**
   - 使用相同的风格参数
   - 批量应用特效
   - 创建风格预设
