// One knob that slides from strict periodicity to apparent chaos, without ever
// being random.
//
//     value = frac(n × pattern + skew)
//
// `n` is an ORDINAL — which note this is, which step of a bar this is, which
// leg of a journey. `pattern` is the whole instrument: at 0.5 the value
// alternates, at 0.25 it cycles every four, and at an irrational it spreads
// evenly and never repeats. An LFO cannot do this, because an LFO always has a
// period.
//
// It is NOT random, and that is the point rather than a limitation. A random
// value gives a different take every pass; this gives the SAME take every pass
// and still never settles. For anything you intend to record, that difference
// is everything.
//
// Pure by construction: the ordinal arrives as an argument. Whatever counts it
// is allowed to remember — `VoiceManager` does, a read head does — but this is
// not, or an offline export would drift from what was heard.
//
// It lives in the SDK rather than in `src/` because two realms need it and
// neither can import the other. `plugins/pernote` compiles against this package
// and cannot reach the host's source at all; the host's note generator reaches
// it the way it reaches every other SDK primitive, through a one-line re-export
// in `src/audio-dsp/`. Written twice instead, the two would drift, and a
// modulator and a generator disagreeing about what Pattern 0.618 means is a
// difference nobody would think to look for.

/** The golden ratio's conjugate, at full precision on purpose.
 *
 *  A short decimal like 0.618 is a RATIONAL — 309/500 — and every rational
 *  cycles, here after exactly 500 steps. The irrational never does, which is
 *  what makes it the honest default for "spread these out and do not repeat". */
export const GOLDEN_PATTERN = (Math.sqrt(5) - 1) / 2;

/** `frac(n × pattern + skew)`, in 0..1.
 *
 *  `Math.floor` rather than a bitwise truncation, for two reasons that both
 *  bite in practice: an ordinal outruns 32 bits in a long session, and
 *  truncation folds negatives the wrong way. */
export function patternValue(n: number, pattern = GOLDEN_PATTERN, skew = 0): number {
  if (!Number.isFinite(n) || !Number.isFinite(pattern) || !Number.isFinite(skew)) return 0;
  const x = n * pattern + skew;
  return x - Math.floor(x);
}

/** The same value centred on zero, in -1..1.
 *
 *  Unipolar leaves a target moving one way from where you set it; bipolar lets
 *  it land under the knob as well as over it. Which one a modulator wants is a
 *  property of the patch, so both are offered rather than one being derived at
 *  every call site — that is how a sign convention ends up disagreeing with
 *  itself across two files. */
export function patternValueBipolar(n: number, pattern = GOLDEN_PATTERN, skew = 0): number {
  return patternValue(n, pattern, skew) * 2 - 1;
}
