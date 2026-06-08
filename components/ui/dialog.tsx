"use client"

import * as React from "react"
import { createPortal } from "react-dom"
import { X } from '@phosphor-icons/react';import { cn } from "@/lib/utils"
import { useFocusTrap } from "@/hooks/use-focus-trap"

interface DialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  children: React.ReactNode
}

interface DialogContentProps {
  className?: string
  children: React.ReactNode
}

interface DialogHeaderProps {
  children: React.ReactNode
}

interface DialogTitleProps {
  children: React.ReactNode
}

interface DialogDescriptionProps {
  children: React.ReactNode
}

interface DialogFooterProps {
  children: React.ReactNode
}

const DialogContext = React.createContext<{
  open: boolean
  onOpenChange: (open: boolean) => void
} | null>(null)

export function Dialog({ open, onOpenChange, children }: DialogProps) {
  return (
    <DialogContext.Provider value={{ open, onOpenChange }}>
      {children}
    </DialogContext.Provider>
  )
}

export function DialogContent({ className, children }: DialogContentProps) {
  const context = React.useContext(DialogContext)
  const [mounted, setMounted] = React.useState(false)

  React.useEffect(() => {
    setMounted(true)
    return () => setMounted(false)
  }, [])

  // v10.3.5 a11y: 焦点陷阱 + Escape(document 级)+ 焦点归还 —— hook 必须在任何 early-return 之前调用
  const dialogRef = useFocusTrap<HTMLDivElement>(!!context?.open && mounted, () => context?.onOpenChange(false))

  if (!context) return null
  const { open, onOpenChange } = context
  if (!open || !mounted) return null

  // 使用 Portal 渲染到 body，避免 React Flow 的 CSS transform 破坏 fixed 定位
  const content = (
    <div
      className="fixed inset-0 flex items-center justify-center"
      style={{ zIndex: 99999 }}
      onMouseDown={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
    >
      {/* Backdrop —— 纯视觉 + 点击关闭,读屏忽略 */}
      <div
        aria-hidden="true"
        className="absolute inset-0 bg-black/85 backdrop-blur-md"
        style={{ animation: 'fadeIn 0.15s ease' }}
        onClick={(e) => {
          e.preventDefault()
          e.stopPropagation()
          onOpenChange(false)
        }}
      />

      {/* Dialog */}
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label="对话框"
        tabIndex={-1}
        className={cn(
          "relative bg-neutral-900 border border-white/10 rounded-lg shadow-2xl outline-none",
          "w-full max-w-lg mx-4 p-6",
          className
        )}
        style={{ animation: 'zoomIn 0.15s ease' }}
        onClick={(e) => e.stopPropagation()}
      >
        <button
          onClick={(e) => {
            e.preventDefault()
            e.stopPropagation()
            onOpenChange(false)
          }}
          aria-label="关闭"
          className="absolute right-4 top-4 rounded-md p-1.5 hover:bg-white/10 transition-colors z-[10]"
        >
          <X className="w-4 h-4 text-white" />
        </button>
        {children}
      </div>
    </div>
  )

  return createPortal(content, document.body)
}

export function DialogHeader({ children }: DialogHeaderProps) {
  return <div className="mb-4">{children}</div>
}

export function DialogTitle({ children }: DialogTitleProps) {
  return <h2 className="text-xl font-semibold text-white">{children}</h2>
}

export function DialogDescription({ children }: DialogDescriptionProps) {
  return <p className="text-sm text-neutral-400 mt-2">{children}</p>
}

export function DialogFooter({ children }: DialogFooterProps) {
  return (
    <div className="flex justify-end gap-3 mt-6">
      {children}
    </div>
  )
}
