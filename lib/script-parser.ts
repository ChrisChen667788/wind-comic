/**
 * 剧本解析器 v1.0
 * 将真实的剧本文本（△画面、角色对白、场景标注等）
 * 解析为结构化的 ParsedScript，供 Director/Writer 阶段使用
 *
 * 支持的剧本格式：
 * - 章节标记：第X章
 * - 场景标记：X-X场景名 时间
 * - 画面描述：△画面：...
 * - 角色对白：角色名：对白
 * - 内心独白：角色名（OS）：...
 * - 注释/备注：行内标注
 */

// ═══════════════════════════════════════
// 类型定义
// ═══════════════════════════════════════

export interface ParsedCharacter {
  name: string;
  dialogueCount: number;
  firstAppearance: string;      // 角色首次出现的场景
  sampleDialogues: string[];    // 代表性台词（最多5句）
  internalMonologues: string[]; // OS独白（最多3段）
  descriptionHints: string[];   // 从剧本中提取的外貌/性格描述线索
  relationships: string[];      // 与其他角色的关系线索
}

export interface ParsedScene {
  id: string;              // 例如 "1-1"
  location: string;        // 场景地点
  timeOfDay: string;       // 日/夜/晨/昏
  chapter: number;
  actions: string[];       // △画面描述列表
  dialogues: Array<{
    character: string;
    line: string;
    isOS: boolean;         // 是否为内心独白
  }>;
  characters: string[];    // 本场景出场角色
  emotionalArc: string;    // 推断的情感走向
}

export interface ParsedScript {
  /** 原始文本 */
  rawText: string;
  /** 检测到的总章节数 */
  totalChapters: number;
  /** 所有解析出的场景 */
  scenes: ParsedScene[];
  /** 所有检测到的角色 */
  characters: ParsedCharacter[];
  /** 故事主线摘要（基于关键情节） */
  plotSummary: string;
  /** 检测到的类型标签 */
  genreHints: string[];
  /** 是否为完整剧本格式（vs 简短创意） */
  isFullScript: boolean;
  /** 总字数统计 */
  stats: {
    totalChars: number;
    dialogueCount: number;
    actionCount: number;
    sceneCount: number;
    characterCount: number;
  };
}

// ═══════════════════════════════════════
// 核心解析函数
// ═══════════════════════════════════════

/**
 * 判断用户输入是否为完整剧本（vs 简短创意描述）
 * 判断标准：
 * 1. 超过200字
 * 2. 包含场景标记（第X章 或 X-X场景名）
 * 3. 包含对白格式（角色名：对白）
 * 4. 包含画面描述（△画面）
 */
export function isFullScriptInput(text: string): boolean {
  // 短文本不可能是剧本
  if (text.length < 150) return false;

  // 多维度信号检测
  const hasChapterMark = /第\d+[章集幕]/.test(text);
  const hasSceneMark = /\d+-\d+\s*\S+\s*(日|夜|晨|昏|黄昏|拂晓|清晨|深夜|白天|夜晚|傍晚|凌晨)/.test(text);
  const hasSceneMarkAlt = /(?:场景|第)\s*[\d一二三四五六七八九十]+\s*[：:场]?\s*\S+/.test(text);
  const hasSceneMarkIntExt = /(?:INT|EXT|内|外|内\/外)[.\s]+.+(?:——|-–)\s*(?:日|夜|DAY|NIGHT)/i.test(text);
  const hasDialogue = /[\u4e00-\u9fa5a-zA-Z]{1,20}[：:].{2,}/m.test(text);
  const hasMultipleDialogues = (text.match(/[\u4e00-\u9fa5]{1,15}[：:].{2,}/gm) || []).length >= 3;
  const hasAction = /△|画面[：:]/.test(text);
  const hasOSMark = /[（(]\s*OS\s*[）)]/.test(text);

  // 强信号:出现明确剧本结构标记之一 → 一票通过
  if (hasChapterMark || hasSceneMark || hasSceneMarkAlt || hasSceneMarkIntExt) return true;
  if (hasAction || hasOSMark) return true;

  // 弱信号组合:仅当"多对白行(≥4) + 长文本(≥800)"才算剧本
  // 单纯 hasDialogue 不够,防止"小说+引述"误判
  if (hasMultipleDialogues && text.length > 800) return true;

  return false;
}

/**
 * 主解析入口：将剧本文本解析为结构化数据
 */
