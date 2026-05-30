"use client"

import * as React from "react"
import { motion } from "framer-motion"
import Link from "next/link"
import { Sparkle as Sparkles, BookOpen, Lightning as Zap, Users, Question as HelpCircle, ChatCircle as MessageCircle } from '@phosphor-icons/react';import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { useLocale } from "@/hooks/use-locale"

// 仅保留展示用的图标 + 颜色; 标题/描述走 i18n (t.help.guides 按序对应)
const guideMeta = [
  { icon: Zap, color: "text-yellow-400" },
  { icon: BookOpen, color: "text-blue-400" },
  { icon: Users, color: "text-green-400" },
]

export default function HelpPage() {
  const { t } = useLocale()
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
              <span className="text-xl font-bold">{t.brand.studio}</span>
            </Link>

            <div className="flex items-center gap-4">
              <Link href="/examples">
                <Button variant="ghost">{t.help.examples}</Button>
              </Link>
              <Link href="/auth">
                <Button>{t.nav.create}</Button>
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
                {t.help.title}
              </span>
            </h1>
            <p className="text-xl text-neutral-400 max-w-2xl mx-auto mb-8">
              {t.help.subtitle}
            </p>

            {/* Search */}
            <div className="max-w-2xl mx-auto">
              <div className="relative">
                <HelpCircle className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-neutral-500" />
                <Input
                  type="text"
                  placeholder={t.help.searchPlaceholder}
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
            <h2 className="text-2xl font-bold mb-6">{t.help.quickGuides}</h2>
            <div className="grid md:grid-cols-3 gap-6">
              {guideMeta.map((guide, index) => {
                const Icon = guide.icon
                return (
                  <Card key={index} className="hover:border-[#E8C547]/50 transition-all cursor-pointer">
                    <CardHeader>
                      <Icon className={`w-8 h-8 ${guide.color} mb-2`} />
                      <CardTitle>{t.help.guides[index].title}</CardTitle>
                      <CardDescription>{t.help.guides[index].description}</CardDescription>
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
            <h2 className="text-2xl font-bold mb-6">{t.help.faqTitle}</h2>
            <div className="space-y-4">
              {t.help.faqs.map((faq, index) => (
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
                <CardTitle className="text-2xl">{t.help.moreTitle}</CardTitle>
                <CardDescription className="text-base">
                  {t.help.moreDesc}
                </CardDescription>
              </CardHeader>
              <CardContent className="flex justify-center gap-4">
                <Button variant="outline">
                  {t.help.sendEmail}
                </Button>
                <Button>
                  {t.help.liveChat}
                </Button>
              </CardContent>
            </Card>
          </motion.div>
        </div>
      </main>
    </div>
  )
}
