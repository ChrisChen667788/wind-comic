"use client"

import * as React from "react"
import { motion } from "framer-motion"
import Link from "next/link"
import { Sparkles, User, Mail, Camera, Save } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Avatar } from "@/components/ui/avatar"
import { useToast } from "@/components/ui/toast-provider"

export default function ProfilePage() {
  const [name, setName] = React.useState("张三")
  const [email, setEmail] = React.useState("zhangsan@example.com")
  const [bio, setBio] = React.useState("热爱创作的 AI 漫剧制作人")
  const [loading, setLoading] = React.useState(false)
  const { showToast } = useToast()

  const handleSave = async () => {
    setLoading(true)
    setTimeout(() => {
      showToast({
        title: "保存成功",
        description: "个人资料已更新",
        type: "success"
      })
      setLoading(false)
    }, 1000)
  }

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
              <Link href="/projects">
                <Button variant="ghost">我的项目</Button>
              </Link>
              <Link href="/settings">
                <Button variant="ghost">设置</Button>
              </Link>
            </div>
          </div>
        </div>
      </nav>

      <main className="pt-24 pb-12 px-6">
        <div className="container mx-auto max-w-4xl">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
          >
            <h1 className="text-4xl font-bold mb-2">个人资料</h1>
            <p className="text-neutral-400 mb-8">管理你的个人信息和偏好设置</p>

            <div className="grid md:grid-cols-3 gap-6">
              {/* Avatar Section */}
              <Card className="md:col-span-1">
                <CardHeader>
                  <CardTitle>头像</CardTitle>
                </CardHeader>
                <CardContent className="flex flex-col items-center">
                  <div className="relative group">
                    <Avatar className="w-32 h-32">
                      <div className="w-full h-full bg-gradient-to-br from-[#E8C547] to-[#D4A830] flex items-center justify-center text-4xl font-bold">
                        {name.charAt(0)}
                      </div>
                    </Avatar>
                    <button className="absolute inset-0 bg-black/60 rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                      <Camera className="w-6 h-6" />
                    </button>
                  </div>
                  <Button variant="outline" className="mt-4 w-full">
                    上传头像
                  </Button>
                </CardContent>
              </Card>

              {/* Profile Info */}
              <Card className="md:col-span-2">
                <CardHeader>
                  <CardTitle>基本信息</CardTitle>
                  <CardDescription>更新你的个人资料</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="space-y-2">
                    <label className="text-sm text-neutral-400">用户名</label>
                    <div className="relative">
                      <User className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-neutral-500" />
                      <Input
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        className="pl-10"
                      />
                    </div>
                  </div>

                  <div className="space-y-2">
                    <label className="text-sm text-neutral-400">邮箱</label>
                    <div className="relative">
                      <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-neutral-500" />
                      <Input
                        type="email"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        className="pl-10"
                      />
                    </div>
                  </div>

                  <div className="space-y-2">
                    <label className="text-sm text-neutral-400">个人简介</label>
                    <Textarea
                      value={bio}
                      onChange={(e) => setBio(e.target.value)}
                      rows={4}
                      placeholder="介绍一下你自己..."
                    />
                  </div>

                  <Button
                    onClick={handleSave}
                    disabled={loading}
                    className="w-full"
                  >
                    <Save className="w-4 h-4 mr-2" />
                    {loading ? "保存中..." : "保存更改"}
                  </Button>
                </CardContent>
              </Card>

              {/* Stats */}
              <Card className="md:col-span-3">
                <CardHeader>
                  <CardTitle>创作统计</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                    <div className="text-center p-4 bg-white/5 rounded-lg">
                      <div className="text-3xl font-bold text-[#E8C547]">12</div>
                      <div className="text-sm text-neutral-400 mt-1">总项目数</div>
                    </div>
                    <div className="text-center p-4 bg-white/5 rounded-lg">
                      <div className="text-3xl font-bold text-pink-400">8</div>
                      <div className="text-sm text-neutral-400 mt-1">已完成</div>
                    </div>
                    <div className="text-center p-4 bg-white/5 rounded-lg">
                      <div className="text-3xl font-bold text-blue-400">4</div>
                      <div className="text-sm text-neutral-400 mt-1">进行中</div>
                    </div>
                    <div className="text-center p-4 bg-white/5 rounded-lg">
                      <div className="text-3xl font-bold text-green-400">156</div>
                      <div className="text-sm text-neutral-400 mt-1">总镜头数</div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>
          </motion.div>
        </div>
      </main>
    </div>
  )
}
