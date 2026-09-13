# AI Comic Studio - Skills

本目录包含 AI Comic Studio 项目的 Skills 定义和实现。

## 导演技能库(v12.437 起,流水线运行时读取)

`skills/<id>/SKILL.md` 形式的技能会在创作时**自动命中并注入流水线**。格式就是
[Anthropic SKILL.md](https://github.com/anthropics/skills) 规范,也是
[Agent Plugins v1.0.0](https://github.com/agentplugins/agent-plugins-spec) 包裹的格式 ——
写一次,两边都能用。

### 写一个自己的技能

新建 `skills/<名字>/SKILL.md`(名字只许小写字母、数字、连字符,且**必须与文件里的 `name` 一致**):

```markdown
---
name: noir
description: 黑色电影风格。创意里出现雨夜、侦探、背叛时使用 —— 高反差布光,慢节奏。
metadata:
  wind-comic:
    kind: genre-shot-pack        # 或 director-method
    label: 黑色电影               # 界面上显示的名字
    priority: 40                 # 多个技能同时命中时,数字小的优先
    match: 黑色电影|雨夜|侦探|noir  # 创意里出现这些词时启用(正则)
    # 以下三项只有 genre-shot-pack 需要:
    cameraDefault: slow-push
    editStyle: 黑色电影:高反差,慢节奏,大量阴影
    bgmStyleHint: smoky jazz, muted trumpet, rain ambience
---

# 正文:导演方法论

命中后,这段正文会拼进导演的系统提示词。写你自己的方法 ——
**方法可以借鉴,受版权保护的书籍原文不能照抄。**
```

然后跑一下校验:

```bash
npm run skills:check
```

### 两种技能

| kind | 命中规则 | 作用 |
|---|---|---|
| `genre-shot-pack` 题材包 | 多个命中**只取 priority 最小的一个** | 设定默认运镜、剪辑风格、配乐风格词(用户显式选择的不覆盖),并注入正文 |
| `director-method` 导演技法 | **可叠加,最多 3 个** | 只注入正文 —— 一部悬疑片里既有对峙戏又有追逐戏,两套方法都该给导演 |

没有 `metadata.wind-comic` 的技能(比如 `screenwriter/`)是**合法的外部技能**,给外部 Claude 代理用,不进流水线。

### 写错了会怎样

**流水线不会因为一个坏技能报错** —— 写错的技能被跳过,其它技能照常工作。问题只在
`npm run skills:check` 里报出(退出码 1),仓库测试也会拦住任何带问题的技能入库。

---

## 以下为早期的能力说明文档(平铺 .md,非运行时技能)

## 概述

Skills 是可复用的功能模块，为项目提供各种 AI 能力支持。

## 目录结构

```
skills/
├── README.md                    # 本文件
├── base/                        # 基础能力 Skills
│   ├── image-generation.md     # 图片生成
│   ├── video-analysis.md       # 视频分析
│   └── content-generation.md   # 内容生成
├── advanced/                    # 高级应用 Skills
│   └── effect-application.md   # 特效应用
└── examples/                    # 使用示例
    └── skill-usage-examples.md
```

## 可用 Skills

### 基础能力

1. **image-generation** - 图片生成
   - 文生图、图生图
   - 图片编辑和增强
   - 适用于漫画场景生成

2. **video-analysis** - 视频分析
   - 提取关键帧
   - 分析视频内容
   - 适用于视频素材处理

3. **content-generation** - 内容生成
   - 生成漫画脚本
   - 创建对话文本
   - 生成项目文档

### 高级应用

4. **effect-application** - 特效应用
   - 漫画风格滤镜
   - 图片特效处理
   - 适用于漫画后期制作

## 快速开始

查看 `examples/skill-usage-examples.md` 了解详细使用方法。
