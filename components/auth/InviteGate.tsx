'use client';

/**
 * InviteGate (v2.0 Sprint 0 D6)
 *
 * Beta 邀请码门禁 UI —— 注册页/首页用。
 *
 * 包含两个子组件：
 *  1. <InviteCodeField>  注册表单里的"邀请码"输入+实时校验
 *  2. <WaitlistForm>     无码用户的"申请内测"表单（邮箱 + 用途）
 *
 * 通过 `/api/invite-codes/validate` 做前端实时校验；后端 register
 * 会再用 `consumeInviteCode` 做原子占用。
 */

import * as React from 'react';
import { cn } from '@/lib/utils';

// ──────────────────────────────────────────────────────────
// InviteCodeField
// ──────────────────────────────────────────────────────────

type ValidationState =
  | { status: 'idle' }
  | { status: 'checking' }
  | { status: 'ok'; source?: string }
  | { status: 'error'; message: string };

const ERROR_MESSAGES: Record<string, string> = {
  NOT_FOUND: '邀请码不存在',
  ALREADY_USED: '该邀请码已被使用',
  EXPIRED: '邀请码已过期',
  REVOKED: '邀请码已被撤销',
  INVALID: '邀请码格式无效',
};

export interface InviteCodeFieldProps {
  value: string;
  onChange: (code: string) => void;
  /** 校验成功的回调（父组件可据此启用"注册"按钮） */
  onValid?: (code: string) => void;
  /** 校验失败的回调 */
  onInvalid?: (error: string) => void;
  className?: string;
}

