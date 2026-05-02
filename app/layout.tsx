import type { Metadata } from "next";
import "./globals.css";
// v2.13: cinema theme — opt-in via .cinema-page className,不影响其他页
import "./cinema-theme.css";
import { ToastProvider } from "@/components/ui/toast-provider";
import { ErrorBoundary } from "@/components/error-boundary";
import { AuthProvider } from "@/components/auth-provider";

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
    <html lang="zh-CN">
      <body className="antialiased">
        <ErrorBoundary>
          <AuthProvider>
            <ToastProvider>
              {children}
            </ToastProvider>
          </AuthProvider>
        </ErrorBoundary>
      </body>
    </html>
  );
}
