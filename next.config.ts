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
  // 让本地 2D 口型引擎用的 ffmpeg-static / fluent-ffmpeg 不被打包(保持其二进制路径正确,
  // 否则 webpack 重写 __dirname 会让 ffmpeg-static 指向不存在的路径)。
  serverExternalPackages: ['ffmpeg-static', 'fluent-ffmpeg'],
};

export default nextConfig;
