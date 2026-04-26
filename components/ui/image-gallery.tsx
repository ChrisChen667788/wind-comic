"use client"

import * as React from "react"
import { X, ChevronLeft, ChevronRight, ZoomIn, ZoomOut } from "lucide-react"
import { cn } from "@/lib/utils"
import { Button } from "./button"

interface ImageGalleryProps {
  images: Array<{
    url: string
    title?: string
    description?: string
  }>
  className?: string
}

export function ImageGallery({ images, className }: ImageGalleryProps) {
  const [selectedIndex, setSelectedIndex] = React.useState<number | null>(null)
  const [zoom, setZoom] = React.useState(1)

  const openImage = (index: number) => {
    setSelectedIndex(index)
    setZoom(1)
  }

  const closeImage = () => {
    setSelectedIndex(null)
    setZoom(1)
  }

  const nextImage = () => {
    if (selectedIndex !== null) {
      setSelectedIndex((selectedIndex + 1) % images.length)
      setZoom(1)
    }
  }

  const prevImage = () => {
    if (selectedIndex !== null) {
      setSelectedIndex((selectedIndex - 1 + images.length) % images.length)
      setZoom(1)
    }
  }

  const zoomIn = () => setZoom(Math.min(zoom + 0.5, 3))
  const zoomOut = () => setZoom(Math.max(zoom - 0.5, 0.5))

  return (
    <>
      {/* Gallery Grid */}
      <div className={cn("grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4", className)}>
        {images.map((image, index) => (
          <div
            key={index}
            className="relative aspect-square rounded-lg overflow-hidden cursor-pointer group"
            onClick={() => openImage(index)}
          >
            <img
              src={image.url}
              alt={image.title || `Image ${index + 1}`}
              className="w-full h-full object-cover transition-transform group-hover:scale-110"
            />
            <div className="absolute inset-0 bg-black/0 group-hover:bg-black/40 transition-colors flex items-center justify-center">
              <ZoomIn className="w-8 h-8 text-white opacity-0 group-hover:opacity-100 transition-opacity" />
            </div>
          </div>
        ))}
      </div>

      {/* Lightbox */}
      {selectedIndex !== null && (
        <div className="fixed inset-0 z-50 bg-black/95 flex items-center justify-center">
          {/* Close Button */}
          <Button
            variant="ghost"
            size="sm"
            onClick={closeImage}
            className="absolute top-4 right-4 z-10"
          >
            <X className="w-6 h-6" />
          </Button>

          {/* Navigation */}
          <Button
            variant="ghost"
            size="sm"
            onClick={prevImage}
            className="absolute left-4 top-1/2 -translate-y-1/2 z-10"
          >
            <ChevronLeft className="w-8 h-8" />
          </Button>

          <Button
            variant="ghost"
            size="sm"
            onClick={nextImage}
            className="absolute right-4 top-1/2 -translate-y-1/2 z-10"
          >
            <ChevronRight className="w-8 h-8" />
          </Button>

          {/* Zoom Controls */}
          <div className="absolute bottom-4 left-1/2 -translate-x-1/2 flex gap-2 z-10">
            <Button variant="ghost" size="sm" onClick={zoomOut}>
              <ZoomOut className="w-5 h-5" />
            </Button>
            <span className="text-white px-3 py-1">{Math.round(zoom * 100)}%</span>
            <Button variant="ghost" size="sm" onClick={zoomIn}>
              <ZoomIn className="w-5 h-5" />
            </Button>
          </div>

          {/* Image */}
          <div className="max-w-7xl max-h-[90vh] overflow-auto">
            <img
              src={images[selectedIndex].url}
              alt={images[selectedIndex].title || `Image ${selectedIndex + 1}`}
              className="transition-transform"
              style={{ transform: `scale(${zoom})` }}
            />
          </div>

          {/* Info */}
          {(images[selectedIndex].title || images[selectedIndex].description) && (
            <div className="absolute bottom-4 left-4 right-4 text-center">
              {images[selectedIndex].title && (
                <h3 className="text-xl font-semibold text-white mb-1">
                  {images[selectedIndex].title}
                </h3>
              )}
              {images[selectedIndex].description && (
                <p className="text-sm text-neutral-300">
                  {images[selectedIndex].description}
                </p>
              )}
            </div>
          )}
        </div>
      )}
    </>
  )
}
