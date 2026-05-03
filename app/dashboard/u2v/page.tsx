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
import { CameraLanguagePicker } from '@/components/create/camera-language-picker';

// v2.14 P0.4: 长镜头档位 — 5/6s 走 Minimax I2V-01, 10s 走 Kling Master, 15s 走 Vidu Q3 Pro.
// 客户端只看到统一选项, 后端 /api/u2v 根据 duration 自动选模型 (见 P0.4 路由).
type DurationOption = 5 | 6 | 10 | 15;
const DURATION_OPTIONS: Array<{ value: DurationOption; label: string; engineHint: string }> = [
  { value: 5,  label: '5s',  engineHint: 'Minimax I2V-01' },
  { value: 6,  label: '6s',  engineHint: 'Minimax I2V-01' },
  { value: 10, label: '10s', engineHint: 'Kling Master' },
  { value: 15, label: '15s', engineHint: 'Vidu Q3 Pro' },
];

export default function U2VPage() {
  const fileRef = useRef<HTMLInputElement | null>(null);
  const tailFileRef = useRef<HTMLInputElement | null>(null);
  const [imageUrl, setImageUrl] = useState('');
  const [imagePreview, setImagePreview] = useState('');
  const [urlDraft, setUrlDraft] = useState('');
  const [showUrlInput, setShowUrlInput] = useState(false);
  // v2.14 P0.3: 首尾帧融合 — 当 tailImageUrl 非空时, 路由切到 /api/u2v-flf
  const [tailImageUrl, setTailImageUrl] = useState('');
  const [tailImagePreview, setTailImagePreview] = useState('');
  const [prompt, setPrompt] = useState('');
  const [duration, setDuration] = useState<DurationOption>(5);
  // v2.14 P0.2: 镜头语言预设 id (来自 CAMERA_LANGUAGE_PRESETS)
  const [cameraPreset, setCameraPreset] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);
  const [resultUrl, setResultUrl] = useState('');
  const { showToast } = useToast();
  const isFlfMode = !!tailImageUrl;

  /**
   * 上传图片到 /api/upload/character-face, 拿到 URL 后塞回对应槽位 (first / tail).
   * v2.14 P0.3: 加 slot 参数, 区分主图(单图视频或首帧)和尾帧。
   */
  const uploadFile = async (file: File, slot: 'first' | 'tail' = 'first') => {
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
    if (slot === 'first') {
      setImageUrl(body.url);
      setImagePreview(body.url);
    } else {
      setTailImageUrl(body.url);
      setTailImagePreview(body.url);
    }
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
      // v2.14 P0.3: 有尾帧 → 走 /api/u2v-flf 首尾帧融合; 否则走单图 /api/u2v
      const endpoint = isFlfMode ? '/api/u2v-flf' : '/api/u2v';
      const requestBody = isFlfMode
        ? {
            firstFrameUrl: imageUrl,
            lastFrameUrl: tailImageUrl,
            prompt,
            // FLF 路径 Kling 上限 10s
            duration: duration === 5 || duration === 6 ? 5 : 10,
            cameraPreset,
          }
        : { imageUrl, prompt, duration, cameraPreset };
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody),
      });
      const body = await res.json();
      if (!res.ok) {
        showToast({ title: body.error || '生成失败', type: 'error' });
        return;
      }
      setResultUrl(body.videoUrl);
      const modelHint = body.model ? ` · ${body.model}` : '';
      const warnHint = body.warning ? `(${body.warning.slice(0, 60)})` : '';
      showToast({ title: `生成成功!${modelHint} ${warnHint}`, type: 'success' });
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
                if (f) uploadFile(f, 'first');
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

          {/* v2.14 P0.3: 尾帧上传槽位 — 可选, 上传后路由切到 /api/u2v-flf 首尾帧融合 */}
          {imageUrl && (
            <div>
              <label className="text-xs text-[var(--soft)] uppercase tracking-wider flex items-center justify-between">
                <span>尾帧 (可选 · 启用首尾帧融合)</span>
                {isFlfMode && (
                  <button
                    onClick={() => { setTailImageUrl(''); setTailImagePreview(''); }}
                    className="text-[10px] text-[#E8C547] hover:underline"
                  >
                    清空
                  </button>
                )}
              </label>
              <div
                onClick={() => !tailImagePreview && tailFileRef.current?.click()}
                className={`mt-2 aspect-video rounded-xl overflow-hidden flex items-center justify-center border ${
                  tailImagePreview ? 'border-[#E8C547]/30 bg-black/20' : 'cursor-pointer border-dashed border-white/10 bg-white/[0.02] hover:bg-white/5'
                }`}
              >
                {tailImagePreview ? (
                  <img src={tailImagePreview} alt="tail preview" className="w-full h-full object-cover" />
                ) : (
                  <div className="text-center text-[var(--soft)]">
                    <Upload className="w-5 h-5 mx-auto mb-1 opacity-40" />
                    <div className="text-[11px]">点击上传尾帧 · Kling 自动补中间运动</div>
                  </div>
                )}
              </div>
              <input
                ref={tailFileRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={e => {
                  const f = e.target.files?.[0];
                  if (f) uploadFile(f, 'tail');
                  if (tailFileRef.current) tailFileRef.current.value = '';
                }}
              />
              {isFlfMode && (
                <div className="mt-1 text-[10px] text-[#E8C547]/80">
                  ✦ 模式: 首尾帧融合 · 引擎: Kling Master (失败回退 Minimax 单图)
                </div>
              )}
            </div>
          )}

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

          {/* v2.14 P0.2: 镜头语言预设 — chip 单选, 不强制 */}
          <CameraLanguagePicker value={cameraPreset} onChange={setCameraPreset} disabled={generating} />

          <div>
            <label className="text-xs text-[var(--soft)] uppercase tracking-wider">时长</label>
            <div className="mt-2 flex gap-2">
              {DURATION_OPTIONS.map(opt => (
                <button
                  key={opt.value}
                  onClick={() => setDuration(opt.value)}
                  disabled={generating}
                  title={`${opt.label} · 后端走 ${opt.engineHint}`}
                  className={`flex-1 px-3 py-1.5 rounded-lg text-sm transition ${
                    duration === opt.value
                      ? 'bg-[#E8C547] text-black font-semibold'
                      : 'bg-white/5 hover:bg-white/10 text-white/70'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
            <div className="text-[10px] text-[var(--soft)] mt-1 opacity-60">
              {DURATION_OPTIONS.find(o => o.value === duration)?.engineHint}
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
