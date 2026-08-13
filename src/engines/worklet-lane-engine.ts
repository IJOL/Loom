// src/engines/worklet-lane-engine.ts
// A SynthEngine adapter backed by ONE LoomWorkletNode (the AudioWorklet
// software synth). It replaces the PolySynth-per-lane model for 'subtractive'
// lanes: createVoice() returns a thin Voice that posts a `spawn` message on
// trigger(), so trigger-dispatch, the lane scheduler, note-FX, and the
// live-voice registry stay untouched. setBaseValue/applyPreset post param
// updates into the worklet.
//
// Phase 1 scope: modulation (LFO/ADSR) moves in-worklet in Task 10, so
// getAudioParams() returns an empty Map and buildParamUI() is a stub here.
// Per-lane voice cap (poly.voices) maps to the worklet's maxVoices. poly.mode
// and poly.retrig were never modelled in the worklet renderer and are now
// deleted from every engine's params — setBaseValue still accepts-and-ignores
// either id so a pre-deletion save carrying them in engineState.params loads
// without error.

import type {
  SynthEngine, Voice, VoiceTriggerOptions, EngineUIContext, EnginePreset,
} from './engine-types';
import type { EngineParamSpec } from './engine-params';
import type { ParamBag } from '../audio-dsp/types';
import type { ModLite } from '../audio-dsp/modulation-runtime';
import type { EngineParamGroup } from './engine-param-groups';
import { LoomWorkletNode } from '../audio-worklet/loom-node';
import { ModulationHostImpl } from '../modulation/modulation-host';
import { type ModulatorState } from '../modulation/types';
import { getCachedPresets } from '../presets/preset-loader';
import { velNorm, resolveVelocity } from '../core/velocity-gain';
import { makeDotIdMapper, toModLite } from './mod-lite';
import { renderModulatorsPanel, type ModulationUIDeps } from '../modulation/modulation-ui';
import { buildEngineParamGrid } from './engine-param-grid';
import { randomizeEngineParams } from './engine-randomize';
import type { KnobHandle } from '../core/knob';
import { reapplyLaneModulations } from '../modulation/voice-mod-binding';
import type { ChannelStrip } from '../core/fx';
import {
  isStripParamId, getStripParam, setStripParam, stripAudioParams,
} from '../core/channel-strip-params';

// fieldForParamId / makeDotIdMapper / toModLite now live in ./mod-lite (pure
// data mapping, no Web Audio / DOM — see that module for the mapping logic).
// Re-exported here so no external caller's import path changes.
export { makeDotIdMapper, toModLite };

/** Monotonic handle so each spawned voice can be released on its own. Module
 *  scope, not per-node: ids only need to be unique within a lane, and one
 *  counter for the whole app is the simplest thing that guarantees it. */
let nextVoiceId = 1;

