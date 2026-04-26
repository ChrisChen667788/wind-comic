"use client"

import * as React from "react"
import { motion } from "framer-motion"
import Link from "next/link"
import { Sparkles, Bell, Globe, Palette, Zap, Shield, CreditCard } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Select } from "@/components/ui/select"
import { useToast } from "@/components/ui/toast-provider"
import { useSettings } from "@/hooks/useSettings"

export default function SettingsPage() {
  const { settings, updateSettings, isLoading } = useSettings()
  const { showToast } = useToast()

  const language = settings.language
  const theme = settings.theme
  const notifications = settings.notifications.email

  const setLanguage = (value: string) => updateSettings({ language: value })
  const setTheme = (value: string) => updateSettings({ theme: value })
  const setNotifications = (value: boolean) =>
    updateSettings({ notifications: { ...settings.notifications, email: value } })

  const handleSave = () => {
    showToast({
      title: "设置已保存",
      description: "你的偏好设置已更新",
      type: "success"
    })
  }

  const handleReset = () => {
    updateSettings({
      language: 'zh-CN',
      theme: 'dark',
      notifications: { email: true, push: true, updates: true },
      privacy: { profilePublic: false, showActivity: true },
    })
    showToast({ title: "设置已重置", type: "info" })
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
              <Link href="/profile">
                <Button variant="ghost">个人资料</Button>
              </Link>
              <Link href="/projects">
                <Button variant="ghost">我的项目</Button>
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
            <h1 className="text-4xl font-bold mb-2">设置</h1>
            <p className="text-neutral-400 mb-8">管理你的应用偏好和账户设置</p>

            <div className="space-y-6">
              {/* General Settings */}
              <Card>
                <CardHeader>
                  <div className="flex items-center gap-3">
                    <Globe className="w-5 h-5 text-[#E8C547]" />
                    <div>
                      <CardTitle>通用设置</CardTitle>
                      <CardDescription>语言和地区偏好</CardDescription>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="space-y-2">
                    <label className="text-sm text-neutral-400">语言</label>
                    <Select
                      value={language}
                      onChange={(e) => setLanguage(e.target.value)}
                    >
                      <option value="zh-CN">简体中文</option>
                      <option value="zh-TW">繁體中文</option>
                      <option value="en">English</option>
                      <option value="ja">日本語</option>
                    </Select>
                  </div>
                </CardContent>
              </Card>

              {/* Appearance */}
              <Card>
                <CardHeader>
                  <div className="flex items-center gap-3">
                    <Palette className="w-5 h-5 text-pink-400" />
                    <div>
                      <CardTitle>外观</CardTitle>
                      <CardDescription>自定义界面主题</CardDescription>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="space-y-2">
                    <label className="text-sm text-neutral-400">主题</label>
                    <Select
                      value={theme}
                      onChange={(e) => setTheme(e.target.value)}
                    >
                      <option value="dark">深色模式</option>
                      <option value="light">浅色模式</option>
                      <option value="auto">跟随系统</option>
                    </Select>
                  </div>
                </CardContent>
              </Card>

              {/* Notifications */}
              <Card>
                <CardHeader>
                  <div className="flex items-center gap-3">
                    <Bell className="w-5 h-5 text-blue-400" />
                    <div>
                      <CardTitle>通知</CardTitle>
                      <CardDescription>管理通知偏好</CardDescription>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="font-medium">项目完成通知</div>
                      <div className="text-sm text-neutral-400">当项目创作完成时接收通知</div>
                    </div>
                    <button
                      onClick={() => setNotifications(!notifications)}
                      className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                        notifications ? "bg-[#E8C547]" : "bg-neutral-700"
                      }`}
                    >
                      <span
                        className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                          notifications ? "translate-x-6" : "translate-x-1"
                        }`}
                      />
                    </button>
                  </div>
                </CardContent>
              </Card>

              {/* Performance */}
              <Card>
                <CardHeader>
                  <div className="flex items-center gap-3">
                    <Zap className="w-5 h-5 text-yellow-400" />
                    <div>
                      <CardTitle>性能</CardTitle>
                      <CardDescription>优化应用性能</CardDescription>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="space-y-2">
                    <label className="text-sm text-neutral-400">视频质量</label>
                    <Select defaultValue="high">
                      <option value="high">高质量</option>
                      <option value="medium">中等质量</option>
                      <option value="low">低质量（节省流量）</option>
                    </Select>
                  </div>
                </CardContent>
              </Card>

              {/* Privacy & Security */}
              <Card>
                <CardHeader>
                  <div className="flex items-center gap-3">
                    <Shield className="w-5 h-5 text-green-400" />
                    <div>
                      <CardTitle>隐私与安全</CardTitle>
                      <CardDescription>保护你的账户安全</CardDescription>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="space-y-4">
                  <Button variant="outline" className="w-full justify-start">
                    修改密码
                  </Button>
                  <Button variant="outline" className="w-full justify-start">
                    启用两步验证
                  </Button>
                  <Button variant="outline" className="w-full justify-start">
                    管理已登录设备
                  </Button>
                </CardContent>
              </Card>

              {/* Billing */}
              <Card>
                <CardHeader>
                  <div className="flex items-center gap-3">
                    <CreditCard className="w-5 h-5 text-orange-400" />
                    <div>
                      <CardTitle>账单与订阅</CardTitle>
                      <CardDescription>管理你的订阅计划</CardDescription>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="p-4 bg-[#E8C547]/10 border border-[#E8C547]/50 rounded-lg">
                    <div className="flex items-center justify-between mb-2">
                      <div className="font-semibold">免费计划</div>
                      <div className="text-sm text-[#E8C547]">当前计划</div>
                    </div>
                    <div className="text-sm text-neutral-400">
                      每月 10 个项目额度
                    </div>
                  </div>
                  <Link href="/pricing">
                    <Button className="w-full">
                      升级到专业版
                    </Button>
                  </Link>
                </CardContent>
              </Card>

              {/* Save Button */}
              <div className="flex justify-end gap-3">
                <Button variant="ghost" onClick={handleReset}>
                  重置
                </Button>
                <Button onClick={handleSave}>
                  保存更改
                </Button>
              </div>
            </div>
          </motion.div>
        </div>
      </main>
    </div>
  )
}
