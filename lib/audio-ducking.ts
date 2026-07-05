/**
 * BGM 自动闪避(ducking,v12.67.0)。
 *
 * 病根:成片 BGM 全程恒定音量(有配音时仅静态降到 0.2),旁白与 BGM 频段打架,人声发闷。
 * 行业标准做法 = sidechain 压缩:旁白响起的瞬间 BGM 自动压低,停顿处自然回升。
 * 本模块产 ffmpeg filter 片段(纯函数,可测):
 *   [vo]asplit=2[vo_sc][vo_mix];[music][vo_sc]sidechaincompress=...[music_ducked]
 * 真正接线在 video-composer(仅 BGM+配音同时存在时启用;BGM_DUCK_DISABLE=1 关闭)。
 */

export interface DuckingPlan {
  filters: string[];
  musicOut: string; // 压低后的 BGM 标签
  voOut: string;    // 供 amix 的配音标签(asplit 复制)
}

/**
 * @param musicLabel 已就绪的 BGM 流标签(如 '[musicvol]')
 * @param voLabel    已就绪的配音流标签(如 '[vomix]' 或 '[vo0]')
 * 参数:threshold 0.02(人声一出即触发)/ ratio 6(压得明显但不突兀)/
 * attack 120ms(入场柔)/ release 600ms(停顿回升自然)/ makeup 1(不额外抬)。
 */
export function buildDuckingFilters(musicLabel: string, voLabel: string): DuckingPlan {
  const filters = [
    `${voLabel}asplit=2[duck_sc][duck_vo]`,
    `${musicLabel}[duck_sc]sidechaincompress=threshold=0.02:ratio=6:attack=120:release=600:makeup=1[duck_music]`,
  ];
  return { filters, musicOut: '[duck_music]', voOut: '[duck_vo]' };
}

/** 是否启用 ducking(纯判定,可测):必须 BGM+配音齐备,且未被 env 关闭。 */
export function shouldDuck(hasMusic: boolean, voCount: number, env: NodeJS.ProcessEnv = process.env): boolean {
  return hasMusic && voCount > 0 && env.BGM_DUCK_DISABLE !== '1';
}

/**
 * v12.110.0 响度归一(纯函数):平台标准 -14 LUFS(抖音/小红书/YouTube 通行),
 * true peak -1.5 dBTP 防削波。成片响度忽大忽小会被平台二次压缩(音质损)或听感突兀。
 * 挂在最终音频标签后;AUDIO_LOUDNORM_DISABLE=1 关。
 */
export function buildLoudnormFilter(inLabel: string, outLabel: string = '[anorm]'): string {
  return `${inLabel}loudnorm=I=-14:TP=-1.5:LRA=11[${outLabel.replace(/^\[|\]$/g, '')}]`;
}

export function shouldLoudnorm(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.AUDIO_LOUDNORM_DISABLE !== '1';
}
