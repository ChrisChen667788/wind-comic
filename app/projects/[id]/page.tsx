'use client';

import { useState, useEffect, useRef, type CSSProperties } from 'react';
import { SafeAreaOverlay } from '@/components/ui/safe-area-overlay';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { motion } from 'framer-motion';
import { ArrowLeft, FileText, Users, Mountains as Mountain, FilmStrip as Film, Video, Play, Scissors, Star, CheckCircle as CheckCircle2, Warning as AlertTriangle, Pencil, FloppyDisk as Save, X, ChatCircle as MessageCircle, ChartBar as BarChart3, FilmSlate as Clapperboard, Scan as ScanEye, MonitorPlay, LinkSimple as Link2, Gauge, BracketsCurly as Braces, Megaphone, MagicWand, SpeakerHigh, ArrowsOut as Maximize, ArrowsIn as Minimize } from '@phosphor-icons/react';
import { CameoPanel } from '@/components/CameoPanel';
import { DistributionPanel } from '@/components/project/distribution-panel';
import { CoverCandidatesPanel } from '@/components/project/cover-candidates-panel';
import { DirectorConsole } from '@/components/director-console';
import LatestPolishBanner from '@/components/polish/LatestPolishBanner';
import ProjectChatSidebar, { ChatLauncherButton } from '@/components/agent-chat-sidebar';
import { CameoBadge, CameoSummary } from '@/components/cameo/CameoStoryboardWidgets';
import { ShotInspector, type InspectShot } from '@/components/project/shot-inspector';
import { Eyebrow, TimecodeChip, FilmStripDivider, EmptyState } from '@/components/cinema/primitives';
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
import { AssetLedgerPanel } from '@/components/project/asset-ledger-panel';
import { ClipWithAudio } from '@/components/project/clip-with-audio';
import { PullSheetTable } from '@/components/project/pull-sheet-table';
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
  // v10.6.0 竖屏优先:项目级画幅驱动预览框(旧项目无列值 → 16:9 零回归);字幕安全区可开关
  const [showSafeArea, setShowSafeArea] = useState(false);
  const isVertical = project?.aspect === '9:16';
  const frameClass = isVertical ? 'aspect-[9/16]' : 'aspect-video';
  const mainFrameClass = isVertical ? 'aspect-[9/16] max-w-[320px] mx-auto' : 'aspect-video';
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<string>('script');
  const [playingIndex, setPlayingIndex] = useState<number>(-1);
  // 完整播放:点击全屏。全屏套在「外层容器」上(而非 <video>),这样切下一镜
  // <video> 重挂载时全屏不掉,整段连播都在全屏里。
  const playerWrapRef = useRef<HTMLDivElement | null>(null);
  const [isPlayerFs, setIsPlayerFs] = useState(false);
  useEffect(() => {
    const onFsChange = () => setIsPlayerFs(document.fullscreenElement === playerWrapRef.current);
    document.addEventListener('fullscreenchange', onFsChange);
    return () => document.removeEventListener('fullscreenchange', onFsChange);
  }, []);
  const togglePlayerFullscreen = () => {
    const el = playerWrapRef.current;
    if (!el) return;
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    else el.requestFullscreen?.().catch(() => {});
  };
  // v12.13.2:按「视频/图片真实比例」显示 —— 裸 <video> 默认 object-fit:fill 会把不同比例的源
  // 拉伸进固定框(竖屏框塞横屏片=变形)。从加载到的真实尺寸探测比例,预览+全屏都按真实比例 + object-contain。
  const [playerRatio, setPlayerRatio] = useState<number | null>(null);
  // 切镜重新探测(不同镜可能比例不同),onLoadedMetadata/onLoad 会立刻回填
  useEffect(() => { setPlayerRatio(null); }, [playingIndex]);
  // 给定是否全屏,返回主播放媒体的 className/style:真实比例已知则按其显示,否则回退项目设定比例。
  const mediaPresentation = (isFs: boolean): { className: string; style?: CSSProperties } => {
    if (isFs) return { className: 'max-h-screen max-w-full object-contain' };
    if (playerRatio) {
      return playerRatio < 1
        ? { className: 'object-contain bg-black mx-auto block h-auto', style: { aspectRatio: String(playerRatio), maxHeight: '72vh', width: 'auto' } } // 竖屏:限高居中
        : { className: 'w-full object-contain bg-black block', style: { aspectRatio: String(playerRatio) } };                                          // 横屏/方:撑满宽
    }
    return { className: `w-full object-contain bg-black ${mainFrameClass}` }; // 回退:项目比例框,但 object-contain 不变形
  };
  // v12.1.1 成片音频体检
  const [audioCheck, setAudioCheck] = useState<{ audible: boolean; label: string; hasAudioStream: boolean | null; healed: boolean } | null>(null);
  useEffect(() => {
    if (activeTab !== 'play') return;
    let alive = true;
    fetch(`/api/projects/${encodeURIComponent(id)}/audio-check`)
      .then((r) => r.json()).then((d) => { if (alive && d.exists) setAudioCheck(d); }).catch(() => {});
    return () => { alive = false; };
  }, [activeTab, id]);

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
  const [inspectShot, setInspectShot] = useState<InspectShot | null>(null);
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
        <div className="text-sm text-[var(--cinema-text-3)]">加载项目中...</div>
      </div>
    </div>
  );
  if (!project) return (
    <div className="min-h-screen bg-[var(--background)] text-white grid place-items-center">
      <div className="text-[var(--cinema-text-3)]">项目不存在</div>
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
  // v12.1.0 片段预览叠播配音:镜号 → shot-audio(TTS 配音)URL
  const shotAudioByShot: Record<number, string> = {};
  for (const a of assets as any[]) {
    if (a.type === 'shot-audio' && typeof a.shotNumber === 'number' && a.mediaUrls?.[0]) shotAudioByShot[a.shotNumber] = a.mediaUrls[0];
  }
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
    // v11.1.0: 拉片 — 出厂参数真值逐镜五栏(阶段十九)
    { key: 'pullsheet', label: '拉片', icon: Clapperboard, count: 0 },
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

  // v12.42 工作流主轴:把 18 个平铺 Tab 收成两级 IA(创作 → 精修 → 审校 → 交付)。
  // activeGroup 纯派生自 activeTab(含程序化 setActiveTab,如导演台跳转),无需额外状态。
  const TAB_GROUPS: { key: string; label: string; en: string; tabKeys: string[] }[] = [
    { key: 'create',  label: '创作', en: 'CREATE',  tabKeys: ['director', 'script', 'characters', 'scenes', 'storyboard', 'videos', 'oneclick'] },
    { key: 'refine',  label: '精修', en: 'REFINE',  tabKeys: ['workshop', 'continuity', 'timeline', 'param-linkage'] },
    { key: 'review',  label: '审校', en: 'REVIEW',  tabKeys: ['pacing', 'pullsheet', 'vision-audit', 'monitor'] },
    { key: 'deliver', label: '交付', en: 'DELIVER', tabKeys: ['play', 'comments', 'distribution'] },
  ];
  const tabByKey: Record<string, typeof tabs[number]> = Object.fromEntries(tabs.map((t) => [t.key, t]));
  const activeGroup = TAB_GROUPS.find((g) => g.tabKeys.includes(activeTab))?.key || 'create';
  const groupTabs = (TAB_GROUPS.find((g) => g.key === activeGroup)?.tabKeys || []).map((k) => tabByKey[k]).filter(Boolean);

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
              <p className="mt-3 text-sm text-[var(--cinema-text-3)] leading-relaxed max-w-2xl">{script.synopsis}</p>
            )}
            {script?.theme && (
              <p className="mt-2 text-xs text-[var(--cinema-amber)]">主题 · {script.theme}</p>
            )}
          </div>
          <dl className="lg:border-l lg:border-[var(--cinema-border)] lg:pl-8 grid grid-cols-2 lg:grid-cols-1 gap-x-8 gap-y-3 shrink-0">
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

        {/* Tabs — v12.42 两级工作流主轴(创作 → 精修 → 审校 → 交付),收敛 18 个平铺 Tab */}
        <div className="mb-6 flex flex-col gap-2">
          {/* 主轴:工作流分组 */}
          <div
            role="tablist"
            aria-label="工作流分组"
            className="flex items-center gap-1 cinema-card p-1 w-fit"
            onKeyDown={(e) => {
              if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
              e.preventDefault();
              const i = TAB_GROUPS.findIndex(g => g.key === activeGroup);
              const ni = (i + (e.key === 'ArrowRight' ? 1 : TAB_GROUPS.length - 1)) % TAB_GROUPS.length;
              setActiveTab(TAB_GROUPS[ni].tabKeys[0]);
            }}
          >
            {TAB_GROUPS.map(g => {
              const on = activeGroup === g.key;
              return (
                <button
                  key={g.key}
                  role="tab"
                  aria-selected={on}
                  tabIndex={on ? 0 : -1}
                  onClick={() => { if (g.key !== activeGroup) setActiveTab(g.tabKeys[0]); }}
                  className={`flex items-center gap-1.5 px-3.5 py-1.5 text-xs whitespace-nowrap transition-colors ${
                    on
                      ? 'bg-[var(--cinema-amber)] text-black font-semibold'
                      : 'text-[var(--cinema-text-2)] hover:text-[var(--cinema-text)] hover:bg-[var(--cinema-surface-2)]'
                  }`}
                  style={{ borderRadius: 3 }}
                >
                  <span>{g.label}</span>
                  <span className={`cinema-mono text-[8px] tracking-widest ${on ? 'opacity-60' : 'opacity-40'}`}>{g.en}</span>
                </button>
              );
            })}
          </div>
          {/* 当前组的环节 */}
          <div
            role="tablist"
            aria-label={`${TAB_GROUPS.find(g => g.key === activeGroup)?.label || ''} 环节`}
            className="flex items-center gap-0.5 cinema-card overflow-x-auto p-1 w-fit"
            onKeyDown={(e) => {
              if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
              e.preventDefault();
              const keys = groupTabs.map(t => t.key);
              const i = Math.max(0, keys.indexOf(activeTab));
              const ni = (i + (e.key === 'ArrowRight' ? 1 : keys.length - 1)) % keys.length;
              setActiveTab(keys[ni]);
            }}
          >
            {groupTabs.map(t => {
              const on = activeTab === t.key;
              return (
                <button
                  key={t.key}
                  role="tab"
                  aria-selected={on}
                  tabIndex={on ? 0 : -1}
                  onClick={() => setActiveTab(t.key)}
                  className={`flex items-center gap-1.5 px-3 py-1.5 text-xs whitespace-nowrap transition-colors ${
                    on
                      ? 'bg-[var(--cinema-amber)] text-black font-semibold'
                      : 'text-[var(--cinema-text-2)] hover:text-[var(--cinema-text)] hover:bg-[var(--cinema-surface-2)]'
                  }`}
                  style={{ borderRadius: 3 }}
                >
                  <t.icon className="w-3 h-3" />
                  <span>{t.label}</span>
                  {t.count > 0 && <span className="cinema-mono text-[9px] opacity-70 tabular-nums">{String(t.count).padStart(2, '0')}</span>}
                </button>
              );
            })}
          </div>
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
            <div className="space-y-2.5">
              {(script.shots || []).map((shot: any, i: number) => (
                <div key={i} className="cinema-card p-4">
                  <div className="flex items-center gap-2.5 mb-2">
                    <span className="cinema-mono text-[9px] tracking-widest text-[var(--cinema-amber)]">SHOT {String(shot.shotNumber || i + 1).padStart(2, '0')}</span>
                    {shot.act && <span className="cinema-mono text-[10px] opacity-50">ACT {shot.act}</span>}
                    {shot.emotion && editingShot !== i && <span className="cinema-mono text-[10px] opacity-50">{shot.emotion}</span>}
                    {shot.duration && <TimecodeChip seconds={shot.duration} />}
                    <div className="ml-auto">
                      {editingShot === i ? (
                        <div className="flex items-center gap-1.5">
                          <button onClick={() => saveShot(i)} disabled={saving} className="cinema-btn-primary !text-xs !py-1 disabled:opacity-50">
                            <Save className="w-3 h-3" /> 保存
                          </button>
                          <button onClick={cancelEditShot} className="cinema-btn-ghost !text-xs !py-1">
                            <X className="w-3 h-3" /> 取消
                          </button>
                        </div>
                      ) : (
                        <button onClick={() => startEditShot(i, shot)} className="cinema-btn-ghost !text-xs !py-1">
                          <Pencil className="w-3 h-3" /> 编辑
                        </button>
                      )}
                    </div>
                  </div>

                  {editingShot === i ? (
                    <div className="space-y-2.5 mt-2">
                      <div>
                        <label className="cinema-eyebrow !text-[9px] opacity-60 block mb-1">场景描述</label>
                        <textarea
                          value={shotDraft.sceneDescription}
                          onChange={e => setShotDraft(d => ({ ...d, sceneDescription: e.target.value }))}
                          rows={3}
                          className="cinema-input w-full text-sm resize-none"
                        />
                      </div>
                      <div>
                        <label className="cinema-eyebrow !text-[9px] opacity-60 block mb-1">对白</label>
                        <textarea
                          value={shotDraft.dialogue}
                          onChange={e => setShotDraft(d => ({ ...d, dialogue: e.target.value }))}
                          rows={2}
                          className="cinema-input w-full text-sm resize-none !text-[var(--cinema-blue)]"
                        />
                      </div>
                      <div>
                        <label className="cinema-eyebrow !text-[9px] opacity-60 block mb-1">情绪</label>
                        <input
                          type="text"
                          value={shotDraft.emotion}
                          onChange={e => setShotDraft(d => ({ ...d, emotion: e.target.value }))}
                          className="cinema-input w-full text-sm"
                        />
                      </div>
                    </div>
                  ) : (
                    <>
                      <p className="cinema-subhead text-sm opacity-90">{shot.sceneDescription}</p>
                      {shot.dialogue && <p className="text-xs text-[var(--cinema-blue)] mt-1.5 italic">「{shot.dialogue}」</p>}
                      {shot.beat && <p className="cinema-mono text-[10px] opacity-50 mt-1">节拍 · {shot.beat}</p>}
                    </>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* 角色 */}
          {activeTab === 'characters' && (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {characters.length === 0 && <div className="col-span-full"><EmptyState icon={Users} title="还没有角色" hint="生成剧本后,AI 角色设计师会自动产出角色设定与立绘" /></div>}
              {characters.map((c: any) => (
                <div key={c.id} className="cinema-card overflow-hidden">
                  {c.mediaUrls?.[0] && (
                    <img loading="lazy" decoding="async" src={c.mediaUrls[0]} alt={c.name} className="w-full h-[200px] object-cover" />
                  )}
                  <div className="p-4">
                    <h3 className="cinema-headline text-sm mb-1.5">{c.name}</h3>
                    {editingCharacter === c.id ? (
                      <div className="space-y-2 mt-2">
                        <textarea
                          value={characterDraft}
                          onChange={e => setCharacterDraft(e.target.value)}
                          rows={4}
                          className="cinema-input w-full text-xs resize-none"
                        />
                        <div className="flex items-center gap-1.5">
                          <button onClick={() => saveCharacter(c.id)} disabled={saving} className="cinema-btn-primary !text-xs !py-1 disabled:opacity-50">
                            <Save className="w-3 h-3" /> 保存
                          </button>
                          <button onClick={cancelEditCharacter} className="cinema-btn-ghost !text-xs !py-1">
                            <X className="w-3 h-3" /> 取消
                          </button>
                        </div>
                      </div>
                    ) : (
                      <>
                        <p className="cinema-subhead text-xs opacity-80 leading-relaxed">{c.data?.description}</p>
                        <button onClick={() => startEditCharacter(c.id, c.data?.description || '')} className="cinema-btn-ghost !text-xs !py-1 mt-3">
                          <Pencil className="w-3 h-3" /> 编辑描述
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
              {scenes.length === 0 && <div className="col-span-full"><EmptyState icon={Mountain} title="还没有场景" hint="生成剧本后,AI 场景设计师会自动产出场景视觉方案" /></div>}
              {scenes.map((s: any) => (
                <div key={s.id} className="cinema-card overflow-hidden">
                  {s.mediaUrls?.[0] && (
                    <img loading="lazy" decoding="async" src={s.mediaUrls[0]} alt={s.name} className="w-full h-[180px] object-cover" />
                  )}
                  <div className="p-4">
                    <h3 className="cinema-headline text-sm mb-1.5">{s.name}</h3>
                    <p className="cinema-subhead text-xs opacity-80 leading-relaxed">{s.data?.description}</p>
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
                  const curSpec: ShotSpec = specOverrides[sb.shotNumber] || (sb.data?.cameraSpec ? normalizeShotSpec(sb.data.cameraSpec) : seedSpecFromCameraAngle(sb.data?.cameraAngle));
                  const hasSaved = !!specOverrides[sb.shotNumber] || !!sb.data?.cameraSpec;
                  const scriptShot = (script?.shots || [])[sb.shotNumber - 1];
                  return (
                    <div
                      key={sb.id}
                      data-shot={sb.shotNumber}
                      className="cinema-card relative overflow-hidden hover:border-[var(--cinema-amber-deep)] transition-colors scroll-mt-24"
                    >
                      {/* Sprint A.4 · 右上角 Cameo 徽章 (没分数时不渲染) */}
                      <CameoBadge data={sb.data || {}} />
                      {sb.mediaUrls?.[0] ? (
                        <div
                          className="relative cursor-pointer group/insp"
                          onClick={() => setInspectShot({ shotNumber: sb.shotNumber, imageUrl: sb.mediaUrls[0], description: sb.data?.description, dialogue: scriptShot?.dialogue, emotion: scriptShot?.emotion, duration: dur, data: sb.data || {}, specSummary: describeShotSpec(curSpec) })}
                        >
                          <img loading="lazy" decoding="async" src={sb.mediaUrls[0]} alt={sb.name} className={`w-full ${frameClass} object-cover`} />
                          {isVertical && showSafeArea && <SafeAreaOverlay />}
                          <div className="absolute inset-0 flex items-center justify-center bg-black/0 group-hover/insp:bg-black/35 opacity-0 group-hover/insp:opacity-100 transition-all">
                            <span className="cinema-chip cinema-chip-amber">检查器</span>
                          </div>
                        </div>
                      ) : (
                        <div className={`w-full ${frameClass} flex items-center justify-center bg-[var(--cinema-surface-2)] cinema-mono text-[10px] opacity-40`}>
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
                        <button
                          onClick={() => setCinemaShot({ shotNumber: sb.shotNumber, title: sb.data?.description?.slice(0, 60), spec: curSpec, emotion: scriptShot?.emotion })}
                          title="单镜头摄影台 — 景别/机位/镜头/运镜/焦点/氛围"
                          className="mt-1.5 w-full flex items-center gap-1.5 px-1.5 py-1 rounded-md border border-[var(--cinema-border)] hover:border-[var(--cinema-amber)] transition group/cine"
                        >
                          <Clapperboard size={11} className={hasSaved ? 'text-[var(--cinema-amber)]' : 'text-[var(--cinema-text-3)]'} />
                          <span className="cinema-mono text-[9px] truncate opacity-75 group-hover/cine:opacity-100">
                            {describeShotSpec(curSpec)}
                          </span>
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* v7.3 连贯性 + 种子锁控制台 */}
          {activeTab === 'continuity' && (
            <>
              <ContinuityConsole
                projectId={id}
                characters={characters}
                scenes={scenes}
                storyboards={storyboards}
                initialSettings={assets.find((a: any) => a.type === 'continuity')?.data}
              />
              {/* v10.6.1: 资产级连续性台账 — 服装/场景/道具 × 引用镜号,改描述列受影响镜头 */}
              <AssetLedgerPanel projectId={id} />
            </>
          )}

          {/* 视频 */}
          {activeTab === 'videos' && (
            <>
            {isVertical && (
              <div className="flex justify-end mb-3">
                <button
                  onClick={() => setShowSafeArea((v) => !v)}
                  aria-pressed={showSafeArea}
                  className={`cinema-btn-ghost !text-[11px] !py-1 ${showSafeArea ? '!text-[var(--cinema-amber)] !border-[var(--cinema-amber-deep)]' : ''}`}
                >
                  字幕安全区 {showSafeArea ? 'ON' : 'OFF'}
                </button>
              </div>
            )}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {videos.length === 0 && <div className="col-span-full"><EmptyState icon={Video} title="还没有镜头视频" hint="完成分镜后,在镜头工坊或主管线生成每镜视频" /></div>}
              {videos.map((v: any) => {
                const url = v.mediaUrls?.[0];
                const isVid = url && isVideoUrl(url);
                return (
                  <div key={v.id} className="cinema-card overflow-hidden">
                    {url && (
                      isVid ? (
                        <ClipWithAudio
                          videoUrl={url}
                          audioUrl={shotAudioByShot[v.shotNumber]}
                          className={`w-full ${frameClass}`}
                          overlay={isVertical && showSafeArea ? <SafeAreaOverlay /> : undefined}
                        />
                      ) : (
                        <div className="relative">
                          <img loading="lazy" decoding="async" src={url} alt={v.name} className={`w-full ${frameClass} object-cover`} />
                          <div className="absolute inset-0 bg-black/50 flex items-center justify-center">
                            <div className="text-center">
                              <AlertTriangle className="w-7 h-7 text-[var(--cinema-amber)] mx-auto mb-2" />
                              <p className="cinema-mono text-[10px] opacity-80">视频生成失败 · 显示分镜图</p>
                            </div>
                          </div>
                        </div>
                      )
                    )}
                    <div className="px-3 py-2 flex items-center justify-between">
                      <span className="cinema-mono text-[10px] tracking-widest text-[var(--cinema-amber)]">SHOT {String(v.shotNumber).padStart(2, '0')}</span>
                      <TimecodeChip seconds={v.data?.duration || 5} />
                    </div>
                  </div>
                );
              })}
            </div>
            </>
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
          {activeTab === 'pullsheet' && <PullSheetTable projectId={id} />}

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
              {audioCheck && (
                <div className="mb-3 flex items-center gap-2 text-[12px]" data-testid="final-audio-badge">
                  <span className={`cinema-chip ${audioCheck.audible ? 'cinema-chip-green' : 'cinema-chip-amber'}`}>
                    <SpeakerHigh className="w-3 h-3" weight="fill" /> {audioCheck.label}
                  </span>
                  {audioCheck.healed && <span className="cinema-mono text-[10px] opacity-40">已自愈补音轨</span>}
                  {!audioCheck.audible && <span className="cinema-mono text-[10px] opacity-45">— 缺配乐/配音?去「镜头工坊」合成配音或重生成片补音</span>}
                </div>
              )}
              <div className="cinema-card overflow-hidden mb-4">
                {videos.length > 0 ? (
                  <div ref={playerWrapRef} className={`relative ${isPlayerFs ? 'w-screen h-screen bg-black grid place-items-center' : ''}`}>
                    {videos[Math.max(0, playingIndex)]?.mediaUrls?.[0] ? (
                      (() => {
                        const url = videos[Math.max(0, playingIndex)].mediaUrls[0];
                        const mp = mediaPresentation(isPlayerFs);
                        return isVideoUrl(url) ? (
                          <video
                            key={playingIndex}
                            src={url}
                            autoPlay
                            playsInline
                            controls
                            onLoadedMetadata={(e) => { const v = e.currentTarget; if (v.videoWidth && v.videoHeight) setPlayerRatio(v.videoWidth / v.videoHeight); }}
                            onDoubleClick={(e) => { e.preventDefault(); togglePlayerFullscreen(); }}
                            className={mp.className}
                            style={mp.style}
                            onEnded={() => {
                              if (playingIndex < videos.length - 1) setPlayingIndex(playingIndex + 1);
                            }}
                          />
                        ) : (
                          <div className={isPlayerFs ? 'relative grid place-items-center' : 'relative'}>
                            <img loading="lazy" decoding="async" src={url} alt="playing"
                              onLoad={(e) => { const im = e.currentTarget; if (im.naturalWidth && im.naturalHeight) setPlayerRatio(im.naturalWidth / im.naturalHeight); }}
                              className={mp.className} style={mp.style} />
                            <div className="absolute top-3 right-3 cinema-chip cinema-chip-amber !text-[10px]">
                              分镜图（视频生成失败）
                            </div>
                          </div>
                        );
                      })()
                    ) : (
                      <div className={`w-full ${mainFrameClass} bg-black grid place-items-center cinema-mono text-[11px] opacity-40`}>无视频</div>
                    )}
                    <div className="absolute bottom-3 left-3 px-3 py-1 rounded-full bg-black/70 text-xs text-white">
                      镜头 {playingIndex >= 0 ? videos[playingIndex]?.shotNumber : '-'} / {videos.length}
                    </div>
                    {/* 点击全屏(套外层容器 → 连播不掉全屏);双击画面亦可 */}
                    <button
                      type="button"
                      onClick={togglePlayerFullscreen}
                      title={isPlayerFs ? '退出全屏' : '全屏观看'}
                      aria-label={isPlayerFs ? '退出全屏' : '全屏观看'}
                      className="absolute top-3 left-3 z-10 flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-black/60 hover:bg-black/80 border border-white/15 text-white/90 text-xs transition-colors">
                      {isPlayerFs ? <Minimize className="w-4 h-4" /> : <Maximize className="w-4 h-4" />}
                      <span>{isPlayerFs ? '退出全屏' : '全屏'}</span>
                    </button>
                  </div>
                ) : (
                  <div className={`w-full ${mainFrameClass} grid place-items-center cinema-mono text-[11px] opacity-40`}>暂无视频</div>
                )}
              </div>

              {/* 播放控制 */}
              <div className="flex items-center gap-2 mb-4">
                <button onClick={() => setPlayingIndex(0)} className="cinema-btn-primary !text-sm">
                  <Play className="w-4 h-4" />从头播放
                </button>
                <div className="flex gap-1 overflow-x-auto">
                  {videos.map((v: any, i: number) => (
                    <button key={i} onClick={() => setPlayingIndex(i)}
                      className={`cinema-mono px-2.5 py-1.5 rounded-[3px] text-xs transition-colors ${playingIndex === i ? 'bg-[var(--cinema-amber)] text-black font-semibold' : 'text-[var(--cinema-text-2)] hover:bg-[var(--cinema-surface-2)]'}`}>
                      #{String(v.shotNumber).padStart(2, '0')}
                    </button>
                  ))}
                </div>
              </div>

              {/* 导演审核结果 */}
              {review && (
                <div className="cinema-card-hi p-5">
                  <div className="flex items-center gap-3 mb-4">
                    <Star className="w-5 h-5 text-[var(--cinema-amber)]" weight="fill" />
                    <span className="cinema-headline text-lg text-[var(--cinema-amber)]">{review.overallScore}<span className="cinema-mono text-sm opacity-50"> /100</span></span>
                    <span className={`cinema-chip ${review.passed ? 'cinema-chip-green' : 'cinema-chip-amber'}`}>
                      {review.passed ? <CheckCircle2 className="w-3 h-3" weight="fill" /> : <AlertTriangle className="w-3 h-3" />}
                      {review.passed ? '审核通过' : '需要优化'}
                    </span>
                  </div>
                  <p className="cinema-subhead text-sm opacity-90 mb-4">{review.summary}</p>

                  {review.dimensions && (
                    <div className="grid grid-cols-2 md:grid-cols-3 gap-2 mb-4">
                      {Object.entries(review.dimensions).map(([key, dim]: [string, any]) => (
                        <div key={key} className="rounded-[3px] p-2.5 bg-[var(--cinema-surface-2)] border border-[var(--cinema-border)]">
                          <div className="flex items-center justify-between mb-1">
                            <span className="cinema-mono text-[10px] opacity-60">{
                              { narrative: '叙事', visualConsistency: '画风', pacing: '节奏', characterPerformance: '角色', visualQuality: '视觉', audio: '音频' }[key] || key
                            }</span>
                            <span className="cinema-mono text-xs text-[var(--cinema-amber)] tabular-nums">{dim.score}</span>
                          </div>
                          <p className="cinema-mono text-[10px] opacity-50 leading-relaxed">{dim.comment}</p>
                        </div>
                      ))}
                    </div>
                  )}

                  {review.items?.length > 0 && (
                    <div className="space-y-1.5">
                      {review.items.map((item: any, i: number) => (
                        <div key={i} className={`flex items-start gap-2 rounded-[3px] p-2 text-[11px] border ${
                          item.severity === 'critical' ? 'bg-[var(--cinema-red)]/12 text-[var(--cinema-red)] border-[var(--cinema-red)]/30' :
                          item.severity === 'major' ? 'bg-[var(--cinema-amber)]/10 text-[var(--cinema-amber)] border-[var(--cinema-amber-deep)]' :
                          'bg-[var(--cinema-amber)]/[0.05] text-[var(--cinema-text-2)] border-[var(--cinema-border)]'
                        }`}>
                          <AlertTriangle className="w-3 h-3 mt-0.5 shrink-0" />
                          <div>
                            {item.shotNumber && <span className="opacity-70 cinema-mono">SHOT {String(item.shotNumber).padStart(2, '0')}: </span>}
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

      {/* v12.44 统一镜头检查器 — 点分镜图弹出,聚合单镜预览/元数据/操作 */}
      {inspectShot && (
        <ShotInspector
          shot={inspectShot}
          frameClass={frameClass}
          onClose={() => setInspectShot(null)}
          onCinema={() => {
            const sn = inspectShot.shotNumber;
            const sbx = (storyboards as any[]).find((s) => s.shotNumber === sn);
            const spec = specOverrides[sn] || (sbx?.data?.cameraSpec ? normalizeShotSpec(sbx.data.cameraSpec) : seedSpecFromCameraAngle(sbx?.data?.cameraAngle));
            setCinemaShot({ shotNumber: sn, title: inspectShot.description?.slice(0, 60), spec, emotion: inspectShot.emotion });
            setInspectShot(null);
          }}
          onWorkshop={() => { setActiveTab('workshop'); setInspectShot(null); }}
        />
      )}
    </div>
  );
}
