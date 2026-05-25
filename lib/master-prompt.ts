/**
 * lib/master-prompt (v7.7) — Master Prompt Generator + 风格/LUT/导演运镜预设 + 专业术语表
 * (对标 CineMaster Pro「顶级创意生成器 / 风格预设 / 专业术语对照表」)
 *
 * 纯逻辑 + 预设:
 *   - FILM_LOOK_PRESETS / LUT_PRESETS / MOVEMENT_STYLE_PRESETS: 引用真实影片/胶片/导演的可枚举预设
 *   - GLOSSARY: 专业术语对照
 *   - compileMasterPrompt(): 把 role/task/核心概念/执行参数 编译成结构化 master prompt (Markdown)
 */

export interface RefPreset {
  id: string;
  label: string;   // 中文标签
  ref: string;     // 引用的真实影片/导演/胶片
  prompt: string;  // 英文 prompt 片段
}

/** 光影/影调参考 — 引用真实影片 look */
export const FILM_LOOK_PRESETS: RefPreset[] = [
  { id: 'br2049',  label: '赛博霓虹',   ref: 'Blade Runner 2049', prompt: 'Blade Runner 2049 look: neon haze, heavy atmospheric volumetrics, teal-and-orange, brutalist scale' },
  { id: 'dune',    label: '史诗大漠',   ref: 'Dune',              prompt: 'Dune look: vast desaturated desert, monumental scale, soft directional sand light' },
  { id: 'joker',   label: '都市颓废',   ref: 'Joker (2019)',      prompt: 'Joker look: grimy late-70s city, sickly green cast, heavy grain' },
  { id: 'wkw',     label: '王家卫情迷', ref: 'In the Mood for Love', prompt: 'Wong Kar-wai look: saturated reds and greens, step-printed motion blur, neon nostalgia' },
  { id: 'fincher', label: '冷峻悬疑',   ref: 'Se7en / Gone Girl', prompt: 'Fincher look: desaturated cool palette, precise low-key, clinical detail' },
  { id: 'nolan',   label: '宏大写实',   ref: 'Oppenheimer',       prompt: 'Nolan look: large-format naturalistic realism, IMAX clarity, restrained color' },
  { id: 'a24',     label: 'A24 文艺',   ref: 'A24 arthouse',      prompt: 'A24 arthouse look: soft naturalism, muted earthy palette, 35mm grain' },
  { id: 'wes',     label: '韦斯·安德森', ref: 'Wes Anderson',     prompt: 'Wes Anderson look: symmetrical staging, pastel palette, flat frontal framing' },
];

/** 色彩 LUT / 胶片 */
export const LUT_PRESETS: RefPreset[] = [
  { id: 'kodak2383',   label: '柯达印片',   ref: 'Kodak 2383',          prompt: 'Kodak 2383 film print emulation, rich filmic contrast' },
  { id: 'vision3-500t', label: 'Vision3 500T', ref: 'Kodak Vision3 500T', prompt: 'Kodak Vision3 500T tungsten film stock, gentle halation, fine grain' },
  { id: 'fuji-eterna', label: '富士 Eterna', ref: 'Fuji Eterna',         prompt: 'Fuji Eterna soft low-saturation cinematic grade' },
  { id: 'teal-orange', label: '青橙大片',   ref: 'Teal & Orange',       prompt: 'Hollywood teal-and-orange blockbuster grade' },
  { id: 'bleach',      label: '漂白工艺',   ref: 'Bleach Bypass',       prompt: 'bleach bypass, desaturated high-contrast silver retention' },
  { id: 'clean709',    label: '干净写实',   ref: 'Rec.709 clean',       prompt: 'clean neutral Rec.709 grade' },
];

/** 导演运镜风格 */
export const MOVEMENT_STYLE_PRESETS: RefPreset[] = [
  { id: 'villeneuve', label: '维伦纽瓦慢推', ref: 'Denis Villeneuve', prompt: 'Villeneuve slow deliberate push-in, patient pacing, monumental framing' },
  { id: 'spielberg',  label: '斯皮尔伯格长镜', ref: 'Spielberg',      prompt: 'Spielberg flowing oner, motivated continuous camera blocking' },
  { id: 'kubrick',    label: '库布里克对称跟', ref: 'Kubrick',        prompt: 'Kubrick one-point-perspective symmetrical tracking shot' },
  { id: 'fincher-mv', label: '芬奇精准固定', ref: 'Fincher',          prompt: 'Fincher locked precise camera, minimal deliberate motion' },
  { id: 'bay',        label: '迈克尔·贝高能', ref: 'Michael Bay',     prompt: 'high-energy dynamic sweeping camera, heroic low angles' },
  { id: 'handheld',   label: '纪实手持',     ref: 'Paul Greengrass',  prompt: 'documentary urgent reactive handheld camera' },
];

