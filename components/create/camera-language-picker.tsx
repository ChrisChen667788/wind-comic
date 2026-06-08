'use client';

/**
 * components/create/camera-language-picker (v2.14 P0.2)
 *
 * 12 镜头预设的 chip 单选器, 用 cinema-btn 风格. 选中后 onChange(id);
 * 再点同一个 = 清空(回到 undefined / 自动 push-in).
 *
 * 用法:
 *   <CameraLanguagePicker value={cameraId} onChange={setCameraId} />
 *
 * 数据源: lib/prompt-templates#CAMERA_LANGUAGE_PRESETS — 改预设只需改那一处。
 */

import { CAMERA_LANGUAGE_PRESETS } from '@/lib/prompt-templates';

export interface CameraLanguagePickerProps {
  value?: string | null;
  onChange: (id: string | null) => void;
  /** 默认 false; true 时禁用全部 chip (跑动中等场景) */
  disabled?: boolean;
  /** 额外 className 给外层容器 */
  className?: string;
  /** 是否显示标题 + 提示行, 默认 true */
  showHeading?: boolean;
}

export function CameraLanguagePicker({
  value,
  onChange,
  disabled = false,
  className = '',
  showHeading = true,
}: CameraLanguagePickerProps) {
  const active = CAMERA_LANGUAGE_PRESETS.find((p) => p.id === value);

  return (
    <div className={className}>
      {showHeading && (
        <div className="flex items-center justify-between mb-2">
          <span className="cinema-eyebrow">CAMERA · 镜头语言</span>
          {active ? (
            <span className="cinema-mono text-[10px] opacity-80 truncate max-w-[60%]" title={active.desc}>
              {active.label} · {active.desc}
            </span>
          ) : (
            <span className="cinema-mono text-[10px] opacity-70">默认 · 轻微推近</span>
          )}
        </div>
      )}
      <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="镜头语言预设">
        {CAMERA_LANGUAGE_PRESETS.map((p) => {
          const isActive = value === p.id;
          return (
            <button
              key={p.id}
              type="button"
              role="radio"
              aria-checked={isActive}
              disabled={disabled}
              onClick={() => onChange(isActive ? null : p.id)}
              title={`${p.label} (${p.en}) · ${p.desc}`}
              className={`cinema-btn !px-2.5 !py-1 !text-[11px] cinema-mono transition-all ${
                isActive ? 'cinema-btn-primary' : ''
              }`}
            >
              {p.label}
              <span className="opacity-50 ml-1 text-[9px] tracking-wide">{p.en}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
