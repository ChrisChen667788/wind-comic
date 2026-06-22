# 阶段二十五 · 分镜「逐秒多参」升级方案

> 用户诉求:把分镜提示词细化到「第几秒到第几秒、是什么角色、在什么场景、做什么动作、
> 怎么运镜、台词/BGM、氛围如何」,并参考 GitHub/SkillHub 最流行的多参分镜 prompt 方案。
> 本文是落地设计 + 分阶段路线。**Phase 1 已随 v12.11.0 交付**(见末尾状态)。

## 0. 调研结论(2026-06-20,联网核实)

业界已收敛为两条主线,与用户给的「黄金模板」高度对标:

| 路线 | 代表 | 核心结构 | 强项 | 短板 |
|---|---|---|---|---|
| 国内短剧工业流水线 | **OnlyShot**(`A-cat-with-carrots/OnlyShot-ai-short-drama-skill`)、即梦 | 挂载元素三圣经 + 8段SOP + 36-grid JSON + 红果7招节奏地图 | 字段最深、节奏钉子全 | 缺微表情时间轴 |
| 西方电影语言流水线 | **Seedance 2.0** / **KlingAI MultiShotMaster**(CVPR'26)/ `video-notation-schema` | `@ImageN/@VideoN` 索引引用 + 逐秒时间码 + 双级 caption | 多参绑定标准化、引擎直连 | 缺 CONTINUITY 主表/双版本锚 |

**多参挂载(@元素)三引擎绑定**(可直连):
- **Seedance 2.0**:位置数组 `image_urls[]/video_urls[]/audio_urls[]`,prompt 里 `@Image1/[Image1]` 按序引用(≤9图+3视频+3音频);角色图放最前槽(优先级最高),场景图靠后,道具最末。
- **Kling 3.0 OmniVideo**:`elements[]`(每个 `frontal_image_url` + `reference_image_urls[]` 多角度)→ `@Element1..`;`image_urls[0]` → `@Image1`(场景/风格)。
- **Veo 3.1 Ingredients**:统一 `reference_images[]`(`reference_type:'asset'`,最多 3 张,**无 @标记**,角色语义靠自然语言 prompt 描述),`duration` 用 ref 时须 '8'。

来源:OnlyShot / KlingAIResearch/MultiShotMaster / Kevin-thu/StoryMem / context-notation/video-notation-schema / BytePlus ModelArk 官方 / fal.ai Kling v3 Omni / Google Gemini Veo 3.1 官方 / Seedance 2.0 prompting guide。

## 1. 现状盘点(已有,不重造)

- `MicroBeat`(types/agents.ts):逐秒 beat `ts/startSec/endSec/action/camera/dialogue?/audio?`,各段时长之和=镜时长。**(v12.6.0)**
- `buildBeatSheetBlock`(lib/writer-enhance.ts):四段式拆解 + 运镜与动作分离 + 首镜钩子 + I2V 只写 delta。
- `synthesizeBeatsToEnginePrompt`:beats→引擎 prompt,**已按引擎分流**(kling 留时间码 / seedance `0-3s:` / veo+hailuo 转散文时序)。
- `buildMultiReferenceBundle`:多参打包(firstFrame / subjectImages→S2V subject_reference / referenceImages→Veo ingredients / styleImage→sref / cameo 锁脸)。
- `WriterShotCinema`:景别/焦段/角度/运镜/光影/构图/剪辑 9 维。

## 2. 黄金模板比现状多出、值得吸收的

| 模板块 | 现状 | 缺口 | 落地阶段 |
|---|---|---|---|
| 逐秒 beat 含**角色/场景** | beat 仅 action/camera | beat 没显式挂角色/场景 | **P1** |
| **微表情时间轴** | 无 | 某秒某角色表情 | **P1** |
| **慢镜/插针/甩拍** | 无 | speedRamp 标记 | **P1** |
| **逐 beat 氛围** | shot 级 emotion | beat 级 mood | **P1** |
| **Must-Show 目标物** | 仅 negativePrompt | 正向必现清单 | **P1** |
| **承接**(cut/continuous) | 无 | StoryMem cut 字段 | **P1**(字段) |
| **@元素挂载**(命名复用→映射参考图→喂引擎) | 有 bundle,无统一命名复用语法 | 元素注册表 + slot 映射 + 跨引擎适配 | **P2** |
| **双版本适配**(16:9+9:16 同分镜) | 单 aspectRatio | 双版本锚 | **P3** |
| **CONTINUITY 主表行**(StylePack/Light/FPS/双版本) | 散在 shot 字段 | 成「一行连续性契约」 | **P3** |

## 3. Phase 1 — beat 黄金字段(✅ 已交付 v12.11.0,向后兼容)

`MicroBeat` 新增可选:`characters?: string[]` / `scene?: string` / `mood?: string` /
`microExpression?: string` / `speedRamp?: string`。
`ScriptShot` 新增可选:`mustShow?: string[]` / `transition?: 'cut'|'continuous'`。

- **Writer**:`buildBeatSheetBlock` 追加「黄金模板对齐」段,指引逐 beat 填上述字段,
  纪律:characters/scene 必引用已有资产名(锁一致性的键);microExpression 只在情绪转折填;
  speedRamp 不改时长字段;mood 串起来=情绪曲线。
- **引擎合成**:`synthesizeBeatsToEnginePrompt`:微表情内联进对应 beat 动作;
  新增 `Mood:`(逐 beat 去重)/`Timing:`(慢镜带时间码)/`Must show:` 子句。
- **展示**:分镜师卡片逐 beat 显示 👤角色 / 🏞场景 / 😶微表情 / ⏱慢镜 / 氛围,镜头级「必现」行。

## 4. Phase 2 — @元素多参挂载(✅ 核心已交付 v12.12.0)

落地「角色/场景/道具统一命名 → 映射参考图 → 按引擎适配喂入」:

**v12.12.0 已交付**:
- **`lib/elements-registry.ts`**(纯函数,16 单测):`buildElementsRegistry`(project assets → `@人物{}/@场景{}/@道具{}` 注册表)、`elementId/parseElementId`、`mountForShot`(按名解析+去重+排序)、跨引擎适配器 `toSeedanceSlots`(image_urls 角色→场景→道具 + `@Image1..` mentions)/`toKlingElements`(elements frontal+多角度 refs + 场景 image_urls)/`toVeoReferenceImages`(≤3 角色→场景→道具)/`annotateSeedancePrompt`。
- **承接真末帧链(解锁 v12.9.1 #3)**:orchestrator 在 `shot.transition==='continuous'` + 上一镜真末帧已抽好 + `scenesLikelySame` 同场景守卫(防误标跨场景串帧)三条件齐备时,**用上一镜真末帧作 I2V 首帧**(无缝衔接),否则沿用静态分镜图(安全基线)。发 `consistencyStatus: lastFrameChained` 事件。
- **registry 接线**:orchestrator 每次渲染建注册表,逐镜 `mountForShot` 解析挂载 → `[Elements]` 日志 + `consistencyStatus: elementsMounted` 事件。

**Phase 2.1(跟进,需扩契约)**:`VideoGenerateInput`(lib/video-providers/types.ts)目前每 subject 只收 1 url;
要把 Kling 多角度 `reference_image_urls` / Seedance `@Image` prompt 真正喂进 dispatch,需扩 subjectReferences 为
`{frontalUrl, refUrls[]}` 形状 + 各 provider service 适配。适配器层(toKlingElements/toSeedanceSlots)已就绪,只差喂入。

### 原始设计(完整版,供 P2.1 参考)

1. **元素注册表**(项目级):`elements_registry`(已有 project_assets 角色/场景可直接投影),
   每元素 `{id:@人物{陆晚晚}, type, traits, assets:[{role:frontal/side/3_4/primary, url}]}`。
2. **shot 挂载声明**:`mounted = {chars:[@人物{陆晚晚}], scenes:[@场景{书房}], props:[...], refOverride}`
   (beat.characters/scene 已是雏形,P2 升级为带 @id 的强引用)。
3. **跨引擎适配器**(扩 `buildMultiReferenceBundle`):
   - Seedance:按槽位顺序排 image_urls(角色最前→场景→道具),prompt 注入 `@Image1..`。
   - Kling:elements[](frontal+多角度 refs)+ image_urls[0] 场景。
   - Veo:reference_images[](≤3,asset)+ prompt 自然语言点名。
   - Minimax S2V:沿用现 subject_reference(承 v12.9.x,单主角锁定)。
4. **承接链**:`transition==='continuous'` 时才用「上一镜真末帧」做 I2V 首帧
   —— 正好解锁 v12.9.1 #3 暂缓项(同场景检测=transition 字段)。

## 5. Phase 3 — 双版本 + CONTINUITY 主表

- `aspectRatios: ('16:9'|'9:16')[]` + 双版本锚(横屏展空间关系 / 竖屏放冲击力),一次分镜两版出片。
- CONTINUITY 主表行:把 StylePack/Light(色温+光比)/FPS/双版本 收成一行「连续性契约」,全片校验。

## 6. 落地顺序(ROI)

1. ✅ **P1**(v12.11.0):beat 黄金字段 —— 低风险、立即改善引擎演出精度。
2. ✅ **P2**(v12.12.0):@元素注册表 + 跨引擎适配器 + 承接真末帧链(解锁 v12.9.1 #3)—— 一致性最大增益。
3. **P3**:双版本 + CONTINUITY 主表 —— 交付完整度。

---
**状态**(2026-06-22 更新):Phase 1(v12.11.0)+ Phase 2 核心(v12.12.0)+ **Phase 2.1(v12.15.0 多参 Elements 喂 Kling)** + **Phase 3(v12.16.0 双版本重构图 + CONTINUITY 主表)** 均已交付,tsc 0 + 测试绿。
阶段二十七延伸:Seedance @Image dispatch 随 **Seedance 2.0 接活(v12.28.0)** 真正落地;并新增 **原生音画一体(v12.29.0,`NATIVE_AV`)**。多参分镜路线已全部收口。
