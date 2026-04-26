// Generate beautiful SVG placeholder images for the app
// These replace all external oiioii.ai / hogi.ai images to avoid commercial risk

function svgToDataUri(svg: string): string {
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

function gradientSvg(w: number, h: number, colors: [string, string], label: string): string {
  const id = label.replace(/\s/g, '');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
  <defs><linearGradient id="g${id}" x1="0%" y1="0%" x2="100%" y2="100%"><stop offset="0%" stop-color="${colors[0]}"/><stop offset="100%" stop-color="${colors[1]}"/></linearGradient></defs>
  <rect width="${w}" height="${h}" fill="url(#g${id})"/>
  <text x="50%" y="50%" dominant-baseline="middle" text-anchor="middle" fill="rgba(255,255,255,0.6)" font-family="system-ui" font-size="${Math.min(w, h) * 0.08}">${label}</text>
</svg>`;
}

// Hero / Feature images
// v2.11 更新: 之前是营销词(镜头盒/节奏谱/风格矩阵, 都没落地),
// 改成真实能力的视觉代号 —— Cameo 锁脸 / Keyframes 链 / Writer-Editor 闭环
export const IMG_LENS_BOX = svgToDataUri(gradientSvg(600, 400, ['#6b21a8', '#ec4899'], 'Cameo · 主角锁脸'));
export const IMG_RHYTHM = svgToDataUri(gradientSvg(600, 400, ['#1e3a5f', '#4de0c2'], 'Keyframes · 镜头衔接'));
export const IMG_STYLE_GRID = svgToDataUri(gradientSvg(600, 400, ['#0f172a', '#ef319f'], 'Writer-Editor · 闭环'));
export const IMG_FEATURE_MAIN = svgToDataUri(gradientSvg(700, 380, ['#1a1035', '#d946ef'], 'Feature Preview'));

// Agent cards — 对齐 types/agents.ts AgentRole 真实名称
export const IMG_AGENT_DIRECTOR = svgToDataUri(gradientSvg(400, 280, ['#4c1d95', '#f472b6'], 'AI 导演'));
export const IMG_AGENT_STORYBOARD = svgToDataUri(gradientSvg(400, 280, ['#0c4a6e', '#67e8f9'], 'AI 编剧'));
export const IMG_AGENT_MOTION = svgToDataUri(gradientSvg(400, 280, ['#1e1b4b', '#a78bfa'], 'AI 角色/分镜'));
export const IMG_AGENT_EDITOR = svgToDataUri(gradientSvg(400, 280, ['#3b0764', '#f0abfc'], 'AI 剪辑/制片'));

// Vibe shots
export const IMG_VIBE_FOREST = svgToDataUri(gradientSvg(600, 200, ['#064e3b', '#6ee7b7'], '雾森晨光'));
export const IMG_VIBE_NEON = svgToDataUri(gradientSvg(600, 200, ['#1e1b4b', '#ef319f'], '霓虹夜航'));

// Lens section
export const IMG_LENS_MAIN = svgToDataUri(gradientSvg(600, 320, ['#0C0C0C', '#4de0c2'], 'Lens Preview'));

// Auth backgrounds
export const IMG_AUTH_BG1 = svgToDataUri(gradientSvg(260, 360, ['#581c87', '#f472b6'], ''));
export const IMG_AUTH_BG2 = svgToDataUri(gradientSvg(260, 360, ['#0e7490', '#4de0c2'], ''));

// Preview / default
export const IMG_PREVIEW_DEFAULT = svgToDataUri(gradientSvg(600, 260, ['#1a1035', '#6b21a8'], 'Live Preview'));

// Avatar default
export const IMG_AVATAR_DEFAULT = svgToDataUri(
  `<svg xmlns="http://www.w3.org/2000/svg" width="80" height="80" viewBox="0 0 80 80">
  <rect width="80" height="80" rx="40" fill="#2d1b69"/>
  <circle cx="40" cy="30" r="14" fill="rgba(255,255,255,0.3)"/>
  <ellipse cx="40" cy="68" rx="22" ry="18" fill="rgba(255,255,255,0.2)"/>
</svg>`
);

// Background texture (dots pattern)
export const IMG_BG_TEXTURE = svgToDataUri(
  `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="400" viewBox="0 0 400 400">
  <rect width="400" height="400" fill="transparent"/>
  ${Array.from({ length: 60 }, () => {
    const x = Math.floor(Math.random() * 400);
    const y = Math.floor(Math.random() * 400);
    const r = Math.random() * 2 + 0.5;
    return `<circle cx="${x}" cy="${y}" r="${r}" fill="rgba(255,255,255,0.15)"/>`;
  }).join('')}
</svg>`
);

// Case covers
export const IMG_CASE_1 = svgToDataUri(gradientSvg(400, 300, ['#312e81', '#f9a8d4'], '月华藏境'));
export const IMG_CASE_2 = svgToDataUri(gradientSvg(400, 300, ['#0c4a6e', '#ef319f'], '霓虹回响'));
export const IMG_CASE_3 = svgToDataUri(gradientSvg(400, 300, ['#1e1b4b', '#4de0c2'], '星潮旅人'));
export const IMG_CASE_4 = svgToDataUri(gradientSvg(400, 300, ['#064e3b', '#a78bfa'], '云岚日记'));

// Project covers
export const IMG_PROJECT_1 = svgToDataUri(gradientSvg(300, 180, ['#4c1d95', '#ec4899'], '灵眸'));
export const IMG_PROJECT_2 = svgToDataUri(gradientSvg(300, 180, ['#0e7490', '#f472b6'], '都市镜像'));
export const IMG_PROJECT_3 = svgToDataUri(gradientSvg(300, 180, ['#1e3a5f', '#4de0c2'], '风起青枫'));
