"use client"

import * as React from "react"
import { cn } from "@/lib/utils"

interface BadgeProps extends React.HTMLAttributes<HTMLDivElement> {
  variant?: "default" | "success" | "warning" | "error" | "info"
}

const Badge = React.forwardRef<HTMLDivElement, BadgeProps>(
  ({ className, variant = "default", ...props }, ref) => {
    const variantStyles = {
      default: "bg-neutral-800 text-neutral-300",
      success: "bg-green-500/10 text-green-400 border-green-500/50",
      warning: "bg-yellow-500/10 text-yellow-400 border-yellow-500/50",
      error: "bg-red-500/10 text-red-400 border-red-500/50",
      info: "bg-blue-500/10 text-blue-400 border-blue-500/50"
    }

    return (
      <div
        ref={ref}
        className={cn(
          "inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold transition-colors",
          variantStyles[variant],
          className
        )}
        {...props}
      />
    )
  }
)
Badge.displayName = "Badge"

export { Badge }
