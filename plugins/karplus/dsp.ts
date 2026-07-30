// plugins/karplus/dsp.ts
// Pure per-sample Karplus-Strong renderer, running inside the AudioWorklet (and
// on the main thread for offline render).
//
// LIVE vs FROZEN: the excitation burst (the pluck itself) is over within a few
// tens of milliseconds, so `excite.time`/`excite.tone` and the amp envelope's
// `attack`/`release`/`builtinEnv` are read once at trigger — by the time anyone
// could turn a knob, that part of the sound has already happened. But the
// STRING'S resonance is not a photograph: `string.damping` (decay rate) and
// `string.brightness` (loop tone) now drive a real per-sample delay-line loop
// (KsLoop below) instead of a bulk-precomputed buffer, so turning them moves
// the note ALREADY ringing — exactly like a real Karplus-Strong patch's tone
// and decay controls. `amp.level` and `output.trim` are live too (pure output
// scalars). Delay-line LENGTH is sized once at trigger from the initial
// brightness (pitch is structural); only the loop's one-pole coefficient and
// feedback gain move live, so an extreme brightness sweep can drift the pitch
// by a fraction of a sample — an accepted trade-off of a real analogue-style
// tone control living inside the resonator, not a bug.
import { param, midiToFreq, velGain01, ModEnvHost } from '@loom/plugin-sdk';
import type { NoteSpec, ParamBag, VoiceRenderer, VoiceModOffsets, ModLite } from '@loom/plugin-sdk';

const DC_R = 0.997;   // DC-blocker pole (one-pole high-pass)

/** One-pole loop filter → delay line → feedback gain → DC blocker, run one
 *  sample at a time. `Li`/`frac`/`dlSize` (the delay LENGTH) are fixed for the
 *  lifetime of a loop instance — only `a` (brightness) and `g` (damping) vary
 *  per call, which is what lets the string's tone and decay move live. */
class KsLoop {
  private readonly dl: Float32Array;
  private widx = 0;
  private lp = 0;
  private dcX = 0;
  private dcY = 0;

  constructor(private readonly Li: number, private readonly frac: number, dlSize: number) {
    this.dl = new Float32Array(dlSize);
  }

  step(exc: number, a: number, g: number): number {
    const dl = this.dl, dlSize = dl.length;
    const i0 = (this.widx - this.Li + dlSize) % dlSize;
    const i1 = (i0 - 1 + dlSize) % dlSize;
    const read = dl[i0] * (1 - this.frac) + dl[i1] * this.frac;
    this.lp += a * (read - this.lp);
    const s = exc + g * this.lp;
    dl[this.widx] = s;
    this.widx = this.widx + 1 === dlSize ? 0 : this.widx + 1;
    // DC blocker (one-pole high-pass) so the random burst leaves no subsonic
    // offset to thump the amp. Purely causal — same result inline or as a
    // separate pass over the whole buffer.
    const y = s - this.dcX + DC_R * this.dcY;
    this.dcX = s; this.dcY = y;
    return y;
  }
}

/** Loop low-pass coefficient from brightness (one-pole y += a·(x−y)):
 *  0.15 ≈ 1 kHz cutoff (dark) … 0.95 ≈ 20 kHz (open/metallic). */
function aFromBrightness(brightness: number): number {
  return 0.15 + brightness * 0.80;
}

/** Loop feedback gain from damping. A FIXED loop gain makes the 60 dB decay
 *  time T60 ∝ 1/freq (amp(t) = g^(freq·t)), so high notes die far too fast —
 *  C6 collapses in ~0.1s, unmusical and leaving the top of the register
 *  near-silent. Instead choose g PER NOTE so T60 is set by damping and is
 *  ~constant across the register: solve g^(freq·T60) = 1e-3 for g.
 *    damping 0 → T60 ≈ 4.0s (long sustain)   damping 1 → T60 ≈ 0.12s (muted) */
