import type { NoteSpec, ParamBag, VoiceRenderer, VoiceModOffsets } from './types';
import { createRenderer } from './renderer-registry';
import type { ModulationRuntime, ModLite, PhaseOrigin } from './modulation-runtime';
import { buildParamIndex, type ParamIndex } from './param-index';
import { SlotSmoother } from './slot-smoother';

/** Phase origin for the all-free/all-shared fast path: the LFO ignores notes. */
const SHARED_ORIGIN: PhaseOrigin = { voiceStartT: 0, lastNoteOnT: 0 };

interface Slot { midi: number; allocatedAt: number; v: VoiceRenderer; voiceId?: number; }

export class VoiceManager {
  private slots: Slot[] = [];
  private maxVoices = 16; // default poly; mono lanes set 1 via setMaxVoices
  private params: ParamBag;
  /** The lane's LIVE param values, by slot: the smoothed copy voices read every
   *  sample. `params` stays the TARGET bag — what a renderer's constructor reads
   *  for its structural, trigger-time decisions. */
  private readonly smoother: SlotSmoother;
  /** The numbering of this lane's declared params. Handed to every voice
   *  alongside the values so a renderer resolves its slots once. */
  private readonly index: ParamIndex;
  /** slot → declared id. Only the DECLARED params get an entry: the synthetic
   *  modulation targets buildParamIndex appends are not param ids and have no
   *  business in a name-keyed bag. */
  private readonly slotIds: string[] = [];
  /** TRANSITIONAL: a name-keyed view of `smoother.values`, mutated IN PLACE so
   *  the renderers still on setLiveParams keep reading through the one reference
   *  they took at spawn. It dies with that contract — nothing here is the source
   *  of truth, the Float64Array is. Refreshed only when the smoother reports a
   *  change, so a lane at rest pays nothing. */
  private readonly legacyBag: ParamBag = {};
  /** Set the first time a renderer turns up that does NOT speak slots. Until
   *  then the mirror above is never written on the audio path. */
  private legacyReaders = false;
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
  // Pooled per-sample modulation offsets, addressed by the SAME slots as the
  // live values — mutated in place each render sample and shared (read-only) by
  // every voice, so the real-time render callback allocates nothing.
  //
  // There used to be TWO of these, and both were keyed by name: this one, and a
  // hand-written struct of twenty flat SubParams fields filled by twenty
  // individually-named offsetFor calls, which existed only because subtractive's
  // renderer read those names. One numbering replaced both — and a renderer needs
  // no new slots for it, because a modulation target IS a param id.
  private readonly modOffsets: Float64Array;
  /** slot → target id, for EVERY slot including the synthetic ones. Only used at
   *  telemetry rate (~30 Hz) to name the knob rings; the audio path never reads
   *  it. `slotIds` above is the declared-only prefix, for the legacy bag. */
  private readonly targetIds: string[] = [];
  /** Per-engine output balance the HOST applies at the sum point. Every melodic
   *  engine is a PLUGIN, and a plugin's renderer never applies its own trim —
   *  the number lives in its manifest, not in its compiled JS. The default of 1
   *  is the floor for an engine that declares none, not a built-in fallback.
   *
   *  @param paramIds the lane's DECLARED live param set, in declaration order —
   *  the ids that get a slot. An id outside it is dropped with a warning instead
   *  of entering a bag nobody reads. Production callers pass it explicitly (the
   *  worklet's bag starts EMPTY, so there is nothing to infer it from); the
   *  default serves the in-process callers whose initial bag IS the full set. */
  constructor(private sr: number, private engineId: string, params: ParamBag,
              private readonly outputTrim = 1,
              paramIds: readonly string[] = Object.keys(params)) {
    this.params = { ...params };
    this.index = buildParamIndex(paramIds);
    for (const id of paramIds) this.slotIds[this.index.slot[id]] = id;
    for (const id in this.index.slot) this.targetIds[this.index.slot[id]] = id;
    this.modOffsets = new Float64Array(this.index.length);
    this.smoother = new SlotSmoother(sr, this.index);
    this.smoother.reset(this.params);
    // No legacyBag fill here on purpose: nothing reads it until a renderer that
    // does not speak slots turns up, and spawn() fills it then.
  }
  /** Per-lane state a renderer needs that is not a number — which engine sits in
   *  each of a LAYERS lane's slots, say. Handed to every voice at SPAWN, never
   *  to one already sounding: it is structural by definition, and re-reading it
   *  mid-note would mean swapping a voice's instrument underneath it. */
  private structural: unknown;
  setStructural(s: unknown): void { this.structural = s; }

