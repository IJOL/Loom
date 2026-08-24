// src/audio-dsp/modulation-runtime.ts
// In-worklet time-driven modulation (LFO and any other 'time'-driver kernel)
// over the full subtractive modulation target set (every SubParams field a
// connection can reach, plus the synthetic `ampGain` tremolo). The runtime
// no longer knows what an LFO is: for each enabled modulator it looks up a
// ModulatorKernel by `kind` (modulator-kernels.ts) and asks it for the
// normalised signal at the resolved phase origin. A kind with no registered
// kernel contributes nothing — it is ignored, not folded into another kind.
// The runtime returns NORMALISED offsets (sum of kernel-value×depth); the
// renderer scales each to native units (cents/semitones for pitch, ×gain for
// ampGain, 0..1 add for the rest). BPM-synced LFOs ARE honoured: the host
// (WorkletLaneEngine.toModLite) resolves any sync→free Hz via effectiveRateHz
// before sending, so `rateHz` here is already tempo-correct and re-posted on
// every BPM change.
//
// TRIG + SCOPE: both are honoured, and both reduce to ONE question — where does
// the phase start (see PhaseOrigin). A free+shared LFO starts at 0 and is the
// cheap path the render loop takes when nothing needs more; note-triggered and
// per-voice LFOs need an origin per voice, which VoiceManager supplies from each
// slot's note-on time. `needsPerVoicePhase()` tells the loop which path to take.
//
// A gate-driven mod (driver:'gate' — today always the ADSR, the only component
// registered that way) contributes zero HERE — it is genuinely per-voice and
// travels a different road: getAdsrMods() hands it to the renderer at spawn,
// which gates an envelope per note (see ModEnvHost). That road is unchanged by
// this file's kernel lookup — a gate driver has no 'time'-driver kernel to
// look up, by design (§3.3 of the design doc: the gate road stays closed).
import type { ModTarget, ParamIndex } from './types';
import { getModulatorKernel, type ModulatorKernel } from './modulator-kernels';

export interface ModLite {
  id: string;
  /** The modulator component's id. NOT a closed union: the runtime resolves it
   *  through the kernel registry, so a plugin's kind travels here untouched.
   *  It used to be 'lfo' | 'adsr', and toModLite coerced anything else into
   *  'adsr' — a third modulator silently became an envelope. */
  kind: string;
  /** Mirrors ModulatorComponent.driver (modulator-registry.ts), carried through
   *  so the per-voice gate road (getAdsrMods below) can be identified by this
   *  property instead of a hardcoded 'adsr' comparison — the runtime has no
   *  business knowing which id means "envelope". Populated by the host's
   *  toModLite (mod-lite.ts), which has the registry; absent on a hand-built
   *  ModLite (tests that skip toModLite), which then correctly counts as
   *  "not a gate mod". */
  driver?: 'time' | 'gate' | 'trigger';
  enabled: boolean;
  rateHz: number;
  waveform: 'sine' | 'triangle' | 'square' | 'saw';
  /** Polarity: bipolar (default) swings -1..+1; unipolar maps the wave to 0..1
   *  so the offset only pushes the target one way. Optional — absent ⇒ bipolar. */
  bipolar?: boolean;
  /** ADSR shape (seconds; sustain 0..1). Present for kind:'adsr' — the renderer
   *  drives a PER-VOICE envelope from these, gated by the note (attack on note-on,
   *  release on note-off), and adds env×depth to each connected param. */
  attackSec?: number;
  decaySec?: number;
  sustain?: number;
  releaseSec?: number;
  /** TRIG: 'free' runs the phase off absolute time; 'note' restarts it on every
   *  note-on. Absent ⇒ 'free' (the historical behaviour). */
  trigger?: 'free' | 'note';
  /** SCOPE: 'shared' is one phase for the whole lane; 'voice' gives each played
   *  note its own phase, so voices drift apart. Absent ⇒ 'shared'. */
  scope?: 'shared' | 'voice';
  /** SubParams field name → modulation depth (-1..1), additive in the field's
   *  native 0..1 units. */
  depthByParam: Record<string, number>;
  /** A plugin modulator's own settings (ModulatorState.params, carried through
   *  unchanged). No built-in kernel reads this — LFO and ADSR keep their named
   *  fields above — but a plugin kernel has nowhere else to find its rate. */
  params?: Record<string, number>;
}

/** Where a modulator's phase starts. TRIG and SCOPE both reduce to this one
 *  question, which is why they share a code path:
 *    free + shared → 0            (one phase for the lane, ignores notes)
 *    note + shared → lastNoteOnT  (the lane retriggers together)
 *    scope 'voice' → voiceStartT  (each note runs its own) */
