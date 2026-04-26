import { describe, it, expect, beforeEach } from 'vitest';
import { useAgentStore } from '@/lib/store';

describe('Consistency store slice (v2.11 #1)', () => {
  beforeEach(() => {
    useAgentStore.getState().resetConsistency();
  });

  it('starts empty', () => {
    const s = useAgentStore.getState();
    expect(s.consistencyEvents).toEqual([]);
    expect(s.totalShots).toBe(0);
  });

  it('addConsistencyEvent appends unique (shotNumber, type)', () => {
    const { addConsistencyEvent } = useAgentStore.getState();
    addConsistencyEvent({ shotNumber: 1, type: 'cameoApplied', at: 1 });
    addConsistencyEvent({ shotNumber: 2, type: 'cameoApplied', at: 2 });
    addConsistencyEvent({ shotNumber: 2, type: 'keyframeChained', fromShot: 1, at: 3 });
    const evs = useAgentStore.getState().consistencyEvents;
    expect(evs).toHaveLength(3);
  });

  it('addConsistencyEvent dedupes same (shotNumber, type) by keeping latest', () => {
    const { addConsistencyEvent } = useAgentStore.getState();
    addConsistencyEvent({ shotNumber: 5, type: 'cameoApplied', at: 100 });
    addConsistencyEvent({ shotNumber: 5, type: 'cameoApplied', at: 200 });
    const evs = useAgentStore.getState().consistencyEvents;
    expect(evs).toHaveLength(1);
    expect(evs[0].at).toBe(200);
  });

  it('setTotalShots overrides', () => {
    useAgentStore.getState().setTotalShots(15);
    expect(useAgentStore.getState().totalShots).toBe(15);
  });

  it('resetConsistency clears everything', () => {
    const { addConsistencyEvent, setTotalShots, resetConsistency } = useAgentStore.getState();
    addConsistencyEvent({ shotNumber: 1, type: 'cameoApplied', at: 1 });
    setTotalShots(10);
    resetConsistency();
    expect(useAgentStore.getState().consistencyEvents).toEqual([]);
    expect(useAgentStore.getState().totalShots).toBe(0);
  });
});
