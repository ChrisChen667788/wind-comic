import { API_CONFIG } from '@/lib/config';

export interface TTSOptions {
  voiceId?: string;
  speed?: number;
  volume?: number;
  pitch?: number;
  emotion?: string;
}

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

const VOICE_PROFILES: Record<string, VoiceProfile> = {
  narrator_male_cn: { voiceId: 'narrator_male_cn', speed: 1.0, vol: 1.0, pitch: 0 },
  narrator_female_cn: { voiceId: 'narrator_female_cn', speed: 1.0, vol: 1.0, pitch: 0 },
  young_male_cn: { voiceId: 'young_male_cn', speed: 1.1, vol: 1.0, pitch: 2 },
  young_female_cn: { voiceId: 'young_female_cn', speed: 1.05, vol: 1.0, pitch: 3 },
};

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
   * Deterministically assign a voice to a character based on their name.
   * Returns one of the 4 default voice IDs.
   */
  assignVoiceToCharacter(characterName: string): string {
    const voices = Object.values(DEFAULT_VOICES);
    // Simple hash: sum of char codes mod number of voices
    let hash = 0;
    for (let i = 0; i < characterName.length; i++) {
      hash += characterName.charCodeAt(i);
    }
    return voices[hash % voices.length];
  }

  /**
   * Generate a single TTS voiceover from text using MiniMax T2A API.
   */
  async generateVoiceover(text: string, options?: TTSOptions): Promise<TTSResult> {
    if (!text.trim()) {
      return { audioUrl: '', duration: 0, subtitle: [] };
    }

    const voiceId = options?.voiceId || DEFAULT_VOICES.narrator_male;
    const profile = VOICE_PROFILES[voiceId] || VOICE_PROFILES[DEFAULT_VOICES.narrator_male];

    // v2.12 Sprint C.4: 与 minimax.service.ts 对齐 — 默认 speech-2.8-hd, 可被 env 覆盖
    const body: Record<string, any> = {
      model: process.env.MINIMAX_TTS_MODEL || 'speech-2.8-hd',
      text,
      voice_setting: {
        voice_id: voiceId,
        speed: options?.speed ?? profile.speed,
        vol: options?.volume ?? profile.vol,
        pitch: options?.pitch ?? profile.pitch,
        ...(options?.emotion && { emotion: options.emotion }),
      },
      audio_setting: {
        sample_rate: 32000,
        bitrate: 128000,
        format: 'mp3',
      },
    };

    console.log(`[TTS] Generating voiceover for: "${text.slice(0, 50)}..." voice=${voiceId}`);

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
