'use client';

/**
 * components/project/shot-cinematography-modal (v7.2)
 *
 * 项目页每个分镜的"镜头摄影台"弹窗: 包 ShotCinematographyPanel + 实时编译提示词 + 保存/复制。
 *   - 编辑 ShotSpec → 实时显示编译后的英文摄影 prompt 片段 + 中文摘要 chip
 *   - 保存机位 → POST /api/projects/[id]/shot-spec (落进 storyboard 资产 data.cameraSpec)
 *   - 复制提示词 → 可直接贴进任意生成框
 */

import { useState } from 'react';
import { X, Copy, Check, Save, Loader2, Clapperboard } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { ShotCinematographyPanel } from './shot-cinematography-panel';
import {
  compileShotSpecToPrompt, describeShotSpec, normalizeShotSpec, type ShotSpec,
} from '@/lib/cinematography';

export function ShotCinematographyModal({
  projectId, shotNumber, shotTitle, initialSpec, onClose, onSaved,
}: {
  projectId: string;
  shotNumber: number;
  shotTitle?: string;
  initialSpec: ShotSpec;
  onClose: () => void;
  onSaved?: (spec: ShotSpec) => void;
}) {
  const [spec, setSpec] = useState<ShotSpec>(() => normalizeShotSpec(initialSpec));
  const [saving, setSaving] = useState(false);
  const [copied, setCopied] = useState(false);
  const [msg, setMsg] = useState('');

  const compiled = compileShotSpecToPrompt(spec);

  async function save() {
    setSaving(true); setMsg('');
    try {
      const r = await fetch(`/api/projects/${projectId}/shot-spec`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ shotNumber, cameraSpec: spec }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) { setMsg(j?.error || `保存失败 (${r.status})`); }
      else { setMsg('已保存机位'); onSaved?.(spec); setTimeout(onClose, 600); }
    } catch (e: any) {
      setMsg(e?.message || '网络错误');
    } finally { setSaving(false); }
  }

  function copy() {
    navigator.clipboard?.writeText(compiled).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); });
  }

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>
            <span className="flex items-center gap-2">
              <Clapperboard size={16} className="text-[var(--primary)]" />
              镜头摄影台 · <span className="cinema-mono">SHOT {String(shotNumber).padStart(2, '0')}</span>
            </span>
          </DialogTitle>
        </DialogHeader>

        {shotTitle && <p className="text-xs text-[var(--muted)] -mt-2 mb-1 line-clamp-1">{shotTitle}</p>}

        <ShotCinematographyPanel value={spec} onChange={setSpec} />

        {/* 中文摘要 + 编译后的英文 prompt 片段 */}
        <div className="mt-3 pt-3 border-t border-[var(--border)]">
          <div className="flex items-center justify-between mb-1">
            <span className="cinema-eyebrow">机位摘要</span>
            <span className="cinema-mono text-[10px] text-[var(--primary)]">{describeShotSpec(spec)}</span>
          </div>
          <code className="block cinema-mono text-[10px] leading-relaxed text-[var(--accent-green)] bg-[var(--surface)] rounded-md p-2 max-h-24 overflow-auto custom-scrollbar">
            {compiled}
          </code>
        </div>

        <div className="flex items-center gap-2 mt-3">
          <button onClick={copy} className="cinema-btn-ghost !text-[11px]">
            {copied ? <Check size={13} className="text-[var(--accent-green)]" /> : <Copy size={13} />} 复制提示词
          </button>
          <button onClick={save} disabled={saving} className="cinema-btn-primary !text-[11px] ml-auto disabled:opacity-50">
            {saving ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />} 保存机位
          </button>
          <button onClick={onClose} className="cinema-btn-ghost !text-[11px]"><X size={13} /> 关闭</button>
        </div>
        {msg && <p className="cinema-mono text-[10px] mt-1.5 text-[var(--muted)]">{msg}</p>}
      </DialogContent>
    </Dialog>
  );
}
