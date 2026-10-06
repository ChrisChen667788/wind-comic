'use client';

/**
 * components/project/project-format-bar (v7.4) — 项目级格式条 (对标 CineFlow 顶栏)
 *
 * 画幅 / 色彩空间 / 帧率 / 安全框 一行控件 + 保存。落进 project_assets type='project-format'。
 *
 * v12.464:画幅改为**只读显示 `projects.aspect`**(项目详情接口的 `aspect`)。修前这里是一个
 * 默认 Scope 2.39:1 的下拉框,存进 project-format 资产却没有任何生成代码读它 —— 9:16 项目
 * 也显示 Scope,改了也不生效。画幅在创建时定下,出片、分镜构图、导演台都按 `projects.aspect` 算;
 * 这里不给改,因为改了不会重排已出的素材(整片、分镜、已出的视频都还是原画幅),只会把「改了没用」换个地方再演一遍。
 * (v12.464 时单镜重生也不读它;v12.467 起重生 / 补拍 / 片段重拍都按 `projects.aspect` 出片。)
 *
 * v12.466:色彩与安全框也有了读者(修前两项都只存不读)——
 *   - 色彩:写进之后出的**分镜图**提示词(整片生成、整张重生、九宫格候选、Cameo 重试),见 lib/project-format-store;
 *     默认「不指定」= 不加任何色彩描述;已出的图不会变。
 *   - 安全框:就是项目页分镜 / 视频预览上那层竖屏安全区。页面传 `safeArea` + `onSafeAreaChange` 时这里受控,
 *     与视频页的「字幕安全区」按钮是同一个开关;叠层只有 9:16 版本,其它画幅禁用并说明。
 */

import { useState } from 'react';
import { FloppyDisk as Save, CircleNotch as Loader2, Check, FilmSlate as Clapperboard, LockSimple as Lock } from '@phosphor-icons/react';
import {
  COLOR_SPACES, FRAME_RATES, normalizeProjectFormat, describeProjectAspect,
  type ProjectFormat,
} from '@/lib/project-format';

const COLOR_HINT = '写进之后出的分镜图提示词(整片生成、整张重生、九宫格候选、Cameo 重试),已出的图不会变。'
  + '「不指定」= 不加任何色彩描述。';
const SAFE_AREA_HINT = '在分镜 / 视频预览上叠一层竖屏安全区(顶部 UI、右侧互动列、底部字幕区),只影响预览,不进成片。';

const ASPECT_HINT = '画幅在创建项目时确定,出片、分镜构图、导演台都按它算,这里只显示。'
  + '要另一比例的成片:「分发」页「改画幅 · 一片两投」直接重构图;要按新画幅重新出片:用新画幅重新创建。';
// v12.469:限制在编排器(画幅统一归一成三种),不是视频引擎本身不支持 —— 见 describeProjectAspect
const VIDEO_ASPECT_HINT = '出片管线的视频只按 16:9 / 9:16 / 1:1 出(编排器统一换算),这个画幅不会原样出成视频';

export function ProjectFormatBar({ projectId, aspect, initialFormat, safeArea, onSafeAreaChange, onSaved }: {
  projectId: string;
  /** 项目画幅(`projects.aspect`,项目详情接口的 `aspect`) */
  aspect?: string | null;
  initialFormat?: Partial<ProjectFormat>;
  /** 受控的安全框开关(项目页传入,与视频页按钮同一状态);不传则由本组件自己管 */
  safeArea?: boolean;
  onSafeAreaChange?: (on: boolean) => void;
  onSaved?: (f: ProjectFormat) => void;
}) {
  const a = describeProjectAspect(aspect);
  const [f, setF] = useState<ProjectFormat>(() => normalizeProjectFormat(initialFormat));
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const set = (patch: Partial<ProjectFormat>) => { setF((p) => ({ ...p, ...patch })); setSaved(false); };
  const safeOn = safeArea ?? f.safeArea;
  const toggleSafeArea = () => {
    if (onSafeAreaChange) { onSafeAreaChange(!safeOn); setSaved(false); } else set({ safeArea: !safeOn });
  };
  // 叠层只画了 9:16(SafeAreaOverlay);其它画幅开了也什么都不显示,不如直说
  const safeAreaUsable = a.ratio === '9:16';

  async function save() {
    setSaving(true);
    try {
      const r = await fetch(`/api/projects/${projectId}/format`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ format: { ...f, safeArea: safeOn } }),
      });
      const j = await r.json().catch(() => ({}));
      if (r.ok) { setSaved(true); onSaved?.(j.format || f); setTimeout(() => setSaved(false), 2000); }
    } finally { setSaving(false); }
  }

  return (
    <div className="cinema-card-hi !p-2.5 mb-3 flex flex-wrap items-center gap-x-4 gap-y-2">
      <span className="cinema-eyebrow flex items-center gap-1.5 shrink-0"><Clapperboard size={13} className="text-[var(--primary)]" /> 项目格式</span>

      <span className="flex items-center gap-1.5 cinema-mono text-[10px] opacity-80" title={ASPECT_HINT}>画幅
        <span data-testid="format-aspect" className="cinema-input !py-1 !text-[11px] !w-auto flex items-center gap-1">
          <Lock size={10} className="opacity-50" />{a.label}
        </span>
        {!a.videoReady && (
          <span data-testid="format-aspect-warn" className="text-[var(--cinema-amber)]"
            title={VIDEO_ASPECT_HINT}>视频不按此画幅出</span>
        )}
      </span>
      <label className="flex items-center gap-1.5 cinema-mono text-[10px] opacity-80" title={COLOR_HINT}>色彩
        <select className="cinema-input !py-1 !text-[11px] !w-auto" value={f.colorSpaceId} onChange={(e) => set({ colorSpaceId: e.target.value })}>
          {COLOR_SPACES.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
        </select>
      </label>
      <label className="flex items-center gap-1.5 cinema-mono text-[10px] opacity-80">帧率
        <select className="cinema-input !py-1 !text-[11px] !w-auto" value={f.fps} onChange={(e) => set({ fps: Number(e.target.value) })}>
          {FRAME_RATES.map((r) => <option key={r} value={r}>{r >= 48 ? `${r}fps 升格` : `${r}fps`}</option>)}
        </select>
      </label>
      <button onClick={toggleSafeArea} disabled={!safeAreaUsable} aria-pressed={safeAreaUsable && safeOn}
        title={safeAreaUsable ? SAFE_AREA_HINT : '安全区叠层目前只有 9:16 竖屏版本'}
        className={`cinema-mono text-[10px] px-2 py-1 rounded border disabled:opacity-40 disabled:cursor-not-allowed ${safeAreaUsable && safeOn ? 'border-[var(--accent-green)] text-[var(--accent-green)]' : 'border-[var(--border)] text-[var(--muted)]'}`}>
        安全框 {!safeAreaUsable ? '仅竖屏' : safeOn ? 'ON' : 'OFF'}
      </button>

      <button onClick={save} disabled={saving} className="cinema-btn-ghost !text-[11px] ml-auto disabled:opacity-50">
        {saving ? <Loader2 size={12} className="animate-spin" /> : saved ? <Check size={12} className="text-[var(--accent-green)]" /> : <Save size={12} />}
        {saved ? '已保存' : '保存格式'}
      </button>
    </div>
  );
}
