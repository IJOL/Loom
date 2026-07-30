import type { NoteSpec, ParamBag, VoiceRenderer, VoiceModOffsets, SubParams } from './types';
import { createRenderer } from './renderer-registry';
import type { ModulationRuntime, ModLite, PhaseOrigin } from './modulation-runtime';
import { ParamSmoother } from './param-smoother';
import { subParamsInto, subParamsFromBag } from './subtractive-renderer';

/** Phase origin for the all-free/all-shared fast path: the LFO ignores notes. */
const SHARED_ORIGIN: PhaseOrigin = { voiceStartT: 0, lastNoteOnT: 0 };

interface Slot { midi: number; allocatedAt: number; v: VoiceRenderer; voiceId?: number; }

export class VoiceManager {
  private slots: Slot[] = [];
  private maxVoices = 16; // default poly; mono lanes set 1 via setMaxVoices
  private params: ParamBag;
  /** The lane's LIVE param bag: the smoothed copy voices read every sample.
   *  `params` stays the TARGET bag — what a renderer's constructor reads for its
   *  structural, trigger-time decisions. */
  private readonly smoother: ParamSmoother;
  /** The lane's live SubParams (subtractive only), refreshed from the smoothed bag
   *  whenever a knob moves. Built on first spawn: a non-subtractive lane never
   *  allocates it. */
  private liveSub: SubParams | null = null;
  private lastT = 0;
  /** When the lane last received a note-on (phase origin for TRIG=note). */
  private lastNoteOnT = 0;
  private mod: ModulationRuntime | null = null;
  /** Voice ids released before their spawn was drained from the scheduler queue
   *  (a key tap shorter than one render quantum). spawn() consumes these.
   *  Bounded: a stray id that never spawns would otherwise leak, so the oldest
   *  entry is dropped past the cap — Set preserves insertion order. */
  private readonly pendingReleases = new Set<number>();
  private static readonly PENDING_RELEASE_CAP = 64;
  // Pooled per-sample modulation-offset struct — mutated in place each render
  // sample and shared (read-only) by every voice, so the real-time render
  // callback allocates nothing on the audio thread when modulation is active.
  // Covers the full subtractive modulation target set (+ ampGain tremolo).
  private readonly modOffsets = {
    filterCutoff: 0, filterResonance: 0, filterEnvAmount: 0, filterKeyTrack: 0, filterDrive: 0,
    osc1Level: 0, osc2Level: 0, subLevel: 0, noiseLevel: 0, noiseColor: 0,
    osc1Detune: 0, osc2Detune: 0, osc1Pw: 0, osc2Pw: 0, osc1Sync: 0, osc2Sync: 0, masterTune: 0, ampGain: 0,
    unisonDetune: 0, unisonDrift: 0,
  };
  // Pooled generic offsets (keyed by param dot-id) for every NON-subtractive
  // engine — filled in place each sample so the render loop allocates nothing.
  private readonly genericOffsets: Record<string, number> = {};
  /** Per-engine output balance the HOST applies at the sum point, for engines
   *  whose renderer does not apply its own — i.e. PLUGINS, whose trim lives in
   *  their manifest rather than in their compiled JS. The default of 1 is what
   *  leaves the six in-tree engines untouched: they still call synthTrim()
   *  inside their own renderSample. */
  constructor(private sr: number, private engineId: string, params: ParamBag,
              private readonly outputTrim = 1) {
    this.params = { ...params };
    this.smoother = new ParamSmoother(sr);
    this.smoother.reset(this.params);
  }
  get activeCount(): number { return this.slots.length; }
  /** The smoothed bag handed to every voice. Read-only by convention: write
   *  through setParams so the values ramp instead of stepping. */
  get liveParams(): ParamBag { return this.smoother.values; }
  setParams(patch: ParamBag): void {
    Object.assign(this.params, patch);
    this.smoother.setTargets(patch);
  }
  setMaxVoices(n: number): void { this.maxVoices = Math.max(1, Math.min(64, Math.floor(n))); }
  /** Attach a shared-LFO modulation runtime. Its per-sample offsets are applied
   *  to every active voice at read time. */
  setModulation(m: ModulationRuntime): void { this.mod = m; }

  /** ADSR-only modulation offsets of the MOST RECENT voice — the UI knob ring
   *  follows the last note (the ADSR is per-voice; the legacy engine showed the
   *  last note too). Undefined when no live voice carries an ADSR. */
  lastVoiceAdsrOffsets(): Record<string, number> | undefined {
    const last = this.slots[this.slots.length - 1];
    return (last?.v as { getAdsrOffsets?(): Record<string, number> })?.getAdsrOffsets?.();
  }

