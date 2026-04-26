'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { api } from '@/lib/api-client';
import { GlassCard } from '@/components/ui/glass-card';
import { Sparkles, FolderKanban, Zap, BookOpen, ArrowRight, Clock, Film, TrendingUp } from 'lucide-react';

export default function DashboardPage() {
  const [metrics, setMetrics] = useState({ projects: 0, generations: 0, cases: 0, uptime: 0 });
  const [generations, setGenerations] = useState<any[]>([]);

  useEffect(() => {
    api.metrics().then((d: any) => setMetrics(d)).catch(() => {});
    api.generations().then((d: any) => setGenerations(d.slice(0, 4))).catch(() => {});
  }, []);

  return (
    <div className="max-w-6xl mx-auto">
      {/* Hero Header */}
      <div className="mb-8 animate-fade-up">
        <div className="flex items-center gap-2 mb-1">
          <div className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
          <span className="text-xs text-emerald-400 font-medium">系统在线</span>
        </div>
        <h1 className="text-3xl font-bold text-white mb-2">创作总览</h1>
        <p className="text-sm text-[var(--muted)]">AI 多智能体协作引擎，从创意到成片的一站式漫剧生产线</p>
      </div>

      {/* Quick Action Banner */}
      <Link
        href="/dashboard/create"
        className="block mb-8 p-5 rounded-2xl bg-gradient-to-r from-[#E8C547]/08 via-[#D4A830]/08 to-[#4A7EBB]/06 border border-[#E8C547]/20 hover:border-[#E8C547]/40 transition-all group animate-fade-up"
        style={{ animationDelay: '0.1s' }}
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-[#E8C547] to-[#D4A830] grid place-items-center shadow-lg shadow-[#E8C547]/15">
              <Sparkles className="w-6 h-6 text-white" />
            </div>
            <div>
              <div className="text-white font-semibold text-lg">开始创作</div>
              <div className="text-[var(--muted)] text-sm">输入创意，AI 七人团队自动接力创作</div>
            </div>
          </div>
          <ArrowRight className="w-5 h-5 text-[var(--muted)] group-hover:text-white group-hover:translate-x-1 transition-all" />
        </div>
      </Link>

      {/* Stat Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-8">
        {[
          { label: '我的项目', value: metrics.projects, icon: FolderKanban, color: 'rose', sub: '创作中的漫剧项目' },
          { label: '生成次数', value: metrics.generations, icon: Zap, color: 'pink', sub: '累计 AI 生成调用' },
          { label: '案例库', value: metrics.cases, icon: BookOpen, color: 'cyan', sub: '可参考的模版案例' },
        ].map((c, i) => {
          const colorMap: Record<string, string> = {
            purple: 'from-[#E8C547]/15 to-[#E8C547]/05 border-[#E8C547]/10',
            pink: 'from-[#D4A830]/15 to-pink-500/5 border-[#D4A830]/08',
            cyan: 'from-cyan-500/20 to-cyan-500/5 border-cyan-500/10',
          };
          const iconColorMap: Record<string, string> = {
            purple: 'bg-[#E8C547]/15 text-[#E8C547]',
            pink: 'bg-pink-500/15 text-pink-400',
            cyan: 'bg-cyan-500/15 text-cyan-400',
          };
          return (
            <div
              key={c.label}
              className={`bg-gradient-to-br ${colorMap[c.color]} border rounded-2xl p-5 flex flex-col gap-3 animate-fade-up hover:scale-[1.02] transition-transform`}
              style={{ animationDelay: `${0.15 + i * 0.08}s` }}
            >
              <div className="flex items-center justify-between">
                <span className="text-sm text-[var(--muted)] font-medium">{c.label}</span>
                <div className={`w-9 h-9 rounded-xl ${iconColorMap[c.color]} grid place-items-center`}>
                  <c.icon className="w-4 h-4" />
                </div>
              </div>
              <strong className="text-3xl font-bold text-white">{c.value}</strong>
              <small className="text-[var(--soft)] text-xs">{c.sub}</small>
            </div>
          );
        })}
      </div>

      {/* Content Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
        {/* Recent Generations */}
        <div className="lg:col-span-3 animate-fade-up" style={{ animationDelay: '0.3s' }}>
          <GlassCard>
            <div className="flex items-center justify-between mb-5">
              <div className="flex items-center gap-2">
                <Film className="w-4 h-4 text-[#E8C547]" />
                <h3 className="font-semibold text-white">最近创作</h3>
              </div>
              <Link href="/dashboard/projects" className="text-xs text-[var(--muted)] hover:text-white transition-colors flex items-center gap-1">
                查看全部 <ArrowRight className="w-3 h-3" />
              </Link>
            </div>
            <div className="space-y-3">
              {generations.length > 0 ? generations.map((item) => (
                <div key={item.id} className="flex gap-3 items-center bg-[var(--surface)] hover:bg-[var(--surface-strong)] rounded-xl p-3 transition-all group cursor-pointer">
                  <div className="w-16 h-16 rounded-xl overflow-hidden shrink-0 bg-black/20">
                    {item.resultUrls?.[0] ? (
                      <img src={item.resultUrls[0]} alt={item.prompt} className="w-full h-full object-cover group-hover:scale-105 transition-transform" />
                    ) : (
                      <div className="w-full h-full grid place-items-center text-[var(--soft)]"><Film className="w-5 h-5" /></div>
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <h4 className="font-medium text-sm text-white truncate">{item.style || item.prompt?.slice(0, 20)}</h4>
                    <p className="text-xs text-[var(--muted)] mt-0.5 line-clamp-1">{item.prompt}</p>
                    <div className="flex items-center gap-2 mt-1.5">
                      <span className={`inline-flex px-2 py-0.5 rounded-full text-[10px] font-medium ${
                        item.status === 'completed' ? 'badge-completed' : item.status === 'active' ? 'badge-active' : 'badge-draft'
                      }`}>{item.status === 'completed' ? '已完成' : item.status === 'active' ? '创作中' : '草稿'}</span>
                    </div>
                  </div>
                </div>
              )) : (
                <div className="text-center py-10 text-[var(--soft)]">
                  <Sparkles className="w-8 h-8 mx-auto mb-2 opacity-30" />
                  <p className="text-sm">还没有创作记录</p>
                  <Link href="/dashboard/create" className="text-xs text-[#E8C547] hover:text-[#D4A830] mt-1 inline-block">开始第一次创作 →</Link>
                </div>
              )}
            </div>
          </GlassCard>
        </div>

        {/* Activity & Status */}
        <div className="lg:col-span-2 space-y-6 animate-fade-up" style={{ animationDelay: '0.4s' }}>
          <GlassCard>
            <div className="flex items-center gap-2 mb-4">
              <TrendingUp className="w-4 h-4 text-emerald-400" />
              <h3 className="font-semibold text-white text-sm">系统状态</h3>
            </div>
            <div className="space-y-3">
              {[
                { label: 'AI 引擎', status: 'Claude 4 Opus + Veo 3.1', color: 'emerald' },
                { label: '图像生成', status: 'Midjourney v6.1 / Minimax', color: 'rose' },
                { label: '视频生成', status: 'Google Veo 3.1', color: 'pink' },
              ].map((s) => (
                <div key={s.label} className="flex items-center justify-between py-2 border-b border-[var(--border)] last:border-0">
                  <span className="text-xs text-[var(--muted)]">{s.label}</span>
                  <div className="flex items-center gap-1.5">
                    <div className={`w-1.5 h-1.5 rounded-full bg-${s.color}-400`} />
                    <span className="text-xs text-white font-medium">{s.status}</span>
                  </div>
                </div>
              ))}
            </div>
          </GlassCard>

          <GlassCard>
            <div className="flex items-center gap-2 mb-4">
              <Clock className="w-4 h-4 text-amber-400" />
              <h3 className="font-semibold text-white text-sm">最近动态</h3>
            </div>
            <div className="space-y-2">
              {[
                { text: '剧本智能拆解完成', time: '5 分钟前', dot: 'bg-emerald-400' },
                { text: '镜头 12 渲染成功', time: '25 分钟前', dot: 'bg-[#E8C547]' },
                { text: '分镜一致性检查通过', time: '1 小时前', dot: 'bg-cyan-400' },
              ].map((a) => (
                <div key={a.text} className="flex items-start gap-3 py-2">
                  <div className={`w-2 h-2 rounded-full ${a.dot} mt-1.5 shrink-0`} />
                  <div className="flex-1">
                    <span className="text-[13px] text-white">{a.text}</span>
                    <div className="text-[11px] text-[var(--soft)] mt-0.5">{a.time}</div>
                  </div>
                </div>
              ))}
            </div>
          </GlassCard>
        </div>
      </div>
    </div>
  );
}
