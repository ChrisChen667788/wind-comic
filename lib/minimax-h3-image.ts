import { API_CONFIG } from './config';

export const H3_IMAGE_TIMEOUT_MS = 600_000;

export function h3ImageSettings() {
  const { apiKey, baseURL, imageModel: model } = API_CONFIG.minimax;
  if (!apiKey || (model !== 'MiniMax-H3-Image' && model !== 'MiniMax-H3-Image-Highspeed')) return null;
  // The existing default base belongs to the China region.
  const base = baseURL === 'https://api.minimaxi.com' ? 'https://api.minimax.cn' : baseURL;
  if (base !== 'https://api.minimax.cn' && base !== 'https://api.minimax.io') return null;
  return { endpoint: `${base}/v1/images/generations`, model, apiKey };
}

export function imageStageTimeout(defaultMs: number): number {
  const mode = process.env.PLUGIN_CHAIN_MODE?.trim().toLowerCase();
  if (mode === 'off' || mode === 'shadow' || !h3ImageSettings()) return defaultMs;
  // Allow the generation request to finish before the stage falls back.
  return defaultMs + H3_IMAGE_TIMEOUT_MS;
}
