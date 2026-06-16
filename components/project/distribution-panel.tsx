'use client';

/**
 * components/project/distribution-panel (v9.1.2) — 分发 / 变现 tab.
 *
 * 平台多选 chips → 一键生成分发包 → 每平台卡片 (标题候选/标签/钩子/简介/建议, 行内复制)
 * + 复制全部 / 导出 .txt。落 project_assets type='distribution' (POST /api/projects/[id]/distribution)。
 */

import { useEffect, useState } from 'react';
import { Megaphone, Copy, Check, DownloadSimple, CircleNotch as Loader2, Sparkle, PaperPlaneTilt, LinkSimple } from '@phosphor-icons/react';
import {
  PLATFORM_SPECS, distributionPackToText,
  type PlatformId, type DistributionPack, type PlatformPack,
} from '@/lib/distribution';

const DEFAULT_PLATFORMS: PlatformId[] = ['douyin', 'xiaohongshu', 'shipinhao'];

// v12.3.1 发布动作结果(per platform)
type PublishResult = { kind: 'ok' | 'plan' | 'blocked' | 'err'; msg: string; shareUrl?: string; externalUrl?: string };

export function DistributionPanel({ projectId }: { projectId: string }) {
  const [selected, setSelected] = useState<PlatformId[]>(DEFAULT_PLATFORMS);
  const [pack, setPack] = useState<DistributionPack | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');
  const [copiedKey, setCopiedKey] = useState('');
  const [publishing, setPublishing] = useState<PlatformId | null>(null);
  const [pubResults, setPubResults] = useState<Record<string, PublishResult>>({});
  // v12.3.3 定时发布 + YouTube 真上传
  const [scheduleAt, setScheduleAt] = useState('');   // datetime-local 字符串(空 = 立即)
  const [ytReal, setYtReal] = useState(false);        // 勾选 = 真上传到 YouTube(需已配 token)

  useEffect(() => {
    let alive = true;
    fetch(`/api/projects/${projectId}/distribution`)
      .then((r) => r.json()).then((j) => { if (alive && j?.pack?.platforms) setPack(j.pack); })
      .catch(() => {});
    return () => { alive = false; };
  }, [projectId]);

  function toggle(p: PlatformId) {
    setSelected((prev) => prev.includes(p) ? prev.filter((x) => x !== p) : [...prev, p]);
  }

  async function generate() {
    if (selected.length === 0) { setErr('至少选一个平台'); return; }
    setLoading(true); setErr('');
    try {
      const r = await fetch(`/api/projects/${projectId}/distribution`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ platforms: selected }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) { setErr(j?.error || `生成失败 (${r.status})`); }
      else { setPack(j.pack); }
    } catch (e: any) { setErr(e?.message || '网络错误'); }
    finally { setLoading(false); }
  }

  async function copy(text: string, key: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedKey(key);
      setTimeout(() => setCopiedKey(''), 1500);
    } catch { /* ignore */ }
  }

  // v12.3.1+12.3.3 发布:打包 + 硬质量门禁 + 计费 gate + 落记录 + 分享链接;
  // 可定时(scheduleAt)/可真上传(YouTube 已配 token → 真传,其余诚实降级为手动)。
  async function publish(platform: PlatformId) {
    setPublishing(platform);
    setPubResults((r) => ({ ...r, [platform]: { kind: 'ok', msg: '发布中…' } }));
    try {
      const body: any = { platform };
      if (scheduleAt) {
        const iso = new Date(scheduleAt).toISOString();
        if (new Date(iso).getTime() > Date.now()) body.scheduledAt = iso;
      }
      if (platform === 'youtube_shorts' && ytReal) { body.upload = true; body.confirmUpload = true; }
      const token = typeof window !== 'undefined' ? localStorage.getItem('qfmj-token') : '';
      const r = await fetch(`/api/projects/${projectId}/publish`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify(body),
      });
      const j = await r.json().catch(() => ({}));
      let res: PublishResult;
      if (r.status === 402) res = { kind: 'plan', msg: '发布需 creator 档及以上,去升级' };
      else if (r.status === 422) res = { kind: 'blocked', msg: '质量门禁未通过(block),先修复最弱镜' };
      else if (r.status === 401) res = { kind: 'err', msg: '请先登录' };
      else if (!r.ok) res = { kind: 'err', msg: j?.error || `发布失败 (${r.status})` };
      else if (j?.status === 'scheduled') res = { kind: 'ok', msg: `已排定定时发布 · ${new Date(j?.scheduled?.scheduledAt).toLocaleString()}` };
      else if (j?.status === 'published') res = { kind: 'ok', msg: '已真上传到 YouTube(默认私有,去后台改公开)', shareUrl: j?.shareUrl, externalUrl: j?.record?.externalUrl };
      else if (j?.upload?.status === 'manual') res = { kind: 'ok', msg: `已打包 · ${j.upload.message}`, shareUrl: j?.shareUrl };
      else res = { kind: 'ok', msg: '已打包 + 生成分享链接(可下载素材手动上传)', shareUrl: j?.shareUrl };
      setPubResults((rr) => ({ ...rr, [platform]: res }));
    } catch (e: any) {
      setPubResults((rr) => ({ ...rr, [platform]: { kind: 'err', msg: e?.message || '网络错误' } }));
    } finally { setPublishing(null); }
  }

  function exportTxt() {
    if (!pack) return;
    const blob = new Blob([distributionPackToText(pack)], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `分发包-${projectId.slice(0, 8)}.txt`;
    a.click(); URL.revokeObjectURL(url);
  }

  return (
    <div className="flex flex-col gap-4">
      {/* 平台选择 + 生成 */}
      <div className="cinema-card !p-4">
        <div className="cinema-eyebrow mb-3 flex items-center gap-1.5"><Megaphone size={13} className="text-[var(--cinema-amber)]" /> 多平台分发 · DISTRIBUTION</div>
        <div className="flex flex-wrap gap-2 mb-3">
          {PLATFORM_SPECS.map((s) => {
            const on = selected.includes(s.id);
            return (
              <button key={s.id} onClick={() => toggle(s.id)}
                className={`px-3 py-1.5 rounded-full border text-[12px] transition ${on ? 'border-[var(--cinema-amber)] bg-[var(--cinema-amber-glow)] text-[var(--cinema-amber)]' : 'border-[var(--cinema-border)] opacity-70 hover:opacity-100'}`}>
                {s.label}
              </button>
            );
          })}
        </div>
        <div className="flex items-center gap-2">
          <button onClick={generate} disabled={loading || selected.length === 0}
            className="cinema-btn-primary !text-[12px] disabled:opacity-50">
            {loading ? <Loader2 size={13} className="animate-spin" /> : <Sparkle size={13} />} {pack ? '重新生成' : '一键生成分发包'}
          </button>
          {pack && (
            <button onClick={exportTxt} className="cinema-btn-ghost !text-[12px]"><DownloadSimple size={13} /> 导出 .txt</button>
          )}
          {pack?.degraded && <span className="cinema-mono text-[10px] text-[var(--secondary)]">LLM 输出已尽力解析 (部分降级)</span>}
        </div>
        {pack && (
          <div className="mt-3 flex flex-wrap items-center gap-3 pt-2 border-t border-[var(--cinema-border)]">
            <label className="cinema-mono text-[10px] opacity-70 flex items-center gap-1.5">
              定时发布(可选)
              <input type="datetime-local" value={scheduleAt} onChange={(e) => setScheduleAt(e.target.value)}
                className="bg-transparent border border-[var(--cinema-border)] rounded px-1.5 py-0.5 text-[11px]" />
            </label>
            {scheduleAt && <button onClick={() => setScheduleAt('')} className="cinema-mono text-[10px] opacity-50 hover:opacity-100 underline">清除(改立即)</button>}
            <label className="cinema-mono text-[10px] opacity-70 flex items-center gap-1.5">
              <input type="checkbox" checked={ytReal} onChange={(e) => setYtReal(e.target.checked)} />
              真上传到 YouTube(需已配 token,会公开到你频道)
            </label>
          </div>
        )}
        {err && <p className="cinema-mono text-[11px] mt-2 text-[var(--secondary)]">{err}</p>}
      </div>

      {/* 每平台卡片 */}
      {pack && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
          {pack.platforms.map((p) => (
            <PlatformCard key={p.platform} p={p} copiedKey={copiedKey} onCopy={copy}
              onPublish={() => publish(p.platform)} publishing={publishing === p.platform} result={pubResults[p.platform]} />
          ))}
        </div>
      )}

      {!pack && !loading && (
        <div className="cinema-card !p-6 text-center cinema-mono text-[11px] opacity-50">
          选好平台 → 一键生成。基于本片剧本/钩子, 为每个平台产出标题候选 · 标签 · 封面钩子 · 简介 · 发布建议。
        </div>
      )}
    </div>
  );
}

