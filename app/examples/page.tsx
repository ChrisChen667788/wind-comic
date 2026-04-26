"use client"

import * as React from "react"
import { motion } from "framer-motion"
import Link from "next/link"
import { Sparkles, Play, Eye, Heart, Share2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"

const examples = [
  {
    id: 1,
    title: "赛博朋克侦探",
    description: "2077年的新东京，一位赛博侦探接到神秘委托",
    thumbnail: "/placeholder/example1.jpg",
    genre: "科幻",
    duration: "3:24",
    views: "12.5K",
    likes: "1.2K"
  },
  {
    id: 2,
    title: "古风仙侠传",
    description: "修仙世界中的爱恨情仇",
    thumbnail: "/placeholder/example2.jpg",
    genre: "古风",
    duration: "4:15",
    views: "8.3K",
    likes: "856"
  },
  {
    id: 3,
    title: "末日求生录",
    description: "丧尸末日中的人性挣扎",
    thumbnail: "/placeholder/example3.jpg",
    genre: "惊悚",
    duration: "2:48",
    views: "15.7K",
    likes: "2.1K"
  },
  {
    id: 4,
    title: "校园青春物语",
    description: "高中生活的酸甜苦辣",
    thumbnail: "/placeholder/example4.jpg",
    genre: "青春",
    duration: "3:56",
    views: "20.1K",
    likes: "3.4K"
  },
  {
    id: 5,
    title: "魔法学院",
    description: "魔法世界的冒险之旅",
    thumbnail: "/placeholder/example5.jpg",
    genre: "奇幻",
    duration: "5:12",
    views: "18.9K",
    likes: "2.8K"
  },
  {
    id: 6,
    title: "都市爱情故事",
    description: "现代都市中的浪漫邂逅",
    thumbnail: "/placeholder/example6.jpg",
    genre: "爱情",
    duration: "3:33",
    views: "25.6K",
    likes: "4.2K"
  }
]

const genres = ["全部", "科幻", "古风", "惊悚", "青春", "奇幻", "爱情"]

export default function ExamplesPage() {
  const [selectedGenre, setSelectedGenre] = React.useState("全部")

  const filteredExamples = selectedGenre === "全部"
    ? examples
    : examples.filter(ex => ex.genre === selectedGenre)

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
              <Link href="/pricing">
                <Button variant="ghost">定价</Button>
              </Link>
              <Link href="/auth">
                <Button>开始创作</Button>
              </Link>
            </div>
          </div>
        </div>
      </nav>

      <main className="pt-24 pb-12 px-6">
        <div className="container mx-auto max-w-7xl">
          {/* Header */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="text-center mb-12"
          >
            <h1 className="text-5xl font-bold mb-4">
              <span className="bg-gradient-to-r from-white to-gray-400 bg-clip-text text-transparent">
                精选作品
              </span>
            </h1>
            <p className="text-xl text-neutral-400 max-w-2xl mx-auto">
              探索由 AI 创作的精彩漫剧作品
            </p>
          </motion.div>

          {/* Genre Filter */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
            className="flex flex-wrap justify-center gap-3 mb-12"
          >
            {genres.map((genre) => (
              <button
                key={genre}
                onClick={() => setSelectedGenre(genre)}
                className={`px-6 py-2 rounded-full transition-all ${
                  selectedGenre === genre
                    ? "bg-gradient-to-r from-[#E8C547] to-[#D4A830] text-white"
                    : "bg-white/5 text-neutral-400 hover:bg-white/10 hover:text-white"
                }`}
              >
                {genre}
              </button>
            ))}
          </motion.div>

          {/* Examples Grid */}
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
            {filteredExamples.map((example, index) => (
              <motion.div
                key={example.id}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: index * 0.1 }}
              >
                <Card className="group overflow-hidden hover:border-[#E8C547]/50 transition-all cursor-pointer">
                  {/* Thumbnail */}
                  <div className="relative aspect-video bg-gradient-to-br from-[#E8C547]/15 to-[#D4A830]/15 overflow-hidden">
                    <div className="absolute inset-0 flex items-center justify-center">
                      <div className="w-16 h-16 bg-white/10 rounded-full flex items-center justify-center group-hover:bg-white/20 transition-all">
                        <Play className="w-8 h-8 text-white" />
                      </div>
                    </div>
                    <div className="absolute top-3 left-3">
                      <Badge variant="default">{example.genre}</Badge>
                    </div>
                    <div className="absolute bottom-3 right-3 bg-black/80 px-2 py-1 rounded text-xs">
                      {example.duration}
                    </div>
                  </div>

                  <CardContent className="p-4">
                    <h3 className="font-semibold text-lg mb-2 group-hover:text-[#E8C547] transition-colors">
                      {example.title}
                    </h3>
                    <p className="text-sm text-neutral-400 mb-4 line-clamp-2">
                      {example.description}
                    </p>

                    <div className="flex items-center justify-between text-sm text-neutral-500">
                      <div className="flex items-center gap-4">
                        <span className="flex items-center gap-1">
                          <Eye className="w-4 h-4" />
                          {example.views}
                        </span>
                        <span className="flex items-center gap-1">
                          <Heart className="w-4 h-4" />
                          {example.likes}
                        </span>
                      </div>
                      <button className="hover:text-[#E8C547] transition-colors">
                        <Share2 className="w-4 h-4" />
                      </button>
                    </div>
                  </CardContent>
                </Card>
              </motion.div>
            ))}
          </div>

          {/* CTA */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.5 }}
            className="text-center mt-16"
          >
            <h2 className="text-3xl font-bold mb-4">准备好创作你的作品了吗？</h2>
            <p className="text-neutral-400 mb-6">
              加入数千位创作者，开始你的 AI 漫剧创作之旅
            </p>
            <Link href="/create">
              <Button size="lg">
                <Sparkles className="w-5 h-5 mr-2" />
                立即开始创作
              </Button>
            </Link>
          </motion.div>
        </div>
      </main>
    </div>
  )
}