class WorkletVoice implements Voice {
  /** Set at trigger(); until then this voice owns nothing in the worklet. */
  private voiceId: number | null = null;
  constructor(private node: LoomWorkletNode) {}
  trigger(midi: number, time: number, o: VoiceTriggerOptions): void {
    const accent = o.accent ?? false;
    // VoiceTriggerOptions.velocity is the MIDI 0..127 scale (see velocity-gain.ts:
    // velNorm/resolveVelocity). NoteSpec.velocity the renderer expects is the
    // normalised 0..1 value, so convert here (defaulting via resolveVelocity so a
    // velocity-less audition/note-FX trigger lands at the legacy loudness).
    this.voiceId = nextVoiceId++;
    this.node.spawn({
      midi, beginSec: time, durationSec: o.gateDuration,
      velocity: velNorm(resolveVelocity(o.velocity, accent)),
      accent, slide: o.slide ?? false,
      voiceId: this.voiceId,
      // Rides the note because it varies PER note: a bar woven from two loops
      // sends each surviving hit to the instrument of the loop it came from.
      // Undefined for every ordinary trigger, and ignored by every engine but
      // LAYERS.
      layerIndex: o.layerIndex,
    });
  }
  /** Note-off THIS voice. A live key-up (live-keyboard's voice pool) lands here,
   *  and the other notes of a held chord must keep sounding.
   *
   *  This used to call node.silenceAll() — every voice on the lane — so lifting
   *  one key of a chord killed the chord. Measured in the app before the fix: a
   *  3-note chord at RMS 0.1954 fell to 0.0129 when ONE key came up, while an
   *  untouched control chord held at 0.2037. Do not route a key-up back through
   *  silenceAll; use silenceLane() when you really mean the whole lane. */
  release(_t: number): void {
    if (this.voiceId === null) return;   // never triggered: nothing of ours is sounding
    this.node.releaseVoice(this.voiceId);
  }
  /** Silence the ENTIRE lane (transport Stop / STOP ALL / scene-launch seam),
   *  regardless of which voice this handle happens to be. */
  silenceLane(): void { this.node.silenceAll(); }
  connect(_d: AudioNode): void { /* the lane's worklet node is already connected by the engine */ }
  getAudioParams(): Map<string, AudioParam> { return new Map(); }
  dispose(): void { /* no per-note nodes to tear down */ }
}

/** Per-engine configuration for a worklet-backed lane. */
export interface WorkletEngineConfig {
  engineId: string;
  name: string;
  params: EngineParamSpec[];
  /** Declared editor layout for `params`. See SynthEngine.groups. */
  groups?: EngineParamGroup[];
  presetsKey: string;          // preset cache key (engine id)
  polyphony: 'mono' | 'poly';
  modulators?: ModulatorState[];
  /** Per-engine output balance the HOST applies, for engines whose renderer does
   *  not apply its own (i.e. plugins — the number lives in their manifest).
   *  Default 1 leaves the six in-tree engines exactly as they were. */
  outputTrim?: number;
  /** A control this engine needs that is not a knob, drawn ABOVE its grid.
   *
   *  LAYERS has one: which instrument sits in each slot is a dropdown, not a
   *  number, so the generic grid has nothing to draw for it. The engine supplies
   *  the builder — that keeps the decision with the engine instead of putting an
   *  `if (engineId === …)` in the one class every worklet lane shares. */
  extraUI?: (host: HTMLElement, ctx: EngineUIContext, engine: SynthEngine) => void;
  /** A param this engine declares but does not want DRAWN right now. LAYERS
   *  hides the three closed tabs, so the page shows one instrument rather than
   *  four stacked. Absent ⇒ everything declared is drawn, as before. */
  hideParam?: (laneId: string, paramId: string) => boolean;
  /** Modulation targets that are not declared params — see
   *  EngineDescriptor.modTargets. They must reach BOTH the numbering (so a
   *  connection to one resolves to a slot) and the target mapper (so it is
   *  recognised at all); this class is where those two meet. */
  modTargets?: readonly string[];
}

