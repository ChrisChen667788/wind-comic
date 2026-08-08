import { API_CONFIG } from '@/lib/config';
import { emotionToMinimaxEmotion } from '@/lib/emotion-tag';
import { voiceForLanguage } from '@/lib/tts-voice-map';
import { VOICE_CATALOG, pickVoiceForCharacter } from '@/lib/character-studio';

export interface TTSOptions {
  voiceId?: string;
  speed?: number;
  volume?: number;
  pitch?: number;
  emotion?: string;
  /** v12.168:TTS 语种码('ja-JP' 等)→ MiniMax language_boost,配音即该语种 */
  language?: string;
}

// v12.168:ttsCode → MiniMax t2a_v2 language_boost 枚举名
const LANGUAGE_BOOST: Record<string, string> = {
  'zh-CN': 'Chinese', 'en-US': 'English', 'ja-JP': 'Japanese', 'ko-KR': 'Korean',
  'ru-RU': 'Russian', 'es-ES': 'Spanish', 'fr-FR': 'French', 'de-DE': 'German', 'pt-BR': 'Portuguese',
};

export interface TTSResult {
  audioUrl: string;
  duration: number;
  subtitle: SubtitleEntry[];
}

export interface SubtitleEntry {
  start: number;  // seconds
  end: number;
  text: string;
  character?: string;
}

// Default voice IDs for different character types
const DEFAULT_VOICES = {
  narrator_male: 'narrator_male_cn',
  narrator_female: 'narrator_female_cn',
  young_male: 'young_male_cn',
  young_female: 'young_female_cn',
} as const;

// Voice profiles with TTS parameters
interface VoiceProfile {
  voiceId: string;
  speed: number;
  vol: number;
  pitch: number;
}

/**
 * v12.274:**从 VOICE_CATALOG 派生**,不再手工维护平行表。
 *
 * 病根:v12.229 把目录从 4 扩到 22,这张表却仍是 4 条 —— 另外 18 档全部落进
 * `VOICE_PROFILES[voiceId] || 默认旁白男声` 兜底,导致「俏皮少女」「奶音男孩」
 * 的音色换了但**腔调没换**(speed 1.0 / pitch 0,与成熟男旁白逐字节相同)。
 * 两份表各写各的必然漂移,故改为单一真源:目录带韵律,这里派生。
 * 原 4 档的数值在目录里保持原样(1.0/0、1.0/0、1.1/2、1.05/3),**零回归**。
 */
const VOICE_PROFILES: Record<string, VoiceProfile> = Object.fromEntries(
  VOICE_CATALOG.map((v) => [
    v.id,
    { voiceId: v.id, speed: v.speed ?? 1.0, vol: v.vol ?? 1.0, pitch: v.pitch ?? 0 },
  ]),
);

/**
 * v12.229 —— **修一个一直没人发现的真 bug**:内部音色 id 解析成 MiniMax 真实音色 id。
 *
 * 病根:此前 `voice_id` 把 `narrator_male_cn` / `young_female_cn` 这类**内部别名原样**发给 MiniMax,
 * 而 MiniMax 压根不认 —— live 探测返回 `2054 voice id not exist`,和随手编的假 id 反应一模一样。
 * 也就是说**走 MiniMax 路径时,按角色路由的音色从来没出过声**。
 * 之所以长期没暴露:生产主路径是 vectorengine(priority 50 < minimax 100),MiniMax 只是兜底,
 * 平时轮不到它;一旦 vectorengine 不可用回落 MiniMax,配音就会静默失败。
 *
 * 解析顺序:音色目录里的 `minimax` 字段(逐个 live 探测确认可用)> 已是合法 MiniMax id 则原样透传
 * (克隆音色 / env 配的语种专属音色走这条)> 兜底 presenter_male(探测确认存在)。
 */
export function resolveMinimaxVoiceId(voiceId: string): string {
  const hit = VOICE_CATALOG.find((v) => v.id === voiceId);
  if (hit?.minimax) return hit.minimax;
  // 不在目录里:可能是克隆音色 id 或 env 指定的语种专属音色 —— 原样透传,由 MiniMax 判定
  if (voiceId && !/_cn$/.test(voiceId)) return voiceId;
  return 'presenter_male';
}

// Estimate audio duration from text length (average speaking rate ~4 chars/sec for Chinese)
function estimateDuration(text: string): number {
  const chineseChars = (text.match(/[\u4e00-\u9fa5]/g) || []).length;
  const otherChars = text.length - chineseChars;
  // Chinese: ~4 chars/sec, Other: ~10 chars/sec
  return Math.max(1.0, chineseChars / 4 + otherChars / 10);
}

