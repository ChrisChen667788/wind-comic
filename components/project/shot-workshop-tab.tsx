'use client';

/**
 * components/project/shot-workshop-tab (v2.16 P1.4)
 *
 * 项目页 "镜头工坊" tab — 把 v2.14 P0.3 (FLF) / P0.4 (duration routing) /
 * v2.16 P0.2 (4K export) / P1.3 (4K Kling Master 重渲) 这些"per-shot 操作"
 * 集中到一个 surface, 而不是散落在 nav bar / 视频 tab / dashboard/create。
 *
 * 设计原则:
 *   - 列出当前项目所有 shots, 每个一行 + 缩略图 + 当前质量 badge
 *   - 行内行动: "4K 重渲" (v2.16 P1.3, plan-gate pro+)
 *   - 顶部全局: 出片下载分辨率选择 (复用 ExportResolutionDropdown)
 *   - 链接出口: 跳到 /dashboard/u2v / /dashboard/u2v-flf 用 V2.14 工具调单镜
 */

import { useState } from 'react';
import { ArrowsClockwise as RefreshCw, CircleNotch as Loader2, Sparkle as Sparkles, ArrowSquareOut as ExternalLink, Lock, FilmStrip as Film, Pencil, SquaresFour as Grid } from '@phosphor-icons/react';
import { EmptyState } from '@/components/cinema/primitives';
import { ExportResolutionDropdown } from './export-resolution-dropdown';
import { StoryboardRegenModal } from './storyboard-regen-modal';
import { CandidateGridModal } from './candidate-grid-modal'; // v12.35.0 九宫格候选帧

interface Video {
  shotNumber: number;
  videoUrl?: string;
  imageUrl?: string;
  /** 数据库里 data 字段塞的元数据, 包含 quality / engine 等 */
  meta?: { quality?: string; engine?: string; [k: string]: any };
}

export interface ShotWorkshopTabProps {
  projectId: string;
  videos: Video[];
  storyboards: Array<{ shotNumber?: number; imageUrl?: string }>;
  /** 用户档位, 用来本地短路 4K 锁标; 真授权由路由层最终决定 */
  userTier?: 'free' | 'creator' | 'pro' | 'enterprise';
  onShotRegenerated?: (shotNumber: number, newVideoUrl: string) => void;
}

