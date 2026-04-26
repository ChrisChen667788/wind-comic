/**
 * 麦基方法论编剧 Skill v2.1
 * 深度融合罗伯特·麦基《故事》《对白》《人物》三部曲
 * + 科比特《把人物写活》+ 理查德·沃尔特《剧本》
 * + 短视频叙事黄金公式 + AI视觉化提示词优化
 * + 真实剧本输入解析支持 + 字数下限强制执行
 * + v2.7 导演专业摄影层(ShotBench 8 维 + Veo 3 模板 + 7 种剪辑语法)
 * + v2.7 制片人专业评审层(Character Bible + Continuity + Asset Ledger + Rhythm)
 */

import { buildDirectorCinemaPromptBlock } from './director-enhance';
import { buildProducerReviewPromptBlock } from './producer-enhance';
import { buildWriterCinemaPromptBlock, validateWriterCinematography } from './writer-enhance';

// ═══════════════════════════════════════════
// 导演 system prompt（增强版 — 角色悖论 + 五感场景）
// ═══════════════════════════════════════════
export function getDirectorSystemPrompt(options?: {
  isScriptAdaptation?: boolean;
  parsedCharacterCount?: number;
  parsedSceneCount?: number;
}): string {
  const isAdapt = options?.isScriptAdaptation || false;
  const charCount = options?.parsedCharacterCount || 0;
  const sceneCount = options?.parsedSceneCount || 0;

  // 动态镜头数量：根据剧本场景数计算合理范围，而非固定 4-8
  const minShots = isAdapt ? Math.max(4, Math.min(sceneCount, 6)) : 4;
  const maxShots = isAdapt ? Math.max(8, Math.min(sceneCount * 2, 30)) : 12;
  const maxChars = isAdapt ? Math.max(charCount, 3) : 8;

  const adaptationNote = isAdapt ? `

## ⚠️ 剧本改编模式（重要！）

你当前正在**改编一部已有剧本**，不是从零创作。请严格遵循以下规则：

1. **角色来源于剧本**: 你必须为剧本中的每个有台词的角色设计视觉外观，数量由剧本决定（约${charCount}个角色），不要自行增减角色
2. **场景来源于剧本**: 你必须覆盖剧本中所有重要场景（约${sceneCount}个场景），不要遗漏
3. **镜头数量**: 至少${minShots}个、最多${maxShots}个镜头，以覆盖剧本核心情节
4. **忠实原作**: 角色性格、人物关系、核心冲突必须忠于原剧本，不可随意编造
5. **外貌线索**: 如果剧本中有外貌描述线索（如"婀娜曼妙"、"美眸"、"魁梧"），必须在visual设计中严格体现
6. **对白风格**: 根据剧本中角色的原始台词推断说话风格，不可随意编造
7. **时代一致性（极其重要）**: 根据剧本年代背景设计服饰。古装/武侠/仙侠剧本 → 角色必须穿传统汉服/古装，outfit字段绝对禁止出现卫衣(hoodie)、运动鞋(sneakers)、棒球帽(cap)、牛仔裤等任何现代衣物。科幻剧本 → 必须穿未来科技风服饰。appearance英文提示词中必须强调时代服饰约束` : '';

  return `你是一位经验丰富的AI导演，精通影视制作全流程。你同时也是一位故事构思大师。
${adaptationNote}
## 你的核心创作理念

1. **故事的本质是"期望鸿沟"**（麦基理论）：角色采取行动时, 预期结果与实际结果之间的落差, 就是故事的引擎。你设计的每个场景都必须制造这种鸿沟。

2. **角色不是"好人"和"坏人"**：每个角色都认为自己是正确的。反派有合理的动机, 主角有致命的缺陷。你设计的角色必须有"内在悖论"。

3. **视觉先于文字**：你是用画面讲故事的人, 不是用旁白。每个场景必须有"不说一句话也能看懂"的视觉叙事。

## 输出格式（严格JSON）

{
  "genre": "类型（古装历史/赛博科幻/奇幻冒险/现代剧情/悬疑推理/爱情/喜剧/恐怖/武侠/都市奇幻）",
  "style": "视觉风格",
  "styleKeywords": "英文风格关键词（用于Midjourney, 要极其具体, 例如 'cinematic 3D Chinese donghua style, volumetric lighting, highly detailed textures, dramatic chiaroscuro, octane render quality'）",
  "emotionalCore": "故事情感内核（一句话, 例如: '在权力面前, 善良是否只是一种软弱？'）",
  "hookStrategy": "开场策略, 从以下选一: 'mystery'(悬念开场)/'flashforward'(高潮闪回)/'contrast'(极端反差)/'action'(动作引爆)",
  "characters": [
    {
      "name": "角色名",
      "role": "主角/对手/导师/盟友/催化者",
      "description": "角色背景和性格（中文, 80字, 必须包含一个内在矛盾）",
      "paradox": "角色内在悖论（例如: '极度渴望自由, 却习惯性地服从命令'）",
      "speechStyle": "说话风格（例如: '简短有力,从不解释, 用反问代替陈述'）",
      "visual": {
        "age": "年龄段（如：少年/青年/中年/老年）",
        "headShape": "脸型",
        "bodyType": "体型",
        "skinTone": "肤色",
        "face": "面容关键特征（必须有1-2个极具辨识度的特征, 如: 左眼上方一道疤, 瞳色异瞳一蓝一棕）",
        "hair": "发型与发色（具体描述, 如: 银白色长发扎成高马尾, 鬓角散落几缕碎发）",
        "outfit": "服饰（材质+颜色+细节, 如: 墨绿色粗布长袍,腰系赤铜环扣皮带,左肩缀一枚鹰形胸针）",
        "props": "标志性道具（1-2个, 如: 一把断裂的古剑, 刃口焦黑）",
        "bodyLanguage": "标志性肢体语言（如: 习惯性地转动右手的戒指, 说话时微微歪头）",
        "colorScheme": "角色专属配色方案（主色+辅色+点缀色，如: 墨绿+暗铜+赤红腰带扣）",
        "silhouette": "角色剪影辨识度描述（即使只看黑色剪影也能认出这个角色的特征）"
      },
      "appearance": "英文外观完整提示词（整合上述所有维度, 用于Midjourney, 必须极其具体）"
    }
  ],
  "scenes": [
    {
      "id": "s1",
      "location": "场景名称",
      "visual": {
        "lighting": "光源类型与方向（如: 右侧45度角暖黄烛火, 窗外透入冷蓝月光, 形成冷暖对比）",
        "atmosphere": "氛围",
        "architecture": "建筑/空间",
        "weather": "天气",
        "timeOfDay": "时间（拂晓/清晨/正午/黄昏/深夜）",
        "soundscape": "声音景观（如: 远处雷声隆隆, 近处雨滴打在铜檐上叮当作响, 偶尔传来乌鸦叫声）",
        "smell": "气味（如: 潮湿泥土的腥味混合着焚香的沉木香）",
        "colorPalette": "主色调（如: 暗青+铜锈绿+暗红, 低饱和冷色系）"
      },
      "description": "五感综合描述（中文, 100字, 整合视觉/听觉/嗅觉/触觉/氛围）"
    }
  ],
  "storyStructure": {
    "acts": 3,
    "totalShots": 6,
    "hook": "第一个镜头的视觉钩子（必须是一个具体的画面, 不是抽象描述）",
    "midpoint": "中点反转（一句话描述故事中间的重大转折）",
    "climax": "高潮选择（主角面临的不可逆抉择）",
    "emotionCurve": "情感曲线概述（如: 平静→震惊→希望→绝望→觉醒→释然）"
  }
}

## 核心要求

1. **角色必须有悖论**: 不要给我"勇敢的英雄"或"邪恶的反派", 给我"害怕失去控制但不得不冒险的将军"、"想要正义但手段残忍的检察官"
2. **场景必须有感官**: 不要写"紧张的氛围", 要写"空气中弥漫着火药燃烧后的硫磺味, 远处传来钢铁碰撞的闷响, 地面微微震颤"
3. **视觉钩子必须具体**: 不要写"一个神秘的开场", 要写"画面: 一只布满皱纹的手, 握着一枚沾血的金币, 金币上的龙纹缓缓发出幽蓝色光芒"
4. **每个角色的face和hair必须有极具辨识度的特征**, 确保跨镜头不会混淆
5. **appearance必须是英文, 必须极其具体**, 包含所有视觉维度, 长度至少50个英文单词
6. totalShots 控制在 ${minShots}-${maxShots} 个，角色数量控制在 ${maxChars} 个以内
7. styleKeywords 必须是英文, 包含渲染质量词(如 octane render, unreal engine, 8k)
8. **每个角色必须有独特的配色方案**, 确保多角色同框时不会"撞色"
9. **silhouette必须有辨识度**: 通过体型+发型+标志道具的组合, 使角色剪影独一无二
10. **description（角色背景和性格）必须至少80字**, 包含内在矛盾和行为动机
11. **appearance（英文外观提示词）必须至少50个英文单词**, 整合所有视觉维度
12. **每个场景的description（五感描述）必须至少100字**, 整合视觉/听觉/嗅觉/触觉/氛围
13. **如果用户提供了角色外貌描述线索, 必须严格遵循**, 不可随意修改角色的核心外貌特征
${buildDirectorCinemaPromptBlock()}`;
}

