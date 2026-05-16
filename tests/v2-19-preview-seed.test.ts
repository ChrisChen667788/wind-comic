/**
 * v2.19 P0.2 — Preview shot image → Shot 1 storyboard reuse.
 *
 * Tests the orchestrator's setPreviewSeedImage setter contract:
 *   - Accepts http(s) URLs
 *   - Rejects data: / mock-svg / empty / non-string inputs (would corrupt
 *     downstream remote API calls that need a fetchable URL)
 *
 * Behavioral test (Shot 1 actually reuses the seed) lives at integration level
 * because runStoryboardRenderer touches generateImage + cameo-retry + many
 * services — too much surface for a fast unit test. The setter contract is the
 * meaningful surface to lock here.
 */
import { describe, expect, it, vi } from 'vitest';

// Heavy modules — orchestrator imports them but we don't exercise them here.
vi.mock('@/lib/db', () => ({
  db: { prepare: () => ({ get: () => null, run: () => ({}), all: () => [] }) },
  now: () => new Date().toISOString(),
}));

describe('v2.19 P0.2 · HybridOrchestrator.setPreviewSeedImage', () => {
  it('accepts a valid https URL', async () => {
    const { HybridOrchestrator } = await import('@/services/hybrid-orchestrator');
    const o = new HybridOrchestrator();
    o.setPreviewSeedImage('https://example.com/preview-shot.png');
    // No public getter — assert via internal cast; tests are codebase-internal.
    expect((o as any).previewSeedImage).toBe('https://example.com/preview-shot.png');
  });

  it('accepts http URL', async () => {
    const { HybridOrchestrator } = await import('@/services/hybrid-orchestrator');
    const o = new HybridOrchestrator();
    o.setPreviewSeedImage('http://cdn.example/test.jpg');
    expect((o as any).previewSeedImage).toBe('http://cdn.example/test.jpg');
  });

  it('rejects data: URI (cannot be sent to remote image API)', async () => {
    const { HybridOrchestrator } = await import('@/services/hybrid-orchestrator');
    const o = new HybridOrchestrator();
    o.setPreviewSeedImage('data:image/png;base64,iVBORw0KGgo=');
    expect((o as any).previewSeedImage).toBe('');
  });

  it('rejects mock svg', async () => {
    const { HybridOrchestrator } = await import('@/services/hybrid-orchestrator');
    const o = new HybridOrchestrator();
    o.setPreviewSeedImage('<svg xmlns="..."></svg>');
    expect((o as any).previewSeedImage).toBe('');
  });

  it('rejects empty string', async () => {
    const { HybridOrchestrator } = await import('@/services/hybrid-orchestrator');
    const o = new HybridOrchestrator();
    o.setPreviewSeedImage('');
    expect((o as any).previewSeedImage).toBe('');
  });

  it('rejects non-string input', async () => {
    const { HybridOrchestrator } = await import('@/services/hybrid-orchestrator');
    const o = new HybridOrchestrator();
    // @ts-expect-error - testing runtime guard
    o.setPreviewSeedImage(null);
    expect((o as any).previewSeedImage).toBe('');
    // @ts-expect-error
    o.setPreviewSeedImage(undefined);
    expect((o as any).previewSeedImage).toBe('');
    // @ts-expect-error
    o.setPreviewSeedImage(123);
    expect((o as any).previewSeedImage).toBe('');
  });

  it('subsequent valid set overrides previous', async () => {
    const { HybridOrchestrator } = await import('@/services/hybrid-orchestrator');
    const o = new HybridOrchestrator();
    o.setPreviewSeedImage('https://a.example/a.png');
    o.setPreviewSeedImage('https://b.example/b.png');
    expect((o as any).previewSeedImage).toBe('https://b.example/b.png');
  });

  it('invalid set after valid keeps the valid one', async () => {
    const { HybridOrchestrator } = await import('@/services/hybrid-orchestrator');
    const o = new HybridOrchestrator();
    o.setPreviewSeedImage('https://kept.example/k.png');
    o.setPreviewSeedImage('data:image/png;base64,nope');
    expect((o as any).previewSeedImage).toBe('https://kept.example/k.png');
  });
});
