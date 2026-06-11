'use client';

/**
 * AssetLedgerPanel (v10.6.1) — 资产级连续性台账面板(连贯性 tab 内,种子锁控制台之下)。
 * 服装/场景/道具条目 × 引用镜号;改描述 → 即时显示受影响镜头清单(对应分镜/视频已置 stale)。
 */
import { useCallback, useEffect, useState } from 'react';
import { getToken } from '@/lib/auth';

interface Entry {
  id: string;
  kind: 'costume' | 'scene' | 'prop';
  name: string;
  description: string;
  shotNumbers: number[];
  source: 'auto' | 'manual';
}

const KIND_META: Record<Entry['kind'], { label: string; cls: string }> = {
  costume: { label: '服装', cls: 'text-amber-300 border-amber-500/30' },
  scene: { label: '场景', cls: 'text-sky-300 border-sky-500/30' },
  prop: { label: '道具', cls: 'text-emerald-300 border-emerald-500/30' },
};

function authHeaders(): Record<string, string> {
  const t = getToken();
  return { 'Content-Type': 'application/json', ...(t ? { Authorization: `Bearer ${t}` } : {}) };
}

export function AssetLedgerPanel({ projectId }: { projectId: string }) {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [notice, setNotice] = useState<string>('');
  const [newProp, setNewProp] = useState('');

  const refresh = useCallback(async () => {
    try {
      const res = await fetch(`/api/projects/${encodeURIComponent(projectId)}/asset-ledger`);
      if (res.ok) setEntries((await res.json()).entries || []);
    } catch { /* 非关键路径,静默 */ }
  }, [projectId]);

  useEffect(() => { refresh(); }, [refresh]);

  const save = async (entry: Entry) => {
    const res = await fetch(`/api/projects/${encodeURIComponent(projectId)}/asset-ledger`, {
      method: 'PUT',
      headers: authHeaders(),
      body: JSON.stringify({ entryId: entry.id, description: draft }),
    });
    if (res.ok) {
      const { affectedShots, staleMarked } = await res.json();
      setNotice(
        affectedShots.length
          ? `「${entry.name}」描述已更新 — 受影响镜头:${affectedShots.join('、')}(${staleMarked} 项资产已标待重渲)`
          : `「${entry.name}」描述已更新 — 无镜头引用该资产`,
      );
      setEditing(null);
      await refresh();
    }
  };

  const addProp = async () => {
    const name = newProp.trim();
    if (!name) return;
    const res = await fetch(`/api/projects/${encodeURIComponent(projectId)}/asset-ledger`, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ kind: 'prop', name }),
    });
    if (res.ok || res.status === 409) {
      setNewProp('');
      await refresh();
    }
  };

  return (
    <div className="mt-6 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4" data-testid="asset-ledger">
      <div className="flex items-center justify-between gap-3 mb-1">
        <h3 className="text-sm font-semibold text-white">资产连续性台账</h3>
        <div className="flex items-center gap-1.5">
          <input
            value={newProp}
            onChange={(e) => setNewProp(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') addProp(); }}
            placeholder="登记关键道具(如:旧照片)"
            aria-label="登记关键道具"
            className="px-2 py-1 text-[11px] rounded-md bg-black/30 border border-white/10 focus:outline-none focus:border-[#E8C547]/50 w-44"
          />
          <button onClick={addProp} className="px-2.5 py-1 rounded-md text-[11px] font-semibold bg-[#E8C547] text-[#0C0C0C] hover:bg-[#D4A830]">登记</button>
        </div>
      </div>
      <p className="text-[11px] text-[var(--muted)] mb-3">
        服装/场景/道具逐条登记 × 引用镜号;改描述会列出受影响镜头并标记待重渲。配 Vision key 后可升级为画面级漂移比对(BYO)。
      </p>

      {notice && (
        <div className="mb-3 px-3 py-2 rounded-lg bg-[#E8C547]/10 border border-[#E8C547]/30 text-[12px] text-[#E8C547]" role="status">
          {notice}
        </div>
      )}

      {entries.length === 0 ? (
        <p className="text-xs text-[var(--muted)] py-4 text-center">暂无条目 —— 项目生成剧本/角色/场景后自动登记。</p>
      ) : (
        <ul className="space-y-2">
          {entries.map((e) => {
            const meta = KIND_META[e.kind];
            const isEditing = editing === e.id;
            return (
              <li key={e.id} className="rounded-lg border border-white/10 bg-black/20 px-3 py-2">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className={`px-1.5 py-0.5 rounded text-[10px] border ${meta.cls}`}>{meta.label}</span>
                  <span className="text-[12.5px] font-medium text-white">{e.name}</span>
                  {e.source === 'manual' && <span className="text-[10px] text-white/60">手动</span>}
                  <span className="ml-auto text-[11px] text-white/70">
                    引用镜:{e.shotNumbers.length ? e.shotNumbers.join('、') : '—'}
                  </span>
                </div>
                {isEditing ? (
                  <div className="mt-2 flex items-start gap-2">
                    <textarea
                      value={draft}
                      onChange={(ev) => setDraft(ev.target.value)}
                      rows={2}
                      aria-label={`${e.name} 描述`}
                      className="flex-1 px-2 py-1.5 text-xs rounded-md bg-black/30 border border-white/10 focus:outline-none focus:border-[#E8C547]/50"
                    />
                    <button onClick={() => save(e)} className="px-2.5 py-1 rounded-md text-[11px] font-semibold bg-[#E8C547] text-[#0C0C0C] hover:bg-[#D4A830]">保存</button>
                    <button onClick={() => setEditing(null)} className="px-2 py-1 rounded-md text-[11px] text-white/70 border border-white/15 hover:text-white">取消</button>
                  </div>
                ) : (
                  <button
                    onClick={() => { setEditing(e.id); setDraft(e.description); setNotice(''); }}
                    className="mt-1 block w-full text-left text-[11.5px] text-white/70 hover:text-white/95 transition-colors"
                    title="点击编辑描述"
                  >
                    {e.description || <span className="opacity-60">(无描述 — 点击补充,变更会标记受影响镜头)</span>}
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
