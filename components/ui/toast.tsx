"use client"

import * as React from "react"
import { X } from "lucide-react"
import { cn } from "@/lib/utils"

export interface ToastProps {
  id: string
  title?: string
  description?: string
  type?: "success" | "error" | "warning" | "info"
  duration?: number
  /** 可选行动按钮,例如 "重试此步" */
  action?: { label: string; onClick: () => void }
  onClose?: () => void
}

const toastTypeStyles = {
  success: "bg-green-500/10 border-green-500/50 text-green-400",
  error: "bg-red-500/10 border-red-500/50 text-red-400",
  warning: "bg-yellow-500/10 border-yellow-500/50 text-yellow-400",
  info: "bg-blue-500/10 border-blue-500/50 text-blue-400"
}

export function Toast({
  title,
  description,
  type = "info",
  action,
  onClose
}: ToastProps) {
  return (
    <div
      className={cn(
        "pointer-events-auto w-full max-w-sm rounded-lg border p-4 shadow-lg backdrop-blur-sm",
        "animate-in slide-in-from-right-full duration-300",
        toastTypeStyles[type]
      )}
    >
      <div className="flex items-start gap-3">
        <div className="flex-1">
          {title && (
            <div className="font-semibold text-sm mb-1">{title}</div>
          )}
          {description && (
            <div className="text-sm opacity-90">{description}</div>
          )}
          {action && (
            <button
              onClick={() => { action.onClick(); onClose?.(); }}
              className="mt-2 inline-flex items-center rounded-md border border-current/40 px-2 py-1 text-xs font-medium hover:bg-white/10 transition-colors"
            >
              {action.label}
            </button>
          )}
        </div>
        {onClose && (
          <button
            onClick={onClose}
            className="rounded-md p-1 hover:bg-white/10 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        )}
      </div>
    </div>
  )
}