export interface PhaseOrigin {
  /** When the voice being rendered was triggered. */
  voiceStartT: number;
  /** When the lane most recently received any note-on. */
  lastNoteOnT: number;
  /** How many notes this lane has played since the transport started — the
   *  ordinal of the note this voice belongs to, counting from 0.
   *
   *  It lives HERE and not on ModLite because ModLite is the modulator's
   *  config: one per lane, shared by every voice, posted when something
   *  changes. An ordinal is per voice, and per voice is what this struct is.
   *
   *  A driver:'trigger' kernel is a function of this and nothing else, which is
   *  what keeps it pure: the counting happens in VoiceManager, which is allowed
   *  to remember things; the kernel only reads the number it is handed. */
  triggerIndex: number;
}

const SHARED_FREE: PhaseOrigin = { voiceStartT: 0, lastNoteOnT: 0, triggerIndex: 0 };

/** The phase origin for one modulator. Voice scope wins over trigger: a
 *  per-voice LFO always starts with its own note, whatever TRIG says. */
function originFor(m: ModLite, o: PhaseOrigin): number {
  if (m.scope === 'voice') return o.voiceStartT;
  if (m.trigger === 'note') return o.lastNoteOnT;
  return 0;
}

/** One modulator paired with the kernel that renders it. Resolved once, in
 *  setMods — NEVER per sample: VoiceManager calls offsetFor twenty times per
 *  sample per voice, so a registry lookup inside those loops would run tens of
 *  thousands of map probes a second on the audio thread. */
interface ActiveMod {
  m: ModLite;
  kernel: ModulatorKernel;
}

/** One active modulator with its targets already resolved to SLOTS. `depthByParam`
 *  is keyed by name, so translating it per sample would cost exactly what reading
 *  params by name used to: the resolution happens ONCE, here, whenever the
 *  modulator set or the lane's numbering changes. Parallel arrays rather than
 *  objects so the per-sample loop walks two typed arrays and allocates nothing. */
interface SlottedMod {
  m: ModLite;
  kernel: ModulatorKernel;
  slots: Int32Array;
  depths: Float64Array;
}

export class ModulationRuntime {
  private mods: ModLite[] = [];
  /** The enabled modulators that have a kernel, paired with it. The three
   *  per-sample loops iterate THIS, so they do no lookups and skip nothing:
   *  disabled and kernel-less mods are already gone. */
  private active: ActiveMod[] = [];
  /** True when any enabled time-driven modulator needs a per-voice phase
   *  (SCOPE=voice or TRIG=note). Lets the render loop keep the cheap
   *  once-per-sample shared path when nothing asks for more. Recomputed on
   *  setMods, never per sample. */
  private perVoicePhase = false;
  /** The same active set with its targets resolved to slots — empty until a lane
   *  binds its numbering. */
  private slotted: SlottedMod[] = [];
  /** The lane's param numbering, or null when nobody bound one (the name-keyed
   *  callers do not need it). */
  private index: ParamIndex | null = null;
  /** Targets with no slot, warned about once each: a modulation connection to an
   *  id the engine does not declare would otherwise vanish without a word. */
  private readonly warned = new Set<string>();
  // sr is reserved for future per-sample phase accumulation (BPM sync); the
  // current free-rate implementation derives phase from absolute time directly.
  constructor(_sr: number) {}
  setMods(mods: ModLite[]): void {
    this.mods = mods;
    this.active = [];
    for (const m of mods) {
      if (!m.enabled) continue;
      const kernel = getModulatorKernel(m.kind);
      if (!kernel) continue;          // an unknown kind contributes nothing
      this.active.push({ m, kernel });
    }
    this.perVoicePhase = this.active.some(
      // A driver:'trigger' mod belongs here whatever its SCOPE says. Its value
      // is a function of the note ordinal, and the ordinal only exists on the
      // per-voice path: the shared fill runs with SHARED_ORIGIN, whose
      // triggerIndex is 0 forever. Left out of this test, a per-note modulator
      // set to shared scope is silently frozen on its first value — enabled,
      // connected, drawing a ring, and inert.
      ({ m }) => m.scope === 'voice' || m.trigger === 'note' || m.driver === 'trigger',
    );
    this.resolveSlots();
  }

  /** Hand this runtime the lane's param numbering, so its targets can be resolved
   *  to slots. Called once, when the lane attaches the runtime; re-resolves if the
   *  modulator set was already set. */
  bindIndex(index: ParamIndex): void {
    this.index = index;
    this.resolveSlots();
  }

  private resolveSlots(): void {
    this.slotted = [];
    const ix = this.index;
    if (!ix) return;
    for (const { m, kernel } of this.active) {
      const slots: number[] = [];
      const depths: number[] = [];
      for (const id in m.depthByParam) {
        const depth = m.depthByParam[id];
        if (!depth) continue;
        const slot = ix.slot[id];
        if (slot === undefined) {
          if (!this.warned.has(id)) {
            this.warned.add(id);
            console.warn(`[modulation] no slot for target '${id}' — this connection is inert`);
          }
          continue;
        }
        slots.push(slot);
        depths.push(depth);
      }
      if (slots.length) {
        this.slotted.push({ m, kernel, slots: Int32Array.from(slots), depths: Float64Array.from(depths) });
      }
    }
  }

