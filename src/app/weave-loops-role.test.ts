// What a lane is OFFERED.
//
// Today a melodic lane is offered both bass and lead patterns, with a comment in
// weave-loops.ts that is already an apology for it: "nothing in the session says
// which of the two a given lane is meant to be and guessing would hide half the
// library". The role is that missing sentence.
import { describe, it, expect } from 'vitest';
import { sourcesFor } from './weave-loops';

describe('sourcesFor', () => {
  it('offers a drum lane percussion, whatever its role says', () => {
    // A drum lane has no role picker; a role left behind by an engine swap must
    // not hand it melodic material.
    expect(sourcesFor(undefined, false)).toEqual(['drums']);
    expect(sourcesFor('bass', false)).toEqual(['drums']);
    expect(sourcesFor('pad', false)).toEqual(['drums']);
  });

  it('offers an UNMARKED melodic lane exactly what it is offered today', () => {
    // The escape hatch: absent means nothing changes, which is why no saved
    // session has to migrate.
    expect(sourcesFor(undefined, true)).toEqual(['bass', 'synth']);
  });

  it('narrows a marked lane to its own shelf', () => {
    expect(sourcesFor('bass', true)).toEqual(['bass']);
    expect(sourcesFor('melody', true)).toEqual(['synth']);
  });

  it('gives the chordal roles no PATTERN shelf at all', () => {
    // Their material is generated rather than authored — a later task adds it as
    // a separate source. An empty shelf list is the correct answer here, not a
    // gap: there are no pad loops in the library and there never will be.
    for (const role of ['comp', 'pad', 'arp'] as const) {
      expect(sourcesFor(role, true)).toEqual([]);
    }
  });
});
