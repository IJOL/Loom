// The lane's part, across the plugin boundary.
//
// The WEAVE panel is compiled separately and cannot import the host, so the
// role reaches it as three plain members: the choices, the mark, and the write.
// The host writes every LABEL because the vocabulary is the host's — a panel
// carrying its own copy of it would be free to drift, in a bundle nothing
// typechecks against this one.
import { describe, it, expect, beforeEach } from 'vitest';
import { createPanelContext } from './panel-context';
import { defaultWeaveState } from '../weave/weave-state';
import { DEFAULT_METER } from '../core/meter';
import { DEFAULT_MUSICALITY } from '../session/session-types';
import { registerEngineCapabilities, __resetCapabilities } from '../plugins/capabilities';
import { setLibrary } from '../patterns/pattern-library';
import { getNoteFxChain, clearNoteFxChains } from '../notefx/notefx-registry';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { PanelWeave } from '@loom/plugin-sdk';
import type { SessionState, SessionLane } from '../session/session';
import type { LanePlayState } from '../session/session-runtime';

const dir = join(process.cwd(), 'public', 'patterns');
const read = (f: string) => JSON.parse(readFileSync(join(dir, f), 'utf8'));

const lane = (id: string, engineId: string): SessionLane =>
  ({ id, engineId, name: id, clips: [], inserts: [] }) as unknown as SessionLane;

/** The near end of an A→B selection. Narrowed rather than cast: a reseed that
 *  handed back a QUEUE would otherwise read as "the loop changed" and pass. */
const abLoop = (w: PanelWeave | null | undefined): string | undefined =>
  (w && w.kind === 'ab') ? w.a : undefined;

function harness() {
  const state = {
    lanes: [lane('lane1', 'subtractive'), lane('acid', 'tb303'), lane('beat', 'drums-machine')],
    scenes: [{ id: 'scene1', name: 'Scene 1', clipPerLane: {} as Record<string, number | null> }],
    musicality: { ...DEFAULT_MUSICALITY },
  } as unknown as SessionState;
  const weave = defaultWeaveState();
  const changed: (string | undefined)[] = [];

  const ctx = createPanelContext({
    sessionHost: {
      state,
      laneStates: new Map<string, LanePlayState>(),
      renderWithMixer: () => {},
      callbacks: {},
    } as never,
    seq: { bpm: 128, meter: DEFAULT_METER, isPlaying: () => false } as never,
    ctx: { currentTime: 0 } as never,
    weave,
    refresh: () => {},
    onWeaveChanged: (id) => changed.push(id),
    setMusicality: () => {},
    stopTransport: () => {},
  });

  return { ctx, state, weave, changed };
}

beforeEach(() => {
  setLibrary({
    synth: read('patterns-s1.json'),
    drums: read('patterns-t8-drums.json'),
    bass: read('patterns-t8-bass.json'),
    catalog: read('catalog.json'),
  });
  clearNoteFxChains();
  __resetCapabilities();
  registerEngineCapabilities('subtractive', {
    clipContent: 'notes', shortLabel: 'sub', outputTrim: 1,
  });
  registerEngineCapabilities('tb303', {
    clipContent: 'notes', shortLabel: 'tb-303', outputTrim: 1, defaultRole: 'bass',
  });
  registerEngineCapabilities('drums-machine', {
    clipContent: 'notes', shortLabel: 'drums', outputTrim: 1, harmonic: false,
  });
});

describe('the choices a lane is offered', () => {
  it('offers every part, unmarked first', () => {
    const { ctx } = harness();
    const ids = ctx.roleChoices('lane1').map((c) => c.id);
    expect(ids[0]).toBe('');
    expect(ids).toEqual(expect.arrayContaining(['bass', 'melody', 'comp', 'pad', 'arp']));
  });

  it('names the unmarked option after what it actually does', () => {
    // On an instrument that declares the part it is built for, leaving this
    // alone is not "no part" — it is that part. A bare dash would read as the
    // lane being unassigned while its loop list showed only basslines.
    const { ctx } = harness();
    expect(ctx.roleChoices('acid')[0].name).toContain('Bass');
    expect(ctx.roleChoices('lane1')[0].name).not.toContain('Bass');
  });

  it('offers a drum lane NOTHING, which is how the control disappears', () => {
    // Not a gap: a drum lane draws percussion whatever anyone marks it. A
    // picker whose every choice is ignored is worse than no picker.
    expect(harness().ctx.roleChoices('beat')).toEqual([]);
  });

  it('offers nothing for a lane that is not there', () => {
    expect(harness().ctx.roleChoices('ghost')).toEqual([]);
  });
});

