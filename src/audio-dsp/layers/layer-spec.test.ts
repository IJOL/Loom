import { describe, it, expect } from 'vitest';
import { pickLayers, subBag, subIndex, emptyLayer, type LayerSpec } from './layer-spec';

const layer = (o: Partial<LayerSpec>): LayerSpec => ({ ...emptyLayer(), engineId: 'sub', ...o });

describe('pickLayers — by zone', () => {
  const split: LayerSpec[] = [
    layer({ engineId: 'sub', lo: 0, hi: 59 }),
    layer({ engineId: 'fm', lo: 60, hi: 127 }),
  ];

  it('sends a low note to the lower layer and a high note to the upper', () => {
    expect(pickLayers(split, 40)).toEqual([0]);
    expect(pickLayers(split, 72)).toEqual([1]);
  });

  it('includes the zone boundaries — they are inclusive', () => {
    expect(pickLayers(split, 59)).toEqual([0]);
    expect(pickLayers(split, 60)).toEqual([1]);
  });

  it('sounds EVERY layer whose zone contains the note, not just the first', () => {
    // Overlapping zones are how a stack is built: bass and pad on the same
    // note is the point, not a conflict to resolve.
    const stacked = [layer({ lo: 0, hi: 127 }), layer({ engineId: 'fm', lo: 0, hi: 127 })];
    expect(pickLayers(stacked, 64)).toEqual([0, 1]);
  });

  it('skips a slot the user never filled', () => {
    const half = [layer({}), emptyLayer()];
    expect(pickLayers(half, 64)).toEqual([0]);
  });

  it('a note outside every zone sounds nothing', () => {
    const narrow = [layer({ lo: 60, hi: 64 })];
    expect(pickLayers(narrow, 30)).toEqual([]);
  });
});

describe('pickLayers — by index', () => {
  const two = [layer({ engineId: 'sub', lo: 0, hi: 59 }), layer({ engineId: 'fm', lo: 60, hi: 127 })];

  it('overrides the zone completely', () => {
    // A low note aimed at the upper layer goes there. This is what lets a
    // crossfade drive the instrument without the instrument knowing why.
    expect(pickLayers(two, 40, 1)).toEqual([1]);
    expect(pickLayers(two, 100, 0)).toEqual([0]);
  });

  it('picks exactly one layer, never a stack', () => {
    const stacked = [layer({}), layer({ engineId: 'fm' })];
    expect(pickLayers(stacked, 64, 0)).toEqual([0]);
  });

  it('an index out of range sounds NOTHING rather than falling back to zones', () => {
    // Silence is a bug you find. A note that quietly plays on the wrong
    // instrument is one you ship.
    expect(pickLayers(two, 64, 7)).toEqual([]);
    expect(pickLayers(two, 64, -1)).toEqual([]);
  });

  it('an index pointing at an empty slot sounds nothing', () => {
    expect(pickLayers([layer({}), emptyLayer()], 64, 1)).toEqual([]);
  });
});

describe('per-layer params', () => {
  const bag = { 'l0.filter.cutoff': 800, 'l1.filter.cutoff': 4000, 'l0.osc.wave': 1, mix: 0.5 };

  it('hands each layer its own values under the names its engine knows', () => {
    expect(subBag(bag, 0)).toEqual({ 'filter.cutoff': 800, 'osc.wave': 1 });
    expect(subBag(bag, 1)).toEqual({ 'filter.cutoff': 4000 });
  });

  it('drops what belongs to the lane rather than to a layer', () => {
    // Two layers on the same engine must be able to differ; one shared bag
    // would make the second a copy of the first forever.
    expect(subBag(bag, 0)).not.toHaveProperty('mix');
  });

  it('translates the slot numbering without copying the values', () => {
    const index = { slot: { 'l0.filter.cutoff': 3, 'l1.filter.cutoff': 9, mix: 0 }, length: 12 };
    const sub = subIndex(index, 1);
    expect(sub.slot['filter.cutoff']).toBe(9);
    // Same length: the layer reads the LANE's array, at a translated position.
    // A shortened array would be a copy, and a copy is a knob that goes dead.
    expect(sub.length).toBe(12);
  });

  it('a layer with no params of its own resolves nothing rather than everything', () => {
    const index = { slot: { 'l0.filter.cutoff': 3 }, length: 4 };
    expect(subIndex(index, 2).slot).toEqual({});
  });
});
