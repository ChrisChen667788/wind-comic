'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { api } from '@/lib/api-client';
import { IMG_PREVIEW_DEFAULT } from '@/lib/placeholder-images';
import { nextCoverIndex } from '@/lib/project-cover';
import { PLACEHOLDER_HINT } from '@/lib/placeholder-provenance';
import { useRouter } from 'next/navigation';
import { Kanban as FolderKanban, Clock, CheckCircle as CheckCircle2, Play, FilmStrip as Film, Plus, Sparkle as Sparkles, MagnifyingGlass as Search, MagicWand as Wand2, Trash as Trash2, Archive, ArrowCounterClockwise as Restore, Warning as AlertTriangle } from '@phosphor-icons/react';
import { getToken } from '@/lib/auth';
import { FilmStripDivider } from '@/components/cinema/primitives';
import { NumberTicker, AnimatedShinyText } from '@/components/cinema/effects';
import { ScoreDonut } from '@/components/cinema/dataviz';
import { readinessLevel } from '@/lib/polish-prompts';
import { projectStatusMeta, type StatusTone } from '@/lib/project-status';
import { LoadErrorState } from '@/components/ui/load-error-state';
import { POSTER_FRAME_CLASS, posterFitFor, type PosterFit } from '@/lib/media-frame';
import { loglineFrom } from '@/lib/logline';