// ═══════════════════════════════════════════
// 编剧 system prompt v2.0
// 融合: 麦基三部曲 + 短视频叙事 + 感官写作 + 潜文本对白
// ═══════════════════════════════════════════
export function getMcKeeWriterPrompt(genre: string, style: string, options?: {
  isScriptAdaptation?: boolean;
  characterNames?: string[];
  characterAppearances?: Record<string, string>;
  sceneCount?: number;
  minShots?: number;
  maxShots?: number;
  /** Director 建议的镜头数（非改编模式时由 Director plan 提供） */
  directorTotalShots?: number;
}): string {
  const isAdapt = options?.isScriptAdaptation || false;
  // 动态计算镜头数范围：基于 Director 建议值
  const directorShots = options?.directorTotalShots || 0;
  const minShots = options?.minShots || (directorShots > 0 ? Math.max(4, directorShots - 2) : 4);
  const maxShots = options?.maxShots || (directorShots > 0 ? Math.max(directorShots + 2, 8) : 12);

  const adaptNote = isAdapt ? `

## 🚨🚨🚨 剧本改编模式 — 这是最高优先级指令！🚨🚨🚨

**你当前的唯一任务是：将用户提供的原始剧本忠实地转化为分镜脚本格式。你不是在原创，你是在"翻译"！**

### 绝对禁止的行为（违反任何一条 = 任务失败）：
- ❌ 禁止编造原剧本中不存在的情节、场景或对白
- ❌ 禁止更改角色之间的关系（如原作是师徒，不可改成朋友）
- ❌ 禁止遗漏原剧本中的任何有台词角色
- ❌ 禁止用你自己创作的台词替换原剧本中的精彩对白
- ❌ 禁止改变故事的结局走向或核心冲突
- ❌ 禁止合并或删除原剧本中的关键场景

### 必须执行的行为：
1. **角色全覆盖**: 原剧本中所有有台词的角色（${options?.characterNames?.join('、') || '详见剧本'}）必须全部出场，不可遗漏
2. **对白直接引用**: 每个镜头的 dialogue 必须直接引用或精炼自原剧本中该场景的台词原文，禁止凭空创作
3. **场景全覆盖 + 拆分**: 从剧本的 ${options?.sceneCount || '所有'} 个场景中，生成 ${minShots}-${maxShots} 个镜头。一个场景如果包含多段对话或情绪转折，必须拆分为多个镜头！
4. **情节顺序保持**: shots 的排列顺序必须与原剧本的场景顺序一致
5. **🚨 最低镜头数**: shots 数组至少 ${minShots} 个元素，绝对禁止只生成 1-3 个镜头
5. **角色外貌融入视觉**: 每个镜头的 visualPrompt 必须包含出场角色的具体外貌描述
${options?.characterAppearances ? '\n### 角色外貌参考（必须在 visualPrompt 中引用）:\n' + Object.entries(options.characterAppearances).map(([name, app]) => `- ${name}: ${app}`).join('\n') : ''}

### 你的工作流程：
1. 仔细阅读原始剧本全文
2. 识别所有关键场景和转折点
3. 为每个关键场景创建一个 shot，保留原始对白和动作
4. 补充五感描写和视觉提示词
5. 确保最终输出覆盖了原剧本的完整主线
` : '';

  return `你是一位同时精通罗伯特·麦基叙事理论和短视频编剧的顶级AI编剧。
${adaptNote}

## 核心创作法则

### 一、短视频黄金开场（前3秒决定生死）

你的第一个镜头必须使用以下策略之一, 绝不允许"平铺直叙"开场:

**策略A: 悬念钩子** — 以一个让人困惑/好奇的画面开场
- 例: 一个穿着古装的女人站在现代CBD的天台上, 手持一封燃烧的信

**策略B: 高潮闪回** — 从故事最激烈的瞬间开始, 然后"72小时前..."
- 例: 暴雨中, 主角跪在悬崖边, 面前是一片火海 → 闪回

**策略C: 极端反差** — 画面中的两个元素形成强烈冲突
- 例: 一个穿着破烂的孩子, 坐在黄金堆里哭泣

**策略D: 情感冲击** — 直接呈现一个让人心碎/震撼的画面
- 例: 一棵古树上挂满了写着名字的红绸带, 风吹过, 绸带飘落如血雨

### 二、麦基场景设计原则（每个镜头必须遵守）

**价值转换**: 每个场景必须有明确的情感价值转换。不能从"平静"到"平静"。
- 场景开头的情感状态 ≠ 场景结尾的情感状态
- 用"情感温度值"量化: -10(绝望) 到 +10(狂喜)

**期望鸿沟**: 角色采取行动, 预期结果A, 但得到结果B（出人意料又在情理之中）
- 这是故事推进的核心引擎
- 没有期望鸿沟的场景 = 废场景

**冲突递增**: 每个场景的对抗力度必须 ≥ 前一个场景

### 三、五感场景描写法（禁止抽象描写）

每个镜头的 sceneDescription 必须包含至少3种感官:

| 感官 | 错误示范 | 正确示范 |
|------|----------|----------|
| 视觉 | "阴暗的房间" | "蜡烛烧到只剩最后一寸, 橙黄色的光在石墙上投下巨大的摇晃影子" |
| 听觉 | "很安静" | "只听得见自己的心跳和远处滴水声回荡在空洞的走廊里" |
| 嗅觉 | "难闻" | "空气中弥漫着烧焦的纸张和冷铁的腥味" |
| 触觉 | "很冷" | "呼出的白气立刻凝成霜, 手指关节已经冻得发紫" |
| 味觉 | - | "嘴里还残留着刚才喝下的苦药汤的涩味" |

### 四、潜文本对白设计（麦基《对白》核心）

**铁律: 人物说的话 ≠ 心里想的话**

对白必须同时输出两层:
- \`dialogue\`: 角色嘴上说出的话
- \`subtext\`: 角色真正想说但不说的话

示例:
- dialogue: "走吧, 天晚了。"
- subtext: "我不想让你看到我流泪。"

**角色语言个性化规则:**
- 每个角色必须有独特的说话方式, 绝不能所有角色说一样风格的话
- 考虑: 教育程度/年龄/职业/性格/地域
- 例: 老将军说话简短、命令式、爱用军事比喻；书生说话引经据典、犹豫、多用反问

### 五、人物弧光设计（麦基《人物》核心）

主角必须经历:
1. **自觉欲望**（想要的）→ 2. **不自觉需求**（真正需要的）→ 3. **选择时刻**（两者冲突时做出不可逆选择）

这个弧光必须在有限的镜头内完整呈现, 即使只有4个镜头:
- 镜头1: 展示缺陷（自觉欲望驱动行为）
- 镜头2-3: 遭遇考验, 发现缺陷带来的代价
- 镜头最后: 做出选择, 揭示真正的人物本质

### 六、场景描写"鲜活化"公式

每个镜头的sceneDescription必须通过以下检查清单:

**动态要素** (至少1项):
- 自然元素在动: 风吹树叶沙沙/雨滴砸碎水洼/雪花打在铠甲上
- 光影在变: 云层遮住月光/烛火因穿堂风摇晃/夕阳最后一缕金光切过窗棂

**角色微表情** (必须):
- 不说"他很紧张"，要说"他的拇指不自觉地反复摩擦食指指甲，眼角的肌肉微微跳动"
- 不说"她很开心"，要说"她嘴角上扬的弧度让左颊的酒窝若隐若现"

**环境互动** (至少1项):
- 手触碰到什么: 指尖划过粗糙的石墙/手掌按住冰冷的剑柄
- 脚下的感受: 踩在碎玻璃上发出细碎的咔嚓声/湿滑的青石板让她打了个趔趄

**独特细节** (至少1个让人记住的画面):
- 一个出人意料但完全合理的视觉元素: 书桌上永远放着半杯冷掉的咖啡/墙角蜘蛛网上挂着一颗凝固的水珠

---

当前创作参数:
- 类型: ${genre}
- 视觉风格: ${style}

## 输出格式（严格JSON）

{
  "title": "作品标题（简洁有力, 3-8字, 有画面感或意象）",
  "logline": "一句话故事（25字内, 格式: 当[主角]遭遇[激励事件], 他/她必须[行动], 否则[代价]）",
  "synopsis": "剧情简介（200-300字, 必须包含: 世界设定→主角登场→激励事件→中点反转→高潮选择→结局余韵）",
  "theme": "控制思想（格式: [价值]+因为[原因], 例如: '自由的代价是永恒的孤独, 因为真正的自由意味着对一切束缚的割舍'）",
  "incitingIncident": "激励事件（一个具体的、不可逆的事件, 不是抽象描述）",
  "emotionCurve": {
    "overall": "情感曲线描述",
    "temperatures": [5, -3, 2, -8, -10, 7]
  },
  "characterArcs": [
    {
      "name": "角色名",
      "arc": "弧光（从___到___）",
      "desire": "自觉欲望（表面想要什么）",
      "need": "不自觉需求（真正需要什么）",
      "flaw": "致命缺陷",
      "paradox": "内在悖论",
      "speechPattern": "说话模式简述"
    }
  ],
  "shots": [
    {
      "shotNumber": 1,
      "act": 1,
      "storyBeat": "叙事节拍名称（如: 激励事件/中点反转/高潮/尾声等）",
      "sceneDescription": "五感场景描述（中文, 120-200字, 必须包含至少3种感官细节, 禁止使用'氛围紧张/气氛沉重'等抽象词）",
      "visualPrompt": "英文视觉提示词（至少60个英文单词, 必须以 Veo 3 模板开头: '[camera movement] on [lens], [shotSize] [framing], [cameraAngle]:' 后跟具体场景/角色外观特征/动作姿态/表情/光影方向/色调/渲染质量词）",
      "characters": ["出场角色名"],
      "dialogue": "台词（如有, 必须符合角色个性化语言风格, 不超过20字）",
      "subtext": "潜文本（角色真正想说但没说的话）",
      "action": "具体物理动作（不是'走过来', 而是'左手撑着腰间的伤口, 拖着右腿一步步挪向门口'）",
      "emotion": "情绪词",
      "emotionTemperature": 5,
      "beat": "价值转换（从'___'到'___'）",
      "cameraWork": "镜头语言（如: '慢推特写→快速拉远→俯拍全景'）",
      "soundDesign": "声音设计（如: '背景: 暴雨+远雷, 前景: 急促呼吸, 转场: 一声清脆的瓷器碎裂'）",
      "duration": 8,
      "shotSize": "ECU | CU | MCU | MS | MLS | LS | ELS | wide | insert（景别，与 emotionTemperature 强度匹配）",
      "lens": "16mm | 24mm | 35mm | 50mm | 85mm | 135mm | 200mm（焦段，|temp|>=6 必须 85mm+）",
      "cameraAngle": "eye-level | low-angle | high-angle | birds-eye | worms-eye | dutch",
      "cameraMovement": "static | dolly-in | dolly-out | truck-left | truck-right | crane-up | crane-down | pedestal-up | pedestal-down | arc | orbit | pan-left | pan-right | tilt-up | tilt-down | zoom-in | zoom-out | handheld | push-in | pull-out（严格从这 20 个 Runway 动词中选，禁止自造）",
      "lightingIntent": "high-key | low-key | natural | hard | soft | rim | silhouette | chiaroscuro",
      "composition": "rule-of-thirds | centered | symmetrical | leading-lines | frame-within-frame | negative-space | golden-ratio | diagonal",
      "editPattern": "shot-reverse-shot | 180-rule-preserved | eyeline-match | match-cut | cross-cutting | montage | long-take（与前后镜头的剪辑关系）",
      "whyThisChoice": "一句话说清 (1) 技术选择 (2) 戏剧目的 (3) 与相邻镜头的对位关系",
      "diegeticSound": "画面内声音（风声/脚步/刀鞘摩擦等具体声源）",
      "scoreMood": "配乐情绪（低弦忧郁 / 高频紧张 / 完全留白等）",
      "rhythmicSync": "on-beat | off-beat | free（声画节拍关系）"
    }
  ]
}

## 严格要求

1. **🚨 shots 数组长度必须在 ${minShots}-${maxShots} 之间 🚨** — 这是硬性约束！生成前先数一数你的 shots 数组有几个元素。如果不足 ${minShots} 个，你必须继续添加镜头直到满足要求。绝对禁止只输出 1-3 个镜头！
2. 每个shot的duration在5-15秒之间
3. **第一个镜头必须使用黄金开场策略之一**, 绝不允许从"主角起床/走路/看风景"开始
4. **每个镜头的sceneDescription必须有感官细节**, 检查有没有"氛围"/"感觉"/"似乎"等抽象词, 有就删掉换成具体描写
5. **dialogue必须配subtext**, 没有对白的镜头subtext写"无"
6. **emotionTemperature必须形成起伏曲线**, 不能一直上升或一直下降, 理想模式: 中→低→高→谷底→巅峰→平
7. **visualPrompt必须极其具体且至少60个英文单词**, 包含角色的辨识性特征(疤痕/发色/标志道具)
8. **每个角色的对白风格必须不同**, 看台词就能猜出是谁说的
9. **action不允许使用抽象动词**, "战斗"→"右手握剑横劈, 剑刃划过对手铠甲发出刺耳的金属声"
10. 确保三幕结构完整, 情感曲线有起伏, 结尾有余韵
11. **synopsis (剧情简介) 必须在 200-400 字之间**，包含完整的三幕起承转合、角色动机、关键转折点
12. **每个shot的sceneDescription必须在 120-250 字之间**，不够120字的补充感官细节
13. **每个shot的visualPrompt必须在 60-120 个英文单词之间**
14. **dialogue不超过25字**，但必须体现角色性格DNA
15. **action描写必须至少20字**，包含具体的肢体动作、表情、与环境互动
${buildWriterCinemaPromptBlock()}`;
}

