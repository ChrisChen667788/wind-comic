/**
 * Editor Vision Scorer (v2.11 #4)
 *
 * 成片拼接完成后,由 Editor 对"连贯 / 光影 / 脸相似"三维打分。
 *
 * 流程:
 *   1. 从最终视频等距抽 N 帧 (默认 4 帧,快但有代表性)
 *   2. 把 N 帧一次性喂给 vision LLM,让它按 JSON 结构出分
 *   3. 返回结构化结果,上游调用 insertQualityScore 入库
 *
 * 为什么抽 4 帧而不是 1 帧:
 *   "脸相似" / "光影一致性" 这类指标本质是"跨时间比较",只看单帧必然看不出。
 *   抽 4 帧覆盖开头-三分之一-三分之二-结尾,让模型能对齐对比。
 *
 * 成本:
 *   gpt-4o vision 一次 4 图 ≈ $0.02,远低于用户重生整条片的代价。
 *
 * 失败降级:
 *   任何一步挂就返回 null,Writer 读不到 score 就走默认提示(不会阻塞下一轮创作)。
 */

import OpenAI from 'openai';
import ffmpeg from 'fluent-ffmpeg';
import ffmpegPath from 'ffmpeg-static';
import fs from 'fs';
import path from 'path';
import os from 'os';
import crypto from 'crypto';
import { API_CONFIG } from './config';
import { persistAsset, resolveByKey } from './asset-storage';
import type { QualityScoreDimensions, QualityScoreSuggestions } from './quality-scores';

let ffmpegReady = false;
function ensureFFmpeg() {
  if (ffmpegReady) return;
  const p = (typeof ffmpegPath === 'string' && fs.existsSync(ffmpegPath)) ? ffmpegPath : 'ffmpeg';
  ffmpeg.setFfmpegPath(p);
  ffmpegReady = true;
}

export interface EditorScoreResult extends QualityScoreDimensions {
  narrative: string;            // 一段话总结
  sampleFrames: string[];       // 用来打分的采样帧 URL(持久化)
  suggestions: QualityScoreSuggestions;
}

const SYSTEM_PROMPT = `你是资深的 AI 视频后期导演。用户刚完成一部 AI 生成的短片,给你看了均匀采样的若干关键帧(通常 4 张,按时间先后排列)。
请严格评估三项"跨镜一致性"指标,并给出一段可被下一轮编剧采纳的优化建议:

1. 连贯度 (continuity): 前后帧的场景 / 道具 / 角色位置是否自然衔接?有没有"跳戏"?
2. 光影 (lighting): 整片色温 / 明暗 / 光源方向是否保持一致?有没有刺眼的跳光?
3. 脸相似 (face): 跨帧主角脸是否还是"同一个人"?五官、发型、肤色是否稳定?

评分范围 0-100,判分建议:
  >=85 几乎无可挑剔
  70-84 可用,小瑕疵
  50-69 能看但明显出戏
  <50 严重断裂,建议返工

suggestions 每维写 1-3 条"下一轮编剧应该怎么改"的具体指令(例如 "在主角上场的每一幕复述发型" / "把夜景改为统一侧光")。不要笼统,越具体越好。

严格返回如下 JSON(只输出 JSON,不要 markdown):
{
  "overall": 0-100,
  "continuity": 0-100,
  "lighting": 0-100,
  "face": 0-100,
  "narrative": "一段 80-150 字的总结,客观描述最明显的瑕疵和亮点",
  "suggestions": {
    "continuity": ["..."],
    "lighting": ["..."],
    "face": ["..."]
  }
}`;

/**
 * 从视频 URL 评分。
 *
 * @param videoUrl 最终视频地址(http/ api/serve-file / 本地路径均可)
 * @param sampleCount 采样帧数(默认 4)
 * @returns 评分结果,失败 null
 */