export function parseScript(rawText: string): ParsedScript {
  const lines = rawText.split(/\n/).map(l => l.trim()).filter(Boolean);

  // Step 1: 检测章节
  const chapters = detectChapters(lines);
  const totalChapters = chapters.length || 1;

  // Step 2: 解析场景
  const scenes = parseScenes(lines);

  // Step 3: 提取角色信息
  const characters = extractCharacters(lines, scenes);

  // Step 4: 推断类型
  const genreHints = detectGenre(rawText);

  // Step 5: 生成情节摘要
  const plotSummary = generatePlotSummary(scenes, characters);

  // Step 6: 统计
  const dialogueCount = scenes.reduce((sum, s) => sum + s.dialogues.length, 0);
  const actionCount = scenes.reduce((sum, s) => sum + s.actions.length, 0);

  return {
    rawText,
    totalChapters,
    scenes,
    characters,
    plotSummary,
    genreHints,
    isFullScript: true,
    stats: {
      totalChars: rawText.length,
      dialogueCount,
      actionCount,
      sceneCount: scenes.length,
      characterCount: characters.length,
    },
  };
}

// ═══════════════════════════════════════
// 内部解析工具函数
// ═══════════════════════════════════════

function detectChapters(lines: string[]): { chapter: number; lineIndex: number }[] {
  const chapters: { chapter: number; lineIndex: number }[] = [];
  for (let i = 0; i < lines.length; i++) {
    const match = lines[i].match(/第(\d+)章/);
    if (match) {
      chapters.push({ chapter: parseInt(match[1]), lineIndex: i });
    }
  }
  return chapters;
}

