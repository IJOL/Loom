// Karplus-Strong physical-modeling engine.
//
// ── Why this engine is NOT built from a Web Audio DelayNode feedback loop ──
// The "obvious" realization (noise → DelayNode → LP → feedback gain → back into
// the DelayNode) is fundamentally broken in Web Audio: a DelayNode that sits in
// a cycle is clamped to a MINIMUM delay of one render quantum (128 samples ≈
// 2.9 ms / ~344 Hz). Any note above ~344 Hz collapses to that same ~340 Hz
// drone — every melody turns into a fixed, detuned howl that sounds exactly
// like acoustic feedback ("acople"). The loop also clips on overlapping notes
// and can only be kept stable with band-aids that kill the string's sustain.
//
// ── What we do instead: offline per-note synthesis ──
// On each trigger we run the Karplus-Strong digital-waveguide recurrence
// sample-by-sample in JS (see renderKarplusString) into an AudioBuffer, then
// play that buffer through a GainNode that carries the amp envelope. Because
// the whole note is a finite pre-rendered buffer with NO runtime feedback path:
//   • pitch is exact at every note (fractional-delay line, no 128-sample floor),
//   • the loop filter + DC-blocker shape a natural plucked-string decay,
//   • cross-note coupling / runaway is structurally impossible,
//   • the buffer is peak-normalized so a single note never clips.
// Trade-off: string.damping / brightness / excite.* are "baked" at trigger time
// (not continuously modulatable mid-note). amp.level stays a live AudioParam, so
// LFO/ADSR on the amp still work. This matches how a plucked string behaves —
// the timbre is set at the moment of the pluck.

