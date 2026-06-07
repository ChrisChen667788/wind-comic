/**
 * lib/lipsync-providers (v9.6.9) — 口型引擎 bootstrap:导入即注册内置适配器 + 再导出 registry/types。
 * 调用方:`import { dispatchLipSyncGenerate, lipSyncEngineConfigured } from '@/lib/lipsync-providers'`。
 */
import './builtins'; // 副作用:注册 wav2lip-http
import './local-2d'; // 副作用:注册 local-2d(零配置兜底,ffmpeg)

export * from './types';
export * from './registry';
