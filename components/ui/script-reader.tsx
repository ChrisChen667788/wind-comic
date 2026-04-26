"use client"

import * as React from "react"
import { Book, ChevronDown, ChevronUp } from "lucide-react"
import { cn } from "@/lib/utils"
import { Card, CardContent, CardHeader, CardTitle } from "./card"
import { Button } from "./button"

interface Shot {
  shotNumber: number
  sceneDescription: string
  characters: string[]
  dialogue?: string
  action?: string
  emotion?: string
}

interface ScriptReaderProps {
  title: string
  synopsis?: string
  shots: Shot[]
  className?: string
}

export function ScriptReader({ title, synopsis, shots, className }: ScriptReaderProps) {
  const [expandedShots, setExpandedShots] = React.useState<Set<number>>(new Set([0]))

  const toggleShot = (shotNumber: number) => {
    setExpandedShots(prev => {
      const newSet = new Set(prev)
      if (newSet.has(shotNumber)) {
        newSet.delete(shotNumber)
      } else {
        newSet.add(shotNumber)
      }
      return newSet
    })
  }

  const expandAll = () => {
    setExpandedShots(new Set(shots.map(s => s.shotNumber)))
  }

  const collapseAll = () => {
    setExpandedShots(new Set())
  }

  return (
    <Card className={cn("", className)}>
      <CardHeader>
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-3">
            <Book className="w-6 h-6 text-[#FF6B6B]" />
            <div>
              <CardTitle>{title}</CardTitle>
              {synopsis && (
                <p className="text-sm text-neutral-400 mt-2">{synopsis}</p>
              )}
            </div>
          </div>
          <div className="flex gap-2">
            <Button variant="ghost" size="sm" onClick={expandAll}>
              展开全部
            </Button>
            <Button variant="ghost" size="sm" onClick={collapseAll}>
              收起全部
            </Button>
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-3">
        {shots.map((shot) => {
          const isExpanded = expandedShots.has(shot.shotNumber)

          return (
            <div
              key={shot.shotNumber}
              className="border border-white/10 rounded-lg overflow-hidden"
            >
              {/* Shot Header */}
              <button
                onClick={() => toggleShot(shot.shotNumber)}
                className="w-full flex items-center justify-between p-4 hover:bg-white/5 transition-colors"
              >
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-full bg-[#E8C547]/20 flex items-center justify-center text-[#FF6B6B] font-semibold">
                    {shot.shotNumber}
                  </div>
                  <div className="text-left">
                    <div className="font-medium text-white">第 {shot.shotNumber} 镜</div>
                    <div className="text-sm text-neutral-400 line-clamp-1">
                      {shot.sceneDescription}
                    </div>
                  </div>
                </div>
                {isExpanded ? (
                  <ChevronUp className="w-5 h-5 text-neutral-400" />
                ) : (
                  <ChevronDown className="w-5 h-5 text-neutral-400" />
                )}
              </button>

              {/* Shot Content */}
              {isExpanded && (
                <div className="p-4 pt-0 space-y-3">
                  <div>
                    <div className="text-xs text-neutral-500 uppercase mb-1">场景描述</div>
                    <div className="text-sm text-neutral-300">{shot.sceneDescription}</div>
                  </div>

                  {shot.characters.length > 0 && (
                    <div>
                      <div className="text-xs text-neutral-500 uppercase mb-1">角色</div>
                      <div className="flex flex-wrap gap-2">
                        {shot.characters.map((char, idx) => (
                          <span
                            key={idx}
                            className="px-2 py-1 rounded-full bg-[#E8C547]/10 text-[#FF6B6B] text-xs"
                          >
                            {char}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}

                  {shot.dialogue && (
                    <div>
                      <div className="text-xs text-neutral-500 uppercase mb-1">对话</div>
                      <div className="text-sm text-neutral-300 italic">"{shot.dialogue}"</div>
                    </div>
                  )}

                  {shot.action && (
                    <div>
                      <div className="text-xs text-neutral-500 uppercase mb-1">动作</div>
                      <div className="text-sm text-neutral-300">{shot.action}</div>
                    </div>
                  )}

                  {shot.emotion && (
                    <div>
                      <div className="text-xs text-neutral-500 uppercase mb-1">情绪氛围</div>
                      <div className="text-sm text-neutral-300">{shot.emotion}</div>
                    </div>
                  )}
                </div>
              )}
            </div>
          )
        })}
      </CardContent>
    </Card>
  )
}
