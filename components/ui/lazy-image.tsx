"use client"

import * as React from "react"
import { cn } from "@/lib/utils"
import { useLazyImage } from "@/hooks/useLazyImage"

interface LazyImageProps extends React.ImgHTMLAttributes<HTMLImageElement> {
  src: string
  alt: string
  fallback?: string
}

export function LazyImage({
  src,
  alt,
  className,
  fallback = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='400' height='300'%3E%3Crect fill='%23333' width='400' height='300'/%3E%3C/svg%3E",
  ...props
}: LazyImageProps) {
  const { imgRef, imageSrc, isLoaded, handleLoad } = useLazyImage(src)

  return (
    <div className="relative overflow-hidden">
      <img
        ref={imgRef}
        src={imageSrc || fallback}
        alt={alt}
        className={cn(
          "transition-opacity duration-300",
          isLoaded ? "opacity-100" : "opacity-0",
          className
        )}
        onLoad={handleLoad}
        {...props}
      />
      {!isLoaded && (
        <div className="absolute inset-0 bg-neutral-800 animate-pulse" />
      )}
    </div>
  )
}
