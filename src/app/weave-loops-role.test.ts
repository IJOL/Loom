// What a lane is OFFERED.
//
// Today a melodic lane is offered both bass and lead patterns, with a comment in
// weave-loops.ts that is already an apology for it: "nothing in the session says
// which of the two a given lane is meant to be and guessing would hide half the
// library". The role is that missing sentence.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { sourcesFor, rootFor } from './weave-loops';

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

describe('rootFor', () => {
  it('keeps the parts apart, low to high', () => {
    // The ORDER is the requirement; the numbers are a starting point to be
    // adjusted by ear. Asserted as an order so tuning them does not break it.
    const k = 9;
    expect(rootFor('bass', undefined, k)).toBeLessThan(rootFor('pad', undefined, k));
    expect(rootFor('pad', undefined, k)).toBeLessThan(rootFor('comp', undefined, k));
    expect(rootFor('comp', undefined, k)).toBeLessThan(rootFor('melody', undefined, k));
  });

  it('leaves an UNMARKED lane exactly where it has always been', () => {
    // The fallback that matters: an unmarked lane playing a bass pattern has
    // always sat at 36. Answering 48 for it would lift every existing session's
    // bass loops an octave — the one thing an optional mark must never do.
    expect(rootFor(undefined, 'bass', 0)).toBe(36);
    expect(rootFor(undefined, 'synth', 0)).toBe(48);
    expect(rootFor(undefined, 'drums', 0)).toBe(48);
  });

  it('lets the ROLE overrule the pattern it happens to be playing', () => {
    expect(rootFor('melody', 'bass', 0)).toBe(60);
  });

  it('keeps every role within half an octave of its base', () => {
    // The nearest tonic, never the one above: adding the key outright walks the
    // whole shelf upwards, which is the bug reported as "nunca pones bajos que
    // suenen a bajos".
    for (let key = 0; key < 12; key++) {
      expect(Math.abs(rootFor('bass', undefined, key) - 36)).toBeLessThanOrEqual(6);
      expect(Math.abs(rootFor(undefined, 'synth', key) - 48)).toBeLessThanOrEqual(6);
    }
  });
});

describe('one answer, not four', () => {
  // Grep IS the test, and it is the only kind that can hold this. Each of these
  // was a separate answer to "what part is this lane", and two of them were an
  // `engineId === '…'` in the core, which the project forbids. Nothing about the
  // BEHAVIOUR of the code left behind would notice one of them creeping back in
  // beside the door — only its absence says the round did what it claimed.
  const src = (p: string) => readFileSync(new URL(p, import.meta.url), 'utf8');

  it('has retired patternKindFor and patternRootFor', () => {
    const f = src('../patterns/pattern-picker-ui.ts');
    expect(f).not.toContain('patternKindFor');
    expect(f).not.toContain('patternRootFor');
  });

  it('has retired genKindFor', () => {
    expect(src('../session/session-inspector.ts')).not.toContain('genKindFor');
  });

  it('leaves no engine-id comparison in either file', () => {
    // What the three had in common, and the reason they could not simply be
    // moved: the core is not allowed to know a plugin's name.
    for (const p of ['../patterns/pattern-picker-ui.ts', '../session/session-inspector.ts']) {
      expect(src(p)).not.toMatch(/engineId === '/);
    }
  });
});