function PlatformCard({ p, copiedKey, onCopy, onPublish, publishing, result }: {
  p: PlatformPack; copiedKey: string; onCopy: (t: string, k: string) => void;
  onPublish: () => void; publishing: boolean; result?: PublishResult;
}) {
  const Row = ({ k, label, value }: { k: string; label: string; value: string }) => (
    <div className="flex items-start gap-2 py-1.5 border-b border-[var(--cinema-border)] last:border-0">
      <span className="cinema-mono text-[9px] opacity-50 w-10 shrink-0 pt-0.5">{label}</span>
      <span className="text-[12px] flex-1 leading-relaxed">{value}</span>
      <button onClick={() => onCopy(value, k)} className="opacity-50 hover:opacity-100 shrink-0" title="复制">
        {copiedKey === k ? <Check size={12} className="text-[var(--cinema-green)]" /> : <Copy size={12} />}
      </button>
    </div>
  );
  return (
    <div className="cinema-card !p-4">
      <div className="cinema-eyebrow mb-2">{p.label}</div>
      <Row k={`${p.platform}-title`} label="标题" value={p.titles[0] || ''} />
      {p.titles.slice(1).map((t, i) => <Row key={i} k={`${p.platform}-t${i}`} label="备选" value={t} />)}
      {p.tags.length > 0 && <Row k={`${p.platform}-tags`} label="标签" value={p.tags.map((t) => '#' + t).join(' ')} />}
      {p.hook && <Row k={`${p.platform}-hook`} label="钩子" value={p.hook} />}
      {p.description && <Row k={`${p.platform}-desc`} label="简介" value={p.description} />}
      {p.tips && <Row k={`${p.platform}-tips`} label="建议" value={p.tips} />}
      {/* v12.3.1 发布动作:打包 + 硬门禁 + 分享链接(诚实标注非真上传) */}
      <div className="mt-3 pt-2 border-t border-[var(--cinema-border)] flex items-center gap-2">
        <button onClick={onPublish} disabled={publishing} data-testid={`publish-${p.platform}`}
          className="cinema-btn-primary !text-[11px] disabled:opacity-50">
          {publishing ? <Loader2 size={12} className="animate-spin" /> : <PaperPlaneTilt size={12} />} 发布 / 打包
        </button>
        {result && (
          <span className={`cinema-mono text-[10px] flex items-center gap-1 ${result.kind === 'ok' ? 'text-[var(--cinema-green)]' : result.kind === 'plan' ? 'text-[var(--cinema-amber)]' : 'text-[var(--secondary)]'}`}>
            {result.msg}
            {result.shareUrl && <a href={result.shareUrl} target="_blank" rel="noreferrer" className="underline inline-flex items-center gap-0.5"><LinkSimple size={10} /> 分享页</a>}
            {result.externalUrl && <a href={result.externalUrl} target="_blank" rel="noreferrer" className="underline inline-flex items-center gap-0.5"><LinkSimple size={10} /> 平台链接</a>}
          </span>
        )}
      </div>
    </div>
  );
}