describe('reading and writing the mark', () => {
  it('reads null for a lane nobody has marked', () => {
    expect(harness().ctx.laneRole('lane1')).toBeNull();
  });

  it('reads null for a 303 too — the fallback is not a mark', () => {
    // The whole reason this returns the MARK: a control that showed the
    // engine's default as a selection would offer no way to tell the two apart,
    // and clearing it would appear to do nothing.
    expect(harness().ctx.laneRole('acid')).toBeNull();
  });

  it('writes the part onto the LANE, not into the weave', () => {
    // Session state: the arranger reads it, a MIDI import could fill it in, and
    // a copy inside the panel would be a second owner.
    const h = harness();
    h.ctx.setLaneRole('lane1', 'pad');
    expect(h.state.lanes[0].role).toBe('pad');
    expect(h.ctx.laneRole('lane1')).toBe('pad');
  });

  it('clears back to unmarked', () => {
    const h = harness();
    h.ctx.setLaneRole('lane1', 'pad');
    h.ctx.setLaneRole('lane1', null);
    expect(h.state.lanes[0].role).toBeUndefined();
    expect(h.ctx.laneRole('lane1')).toBeNull();
  });

  it('publishes the mark in the lane summary a panel reads', () => {
    const h = harness();
    h.state.lanes[0].role = 'comp';
    expect(h.ctx.lanes()[0].role).toBe('comp');
  });

  it('says nothing about a lane that is not there', () => {
    const h = harness();
    expect(() => h.ctx.setLaneRole('ghost', 'pad')).not.toThrow();
    expect(h.ctx.laneRole('ghost')).toBeNull();
  });
});

describe('the loops move with the mark', () => {
  it('drops a selection the lane may no longer read', () => {
    // Exactly why setLaneStyle reseeds: a loop id carries its own kind and
    // still RESOLVES whatever the role says, so without this a lane marked Pad
    // goes on playing the lead loop it had while its picker lists five chord
    // shapes, none of them selected.
    const h = harness();
    h.weave.lanes['lane1'] = {
      weave: { kind: 'ab', a: 'lib:acid-techno:synth:0', b: 'lib:acid-techno:synth:1', x: 0 },
    } as never;

    h.ctx.setLaneRole('lane1', 'bass');

    expect(abLoop(h.weave.lanes['lane1'].weave)).not.toBe('lib:acid-techno:synth:0');
  });

  it('leaves a selection the lane may still read exactly where it was', () => {
    // The reseed is a repair, not a reset: marking a lane as what it was
    // already playing must not throw its loops away.
    const h = harness();
    h.weave.lanes['lane1'] = {
      weave: { kind: 'ab', a: 'lib:acid-techno:bass:0', b: 'lib:acid-techno:bass:1', x: 0 },
    } as never;

    h.ctx.setLaneRole('lane1', 'bass');

    expect(abLoop(h.weave.lanes['lane1'].weave)).toBe('lib:acid-techno:bass:0');
  });

  it('tells the weave it moved, so the scheduler drops its cached notes', () => {
    const h = harness();
    h.ctx.setLaneRole('lane1', 'pad');
    expect(h.changed).toContain('lane1');
  });
});

describe('an ARP lane actually arpeggiates', () => {
  // Without this the part is a promise the app does not keep: every chordal
  // part draws the same five shapes, so marking a lane Arp gave you a pad in
  // the lead register and nothing else. The note-FX is what turns a held chord
  // into one note at a time.
  const arpsOn = (laneId: string) =>
    getNoteFxChain(laneId).noteFx.filter((s) => s.kind === 'arp');

  it('seeds an arpeggiator onto the lane', () => {
    const h = harness();
    h.ctx.setLaneRole('lane1', 'arp');
    expect(arpsOn('lane1')).toHaveLength(1);
    expect(arpsOn('lane1')[0].enabled).toBe(true);
  });

  it('mirrors it into the session, or it dies on reload', () => {
    // The chain is live and the session is what gets SAVED. The panel's own add
    // button mirrors through the same seam.
    const h = harness();
    h.ctx.setLaneRole('lane1', 'arp');
    expect(h.state.lanes[0].engineState?.noteFx?.some((s) => s.kind === 'arp')).toBe(true);
  });

  it('seeds ONE, however many times you mark it', () => {
    const h = harness();
    h.ctx.setLaneRole('lane1', 'arp');
    h.ctx.setLaneRole('lane1', null);
    h.ctx.setLaneRole('lane1', 'arp');
    expect(arpsOn('lane1')).toHaveLength(1);
  });

  it('leaves it behind when the mark is cleared', () => {
    // By then it is a card in the lane's note-FX panel with the user's own
    // settings on it. Quietly deleting somebody's edits because they changed a
    // dropdown is worse than leaving a control they can see and switch off.
    const h = harness();
    h.ctx.setLaneRole('lane1', 'arp');
    h.ctx.setLaneRole('lane1', null);
    expect(arpsOn('lane1')).toHaveLength(1);
  });

  it('seeds nothing for any other part', () => {
    const h = harness();
    for (const role of ['bass', 'melody', 'comp', 'pad']) h.ctx.setLaneRole('lane1', role);
    expect(arpsOn('lane1')).toHaveLength(0);
  });
});
