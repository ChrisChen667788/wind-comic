import type { Metadata } from "next";
// v8.3 P1: Plus Jakarta Sans (Taste Skill 推荐, 非 Inter) 自托管, 0 运行时 Google Fonts 请求
// v12.321: 改 next/font/local —— `next/font/google` 运行时确实不请求 Google,但它在
// **构建期**下载字体。CI 的 Build job 因此连红两次(v12.316、v12.319),报的是
// `internal/font/google … Module not found`,长得和模块解析回归一模一样,极易误判成
// 代码问题(这两次我都先怀疑了自己)。字体文件进仓后,构建不再依赖外网。
import localFont from "next/font/local";
import "./globals.css";
// v2.13: cinema theme — opt-in via .cinema-page className,不影响其他页
import "./cinema-theme.css";
import { ToastProvider } from "@/components/ui/toast-provider";
import { IconProvider } from "@/components/icon-provider";
import { ErrorBoundary } from "@/components/error-boundary";
import { AuthProvider } from "@/components/auth-provider";
import { MotionProvider } from "@/components/motion-provider";
import { SkipLink } from "@/components/skip-link";

// 可变字体各一个文件(latin 子集),覆盖原先逐字重下载的全部档位:
// Jakarta 400–800、Mono 400–600 都在 wght 轴范围内,合计 67KB。
const jakarta = localFont({
  src: "./fonts/plus-jakarta-sans.woff2",
  weight: "200 800",
  variable: "--font-jakarta",
  display: "swap",
});

const jetbrainsMono = localFont({
  src: "./fonts/jetbrains-mono.woff2",
  weight: "100 800",
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
