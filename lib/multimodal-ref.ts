/**
 * v6.1.2 — 多模态参考 (Multimodal Reference) · 纯逻辑 (client-safe, 可单测)
 *
 * 对标 火山剧创"生成时可上传 图/音/视频 作参考". 这里做类型判定 + 校验 + 汇总,
 * UI (MultimodalRefShelf) 和创作提交载荷复用. 图片参考本就被 cameo/cref 消费;
 * 音/视频参考目前作为前向兼容载荷透传 (后续视频/TTS 管线消费).
 */

export type RefKind = 'image' | 'audio' | 'video';

export interface ReferenceAsset {
  id: string;
  kind: RefKind;
  /** data: URI 或 http(s) URL */
  url: string;
  name: string;
  /** 可选用途标注: '风格参考' / '运镜参考' / '配音参考' 等 */
  role?: string;
}

export const KIND_LABEL: Record<RefKind, string> = { image: '图片', audio: '音频', video: '视频' };

/** 每类参考数量上限. */
export const MAX_PER_KIND: Record<RefKind, number> = { image: 6, audio: 3, video: 3 };

/** file input 的 accept 属性. */
export const ACCEPT_ATTR = 'image/*,audio/*,video/*';

const EXT_KIND: Record<string, RefKind> = {
  png: 'image', jpg: 'image', jpeg: 'image', webp: 'image', gif: 'image', bmp: 'image', avif: 'image',
  mp3: 'audio', wav: 'audio', aac: 'audio', m4a: 'audio', ogg: 'audio', flac: 'audio',
  mp4: 'video', webm: 'video', mov: 'video', mkv: 'video', m4v: 'video',
};

/** 从 mime / 文件名 / url 推断参考类型. 不支持返回 null. */
export function classifyRef(input: { mime?: string; name?: string; url?: string }): RefKind | null {
  const mime = (input.mime || '').toLowerCase();
  if (mime.startsWith('image/')) return 'image';
  if (mime.startsWith('audio/')) return 'audio';
  if (mime.startsWith('video/')) return 'video';
  // data:URI 也带 mime: data:<mime>[;base64],<data>
  const u = input.url || '';
  if (u.startsWith('data:')) {
    const cut = [u.indexOf(';'), u.indexOf(',')].filter((i) => i >= 0);
    const end = cut.length ? Math.min(...cut) : 5;
    const m = u.slice(5, end).toLowerCase();
    if (m.startsWith('image/')) return 'image';
    if (m.startsWith('audio/')) return 'audio';
    if (m.startsWith('video/')) return 'video';
  }
  const src = (input.name || u || '').toLowerCase().split('?')[0];
  const ext = src.includes('.') ? src.slice(src.lastIndexOf('.') + 1) : '';
  return EXT_KIND[ext] ?? null;
}

export interface ValidateResult { ok: boolean; errors: string[]; }

/** 校验一组参考: 都有 url + 每类不超上限. */
export function validateRefs(refs: ReferenceAsset[]): ValidateResult {
  const errors: string[] = [];
  const counts = summarizeRefs(refs);
  for (const r of refs) {
    if (!r.url) errors.push(`「${r.name || '未命名'}」缺少 URL`);
  }
  (Object.keys(MAX_PER_KIND) as RefKind[]).forEach((k) => {
    if (counts[k] > MAX_PER_KIND[k]) errors.push(`${KIND_LABEL[k]}参考最多 ${MAX_PER_KIND[k]} 个(现 ${counts[k]})`);
  });
  return { ok: errors.length === 0, errors };
}

/** 每类计数. */
export function summarizeRefs(refs: ReferenceAsset[]): Record<RefKind, number> {
  const c: Record<RefKind, number> = { image: 0, audio: 0, video: 0 };
  for (const r of refs) if (c[r.kind] != null) c[r.kind] += 1;
  return c;
}

/** 能否再加一个该类参考 (没到上限). */
export function canAdd(refs: ReferenceAsset[], kind: RefKind): boolean {
  return summarizeRefs(refs)[kind] < MAX_PER_KIND[kind];
}
