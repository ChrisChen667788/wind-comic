/**
 * lib/music-providers-builtin.ts — 内置 BGM provider 注册(v12.410)。
 *
 * 顺序即优先级。取舍见 `lib/music-providers.ts` 顶部说明。
 */
import { registerMusicProvider, type MusicRequest } from './music-providers';
// v12.410:必须走 safeFetch —— 它逐跳重验重定向。
// 裸 fetch 默认 redirect:follow,攻击者可用自己控制的公网地址 302 到 169.254.169.254,
// 整道 SSRF 防线被完整绕过(v12.235 的病史)。`MUSIC_SELFHOST_URL` 是用户可配的 URL,
// 正是这条规则要防的形态。
import { safeFetch } from './ssrf-guard';

const clampSec = (s: number | undefined, lo: number, hi: number) =>
  Math.min(hi, Math.max(lo, Math.round(Number(s) || 30)));

/** ① ElevenLabs Music — 官方 API,授权语料商用最干净。$0.15/min。 */
registerMusicProvider({
  id: 'elevenlabs',
  name: 'ElevenLabs Music',
  priority: 10,
  available: () => !!process.env.ELEVENLABS_API_KEY,
  async generate(req: MusicRequest): Promise<string> {
    // 官方字段表(2026-09-03 核):POST /v1/music/compose
    //   prompt(与 composition_plan 互斥)· music_length_ms ∈ [3000, 600000] · model_id · output_format
    const lengthMs = clampSec(req.durationSec, 3, 600) * 1000;
    const body: Record<string, unknown> = {
      prompt: req.style ? `${req.prompt}。风格:${req.style}` : req.prompt,
      music_length_ms: lengthMs,
    };
    if (process.env.ELEVENLABS_MUSIC_MODEL) body.model_id = process.env.ELEVENLABS_MUSIC_MODEL;

    const res = await safeFetch('https://api.elevenlabs.io/v1/music/compose', {
      method: 'POST',
      headers: {
        'xi-api-key': process.env.ELEVENLABS_API_KEY as string,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      throw new Error(`ElevenLabs Music ${res.status}: ${(await res.text()).slice(0, 200)}`);
    }
    // 该端点直接返回音频字节流,不是 JSON —— 落成 data URI 交给上层持久化。
    const buf = Buffer.from(await res.arrayBuffer());
    if (!buf.length) throw new Error('ElevenLabs Music 返回空音频');
    return `data:audio/mpeg;base64,${buf.toString('base64')}`;
  },
});

/**
 * ② 自托管(ACE-Step 1.5 / YuE 等,Apache-2.0 / MIT)。
 * 这是**唯一不会被供应商停服掐死**的一条,也最契合本项目「开源可自托管」的定位。
 * 约定一个最小接口:POST {MUSIC_SELFHOST_URL} { prompt, duration } → { url } 或 { audio_base64 }。
 */
registerMusicProvider({
  id: 'selfhost',
  name: '自托管(ACE-Step / YuE)',
  priority: 20,
  available: () => !!process.env.MUSIC_SELFHOST_URL,
  async generate(req: MusicRequest): Promise<string> {
    const res = await safeFetch(process.env.MUSIC_SELFHOST_URL as string, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        prompt: req.style ? `${req.prompt} (${req.style})` : req.prompt,
        duration: clampSec(req.durationSec, 3, 600),
      }),
    });
    if (!res.ok) throw new Error(`自托管音乐服务 ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const data = await res.json();
    if (data?.url) return data.url as string;
    if (data?.audio_base64) return `data:audio/mpeg;base64,${data.audio_base64}`;
    throw new Error('自托管音乐服务未返回 url 或 audio_base64');
  },
});

/**
 * ③ MiniMax music-2.6 —— **留在链尾**。
 * 它当下对新用户返 410(停服,无预告),但老账号可能仍可用;留着不花成本,
 * 真恢复了也能自动被用上。把它从第一位挪到最后一位,正是本版的要点:
 * 一整项能力不该压在一家供应商身上。
 */
registerMusicProvider({
  id: 'minimax',
  name: 'MiniMax music-2.6',
  priority: 30,
  available: () => !!process.env.MINIMAX_API_KEY,
  async generate(req: MusicRequest): Promise<string> {
    const { MinimaxService } = await import('@/services/minimax.service');
    const url = await new MinimaxService().generateMusic(
      req.prompt,
      req.style ? { style: req.style } : undefined,
    );
    if (!url) throw new Error('MiniMax 未返回音频(music-2.6 已对新用户停服:410 / 2153)');
    return url;
  },
});