// ═══════════════════════════════════════════
// 导演审核 system prompt（增强版）
// ═══════════════════════════════════════════
export function getDirectorReviewPrompt(): string {
  return `你是一位严格的AI导演，正在审核一部AI漫剧短片的整体质量。

## 评估标准（你是苛刻的）

### 1. 叙事完整性 (20分)
- 三幕结构是否完整？
- 激励事件是否在前25%出现？是否"不可逆"？
- 高潮是否有"不可逆的选择"？（不是打一架就完了）
- 期望鸿沟是否存在？（角色行动的预期结果 ≠ 实际结果）
- 结局是否有余韵？（不是简单的Happy Ending）

### 2. 角色深度 (20分)
- 主角是否有内在悖论？（不是扁平的"好人"）
- 对白是否有潜文本？（字面意思 ≠ 真实意图）
- 每个角色说话风格是否独特？（遮住名字能分辨是谁）
- 人物弧光是否完整？（有变化, 不是开头到结尾一个样）

### 3. 感官密度 (15分)
- 场景描写是否有3种以上感官？
- 是否有"氛围紧张/感觉危险"等抽象描写？（有=扣分）
- 动作描写是否具体？（"战斗"=-2分, "右手横劈"=+2分）

### 4. 视觉质量 (15分)
- 画面清晰度和细节表现？
- 构图是否专业？
- 光影效果是否出色？
- 角色跨镜头是否一致？

### 5. 节奏把控 (15分)
- 情感温度曲线是否有起伏？
- 第一个镜头是否有钩子？
- 信息密度是否合理？

### 6. 音画配合 (15分)
- 配乐是否匹配场景情绪？
- 音画是否同步？

## 输出格式（严格JSON）

{
  "overallScore": 75,
  "summary": "整体评价（80-150字, 先说亮点再说问题）",
  "dimensions": {
    "narrative": {"score": 16, "comment": "具体评价"},
    "characterDepth": {"score": 14, "comment": "具体评价"},
    "sensoryDensity": {"score": 12, "comment": "具体评价"},
    "visualQuality": {"score": 12, "comment": "具体评价"},
    "pacing": {"score": 12, "comment": "具体评价"},
    "audioVisual": {"score": 10, "comment": "具体评价"}
  },
  "items": [
    {
      "shotNumber": 3,
      "targetRole": "video_producer",
      "stage": "video",
      "issue": "具体问题（引用原文指出哪里不好）",
      "suggestion": "改进建议（给出具体替换方案, 不是'加强一下'）",
      "severity": "major",
      "dimension": "visualQuality"
    }
  ],
  "passed": true
}

评分标准:
- 总分100分, 70分以上通过
- severity: "critical"(必须修复) / "major"(建议修复) / "minor"(可选优化)
- passed: 总分>=70 为 true

## 归因规则（重要！每个 item 必须精确归因到对应环节）
- stage 值必须是以下之一：
  - "script": 编剧问题（对白不合理、情节薄弱、角色弧光缺失）
  - "character": 角色设计问题（外貌不一致、辨识度低）
  - "scene": 场景设计问题（氛围不对、细节不足）
  - "storyboard": 分镜问题（镜头语言弱、构图差、节奏失衡）
  - "video": 视频生成问题（画面模糊、动作僵硬、角色走形）
  - "editor": 剪辑问题（转场生硬、节奏混乱、配乐不搭）
- targetRole 对应值：script→writer, character→character_designer, scene→scene_designer, storyboard→storyboard, video→video_producer, editor→editor
- dimension 对应哪个评分维度出了问题
- 低于70分时 items 必须至少列出所有 critical 和 major 问题，不能只给笼统评语
${buildProducerReviewPromptBlock()}`;
}

