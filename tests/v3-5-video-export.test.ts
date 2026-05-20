/**
 * v3.5 — 视频导出预设单测.
 */

import { describe, it, expect } from 'vitest';
import {
  buildAspectFilter,
  animFormatPlan,
  ASPECT_DIMENSIONS,
} from '@/lib/video-export';

describe('v3.5 · buildAspectFilter', () => {
  it('contain → scale+pad with black bars', () => {
    const r = buildAspectFilter({ targetAspect: '9:16', fit: 'contain' });
    expect(r.vf).toContain('force_original_aspect_ratio=decrease');
    expect(r.vf).toContain('pad=1080:1920');
    expect(r.width).toBe(1080);
    expect(r.height).toBe(1920);
    expect(r.filterComplex).toBeUndefined();
  });

  it('cover → scale+crop, no bars', () => {
    const r = buildAspectFilter({ targetAspect: '9:16', fit: 'cover' });
    expect(r.vf).toContain('force_original_aspect_ratio=increase');
    expect(r.vf).toContain('crop=1080:1920');
  });

  it('blur-pad → filter_complex with gblur + overlay', () => {
    const r = buildAspectFilter({ targetAspect: '9:16', fit: 'blur-pad' });
    expect(r.vf).toBeUndefined();
    expect(r.filterComplex).toContain('gblur');
    expect(r.filterComplex).toContain('overlay=(W-w)/2:(H-h)/2');
    expect(r.filterComplex).toContain('split=2');
  });

  it('honors all aspect presets', () => {
    expect(buildAspectFilter({ targetAspect: '16:9', fit: 'contain' }).width).toBe(1920);
    expect(buildAspectFilter({ targetAspect: '1:1', fit: 'contain' }).height).toBe(1080);
    expect(buildAspectFilter({ targetAspect: '4:5', fit: 'contain' }).height).toBe(1350);
  });

  it('width/height overrides win', () => {
    const r = buildAspectFilter({ targetAspect: '9:16', fit: 'contain', width: 720, height: 1280 });
    expect(r.width).toBe(720);
    expect(r.height).toBe(1280);
    expect(r.vf).toContain('pad=720:1280');
  });

  it('ASPECT_DIMENSIONS covers all aspects', () => {
    // JS 字符串排序: '16:9' < '1:1' (因为 '6'(54) < ':'(58))
    expect(Object.keys(ASPECT_DIMENSIONS).sort()).toEqual(['16:9', '1:1', '4:5', '9:16']);
  });
});

describe('v3.5 · animFormatPlan', () => {
  it('gif needs palette 2-pass', () => {
    const p = animFormatPlan({ format: 'gif' });
    expect(p.ext).toBe('.gif');
    expect(p.needsPalette).toBe(true);
    expect(p.encodeArgs).toEqual([]);
  });

  it('webp uses libwebp_anim single-pass', () => {
    const p = animFormatPlan({ format: 'webp', fps: 12, width: 800, quality: 80 });
    expect(p.ext).toBe('.webp');
    expect(p.needsPalette).toBe(false);
    const joined = p.encodeArgs.join(' ');
    expect(joined).toContain('libwebp_anim');
    expect(joined).toContain('fps=12');
    expect(joined).toContain('scale=800:-1');
    expect(joined).toContain('-q:v 80');
    expect(joined).toContain('-loop 0');
  });

  it('avif uses libaom-av1 with crf mapped from quality', () => {
    const p = animFormatPlan({ format: 'avif', quality: 100 }); // best quality → crf 0
    expect(p.ext).toBe('.avif');
    const joined = p.encodeArgs.join(' ');
    expect(joined).toContain('libaom-av1');
    expect(joined).toContain('-crf 0');
  });

  it('avif low quality → high crf', () => {
    const p = animFormatPlan({ format: 'avif', quality: 0 });
    expect(p.encodeArgs.join(' ')).toContain('-crf 63');
  });

  it('clamps insane fps / width / quality', () => {
    const p = animFormatPlan({ format: 'webp', fps: 999, width: 99999, quality: 999 });
    const joined = p.encodeArgs.join(' ');
    expect(joined).toContain('fps=60');
    expect(joined).toContain('scale=4096:-1');
    expect(joined).toContain('-q:v 100');
  });

  it('defaults: fps=10 width=960 quality=75', () => {
    const p = animFormatPlan({ format: 'webp' });
    const joined = p.encodeArgs.join(' ');
    expect(joined).toContain('fps=10');
    expect(joined).toContain('scale=960:-1');
    expect(joined).toContain('-q:v 75');
  });
});