  /** The phase origin the live modulation telemetry should read, so the UI knob
   *  rings / LFO graph follow TRIG and SCOPE instead of always drawing a free,
   *  shared LFO. It tracks the MOST RECENT note (like lastVoiceAdsrOffsets): its
   *  voiceStartT drives SCOPE=voice and its note-on drives a TRIG=note
   *  retrigger. Before any note it is the free origin {0,0}, so a silent lane's
   *  rings sit at the free-running position. Cheap — no per-sample use; the
   *  worklet reads it once per ~30 Hz telemetry post. */
  currentPhaseOrigin(): PhaseOrigin {
    const last = this.slots[this.slots.length - 1];
    return { voiceStartT: last?.allocatedAt ?? 0, lastNoteOnT: this.lastNoteOnT };
  }

  spawn(note: NoteSpec): void {
    // same-midi RETRIGGER: release the previous voice of this pitch, but leave
    // it in the render loop — it fades over its release and self-frees via
    // `done`. Splicing it out here (the old behaviour) discarded whatever
    // amplitude it was rendering, and that discarded amplitude landed verbatim
    // as a step discontinuity: an audible click on every back-to-back same-pitch
    // note (transcription clips are full of them) — the same physics that killed
    // the finite voice cap below. MIDI imports retrigger without a note-off, so
    // this noteOff IS the note-off; calling it on an already-releasing voice is
    // harmless (it only ever shortens the hold).
    for (let i = this.slots.length - 1; i >= 0; i--) {
      if (this.slots[i].midi === note.midi) this.slots[i].v.noteOff(this.lastT);
    }
    // Monophonic lanes (maxVoices === 1) steal the previous voice so the line stays
    // mono (e.g. TB-303 acid bass). Polyphonic lanes are intentionally UNCAPPED: the
    // AudioWorklet handles dense polyphony, and an artificial per-lane cap produced
    // audible clicks — it yanked a still-sounding voice out of the render loop
    // mid-note so its release never rendered (a step discontinuity). Voices
    // self-terminate on release, so they don't grow unbounded. (User-confirmed
    // click-free uncapped, 2026-06-24.)
    if (this.maxVoices <= 1) {
      while (this.slots.length >= 1) {
        const oldest = this.slots.shift();
        oldest?.v.noteOff(this.lastT);
      }
    }
    const v = createRenderer(this.engineId, note, this.params, this.sr);
    // Hand this voice the lane's live bag so its continuous params track the
    // knobs. Its constructor already took the structural snapshot from `params`.
    // Both hooks are declared right on VoiceRenderer (optional) — this IS the
    // contract every renderer opts into, not an ad-hoc extension worth casting.
    v.setLiveParams?.(this.smoother.values);
    if (this.engineId === 'subtractive') {
      if (!this.liveSub) this.liveSub = subParamsFromBag(this.smoother.values);
      v.setLiveSubParams?.(this.liveSub);
    }
    // Hand this voice its per-voice ADSR envelopes (subtractive renderer only;
    // others ignore the call). Read once at spawn — live shape edits apply to the
    // NEXT note, matching the engine's "params read at trigger time" rule.
    const adsr = this.mod?.getAdsrMods();
    if (adsr && adsr.length) (v as { setModEnvelopes?(m: ModLite[]): void }).setModEnvelopes?.(adsr);
    // The lane's most recent note-on — the phase origin for a shared LFO whose
    // TRIG is 'note' (the whole lane retriggers together).
    this.lastNoteOnT = note.beginSec;
    this.slots.push({ midi: note.midi, allocatedAt: note.beginSec, v, voiceId: note.voiceId });
    // A note-off that arrived before its note-on: a very short key tap can have
    // its release message overtake the spawn, which is still sitting in the
    // scheduler queue. Without this the voice would hold for its whole
    // durationSec — and a held live note asks for an hour.
    if (note.voiceId !== undefined && this.pendingReleases.has(note.voiceId)) {
      this.pendingReleases.delete(note.voiceId);
      v.noteOff(this.lastT);
    }
  }

  /** Release the `count` oldest voices early (global-cap stealing, and the
   *  transport Stop path via silenceAll). Addressed by AGE — for a key-up use
   *  releaseVoice, which is addressed by identity. */
  steal(count: number): void {
    const n = Math.min(count, this.slots.length);
    for (let i = 0; i < n; i++) this.slots[i].v.noteOff(this.lastT);
  }

