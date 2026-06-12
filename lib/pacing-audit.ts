/**
 * v2.21 P1.1 — 节奏/反转密度自动审计.
 *
 * 问题: Writer prompt 已经强约束 "短剧 6 镜里至少 2 反转 / 每镜要有事件",
 * 但 LLM 输出后没人检查. 用户得自己看分镜, 发现节奏崩了 → 重生整片.
 *
 * 解法: 纯函数 lib, 给每个 shot 算冲突分 + 检测相邻 shot 的情绪反转,
 * 输出 audit 报告. orchestrator 在 runWriter 后跑一遍, 不强阻塞但 SSE 推到前端,
 * 短剧场景反转不足时弹 warning.
 *
 * 设计:
 *   - 纯函数 + 关键词字典, 不依赖 LLM 二次审 (省成本)
 *   - 阈值按 mode 区分: 短剧 严格 (≥2 反转), 普通 宽松 (≥1 反转)
 *   - 输出包含 shot 维度建议 (哪一镜偏弱 + 怎么补)
 */

import type { ScriptShot, Script } from '@/types/agents';
import type { HookAuditResult } from './hook-audit';

// ─── 词典 ────────────────────────────────────────────────────────────────────
// 冲突词: 直接表征"事件发生"的动词 + 情绪词. 越多分越高.
const CONFLICT_KEYWORDS = [
  // 强动作
  '撕', '打', '砸', '推', '拽', '掐', '抓', '甩', '扇', '踹', '咬', '刺', '斩',
  '冲', '闯', '夺', '抢', '抓', '逃', '追', '截', '杀', '救', '抓住',
  // 揭穿/对峙
  '揭穿', '撕破', '当众', '指着', '怒斥', '质问', '反驳', '反击', '对峙', '摊牌',
  '反转', '翻脸', '翻供', '回怼', '反咬',
  // 情绪强转
  '崩溃', '怒火', '震怒', '失声', '颤抖', '咬牙', '冷笑', '失控', '抓狂',
  '哽咽', '绝望', '震惊', '错愕', '懵', '茫然', '难以置信',
  // 冲突事件
  '车祸', '事故', '袭击', '阴谋', '陷阱', '出卖', '背叛', '谎言', '欺骗',
  '掌掴', '羞辱', '羞辱', '威胁', '勒索',
  // 转折标志
  '突然', '猛地', '骤然', '陡然', '瞬间', '没想到', '却没料到', '万万没想到',
  '原来', '竟然', '居然', '没成想',
];

// 情绪极性词典 — positive (+) / negative (-) / neutral (0)
// 用来检测相邻 shot 的"价值转换" (McKee: 每场戏必须有 value shift)
const POSITIVE_EMOTION = [
  '欢', '喜', '乐', '爱', '甜', '安', '宁', '兴奋', '激动', '满足', '骄傲',
  '希望', '感动', '温暖', '幸福', '解脱', '释然', '胜利', '成功',
];

const NEGATIVE_EMOTION = [
  '怒', '恨', '怕', '惧', '悲', '哀', '愤', '惊', '崩', '绝望', '愤怒',
  '焦虑', '紧张', '恐惧', '羞辱', '屈辱', '失望', '痛苦', '挫败', '失败',
];

/** 检测文本里出现了多少个冲突关键词 */
function countConflictWords(text: string): number {
  if (!text) return 0;
  let n = 0;
  for (const w of CONFLICT_KEYWORDS) {
    if (text.includes(w)) n++;
  }
  return n;
}

/** 检测情绪极性. 0=neutral, +1=positive, -1=negative. 混合时按多数. */
export function detectEmotionPolarity(text: string): -1 | 0 | 1 {
  if (!text) return 0;
  let pos = 0;
  let neg = 0;
  for (const w of POSITIVE_EMOTION) if (text.includes(w)) pos++;
  for (const w of NEGATIVE_EMOTION) if (text.includes(w)) neg++;
  if (pos === 0 && neg === 0) return 0;
  if (pos > neg) return 1;
  if (neg > pos) return -1;
  return 0; // 平局算 neutral
}

