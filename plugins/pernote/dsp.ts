// plugins/pernote/dsp.ts
// Per-Note: every note gets its own value, and the same note always gets the
// same one. A driver:'trigger' modulator — it is a function of WHICH note this
// is, not of the clock, so `t` is unused and the value never moves during a
// note.
//
// The maths is `frac(n × Pattern + Skew)` and it lives in the SDK
// (`dsp/pattern`), not here. The host's note generator wants the same formula
// for the same reason — one knob from strict periodicity to apparent chaos over
// an ordinal — and it cannot import a plugin any more than a plugin can import
// the host. Two copies would be free to disagree about what Pattern 0.618
// means, which is a difference nobody would think to look for.
//
// What is left here is this modulator's IDENTITY: which ordinal it reads (the
// note's), and the polarity convention it shares with S&H.
//
// PURE by construction: the ordinal arrives as an argument. The counting lives
// in VoiceManager, which is allowed to remember things; a kernel is not, or an
// offline export would drift from what you heard.
//
// There is deliberately no Amount knob, though Karst's version has one: every
// modulation connection in Loom already carries its own depth, and a second
// depth inside the modulator would be the same control twice.

import {
  patternValue, patternValueBipolar, GOLDEN_PATTERN,
} from '@loom/plugin-sdk';

Loom.registerModulatorKernel({
  id: 'pernote',
  valueAt(m, _t, _origin, triggerIndex) {
    const n = triggerIndex ?? 0;
    const pattern = m.params?.pattern ?? GOLDEN_PATTERN;
    const skew = m.params?.skew ?? 0;
    // Unipolar leaves it 0..1 so the target only ever moves one way from where
    // you set it; bipolar centres it so a note can land under the knob as well
    // as over it. Same convention as S&H: 0 means unipolar.
    return m.params?.bipolar === 0
      ? patternValue(n, pattern, skew)
      : patternValueBipolar(n, pattern, skew);
  },
});
