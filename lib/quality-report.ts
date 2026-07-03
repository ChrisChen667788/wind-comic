/**
 * 成片质检报告(v12.66.0)。
 *
 * 管线里已有多道质量防线(cameo 一致性重生 / 风格门禁重生 / styleAudit 重生 / Ken Burns 兜底 /
 * 视频瞬时重试),但它们的动作只散落在日志里 —— 用户看不到「这条片有几个镜被救过、哪里降级了」。
 * 本模块把防线事件收进一本账并汇总成报告(落 quality_report 资产 + final_video data 摘要)。
 * 纯函数,可单测。
 */

export interface QualityEvent {
  shot: number;          // 镜号(全片级事件用 0)
  kind: 'shot-gate' | 'cameo-retry' | 'style-audit' | 'kenburns-fallback' | 'video-retry' | 'compliance' | string;
  detail: string;
}

export interface QualityReport {
  totalEvents: number;
  byKind: Record<string, number>;
  affectedShots: number[];      // 有事件的镜号(去重升序,不含 0)
  degradedShots: number[];      // 走了兜底(kenburns)的镜 —— 真降级
  healthScore: number;          // 0-100:100=零事件;重生类扣 5/次,兜底类扣 12/次,下限 20
  summary: string;              // 一句话中文摘要
}

const DEGRADE_KINDS = new Set(['kenburns-fallback', 'missing-video']);
const RETRY_PENALTY = 5;
const DEGRADE_PENALTY = 12;
// v12.91.0:缺镜(视频没出、连兜底图都没有)比兜底更重 —— 内容直接没了
const MISSING_PENALTY = 15;

export function summarizeQualityLedger(events: QualityEvent[]): QualityReport {
  const byKind: Record<string, number> = {};
  const shotSet = new Set<number>();
  const degraded = new Set<number>();
  for (const e of events || []) {
    byKind[e.kind] = (byKind[e.kind] || 0) + 1;
    if (e.shot > 0) shotSet.add(e.shot);
    if (DEGRADE_KINDS.has(e.kind) && e.shot > 0) degraded.add(e.shot);
  }
  const total = (events || []).length;
  let score = 100;
  for (const e of events || []) {
    score -= e.kind === 'missing-video' ? MISSING_PENALTY : DEGRADE_KINDS.has(e.kind) ? DEGRADE_PENALTY : RETRY_PENALTY;
  }
  score = Math.max(20, Math.round(score));
  const parts: string[] = [];
  if (total === 0) parts.push('全片零质量干预,一次成型');
  else {
    // v12.91:缺镜最严重,放摘要首位(实测坑:3/12 镜 15.8s 残片却报 100 分「一次成型」)
    if (byKind['missing-video']) parts.push(`⚠️ ${byKind['missing-video']} 镜缺失(视频未出且无兜底图,成片不完整)`);
    if (byKind['dialogue-overflow']) parts.push(`${byKind['dialogue-overflow']} 镜台词偏长`);
    if (byKind['cameo-retry']) parts.push(`${byKind['cameo-retry']} 镜一致性重生`);
    if (byKind['shot-gate']) parts.push(`${byKind['shot-gate']} 镜风格门禁重生`);
    if (byKind['style-audit']) parts.push(`${byKind['style-audit']} 镜画风校正`);
    if (byKind['video-retry']) parts.push(`${byKind['video-retry']} 镜视频重试`);
    if (byKind['kenburns-fallback']) parts.push(`${byKind['kenburns-fallback']} 镜静图动画兜底`);
    if (byKind['compliance']) parts.push(`${byKind['compliance']} 处广告合规替换`);
  }
  return {
    totalEvents: total,
    byKind,
    affectedShots: [...shotSet].sort((a, b) => a - b),
    degradedShots: [...degraded].sort((a, b) => a - b),
    healthScore: score,
    summary: parts.join(';') || '全片零质量干预,一次成型',
  };
}