export class WorkletLaneEngine implements SynthEngine {
  readonly id: string;
  readonly name: string;
  readonly type = 'polyhost' as const;
  readonly polyphony: 'mono' | 'poly';
  readonly editor = 'piano-roll' as const;
  readonly params: EngineParamSpec[];
  readonly groups?: EngineParamGroup[];
  private readonly presetsKey: string;
  private modHost: ModulationHostImpl;
  // Current scalar param state as a dot-id ParamBag, seeded from the spec
  // defaults. setBaseValue mirrors here and posts the same dot-id to the worklet.
  private state: ParamBag = {};
  private maxVoices: number;
  private worklet: LoomWorkletNode;
  /** The lane's mixer channel. Attached by the allocator after construction —
   *  see setBusStrip. Null while a lane is still being built. */
  private busStrip: ChannelStrip | null = null;
  // Latest live modulation offsets reported by the worklet (field → normalised
  // -1..1), the source of truth for the UI knob rings. Empty when nothing modulates.
  private liveModOffsets: Record<string, number> = {};
  /** Connection-paramId → modulation target name. One dot-id mapper for every
   *  engine (subtractive once had a translator of its own — see below). */
  private readonly mapTarget: (paramId: string) => string | null;
  /** See WorkletEngineConfig.extraUI. Public because SynthEngine declares it —
   *  a private field of the same name makes this class stop implementing the
   *  interface, and every `SynthEngine & WorkletLaneEngine` intersection in the
   *  offline recorder collapses to `never`. */
  readonly extraUI?: (host: HTMLElement, ctx: EngineUIContext, engine: SynthEngine) => void;
  /** See WorkletEngineConfig.hideParam. */
  readonly hideParam?: (laneId: string, paramId: string) => boolean;
  private _bpm = 120;
  /** Tempo. Assigning re-posts the modulator set so BPM-synced LFOs re-resolve
   *  their rate live (bpm-broadcast assigns this on every tempo change). */
  get bpm(): number { return this._bpm; }
  set bpm(v: number) { this._bpm = v; this.postMods(); }

  constructor(ctx: AudioContext, output: AudioNode, cfg: WorkletEngineConfig) {
    this.id = cfg.engineId;
    this.name = cfg.name;
    this.polyphony = cfg.polyphony;
    this.params = cfg.params;
    this.groups = cfg.groups;
    this.presetsKey = cfg.presetsKey;
    this.modHost = new ModulationHostImpl(cfg.modulators ?? []);
    // ONE vocabulary for every engine: a modulation connection targets a param's
    // own dot-id. Subtractive used to be translated into flat SubParams field
    // names by fieldForParamId — the last thing keeping it a special case, and
    // the reason its offsets could not be numbered by the lane's ParamIndex,
    // which is keyed by dot-ids. Nothing persisted changes: a saved connection
    // always stored the dot-id, and the translation only ever happened in flight.
    this.mapTarget = makeDotIdMapper(cfg.params, cfg.modTargets);
    this.extraUI = cfg.extraUI;
    this.hideParam = cfg.hideParam;
    // Strip params are excluded from the bag on purpose: the bag IS the worklet
    // renderer's input (and what the offline kernel renders from), while the seven
    // mixer params live on the lane's native ChannelStrip. Seeding them here would
    // hand the renderer params it does not have and make the bag a second owner
    // of the fader.
    for (const s of cfg.params) {
      if (!isStripParamId(s.id)) this.state[s.id] = s.default;
    }
    // The engine's OWN declared default, not a number chosen here. It was 8
    // whatever the manifest said, which made the knob's spec-default a decoration
    // — an engine asking for 6 got 8, and the two disagreed from the first frame.
    // Only the polyphony KIND is decided here, because mono is not a count.
    this.maxVoices = cfg.polyphony === 'mono'
      ? 1
      : Math.max(1, Math.round(cfg.params.find((p) => p.id === 'poly.voices')?.default ?? 8));
    this.state['poly.voices'] = this.maxVoices;   // keep the bag in sync with the authoritative cap
    // The lane's DECLARED live param set, built ONCE and used for both jobs it
    // has: seeding the worklet's values, and numbering them. It is NOT
    // cfg.params — strip params are excluded (they live on the ChannelStrip),
    // `poly.voices` is added, and `output.trim` is a live param that fm-renderer
    // and plugins/karplus read but NO engine declares. Deriving the numbering
    // from the same object is what keeps that third case from going dead.
    const seed: ParamBag = { ...this.state, 'output.trim': 1 };
    this.worklet = new LoomWorkletNode(ctx, cfg.engineId, cfg.outputTrim ?? 1,
                                       Object.keys(seed), cfg.modTargets);
    this.worklet.connect(output);
    // Post the FULL spec-default bag once, right away. loom-processor.ts builds
    // its VoiceManager from an empty ParamBag ({}), so — absent this — every id
    // is a "first-ever write" as far as ParamSmoother is concerned, INCLUDING
    // whatever a preset load posts next. Landing a first-ever write instantly is
    // correct for a declared spec param (the step spans spec-default → first
    // value, same as the renderer's own trigger-time snapshot) but not for
    // `output.trim`: it is not a declared spec param (never seeded above), yet
    // every FM preset carries it (0.65..2.0) and fm-renderer.ts reads it LIVE. A
    // preset loaded over an already-held note would otherwise land as that
    // param's first-ever write mid-note — an instant gain step, exactly the
    // click the smoother exists to prevent. Seeding `output.trim` to 1 here too
    // means the preset's later write is an ordinary ramped update instead.
    // Nothing is sounding at construction, so landing instantly here is correct.
    this.worklet.setParams(seed);
    // Receive live modulation telemetry so the UI can draw the REAL knob rings.
    this.worklet.onModValues((o) => { this.liveModOffsets = o; });
    if (cfg.polyphony === 'mono') this.worklet.setMaxVoices(1);
    this.postMods();
  }