export function InviteCodeField({
  value,
  onChange,
  onValid,
  onInvalid,
  className,
}: InviteCodeFieldProps) {
  const [state, setState] = React.useState<ValidationState>({ status: 'idle' });

  // debounced validate
  React.useEffect(() => {
    if (!value || value.trim().length < 4) {
      setState({ status: 'idle' });
      return;
    }

    const controller = new AbortController();
    const timer = setTimeout(() => {
      setState({ status: 'checking' });
      fetch('/api/invite-codes/validate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: value.trim() }),
        signal: controller.signal,
      })
        .then(async res => {
          const data = (await res.json().catch(() => ({}))) as {
            ok?: boolean;
            error?: string;
            source?: string;
          };
          if (data.ok) {
            setState({ status: 'ok', source: data.source });
            onValid?.(value.trim());
          } else {
            const msg = ERROR_MESSAGES[data.error ?? 'INVALID'] ?? '邀请码无效';
            setState({ status: 'error', message: msg });
            onInvalid?.(data.error ?? 'INVALID');
          }
        })
        .catch(err => {
          if (err instanceof DOMException && err.name === 'AbortError') return;
          setState({ status: 'error', message: '验证失败，请稍后重试' });
        });
    }, 400);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [value, onValid, onInvalid]);

  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      <label htmlFor="invite-code" className="text-sm font-medium text-white">
        邀请码
        <span className="ml-1 text-xs text-neutral-400">(Beta 版必填)</span>
      </label>
      <div className="relative">
        <input
          id="invite-code"
          type="text"
          value={value}
          onChange={e => onChange(e.target.value.toUpperCase())}
          placeholder="BETAXXXXXX"
          className={cn(
            'w-full rounded-lg border bg-black/20 px-3 py-2 pr-10 font-mono text-sm text-white placeholder:text-neutral-500 focus:outline-none',
            state.status === 'ok' && 'border-green-500/60 focus:border-green-500',
            state.status === 'error' && 'border-red-500/60 focus:border-red-500',
            (state.status === 'idle' || state.status === 'checking') &&
              'border-white/10 focus:border-[#E8C547]/60',
          )}
          data-testid="invite-code-input"
          aria-invalid={state.status === 'error'}
          aria-describedby="invite-code-feedback"
        />
        <div className="absolute right-3 top-1/2 -translate-y-1/2">
          {state.status === 'checking' && (
            <span className="text-xs text-neutral-400">校验中...</span>
          )}
          {state.status === 'ok' && (
            <span className="text-green-400" aria-label="valid">
              ✓
            </span>
          )}
          {state.status === 'error' && (
            <span className="text-red-400" aria-label="invalid">
              ✗
            </span>
          )}
        </div>
      </div>
      <div
        id="invite-code-feedback"
        className="min-h-[1rem] text-xs"
        data-testid="invite-code-feedback"
      >
        {state.status === 'ok' && (
          <span className="text-green-400">✓ 邀请码有效 {state.source ? `· ${state.source}` : ''}</span>
        )}
        {state.status === 'error' && <span className="text-red-400">{state.message}</span>}
        {state.status === 'idle' && !value && (
          <span className="text-neutral-500">
            没有邀请码？
            <a href="#waitlist" className="ml-1 text-[#E8C547] underline">
              申请内测
            </a>
          </span>
        )}
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────────────────
// WaitlistForm
// ──────────────────────────────────────────────────────────

type WaitlistState =
  | { status: 'idle' }
  | { status: 'submitting' }
  | { status: 'success'; message: string }
  | { status: 'error'; message: string };

export interface WaitlistFormProps {
  source?: string;
  className?: string;
}

export function WaitlistForm({ source, className }: WaitlistFormProps) {
  const [email, setEmail] = React.useState('');
  const [purpose, setPurpose] = React.useState('');
  const [state, setState] = React.useState<WaitlistState>({ status: 'idle' });

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (state.status === 'submitting') return;

    setState({ status: 'submitting' });
    try {
      const res = await fetch('/api/waitlist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, purpose, source }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        message?: string;
        error?: string;
      };
      if (res.ok) {
        setState({
          status: 'success',
          message: data.message ?? '已加入等待列表，审核结果将通过邮件通知',
        });
        setEmail('');
        setPurpose('');
      } else {
        setState({
          status: 'error',
          message: data.error ?? '提交失败，请稍后重试',
        });
      }
    } catch (err) {
      setState({
        status: 'error',
        message: err instanceof Error ? err.message : '网络错误',
      });
    }
  };

  return (
    <form
      onSubmit={submit}
      className={cn(
        'flex flex-col gap-3 rounded-xl border border-white/10 bg-white/5 p-5',
        className,
      )}
      data-testid="waitlist-form"
    >
      <div>
        <h3 className="text-base font-semibold text-white">申请内测</h3>
        <p className="mt-1 text-xs text-neutral-400">
          留下邮箱，我们会在审核通过后发送邀请码
        </p>
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="waitlist-email" className="text-xs text-neutral-300">
          邮箱
        </label>
        <input
          id="waitlist-email"
          type="email"
          required
          value={email}
          onChange={e => setEmail(e.target.value)}
          placeholder="you@example.com"
          className="rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-sm text-white placeholder:text-neutral-500 focus:border-[#E8C547]/60 focus:outline-none"
          data-testid="waitlist-email"
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="waitlist-purpose" className="text-xs text-neutral-300">
          使用场景 (可选)
        </label>
        <textarea
          id="waitlist-purpose"
          rows={3}
          value={purpose}
          onChange={e => setPurpose(e.target.value)}
          placeholder="例如：想做自己的连载漫剧 / 用来给客户做广告片 / 学习 AI 视频..."
          className="resize-none rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-sm text-white placeholder:text-neutral-500 focus:border-[#E8C547]/60 focus:outline-none"
          data-testid="waitlist-purpose"
        />
      </div>

      <button
        type="submit"
        disabled={state.status === 'submitting' || !email}
        className={cn(
          'rounded-lg bg-gradient-to-r from-[#E8C547] to-[#FF6B35] px-4 py-2 text-sm font-semibold text-white transition-opacity',
          'disabled:cursor-not-allowed disabled:opacity-50 hover:opacity-90',
        )}
        data-testid="waitlist-submit"
      >
        {state.status === 'submitting' ? '提交中...' : '加入 Waitlist'}
      </button>

      {state.status === 'success' && (
        <div className="rounded-lg border border-green-500/30 bg-green-500/10 p-3 text-xs text-green-300">
          ✓ {state.message}
        </div>
      )}
      {state.status === 'error' && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-xs text-red-300">
          ✗ {state.message}
        </div>
      )}
    </form>
  );
}
