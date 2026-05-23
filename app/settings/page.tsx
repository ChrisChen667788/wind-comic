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
import { useLocale } from "@/hooks/use-locale"
import type { Locale } from "@/lib/i18n"

export default function SettingsPage() {
  const { settings, updateSettings, isLoading } = useSettings()
  const { showToast } = useToast()
  const { t, locale, setLocale } = useLocale()

  const theme = settings.theme
  const notifications = settings.notifications.email

  // 语言下拉直接驱动真 i18n locale(同时同步到 useSettings)
  const setLanguage = (value: string) => {
    setLocale(value as Locale)
    updateSettings({ language: value })
  }
  const setTheme = (value: string) => updateSettings({ theme: value })
  const setNotifications = (value: boolean) =>
    updateSettings({ notifications: { ...settings.notifications, email: value } })

  const handleSave = () => {
    showToast({
      title: t.settings.saved,
      description: t.settings.savedDesc,
      type: "success"
    })
  }

  const handleReset = () => {
    setLocale('zh-CN')
    updateSettings({
      language: 'zh-CN',
      theme: 'dark',
      notifications: { email: true, push: true, updates: true },
      privacy: { profilePublic: false, showActivity: true },
    })
    showToast({ title: t.settings.resetDone, type: "info" })
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
              <span className="text-xl font-bold">{t.brand.studio}</span>
            </Link>

            <div className="flex items-center gap-4">
              <Link href="/profile">
                <Button variant="ghost">{t.nav.profile}</Button>
              </Link>
              <Link href="/projects">
                <Button variant="ghost">{t.nav.projects}</Button>
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
            <h1 className="text-4xl font-bold mb-2">{t.settings.title}</h1>
            <p className="text-neutral-400 mb-8">{t.settings.subtitle}</p>

            <div className="space-y-6">
              {/* General Settings */}
              <Card>
                <CardHeader>
                  <div className="flex items-center gap-3">
                    <Globe className="w-5 h-5 text-[#E8C547]" />
                    <div>
                      <CardTitle>{t.settings.general}</CardTitle>
                      <CardDescription>{t.settings.generalDesc}</CardDescription>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="space-y-2">
                    <label className="text-sm text-neutral-400">{t.settings.language}</label>
                    <Select
                      value={locale}
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
                      <CardTitle>{t.settings.appearance}</CardTitle>
                      <CardDescription>{t.settings.appearanceDesc}</CardDescription>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="space-y-2">
                    <label className="text-sm text-neutral-400">{t.settings.theme}</label>
                    <Select
                      value={theme}
                      onChange={(e) => setTheme(e.target.value)}
                    >
                      <option value="dark">{t.settings.themeDark}</option>
                      <option value="light">{t.settings.themeLight}</option>
                      <option value="auto">{t.settings.themeAuto}</option>
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
                      <CardTitle>{t.settings.notifications}</CardTitle>
                      <CardDescription>{t.settings.notificationsDesc}</CardDescription>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="font-medium">{t.settings.projectDone}</div>
                      <div className="text-sm text-neutral-400">{t.settings.projectDoneDesc}</div>
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
                      <CardTitle>{t.settings.performance}</CardTitle>
                      <CardDescription>{t.settings.performanceDesc}</CardDescription>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="space-y-2">
                    <label className="text-sm text-neutral-400">{t.settings.videoQuality}</label>
                    <Select defaultValue="high">
                      <option value="high">{t.settings.qualityHigh}</option>
                      <option value="medium">{t.settings.qualityMedium}</option>
                      <option value="low">{t.settings.qualityLow}</option>
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
                      <CardTitle>{t.settings.privacy}</CardTitle>
                      <CardDescription>{t.settings.privacyDesc}</CardDescription>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="space-y-4">
                  <Button variant="outline" className="w-full justify-start">
                    {t.settings.changePassword}
                  </Button>
                  <Button variant="outline" className="w-full justify-start">
                    {t.settings.enable2fa}
                  </Button>
                  <Button variant="outline" className="w-full justify-start">
                    {t.settings.manageDevices}
                  </Button>
                </CardContent>
              </Card>

              {/* Billing */}
              <Card>
                <CardHeader>
                  <div className="flex items-center gap-3">
                    <CreditCard className="w-5 h-5 text-orange-400" />
                    <div>
                      <CardTitle>{t.settings.billing}</CardTitle>
                      <CardDescription>{t.settings.billingDesc}</CardDescription>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="p-4 bg-[#E8C547]/10 border border-[#E8C547]/50 rounded-lg">
                    <div className="flex items-center justify-between mb-2">
                      <div className="font-semibold">{t.settings.freePlan}</div>
                      <div className="text-sm text-[#E8C547]">{t.settings.currentPlan}</div>
                    </div>
                    <div className="text-sm text-neutral-400">
                      {t.settings.freeQuota}
                    </div>
                  </div>
                  <Link href="/pricing">
                    <Button className="w-full">
                      {t.settings.upgradePro}
                    </Button>
                  </Link>
                </CardContent>
              </Card>

              {/* Save Button */}
              <div className="flex justify-end gap-3">
                <Button variant="ghost" onClick={handleReset}>
                  {t.common.reset}
                </Button>
                <Button onClick={handleSave}>
                  {t.common.saveChanges}
                </Button>
              </div>
            </div>
          </motion.div>
        </div>
      </main>
    </div>
  )
}
