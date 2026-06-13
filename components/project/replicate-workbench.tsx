'use client';

/**
 * ReplicateWorkbench (v11.1.2) — 拉片复刻 · 替换工作台(拉片 tab 内)。
 *
 * 加替换规则(全局指令「所有人物→猫咪」/ 逐维度角色·场景·道具,可带参考图)→
 * 预览改写后的逐镜 prompt(全开放可编辑)→ 复刻起片(建新项目并行生成)。
 */
import { useCallback, useState } from 'react';
import { MagicWand, Plus, X, CircleNotch, FilmSlate } from '@phosphor-icons/react';
import { getToken } from '@/lib/auth';

type Kind = 'global' | 'character' | 'scene' | 'prop';
interface Rule { kind: Kind; from: string; to: string; refImage?: string }
interface PreviewShot { shotNumber: number; durationSec: number; characters: string[]; scene: string; prompt: string; refImages: string[] }

const KIND_LABEL: Record<Kind, string> = { global: '全局替换', character: '角色', scene: '场景', prop: '道具' };

function authHeaders(): Record<string, string> {
  const t = getToken();
  return { 'Content-Type': 'application/json', ...(t ? { Authorization: `Bearer ${t}` } : {}) };
}

export function ReplicateWorkbench({ projectId, sheetSource = 'factory' }: { projectId: string; sheetSource?: string }) {
  const [rules, setRules] = useState<Rule[]>([{ kind: 'global', from: '', to: '' }]);
  const [preview, setPreview] = useState<{ title: string; shots: PreviewShot[] } | null>(null);
  const [edited, setEdited] = useState<Record<number, string>>({});
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');

  const setRule = (i: number, patch: Partial<Rule>) =>
    setRules((rs) => rs.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));

  const body = useCallback((extra: object) => JSON.stringify({
    sheetSource,
    replacements: rules.filter((r) => r.to.trim()),
    ...extra,
  }), [rules, sheetSource]);

  const doPreview = async () => {
    setBusy(true); setNotice('');
    try {
      const res = await fetch(`/api/projects/${encodeURIComponent(projectId)}/pull-sheet/replicate`, {
        method: 'POST', headers: authHeaders(), body: body({ preview: true }),
      });
      const b = await res.json();
      // 保留用户已编辑的 prompt(按 shotNumber 套用)—— 重复点预览不清空编辑(审查修复)
      if (res.ok) setPreview(b);
      else setNotice(b.message || '预览失败');
    } catch { setNotice('预览失败'); }
    finally { setBusy(false); }
  };

  const doReplicate = async () => {
    setBusy(true); setNotice('');
    try {
      const res = await fetch(`/api/projects/${encodeURIComponent(projectId)}/pull-sheet/replicate`, {
        method: 'POST', headers: authHeaders(), body: body({ editedPrompts: edited, title: preview?.title }),
      });
      const b = await res.json();
      if (res.ok) setNotice(`复刻已起片 — 新项目 ${b.newProjectId}(${b.shots} 镜并行生成中,去「我的项目」查看)`);
      else setNotice(b.message || '复刻失败');
    } catch { setNotice('复刻失败'); }
    finally { setBusy(false); }
  };

  return (
    <div className="cinema-card-hi p-4 mt-6" data-testid="replicate-workbench">
      <div className="cinema-eyebrow flex items-center gap-1.5 mb-1"><MagicWand className="w-3.5 h-3.5" />复刻 · 替换工作台</div>
      <p className="cinema-mono text-[10px] opacity-50 mb-3">
        换角色/场景/道具(全局指令如「老板→猫咪」一键全员换)→ 预览改写后逐镜 prompt(可编辑)→ 按原片结构并行起片新片。复刻 = 同结构新内容,不复制原片素材。
      </p>

      <div className="space-y-2">
        {rules.map((r, i) => (
          <div key={i} className="flex items-center gap-2 flex-wrap">
            <select value={r.kind} onChange={(e) => setRule(i, { kind: e.target.value as Kind })}
              aria-label="替换类型"
              className="cinema-input !text-[11px] !py-1 w-24 shrink-0">
              {(Object.keys(KIND_LABEL) as Kind[]).map((k) => <option key={k} value={k} className="bg-[#1a1a24]">{KIND_LABEL[k]}</option>)}
            </select>
            <input value={r.from} onChange={(e) => setRule(i, { from: e.target.value })}
              placeholder={r.kind === 'global' ? '原词(如:老板)' : '原(空=整列)'}
              aria-label="原词"
              className="cinema-input !text-[11px] !py-1 flex-1 min-w-[100px]" />
            <span className="opacity-40 text-[11px]">→</span>
            <input value={r.to} onChange={(e) => setRule(i, { to: e.target.value })}
              placeholder="换成(如:一只橘猫)"
              aria-label="替换为"
              className="cinema-input !text-[11px] !py-1 flex-1 min-w-[100px]" />
            <input value={r.refImage || ''} onChange={(e) => setRule(i, { refImage: e.target.value })}
              placeholder="参考图 URL(可选)"
              aria-label="参考图"
              className="cinema-input !text-[11px] !py-1 w-32" />
            <button onClick={() => setRules((rs) => rs.filter((_, idx) => idx !== i))}
              aria-label="删除规则" className="text-white/40 hover:text-white shrink-0"><X className="w-3.5 h-3.5" /></button>
          </div>
        ))}
        <button onClick={() => setRules((rs) => [...rs, { kind: 'global', from: '', to: '' }])}
          className="cinema-btn !px-2 !py-1 !text-[10px] inline-flex items-center gap-1"><Plus className="w-3 h-3" />加规则</button>
      </div>

      <div className="flex items-center gap-2 mt-3">
        <button onClick={doPreview} disabled={busy} className="cinema-btn !px-2.5 !py-1.5 !text-[11px] inline-flex items-center gap-1.5 disabled:opacity-50">
          {busy ? <CircleNotch className="w-3.5 h-3.5 animate-spin" /> : <MagicWand className="w-3.5 h-3.5" />}预览改写
        </button>
        {preview && (
          <button onClick={doReplicate} disabled={busy} className="cinema-btn cinema-btn-primary !px-2.5 !py-1.5 !text-[11px] inline-flex items-center gap-1.5 disabled:opacity-50">
            <FilmSlate className="w-3.5 h-3.5" />复刻起片({preview.shots.length} 镜)
          </button>
        )}
      </div>
      {notice && <p className="mt-2 text-[11px] text-[var(--cinema-amber)]" role="status">{notice}</p>}

      {preview && (
        <div className="mt-4 space-y-2">
          <div className="cinema-mono text-[10px] opacity-50">「{preview.title}」逐镜复刻 prompt(可改):</div>
          {preview.shots.map((s) => (
            <div key={s.shotNumber} className="rounded-md border border-[var(--cinema-border)] bg-black/20 px-3 py-2">
              <div className="flex items-center gap-2 mb-1">
                <span className="cinema-mono text-[10px] opacity-50">镜 {s.shotNumber} · {s.durationSec}s</span>
                {s.characters.length > 0 && <span className="text-[10px] text-[var(--cinema-text-3)]">{s.characters.join('、')}</span>}
                {s.refImages.length > 0 && <span className="text-[9px] text-sky-300/70">{s.refImages.length} 参考图</span>}
              </div>
              <textarea
                value={edited[s.shotNumber] ?? s.prompt}
                onChange={(e) => setEdited((m) => ({ ...m, [s.shotNumber]: e.target.value }))}
                aria-label={`镜 ${s.shotNumber} 复刻 prompt`}
                rows={2}
                className="cinema-textarea w-full !text-[11px]" />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
