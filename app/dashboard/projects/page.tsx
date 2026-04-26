'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { IMG_PREVIEW_DEFAULT } from '@/lib/placeholder-images';
import { useRouter } from 'next/navigation';
import { FolderKanban, Clock, CheckCircle2, Play, Film, Plus, Sparkles, Search, Wand2, Activity } from 'lucide-react';
import { readinessLevel } from '@/lib/polish-prompts';

export default function ProjectsPage() {
  const router = useRouter();
  const [projects, setProjects] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<'all' | 'completed' | 'active' | 'draft'>('all');

  useEffect(() => {
    fetch('/api/projects')
      .then(r => r.json())
      .then(d => { if (Array.isArray(d)) setProjects(d); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const statusConfig: Record<string, { label: string; dotColor: string; bgColor: string; icon: any }> = {
    completed: { label: '已完成', dotColor: 'bg-emerald-400', bgColor: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20', icon: CheckCircle2 },
    active: { label: '创作中', dotColor: 'bg-[#E8C547]', bgColor: 'bg-[#E8C547]/10 text-[#E8C547] border-[#E8C547]/20', icon: Play },
    draft: { label: '草稿', dotColor: 'bg-gray-400', bgColor: 'bg-gray-500/10 text-gray-400 border-gray-500/20', icon: Clock },
  };

  const filtered = filter === 'all' ? projects : projects.filter(p => p.status === filter);
  const filterOptions = [
    { key: 'all', label: '全部' },
    { key: 'active', label: '创作中' },
    { key: 'completed', label: '已完成' },
    { key: 'draft', label: '草稿' },
  ];

  return (
    <div className="max-w-6xl mx-auto">
      {/* Header */}
      <div className="flex justify-between items-start mb-6 animate-fade-up">
        <div>
          <h1 className="text-2xl font-bold text-white">我的项目</h1>
          <p className="text-sm text-[var(--muted)] mt-1">管理和追踪你的 AI 漫剧创作</p>
        </div>
        <Link href="/dashboard/create" className="btn-primary flex items-center gap-2 text-sm">
          <Plus className="w-4 h-4" />
          新建创作
        </Link>
      </div>

      {/* Filter Bar */}
      <div className="flex items-center gap-2 mb-6 animate-fade-up" style={{ animationDelay: '0.1s' }}>
        {filterOptions.map(f => (
          <button
            key={f.key}
            onClick={() => setFilter(f.key as any)}
            className={`chip ${filter === f.key ? 'active' : ''}`}
          >
            {f.label}
            {f.key !== 'all' && (
              <span className="ml-1 opacity-60">
                {projects.filter(p => f.key === 'all' || p.status === f.key).length}
              </span>
            )}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
          {[1, 2, 3].map(i => (
            <div key={i} className="project-card animate-shimmer">
              <div className="h-[160px] bg-[var(--surface)]" />
              <div className="p-4 space-y-3">
                <div className="h-4 bg-[var(--surface)] rounded w-2/3" />
                <div className="h-3 bg-[var(--surface)] rounded w-full" />
                <div className="h-3 bg-[var(--surface)] rounded w-1/2" />
              </div>
            </div>
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-20 animate-fade-up">
          <div className="w-16 h-16 rounded-2xl bg-[var(--surface)] grid place-items-center mx-auto mb-4">
            <FolderKanban className="w-8 h-8 text-[var(--soft)]" />
          </div>
          <p className="text-[var(--muted)] text-sm mb-1">{filter === 'all' ? '还没有创作项目' : '没有符合条件的项目'}</p>
          <p className="text-[var(--soft)] text-xs mb-5">输入你的创意，AI 团队将自动为你完成从剧本到成片的全流程创作</p>
          <Link href="/dashboard/create" className="btn-primary inline-flex items-center gap-2 text-sm">
            <Sparkles className="w-4 h-4" />
            开始创作
          </Link>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
          {filtered.map((p, i) => {
            const sc = statusConfig[p.status] || statusConfig.draft;
            const StatusIcon = sc.icon;
            const cover = p.covers?.[0] || IMG_PREVIEW_DEFAULT;
            const shotCount = p.scriptData?.shots?.length || 0;

            return (
              <Link
                key={p.id}
                href={`/projects/${p.id}`}
                className="project-card animate-fade-up group"
                style={{ animationDelay: `${0.1 + i * 0.05}s` }}
              >
                {/* Cover */}
                <div className="cover h-[160px]">
                  <img src={cover} alt={p.title} className="w-full h-full object-cover" />
                  <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-transparent to-transparent" />
                  <div className={`absolute top-3 right-3 flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-medium border backdrop-blur-sm ${sc.bgColor}`}>
                    <div className={`w-1.5 h-1.5 rounded-full ${sc.dotColor}`} />
                    {sc.label}
                  </div>
                  {shotCount > 0 && (
                    <div className="absolute bottom-3 left-3 flex items-center gap-1 px-2 py-0.5 rounded-full bg-black/50 backdrop-blur-sm text-[10px] text-white/80">
                      <Film className="w-3 h-3" />
                      {shotCount} 镜
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

                {/* Info */}
                <div className="p-4">
                  <h3 className="font-semibold text-white text-[15px] mb-1 truncate group-hover:text-[#E8C547] transition-colors">{p.title}</h3>
                  <p className="text-xs text-[var(--muted)] line-clamp-2 mb-3 leading-relaxed">{p.description}</p>
                  <div className="flex items-center justify-between text-[10px] text-[var(--soft)]">
                    <span className="flex items-center gap-1">
                      <Clock className="w-3 h-3" />
                      {new Date(p.createdAt).toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' })}
                    </span>
                    {p.directorNotes?.overallScore && (
                      <span className="text-amber-400 font-medium">{p.directorNotes.overallScore}/100</span>
                    )}
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
  const palette =
    lvl.level === 'green'
      ? 'bg-emerald-500/85 text-emerald-50 border-emerald-300/40'
      : lvl.level === 'amber'
        ? 'bg-amber-500/85 text-amber-50 border-amber-300/40'
        : 'bg-rose-500/85 text-rose-50 border-rose-300/40';
  return (
    <div
      className={`absolute bottom-3 right-12 flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold border backdrop-blur-sm shadow-sm ${palette}`}
      title={`AIGC 就绪度: ${score}/100 · ${lvl.label}`}
    >
      <Activity className="w-2.5 h-2.5" />
      {score}
    </div>
  );
}
