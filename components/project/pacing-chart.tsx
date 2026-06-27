'use client';

/**
 * v2.21 P1.4 + v2.24 A/C — 节奏分析图 (PacingChart).
 *
 * 展示:
 *   - PacingAuditReport (P1.1) — 冲突分 / 反转 / cliffhanger
 *   - StyleAudit 历史趋势 (v2.24 A) — 每镜画风评分 + 重生标记
 *   - DialogueCoverageReport (v2.24 C) — 缺反打 / 缺特写 列表
 */

import { ArrowRight, Warning as AlertTriangle, CheckCircle as CheckCircle2, TrendUp as TrendingUp, TrendDown as TrendingDown, Minus, Lightbulb, Palette, ChatCircle as MessageCircle, ArrowsClockwise as RefreshCw } from '@phosphor-icons/react';
import { EmptyState } from '@/components/cinema/primitives';

type Polarity = -1 | 0 | 1;

interface ShotReport {
  shotNumber: number;
  conflictScore: number;
  polarity: Polarity;
  warning: string | null;
}

interface HookMetric {
  score: number;
  reasons: string[];
}

interface BgmSyncMetric {
  available: boolean;
  rate: number | null;
  alignedCuts: number;
  totalCuts: number;
  windowS: number;
}

// v10.6.2 — 钩子审计三指标(开场 3 秒 / 集尾悬念 / BGM 卡点)
interface HookAuditShape {
  openingHook: HookMetric;
  cliffhanger: HookMetric;
  bgmSync: BgmSyncMetric;
  llmAssisted: boolean;
}

interface PacingReport {
  dramaMode: boolean;
  averageConflictScore: number;
  reversalCount: number;
  reversalDensity: number;
  passed: boolean;
  shots: ShotReport[];
  warnings: string[];
  suggestions: string[];
  hooks?: HookAuditShape;
}

// v2.24 A — Style audit per-shot data (from Storyboard.styleAuditScore etc)
export interface StyleAuditShot {
  shotNumber: number;
  styleAuditScore?: number;     // 0-100
  styleAuditRetried?: boolean;
  styleAuditReason?: string;
}

// v2.24 C — Dialogue coverage report shape
export interface DialogueCoverageReportShape {
  sceneCount: number;
  multiCharSceneCount: number;
  needsReverseShot: Array<{ startIndex: number; endIndex: number; characters: string[] }>;
  needsCloseUp: Array<{ startIndex: number; endIndex: number; characters: string[] }>;
  coverageScore: number;
  warnings: string[];
  rewriteHints: string[];
}

export interface PacingChartProps {
  report: PacingReport | null | undefined;
  /** v2.24 A — 每镜 style audit 分数, 给 "画风一致性" sub-section 用 */
  styleAuditShots?: StyleAuditShot[];
  /** v2.24 C — 对话覆盖度报告 */
  dialogueCoverage?: DialogueCoverageReportShape | null;
}

function scoreColor(score: number): string {
  if (score >= 7) return 'var(--cinema-green)';
  if (score >= 4) return 'var(--cinema-amber)';
  return 'var(--cinema-red)';
}

function PolarityIcon({ p }: { p: Polarity }) {
  if (p === 1) return <TrendingUp className="w-3 h-3" style={{ color: 'var(--cinema-green)' }} />;
  if (p === -1) return <TrendingDown className="w-3 h-3" style={{ color: 'var(--cinema-red)' }} />;
  return <Minus className="w-3 h-3 opacity-40" />;
}

