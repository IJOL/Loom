// plugins/pernote/dsp.ts
// Per-Note: every note gets its own value, and the same note always gets the
// same one. A driver:'trigger' modulator — it is a function of WHICH note this
// is, not of the clock, so `t` is unused and the value never moves during a
// note.
//
// The maths is one line: take the note's ordinal, multiply, keep the fraction.
//
//     value = frac(n × Pattern + Skew)
//
// Pattern is the whole instrument. At 0.5 the value alternates; at 0.25 it
// cycles every four notes; at an irrational-ish 0.618 it spreads evenly and
// takes hundreds of notes to repeat. One knob slides continuously
// from strict periodicity to apparent chaos, which is the thing an LFO cannot
// do — an LFO always has a period.
//
// It is NOT random. A random value gives a different take every pass; this
// gives the same take every pass and still never settles. For anything you
// intend to record, that difference is the whole point.
//
// PURE by construction: the ordinal arrives as an argument. The counting lives
// in VoiceManager, which is allowed to remember things; a kernel is not, or an
// offline export would drift from what you heard.
//
// There is deliberately no Amount knob, though Karst's version has one: every
// modulation connection in Loom already carries its own depth, and a second
// depth inside the modulator would be the same control twice.

// The default: the golden ratio's conjugate, at full precision on purpose. A
// short decimal like 0.618 is a rational — 309/500 — and every rational cycles,
// here after exactly 500 notes. The irrational never does.
const GOLDEN = (Math.sqrt(5) - 1) / 2;

Loom.registerModulatorKernel({
  id: 'pernote',
  valueAt(m, _t, _origin, triggerIndex) {
    const n = triggerIndex ?? 0;
    const pattern = m.params?.pattern ?? GOLDEN;
    const skew = m.params?.skew ?? 0;
    const x = n * pattern + skew;
    // Math.floor, not a bitwise truncation: the ordinal can outrun 32 bits in a
    // long session, and truncation would also fold negatives the wrong way.
    const v = x - Math.floor(x);
    // Unipolar leaves it 0..1 so the target only ever moves one way from where
    // you set it; bipolar centres it so a note can land under the knob as well
    // as over it. Same convention as S&H: 0 means unipolar.
    return m.params?.bipolar === 0 ? v : v * 2 - 1;
  },
});
