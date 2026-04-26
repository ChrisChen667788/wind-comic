/**
 * 风格预设库 v1 —— 60 个初始风格
 *
 * 分类：realistic / anime / artistic / retro / experimental，每类 12 个。
 *
 * 缩略图统一由 MJ API 通过 `scripts/generate-style-thumbnails.ts` 生成，
 * 输出到 `public/styles/<id>.jpg`。
 *
 * promptFragment 将在生成图/视频时注入到 prompt 末尾（逗号分隔），
 * 由 orchestrator 在调用具体 engine service 前统一拼接。
 */

import type { StylePreset } from '@/types/agents';

export const STYLE_PRESETS: StylePreset[] = [
  // ========== REALISTIC 写实 (12) ==========
  {
    id: 'cinematic',
    name: '电影感',
    nameEn: 'Cinematic',
    category: 'realistic',
    thumbnail: '/styles/cinematic.jpg',
    promptFragment: 'cinematic lighting, shallow depth of field, film grain, anamorphic lens, color graded, 35mm',
    negativePrompt: 'cartoon, anime, flat lighting',
    recommendedEngine: 'seedance2',
    popularity: 98,
  },
  {
    id: 'documentary',
    name: '纪录片',
    nameEn: 'Documentary',
    category: 'realistic',
    thumbnail: '/styles/documentary.jpg',
    promptFragment: 'documentary photography, handheld camera, natural light, candid moment, realistic tones',
    recommendedEngine: 'kling3',
    popularity: 72,
  },
  {
    id: 'photojournalism',
    name: '新闻摄影',
    nameEn: 'Photojournalism',
    category: 'realistic',
    thumbnail: '/styles/photojournalism.jpg',
    promptFragment: 'photojournalistic, gritty realism, high contrast, black and white tones, 50mm lens',
    popularity: 58,
  },
  {
    id: 'portrait-natural',
    name: '自然光人像',
    nameEn: 'Natural Light Portrait',
    category: 'realistic',
    thumbnail: '/styles/portrait-natural.jpg',
    promptFragment: 'natural window light portrait, soft shadows, creamy bokeh, 85mm, skin texture detail',
    recommendedEngine: 'kling3',
    popularity: 88,
  },
  {
    id: 'hdr-landscape',
    name: 'HDR 风景',
    nameEn: 'HDR Landscape',
    category: 'realistic',
    thumbnail: '/styles/hdr-landscape.jpg',
    promptFragment: 'HDR landscape photography, ultra wide angle, rich shadow detail, vivid skies, Ansel Adams inspired',
    popularity: 66,
  },
  {
    id: 'golden-hour',
    name: '黄金时刻',
    nameEn: 'Golden Hour',
    category: 'realistic',
    thumbnail: '/styles/golden-hour.jpg',
    promptFragment: 'golden hour sunlight, warm backlight, lens flare, soft haze, cinematic warmth',
    recommendedEngine: 'seedance2',
    popularity: 92,
  },
  {
    id: 'blue-hour',
    name: '蓝调时刻',
    nameEn: 'Blue Hour',
    category: 'realistic',
    thumbnail: '/styles/blue-hour.jpg',
    promptFragment: 'blue hour twilight, deep cyan sky, city lights, long exposure, moody atmosphere',
    popularity: 64,
  },
  {
    id: 'fashion-editorial',
    name: '时尚大片',
    nameEn: 'Fashion Editorial',
    category: 'realistic',
    thumbnail: '/styles/fashion-editorial.jpg',
    promptFragment: 'high fashion editorial, Vogue cover, dramatic studio lighting, strong pose, matte finish',
    popularity: 75,
  },
  {
    id: 'street-photography',
    name: '街拍',
    nameEn: 'Street Photography',
    category: 'realistic',
    thumbnail: '/styles/street-photography.jpg',
    promptFragment: 'street photography, candid urban moment, Leica M6 film look, grainy, dynamic composition',
    popularity: 70,
  },
  {
    id: 'macro',
    name: '微距',
    nameEn: 'Macro',
    category: 'realistic',
    thumbnail: '/styles/macro.jpg',
    promptFragment: 'macro photography, extreme close up, razor sharp focus, intricate detail, shallow depth',
    popularity: 45,
  },
  {
    id: 'food-styled',
    name: '美食',
    nameEn: 'Food Styling',
    category: 'realistic',
    thumbnail: '/styles/food-styled.jpg',
    promptFragment: 'food photography, overhead 45 degree angle, soft diffused light, appetizing color, steam',
    popularity: 52,
  },
  {
    id: 'hyperrealism',
    name: '超写实',
    nameEn: 'Hyperrealism',
    category: 'realistic',
    thumbnail: '/styles/hyperrealism.jpg',
    promptFragment: 'hyperrealistic, 8k detail, perfectly rendered skin pores, every strand of hair visible, physically based',
    popularity: 80,
  },

  // ========== ANIME 动漫 (12) ==========
  {
    id: 'modern-anime',
    name: '日漫现代',
    nameEn: 'Modern Anime',
    category: 'anime',
    thumbnail: '/styles/modern-anime.jpg',
    promptFragment: 'modern anime style, vibrant color, clean linework, expressive eyes, soft cel shading, Kyoto Animation',
    recommendedEngine: 'seedance2',
    popularity: 97,
  },
  {
    id: 'ghibli',
    name: '吉卜力',
    nameEn: 'Ghibli',
    category: 'anime',
    thumbnail: '/styles/ghibli.jpg',
    promptFragment: 'Studio Ghibli style, hand-painted backgrounds, soft watercolor clouds, warm nostalgic palette, Miyazaki',
    recommendedEngine: 'kling3',
    popularity: 95,
  },
  {
    id: 'makoto-shinkai',
    name: '新海诚',
    nameEn: 'Makoto Shinkai',
    category: 'anime',
    thumbnail: '/styles/makoto-shinkai.jpg',
    promptFragment: 'Makoto Shinkai style, hyper detailed skies, volumetric god rays, wistful romantic atmosphere, vivid sunset',
    recommendedEngine: 'kling3',
    popularity: 94,
  },
  {
    id: 'kyoani',
    name: '京阿尼',
    nameEn: 'Kyoto Animation',
    category: 'anime',
    thumbnail: '/styles/kyoani.jpg',
    promptFragment: 'KyoAni style, crisp detailed character animation, soft pastel lighting, slice of life, melancholy warmth',
    popularity: 82,
  },
  {
    id: 'cel-shaded',
    name: '赛璐璐',
    nameEn: 'Cel Shaded',
    category: 'anime',
    thumbnail: '/styles/cel-shaded.jpg',
    promptFragment: 'classic cel shaded anime, flat color blocks, visible line art, retro 90s anime aesthetic',
    popularity: 68,
  },
  {
    id: 'shounen',
    name: '少年热血',
    nameEn: 'Shounen Action',
    category: 'anime',
    thumbnail: '/styles/shounen.jpg',
    promptFragment: 'shounen anime, dynamic action pose, speed lines, intense expression, saturated color, energetic',
    popularity: 78,
  },
  {
    id: 'shoujo',
    name: '少女唯美',
    nameEn: 'Shoujo Romance',
    category: 'anime',
    thumbnail: '/styles/shoujo.jpg',
    promptFragment: 'shoujo anime, sparkling eyes, floral frames, pastel color, dreamy romantic atmosphere',
    popularity: 60,
  },
  {
    id: 'chibi',
    name: 'Q 版',
    nameEn: 'Chibi',
    category: 'anime',
    thumbnail: '/styles/chibi.jpg',
    promptFragment: 'chibi style, super deformed, big head small body, cute rounded shapes, playful',
    popularity: 56,
  },
  {
    id: 'mecha',
    name: '机甲',
    nameEn: 'Mecha',
    category: 'anime',
    thumbnail: '/styles/mecha.jpg',
    promptFragment: 'mecha anime, detailed robot, panel lines, industrial, Gundam style, cinematic scale',
    popularity: 63,
  },
  {
    id: 'seinen-dark',
    name: '青年暗黑',
    nameEn: 'Dark Seinen',
    category: 'anime',
    thumbnail: '/styles/seinen-dark.jpg',
    promptFragment: 'dark seinen anime, mature tone, desaturated palette, heavy shadows, gritty realism, Berserk inspired',
    popularity: 71,
  },
  {
    id: 'chinese-animation',
    name: '国风动画',
    nameEn: 'Chinese Animation',
    category: 'anime',
    thumbnail: '/styles/chinese-animation.jpg',
    promptFragment: 'Chinese animation style, wuxia aesthetic, flowing robes, ink wash backgrounds, elegant lineart',
    recommendedEngine: 'viduq3',
    popularity: 85,
  },
  {
    id: 'donghua',
    name: '现代国漫',
    nameEn: 'Modern Donghua',
    category: 'anime',
    thumbnail: '/styles/donghua.jpg',
    promptFragment: 'modern donghua 3D animation style, stylized cel look, vivid color, cinematic action, Nezha style',
    recommendedEngine: 'viduq3',
    popularity: 84,
  },

  // ========== ARTISTIC 艺术 (12) ==========
  {
    id: 'ink-wash',
    name: '水墨',
    nameEn: 'Ink Wash',
    category: 'artistic',
    thumbnail: '/styles/ink-wash.jpg',
    promptFragment: 'traditional Chinese ink wash painting, sumi-e, flowing brush strokes, monochrome gradient, rice paper texture',
    recommendedEngine: 'viduq3',
    popularity: 86,
  },
  {
    id: 'oil-painting',
    name: '油画',
    nameEn: 'Oil Painting',
    category: 'artistic',
    thumbnail: '/styles/oil-painting.jpg',
    promptFragment: 'classical oil painting, visible brush strokes, rich impasto, Rembrandt lighting, museum quality',
    popularity: 77,
  },
  {
    id: 'watercolor',
    name: '水彩',
    nameEn: 'Watercolor',
    category: 'artistic',
    thumbnail: '/styles/watercolor.jpg',
    promptFragment: 'watercolor painting, soft wet on wet bleeds, translucent layers, paper texture, delicate',
    popularity: 74,
  },
  {
    id: 'pencil-sketch',
    name: '铅笔素描',
    nameEn: 'Pencil Sketch',
    category: 'artistic',
    thumbnail: '/styles/pencil-sketch.jpg',
    promptFragment: 'detailed pencil sketch, graphite on paper, cross hatching, tonal gradient, study drawing',
    popularity: 51,
  },
  {
    id: 'woodcut',
    name: '版画',
    nameEn: 'Woodcut Print',
    category: 'artistic',
    thumbnail: '/styles/woodcut.jpg',
    promptFragment: 'woodcut print style, bold black lines, high contrast, Hokusai inspired, textured paper',
    popularity: 48,
  },
  {
    id: 'pop-art',
    name: '波普',
    nameEn: 'Pop Art',
    category: 'artistic',
    thumbnail: '/styles/pop-art.jpg',
    promptFragment: 'pop art style, Roy Lichtenstein dots, bold primary colors, comic panel aesthetic, screen print',
    popularity: 62,
  },
  {
    id: 'art-nouveau',
    name: '新艺术',
    nameEn: 'Art Nouveau',
    category: 'artistic',
    thumbnail: '/styles/art-nouveau.jpg',
    promptFragment: 'art nouveau, Alphonse Mucha, flowing organic lines, floral ornament, muted gold palette',
    popularity: 57,
  },
  {
    id: 'impressionism',
    name: '印象派',
    nameEn: 'Impressionism',
    category: 'artistic',
    thumbnail: '/styles/impressionism.jpg',
    promptFragment: 'impressionist painting, Monet style, broken brush strokes, dappled sunlight, pastel harmony',
    popularity: 67,
  },
  {
    id: 'surrealism',
    name: '超现实',
    nameEn: 'Surrealism',
    category: 'artistic',
    thumbnail: '/styles/surrealism.jpg',
    promptFragment: 'surrealist painting, Salvador Dali style, dreamlike, impossible geometry, melting shapes',
    popularity: 65,
  },
  {
    id: 'concept-art',
    name: '概念美术',
    nameEn: 'Concept Art',
    category: 'artistic',
    thumbnail: '/styles/concept-art.jpg',
    promptFragment: 'professional concept art, ArtStation trending, dramatic composition, matte painting, epic scale',
    recommendedEngine: 'kling3',
    popularity: 89,
  },
  {
    id: 'storybook',
    name: '绘本',
    nameEn: 'Storybook',
    category: 'artistic',
    thumbnail: '/styles/storybook.jpg',
    promptFragment: 'children storybook illustration, gouache, whimsical, rounded shapes, warm cozy palette',
    popularity: 59,
  },
  {
    id: 'gothic',
    name: '哥特',
    nameEn: 'Gothic',
    category: 'artistic',
    thumbnail: '/styles/gothic.jpg',
    promptFragment: 'gothic art, dark romanticism, cathedral architecture, candlelight, oil on canvas, Caravaggio inspired',
    popularity: 55,
  },

  // ========== RETRO 复古 (12) ==========
  {
    id: 'vhs-80s',
    name: '80s VHS',
    nameEn: '80s VHS',
    category: 'retro',
    thumbnail: '/styles/vhs-80s.jpg',
    promptFragment: '80s VHS aesthetic, scan lines, chromatic aberration, muted colors, analog tape artifacts',
    popularity: 73,
  },
  {
    id: 'hk-90s',
    name: '90s 港片',
    nameEn: '90s Hong Kong Cinema',
    category: 'retro',
    thumbnail: '/styles/hk-90s.jpg',
    promptFragment: '90s Hong Kong cinema, Wong Kar-wai, neon reflection, rainy night, smoky bar, film grain',
    recommendedEngine: 'kling3',
    popularity: 81,
  },
  {
    id: 'film-grain',
    name: '胶片颗粒',
    nameEn: 'Film Grain',
    category: 'retro',
    thumbnail: '/styles/film-grain.jpg',
    promptFragment: 'analog film grain, Kodak Portra 400, warm tones, soft contrast, organic imperfection',
    recommendedEngine: 'seedance2',
    popularity: 87,
  },
  {
    id: 'black-white-classic',
    name: '黑白老电影',
    nameEn: 'Classic Black & White',
    category: 'retro',
    thumbnail: '/styles/black-white-classic.jpg',
    promptFragment: 'classic black and white film, 1950s Hollywood, high contrast, dramatic shadow, Orson Welles',
    popularity: 64,
  },
  {
    id: 'super-8',
    name: '超 8 胶片',
    nameEn: 'Super 8',
    category: 'retro',
    thumbnail: '/styles/super-8.jpg',
    promptFragment: 'Super 8 home movie look, warm washed out color, vignetting, dust and scratches, summer memories',
    popularity: 53,
  },
  {
    id: 'polaroid',
    name: '宝丽来',
    nameEn: 'Polaroid',
    category: 'retro',
    thumbnail: '/styles/polaroid.jpg',
    promptFragment: 'Polaroid instant photo, square crop, faded color, white border, soft vignette, nostalgia',
    popularity: 66,
  },
  {
    id: 'art-deco',
    name: 'Art Deco',
    nameEn: 'Art Deco',
    category: 'retro',
    thumbnail: '/styles/art-deco.jpg',
    promptFragment: 'Art Deco 1920s, geometric gold ornament, symmetric composition, Gatsby era luxury',
    popularity: 58,
  },
  {
    id: 'vintage-poster',
    name: '复古海报',
    nameEn: 'Vintage Poster',
    category: 'retro',
    thumbnail: '/styles/vintage-poster.jpg',
    promptFragment: 'vintage travel poster, limited color palette, stylized illustration, WPA style',
    popularity: 61,
  },
  {
    id: 'pulp-comic',
    name: '老漫画',
    nameEn: 'Pulp Comic',
    category: 'retro',
    thumbnail: '/styles/pulp-comic.jpg',
    promptFragment: 'pulp comic book style, halftone dots, bold ink lines, vintage newsprint, 1960s aesthetic',
    popularity: 54,
  },
  {
    id: 'disco-70s',
    name: '70s 迪斯科',
    nameEn: '70s Disco',
    category: 'retro',
    thumbnail: '/styles/disco-70s.jpg',
    promptFragment: '70s disco aesthetic, mirror ball, glittering lights, warm orange and brown palette, funk',
    popularity: 49,
  },
  {
    id: 'ukiyoe',
    name: '浮世绘',
    nameEn: 'Ukiyo-e',
    category: 'retro',
    thumbnail: '/styles/ukiyoe.jpg',
    promptFragment: 'Japanese ukiyo-e woodblock print, Hokusai, flat color areas, bold outlines, traditional pigments',
    popularity: 69,
  },
  {
    id: 'chinese-dynasty',
    name: '古风工笔',
    nameEn: 'Chinese Gongbi',
    category: 'retro',
    thumbnail: '/styles/chinese-dynasty.jpg',
    promptFragment: 'Chinese Tang dynasty gongbi painting, delicate brushwork, mineral pigments, silk scroll',
    recommendedEngine: 'viduq3',
    popularity: 79,
  },

  // ========== EXPERIMENTAL 实验 (12) ==========
  {
    id: 'cyberpunk',
    name: '赛博朋克',
    nameEn: 'Cyberpunk',
    category: 'experimental',
    thumbnail: '/styles/cyberpunk.jpg',
    promptFragment: 'cyberpunk, neon lights, rain soaked streets, holographic signs, Blade Runner 2049, dystopian',
    recommendedEngine: 'seedance2',
    popularity: 99,
  },
  {
    id: 'low-poly',
    name: '低多边形',
    nameEn: 'Low Poly',
    category: 'experimental',
    thumbnail: '/styles/low-poly.jpg',
    promptFragment: 'low poly 3D art, flat shaded triangles, minimalist geometry, pastel gradient',
    popularity: 46,
  },
  {
    id: 'pixel-art',
    name: '像素艺术',
    nameEn: 'Pixel Art',
    category: 'experimental',
    thumbnail: '/styles/pixel-art.jpg',
    promptFragment: '16-bit pixel art, limited palette, SNES aesthetic, crisp pixels, dithering',
    popularity: 72,
  },
  {
    id: 'glitch',
    name: '故障艺术',
    nameEn: 'Glitch Art',
    category: 'experimental',
    thumbnail: '/styles/glitch.jpg',
    promptFragment: 'glitch art, datamoshing, RGB split, corrupted pixels, digital decay, vaporwave',
    popularity: 60,
  },
  {
    id: 'psychedelic',
    name: '迷幻',
    nameEn: 'Psychedelic',
    category: 'experimental',
    thumbnail: '/styles/psychedelic.jpg',
    promptFragment: 'psychedelic, kaleidoscope patterns, neon rainbow, fractal, 60s trippy art',
    popularity: 52,
  },
  {
    id: 'vaporwave',
    name: '蒸汽波',
    nameEn: 'Vaporwave',
    category: 'experimental',
    thumbnail: '/styles/vaporwave.jpg',
    promptFragment: 'vaporwave aesthetic, pink and cyan gradient, roman statue, grid floor, 80s nostalgia',
    popularity: 68,
  },
  {
    id: 'synthwave',
    name: '合成波',
    nameEn: 'Synthwave',
    category: 'experimental',
    thumbnail: '/styles/synthwave.jpg',
    promptFragment: 'synthwave, retrofuturism, neon grid, chrome text, purple pink sunset, 80s sci-fi',
    recommendedEngine: 'seedance2',
    popularity: 76,
  },
  {
    id: 'biopunk',
    name: '生物朋克',
    nameEn: 'Biopunk',
    category: 'experimental',
    thumbnail: '/styles/biopunk.jpg',
    promptFragment: 'biopunk, organic machinery, bioluminescent, wet surfaces, alien body horror, Cronenberg',
    popularity: 47,
  },
  {
    id: 'steampunk',
    name: '蒸汽朋克',
    nameEn: 'Steampunk',
    category: 'experimental',
    thumbnail: '/styles/steampunk.jpg',
    promptFragment: 'steampunk, brass gears, Victorian era, steam powered machines, gaslight, airships',
    popularity: 70,
  },
  {
    id: 'solarpunk',
    name: '太阳朋克',
    nameEn: 'Solarpunk',
    category: 'experimental',
    thumbnail: '/styles/solarpunk.jpg',
    promptFragment: 'solarpunk utopia, lush greenery, clean architecture, solar panels, optimistic bright palette',
    popularity: 55,
  },
  {
    id: 'abstract',
    name: '抽象',
    nameEn: 'Abstract',
    category: 'experimental',
    thumbnail: '/styles/abstract.jpg',
    promptFragment: 'abstract art, non-representational, bold color fields, geometric composition, Kandinsky',
    popularity: 43,
  },
  {
    id: 'afrofuturism',
    name: '非洲未来主义',
    nameEn: 'Afrofuturism',
    category: 'experimental',
    thumbnail: '/styles/afrofuturism.jpg',
    promptFragment: 'afrofuturism, tribal patterns meets sci-fi, gold and indigo, cosmic imagery, Wakanda inspired',
    popularity: 50,
  },
];

