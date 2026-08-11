// The pad shelf. Generated, never authored — a chord written as fixed semitones
// cannot stay diatonic across the scales a session may be in, so these are
// written in scale DEGREES and are in key by construction, in every key.
import { describe, it, expect } from 'vitest';
import { PAD_LOOPS, isPadLoop, padLoop, renderPadLoop } from './pad-loops';
import { CHORD_SHAPES } from './chord-rhythms';
import { inScale } from './musicality';
import { TICKS_PER_STEP } from './notes';

const BAR = TICKS_PER_STEP * 16;
const OPTS = { key: 9, scale: 'minor' as const, octaveBase: 48, barTicks: BAR };

/** How many notes sound at `step`. */
const voicesAt = (id: string, step: number) =>
  renderPadLoop(id, OPTS).filter((n) => {
    const at = step * TICKS_PER_STEP;
    return n.start <= at && n.start + n.duration > at;
  }).length;

describe('the shelf', () => {
  it('offers more than the five rhythms it grew out of', () => {
    // The whole point of the round: five bare rhythms on one triad was a
    // template, not a shelf.
    expect(PAD_LOOPS.length).toBeGreaterThan(CHORD_SHAPES.length);
  });

  it('keeps the five original ids, so a saved lane still resolves', () => {
    for (const s of CHORD_SHAPES) expect(isPadLoop(s.id)).toBe(true);
  });

  it('gives every loop an id and a label', () => {
    for (const p of PAD_LOOPS) {
      expect(p.id).toBeTruthy();
      expect(p.label).toBeTruthy();
      expect(p.hits.length).toBeGreaterThan(0);
    }
  });

  it('has no two loops under one id', () => {
    expect(new Set(PAD_LOOPS.map((p) => p.id)).size).toBe(PAD_LOOPS.length);
  });

  it('recognises its own ids and refuses anything else', () => {
    // The guard behind the loop id. An id that parses but does not exist is a
    // loop that shows in the dropdown and plays silence.
    expect(isPadLoop('nope')).toBe(false);
    expect(isPadLoop('toString')).toBe(false);   // not an inherited property
    expect(padLoop('nope')).toBeUndefined();
  });
});

describe('rendering one', () => {
  it('puts every note in the scale, whatever the loop', () => {
    for (const p of PAD_LOOPS) {
      const notes = renderPadLoop(p.id, OPTS);
      expect(notes.length).toBeGreaterThan(0);
      for (const n of notes) expect(inScale(n.midi, OPTS.key, OPTS.scale)).toBe(true);
    }
  });

  it('stays in the scale in EVERY scale, which is why it is generated', () => {
    // A stack of fixed semitones cannot be diatonic in minor and major at once,
    // and the scale is chosen per session. Built from degrees, it simply is.
    for (const scale of ['minor', 'major', 'pentMinor', 'dorian'] as const) {
      for (const key of [0, 5, 9]) {
        for (const p of PAD_LOOPS) {
          for (const n of renderPadLoop(p.id, { ...OPTS, key, scale })) {
            expect(inScale(n.midi, key, scale)).toBe(true);
          }
        }
      }
    }
  });

  it('stays inside ONE bar, because the blend folds by position within a bar', () => {
    for (const p of PAD_LOOPS) {
      for (const n of renderPadLoop(p.id, OPTS)) {
        expect(n.start).toBeGreaterThanOrEqual(0);
        expect(n.start + n.duration).toBeLessThanOrEqual(BAR);
      }
    }
  });

  it('renders on the TONIC, so the progression can move it', () => {
    // Library loops are written on one chord and moved per bar by
    // applyProgression. A loop that pre-applied a chord would be moved twice.
    for (const p of PAD_LOOPS) {
      const root = Math.min(...renderPadLoop(p.id, OPTS).map((n) => n.midi));
      expect(((root % 12) + 12) % 12).toBe((((OPTS.octaveBase + OPTS.key) % 12) + 12) % 12);
    }
  });

  it('accents the downbeat, the way the comping generator already does', () => {
    const notes = renderPadLoop('offbeat', OPTS);
    expect(notes[0].velocity).toBeGreaterThan(notes[notes.length - 1].velocity);
  });

  it('returns nothing for a loop that does not exist', () => {
    expect(renderPadLoop('nope', OPTS)).toEqual([]);
  });
});

describe('what makes it a pad shelf and not five rhythms', () => {
  it('sustains the plain pad for the whole bar', () => {
    // If this stops being one hit of a full bar, the pad role has quietly
    // become something else.
    const notes = renderPadLoop('sustained', OPTS);
    expect(notes).toHaveLength(3);
    for (const n of notes) expect(n.duration).toBe(BAR);
  });

  it('offers chords past the plain triad', () => {
    // A shelf where every loop is the same three notes is a shelf of rhythms.
    const sizes = PAD_LOOPS.map((p) => new Set(renderPadLoop(p.id, OPTS).map((n) => n.midi)).size);
    expect(Math.max(...sizes)).toBeGreaterThan(3);
  });

  it('opens out across the bar on Rise', () => {
    // Voices ENTER: one at the downbeat, four by the last quarter. No
    // rhythm-only shape can say this — it needs voices per hit.
    expect(voicesAt('rise', 0)).toBe(1);
    expect(voicesAt('rise', 14)).toBe(4);
  });

  it('thins out across the bar on Fall', () => {
    expect(voicesAt('fall', 0)).toBe(4);
    expect(voicesAt('fall', 14)).toBe(1);
  });

  it('changes chord half way through Half Swell', () => {
    // Two halves that are not the same chord — the second opens the triad into
    // a seventh, which is the gesture the five bare rhythms could not make.
    const first = new Set(renderPadLoop('swell', OPTS).filter((n) => n.start === 0).map((n) => n.midi));
    const second = new Set(
      renderPadLoop('swell', OPTS).filter((n) => n.start === BAR / 2).map((n) => n.midi),
    );
    expect(second.size).toBeGreaterThan(first.size);
  });

  it('holds a bed under the moving voices on Breathing', () => {
    // Something sounds at every step of the bar, which is what makes it a pad
    // rather than a stab: a gap would be heard as the lane dropping out.
    for (let s = 0; s < 16; s++) expect(voicesAt('breathe', s)).toBeGreaterThan(0);
  });

  it('leaves the third out of Hollow Fifths', () => {
    // The one voicing that is defined by what it does NOT play; a shelf that
    // always rendered the triad could not have it.
    expect(new Set(renderPadLoop('fifths', OPTS).map((n) => n.midi)).size).toBe(2);
  });
});
