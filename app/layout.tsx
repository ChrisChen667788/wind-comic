import type { Metadata } from "next";
// v8.3 P1: Plus Jakarta Sans (Taste Skill 推荐, 非 Inter) 自托管, 0 运行时 Google Fonts 请求
import { Plus_Jakarta_Sans, JetBrains_Mono } from "next/font/google";
import "./globals.css";
// v2.13: cinema theme — opt-in via .cinema-page className,不影响其他页
import "./cinema-theme.css";
import { ToastProvider } from "@/components/ui/toast-provider";
import { IconProvider } from "@/components/icon-provider";
import { ErrorBoundary } from "@/components/error-boundary";
import { AuthProvider } from "@/components/auth-provider";
import { MotionProvider } from "@/components/motion-provider";
import { SkipLink } from "@/components/skip-link";

const jakarta = Plus_Jakarta_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
  variable: "--font-jakarta",
  display: "swap",
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: "青枫漫剧 · AI Animation Agent Studio",
  description: "你的 AI 动画/漫剧团队，从灵感到成片一步到位",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN" className={`${jakarta.variable} ${jetbrainsMono.variable}`}>
      <body className="antialiased">
        {/* v10.3.5 a11y: 跳到主内容 —— 键盘第一个可聚焦元素,平时 sr-only,聚焦才显形 */}
        <SkipLink />
        {/* v8.3 P1: 全局 film grain 遮罩 (固定, 不接触指针, 与暖墨黑底叠出印刷质感) */}
        <div aria-hidden className="film-grain" />
        <ErrorBoundary>
          <IconProvider>
            <AuthProvider>
              <ToastProvider>
                <MotionProvider>
                  {children}
                </MotionProvider>
              </ToastProvider>
            </AuthProvider>
          </IconProvider>
        </ErrorBoundary>
      </body>
    </html>
  );
}
