/**
 * v10.4.0 — Mock 引擎三件套(确定性假引擎;journey e2e 安全网 / 本地无 key 开发用)。
 *
 * 激活:`MOCK_ENGINES=1`(available() 把关;注册本身常驻 → 不开 env 时零行为变化)。
 * 配合 plugin chain:未显式设 PLUGIN_CHAIN_MODE 时,MOCK_ENGINES=1 隐含 primary
 * (见 lib/plugin-chain-mode.ts)→ registry 成为主路径 → 流水线走「provider 成功路径」:
 * 返回 http URL → 正常入库 → 下游(参考链/口型/导出)可消费;
 * 区别于无 key 时 orchestrator 的 data:URI 占位兜底(会被下游过滤)。
 *
 * 产物由 /api/mock-assets/* 确定性生成(SVG 图 / ffmpeg 纯色短片 / 正弦 WAV):
 * 同 seed 同产物、零外部调用、零成本(estCostCny: 0)。
 */
import { registerImageProvider } from './image-providers/registry';
import { registerVideoProvider } from './video-providers/registry';
import { registerTTSProvider } from './tts-providers/registry';

export function mockEnginesEnabled(): boolean {
  return process.env.MOCK_ENGINES === '1';
}

/** provider 返回的 URL 必须绝对(registry/orchestrator 校验 http 开头) */
export function mockAssetBase(): string {
  const app = (process.env.APP_URL || '').replace(/\/+$/, '');
  if (app) return app;
  return `http://localhost:${process.env.PORT || 3000}`;
}

/** FNV-1a 稳定 hash → 8 位 hex(同输入同产物;不依赖时间/随机) */
export function mockSeed(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ─── Image ────────────────────────────────────────────────────────────────
registerImageProvider({
  id: 'mock-image',
  name: 'Mock Image (deterministic)',
  supportsRefs: true,
  maxRefImages: 8,
  priority: 10, // 抢在所有内置(90+)之前;available() 决定是否真的进 chain
  available: mockEnginesEnabled,
  async generate(input) {
    await delay(60); // 模拟异步引擎,保持调用方时序真实
    const ar = input.aspectRatio || '16:9';
    const seed = mockSeed(`${input.prompt}|${ar}`);
    const label = encodeURIComponent((input.label || input.prompt).slice(0, 40));
    return {
      imageUrl: `${mockAssetBase()}/api/mock-assets/image/${seed}.svg?ar=${encodeURIComponent(ar)}&label=${label}`,
      provider: 'mock-image',
      estCostCny: 0,
    };
  },
});

// ─── Video ────────────────────────────────────────────────────────────────
registerVideoProvider({
  id: 'mock-video',
  name: 'Mock Video (deterministic)',
  priority: 10,
  supportsImage2Video: true,
  supportsText2Video: true,
  supportsLastFrame: true,
  supportsSubjectReference: true,
  maxDurationSec: 15,
  available: mockEnginesEnabled,
  async generate(input) {
    await delay(80);
    input.onProgress?.(50, 'mock 渲染中');
    // 出片上限 4s:journey 求快;durationSec 报实际值
    const dur = Math.min(Math.max(Math.round(input.durationSec || 2), 1), 4);
    const ar = input.aspectRatio || '16:9';
    const seed = mockSeed(`${input.prompt}|${ar}|${dur}`);
    input.onProgress?.(100, 'mock 完成');
    return {
      videoUrl: `${mockAssetBase()}/api/mock-assets/clip/${seed}.mp4?ar=${encodeURIComponent(ar)}&d=${dur}`,
      provider: 'mock-video',
      durationSec: dur,
      estCostCny: 0,
    };
  },
});

// ─── TTS ──────────────────────────────────────────────────────────────────
registerTTSProvider({
  id: 'mock-tts',
  name: 'Mock TTS (deterministic)',
  priority: 10,
  supportsEmotion: true,
  supportsCloning: false,
  supportsStreaming: false,
  maxTextLen: 5000,
  supportedLanguages: [], // 空 = 任何语言
  available: mockEnginesEnabled,
  async generate(input) {
    await delay(40);
    const dur = Math.max(1, Math.round((input.text.length / 4) * 10) / 10); // 中文 ~4 字/秒
    // v10.6.4: 种子带 prosody —— 改情绪标签重录(speed/pitch 变)产物 URL 随之不同
    const seed = mockSeed(`${input.text}|${input.voiceId}|${input.speed ?? ''}|${input.pitch ?? ''}`);
    return {
      audioUrl: `${mockAssetBase()}/api/mock-assets/voice/${seed}.wav?d=${dur}`,
      duration: dur,
      subtitle: [{ start: 0, end: dur, text: input.text, character: input.character }],
      provider: 'mock-tts',
      estCostCny: 0,
    };
  },
});