// ── Karplus-Strong string renderer (offline, per note) ────────────────────
// Renders a full plucked-string decay into a Float32Array using a sample-
// accurate waveguide loop:
//   excitation[n] ─►(+)─► delay(L, fractional) ─► one-pole LP ─►(×g)─┐
//                    ▲                                                │
//                    └────────────────────────────────────────────────┘
//   • L = sampleRate/freq, read with linear interpolation for fractional
//     tuning → correct pitch at ALL frequencies. L is shortened by the loop
//     filter's group delay so the resonance lands on the true fundamental.
//   • one-pole LP (coefficient from `brightness`) damps high harmonics faster
//     than low ones → the characteristic string timbre and its evolution.
//   • loop gain g < 1 (from `damping`) sets the overall T60 decay length.
//   • a DC-blocking high-pass on the output removes any offset the random
//     excitation burst leaves behind.
//   • output is peak-normalized so the amp GainNode is the only level control.
function renderKarplusString(opts: {
  sampleRate: number; freq: number; damping: number; brightness: number;
  exciteDur: number; noiseTone: number; seconds: number;
}): Float32Array {
  const { sampleRate: fs, freq, damping, brightness, exciteDur, noiseTone } = opts;
  const N = Math.max(1, Math.round(opts.seconds * fs));
  const out = new Float32Array(N);

  // Loop low-pass coefficient from brightness (one-pole y += a·(x−y)):
  // 0.15 ≈ 1 kHz cutoff (dark) … 0.95 ≈ 20 kHz (open/metallic).
  const a = 0.15 + brightness * 0.80;
  // Loop gain → decay time. A FIXED loop gain makes the 60 dB decay time
  // T60 ∝ 1/freq (amp(t) = g^(freq·t)), so high notes die far too fast — C6
  // collapses in ~0.1 s, which is both unmusical and left the top of the
  // register near-silent. Instead choose g PER NOTE so T60 is set by `damping`
  // and is ~constant across the register: solve g^(freq·T60) = 1e-3 for g.
  //   damping 0 → T60 ≈ 4.0 s (long sustain)   damping 1 → T60 ≈ 0.12 s (muted)
  // Clamped just below 1 for safety (the loop only runs offline, so there is no
  // live feedback path to destabilize regardless).
  const t60 = 4.0 * Math.pow(0.03, damping);
  const g = Math.min(0.9995, Math.exp(Math.log(1e-3) / (Math.max(20, freq) * t60)));

  // Delay length = period minus the one-pole's low-frequency group delay
  // ((1−a)/a samples), so the filtered loop resonates at the true pitch.
  const period = fs / Math.max(20, freq);
  const Ldelay = Math.max(1, period - (1 - a) / a);
  const Li = Math.floor(Ldelay);
  const frac = Ldelay - Li;
  const dlSize = Li + 2;
  const dl = new Float32Array(dlSize);
  let widx = 0;
  let lp = 0;

  // Excitation: a band-limited white-noise burst whose colour is set by
  // noiseTone (200 Hz dark … 12 kHz bright), with a short raised-cosine
  // fade-out so the burst's end doesn't click.
  const exciteLen = Math.min(N, Math.max(4, Math.round(exciteDur * fs)));
  const noiseHz = Math.min(fs * 0.45, 200 * Math.pow(60, noiseTone));
  const na = 1 - Math.exp(-2 * Math.PI * noiseHz / fs);
  let nlp = 0;
  const FADE = 32;

  for (let n = 0; n < N; n++) {
    let exc = 0;
    if (n < exciteLen) {
      const w = Math.random() * 2 - 1;
      nlp += na * (w - nlp);
      exc = nlp;
      if (n > exciteLen - FADE) {
        exc *= 0.5 - 0.5 * Math.cos(Math.PI * (exciteLen - n) / FADE);
      }
    }
    const i0 = (widx - Li + dlSize) % dlSize;
    const i1 = (i0 - 1 + dlSize) % dlSize;
    const read = dl[i0] * (1 - frac) + dl[i1] * frac;
    lp += a * (read - lp);
    const s = exc + g * lp;
    out[n] = s;
    dl[widx] = s;
    widx = widx + 1 === dlSize ? 0 : widx + 1;
  }

  // DC blocker (one-pole high-pass, R≈0.997) so the random burst leaves no
  // subsonic offset to thump the amp.
  let xPrev = 0, yPrev = 0;
  const R = 0.997;
  for (let n = 0; n < N; n++) {
    const x = out[n];
    const y = x - xPrev + R * yPrev;
    xPrev = x; yPrev = y; out[n] = y;
  }

  // Peak-normalize to fixed headroom: the output GainNode becomes the sole
  // level control and a single note can never clip regardless of resonance.
  let pk = 0;
  for (let n = 0; n < N; n++) { const v = Math.abs(out[n]); if (v > pk) pk = v; }
  if (pk > 1e-9) { const k = 0.8 / pk; for (let n = 0; n < N; n++) out[n] *= k; }
  return out;
}

import type { SynthEngine, Voice, VoiceTriggerOptions, EngineSequencer, EngineUIContext } from './engine-types';
import type { EngineParamSpec } from './engine-params';
import type { PluginFactory } from '../plugins/types';
import { registerEngine, registerEngineFactory } from './registry';
import type { KnobHandle } from '../core/knob';
import { ModulationHostImpl } from '../modulation/modulation-host';
import { makeDefaultLFO, makeDefaultADSR, type ModulatorVoice } from '../modulation/types';
import { recordVoiceMods, getCurrentLaneForVoice } from '../modulation/active-mods';
import { renderModulatorsPanel } from '../modulation/modulation-ui';
import { bindEngineModulators, bindVoiceModulators, reapplyLaneModulations, disposeLaneModulations } from '../modulation/voice-mod-binding';
import { ConnectionBinder } from '../modulation/connection-binder';
import { wireEngineParams } from './engine-ui';
import { getCachedPresets } from '../presets/preset-loader';
import { velToGain, resolveVelocity } from '../core/velocity-gain';

