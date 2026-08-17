/**
 * v12.330 — 收官:把逐帧检视与片段重拍接进界面。
 *
 * ── 为什么最后一版用来「接线」 ────────────────────────────────────
 * 这一轮我反复在说「造好没接线是本仓最顽固的病」,而我自己连着交付了两个
 * **只有 API、没有界面**的能力:v12.315 片段重拍、v12.328 逐帧检视。
 * 不接上,就是我自己在犯同一个毛病。而且它俩本来就该是一件事:
 *   翻帧 → 框出坏的那一段 → 直接交给重拍。
 *
 * ── 一个刻意的克制:前端不算时间 ──────────────────────────────────
 * 帧号 → 秒的换算**全部走后端**(与 `planSegmentRetake` 共用同一个 `snapToFrame`)。
 * 前端若自己 `i / fps`,就成了**第三套帧吸附口径** —— 用户点了第 47 帧、后端却从
 * 46 帧半切下去,而这种错**看不出来**,只体现为成片抖一下。
 *
 * ── v12.318 的教训:源码断言证明不了组件能打开 ────────────────────
 * 那一版 17 条源码断言全绿、tsc 也干净,而项目页在浏览器里直接 500
 * (动态 import 仍被 webpack 静态分析,把 better-sqlite3 打进客户端包)。
 * 所以这里**真渲染**:jsdom 里挂载组件、断言帧真的画出来、点击真的产生选区。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import fs from 'node:fs';
import { FrameInspectModal } from '@/components/project/frame-inspect-modal';

const strip = (t: string) =>
  t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const CMP = strip(fs.readFileSync('components/project/frame-inspect-modal.tsx', 'utf-8'));
const PAGE = strip(fs.readFileSync('app/projects/[id]/page.tsx', 'utf-8'));
const INSPECTOR = strip(fs.readFileSync('components/project/shot-inspector.tsx', 'utf-8'));

const strip3 = {
  shotNumber: 3, durationS: 8, fps: 24, thinned: false, step: 1,
  frames: [
    { frameIndex: 72, atSec: 3, url: '/f/72.jpg' },
    { frameIndex: 73, atSec: 3.0417, url: '/f/73.jpg' },
    { frameIndex: 74, atSec: 3.0833, url: '/f/74.jpg' },
  ],
  failedFrames: [],
  retakeHint: { fromS: 3, toS: 3.125 },
};

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(async () => ({
    ok: true, status: 200, json: async () => strip3,
  })) as unknown as typeof fetch);
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('v12.330 · 真渲染(不是只读源码)', () => {
  it('帧真的画出来,且每帧标了帧号与精确时间戳', async () => {
    render(<FrameInspectModal projectId="p1" shotNumber={3} onClose={() => {}} />);
    await waitFor(() => expect(screen.getByAltText('第 72 帧')).toBeTruthy());
    expect(screen.getByAltText('第 74 帧')).toBeTruthy();
    expect(screen.getByText(/#72 · 3\.000s/)).toBeTruthy();
  });

  it('点两帧形成选区(按钮进入 aria-pressed)', async () => {
    render(<FrameInspectModal projectId="p1" shotNumber={3} onClose={() => {}} />);
    await waitFor(() => screen.getByAltText('第 72 帧'));
    fireEvent.click(screen.getByAltText('第 72 帧').closest('button')!);
    fireEvent.click(screen.getByAltText('第 74 帧').closest('button')!);
    await waitFor(() => {
      expect(screen.getByAltText('第 73 帧').closest('button')!.getAttribute('aria-pressed')).toBe('true');
    });
    expect(screen.getByText(/已选 #72–#74/)).toBeTruthy();
  });

  it('**换算与重拍区间来自服务端**,前端不自己算', async () => {
    const onRetake = vi.fn();
    render(<FrameInspectModal projectId="p1" shotNumber={3} onClose={() => {}} onRetake={onRetake} />);
    await waitFor(() => screen.getByAltText('第 72 帧'));
    fireEvent.click(screen.getByAltText('第 72 帧').closest('button')!);
    fireEvent.click(screen.getByAltText('第 74 帧').closest('button')!);
    fireEvent.click(screen.getByText('换算重拍区间'));
    await waitFor(() => expect(screen.getByText(/3\.000s → 3\.125s/)).toBeTruthy());
    fireEvent.click(screen.getByText('用这段做片段重拍'));
    expect(onRetake).toHaveBeenCalledWith(expect.objectContaining({ fromS: 3, toS: 3.125 }));
  });

  it('抽稀与解码失败**如实显示**,不假装完整', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true, status: 200,
      json: async () => ({ ...strip3, thinned: true, step: 3, failedFrames: [80, 81] }),
    })) as unknown as typeof fetch);
    render(<FrameInspectModal projectId="p1" shotNumber={3} onClose={() => {}} />);
    await waitFor(() => expect(screen.getByText(/已抽稀:每 3 帧取 1/)).toBeTruthy());
    expect(screen.getByText(/2 帧解码失败/)).toBeTruthy();
  });

  it('后端报错时把人话显示出来,不是静默空白(v12.300 的口径)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: false, status: 409, json: async () => ({ error: '第 3 镜还没有成片时长 —— 先出一次片再来逐帧看' }),
    })) as unknown as typeof fetch);
    render(<FrameInspectModal projectId="p1" shotNumber={3} onClose={() => {}} />);
    await waitFor(() => expect(screen.getByText(/先出一次片/)).toBeTruthy());
  });
});

describe('v12.330 · 接线', () => {
  it('单镜检查器里有入口(否则功能等于不存在)', () => {
    expect(INSPECTOR).toContain('onFrameInspect');
    expect(INSPECTOR).toMatch(/逐帧检视/);
  });

  it('项目页挂载了弹窗并传入了 onRetake', () => {
    expect(PAGE).toContain('FrameInspectModal');
    expect(PAGE).toContain('onRetake');
  });

  it('**重拍先 dryRun 预演** —— 计划不通过就说原因,不去花钱调引擎', () => {
    const i = PAGE.indexOf('segment-retake');
    const block = PAGE.slice(i - 200, i + 700);
    expect(block).toMatch(/dryRun: true/);
    expect(block, '失败要让用户看见').toMatch(/showToast/);
  });

  it('前端不做帧→秒换算(否则就是第三套帧吸附口径)', () => {
    expect(CMP, '组件里不该出现自己的帧吸附').not.toMatch(/Math\.round\([^)]*fps\)\s*\/\s*fps/);
    expect(CMP, '秒数应由服务端回').toContain('retakeHint');
  });
});