// Generate subtitle entries from text with timing based on estimated duration
function buildSubtitleEntries(
  text: string,
  startTime: number,
  estimatedDuration: number,
  character?: string
): SubtitleEntry[] {
  if (!text.trim()) return [];

  // Split long text into multiple subtitle entries (max ~15 chars per line for Chinese)
  const maxCharsPerEntry = 20;
  const sentences = text
    .split(/[，。！？；,.!?;]/)
    .map(s => s.trim())
    .filter(s => s.length > 0);

  if (sentences.length <= 1 || text.length <= maxCharsPerEntry) {
    return [{
      start: startTime,
      end: startTime + estimatedDuration,
      text,
      character,
    }];
  }

  const entries: SubtitleEntry[] = [];
  let currentTime = startTime;
  const totalChars = sentences.reduce((sum, s) => sum + s.length, 0) || 1;

  for (const sentence of sentences) {
    const proportion = sentence.length / totalChars;
    const duration = Math.max(0.5, estimatedDuration * proportion);
    entries.push({
      start: currentTime,
      end: currentTime + duration,
      text: sentence,
      character,
    });
    currentTime += duration;
  }

  return entries;
}

export class TTSService {
  private apiKey: string;
  private baseURL: string;

  constructor() {
    this.apiKey = API_CONFIG.minimax.apiKey;
    this.baseURL = API_CONFIG.minimax.baseURL;
  }

  /**
   * 角色 → 音色(v12.287 重做)。
   *
   * 病根:原实现是**在 4 个 DEFAULT_VOICES 里按名字哈希**挑 ——
   *   ① **完全无视性别与年龄**:老年男角可能拿到「青年女声」;
   *   ② 候选池只有 4 个,而 `VOICE_CATALOG` 自 v12.229 起有 **22 档**,
   *      v12.274 还逐档配了专属韵律 —— **其中 18 档在主配音链路上永远轮不到**;
   *   ③ 与建角色时 `pickVoiceForCharacter` 定下的音色**互不相干**,等于那次挑选白做。
   *
   * 现在:有 traits(性别/年龄)→ 复用 `pickVoiceForCharacter`(按性别+年龄打分,与建角色同一口径);
   * 无 traits → 退化为**按性别分池后在全目录内哈希**,至少不再把 22 档砍成 4 档;
   * 性别也未知 → 全目录哈希。确定性不变(同名恒定同音色),只是候选池与匹配质量变了。
   */
  assignVoiceToCharacter(characterName: string, traits?: { gender?: string; ageGroup?: string }): string {
    // 有性别/年龄 → 走与「建角色」同一套挑选,保证前后一致
    if (traits && (traits.gender || traits.ageGroup)) {
      try {
        const pick = pickVoiceForCharacter(traits as any, undefined, characterName); // v12.287:带名字 → 同分散开
        if (pick?.voiceId) return pick.voiceId;
      } catch { /* 落到下方哈希 */ }
    }
    // 无 traits:按性别分池(若知道)后在**全目录**内确定性哈希 —— 而不是只在 4 个默认音色里
    const pool = VOICE_CATALOG.filter((v) => (traits?.gender === 'male' || traits?.gender === 'female')
      ? v.gender === traits.gender
      : true);
    const candidates = (pool.length > 0 ? pool : VOICE_CATALOG).map((v) => v.id);
    if (candidates.length === 0) return DEFAULT_VOICES.narrator_male;
    let hash = 0;
    for (let i = 0; i < characterName.length; i++) hash += characterName.charCodeAt(i);
    return candidates[hash % candidates.length];
  }

