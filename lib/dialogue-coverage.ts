/**
 * v2.23 P0.4 — Dialogue coverage audit (shot/reverse shot).
 *
 * 问题:
 *   漫剧约 50% 镜头是对话场景. 真实导演会用"正反打" — A 说话特写, 切到 B 反应, 再切回 A,
 *   制造心理紧张. 但我们当前 Writer 输出常常一段连续对话用 1 个 wide shot 涵盖, 显得
 *   非常"AI 一遍跑完". 这是漫剧"AI 感"最大来源之一.
 *
 * 解法:
 *   不强行让 Writer 改写 (那要 LLM 重跑), 而是:
 *     1. 写完剧本 audit "对话覆盖度" — 哪个对话场景缺反打
 *     2. SSE warning + 项目页节奏 tab 展示
 *     3. Writer prompt 加约束: 2+ 角色对话 ≥ 2 镜 (覆盖度强), 同 location + 同角色集 = 同对话
 *
 * 设计:
 *   - 纯函数, 词典 + 规则
 *   - dialogueChain: 连续 ≥2 shots 同 location 同对话主体 = 1 个对话场景
 *   - 单镜对话 ≥2 角色 = 缺反打 (warn)
 *   - 对话场景但所有镜头都是 wide shot = 缺特写反应 (warn)
 */

import type { ScriptShot, Script } from '@/types/agents';

/** 检测一镜是否是"对话镜" — 有 dialogue + characters.length >= 2 */
function isDialogueShot(shot: ScriptShot): boolean {
  if (!shot.dialogue || !shot.dialogue.trim()) return false;
  return Array.isArray(shot.characters) && shot.characters.length >= 1;
}

/** 检测一镜是否是 wide / full shot (没有真正的特写) */
function isWideShot(shot: ScriptShot): boolean {
  const text = `${shot.shotSize || ''} ${shot.cameraAngle || ''} ${shot.sceneDescription || ''}`.toLowerCase();
  return /wide|long|full|establishing|远景|全景|远|全|aerial/i.test(text) &&
         !/close|cu\b|medium close|特写|近景/i.test(text);
}

/** 检测一镜是否是 close-up / MCU (有特写反应) */
function isCloseUpShot(shot: ScriptShot): boolean {
  const text = `${shot.shotSize || ''} ${shot.cameraAngle || ''} ${shot.sceneDescription || ''}`.toLowerCase();
  return /close.?up|cu\b|mcu|medium close|特写|近景|大特写/i.test(text);
}

export interface DialogueScene {
  /** 起始 shot index (0-based) */
  startIndex: number;
  endIndex: number;
  /** 涉及的角色 (union of all shots) */
  characters: string[];
  /** shot 数 */
  shotCount: number;
  location: string;
  /** 是否多角色 (≥2 不同角色) */
  isMultiCharacter: boolean;
  /** 是否包含 close-up (反应镜头) */
  hasCloseUp: boolean;
  /** 是否包含 wide-only (没特写) */
  isWideOnly: boolean;
}

/**
 * 抽出 location 的"语义 key" — 同一场景的不同镜头 sceneDescription 不同
 * (e.g. "tavern wide shot" vs "tavern close-up") 应分入同一场景. 取前 1-2 个
 * "地点词" 当 key, 忽略后面的镜头语言修饰词.
 */
function locationKey(shot: ScriptShot): string {
  const explicit = (shot as any).location;
  if (typeof explicit === 'string' && explicit.trim().length > 0) {
    return explicit.trim().toLowerCase();
  }
  const desc = (shot.sceneDescription || '').trim().toLowerCase();
  // Writer 输出格式约定: "venue, camera modifier" 或 "venue, action" — 取首逗号前
  // 段作为 venue. 若没逗号 (单段描述), 去掉镜头语言后取剩下的.
  const head = desc.split(/[,，。.;；]/)[0].trim();
  if (head.length > 0) {
    return head
      .replace(/\b(wide|long|full|establishing|medium|close|cu|mcu|extreme|aerial|panoramic|two[- ]shot)\b/gi, '')
      .replace(/\b(shot|frame|view|angle|stage)\b/gi, '')
      .replace(/\s+/g, ' ')
      .trim();
  }
  return desc;
}

/**
 * 把连续的对话镜头分组成"对话场景". 切分规则:
 *   - location key 不同 → 新场景 (但同 location 的"wide shot" + "close-up" 算同一场景)
 *   - 同 location 但角色完全不重叠 (无共同角色) → 新场景 (不同主体的对话)
 *   - 中间隔了 ≥1 个非对话镜 → 新场景
 */