function gFromDamping(damping: number, freq: number): number {
  const t60 = 4.0 * Math.pow(0.03, damping);
  return Math.min(0.9995, Math.exp(Math.log(1e-3) / (Math.max(20, freq) * t60)));
}

export class KarplusRenderer implements VoiceRenderer {
  private sr: number;
  private begin: number;
  private holdEnd: number;
  private atk: number;
  private rel: number;
  private levelBase: number;
  private ampEnvOn: boolean;
  private vel: number;
  /** Per-preset output trim (gain-staging "preset.trim" — params['output.trim'],
   *  default 1). */
  private trimBase: number;
  private dampingBase: number;
  private brightnessBase: number;
  private freq: number;
  // Excitation burst — frozen: the pluck is over by the time a knob can move.
  private readonly excBurst: Float32Array;
  private readonly exciteLen: number;
  private readonly totalSamples: number;
  // Fixed headroom scalar, derived once from a dry run at the trigger-time
  // snapshot (see the constructor) so a single note can never clip regardless
  // of the resonance the live knobs later dial in.
  private readonly normGain: number;
  // The REAL playback loop — persistent per-sample state, live coefficients.
  private readonly loop: KsLoop;
  // Cached expensive conversion: gFromDamping (pow+exp+log) is not a
  // per-sample cost while the damping knob is settled.
  private dampRaw = NaN;
  private gCache = 0;
  private modEnv = new ModEnvHost();
  /** The lane's live (smoothed) knob bag, or null when this voice runs standalone
   *  (the offline kernel builds renderers directly). */
  private live: ParamBag | null = null;
  done = false;

  /** `rng` is a test seam: production never passes it, so the excitation stays
   *  Math.random and every pluck differs, as a plucked string should. */
  constructor(note: NoteSpec, p: ParamBag, sampleRate: number, rng?: () => number) {
    const fs = this.sr = sampleRate;
    this.begin = note.beginSec;
    this.holdEnd = note.beginSec + note.durationSec;
    this.atk = Math.max(0.001, param(p, 'amp.attack', 0.005));
    this.rel = Math.max(0.05, param(p, 'amp.release', 0.5));
    this.levelBase = param(p, 'amp.level', 0.8);
    this.ampEnvOn = param(p, 'amp.builtinEnv', 1) >= 0.5;
    this.trimBase = param(p, 'output.trim', 1);
    this.dampingBase = param(p, 'string.damping', 0.5);
    this.brightnessBase = param(p, 'string.brightness', 0.65);
    this.vel = velGain01(note.velocity, note.accent);
    this.freq = midiToFreq(note.midi);

    // Frozen structural sizing: the delay-line LENGTH is set once from the
    // initial brightness (its low-frequency group delay compensates so the
    // loop resonates at the true pitch) and never resized mid-note.
    const a0 = aFromBrightness(this.brightnessBase);
    const period = fs / Math.max(20, this.freq);
    const Ldelay = Math.max(1, period - (1 - a0) / a0);
    const Li = Math.floor(Ldelay);
    const frac = Ldelay - Li;
    const dlSize = Li + 2;

    // Excitation: a band-limited white-noise burst whose colour is set by
    // noiseTone (200 Hz dark … 12 kHz bright), with a short raised-cosine
    // fade-out so the burst's end doesn't click. Generated once — frozen.
    this.totalSamples = Math.max(1, Math.round(
      Math.min(8, Math.max(0.4, note.durationSec + this.rel + 0.3)) * fs,
    ));
    const exciteDur = Math.max(0.001, param(p, 'excite.time', 0.01));
    const noiseTone = param(p, 'excite.tone', 0.5);
    this.exciteLen = Math.min(this.totalSamples, Math.max(4, Math.round(exciteDur * fs)));
    const noiseHz = Math.min(fs * 0.45, 200 * Math.pow(60, noiseTone));
    const na = 1 - Math.exp(-2 * Math.PI * noiseHz / fs);
    const gen = rng ?? Math.random;
    const excBurst = new Float32Array(this.exciteLen);
    const FADE = 32;
    let nlp = 0;
    for (let n = 0; n < this.exciteLen; n++) {
      const w = gen() * 2 - 1;
      nlp += na * (w - nlp);
      let e = nlp;
      if (n > this.exciteLen - FADE) {
        e *= 0.5 - 0.5 * Math.cos(Math.PI * (this.exciteLen - n) / FADE);
      }
      excBurst[n] = e;
    }
    this.excBurst = excBurst;

    // Dry run at the FROZEN trigger snapshot to derive a fixed headroom
    // scalar — the same peak-normalize the old bulk-precompute did, just
    // estimated once instead of baked permanently into the audio.
    const g0 = gFromDamping(this.dampingBase, this.freq);
    const dry = new KsLoop(Li, frac, dlSize);
    let pk = 0;
    for (let n = 0; n < this.totalSamples; n++) {
      const exc = n < this.exciteLen ? excBurst[n] : 0;
      const s = Math.abs(dry.step(exc, a0, g0));
      if (s > pk) pk = s;
    }
    this.normGain = pk > 1e-9 ? 1 / pk : 1;

    // The real playback loop: fresh state, driven live sample by sample.
    this.loop = new KsLoop(Li, frac, dlSize);
  }