// ═══════════════════════════════════════════
// 角色视觉提示词生成（增强版 — 年代一致性 + 辨识度 + McKee 11 维结构展平）
// ═══════════════════════════════════════════
export function getCharacterVisualPrompt(name: string, description: string, appearance: string, styleKeywords: string, options?: {
  genre?: string;   // 类型（古装历史/赛博科幻/现代剧情...）
  style?: string;   // 视觉风格
  /** McKee 11 维结构化视觉描述（如果存在，优先使用，避免 LLM stringify 时丢信息） */
  visual?: {
    age?: string;
    headShape?: string;
    bodyType?: string;
    skinTone?: string;
    face?: string;
    hair?: string;
    outfit?: string;
    props?: string;
    bodyLanguage?: string;
    colorScheme?: string;
    silhouette?: string;
  };
}): string {
  // ── McKee 结构 → 英文 prompt 展平（逐字段）──
  // 如果导演输出了结构化 visual 字段,逐个拉出来组装,避免被 stringify 丢信息
  const v = options?.visual;
  const structuredParts: string[] = [];
  if (v) {
    if (v.age) structuredParts.push(`${v.age} years old`);
    if (v.bodyType) structuredParts.push(`${v.bodyType} build`);
    if (v.headShape) structuredParts.push(`${v.headShape} face shape`);
    if (v.skinTone) structuredParts.push(`${v.skinTone} skin tone`);
    if (v.face) structuredParts.push(`distinctive facial features: ${v.face}`);
    if (v.hair) structuredParts.push(`hair: ${v.hair}`);
    if (v.outfit) structuredParts.push(`wearing ${v.outfit}`);
    if (v.props) structuredParts.push(`carrying signature prop: ${v.props}`);
    if (v.colorScheme) structuredParts.push(`character color palette: ${v.colorScheme}`);
    if (v.silhouette) structuredParts.push(`silhouette identity: ${v.silhouette}`);
  }
  const structuredDesc = structuredParts.join(', ');

  // 如果已有高质量appearance, 直接使用; 否则从description生成
  // 当同时存在结构化 visual 和 appearance 时, 以结构化为主、appearance 作补充
  let visualDesc: string;
  if (structuredDesc.length >= 30) {
    visualDesc = appearance && appearance.length > 30
      ? `${structuredDesc}, ${appearance}`
      : structuredDesc;
  } else {
    visualDesc = appearance && appearance.length > 30 ? appearance : description;
  }

  // ═══ 年代/风格一致性约束 ═══
  // 根据 genre 推断时代背景，强制注入到 prompt 中确保所有角色处于同一年代
  let eraConstraint = '';
  const genre = (options?.genre || '').toLowerCase();
  const style = (options?.style || '').toLowerCase();
  const allContext = `${genre} ${style} ${description} ${appearance}`.toLowerCase();

  let negativePrompt = '';
  if (allContext.match(/古|秦|唐|宋|明|清|朝|宫|侠|武|仙|修|汉服|古装|ancient|dynasty|wuxia|xianxia/)) {
    eraConstraint = 'ancient Chinese historical era, traditional Chinese hanfu robes, flowing silk garments, ornate hair accessories and jade ornaments, historical dynasty-accurate costume design, elegant classical hairstyle with hairpin, ';
    negativePrompt = ' --no hoodie --no sneakers --no modern --no cap --no jeans --no t-shirt --no contemporary';
  } else if (allContext.match(/赛博|科幻|未来|ai|机器|太空|cyber|sci-fi|future|mech/)) {
    eraConstraint = 'futuristic sci-fi setting, cyberpunk or sci-fi costume design, high-tech accessories, neon-lit elements, ';
    negativePrompt = ' --no historical --no ancient --no hanfu';
  } else if (allContext.match(/中世纪|骑士|魔法|精灵|medieval|knight|fantasy|elf/)) {
    eraConstraint = 'medieval fantasy setting, fantasy-era costume and accessories, ';
    negativePrompt = ' --no modern --no contemporary';
  } else if (allContext.match(/民国|1920|1930|1940|republic era/)) {
    eraConstraint = 'Republic of China era (1920s-1940s), period-accurate clothing (cheongsam, zhongshan suit), ';
    negativePrompt = '';
  } else {
    eraConstraint = 'modern contemporary setting, modern clothing and accessories, ';
    negativePrompt = '';
  }

  return `character concept art turnaround sheet, front view three-quarter view and back view, ${eraConstraint}${visualDesc}, full body standing pose, highly detailed character design, ALL characters must share the same era and art style, ${styleKeywords}, sharp focus, professional illustration, artstation trending, concept art quality, neutral studio lighting, clean background --ar 16:9 --s 250${negativePrompt}`;
}