export function detectDialogueScenes(shots: ScriptShot[]): DialogueScene[] {
  const scenes: DialogueScene[] = [];
  let current: { startIndex: number; endIndex: number; chars: Set<string>; loc: string; closeUps: number; wides: number; total: number } | null = null;

  const finalize = () => {
    if (!current || current.total < 1) {
      current = null;
      return;
    }
    const chars = Array.from(current.chars);
    scenes.push({
      startIndex: current.startIndex,
      endIndex: current.endIndex,
      characters: chars,
      shotCount: current.total,
      location: current.loc,
      isMultiCharacter: chars.length >= 2,
      hasCloseUp: current.closeUps > 0,
      isWideOnly: current.wides > 0 && current.closeUps === 0,
    });
    current = null;
  };

  for (let i = 0; i < shots.length; i++) {
    const s = shots[i];
    if (!isDialogueShot(s)) {
      finalize();
      continue;
    }
    const loc = locationKey(s);
    const sChars = new Set(s.characters || []);

    if (current && loc === current.loc) {
      // 同 location → 一定并入当前场景 (即使发言人切换 — shot/reverse 的本质就是切换说话人)
      current.endIndex = i;
      sChars.forEach((c) => current!.chars.add(c));
      if (isCloseUpShot(s)) current.closeUps++;
      if (isWideShot(s)) current.wides++;
      current.total++;
    } else {
      finalize();
      current = {
        startIndex: i, endIndex: i,
        chars: sChars,
        loc,
        closeUps: isCloseUpShot(s) ? 1 : 0,
        wides: isWideShot(s) ? 1 : 0,
        total: 1,
      };
    }
  }
  finalize();
  return scenes;
}

export interface DialogueCoverageReport {
  /** 总对话场景数 */
  sceneCount: number;
  /** 多角色对话场景数 (≥2 角色) */
  multiCharSceneCount: number;
  /** 缺反打的场景 — 多角色对话但只有 1 镜 */
  needsReverseShot: DialogueScene[];
  /** 缺特写反应 — 多角色对话, ≥2 镜, 但全 wide shot 没特写 */
  needsCloseUp: DialogueScene[];
  /** 覆盖度评分 0-100 (满足覆盖度规则的多角色对话场景占比) */
  coverageScore: number;
  /** 给前端展示的 warning 列表 */
  warnings: string[];
  /** 给 Writer Pass-2 重写的 hint */
  rewriteHints: string[];
}

/**
 * audit 整个剧本的对话覆盖度.
 */
export function auditDialogueCoverage(script: Script): DialogueCoverageReport {
  const shots = Array.isArray(script.shots) ? script.shots : [];
  const scenes = detectDialogueScenes(shots);
  const multiChar = scenes.filter((s) => s.isMultiCharacter);
  const needsReverseShot = multiChar.filter((s) => s.shotCount === 1);
  const needsCloseUp = multiChar.filter((s) => s.shotCount >= 2 && s.isWideOnly);

  const warnings: string[] = [];
  const rewriteHints: string[] = [];

  for (const s of needsReverseShot) {
    const shotN = shots[s.startIndex]?.shotNumber ?? (s.startIndex + 1);
    warnings.push(
      `🎬 第 ${shotN} 镜: ${s.characters.join(' / ')} 对话场景只有 1 镜, 缺正反打 — 真实导演会切到对方反应`,
    );
    rewriteHints.push(
      `在 shot ${shotN} 之后插一镜: 对话听众 (${s.characters.slice(1).join('/')}) 的反应特写 (CU 表情) — 切镜后回到 ${s.characters[0]}`,
    );
  }
  for (const s of needsCloseUp) {
    const shotN = shots[s.startIndex]?.shotNumber ?? (s.startIndex + 1);
    warnings.push(
      `📷 第 ${shotN} 镜起的对话场景 (${s.characters.join(' / ')}) ${s.shotCount} 镜全是远景/全景, 缺反应特写`,
    );
    rewriteHints.push(
      `把 shot ${shotN}-${shots[s.endIndex]?.shotNumber ?? s.endIndex + 1} 其中 1 镜改成 MCU/CU, 拍听众的瞳孔放大/眉头紧锁等微表情`,
    );
  }

  const ruleSatisfied = multiChar.length - needsReverseShot.length - needsCloseUp.length;
  const coverageScore = multiChar.length === 0
    ? 100
    : Math.round((ruleSatisfied / multiChar.length) * 100);

  return {
    sceneCount: scenes.length,
    multiCharSceneCount: multiChar.length,
    needsReverseShot,
    needsCloseUp,
    coverageScore,
    warnings,
    rewriteHints,
  };
}

/**
 * 给 Writer system prompt 注入"对话场景必须正反打"的硬约束.
 * 在 漫剧 mode 之后调用, 内容简短不和已有规则冲突.
 */
export function buildDialogueCoverageBlock(): string {
  return [
    '',
    '### 🎬 对话场景覆盖度 (硬规则)',
    '- **2+ 角色对话至少 2 镜**: 不要一镜 wide shot 涵盖整段对话; 必须切到听众反应',
    '- **正反打结构**: A 说话特写 → 切 B 反应特写 → 切回 A 继续说; 同一场景最少 3 切',
    '- **避免 wide-only**: 多角色对话整段都是远景/全景 = 缺微表情张力, 必须至少 1 镜是 CU/MCU 拍人物面部',
    '- **每个 reaction shot 独立成行**: shot.dialogue 可为空, shot.action 写"听者表情" (e.g. "眉头紧蹙, 眼神闪动")',
    '',
  ].join('\n');
}
