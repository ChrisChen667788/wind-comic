/**
 * 引擎能力边界告知(v12.216.0,纯函数)。
 *
 * 病根:底层模型的硬边界(原生音效不产音/口型无该语种音素/运镜要降画质)只躺在代码注释
 * 和 VERSIONS 里,运营者在面板上看不到 —— 开了 KLING_AUDIO_ENABLED 以为会出声、选了日语
 * 以为有口型,结果静默落空。本模块把 v12.215 真机实测结论变成**上下文触发**的面板提示:
 * 只有当用户的配置/语种真的撞上边界时才显示(零噪音),不撞不打扰。
 * 消费方:/api/api-status(引擎天气条,env 触发)+ 成片体检(env + 项目语种触发)。
 */
import { lipsyncLangCode, isSupportedLanguage, languageDisplayName, type TargetLanguage } from './language-detect';
import { decideLipsyncForLanguage } from './lipsync-language-gate';

export interface CapabilityNote {
  key: string;
  label: string;
  /** warn=运营者显式开了不生效的开关(必须知情);info=诚实降级说明(知情不报警) */
  severity: 'warn' | 'info';
  text: string;
}

/**
 * 按当前 env/语种算出命中的能力边界提示。默认(env 全关 + zh/en)返回空数组。
 * @param opts.language 项目/系统目标语种(触发口型降级说明);不传则跳过语种类提示
 */
export function engineCapabilityNotes(
  opts: { env?: NodeJS.ProcessEnv; language?: string | null } = {},
): CapabilityNote[] {
  const env = opts.env || process.env;
  const notes: CapabilityNote[] = [];

  // ① 原生音效:v12.215 真机 4 次实测(image2video v3/v2.6 + text2video v2.6)——
  //    enable_audio 参数被接受但成片全部无 audio stream(本账号套餐/端点不产原生音效)。
  //    运营者开了这个开关 = 期待出声但不会出 → warn 必须知情。
  if (env.KLING_AUDIO_ENABLED === 'true') {
    notes.push({
      key: 'klingNativeAudio',
      label: '引擎音效',
      severity: 'warn',
      text: '当前 Kling 账号原生音效不可用(v12.215 真机实测:enable_audio 参数被接受但成片无音轨)——成片声音仍走 TTS+BGM 链,该开关不会产生额外效果',
    });
  }

  // ② 口型语种:口型模型仅 zh/en 音素,ja/ko/ru 已诚实降级为 none(错口型比无口型更伤)。
  //    仅当项目语种真的命中时提示(zh/en 不打扰)。
  const lang = (opts.language || '').trim();
  // v12.418:这条提示此前只看语言,而「能不能上口型」现在是 语言 × 装了什么引擎。
  // 装了语种无关引擎时还提示「已降级为无」,就是在报一件已经不成立的事。
  if (lang && isSupportedLanguage(lang)) {
    const d = decideLipsyncForLanguage(lang as TargetLanguage);
    if (!d.enabled) {
      notes.push({
        key: 'lipsyncNone',
        label: '口型同步',
        severity: 'info',
        text: `当前语种(${languageDisplayName(lang as TargetLanguage)})口型模型无对应音素,口型同步已诚实降级为「无」(错口型比无口型更伤观感);可灵 lip-sync 端点仅支持 zh/en 台词(语音需 ≥2s)。**配 SYNC_SO_API_KEY 可解开 ja/ko/ru** —— Sync.so lipsync-2 对齐波形而非音素,不依赖语种`,
      });
    } else if (d.langCode === 'any') {
      notes.push({
        key: 'lipsyncAgnostic',
        label: '口型同步',
        severity: 'info',
        text: `当前语种(${languageDisplayName(lang as TargetLanguage)})本无音素表,但已配置语种无关引擎(Sync.so lipsync-2,对齐波形而非音素)—— 口型同步可用`,
      });
    }
  }

  // ③ 运镜画质权衡:KLING_CAMERA_MODEL 显式启用 = 带运镜的镜降到 v1-5 pro(画质次于 v3)。
  if (env.KLING_CAMERA_MODEL) {
    notes.push({
      key: 'cameraTradeoff',
      label: '运镜控制',
      severity: 'info',
      text: `运镜 camera_control 已启用(${env.KLING_CAMERA_MODEL}):该能力仅 kling-v1-5 pro 支持,带运镜的镜头以画质换运镜(次于 v3)`,
    });
  }

  return notes;
}