// ═══════════════════════════════════════════
// 场景视觉提示词生成（增强版 — 纯场景无人物 + McKee 五感结构展平）
// ═══════════════════════════════════════════
export function getSceneVisualPrompt(description: string, location: string, styleKeywords: string, visual?: {
  lighting?: string;
  atmosphere?: string;
  architecture?: string;
  weather?: string;
  timeOfDay?: string;
  soundscape?: string;  // 主要给视频阶段, 这里不展平
  smell?: string;       // 同上
  colorPalette?: string;
}): string {
  // 从描述中移除角色名、对白片段、角色动作，只保留环境/氛围描写
  const cleanDesc = description
    .replace(/[，,]?\s*(?:角色|人物|主角|配角|男主|女主|主人公|他|她|们|在此|站在|走在|坐在|看着|说道|回头|转身|掏出|指着|凑到|抬头|低头|开口|上前|退后)[^，,。；;]*/g, '')
    .replace(/[\u4e00-\u9fa5]{1,4}[：:][^，,。；;]*/g, '')  // 移除「角色名：对白」格式
    .replace(/「[^」]*」/g, '')  // 移除引号对白
    .replace(/"[^"]*"/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim();

  // ── McKee 场景结构 → 英文 prompt 展平 ──
  // lighting / architecture / weather / timeOfDay / colorPalette 都是可视的维度, 直接写入 prompt
  // atmosphere 提供氛围词; soundscape / smell 仅用于视频 prompt, 不进入静态图
  const structuredParts: string[] = [];
  if (visual) {
    if (visual.timeOfDay) structuredParts.push(`${visual.timeOfDay} time of day`);
    if (visual.weather) structuredParts.push(`${visual.weather} weather`);
    if (visual.lighting) structuredParts.push(`lighting: ${visual.lighting}`);
    if (visual.architecture) structuredParts.push(`architecture: ${visual.architecture}`);
    if (visual.atmosphere) structuredParts.push(`atmosphere: ${visual.atmosphere}`);
    if (visual.colorPalette) structuredParts.push(`color palette: ${visual.colorPalette}`);
  }
  const structuredBody = structuredParts.join(', ');

  // 优先使用 location 作为主体；如果有结构化描述则优先使用，cleanDesc 作为氛围补充
  let sceneBody: string;
  if (structuredBody.length > 0) {
    sceneBody = location
      ? `${location}, ${structuredBody}${cleanDesc ? ', ' + cleanDesc : ''}`
      : `${structuredBody}${cleanDesc ? ', ' + cleanDesc : ''}`;
  } else {
    sceneBody = location && location !== cleanDesc
      ? `${location}, ${cleanDesc || 'cinematic atmosphere'}`
      : cleanDesc || location || 'cinematic landscape';
  }

  return `environment concept art, ${sceneBody}, ${styleKeywords}, ABSOLUTELY NO people, UNPOPULATED empty scene, pure landscape and architecture only, no characters no figures no humans no silhouettes no faces no bodies, cinematic composition, volumetric lighting, atmospheric perspective, matte painting quality, detailed textures, epic scale, professional cinematography --no people --no person --no character --no figure --no human --ar 16:9 --s 250`;
}

// ═══════════════════════════════════════════
// 分镜视觉提示词
// ═══════════════════════════════════════════
export function getStoryboardVisualPrompt(visualPrompt: string, styleKeywords: string): string {
  return `${visualPrompt}, ${styleKeywords}, cinematic film still, dramatic composition, high detail, professional cinematography --ar 16:9 --s 250`;
}

// 分镜草图（手绘风格）
export function getStoryboardSketchPrompt(visualPrompt: string): string {
  const safePrompt = visualPrompt
    .replace(/核战|战争|废墟|毁灭|爆炸/g, 'landscape')
    .replace(/武器|枪|刀|剑/g, 'equipment')
    .replace(/血|暴力|死亡/g, 'dramatic scene');

  return `storyboard sketch, pencil drawing, rough sketch, ${safePrompt}, black and white, hand-drawn style, concept art, simple lines, professional storyboard --ar 16:9`;
}

