/**
 * lib/prompt-templates (v2.13.4)
 *
 * 用户输入 → 专业级提示词增强 (vague → specific cinematic guidance)。
 *
 * 不调 LLM (避免循环 + 成本),纯字符串拼接 + 规则启发式补全。
 * "增强"含义有限:
 *   - 把模糊"我想拍个浪漫故事" 变成 "现代都市言情短剧, 三幕结构, 16:9, 暖色调"
 *   - 把"强化视觉感" 变成"按镜头补充光源/色温/景别/材质质感, 不动情节结构"
 *   - 把"人物缓缓抬头" 变成"专业 I2V 镜头描述,加运镜/速度/情绪"
 *
 * 这些模板会拼到用户输入的尾部 (而不是替换),让 LLM 收到 "原始意图 + 专业改写指引"。
 */

// ════════════════════════════════════════════════════════════════════
// 创作主入口 — /dashboard/create idea 字段
// ════════════════════════════════════════════════════════════════════

export interface IdeaEnhancement {
  enhancedIdea: string;
  /** 给前端的 toast 提示用 */
  hint: string;
}

/**
 * 把用户的创意输入加固为"可拍的剧本骨架描述"。
 * 检测到的特征会反馈到 hint, 让用户知道我们在背后补了什么。
 */
export function enhanceIdeaForCreation(rawIdea: string): IdeaEnhancement {
  const idea = rawIdea.trim();
  const hints: string[] = [];

  // 太短(<25 字)→ 提醒用户:LLM 会自己补,但可能跟你想的不一样
  const isShort = idea.length < 25;
  if (isShort) hints.push('创意较简短,LLM 会自动展开三幕结构');

  // 检测题材关键词,显式标注
  const detectedGenres: string[] = [];
  if (/古装|宫|侠|剑|秦|唐|宋|明|清/.test(idea)) detectedGenres.push('古装');
  if (/赛博|未来|机甲|外星|太空|AI|科幻/.test(idea)) detectedGenres.push('科幻');
  if (/恋爱|偶遇|心动|表白|表黑/.test(idea)) detectedGenres.push('言情');
  if (/破案|悬疑|凶手|失踪|侦探/.test(idea)) detectedGenres.push('悬疑');
  if (/职场|公司|老板|创业|加班/.test(idea)) detectedGenres.push('职场');
  if (/校园|学生|高中|大学|宿舍/.test(idea)) detectedGenres.push('校园');
  if (/武侠|江湖|门派|内功|轻功/.test(idea)) detectedGenres.push('武侠');
  if (/恐怖|鬼|惊悚|血/.test(idea)) detectedGenres.push('惊悚');

  // 检测情绪基调
  const detectedMoods: string[] = [];
  if (/喜剧|搞笑|轻松|爆笑|沙雕/.test(idea)) detectedMoods.push('喜剧基调');
  if (/悲|哭|泪|绝望|心碎|遗憾/.test(idea)) detectedMoods.push('悲情基调');
  if (/温暖|治愈|温馨|甜/.test(idea)) detectedMoods.push('治愈基调');
  if (/紧张|危险|逃|追/.test(idea)) detectedMoods.push('紧张节奏');

  // 拼接增强后缀(给 LLM 用,不展示给前端)
  const suffix: string[] = [];
  suffix.push('\n\n── 制作要求 ──');
  suffix.push('1. 把上面的创意展开为 4-8 个镜头的短剧脚本');
  suffix.push('2. 三幕结构:激励事件 (15%) → 冲突升级 (60%) → 解决 (25%)');
  suffix.push('3. 每个镜头给出:场景/光源/色温/景别/角色行动/对白(可选)');
  if (detectedGenres.length === 0) {
    suffix.push('4. 题材:用户未指定,你判断最合适的(优先现代题材便于落地)');
  } else {
    suffix.push(`4. 题材锁定:${detectedGenres.join(' + ')}(用户已指定,严格遵守)`);
    hints.push(`已识别题材:${detectedGenres.join('/')}`);
  }
  if (detectedMoods.length > 0) {
    suffix.push(`5. 情绪基调:${detectedMoods.join('、')}`);
    hints.push(`基调:${detectedMoods.join('/')}`);
  } else {
    suffix.push('5. 情绪基调:从创意里推断,保持统一');
  }
  suffix.push('6. 角色 2-4 人,每人有清晰的视觉锚点(发型/服饰/性格关键词)');
  suffix.push('7. 全程影视化语言,避免小说式心理独白(改成行动 + 微表情)');

  return {
    enhancedIdea: idea + suffix.join('\n'),
    hint: hints.join(' · ') || '已用专业制作要求增强',
  };
}