// 静态校验：确保恰好 60 条，每类 12 条（开发期断言，打包后 tree-shake）
if (process.env.NODE_ENV !== 'production') {
  const total = STYLE_PRESETS.length;
  if (total !== 60) {
    console.warn(`[style-presets] expected 60 styles, got ${total}`);
  }
  const byCategory = STYLE_PRESETS.reduce<Record<string, number>>((acc, s) => {
    acc[s.category] = (acc[s.category] ?? 0) + 1;
    return acc;
  }, {});
  for (const cat of ['realistic', 'anime', 'artistic', 'retro', 'experimental'] as const) {
    if (byCategory[cat] !== 12) {
      console.warn(`[style-presets] category "${cat}" should have 12 styles, got ${byCategory[cat] ?? 0}`);
    }
  }
  // id 去重检查
  const ids = new Set<string>();
  for (const s of STYLE_PRESETS) {
    if (ids.has(s.id)) console.warn(`[style-presets] duplicate id: ${s.id}`);
    ids.add(s.id);
  }
}

// ============ 便捷查询函数 ============

export function getStyleById(id: string): StylePreset | undefined {
  return STYLE_PRESETS.find(s => s.id === id);
}

export function getStylesByCategory(category: StylePreset['category']): StylePreset[] {
  return STYLE_PRESETS.filter(s => s.category === category);
}

/** 按流行度降序返回，可选 limit */
export function getPopularStyles(limit?: number): StylePreset[] {
  const sorted = [...STYLE_PRESETS].sort((a, b) => b.popularity - a.popularity);
  return limit ? sorted.slice(0, limit) : sorted;
}

/** 拼接风格 prompt 片段到用户 prompt 尾部 */
export function applyStyleToPrompt(basePrompt: string, styleId?: string): string {
  if (!styleId) return basePrompt;
  const style = getStyleById(styleId);
  if (!style) return basePrompt;
  return `${basePrompt}, ${style.promptFragment}`;
}

/** 获取风格的负面 prompt（如果有） */
export function getStyleNegativePrompt(styleId?: string): string | undefined {
  if (!styleId) return undefined;
  return getStyleById(styleId)?.negativePrompt;
}

/** 获取风格推荐的视频引擎（如果有） */
export function getStyleRecommendedEngine(styleId?: string) {
  if (!styleId) return undefined;
  return getStyleById(styleId)?.recommendedEngine;
}