export function ShotWorkshopTab({
  projectId,
  videos,
  storyboards,
  userTier,
  onShotRegenerated,
}: ShotWorkshopTabProps) {
  const [busyShot, setBusyShot] = useState<number | null>(null);
  const [progress, setProgress] = useState<{ shotNumber: number; pct: number; msg: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  // local override 4K-regen 后的 url, 让 UI 立即生效不等父组件刷新
  const [localOverrides, setLocalOverrides] = useState<Record<number, { url: string; quality: string }>>({});
  // v2.23 P0.2: 单镜分镜图重生 — 用户改 prompt 后重渲
  const [regenModalShot, setRegenModalShot] = useState<number | null>(null);
  const [gridModalShot, setGridModalShot] = useState<number | null>(null); // v12.35.0 九宫格候选帧
  // 分镜图本地 override (regen 成功后立刻替换缩略图)
  const [sbOverrides, setSbOverrides] = useState<Record<number, string>>({});

  const canDo4K = !userTier || userTier === 'pro' || userTier === 'enterprise';

  const regenAt4K = async (shotNumber: number) => {
    if (busyShot !== null) return;
    if (!canDo4K) {
      window.location.href = '/dashboard/billing';
      return;
    }
    setBusyShot(shotNumber);
    setError(null);
    setProgress({ shotNumber, pct: 0, msg: '准备中...' });

    try {
      const res = await fetch(`/api/projects/${encodeURIComponent(projectId)}/regenerate-shot-4k`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ shotNumber, duration: 5 }),
      });
      if (res.status === 402) {
        setError('4K 重渲需 pro 档及以上');
        window.location.href = '/dashboard/billing';
        return;
      }
      if (!res.ok && !res.body) {
        const errBody = await res.json().catch(() => ({}));
        setError(errBody.error || `请求失败 (${res.status})`);
        return;
      }
      // SSE 流
      const reader = res.body?.getReader();
      if (!reader) {
        setError('无法读取响应流');
        return;
      }
      const decoder = new TextDecoder();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value);
        for (const line of chunk.split('\n')) {
          if (!line.startsWith('data: ')) continue;
          try {
            const evt = JSON.parse(line.slice(6));
            if (evt.type === 'progress') {
              setProgress({ shotNumber, pct: evt.data.progress || 0, msg: evt.data.status || '渲染中...' });
            } else if (evt.type === 'completed') {
              setLocalOverrides((prev) => ({
                ...prev,
                [shotNumber]: { url: evt.data.videoUrl, quality: evt.data.quality || '4k' },
              }));
              onShotRegenerated?.(shotNumber, evt.data.videoUrl);
            } else if (evt.type === 'error') {
              setError(evt.data.error || '4K 重渲失败');
            }
          } catch { /* skip malformed */ }
        }
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : '4K 重渲失败');
    } finally {
      setBusyShot(null);
      setProgress(null);
    }
  };

  // 把 shotNumber 排序; storyboard 缩略图按 shotNumber 配对
  const sortedShots = [...videos].sort((a, b) => a.shotNumber - b.shotNumber);
  const sbByShot = new Map(storyboards.map((s) => [s.shotNumber, s.imageUrl]));
  const getShotImage = (shotNumber: number): string | undefined => {
    return sbOverrides[shotNumber] || sbByShot.get(shotNumber);
  };

  return (
    <div className="space-y-5">
      {/* 顶部:工坊介绍 + 全局导出 */}
      <div className="cinema-card-hi p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <Film className="w-4 h-4 text-[var(--cinema-amber)]" />
            <h3 className="cinema-headline text-base">镜头工坊</h3>
            <span className="cinema-mono text-[10px] opacity-50">SHOT WORKSHOP · v2.16</span>
          </div>
          <p className="cinema-subhead text-[12px] mt-1 opacity-75">
            单镜操作集中地: 4K 重渲 / 首尾帧融合 / 镜头语言定向调整 / 多分辨率导出。
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <ExportResolutionDropdown projectId={projectId} userTier={userTier} />
          <a
            href="/dashboard/u2v"
            className="cinema-btn !px-3 !py-1.5 !text-[11px] inline-flex items-center gap-1.5"
            title="独立 U2V 工具 (单图变视频, 镜头语言可选)"
          >
            <Sparkles className="w-3.5 h-3.5" />
            U2V 工具
            <ExternalLink className="w-3 h-3 opacity-60" />
          </a>
        </div>
      </div>

      {/* 全局错误 */}
      {error && (
        <div className="cinema-card p-3 border-[var(--cinema-red)]/40">
          <span className="cinema-mono text-[11px] text-[var(--cinema-red)]">✗ {error}</span>
        </div>
      )}

      {/* per-shot 列表 */}
      {sortedShots.length === 0 ? (
        <div className="cinema-card">
          <EmptyState icon={Film} title="还没有视频镜头" hint="完成主管线创作后回来看这里" />
        </div>
      ) : (
        <div className="space-y-2">
          {sortedShots.map((v) => {
            const overridden = localOverrides[v.shotNumber];
            const currentQuality = overridden?.quality || v.meta?.quality || 'standard';
            const isBusy = busyShot === v.shotNumber;
            const sbImg = getShotImage(v.shotNumber) || v.imageUrl;
            const sbRegenerated = !!sbOverrides[v.shotNumber];
            return (
              <div
                key={v.shotNumber}
                className="cinema-card-hi p-3 flex items-center gap-3"
              >
                {/* v12.41 方形中性框 + object-contain:任意画幅(含 9:16 竖屏)整帧显示,不再被裁切变形 */}
                <div className="w-14 h-14 bg-black/40 rounded overflow-hidden flex-shrink-0 grid place-items-center">
                  {sbImg && /^https?:|^\/api\//i.test(sbImg) ? (
                    /* eslint-disable-next-line @next/next/no-img-element */
                    <img loading="lazy" decoding="async" src={sbImg} alt={`shot ${v.shotNumber}`} className="max-w-full max-h-full object-contain" />
                  ) : (
                    <span className="cinema-mono text-[10px] opacity-40">—</span>
                  )}
                </div>

                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="cinema-mono text-[11px] tracking-widest opacity-60">
                      SHOT {String(v.shotNumber).padStart(2, '0')}
                    </span>
                    {currentQuality === '4k' ? (
                      <span className="cinema-chip cinema-chip-amber !px-1.5 !py-0.5 !text-[9px]">4K</span>
                    ) : (
                      <span className="cinema-chip !px-1.5 !py-0.5 !text-[9px] opacity-70">{currentQuality}</span>
                    )}
                    {overridden && <span className="cinema-mono text-[9px] text-[var(--cinema-green)]">✓ 4K 已重渲</span>}
                    {sbRegenerated && <span className="cinema-mono text-[9px] text-[var(--cinema-amber)] inline-flex items-center gap-1"><Sparkles className="w-2.5 h-2.5" />分镜图已重生</span>}
                  </div>
                  {isBusy && progress && progress.shotNumber === v.shotNumber && (
                    <div className="flex items-center gap-2 mt-1">
                      <div className="flex-1 h-1 bg-[var(--cinema-surface-2)] rounded overflow-hidden">
                        <div
                          className="h-full bg-[var(--cinema-amber)] transition-[width]"
                          style={{ width: `${progress.pct}%` }}
                        />
                      </div>
                      <span className="cinema-mono text-[10px] opacity-60 whitespace-nowrap">
                        {progress.pct}% · {progress.msg}
                      </span>
                    </div>
                  )}
                </div>

                <div className="flex items-center gap-2 flex-shrink-0">
                  {/* v2.23 P0.2: 改 prompt 重生分镜图 */}
                  <button
                    onClick={() => setRegenModalShot(v.shotNumber)}
                    disabled={busyShot !== null}
                    title="改 prompt 重生这一镜的分镜图 (走 image 路由, 不重生视频)"
                    className="cinema-btn !px-3 !py-1.5 !text-[11px] inline-flex items-center gap-1.5 disabled:opacity-40"
                  >
                    <Pencil className="w-3 h-3" />
                    改 prompt 重生
                  </button>
                  {/* v12.35.0: 九宫格候选帧 — 一镜出 N 构图候选,挑最优作首帧 */}
                  <button
                    onClick={() => setGridModalShot(v.shotNumber)}
                    disabled={busyShot !== null}
                    title="一镜出 4/6/9 个构图各异的候选帧,挑最优作首帧 seed(走 image 路由)"
                    className="cinema-btn !px-3 !py-1.5 !text-[11px] inline-flex items-center gap-1.5 disabled:opacity-40"
                  >
                    <Grid className="w-3 h-3" />
                    九宫格选帧
                  </button>
                  <button
                    onClick={() => regenAt4K(v.shotNumber)}
                    disabled={isBusy || busyShot !== null}
                    title={canDo4K ? '用 Kling Master 重新渲染这一镜 (60-90s)' : '需要 pro 档及以上'}
                    className={`cinema-btn !px-3 !py-1.5 !text-[11px] inline-flex items-center gap-1.5 disabled:opacity-40 ${
                      canDo4K ? '' : 'opacity-60'
                    }`}
                  >
                    {isBusy ? (
                      <Loader2 className="w-3 h-3 animate-spin" />
                    ) : canDo4K ? (
                      <RefreshCw className="w-3 h-3" />
                    ) : (
                      <Lock className="w-3 h-3 text-[var(--cinema-amber)]" />
                    )}
                    4K 重渲
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* v2.23 P0.2: 改 prompt 重生 modal */}
      {regenModalShot !== null && (
        <StoryboardRegenModal
          projectId={projectId}
          shotNumber={regenModalShot}
          currentImageUrl={getShotImage(regenModalShot)}
          currentPrompt={
            (videos.find((v) => v.shotNumber === regenModalShot)?.meta as any)?.prompt
            || (storyboards.find((s) => s.shotNumber === regenModalShot) as any)?.prompt
            || ''
          }
          onComplete={(newUrl) => {
            setSbOverrides((prev) => ({ ...prev, [regenModalShot]: newUrl }));
            setRegenModalShot(null);
          }}
          onCancel={() => setRegenModalShot(null)}
        />
      )}

      {/* v12.35.0: 九宫格候选帧 modal */}
      {gridModalShot !== null && (
        <CandidateGridModal
          projectId={projectId}
          shotNumber={gridModalShot}
          basePrompt={
            (videos.find((v) => v.shotNumber === gridModalShot)?.meta as any)?.prompt
            || (storyboards.find((s) => s.shotNumber === gridModalShot) as any)?.prompt
            || ''
          }
          onPick={(newUrl) => {
            setSbOverrides((prev) => ({ ...prev, [gridModalShot]: newUrl }));
            setGridModalShot(null);
          }}
          onCancel={() => setGridModalShot(null)}
        />
      )}

      <div className="cinema-mono text-[10px] opacity-50 leading-relaxed">
        4K 重渲走 Kling Master, 单镜头 60-90s · plan-gate: pro+
        <br />
        镜头工坊只列出已生成的视频镜头; 想新加镜头请回到剧本 tab 编辑。
      </div>
    </div>
  );
}