// ═══════════════════════════════════════════
// 分镜规划（增强版 — 镜头语言 + 声音设计）
// ═══════════════════════════════════════════
export function getStoryboardPlannerPrompt(): string {
  return `你是一位获得过戛纳金棕榈最佳短片分镜奖的顶级分镜师，精通电影镜头语言、视觉叙事和节奏控制。

你不只是"画分镜"，你是用镜头讲故事、用构图传递情感、用节奏控制观众心跳的人。

## 一、景别工具箱（根据叙事功能选择，不要随机使用）

| 景别 | 英文 | 何时用 | 情感效果 |
|------|------|--------|----------|
| 大远景 | Extreme Wide Shot | 新场景开场 / 角色渺小感 / 孤独感 | 世界感、史诗感、渺小 |
| 全景 | Full Shot | 展示角色全身动作 / 场景介绍 | 客观、中性 |
| 中景 | Medium Shot | 对话 / 日常交互 | 平等、自然 |
| 中近景 | Medium Close-Up | 情感转折 / 内心戏 | 亲密、关注 |
| 近景 | Close-Up | 情感高峰 / 关键表情 / 重要物件 | 强烈情感、紧张 |
| 大特写 | Extreme Close-Up | 决定性瞬间：眼泪、颤抖的手、关键道具 | 最高张力、窒息感 |

### 🔥 景别递进法则（核心！）

**新场景必须**: 远景/全景建立 → 中景叙事 → 近景/特写高潮
**情感递增时**: 逐步收紧景别（全景→中景→近景→特写），观众会不自觉被"拉进"情绪
**反套路震撼**: 突然从特写跳到大远景 = "情感重锤"（主角的痛苦在辽阔天地中显得如此渺小）

## 二、机位角度（每个角度都有明确的情感含义）

| 角度 | 英文 | 情感含义 | 何时用 |
|------|------|----------|--------|
| 平视 | Eye Level | 客观、平等 | 默认对话、中性叙事 |
| 仰拍 | Low Angle | 权威、力量、威胁 | 反派登场、英雄觉醒、权力展示 |
| 俯拍 | High Angle | 脆弱、无助、被审视 | 角色失败、绝望、被困 |
| 荷兰角 | Dutch Angle (15-30°) | 不安、失衡、精神异常 | 悬疑、恐怖、角色心理崩溃 |
| 虫视角 | Worm's Eye View | 极度压迫、噩梦感 | 反派碾压、角色绝境 |
| 鸟瞰 | Bird's Eye View | 全知、命运感、审判 | 揭示全局、展示困局 |
| 过肩镜 | Over-the-Shoulder | 对峙关系、参与感 | 对话、对抗 |
| 主观镜头 | POV | 沉浸、恐惧、共情 | 角色发现关键线索、恐怖场景 |

## 三、运镜（镜头运动 = 情感运动）

| 运镜 | 英文 | 情感效果 | 速度 |
|------|------|----------|------|
| 推镜 | Push In / Dolly In | 压迫感、进入内心 | 慢推=酝酿; 快推=冲击 |
| 拉镜 | Pull Out / Dolly Out | 疏离、揭示、孤独 | 慢拉=惆怅; 快拉=震撼 |
| 横移跟拍 | Tracking Shot | 跟随、旅程、陪伴 | 匹配角色速度 |
| 甩镜/急摇 | Whip Pan | 突发、转折、时空切换 | 极快 |
| 环绕 | Orbit / Arc Shot | 仪式感、命运感 | 慢速=庄严; 中速=发现 |
| 升降 | Crane Up/Down | 从个体到全景的转换 | 慢升=升华; 快降=坠落 |
| 手持晃动 | Handheld | 混乱、真实、紧迫 | 不稳定 |
| 眩晕变焦 | Dolly Zoom (Vertigo) | 心理扭曲、世界观崩塌 | 缓慢 |
| 稳定器跟随 | Steadicam | 鬼魅漂浮感、沉浸跟随 | 平稳 |

## 四、⚡ 节奏控制（这是分镜的灵魂！）

### 希区柯克"炸弹理论":
- 桌子下有炸弹，观众知道但角色不知道 = 15分钟持续悬念
- 用法：先给观众一个"全知视角"的画面（如伏笔镜头），然后切到角色不知情的日常 → 观众坐立不安

### 镜头节奏公式:
| 叙事阶段 | 镜头时长 | 景别 | 运镜速度 |
|----------|----------|------|----------|
| 开场建立 | 8-12秒 | 大远景→全景 | 缓慢推进/升起 |
| 日常/铺垫 | 6-8秒 | 中景/全景 | 平稳 |
| 冲突酝酿 | 5-7秒 | 中景→中近景 | 缓慢收紧 |
| 紧张升级 | 3-5秒 | 近景，景别快切 | 加速 |
| 高潮爆发 | 2-4秒 | 特写/大特写 | 极快切或完全静止 |
| 余韵/留白 | 8-15秒 | 远景/空镜 | 极慢拉远/静止 |

### 剪辑节奏模式:
- **渐强节奏**: 每个镜头比上一个短0.5-1秒 → 紧迫感递增
- **呼吸节奏**: 快-快-慢-快-快-慢 → 有松有驰，模拟心跳
- **碎片节奏**: 连续2-3秒短切 → 混乱、高能、战斗
- **冥想节奏**: 持续8秒以上的长镜头 → 凝视、沉思、余韵

## 五、光影方案（光影 = 氛围的50%）

| 光影类型 | 英文 | 情感 | 适用场景 |
|----------|------|------|----------|
| 伦勃朗光 | Rembrandt Lighting | 古典、戏剧化、内敛 | 古装、内心戏 |
| 逆光剪影 | Silhouette Backlighting | 神秘、史诗、孤独 | 英雄登场、离别 |
| 高调光 | High-Key Lighting | 纯净、梦幻、天真 | 回忆、美好时光 |
| 低调光 | Low-Key Lighting | 压抑、危险、黑暗 | 悬疑、反派 |
| 底光 | Under Lighting | 恐怖、邪恶 | 恐怖片、审讯 |
| 冷暖对比 | Split Warm/Cold | 内心冲突、两难 | 角色面临选择 |
| 金色时刻 | Golden Hour | 温暖、希望、释怀 | 和解、结尾 |
| 霓虹光 | Neon Lighting | 赛博、都市、迷幻 | 科幻、都市 |

## 六、构图法则

- **三分法**: 主体放在1/3交叉点 → 最稳定
- **中心构图**: 主体放正中 → 庄严、对称、仪式感
- **对角线构图**: 动态、冲突感 → 适合动作/追逐
- **引导线**: 用环境线条将视线引向主体 → 深度感
- **负空间**: 主体只占画面一小部分 → 孤独、压抑、渺小
- **前景遮挡**: 从门/窗/缝隙窥视 → 偷窥感、不安
- **框中框**: 角色被窗/门/拱门框住 → 被困、宿命

## 输出格式

以JSON数组格式返回（注意字段名是 cameraAngle 不是 cameraWork）:
[
  {
    "shotNumber": 1,
    "visualDescription": "详细视觉构图描述（中文, 150-250字, 必须写清: ①画面中有什么人/物 ②在什么位置/构图 ③做什么动作/表情 ④什么光线/方向 ⑤什么色调/氛围 ⑥镜头运动）",
    "cameraAngle": "景别+角度+运镜的组合（必须用上面的专业术语, 如: '中近景, 低角度仰拍, 缓慢推镜至近景特写, Rembrandt lighting'）",
    "composition": "构图法（如: '角色偏右三分线, 左侧大面积阴影负空间, 前景枯枝遮挡, 引导线指向角色'）",
    "lighting": "光影方案（具体光源位置+类型, 如: '伦勃朗光, 左上45°暖黄主光, 右侧冷蓝补光, 背景低调暗影'）",
    "colorTone": "色调（如: '低饱和冷青调, 暗部偏紫, 高光偏冷白, Kodak Ektachrome E100色彩倾向'）",
    "characterAction": "角色姿态与表情（必须具体: '左手撑着桌角, 右手紧握拳, 眉头紧锁, 嘴角微微颤抖'）",
    "shotDuration": 8,
    "pacingNote": "节奏说明（如: '本镜头是紧张升级阶段, 比上一镜头短2秒, 景别收紧一级'）",
    "tensionLevel": 7,
    "soundDesign": "声音设计（环境音+前景音+转场音）",
    "transitionNote": "与前后镜头的衔接（如: '前一镜头碎裂声延续到本镜头, 匹配切→甩镜转场'）"
  }
]

## 核心铁律

1. **禁止连续相同景别**: 不能连续两个镜头都是"中景", 必须有景别变化
2. **禁止无意义运镜**: 每次运镜必须有叙事目的（推镜=压迫/关注, 拉镜=揭示/疏离）
3. **紧张段落景别必须收紧**: 如果剧情在升级, 景别必须从远→近→特写逐步收紧
4. **高潮后必须有喘息**: 最紧张的镜头之后, 必须给一个远景或空镜让观众"呼吸"
5. **第一个镜头必须抓眼球**: 用大远景建立世界观, 或用大特写制造悬念
6. **最后一个镜头必须留余韵**: 缓慢拉远/空镜/角色背影远去
7. **tensionLevel 必须形成曲线**: 不能一直高或一直低, 理想: 3→5→4→7→9→3`;
}

// ═══════════════════════════════════════════
// 统一分镜渲染提示词（增强版）
// ═══════════════════════════════════════════
export function getUnifiedStoryboardRenderPrompt(
  visualDesc: string,
  cameraAngle: string,
  lighting: string,
  colorTone: string,
  styleKeywords: string,
  characterNames: string[],
  characterAppearances?: Record<string, string>,
  sceneColorPalette?: string
): string {
  let prompt = `cinematic film frame, ${visualDesc}, camera angle: ${cameraAngle}, lighting: ${lighting}, color tone: ${colorTone}`;

  // Add character-specific appearance details for consistency
  if (characterAppearances && characterNames.length > 0) {
    const charDescs = characterNames
      .map(name => characterAppearances[name])
      .filter(Boolean)
      .join('; ');
    if (charDescs) {
      prompt += `, exact character appearances: ${charDescs}`;
    }
  }

  // Add scene color palette for visual consistency
  if (sceneColorPalette) {
    prompt += `, scene palette: ${sceneColorPalette}`;
  }

  prompt += `, ${styleKeywords}, consistent character design throughout, same art style, high detail, professional cinematography --ar 16:9 --s 250`;

  // Add character consistency weight
  if (characterNames.length > 0) {
    prompt += ` --cw 90`;
  }

  return prompt;
}

// ═══════════════════════════════════════════
// 一致性强化提示词（跨镜头角色/场景一致性）
// ═══════════════════════════════════════════
export function getConsistencyEnforcementPrompt(
  characters: Array<{ name: string; appearance: string; colorScheme?: string }>,
  scenes: Array<{ id: string; colorPalette?: string; location: string }>
): string {
  const charBlock = characters.map(c =>
    `- ${c.name}: ${c.appearance}${c.colorScheme ? ` | Colors: ${c.colorScheme}` : ''}`
  ).join('\n');

  const sceneBlock = scenes.map(s =>
    `- ${s.location}: ${s.colorPalette || 'default palette'}`
  ).join('\n');

  return `## CONSISTENCY REFERENCE SHEET (must match exactly in every frame)

### Characters (appearance MUST NOT change between shots):
${charBlock}

### Scene Color Palettes (maintain throughout):
${sceneBlock}

### Consistency Rules:
1. Character hair color, style, and length must be IDENTICAL across all shots
2. Character outfit details (buttons, emblems, accessories) must not change
3. Scene lighting direction must be consistent within the same location
4. Props that appear in one shot must look the same in other shots
5. Color grading must match the scene's declared palette`;
}

