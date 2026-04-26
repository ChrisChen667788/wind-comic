'use client';

/**
 * /dashboard/u2v · Sprint C.1 — 单图 → 视频独立工具页
 *
 * 不进项目主管线,纯独立工具:
 *   1. 用户贴 image URL 或上传文件
 *   2. 写一句描述 (希望画面如何动)
 *   3. 选时长 (5s / 6s)
 *   4. 点生成 → 等 1-3 分钟 → 内嵌 video player + 下载按钮
 */

import { useRef, useState } from 'react';
import { Upload, Link as LinkIcon, Play, Download, Loader2, Sparkles } from 'lucide-react';
import { useToast } from '@/components/ui/toast-provider';

export default function U2VPage() {
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [imageUrl, setImageUrl] = useState('');
  const [imagePreview, setImagePreview] = useState('');
  const [urlDraft, setUrlDraft] = useState('');
  const [showUrlInput, setShowUrlInput] = useState(false);
  const [prompt, setPrompt] = useState('');
  const [duration, setDuration] = useState<5 | 6>(5);
  const [generating, setGenerating] = useState(false);
  const [resultUrl, setResultUrl] = useState('');
  const { showToast } = useToast();

  const uploadFile = async (file: File) => {
    if (!file.type.startsWith('image/')) {
      showToast({ title: '只能上传图片', type: 'error' });
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      showToast({ title: '图片太大(上限 10MB)', type: 'error' });
      return;
    }
    const form = new FormData();
    form.append('file', file);
    const res = await fetch('/api/upload/character-face', { method: 'POST', body: form });
    const body = await res.json();
    if (!res.ok) {
      showToast({ title: body.error || '上传失败', type: 'error' });
      return;
    }
    setImageUrl(body.url);
    setImagePreview(body.url);
  };

  const acceptUrl = async () => {
    const trimmed = urlDraft.trim();
    if (!trimmed) return;
    if (!/^https?:\/\//i.test(trimmed)) {
      showToast({ title: 'URL 必须以 http(s):// 开头', type: 'error' });
      return;
    }
    const res = await fetch('/api/upload/character-face', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ imageUrl: trimmed }),
    });
    const body = await res.json();
    if (!res.ok) {
      showToast({ title: body.error || 'URL 抓取失败', type: 'error' });
      return;
    }
    setImageUrl(body.url);
    setImagePreview(body.url);
    setShowUrlInput(false);
    setUrlDraft('');
  };

  const generate = async () => {
    if (!imageUrl || !prompt.trim()) {
      showToast({ title: '需要先上传图片 + 写一句描述', type: 'error' });
      return;
    }
    setGenerating(true);
    setResultUrl('');
    try {
      const res = await fetch('/api/u2v', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imageUrl, prompt, duration }),
      });
      const body = await res.json();
      if (!res.ok) {
        showToast({ title: body.error || '生成失败', type: 'error' });
        return;
      }
      setResultUrl(body.videoUrl);
      showToast({ title: '生成成功!', type: 'success' });
    } catch (e) {
      showToast({ title: e instanceof Error ? e.message : '生成失败', type: 'error' });
    } finally {
      setGenerating(false);
    }
  };

  return (
    <div className="max-w-4xl mx-auto py-6">
      <div className="mb-6">
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <Sparkles className="w-6 h-6 text-[#E8C547]" />
          单图变视频(I2V)
        </h1>
        <p className="text-sm text-[var(--soft)] mt-1">
          上传一张图,写一句描述 — Minimax I2V-01 给你 5-6s 视频。独立工具,不进项目管线。
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {/* 输入区 */}
        <div className="bg-[rgba(255,255,255,0.06)] border border-[var(--border)] rounded-2xl p-5 space-y-4">
          <div>
            <label className="text-xs text-[var(--soft)] uppercase tracking-wider">输入图片</label>
            <div
              onClick={() => !imagePreview && fileRef.current?.click()}
              className={`mt-2 aspect-video rounded-xl overflow-hidden flex items-center justify-center border ${
                imagePreview ? 'border-[#E8C547]/30 bg-black/20' : 'cursor-pointer border-dashed border-white/15 bg-white/[0.02] hover:bg-white/5'
              }`}
            >
              {imagePreview ? (
                <img src={imagePreview} alt="preview" className="w-full h-full object-cover" />
              ) : (
                <div className="text-center text-[var(--soft)]">
                  <Upload className="w-7 h-7 mx-auto mb-1 opacity-50" />
                  <div className="text-xs">点击上传 或 用 URL</div>
                </div>
              )}
            </div>
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={e => {
                const f = e.target.files?.[0];
                if (f) uploadFile(f);
                if (fileRef.current) fileRef.current.value = '';
              }}
            />
            <div className="flex gap-2 mt-2">
              <button
                onClick={() => fileRef.current?.click()}
                className="flex-1 px-3 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-xs inline-flex items-center justify-center gap-1.5"
              >
                <Upload className="w-3.5 h-3.5" />
                上传文件
              </button>
              <button
                onClick={() => setShowUrlInput(v => !v)}
                className="flex-1 px-3 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-xs inline-flex items-center justify-center gap-1.5"
              >
                <LinkIcon className="w-3.5 h-3.5" />
                用 URL
              </button>
            </div>
            {showUrlInput && (
              <div className="mt-2 flex gap-1">
                <input
                  type="url"
                  value={urlDraft}
                  onChange={e => setUrlDraft(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') acceptUrl(); }}
                  placeholder="https://..."
                  className="flex-1 px-2 py-1 text-xs bg-black/30 border border-white/10 rounded focus:outline-none focus:border-[#E8C547]/50"
                />
                <button
                  onClick={acceptUrl}
                  disabled={!urlDraft.trim()}
                  className="px-3 py-1 text-xs rounded bg-[#E8C547]/15 text-[#E8C547] hover:bg-[#E8C547]/25 disabled:opacity-40"
                >
                  抓取
                </button>
              </div>
            )}
          </div>

          <div>
            <label className="text-xs text-[var(--soft)] uppercase tracking-wider">描述如何动</label>
            <textarea
              value={prompt}
              onChange={e => setPrompt(e.target.value)}
              placeholder="例如:人物缓缓抬头,风吹动头发,背景虚化"
              maxLength={500}
              rows={3}
              className="mt-2 w-full px-3 py-2 bg-black/30 border border-white/10 rounded-lg focus:outline-none focus:border-[#E8C547]/50 text-sm resize-none"
            />
            <div className="text-[10px] text-[var(--soft)] mt-1 text-right">{prompt.length} / 500</div>
          </div>

          <div>
            <label className="text-xs text-[var(--soft)] uppercase tracking-wider">时长</label>
            <div className="mt-2 flex gap-2">
              {([5, 6] as const).map(d => (
                <button
                  key={d}
                  onClick={() => setDuration(d)}
                  className={`flex-1 px-3 py-1.5 rounded-lg text-sm transition ${
                    duration === d
                      ? 'bg-[#E8C547] text-black font-semibold'
                      : 'bg-white/5 hover:bg-white/10 text-white/70'
                  }`}
                >
                  {d}s
                </button>
              ))}
            </div>
          </div>

          <button
            onClick={generate}
            disabled={generating || !imageUrl || !prompt.trim()}
            className="w-full px-4 py-2.5 rounded-xl bg-[#E8C547] hover:bg-[#E8C547]/90 disabled:opacity-40 disabled:cursor-not-allowed text-black font-semibold inline-flex items-center justify-center gap-2"
          >
            {generating ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                生成中(1-3 分钟)...
              </>
            ) : (
              <>
                <Play className="w-4 h-4" />
                生成视频
              </>
            )}
          </button>
        </div>

        {/* 结果区 */}
        <div className="bg-[rgba(255,255,255,0.06)] border border-[var(--border)] rounded-2xl p-5">
          <label className="text-xs text-[var(--soft)] uppercase tracking-wider">结果预览</label>
          <div className="mt-2 aspect-video rounded-xl overflow-hidden bg-black/40 flex items-center justify-center">
            {resultUrl ? (
              <video src={resultUrl} controls autoPlay loop className="w-full h-full object-contain" />
            ) : generating ? (
              <div className="text-center text-[var(--soft)] text-sm">
                <Loader2 className="w-8 h-8 mx-auto mb-2 animate-spin opacity-60" />
                Minimax I2V-01 正在跑 — 通常 1-3 分钟
              </div>
            ) : (
              <div className="text-center text-[var(--soft)] text-sm opacity-60">
                结果将出现在这里
              </div>
            )}
          </div>
          {resultUrl && (
            <a
              href={resultUrl}
              download={`u2v-${Date.now()}.mp4`}
              target="_blank"
              rel="noopener"
              className="mt-3 w-full px-4 py-2 rounded-xl bg-white/5 hover:bg-white/10 text-sm inline-flex items-center justify-center gap-1.5"
            >
              <Download className="w-3.5 h-3.5" />
              下载 MP4
            </a>
          )}
        </div>
      </div>
    </div>
  );
}
