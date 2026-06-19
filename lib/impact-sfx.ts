/**
 * 打击音效层(阶段二十五 · v12.13.1 「劲爆度第二波」)
 *
 * 痛点:打斗成片只有 BGM + 配音,没有「拳拳到肉」的冲击音 —— 而动作片的「劲」一半在音效。
 * 真实 SFX 素材需联网下载(受限),故本模块用 ffmpeg **程序化合成**闷响打击音:
 *   pink 噪声 → 低通(取 body)→ 指数快衰减(脆)→ 定位到冲击时间点。零素材、零下载。
 *
 * 设计:纯函数,只产「冲击时间点」与「ffmpeg filter_complex 源节点字符串」,
 * 真正混音在 video-composer(末端独立 amix,normalize=0 不动既有 BGM/配音平衡)。
 */

/** 冲击动词(中英)—— beat.action/audio 命中即视为一记打击。 */
export const IMPACT_VERBS_RE =
  /砸|击中|打中|命中|撞|踢中|踹|拳|肘击|膝撞|劈|斩|刺中|捶|轰|顶飞|甩出|重击|crash|impact|hit|punch|kick|slam|strike|smash|clash|blow|thud/i;

export interface ImpactCue {
  /** 所属镜号 */
  shotNumber: number;
  /** 冲击点在该镜「设计时长」坐标系内的秒数(裁切后片段即 0..designed) */
  atSec: number;
  /** 强度 0..1 —— speedRamp 标注的冲击更强,纯动词命中次之 */
  intensity: number;
}

interface BeatLike { startSec?: number; endSec?: number; action?: string; audio?: string; speedRamp?: string }
interface ShotLike { shotNumber: number; duration?: number; beats?: BeatLike[] }

/**
 * 从剧本逐 beat 找「冲击点」:beat 标了 speedRamp(慢镜常落在受击帧)或 action/audio 含冲击动词。
 * atSec 取 beat 中点(若无时间码则 0)。每镜最多取 3 个冲击点(防密集噪声)。
 */
export function findImpactCues(shots: ShotLike[]): ImpactCue[] {
  const cues: ImpactCue[] = [];
  for (const s of shots || []) {
    let perShot = 0;
    for (const b of s.beats || []) {
      const hasSpeed = !!(b.speedRamp && /slow|0\.\d+x|impact|慢|insert/i.test(b.speedRamp));
      const hasVerb = IMPACT_VERBS_RE.test(`${b.action || ''} ${b.audio || ''}`);
      if (!hasSpeed && !hasVerb) continue;
      const atSec = (typeof b.startSec === 'number' && typeof b.endSec === 'number')
        ? (b.startSec + b.endSec) / 2
        : (typeof b.startSec === 'number' ? b.startSec : 0);
      cues.push({ shotNumber: s.shotNumber, atSec, intensity: hasSpeed ? 1.0 : 0.7 });
      if (++perShot >= 3) break;
    }
  }
  return cues;
}

/** 镜号 → 是否含冲击点(供「选择性 impact 慢镜」用)。 */
export function impactShotSet(cues: ImpactCue[]): Set<number> {
  return new Set(cues.map((c) => c.shotNumber));
}

/**
 * 合成一记「闷响打击」的 ffmpeg filter_complex 源节点字符串,定位到 absMs 毫秒、输出 [label]。
 * pink 噪声 + 低通 250Hz(取闷响 body)+ 180ms 指数衰减(脆)+ 强度调音量 + adelay 定位。
 * 纯字符串拼装,单测锁语法。
 */
export function impactSfxNode(absMs: number, intensity: number, label: string): string {
  const dur = 0.18;
  const amp = (0.7 + 0.25 * clamp01(intensity)).toFixed(2);      // 噪声振幅 0.7..0.95
  const vol = (0.55 + 0.5 * clamp01(intensity)).toFixed(2);       // 音量 0.55..1.05
  const ms = Math.max(0, Math.round(absMs));
  return `anoisesrc=d=${dur}:c=pink:r=44100:a=${amp},lowpass=f=250,afade=t=out:st=0:d=${dur}:curve=exp,aformat=sample_rates=44100:channel_layouts=stereo,volume=${vol},adelay=${ms}|${ms}[${label}]`;
}

function clamp01(x: number): number {
  return Math.max(0, Math.min(1, Number.isFinite(x) ? x : 0));
}