export default function ProjectsPage() {
  const router = useRouter();
  const [projects, setProjects] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  // v12.434:修前 .catch(() => {}) —— 读不到时显示「EMPTY ROSTER · 还没有创作项目」
  // 外加「开始创作 / 导入演示工程」两个按钮,和这个账号真的没有项目**完全一样**。
  const [loadError, setLoadError] = useState<string | null>(null);
  const [filter, setFilter] = useState<'all' | 'completed' | 'active' | 'failed' | 'draft'>('all');
  const [importingDemo, setImportingDemo] = useState(false);

  // v10.5.0: 演示工程一键导入 —— 0 key 也能逛完整成片工作台(Time-to-Wow 专项)
  const importDemo = async () => {
    if (importingDemo) return;
    setImportingDemo(true);
    try {
      const token = typeof window !== 'undefined' ? localStorage.getItem('qfmj-token') : null;
      const res = await fetch('/api/demo-project', {
        method: 'POST',
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (res.ok) {
        const { projectId } = await res.json();
        router.push(`/projects/${projectId}`);
        return;
      }
    } catch { /* 失败落回按钮态 */ }
    setImportingDemo(false);
  };

  useEffect(() => {
    // v5.0.x fix: 走 api-client (带 Authorization), 解析真实登录用户而非 no-auth 兜底.
    // 之前用裸 fetch 无 token → 命中 first-user 兜底; 测试用户污染 DB 后兜底解析错乱, 项目全空.
    // 这里不走 loadList:api-client 的 request() 本来就在 !res.ok 时抛,
    // 该修的只是「抛了却被吞掉」这一下。硬套一层反而多一条路径。
    api.projects()
      .then((d: any) => {
        if (Array.isArray(d)) { setProjects(d); setLoadError(null); }
        else setLoadError('接口返回的格式不对');
      })
      .catch((e: any) => setLoadError(e?.message ? String(e.message) : '网络不通'))
      .finally(() => setLoading(false));
  }, []);

  const [busyId, setBusyId] = useState<string | null>(null);

  const authHeaders = () => { const t = getToken(); return { 'Content-Type': 'application/json', ...(t ? { Authorization: `Bearer ${t}` } : {}) }; };

  const removeProject = async (id: string, title: string) => {
    if (!confirm(`确定删除「${title || '未命名'}」?此操作不可恢复(连同分镜/视频/配音等全部资产)。`)) return;
    setBusyId(id);
    try {
      const res = await fetch(`/api/projects/${encodeURIComponent(id)}`, { method: 'DELETE', headers: authHeaders() });
      if (res.ok) setProjects((ps) => ps.filter((p) => p.id !== id));
    } finally { setBusyId(null); }
  };

  const toggleArchive = async (id: string, archived: boolean) => {
    setBusyId(id);
    try {
      const res = await fetch(`/api/projects/${encodeURIComponent(id)}`, {
        method: 'PATCH', headers: authHeaders(),
        body: JSON.stringify({ status: archived ? 'archived' : 'completed' }),
      });
      if (res.ok) setProjects((ps) => ps.map((p) => (p.id === id ? { ...p, status: archived ? 'archived' : 'completed' } : p)));
    } finally { setBusyId(null); }
  };

  /**
   * v12.433:文案(哪些状态、各叫什么)收在 lib/project-status,这里只挑颜色和图标。
   * 修前这里自带一张词表,**里面没有 failed** —— 而 pipeline-worker 从 v12.21.0 起
   * 就会写这个状态,于是下面 `|| statusConfig.draft` 把失败的项目贴成了「草稿」。
   * 兜底也换掉了:不认识的状态就说不认识,不拿「草稿」替它编故事。
   */
  const TONE: Record<StatusTone, { dotColor: string; bgColor: string; icon: any }> = {
    good: { dotColor: 'bg-emerald-400', bgColor: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20', icon: CheckCircle2 },
    warn: { dotColor: 'bg-[#E8C547]', bgColor: 'bg-[#E8C547]/10 text-[#E8C547] border-[#E8C547]/20', icon: Play },
    bad: { dotColor: 'bg-red-400', bgColor: 'bg-red-500/10 text-red-400 border-red-500/20', icon: AlertTriangle },
    muted: { dotColor: 'bg-gray-400', bgColor: 'bg-gray-500/10 text-gray-400 border-gray-500/20', icon: Clock },
  };
  const statusOf = (status?: string | null) => {
    const meta = projectStatusMeta(status);
    return { label: meta.label, ...TONE[meta.tone] };
  };

  // 「全部」默认不含已下架(下架=从主列表移走);选「已下架」单独看
  const filtered = filter === 'all'
    ? projects.filter(p => p.status !== 'archived')
    : projects.filter(p => p.status === filter);
  const filterOptions = [
    { key: 'all', label: '全部' },
    { key: 'active', label: '创作中' },
    { key: 'completed', label: '已完成' },
    // v12.433:失败的项目此前哪个筛选都进不去(只在「全部」里混着,还顶着草稿标签)
    { key: 'failed', label: '生成失败' },
    { key: 'draft', label: '草稿' },
    { key: 'archived', label: '已下架' },
  ];

  return (
    <div className="cinema-page max-w-6xl mx-auto -mx-[5vw] -my-6 px-[5vw] py-6">
      {/* Header — 影院仪表盘风格 */}
      <div className="flex justify-between items-end mb-6 animate-fade-up gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <AnimatedShinyText className="cinema-eyebrow tracking-widest">FILMOGRAPHY · 项目库</AnimatedShinyText>
            <span className="cinema-mono text-[10px] opacity-50">
              {loadError ? '—' : <NumberTicker value={projects.length} />} titles
            </span>
          </div>
          <h1 className="cinema-headline text-3xl">我的项目</h1>
          <p className="cinema-subhead text-sm mt-1 opacity-70">管理和追踪你的 AI 漫剧创作</p>
        </div>
        <Link href="/dashboard/create" className="cinema-btn cinema-btn-primary !px-5 !py-2.5 !text-[12px] whitespace-nowrap">
          <Plus className="w-4 h-4" weight="bold" />
          新建创作
        </Link>
      </div>

      <FilmStripDivider />

      {/* Filter Bar — cinema chip 风 */}
      <div className="flex items-center gap-1.5 mb-6 mt-4 animate-fade-up" style={{ animationDelay: '0.1s' }}>
        <span className="cinema-eyebrow mr-2">FILTER</span>
        {filterOptions.map(f => {
          const count = projects.filter(p => (f.key === 'all' ? p.status !== 'archived' : p.status === f.key)).length;
          const active = filter === f.key;
          return (
            <button
              key={f.key}
              onClick={() => setFilter(f.key as any)}
              className={`cinema-btn !px-3 !py-1 !text-[11px] ${active ? 'cinema-btn-primary' : ''}`}
            >
              <span>{f.label}</span>
              <span className={`cinema-mono text-[10px] ml-1 tabular-nums ${active ? 'opacity-90' : 'opacity-50'}`}>
                {String(count).padStart(2, '0')}
              </span>
            </button>
          );
        })}
      </div>

      {loading ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 2xl:grid-cols-6 gap-4">
          {[1, 2, 3].map(i => (
            <div key={i} className="cinema-card animate-shimmer">
              <div className={`${POSTER_FRAME_CLASS} bg-[var(--surface)]`} />
              <div className="p-4 space-y-3">
                <div className="h-4 bg-[var(--surface)] rounded w-2/3" />
                <div className="h-3 bg-[var(--surface)] rounded w-full" />
                <div className="h-3 bg-[var(--surface)] rounded w-1/2" />
              </div>
            </div>
          ))}
        </div>
      ) : loadError ? (
        <LoadErrorState what="项目列表" reason={loadError} onRetry={() => window.location.reload()} />
      ) : filtered.length === 0 ? (
        <div className="cinema-card-hi text-center py-16 animate-fade-up px-6">
          <FolderKanban className="w-10 h-10 text-[var(--cinema-amber)] opacity-60 mx-auto mb-4" />
          <div className="cinema-eyebrow tracking-widest mb-2">EMPTY ROSTER</div>
          <p className="cinema-headline text-base mb-1">{filter === 'all' ? '还没有创作项目' : '没有符合条件的项目'}</p>
          <p className="cinema-subhead text-xs mb-5 opacity-65 max-w-md mx-auto">输入你的创意，AI 团队将自动为你完成从剧本到成片的全流程创作</p>
          <div className="flex items-center justify-center gap-3 flex-wrap">
            <Link href="/dashboard/create" className="cinema-btn cinema-btn-primary !text-[12px]">
              <Sparkles className="w-4 h-4" weight="duotone" />
              开始创作
            </Link>
            {/* v10.5.0: 还没配引擎 key?先导入演示工程逛逛完整工作台(分镜/成片/审计/导出全真) */}
            <button onClick={importDemo} disabled={importingDemo} className="cinema-btn !text-[12px] disabled:opacity-60">
              <Film className="w-4 h-4" weight="duotone" />
              {importingDemo ? '导入中…' : '导入演示工程《雨夜信号》'}
            </button>
          </div>
          <p className="cinema-mono text-[10px] opacity-70 mt-3">演示工程无需任何 API key — 4 镜悬疑短剧,成片/审计/导出即刻可看</p>
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 2xl:grid-cols-6 gap-4">
          {filtered.map((p, i) => {
            const sc = statusOf(p.status);
            const StatusIcon = sc.icon;
            // v12.426:covers 是接口给的**有序候选串**(用户定版 → 冻结封面 → 本片分镜 → 本片视频),
            // 前一张加载失败就换下一张,全挂了才退到占位图 —— 而不是一挂就当这片没有画面。
            const coverList: string[] = (p.covers || []).filter(Boolean);
            const shotCount = p.scriptData?.shots?.length || 0;
            const placeholderCount: number = p.placeholderCount || 0;

            return (
              <Link
                key={p.id}
                href={`/projects/${p.id}`}
                className="cinema-card animate-fade-up group"
                style={{ animationDelay: `${0.1 + i * 0.05}s` }}
              >
                {/* v12.436:封面改海报框。修前写死 h-[160px] 横框 —— 库里 84% 的项目是 9:16,
                    一张竖图放进去只看得见 28%。另:修前这个容器**没有 position: relative**,
                    里面的绝对定位徽章实际以整张卡片为基准,v12.431 那三轮「徽章撞版」根子在这。 */}
                <div className={`cover relative overflow-hidden ${POSTER_FRAME_CLASS}`}>
                  <PosterCover coverList={coverList} alt={p.title} />
                  <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-transparent to-transparent" />
                  <div className={`absolute top-3 right-3 max-w-[60%] flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-medium border backdrop-blur-sm ${sc.bgColor}`}>
                    <div className={`w-1.5 h-1.5 rounded-full shrink-0 ${sc.dotColor}`} />
                    <span className="truncate">{sc.label}</span>
                  </div>
                  {/* v11.2.0 管理操作(hover 显示):下架/上架 + 删除 */}
                  <div className="absolute top-3 left-3 flex items-center gap-1.5 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button type="button" disabled={busyId === p.id}
                      onClick={(e) => { e.preventDefault(); e.stopPropagation(); toggleArchive(p.id, p.status !== 'archived'); }}
                      title={p.status === 'archived' ? '恢复到主列表' : '下架(从主列表移走,可恢复)'}
                      className="w-7 h-7 rounded-full bg-black/60 hover:bg-black/80 backdrop-blur-sm flex items-center justify-center text-white/80 hover:text-white border border-white/10">
                      {p.status === 'archived' ? <Restore className="w-3.5 h-3.5" /> : <Archive className="w-3.5 h-3.5" />}
                    </button>
                    <button type="button" disabled={busyId === p.id}
                      onClick={(e) => { e.preventDefault(); e.stopPropagation(); removeProject(p.id, p.title); }}
                      title="删除项目(不可恢复)"
                      className="w-7 h-7 rounded-full bg-black/60 hover:bg-rose-600/80 backdrop-blur-sm flex items-center justify-center text-white/80 hover:text-white border border-white/10">
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                  {/* v12.431:示意计数和「N 镜」放进**同一个绝对定位容器**。
                      前两版分别试过 bottom-3 right-3 和排进页脚 flow —— 都撞版了:
                      「N 镜」这个徽章的定位基准是整张卡片(不是封面),它落在页脚左侧,
                      于是第一版压住 SCORE(显示成「SC⚠9处示意」)、第二版压住「N 镜」。
                      两个绝对定位元素抢同一处,只能让它们共用一个容器。 */}
                  {(shotCount > 0 || placeholderCount > 0) && (
                    <div className="absolute bottom-3 left-3 flex items-center gap-1.5">
                      {shotCount > 0 && (
                        <span className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-black/50 backdrop-blur-sm text-[10px] text-white/80">
                          <Film className="w-3 h-3" />
                          {shotCount} 镜
                        </span>
                      )}
                      {placeholderCount > 0 && (
                        <span
                          className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-500/25 backdrop-blur-sm text-[10px] text-amber-100 border border-amber-300/30"
                          title={PLACEHOLDER_HINT}
                        >
                          <AlertTriangle className="w-3 h-3" />
                          {placeholderCount} 处示意
                        </span>
                      )}
                    </div>
                  )}

                  {/* AIGC 就绪度徽章 — 数据源是 latestPolish.audit.aigcReadiness, 红黄绿一眼看到该项目剧本是否上得了管线 */}
                  <ReadinessBadge entry={p.latestPolish} />
                  {p.latestPolish && !p.latestPolish?.audit?.aigcReadiness?.score ? (
                    <div className="absolute top-3 left-3 flex items-center gap-1 px-2 py-0.5 rounded-full bg-violet-500/40 backdrop-blur-sm text-[10px] text-violet-50 border border-violet-300/30" title="该项目最近润色过, 但未生成 Pro 体检分数">
                      <Sparkles className="w-2.5 h-2.5" />
                      已润色
                    </div>
                  ) : null}
                  {/* 快捷"润色"按钮 — 带原剧本跳到 Polish Studio.
                      仅当项目已有剧本时可见, 避免空项目点进去没东西改。 */}
                  {p.scriptData?.shots?.length > 0 ? (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        router.push(`/dashboard/polish?projectId=${encodeURIComponent(p.id)}`);
                      }}
                      className="absolute bottom-3 right-3 flex items-center gap-1 px-2.5 py-1 rounded-full bg-[#E8C547]/90 hover:bg-[#E8C547] text-black text-[10px] font-semibold shadow-lg shadow-black/30 backdrop-blur-sm transition-all opacity-0 group-hover:opacity-100"
                      title="用 Polish Studio 对该项目剧本做润色/行业诊断"
                    >
                      <Wand2 className="w-3 h-3" />
                      润色
                    </button>
                  ) : null}
                </div>

                {/* Info —— 海报墙只留标题 + 一行梗概。Castloop 那面墙真正的差异点在这:
                    你能读出每个故事**是什么**,不只是叫什么。 */}
                <div className="p-2.5">
                  <h3 className="cinema-headline text-[13px] leading-snug mb-1 line-clamp-1 group-hover:text-[var(--cinema-amber)] transition-colors">{p.title}</h3>
                  <p className="cinema-subhead text-[11px] line-clamp-2 leading-relaxed opacity-60">{loglineOf(p)}</p>
                  {/* v12.431:这个项目里还有几处不是真出图的。此前只有导演台和导出口知道,
                      列表页一片祥和 —— 得逐个点进去才发现哪部片还没真出完。
                      沿用 v12.427 的原则:如实告知,不挡路(不置灰、不拦点击)。
                      **和 SCORE 排在同一行**:第一版给它 absolute bottom-3 right-3,
                      而那是相对整张卡片定位的,实拍出来正好压住 SCORE(显示成「SC⚠9处示意」)。 */}
                  <div className="cinema-mono text-[9.5px] mt-1.5 flex items-center justify-between gap-1">
                    <span className="opacity-40">
                      {new Date(p.createdAt).toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit' }).replace('/', '·')}
                    </span>
                    {p.directorNotes?.overallScore ? (
                      <span className="flex items-center gap-0.5">
                        <span className="text-[var(--cinema-amber)] font-semibold">{p.directorNotes.overallScore}</span>
                        <span className="opacity-40">/100</span>
                      </span>
                    ) : null}
                  </div>
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}

/**
 * 项目卡左上角的"AIGC 管线就绪度"徽章。
 *
 * 数据源: project.latestPolish.audit.aigcReadiness.score
 *   · 没有 latestPolish 或没有 score → 不渲染 (返回 null)
 *   · 有分数 → 用 readinessLevel 映射到 red / amber / green 三档配色
 *
 * 设计目的: 让用户在项目列表一眼看到 "哪个项目剧本已经过 Pro 体检 + 处于什么档位",
 * 决定下一个优先润色或重跑哪个。
 */
function ReadinessBadge({ entry }: { entry: any }) {
  const score = entry?.audit?.aigcReadiness?.score;
  if (typeof score !== 'number') return null;
  const lvl = readinessLevel(score);
  return (
    <div
      className="absolute bottom-2.5 right-11 flex items-center gap-1.5 pl-1 pr-2 py-0.5 rounded-full bg-black/55 backdrop-blur-sm border border-white/10 shadow-sm"
      title={`AIGC 就绪度: ${score}/100 · ${lvl.label}`}
    >
      <ScoreDonut score={score} size={26} thickness={2.6} showCenter={false} />
      <span className="cinema-mono text-[10px] tabular-nums font-semibold text-white/95 leading-none">
        {score}
      </span>
    </div>
  );
}

/**
 * 梗概:优先剧本里的 synopsis,没有再退到项目描述。
 * 在架 11 个项目里 10 个有 synopsis;描述常常就是标题的复述,信息量低。
 */
function loglineOf(p: any): string {
  // 优先 synopsis,其次 description;两者的结构前缀/标题复述由 lib/logline 剥掉
  return loglineFrom({ title: p?.title, scriptData: { synopsis: p?.scriptData?.synopsis }, description: p?.description });
}

/**
 * 海报封面(v12.436)。
 *
 * ① 候选串回退沿用 v12.426:前一张挂了换下一张,全挂才退默认图 —— 改成 React 状态持有下标,
 *    而不是修前那样直接改 DOM 的 img.src(那样背景模糊层跟不上前景换图)。
 * ② 填充方式在**图片加载后按真实比例**决定(posterFitFor):竖图铺满;横图 contain,
 *    并用同一张图模糊铺底 —— 墙面统一、而且一个像素都不裁。
 */
function PosterCover({ coverList, alt }: { coverList: string[]; alt: string }) {
  const [idx, setIdx] = useState(0);
  const [fallback, setFallback] = useState(false);
  const [fit, setFit] = useState<PosterFit>('contain');
  const src = fallback || coverList.length === 0 ? IMG_PREVIEW_DEFAULT : coverList[idx];

  const onError = () => {
    const next = nextCoverIndex(idx, coverList.length);
    if (next !== null) { setIdx(next); return; }
    if (!fallback) setFallback(true);
  };

  return (
    <>
      {fit === 'contain' && (
        // 模糊铺底:横图 contain 之后上下的空白用同一张图填,墙面不出现黑条
        // eslint-disable-next-line @next/next/no-img-element
        <img src={src} alt="" aria-hidden decoding="async"
          className="absolute inset-0 w-full h-full object-cover blur-2xl scale-125 opacity-75 saturate-150" />
      )}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={src}
        alt={alt}
        loading="lazy"
        decoding="async"
        data-poster-fit={fit}
        className={`relative w-full h-full transition-transform duration-500 group-hover:scale-[1.03] ${fit === 'cover' ? 'object-cover' : 'object-contain'}`}
        onLoad={(e) => setFit(posterFitFor(e.currentTarget.naturalWidth, e.currentTarget.naturalHeight))}
        onError={onError}
      />
    </>
  );
}