// Unified-param schema. Dot-namespaced ids that map consistently between
// knob layer and voice AudioParam destinations (no more ks-* split between
// the knob layer and per-voice param map).
const KARPLUS_PARAMS: EngineParamSpec[] = [
  // String resonator
  { id: 'string.damping',    label: 'Damping',    kind: 'continuous', min: 0,     max: 1,   default: 0.5 },
  { id: 'string.brightness', label: 'Brightness', kind: 'continuous', min: 0,     max: 1,   default: 0.65 },
  // Excitation burst
  { id: 'excite.time',       label: 'Excite',     kind: 'continuous', min: 0.001, max: 0.1, default: 0.01, unit: 's' },
  { id: 'excite.tone',       label: 'Noise Tone', kind: 'continuous', min: 0,     max: 1,   default: 0.5 },
  // Amp envelope
  { id: 'amp.builtinEnv',    label: 'Built-in Env', kind: 'discrete', min: 0, max: 1, default: 1,
    options: [{ value: 'off', label: 'Off' }, { value: 'on', label: 'On' }] },
  { id: 'amp.attack',        label: 'Attack',     kind: 'continuous', min: 0.001, max: 0.5, default: 0.005, unit: 's' },
  { id: 'amp.release',       label: 'Release',    kind: 'continuous', min: 0.05,  max: 4,   default: 0.5,   unit: 's' },
  { id: 'amp.level',         label: 'Level',      kind: 'continuous', min: 0,     max: 1,   default: 0.8 },
  // Polyphony cap — shown as a knob in the Karplus inspector.
  { id: 'poly.voices',       label: 'Voices',     kind: 'continuous', min: 1,     max: 16,  default: 8 },
];

class KarplusVoice implements Voice {
  public readonly amp: GainNode;
  private envAmp!: ConstantSourceNode;
  /** The pre-rendered string buffer for the current note. Created in trigger. */
  private src: AudioBufferSourceNode | null = null;
  private disposed = false;

  /** Set by KarplusEngine.createVoice for dispose-time cleanup. */
  laneId: string | null = null;
  binder: ConnectionBinder | null = null;

  /** Called by the engine after each natural dispose so it can prune the
   *  voice from its activeVoices list. Assigned by createVoice. */
  onDisposed: (() => void) | null = null;

  constructor(
    private ctx: AudioContext,
    output: AudioNode,
    private getParam: (id: string) => number,
    private voiceMods: Map<string, ModulatorVoice>,
    modBus?: Record<string, ConstantSourceNode>,
  ) {
    // Output amp. The pre-rendered string buffer feeds this; its gain carries
    // the amp envelope + amp.level modulation. The string itself is synthesized
    // offline at trigger time (renderKarplusString), so the only live node
    // graph is BufferSource → amp → output: no feedback path, no coupling.
    this.amp = ctx.createGain();
    this.amp.gain.value = 0;

    // Internal amp envelope source. Per-note envelope writes to envAmp.offset,
    // and external modulators sum on top via getAudioParams().get('amp.level').
    this.envAmp = ctx.createConstantSource();
    this.envAmp.offset.value = 0;
    this.envAmp.start();
    this.envAmp.connect(this.amp.gain);

    // Shared modulation bus fan-out: scope='shared' modulators write to
    // modBus['amp.level'].offset, and each voice sums it into amp.gain. Karplus
    // only shares the output amp gain — the string timbre params are baked per
    // note inside renderKarplusString, so they aren't live AudioParams.
    if (modBus) {
      modBus['amp.level'].connect(this.amp.gain);
    }

    this.amp.connect(output);
  }

  getAudioParams(): Map<string, AudioParam> {
    // Only amp.level is a live AudioParam. string.damping / excite.tone are
    // baked into the buffer at trigger time, so they are intentionally NOT
    // exposed as modulation destinations (see file header trade-off note).
    return new Map<string, AudioParam>([['amp.level', this.amp.gain]]);
  }