export async function scoreFinalVideo(
  videoUrl: string,
  sampleCount = 4,
): Promise<EditorScoreResult | null> {
  if (!videoUrl) return null;
  if (!API_CONFIG.openai.apiKey) {
    console.warn('[EditorScore] OPENAI_API_KEY missing');
    return null;
  }

  // 1) 抽 N 帧
  const frames = await sampleFrames(videoUrl, sampleCount);
  if (!frames || frames.length === 0) {
    console.warn('[EditorScore] no frames sampled');
    return null;
  }

  // 2) 把本地帧转成 vision 能消费的 data URI
  const visionInputs = frames
    .map((f) => localPathToDataUri(f.absPath))
    .filter((x): x is string => !!x);
  if (visionInputs.length === 0) return null;

  // 3) 喂给 vision LLM
  const client = new OpenAI({
    apiKey: API_CONFIG.openai.apiKey,
    baseURL: API_CONFIG.openai.baseURL,
  });

  try {
    const resp = await client.chat.completions.create({
      model: API_CONFIG.openai.model,
      temperature: 0.3,
      response_format: { type: 'json_object' },
      max_tokens: 900,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        {
          role: 'user',
          content: [
            { type: 'text', text: `以下是一部 AI 视频按时间顺序采样的 ${visionInputs.length} 张关键帧,请按照 system 的 JSON 结构评估。` },
            ...visionInputs.map((url) => ({
              type: 'image_url' as const,
              image_url: { url },
            })),
          ],
        },
      ],
    });

    const raw = resp.choices?.[0]?.message?.content?.toString().trim();
    if (!raw) return null;
    const parsed = safeParseJson(raw);
    if (!parsed) return null;

    // 4) 把抽帧持久化(存为 sample_frames),这样历史评分里能看到基准素材
    const persistedUrls: string[] = [];
    for (const f of frames) {
      try {
        const p = await persistAsset(f.absPath, { contentType: 'image/jpeg', ext: '.jpg' });
        if (p?.url) persistedUrls.push(p.url);
      } catch {
        // 单帧失败不致命,继续
      }
    }

    return normalizeResult(parsed, persistedUrls);
  } catch (e) {
    console.warn('[EditorScore] vision call failed:', e instanceof Error ? e.message : e);
    return null;
  } finally {
    // 清理 tmp 采样帧
    for (const f of frames) {
      try { if (fs.existsSync(f.absPath)) fs.unlinkSync(f.absPath); } catch {}
    }
  }
}

// ─────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────

interface SampledFrame {
  absPath: string;
  t: number;
}

/**
 * 从视频均匀抽 N 帧 (t=0 到 t=duration 的 [1..N]/N+1)。
 * 返回本地 tmp 文件路径数组,上游自行清理。
 */
async function sampleFrames(videoUrl: string, n: number): Promise<SampledFrame[]> {
  ensureFFmpeg();

  // 1) 源视频落本地
  const tmpIn = path.join(os.tmpdir(), `editor-src-${crypto.randomBytes(6).toString('hex')}.mp4`);
  const downloaded = await materializeVideo(videoUrl, tmpIn);
  if (!downloaded) return [];

  try {
    const duration = await getDurationSeconds(tmpIn).catch(() => 0);
    if (!duration || duration <= 0) return [];

    // 2) 选 N 个等距时间点,避开头 0.1s 和尾 0.1s
    const times: number[] = [];
    for (let i = 1; i <= n; i++) {
      const t = (duration * i) / (n + 1);
      times.push(Math.max(0.1, Math.min(duration - 0.1, t)));
    }

    // 3) 串行抽帧(并行可能撞 ffmpeg 进程数上限)
    const out: SampledFrame[] = [];
    for (const t of times) {
      const outPath = path.join(os.tmpdir(), `editor-frame-${crypto.randomBytes(6).toString('hex')}.jpg`);
      try {
        await new Promise<void>((resolve, reject) => {
          ffmpeg(tmpIn)
            .seekInput(t)
            .frames(1)
            .outputOptions(['-q:v 3'])
            .output(outPath)
            .on('end', () => resolve())
            .on('error', (e) => reject(e))
            .run();
        });
        if (fs.existsSync(outPath) && fs.statSync(outPath).size > 512) {
          out.push({ absPath: outPath, t });
        } else {
          try { fs.unlinkSync(outPath); } catch {}
        }
      } catch (e) {
        console.warn(`[EditorScore] sample frame at t=${t.toFixed(2)} failed:`, e instanceof Error ? e.message : e);
      }
    }
    return out;
  } finally {
    try { if (fs.existsSync(tmpIn)) fs.unlinkSync(tmpIn); } catch {}
  }
}

