'use client';

import { useState, useEffect } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { motion } from 'framer-motion';
import {
  ArrowLeft, FileText, Users, Mountain, Film, Video, Play, Scissors,
  Star, CheckCircle2, AlertTriangle, Pencil, Save, X
} from 'lucide-react';
import { CameoPanel } from '@/components/CameoPanel';
import LatestPolishBanner from '@/components/polish/LatestPolishBanner';
import ProjectChatSidebar, { ChatLauncherButton } from '@/components/agent-chat-sidebar';
import { CameoBadge, CameoSummary } from '@/components/cameo/CameoStoryboardWidgets';

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
  const videos = assets.filter((a: any) => a.type === 'video').sort((a: any, b: any) => (a.shotNumber || 0) - (b.shotNumber || 0));
  const timeline = assets.find((a: any) => a.type === 'timeline');
  const review = project.directorNotes;
  const script = project.scriptData || scriptAsset?.data;

  const tabs = [
    { key: 'script', label: '剧本', icon: FileText, count: script?.shots?.length || 0 },
    { key: 'characters', label: '角色', icon: Users, count: characters.length },
    { key: 'scenes', label: '场景', icon: Mountain, count: scenes.length },
    { key: 'storyboard', label: '分镜', icon: Film, count: storyboards.length },
    { key: 'videos', label: '视频', icon: Video, count: videos.length },
    { key: 'play', label: '完整播放', icon: Play, count: 0 },
  ];

  return (
    <div className="min-h-screen bg-[var(--background)] text-white">
      {/* Nav */}
      <nav className="sticky top-0 z-50 bg-[var(--background)]/80 backdrop-blur-xl border-b border-[var(--border)]">
        <div className="max-w-6xl mx-auto px-6 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link href="/dashboard/projects" className="p-2 rounded-lg hover:bg-white/10 transition-colors">
              <ArrowLeft className="w-4 h-4" />
            </Link>
            <div>
              <h1 className="text-lg font-semibold">{project.title}</h1>
              <p className="text-xs text-gray-400">{project.status === 'completed' ? '已完成' : '创作中'}</p>
            </div>
          </div>
          {review && (
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-white/5 border border-white/10">
              <Star className="w-4 h-4 text-orange-400" />
              <span className="text-sm font-medium">{review.overallScore}/100</span>
            </div>
          )}
        </div>
      </nav>

      <main className="max-w-6xl mx-auto px-6 py-8">
        {/* Synopsis */}
        {script?.synopsis && (
          <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="mb-6 p-5 bg-white/5 border border-white/10 rounded-2xl">
            <p className="text-sm text-gray-300 leading-relaxed">{script.synopsis}</p>
            {script.theme && <p className="text-xs text-[#E8C547] mt-2">主题：{script.theme}</p>}
          </motion.div>
        )}

        {/* v2.11: 最近一次润色的行业体检单 (如果有) */}
        {scriptAsset?.data?.latestPolish ? (
          <LatestPolishBanner entry={scriptAsset.data.latestPolish} projectId={id} />
        ) : null}

        {/* v2.12 Phase 1: 多角色锁脸预览 — 创作工坊上传的 1-3 个角色全部展示 */}
        {Array.isArray(project.lockedCharacters) && project.lockedCharacters.length > 0 && (
          <div className="mb-4 p-4 rounded-2xl border border-[#E8C547]/30 bg-gradient-to-r from-[#E8C547]/8 to-transparent">
            <div className="flex items-center gap-2 mb-3">
              <span className="text-xs font-semibold text-[#E8C547]">🔒 已锁定 {project.lockedCharacters.length} 个主要角色</span>
              <span className="text-[10px] text-gray-500">·  创作时上传 ·  全片这些角色脸保持一致</span>
            </div>
            <div className="flex gap-3 flex-wrap">
              {project.lockedCharacters.map((c: any, idx: number) => {
                const roleLabel = ({ lead: '主角', antagonist: '对手', supporting: '配角', cameo: '客串' } as Record<string, string>)[c.role] || c.role || '角色';
                return (
                  <div key={idx} className="flex items-center gap-2 px-2 py-1.5 rounded-xl bg-black/30 border border-white/8">
                    <img src={c.imageUrl} alt={c.name} className="w-9 h-9 rounded-lg object-cover" loading="lazy" />
                    <div className="text-xs leading-tight">
                      <div className="font-medium text-white">{c.name}</div>
                      <div className="text-[10px] text-gray-400">{roleLabel} · cw={c.cw}</div>
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

        {/* Tabs */}
        <div className="flex gap-1 mb-6 bg-white/5 p-1 rounded-xl w-fit overflow-x-auto">
          {tabs.map(t => (
            <button key={t.key} onClick={() => setActiveTab(t.key)}
              className={`flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm whitespace-nowrap transition-all ${
                activeTab === t.key ? 'bg-gradient-to-r from-[#E8C547] to-[#D4A830] text-white' : 'text-gray-400 hover:text-white hover:bg-white/5'
              }`}>
              <t.icon className="w-3.5 h-3.5" />
              {t.label}
              {t.count > 0 && <span className="text-[10px] opacity-70">({t.count})</span>}
            </button>
          ))}
        </div>

        {/* Content */}
        <motion.div key={activeTab} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
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
                <div className="mb-3 px-3 py-2 rounded-lg bg-violet-500/10 border border-violet-500/25 text-[12px] text-violet-100">
                  {batchRetryMsg}
                </div>
              ) : null}

              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
                {storyboards.map((sb: any) => (
                  <div key={sb.id} className="relative bg-white/5 border border-white/10 rounded-xl overflow-hidden">
                    {/* Sprint A.4 · 右上角 Cameo 徽章 (没分数时不渲染) */}
                    <CameoBadge data={sb.data || {}} />
                    {sb.mediaUrls?.[0] && (
                      <img src={sb.mediaUrls[0]} alt={sb.name} className="w-full aspect-video object-cover" />
                    )}
                    <div className="px-3 py-2">
                      <span className="text-[10px] text-cyan-400 font-medium">镜头 {sb.shotNumber}</span>
                      <p className="text-[11px] text-gray-400 line-clamp-2 mt-0.5">{sb.data?.description?.slice(0, 60)}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
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
    </div>
  );
}
