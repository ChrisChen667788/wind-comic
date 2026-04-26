import { describe, it, expect } from 'vitest';
import {
  IMG_LENS_BOX, IMG_RHYTHM, IMG_STYLE_GRID, IMG_FEATURE_MAIN,
  IMG_AGENT_DIRECTOR, IMG_AGENT_STORYBOARD, IMG_AGENT_MOTION, IMG_AGENT_EDITOR,
  IMG_VIBE_FOREST, IMG_VIBE_NEON, IMG_LENS_MAIN,
  IMG_AUTH_BG1, IMG_AUTH_BG2, IMG_PREVIEW_DEFAULT, IMG_AVATAR_DEFAULT,
  IMG_BG_TEXTURE, IMG_CASE_1, IMG_CASE_2, IMG_CASE_3, IMG_CASE_4,
  IMG_PROJECT_1, IMG_PROJECT_2, IMG_PROJECT_3,
} from '@/lib/placeholder-images';

describe('Placeholder Images', () => {
  const allImages = {
    IMG_LENS_BOX, IMG_RHYTHM, IMG_STYLE_GRID, IMG_FEATURE_MAIN,
    IMG_AGENT_DIRECTOR, IMG_AGENT_STORYBOARD, IMG_AGENT_MOTION, IMG_AGENT_EDITOR,
    IMG_VIBE_FOREST, IMG_VIBE_NEON, IMG_LENS_MAIN,
    IMG_AUTH_BG1, IMG_AUTH_BG2, IMG_PREVIEW_DEFAULT, IMG_AVATAR_DEFAULT,
    IMG_BG_TEXTURE, IMG_CASE_1, IMG_CASE_2, IMG_CASE_3, IMG_CASE_4,
    IMG_PROJECT_1, IMG_PROJECT_2, IMG_PROJECT_3,
  };

  it('all images are data URIs', () => {
    for (const [name, uri] of Object.entries(allImages)) {
      expect(uri, `${name} should be a data URI`).toMatch(/^data:image\/svg\+xml,/);
    }
  });

  it('no external URLs remain', () => {
    for (const [name, uri] of Object.entries(allImages)) {
      expect(uri, `${name} should not reference oiioii.ai`).not.toContain('oiioii.ai');
      expect(uri, `${name} should not reference hogi.ai`).not.toContain('hogi.ai');
    }
  });

  it('all images are non-empty', () => {
    for (const [name, uri] of Object.entries(allImages)) {
      expect(uri.length, `${name} should have content`).toBeGreaterThan(50);
    }
  });
});
