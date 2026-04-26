"use client"

import * as React from "react"
import { motion } from "framer-motion"
import Link from "next/link"
import { Sparkles, BookOpen, Zap, Users, HelpCircle, MessageCircle } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"

const guides = [
  {
    title: "快速开始",
    description: "5分钟学会创作你的第一个 AI 漫剧",
    icon: Zap,
    color: "text-yellow-400"
  },
  {
    title: "创作指南",
    description: "掌握 AI 漫剧创作的技巧和最佳实践",
    icon: BookOpen,
    color: "text-blue-400"
  },
  {
    title: "社区教程",
    description: "来自创作者社区的经验分享",
    icon: Users,
    color: "text-green-400"
  }
]

const faqs = [
  {
    q: "如何开始创作我的第一个项目？",
    a: "点击「开始创作」按钮，输入你的故事创意，选择视频生成引擎，AI 会自动为你生成完整的漫剧作品。"
  },
  {
    q: "支持哪些视频生成引擎？",
    a: "我们支持 Minimax、Vidu 和可灵 AI 等多个视频生成引擎，你可以根据需求选择最适合的引擎。"
  },
  {
    q: "生成一个项目需要多长时间？",
    a: "通常需要 5-15 分钟，具体时间取决于项目复杂度和所选的视频生成引擎。"
  },
  {
    q: "可以编辑 AI 生成的内容吗？",
    a: "是的，你可以编辑剧本、调整角色设计、修改分镜图，完全掌控创作过程。"
  },
  {
    q: "生成的作品可以商用吗？",
    a: "专业版和企业版用户可以将作品用于商业用途。免费版仅供个人学习使用。"
  },
  {
    q: "如何导出我的作品？",
    a: "在项目详情页点击「下载」按钮，可以导出视频、图片和剧本等所有素材。"
  }
]

export default function HelpPage() {
  const [searchQuery, setSearchQuery] = React.useState("")

  return (
    <div className="min-h-screen bg-black text-white">
      {/* Navigation */}
      <nav className="fixed top-0 left-0 right-0 z-50 bg-black/80 backdrop-blur-xl border-b border-white/10">
        <div className="container mx-auto px-6 py-4">
          <div className="flex items-center justify-between">
            <Link href="/" className="flex items-center gap-2">
              <div className="w-8 h-8 bg-gradient-to-br from-[#E8C547] to-[#D4A830] rounded-lg flex items-center justify-center">
                <Sparkles className="w-5 h-5" />
              </div>
              <span className="text-xl font-bold">AI 漫剧工作室</span>
            </Link>

            <div className="flex items-center gap-4">
              <Link href="/examples">
                <Button variant="ghost">示例作品</Button>
              </Link>
              <Link href="/auth">
                <Button>开始创作</Button>
              </Link>
            </div>
          </div>
        </div>
      </nav>

      <main className="pt-24 pb-12 px-6">
        <div className="container mx-auto max-w-5xl">
          {/* Header */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="text-center mb-12"
          >
            <h1 className="text-5xl font-bold mb-4">
              <span className="bg-gradient-to-r from-white to-gray-400 bg-clip-text text-transparent">
                帮助中心
              </span>
            </h1>
            <p className="text-xl text-neutral-400 max-w-2xl mx-auto mb-8">
              找到你需要的答案，快速上手 AI 漫剧创作
            </p>

            {/* Search */}
            <div className="max-w-2xl mx-auto">
              <div className="relative">
                <HelpCircle className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-neutral-500" />
                <Input
                  type="text"
                  placeholder="搜索帮助文档..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-12 h-14 text-lg"
                />
              </div>
            </div>
          </motion.div>

          {/* Quick Guides */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
            className="mb-16"
          >
            <h2 className="text-2xl font-bold mb-6">快速指南</h2>
            <div className="grid md:grid-cols-3 gap-6">
              {guides.map((guide, index) => {
                const Icon = guide.icon
                return (
                  <Card key={index} className="hover:border-[#E8C547]/50 transition-all cursor-pointer">
                    <CardHeader>
                      <Icon className={`w-8 h-8 ${guide.color} mb-2`} />
                      <CardTitle>{guide.title}</CardTitle>
                      <CardDescription>{guide.description}</CardDescription>
                    </CardHeader>
                  </Card>
                )
              })}
            </div>
          </motion.div>

          {/* FAQs */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2 }}
            className="mb-16"
          >
            <h2 className="text-2xl font-bold mb-6">常见问题</h2>
            <div className="space-y-4">
              {faqs.map((faq, index) => (
                <Card key={index}>
                  <CardHeader>
                    <CardTitle className="text-lg">{faq.q}</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <p className="text-neutral-400">{faq.a}</p>
                  </CardContent>
                </Card>
              ))}
            </div>
          </motion.div>

          {/* Contact Support */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.3 }}
          >
            <Card className="bg-gradient-to-br from-[#E8C547]/08 to-[#D4A830]/08 border-[#E8C547]/50">
              <CardHeader className="text-center">
                <MessageCircle className="w-12 h-12 text-[#E8C547] mx-auto mb-4" />
                <CardTitle className="text-2xl">还有其他问题？</CardTitle>
                <CardDescription className="text-base">
                  我们的支持团队随时为你提供帮助
                </CardDescription>
              </CardHeader>
              <CardContent className="flex justify-center gap-4">
                <Button variant="outline">
                  发送邮件
                </Button>
                <Button>
                  在线客服
                </Button>
              </CardContent>
            </Card>
          </motion.div>
        </div>
      </main>
    </div>
  )
}