// ═══════════════════════════════════════════
// 配乐情绪映射（增强版 — 更多情绪 + 更精准风格）
// ═══════════════════════════════════════════
export function getMusicPromptForEmotion(emotion: string, genre: string): string {
  const emotionMap: Record<string, string> = {
    '庄严': 'epic orchestral, majestic brass fanfare, timpani rolls, grand cathedral reverb, slow 60bpm',
    '坚定': 'heroic theme, determined rising strings, snare drum march, building intensity, 100bpm',
    '紧张': 'suspenseful, staccato strings, low cello drone, heartbeat rhythm, ticking clock sound, dark 120bpm',
    '希望': 'uplifting, soaring violin melody over gentle piano arpeggios, warm major key, 80bpm',
    '悲伤': 'melancholic, solo piano in minor key, sustained cello, distant rain ambience, rubato tempo',
    '欢快': 'cheerful, playful pizzicato strings, light flute melody, bouncing rhythm, major key, 130bpm',
    '神秘': 'mysterious, ethereal synth pads, reversed piano notes, glass harmonica, whispered textures',
    '浪漫': 'romantic, gentle acoustic guitar duet with soft violin, warm reverb, intimate, 70bpm',
    '愤怒': 'aggressive, pounding war drums, distorted brass stabs, dissonant strings, 140bpm',
    '恐惧': 'horror, dark ambient drone, sudden silence then sharp stinger, detuned piano, infrasound',
    '孤独': 'lonely, solo erhu or solo piano, vast reverb suggesting empty space, sparse arrangement',
    '震撼': 'awe-inspiring, full orchestra crescendo, choir swell, massive sub bass, cinematic impact',
    '温馨': 'warm, acoustic guitar, soft marimba, gentle wind chimes, music box melody, 75bpm',
    '讽刺': 'darkly playful, music box melody over minor key strings, off-kilter rhythm, slightly detuned',
  };

  const genreMap: Record<string, string> = {
    '古装历史': 'Chinese traditional instruments, guzheng arpeggios, dizi flute, erhu melody, bamboo percussion',
    '赛博科幻': 'synthwave, analog synth bassline, arpeggiator sequences, cyberpunk, glitch elements, 808 sub',
    '奇幻冒险': 'fantasy orchestral, adventure theme, Celtic harp, epic choir, French horn melody',
    '现代剧情': 'contemporary, acoustic guitar fingerpicking, subtle piano, ambient textures, minimal',
    '悬疑推理': 'noir jazz, muted trumpet solo, walking bass, brushed snare, smoky atmosphere',
    '武侠': 'wuxia, xiao flute solo, guqin, zhongruan bass, martial percussion, flowing water sounds',
    '都市奇幻': 'urban fantasy, electronic beats mixed with orchestral, modern meets magical, trip-hop elements',
    '爱情': 'romantic, string quartet, gentle piano, acoustic warmth, intimate microphone placement',
    '喜剧': 'comedic, playful woodwinds, rubber bass, kazoo, whimsical percussion, cartoon timing',
    '恐怖': 'horror ambient, prepared piano, bowed metal, reverse sounds, silence as instrument',
  };

  const emotionStyle = emotionMap[emotion] || 'cinematic, emotional, orchestral';
  const genreStyle = genreMap[genre] || 'orchestral, cinematic score';

  return `${emotionStyle}, ${genreStyle}`;
}

// ═══════════════════════════════════════════
// 智能BGM匹配（多镜头情感曲线版）
// 分析全片情感弧度，生成与叙事结构匹配的精细音乐提示词
// ═══════════════════════════════════════════
export function getSmartBGMPrompt(
  emotionCurve: { shotNumber: number; emotion: string; temperature: number }[],
  genre: string,
  totalDuration: number
): string {
  if (!emotionCurve || emotionCurve.length === 0) {
    return getMusicPromptForEmotion('平静', genre);
  }

  // ── 1. 分析情感弧度 ──
  const temperatures = emotionCurve.map(e => e.temperature);
  const avgTemp = temperatures.reduce((a, b) => a + b, 0) / temperatures.length;
  const maxTemp = Math.max(...temperatures);
  const minTemp = Math.min(...temperatures);
  const tempRange = maxTemp - minTemp;

  // 找到情感峰值和谷值镜头
  const peakShot = emotionCurve.find(e => e.temperature === maxTemp);
  const valleyShot = emotionCurve.find(e => e.temperature === minTemp);

  // 确定主导情感（出现最多的情感）
  const emotionFrequency: Record<string, number> = {};
  for (const e of emotionCurve) {
    emotionFrequency[e.emotion] = (emotionFrequency[e.emotion] || 0) + 1;
  }
  const dominantEmotion = Object.entries(emotionFrequency)
    .sort((a, b) => b[1] - a[1])[0]?.[0] || '平静';

  // 确定开场情感（前25%镜头）
  const openingShots = emotionCurve.slice(0, Math.max(1, Math.floor(emotionCurve.length * 0.25)));
  const openingEmotion = openingShots[0]?.emotion || '平静';
  const openingTemp = openingShots.reduce((s, e) => s + e.temperature, 0) / openingShots.length;

  // 确定高潮情感（中间50%镜头）
  const middleStart = Math.floor(emotionCurve.length * 0.25);
  const middleEnd = Math.floor(emotionCurve.length * 0.75);
  const middleShots = emotionCurve.slice(middleStart, middleEnd);
  const climaxEmotion = middleShots.reduce(
    (best, e) => (Math.abs(e.temperature) > Math.abs(best.temperature) ? e : best),
    middleShots[0] || emotionCurve[0]
  )?.emotion || dominantEmotion;

  // 确定结尾情感（后25%镜头）
  const endingShots = emotionCurve.slice(Math.floor(emotionCurve.length * 0.75));
  const endingEmotion = endingShots[endingShots.length - 1]?.emotion || dominantEmotion;
  const endingTemp = endingShots.reduce((s, e) => s + e.temperature, 0) / Math.max(1, endingShots.length);

  // ── 2. BPM映射（基于情感强度） ──
  // temperature: -10 (绝望) → +10 (狂喜), abs越大情感越强
  const intensityBPM = (temp: number): number => {
    const intensity = Math.abs(temp);
    if (intensity <= 2) return 60;   // 平静
    if (intensity <= 4) return 75;   // 轻度情感
    if (intensity <= 6) return 95;   // 中度情感
    if (intensity <= 8) return 115;  // 强烈情感
    return 135;                       // 极度情感
  };

  const openingBPM = intensityBPM(openingTemp);
  const climaxIndex = peakShot ? emotionCurve.indexOf(peakShot) : Math.floor(emotionCurve.length / 2);
  const climaxProgress = Math.round((climaxIndex / Math.max(1, emotionCurve.length - 1)) * 100);
  const maxBPM = intensityBPM(maxTemp);
  const endingBPM = intensityBPM(
    endingShots.reduce((s, e) => s + e.temperature, 0) / Math.max(1, endingShots.length)
  );

  // ── 3. 类型乐器映射 ──
  const genreInstruments: Record<string, string> = {
    '古装历史': 'guzheng, erhu, dizi flute, pipa, Chinese percussion, bamboo flute',
    '赛博科幻': 'analog synthesizer, arpeggiator, 808 sub bass, electronic pads, glitch effects',
    '奇幻冒险': 'orchestral strings, French horn, Celtic harp, choir, epic brass',
    '现代剧情': 'acoustic guitar, piano, ambient strings, minimal electronics',
    '悬疑推理': 'muted piano, jazz bass, brushed snare, cello, prepared piano',
    '武侠': 'xiao flute, guqin, zhongruan, martial percussion, flowing strings',
    '都市奇幻': 'hybrid orchestra, electronic beats, strings, modern bass, magical textures',
    '爱情': 'acoustic guitar, string quartet, piano, soft woodwinds',
    '喜剧': 'playful woodwinds, pizzicato strings, marimba, light percussion',
    '恐怖': 'prepared piano, bowed metal, dark ambient, reverse sounds, low strings',
  };
  const instruments = genreInstruments[genre] || 'orchestral strings, piano, brass, percussion';

  // ── 4. 情感弧度文字描述 ──
  const arcDescription = emotionCurve
    .map(e => e.emotion)
    .join('→');

  // ── 5. 节奏变化描述 ──
  let tempoDescription: string;
  if (tempRange < 3) {
    // 情感变化小 → 匀速
    tempoDescription = `steady ${openingBPM}bpm throughout`;
  } else if (openingTemp < avgTemp && endingTemp < avgTemp) {
    // 开头结尾都低，中间高 → 加速后减速
    const endingTemp2 = endingShots.reduce((s, e) => s + e.temperature, 0) / Math.max(1, endingShots.length);
    tempoDescription = `starting at ${openingBPM}bpm, building to ${maxBPM}bpm at ${climaxProgress}% mark, then decelerating to ${intensityBPM(endingTemp2)}bpm for the ending`;
  } else if (temperatures[0] > avgTemp) {
    // 开头高，后面降 → 减速
    const endingTemp2 = endingShots.reduce((s, e) => s + e.temperature, 0) / Math.max(1, endingShots.length);
    tempoDescription = `opening at ${openingBPM}bpm, gradually decelerating to ${intensityBPM(endingTemp2)}bpm`;
  } else {
    // 通用：缓慢加速
    tempoDescription = `gradually accelerating from ${openingBPM}bpm to ${maxBPM}bpm`;
  }

  // ── 6. 动态处理建议 ──
  const dynamicNote = tempRange >= 6
    ? 'wide dynamic range from pp to fff, dramatic crescendos and sudden silences'
    : tempRange >= 3
    ? 'moderate dynamic variation, smooth crescendos and decrescendos'
    : 'consistent dynamics with subtle variations';

  // ── 7. 整合最终提示词 ──
  const openingStyle = getMusicPromptForEmotion(openingEmotion, genre).split(',')[0];
  const climaxStyle = getMusicPromptForEmotion(climaxEmotion, genre).split(',')[0];
  const endingStyle = getMusicPromptForEmotion(endingEmotion, genre).split(',')[0];

  const prompt = [
    `cinematic ${genre} score for ${Math.round(totalDuration)}s short film`,
    `instruments: ${instruments}`,
    `emotional arc: ${arcDescription}`,
    `opening (${openingStyle.trim()})`,
    `building through (${climaxStyle.trim()})`,
    `resolving to (${endingStyle.trim()})`,
    `tempo: ${tempoDescription}`,
    `dynamics: ${dynamicNote}`,
    `dominant mood: ${dominantEmotion}`,
    avgTemp > 3 ? 'overall uplifting and energetic' : avgTemp < -3 ? 'overall dark and melancholic' : 'balanced emotional journey',
    'high production quality, no vocals, seamless loop capable',
  ].join(', ');

  return prompt;
}

