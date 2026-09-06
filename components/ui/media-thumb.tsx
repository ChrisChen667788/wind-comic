'use client';

/**
 * 素材缩略件(v12.425)。
 *
 * 修前 10 处都是 onError → style.display='none':图挂了就悄悄消失,卡片变成一块全空,
 * 用户既不知道有过图,也不知道为什么没了。本机实测角色库 44 张立绘里 41 张底层文件
 * 已被清理,页面看上去就是「一片空白的角色库」—— 这不是没数据,是没说实话。
 *
 * 填充一律 contain(见 lib/media-frame),缩略图和全屏看到的是同一张完整画面。
 */

import { useState, useEffect } from 'react';
import { ImageBroken as ImageOff } from '@phosphor-icons/react';
import { ASSET_MEDIA_FIT, ASSET_MATTE_CLASS } from '@/lib/media-frame';

export function MediaThumb({
  src,
  alt = '',
  className,
  note = '素材已失效',
  loading = 'lazy',
}: {
  src?: string | null;
  alt?: string;
  className?: string;
  /** 挂掉时显示的说明。调用方按语境改,比如上传件说「预览不可用」。 */
  note?: string;
  loading?: 'lazy' | 'eager';
}) {
  const [broken, setBroken] = useState(false);
  // src 换了就给一次新机会 —— 否则重试/换图后永远停在失效态。
  useEffect(() => { setBroken(false); }, [src]);

  if (!src || broken) {
    return (
      <div
        className={`${className || 'w-full h-full'} flex flex-col items-center justify-center gap-1 bg-black/40 text-center`}
        title={note}
      >
        <ImageOff className="w-4 h-4 opacity-30 shrink-0" />
        <span className="cinema-mono text-[9px] opacity-40 leading-tight px-1">{note}</span>
      </div>
    );
  }

  return (
    <img
      src={src}
      alt={alt}
      loading={loading}
      decoding="async"
      className={className || `w-full h-full ${ASSET_MEDIA_FIT} ${ASSET_MATTE_CLASS}`}
      onError={() => setBroken(true)}
    />
  );
}