  /** Slot-addressed twin of offsetsInto: fills `out` IN PLACE, indexed by the
   *  bound ParamIndex. Names were resolved once in resolveSlots, so this walks
   *  two typed arrays per modulator and touches no string at all. */
  offsetsIntoSlots(out: Float64Array, t: number, o: PhaseOrigin = SHARED_FREE): void {
    out.fill(0);
    for (const s of this.slotted) {
      const w = s.kernel.valueAt(s.m, t, originFor(s.m, o), o.triggerIndex);
      const { slots, depths } = s;
      for (let i = 0; i < slots.length; i++) out[slots[i]] += w * depths[i];
    }
  }

  /** Whether ANY enabled modulator with a kernel would contribute an offset.
   *  False ⇒ every offset this runtime can produce is exactly zero, so the
   *  caller should hand the renderers nothing at all rather than a bag of
   *  zeroes. That distinction is not cosmetic: a renderer tests `mo?.<target>`
   *  per target per voice per sample, and an EMPTY BAG makes every one of those
   *  lookups actually run and miss, where `undefined` short-circuits. Gate
   *  modulators (ADSR) are correctly absent from `active` — they have no kernel
   *  and travel the per-voice envelope road instead. */
  get hasActive(): boolean {
    // Once a lane has bound its numbering, "active" means active ON THE SLOT
    // PATH: a modulator whose every target failed to resolve contributes exactly
    // zero, and answering true for it would cost a fill and a full set of reads
    // per sample to produce an array of zeroes.
    return this.index ? this.slotted.length > 0 : this.active.length > 0;
  }

  /** Whether the render loop must compute offsets per voice rather than once per
   *  sample. False for the common all-free/all-shared case. */
  needsPerVoicePhase(): boolean { return this.perVoicePhase; }

  /** The enabled gate-driven modulators (per-voice envelopes the renderer
   *  drives) — today that is always the ADSR, the only component registered
   *  with driver:'gate' (§3.3: the gate road stays closed in this slice). LFOs
   *  stay shared in offsetFor/activeOffsets; a gate mod is gated per note, so
   *  each voice runs its own envelope from these — the VoiceManager hands them
   *  to the renderer at spawn. Asks the DRIVER, not the id: this is still the
   *  same per-voice envelope road, unmoved — only how the runtime recognises
   *  a mod belongs on it. */
  getAdsrMods(): ModLite[] {
    return this.mods.filter((m) => m.driver === 'gate' && m.enabled);
  }
  /** Normalised additive offset (Σ wave×depth over enabled LFOs) for a
   *  modulation target at absolute time t. The renderer scales it to the
   *  target's native units. */
  offsetFor(field: ModTarget, t: number, o: PhaseOrigin = SHARED_FREE): number {
    let sum = 0;
    for (const { m, kernel } of this.active) {
      const depth = m.depthByParam[field as string];
      if (!depth) continue;
      sum += kernel.valueAt(m, t, originFor(m, o), o.triggerIndex) * depth;
    }
    return sum;
  }

  /** Snapshot of the normalised offset for EVERY param any enabled modulator
   *  drives at time t (the sum over all sources, the same value offsetFor
   *  returns). The worklet posts this to the main thread so the knob rings show
   *  the REAL modulation; params with no active modulation are omitted. When
   *  per-voice ADSR lands it adds its contribution here and the rings follow. */
  activeOffsets(t: number, o: PhaseOrigin = SHARED_FREE): Record<string, number> {
    const out: Record<string, number> = {};
    for (const { m, kernel } of this.active) {
      const w = kernel.valueAt(m, t, originFor(m, o), o.triggerIndex);
      for (const field in m.depthByParam) {
        const depth = m.depthByParam[field];
        if (!depth) continue;
        out[field] = (out[field] ?? 0) + w * depth;
      }
    }
    return out;
  }

  /** Pooled variant of activeOffsets: fills `out` IN PLACE (zeroing its existing
   *  keys first) so the per-sample render loop allocates nothing on the audio
   *  thread. Generic — `out` is keyed by whatever the connections target
   *  (SubParams fields for Subtractive, param dot-ids for the other engines), so
   *  the same path drives every engine's LFO modulation. */
  offsetsInto(out: Record<string, number>, t: number, o: PhaseOrigin = SHARED_FREE): void {
    for (const k in out) out[k] = 0;
    for (const { m, kernel } of this.active) {
      const w = kernel.valueAt(m, t, originFor(m, o), o.triggerIndex);
      for (const field in m.depthByParam) {
        const depth = m.depthByParam[field];
        if (!depth) continue;
        out[field] = (out[field] ?? 0) + w * depth;
      }
    }
  }
}