function parseScenes(lines: string[]): ParsedScene[] {
  const scenes: ParsedScene[] = [];
  let currentChapter = 1;
  let currentScene: ParsedScene | null = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // 检测章节变化
    const chapterMatch = line.match(/第(\d+)章/);
    if (chapterMatch) {
      currentChapter = parseInt(chapterMatch[1]);
      continue;
    }

    // 检测场景标头（多种格式兼容）:
    //   "1-1院子 日" / "3-1河边  夜"
    //   "第4-1场 院子 夜" / "第4-1场  院子  夜"（用户实际格式）
    //   "场景一：办公室 白天" / "场景1: 河边 夜晚"
    //   "第1场：客厅 日" / "EXT. PARK - DAY"
    //   "INT. 办公室 - 日" / "内 起居室——夜"
    const TIME_PATTERN = '日|夜|晨|昏|黄昏|拂晓|清晨|深夜|正午|白天|夜晚|傍晚|凌晨';
    const sceneMatch = line.match(new RegExp(`^(\\d+-\\d+)\\s*(\\S+?)\\s+(${TIME_PATTERN})\\s*$`))
      // 新增：匹配 "第X-X场 场景名 时间" 格式 (用户实际使用的格式)
      || line.match(new RegExp(`^第\\s*(\\d+-\\d+)\\s*场?\\s+(\\S+?)\\s+(${TIME_PATTERN})\\s*$`))
      // 新增：匹配 "第X场 场景名 时间" 格式
      || line.match(new RegExp(`^第\\s*(\\d+)\\s*场\\s+(\\S+?)\\s+(${TIME_PATTERN})\\s*$`))
      // 原有：匹配 "场景X：场景名 时间" / "第X场：场景名 时间" 等
      || line.match(new RegExp(`^(?:场景|第)\\s*[\\d一二三四五六七八九十]+\\s*[：:场]?\\s*(\\S+?)\\s+(${TIME_PATTERN})\\s*$`))
      // 原有：匹配 INT/EXT 格式
      || line.match(new RegExp(`^(?:INT|EXT|内|外|内\\/外)[.\\s]+(.+?)(?:——|-–)\\s*(${TIME_PATTERN}|DAY|NIGHT)\\s*$`, 'i'));
    if (sceneMatch) {
      // 统一提取: 场景ID、场景名、时间
      const matchGroups = sceneMatch.filter(Boolean);
      const sceneId = matchGroups[1]?.includes('-') ? matchGroups[1] : `${currentChapter}-${scenes.length + 1}`;
      const sceneName = matchGroups[1]?.includes('-') ? (matchGroups[2] || '未命名') : (matchGroups[1] || '未命名');
      const timeOfDay = (matchGroups[matchGroups.length - 1] || '日').replace(/DAY/i, '日').replace(/NIGHT/i, '夜');
      // 保存前一个场景
      if (currentScene) {
        currentScene.emotionalArc = inferEmotionalArc(currentScene);
        currentScene.characters = [...new Set(currentScene.dialogues.map(d => d.character))];
        scenes.push(currentScene);
      }
      currentScene = {
        id: sceneId,
        location: sceneName,
        timeOfDay: timeOfDay,
        chapter: currentChapter,
        actions: [],
        dialogues: [],
        characters: [],
        emotionalArc: '',
      };
      continue;
    }

    // 隐式场景边界检测：当遇到新的 △画面 描述且包含明显的场所变化时，创建新场景
    if (currentScene && line.startsWith('△')) {
      const locationPatterns = /(?:来到|走进|走到|进入|回到|站在|坐在|躺在|蹲在)(?:了)?(.{1,10}?(?:里|中|前|旁|边|上|下|内|外|处|门口|窗前))/;
      const locMatch = line.match(locationPatterns);
      if (locMatch && currentScene.dialogues.length > 0) {
        // 当前场景已有对话，且出现新场所 → 视为新场景
        currentScene.emotionalArc = inferEmotionalArc(currentScene);
        currentScene.characters = [...new Set(currentScene.dialogues.map(d => d.character))];
        scenes.push(currentScene);
        currentScene = {
          id: `${currentChapter}-${scenes.length + 1}`,
          location: locMatch[1] || '未标注',
          timeOfDay: currentScene.timeOfDay, // 继承上个场景的时间
          chapter: currentChapter,
          actions: [],
          dialogues: [],
          characters: [],
          emotionalArc: '',
        };
      }
    }

    // 如果还没有检测到场景标头，尝试从章节号推断
    if (!currentScene && (line.startsWith('△') || /[\u4e00-\u9fa5]{1,8}[（(]?OS[）)]?[：:]/.test(line) || /[\u4e00-\u9fa5]{1,8}[：:]/.test(line))) {
      currentScene = {
        id: `${currentChapter}-1`,
        location: '未标注',
        timeOfDay: '日',
        chapter: currentChapter,
        actions: [],
        dialogues: [],
        characters: [],
        emotionalArc: '',
      };
    }

    if (!currentScene) continue;

    // 解析 △画面 描述
    const actionMatch = line.match(/^[△▽]?\s*画面[：:]\s*(.+)$/);
    if (actionMatch) {
      currentScene.actions.push(actionMatch[1].trim());
      continue;
    }
    // 也匹配单独的 △ 开头
    if (line.startsWith('△')) {
      const actionText = line.replace(/^△\s*/, '').replace(/^画面[：:]\s*/, '');
      if (actionText.length > 2) {
        currentScene.actions.push(actionText);
      }
      continue;
    }

    // 解析 角色对白（含OS内心独白）— 支持更长名字和混合语言
    const osMatch = line.match(/^([\u4e00-\u9fa5a-zA-Z0-9·]{1,20})\s*[（(]\s*OS\s*[）)]\s*[：:]\s*(.+)$/);
    if (osMatch) {
      currentScene.dialogues.push({
        character: osMatch[1],
        line: osMatch[2].trim(),
        isOS: true,
      });
      continue;
    }

    // 普通对白 — 支持更长名字和混合语言名字
    const dialogueMatch = line.match(/^([\u4e00-\u9fa5a-zA-Z0-9·]{1,20})\s*[：:]\s*(.+)$/);
    if (dialogueMatch) {
      // 排除一些可能不是角色名的情况
      const possibleName = dialogueMatch[1];
      if (!['画面', '注意', '备注', '提示', '说明', '关键点', '重点'].includes(possibleName)) {
        currentScene.dialogues.push({
          character: possibleName,
          line: dialogueMatch[2].trim(),
          isOS: false,
        });
      }
      continue;
    }
  }

  // 保存最后一个场景
  if (currentScene) {
    currentScene.emotionalArc = inferEmotionalArc(currentScene);
    currentScene.characters = [...new Set(currentScene.dialogues.map(d => d.character))];
    scenes.push(currentScene);
  }

  // ── 隐式场景分裂：如果只检测到 1 个场景但内容很长，按内容边界自动拆分 ──
  if (scenes.length <= 1 && lines.length > 30) {
    const splitScenes = splitImplicitScenes(scenes[0] || null, lines);
    if (splitScenes.length > scenes.length) {
      return splitScenes;
    }
  }

  return scenes;
}

