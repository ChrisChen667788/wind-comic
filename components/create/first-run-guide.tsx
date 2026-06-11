'use client';

/**
 * FirstRunGuide (v10.5.3) — 创作工坊首跑三步引导(零依赖 coach marks)。
 *
 * 首次进入 create 页(localStorage 无完成标记)时,按「写创意 → 选风格 → ROLL」
 * 三步高亮对应区块(页面元素带 data-guide="idea|style|roll" 锚点):
 * 半透明遮罩 + 目标琥珀描边 + 就近气泡卡。完成/跳过都落 localStorage 不再弹。
 *
 * 埋点(完成率 = completed/shown):create_guide_shown / _step{N} / _completed / _skipped
 * → POST /api/telemetry/ui-event(fire-and-forget,失败不影响引导)。
 * a11y:气泡 role=dialog + useFocusTrap(Tab 圈内循环、Escape=跳过、焦点归还)。
 */
import { useCallback, useEffect, useState } from 'react';
import { useFocusTrap } from '@/hooks/use-focus-trap';

const DONE_KEY = 'qfmj-create-guide-done';

const STEPS = [
  { target: 'idea', title: '① 写下你的创意', desc: '30 字以上、带题材线索(悬疑/爱情/古风…)效果最好;也可以直接粘贴完整剧本。' },
  { target: 'style', title: '② 选一个画风', desc: '画风决定全片视觉基调 —— 横向滑动挑一张顺眼的;之后还能在风格画廊里换。' },
  { target: 'roll', title: '③ 开机 · ROLL', desc: 'AI 团队接管剩下的一切:剧本 → 分镜 → 视频 → 成片;进度随时可在「任务队列」查看。' },
] as const;

function track(event: string, meta: Record<string, unknown> = {}) {
  try {
    void fetch('/api/telemetry/ui-event', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ event, meta }),
      keepalive: true,
    }).catch(() => {});
  } catch { /* 埋点失败不影响引导 */ }
}

interface Rect { top: number; left: number; width: number; height: number }

export function FirstRunGuide() {
  const [step, setStep] = useState(-1); // -1 = 未激活
  const [rect, setRect] = useState<Rect | null>(null);

  // 首跑判定 + 曝光埋点
  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      if (localStorage.getItem(DONE_KEY) === '1') return;
    } catch { return; }
    setStep(0);
    track('create_guide_shown');
  }, []);

  // 目标测量(步进 / resize / scroll 时重测;jsdom/零尺寸 → 居中兜底)
  useEffect(() => {
    if (step < 0) return;
    const measure = () => {
      const el = document.querySelector<HTMLElement>(`[data-guide="${STEPS[step].target}"]`);
      const r = el?.getBoundingClientRect();
      if (r && r.width > 0 && r.height > 0) {
        setRect({ top: r.top, left: r.left, width: r.width, height: r.height });
        el!.scrollIntoView({ block: 'center', behavior: 'smooth' });
      } else {
        setRect(null);
      }
    };
    measure();
    window.addEventListener('resize', measure);
    window.addEventListener('scroll', measure, true);
    return () => {
      window.removeEventListener('resize', measure);
      window.removeEventListener('scroll', measure, true);
    };
  }, [step]);

  const finish = useCallback((how: 'completed' | 'skipped') => {
    try { localStorage.setItem(DONE_KEY, '1'); } catch { /* ignore */ }
    track(`create_guide_${how}`, { atStep: step + 1 });
    setStep(-1);
  }, [step]);

  const dialogRef = useFocusTrap<HTMLDivElement>(step >= 0, () => finish('skipped'));

  if (step < 0) return null;
  const s = STEPS[step];
  const last = step === STEPS.length - 1;

  // 气泡定位:目标下方(空间不够则上方);无目标 rect → 屏幕居中
  const cardStyle: React.CSSProperties = rect
    ? (() => {
        const below = rect.top + rect.height + 12;
        const flip = typeof window !== 'undefined' && below + 180 > window.innerHeight;
        return {
          position: 'fixed',
          top: flip ? Math.max(12, rect.top - 192) : below,
          left: Math.min(Math.max(12, rect.left), typeof window !== 'undefined' ? window.innerWidth - 372 : rect.left),
        };
      })()
    : { position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%, -50%)' };

  return (
    <div className="fixed inset-0 z-[9000]">
      {/* 遮罩(挡误触;引导本身就是模态语义) */}
      <div aria-hidden="true" className="absolute inset-0 bg-black/55" />
      {/* 目标高亮描边 */}
      {rect && (
        <div
          aria-hidden="true"
          className="fixed rounded-lg pointer-events-none"
          style={{
            top: rect.top - 6, left: rect.left - 6,
            width: rect.width + 12, height: rect.height + 12,
            outline: '2px solid var(--cinema-amber, #C9A35E)',
            boxShadow: '0 0 0 6px rgba(201,163,94,0.18), 0 0 40px rgba(201,163,94,0.25)',
          }}
        />
      )}
      {/* 气泡卡 */}
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label="创作工坊首跑引导"
        tabIndex={-1}
        className="w-[360px] max-w-[calc(100vw-24px)] rounded-xl border border-[var(--cinema-amber-deep,#8A6E3F)] bg-[#16130f] p-4 shadow-2xl outline-none"
        style={cardStyle}
      >
        <div className="cinema-mono text-[10px] tracking-widest text-[var(--cinema-amber,#C9A35E)] mb-1.5">
          FIRST ROLL · {step + 1}/{STEPS.length}
        </div>
        <h3 className="text-[15px] font-semibold text-white mb-1">{s.title}</h3>
        <p className="text-[12.5px] leading-relaxed text-white/75 mb-3.5">{s.desc}</p>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => finish('skipped')}
            className="text-[11px] text-white/60 hover:text-white/90 underline"
          >
            跳过引导
          </button>
          <span className="flex-1" />
          {step > 0 && (
            <button
              type="button"
              onClick={() => { setStep(step - 1); }}
              className="cinema-btn !px-3 !py-1.5 !text-[12px]"
            >
              上一步
            </button>
          )}
          <button
            type="button"
            onClick={() => {
              if (last) { finish('completed'); return; }
              track(`create_guide_step${step + 2}`);
              setStep(step + 1);
            }}
            className="cinema-btn cinema-btn-primary !px-4 !py-1.5 !text-[12px]"
          >
            {last ? '开拍 🎬' : '下一步'}
          </button>
        </div>
      </div>
    </div>
  );
}
