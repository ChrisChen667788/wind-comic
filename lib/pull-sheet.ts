/**
 * lib/pull-sheet (v11.1.0) — 拉片表纯函数核心(阶段十九 · 拉片复刻 第一块地基)。
 *
 * 「拉片」= 把一部片逐镜拆成结构化五栏:叙事要素 / 时间 / 镜头语言 / 影像处理 / 声音。
 * 本项目的独特优势是**出厂参数**:自家流水线生成时就持有全部真实摄影参数
 * (ScriptShot v2.8 字段),拉自家项目的表是真值、零生成成本 —— 不用 AI 看图猜。
 *
 * PullSheet schema 同时是阶段十九全链的统一数据结构:
 *   v11.1.0 自家项目真值表(source='factory')
 *   v11.1.1 外部视频:ffmpeg 切分骨架(source='skeleton')/ Vision 打标(source='vision')
 *   v11.1.2 替换+复刻:以本结构为底改写逐镜 prompt
 *
 * 纯函数、零 LLM、零 IO;缺字段如实留空(UI 显示 —),不编造。
 */

export type PullSheetSource = 'factory' | 'vision' | 'skeleton';

export interface PullSheetShot {
  shotNumber: number;
  /** 缩略图(分镜图优先)与可播放视频 */
  thumbnail: string | null;
  videoUrl: string | null;
  /** 镜头内容一句话(画面描述/动作) */
  description: string;

  // ── 叙事要素 ──
  scene: string;
  characters: string[];
  dialogue: string;

  // ── 时间(秒,起止按 duration 累计) ──
  durationSec: number;
  startSec: number;
  endSec: number;

  // ── 镜头语言 ──
  shotSize: string;        // 景别
  composition: string;     // 构图
  cameraAngle: string;     // 机位角度
  cameraMovement: string;  // 运镜方法
  lens: string;            // 焦距与景深

  // ── 影像处理 ──
  lightingIntent: string;  // 光影与色调
  editPattern: string;     // 剪辑

  // ── 声音 ──
  scoreMood: string;       // 音乐情绪
  soundDesign: string;     // 音效设计
  diegeticSound: string;   // 环境声

  // ── 叙事功能 ──
  storyBeat: string;       // 分镜功能(叙事节拍)
  whyThisChoice: string;   // 镜头叙事功能(为什么这么拍)

  source: PullSheetSource;
}

export interface PullSheet {
  title: string;
  shotCount: number;
  totalDurationSec: number;
  source: PullSheetSource;
  shots: PullSheetShot[];
}

interface MediaRef {
  shotNumber: number;
  url: string;
}

const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');

/**
 * 自家项目真值表:script.shots(权威 ScriptShot,兼容演示工程的
 * 单数 character / description 字段形)× 分镜图/视频资产 → PullSheet。
 */
export function buildPullSheetFromScript(
  script: { title?: string; shots?: any[] },
  media?: { storyboards?: MediaRef[]; videos?: MediaRef[] },
): PullSheet {
  const shots = Array.isArray(script?.shots) ? script.shots : [];
  const sbByShot = new Map((media?.storyboards || []).map((m) => [m.shotNumber, m.url]));
  const vByShot = new Map((media?.videos || []).map((m) => [m.shotNumber, m.url]));

  let t = 0;
  const rows: PullSheetShot[] = shots
    .filter((s: any) => typeof s?.shotNumber === 'number')
    .map((s: any) => {
      const durationSec = typeof s.duration === 'number' && s.duration > 0 ? s.duration : 5;
      const startSec = t;
      t += durationSec;
      return {
        shotNumber: s.shotNumber,
        thumbnail: sbByShot.get(s.shotNumber) ?? null,
        videoUrl: vByShot.get(s.shotNumber) ?? null,
        description: str(s.sceneDescription) || str(s.description) || str(s.action),
        scene: str(s.scene) || str(s.sceneId),
        characters: Array.isArray(s.characters)
          ? s.characters.map((c: unknown) => str(c)).filter(Boolean)
          : str(s.character) ? [str(s.character)] : [],
        dialogue: str(s.dialogue),
        durationSec,
        startSec,
        endSec: t,
        shotSize: str(s.shotSize),
        composition: str(s.composition),
        cameraAngle: str(s.cameraAngle),
        cameraMovement: str(s.cameraMovement) || str(s.cameraWork),
        lens: str(s.lens),
        lightingIntent: str(s.lightingIntent),
        editPattern: str(s.editPattern),
        scoreMood: str(s.scoreMood),
        soundDesign: str(s.soundDesign),
        diegeticSound: str(s.diegeticSound),
        storyBeat: str(s.storyBeat) || str(s.beat),
        whyThisChoice: str(s.whyThisChoice),
        source: 'factory' as const,
      };
    });

  return {
    title: str(script?.title) || '未命名',
    shotCount: rows.length,
    totalDurationSec: t,
    source: 'factory',
    shots: rows,
  };
}