export function PacingChart({ report, styleAuditShots, dialogueCoverage }: PacingChartProps) {
  if (!report) {
    return (
      <div className="cinema-card-hi">
        <EmptyState icon={TrendingUp} title="暂无节奏数据" hint="等编剧完成本项目后这里会显示节奏分析" />
      </div>
    );
  }

  const { shots, averageConflictScore, reversalCount, passed, dramaMode, warnings, suggestions } = report;

  // 反转对 — 把相邻不同极性的 shot 标出来
  const reversalEdges = new Set<number>();
  let lastNonZero: { idx: number; polarity: Polarity } | null = null;
  for (let i = 0; i < shots.length; i++) {
    const p = shots[i].polarity;
    if (p === 0) continue;
    if (lastNonZero && p !== lastNonZero.polarity) {
      reversalEdges.add(lastNonZero.idx); // 标在前一镜的右边
    }
    lastNonZero = { idx: i, polarity: p };
  }

  return (
    <div className="space-y-4">
      {/* KPI 卡 */}
      <div className="grid grid-cols-3 gap-3">
        <div className="cinema-card-hi p-3">
          <div className="cinema-eyebrow mb-1">AVG CONFLICT</div>
          <div className="flex items-baseline gap-1">
            <span className="cinema-headline text-2xl" style={{ color: scoreColor(averageConflictScore) }}>
              {averageConflictScore.toFixed(1)}
            </span>
            <span className="cinema-mono text-[10px] opacity-50">/10</span>
          </div>
          <div className="cinema-mono text-[9px] opacity-40 mt-0.5">
            {dramaMode ? '短剧 ≥3.5 合格' : '普通 ≥2.5 合格'}
          </div>
        </div>

        <div className="cinema-card-hi p-3">
          <div className="cinema-eyebrow mb-1">REVERSALS</div>
          <div className="flex items-baseline gap-1">
            <span className="cinema-headline text-2xl">{reversalCount}</span>
            <span className="cinema-mono text-[10px] opacity-50">次</span>
          </div>
          <div className="cinema-mono text-[9px] opacity-40 mt-0.5">
            {dramaMode ? '短剧 ≥2 合格' : '普通 ≥1 合格'}
          </div>
        </div>

        <div className="cinema-card-hi p-3">
          <div className="cinema-eyebrow mb-1">VERDICT</div>
          <div className="flex items-center gap-1.5">
            {passed ? (
              <>
                <CheckCircle2 className="w-5 h-5" style={{ color: 'var(--cinema-green)' }} />
                <span className="cinema-headline text-base" style={{ color: 'var(--cinema-green)' }}>通过</span>
              </>
            ) : (
              <>
                <AlertTriangle className="w-5 h-5" style={{ color: 'var(--cinema-amber)' }} />
                <span className="cinema-headline text-base" style={{ color: 'var(--cinema-amber)' }}>待改</span>
              </>
            )}
          </div>
          <div className="cinema-mono text-[9px] opacity-40 mt-0.5">
            {dramaMode ? '短剧模式' : '普通模式'}
          </div>
        </div>
      </div>

      {/* v10.6.2 — 钩子审计三指标 */}
      {report.hooks && (
        <div className="cinema-card-hi p-4" data-testid="hook-audit">
          <div className="flex items-center justify-between mb-3">
            <div className="cinema-eyebrow">钩子审计</div>
            <div className="cinema-mono text-[10px] opacity-50">
              {report.hooks.llmAssisted ? '启发式 + LLM 复核' : '确定性启发式'}
            </div>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <div className="cinema-mono text-[10px] opacity-60 mb-1">开场 3 秒钩子</div>
              <div className="flex items-baseline gap-1">
                <span className="cinema-headline text-xl" style={{ color: scoreColor(report.hooks.openingHook.score) }}>
                  {report.hooks.openingHook.score}
                </span>
                <span className="cinema-mono text-[10px] opacity-50">/10</span>
              </div>
            </div>
            <div>
              <div className="cinema-mono text-[10px] opacity-60 mb-1">集尾悬念</div>
              <div className="flex items-baseline gap-1">
                <span className="cinema-headline text-xl" style={{ color: scoreColor(report.hooks.cliffhanger.score) }}>
                  {report.hooks.cliffhanger.score}
                </span>
                <span className="cinema-mono text-[10px] opacity-50">/10</span>
              </div>
            </div>
            <div>
              <div className="cinema-mono text-[10px] opacity-60 mb-1">BGM 卡点对齐</div>
              {report.hooks.bgmSync.available && report.hooks.bgmSync.rate !== null ? (
                <div className="flex items-baseline gap-1">
                  <span className="cinema-headline text-xl" style={{ color: scoreColor(report.hooks.bgmSync.rate * 10) }}>
                    {Math.round(report.hooks.bgmSync.rate * 100)}%
                  </span>
                  <span className="cinema-mono text-[10px] opacity-50">
                    {report.hooks.bgmSync.alignedCuts}/{report.hooks.bgmSync.totalCuts} 切点
                  </span>
                </div>
              ) : (
                <div className="cinema-mono text-[11px] opacity-50">未生成 BGM,暂不可测</div>
              )}
            </div>
          </div>
          <ul className="mt-3 space-y-0.5">
            {[...report.hooks.openingHook.reasons.map((r) => `开场:${r}`),
              ...report.hooks.cliffhanger.reasons.map((r) => `集尾:${r}`)].map((r, i) => (
              <li key={i} className="cinema-mono text-[10px] opacity-50">· {r}</li>
            ))}
          </ul>
        </div>
      )}

      {/* 每镜柱状条 + 反转箭头 */}
      <div className="cinema-card-hi p-4">
        <div className="flex items-center justify-between mb-3">
          <div className="cinema-eyebrow">PER-SHOT CONFLICT</div>
          <div className="cinema-mono text-[10px] opacity-50">
            {shots.length} 镜
          </div>
        </div>
        {shots.length === 0 ? (
          <div className="cinema-mono text-[11px] opacity-50 py-4 text-center">
            无镜头数据
          </div>
        ) : (
          <div className="flex items-end gap-1 min-h-[140px]">
            {shots.map((s, i) => {
              const heightPct = Math.max(8, (s.conflictScore / 10) * 100);
              const color = scoreColor(s.conflictScore);
              const isReversal = reversalEdges.has(i);
              return (
                <div key={s.shotNumber} className="flex-1 flex flex-col items-center gap-1 min-w-0">
                  {/* 反转箭头 — 标在该镜柱顶之上 */}
                  <div className="h-4 flex items-center justify-center">
                    {isReversal && (
                      <ArrowRight
                        className="w-3 h-3"
                        style={{ color: 'var(--cinema-amber)' }}
                        aria-label="情绪反转"
                      />
                    )}
                  </div>
                  {/* 极性 icon */}
                  <PolarityIcon p={s.polarity} />
                  {/* 柱条 */}
                  <div
                    className="w-full rounded-t flex items-end justify-center relative group"
                    style={{
                      height: `${heightPct}%`,
                      minHeight: '12px',
                      background: color,
                      opacity: s.warning ? 0.6 : 0.9,
                    }}
                    title={s.warning ?? `Shot ${s.shotNumber}: ${s.conflictScore}/10`}
                  >
                    <span className="cinema-mono text-[9px] text-black/70 font-bold pb-0.5">
                      {s.conflictScore}
                    </span>
                  </div>
                  {/* 镜号 */}
                  <div className="cinema-mono text-[10px] opacity-60">{s.shotNumber}</div>
                </div>
              );
            })}
          </div>
        )}
        <div className="flex items-center gap-3 mt-3 cinema-mono text-[9px] opacity-50">
          <span className="inline-flex items-center gap-1">
            <span className="w-2 h-2 rounded-sm" style={{ background: 'var(--cinema-green)' }} /> 强 ≥7
          </span>
          <span className="inline-flex items-center gap-1">
            <span className="w-2 h-2 rounded-sm" style={{ background: 'var(--cinema-amber)' }} /> 中 4-6
          </span>
          <span className="inline-flex items-center gap-1">
            <span className="w-2 h-2 rounded-sm" style={{ background: 'var(--cinema-red)' }} /> 弱 &lt;4
          </span>
          <span className="ml-auto inline-flex items-center gap-1">
            <ArrowRight className="w-2.5 h-2.5" style={{ color: 'var(--cinema-amber)' }} /> 情绪反转点
          </span>
        </div>
      </div>

      {/* v2.24 A: 画风一致性 sub-section (StyleAudit 每镜评分) */}
      {styleAuditShots && styleAuditShots.length > 0 && (
        <div className="cinema-card-hi p-4">
          <div className="flex items-center justify-between mb-3">
            <div className="cinema-eyebrow flex items-center gap-1.5">
              <Palette className="w-3 h-3" />
              STYLE BIBLE 一致性 (每镜 vision 审计)
            </div>
            {(() => {
              const scored = styleAuditShots.filter((s) => s.styleAuditScore != null);
              if (scored.length === 0) return null;
              const avg = scored.reduce((sum, s) => sum + (s.styleAuditScore || 0), 0) / scored.length;
              const retried = styleAuditShots.filter((s) => s.styleAuditRetried).length;
              return (
                <span className="cinema-mono text-[10px] opacity-60">
                  平均 {avg.toFixed(0)}/100 · {retried} 镜重生
                </span>
              );
            })()}
          </div>
          <div className="flex items-end gap-1 min-h-[80px]">
            {styleAuditShots.map((s) => {
              const score = s.styleAuditScore;
              if (score == null) {
                return (
                  <div key={s.shotNumber} className="flex-1 flex flex-col items-center gap-1 min-w-0">
                    <div className="w-full bg-white/5 rounded-t" style={{ height: '20%' }} />
                    <span className="cinema-mono text-[9px] opacity-30">{s.shotNumber}</span>
                  </div>
                );
              }
              const heightPct = Math.max(15, (score / 100) * 100);
              const color = score >= 85 ? 'var(--cinema-green)' : score >= 70 ? 'var(--cinema-amber)' : 'var(--cinema-red)';
              return (
                <div key={s.shotNumber} className="flex-1 flex flex-col items-center gap-1 min-w-0 relative">
                  {s.styleAuditRetried && (
                    <span
                      className="absolute -top-3 cinema-mono text-[10px]"
                      style={{ color: 'var(--cinema-amber)' }}
                      title={`已重生 (vision 修偏: ${s.styleAuditReason || ''})`}
                    >
                      <RefreshCw className="w-2.5 h-2.5" />
                    </span>
                  )}
                  <div
                    className="w-full rounded-t flex items-end justify-center"
                    style={{
                      height: `${heightPct}%`,
                      minHeight: '14px',
                      background: color,
                      opacity: 0.9,
                    }}
                    title={s.styleAuditReason ? `${score}/100: ${s.styleAuditReason}` : `${score}/100`}
                  >
                    <span className="cinema-mono text-[9px] text-black/70 font-bold pb-0.5">{score}</span>
                  </div>
                  <span className="cinema-mono text-[10px] opacity-60">{s.shotNumber}</span>
                </div>
              );
            })}
          </div>
          <div className="flex items-center gap-3 mt-3 cinema-mono text-[9px] opacity-50">
            <span className="inline-flex items-center gap-1">
              <span className="w-2 h-2 rounded-sm" style={{ background: 'var(--cinema-green)' }} /> 强 ≥85
            </span>
            <span className="inline-flex items-center gap-1">
              <span className="w-2 h-2 rounded-sm" style={{ background: 'var(--cinema-amber)' }} /> 中 70-84
            </span>
            <span className="inline-flex items-center gap-1">
              <span className="w-2 h-2 rounded-sm" style={{ background: 'var(--cinema-red)' }} /> 弱 &lt;70 (已触发重生)
            </span>
            <span className="ml-auto inline-flex items-center gap-1"><RefreshCw className="w-2.5 h-2.5" />vision auto-regen</span>
          </div>
        </div>
      )}

      {/* v2.24 C: 对话覆盖度 sub-section */}
      {dialogueCoverage && dialogueCoverage.multiCharSceneCount > 0 && (
        <div className="cinema-card-hi p-4">
          <div className="flex items-center justify-between mb-2">
            <div className="cinema-eyebrow flex items-center gap-1.5">
              <MessageCircle className="w-3 h-3" />
              对话覆盖度 (正反打 / 反应特写)
            </div>
            <span
              className={`cinema-mono text-[11px] font-bold ${
                dialogueCoverage.coverageScore >= 80 ? 'text-[var(--cinema-green)]'
                : dialogueCoverage.coverageScore >= 50 ? 'text-[var(--cinema-amber)]'
                : 'text-[var(--cinema-red)]'
              }`}
            >
              {dialogueCoverage.coverageScore}/100
            </span>
          </div>
          <div className="cinema-mono text-[10px] opacity-60 mb-2">
            {dialogueCoverage.sceneCount} 个对话场景 · {dialogueCoverage.multiCharSceneCount} 个多角色对话
          </div>
          {dialogueCoverage.needsReverseShot.length > 0 && (
            <div className="mt-2">
              <div className="cinema-mono text-[10px] opacity-80 mb-1 flex items-center gap-1">
                <MessageCircle className="w-3 h-3" />缺正反打 ({dialogueCoverage.needsReverseShot.length} 处)
              </div>
              <ul className="space-y-0.5">
                {dialogueCoverage.needsReverseShot.slice(0, 5).map((s, i) => (
                  <li key={i} className="cinema-mono text-[10px] opacity-70">
                    · Shot 群 #{s.startIndex + 1}: {s.characters.join(' / ')} — 仅 1 镜, 缺反应切镜
                  </li>
                ))}
              </ul>
            </div>
          )}
          {dialogueCoverage.needsCloseUp.length > 0 && (
            <div className="mt-2">
              <div className="cinema-mono text-[10px] opacity-80 mb-1">
                📷 缺反应特写 ({dialogueCoverage.needsCloseUp.length} 处)
              </div>
              <ul className="space-y-0.5">
                {dialogueCoverage.needsCloseUp.slice(0, 5).map((s, i) => (
                  <li key={i} className="cinema-mono text-[10px] opacity-70">
                    · Shot 群 #{s.startIndex + 1}: {s.characters.join(' / ')} — 全 wide shot, 缺 CU/MCU
                  </li>
                ))}
              </ul>
            </div>
          )}
          {dialogueCoverage.rewriteHints.length > 0 && (
            <div className="mt-3 pt-2 border-t border-white/5">
              <div className="cinema-mono text-[10px] opacity-60 mb-1">改写建议</div>
              <ul className="space-y-0.5">
                {dialogueCoverage.rewriteHints.slice(0, 3).map((h, i) => (
                  <li key={i} className="cinema-mono text-[10px] opacity-70">→ {h}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      {/* Warnings */}
      {warnings.length > 0 && (
        <div className="cinema-card-hi p-4 border-[var(--cinema-amber)]/40">
          <div className="cinema-eyebrow mb-2 flex items-center gap-1.5">
            <AlertTriangle className="w-3 h-3" />
            WARNINGS ({warnings.length})
          </div>
          <ul className="space-y-1.5">
            {warnings.map((w, i) => (
              <li key={i} className="cinema-mono text-[11px] leading-relaxed">
                {w}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Suggestions */}
      {suggestions.length > 0 && (
        <div className="cinema-card-hi p-4">
          <div className="cinema-eyebrow mb-2 flex items-center gap-1.5">
            <Lightbulb className="w-3 h-3" />
            SUGGESTIONS ({suggestions.length})
          </div>
          <ul className="space-y-1.5">
            {suggestions.map((s, i) => (
              <li key={i} className="cinema-mono text-[11px] leading-relaxed opacity-80">
                · {s}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
