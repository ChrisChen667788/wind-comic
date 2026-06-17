/**
 * lib/audio-url (v12.x · #4 修复) — 判定一个配音/音频 URL 该怎么加载到本地。
 *
 * 背景:TTS provider 返回的不是 http URL —— vectorengine-tts 返 `data:audio/...;base64,`、
 * minimax 返 `/api/serve-file?path=...`。composer 此前只认 `startsWith('http')` → 配音全被丢、
 * 成片没人声。这个纯函数把三种形态显式分类,供 composer 正确加载,并可单测锁死回归。
 */
export type AudioLoadKind = 'data' | 'download' | 'skip';

export function audioUrlLoadKind(url: string | null | undefined): AudioLoadKind {
  if (!url) return 'skip';
  if (url.startsWith('data:')) return 'data';                 // 内联 base64 → 解码写文件
  if (url.startsWith('http') || url.startsWith('/api/serve-file')) return 'download'; // downloadFile 已支持两者
  return 'skip';                                              // 未知形态(占位/相对路径等)→ 跳过,不静默当 http
}