/**
 * 给单个 shot 算冲突分 (0-10).
 *
 * 公式:
 *   - 冲突词数 × 2 (上限 6)
 *   - 有 dialogue 加 1 (有对白 = 有戏)
 *   - 情绪非 neutral 加 1
 *   - emotionTemperature 字段存在且 >= 7 加 2 (Writer 明确标了高情绪)
 *   - 总上限 10
 */
export function scoreShotConflict(shot: ScriptShot): number {
  let score = 0;
  const text = `${shot.action || ''} ${shot.dialogue || ''} ${shot.emotion || ''} ${shot.sceneDescription || ''}`;
  const conflictWords = countConflictWords(text);
  score += Math.min(6, conflictWords * 2);
  if (shot.dialogue && shot.dialogue.trim().length > 0) score += 1;
  const polarity = detectEmotionPolarity(text);
  if (polarity !== 0) score += 1;
  if (typeof shot.emotionTemperature === 'number' && shot.emotionTemperature >= 7) score += 2;
  return Math.min(10, score);
}

/**
 * 检测相邻 shot 的 "价值反转".
 * 反转定义: 情绪极性从 +1 → -1 或 -1 → +1 (跳过 neutral 中间过渡).
 * 同极性变化 (例如 +1 → +1) 不算反转 — McKee 说每场戏必须有 value shift.
 */
export function detectReversals(shots: ScriptShot[]): Array<{ fromShot: number; toShot: number }> {
  const reversals: Array<{ fromShot: number; toShot: number }> = [];
  let lastNonZero: { idx: number; polarity: -1 | 1 } | null = null;
  for (let i = 0; i < shots.length; i++) {
    const text = `${shots[i].action || ''} ${shots[i].dialogue || ''} ${shots[i].emotion || ''}`;
    const polarity = detectEmotionPolarity(text);
    if (polarity === 0) continue;
    if (lastNonZero && polarity !== lastNonZero.polarity) {
      reversals.push({
        fromShot: shots[lastNonZero.idx].shotNumber ?? lastNonZero.idx + 1,
        toShot: shots[i].shotNumber ?? i + 1,
      });
    }
    lastNonZero = { idx: i, polarity };
  }
  return reversals;
}

export interface ShotReport {
  shotNumber: number;
  conflictScore: number;
  polarity: -1 | 0 | 1;
  warning: string | null;
}

export interface PacingAuditReport {
  /** 短剧模式 (反转密度要求更严) */
  dramaMode: boolean;
  /** 平均冲突分 (0-10) */
  averageConflictScore: number;
  /** 总反转次数 */
  reversalCount: number;
  /** 反转密度: 每 N 镜出现一次反转 (越小越好) */
  reversalDensity: number;
  /** 是否达标 */
  passed: boolean;
  shots: ShotReport[];
  warnings: string[];
  suggestions: string[];
  /**
   * v10.6.2 钩子审计三指标(开场 3 秒钩子分 / 集尾悬念分 / BGM 卡点对齐率)。
   * 由 orchestrator 在 audit 后用 lib/hook-audit.auditHooks 填充;
   * bgmSync 在 Editor 阶段真 BGM 落盘后回填(Writer 阶段标不可测)。
   */
  hooks?: HookAuditResult;
}

export interface AuditOptions {
  /** 短剧/漫剧模式: 反转门槛更严. 默认按 false 算; 调用方根据 isDramaContext 传 true */
  dramaMode?: boolean;
  /** shot conflict score 阈值, 低于此值标 warning. 默认 dramaMode=4 / normal=2 */
  minShotScore?: number;
  /** 反转最小次数. 默认 dramaMode=2 / normal=1 */
  minReversals?: number;
}

/**
 * 整片 audit. 输出可直接挂到 script.pacingReport 给前端用.
 */