  /**
   * Generate a single TTS voiceover from text using MiniMax T2A API.
   */
  async generateVoiceover(text: string, options?: TTSOptions): Promise<TTSResult> {
    if (!text.trim()) {
      return { audioUrl: '', duration: 0, subtitle: [] };
    }

    let voiceId = options?.voiceId || DEFAULT_VOICES.narrator_male;
    // v12.170:语种专属音色(env TTS_VOICE_JA_FEMALE 等配置即换;没配保持原音色 + language_boost)
    const langVoice = options?.language ? voiceForLanguage(options.language, voiceId) : null;
    if (langVoice) voiceId = langVoice;
    const profile = VOICE_PROFILES[voiceId] || VOICE_PROFILES[DEFAULT_VOICES.narrator_male];

    // v12.211:默认升 speech-2.8-hd(支持情感 emotion 枚举,live 探测可用),可被 MINIMAX_TTS_MODEL 覆盖
    const body: Record<string, any> = {
      model: process.env.MINIMAX_TTS_MODEL || 'speech-2.8-hd',
      text,
      voice_setting: {
        // v12.229:内部别名 → MiniMax 真实音色 id(原样下发会得 2054 voice id not exist)
        voice_id: resolveMinimaxVoiceId(voiceId),
        speed: options?.speed ?? profile.speed,
        vol: options?.volume ?? profile.vol,
        pitch: options?.pitch ?? profile.pitch,
        ...(options?.emotion && { emotion: emotionToMinimaxEmotion(options.emotion) }), // v12.211:中文情绪→MiniMax 枚举
      },
      audio_setting: {
        sample_rate: 32000,
        bitrate: 128000,
        format: 'mp3',
      },
    };
    // v12.168:多语配音 —— 目标语种下达 language_boost(此前 body 无语种参数,
    // 日语台词按默认中文语音读,发音失真);未知语种码不传(让模型自动)。
    const boost = options?.language ? LANGUAGE_BOOST[options.language] : undefined;
    if (boost) body.language_boost = boost;

    console.log(`[TTS] Generating voiceover for: "${text.slice(0, 50)}..." voice=${voiceId} lang=${boost || 'auto'}`);

    const response = await fetch(`${this.baseURL}/v1/t2a_v2`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(`MiniMax TTS API error (${response.status}): ${JSON.stringify(data)}`);
    }

    // Extract audio URL from response
    let audioUrl = '';
    if (data.data?.audio?.audio_url) {
      audioUrl = data.data.audio.audio_url;
    } else if (data.audio_url) {
      audioUrl = data.audio_url;
    } else if (data.data?.audio?.data) {
      // Base64 encoded audio
      audioUrl = `data:audio/mp3;base64,${data.data.audio.data}`;
    } else if (data.data?.audio_url) {
      audioUrl = data.data.audio_url;
    } else if (typeof data.data?.audio === 'string' && data.data.audio.length > 0) {
      // v12.211(live 抓获既有缺口):t2a_v2 默认返回 hex 编码音频(data.audio = 十六进制串,
      // 非 URL 非 base64)。此前 generateVoiceover 直调对 hex 一律 "no audio URL";生产走
      // dispatchTTSGenerate 才幸免。转 base64 data URI 补齐,让所有 TTS 路径都能拿到音频。
      audioUrl = `data:audio/mp3;base64,${Buffer.from(data.data.audio, 'hex').toString('base64')}`;
    }

    if (!audioUrl) {
      throw new Error(`MiniMax TTS: no audio URL in response: ${JSON.stringify(data).slice(0, 300)}`);
    }

    // Use actual duration from API if available, otherwise estimate
    const duration = data.data?.audio?.duration
      ?? data.extra_info?.audio_duration
      ?? estimateDuration(text);

    const subtitle = buildSubtitleEntries(text, 0, duration);

    console.log(`[TTS] Generated: duration=${duration.toFixed(2)}s, url=${audioUrl.slice(0, 60)}...`);

    return { audioUrl, duration, subtitle };
  }

  /**
   * Generate TTS voiceovers for multiple dialogues (one per dialogue entry).
   * Each dialogue gets its own voice based on the character name.
   */
  async generateDialogueVoiceovers(
    dialogues: { character: string; text: string }[]
  ): Promise<TTSResult[]> {
    const results: TTSResult[] = [];

    for (const dialogue of dialogues) {
      if (!dialogue.text.trim()) {
        results.push({ audioUrl: '', duration: 0, subtitle: [] });
        continue;
      }

      const voiceId = this.assignVoiceToCharacter(dialogue.character);

      try {
        const result = await this.generateVoiceover(dialogue.text, { voiceId });
        // Attach character name to subtitle entries
        const subtitleWithChar: SubtitleEntry[] = result.subtitle.map(s => ({
          ...s,
          character: dialogue.character,
        }));
        results.push({ ...result, subtitle: subtitleWithChar });
      } catch (e) {
        console.error(`[TTS] Failed for character "${dialogue.character}":`, e);
        // Fallback: return estimated timing without real audio
        const duration = estimateDuration(dialogue.text);
        results.push({
          audioUrl: '',
          duration,
          subtitle: buildSubtitleEntries(dialogue.text, 0, duration, dialogue.character),
        });
      }
    }

    return results;
  }
}