export const GLOSSARY: { term: string; en?: string; def: string }[] = [
  { term: 'PPM', en: 'Pre-Production Meeting', def: '开拍前制片会, 确认分镜/预算/排期的关键节点。' },
  { term: 'VO', en: 'Voice Over', def: '画外音, 广告/叙事常用的旁白手法。' },
  { term: 'Anamorphic Flare', def: '变形宽银幕镜头的横向蓝色光晕, 增加电影感。' },
  { term: 'Rack Focus', def: '移焦, 镜头内焦点从一处转移到另一处, 引导视线。' },
  { term: 'Push In', def: '推镜, 镜头物理推近主体, 强化情绪张力。' },
  { term: 'Key Frame', def: '关键帧, 动作或剪辑的转折点。' },
  { term: 'Match Cut', def: '匹配剪辑, 用相似构图/动作衔接两个镜头。' },
  { term: 'J-Cut / L-Cut', def: '音画错位剪辑, 声音先于或后于画面进入。' },
  { term: 'Establishing Shot', def: '建立镜头, 交代时空环境的大景别开场。' },
  { term: 'Negative Space', def: '负空间, 主体周围留白, 营造孤独感/张力。' },
];

export const getFilmLook = (id: string) => FILM_LOOK_PRESETS.find((p) => p.id === id);
export const getLut = (id: string) => LUT_PRESETS.find((p) => p.id === id);
export const getMovementStyle = (id: string) => MOVEMENT_STYLE_PRESETS.find((p) => p.id === id);

export interface MasterPromptSpec {
  role: string;
  task: string;
  coreConcept: string;
  filmLook: string;      // FILM_LOOK_PRESETS id
  lut: string;           // LUT_PRESETS id
  movementStyle: string; // MOVEMENT_STYLE_PRESETS id
  aspect: string;        // 画幅说明 (freeform, 如 '2.39:1')
  extra: string;         // 额外执行参数 (freeform)
}

export const DEFAULT_MASTER_PROMPT: MasterPromptSpec = {
  role: '顶级广告导演 & 视觉叙事者',
  task: '生成一段电影感分镜序列',
  coreConcept: '',
  filmLook: 'br2049',
  lut: 'vision3-500t',
  movementStyle: 'villeneuve',
  aspect: '2.39:1',
  extra: '',
};

function pickId(list: RefPreset[], v: any, fb: string): string {
  return list.some((p) => p.id === v) ? v : fb;
}
function str(v: any, fb = ''): string {
  return typeof v === 'string' ? v : fb;
}

export function normalizeMasterPrompt(raw: any): MasterPromptSpec {
  const r = raw && typeof raw === 'object' ? raw : {};
  return {
    role: str(r.role, DEFAULT_MASTER_PROMPT.role).slice(0, 200),
    task: str(r.task, DEFAULT_MASTER_PROMPT.task).slice(0, 300),
    coreConcept: str(r.coreConcept).slice(0, 1000),
    filmLook: pickId(FILM_LOOK_PRESETS, r.filmLook, DEFAULT_MASTER_PROMPT.filmLook),
    lut: pickId(LUT_PRESETS, r.lut, DEFAULT_MASTER_PROMPT.lut),
    movementStyle: pickId(MOVEMENT_STYLE_PRESETS, r.movementStyle, DEFAULT_MASTER_PROMPT.movementStyle),
    aspect: str(r.aspect, DEFAULT_MASTER_PROMPT.aspect).slice(0, 40),
    extra: str(r.extra).slice(0, 600),
  };
}

/** 编译成结构化 master prompt (Markdown, 对齐 CineMaster「Master Prompt Generator」) */
export function compileMasterPrompt(spec: MasterPromptSpec): string {
  const s = normalizeMasterPrompt(spec);
  const look = getFilmLook(s.filmLook);
  const lut = getLut(s.lut);
  const mv = getMovementStyle(s.movementStyle);
  const lines = [
    `# Role: ${s.role}`,
    `# Task: ${s.task}`,
    '',
    '## Core Concept',
    s.coreConcept.trim() || '(描述本片的核心创意 / 情绪 / 卖点)',
    '',
    '## Execution Parameters (Must Follow)',
    `1. Visual Style: ${look?.prompt || ''}${look ? ` (ref: ${look.ref})` : ''}`,
    `2. Color / LUT: ${lut?.prompt || ''}${lut ? ` (ref: ${lut.ref})` : ''}`,
    `3. Camera Movement: ${mv?.prompt || ''}${mv ? ` (ref: ${mv.ref})` : ''}`,
    `4. Aspect Ratio: ${s.aspect}`,
  ];
  if (s.extra.trim()) lines.push(`5. Additional: ${s.extra.trim()}`);
  return lines.join('\n');
}

/** 一行中文摘要 */
export function describeMasterPrompt(spec: MasterPromptSpec): string {
  const s = normalizeMasterPrompt(spec);
  return [getFilmLook(s.filmLook)?.label, getLut(s.lut)?.label, getMovementStyle(s.movementStyle)?.label, s.aspect]
    .filter(Boolean).join(' · ');
}
