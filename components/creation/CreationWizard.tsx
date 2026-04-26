'use client';

/**
 * CreationWizard (v2.0 Sprint 0 D7)
 *
 * 5 步项目创建向导，把前面 4 个组件串起来：
 *   Step 1: 选模式（ModeCardGrid）
 *   Step 2: 选风格（StylePicker）
 *   Step 3: 挑资产（AssetGrid, 可选）
 *   Step 4: 写 prompt + 分辨率 / 时长（ResolutionSelector）
 *   Step 5: 预览确认 → 提交
 *
 * 最终数据通过 onComplete 吐给父组件（通常是 `/app/create` 页面），
 * 由父组件调用 `POST /api/projects` 创建项目并启动 orchestrator。
 *
 * 设计要点：
 *  - 受控步骤条 + 左右按钮
 *  - 各步骤校验未通过时禁用"下一步"
 *  - ESC / 关闭 自动保存草稿到 localStorage（key: qfmj-wizard-draft）
 */

import * as React from 'react';
import { ModeCardGrid, MODE_PRESETS } from './ModeCard';
import { StylePicker } from './StylePicker';
import { ResolutionSelector } from './ResolutionSelector';
import { AssetGrid } from '@/components/assets/AssetGrid';
import type {
  CreationMode,
  ResolutionTier,
  AspectRatio,
  ProjectOutputConfig,
} from '@/types/agents';
import { applyStyleToPrompt } from '@/lib/style-presets';
import { cn } from '@/lib/utils';

// ──────────────────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────────────────

export interface WizardDraft {
  mode?: CreationMode;
  styleId?: string;
  globalAssetIds: string[];
  title: string;
  prompt: string;
  durationSec: number;
  output: ProjectOutputConfig;
}

export type WizardSubmitPayload = Required<Omit<WizardDraft, 'globalAssetIds'>> & {
  globalAssetIds: string[];
  /** 最终拼接后的 prompt（已注入 style fragment） */
  finalPrompt: string;
};

export interface CreationWizardProps {
  initialDraft?: Partial<WizardDraft>;
  onComplete: (payload: WizardSubmitPayload) => void | Promise<void>;
  onCancel?: () => void;
  className?: string;
}

// ──────────────────────────────────────────────────────────
// Draft defaults & localStorage persist
// ──────────────────────────────────────────────────────────

const DRAFT_KEY = 'qfmj-wizard-draft';

export const DEFAULT_DRAFT: WizardDraft = {
  mode: undefined,
  styleId: undefined,
  globalAssetIds: [],
  title: '',
  prompt: '',
  durationSec: 5,
  output: { resolution: '720p', aspectRatio: '16:9' },
};

function loadDraft(): Partial<WizardDraft> | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(DRAFT_KEY);
    return raw ? (JSON.parse(raw) as Partial<WizardDraft>) : null;
  } catch {
    return null;
  }
}

function saveDraft(draft: WizardDraft) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
  } catch {
    /* ignore quota */
  }
}

function clearDraft() {
  if (typeof window === 'undefined') return;
  window.localStorage.removeItem(DRAFT_KEY);
}

// ──────────────────────────────────────────────────────────
// Step metadata
// ──────────────────────────────────────────────────────────

const STEPS = [
  { key: 'mode', label: '创作模式', desc: '选择你想生成的内容类型' },
  { key: 'style', label: '视觉风格', desc: '从 60 个预设中挑选' },
  { key: 'assets', label: '资产复用', desc: '从记忆库选已有角色/场景/道具' },
  { key: 'details', label: '内容细节', desc: 'Prompt + 分辨率 + 时长' },
  { key: 'review', label: '确认提交', desc: '预览并启动生成' },
] as const;

type StepKey = (typeof STEPS)[number]['key'];

// ──────────────────────────────────────────────────────────
// Validation per step
// ──────────────────────────────────────────────────────────

export function isStepValid(step: StepKey, draft: WizardDraft): boolean {
  switch (step) {
    case 'mode':
      return !!draft.mode;
    case 'style':
      return !!draft.styleId;
    case 'assets':
      return true; // 资产是可选项
    case 'details':
      return draft.prompt.trim().length >= 5 && draft.title.trim().length > 0;
    case 'review':
      return (
        !!draft.mode &&
        !!draft.styleId &&
        draft.prompt.trim().length >= 5 &&
        draft.title.trim().length > 0
      );
  }
}

// ──────────────────────────────────────────────────────────
// Component
// ──────────────────────────────────────────────────────────

