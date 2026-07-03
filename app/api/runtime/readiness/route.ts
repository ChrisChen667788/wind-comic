/**
 * GET /api/runtime/readiness (v10.1.2) — 媒体引擎演示模式就绪度。
 *
 * 聚合各 provider 注册表的 available()(图像/视频/TTS)+ lipSyncEngineConfigured()(口型,
 * v10.1.0 起本地 2D 零配置默认可用)→ computeReadiness → { engines, demoMode, ... }。
 * 仅读 env 经各 provider 的 available() 判定,绝不回传密钥。前端「演示模式」提示消费此端点。
 */
import { NextResponse } from 'next/server';
import { listImageProviders } from '@/lib/image-providers/registry';
import '@/lib/image-providers/builtins'; // 副作用:注册内置图像 provider
import { listVideoProviders } from '@/lib/video-providers/registry';
import '@/lib/video-providers/builtins'; // 副作用:注册内置视频 provider
import { listTTSProviders } from '@/lib/tts-providers/registry';
import '@/lib/tts-providers/builtins'; // 副作用:注册内置 TTS provider
import { lipSyncEngineConfigured } from '@/lib/lipsync-providers';
import { computeReadiness, computeStorageReadiness } from '@/lib/engine-readiness';
import { API_CONFIG } from '@/lib/config';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function anyAvailable(list: Array<{ available: () => boolean }>): boolean {
  return list.some((p) => {
    try {
      return p.available();
    } catch {
      return false;
    }
  });
}

export async function GET() {
  // v10.5.1: LLM 探测与 orchestrator hasLLM 同源语义(含 MOCK_ENGINES 全封闭 = 模板剧本,如实标占位)
  const llm =
    !!API_CONFIG.openai.apiKey &&
    !API_CONFIG.openai.apiKey.startsWith('your_') &&
    process.env.MOCK_ENGINES !== '1';
  const report = computeReadiness({
    llm,
    image: anyAvailable(listImageProviders()),
    video: anyAvailable(listVideoProviders()),
    tts: anyAvailable(listTTSProviders()),
    lipsync: lipSyncEngineConfigured(),
  });
  // v10.4.0: mock 引擎开关回显 —— journey e2e 据此判断 dev server 是否以 MOCK_ENGINES=1 启动
  return NextResponse.json({ ...report, mockEngines: process.env.MOCK_ENGINES === '1', storage: computeStorageReadiness() }); // v12.76 存储就绪度
}
