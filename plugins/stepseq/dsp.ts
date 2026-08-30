// plugins/stepseq/dsp.ts
// Step sequencer modulator: a drawn row of 2..16 values (0..1), walked at
// `rate` steps per second from the phase origin the runtime resolved
// (shared/free = transport start, per-voice = that voice's start). PURE by
// construction — the step index is arithmetic over (t - origin), never a
// counter, so the offline render and the live one agree exactly.
//
// `glide` crossfades the LAST `glide` fraction of each step into the next
// one's value: 0 is a hard gate, 1 turns the row into a looping polyline.
// Polarity is applied at the OUTPUT — the drawn values stay 0..1, which is
// what the editor paints and what the bag stores.

/** Hoisted step keys — building `step${i}` per call would allocate a string
 *  on the audio thread every sample. */
const STEP_IDS = [
  'step0', 'step1', 'step2', 'step3', 'step4', 'step5', 'step6', 'step7',
  'step8', 'step9', 'step10', 'step11', 'step12', 'step13', 'step14', 'step15',
] as const;

const clamp01 = (v: number): number => Math.max(0, Math.min(1, v));

Loom.registerModulatorKernel({
  id: 'stepseq',
  valueAt(m, t, origin) {
    const p = m.params;
    const rate = p?.rate ?? 8;
    const n = Math.max(2, Math.min(16, Math.round(p?.steps ?? 8)));
    const glide = clamp01(p?.glide ?? 0);
    const dt = t - origin;
    const pos = dt <= 0 ? 0 : dt * rate;
    const base = Math.floor(pos);
    const i = base % n;
    const a = clamp01(p?.[STEP_IDS[i]] ?? 0);
    let v = a;
    if (glide > 0) {
      const frac = pos - base;
      const start = 1 - glide;
      if (frac > start) {
        const b = clamp01(p?.[STEP_IDS[(i + 1) % n]] ?? 0);
        v = a + (b - a) * ((frac - start) / glide);
      }
    }
    return (p?.bipolar ?? 0) !== 0 ? v * 2 - 1 : v;
  },
});

// A module, not a global script — dsp.ts and main.ts each hoist their own
// STEP_IDS, and only module scope keeps the two from colliding under tsc.
export {};