  /** Push the current modulator set to the worklet runtime. Called on
   *  construction, after applyPreset, and whenever the modulators panel edits a
   *  modulator/connection. (In-worklet modulation is currently subtractive-only;
   *  for other engines toModLite yields inert mods until their targets are wired.) */
  private postMods(): void {
    this.worklet.setMods(toModLite(this.modHost.modulators, this._bpm, this.mapTarget));
  }

  get presets(): EnginePreset[] { return getCachedPresets(this.presetsKey); }
  get modulators(): ModulationHostImpl { return this.modHost; }

  /** Make an edit to `modulators` audible NOW.
   *
   *  The modulation panel's own knobs call this through their deps, and so does
   *  an automation curve writing a connection depth — the depth is a
   *  destination like any other and must not need a panel open to be heard.
   *  Without it, `setConnection` changes a number the worklet was handed a copy
   *  of and the sound carries on at the old depth. */
  onModulationEdited(laneId: string): void {
    // postMods reaches the IN-WORKLET runtime (engine params); Web-Audio
    // destinations — lane/master FX params — are bridged by the connection
    // binder and need the reapply too.
    this.postMods();
    reapplyLaneModulations(laneId);
  }
  /** Re-send the modulator set to the worklet, and nothing else.
   *
   *  What a caller that has just written `modulators` directly — the load path
   *  deserializing a lane's saved set — needs. `onModulationEdited` also
   *  re-binds the lane's Web-Audio destinations, which is right for an edit and
   *  wrong for an offline render. */
  postModulators(): void { this.postMods(); }

  /** Exposed for the global voice cap and for tests. */
  getWorkletNode(): LoomWorkletNode { return this.worklet; }

  /** Lane state a renderer needs that is not a number — a LAYERS rack, say.
   *
   *  Read by each voice at SPAWN, so an edit reaches the next note and never one
   *  already sounding. That is the rule every structural param follows, and here
   *  it is not even a compromise: re-reading it mid-note would mean swapping a
   *  voice's instrument underneath it.
   *
   *  Must be plain data — it crosses the thread boundary by structured clone,
   *  which refuses functions and class instances. */
  setStructural(structural: unknown): void {
    this.worklet.setStructural(structural);
  }

  /** Live modulation offset (normalised -1..1) currently applied to `paramId`
   *  (a dot-id like 'filter.cutoff' or the synthetic 'amp.gain'), or 0 if none.
   *  Reads the worklet's last telemetry — the REAL modulation, so the UI ring
   *  matches what is sounding. Drives the knob-ring overlay in automation-tick. */
  getLiveModOffset(paramId: string): number {
    const key = this.mapTarget(paramId);
    if (!key) return 0;
    return this.liveModOffsets[key] ?? 0;
  }