// ════════════════════════════════════════════════════════════════════
// 润色额外要求 — /dashboard/polish "特别要求" 字段
// ════════════════════════════════════════════════════════════════════

/**
 * 把 "强化视觉感" / "把第三人称改成第一人称" 这种短指令,
 * 改写为对 LLM 更明确的"做什么/不做什么"清单。
 */
export function enhancePolishRequirement(rawReq: string): string {
  const req = rawReq.trim();
  if (!req) return '';

  const lower = req.toLowerCase();
  const enhanced: string[] = [];

  // 几个高频要求,显式扩成"做+不做"
  if (/视觉|画面|视像/.test(req)) {
    enhanced.push(
      '【视觉强化】每个镜头补充:光源方向 / 色温 / 关键质感 / 景别 / 摄影机角度。' +
        '不改情节、不删对白、不动场景顺序。',
    );
  }
  if (/(第三人称.*第一人称|第三.*第一)/.test(req)) {
    enhanced.push(
      '【人称改写】所有叙述句改为第一人称视角,角色对白保持原样。' +
        '心理活动用第一人称内心独白(可加 (OS) 标记)替代旁白。',
    );
  }
  if (/(第一人称.*第三人称|第一.*第三)/.test(req)) {
    enhanced.push(
      '【人称改写】所有第一人称叙述改为第三人称客观视角,内心独白改成行动+微表情外化。',
    );
  }
  if (/对白|台词|台词|对话/.test(req) && (/多|加|增|丰富|细腻/.test(req))) {
    enhanced.push(
      '【对白增强】每个有人在场的镜头至少有 1 句台词,潜文本优先(说一半留一半)。' +
        '不要把"行动描述"变成"角色解说"。',
    );
  }
  if (/紧凑|节奏|加快|提速|快节奏/.test(req)) {
    enhanced.push(
      '【节奏加快】合并低张力镜头, 砍掉解释性描述, 关键转折前 3 秒只用画面+音效不用对白。',
    );
  }
  if (/克制|冷|含蓄|内敛|留白/.test(req)) {
    enhanced.push(
      '【风格克制】删减形容词与情绪外化, 多用动作和环境细节暗示, 让观众自己解读。',
    );
  }

  // 没命中预设 → 把原文直接传给 LLM
  if (enhanced.length === 0) {
    return `用户特别要求:${req}\n注:严格执行此要求,但不允许改情节走向、不允许删核心对白。`;
  }

  return enhanced.join('\n\n') + `\n\n用户原文要求:${req}`;
}

// ════════════════════════════════════════════════════════════════════
// U2V 单图视频运动描述 — /dashboard/u2v
// ════════════════════════════════════════════════════════════════════

/**
 * 用户写"人物缓缓抬头"  → 专业 I2V 描述加运镜词汇 + 速度提示。
 */
export function enhanceU2VMotionPrompt(rawPrompt: string): string {
  const prompt = rawPrompt.trim();
  if (!prompt) return '';

  const additions: string[] = [];

  // 检测是否已有专业运镜词
  const hasCameraTerm = /push.in|pull.out|pan|tilt|zoom|dolly|crane|tracking|静止|推近|拉远|摇|平移|跟拍/i.test(prompt);
  if (!hasCameraTerm) {
    additions.push('Camera: subtle slow push-in (5% zoom over duration).');
  }

  // 检测速度词
  const hasSpeedTerm = /slow|fast|gradual|sudden|缓|快|慢|突然|渐|平稳/.test(prompt);
  if (!hasSpeedTerm) {
    additions.push('Speed: smooth, no jitter, ease-in-out.');
  }

  // 加情绪基调引导(I2V 模型对 mood 词敏感)
  additions.push('Maintain photographic realism, preserve original lighting and color palette of the input image.');
  additions.push('Avoid:morphing artifacts, face distortion, hand mutation.');

  return prompt + '\n\n' + additions.join(' ');
}

// ════════════════════════════════════════════════════════════════════
// Agent chat — 项目页右侧聊天栏发的消息
// ════════════════════════════════════════════════════════════════════

/**
 * 给 LLM 加上 "你现在在跟用户聊一个具体项目" 的上下文,
 * 防止用户用聊天框做"通用助手"。
 */
export function enhanceChatMessage(rawMessage: string, projectTitle?: string): string {
  const msg = rawMessage.trim();
  if (!msg) return '';
  const ctx = projectTitle
    ? `[项目上下文] 用户当前在项目「${projectTitle}」的工作面板里发问。`
    : `[项目上下文] 用户在 Wind Comic 创作工坊里发问。`;
  return `${ctx} 请仅回答与该项目剧本/角色/分镜/视频相关的问题, 其他闲聊礼貌引导回创作。\n\n用户:${msg}`;
}
