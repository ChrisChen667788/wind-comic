import { describe, it, expect } from 'vitest';
import { heroStats, featureHighlights, agentCards, vibeShots } from '@/lib/home-data';

describe('Home Data', () => {
  it('heroStats has correct structure', () => {
    expect(heroStats.length).toBe(3);
    heroStats.forEach((s) => {
      expect(s).toHaveProperty('value');
      expect(s).toHaveProperty('label');
    });
  });

  it('featureHighlights uses local images', () => {
    featureHighlights.forEach((f) => {
      expect(f.image).toMatch(/^data:image\/svg\+xml,/);
      expect(f.image).not.toContain('oiioii.ai');
      expect(f.image).not.toContain('hogi.ai');
    });
  });

  it('agentCards uses local images', () => {
    expect(agentCards.length).toBe(4);
    agentCards.forEach((a) => {
      expect(a.image).toMatch(/^data:image\/svg\+xml,/);
      expect(a).toHaveProperty('title');
      expect(a).toHaveProperty('desc');
    });
  });

  it('vibeShots uses local images', () => {
    expect(vibeShots.length).toBe(2);
    vibeShots.forEach((v) => {
      expect(v.image).toMatch(/^data:image\/svg\+xml,/);
    });
  });
});
