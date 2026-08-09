'use client';

import { useCallback, useState } from 'react';

interface DropZoneProps {
  onFilesAccepted: (files: File[]) => void;
  accept?: Record<string, string[]>;
  maxSize?: number;
  /** v12.300:上传失败回调 —— 外层想接管提示(如走 toast)时用;不传则显示内联错误 */
  onError?: (error: unknown) => void;
}

export default function DropZone({
  onFilesAccepted,
  accept = {
    'image/*': ['.png', '.jpg', '.jpeg', '.gif', '.webp'],
    'video/*': ['.mp4', '.mov', '.avi'],
  },
  maxSize = 50 * 1024 * 1024, // 50MB
  onError,
}: DropZoneProps) {
  const [isDragging, setIsDragging] = useState(false);
  const [uploading, setUploading] = useState(false);
  /** v12.300:上传失败原因 —— 此前失败只进 console,界面静默恢复初始态 */
  const [uploadError, setUploadError] = useState<string | null>(null);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  }, []);

  const handleDrop = useCallback(
    async (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragging(false);
      setUploading(true);

      const files = Array.from(e.dataTransfer.files);

      setUploadError(null);
      try {
        await onFilesAccepted(files);
      } catch (error) {
        // v12.300:此前只有 console.error —— 上传指示器消失、组件恢复初始态,
        // 用户不知道失败了,可能以为成功、或反复重试。低层通用组件不依赖 ToastProvider,
        // 自带内联错误(外层可用 onError 接管)。
        console.error('文件上传错误:', error);
        const msg = error instanceof Error ? error.message : '上传失败,请重试';
        setUploadError(msg.slice(0, 120));
        onError?.(error);
      } finally {
        setUploading(false);
      }
    },
    [onFilesAccepted]
  );

  const handleFileSelect = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = Array.from(e.target.files || []);
      if (files.length === 0) return;

      setUploading(true);
      setUploadError(null);
      try {
        await onFilesAccepted(files);
      } catch (error) {
        // v12.300:此前只有 console.error —— 上传指示器消失、组件恢复初始态,
        // 用户不知道失败了,可能以为成功、或反复重试。低层通用组件不依赖 ToastProvider,
        // 自带内联错误(外层可用 onError 接管)。
        console.error('文件上传错误:', error);
        const msg = error instanceof Error ? error.message : '上传失败,请重试';
        setUploadError(msg.slice(0, 120));
        onError?.(error);
      } finally {
        setUploading(false);
      }
    },
    [onFilesAccepted]
  );

  return (
    <div
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
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
        id="file-upload"
        disabled={uploading}
      />
      <label htmlFor="file-upload" className="cursor-pointer">
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
                支持图片和视频，最大 50MB
              </p>
            </>
          )}
        </div>
      </label>
    </div>
  );
}
