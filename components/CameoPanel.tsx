'use client';

/**
 * CameoPanel (v2.10)
 *
 * 项目详情页的"主角脸锁定"卡片 —— Cameo 闭环 UI。
 *
 * 状态:
 *   - 空:展示"上传主角脸"CTA + 解释锁脸的价值
 *   - 已锁定:展示缩略图 + 替换/删除按钮
 *
 * 接的后端:GET/POST/DELETE /api/projects/:id/cameo
 *
 * 为什么 project detail 页放这个:
 *   创建时用户可能忘了上传,或者生成完看到"每个 shot 脸都不一样"才意识到
 *   需要锁。放在项目内的最显眼位置,配合下面的再生成镜头功能,闭环。
 */

import { useEffect, useRef, useState } from 'react';
import { UserCircle2, Upload, Trash2, Loader2, Lock, CheckCircle2, Sparkles } from 'lucide-react';
import { useToast } from './ui/toast-provider';
import { CameoScoreBadge, type CameoScoreBadgeData } from './CameoScoreBadge';

interface Props {
  projectId: string;
  /** 父组件传入当前已知的 Cameo URL(来自 projects/:id 的初始加载),可为 null */
  initialUrl?: string | null;
  /** 变更后回调给父组件,父组件可刷新项目数据 */
  onChange?: (nextUrl: string | null) => void;
}