  /** Snapshot of the current dot-id param state — the exact ParamBag the
   *  audio-dsp renderer reads. The offline scene recorder uses this to render
   *  this lane through the pure kernel (the worklet itself can't run under the
   *  OfflineAudioContext / node-web-audio-api stub). */
  getParamBag(): ParamBag { return { ...this.state }; }
  /** Current per-lane voice cap (mirrors the worklet's maxVoices). */
  getMaxVoices(): number { return this.maxVoices; }
  /** Compact in-worklet modulation set (shared LFOs) — the same ModLite[] the
   *  worklet runs. The offline kernel render feeds these to a ModulationRuntime.
   *
   *  BUG, fixed here: this used to omit the target mapper and take toModLite's
   *  default, which was subtractive's translator. For any other engine that
   *  returned null for a param outside subtractive's table, the connection was
   *  dropped, and the OFFLINE render came out with the modulation missing while
   *  the live lane had it. postMods below always passed this.mapTarget; only the
   *  export path did not, which is why it never showed up in a listening test. */
  getModLite(): ModLite[] { return toModLite(this.modHost.modulators, this._bpm, this.mapTarget); }

  /** Hand this engine the ChannelStrip of the lane it plays into, so the seven
   *  `bus.*` params reach real nodes. Called by the lane allocator right after
   *  construction; until then a strip write is a no-op and a read answers the
   *  declared default. The strip belongs to the LANE, not the engine, so it
   *  survives an engine swap and is re-attached to the replacement. */
  setBusStrip(strip: ChannelStrip): void { this.busStrip = strip; }

  getBaseValue(id: string): number {
    if (id === 'poly.voices') return this.maxVoices;
    // The strip owns its seven values — read them off the live nodes so a knob
    // rebuilt from here shows where the fader actually is.
    if (isStripParamId(id)) {
      const v = this.busStrip ? getStripParam(this.busStrip, id) : undefined;
      return v ?? this.params.find((p) => p.id === id)?.default ?? 0;
    }
    if (id in this.state) return this.state[id];
    return this.params.find((p) => p.id === id)?.default ?? 0;
  }

  setBaseValue(id: string, v: number): void {
    if (id === 'poly.voices') {
      this.maxVoices = Math.max(1, Math.min(64, Math.round(v)));
      this.worklet.setMaxVoices(this.maxVoices);
      return;
    }
    // poly.mode / poly.retrig are dead ids — deleted from every engine's params
    // (no control ever drew them, and mono/legato were never modelled in the
    // worklet renderer) — but a save written before the deletion can still carry
    // either in lane.engineState.params, and applyLaneEngineState replays every
    // key it finds. Keep accepting-and-ignoring them so that load path never
    // throws on an old save.
    if (id === 'poly.mode' || id === 'poly.retrig') return;
    // A strip param is a native Web Audio node on the lane's mixer channel, not
    // a field of the worklet renderer. It must NOT enter `state` (that bag is the
    // renderer's input, and the offline kernel reads it verbatim) and must not be
    // posted to the worklet, which has no such param.
    if (isStripParamId(id)) {
      if (this.busStrip) setStripParam(this.busStrip, id, v);
      return;
    }
    this.state[id] = v;
    this.worklet.setParams({ [id]: v });   // dot-id straight through to the renderer's ParamBag
  }

  /** The lane strip's AudioParams — the ONLY modulation destinations a melodic
   *  worklet engine hands to the Web-Audio binder. Its synth params modulate
   *  inside the worklet (hence the empty getAudioParams on its voices), but the
   *  mixer channel is native Web Audio, so an LFO can reach it the ordinary way. */
  getSharedAudioParams(): Map<string, AudioParam> {
    if (!this.busStrip) return new Map<string, AudioParam>();
    return stripAudioParams(this.busStrip);
  }