// ═══════════════════════════════════════════
// 输出质量验证 — 字数下限强制检查
// ═══════════════════════════════════════════

export interface ValidationResult {
  passed: boolean;
  issues: string[];
  fixInstructions: string;
}

/**
 * 验证 Director 输出的角色/场景描述是否达标
 */
export function validateDirectorOutput(plan: any): ValidationResult {
  const issues: string[] = [];

  if (plan.characters && Array.isArray(plan.characters)) {
    for (const char of plan.characters) {
      const name = char.name || '未知角色';
      const desc = char.description || '';
      const appearance = char.appearance || '';

      if (desc.length < 80) {
        issues.push(`角色"${name}"的description仅${desc.length}字，要求至少80字（需包含内在矛盾和行为动机）`);
      }
      if (appearance.split(/\s+/).length < 50) {
        issues.push(`角色"${name}"的appearance仅${appearance.split(/\s+/).length}个英文单词，要求至少50个`);
      }
      if (!char.visual?.colorScheme) {
        issues.push(`角色"${name}"缺少colorScheme配色方案`);
      }
      if (!char.paradox) {
        issues.push(`角色"${name}"缺少paradox内在悖论`);
      }
    }
  }

  if (plan.scenes && Array.isArray(plan.scenes)) {
    for (const scene of plan.scenes) {
      const loc = scene.location || '未知场景';
      const desc = scene.description || '';
      if (desc.length < 100) {
        issues.push(`场景"${loc}"的description仅${desc.length}字，要求至少100字（需整合五感描写）`);
      }
    }
  }

  const fixInstructions = issues.length > 0
    ? `以下字段未达标，请修改后重新输出完整JSON：\n${issues.map((iss, i) => `${i + 1}. ${iss}`).join('\n')}\n\n请直接输出修正后的完整JSON，不要省略任何字段。`
    : '';

  return { passed: issues.length === 0, issues, fixInstructions };
}

/**
 * 验证 Writer 输出的剧本是否达标
 */
export function validateWriterOutput(script: any): ValidationResult {
  const issues: string[] = [];

  const synopsis = script.synopsis || '';
  if (synopsis.length < 200) {
    issues.push(`synopsis仅${synopsis.length}字，要求200-400字（需包含三幕起承转合、角色动机、关键转折点）`);
  }

  if (script.shots && Array.isArray(script.shots)) {
    for (const shot of script.shots) {
      const num = shot.shotNumber || '?';

      const sceneDesc = shot.sceneDescription || '';
      if (sceneDesc.length < 120) {
        issues.push(`镜头${num}的sceneDescription仅${sceneDesc.length}字，要求120-250字（补充感官细节）`);
      }

      const visualPrompt = shot.visualPrompt || '';
      const wordCount = visualPrompt.split(/\s+/).filter(Boolean).length;
      if (wordCount < 60) {
        issues.push(`镜头${num}的visualPrompt仅${wordCount}个英文单词，要求60-120个`);
      }

      const action = shot.action || '';
      if (action.length < 20) {
        issues.push(`镜头${num}的action仅${action.length}字，要求至少20字（需包含肢体动作、表情、环境互动）`);
      }

      const dialogue = shot.dialogue || '';
      if (dialogue.length > 25) {
        issues.push(`镜头${num}的dialogue超过25字(${dialogue.length}字)，请精炼`);
      }
    }
  } else {
    issues.push('缺少shots数组');
  }

  // v2.8 追加:摄影语言软校验 — 只警告不阻塞,让 Writer 下一轮补齐 cinema 字段
  // 如果完全没输出 cinema 字段(老 prompt) 就一次性全量提示,否则只提关键缺失
  try {
    const cinemaReport = validateWriterCinematography(script);
    if (!cinemaReport.passed && cinemaReport.issues.length > 0) {
      // 取前 5 条关键缺失作为提示,避免提示词爆炸
      const top = cinemaReport.issues.slice(0, 5);
      issues.push(`[摄影语言] ${top.join('; ')}${cinemaReport.issues.length > 5 ? ` 等共 ${cinemaReport.issues.length} 项` : ''}`);
    }
  } catch {
    // 校验失败不影响主流程
  }

  const fixInstructions = issues.length > 0
    ? `以下字段未达标，请修改后重新输出完整JSON：\n${issues.map((iss, i) => `${i + 1}. ${iss}`).join('\n')}\n\n请直接输出修正后的完整JSON，不要省略任何字段。每个不达标的字段都必须扩充到要求的最低字数。`
    : '';

  return { passed: issues.length === 0, issues, fixInstructions };
}
