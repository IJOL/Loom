import { describe, it, expect } from 'vitest';
import { formatLoopId, parseLoopId, type LoopId } from './loop-ids';

const round = (l: LoopId) => parseLoopId(formatLoopId(l));

describe('loop ids', () => {
  it('round-trips a clip', () => {
    const l: LoopId = { source: 'clip', clipId: 'clip-7' };
    expect(round(l)).toEqual(l);
  });

  it('round-trips a library pattern', () => {
    const l: LoopId = { source: 'pattern', style: 'acid-techno', kind: 'bass', index: 12 };
    expect(round(l)).toEqual(l);
  });

  it('keeps a clip id that contains colons', () => {
    // Clip ids are generated, not curated. Splitting from the left would cut
    // one in half and resolve to nothing.
    const l: LoopId = { source: 'clip', clipId: 'a:b:c' };
    expect(round(l)).toEqual(l);
  });

  it('keeps a style id that contains a colon', () => {
    const l: LoopId = { source: 'pattern', style: 'x:y' as never, kind: 'drums', index: 0 };
    expect(round(l)).toEqual(l);
  });

  it('refuses a malformed id rather than guessing', () => {
    // A save from a future build must fail to resolve, not resolve to the
    // WRONG loop — the caller already substitutes what it cannot find.
    expect(parseLoopId('lib:acid-techno:bass')).toBeNull();
    expect(parseLoopId('lib:acid-techno:trumpet:1')).toBeNull();
    expect(parseLoopId('lib:acid-techno:bass:-1')).toBeNull();
    expect(parseLoopId('lib:acid-techno:bass:x')).toBeNull();
    expect(parseLoopId('clip:')).toBeNull();
    expect(parseLoopId('something-else')).toBeNull();
  });
});

describe('the chord source', () => {
  // Chordal material is GENERATED, so it is a new SOURCE rather than a new
  // PatternKind. That matters more than it looks: PATTERN_KINDS above is a
  // hand-maintained array and `PatternKind[]` accepts a subset, so adding a
  // kind to the union typechecks SILENTLY and then every id of it fails to
  // parse — the loop shows in the dropdown and plays nothing.

  it('round-trips a shape', () => {
    const id = formatLoopId({ source: 'chord', shape: 'sustained' });
    expect(parseLoopId(id)).toEqual({ source: 'chord', shape: 'sustained' });
  });

  it('refuses a shape that does not exist', () => {
    expect(parseLoopId('chord:nope')).toBeNull();
    expect(parseLoopId('chord:')).toBeNull();
  });

  it('does not swallow a clip whose id starts with chord', () => {
    const id = formatLoopId({ source: 'clip', clipId: 'chordal-1' });
    expect(parseLoopId(id)).toEqual({ source: 'clip', clipId: 'chordal-1' });
  });
});
