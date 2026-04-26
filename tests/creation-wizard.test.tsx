/**
 * CreationWizard 集成测试 (v2.0 Sprint 0 D7)
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import {
  CreationWizard,
  isStepValid,
  DEFAULT_DRAFT,
  type WizardDraft,
} from '@/components/creation/CreationWizard';

// AssetGrid 内部会 fetch /api/global-assets；jsdom 无 fetch mock 时会抛。
// 用 vi.stubGlobal 替换 fetch 为空响应。
beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () =>
      new Response(JSON.stringify({ assets: [] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    ),
  );
  // 清 localStorage 避免草稿污染
  window.localStorage.clear();
});

// ──────────────────────────────────────────────────────────
// Unit: isStepValid
// ──────────────────────────────────────────────────────────

describe('isStepValid', () => {
  const base: WizardDraft = { ...DEFAULT_DRAFT };

  it('mode 步：必须选中 mode', () => {
    expect(isStepValid('mode', base)).toBe(false);
    expect(isStepValid('mode', { ...base, mode: 'mv' })).toBe(true);
  });

  it('style 步：必须选中 styleId', () => {
    expect(isStepValid('style', base)).toBe(false);
    expect(isStepValid('style', { ...base, styleId: 'cinematic' })).toBe(true);
  });

  it('assets 步恒为 true（可选）', () => {
    expect(isStepValid('assets', base)).toBe(true);
  });

  it('details 步：title 非空 + prompt 至少 5 字符', () => {
    expect(isStepValid('details', base)).toBe(false);
    expect(
      isStepValid('details', { ...base, title: 'x', prompt: 'abcd' }),
    ).toBe(false);
    expect(
      isStepValid('details', { ...base, title: 'x', prompt: 'abcde' }),
    ).toBe(true);
  });

  it('review 步：需要 mode + style + details 全部通过', () => {
    const ok: WizardDraft = {
      ...base,
      mode: 'quick',
      styleId: 'cinematic',
      title: '项目1',
      prompt: 'a scene in forest',
    };
    expect(isStepValid('review', ok)).toBe(true);
    expect(isStepValid('review', { ...ok, styleId: undefined })).toBe(false);
  });
});

// ──────────────────────────────────────────────────────────
// Component flow
// ──────────────────────────────────────────────────────────

describe('CreationWizard 流程', () => {
  it('渲染 5 步 stepper', () => {
    render(<CreationWizard onComplete={() => {}} />);
    expect(screen.getByTestId('wizard-stepper')).toBeInTheDocument();
    expect(screen.getByTestId('wizard-step-mode')).toBeInTheDocument();
    expect(screen.getByTestId('wizard-step-style')).toBeInTheDocument();
    expect(screen.getByTestId('wizard-step-assets')).toBeInTheDocument();
    expect(screen.getByTestId('wizard-step-details')).toBeInTheDocument();
    expect(screen.getByTestId('wizard-step-review')).toBeInTheDocument();
  });

  it('初始 mode 步的"下一步"默认 disabled', () => {
    render(<CreationWizard onComplete={() => {}} />);
    const next = screen.getByTestId('wizard-next') as HTMLButtonElement;
    expect(next.disabled).toBe(true);
  });

  it('选中 mode 后可前进到 style 步', () => {
    render(<CreationWizard onComplete={() => {}} />);
    fireEvent.click(screen.getByTestId('mode-card-quick'));
    const next = screen.getByTestId('wizard-next') as HTMLButtonElement;
    expect(next.disabled).toBe(false);
    fireEvent.click(next);
    // 进入 style 步后 active 状态切换
    expect(screen.getByTestId('wizard-step-style').getAttribute('data-active')).toBe('true');
  });

  it('prev 按钮可回退', () => {
    render(<CreationWizard onComplete={() => {}} />);
    fireEvent.click(screen.getByTestId('mode-card-quick'));
    fireEvent.click(screen.getByTestId('wizard-next'));
    fireEvent.click(screen.getByTestId('wizard-prev'));
    expect(screen.getByTestId('wizard-step-mode').getAttribute('data-active')).toBe('true');
  });

  it('草稿自动保存到 localStorage', async () => {
    // saveDraft 通过 useEffect([draft]) 触发, 在 React 18+ 中是异步 commit, 必须 waitFor
    render(<CreationWizard onComplete={() => {}} />);
    fireEvent.click(screen.getByTestId('mode-card-episodic'));
    await waitFor(() => {
      const raw = window.localStorage.getItem('qfmj-wizard-draft');
      expect(raw).toBeTruthy();
      const draft = JSON.parse(raw!);
      expect(draft.mode).toBe('episodic');
    });
  });

  it('完成全流程 → onComplete 被调用，带 finalPrompt', async () => {
    const onComplete = vi.fn();
    render(<CreationWizard onComplete={onComplete} />);

    // Step1: mode
    fireEvent.click(screen.getByTestId('mode-card-quick'));
    fireEvent.click(screen.getByTestId('wizard-next'));

    // Step2: style
    fireEvent.click(screen.getByTestId('style-card-cinematic'));
    fireEvent.click(screen.getByTestId('wizard-next'));

    // Step3: assets (可选, 直接跳过)
    await waitFor(() => screen.getByTestId('wizard-next'));
    fireEvent.click(screen.getByTestId('wizard-next'));

    // Step4: details
    fireEvent.change(screen.getByTestId('wizard-title-input'), {
      target: { value: '我的项目' },
    });
    fireEvent.change(screen.getByTestId('wizard-prompt-input'), {
      target: { value: '晨雾中的古镇石板路' },
    });
    fireEvent.click(screen.getByTestId('wizard-next'));

    // Step5: submit
    const submit = screen.getByTestId('wizard-submit');
    fireEvent.click(submit);

    await waitFor(() => expect(onComplete).toHaveBeenCalled());

    const payload = onComplete.mock.calls[0][0];
    expect(payload.mode).toBe('quick');
    expect(payload.styleId).toBe('cinematic');
    expect(payload.title).toBe('我的项目');
    expect(payload.prompt).toBe('晨雾中的古镇石板路');
    // finalPrompt 应当拼接风格 fragment
    expect(payload.finalPrompt).toContain('晨雾中的古镇石板路');
    expect(payload.finalPrompt.length).toBeGreaterThan(payload.prompt.length);
    expect(payload.output.resolution).toBe('720p');
    expect(payload.output.aspectRatio).toBe('16:9');
  });
});