/** 把各种 videoUrl 形式写入到本地 tmpIn,成功返回 true */
async function materializeVideo(videoUrl: string, tmpIn: string): Promise<boolean> {
  try {
    if (videoUrl.startsWith('http://') || videoUrl.startsWith('https://')) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 120_000);
      const resp = await fetch(videoUrl, { signal: controller.signal });
      clearTimeout(timer);
      if (!resp.ok) return false;
      const buf = Buffer.from(await resp.arrayBuffer());
      fs.writeFileSync(tmpIn, buf);
      return true;
    }
    if (videoUrl.startsWith('/api/serve-file')) {
      const u = new URL(videoUrl, 'http://localhost');
      const key = u.searchParams.get('key');
      const p = u.searchParams.get('path');
      if (key) {
        const r = resolveByKey(key);
        if (!r) return false;
        fs.copyFileSync(r.absPath, tmpIn);
        return true;
      }
      if (p && fs.existsSync(p)) {
        fs.copyFileSync(p, tmpIn);
        return true;
      }
      return false;
    }
    if (fs.existsSync(videoUrl)) {
      fs.copyFileSync(videoUrl, tmpIn);
      return true;
    }
    return false;
  } catch (e) {
    console.warn('[EditorScore] materialize failed:', e instanceof Error ? e.message : e);
    return false;
  }
}

function localPathToDataUri(p: string): string | null {
  try {
    if (!fs.existsSync(p)) return null;
    const buf = fs.readFileSync(p);
    return `data:image/jpeg;base64,${buf.toString('base64')}`;
  } catch {
    return null;
  }
}

function getDurationSeconds(filePath: string): Promise<number> {
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(filePath, (err, data) => {
      if (err) return reject(err);
      const d = Number(data?.format?.duration ?? 0);
      if (!isFinite(d) || d <= 0) return reject(new Error('invalid duration'));
      resolve(d);
    });
  });
}

function safeParseJson(raw: string): any | null {
  try { return JSON.parse(raw); } catch {
    const m = raw.match(/\{[\s\S]*\}/);
    if (!m) return null;
    try { return JSON.parse(m[0]); } catch { return null; }
  }
}

function normalizeResult(raw: any, sampleFrames: string[]): EditorScoreResult {
  const clamp = (n: unknown, lo = 0, hi = 100) => {
    const v = typeof n === 'number' ? n : Number(n);
    if (!isFinite(v)) return 0;
    return Math.max(lo, Math.min(hi, Math.round(v)));
  };
  const arr = (v: unknown) =>
    Array.isArray(v) ? v.filter((s) => typeof s === 'string' && s.trim().length > 0).slice(0, 5) : [];

  const overall = clamp(raw?.overall);
  const continuity = clamp(raw?.continuity);
  const lighting = clamp(raw?.lighting);
  const face = clamp(raw?.face);

  return {
    overall: overall || Math.round((continuity + lighting + face) / 3),
    continuity,
    lighting,
    face,
    narrative: typeof raw?.narrative === 'string' ? raw.narrative : '',
    sampleFrames,
    suggestions: {
      continuity: arr(raw?.suggestions?.continuity),
      lighting: arr(raw?.suggestions?.lighting),
      face: arr(raw?.suggestions?.face),
    },
  };
}