export function CameoPanel({ projectId, initialUrl = null, onChange }: Props) {
  const [url, setUrl] = useState<string | null>(initialUrl || null);
  const [busy, setBusy] = useState<'idle' | 'upload' | 'delete'>('idle');
  const inputRef = useRef<HTMLInputElement | null>(null);
  const { showToast } = useToast();

  // v2.11 #2: 上传完成后异步打分,展示适配度徽章
  const [scoreLoading, setScoreLoading] = useState(false);
  const [scoreError, setScoreError] = useState<string | null>(null);
  const [scoreData, setScoreData] = useState<CameoScoreBadgeData | null>(null);

  useEffect(() => {
    setUrl(initialUrl || null);
    // 初始 URL 变化时清掉旧评分(不自动触发评分 —— 避免反复打开页面烧钱;
    //                            用户主动点"重新评分"或替换文件时才调)
    setScoreData(null);
    setScoreError(null);
  }, [initialUrl]);

  /** 对已持久化的 URL 跑 vision 打分 */
  const runPreviewScore = async (imageUrl: string) => {
    setScoreLoading(true);
    setScoreError(null);
    setScoreData(null);
    try {
      const res = await fetch('/api/cameo/preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imageUrl }),
      });
      if (res.status === 503) {
        setScoreError('vision 服务暂未启用');
        return;
      }
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setScoreError(body.error || `HTTP ${res.status}`);
        return;
      }
      const data = await res.json();
      setScoreData(data);
      // 低分时弹 toast 主动提示,让用户别错过
      if (data.verdict === 'poor') {
        showToast({
          title: `这张照片评分偏低 (${data.score}),建议优化后重传`,
          type: 'warning',
        });
      }
    } catch (e) {
      setScoreError(e instanceof Error ? e.message : '评分失败');
    } finally {
      setScoreLoading(false);
    }
  };

  const handleUpload = async (file: File) => {
    if (!file.type.startsWith('image/')) {
      showToast({ title: '只能上传图片', type: 'error' });
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      showToast({ title: '图片太大（上限 10MB）', type: 'error' });
      return;
    }
    setBusy('upload');
    try {
      const form = new FormData();
      form.append('file', file);
      const res = await fetch(`/api/projects/${projectId}/cameo`, {
        method: 'POST',
        body: form,
      });
      const body = await res.json();
      if (!res.ok) {
        showToast({ title: body.error || '上传失败', type: 'error' });
        return;
      }
      setUrl(body.url);
      onChange?.(body.url);
      showToast({ title: '主角脸已锁定 ✓', type: 'success' });
      // 上传成功后 fire-and-forget 触发评分,不阻塞 UI
      runPreviewScore(body.url);
    } catch (e) {
      showToast({ title: e instanceof Error ? e.message : '上传失败', type: 'error' });
    } finally {
      setBusy('idle');
    }
  };

  const handleDelete = async () => {
    if (!confirm('确认解锁主角脸？后续镜头将由 Character Designer 自行决定角色外观。')) return;
    setBusy('delete');
    try {
      const res = await fetch(`/api/projects/${projectId}/cameo`, { method: 'DELETE' });
      if (!res.ok) {
        showToast({ title: '解锁失败', type: 'error' });
        return;
      }
      setUrl(null);
      onChange?.(null);
      setScoreData(null);
      setScoreError(null);
      showToast({ title: '已解锁主角脸', type: 'info' });
    } catch (e) {
      showToast({ title: e instanceof Error ? e.message : '解锁失败', type: 'error' });
    } finally {
      setBusy('idle');
    }
  };

  // 空态:未上传
  if (!url) {
    return (
      <div className="mb-6 p-5 bg-white/5 border border-dashed border-white/15 rounded-2xl [.cinema-page_&]:bg-[var(--cinema-surface)] [.cinema-page_&]:border [.cinema-page_&]:border-dashed [.cinema-page_&]:border-[var(--cinema-border-hi)] [.cinema-page_&]:rounded-none">
        <div className="flex items-start gap-4">
          <div className="w-12 h-12 rounded-xl bg-[#E8C547]/10 flex items-center justify-center flex-shrink-0 [.cinema-page_&]:rounded-sm [.cinema-page_&]:bg-[var(--cinema-amber-glow)]">
            <UserCircle2 className="w-6 h-6 text-[#E8C547] [.cinema-page_&]:text-[var(--cinema-amber)]" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <h3 className="font-semibold text-sm [.cinema-page_&]:hidden">主角脸未锁定</h3>
              <span className="hidden [.cinema-page_&]:inline cinema-eyebrow tracking-widest">CAMEO · 主角脸未锁定</span>
              <span className="px-1.5 py-0.5 bg-[#E8C547]/15 text-[#E8C547] text-[10px] rounded [.cinema-page_&]:hidden">Cameo</span>
            </div>
            <p className="text-xs text-gray-400 leading-relaxed [.cinema-page_&]:cinema-subhead [.cinema-page_&]:opacity-80">
              上传一张主角照片，全片所有镜头都会锁定同一张脸 —— 告别"每句台词换张脸"的跳脸问题。
            </p>
            <input
              ref={inputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) handleUpload(f);
                if (inputRef.current) inputRef.current.value = '';
              }}
            />
            <button
              type="button"
              onClick={() => inputRef.current?.click()}
              disabled={busy !== 'idle'}
              className="mt-3 inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-[#E8C547]/10 hover:bg-[#E8C547]/20 text-[#E8C547] text-xs font-medium transition disabled:opacity-50 [.cinema-page_&]:rounded-sm [.cinema-page_&]:bg-[var(--cinema-amber)] [.cinema-page_&]:text-black [.cinema-page_&]:font-semibold [.cinema-page_&]:hover:bg-[#D6B270]"
            >
              {busy === 'upload' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Upload className="w-3.5 h-3.5" />}
              <span className="[.cinema-page_&]:hidden">上传主角脸</span>
              <span className="hidden [.cinema-page_&]:inline cinema-mono tracking-wider text-[11px]">▲ UPLOAD CAMEO</span>
            </button>
          </div>
        </div>
      </div>
    );
  }

  // 已锁定态
  return (
    <div className="mb-6 p-5 bg-gradient-to-r from-[#E8C547]/5 to-transparent border border-[#E8C547]/20 rounded-2xl [.cinema-page_&]:bg-none [.cinema-page_&]:bg-[var(--cinema-surface-2)] [.cinema-page_&]:border [.cinema-page_&]:border-[var(--cinema-amber-deep)] [.cinema-page_&]:rounded-none">
      <div className="flex items-start gap-4">
        <div className="relative flex-shrink-0">
          <img
            src={url}
            alt="已锁定主角脸"
            className="w-20 h-20 rounded-xl object-cover border-2 border-[#E8C547]/40 [.cinema-page_&]:rounded-sm [.cinema-page_&]:border-[var(--cinema-amber)]"
            loading="lazy"
          />
          <div className="absolute -bottom-1 -right-1 w-6 h-6 rounded-full bg-[#E8C547] flex items-center justify-center border-2 border-[var(--background)] [.cinema-page_&]:rounded-sm [.cinema-page_&]:bg-[var(--cinema-amber)] [.cinema-page_&]:border-[var(--cinema-bg)]">
            <Lock className="w-3 h-3 text-black" />
          </div>
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <CheckCircle2 className="w-4 h-4 text-[#E8C547] [.cinema-page_&]:text-[var(--cinema-amber)]" />
            <h3 className="font-semibold text-sm text-[#E8C547] [.cinema-page_&]:hidden">主角脸已锁定</h3>
            <span className="hidden [.cinema-page_&]:inline cinema-eyebrow tracking-widest text-[var(--cinema-amber)] opacity-90">CAMEO · 主角脸已锁定</span>
          </div>
          <p className="text-xs text-gray-400 leading-relaxed [.cinema-page_&]:cinema-subhead [.cinema-page_&]:opacity-80">
            全片所有镜头都会用这张脸作主角参考；重新生成任意镜头都会继续锁定。
          </p>
          <div className="flex items-center gap-2 mt-3">
            <input
              ref={inputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) handleUpload(f);
                if (inputRef.current) inputRef.current.value = '';
              }}
            />
            <button
              type="button"
              onClick={() => inputRef.current?.click()}
              disabled={busy !== 'idle'}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-xs font-medium transition disabled:opacity-50"
            >
              {busy === 'upload' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Upload className="w-3.5 h-3.5" />}
              替换
            </button>
            <button
              type="button"
              onClick={handleDelete}
              disabled={busy !== 'idle'}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-red-500/10 hover:bg-red-500/20 text-red-400 text-xs font-medium transition disabled:opacity-50"
            >
              {busy === 'delete' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
              解锁
            </button>
            <button
              type="button"
              onClick={() => url && runPreviewScore(url)}
              disabled={busy !== 'idle' || scoreLoading || !url}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-gray-300 text-xs font-medium transition disabled:opacity-50"
              title="让 AI 评估这张脸的适配度"
            >
              {scoreLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
              {scoreData ? '重新评分' : '评估适配度'}
            </button>
          </div>
        </div>
      </div>
      {/* v2.11 #2: 评分卡片 —— 上传后自动触发,低分 toast 提醒 */}
      {(scoreLoading || scoreError || scoreData) && (
        <CameoScoreBadge
          loading={scoreLoading}
          error={scoreError}
          data={scoreData}
        />
      )}
    </div>
  );
}