  trigger(midi: number, time: number, options: VoiceTriggerOptions): void {
    if (this.disposed) return;
    // Fire modulator voices first so their AudioParam contributions land
    // before the note starts.
    for (const mv of this.voiceMods.values()) {
      mv.trigger(time, { gateDuration: options.gateDuration, accent: options.accent });
    }

    const freq = 440 * Math.pow(2, (midi - 69) / 12);
    const velMul = velToGain(resolveVelocity(options.velocity, !!options.accent));

    const damping    = this.getParam('string.damping');     // 0..1, 0 = ringy, 1 = dead
    const brightness = this.getParam('string.brightness');  // 0..1, loop LP cutoff scale
    const exciteDur  = Math.max(0.001, this.getParam('excite.time'));
    const noiseTone  = this.getParam('excite.tone');        // 0 = dark, 1 = bright
    const attack     = Math.max(0.001, this.getParam('amp.attack'));
    const release    = Math.max(0.05, this.getParam('amp.release'));
    const level      = this.getParam('amp.level');

    // Synthesize the whole plucked string into a buffer. Render long enough to
    // cover the gate + release window; the amp envelope shapes what's audible,
    // while the string's own g/brightness decay shapes the timbre within it.
    const seconds = Math.min(8, Math.max(0.4, options.gateDuration + release + 0.3));
    const data = renderKarplusString({
      sampleRate: this.ctx.sampleRate, freq, damping, brightness,
      exciteDur, noiseTone, seconds,
    });
    const audioBuf = this.ctx.createBuffer(1, data.length, this.ctx.sampleRate);
    audioBuf.getChannelData(0).set(data);
    const src = this.ctx.createBufferSource();
    src.buffer = audioBuf;
    src.connect(this.amp);
    this.src = src;

    // Amp envelope on the internal ConstantSource — modulators on amp.level sum
    // into this same destination via getAudioParams(). Skipped when the built-in
    // amp env is bypassed; envAmp stays at 0 so a modular ADSR on amp.level
    // drives the voice alone (the string buffer still plays, but silently).
    const ampEnvOn = this.getParam('amp.builtinEnv') >= 0.5;
    const peakAmp = Math.max(0.0001, level * velMul);
    const releaseStart = time + options.gateDuration;
    if (ampEnvOn) {
      this.envAmp.offset.cancelScheduledValues(time);
      this.envAmp.offset.setValueAtTime(0, time);
      this.envAmp.offset.linearRampToValueAtTime(peakAmp, time + attack);
      this.envAmp.offset.setValueAtTime(peakAmp, releaseStart);
      this.envAmp.offset.exponentialRampToValueAtTime(0.0001, releaseStart + release);
    }

    src.start(time);
    const stopTime = releaseStart + release + 0.1;
    try { src.stop(stopTime); } catch {}
    // Schedule disposal via setTimeout (engines are voices-per-trigger; cleanup
    // prevents leaking AudioNodes that never get garbage-collected).
    const delayMs = Math.max(0, (stopTime - this.ctx.currentTime) * 1000);
    setTimeout(() => this.dispose(), delayMs);
  }

  release(time: number): void {
    if (this.disposed) return;
    // Cut the built-in amp env only if it actually ran this note. When
    // amp.builtinEnv is Off, envAmp was never scheduled (stays at 0), so this
    // would be a no-op — guarding it keeps the bypass semantics symmetric with
    // trigger() and explicit for future readers.
    // cancelAndHoldAtTime snapshots the current value at `time` (handles
    // mid-ramp correctly — unlike reading param.value, which is unreliable
    // when automation is in flight). Then ramp linearly to 0 over 5 ms for
    // a quick perceptual gate cut.
    if (this.getParam('amp.builtinEnv') >= 0.5) {
      const RELEASE_S = 0.005;
      this.envAmp.offset.cancelAndHoldAtTime(time);
      this.envAmp.offset.linearRampToValueAtTime(0, time + RELEASE_S);
    }
    for (const mv of this.voiceMods.values()) mv.release(time);
  }
  connect(_dest: AudioNode): void {}

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    if (this.binder) this.binder.disposeAll();
    if (this.laneId) disposeLaneModulations(this.laneId);
    try { this.src?.stop(); } catch {}
    try { this.envAmp.stop(); } catch {}
    this.src?.disconnect();
    this.amp.disconnect();
    this.envAmp.disconnect();
    for (const mv of this.voiceMods.values()) mv.dispose();
    // Notify the engine so it can prune this voice from activeVoices.
    if (this.onDisposed) this.onDisposed();
  }
}

