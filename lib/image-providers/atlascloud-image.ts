/** Atlas Cloud asynchronous text-to-image provider. */
import { registerImageProvider } from './registry';
import type { AspectRatio, ImageGenerateInput } from './types';

const DEFAULT_BASE_URL = 'https://api.atlascloud.ai';
const DEFAULT_MODEL = 'bytedance/seedream-v5.0-lite';
const TERMINAL_FAILURES = new Set(['failed', 'timeout', 'canceled']);

type FetchLike = typeof fetch;
type Sleep = (ms: number) => Promise<void>;

interface AtlasCloudDeps {
  fetch?: FetchLike;
  sleep?: Sleep;
  pollIntervalMs?: number;
  pollTimeoutMs?: number;
}

function responseData(payload: unknown): Record<string, unknown> {
  const body = payload as { code?: number; message?: string; msg?: string; data?: unknown };
  if (body?.code != null && body.code !== 0 && body.code !== 200) {
    throw new Error(`Atlas Cloud API error: ${body.message || body.msg || body.code}`);
  }
  const data = body?.data ?? body;
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new Error('Atlas Cloud returned an invalid response');
  }
  return data as Record<string, unknown>;
}

export function atlasCloudImageSize(aspect?: AspectRatio): string {
  switch (aspect) {
    case '9:16': return '1600*2848';
    case '3:4': return '1664*2496';
    case '4:3': return '2496*1664';
    case '2.35:1': return '3136*1344';
    case '1:1': return '2048*2048';
    default: return '2848*1600';
  }
}

export function buildAtlasCloudImageRequest(
  input: ImageGenerateInput,
  env: NodeJS.ProcessEnv = process.env,
): { model: string; prompt: string; size: string; output_format: 'jpeg' | 'png' } {
  return {
    model: env.ATLASCLOUD_IMAGE_MODEL || DEFAULT_MODEL,
    prompt: input.prompt,
    size: atlasCloudImageSize(input.aspectRatio),
    output_format: env.ATLASCLOUD_IMAGE_OUTPUT_FORMAT === 'png' ? 'png' : 'jpeg',
  };
}

export function hasAtlasCloudImage(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.ATLASCLOUD_IMAGE_ENABLED === '1' && !!env.ATLASCLOUD_API_KEY;
}

async function readJson(res: Response, label: string): Promise<Record<string, unknown>> {
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`${label} ${res.status}: ${text.slice(0, 160)}`);
  }
  return responseData(await res.json());
}

export async function generateAtlasCloudImage(
  input: ImageGenerateInput,
  env: NodeJS.ProcessEnv = process.env,
  deps: AtlasCloudDeps = {},
): Promise<{ imageUrl: string; predictionId: string }> {
  const fetchImpl = deps.fetch || fetch;
  const sleep = deps.sleep || ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  const base = (env.ATLASCLOUD_BASE_URL || DEFAULT_BASE_URL).replace(/\/+$/, '');
  const key = env.ATLASCLOUD_API_KEY || '';
  if (!key) throw new Error('ATLASCLOUD_API_KEY is required');

  // Submit exactly once. Retrying an ambiguous POST could create a duplicate billable job.
  const submitted = await fetchImpl(`${base}/api/v1/model/generateImage`, {
    method: 'POST',
    signal: AbortSignal.timeout(120_000),
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(buildAtlasCloudImageRequest(input, env)),
  });
  const submitData = await readJson(submitted, 'Atlas Cloud image submit');
  const predictionId = String(submitData.id || submitData.request_id || '');
  if (!predictionId) throw new Error('Atlas Cloud submit returned no prediction id');

  const pollIntervalMs = deps.pollIntervalMs ?? 3_000;
  const pollTimeoutMs = deps.pollTimeoutMs ?? Number(env.ATLASCLOUD_IMAGE_POLL_TIMEOUT_MS || 300_000);
  const deadline = Date.now() + pollTimeoutMs;
  while (Date.now() < deadline) {
    let pollData: Record<string, unknown> | null = null;
    let lastError: unknown;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const polled = await fetchImpl(`${base}/api/v1/model/prediction/${encodeURIComponent(predictionId)}`, {
          method: 'GET',
          signal: AbortSignal.timeout(60_000),
          headers: { Authorization: `Bearer ${key}` },
        });
        pollData = await readJson(polled, 'Atlas Cloud image poll');
        break;
      } catch (error) {
        lastError = error;
        if (attempt < 2) await sleep(250 * (2 ** attempt));
      }
    }
    if (!pollData) throw lastError instanceof Error ? lastError : new Error('Atlas Cloud poll failed');

    const status = String(pollData.status || '').toLowerCase();
    if (status === 'completed' || status === 'succeeded') {
      const output = pollData.outputs ?? pollData.output;
      const imageUrl = Array.isArray(output) ? output[0] : output;
      if (typeof imageUrl !== 'string' || !/^https?:\/\//.test(imageUrl)) {
        throw new Error('Atlas Cloud completed without an image URL');
      }
      return { imageUrl, predictionId };
    }
    if (TERMINAL_FAILURES.has(status)) {
      throw new Error(`Atlas Cloud image generation ${status}: ${String(pollData.error || pollData.message || '')}`);
    }
    await sleep(pollIntervalMs);
  }
  throw new Error(`Atlas Cloud image generation timed out after ${pollTimeoutMs}ms`);
}

registerImageProvider({
  id: 'atlascloud-image',
  name: 'Atlas Cloud (Seedream)',
  supportsRefs: false,
  maxRefImages: 0,
  priority: 65,
  available: () => hasAtlasCloudImage(),
  async generate(input) {
    const result = await generateAtlasCloudImage(input);
    input.onProgress?.(1, 'atlascloud-image: done');
    return { imageUrl: result.imageUrl, provider: 'atlascloud-image', upstreamId: result.predictionId };
  },
});
