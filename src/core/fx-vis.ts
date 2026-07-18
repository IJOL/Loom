// A tiny picture of what each insert is doing, drawn from its live params.
//
// Idea from mpump's EffectEditor, which draws the ducking curve with a "kick"
// mark and the delay's taps at mix·feedback^i. The value is that a glance tells
// you what the knobs added up to — a delay with feedback 0.8 LOOKS different
// from one at 0.2, before you play a note.
//
// Pure geometry: every function returns SVG path data in a fixed 100×32 box, so
// the shapes are unit-testable without a DOM.

export const VIS_W = 100;
export const VIS_H = 32;

/** Reads a live param off the effect. Missing params fall back to 0. */
export type ParamReader = (id: string) => number;

export interface FxVis {
  /** Filled path (an area under a curve), if the shape has one. */
  area?: string;
  /** Stroked path — the curve or the tap stems. */
  line: string;
}

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
/** y for a 0..1 level, flipped so 1 is the top with a 2px margin. */
const y = (level: number) => VIS_H - 2 - clamp01(level) * (VIS_H - 4);

/** Delay: discrete taps, each one feedback× shorter than the last.
 *
 *  Drawn NORMALISED — the first tap always reaches the top — so the picture
 *  shows the DECAY SHAPE, which is what feedback means. Absolute level would
 *  just restate the wet knob, and at a normal wet the later taps collapsed into
 *  invisible 2px ticks that communicated nothing. */
function delayVis(p: ParamReader): FxVis {
  const fb = clamp01(p('feedback'));
  let d = '';
  for (let i = 0; i < 6; i++) {
    const x = 8 + i * 15;
    const level = Math.pow(fb, i);
    if (level < 0.06) break;                    // past here it is inaudible anyway
    d += `M${x} ${VIS_H - 2}L${x} ${y(Math.max(level, 0.15))}`;
  }
  // A floor line, so the stems read as bars standing on something.
  return { line: d, area: `M2 ${VIS_H - 2}L${VIS_W - 2} ${VIS_H - 2}L${VIS_W - 2} ${VIS_H - 1}L2 ${VIS_H - 1}Z` };
}

/** Reverb: an exponential tail. A longer decay reaches further right. */
function reverbVis(p: ParamReader): FxVis {
  const size = Math.max(0.05, p('size'));
  const decay = Math.max(0.1, p('decay'));
  // Normalise so the drawn tail length tracks size, and its droop tracks decay.
  const k = decay / Math.max(1, size) * 1.2;
  let line = `M2 ${y(1)}`;
  for (let i = 1; i <= 24; i++) {
    const t = i / 24;
    line += `L${2 + t * (VIS_W - 4)} ${y(Math.exp(-k * t * 3))}`;
  }
  return { line, area: `${line}L${VIS_W - 2} ${VIS_H - 2}L2 ${VIS_H - 2}Z` };
}

/** Tremolo / gate: one cycle of the LFO at its current shape and depth. */
function tremoloVis(p: ParamReader): FxVis {
  const depth = clamp01(p('depth'));
  const shape = Math.round(p('shape'));
  const base = 1 - depth / 2;
  const swing = depth / 2;
  const wave = (t: number): number => {
    const ph = (t * 2) % 1;                       // two cycles across the box
    if (shape === 1) return ph < 0.5 ? 1 : -1;                     // square
    if (shape === 2) return 1 - 4 * Math.abs(ph - 0.5);            // triangle
    if (shape === 3) return 2 * ph - 1;                            // saw
    return Math.sin(ph * Math.PI * 2);                             // sine
  };
  let line = '';
  for (let i = 0; i <= 48; i++) {
    const t = i / 48;
    const v = base + wave(t) * swing;
    line += `${i === 0 ? 'M' : 'L'}${2 + t * (VIS_W - 4)} ${y(v)}`;
  }
  return { line };
}

/** Filter: the rough magnitude shape of the selected response. */
function multifilterVis(p: ParamReader): FxVis {
  const type = Math.round(p('type'));
  // Map 20..20000 Hz logarithmically onto the box width.
  const fx = clamp01(Math.log(Math.max(20, p('freq')) / 20) / Math.log(1000));
  const q = Math.max(0.1, p('q'));
  const bump = Math.min(0.35, (q - 0.7) * 0.05);
  const mag = (t: number): number => {
    const d = t - fx;
    switch (type) {
      case 1:  return clamp01(0.5 + d * 6) + (Math.abs(d) < 0.08 ? bump : 0);   // highpass
      case 2:  return clamp01(1 - Math.abs(d) * 6) + bump;                      // bandpass
      case 3:  return clamp01(Math.min(1, Math.abs(d) * 8));                    // notch
      default: return clamp01(0.5 - d * 6) + (Math.abs(d) < 0.08 ? bump : 0);   // lowpass
    }
  };
  let line = '';
  for (let i = 0; i <= 40; i++) {
    const t = i / 40;
    line += `${i === 0 ? 'M' : 'L'}${2 + t * (VIS_W - 4)} ${y(mag(t) * 0.9)}`;
  }
  return { line };
}

/** Compressor / limiter: the input→output transfer curve, with its knee. */
function compressorVis(p: ParamReader): FxVis {
  const thrDb = p('threshold');
  const ratio = Math.max(1, p('ratio'));
  const thr = clamp01((thrDb + 60) / 60);       // -60..0 dB across the box
  let line = '';
  for (let i = 0; i <= 40; i++) {
    const t = i / 40;
    const out = t <= thr ? t : thr + (t - thr) / ratio;
    line += `${i === 0 ? 'M' : 'L'}${2 + t * (VIS_W - 4)} ${y(out)}`;
  }
  return { line };
}

/** Distortion: the waveshaping transfer curve. More drive, more bend. */
function distortionVis(p: ParamReader): FxVis {
  const drive = Math.max(0, p('drive'));
  const k = 1 + drive * 0.6;
  let line = '';
  for (let i = 0; i <= 40; i++) {
    const t = i / 40;
    const x = t * 2 - 1;
    const shaped = Math.tanh(x * k) / Math.tanh(k);
    line += `${i === 0 ? 'M' : 'L'}${2 + t * (VIS_W - 4)} ${y((shaped + 1) / 2)}`;
  }
  return { line };
}

/** Bitcrusher: the quantization staircase. Fewer bits, coarser steps. */
function bitcrusherVis(p: ParamReader): FxVis {
  const bits = Math.max(1, Math.min(6, p('bits')));   // past ~6 the steps vanish
  const levels = Math.max(2, Math.pow(2, bits));
  let line = '';
  for (let i = 0; i <= 60; i++) {
    const t = i / 60;
    const q = Math.round(t * (levels - 1)) / (levels - 1);
    line += `${i === 0 ? 'M' : 'L'}${2 + t * (VIS_W - 4)} ${y(q)}`;
  }
  return { line };
}

const BUILDERS: Record<string, (p: ParamReader) => FxVis> = {
  delay: delayVis,
  reverb: reverbVis,
  tremolo: tremoloVis,
  multifilter: multifilterVis,
  compressor: compressorVis,
  limiter: compressorVis,
  distortion: distortionVis,
  bitcrusher: bitcrusherVis,
};

/** Build the shape for an effect, or null if it has no picture worth drawing
 *  (chorus/flanger/phaser are motion, and a still frame says nothing useful). */
export function buildFxVis(fxId: string, read: ParamReader): FxVis | null {
  const b = BUILDERS[fxId];
  return b ? b(read) : null;
}

export function hasFxVis(fxId: string): boolean {
  return fxId in BUILDERS;
}