/**
 * 隐式场景边界检测
 * 当显式场景标头解析只得到 0-1 个场景时，尝试按以下规则拆分：
 * 1. △画面 标记作为场景分界点（每个 △画面 开启一个新的叙事段落）
 * 2. 连续空行 + 新对白角色组合 变化
 * 3. 文本长度超过阈值时按对话轮次均匀切分
 */
function splitImplicitScenes(
  singleScene: ParsedScene | null,
  lines: string[]
): ParsedScene[] {
  // 策略 1: 按 △画面 标记分裂
  const actionIndices: number[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (/^[△▽]\s*画面[：:]/.test(lines[i]) || /^△/.test(lines[i])) {
      actionIndices.push(i);
    }
  }

  // 如果有多个 △画面，以每个 △画面 作为新场景的起点
  if (actionIndices.length >= 2) {
    const scenes: ParsedScene[] = [];
    for (let seg = 0; seg < actionIndices.length; seg++) {
      const startIdx = actionIndices[seg];
      const endIdx = seg < actionIndices.length - 1 ? actionIndices[seg + 1] : lines.length;
      const segLines = lines.slice(startIdx, endIdx);

      const scene: ParsedScene = {
        id: `1-${seg + 1}`,
        location: extractLocationFromAction(segLines[0]) || `场景${seg + 1}`,
        timeOfDay: '日',
        chapter: 1,
        actions: [],
        dialogues: [],
        characters: [],
        emotionalArc: '',
      };

      for (const line of segLines) {
        // 解析 △画面
        const actionMatch = line.match(/^[△▽]\s*画面[：:]\s*(.+)$/);
        if (actionMatch) {
          scene.actions.push(actionMatch[1].trim());
          continue;
        }
        if (line.startsWith('△')) {
          const actionText = line.replace(/^△\s*/, '').replace(/^画面[：:]\s*/, '');
          if (actionText.length > 2) scene.actions.push(actionText);
          continue;
        }
        // 解析对白
        const osMatch = line.match(/^([\u4e00-\u9fa5a-zA-Z0-9·]{1,20})\s*[（(]\s*OS\s*[）)]\s*[：:]\s*(.+)$/);
        if (osMatch) {
          scene.dialogues.push({ character: osMatch[1], line: osMatch[2].trim(), isOS: true });
          continue;
        }
        const dialogueMatch = line.match(/^([\u4e00-\u9fa5a-zA-Z0-9·]{1,20})\s*[：:]\s*(.+)$/);
        if (dialogueMatch) {
          const possibleName = dialogueMatch[1];
          if (!['画面', '注意', '备注', '提示', '说明', '关键点', '重点'].includes(possibleName)) {
            scene.dialogues.push({ character: possibleName, line: dialogueMatch[2].trim(), isOS: false });
          }
        }
      }

      scene.characters = [...new Set(scene.dialogues.map(d => d.character))];
      scene.emotionalArc = inferEmotionalArc(scene);
      scenes.push(scene);
    }
    return scenes;
  }

  // 策略 2: 按对白角色组合变化分裂（当角色阵容发生大幅变化时视为新场景）
  if (singleScene && singleScene.dialogues.length >= 8) {
    const dialogues = singleScene.dialogues;
    const scenes: ParsedScene[] = [];
    let segStart = 0;

    for (let i = 3; i < dialogues.length; i++) {
      // 检查前3句和后3句的角色交集
      const prevChars = new Set(dialogues.slice(Math.max(0, i - 3), i).map(d => d.character));
      const nextChars = new Set(dialogues.slice(i, Math.min(dialogues.length, i + 3)).map(d => d.character));
      const overlap = [...prevChars].filter(c => nextChars.has(c)).length;
      const totalUnique = new Set([...prevChars, ...nextChars]).size;

      // 角色完全变化（交集为 0 或交集 < 总数的 30%）= 新场景
      if (totalUnique >= 2 && overlap / totalUnique < 0.3) {
        const segDialogues = dialogues.slice(segStart, i);
        const segActions = singleScene.actions.filter((_, ai) => ai >= segStart && ai < i);
        scenes.push({
          id: `1-${scenes.length + 1}`,
          location: singleScene.location || `段落${scenes.length + 1}`,
          timeOfDay: singleScene.timeOfDay,
          chapter: 1,
          actions: segActions.length > 0 ? segActions : singleScene.actions.slice(scenes.length, scenes.length + 1),
          dialogues: segDialogues,
          characters: [...new Set(segDialogues.map(d => d.character))],
          emotionalArc: '',
        });
        segStart = i;
      }
    }

    // 剩余部分
    if (segStart > 0) {
      const segDialogues = dialogues.slice(segStart);
      scenes.push({
        id: `1-${scenes.length + 1}`,
        location: singleScene.location || `段落${scenes.length + 1}`,
        timeOfDay: singleScene.timeOfDay,
        chapter: 1,
        actions: singleScene.actions.slice(scenes.length),
        dialogues: segDialogues,
        characters: [...new Set(segDialogues.map(d => d.character))],
        emotionalArc: '',
      });
      // 回填 emotionalArc
      for (const s of scenes) s.emotionalArc = inferEmotionalArc(s);
      return scenes;
    }
  }

  // 策略 3: 按文本量均匀切分（最后手段，确保至少产生多个段落）
  if (singleScene && (singleScene.dialogues.length >= 6 || singleScene.actions.length >= 4)) {
    const totalItems = singleScene.dialogues.length + singleScene.actions.length;
    const targetSceneCount = Math.max(2, Math.min(Math.ceil(totalItems / 5), 8));
    const itemsPerScene = Math.ceil(singleScene.dialogues.length / targetSceneCount);

    if (itemsPerScene >= 2) {
      const scenes: ParsedScene[] = [];
      for (let s = 0; s < targetSceneCount; s++) {
        const segDialogues = singleScene.dialogues.slice(s * itemsPerScene, (s + 1) * itemsPerScene);
        if (segDialogues.length === 0) break;
        const actionSlice = singleScene.actions.slice(
          Math.floor(s * singleScene.actions.length / targetSceneCount),
          Math.floor((s + 1) * singleScene.actions.length / targetSceneCount)
        );
        scenes.push({
          id: `1-${s + 1}`,
          location: singleScene.location || `段落${s + 1}`,
          timeOfDay: singleScene.timeOfDay,
          chapter: 1,
          actions: actionSlice.length > 0 ? actionSlice : [],
          dialogues: segDialogues,
          characters: [...new Set(segDialogues.map(d => d.character))],
          emotionalArc: inferEmotionalArc({ actions: actionSlice, dialogues: segDialogues } as ParsedScene),
        });
      }
      if (scenes.length > 1) return scenes;
    }
  }

  return singleScene ? [singleScene] : [];
}

