/**
 * Tests for v2.18 — story-templates expansion + new metadata
 */

import { describe, it, expect } from 'vitest';
import { storyTemplates, getTemplateById } from '@/lib/story-templates';

describe('storyTemplates v2.18 expansion', () => {
  it('has at least 18 templates (12 original + 6 new)', () => {
    expect(storyTemplates.length).toBeGreaterThanOrEqual(18);
  });

  it('every template has the required fields', () => {
    for (const t of storyTemplates) {
      expect(t.id).toMatch(/^[a-z-]+$/);
      expect(t.name.length).toBeGreaterThan(0);
      expect(t.nameEn.length).toBeGreaterThan(0);
      expect(t.icon.length).toBeGreaterThan(0);
      expect(t.exampleIdea.length).toBeGreaterThanOrEqual(20);
      expect(t.structureHint.length).toBeGreaterThan(50);
      expect(t.shotCount.min).toBeGreaterThan(0);
      expect(t.shotCount.max).toBeGreaterThanOrEqual(t.shotCount.min);
    }
  });

  it('new v2.18 templates exist', () => {
    const newIds = ['sci-fi-space', 'kids-cartoon', 'historical-biopic', 'animal-fable', 'food-vlog', 'music-video'];
    for (const id of newIds) {
      const t = getTemplateById(id);
      expect(t, `template ${id}`).toBeDefined();
    }
  });

  it('new v2.18 templates carry tags + recommended* metadata', () => {
    const newIds = ['sci-fi-space', 'kids-cartoon', 'historical-biopic', 'animal-fable', 'food-vlog', 'music-video'];
    for (const id of newIds) {
      const t = getTemplateById(id)!;
      expect(t.tags, `${id}.tags`).toBeDefined();
      expect(t.tags!.length).toBeGreaterThan(0);
      expect(t.recommendedDuration, `${id}.recommendedDuration`).toBeDefined();
      expect([5, 6, 10, 15], `${id}.recommendedDuration value`).toContain(t.recommendedDuration);
      expect(t.recommendedAspect, `${id}.recommendedAspect`).toBeDefined();
      expect(t.recommendedCamera, `${id}.recommendedCamera`).toBeDefined();
    }
  });

  it('all template ids are unique', () => {
    const ids = storyTemplates.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('kids-cartoon recommendedAspect is 16:9 and duration short (suitable for kids)', () => {
    const t = getTemplateById('kids-cartoon')!;
    expect(t.recommendedAspect).toBe('16:9');
    expect(t.recommendedDuration).toBeLessThanOrEqual(6);
  });

  it('sci-fi-space + historical-biopic use 2.35:1 cinemascope (matches genre)', () => {
    expect(getTemplateById('sci-fi-space')!.recommendedAspect).toBe('2.35:1');
    expect(getTemplateById('historical-biopic')!.recommendedAspect).toBe('2.35:1');
  });

  it('all recommendedCamera values match the 12 valid presets', () => {
    const valid = ['push-in', 'pull-out', 'orbit', 'dolly-zoom', 'whip-pan', 'crash-zoom',
      'handheld', 'locked-tripod', 'crane-up', 'tilt-down', 'tracking', 'arc'];
    for (const t of storyTemplates) {
      if (t.recommendedCamera) {
        expect(valid).toContain(t.recommendedCamera);
      }
    }
  });
});
