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
// v10.0.3: 把原来的死紫色渐变占位换成「影院取景器」示意图 —
//   雾山 + 孤身旅人剪影(呼应品牌「情绪渲染·史诗收束·山雾骑士」)+ 取景器 HUD。
//   纯原创 SVG,无第三方版权,随产品发布安全。
function cinematicPreviewSvg(): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="460" viewBox="0 0 1200 460">
  <defs>
    <linearGradient id="cpSky" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#070d18"/><stop offset="42%" stop-color="#0c1b2a"/>
      <stop offset="72%" stop-color="#163142"/><stop offset="100%" stop-color="#22414f"/>
    </linearGradient>
    <radialGradient id="cpSun" cx="50%" cy="50%" r="50%">
      <stop offset="0%" stop-color="#f4d774" stop-opacity="0.9"/>
      <stop offset="35%" stop-color="#e8c547" stop-opacity="0.45"/>
      <stop offset="100%" stop-color="#e8c547" stop-opacity="0"/>
    </radialGradient>
    <linearGradient id="cpMist" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#bcdfe6" stop-opacity="0"/>
      <stop offset="50%" stop-color="#bcdfe6" stop-opacity="0.22"/>
      <stop offset="100%" stop-color="#bcdfe6" stop-opacity="0"/>
    </linearGradient>
    <linearGradient id="cpVig" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#000" stop-opacity="0.35"/><stop offset="22%" stop-color="#000" stop-opacity="0"/>
      <stop offset="78%" stop-color="#000" stop-opacity="0"/><stop offset="100%" stop-color="#000" stop-opacity="0.45"/>
    </linearGradient>
  </defs>
  <rect width="1200" height="460" fill="url(#cpSky)"/>
  <circle cx="800" cy="250" r="260" fill="url(#cpSun)"/>
  <path d="M0,300 L150,262 L300,295 L470,250 L640,300 L820,255 L1000,298 L1200,268 L1200,460 L0,460 Z" fill="#1b3340" opacity="0.85"/>
  <rect x="0" y="286" width="1200" height="40" fill="url(#cpMist)"/>
  <path d="M0,340 L180,305 L360,345 L520,312 L700,352 L880,316 L1060,350 L1200,322 L1200,460 L0,460 Z" fill="#15293a"/>
  <rect x="0" y="332" width="1200" height="46" fill="url(#cpMist)" opacity="0.85"/>
  <path d="M0,392 L220,360 L430,398 L640,366 L860,400 L1080,372 L1200,392 L1200,460 L0,460 Z" fill="#0c1a26"/>
  <path d="M0,430 L300,414 L640,432 L980,416 L1200,430 L1200,460 L0,460 Z" fill="#06101a"/>
  <g transform="translate(398,356)" fill="#04181f">
    <ellipse cx="2" cy="40" rx="18" ry="4" fill="#000" opacity="0.35"/>
    <path d="M2,-22 C-9,-22 -13,-6 -14,38 L18,38 C17,-6 13,-22 2,-22 Z"/>
    <circle cx="2" cy="-28" r="6"/>
  </g>
  <rect width="1200" height="460" fill="url(#cpVig)"/>
  <g stroke="#f5f1ea" stroke-opacity="0.12" stroke-width="1">
    <line x1="400" y1="40" x2="400" y2="420"/><line x1="800" y1="40" x2="800" y2="420"/>
    <line x1="60" y1="153" x2="1140" y2="153"/><line x1="60" y1="306" x2="1140" y2="306"/>
  </g>
  <g stroke="#e8c547" stroke-opacity="0.7" stroke-width="3" fill="none">
    <path d="M48,60 L48,36 L72,36"/><path d="M1152,60 L1152,36 L1128,36"/>
    <path d="M48,400 L48,424 L72,424"/><path d="M1152,400 L1152,424 L1128,424"/>
  </g>
  <circle cx="70" cy="70" r="7" fill="#ff4d4f"/>
  <text x="86" y="76" font-family="ui-monospace,Menlo,monospace" font-size="20" fill="#f5f1ea" fill-opacity="0.92" letter-spacing="2">REC</text>
  <text x="1150" y="76" text-anchor="end" font-family="ui-monospace,Menlo,monospace" font-size="20" fill="#e8c547" fill-opacity="0.92" letter-spacing="2">00:00:08:04</text>
  <text x="56" y="404" font-family="ui-monospace,Menlo,monospace" font-size="16" fill="#f5f1ea" fill-opacity="0.6" letter-spacing="2">4K · 24FPS · S-LOG3</text>
  <g transform="translate(600,230)">
    <circle r="34" fill="#0a0f1c" fill-opacity="0.4" stroke="#f5f1ea" stroke-opacity="0.35" stroke-width="1.5"/>
    <path d="M-9,-15 L18,0 -9,15 Z" fill="#f5f1ea" fill-opacity="0.85"/>
  </g>
  <text x="600" y="300" text-anchor="middle" font-family="system-ui" font-size="17" fill="#f5f1ea" fill-opacity="0.55" letter-spacing="6">LIVE PREVIEW</text>
</svg>`;
}
export const IMG_PREVIEW_DEFAULT = svgToDataUri(cinematicPreviewSvg());

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