/** 从 △画面 行中提取可能的地点名称 */
function extractLocationFromAction(line: string): string {
  const cleanedLine = line.replace(/^[△▽]\s*(画面[：:])?\s*/, '');
  // 尝试匹配 "在XX中/里/上" 或 "XX（时间）" 等模式
  const locMatch = cleanedLine.match(/(?:在|来到|走进|进入|站在|坐在)\s*([\u4e00-\u9fa5]{2,6})/);
  if (locMatch) return locMatch[1];
  // 尝试匹配括号中的地点 "院子（夜）"
  const bracketMatch = cleanedLine.match(/([\u4e00-\u9fa5]{2,6})\s*[（(]/);
  if (bracketMatch) return bracketMatch[1];
  // 取前几个字作为地点
  const words = cleanedLine.slice(0, 10).replace(/[，。！？、；：""''（）]/g, ' ').trim().split(/\s+/);
  return words[0]?.length >= 2 ? words[0] : '';
}

function extractCharacters(lines: string[], scenes: ParsedScene[]): ParsedCharacter[] {
  const charMap = new Map<string, ParsedCharacter>();

  for (const scene of scenes) {
    for (const dialogue of scene.dialogues) {
      const name = dialogue.character;
      if (!charMap.has(name)) {
        charMap.set(name, {
          name,
          dialogueCount: 0,
          firstAppearance: `${scene.id} ${scene.location}`,
          sampleDialogues: [],
          internalMonologues: [],
          descriptionHints: [],
          relationships: [],
        });
      }
      const char = charMap.get(name)!;
      char.dialogueCount++;

      if (dialogue.isOS) {
        if (char.internalMonologues.length < 3) {
          char.internalMonologues.push(dialogue.line);
        }
      } else {
        if (char.sampleDialogues.length < 5) {
          char.sampleDialogues.push(dialogue.line);
        }
      }
    }
  }

  // 从画面描述中提取角色描述线索
  const allActions = scenes.flatMap(s => s.actions).join(' ');
  for (const [name, char] of charMap) {
    // 外貌描述
    const appearancePatterns = [
      new RegExp(`${name}[^，。]*(?:身高|身材|长相|脸|眼|皮肤|头发|穿|戴|长得)[^。]*`, 'g'),
      new RegExp(`(?:身高|身材|长相|脸|眼|皮肤|头发|穿|戴|长得)[^。]*${name}[^。]*`, 'g'),
    ];
    for (const pattern of appearancePatterns) {
      const matches = allActions.match(pattern);
      if (matches) {
        char.descriptionHints.push(...matches.slice(0, 3));
      }
    }

    // 性格/关系线索
    const relPatterns = [
      new RegExp(`${name}[^。]{0,20}(嫂子|妻子|丈夫|兄弟|姐妹|父亲|母亲|朋友|敌人|对手|师傅|徒弟)`, 'g'),
      new RegExp(`(嫂子|妻子|丈夫|兄弟|姐妹|父亲|母亲|朋友|敌人|对手|师傅|徒弟)[^。]{0,20}${name}`, 'g'),
    ];
    for (const pattern of relPatterns) {
      const matches = allActions.match(pattern);
      if (matches) {
        char.relationships.push(...matches.slice(0, 3));
      }
    }
  }

  // 也从原始文本中搜索角色描述（如剧本末尾的注释区域）
  const fullText = lines.join('\n');
  for (const [name, char] of charMap) {
    // 搜索如 "30岁的美丽女子，身高170厘米..." 这类描述
    const detailPattern = new RegExp(`${name}[^]*?(\\d{2,3}岁[^。]*(?:身高|头发|眼睛|嘴巴|身材|服饰)[^。]{20,})`, 'g');
    const detailMatch = detailPattern.exec(fullText);
    if (detailMatch) {
      char.descriptionHints.push(detailMatch[1]);
    }
  }

  // 按台词数排序，主角一般台词最多
  return Array.from(charMap.values()).sort((a, b) => b.dialogueCount - a.dialogueCount);
}

function inferEmotionalArc(scene: ParsedScene): string {
  const allText = [...scene.actions, ...scene.dialogues.map(d => d.line)].join(' ');

  const emotionKeywords: [string, string[]][] = [
    ['悲伤', ['哭', '泪', '难过', '伤心', '痛苦', '绝望', '失落']],
    ['愤怒', ['怒', '气', '恨', '杀', '打', '骂', '畜生', '混蛋']],
    ['温暖', ['温柔', '感动', '照顾', '关心', '温暖', '笑', '幸福']],
    ['紧张', ['紧张', '害怕', '危险', '追', '逃', '慌']],
    ['希望', ['希望', '相信', '坚持', '勇敢', '站起', '决心']],
    ['诡异', ['诡', '怪', '神秘', '梦境', '幻觉', '古怪']],
    ['搞笑', ['笑', '傻', '搞笑', '好笑', '嘻嘻']],
    ['浪漫', ['心动', '爱', '吸引', '脸红', '美丽', '动人']],
  ];

  const scores = emotionKeywords.map(([emotion, keywords]) => {
    const score = keywords.reduce((sum, kw) => {
      const regex = new RegExp(kw, 'g');
      return sum + (allText.match(regex)?.length || 0);
    }, 0);
    return { emotion, score };
  });

  scores.sort((a, b) => b.score - a.score);
  const top = scores.filter(s => s.score > 0).slice(0, 2);
  if (top.length === 0) return '平静';
  return top.map(t => t.emotion).join('→');
}

function detectGenre(text: string): string[] {
  const genres: string[] = [];

  if (/古|朝|宫|侠|武|仙|修炼|灵气|道袍|剑|内功/.test(text)) genres.push('古装仙侠');
  if (/赛博|科幻|未来|AI|机器人|太空/.test(text)) genres.push('赛博科幻');
  if (/爱|恋|心动|表白|相爱|嫁|娶/.test(text)) genres.push('爱情');
  if (/杀|死|案|凶|悬疑|推理|证据/.test(text)) genres.push('悬疑');
  if (/穿越|重生|系统|金手指|觉醒/.test(text)) genres.push('穿越重生');
  if (/逆袭|打脸|反杀|碾压|装逼/.test(text)) genres.push('爽文');
  if (/傻子|废物|看不起|嘲笑|底层/.test(text)) genres.push('逆袭翻身');
  if (/村|农|田|庄|乡/.test(text)) genres.push('乡村');
  if (/总裁|公司|商业|豪门/.test(text)) genres.push('都市');
  if (/嫂子|寡妇|暧昧|调戏/.test(text)) genres.push('擦边暧昧');

  return genres.length > 0 ? genres : ['现代剧情'];
}

function generatePlotSummary(scenes: ParsedScene[], characters: ParsedCharacter[]): string {
  if (scenes.length === 0) return '无法解析剧情。';

  const mainChars = characters.slice(0, 3).map(c => c.name);
  const sceneDescs = scenes.map(s => {
    const actions = s.actions.slice(0, 2).join('；');
    return `[${s.id}${s.location}] ${actions}`;
  });

  return `主要角色：${mainChars.join('、')}。剧情概要：${sceneDescs.join(' → ')}`;
}

// ═══════════════════════════════════════
// 将 ParsedScript 转为 Director/Writer 可用的结构化提示
// ═══════════════════════════════════════

/**
 * 生成给 Director 的剧本分析摘要
 * Director 需要据此设定角色外观、场景视觉、故事结构
 */
export function getDirectorScriptContext(parsed: ParsedScript): string {
  // 不再截断角色和场景 — 全部提供给 Director，让 LLM 自行取舍
  const charSection = parsed.characters.map(c => {
    const dialogueSample = c.sampleDialogues.slice(0, 3).map(d => `"${d}"`).join(' / ');
    const osSample = c.internalMonologues.length > 0 ? `内心独白: "${c.internalMonologues[0]}"` : '';
    const desc = c.descriptionHints.length > 0 ? `外貌线索: ${c.descriptionHints.join('；')}` : '';
    return `- ${c.name} (台词${c.dialogueCount}句, 首次出场: ${c.firstAppearance})
  ${dialogueSample ? '代表台词: ' + dialogueSample : ''}
  ${osSample}
  ${desc}
  ${c.relationships.length > 0 ? '关系: ' + c.relationships.join('；') : ''}`.trim();
  }).join('\n\n');

  const sceneSection = parsed.scenes.map(s =>
    `- [${s.id}] ${s.location} (${s.timeOfDay}) — 角色: ${s.characters.join('、')} | 情绪: ${s.emotionalArc}
  动作: ${s.actions.slice(0, 3).join('；')}`
  ).join('\n');

  // 截取原始剧本文本给 Director 参考（最多 5000 字符）
  const rawExcerpt = parsed.rawText.length > 5000
    ? parsed.rawText.slice(0, 5000) + '\n...（后续内容省略）'
    : parsed.rawText;

  return `
═══ 用户提供的原始剧本 ═══

${rawExcerpt}

═══ 剧本解析结果 ═══

【统计】${parsed.stats.sceneCount}个场景, ${parsed.stats.characterCount}个角色, ${parsed.stats.dialogueCount}句台词, ${parsed.stats.actionCount}段画面描述
【类型推断】${parsed.genreHints.join(' / ')}
【章节数】共${parsed.totalChapters}章

【角色列表（从剧本中提取，你必须为每个角色设计外观）】
${charSection}

【场景列表（从剧本中提取，你必须为每个场景设计视觉方案）】
${sceneSection}

【剧情脉络】
${parsed.plotSummary}

═══ 导演任务（最高优先级：忠于原始剧本！）═══

你的工作是为这部**已有剧本**设计视觉方案，不是从零创作！

1. 为剧本中的**每一个有台词的角色**设计详细的视觉外观（整合剧本中的外貌线索、性格特征、说话风格），角色数量由剧本决定（${parsed.stats.characterCount}个角色），不可随意增减
2. 为剧本中的**每一个出现的场景**设计视觉方案（光影、氛围、建筑、天气、声音、气味），场景数量由剧本决定（${parsed.stats.sceneCount}个场景）
3. 确定整体视觉风格和色调
4. 设计故事结构 — 从剧本所有场景中选取最有视觉冲击力的关键镜头

⚠️ 严禁行为：
- 严禁编造原剧本中不存在的角色
- 严禁改变角色之间的关系
- 严禁忽略剧本中明确提到的外貌描写线索（如"婀娜曼妙"、"美眸"、"魁梧"等）
- 严禁将多个场景合并或遗漏场景
- 严禁修改核心剧情走向
`;
}

/**
 * 生成给 Writer 的剧本转换上下文
 * Writer 需要据此将剧本转为标准的 shots JSON
 */
export function getWriterScriptContext(parsed: ParsedScript): string {
  // 给 Writer 提供完整的场景和对白数据
  const sceneDetails = parsed.scenes.map(s => {
    const dialogueBlock = s.dialogues.map(d =>
      `  ${d.character}${d.isOS ? '(OS)' : ''}：${d.line}`
    ).join('\n');
    const actionBlock = s.actions.map(a => `  △ ${a}`).join('\n');

    return `【场景 ${s.id}: ${s.location} (${s.timeOfDay})】情绪走向: ${s.emotionalArc}
${actionBlock}
${dialogueBlock}`;
  }).join('\n\n');

  // 截取原始剧本文本（最多 8000 字符），确保 Writer 能看到解析器遗漏的内容
  const rawTextExcerpt = parsed.rawText.length > 8000
    ? parsed.rawText.slice(0, 8000) + '\n\n...（剧本过长，已截取前8000字）'
    : parsed.rawText;

  // 提取原剧本的所有角色对白，作为对照检查清单
  const dialogueChecklist = parsed.scenes.flatMap(s =>
    s.dialogues.filter(d => !d.isOS).slice(0, 3).map(d => `${d.character}："${d.line}"`)
  ).slice(0, 30).join('\n');

  // 提取关键情节点
  const keyPlotPoints = parsed.scenes.map(s => {
    const keyAction = s.actions[0] || '';
    const keyDialogue = s.dialogues[0] ? `${s.dialogues[0].character}："${s.dialogues[0].line}"` : '';
    return `[${s.id} ${s.location}] ${keyAction} ${keyDialogue}`;
  }).join('\n');

  return `
🚨🚨🚨 最高优先级：以下是用户提供的原始剧本，你必须严格遵循！🚨🚨🚨

═══ 剧本原文（这是你工作的唯一依据）═══

${rawTextExcerpt}

═══ 剧本结构化解析（辅助参考）═══

${sceneDetails}

═══ 原剧本关键情节点（你的每个 shot 必须对应其中一个）═══

${keyPlotPoints}

═══ 原剧本核心对白（必须在 shots 中直接引用或精炼这些台词）═══

${dialogueChecklist}

═══ 编剧任务：将原始剧本忠实转化为分镜脚本 ═══

你的工作 **不是创作新故事**，而是将上述剧本 **格式转换** 为标准 JSON 分镜脚本。

## 🚨 镜头数量规则（最高优先级）🚨

你必须生成 **足够多的镜头** 来充分覆盖剧本内容：
- 一个场景如果包含多段对话、多个动作、或情绪转折，**必须拆分为多个镜头**
- 每段重要对话 = 至少 1 个镜头
- 每个情绪转折点 = 至少 1 个镜头
- 每个重要动作/事件 = 至少 1 个镜头
- **绝对禁止将整个剧本压缩为 1-2 个镜头！** 这会导致用户体验极差

具体要求：
1. **充分拆分场景为多个镜头**：一个场景可以（而且通常应该）拆分为 2-5 个镜头。不可跳过关键场景，不可编造新场景
2. **dialogue 必须直接引用原剧本台词**：从上面的"核心对白"中选取最精彩的台词，精炼到25字以内。禁止创作原剧本中不存在的台词
3. **characters 数组必须与原剧本该场景的出场角色一致**
4. **sceneDescription 基于原剧本的△画面描述扩写**：补充五感细节到120-250字
5. **visualPrompt 必须包含出场角色的具体外貌特征**
6. **情节顺序必须与原剧本一致**：shot 1 对应剧本最早的场景，最后一个 shot 对应剧本的结局
7. **情感曲线**：emotionTemperature 必须反映原剧本各场景的情绪走向
8. **subtext**：根据原剧本上下文推断角色的潜台词
9. **OS独白处理**：通过视觉方式呈现（闪回、蒙太奇、画外音字幕）

⚠️ 自检清单（输出前必须核对）：
- [ ] shots 数组是否有 **至少 4 个镜头**？如果少于 4 个，立即返回重新拆分
- [ ] 每个 shot 的 dialogue 是否来自原剧本？
- [ ] 是否遗漏了原剧本中的关键角色？
- [ ] 是否保持了原剧本的情节顺序？
- [ ] 是否有自己编造的情节或对白混入？
`;
}