class KarplusSequencer implements EngineSequencer {
  getStepAt(_i: number): unknown { return null; }
  setLength(_n: number): void {}
  highlight(_s: number): void {}
  serialize(): unknown { return null; }
  deserialize(_d: unknown): void {}
  dispose(): void {}
}

export class KarplusEngine implements SynthEngine {
  readonly id = 'karplus';
  readonly name = 'Karp';
  readonly type = 'polyhost' as const;
  readonly polyphony = 'poly' as const;
  readonly editor = 'piano-roll' as const;
  get presets(): import('./engine-types').EnginePreset[] {
    return getCachedPresets('karplus');
  }
  readonly params = KARPLUS_PARAMS;

  /** Tempo for LFO BPM sync. main.ts can update this at runtime. */
  bpm = 120;

  /** Engine-wide shared modulation bus. ConstantSourceNodes whose .offset is
   *  driven by scope='shared' modulators (via bindEngineModulators) and whose
   *  output fans out to every voice's matching AudioParam in the constructor.
   *  Lazy-init in createVoice because we need the AudioContext.
   *  Karplus only shares the output amp gain — the loop/excite filters are
   *  per-voice (their cutoff is freq-dependent at trigger time). */
  readonly modBus?: Record<string, ConstantSourceNode>;

  /** Cached engine-wide modulator voices for scope='shared' mods. Spawned
   *  once on the first createVoice call and reused for every subsequent voice
   *  so shared LFOs/ADSRs share phase + state across notes. */
  private engineModVoices: Map<string, ModulatorVoice> | null = null;

  private modHost = new ModulationHostImpl([
    makeDefaultLFO('lfo1'),
    makeDefaultADSR('adsr1'),
  ]);

  /** Persistence + cross-module access to modulator state. */
  get modulators(): ModulationHostImpl { return this.modHost; }

  private paramValues: Record<string, number> = {};

  /** Maximum simultaneous voices. Oldest voice is stolen when exceeded. */
  maxVoices = 8;

  /** Ordered list of active voices (oldest first). */
  private activeVoices: KarplusVoice[] = [];

  /** How many voices are currently tracked as active. */
  activeVoiceCount(): number {
    return this.activeVoices.length;
  }

  /** Steal (dispose + remove) the N oldest voices. */
  private stealOldest(n: number): void {
    const toSteal = this.activeVoices.splice(0, n);
    for (const v of toSteal) {
      v.dispose();
    }
  }

  constructor() {
    for (const p of KARPLUS_PARAMS) this.paramValues[p.id] = p.default;
  }

  getBaseValue(id: string): number {
    return this.paramValues[id] ?? KARPLUS_PARAMS.find(p => p.id === id)?.default ?? 0;
  }

  setBaseValue(id: string, v: number): void {
    if (id === 'poly.voices') {
      const newCap = Math.max(1, Math.min(16, Math.round(v)));
      this.maxVoices = newCap;
      this.paramValues[id] = newCap;
      // Steal excess voices immediately if the new cap is below the current count.
      if (this.activeVoices.length > newCap) {
        this.stealOldest(this.activeVoices.length - newCap);
      }
      return;
    }
    this.paramValues[id] = v;
  }

  applyPreset(name: string): void {
    const preset = this.presets.find((p) => p.name === name);
    if (!preset) return;
    for (const [k, v] of Object.entries(preset.params)) this.paramValues[k] = v;
    if (preset.modulators) this.modHost.deserialize(preset.modulators);
  }

  /** Cached so the modulation-panel onChange callback can re-apply bindings. */
  private currentLaneId: string | null = null;

