'use client';

import { useCallback, useId, useMemo, useState } from 'react';

interface DropZoneProps {
  onFilesAccepted: (files: File[]) => void;
  accept?: Record<string, string[]>;
  maxSize?: number;
  /** v12.300:上传失败回调 —— 外层想接管提示(如走 toast)时用;不传则显示内联错误 */
  onError?: (error: unknown) => void;
}

/** 把 accept 映射摊成扩展名/MIME 列表,既用于 <input accept>,也用于落地校验。 */
export const DEFAULT_ACCEPT: Record<string, string[]> = {
  'image/*': ['.png', '.jpg', '.jpeg', '.gif', '.webp'],
  'video/*': ['.mp4', '.mov', '.avi'],
};
export const DEFAULT_MAX_SIZE = 50 * 1024 * 1024;

export function acceptToTokens(accept: Record<string, string[]>): string[] {
  const out: string[] = [];
  for (const [mime, exts] of Object.entries(accept || {})) {
    if (mime) out.push(mime);
    for (const e of exts || []) if (e) out.push(e.toLowerCase());
  }
  return [...new Set(out)];
}

/**
 * v12.339:**真正执行 accept / maxSize**。
 *
 * 此前这两个 prop 只存在于接口声明与解构默认值里,**从未被用来校验任何文件** ——
 * 而界面上还硬编码写着「支持图片和视频,最大 50MB」,等于向用户承诺了一个不存在的校验:
 * 500MB 的文件、.exe 都会照样交给上层。声明了却不执行,比没有这个 prop 更糟,
 * 因为调用方会以为自己已经受保护。
 *
 * 返回被拒的文件与原因;调用方据此给出**指名道姓**的错误(哪个文件、为什么),
 * 而不是笼统一句「上传失败」。
 */
export function filterFiles(
  files: File[],
  accept: Record<string, string[]>,
  maxSize: number,
): { ok: File[]; rejected: Array<{ name: string; reason: string }> } {
  const tokens = acceptToTokens(accept);
  const ok: File[] = [];
  const rejected: Array<{ name: string; reason: string }> = [];
  for (const f of files || []) {
    if (maxSize > 0 && f.size > maxSize) {
      rejected.push({ name: f.name, reason: `超过 ${(maxSize / 1048576).toFixed(0)}MB` });
      continue;
    }
    if (tokens.length) {
      const name = (f.name || '').toLowerCase();
      const type = (f.type || '').toLowerCase();
      const hit = tokens.some((t) =>
        t.startsWith('.') ? name.endsWith(t)
          : t.endsWith('/*') ? type.startsWith(t.slice(0, -1))
            : type === t);
      if (!hit) { rejected.push({ name: f.name, reason: '格式不支持' }); continue; }
    }
    ok.push(f);
  }
  return { ok, rejected };
}

/**
 * v12.339:把「拖放 + 落地校验」抽成 hook。
 *
 * 为什么不是直接把 DropZone 塞进各页面:本仓多数上传位(如 u2v 的首/尾帧)**已经长得像拖放区**,
 * 只是不支持拖放;而 DropZone 自带一套通用灰色样式,塞进影院主题页面会显得突兀。
 * 真正该复用的是**行为**,不是外观 —— 于是行为归 hook,外观各自保留。
 * DropZone 自身也走这个 hook,两边同一出处。
 */
export function useFileDrop(opts: {
  onFiles: (files: File[]) => void | Promise<void>;
  accept?: Record<string, string[]>;
  maxSize?: number;
  onError?: (msg: string) => void;
}) {
  const { onFiles, accept = DEFAULT_ACCEPT, maxSize = DEFAULT_MAX_SIZE, onError } = opts;
  const [isDragging, setIsDragging] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const take = useCallback(async (files: File[]) => {
    if (!files?.length) return;
    const { ok, rejected } = filterFiles(files, accept, maxSize);
    if (rejected.length) {
      const msg = `已拒绝:${rejected.map((r) => `${r.name}(${r.reason})`).join('、')}`.slice(0, 160);
      setError(msg); onError?.(msg);
      if (!ok.length) return;
    } else setError(null);
    setBusy(true);
    try {
      await onFiles(ok);
    } catch (e) {
      const m = e instanceof Error ? e.message : '上传失败,请重试';
      setError(m.slice(0, 120)); onError?.(m);
    } finally { setBusy(false); }
  }, [accept, maxSize, onFiles, onError]);

  /** 摊到目标元素上即可获得拖放能力,外观完全由调用方决定。 */
  const dropProps = {
    onDragOver: (e: React.DragEvent) => { e.preventDefault(); setIsDragging(true); },
    onDragLeave: (e: React.DragEvent) => { e.preventDefault(); setIsDragging(false); },
    onDrop: async (e: React.DragEvent) => {
      e.preventDefault(); setIsDragging(false);
      await take(Array.from(e.dataTransfer.files));
    },
  };
  return { dropProps, isDragging, busy, error, take, setError };
}

export default function DropZone({
  onFilesAccepted,
  accept = DEFAULT_ACCEPT,
  maxSize = DEFAULT_MAX_SIZE,
  onError,
}: DropZoneProps) {
  // v12.339:id 此前写死为 "file-upload" —— 同页放两个 DropZone,后一个的 label
  // 会指到前一个的 input 上,点第二个区域触发的是第一个的文件选择器。
  const inputId = useId();
  const hintText = useMemo(() => {
    const exts = acceptToTokens(accept).filter((t) => t.startsWith('.'));
    const kinds = exts.length ? exts.join(' / ') : '所有文件';
    return `${kinds},单个最大 ${(maxSize / 1048576).toFixed(0)}MB`;
  }, [accept, maxSize]);
  const inputAccept = useMemo(() => acceptToTokens(accept).join(','), [accept]);

  // v12.339:组件与 hook **同一出处** —— 两边各写一套拖放/校验就是漂移的开始。
  const { dropProps, isDragging, busy: uploading, error: uploadError, take } = useFileDrop({
    onFiles: onFilesAccepted, accept, maxSize, onError: () => onError?.(new Error('upload failed')),
  });

  const handleFileSelect = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      await take(Array.from(e.target.files || []));
      e.target.value = '';   // 允许连选同一个文件(否则 change 不触发,看着像没反应)
    },
    [take],
  );

  return (
    <div
      {...dropProps}
      className={`
        border-2 border-dashed rounded-lg p-12 text-center cursor-pointer
        transition-colors
        ${isDragging
          ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20'
          : 'border-gray-300 dark:border-gray-700 hover:border-gray-400 dark:hover:border-gray-600'
        }
        ${uploading ? 'opacity-50 cursor-not-allowed' : ''}
      `}
    >
      <input
        type="file"
        multiple
        onChange={handleFileSelect}
        className="hidden"
        id={inputId}
        accept={inputAccept || undefined}
        disabled={uploading}
      />
      <label htmlFor={inputId} className="cursor-pointer">
        <div className="space-y-2">
          <div className="text-4xl">📁</div>
          {uploading ? (
            <p className="text-blue-500">上传中...</p>
          ) : uploadError ? (
            <p className="text-red-500" role="alert">上传失败:{uploadError}</p>
          ) : isDragging ? (
            <p className="text-blue-500">放开以上传文件...</p>
          ) : (
            <>
              <p className="text-gray-600 dark:text-gray-400">
                拖拽文件到这里，或点击选择文件
              </p>
              <p className="text-sm text-gray-500 dark:text-gray-500">
                {hintText}
              </p>
            </>
          )}
        </div>
      </label>
    </div>
  );
}
