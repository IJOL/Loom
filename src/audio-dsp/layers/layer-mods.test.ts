// Can a LAYER's envelope be named at all?
//
// `amp` and `filter.env` are how every engine finds its per-voice envelopes, and
// a lane numbers ONE of each. Four instruments in one lane therefore shared a
// single amplitude envelope — which is the same as saying a slot's sound
// depended on what the slot beside it was given, and that a converted lane had
// no envelopes it could call its own.
//
// This file pins the naming: each slot gets its own three, they resolve to
// DIFFERENT slots, and the translation back into a slot's own vocabulary is
// exact in both directions.

import { describe, it, expect } from 'vitest';
import { buildParamIndex, SYNTHETIC_TARGETS } from '../param-index';
import { layerModTargets, subIndex, subMods, layerPrefix, MAX_LAYERS } from './layer-spec';
import { makeDotIdMapper } from '../../engines/mod-lite';

/** A LAYERS lane's numbering: two slot gains, plus every slot's envelopes. */
const laneIndex = () => buildParamIndex(['l0.gain', 'l1.gain'], layerModTargets());

describe('each slot has envelopes of its own', () => {
  it('names one set per slot, filled or not', () => {
    // Every slot, always: the numbering is fixed for the lane's lifetime, so a
    // slot that only got its targets once occupied could never be given an
    // envelope without rebuilding the lane.
    const t = layerModTargets();
    expect(t.length).toBe(MAX_LAYERS * SYNTHETIC_TARGETS.length);
    for (let i = 0; i < MAX_LAYERS; i++) {
      expect(t).toContain(`${layerPrefix(i)}amp`);
      expect(t).toContain(`${layerPrefix(i)}filter.env`);
    }
  });

  it('gives each of them a slot of its own', () => {
    // The failure this replaces: one `amp` for the lane, so whichever envelope
    // arrived last played all four instruments.
    const ix = laneIndex();
    const slots = new Set([
      ix.slot['l0.amp'], ix.slot['l1.amp'], ix.slot['l0.filter.env'], ix.slot['amp'],
    ]);
    expect(slots.size).toBe(4);
    expect(ix.slot['l0.amp']).toBeDefined();
  });

  it('leaves the lane s own three where they were', () => {
    // Appended AFTER, so adding a slot's targets never renumbers anything an
    // engine resolved once and holds for the life of a voice.
    const ix = laneIndex();
    for (const t of SYNTHETIC_TARGETS) expect(ix.slot[t]).toBeDefined();
  });

  it('costs an ordinary engine nothing', () => {
    const plain = buildParamIndex(['filter.cutoff']);
    expect(plain.length).toBe(1 + SYNTHETIC_TARGETS.length);
  });
});

describe('a slot reads its envelope under its OWN name', () => {
  it('translates l0.amp back to amp, at the lane s slot', () => {
    // The instrument in slot 0 only ever knew this target as `amp`. The naming
    // is translated; the NUMBERING is not, because the offsets array is the
    // lane's and shared.
    const ix = laneIndex();
    const sub = subIndex(ix, 0);
    expect(sub.slot['amp']).toBe(ix.slot['l0.amp']);
    expect(sub.slot['filter.env']).toBe(ix.slot['l0.filter.env']);
    expect(sub.length).toBe(ix.length);
  });

  it('does not hand slot 0 the lane s own amp', () => {
    // A slot that could see the lane's `amp` would be modulated by something
    // outside its box — the whole thing this round exists to stop.
    const ix = laneIndex();
    expect(subIndex(ix, 0).slot['amp']).not.toBe(ix.slot['amp']);
  });
});

describe('splitting a modulator set per slot', () => {
  const mods: { id: string; depthByParam: Record<string, number> }[] = [
    { id: 'a', depthByParam: { 'l0.amp': 1, 'l1.amp': 0.5 } },
    { id: 'b', depthByParam: { 'l1.filter.env': 0.8 } },
  ];

  it('gives each slot its own targets, prefix stripped', () => {
    expect(subMods(mods, 0)).toEqual([{ id: 'a', depthByParam: { amp: 1 } }]);
  });

  it('keeps the depths apart when one modulator drives two slots', () => {
    const one = subMods(mods, 1);
    expect(one).toHaveLength(2);
    expect(one[0].depthByParam).toEqual({ amp: 0.5 });
    expect(one[1].depthByParam).toEqual({ 'filter.env': 0.8 });
  });

  it('drops a modulator with nothing aimed at this slot', () => {
    // Not passed through empty: a renderer handed an envelope builds one per
    // voice for it, and an envelope with no targets is a voice's worth of work
    // for nothing.
    expect(subMods(mods, 2)).toEqual([]);
  });
});

describe('the target mapper knows a slot s envelope from the lane s', () => {
  const map = makeDotIdMapper(
    [{ id: 'l0.filter.cutoff' }] as never, layerModTargets(),
  );

  it('resolves a slot s envelope to the SLOT s target', () => {
    // Order is load-bearing: `l0.amp` ends with `.amp`, so with the bare three
    // checked first every slot's envelope would collapse onto the lane's one.
    expect(map('layers-1.l0.amp')).toBe('l0.amp');
    expect(map('l0.filter.env')).toBe('l0.filter.env');
  });

  it('still resolves the lane s own', () => {
    expect(map('layers-1.amp')).toBe('amp');
  });

  it('leaves an engine with no extras exactly as it was', () => {
    expect(makeDotIdMapper([{ id: 'filter.cutoff' }] as never)('sub-1.amp')).toBe('amp');
  });
});
