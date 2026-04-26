'use client';

import { useCallback, useState } from 'react';

interface DropZoneProps {
  onFilesAccepted: (files: File[]) => void;
  accept?: Record<string, string[]>;
  maxSize?: number;
}

export default function DropZone({
  onFilesAccepted,
  accept = {
    'image/*': ['.png', '.jpg', '.jpeg', '.gif', '.webp'],
    'video/*': ['.mp4', '.mov', '.avi'],
  },
  maxSize = 50 * 1024 * 1024, // 50MB
}: DropZoneProps) {
  const [isDragging, setIsDragging] = useState(false);
  const [uploading, setUploading] = useState(false);

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

      try {
        await onFilesAccepted(files);
      } catch (error) {
        console.error('文件上传错误:', error);
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
      try {
        await onFilesAccepted(files);
      } catch (error) {
        console.error('文件上传错误:', error);
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
