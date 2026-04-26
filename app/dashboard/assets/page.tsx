'use client';

import { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { Users, Mountain, Film, Video, Music, FileText, Package, Play } from 'lucide-react';
import { VideoModal } from '@/components/ui/video-modal';
import { ImageLightboxModal } from '@/components/ui/image-lightbox';
import { AudioPlayerModal } from '@/components/ui/audio-player-modal';
import { ScriptViewerModal } from '@/components/ui/script-viewer-modal';

interface AssetItem {
  id: string;
  projectId: string;
  type: string;
  name: string;
  data: Record<string, any>;
  mediaUrls: string[];
  shotNumber?: number;
  version: number;
  confirmed: boolean;
  createdAt: string;
  updatedAt: string;
}

const TYPE_META: Record<string, { label: string; icon: any; color: string }> = {
  character: { label: '角色', icon: Users, color: 'text-amber-400 bg-amber-500/15' },
  scene: { label: '场景', icon: Mountain, color: 'text-emerald-400 bg-emerald-500/15' },
  storyboard: { label: '分镜', icon: Film, color: 'text-cyan-400 bg-cyan-500/15' },
  video: { label: '视频', icon: Video, color: 'text-pink-400 bg-pink-500/15' },
  script: { label: '剧本', icon: FileText, color: 'text-purple-400 bg-purple-500/15' },
  music: { label: '配乐', icon: Music, color: 'text-indigo-400 bg-indigo-500/15' },
  final_video: { label: '成片', icon: Play, color: 'text-rose-400 bg-rose-500/15' },
  timeline: { label: '时间线', icon: Film, color: 'text-blue-400 bg-blue-500/15' },
};

const TYPE_FILTERS = ['all', 'character', 'scene', 'storyboard', 'video', 'music', 'script'];

function isImageAsset(asset: AssetItem): boolean {
  if (!asset.mediaUrls?.length) return false;
  const url = asset.mediaUrls[0];
  if (url.startsWith('data:image/svg')) return false;
  if (['character', 'scene', 'storyboard'].includes(asset.type)) return true;
  if (/\.(jpg|jpeg|png|gif|webp)/i.test(url)) return true;
  return false;
}

// ImagePreviewModal 已抽成共享组件 @/components/ui/image-lightbox#ImageLightboxModal
// 见 components/nodes/character-node/scene-node 也复用同一个 modal


export default function AssetsPage() {
  const [assets, setAssets] = useState<AssetItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('all');
  const [videoModalOpen, setVideoModalOpen] = useState(false);
  const [videoSrc, setVideoSrc] = useState('');
  const [videoTitle, setVideoTitle] = useState('');
  const [imagePreview, setImagePreview] = useState<{ src: string; title: string; index: number } | null>(null);
  const [audioModal, setAudioModal] = useState<{ open: boolean; src: string; title: string; subtitle?: string }>({ open: false, src: '', title: '' });
  const [scriptModal, setScriptModal] = useState<{ open: boolean; name: string; data: any; projectId?: string }>({ open: false, name: '', data: {} });

  useEffect(() => {
    fetchAssets();
  }, []);

  const fetchAssets = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/assets');
      const data = await res.json();
      setAssets(Array.isArray(data) ? data : []);
    } catch {
      setAssets([]);
    }
    setLoading(false);
  };

  const filtered = filter === 'all' ? assets : assets.filter(a => a.type === filter);
  const imageAssets = filtered.filter(a => isImageAsset(a));

  const handleMediaClick = (asset: AssetItem) => {
    const url = asset.mediaUrls?.[0];
    if (!url) return;

    if (['video', 'final_video'].includes(asset.type)) {
      setVideoSrc(url);
      setVideoTitle(asset.name);
      setVideoModalOpen(true);
    } else if (asset.type === 'music') {
      // v2.11: 用带进度条的 AudioPlayerModal 替代裸 new Audio().play()
      const subtitle = [asset.data?.mood, asset.data?.bpm ? `${asset.data.bpm}bpm` : null]
        .filter(Boolean).join(' · ') || undefined;
      setAudioModal({ open: true, src: url, title: asset.name, subtitle });
    } else if (isImageAsset(asset)) {
      const idx = imageAssets.findIndex(a => a.id === asset.id);
      setImagePreview({ src: url, title: asset.name, index: idx >= 0 ? idx : 0 });
    }
  };

  const openAsset = (asset: AssetItem) => {
    // 剧本资产没有 mediaUrls, 不走 handleMediaClick
    if (asset.type === 'script') {
      setScriptModal({ open: true, name: asset.name, data: asset.data || {}, projectId: asset.projectId });
      return;
    }
    handleMediaClick(asset);
  };

  const navigateImage = (delta: number) => {
    if (!imagePreview) return;
    const next = imagePreview.index + delta;
    if (next < 0 || next >= imageAssets.length) return;
    const a = imageAssets[next];
    setImagePreview({ src: a.mediaUrls[0], title: a.name, index: next });
  };

  return (
    <div>
      <div className="flex justify-between items-center mb-6">
        <div>
          <h2 className="text-2xl font-bold flex items-center gap-2">
            <Package className="w-6 h-6 text-[#E8C547]" />
            素材库
          </h2>
          <p className="text-sm text-[var(--muted)] mt-1">
            创作产生的数字资产 · 共 {assets.length} 个
          </p>
        </div>
      </div>

      {/* 类型筛选 */}
      <div className="flex gap-2 mb-6 overflow-x-auto pb-2">
        {TYPE_FILTERS.map(t => {
          const meta = TYPE_META[t];
          const count = t === 'all' ? assets.length : assets.filter(a => a.type === t).length;
          return (
            <button
              key={t}
              onClick={() => setFilter(t)}
              className={`shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium transition-all ${
                filter === t
                  ? 'bg-[#E8C547]/20 text-[#E8C547] border border-[#E8C547]/30'
                  : 'bg-white/5 text-gray-400 border border-transparent hover:bg-white/10'
              }`}
            >
              {t === 'all' ? '全部' : meta?.label || t}
              <span className="text-[10px] opacity-60">({count})</span>
            </button>
          );
        })}
      </div>

      {/* 资产网格 */}
      {loading ? (
        <div className="text-center py-20 text-gray-500">
          <div className="w-8 h-8 border-2 border-[#E8C547] border-t-transparent rounded-full animate-spin mx-auto mb-3" />
          加载中...
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-20 text-gray-500">
          <Package className="w-12 h-12 mx-auto mb-3 opacity-30" />
          <p className="text-sm">{filter === 'all' ? '暂无素材' : '该类型暂无素材'}</p>
          <p className="text-xs mt-1 text-gray-600">完成一次创作后，生成的角色、场景、分镜等素材会自动入库</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {filtered.map(asset => {
            const meta = TYPE_META[asset.type] || TYPE_META.script;
            const IconComp = meta.icon;
            const hasMedia = asset.mediaUrls?.length > 0;
            const isImg = isImageAsset(asset);
            const isVid = hasMedia && ['video', 'final_video'].includes(asset.type);

            return (
              <div
                key={asset.id}
                className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl overflow-hidden group hover:-translate-y-1 hover:shadow-[0_12px_40px_rgba(0,0,0,0.4)] transition-all duration-300 cursor-pointer"
                onClick={() => openAsset(asset)}
              >
                {/* 媒体预览 */}
                <div className="h-[140px] bg-black/30 relative overflow-hidden">
                  {isImg && asset.mediaUrls[0] ? (
                    <img src={asset.mediaUrls[0]} alt={asset.name} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300" />
                  ) : isVid && asset.mediaUrls[0] ? (
                    <>
                      <video src={asset.mediaUrls[0]} muted preload="metadata" className="w-full h-full object-cover" />
                      <div className="absolute inset-0 bg-black/20 opacity-0 group-hover:opacity-100 transition-opacity grid place-items-center">
                        <Play className="w-8 h-8 text-white" />
                      </div>
                    </>
                  ) : (
                    <div className="w-full h-full grid place-items-center">
                      <IconComp className={`w-10 h-10 opacity-20 ${meta.color.split(' ')[0]}`} />
                    </div>
                  )}

                  {/* 类型标签 */}
                  <div className={`absolute top-2 left-2 px-2 py-0.5 rounded-full text-[10px] font-medium ${meta.color}`}>
                    {meta.label}
                  </div>

                  {/* 版本标签 */}
                  {asset.version > 1 && (
                    <div className="absolute top-2 right-2 px-1.5 py-0.5 rounded-full bg-black/60 text-[9px] text-white">
                      v{asset.version}
                    </div>
                  )}
                </div>

                {/* 信息 */}
                <div className="p-3">
                  <h4 className="text-sm font-medium text-white truncate">{asset.name}</h4>
                  {asset.data?.description && (
                    <p className="text-[11px] text-gray-400 mt-1 line-clamp-2">{asset.data.description}</p>
                  )}
                  <div className="flex items-center justify-between mt-2">
                    <span className="text-[10px] text-gray-500">
                      {new Date(asset.createdAt).toLocaleDateString('zh-CN')}
                    </span>
                    {asset.shotNumber && (
                      <span className="text-[10px] text-cyan-500">镜头 {asset.shotNumber}</span>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <VideoModal
        open={videoModalOpen}
        onOpenChange={setVideoModalOpen}
        src={videoSrc}
        title={videoTitle}
      />

      {imagePreview && (
        <ImageLightboxModal
          src={imagePreview.src}
          title={imagePreview.title}
          onClose={() => setImagePreview(null)}
          onPrev={() => navigateImage(-1)}
          onNext={() => navigateImage(1)}
          hasPrev={imagePreview.index > 0}
          hasNext={imagePreview.index < imageAssets.length - 1}
        />
      )}

      <AudioPlayerModal
        open={audioModal.open}
        onOpenChange={(o) => setAudioModal((s) => ({ ...s, open: o }))}
        src={audioModal.src}
        title={audioModal.title}
        subtitle={audioModal.subtitle}
      />

      <ScriptViewerModal
        open={scriptModal.open}
        onOpenChange={(o) => setScriptModal((s) => ({ ...s, open: o }))}
        name={scriptModal.name}
        data={scriptModal.data}
        projectId={scriptModal.projectId}
      />
    </div>
  );
}
