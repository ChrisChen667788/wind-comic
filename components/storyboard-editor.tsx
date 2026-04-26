'use client';

import { useState, useCallback } from 'react';
import { GlassCard } from '@/components/ui/glass-card';
import { ZoomableImage } from '@/components/ui/image-lightbox';

export interface StoryboardShot {
  id: string;
  shotNumber: number;
  description: string;
  dialogue: string;
  duration: number;
  cameraAngle: string;
  imageUrl?: string;
}

interface Props {
  shots: StoryboardShot[];
  onChange: (shots: StoryboardShot[]) => void;
}

export function StoryboardEditor({ shots, onChange }: Props) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);

  const addShot = () => {
    const num = shots.length + 1;
    onChange([...shots, {
      id: `shot-${Date.now()}`, shotNumber: num,
      description: '', dialogue: '', duration: 5,
      cameraAngle: '中景',
    }]);
  };

  const updateShot = (id: string, updates: Partial<StoryboardShot>) => {
    onChange(shots.map((s) => s.id === id ? { ...s, ...updates } : s));
  };

  const removeShot = (id: string) => {
    const updated = shots.filter((s) => s.id !== id).map((s, i) => ({ ...s, shotNumber: i + 1 }));
    onChange(updated);
    if (editingId === id) setEditingId(null);
  };

  const duplicateShot = (id: string) => {
    const idx = shots.findIndex((s) => s.id === id);
    if (idx === -1) return;
    const source = shots[idx];
    const newShot = { ...source, id: `shot-${Date.now()}`, shotNumber: idx + 2 };
    const updated = [...shots.slice(0, idx + 1), newShot, ...shots.slice(idx + 1)].map((s, i) => ({ ...s, shotNumber: i + 1 }));
    onChange(updated);
  };

  const handleDragStart = useCallback((id: string) => { setDragId(id); }, []);

  const handleDrop = useCallback((targetId: string) => {
    if (!dragId || dragId === targetId) return;
    const fromIdx = shots.findIndex((s) => s.id === dragId);
    const toIdx = shots.findIndex((s) => s.id === targetId);
    if (fromIdx === -1 || toIdx === -1) return;
    const updated = [...shots];
    const [moved] = updated.splice(fromIdx, 1);
    updated.splice(toIdx, 0, moved);
    onChange(updated.map((s, i) => ({ ...s, shotNumber: i + 1 })));
    setDragId(null);
  }, [dragId, shots, onChange]);

  const cameraOptions = ['特写', '近景', '中景', '全景', '远景', '俯拍', '仰拍', '跟拍'];

  return (
    <div>
      <div className="flex justify-between items-center mb-4">
        <h3 className="font-semibold">分镜编辑器</h3>
        <div className="flex gap-2">
          <span className="text-xs text-[var(--soft)]">{shots.length} 个镜头 · 总时长 {shots.reduce((a, s) => a + s.duration, 0)}s</span>
          <button onClick={addShot} className="btn-primary px-3 py-1.5 rounded-lg text-xs">+ 添加镜头</button>
        </div>
      </div>

      <div className="grid gap-3">
        {shots.map((shot) => (
          <div
            key={shot.id}
            draggable
            onDragStart={() => handleDragStart(shot.id)}
            onDragOver={(e) => e.preventDefault()}
            onDrop={() => handleDrop(shot.id)}
            className={`transition-opacity ${dragId === shot.id ? 'opacity-50' : ''}`}
          >
            <GlassCard className="!p-4 !rounded-xl">
              <div className="flex items-start gap-3">
                {/* Drag handle + shot number */}
                <div className="flex flex-col items-center gap-1 shrink-0 cursor-grab active:cursor-grabbing">
                  <span className="text-[10px] text-[var(--soft)]">⠿</span>
                  <div className="w-8 h-8 rounded-lg bg-[rgba(239,49,159,0.2)] grid place-items-center text-xs font-bold text-[var(--primary)]">
                    {shot.shotNumber}
                  </div>
                </div>

                {/* Thumbnail */}
                {shot.imageUrl ? (
                  <ZoomableImage
                    src={shot.imageUrl}
                    alt={`Shot ${shot.shotNumber}`}
                    title={`镜头 ${shot.shotNumber}${shot.description ? ' — ' + shot.description.slice(0, 60) : ''}`}
                    className="w-[100px] h-[70px] rounded-lg bg-[rgba(255,255,255,0.04)] border border-[var(--border)] shrink-0 overflow-hidden"
                  />
                ) : (
                  <div className="w-[100px] h-[70px] rounded-lg bg-[rgba(255,255,255,0.04)] border border-[var(--border)] shrink-0 grid place-items-center text-[var(--soft)] text-xs overflow-hidden">
                    <span>预览</span>
                  </div>
                )}

                {/* Content */}
                <div className="flex-1 min-w-0">
                  {editingId === shot.id ? (
                    <div className="grid gap-2">
                      <textarea
                        value={shot.description} rows={2}
                        onChange={(e) => updateShot(shot.id, { description: e.target.value })}
                        placeholder="镜头描述..."
                        className="bg-[rgba(255,255,255,0.06)] border border-[var(--border)] rounded-lg px-2.5 py-1.5 text-xs resize-none"
                      />
                      <input
                        value={shot.dialogue}
                        onChange={(e) => updateShot(shot.id, { dialogue: e.target.value })}
                        placeholder="对白..."
                        className="bg-[rgba(255,255,255,0.06)] border border-[var(--border)] rounded-lg px-2.5 py-1.5 text-xs"
                      />
                      <div className="flex gap-2 items-center">
                        <select
                          value={shot.cameraAngle}
                          onChange={(e) => updateShot(shot.id, { cameraAngle: e.target.value })}
                          className="bg-[rgba(255,255,255,0.06)] border border-[var(--border)] rounded-lg px-2 py-1 text-xs"
                        >
                          {cameraOptions.map((o) => <option key={o} value={o}>{o}</option>)}
                        </select>
                        <input
                          type="number" min={1} max={60} value={shot.duration}
                          onChange={(e) => updateShot(shot.id, { duration: Number(e.target.value) || 5 })}
                          className="bg-[rgba(255,255,255,0.06)] border border-[var(--border)] rounded-lg px-2 py-1 text-xs w-16"
                        />
                        <span className="text-[10px] text-[var(--soft)]">秒</span>
                      </div>
                      <button onClick={() => setEditingId(null)} className="btn-primary px-3 py-1 rounded-lg text-xs w-fit">完成</button>
                    </div>
                  ) : (
                    <div onClick={() => setEditingId(shot.id)} className="cursor-pointer">
                      <div className="text-sm line-clamp-2">{shot.description || <span className="text-[var(--soft)]">点击编辑镜头描述...</span>}</div>
                      {shot.dialogue && <div className="text-xs text-[var(--accent)] mt-1 italic">「{shot.dialogue}」</div>}
                      <div className="flex gap-2 mt-1.5">
                        <span className="px-2 py-0.5 rounded-full bg-[rgba(255,255,255,0.08)] text-[10px] text-[var(--soft)]">{shot.cameraAngle}</span>
                        <span className="px-2 py-0.5 rounded-full bg-[rgba(255,255,255,0.08)] text-[10px] text-[var(--soft)]">{shot.duration}s</span>
                      </div>
                    </div>
                  )}
                </div>

                {/* Actions */}
                <div className="flex flex-col gap-1 shrink-0">
                  <button onClick={() => duplicateShot(shot.id)} className="px-1.5 py-1 rounded bg-[rgba(255,255,255,0.08)] text-[10px] hover:bg-[rgba(255,255,255,0.12)]" title="复制">⧉</button>
                  <button onClick={() => removeShot(shot.id)} className="px-1.5 py-1 rounded bg-[rgba(255,88,88,0.12)] text-[10px] text-red-400 hover:bg-[rgba(255,88,88,0.2)]" title="删除">✕</button>
                </div>
              </div>
            </GlassCard>
          </div>
        ))}

        {shots.length === 0 && (
          <div className="text-center py-8 text-[var(--soft)] text-sm border border-dashed border-[var(--border)] rounded-xl">
            还没有分镜，点击上方按钮添加或通过 AI 自动生成
          </div>
        )}
      </div>
    </div>
  );
}