  noteOff(t: number): void {
    if (t < this.holdEnd) this.holdEnd = t;
  }

  setModEnvelopes(mods: ModLite[]): void { this.modEnv.setModEnvelopes(mods); }
  getAdsrOffsets(): VoiceModOffsets { return this.modEnv.getAdsrOffsets(); }
  setLiveParams(l: ParamBag): void { this.live = l; }

  renderSample(t: number, moIn?: VoiceModOffsets): number {
    if (t < this.begin) return 0;
    const idx = Math.floor((t - this.begin) * this.sr);
    if (idx >= this.totalSamples) { this.done = true; return 0; }
    const gate = t <= this.holdEnd ? 1 : 0;
    const mo = this.modEnv.active ? this.modEnv.combine(t, gate, moIn) : moIn;

    // Live knobs: turning these moves THIS note. The trigger snapshot is the
    // fallback when no lane bag is attached.
    const L = this.live;
    const levelKnob = L ? param(L, 'amp.level', this.levelBase) : this.levelBase;
    const trim = L ? param(L, 'output.trim', this.trimBase) : this.trimBase;
    const damping = L ? param(L, 'string.damping', this.dampingBase) : this.dampingBase;
    const brightness = L ? param(L, 'string.brightness', this.brightnessBase) : this.brightnessBase;

    // Cached: gFromDamping (pow+exp+log) only re-runs when damping actually moves.
    if (damping !== this.dampRaw) {
      this.dampRaw = damping;
      this.gCache = gFromDamping(damping, this.freq);
    }
    const a = aFromBrightness(brightness);   // cheap linear map — no cache needed
    const exc = idx < this.exciteLen ? this.excBurst[idx] : 0;
    const raw = this.loop.step(exc, a, this.gCache) * this.normGain;

    let env = 1;
    if (this.ampEnvOn) {
      const dt = t - this.begin;
      const relStart = this.holdEnd - this.begin;
      if (dt < this.atk) {
        env = dt / this.atk;
      } else if (dt < relStart) {
        env = 1;
      } else {
        env = Math.exp(-(dt - relStart) / this.rel);
        if (t > this.holdEnd && env < 0.001) this.done = true;
      }
    }
    const level = mo?.['amp.level'] ? Math.max(0, levelKnob + mo['amp.level']) : levelKnob;
    // No engine trim here: it is a manifest capability (`outputTrim`) that the
    // host multiplies in, together with its synth category gain. `trim` below is
    // the per-PRESET balance (params['output.trim']), which IS the plugin's.
    let out = raw * env * level * this.vel * trim;
    if (mo?.['amp.gain']) out *= Math.max(0, Math.min(2, 1 + mo['amp.gain']));
    return out;
  }
}

Loom.registerRenderer('karplus', (n, p, sr) => new KarplusRenderer(n, p, sr));