  get activeCount(): number { return this.slots.length; }
  /** The smoothed values handed to every voice, and their numbering. Read-only
   *  by convention: write through setParams so the values ramp instead of
   *  stepping. */
  get liveValues(): Float64Array { return this.smoother.values; }
  get paramIndex(): ParamIndex { return this.index; }
  /** TRANSITIONAL name-keyed view of the above — see `legacyBag`. Refreshed on
   *  demand because it is NOT on the audio path: only tests read it directly. */
  get liveParams(): ParamBag { this.writeLegacyBag(); return this.legacyBag; }
  setParams(patch: ParamBag): void {
    Object.assign(this.params, patch);
    this.smoother.setTargets(patch);
    // Control-rate (one knob message), not per-sample: refresh eagerly so a
    // spawn that lands between two render samples never reads a stale name.
    this.mirrorLegacyBag();
  }
  /** Mirror for the audio path. Nobody on the old contract ⇒ nothing to mirror,
   *  and that guard is the whole reason the transitional bag is not a per-sample
   *  tax: no in-tree renderer implements setLiveParams any more, so for every
   *  engine we ship this never runs. It costs an out-of-tree plugin that has not
   *  been rebuilt one string-keyed store per declared param per moving sample —
   *  what it was already paying by name — and it stops when that plugin is. */
  private mirrorLegacyBag(): void {
    if (this.legacyReaders) this.writeLegacyBag();
  }
  private writeLegacyBag(): void {
    const v = this.smoother.values;
    for (let i = 0; i < this.slotIds.length; i++) this.legacyBag[this.slotIds[i]] = v[i];
  }
  setMaxVoices(n: number): void { this.maxVoices = Math.max(1, Math.min(64, Math.floor(n))); }
  /** Attach a shared-LFO modulation runtime. Its per-sample offsets are applied
   *  to every active voice at read time. */
  setModulation(m: ModulationRuntime): void {
    this.mod = m;
    // Hand it this lane's numbering so its targets resolve to slots once, rather
    // than by name on every sample.
    m.bindIndex(this.index);
  }

  /** ADSR-only modulation offsets of the MOST RECENT voice, BY NAME — the UI knob
   *  ring follows the last note (the ADSR is per-voice; the legacy engine showed
   *  the last note too). Undefined when no live voice carries an ADSR.
   *
   *  The voice holds these by slot, like everything else on the audio path; the
   *  naming happens HERE because this is telemetry, read ~30 times a second by
   *  the worklet's reporter, never per sample. Only non-zero slots are named, so
   *  a lane with one modulated param posts one key, as it did before. */
  lastVoiceAdsrOffsets(): Record<string, number> | undefined {
    const last = this.slots[this.slots.length - 1];
    const bySlot = (last?.v as { getAdsrOffsets?(): Float64Array })?.getAdsrOffsets?.();
    if (!bySlot || bySlot.length === 0) return undefined;
    const out: Record<string, number> = {};
    for (let i = 0; i < bySlot.length; i++) {
      if (bySlot[i]) out[this.targetIds[i]] = bySlot[i];
    }
    return out;
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
    const v = createRenderer(this.engineId, note, this.params, this.sr, this.structural);
    // Hand this voice the lane's live bag so its continuous params track the
    // knobs. Its constructor already took the structural snapshot from `params`.
    // Both hooks are declared right on VoiceRenderer (optional) — this IS the
    // contract every renderer opts into, not an ad-hoc extension worth casting.
    // Slot-addressed if the renderer speaks it, name-keyed otherwise. Exactly
    // one of the two, so a half-converted renderer cannot read a knob through
    // two paths at once. The name-keyed branch is the transitional one.
    if (v.setLiveValues) {
      v.setLiveValues(this.smoother.values, this.index);
    } else if (v.setLiveParams) {
      // First voice on the old contract: start maintaining the name-keyed view,
      // and fill it BEFORE handing the reference over — this voice reads through
      // that one object for its whole life.
      if (!this.legacyReaders) { this.legacyReaders = true; this.writeLegacyBag(); }
      v.setLiveParams(this.legacyBag);
    }
    // Hand this voice its per-voice ADSR envelopes (subtractive renderer only;
    // others ignore the call). Read once at spawn — live shape edits apply to the
    // NEXT note, matching the engine's "params read at trigger time" rule.
    const adsr = this.mod?.getAdsrMods();
    // The index travels with them: a spec's depths are keyed by target name, and
    // resolving those to slots is a per-spawn job, not a per-sample one.
    if (adsr && adsr.length) {
      (v as { setModEnvelopes?(m: ModLite[], ix: ParamIndex): void }).setModEnvelopes?.(adsr, this.index);
    }
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
  private fillOffsets(t: number, o: PhaseOrigin): VoiceModOffsets | undefined {
    // Nothing modulating ⇒ hand back NOTHING, not a bag of zeroes. The worklet
    // attaches a runtime to every lane whether or not it has modulators, so this
    // is the COMMON case, and the difference is large: with an empty bag every
    // `mo?.<target>` test in every renderer runs and misses instead of
    // short-circuiting — 120 failed lookups per sample for an 8-voice FM lane,
    // measured at +54% on a lane with no modulation at all.
    if (!this.mod?.hasActive) return undefined;
    // One fill for every engine. It writes only the targets a modulator actually
    // drives, where the subtractive branch wrote all twenty every sample whether
    // anything reached them or not.
    this.mod.offsetsIntoSlots(this.modOffsets, t, o);
    return this.modOffsets;
  }

  renderSample(t: number): number {
    this.lastT = t;
    // Advance any knob still travelling; tick() also reports a first-ever write
    // that landed instantly (it never enters the ramp list). At rest this is one
    // boolean read plus one length compare.
    if (this.smoother.tick()) this.mirrorLegacyBag();
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
      out += s.v.renderSample(t, mo) * this.outputTrim;
      if (s.v.done) this.slots.splice(i, 1);
    }
    return out;
  }
}