/** 五栏列定义(CSV 表头与 UI 共用;顺序即截图五栏的语义顺序)。 */
export const PULL_SHEET_COLUMNS: Array<{ key: keyof PullSheetShot; label: string; group: string }> = [
  { key: 'shotNumber', label: '镜头', group: '' },
  { key: 'description', label: '画面内容', group: '' },
  { key: 'scene', label: '场景', group: '叙事要素' },
  { key: 'characters', label: '角色', group: '叙事要素' },
  { key: 'dialogue', label: '台词对白', group: '叙事要素' },
  { key: 'durationSec', label: '时长(s)', group: '时间' },
  { key: 'startSec', label: '开始(s)', group: '时间' },
  { key: 'endSec', label: '结束(s)', group: '时间' },
  { key: 'shotSize', label: '景别', group: '镜头语言' },
  { key: 'composition', label: '构图', group: '镜头语言' },
  { key: 'cameraAngle', label: '机位角度', group: '镜头语言' },
  { key: 'cameraMovement', label: '运镜方法', group: '镜头语言' },
  { key: 'lens', label: '焦距与景深', group: '镜头语言' },
  { key: 'lightingIntent', label: '光影与色调', group: '影像处理' },
  { key: 'editPattern', label: '剪辑', group: '影像处理' },
  { key: 'scoreMood', label: '音乐情绪', group: '声音' },
  { key: 'soundDesign', label: '音效设计', group: '声音' },
  { key: 'diegeticSound', label: '环境声', group: '声音' },
  { key: 'storyBeat', label: '分镜功能', group: '叙事功能' },
  { key: 'whyThisChoice', label: '镜头叙事功能', group: '叙事功能' },
];

/** Vision 打标可写字段白名单(单帧可判维度;声音列单帧无声,不让 LLM 编) */
const VISION_LABEL_KEYS = [
  'description', 'scene', 'shotSize', 'composition', 'cameraAngle', 'lens', 'lightingIntent',
] as const;

/**
 * Vision 打标结果校验(纯函数):只收白名单字符串字段,trim + 截断 200 字;
 * characters 数组单独校验。LLM 输出越界字段一律丢弃 —— 不编造、不溢出 schema。
 */
export function validateVisionLabel(raw: unknown): Partial<PullSheetShot> {
  if (!raw || typeof raw !== 'object') return {};
  const r = raw as Record<string, unknown>;
  const out: Partial<PullSheetShot> = {};
  for (const k of VISION_LABEL_KEYS) {
    const v = r[k];
    if (typeof v === 'string' && v.trim()) (out as any)[k] = v.trim().slice(0, 200);
  }
  if (Array.isArray(r.characters)) {
    const cs = r.characters.filter((c) => typeof c === 'string' && c.trim()).map((c) => String(c).trim().slice(0, 40));
    if (cs.length) out.characters = cs.slice(0, 8);
  }
  return out;
}

function csvCell(v: unknown): string {
  const s = Array.isArray(v) ? v.join('、') : v == null ? '' : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** CSV 导出(带 BOM,Excel 直接打开中文不乱码)。 */
export function toPullSheetCsv(sheet: PullSheet): string {
  const header = PULL_SHEET_COLUMNS.map((c) => csvCell(c.group ? `${c.group} · ${c.label}` : c.label)).join(',');
  const lines = sheet.shots.map((s) =>
    PULL_SHEET_COLUMNS.map((c) => csvCell(s[c.key])).join(','),
  );
  return '\uFEFF' + [header, ...lines].join('\r\n');
}
