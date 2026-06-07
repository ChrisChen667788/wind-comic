'use client';

import { useState, useEffect } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { motion } from 'framer-motion';
import { ArrowLeft, FileText, Users, Mountains as Mountain, FilmStrip as Film, Video, Play, Scissors, Star, CheckCircle as CheckCircle2, Warning as AlertTriangle, Pencil, FloppyDisk as Save, X, ChatCircle as MessageCircle, ChartBar as BarChart3, FilmSlate as Clapperboard, Scan as ScanEye, MonitorPlay, LinkSimple as Link2, Gauge, BracketsCurly as Braces, Megaphone, MagicWand } from '@phosphor-icons/react';
import { CameoPanel } from '@/components/CameoPanel';
import { DistributionPanel } from '@/components/project/distribution-panel';
import { CoverCandidatesPanel } from '@/components/project/cover-candidates-panel';
import { DirectorConsole } from '@/components/director-console';
import LatestPolishBanner from '@/components/polish/LatestPolishBanner';
import ProjectChatSidebar, { ChatLauncherButton } from '@/components/agent-chat-sidebar';
import { CameoBadge, CameoSummary } from '@/components/cameo/CameoStoryboardWidgets';
import { Eyebrow, TimecodeChip, FilmStripDivider } from '@/components/cinema/primitives';
import { ExportResolutionDropdown } from '@/components/project/export-resolution-dropdown';
import { PlatformExportDropdown } from '@/components/project/platform-export-dropdown';
import { ShotWorkshopTab } from '@/components/project/shot-workshop-tab';
import { CommentThread } from '@/components/collab/comment-thread';
import { PresenceAvatars } from '@/components/collab/presence-avatars';
import { buildTargetId } from '@/lib/comments-shared';
import { useAuth } from '@/components/auth-provider';
import { PacingChart } from '@/components/project/pacing-chart';
import { ReviewStatusBadge } from '@/components/project/review-status-badge';
import dynamic from 'next/dynamic';
import { VisionAuditTab } from '@/components/project/vision-audit-tab';
import { OneClickFilmPanel } from '@/components/project/oneclick-film-panel';
import { CostAttributionPanel } from '@/components/project/cost-attribution-panel';
import { SaveTemplateButton } from '@/components/project/save-template-button';
import { InviteProjectButton } from '@/components/project/invite-project-button';
import { ShotCinematographyModal } from '@/components/project/shot-cinematography-modal';
import { seedSpecFromCameraAngle, normalizeShotSpec, describeShotSpec, type ShotSpec } from '@/lib/cinematography';
import { ContinuityConsole } from '@/components/project/continuity-console';
import { ProjectFormatBar } from '@/components/project/project-format-bar';
import { EmotionRhythmChart } from '@/components/project/emotion-rhythm-chart';
import { computeEmotionCurve } from '@/lib/emotion-curve';
import { MonitorTab } from '@/components/project/monitor-tab';
import { ParamLinkagePanel } from '@/components/project/param-linkage-panel';

// 代码分割:时间线是 projects 详情页里最重的组件(~1182 行 + 拖拽/音频依赖),
// 且仅在 activeTab==='timeline' 时渲染 → 动态懒加载,移出首屏 bundle。
// ssr:false:纯客户端组件,无需服务端渲染。
const CinemaTimeline = dynamic(
  () => import('@/components/project/cinema-timeline').then((m) => m.CinemaTimeline),
  { ssr: false, loading: () => <div className="p-8 text-center text-sm opacity-60">加载时间线…</div> },
);

