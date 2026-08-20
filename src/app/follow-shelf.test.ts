// Following is a coat you can take off.
//
// Reported from use: "cuando un canal se pone a follow después ya nunca
// recupera el funcionamiento normal". Follow and weave answer the same question
// so one has to give way — but giving way was implemented as deleting the
// weave, and stopping following brought the lane back with no topology, an
// empty carrier clip and a row inviting you to pick a topology as though it had
// never had one.

import { describe, it, expect } from 'vitest';
import { setLaneFollow, type FollowDepsUI } from './panel-context-follow';
import type { SessionState } from '../session/session';
import type { PanelWeave } from '@loom/plugin-sdk';

const AB: PanelWeave = { kind: 'ab', a: 'lib:techno:synth:0', b: 'lib:techno:synth:1', x: 0.25 };

function harness(weave: PanelWeave | null) {
  const state = {
    lanes: [
      { id: 'lead', engineId: 'subtractive', role: 'melody', clips: [], inserts: [] },
      { id: 'mine', engineId: 'subtractive', role: 'pad', clips: [], inserts: [] },
    ],
  } as unknown as SessionState;
  const lanes: Record<string, { weave: PanelWeave | null; shelvedWeave?: PanelWeave | null }> = {
    mine: { weave },
  };
  const d: FollowDepsUI = {
    getState: () => state,
    clearWeave: (id) => {
      const cur = lanes[id];
      if (cur && cur.shelvedWeave === undefined) cur.shelvedWeave = cur.weave;
      if (cur) cur.weave = null;
    },
    restoreWeave: (id) => {
      const cur = lanes[id];
      if (!cur || cur.shelvedWeave === undefined) return;
      cur.weave = cur.shelvedWeave;
      delete cur.shelvedWeave;
    },
    refresh: () => {},
    history: () => undefined,
  };
  return { state, lanes, d };
}

describe('following puts the weave away and gives it back', () => {
  it('the weave survives a round trip through following', () => {
    const { lanes, d } = harness(AB);
    setLaneFollow(d, 'mine', 'lead');
    expect(lanes.mine.weave).toBeNull();
    setLaneFollow(d, 'mine', null);
    expect(lanes.mine.weave).toEqual(AB);
  });

  it('and the lane really does stop following', () => {
    const { state, d } = harness(AB);
    setLaneFollow(d, 'mine', 'lead');
    setLaneFollow(d, 'mine', null);
    expect((state.lanes[1] as { follow?: unknown }).follow).toBeUndefined();
  });

  it('re-pointing at another leader does not eat the shelved weave', () => {
    // Only the FIRST shelving counts. Otherwise the second leader would shelve
    // `null` over the real one and the coat would be gone after all.
    const { state, lanes, d } = harness(AB);
    state.lanes.push({ id: 'other', engineId: 'subtractive', role: 'melody', clips: [], inserts: [] } as never);
    setLaneFollow(d, 'mine', 'lead');
    setLaneFollow(d, 'mine', 'other');
    setLaneFollow(d, 'mine', null);
    expect(lanes.mine.weave).toEqual(AB);
  });

  it('a lane that was never weaving comes back exactly as it was', () => {
    const { lanes, d } = harness(null);
    setLaneFollow(d, 'mine', 'lead');
    setLaneFollow(d, 'mine', null);
    expect(lanes.mine.weave).toBeNull();
    expect(lanes.mine.shelvedWeave).toBeUndefined();
  });

  it('clearing a follow that was never set changes nothing', () => {
    const { lanes, d } = harness(AB);
    setLaneFollow(d, 'mine', null);
    expect(lanes.mine.weave).toEqual(AB);
  });
});

