"use client"

import * as React from "react"
import { Clock, CheckCircle2, Circle } from "lucide-react"
import { cn } from "@/lib/utils"

interface TimelineItem {
  id: string
  title: string
  description?: string
  status: "completed" | "in-progress" | "pending"
  timestamp?: string
}

interface TimelineProps {
  items: TimelineItem[]
  className?: string
}

export function Timeline({ items, className }: TimelineProps) {
  return (
    <div className={cn("relative", className)}>
      {/* Vertical Line */}
      <div className="absolute left-4 top-0 bottom-0 w-0.5 bg-white/10" />

      {/* Timeline Items */}
      <div className="space-y-6">
        {items.map((item, index) => {
          const isLast = index === items.length - 1

          return (
            <div key={item.id} className="relative flex gap-4">
              {/* Icon */}
              <div className="relative z-10 flex-shrink-0">
                {item.status === "completed" && (
                  <div className="w-8 h-8 rounded-full bg-green-500/20 flex items-center justify-center">
                    <CheckCircle2 className="w-5 h-5 text-green-400" />
                  </div>
                )}
                {item.status === "in-progress" && (
                  <div className="w-8 h-8 rounded-full bg-[#E8C547]/20 flex items-center justify-center">
                    <Clock className="w-5 h-5 text-[#FF6B6B] animate-pulse" />
                  </div>
                )}
                {item.status === "pending" && (
                  <div className="w-8 h-8 rounded-full bg-neutral-800 flex items-center justify-center">
                    <Circle className="w-5 h-5 text-neutral-500" />
                  </div>
                )}
              </div>

              {/* Content */}
              <div className={cn("flex-1 pb-6", isLast && "pb-0")}>
                <div className="flex items-start justify-between mb-1">
                  <h4 className={cn(
                    "font-medium",
                    item.status === "completed" && "text-white",
                    item.status === "in-progress" && "text-[#FF6B6B]",
                    item.status === "pending" && "text-neutral-500"
                  )}>
                    {item.title}
                  </h4>
                  {item.timestamp && (
                    <span className="text-xs text-neutral-500">{item.timestamp}</span>
                  )}
                </div>
                {item.description && (
                  <p className="text-sm text-neutral-400">{item.description}</p>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