  applyPreset(name: string): void {
    const preset = this.presets.find((p) => p.name === name);
    if (!preset) return;
    // A preset's keys ARE the engine's param ids. There is no per-engine
    // translation left: the last bank that needed one (TB-303's flat 'cutoff',
    // 'envMod', …) was rewritten to dot-ids when it became a plugin.
    for (const [id, val] of Object.entries(preset.params as Record<string, number>)) {
      if (typeof val !== 'number') continue;
      this.setBaseValue(id, val);
    }
    // A preset brings its own modulators or it brings none — no engine gets its
    // set derived here. Subtractive used to, because its bank predated the
    // unified envelope model and carried no `modulators`; the derivation is now
    // baked into plugins/subtractive/presets.json, which is where a preset's
    // data belongs. That was the last comparison by engine id on the audio path.
    if (preset.modulators) this.modHost.deserialize(preset.modulators);
    this.postMods();
  }

  createVoice(_ctx: AudioContext, _output: AudioNode): Voice { return new WorkletVoice(this.worklet); }

  /** "🎲 Sound" — roll a new timbre from this engine's own declared params.
   *  Nothing engine-specific lives here: engine-randomize reads the spec, which
   *  is why every worklet engine gets the dice, not just the bass. */
  randomize(): void { randomizeEngineParams(this); }

  buildParamUI(container: HTMLElement, ctx?: EngineUIContext): void {
    if (!ctx) return;
    container.innerHTML = '';
    // Per-engine knob grid, driven entirely by each engine's declared params +
    // groups table — including POLY (the VOICES knob → the worklet voice cap),
    // which used to be hand-rolled markup here. A poly engine gets POLY only
    // when it declares a 'poly' group (subtractive/fm/wavetable/westcoast do;
    // TB-303 is mono and declares no poly.voices, so it renders nothing here
    // for that group — no polyphony branch needed, the data already says so).
    //
    // Every worklet engine, Subtractive included, renders its full grouped
    // grid here — grouped params (e.g. FM's OP1..OP4, Subtractive's OSC 1/
    // OSC 2/SUB/NOISE/FILTER/MASTER) become one labelled row each, ungrouped
    // params share the top row.
    // Whatever this engine needs that a knob grid cannot express, above its
    // grid — the rack of a layered instrument, say. Most engines have none.
    if (this.extraUI) {
      const host = document.createElement('div');
      container.appendChild(host);
      this.extraUI(host, ctx, this);
    }

    // `skip` is how the grid already lets a caller withhold a param — the
    // sampler uses it for the ids its own scaffold draws. The engine decides;
    // this class only asks.
    const hide = this.hideParam;
    buildEngineParamGrid(this, ctx, container,
      hide ? { skip: (id) => hide(ctx.laneId, id) } : undefined);

    // Modulators panel. Editing a modulator/connection re-posts the whole
    // modulator set to the worklet runtime (postMods) so live LFO edits sound.
    // onChange only needs to re-render the modulators panel itself — the
    // engine's own param set didn't change — and renderModulatorsPanel
    // (modulation-ui.ts) replaces only the `.mod-panel` node it owns, leaving
    // the sibling note-FX panel and insert rack (appended into this same
    // `container` by session-host-lane-editor.ts AFTER buildParamUI returns)
    // untouched. Wiping the whole container here (as it used to) destroyed
    // those siblings until the lane editor was closed and reopened.
    const modDeps: ModulationUIDeps = {
      engineId: this.id,
      laneId: ctx.laneId,
      host: this.modHost,
      registry: ctx.registry as Map<string, KnobHandle>,
      registerKnob: (k) => ctx.registerKnob(k),
      lookupLaneDisplayName: ctx.lookupLaneDisplayName,
      sessionState: ctx.sessionState,
      historyDeps: ctx.historyDeps,
      destinations: ctx.destinations,
      onLiveEdit: () => this.onModulationEdited(ctx.laneId),
      onChange: () => {
        this.postMods();
        reapplyLaneModulations(ctx.laneId);
        renderModulatorsPanel(container, modDeps);
      },
    };
    renderModulatorsPanel(container, modDeps);
  }

  dispose(): void { this.worklet.dispose(); }   // kill the processor, not just disconnect (phantom-processor leak)
}