export function CreationWizard({
  initialDraft,
  onComplete,
  onCancel,
  className,
}: CreationWizardProps) {
  const [stepIdx, setStepIdx] = React.useState(0);
  const [draft, setDraft] = React.useState<WizardDraft>(() => ({
    ...DEFAULT_DRAFT,
    ...(loadDraft() ?? {}),
    ...(initialDraft ?? {}),
  }));
  const [submitting, setSubmitting] = React.useState(false);

  // 自动保存草稿
  React.useEffect(() => {
    saveDraft(draft);
  }, [draft]);

  const step = STEPS[stepIdx];
  const canAdvance = isStepValid(step.key, draft);
  const isLast = stepIdx === STEPS.length - 1;

  const update = <K extends keyof WizardDraft>(key: K, v: WizardDraft[K]) =>
    setDraft(prev => ({ ...prev, [key]: v }));

  const handleSubmit = async () => {
    if (submitting) return;
    if (!isStepValid('review', draft)) return;
    setSubmitting(true);
    try {
      const finalPrompt = applyStyleToPrompt(draft.prompt, draft.styleId);
      await onComplete({
        mode: draft.mode!,
        styleId: draft.styleId!,
        globalAssetIds: draft.globalAssetIds,
        title: draft.title,
        prompt: draft.prompt,
        durationSec: draft.durationSec,
        output: draft.output,
        finalPrompt,
      });
      clearDraft();
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      className={cn(
        'flex flex-col gap-6 rounded-2xl border border-white/10 bg-neutral-950/60 p-6 backdrop-blur',
        className,
      )}
      data-testid="creation-wizard"
    >
      {/* Stepper */}
      <StepperHeader currentIdx={stepIdx} />

      {/* Title / sub */}
      <div>
        <h2 className="text-xl font-semibold text-white">{step.label}</h2>
        <p className="mt-1 text-sm text-neutral-400">{step.desc}</p>
      </div>

      {/* Content */}
      <div className="min-h-[20rem]">
        {step.key === 'mode' && (
          <ModeCardGrid value={draft.mode} onChange={m => update('mode', m)} />
        )}

        {step.key === 'style' && (
          <StylePicker
            value={draft.styleId}
            onChange={id => update('styleId', id || undefined)}
            clearable
          />
        )}

        {step.key === 'assets' && (
          <AssetGrid
            selectable
            selected={draft.globalAssetIds}
            onSelectionChange={ids => update('globalAssetIds', ids)}
            maxSelection={20}
          />
        )}

        {step.key === 'details' && <DetailsStep draft={draft} update={update} />}

        {step.key === 'review' && <ReviewStep draft={draft} />}
      </div>

      {/* Actions */}
      <div className="flex items-center justify-between border-t border-white/10 pt-4">
        <div>
          {onCancel && (
            <button
              type="button"
              onClick={onCancel}
              className="text-sm text-neutral-400 hover:text-white"
              data-testid="wizard-cancel"
            >
              取消
            </button>
          )}
        </div>
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => setStepIdx(i => Math.max(0, i - 1))}
            disabled={stepIdx === 0}
            className="rounded-lg border border-white/10 px-4 py-2 text-sm text-white hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-40"
            data-testid="wizard-prev"
          >
            上一步
          </button>

          {!isLast ? (
            <button
              type="button"
              onClick={() => setStepIdx(i => Math.min(STEPS.length - 1, i + 1))}
              disabled={!canAdvance}
              className={cn(
                'rounded-lg bg-gradient-to-r from-[#E8C547] to-[#FF6B35] px-5 py-2 text-sm font-semibold text-white',
                'disabled:cursor-not-allowed disabled:opacity-50 hover:opacity-90',
              )}
              data-testid="wizard-next"
            >
              下一步
            </button>
          ) : (
            <button
              type="button"
              onClick={handleSubmit}
              disabled={!canAdvance || submitting}
              className={cn(
                'rounded-lg bg-gradient-to-r from-green-500 to-emerald-500 px-6 py-2 text-sm font-semibold text-white',
                'disabled:cursor-not-allowed disabled:opacity-50 hover:opacity-90',
              )}
              data-testid="wizard-submit"
            >
              {submitting ? '提交中...' : '🚀 启动生成'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────────────────
// Stepper
// ──────────────────────────────────────────────────────────

function StepperHeader({ currentIdx }: { currentIdx: number }) {
  return (
    <ol className="flex items-center justify-between gap-2" data-testid="wizard-stepper">
      {STEPS.map((s, i) => {
        const done = i < currentIdx;
        const active = i === currentIdx;
        return (
          <li key={s.key} className="flex flex-1 items-center gap-2">
            <div
              className={cn(
                'flex h-8 w-8 shrink-0 items-center justify-center rounded-full border-2 text-xs font-semibold transition-colors',
                done && 'border-green-500 bg-green-500 text-white',
                active && 'border-[#E8C547] bg-[#E8C547]/20 text-[#E8C547]',
                !done && !active && 'border-white/10 text-neutral-500',
              )}
              data-testid={`wizard-step-${s.key}`}
              data-active={active}
              data-done={done}
            >
              {done ? '✓' : i + 1}
            </div>
            <div className="hidden flex-col md:flex">
              <span
                className={cn(
                  'text-xs font-medium',
                  active ? 'text-white' : 'text-neutral-400',
                )}
              >
                {s.label}
              </span>
            </div>
            {i < STEPS.length - 1 && (
              <div
                className={cn(
                  'ml-2 h-px flex-1',
                  done ? 'bg-green-500/60' : 'bg-white/10',
                )}
              />
            )}
          </li>
        );
      })}
    </ol>
  );
}

// ──────────────────────────────────────────────────────────
// Sub-steps
// ──────────────────────────────────────────────────────────

interface DetailsStepProps {
  draft: WizardDraft;
  update: <K extends keyof WizardDraft>(key: K, v: WizardDraft[K]) => void;
}

function DetailsStep({ draft, update }: DetailsStepProps) {
  return (
    <div className="grid gap-6 lg:grid-cols-[2fr_1fr]">
      <div className="flex flex-col gap-4">
        <div>
          <label className="mb-1.5 block text-sm font-medium text-white">项目标题</label>
          <input
            type="text"
            value={draft.title}
            onChange={e => update('title', e.target.value)}
            placeholder="例：灵眸·短篇漫剧 第 1 集"
            className="w-full rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-sm text-white placeholder:text-neutral-500 focus:border-[#E8C547]/60 focus:outline-none"
            data-testid="wizard-title-input"
            maxLength={60}
          />
        </div>

        <div>
          <label className="mb-1.5 block text-sm font-medium text-white">
            创作 Prompt
          </label>
          <textarea
            value={draft.prompt}
            onChange={e => update('prompt', e.target.value)}
            placeholder="描述你想生成的画面/故事。例：晨雾中的古镇，一位身着汉服的少女抱着古琴漫步石板路..."
            rows={8}
            className="w-full resize-none rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-sm text-white placeholder:text-neutral-500 focus:border-[#E8C547]/60 focus:outline-none"
            data-testid="wizard-prompt-input"
          />
          <div className="mt-1 text-[11px] text-neutral-500">
            {draft.prompt.length} 字 · 至少 5 个字符
          </div>
        </div>

        <div>
          <label className="mb-1.5 block text-sm font-medium text-white">
            单镜头时长（秒）
          </label>
          <div className="flex gap-2" data-testid="wizard-duration-row">
            {[4, 5, 8, 10, 15].map(d => (
              <button
                key={d}
                type="button"
                onClick={() => update('durationSec', d)}
                className={cn(
                  'flex-1 rounded-lg border-2 py-2 text-sm font-medium transition-all',
                  draft.durationSec === d
                    ? 'border-[#E8C547] bg-[#E8C547]/10 text-white'
                    : 'border-white/10 bg-white/5 text-neutral-300 hover:border-white/30',
                )}
                data-selected={draft.durationSec === d}
                data-testid={`wizard-duration-${d}`}
              >
                {d}s
              </button>
            ))}
          </div>
        </div>
      </div>

      <ResolutionSelector
        value={draft.output}
        onChange={v => update('output', v)}
        durationSec={draft.durationSec}
      />
    </div>
  );
}

function ReviewStep({ draft }: { draft: WizardDraft }) {
  const modePreset = draft.mode ? MODE_PRESETS[draft.mode] : undefined;
  const finalPrompt = applyStyleToPrompt(draft.prompt, draft.styleId);

  return (
    <div className="grid gap-4 lg:grid-cols-2" data-testid="wizard-review">
      <div className="space-y-3">
        <ReviewRow label="项目标题" value={draft.title || '(未填写)'} />
        <ReviewRow
          label="创作模式"
          value={
            modePreset ? (
              <span className="flex items-center gap-2">
                <span className="text-xl">{modePreset.icon}</span>
                {modePreset.name} · {modePreset.nameEn}
              </span>
            ) : (
              '(未选择)'
            )
          }
        />
        <ReviewRow label="风格预设" value={draft.styleId ?? '(未选择)'} />
        <ReviewRow
          label="全局资产"
          value={
            draft.globalAssetIds.length > 0
              ? `已选 ${draft.globalAssetIds.length} 个`
              : '未选择'
          }
        />
        <ReviewRow
          label="分辨率 / 比例"
          value={`${draft.output.resolution.toUpperCase()} · ${draft.output.aspectRatio}`}
        />
        <ReviewRow label="单镜头时长" value={`${draft.durationSec}s`} />
      </div>

      <div className="rounded-lg border border-white/10 bg-white/5 p-4">
        <div className="mb-2 text-xs font-semibold uppercase text-neutral-400">
          最终 Prompt 预览
        </div>
        <div className="whitespace-pre-wrap break-words text-sm text-neutral-200">
          {finalPrompt || '(空)'}
        </div>
      </div>
    </div>
  );
}

function ReviewRow({
  label,
  value,
}: {
  label: string;
  value: React.ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-white/5 py-2 text-sm">
      <span className="text-neutral-400">{label}</span>
      <span className="text-right text-white">{value}</span>
    </div>
  );
}
