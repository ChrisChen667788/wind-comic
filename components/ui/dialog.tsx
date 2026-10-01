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

/**
 * v12.462:弹窗的无障碍名称取自它的标题。修前所有弹窗一律 aria-label="对话框" ——
 * 读屏只念「对话框」,不知道是导演台还是镜头参数(真浏览器走查按名字找导演台时撞到)。
 * DialogContent 生成 id,DialogTitle 挂上它;没有标题的弹窗仍回落到「对话框」
 * (aria-labelledby 指向不存在的元素时按规范被忽略,改用 aria-label)。
 */
const DialogTitleIdContext = React.createContext<string | undefined>(undefined)

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
  const titleId = React.useId()

  if (!context) return null
  const { open, onOpenChange } = context
  if (!open || !mounted) return null

  // 使用 Portal 渲染到 body，避免 React Flow 的 CSS transform 破坏 fixed 定位
  const content = (
    // v12.462:外层可滚动、内层 min-h-full 居中。修前外层是 fixed + 居中、不能滚 ——
    // 弹窗比屏幕高时(导演台渲出竖版草图后,1440×900 上就会)上下两头被裁掉:
    // 标题、关闭按钮、「保存站位」全都够不着,只能按 Esc(真浏览器走查撞到)。
    <div
      className="fixed inset-0 overflow-y-auto"
      style={{ zIndex: 99999 }}
      onMouseDown={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
    >
      {/* Backdrop —— 纯视觉 + 点击关闭,读屏忽略;fixed 铺满视口,滚动时不跟着走 */}
      <div
        aria-hidden="true"
        className="fixed inset-0 bg-black/85 backdrop-blur-md"
        style={{ animation: 'fadeIn 0.15s ease' }}
        onClick={(e) => {
          e.preventDefault()
          e.stopPropagation()
          onOpenChange(false)
        }}
      />

      {/* 点弹窗外的空白处与点遮罩一样关闭 —— 这一层盖在遮罩上面,得自己接住 */}
      <div
        className="relative flex min-h-full items-center justify-center py-8"
        onClick={(e) => {
          if (e.target !== e.currentTarget) return
          e.preventDefault()
          e.stopPropagation()
          onOpenChange(false)
        }}
      >
      {/* Dialog */}
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
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
        <DialogTitleIdContext.Provider value={titleId}>{children}</DialogTitleIdContext.Provider>
      </div>
      </div>
    </div>
  )

  return createPortal(content, document.body)
}

export function DialogHeader({ children }: DialogHeaderProps) {
  return <div className="mb-4">{children}</div>
}

export function DialogTitle({ children }: DialogTitleProps) {
  const id = React.useContext(DialogTitleIdContext)
  return <h2 id={id} className="text-xl font-semibold text-white">{children}</h2>
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