  /** Note-off exactly ONE voice, the one whose spawn carried `voiceId`. What a
   *  key-up sends: the other notes of a held chord keep sounding. The voice is
   *  left in the render loop so its release tail renders and it self-frees via
   *  `done` — splicing it out here would drop whatever amplitude it was
   *  rendering and land as a click (same reason spawn's retrigger path leaves
   *  the stolen voice in place). Unknown or repeated ids are harmless. */
  releaseVoice(voiceId: number): void {
    let found = false;
    for (const s of this.slots) {
      if (s.voiceId === voiceId) { s.v.noteOff(this.lastT); found = true; }
    }
    // Not spawned yet — remember it so spawn() can release it on arrival.
    if (!found) {
      this.pendingReleases.add(voiceId);
      if (this.pendingReleases.size > VoiceManager.PENDING_RELEASE_CAP) {
        this.pendingReleases.delete(this.pendingReleases.values().next().value as number);
      }
    }
  }

  /** Fill the pooled offset struct for one phase origin. Reused for the shared
   *  case (computed once per sample) and the per-voice case (once per voice) —
   *  either way it allocates nothing on the audio thread.
   *  In-worklet LFO modulation is SUBTRACTIVE-ONLY for the struct-keyed path:
   *  only SubtractiveVoiceRenderer reads `VoiceModOffsets`. Other engines get the
   *  generic dot-id map instead. */
  private fillOffsets(t: number, o: PhaseOrigin): VoiceModOffsets | Record<string, number> | undefined {
    if (!this.mod) return undefined;
    if (this.engineId === 'subtractive') {
      const m = this.modOffsets;
      m.filterCutoff    = this.mod.offsetFor('filterCutoff', t, o);
      m.filterResonance = this.mod.offsetFor('filterResonance', t, o);
      m.filterEnvAmount = this.mod.offsetFor('filterEnvAmount', t, o);
      m.filterKeyTrack  = this.mod.offsetFor('filterKeyTrack', t, o);
      m.filterDrive     = this.mod.offsetFor('filterDrive', t, o);
      m.osc1Level       = this.mod.offsetFor('osc1Level', t, o);
      m.osc2Level       = this.mod.offsetFor('osc2Level', t, o);
      m.subLevel        = this.mod.offsetFor('subLevel', t, o);
      m.noiseLevel      = this.mod.offsetFor('noiseLevel', t, o);
      m.noiseColor      = this.mod.offsetFor('noiseColor', t, o);
      m.osc1Detune      = this.mod.offsetFor('osc1Detune', t, o);
      m.osc1Pw          = this.mod.offsetFor('osc1Pw', t, o);
      m.osc1Sync        = this.mod.offsetFor('osc1Sync', t, o);
      m.osc2Sync        = this.mod.offsetFor('osc2Sync', t, o);
      m.osc2Pw          = this.mod.offsetFor('osc2Pw', t, o);
      m.osc2Detune      = this.mod.offsetFor('osc2Detune', t, o);
      m.masterTune      = this.mod.offsetFor('masterTune', t, o);
      m.ampGain         = this.mod.offsetFor('ampGain', t, o);
      m.unisonDetune    = this.mod.offsetFor('unisonDetune', t, o);
      m.unisonDrift     = this.mod.offsetFor('unisonDrift', t, o);
      return m;
    }
    this.mod.offsetsInto(this.genericOffsets, t, o);
    return this.genericOffsets;
  }

  renderSample(t: number): number {
    this.lastT = t;
    // Advance any knob still travelling; tick() also reports a first-ever write
    // that landed instantly (it never enters the ramp list). At rest this is one
    // boolean read plus one length compare. Subtractive reads a typed snapshot,
    // so refresh the lane's ONE copy — only when the bag actually changed.
    if (this.smoother.tick() && this.liveSub) subParamsInto(this.smoother.values, this.liveSub);
    // When every LFO is free-running and shared (the common case) the offsets are
    // identical for all voices, so compute them ONCE. Only when a modulator asks
    // for a per-voice phase — SCOPE=voice or TRIG=note — do we pay for a fill per
    // voice inside the loop below.
    const perVoice = this.mod?.needsPerVoicePhase() ?? false;
    const shared = perVoice ? undefined : this.fillOffsets(t, SHARED_ORIGIN);
    let out = 0;
    for (let i = this.slots.length - 1; i >= 0; i--) {
      const s = this.slots[i];
      // Per-voice phase: this voice's own note-on drives SCOPE=voice, while the
      // lane's most recent note-on drives a shared TRIG=note retrigger.
      const mo = perVoice
        ? this.fillOffsets(t, { voiceStartT: s.allocatedAt, lastNoteOnT: this.lastNoteOnT })
        : shared;
      out += s.v.renderSample(t, mo as VoiceModOffsets | undefined) * this.outputTrim;
      if (s.v.done) this.slots.splice(i, 1);
    }
    return out;
  }
}
