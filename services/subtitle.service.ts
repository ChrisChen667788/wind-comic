import { Script } from '@/types/agents';
import { SubtitleEntry } from './tts.service';

export interface SubtitleTrack {
  entries: SubtitleEntry[];
  format: 'srt' | 'vtt';
}

// Format seconds as SRT timestamp: HH:MM:SS,mmm
function toSRTTimestamp(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  const ms = Math.round((seconds - Math.floor(seconds)) * 1000);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')},${String(ms).padStart(3, '0')}`;
}

// Format seconds as VTT timestamp: HH:MM:SS.mmm
function toVTTTimestamp(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  const ms = Math.round((seconds - Math.floor(seconds)) * 1000);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(ms).padStart(3, '0')}`;
}

// Estimate reading duration for a dialogue line (chars/sec for Chinese ≈ 4)
function estimateLineDuration(text: string, shotDuration: number): number {
  if (!text) return 0;
  const chineseChars = (text.match(/[\u4e00-\u9fa5]/g) || []).length;
  const otherChars = text.length - chineseChars;
  const estimated = chineseChars / 4 + otherChars / 10;
  // Clamp to at most 80% of the shot's duration so it doesn't overflow
  return Math.min(estimated, shotDuration * 0.8);
}

export class SubtitleService {
  /**
   * Generate a timed subtitle track from a script and per-shot durations.
   * Each shot's dialogue is placed in the middle of the shot's time window.
   */
  generateSubtitles(script: Script, shotDurations: number[]): SubtitleTrack {
    const entries: SubtitleEntry[] = [];
    const shots = script.shots || [];

    let currentTime = 0;

    for (let i = 0; i < shots.length; i++) {
      const shot = shots[i];
      const shotDuration = shotDurations[i] ?? 8; // default 8s per shot

      const dialogue = shot.dialogue?.trim();
      if (dialogue) {
        const lineDuration = estimateLineDuration(dialogue, shotDuration);
        // Place subtitle at 20% into the shot, leaving some breathing room
        const startOffset = shotDuration * 0.2;
        const entryStart = currentTime + startOffset;
        const entryEnd = Math.min(entryStart + lineDuration, currentTime + shotDuration - 0.2);

        const character = shot.characters?.[0];
        entries.push({
          start: Math.round(entryStart * 1000) / 1000,
          end: Math.round(entryEnd * 1000) / 1000,
          text: dialogue,
          character,
        });
      }

      currentTime += shotDuration;
    }

    return { entries, format: 'srt' };
  }

  /**
   * Convert a SubtitleTrack to SRT format string.
   */
  toSRT(track: SubtitleTrack): string {
    if (!track.entries.length) return '';

    return track.entries
      .map((entry, index) => {
        const prefix = entry.character ? `${entry.character}: ` : '';
        return [
          `${index + 1}`,
          `${toSRTTimestamp(entry.start)} --> ${toSRTTimestamp(entry.end)}`,
          `${prefix}${entry.text}`,
          '',
        ].join('\n');
      })
      .join('\n');
  }

  /**
   * Convert a SubtitleTrack to WebVTT format string.
   */
  toVTT(track: SubtitleTrack): string {
    const header = 'WEBVTT\n\n';

    if (!track.entries.length) return header;

    const body = track.entries
      .map((entry, index) => {
        const prefix = entry.character ? `<v ${entry.character}>` : '';
        const suffix = entry.character ? '</v>' : '';
        return [
          `cue-${index + 1}`,
          `${toVTTTimestamp(entry.start)} --> ${toVTTTimestamp(entry.end)}`,
          `${prefix}${entry.text}${suffix}`,
          '',
        ].join('\n');
      })
      .join('\n');

    return header + body;
  }
}
