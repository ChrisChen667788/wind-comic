'use client';

/**
 * v6.5 — 团队工作区. 主账号管理团队积分池 + 按成员分配额度.
 * 校验/汇总/RBAC 全在 lib/team-credits (已单测), 落库走 /api/team/allocations.
 */

import { useState, useEffect } from 'react';
import { UsersThree as UsersRound, Plus, Trash as Trash2, FloppyDisk as Save, Wallet, CircleNotch as Loader2, Warning as AlertTriangle, Envelope as Mail, LinkSimple as Link2, PaperPlaneTilt as Send, Copy } from '@phosphor-icons/react';
import {
  poolSummary, canSetAllocation, remaining,
  canRemoveMember, canAllocateCredits,
  type MemberAllocation, type TeamRole,
} from '@/lib/team-credits';

const ROLE_LABEL: Record<TeamRole, string> = { owner: '主账号', admin: '管理员', member: '成员' };
const INVITE_STATUS_META: Record<string, { label: string; cls: string }> = {
  pending: { label: '待接受', cls: 'text-amber-300' },
  accepted: { label: '已加入', cls: 'text-emerald-400' },
  revoked: { label: '已撤销', cls: 'text-[var(--soft)]' },
  expired: { label: '已过期', cls: 'text-rose-400/80' },
};