  createVoice(ctx: AudioContext, output: AudioNode): Voice {
    // Lazy-init the shared modulation bus on the first createVoice call.
    if (!this.modBus) {
      const n = ctx.createConstantSource();
      n.offset.value = 0;
      n.start();
      (this as { modBus: Record<string, ConstantSourceNode> }).modBus = {
        'amp.level': n,
      };
    }
    // 1. Lazy-init engine-wide modulator voices for SHARED mods and bind
    //    them ONCE to the modulation bus AudioParams. The amp.level paramId
    //    is a 0..1 gain in both the spec and the AudioParam, so the default
    //    rangeLookup (from engine.params) is correct — no override needed.
    if (!this.engineModVoices) {
      this.engineModVoices = this.modHost.spawnVoiceFiltered(
        ctx, () => this.bpm,
        (m) => (m.scope ?? (m.kind === 'lfo' ? 'shared' : 'per-voice')) === 'shared',
      );
      const sharedLaneId = getCurrentLaneForVoice();
      if (sharedLaneId) {
        bindEngineModulators({
          laneId: sharedLaneId,
          engine: this,
          voiceMods: this.engineModVoices,
          ctx,
        });
      }
    }
    // 2. Per-voice modulators: spawn per call for this note.
    const voiceMods = this.modHost.spawnVoiceFiltered(
      ctx, () => this.bpm,
      (m) => (m.scope ?? (m.kind === 'lfo' ? 'shared' : 'per-voice')) === 'per-voice',
    );
    const voice = new KarplusVoice(ctx, output, (id) => this.getBaseValue(id), voiceMods, this.modBus);
    // Record BOTH engine-shared and per-voice mods so the rAF tick can find
    // the shared LFO via getActiveModVoice (whose currentValue() syncs the
    // live OscillatorNode to state mutations).
    recordVoiceMods(new Map([...(this.engineModVoices ?? new Map()), ...voiceMods]));
    const laneId = getCurrentLaneForVoice();
    if (laneId) {
      voice.laneId = laneId;
      // Merge engine-shared mods into the per-voice binding map so a
      // scope='shared' LFO targeting a per-voice-only param still gets a
      // gain bridge. The voice-mod-binder skips shared-bus paramIds for
      // shared-scope mods so we don't double-route.
      const engineMods = this.engineModVoices ?? new Map<string, ModulatorVoice>();
      const combinedMods = new Map<string, ModulatorVoice>([...engineMods, ...voiceMods]);
      voice.binder = bindVoiceModulators({
        laneId, engine: this, voice, voiceMods: combinedMods, ctx,
        // One per-voice binding per live voice so a chord driven by a modular
        // ADSR (sole amp driver) stays polyphonic (cap = voice-stealing limit).
        voicePool: this.maxVoices,
      });
      this.currentLaneId = laneId;
    }

    // Polyphony cap: track the new voice, then steal oldest if over limit.
    this.activeVoices.push(voice);
    if (this.activeVoices.length > this.maxVoices) {
      this.stealOldest(this.activeVoices.length - this.maxVoices);
    }

    // Self-pruning: KarplusVoice already schedules its own dispose() via
    // setTimeout when the note finishes naturally. Wire a callback so that
    // natural completion also removes the voice from activeVoices.
    voice.onDisposed = () => {
      const idx = this.activeVoices.indexOf(voice);
      if (idx !== -1) this.activeVoices.splice(idx, 1);
    };

    return voice;
  }

  getSharedAudioParams(_ctx?: AudioContext): Map<string, AudioParam> {
    if (!this.modBus) return new Map();
    return new Map<string, AudioParam>([
      ['amp.level', this.modBus['amp.level'].offset],
    ]);
  }

  buildSequencer(_c: HTMLElement, _n: number): EngineSequencer {
    return new KarplusSequencer();
  }

