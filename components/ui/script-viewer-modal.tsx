'use client';

/**
 * ScriptViewerModal — 剧本资产专用查看器。
 *
 * 之前素材库对 script 资产的处理是 `alert(asset.data.synopsis || '无内容')`,
 * 体验极差:只弹一行纯文本,看不到分镜、对白、动作、镜头语言。
 *
 * /api/assets 实际已经把完整 data 打回来(包含 title / synopsis / shots[]),
 * 所以这里只是把结构化数据渲染成可阅读的分镜剧本。
 *
 * 渲染结构(与 types/agents.ts#ScriptShot 对齐):
 *   - 标题 + 一句话梗概 + 幕数统计
 *   - 按 Shot 依次展开,每个 Shot 显示:
 *     · 镜头号 / 幕号 / Beat / 时长
 *     · 场景描述 + 动作 + 情绪
 *     · 对白(如有,高亮)
 *     · 摄影语言(shot size / lens / angle / movement / lighting)
 *     · 视觉 prompt / subtext(可折叠)
 *
 * 支持:
 *   - ESC 关闭
 *   - 复制全文(一键)
 *   - 下载 .txt
 */

import { useEffect, useState, useCallback, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { X, FileText, Copy, Download, Check, Wand2 } from 'lucide-react';
import Link from 'next/link';

interface ScriptShot {
  shotNumber: number;
  sceneDescription?: string;
  action?: string;
  emotion?: string;
  characters?: string[];
  dialogue?: string;
  act?: number;
  storyBeat?: string;
  beat?: string;
  visualPrompt?: string;
  subtext?: string;
  emotionTemperature?: number;
  cameraWork?: string;
  soundDesign?: string;
  duration?: number;
  // v2.8 摄影语言
  shotSize?: string;
  lens?: string;
  cameraAngle?: string;
  cameraMovement?: string;
  lightingIntent?: string;
  composition?: string;
  editPattern?: string;
  whyThisChoice?: string;
  diegeticSound?: string;
  scoreMood?: string;
  rhythmicSync?: string;
}

interface ScriptData {
  title?: string;
  synopsis?: string;
  description?: string;
  genre?: string;
  style?: string;
  shots?: ScriptShot[];
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  name: string;
  data: ScriptData;
  /** 若传入, 会在工具栏多出一个"润色"按钮, 跳到 /dashboard/polish?projectId=xxx */
  projectId?: string;
}

/** 把 ScriptData 序列化成适合复制/下载的纯文本 */
function scriptToText(name: string, data: ScriptData): string {
  const lines: string[] = [];
  lines.push(`《${data.title || name}》`);
  if (data.synopsis) lines.push(`\n梗概:${data.synopsis}`);
  if (data.genre || data.style) {
    lines.push(`\n类型:${[data.genre, data.style].filter(Boolean).join(' · ')}`);
  }
  lines.push('');
  (data.shots || []).forEach((s) => {
    lines.push(`\n───── Shot ${s.shotNumber}${s.act ? ` · 第${s.act}幕` : ''} ${s.storyBeat || s.beat || ''} ─────`);
    if (s.sceneDescription) lines.push(`[场景] ${s.sceneDescription}`);
    if (s.characters?.length) lines.push(`[人物] ${s.characters.join('、')}`);
    if (s.action) lines.push(`[动作] ${s.action}`);
    if (s.emotion) lines.push(`[情绪] ${s.emotion}`);
    if (s.dialogue) lines.push(`[对白] ${s.dialogue}`);
    const cam = [s.shotSize, s.lens, s.cameraAngle, s.cameraMovement].filter(Boolean).join(' / ');
    if (cam) lines.push(`[镜头] ${cam}`);
    if (s.lightingIntent) lines.push(`[光影] ${s.lightingIntent}`);
    if (s.subtext) lines.push(`[潜台词] ${s.subtext}`);
    if (s.visualPrompt) lines.push(`[视觉 Prompt] ${s.visualPrompt}`);
    if (s.duration) lines.push(`[时长] ${s.duration}s`);
  });
  return lines.join('\n');
}

export function ScriptViewerModal({ open, onOpenChange, name, data, projectId }: Props) {
  const [mounted, setMounted] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    setMounted(true);
    return () => setMounted(false);
  }, []);

  const handleClose = useCallback(() => onOpenChange(false), [onOpenChange]);

  useEffect(() => {
    if (!open) return;
    const h = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        handleClose();
      }
    };
    document.addEventListener('keydown', h, true);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', h, true);
      document.body.style.overflow = prev;
    };
  }, [open, handleClose]);

  const fullText = useMemo(() => scriptToText(name, data), [name, data]);

  const handleCopy = () => {
    navigator.clipboard.writeText(fullText).then(
      () => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      },
      () => {
        setCopied(false);
      },
    );
  };

  const handleDownload = () => {
    const blob = new Blob([fullText], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${data.title || name || 'script'}.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  if (!open || !mounted) return null;

  const shots = data.shots || [];

  return createPortal(
    <div
      className="fixed inset-0 flex items-center justify-center"
      style={{ zIndex: 99999 }}
      onMouseDown={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
    >
      <div
        className="absolute inset-0 bg-black/85 backdrop-blur-md"
        style={{ animation: 'fadeIn 0.15s ease' }}
        onClick={handleClose}
      />

      <div
        className="relative w-[94vw] max-w-4xl h-[86vh] rounded-2xl overflow-hidden bg-[var(--surface)] border border-[var(--border)] shadow-2xl flex flex-col"
        style={{ animation: 'zoomIn 0.2s ease' }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* 顶部工具栏 */}
        <div className="flex items-center justify-between p-4 border-b border-[var(--border)] bg-black/20">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-9 h-9 rounded-xl grid place-items-center bg-purple-500/15 text-purple-400 shrink-0">
              <FileText className="w-4 h-4" />
            </div>
            <div className="min-w-0">
              <h3 className="text-sm font-medium text-white truncate">
                《{data.title || name}》
              </h3>
              <p className="text-[11px] text-[var(--muted)] truncate">
                剧本 · {shots.length} 个镜头
                {data.genre ? ` · ${data.genre}` : ''}
                {data.style ? ` · ${data.style}` : ''}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-1">
            {projectId ? (
              <Link
                href={`/dashboard/polish?projectId=${encodeURIComponent(projectId)}`}
                onClick={handleClose}
                className="px-3 py-1.5 rounded-lg bg-[#E8C547]/15 hover:bg-[#E8C547]/25 transition-colors text-xs text-[#E8C547] flex items-center gap-1.5 border border-[#E8C547]/20"
                title="打开剧本润色工具, 自动导入本剧本"
              >
                <Wand2 className="w-3.5 h-3.5" />
                润色
              </Link>
            ) : null}
            <button
              onClick={handleCopy}
              className="px-3 py-1.5 rounded-lg hover:bg-white/10 transition-colors text-xs text-white/70 flex items-center gap-1.5"
              title="复制全文"
            >
              {copied ? <Check className="w-3.5 h-3.5 text-green-400" /> : <Copy className="w-3.5 h-3.5" />}
              {copied ? '已复制' : '复制'}
            </button>
            <button
              onClick={handleDownload}
              className="px-3 py-1.5 rounded-lg hover:bg-white/10 transition-colors text-xs text-white/70 flex items-center gap-1.5"
              title="下载 .txt"
            >
              <Download className="w-3.5 h-3.5" />
              下载
            </button>
            <button
              onClick={handleClose}
              className="p-2 rounded-lg hover:bg-white/10 transition-colors"
              title="关闭 (ESC)"
            >
              <X className="w-4 h-4 text-white/70" />
            </button>
          </div>
        </div>

        {/* 滚动内容 */}
        <div className="flex-1 overflow-y-auto p-6 custom-scrollbar">
          {/* 梗概 */}
          {data.synopsis || data.description ? (
            <div className="mb-6 pb-6 border-b border-[var(--border)]">
              <p className="text-[11px] text-[var(--muted)] tracking-wider uppercase mb-2">Synopsis</p>
              <p className="text-sm text-white/85 leading-relaxed whitespace-pre-wrap">
                {data.synopsis || data.description}
              </p>
            </div>
          ) : null}

          {/* 分镜 */}
          {shots.length === 0 ? (
            <div className="text-center py-20 text-[var(--muted)]">
              <FileText className="w-10 h-10 mx-auto mb-3 opacity-30" />
              <p className="text-sm">剧本尚未生成具体镜头</p>
            </div>
          ) : (
            <div className="space-y-5">
              {shots.map((shot, i) => (
                <ShotBlock key={shot.shotNumber ?? i} shot={shot} />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}

function ShotBlock({ shot }: { shot: ScriptShot }) {
  const camera = [shot.shotSize, shot.lens, shot.cameraAngle, shot.cameraMovement]
    .filter(Boolean)
    .join(' · ');

  return (
    <div className="bg-black/20 border border-[var(--border)] rounded-xl p-4 hover:bg-black/30 transition-colors">
      {/* Shot 头 */}
      <div className="flex items-center gap-3 mb-3 flex-wrap">
        <span className="px-2 py-0.5 rounded-md bg-[#E8C547]/15 text-[#E8C547] text-xs font-mono font-bold">
          Shot {shot.shotNumber}
        </span>
        {shot.act ? (
          <span className="px-2 py-0.5 rounded-md bg-purple-500/15 text-purple-300 text-[11px]">
            第{shot.act}幕
          </span>
        ) : null}
        {shot.storyBeat || shot.beat ? (
          <span className="text-[11px] text-cyan-300/80">
            {shot.storyBeat || shot.beat}
          </span>
        ) : null}
        {shot.duration ? (
          <span className="ml-auto text-[11px] text-[var(--muted)] font-mono">
            {shot.duration}s
          </span>
        ) : null}
      </div>

      {/* 场景 */}
      {shot.sceneDescription ? (
        <Row label="场景">
          {shot.sceneDescription}
        </Row>
      ) : null}

      {/* 人物 */}
      {shot.characters?.length ? (
        <Row label="人物">
          {shot.characters.join('、')}
        </Row>
      ) : null}

      {/* 动作 */}
      {shot.action ? (
        <Row label="动作">
          {shot.action}
        </Row>
      ) : null}

      {/* 对白 — 高亮 */}
      {shot.dialogue ? (
        <div className="mt-3 p-3 rounded-lg bg-[#E8C547]/8 border-l-2 border-[#E8C547]/70">
          <p className="text-[10px] text-[#E8C547] tracking-wider uppercase mb-1">对白 Dialogue</p>
          <p className="text-sm text-white/90 leading-relaxed italic whitespace-pre-wrap">
            {shot.dialogue}
          </p>
        </div>
      ) : null}

      {/* 情绪 */}
      {shot.emotion ? (
        <Row label="情绪">
          {shot.emotion}
          {typeof shot.emotionTemperature === 'number' ? ` (温度 ${shot.emotionTemperature})` : ''}
        </Row>
      ) : null}

      {/* 摄影语言 */}
      {camera ? (
        <Row label="镜头" mono>
          {camera}
        </Row>
      ) : null}

      {/* 光影 */}
      {shot.lightingIntent ? (
        <Row label="光影">
          {shot.lightingIntent}
        </Row>
      ) : null}

      {/* 构图 */}
      {shot.composition ? (
        <Row label="构图">
          {shot.composition}
        </Row>
      ) : null}

      {/* 声音 */}
      {shot.diegeticSound || shot.scoreMood || shot.rhythmicSync ? (
        <Row label="声音">
          {[shot.diegeticSound, shot.scoreMood, shot.rhythmicSync].filter(Boolean).join(' · ')}
        </Row>
      ) : null}

      {/* 潜台词 */}
      {shot.subtext ? (
        <Row label="潜台词" italic>
          {shot.subtext}
        </Row>
      ) : null}

      {/* Visual Prompt */}
      {shot.visualPrompt ? (
        <div className="mt-2 text-[11px] text-[var(--muted)] italic leading-relaxed line-clamp-3">
          <span className="text-[10px] text-white/40 tracking-wider uppercase mr-2">Prompt</span>
          {shot.visualPrompt}
        </div>
      ) : null}
    </div>
  );
}

function Row({ label, children, mono, italic }: { label: string; children: React.ReactNode; mono?: boolean; italic?: boolean }) {
  return (
    <div className="flex gap-3 text-sm leading-relaxed py-1">
      <span className="shrink-0 w-14 text-[11px] text-[var(--muted)] tracking-wider uppercase pt-0.5">
        {label}
      </span>
      <span
        className={`text-white/85 ${mono ? 'font-mono text-[12px]' : ''} ${italic ? 'italic text-white/70' : ''}`}
      >
        {children}
      </span>
    </div>
  );
}