export function auditScript(script: Script, opts?: AuditOptions): PacingAuditReport {
  const shots = Array.isArray(script.shots) ? script.shots : [];
  const dramaMode = opts?.dramaMode ?? false;
  const minShotScore = opts?.minShotScore ?? (dramaMode ? 4 : 2);
  const minReversals = opts?.minReversals ?? (dramaMode ? 2 : 1);

  const shotReports: ShotReport[] = shots.map((shot, i) => {
    const conflictScore = scoreShotConflict(shot);
    const text = `${shot.action || ''} ${shot.dialogue || ''} ${shot.emotion || ''}`;
    const polarity = detectEmotionPolarity(text);
    let warning: string | null = null;
    if (conflictScore < minShotScore) {
      warning = dramaMode
        ? `第 ${shot.shotNumber ?? i + 1} 镜冲突分 ${conflictScore}/10 太低 (短剧要求 ≥${minShotScore}) — 这镜可能是"过场", 建议补冲突 / 反转 / 强对白`
        : `第 ${shot.shotNumber ?? i + 1} 镜冲突分 ${conflictScore}/10 偏低, 看看是否能加些事件感`;
    }
    return {
      shotNumber: shot.shotNumber ?? i + 1,
      conflictScore,
      polarity,
      warning,
    };
  });

  const reversals = detectReversals(shots);
  const reversalCount = reversals.length;
  const reversalDensity = reversalCount > 0 ? shots.length / reversalCount : Infinity;

  const totalScore = shotReports.reduce((sum, r) => sum + r.conflictScore, 0);
  const averageConflictScore = shots.length > 0 ? totalScore / shots.length : 0;

  const warnings: string[] = [];
  const suggestions: string[] = [];

  // 低分镜统计 warning
  const weakShots = shotReports.filter((r) => r.warning);
  for (const w of weakShots) if (w.warning) warnings.push(w.warning);

  // 反转不够
  if (reversalCount < minReversals) {
    const msg = dramaMode
      ? `🚨 全片只有 ${reversalCount} 次情绪反转, 短剧标准至少 ${minReversals} 次 — 观众会觉得"平", 强烈建议改写`
      : `全片仅 ${reversalCount} 次情绪反转, 建议至少 ${minReversals} 次让节奏起伏`;
    warnings.push(msg);
    suggestions.push('在中段插一个"翻面"事件: 主角看似得胜 → 突然失利, 或反之');
  }

  // 平均分太低 — 整片"温吞". 4.5 实测对"好剧本"也太严, 降到 3.5 (≥3.5 = 大多镜有对白+情绪+1 个事件)
  const avgThreshold = dramaMode ? 3.5 : 2.5;
  if (averageConflictScore < avgThreshold) {
    warnings.push(
      dramaMode
        ? `🚨 全片平均冲突分 ${averageConflictScore.toFixed(1)}/10 偏低 (短剧需 ≥${avgThreshold}) — 整片可能"温吞"`
        : `平均冲突分 ${averageConflictScore.toFixed(1)}/10, 节奏偏缓`,
    );
    suggestions.push('在弱镜里加入: 突发动作 / 摊牌对白 / 反驳/质问 / 揭穿 / 撕破伪装');
  }

  // 首镜没钩子 (短剧场景必检)
  if (dramaMode && shotReports.length > 0 && shotReports[0].conflictScore < 5) {
    warnings.push('🚨 第 1 镜冲突分太低 — 短剧观众前 3 秒不上钩就划走, 必须用 危机 / 反转 / 强对白 起手');
    suggestions.push('改第 1 镜为: 主角被当街羞辱 / 醒来发现回到过去 / 系统提示音突响 / 反派抓住把柄');
  }

  // cliffhanger 检查 — 末镜要有 ↑ 的情绪/疑问
  if (dramaMode && shotReports.length > 0) {
    const lastShot = shots[shots.length - 1];
    const lastText = `${lastShot.action || ''} ${lastShot.dialogue || ''} ${lastShot.emotion || ''}`;
    const hasCliffhanger = /[?？]|未完|未结|下一集|cliffhanger|留下|消失|出现/.test(lastText);
    if (!hasCliffhanger) {
      warnings.push('末镜没明显 cliffhanger — 短剧需要留 "下集预期", 不能像电影一样"完美收尾"');
      suggestions.push('末镜加: 关键人物突然出现 / 主角拨通电话只说"你过来" / 屏幕黑下来留一个问号');
    }
  }

  const passed =
    reversalCount >= minReversals &&
    averageConflictScore >= avgThreshold &&
    (!dramaMode || shotReports[0]?.conflictScore >= 5);

  return {
    dramaMode,
    averageConflictScore,
    reversalCount,
    reversalDensity,
    passed,
    shots: shotReports,
    warnings,
    suggestions,
  };
}
