'use client';

/**
 * ContinueCard (v10.5.4) — dashboard「继续创作」卡(留存面)。
 * 取项目列表 → pickContinueProject 挑最该继续的一部 → 按状态给下一步建议。
 * 空项目态整卡不渲染(验收条款);加载失败静默(留存增强非关键路径)。
 */
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { api } from '@/lib/api-client';
import { pickContinueProject, suggestNextStep, type ProjectLike } from '@/lib/next-step';
import { ArrowRight, FilmSlate } from '@phosphor-icons/react';

const STATUS_LABEL: Record<string, string> = { active: '创作中', draft: '草稿', completed: '已完成' };

export function ContinueCard() {
  const [project, setProject] = useState<(ProjectLike & { covers?: string[] }) | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const d = await api.projects();
        if (alive && Array.isArray(d)) {
          setProject(pickContinueProject(d as ProjectLike[]) as typeof project);
        }
      } catch { /* 留存增强非关键路径,失败静默 */ }
    })();
    return () => { alive = false; };
  }, []);

  if (!project) return null; // 空项目态不显示
  const step = suggestNextStep(project);
  const cover = project.covers?.[0];

  return (
    <Link
      href={`/projects/${encodeURIComponent(project.id)}`}
      className="group mb-4 flex items-center gap-4 rounded-[18px] border border-[var(--border)] bg-[var(--surface)] px-5 py-3.5 hover:border-[#E8C547]/45 transition-colors animate-fade-up"
      data-testid="continue-card"
    >
      {cover ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={cover} alt="" loading="lazy" decoding="async" className="w-16 h-10 rounded-lg object-cover shrink-0 border border-white/10" />
      ) : (
        <span className="w-16 h-10 rounded-lg grid place-items-center bg-[#E8C547]/10 shrink-0">
          <FilmSlate className="w-4 h-4 text-[#E8C547]" weight="duotone" />
        </span>
      )}
      <span className="min-w-0 flex-1">
        <span className="block text-[10px] font-mono tracking-[0.22em] uppercase text-[#E8C547]/75 mb-0.5">
          继续创作 · {STATUS_LABEL[project.status || ''] || project.status}
        </span>
        <span className="block text-sm font-semibold text-white truncate">{project.title || project.id}</span>
        <span className="block text-xs text-[var(--muted)] truncate">{step.hint}</span>
      </span>
      <span className="shrink-0 inline-flex items-center gap-1.5 text-xs font-semibold text-[#E8C547] whitespace-nowrap">
        {step.label}
        <ArrowRight className="w-3.5 h-3.5 transition-transform group-hover:translate-x-0.5" />
      </span>
    </Link>
  );
}
