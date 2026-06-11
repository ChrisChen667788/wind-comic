/**
 * v10.5.3 — ui_events 埋点仓库单测:落库/计数(完成率分子分母)、事件名白名单。
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { db } from '@/lib/db';
import { recordUiEvent, countUiEvents } from '@/lib/repos/ui-event-repo';

beforeEach(() => {
  db.prepare('DELETE FROM ui_events').run();
});

describe('v10.5.3 · ui-event-repo', () => {
  it('落库 + 计数:完成率 = completed/shown 可直接算', async () => {
    await recordUiEvent({ event: 'create_guide_shown' });
    await recordUiEvent({ event: 'create_guide_shown', userId: 'u1' });
    await recordUiEvent({ event: 'create_guide_completed', userId: 'u1', meta: { atStep: 3 } });
    expect(await countUiEvents('create_guide_shown')).toBe(2);
    expect(await countUiEvents('create_guide_completed')).toBe(1);
    const row = db.prepare("SELECT user_id, meta FROM ui_events WHERE event = 'create_guide_completed'").get() as any;
    expect(row.user_id).toBe('u1');
    expect(JSON.parse(row.meta)).toEqual({ atStep: 3 });
  });

  it('事件名白名单:非法字符 / 超长 / 空 → 拒收', async () => {
    expect(await recordUiEvent({ event: 'DROP TABLE;' })).toBe(false);
    expect(await recordUiEvent({ event: 'x'.repeat(61) })).toBe(false);
    expect(await recordUiEvent({ event: '' })).toBe(false);
    expect(await countUiEvents('DROP TABLE;')).toBe(0);
  });
});
