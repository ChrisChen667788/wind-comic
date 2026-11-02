import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: '**',
      },
    ],
  },
  // ffmpeg-static / ffprobe-static / fluent-ffmpeg 不被打包(保持其二进制路径正确,
  // 否则打包器重写 __dirname 会让它们指向不存在的路径)。解析入口见 lib/ffmpeg-bin.ts。
  serverExternalPackages: ['ffmpeg-static', 'ffprobe-static', 'fluent-ffmpeg'],
};

export default nextConfig;