  buildParamUI(container: HTMLElement, ctx?: EngineUIContext): void {
    container.innerHTML = '';
    if (!ctx) return;

    const fmt = (id: string, v: number): string => {
      if (id === 'amp.release') return v < 1 ? `${Math.round(v * 1000)}ms` : `${v.toFixed(2)}s`;
      if (id === 'excite.time' || id === 'amp.attack') return `${Math.round(v * 1000)}ms`;
      return `${Math.round(v * 100)}%`;
    };

    // A row can host one or more labelled knob groups, separated by a vertical
    // divider — STRING + EXCITE share a row (like the poly ENGINE/PRESET row).
    const section = (...groups: Array<[string, (id: string) => boolean]>): HTMLElement => {
      const row = document.createElement('div');
      row.className = 'row poly-section';
      groups.forEach(([label, filter], i) => {
        if (i > 0) {
          const divider = document.createElement('div');
          divider.className = 'vert-divider';
          row.appendChild(divider);
        }
        const lab = document.createElement('div');
        lab.className = 'section-label';
        lab.textContent = label;
        row.appendChild(lab);
        const knobRow = document.createElement('div');
        knobRow.className = 'knob-row';
        row.appendChild(knobRow);
        wireEngineParams(this, ctx, knobRow, { filter, formatter: fmt });
      });
      return row;
    };

    container.appendChild(section(
      ['STRING', (id) => id.startsWith('string.')],
      ['EXCITE', (id) => id.startsWith('excite.')],
    ));
    container.appendChild(section(['AMP', (id) => id.startsWith('amp.')]));

    renderModulatorsPanel(container, {
      engineId: this.id,
      laneId: ctx.laneId,
      host: this.modHost,
      registry: ctx.registry as Map<string, KnobHandle>,
      registerKnob: (k) => ctx.registerKnob(k),
      lookupLaneDisplayName: ctx.lookupLaneDisplayName,
      sessionState: ctx.sessionState,
      historyDeps: ctx.historyDeps,
      laneInserts: ctx.laneInserts,
      masterInserts: ctx.masterInserts,
      fxBus: ctx.fxBus,
      onChange: () => {
        container.innerHTML = '';
        this.buildParamUI(container, ctx);
        if (this.currentLaneId) reapplyLaneModulations(this.currentLaneId);
      },
    });
  }

  randomize(): void {
    const rnd = (a: number, b: number) => a + Math.random() * (b - a);
    this.paramValues['string.damping']    = rnd(0.05, 0.55);   // mostly ringy
    this.paramValues['string.brightness'] = rnd(0.3, 0.9);
    this.paramValues['excite.time']       = rnd(0.002, 0.03);
    this.paramValues['excite.tone']       = rnd(0.2, 0.85);
    this.paramValues['amp.attack']        = rnd(0.001, 0.02);
    this.paramValues['amp.release']       = rnd(0.3, 2.5);
    this.paramValues['amp.level']         = rnd(0.6, 0.9);
  }

  dispose(): void {}
}

export const karplusEngine = new KarplusEngine();
registerEngine(karplusEngine);
registerEngineFactory('karplus', () => new KarplusEngine());

export const karplusPlugin: PluginFactory = {
  kind: 'synth',
  manifest: {
    id: 'karplus',
    name: 'Karplus',
    kind: 'synth',
    version: '1.0.0',
    params: karplusEngine.params,
    presets: [],
  },
  create(ctx, output) {
    const engine = new KarplusEngine();
    const voice = engine.createVoice(ctx, output);
    return {
      trigger:                (m, t, o) => voice.trigger(m, t, o),
      release:                (t)       => voice.release(t),
      connect:                (d)       => voice.connect(d),
      getAudioParams:         ()        => voice.getAudioParams(),
      getAudioParamRange:     (id)      => voice.getAudioParamRange?.(id),
      getSharedAudioParams:   (c)       => engine.getSharedAudioParams?.(c) ?? new Map(),
      getBaseValue:           (id)      => engine.getBaseValue(id),
      setBaseValue:           (id, v)   => engine.setBaseValue(id, v),
      applyPreset:            (name)    => engine.applyPreset(name),
      dispose:                ()        => { voice.dispose(); engine.dispose(); },
    };
  },
};
