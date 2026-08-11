// PRINT captured the notes and dropped the movement: a scene printed while the
// step rack was driving a filter arrived with the filter frozen wherever the
// playhead happened to be.
import { describe, it, expect } from 'vitest';
import { envelopesForPrint, type PrintableRow } from './print-automation';

const SUBS_PER_BAR = 64;   // envelopeValueLength(1, 4/4) — 16 steps × 4 sub-samples
const LANES = ['lane1', 'lane2'];

const row = (over: Partial<PrintableRow> = {}): PrintableRow => ({
  destId: 'lane1.filter.cutoff',
  values: [0, 1],
  mode: 'hold',
  on: true,
  ...over,
});

describe('printing the step rack into the clips', () => {
  it('files a row under the lane its destination names', () => {
    const out = envelopesForPrint([row()], LANES, 1, SUBS_PER_BAR);
    expect([...out.keys()]).toEqual(['lane1']);
    expect(out.get('lane1')![0].paramId).toBe('lane1.filter.cutoff');
  });

  it('gives the envelope exactly the length the clip expects', () => {
    // A curve of a different length slides a bar per lap against its own notes.
    const out = envelopesForPrint([row()], LANES, 4, SUBS_PER_BAR);
    expect(out.get('lane1')![0].values).toHaveLength(SUBS_PER_BAR * 4);
  });

  it('REPEATS the shape once per bar rather than stretching it', () => {
    // The row plays at `bars - floor(bars)`, so its shape is one bar long and
    // comes round again. Stretched over a four-bar lap it would print something
    // nobody heard.
    const out = envelopesForPrint([row()], LANES, 4, SUBS_PER_BAR);
    const v = out.get('lane1')![0].values;
    for (let bar = 0; bar < 4; bar++) {
      expect(v[bar * SUBS_PER_BAR]).toBe(v[0]);
      expect(v[bar * SUBS_PER_BAR + SUBS_PER_BAR / 2]).toBe(v[SUBS_PER_BAR / 2]);
    }
  });

  it('holds a staircase where the row holds', () => {
    const out = envelopesForPrint([row({ values: [0.25, 0.75], mode: 'hold' })], LANES, 1, SUBS_PER_BAR);
    const v = out.get('lane1')![0].values;
    expect(v[0]).toBeCloseTo(0.25, 6);
    expect(v[SUBS_PER_BAR / 2 - 1]).toBeCloseTo(0.25, 6);
    expect(v[SUBS_PER_BAR / 2]).toBeCloseTo(0.75, 6);
    expect(out.get('lane1')![0].stepped).toBe(true);
  });

  it('slopes where the row ramps, and says so', () => {
    const out = envelopesForPrint([row({ values: [0, 1], mode: 'ramp' })], LANES, 1, SUBS_PER_BAR);
    const e = out.get('lane1')![0];
    expect(e.stepped).toBe(false);
    expect(e.values[1]).toBeGreaterThan(e.values[0]);
  });

  it('carries several rows, each to its own lane', () => {
    const out = envelopesForPrint(
      [row(), row({ destId: 'lane2.filter.resonance' })], LANES, 1, SUBS_PER_BAR,
    );
    expect(out.get('lane1')).toHaveLength(1);
    expect(out.get('lane2')).toHaveLength(1);
  });

  it('keeps two rows on the SAME lane apart', () => {
    const out = envelopesForPrint(
      [row(), row({ destId: 'lane1.filter.resonance' })], LANES, 1, SUBS_PER_BAR,
    );
    expect(out.get('lane1')!.map((e) => e.paramId))
      .toEqual(['lane1.filter.cutoff', 'lane1.filter.resonance']);
  });

  it('prints NOTHING for a row that is off', () => {
    // An envelope of zeroes is not the same as no envelope: it would pin the
    // param at zero for the whole clip, which the row was not doing.
    expect(envelopesForPrint([row({ on: false })], LANES, 1, SUBS_PER_BAR).size).toBe(0);
  });

  it('prints nothing for a row with no destination or no shape', () => {
    expect(envelopesForPrint([row({ destId: '' })], LANES, 1, SUBS_PER_BAR).size).toBe(0);
    expect(envelopesForPrint([row({ values: [] })], LANES, 1, SUBS_PER_BAR).size).toBe(0);
  });

  it('leaves out what no clip can hold', () => {
    // A macro, the master bus and a send return are real destinations with no
    // lane to belong to. Misfiling one under a lane would write a param that
    // lane does not have.
    const out = envelopesForPrint([
      row({ destId: 'session.weave:space' }),
      row({ destId: 'fx.master.fx:slot1.mix' }),
      row({ destId: 'fx.send.A.fx:slot1.mix' }),
    ], LANES, 1, SUBS_PER_BAR);
    expect(out.size).toBe(0);
  });

  it('leaves out a lane that is not in the print', () => {
    expect(envelopesForPrint([row({ destId: 'ghost.filter.cutoff' })], LANES, 1, SUBS_PER_BAR).size)
      .toBe(0);
  });

  it('prints nothing rather than an empty array for a lap of no bars', () => {
    expect(envelopesForPrint([row()], LANES, 0, SUBS_PER_BAR).size).toBe(0);
  });
});