export default function TeamPage() {
  const myRole: TeamRole = 'owner'; // 当前为主账号视角
  const [pool, setPool] = useState(1000);
  const [members, setMembers] = useState<MemberAllocation[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState('');
  const [newEmail, setNewEmail] = useState('');
  const [newRole, setNewRole] = useState<TeamRole>('member');
  // v6.5.1: 真·多用户邀请
  const [invites, setInvites] = useState<any[]>([]);
  const [invEmail, setInvEmail] = useState('');
  const [invRole, setInvRole] = useState<TeamRole>('member');
  const [invAlloc, setInvAlloc] = useState('100');
  const [invLink, setInvLink] = useState('');
  const [invBusy, setInvBusy] = useState(false);

  const loadInvites = () => {
    fetch('/api/team/invite')
      .then((r) => r.json())
      .then((d) => { if (Array.isArray(d?.invites)) setInvites(d.invites); })
      .catch(() => {});
  };

  useEffect(() => {
    fetch('/api/team/allocations')
      .then((r) => r.json())
      .then((d) => {
        if (Number.isFinite(d?.pool)) setPool(d.pool);
        if (Array.isArray(d?.members)) setMembers(d.members);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
    loadInvites();
  }, []);

  const flash = (m: string) => { setMsg(m); setTimeout(() => setMsg(''), 3500); };
  const summary = poolSummary(pool, members);
  const canEdit = canAllocateCredits(myRole);

  const setAlloc = (id: string, amount: number) => {
    const chk = canSetAllocation(pool, members, id, amount);
    if (!chk.ok) { flash(chk.reason || '额度无效'); return; }
    setMembers((ms) => ms.map((m) => (m.id === id ? { ...m, allocated: amount } : m)));
  };
  const addMember = () => {
    const email = newEmail.trim();
    if (!email) return;
    if (members.some((m) => m.id === email)) { flash('成员已存在'); return; }
    setMembers((ms) => [...ms, { id: email, name: email, role: newRole, allocated: 0, used: 0 }]);
    setNewEmail('');
  };
  const removeMember = (m: MemberAllocation) => {
    if (!canRemoveMember(myRole, m.role)) { flash('无法移除该成员'); return; }
    setMembers((ms) => ms.filter((x) => x.id !== m.id));
  };
  const save = async () => {
    setSaving(true); setMsg('');
    try {
      const res = await fetch('/api/team/allocations', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pool, members }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.message || '保存失败');
      flash('✓ 已保存');
    } catch (e: any) { flash(e?.message || '保存失败'); }
    finally { setSaving(false); }
  };

  const createInvite = async () => {
    const email = invEmail.trim();
    if (!email) { flash('请填邀请邮箱'); return; }
    setInvBusy(true); setInvLink('');
    try {
      const res = await fetch('/api/team/invite', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, role: invRole, allocated: parseInt(invAlloc, 10) || 0 }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.message || '生成失败');
      setInvLink(typeof window !== 'undefined' ? window.location.origin + d.link : d.link);
      setInvEmail('');
      loadInvites();
      flash('✓ 邀请已生成');
    } catch (e: any) { flash(e?.message || '生成失败'); }
    finally { setInvBusy(false); }
  };
  const copyLink = async () => {
    try { await navigator.clipboard.writeText(invLink); flash('✓ 链接已复制'); } catch { /* ignore */ }
  };

  return (
    <div className="max-w-4xl mx-auto">
      <div className="mb-6 flex items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold flex items-center gap-2"><UsersRound className="w-6 h-6 text-amber-400" />团队工作区</h2>
          <p className="text-sm text-[var(--muted)] mt-1">主账号管理团队积分池 · 按成员分配额度</p>
        </div>
        <button
          onClick={save}
          disabled={saving || !canEdit || summary.overAllocated}
          className="px-4 py-2 rounded-xl text-sm font-medium bg-amber-500/20 text-amber-300 border border-amber-500/30 hover:bg-amber-500/30 transition-all disabled:opacity-40 disabled:cursor-not-allowed inline-flex items-center gap-2"
        >
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}保存
        </button>
      </div>

      {loading ? (
        <div className="text-center py-16 text-[var(--muted)]"><Loader2 className="w-6 h-6 animate-spin mx-auto" /></div>
      ) : (
        <>
          {/* 池总览 */}
          <div className="rounded-2xl border border-[var(--border)] bg-white/[0.03] p-5 mb-5">
            <div className="flex items-center justify-between mb-3">
              <span className="text-sm font-medium text-white flex items-center gap-1.5"><Wallet className="w-4 h-4 text-amber-400" />团队积分池</span>
              <div className="flex items-center gap-2">
                <input
                  type="number" value={pool} disabled={!canEdit}
                  onChange={(e) => setPool(Math.max(0, parseInt(e.target.value, 10) || 0))}
                  className="w-28 bg-black/40 border border-[var(--border)] rounded-lg px-2.5 py-1.5 text-sm text-white text-right outline-none focus:border-amber-500/40 disabled:opacity-50"
                />
                <span className="text-xs text-[var(--muted)]">积分</span>
              </div>
            </div>
            {/* 分配条 */}
            <div className="h-2 rounded-full bg-white/10 overflow-hidden flex">
              <div className="h-full bg-amber-400" style={{ width: `${Math.min(100, pool ? (summary.used / pool) * 100 : 0)}%` }} title="已用" />
              <div className="h-full bg-amber-400/40" style={{ width: `${Math.min(100, pool ? ((summary.allocated - summary.used) / pool) * 100 : 0)}%` }} title="已分配未用" />
            </div>
            <div className="flex items-center justify-between mt-2 text-[11px] text-[var(--muted)]">
              <span>已分配 {summary.allocated} · 已用 {summary.used}</span>
              <span className={summary.overAllocated ? 'text-rose-400' : 'text-emerald-400'}>
                {summary.overAllocated
                  ? <span className="inline-flex items-center gap-1"><AlertTriangle className="w-3 h-3" />超额 {summary.allocated - pool}</span>
                  : `剩余可分 ${summary.unallocated}`}
              </span>
            </div>
          </div>

          {/* 添加成员 */}
          <div className="flex gap-2 mb-3">
            <input
              value={newEmail} onChange={(e) => setNewEmail(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), addMember())}
              placeholder="成员邮箱 / ID"
              className="flex-1 bg-black/40 border border-[var(--border)] rounded-xl px-3 py-2 text-sm text-white placeholder:text-[var(--muted)] outline-none focus:border-amber-500/40"
            />
            <select value={newRole} onChange={(e) => setNewRole(e.target.value as TeamRole)} className="bg-black/40 border border-[var(--border)] rounded-xl px-3 py-2 text-sm text-white outline-none">
              <option value="member">成员</option>
              <option value="admin">管理员</option>
            </select>
            <button onClick={addMember} className="px-3 py-2 rounded-xl bg-white/5 border border-white/10 text-sm text-white/85 hover:bg-white/10 inline-flex items-center gap-1.5"><Plus className="w-4 h-4" />添加</button>
          </div>

          {msg && <p className="text-[12px] text-amber-300/90 mb-3">{msg}</p>}

          {/* 成员表 */}
          {members.length === 0 ? (
            <p className="text-sm text-[var(--muted)] text-center py-10">还没有团队成员,添加后即可分配积分额度</p>
          ) : (
            <div className="rounded-2xl border border-[var(--border)] overflow-hidden">
              <div className="grid grid-cols-[1fr_80px_110px_80px_40px] gap-2 px-4 py-2 bg-white/[0.04] text-[11px] text-[var(--muted)]">
                <span>成员</span><span>角色</span><span className="text-right">额度</span><span className="text-right">剩余</span><span />
              </div>
              {members.map((m) => (
                <div key={m.id} className="grid grid-cols-[1fr_80px_110px_80px_40px] gap-2 px-4 py-2.5 items-center border-t border-[var(--border)]">
                  <span className="text-sm text-white truncate" title={m.id}>{m.name || m.id}</span>
                  <span className="text-[11px] text-[var(--soft)]">{ROLE_LABEL[m.role]}</span>
                  <input
                    type="number" value={m.allocated} disabled={!canEdit || m.role === 'owner'}
                    onChange={(e) => setAlloc(m.id, Math.max(0, parseInt(e.target.value, 10) || 0))}
                    className="w-full bg-black/40 border border-[var(--border)] rounded-lg px-2 py-1 text-[13px] text-white text-right outline-none focus:border-amber-500/40 disabled:opacity-50"
                  />
                  <span className="text-[13px] text-right text-emerald-300">{remaining(m)}</span>
                  {m.role !== 'owner' ? (
                    <button onClick={() => removeMember(m)} className="text-rose-400/70 hover:text-rose-400 justify-self-end" title="移除"><Trash2 className="w-3.5 h-3.5" /></button>
                  ) : <span />}
                </div>
              ))}
            </div>
          )}

          {/* v6.5.1: 真·多用户成员邀请 */}
          <div className="mt-6 rounded-2xl border border-[var(--border)] bg-white/[0.03] p-5">
            <p className="text-sm font-medium text-white flex items-center gap-1.5 mb-3"><Mail className="w-4 h-4 text-amber-400" />邀请成员加入团队</p>
            <div className="flex gap-2 flex-wrap">
              <input
                value={invEmail} onChange={(e) => setInvEmail(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), createInvite())}
                placeholder="被邀请人邮箱"
                className="flex-1 min-w-[180px] bg-black/40 border border-[var(--border)] rounded-xl px-3 py-2 text-sm text-white placeholder:text-[var(--muted)] outline-none focus:border-amber-500/40"
              />
              <select value={invRole} onChange={(e) => setInvRole(e.target.value as TeamRole)} className="bg-black/40 border border-[var(--border)] rounded-xl px-3 py-2 text-sm text-white outline-none">
                <option value="member">成员</option>
                <option value="admin">管理员</option>
              </select>
              <input
                type="number" value={invAlloc} onChange={(e) => setInvAlloc(e.target.value)}
                title="接受后初始额度" placeholder="额度"
                className="w-24 bg-black/40 border border-[var(--border)] rounded-xl px-3 py-2 text-sm text-white text-right outline-none focus:border-amber-500/40"
              />
              <button
                onClick={createInvite} disabled={invBusy || !canEdit}
                className="px-3 py-2 rounded-xl bg-amber-500/20 text-amber-300 border border-amber-500/30 hover:bg-amber-500/30 text-sm inline-flex items-center gap-1.5 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {invBusy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}生成邀请链接
              </button>
            </div>

            {invLink && (
              <div className="mt-3 flex items-center gap-2 rounded-lg bg-black/30 border border-amber-500/20 px-3 py-2">
                <Link2 className="w-3.5 h-3.5 text-amber-300 shrink-0" />
                <code className="text-[11px] text-amber-200/90 truncate flex-1">{invLink}</code>
                <button onClick={copyLink} className="text-amber-300/80 hover:text-amber-300 shrink-0" title="复制链接"><Copy className="w-3.5 h-3.5" /></button>
              </div>
            )}

            {invites.length > 0 && (
              <div className="mt-4 space-y-1.5">
                {invites.map((inv) => {
                  const meta = INVITE_STATUS_META[inv.status] || INVITE_STATUS_META.pending;
                  return (
                    <div key={inv.token} className="flex items-center justify-between gap-2 text-[12px] px-3 py-2 rounded-lg bg-black/20 border border-[var(--border)]">
                      <span className="text-white truncate flex-1">{inv.email}</span>
                      <span className="text-[10px] text-[var(--soft)] shrink-0">{ROLE_LABEL[inv.role as TeamRole]} · {inv.allocated} 额度</span>
                      <span className={`text-[10px] shrink-0 ${meta.cls}`}>{meta.label}</span>
                    </div>
                  );
                })}
              </div>
            )}

            <p className="mt-3 text-[11px] text-[var(--soft)] leading-relaxed">
              被邀请人需用自己的已有账号登录后打开链接接受(系统不代为创建账号);接受后以其真实账号进团队。
            </p>
          </div>

          <p className="mt-4 text-[11px] text-[var(--soft)] leading-relaxed">
            📌 成员消费已按额度实时扣减(随生成成本计入各成员 used,余额不足将被拒绝);额度分配 + 真·多用户邀请均已持久化。
          </p>
        </>
      )}
    </div>
  );
}