function isVideoUrl(url: string): boolean {
  if (!url) return false;
  if (url.startsWith('data:image') || url.startsWith('data:')) return false;
  if (/\.(mp4|webm|mov|avi|mkv|m3u8|ts)(\?|#|$)/i.test(url)) return true;
  if (/oss.*aliyuncs\.com|cos\..+myqcloud\.com|vod\.|video\./i.test(url)) return true;
  if (url.startsWith('http') && !/\.(jpg|jpeg|png|gif|svg|webp|bmp|ico|tiff)(\?|#|$)/i.test(url)) return true;
  return false;
}

export default function ProjectDetailPage() {
  const params = useParams();
  const id = params.id as string;
  const { user } = useAuth();
  const [project, setProject] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<string>('script');
  const [playingIndex, setPlayingIndex] = useState<number>(-1);

  // Editing state
  const [editingShot, setEditingShot] = useState<number | null>(null);
  const [editingCharacter, setEditingCharacter] = useState<string | null>(null);
  const [shotDraft, setShotDraft] = useState<{ sceneDescription: string; dialogue: string; emotion: string }>({ sceneDescription: '', dialogue: '', emotion: '' });
  const [characterDraft, setCharacterDraft] = useState<string>('');
  const [saving, setSaving] = useState(false);
  // AI 助手侧栏开关 — alt+/ 也能呼出
  const [chatOpen, setChatOpen] = useState(false);
  // Sprint A.4 批量重生进行中标记
  const [batchRetrying, setBatchRetrying] = useState(false);
  const [batchRetryMsg, setBatchRetryMsg] = useState<string>('');
  // v7.2 单镜头摄影台: 当前打开的分镜 + 本地已保存机位覆盖 (省一次全量刷新)
  const [cinemaShot, setCinemaShot] = useState<{ shotNumber: number; title?: string; spec: ShotSpec; emotion?: string } | null>(null);
  const [specOverrides, setSpecOverrides] = useState<Record<number, ShotSpec>>({});

  useEffect(() => {
    fetch(`/api/projects/${id}`)
      .then(r => r.json())
      .then(d => { if (d.id) setProject(d); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [id]);

  const startEditShot = (shotIndex: number, shot: any) => {
    setEditingShot(shotIndex);
    setShotDraft({
      sceneDescription: shot.sceneDescription || '',
      dialogue: shot.dialogue || '',
      emotion: shot.emotion || '',
    });
  };

  const cancelEditShot = () => {
    setEditingShot(null);
    setShotDraft({ sceneDescription: '', dialogue: '', emotion: '' });
  };

  const saveShot = async (shotIndex: number) => {
    if (!project) return;
    const assets = project.assets || [];
    const scriptAsset = assets.find((a: any) => a.type === 'script');
    if (!scriptAsset) return;

    const script = project.scriptData || scriptAsset?.data;
    if (!script) return;

    const updatedShots = (script.shots || []).map((s: any, i: number) =>
      i === shotIndex ? { ...s, ...shotDraft } : s
    );
    const updatedData = { ...scriptAsset.data, shots: updatedShots };

    setSaving(true);
    try {
      const res = await fetch(`/api/projects/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ assetId: scriptAsset.id, data: updatedData }),
      });
      if (res.ok) {
        setProject((prev: any) => ({
          ...prev,
          scriptData: prev.scriptData
            ? { ...prev.scriptData, shots: updatedShots }
            : prev.scriptData,
          assets: prev.assets.map((a: any) =>
            a.id === scriptAsset.id ? { ...a, data: updatedData } : a
          ),
        }));
        setEditingShot(null);
      }
    } catch (e) {
      console.error('Failed to save shot:', e);
    } finally {
      setSaving(false);
    }
  };

  const startEditCharacter = (characterId: string, description: string) => {
    setEditingCharacter(characterId);
    setCharacterDraft(description || '');
  };

  const cancelEditCharacter = () => {
    setEditingCharacter(null);
    setCharacterDraft('');
  };

  const saveCharacter = async (characterId: string) => {
    if (!project) return;
    const assets = project.assets || [];
    const charAsset = assets.find((a: any) => a.id === characterId);
    if (!charAsset) return;

    const updatedData = { ...charAsset.data, description: characterDraft };

    setSaving(true);
    try {
      const res = await fetch(`/api/projects/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ assetId: characterId, data: updatedData }),
      });
      if (res.ok) {
        setProject((prev: any) => ({
          ...prev,
          assets: prev.assets.map((a: any) =>
            a.id === characterId ? { ...a, data: updatedData } : a
          ),
        }));
        setEditingCharacter(null);
      }
    } catch (e) {
      console.error('Failed to save character:', e);
    } finally {
      setSaving(false);
    }
  };

  if (loading) return (
    <div className="min-h-screen bg-[var(--background)] text-white grid place-items-center">
      <div className="flex flex-col items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-[#E8C547] to-[#D4A830] grid place-items-center animate-pulse">
          <Film className="w-5 h-5 text-white" />
        </div>
        <div className="text-sm text-[var(--muted)]">加载项目中...</div>
      </div>
    </div>
  );
  if (!project) return (
    <div className="min-h-screen bg-[var(--background)] text-white grid place-items-center">
      <div className="text-[var(--muted)]">项目不存在</div>
    </div>
  );

  const assets = project.assets || [];
  const scriptAsset = assets.find((a: any) => a.type === 'script');
  const characters = assets.filter((a: any) => a.type === 'character');
  const scenes = assets.filter((a: any) => a.type === 'scene');
  const storyboards = assets.filter((a: any) => a.type === 'storyboard').sort((a: any, b: any) => (a.shotNumber || 0) - (b.shotNumber || 0));
  // v9.4.6: 一键成片闭环要用的「镜号→分镜 prompt」(防御式取, 取不到的镜面板会跳过)
  const shotPrompts = storyboards.map((s: any) => ({
    shotNumber: s.shotNumber || 0,
    prompt: s.prompt || (s.data && typeof s.data === 'object' ? s.data.prompt : '') || '',
  }));
  const videos = assets.filter((a: any) => a.type === 'video').sort((a: any, b: any) => (a.shotNumber || 0) - (b.shotNumber || 0));
  const timeline = assets.find((a: any) => a.type === 'timeline');
  const review = project.directorNotes;
  const script = project.scriptData || scriptAsset?.data;

  const tabs = [
    // v6.4: 导演台 — 全链路环节总览 + 跳转编辑
    { key: 'director', label: '导演台', icon: MonitorPlay, count: 0 },
    { key: 'script', label: '剧本', icon: FileText, count: script?.shots?.length || 0 },
    { key: 'characters', label: '角色', icon: Users, count: characters.length },
    { key: 'scenes', label: '场景', icon: Mountain, count: scenes.length },
    { key: 'storyboard', label: '分镜', icon: Film, count: storyboards.length },
    // v7.3: 连贯性 + 种子锁控制台 (对标 Continuity Pro)
    { key: 'continuity', label: '连贯性', icon: Link2, count: 0 },
    { key: 'videos', label: '视频', icon: Video, count: videos.length },
    // v2.16 P1.4: 镜头工坊 — 4K 重渲 / 首尾帧 / 多分辨率导出 集中入口
    { key: 'workshop', label: '镜头工坊', icon: Scissors, count: videos.length },
    // v3.1 F: Cinema 时间线 — 拖拽重排 + 时长调整
    { key: 'timeline', label: 'Cinema 时间线', icon: Clapperboard, count: script?.shots?.length || 0 },
    // v2.21 P1.4: 节奏分析 — 每镜冲突分 + 反转标记 + 警告/建议
    { key: 'pacing', label: '节奏分析', icon: BarChart3, count: script?.pacingReport?.warnings?.length || 0 },
    // v3.4.1: 成片质检 — 每镜画面对剧本的 Vision 评分
    { key: 'vision-audit', label: '成片质检', icon: ScanEye, count: 0 },
    { key: 'oneclick', label: '一键成片', icon: MagicWand, count: 0 },
    // v8.0: 技术监看台 — 视频示波器 + EDL/XML 出片对接
    { key: 'monitor', label: '技术监看', icon: Gauge, count: 0 },
    // v8.2: 参数联动 — JSON ↔ 可视化同步
    { key: 'param-linkage', label: '参数联动', icon: Braces, count: 0 },
    // v3.0 P0.1: 评论协作 — 项目级讨论 + 提及通知
    { key: 'comments', label: '评论协作', icon: MessageCircle, count: 0 },
    // v9.1.2: 多平台分发 / 变现
    { key: 'distribution', label: '分发', icon: Megaphone, count: 0 },
    { key: 'play', label: '完整播放', icon: Play, count: 0 },
  ];

  return (
    <div className="cinema-page min-h-screen text-white">
      {/* Nav — 影院风:左侧返回 + 项目"场记板"标题 + 右侧综合评分仪表 */}
      <nav className="sticky top-0 z-50 bg-[var(--cinema-surface)]/85 backdrop-blur-xl border-b border-[var(--cinema-border)]">
        <div className="max-w-6xl mx-auto px-6 py-3 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0">
            <Link href="/dashboard/projects" className="cinema-btn-ghost cinema-btn !p-2">
              <ArrowLeft className="w-4 h-4" />
            </Link>
            <div className="min-w-0">
              <div className="flex items-center gap-2 mb-0.5">
                <span className="cinema-eyebrow">PROJECT</span>
                <span className="cinema-mono text-[10px] opacity-50">· {project.id?.slice(-8) || '——'}</span>
              </div>
              <div className="cinema-headline text-lg truncate">{project.title}</div>
            </div>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            {/* v3.0 P0.2: presence — 现在谁在看这个项目 (Yjs awareness)
                v3.1.3 P3: 透传 activeTab → 别人头像下方显示"在 镜头工坊"等 chip */}
            {user && (
              <PresenceAvatars
                projectId={id}
                currentUser={{ id: user.id, name: user.name, avatarUrl: user.avatarUrl || null }}
                activeTab={activeTab}
              />
            )}
            {/* v3.x P0.3 E.3: 审批状态 badge */}
            <ReviewStatusBadge projectId={id} currentUserId={user?.id} />
            {/* v3.x: 邀请协作者 (仅 owner 显示) */}
            <InviteProjectButton
              projectId={id}
              isOwner={!!user && (project?.userId === user.id || project?.user_id === user.id)}
            />
            <span className={`cinema-chip ${project.status === 'completed' ? 'cinema-chip-green' : 'cinema-chip-amber'}`}>
              <span className="cinema-statusbar-dot" style={{ background: project.status === 'completed' ? 'var(--cinema-green)' : 'var(--cinema-amber)' }} />
              {project.status === 'completed' ? 'COMPLETED' : 'IN PRODUCTION'}
            </span>
            {review && (
              <div className="cinema-chip cinema-chip-amber">
                <Star className="w-3 h-3" />
                <span className="cinema-mono">{review.overallScore}<span className="opacity-50">/100</span></span>
              </div>
            )}
            {/* v2.16 P0.2: 4K 导出 dropdown — 点开选分辨率, plan-gate 在 route 层最终校验 */}
            <ExportResolutionDropdown projectId={id} />
            {/* v3.5.1: 平台导出 — 抖音/快手/小红书 横竖屏 + 平台字幕 */}
            <PlatformExportDropdown projectId={id} />
          </div>
        </div>
      </nav>

      <main className="max-w-6xl mx-auto px-6 py-8">
        {/* v9.2.3 P4.1: editorial split 头部 — 杂志感非对称双栏 (宽标题栏 + 竖线分隔的 meta deck) */}
        <motion.header
          initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
          className="mb-8 grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_auto] gap-6 lg:gap-10 items-start"
        >
          <div className="min-w-0">
            <div className="flex items-center gap-2 mb-2">
              <span className="cinema-eyebrow">PROJECT</span>
              <span className="cinema-mono text-[10px] opacity-50">· {project.id?.slice(-8) || '——'}</span>
            </div>
            <h1 className="cinema-headline text-3xl sm:text-4xl leading-[1.1] tracking-tight">{project.title}</h1>
            {script?.synopsis && (
              <p className="mt-3 text-sm text-[var(--muted)] leading-relaxed max-w-2xl">{script.synopsis}</p>
            )}
            {script?.theme && (
              <p className="mt-2 text-xs text-[var(--primary)]">主题 · {script.theme}</p>
            )}
          </div>
          <dl className="lg:border-l lg:border-[var(--border)] lg:pl-8 grid grid-cols-2 lg:grid-cols-1 gap-x-8 gap-y-3 shrink-0">
            {[
              { label: '镜头', value: String(script?.shots?.length ?? 0) },
              { label: '角色', value: String(Array.isArray(project.lockedCharacters) ? project.lockedCharacters.length : 0) },
              { label: '评分', value: review ? `${review.overallScore}/100` : '—' },
              { label: '状态', value: project.status === 'completed' ? '已完成' : '制作中' },
            ].map((m) => (
              <div key={m.label}>
                <dt className="cinema-eyebrow !text-[9px] opacity-50">{m.label}</dt>
                <dd className="cinema-mono text-base tabular-nums mt-0.5">{m.value}</dd>
              </div>
            ))}
          </dl>
        </motion.header>

        {/* v2.11: 最近一次润色的行业体检单 (如果有) */}
        {scriptAsset?.data?.latestPolish ? (
          <LatestPolishBanner entry={scriptAsset.data.latestPolish} projectId={id} />
        ) : null}

        {/* v2.12 Phase 1: 多角色锁脸预览 — cinema redesign */}
        {Array.isArray(project.lockedCharacters) && project.lockedCharacters.length > 0 && (
          <div className="cinema-card-hi p-4 mb-4">
            <div className="flex items-center justify-between mb-3">
              <Eyebrow>Cast Lock · 已锁定 {project.lockedCharacters.length} 角色</Eyebrow>
              <span className="cinema-mono text-[10px] opacity-50">全片脸部一致性</span>
            </div>
            <div className="flex gap-2 flex-wrap">
              {project.lockedCharacters.map((c: any, idx: number) => {
                const roleLabel = ({ lead: 'LEAD', antagonist: 'ANTAGONIST', supporting: 'SUPPORTING', cameo: 'CAMEO' } as Record<string, string>)[c.role] || c.role || 'CAST';
                return (
                  <div key={idx} className="flex items-center gap-2 px-2 py-1.5 cinema-card border border-[var(--cinema-border-hi)]">
                    <span className="cinema-mono text-[10px] opacity-60 w-5 text-center">{String.fromCharCode(65 + idx)}</span>
                    <img src={c.imageUrl} alt={c.name} className="w-9 h-9 object-cover" style={{ borderRadius: 3 }} loading="lazy" />
                    <div className="text-xs leading-tight">
                      <div className="cinema-headline text-[12px]">{c.name}</div>
                      <div className="cinema-mono text-[9px] opacity-60">{roleLabel} · cw={c.cw}</div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* v2.10 A: Cameo 主角脸锁定闭环 (单角色 — 兜底入口,Phase 1 先与多角色并存) */}
        <CameoPanel
          projectId={id}
          initialUrl={project.primaryCharacterRef}
          onChange={(nextUrl) => setProject((prev: any) => ({ ...prev, primaryCharacterRef: nextUrl }))}
        />

        {/* Tabs — cinema clipboard 切换条 */}
        <div className="flex items-center gap-0.5 mb-6 cinema-card overflow-x-auto p-1 w-fit">
          {tabs.map(t => (
            <button
              key={t.key}
              onClick={() => setActiveTab(t.key)}
              className={`flex items-center gap-1.5 px-3 py-1.5 text-xs whitespace-nowrap transition-colors ${
                activeTab === t.key
                  ? 'bg-[var(--cinema-amber)] text-black font-semibold'
                  : 'text-[var(--cinema-text-2)] hover:text-[var(--cinema-text)] hover:bg-[var(--cinema-surface-2)]'
              }`}
              style={{ borderRadius: 3 }}
            >
              <t.icon className="w-3 h-3" />
              <span>{t.label}</span>
              {t.count > 0 && <span className="cinema-mono text-[9px] opacity-70 tabular-nums">{String(t.count).padStart(2, '0')}</span>}
            </button>
          ))}
        </div>

        {/* Content */}
        <motion.div key={activeTab} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
          {/* v6.4: 导演台 — 全链路环节总览 */}
          {activeTab === 'director' && (
            <DirectorConsole
              assets={assets}
              onEditStage={(tab) => setActiveTab(tab)}
              projectId={id}
              onReran={() => {
                fetch(`/api/projects/${id}`).then((r) => r.json()).then((d) => { if (d?.id) setProject(d); }).catch(() => {});
              }}
            />
          )}

          {/* 剧本 */}
          {activeTab === 'script' && script && (
            <div className="space-y-3">
              {(script.shots || []).map((shot: any, i: number) => (
                <div key={i} className="bg-white/5 border border-white/10 rounded-xl p-4">
                  <div className="flex items-center gap-2 mb-2">
                    <span className="px-2 py-0.5 rounded-full bg-[#E8C547]/20 text-[#E8C547] text-[10px] font-medium">镜头 {shot.shotNumber || i + 1}</span>
                    {shot.act && <span className="text-[10px] text-gray-500">第{shot.act}幕</span>}
                    {shot.emotion && editingShot !== i && <span className="text-[10px] text-gray-500">{shot.emotion}</span>}
                    {shot.duration && <span className="text-[10px] text-gray-500">{shot.duration}s</span>}
                    <div className="ml-auto">
                      {editingShot === i ? (
                        <div className="flex items-center gap-1.5">
                          <button
                            onClick={() => saveShot(i)}
                            disabled={saving}
                            className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-[#E8C547]/20 text-[#E8C547] border border-[#E8C547]/30 text-xs hover:bg-[#E8C547]/30 transition-colors disabled:opacity-50"
                          >
                            <Save className="w-3 h-3" />
                            保存
                          </button>
                          <button
                            onClick={cancelEditShot}
                            className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-white/5 text-gray-400 border border-white/10 text-xs hover:bg-white/10 transition-colors"
                          >
                            <X className="w-3 h-3" />
                            取消
                          </button>
                        </div>
                      ) : (
                        <button
                          onClick={() => startEditShot(i, shot)}
                          className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-white/5 text-gray-400 border border-white/10 text-xs hover:bg-white/10 hover:text-white transition-colors"
                        >
                          <Pencil className="w-3 h-3" />
                          编辑
                        </button>
                      )}
                    </div>
                  </div>

                  {editingShot === i ? (
                    <div className="space-y-2.5 mt-2">
                      <div>
                        <label className="block text-[10px] text-gray-500 mb-1">场景描述</label>
                        <textarea
                          value={shotDraft.sceneDescription}
                          onChange={e => setShotDraft(d => ({ ...d, sceneDescription: e.target.value }))}
                          rows={3}
                          className="w-full bg-black/30 border border-white/15 rounded-lg px-3 py-2 text-sm text-gray-200 resize-none focus:outline-none focus:border-[#E8C547]/50"
                        />
                      </div>
                      <div>
                        <label className="block text-[10px] text-gray-500 mb-1">对白</label>
                        <textarea
                          value={shotDraft.dialogue}
                          onChange={e => setShotDraft(d => ({ ...d, dialogue: e.target.value }))}
                          rows={2}
                          className="w-full bg-black/30 border border-white/15 rounded-lg px-3 py-2 text-sm text-cyan-300 resize-none focus:outline-none focus:border-[#E8C547]/50"
                        />
                      </div>
                      <div>
                        <label className="block text-[10px] text-gray-500 mb-1">情绪</label>
                        <input
                          type="text"
                          value={shotDraft.emotion}
                          onChange={e => setShotDraft(d => ({ ...d, emotion: e.target.value }))}
                          className="w-full bg-black/30 border border-white/15 rounded-lg px-3 py-2 text-sm text-gray-200 focus:outline-none focus:border-[#E8C547]/50"
                        />
                      </div>
                    </div>
                  ) : (
                    <>
                      <p className="text-sm text-gray-300">{shot.sceneDescription}</p>
                      {shot.dialogue && <p className="text-xs text-cyan-400 mt-1.5 italic">「{shot.dialogue}」</p>}
                      {shot.beat && <p className="text-[10px] text-gray-500 mt-1">节拍：{shot.beat}</p>}
                    </>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* 角色 */}
          {activeTab === 'characters' && (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {characters.map((c: any) => (
                <div key={c.id} className="bg-white/5 border border-white/10 rounded-xl overflow-hidden">
                  {c.mediaUrls?.[0] && (
                    <img src={c.mediaUrls[0]} alt={c.name} className="w-full h-[200px] object-cover" />
                  )}
                  <div className="p-4">
                    <h3 className="font-semibold text-white mb-1">{c.name}</h3>
                    {editingCharacter === c.id ? (
                      <div className="space-y-2 mt-2">
                        <textarea
                          value={characterDraft}
                          onChange={e => setCharacterDraft(e.target.value)}
                          rows={4}
                          className="w-full bg-black/30 border border-white/15 rounded-lg px-3 py-2 text-xs text-gray-300 resize-none focus:outline-none focus:border-[#E8C547]/50"
                        />
                        <div className="flex items-center gap-1.5">
                          <button
                            onClick={() => saveCharacter(c.id)}
                            disabled={saving}
                            className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-[#E8C547]/20 text-[#E8C547] border border-[#E8C547]/30 text-xs hover:bg-[#E8C547]/30 transition-colors disabled:opacity-50"
                          >
                            <Save className="w-3 h-3" />
                            保存
                          </button>
                          <button
                            onClick={cancelEditCharacter}
                            className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-white/5 text-gray-400 border border-white/10 text-xs hover:bg-white/10 transition-colors"
                          >
                            <X className="w-3 h-3" />
                            取消
                          </button>
                        </div>
                      </div>
                    ) : (
                      <>
                        <p className="text-xs text-gray-400">{c.data?.description}</p>
                        <button
                          onClick={() => startEditCharacter(c.id, c.data?.description || '')}
                          className="flex items-center gap-1 mt-3 px-2.5 py-1 rounded-lg bg-white/5 text-gray-400 border border-white/10 text-xs hover:bg-white/10 hover:text-white transition-colors"
                        >
                          <Pencil className="w-3 h-3" />
                          编辑描述
                        </button>
                      </>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* 场景 */}
          {activeTab === 'scenes' && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {scenes.map((s: any) => (
                <div key={s.id} className="bg-white/5 border border-white/10 rounded-xl overflow-hidden">
                  {s.mediaUrls?.[0] && (
                    <img src={s.mediaUrls[0]} alt={s.name} className="w-full h-[180px] object-cover" />
                  )}
                  <div className="p-4">
                    <h3 className="font-semibold text-white mb-1">{s.name}</h3>
                    <p className="text-xs text-gray-400">{s.data?.description}</p>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* 分镜 */}
          {activeTab === 'storyboard' && (
            <div>
              {/* v7.4 项目级格式条 (画幅/色彩/帧率/安全框) */}
              <ProjectFormatBar projectId={id} initialFormat={assets.find((a: any) => a.type === 'project-format')?.data} />
              {/* Sprint A.4 · 顶部 Cameo 一致性汇总条 + 批量重生按钮 */}
              <CameoSummary
                storyboards={storyboards}
                batchRetrying={batchRetrying}
                onBatchRetry={async (lowShots) => {
                  if (!lowShots.length) return;
                  setBatchRetrying(true);
                  setBatchRetryMsg('');
                  try {
                    const res = await fetch(`/api/projects/${id}/cameo-retry-storyboard`, {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ shotNumbers: lowShots }),
                    });
                    const json = await res.json().catch(() => ({}));
                    if (!res.ok) {
                      setBatchRetryMsg(json?.error || `重生失败 (${res.status})`);
                    } else {
                      setBatchRetryMsg(
                        `批量重生完成: ${json.upgraded ?? 0} 镜提升, ${json.unchanged ?? 0} 镜未变, ${json.failed ?? 0} 镜失败`
                      );
                      // 拉一遍最新数据以刷新页面
                      const fresh = await fetch(`/api/projects/${id}`).then((r) => r.json()).catch(() => null);
                      if (fresh?.id) setProject(fresh);
                    }
                  } catch (e: any) {
                    setBatchRetryMsg(e?.message || '网络异常');
                  } finally {
                    setBatchRetrying(false);
                    setTimeout(() => setBatchRetryMsg(''), 8000);
                  }
                }}
              />
              {batchRetryMsg ? (
                <div className="cinema-card-hi mb-3 px-3 py-2 cinema-mono text-[11px] tracking-wide" style={{ borderColor: 'var(--cinema-amber-deep)' }}>
                  <span className="opacity-60">[BATCH RETRY] </span>{batchRetryMsg}
                </div>
              ) : null}

              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2">
                {storyboards.map((sb: any) => {
                  const dur = (sb.data?.duration as number) || 5;
                  return (
                    <div
                      key={sb.id}
                      data-shot={sb.shotNumber}
                      className="cinema-card relative overflow-hidden hover:border-[var(--cinema-amber-deep)] transition-colors scroll-mt-24"
                    >
                      {/* Sprint A.4 · 右上角 Cameo 徽章 (没分数时不渲染) */}
                      <CameoBadge data={sb.data || {}} />
                      {sb.mediaUrls?.[0] ? (
                        <img src={sb.mediaUrls[0]} alt={sb.name} className="w-full aspect-video object-cover" />
                      ) : (
                        <div className="w-full aspect-video flex items-center justify-center bg-[var(--cinema-surface-2)] cinema-mono text-[10px] opacity-40">
                          NO RENDER
                        </div>
                      )}
                      <div className="px-2.5 py-1.5">
                        <div className="flex items-center justify-between mb-0.5">
                          <span className="cinema-mono text-[9px] tracking-widest opacity-60">SHOT {String(sb.shotNumber).padStart(2, '0')}</span>
                          <TimecodeChip seconds={dur} />
                        </div>
                        <p className="cinema-subhead text-[11px] line-clamp-2 opacity-85 leading-snug">
                          {sb.data?.description?.slice(0, 60) || '——'}
                        </p>
                        {/* v7.2 单镜头摄影台 — 机位摘要 chip + 入口 */}
                        {(() => {
                          const curSpec: ShotSpec =
                            specOverrides[sb.shotNumber]
                            || (sb.data?.cameraSpec ? normalizeShotSpec(sb.data.cameraSpec) : seedSpecFromCameraAngle(sb.data?.cameraAngle));
                          const hasSaved = !!specOverrides[sb.shotNumber] || !!sb.data?.cameraSpec;
                          return (
                            <button
                              onClick={() => setCinemaShot({ shotNumber: sb.shotNumber, title: sb.data?.description?.slice(0, 60), spec: curSpec, emotion: (script?.shots || [])[sb.shotNumber - 1]?.emotion })}
                              title="单镜头摄影台 — 景别/机位/镜头/运镜/焦点/氛围"
                              className="mt-1.5 w-full flex items-center gap-1.5 px-1.5 py-1 rounded-md border border-[var(--border)] hover:border-[var(--primary)] transition group/cine"
                            >
                              <Clapperboard size={11} className={hasSaved ? 'text-[var(--primary)]' : 'text-[var(--muted)]'} />
                              <span className="cinema-mono text-[9px] truncate opacity-75 group-hover/cine:opacity-100">
                                {describeShotSpec(curSpec)}
                              </span>
                            </button>
                          );
                        })()}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* v7.3 连贯性 + 种子锁控制台 */}
          {activeTab === 'continuity' && (
            <ContinuityConsole
              projectId={id}
              characters={characters}
              scenes={scenes}
              storyboards={storyboards}
              initialSettings={assets.find((a: any) => a.type === 'continuity')?.data}
            />
          )}

          {/* 视频 */}
          {activeTab === 'videos' && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {videos.map((v: any) => {
                const url = v.mediaUrls?.[0];
                const isVid = url && isVideoUrl(url);
                return (
                  <div key={v.id} className="bg-white/5 border border-white/10 rounded-xl overflow-hidden">
                    {url && (
                      isVid ? (
                        <video src={url} controls playsInline crossOrigin="anonymous" className="w-full aspect-video" />
                      ) : (
                        <div className="relative">
                          <img src={url} alt={v.name} className="w-full aspect-video object-cover" />
                          <div className="absolute inset-0 bg-black/40 flex items-center justify-center">
                            <div className="text-center">
                              <AlertTriangle className="w-8 h-8 text-yellow-400 mx-auto mb-2" />
                              <p className="text-xs text-white">视频生成失败，显示分镜图</p>
                            </div>
                          </div>
                        </div>
                      )
                    )}
                    <div className="px-4 py-2 flex items-center justify-between">
                      <span className="text-xs text-pink-400 font-medium">镜头 {v.shotNumber}</span>
                      <span className="text-[10px] text-gray-500">{v.data?.duration || 5}s</span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* v2.16 P1.4: 镜头工坊 — 4K 重渲 / 多分辨率导出 / 跳到 U2V 工具 */}
          {activeTab === 'workshop' && (
            <ShotWorkshopTab
              projectId={id}
              videos={videos.map((v: any) => ({
                shotNumber: v.shotNumber || v.shot_number,
                videoUrl: v.mediaUrls?.[0] || v.media_urls?.[0],
                imageUrl: v.mediaUrls?.[0],
                meta: v.data || v.meta,
              }))}
              storyboards={storyboards.map((s: any) => ({
                shotNumber: s.shotNumber || s.shot_number,
                imageUrl: s.imageUrl || s.mediaUrls?.[0],
              }))}
            />
          )}

          {/* v3.1 F: Cinema 时间线 MVP */}
          {activeTab === 'timeline' && (
            <CinemaTimeline
              projectId={id}
              currentUser={user ? { id: user.id, name: user.name, avatarUrl: user.avatarUrl || null } : undefined}
            />
          )}

          {/* v2.21 P1.4: 节奏分析 — 每镜冲突分 + 反转标记 + 警告/建议 */}
          {activeTab === 'pacing' && (
            <div className="flex flex-col gap-4">
              {/* v7.5 情感曲线 + 多轨节奏热力图 */}
              <EmotionRhythmChart
                curve={computeEmotionCurve(
                  (script?.shots || []).map((sh: any, i: number) => {
                    const sb = storyboards.find((b: any) => (b.shotNumber ?? b.shot_number) === (sh.shotNumber ?? i + 1));
                    const cs = sb?.data?.cameraSpec;
                    return {
                      emotion: sh.emotion,
                      durationS: sh.duration ?? sb?.data?.duration ?? 5,
                      motion: cs?.motion,
                      conflict: script?.pacingReport?.shots?.[i]?.conflictScore,
                      lightingSetup: cs?.lighting?.setup,
                      atmosphere: cs?.atmosphere,
                    };
                  }),
                )}
              />
              <PacingChart
                report={script?.pacingReport || null}
                dialogueCoverage={script?.dialogueCoverageReport || null}
                styleAuditShots={storyboards.map((sb: any) => ({
                  shotNumber: sb.shotNumber || sb.shot_number,
                  styleAuditScore: sb.styleAuditScore ?? sb.data?.styleAuditScore,
                  styleAuditRetried: sb.styleAuditRetried ?? sb.data?.styleAuditRetried,
                  styleAuditReason: sb.styleAuditReason ?? sb.data?.styleAuditReason,
                }))}
              />
            </div>
          )}

          {/* v3.4.1: 成片质检 — Vision 看画面对不对得上剧本 */}
          {activeTab === 'vision-audit' && (
            <VisionAuditTab projectId={id} onJumpToWorkshop={() => setActiveTab('workshop')} />
          )}

          {/* v9.4.6: 一键成片自愈闭环(对标可灵, 我们多自检+自动重拍) */}
          {activeTab === 'oneclick' && (
            <OneClickFilmPanel projectId={id} shotPrompts={shotPrompts} />
          )}

          {/* v8.0 技术监看台 — 视频示波器 + EDL/XML 出片对接 */}
          {activeTab === 'monitor' && (
            <div className="space-y-4">
              <MonitorTab projectId={id} storyboards={storyboards} />
              {/* v9.6.5 T3 性能成本:项目级成本归因 */}
              <CostAttributionPanel projectId={id} />
              {/* v9.6.8 T2 模板市场:把这个项目存为可复用模板 */}
              <SaveTemplateButton projectId={id} />
            </div>
          )}

          {/* v8.2 参数联动 — JSON ↔ 可视化同步 */}
          {activeTab === 'param-linkage' && (
            <ParamLinkagePanel
              projectId={id}
              shots={storyboards.map((sb: any) => ({ shotNumber: sb.shotNumber, cameraSpec: sb.data?.cameraSpec }))}
              continuity={assets.find((a: any) => a.type === 'continuity')?.data}
              format={assets.find((a: any) => a.type === 'project-format')?.data}
              onSynced={(doc) => setSpecOverrides((m) => {
                const next = { ...m };
                for (const s of doc.shots) next[s.shotNumber] = s.spec;
                return next;
              })}
            />
          )}

          {/* v3.0 P0.1: 评论协作 — 项目级讨论 + 每个镜头独立线程 */}
          {activeTab === 'comments' && (
            <div className="space-y-4">
              <CommentThread
                projectId={id}
                targetType="project"
                targetId={buildTargetId('project', id)}
                contextLabel="PROJECT"
                currentUserId={(project?.userId || project?.user_id) || null}
              />
              {/* 每个分镜独立评论线程 — 用 collapsible 列表展现 */}
              {script?.shots && script.shots.length > 0 && (
                <div className="space-y-2">
                  <div className="cinema-eyebrow opacity-60">PER-SHOT COMMENTS</div>
                  <div className="grid grid-cols-1 gap-3">
                    {script.shots.map((sh: any) => (
                      <details
                        key={sh.shotNumber}
                        className="cinema-card-hi p-3 group"
                      >
                        <summary className="cursor-pointer flex items-center justify-between gap-2 select-none">
                          <span className="cinema-mono text-[11px]">
                            <span className="opacity-50">SHOT</span> #{sh.shotNumber}
                            <span className="opacity-50 ml-2">· {sh.sceneDescription?.slice(0, 40) || '(无场景描述)'}</span>
                          </span>
                          <span className="cinema-mono text-[10px] opacity-50 group-open:hidden">展开评论 →</span>
                        </summary>
                        <div className="mt-3">
                          <CommentThread
                            projectId={id}
                            targetType="shot"
                            targetId={buildTargetId('shot', id, sh.shotNumber)}
                            contextLabel={`SHOT #${sh.shotNumber}`}
                            currentUserId={(project?.userId || project?.user_id) || null}
                            pollIntervalMs={0}
                          />
                        </div>
                      </details>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* v9.1.2 多平台分发 + v9.1.3 AI 竖屏封面候选 (发布前置: 文案 + 封面) */}
          {activeTab === 'distribution' && (
            <div className="flex flex-col gap-4">
              <DistributionPanel projectId={id} />
              <CoverCandidatesPanel projectId={id} title={project.title} />
            </div>
          )}

          {/* 完整播放 */}
          {activeTab === 'play' && (
            <div>
              <div className="bg-white/5 border border-white/10 rounded-2xl overflow-hidden mb-4">
                {videos.length > 0 ? (
                  <div className="relative">
                    {videos[Math.max(0, playingIndex)]?.mediaUrls?.[0] ? (
                      (() => {
                        const url = videos[Math.max(0, playingIndex)].mediaUrls[0];
                        return isVideoUrl(url) ? (
                          <video
                            key={playingIndex}
                            src={url}
                            autoPlay
                            playsInline
                                                        className="w-full aspect-video"
                            onEnded={() => {
                              if (playingIndex < videos.length - 1) setPlayingIndex(playingIndex + 1);
                            }}
                          />
                        ) : (
                          <div className="relative">
                            <img src={url} alt="playing" className="w-full aspect-video object-cover" />
                            <div className="absolute top-3 right-3 px-2 py-1 rounded-lg bg-yellow-500/20 border border-yellow-500/30 text-yellow-400 text-[10px]">
                              分镜图（视频生成失败）
                            </div>
                          </div>
                        );
                      })()
                    ) : (
                      <div className="w-full aspect-video bg-black grid place-items-center text-gray-500">无视频</div>
                    )}
                    <div className="absolute bottom-3 left-3 px-3 py-1 rounded-full bg-black/70 text-xs text-white">
                      镜头 {playingIndex >= 0 ? videos[playingIndex]?.shotNumber : '-'} / {videos.length}
                    </div>
                  </div>
                ) : (
                  <div className="w-full aspect-video grid place-items-center text-gray-500">暂无视频</div>
                )}
              </div>

              {/* 播放控制 */}
              <div className="flex items-center gap-2 mb-4">
                <button onClick={() => setPlayingIndex(0)} className="px-4 py-2 rounded-xl bg-gradient-to-r from-[#E8C547] to-[#D4A830] text-white text-sm">
                  <Play className="w-4 h-4 inline mr-1" />从头播放
                </button>
                <div className="flex gap-1 overflow-x-auto">
                  {videos.map((v: any, i: number) => (
                    <button key={i} onClick={() => setPlayingIndex(i)}
                      className={`px-3 py-1.5 rounded-lg text-xs transition-all ${playingIndex === i ? 'bg-[#D4A830]/15 text-pink-400 border border-pink-500/30' : 'bg-white/5 text-gray-400 hover:bg-white/10'}`}>
                      #{v.shotNumber}
                    </button>
                  ))}
                </div>
              </div>

              {/* 导演审核结果 */}
              {review && (
                <div className="bg-white/5 border border-white/10 rounded-2xl p-5">
                  <div className="flex items-center gap-3 mb-4">
                    <Star className="w-5 h-5 text-orange-400" />
                    <span className="text-lg font-bold text-orange-400">{review.overallScore}/100</span>
                    <span className="text-sm text-gray-400">{review.passed ? '✅ 审核通过' : '⚠️ 需要优化'}</span>
                  </div>
                  <p className="text-sm text-gray-300 mb-4">{review.summary}</p>

                  {review.dimensions && (
                    <div className="grid grid-cols-2 md:grid-cols-3 gap-2 mb-4">
                      {Object.entries(review.dimensions).map(([key, dim]: [string, any]) => (
                        <div key={key} className="bg-black/20 rounded-lg p-2.5">
                          <div className="flex items-center justify-between mb-1">
                            <span className="text-[10px] text-gray-400">{
                              { narrative: '叙事', visualConsistency: '画风', pacing: '节奏', characterPerformance: '角色', visualQuality: '视觉', audio: '音频' }[key] || key
                            }</span>
                            <span className="text-xs font-medium text-white">{dim.score}</span>
                          </div>
                          <p className="text-[10px] text-gray-500">{dim.comment}</p>
                        </div>
                      ))}
                    </div>
                  )}

                  {review.items?.length > 0 && (
                    <div className="space-y-1.5">
                      {review.items.map((item: any, i: number) => (
                        <div key={i} className={`flex items-start gap-2 rounded-lg p-2 text-[11px] ${
                          item.severity === 'critical' ? 'bg-red-500/10 text-red-300' :
                          item.severity === 'major' ? 'bg-orange-500/10 text-orange-300' :
                          'bg-yellow-500/10 text-yellow-300'
                        }`}>
                          <AlertTriangle className="w-3 h-3 mt-0.5 shrink-0" />
                          <div>
                            {item.shotNumber && <span className="opacity-70">镜头{item.shotNumber}: </span>}
                            {item.issue}
                            <span className="opacity-60 ml-1">→ {item.suggestion}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </motion.div>
      </main>

      {/* AI 助手浮动入口 + 侧栏 (alt+/ 也可呼出) */}
      <ChatLauncherButton open={chatOpen} onClick={() => setChatOpen(true)} />
      <ProjectChatSidebar projectId={id} open={chatOpen} onClose={() => setChatOpen(false)} />

      {/* v7.2 单镜头摄影台弹窗 */}
      {cinemaShot && (
        <ShotCinematographyModal
          projectId={id}
          shotNumber={cinemaShot.shotNumber}
          shotTitle={cinemaShot.title}
          initialSpec={cinemaShot.spec}
          emotion={cinemaShot.emotion}
          onClose={() => setCinemaShot(null)}
          onSaved={(spec) => setSpecOverrides((m) => ({ ...m, [cinemaShot.shotNumber]: spec }))}
        />
      )}
    </div>
  );
}
