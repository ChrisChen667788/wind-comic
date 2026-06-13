/**
 * lib/replica-fidelity (v11.1.3) — 复刻质量对照(阶段十九收尾)。
 *
 * 复刻的目标是**保结构**:镜数/时长/镜头语言照原片,只换主体。所以"质量"= 复刻片
 * 的节奏与钩子结构有多贴近原片。复用既有 pacing-audit + hook-audit 纯函数对原片拉片表
 * 与复刻脚本各跑一遍,算开场钩子/集尾悬念/反转数/平均冲突分的差异 → 保真度 0-100。
 *
 * 纯函数、零 IO;auditScript/auditHooks 本就是确定性词典启发式,对照无外部依赖可单测。
 */
import { auditScript } from './pacing-audit';
import { auditHooks } from './hook-audit';
import type { PullSheet } from './pull-sheet';

export interface FidelityMetrics {
  openingHook: number;       // 0-10
  cliffhanger: number;       // 0-10
  averageConflictScore: number; // 0-10
  reversalCount: number;
}

export interface ReplicaFidelityReport {
  original: FidelityMetrics;
  replica: FidelityMetrics;
  fidelity: {
    pacing: number;   // 0-100 节奏保真(平均冲突分 + 反转数贴合度)
    hook: number;     // 0-100 钩子保真(开场 + 集尾贴合度)
    overall: number;  // 0-100
  };
  notes: string[];
}

/** PullSheet / 复刻脚本统一成 auditScript/auditHooks 消费的 Script 形。 */
function toAuditScript(input: { title?: string; shots: any[] }): { title: string; synopsis: string; shots: any[] } {
  const shots = (input.shots || []).map((s: any) => ({
    shotNumber: s.shotNumber,
    sceneDescription: s.sceneDescription || s.scene || s.description || '',
    action: s.action || s.description || '',
    emotion: s.emotion || '',
    characters: Array.isArray(s.characters) ? s.characters : [],
    dialogue: s.dialogue || '',
    duration: typeof s.duration === 'number' ? s.duration : (typeof s.durationSec === 'number' ? s.durationSec : 5),
    emotionTemperature: typeof s.emotionTemperature === 'number' ? s.emotionTemperature : undefined,
    storyBeat: s.storyBeat || s.beat || '',
  }));
  return { title: input.title || '', synopsis: '', shots };
}

function metricsOf(input: { title?: string; shots: any[] }): FidelityMetrics {
  const script = toAuditScript(input);
  const pacing = auditScript(script as any, { dramaMode: true });
  const hooks = auditHooks(script as any);
  return {
    openingHook: hooks.openingHook.score,
    cliffhanger: hooks.cliffhanger.score,
    averageConflictScore: Math.round(pacing.averageConflictScore * 10) / 10,
    reversalCount: pacing.reversalCount,
  };
}

/** 两个 0-10 值的贴合度(0-100):差 0 → 100,差 10 → 0。 */
function closeness10(a: number, b: number): number {
  return Math.max(0, Math.round((1 - Math.abs(a - b) / 10) * 100));
}

/** 反转数贴合度:按相对差(原片 0 反转时按绝对差宽容)。 */
function closenessCount(orig: number, rep: number): number {
  const denom = Math.max(orig, 1);
  return Math.max(0, Math.round((1 - Math.min(1, Math.abs(orig - rep) / denom)) * 100));
}

/**
 * 复刻保真度对照。original 接 PullSheet(出厂/外部表),replica 接复刻脚本
 * ({title, shots:[ScriptShot]});两者都归一成 audit Script 后对照。
 */
export function compareReplicaFidelity(
  original: PullSheet | { title?: string; shots: any[] },
  replica: { title?: string; shots: any[] },
): ReplicaFidelityReport {
  const o = metricsOf(original);
  const r = metricsOf(replica);

  const hook = Math.round((closeness10(o.openingHook, r.openingHook) + closeness10(o.cliffhanger, r.cliffhanger)) / 2);
  const pacing = Math.round((closeness10(o.averageConflictScore, r.averageConflictScore) + closenessCount(o.reversalCount, r.reversalCount)) / 2);
  const overall = Math.round((hook + pacing) / 2);

  const notes: string[] = [];
  if (r.openingHook < o.openingHook - 2) notes.push(`开场钩子掉了 ${o.openingHook}→${r.openingHook} —— 替换词削弱了开场冲突,建议给首镜补强动作/危机词`);
  if (r.cliffhanger < o.cliffhanger - 2) notes.push(`集尾悬念掉了 ${o.cliffhanger}→${r.cliffhanger} —— 末镜复刻 prompt 可补"突现/疑问/威胁"构件`);
  if (r.reversalCount < o.reversalCount) notes.push(`情绪反转少了 ${o.reversalCount}→${r.reversalCount} —— 替换可能抹掉了情绪极性词`);
  if (overall >= 85) notes.push('结构保真度高 —— 复刻很好地保留了原片节奏与钩子');

  return { original: o, replica: r, fidelity: { pacing, hook, overall }, notes };
}
