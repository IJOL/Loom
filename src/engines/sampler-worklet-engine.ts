// src/engines/sampler-worklet-engine.ts
// Sampler engine backed by the AudioWorklet sample bank (sampler-processor). It
// keeps ALL of the legacy SamplerEngine's main-thread logic — keymap, per-pad
// param store, mute/solo, the channel/keymap UI, bundled-instrument loading
// (loadFamilyRef) — and replaces ONLY the audio path: instead of building a
// per-note SamplerVoice Web Audio graph, createVoice() resolves a fully-formed
// SampleSpawn main-thread (keymap lookup, repitch, pad params, playback window,
// velocity/audible) and posts it to a shared SamplerWorkletNode, which plays it
// in the worklet through a per-pad Svf lowpass + amp env + pan, with per-pad
// reverb/delay sends fanned to the FxBus.
//
// Decoded buffers are transferred to the worklet bank (loadSample) whenever a
// sample becomes available (setKeymap, loadFamilyRef, import) — the worklet never
// touches IndexedDB or decodeAudioData.
//
// This engine is NOT in the engine registry (like WorkletLaneEngine and
// DrumsWorkletEngine): the lane allocator constructs it directly on the worklet
// backend. The legacy SamplerEngine (sampler.ts) keeps the 'sampler' registry
// entry as the offline-render source until Phase 4 (cutover).

import { html, render } from 'lit-html';
import { renderElement } from '../core/lit-fragment';
import { samplerEditorTemplate, zoneRangeRowTemplate } from './sampler-editor-templates';
import type {
  SynthEngine, Voice, EngineUIContext, VoiceTriggerOptions,
} from './engine-types';
import type { EngineParamSpec } from './engine-params';
import { ModulationHostImpl } from '../modulation/modulation-host';
import { requireModulator } from '../modulation/modulator-registry';
import type { ModulatorVoice } from '../modulation/types';
import { renderModulatorsPanel, type ModulationUIDeps } from '../modulation/modulation-ui';
import { getCurrentLaneForVoice } from '../modulation/active-mods';
import {
  bindEngineModulators, reapplyLaneModulations, disposeLaneModulations, disposeEngineMods,
} from '../modulation/voice-mod-binding';
import type { KeymapEntry } from '../samples/types';
import { sampleCache } from '../samples/sample-cache';
import { keymapEntryFor, repitchRate } from '../samples/keymap';
import { buildEngineParamGrid } from './engine-param-grid';
import { sampleStore } from '../samples/store-singleton';
import { importFile } from '../samples/import';
import { addSampleToKeymap, removeKeymapEntry, setEntryRoot, setEntryRange } from '../samples/keymap-edit';
import { mirrorKeymapChange, mirrorDrumkitId, mirrorInstrumentId, mirrorSamplerPreset, mirrorPadParams } from '../session/session-engine-state';
import { fetchDrumkitManifest, loadDrumkit } from '../samples/drumkit-loader';
import { fetchInstrumentManifest, loadInstrument, loadPresetZones } from '../samples/instrument-loader';
import { getCachedPresets } from '../presets/preset-loader';
import { PAD_DEFAULTS, PAD_LEAF_SPECS, padKeyForNote, noteForPadKey, nextFreePadNote, type PadParams } from './sampler-pad-params';
import { defaultChokeGroup } from './sampler-choke';
import { renderSamplerKeyboardMap, noteName, padColor } from './sampler-keyboard-map';
import { renderSampleViewer } from './sampler-sample-viewer';
import { mountKeyboardConnectors } from './sampler-keyboard-connectors';
import { renderLoopOverview } from './sampler-loop-overview';
import type { FxBus } from '../core/fx';
import { computeVoiceMutes } from '../core/mute-solo';
import { renderDrumVoiceRack, VOICE_LABELS } from './drum-voice-rack';
import { GM_DRUM_MAP } from './drum-gm-map';
import { velGain } from '../core/velocity-gain';
import { OUTPUT_TRIM, resolveAudioClipPlayback } from './audio-clip-voice';
import { CATEGORY_GAIN, SAMPLE_HEADROOM } from '../audio-dsp/gain-staging';
import { samplePlaybackWindow } from './sampler-playback-window';
import { withUndo } from '../save/history-wiring';
import { guessRootNoteFromName } from './sampler';
import type { KnobHandle } from '../core/knob';
import { SamplerWorkletNode } from '../audio-worklet/sampler-node';
import type { SampleSpawn } from '../audio-dsp/sample/types';
import type { ChannelStrip } from '../core/fx';
import {
  STRIP_PARAM_SPECS, isStripParamId, getStripParam, setStripParam, stripAudioParams,
} from '../core/channel-strip-params';

const SAMPLER_PARAMS: EngineParamSpec[] = [
  { id: 'gain',            label: 'Gain',   kind: 'continuous', min: 0,              max: 1.5,             default: 1 },
  { id: 'poly.voices',     label: 'Voices', kind: 'continuous', min: 1,              max: 16,              default: 8 },
];

/** Thin voice posting resolved spawns to the shared worklet node. One per note;
 *  the worklet pools the actual playing voices. */
class SamplerWorkletVoice implements Voice {
  constructor(private engine: SamplerWorkletEngine) {}
  trigger(midi: number, time: number, opts: VoiceTriggerOptions): void {
    this.engine.spawnFor(midi, time, opts);
  }
  release(time: number): void { this.engine.silence(time); }
  connect(_dest: AudioNode): void { /* worklet node is connected by the engine */ }
  getAudioParams(): Map<string, AudioParam> { return new Map(); }
  dispose(): void { /* no per-note nodes */ }
}

export class SamplerWorkletEngine implements SynthEngine {
  readonly id = 'sampler';
  readonly name = 'Sampler';
  readonly type = 'polyhost' as const;
  readonly polyphony = 'poly' as const;
  readonly editor = 'piano-roll' as const;
  // Normal Sampler presets (public/presets/sampler.json) — melodic multi-zone
  // instruments whose wavs load from each zone's URL. Loaded by the standard
  // preset path (loadAllPresets at boot); applied via loadFamilyRef('preset:…').
  get presets(): import('./engine-types').EnginePreset[] { return getCachedPresets('sampler'); }

  // dynamic: globals + one <padKey>.<leaf> spec per keymap entry.
  get params(): EngineParamSpec[] {
    const out: EngineParamSpec[] = [...SAMPLER_PARAMS];
    for (const entry of this.keymap) {
      const key = padKeyForNote(entry.rootNote);
      for (const s of PAD_LEAF_SPECS) {
        const { leaf, ...rest } = s;
        out.push({ ...rest, id: `${key}.${leaf}` });
      }
    }
    return out;
  }

  private paramValues: Record<string, number> = {};
  private padStore: Record<number, Partial<PadParams>> = {};
  private fx: FxBus | null = null;
  private keymap: KeymapEntry[] = [];
  private selectedPadNote: number | null = null;
  private uiCtx: EngineUIContext | null = null;
  private uiRebuild: (() => void) | null = null;
  // Lazy — see DescriptorEngineConfig.modulators (descriptor-engine.ts) for
  // why: getModulator('lfo')/('adsr') must not be read at module/construction
  // scope, since nothing orders this file's eager glob against the modulator
  // components' eager glob. Built once, on first real access.
  private _modHost: ModulationHostImpl | undefined;
  private getModHost(): ModulationHostImpl {
    if (!this._modHost) {
      const lfo = requireModulator('lfo');
      const adsr = requireModulator('adsr');
      this._modHost = new ModulationHostImpl([lfo.defaultState('lfo1'), adsr.defaultState('adsr1')]);
    }
    return this._modHost;
  }
  /** Tempo for LFO BPM sync — updated by main.ts when seq.bpm changes. */
  bpm = 120;
  private engineModVoices: Map<string, ModulatorVoice> | null = null;
  private currentLaneId: string | null = null;
  /** Per-category output gain (sampler vs drum vs audio). DrumsWorkletEngine sets
   *  this so its embedded sampler plays at the 'drum' category level. */
  private categoryGain = CATEGORY_GAIN.sampler;
  setCategoryGain(g: number): void { this.categoryGain = g; }

  // ── Worklet node (built lazily once the ctx is known) ─────────────────────────
  private node: SamplerWorkletNode | null = null;
  private ctx: AudioContext | null = null;
  /** Connect targets, applied to the node when it is (re)built. */
  private dryTarget: AudioNode | null = null;
  /** Build the worklet node + connect it (dry → lane strip, send → FxBus).
   *  Filtering the channel is a `multifilter` in the lane insert chain like any
   *  other lane — no engine-owned filter node here, which is what keeps the
   *  offline render faithful (the exporter rehydrates inserts). Idempotent. */
  private ensureNode(ctx: AudioContext): SamplerWorkletNode {
    if (this.node && this.ctx === ctx) return this.node;
    this.ctx = ctx;
    this.node = new SamplerWorkletNode(ctx);
    // A (re)built node starts with an uncapped pool — hand it the lane's
    // current budget, the same way the connect targets are re-applied.
    this.node.setMaxVoices(Math.max(1, Math.min(16, Math.round(this.paramValues['poly.voices'] ?? 8))));
    if (this.dryTarget) this.node.connectDry(this.dryTarget);
    if (this.fx) this.node.connectSend(this.fx.delayInput, this.fx.reverbInput);
    // Any buffers already in the cache for the current keymap get pushed now.
    this.pushAllKeymapBuffers();
    return this.node;
  }

  /** The allocator wires the dry output to the lane insert chain / strip. */
  setOutputTarget(n: AudioNode): void {
    this.dryTarget = n;
    if (this.node) this.node.connectDry(n);
  }

  setSharedFx(fx: FxBus): void {
    this.fx = fx;
    if (this.node) this.node.connectSend(fx.delayInput, fx.reverbInput);
  }

  /** Push a decoded buffer to the worklet bank if it is cached + not yet sent. */
  private pushBuffer(sampleId: string): void {
    if (!this.node) return;
    if (this.node.hasSample(sampleId)) return;
    const buf = sampleCache.get(sampleId);
    if (buf) this.node.loadSample(sampleId, buf);
  }
  /** Push every keymap sample currently in the cache (e.g. after node rebuild). */
  private pushAllKeymapBuffers(): void {
    for (const e of this.keymap) this.pushBuffer(e.sampleId);
  }

  // ── per-voice mute/solo (drumkit kits) ───────────────────────────────────────
  private voiceMute: Record<string, boolean> = {};
  private voiceSolo: Record<string, boolean> = {};
  getDrumVoiceMute(v: string): boolean { return !!this.voiceMute[v]; }
  setDrumVoiceMute(v: string, m: boolean): void { this.voiceMute[v] = m; }
  getDrumVoiceSolo(v: string): boolean { return !!this.voiceSolo[v]; }
  toggleDrumVoiceSolo(v: string): void { this.voiceSolo[v] = !this.voiceSolo[v]; }
  getDrumVoiceMutes(): Record<string, boolean> { return { ...this.voiceMute }; }
  setDrumVoiceMutes(m: Record<string, boolean>): void { this.voiceMute = { ...m }; }

  private onPadEdit: (() => void) | null = null;
  setPadEditHook(fn: (() => void) | null): void { this.onPadEdit = fn; }

  getRackLayout() {
    return {
      curatedSynth: ['tune', 'cutoff', 'decay'],
      curatedMixer: ['level', 'rev', 'dly'],
      advancedMixer: ['pan'],
    };
  }

  private isDrumkit(): boolean {
    return this.keymap.length > 0 && this.keymap.every((e) => e.loNote === e.hiNote && e.hiNote === e.rootNote);
  }

  /** True if the pad at `note` should sound now (per mute/solo over the kit's
   *  voice keys). Read by spawnFor at trigger time. */
  isPadAudible(note: number): boolean {
    const keys = this.keymap.map((e) => padKeyForNote(e.rootNote));
    const muted = computeVoiceMutes(keys, this.voiceMute, this.voiceSolo);
    return !muted[padKeyForNote(note)];
  }

  /** Resolved pad params for a note (defaults merged with stored overrides). The
   *  chokeGroup default is note-aware: GM hi-hats on a drumkit start in group 1 so
   *  a freshly-loaded kit chokes its hats with no setup (an explicit store wins). */
  getPad(note: number): PadParams {
    const canonical = noteForPadKey(padKeyForNote(note));
    const stored = this.padStore[canonical] ?? {};
    const pad = { ...PAD_DEFAULTS, ...stored };
    if (stored.chokeGroup == null) pad.chokeGroup = defaultChokeGroup(canonical, this.isDrumkit());
    return pad;
  }

  getPadStore(): Record<number, Partial<PadParams>> { return this.padStore; }
  /** Bulk-replace the WHOLE pad store — undo/redo restore, session/demo load, and
   *  a family switch (loadFamilyRef) all land here without touching a single
   *  knob. Unlike setBaseValue's single-pad edit, nothing else pushes these
   *  values to the worklet's live table, which otherwise seeds a pad ONCE from
   *  its first spawn and never again (C1, 2026-07-26 continuous-params review):
   *  a knob could be dragged, then undone, and the sounding/next-triggered voice
   *  would keep reading the pre-undo value forever. Resync every pad the OLD or
   *  NEW store touches (their union) so a value that reverts to default — not
   *  just one that changes — is pushed too. */
  setPadStore(store: Record<number, Partial<PadParams>>): void {
    const affected = new Set<number>();
    for (const k of Object.keys(this.padStore)) affected.add(Number(k));
    for (const k of Object.keys(store)) affected.add(Number(k));
    this.padStore = {};
    for (const [k, v] of Object.entries(store)) this.padStore[Number(k)] = { ...v };
    for (const note of affected) this.pushPadParams(note);
  }

  get modulators(): ModulationHostImpl { return this.getModHost(); }

  /** Make an edit to `modulators` audible now. The panel's knobs call it, and so
   *  does an automation curve on a connection depth — which must not need the
   *  panel open to be heard. The sampler modulates Web-Audio params, so the
   *  connection binder is the whole of it. */
  onModulationEdited(laneId: string): void {
    reapplyLaneModulations(laneId);
  }

  /** The lane's mixer strip is the engine's only shared Web-Audio surface:
   *  filtering a sampler lane is a `multifilter` insert, whose params are already
   *  destinations (`<laneId>.fx:<slotId>.<param>`), but level/pan/sends/EQ are
   *  native nodes on the channel and an LFO reaches them directly. */
  getSharedAudioParams(): Map<string, AudioParam> {
    if (!this.busStrip) return new Map<string, AudioParam>();
    return stripAudioParams(this.busStrip);
  }

  /** The lane's mixer channel, handed over by the allocator after construction. */
  setBusStrip(strip: ChannelStrip): void { this.busStrip = strip; }
  private busStrip: ChannelStrip | null = null;

  /** Range lookup for the modulation depth bridge. */
  private paramRangeLookup = (id: string): { min: number; max: number } => {
    const s = this.params.find((p) => p.id === id);
    return { min: s?.min ?? 0, max: s?.max ?? 1 };
  };

  constructor() {
    for (const p of SAMPLER_PARAMS) this.paramValues[p.id] = p.default;
  }

  getBaseValue(id: string): number {
    // Strip params FIRST: their ids are dotted, and 'bus.level' would otherwise
    // fall into the per-pad branch below (`level` IS a pad leaf) and read the
    // pad of a note called "bus".
    if (isStripParamId(id)) {
      const v = this.busStrip ? getStripParam(this.busStrip, id) : undefined;
      return v ?? STRIP_PARAM_SPECS.find((p) => p.id === id)?.default ?? 0;
    }
    if (id in this.paramValues) return this.paramValues[id];
    const dot = id.indexOf('.');
    if (dot > 0) {
      const key = id.slice(0, dot);
      const leaf = id.slice(dot + 1) as keyof PadParams;
      if (leaf in PAD_DEFAULTS) {
        const note = noteForPadKey(key);
        const stored = this.padStore[note]?.[leaf];
        if (typeof stored === 'number') return stored;
        // Note-aware default so the CHOKE dropdown shows group 1 for GM hi-hats on
        // a drumkit out of the box (mirrors getPad); all other leaves use PAD_DEFAULTS.
        if (leaf === 'chokeGroup') return defaultChokeGroup(note, this.isDrumkit());
        return PAD_DEFAULTS[leaf];
      }
    }
    return SAMPLER_PARAMS.find((p) => p.id === id)?.default ?? 0;
  }

  setBaseValue(id: string, v: number): void {
    if (isStripParamId(id)) {
      if (this.busStrip) setStripParam(this.busStrip, id, v);
      return;
    }
    // poly.voices reaches the PROCESSOR, not just the param bag: the sampler
    // pools its voices in its own worklet, so a value that stayed main-thread
    // was a knob that did nothing (the audit's "same lie, different room").
    if (id === 'poly.voices') {
      const n = Math.max(1, Math.min(16, Math.round(v)));
      this.paramValues[id] = n;
      this.node?.setMaxVoices(n);
      return;
    }
    if (id in this.paramValues || SAMPLER_PARAMS.some((p) => p.id === id)) {
      this.paramValues[id] = v;
      return;
    }
    const dot = id.indexOf('.');
    if (dot <= 0) return;
    const key = id.slice(0, dot);
    const leaf = id.slice(dot + 1) as keyof PadParams;
    if (!(leaf in PAD_DEFAULTS)) return;
    const note = noteForPadKey(key);
    (this.padStore[note] ??= {})[leaf] = v;
    this.pushPadParams(note);
    this.onPadEdit?.();
  }

  /** Push one pad's resolved continuous values to the worklet's live table — the
   *  voices ALREADY sounding hear the change (the spawn only froze the trigger).
   *  getPad merges the store over the defaults, so this always sends a complete
   *  set. `node` is null before the first sound, and then there is nothing
   *  sounding to update. */
  private pushPadParams(note: number): void {
    if (!this.node) return;
    const pad = this.getPad(note);
    this.node.setPadParams(note, {
      cutoff: pad.cutoff, res: pad.res, level: pad.level,
      pan: pad.pan, rev: pad.rev, dly: pad.dly,
    });
  }

  setKeymap(entries: KeymapEntry[]): void {
    this.keymap = entries;
    this.pushAllKeymapBuffers();
  }
  getKeymap(): KeymapEntry[] {
    return this.keymap;
  }

  applyPreset(name: string): void {
    const p = this.presets.find((x) => x.name === name);
    if (!p) return;
    for (const [k, v] of Object.entries(p.params)) this.paramValues[k] = v;
  }

  /** Load a Sampler "preset" by namespaced ref — the unified PRESET path:
   *   - 'preset:<name>'  a normal preset from presets/sampler.json (zone URLs);
   *   - 'drumkit:<id>'   a bundled GM drumkit;
   *   - 'melodic:<id>' / 'loop:<id>'  a legacy bundled instrument manifest.
   *  The three sampler sub-ids (presetName / drumkitId / instrumentId) are
   *  mutually exclusive; each branch clears the others so the load path stays
   *  unambiguous. */
  async loadFamilyRef(ref: string): Promise<void> {
    const ctx = this.uiCtx;
    const audioCtx = ctx?.audioContext;
    if (!ctx || !audioCtx) return;
    const sep = ref.indexOf(':');
    if (sep < 0) return;
    const family = ref.slice(0, sep) as 'melodic' | 'drumkit' | 'loop' | 'preset';
    const id = ref.slice(sep + 1);
    if (family === 'preset') {
      const preset = this.presets.find((p) => p.name === id);
      if (preset?.zones) {
        const km = await loadPresetZones(preset.zones, audioCtx);
        this.setKeymap(km);
        for (const [k, v] of Object.entries(preset.params)) this.paramValues[k] = v;
        if (ctx.sessionState) {
          mirrorKeymapChange(ctx.sessionState, ctx.laneId, km);
          mirrorSamplerPreset(ctx.sessionState, ctx.laneId, id);
          mirrorInstrumentId(ctx.sessionState, ctx.laneId, undefined);
          mirrorDrumkitId(ctx.sessionState, ctx.laneId, undefined);
        }
      }
    } else if (family === 'drumkit') {
      const manifest = await fetchDrumkitManifest(id);
      const km = await loadDrumkit(manifest, audioCtx);
      this.setKeymap(km);
      if (ctx.sessionState) {
        mirrorKeymapChange(ctx.sessionState, ctx.laneId, km);
        mirrorDrumkitId(ctx.sessionState, ctx.laneId, id);
        mirrorInstrumentId(ctx.sessionState, ctx.laneId, undefined);
        mirrorSamplerPreset(ctx.sessionState, ctx.laneId, undefined);
      }
    } else {
      const manifest = await fetchInstrumentManifest(id);
      const loaded = await loadInstrument(manifest, audioCtx);
      this.setKeymap(loaded.keymap);
      if (ctx.sessionState) {
        mirrorKeymapChange(ctx.sessionState, ctx.laneId, loaded.keymap);
        mirrorInstrumentId(ctx.sessionState, ctx.laneId, id);
        mirrorDrumkitId(ctx.sessionState, ctx.laneId, undefined);
        mirrorSamplerPreset(ctx.sessionState, ctx.laneId, undefined);
      }
      if (family === 'melodic' && 'padParams' in loaded && loaded.padParams) {
        const pad = loaded.padParams as Record<number, Record<string, number>>;
        this.setPadStore(pad);
        if (ctx.sessionState) mirrorPadParams(ctx.sessionState, ctx.laneId, pad);
      }
      if (family === 'loop' && 'slicePointsSec' in loaded) {
        document.dispatchEvent(new CustomEvent('loom:loop-loaded', {
          detail: {
            laneId: ctx.laneId,
            slicePointsSec: loaded.slicePointsSec,
            durationSec: loaded.durationSec,
            originalBpm: loaded.originalBpm,
            loopSampleId: loaded.loopSampleId,
          },
        }));
      }
    }
    this.selectedPadNote = null;
    document.dispatchEvent(new CustomEvent('loom:lane-engine-ui-changed', { detail: { laneId: ctx.laneId } }));
    this.uiRebuild?.();
  }

  createVoice(ctx: AudioContext, output: AudioNode): Voice {
    // Default the dry target to `output` if the allocator hasn't set one.
    if (!this.dryTarget) this.dryTarget = output;
    this.ensureNode(ctx);
    // Spawn engine-level modulators (LFO/ADSR) once and bind them to the filter.
    if (!this.engineModVoices) {
      this.engineModVoices = this.getModHost().spawnVoice(ctx, () => this.bpm);
    }
    const laneId = getCurrentLaneForVoice();
    if (laneId) {
      bindEngineModulators({
        laneId, engine: this, voiceMods: this.engineModVoices, ctx,
        rangeLookup: this.paramRangeLookup,
      });
      this.currentLaneId = laneId;
    }
    return new SamplerWorkletVoice(this);
  }

  /** Resolve + post a spawn for a triggered note (the heart of the port). Mirrors
   *  the math in the legacy SamplerVoice.trigger / triggerSample. */
  spawnFor(midi: number, time: number, opts: VoiceTriggerOptions): void {
    const node = this.node;
    if (!node) return;
    const r = this.resolveSpawn(midi, time, opts, this.ctx);
    if (!r) return;
    if (!node.hasSample(r.spawn.sampleId)) node.loadSample(r.spawn.sampleId, r.buffer);
    node.spawn(r.kind, r.spawn);
  }

  /** Pure spawn resolution: turn a triggered note into the SampleSpawn the
   *  renderer plays + the AudioBuffer to register under spawn.sampleId. Shared by
   *  spawnFor (live) and the offline scene recorder (which renders the spawn
   *  through SamplerRenderer/AudioClipRenderer instead of the worklet). `ctx` is
   *  needed only for the audio-clip warp/stretch path. */
  resolveSpawn(
    midi: number, time: number, opts: VoiceTriggerOptions, ctx: AudioContext | null,
  ): { kind: 'sampler' | 'audio'; spawn: SampleSpawn; buffer: AudioBuffer } | null {
    // Loop/song audio-clip path: resolve the (warp/stretch) buffer main-thread.
    if (opts.sample) {
      if (!ctx) return null;
      const resolved = resolveAudioClipPlayback({
        ctx, sample: opts.sample, gateDuration: opts.gateDuration,
        masterGain: this.getBaseValue('gain'), offsetSec: opts.offsetSec,
      });
      if (!resolved) return null;
      return {
        kind: 'audio', buffer: resolved.buffer,
        spawn: neutralAudioSpawn(resolved.bufferId, time, opts.gateDuration, resolved.rate, resolved.offset, resolved.gain * this.categoryGain),
      };
    }

    const entry = keymapEntryFor(this.keymap, midi);
    if (!entry) return null;
    const buf = sampleCache.get(entry.sampleId);
    if (!buf) return null;
    // Make sure the buffer is in the worklet bank (live path; harmless offline).
    this.pushBuffer(entry.sampleId);

    const pad = this.getPad(entry.rootNote);
    const rate = repitchRate(midi, entry.rootNote, pad.tune);
    const win = samplePlaybackWindow(pad, buf.duration);
    const audible = this.isPadAudible(entry.rootNote) ? 1 : 0;
    // Per-asset peak-normalization evens out the drumkit library's level spread
    // (TR-808/Acoustic/GM-percussion arrive 5-7 dB quieter than the rest). Keymap
    // path only — audio clips/loops/stems keep their intentional mix level.
    const gain = this.getBaseValue('gain') * (entry.gain ?? 1) * sampleCache.normGain(entry.sampleId)
      * (SAMPLE_HEADROOM * velGain(opts.velocity, !!opts.accent)) * OUTPUT_TRIM * this.categoryGain * audible;

    const spawn: SampleSpawn = {
      sampleId: entry.sampleId,
      beginSec: time,
      gateSec: opts.gateDuration,
      rate,
      offsetSec: win.offset,
      loop: win.loop,
      loopStartSec: win.loopStart,
      loopEndSec: win.loopEnd,
      // One-shot trim-out: win.duration is the buffer-time window length (null for
      // loops). The absolute end = offset + duration, so audio past the pad's
      // sampleEnd never sounds (legacy src.start(t, offset, duration)).
      ...(win.duration != null ? { endSec: win.offset + win.duration } : {}),
      cutoff: pad.cutoff,
      res: pad.res,
      attack: Math.max(0.001, pad.attack),
      decay: Math.max(0.005, pad.decay),
      level: pad.level,
      pan: pad.pan,
      rev: pad.rev,
      dly: pad.dly,
      gain,
      // Choke: a non-zero group cuts ringing group-mates; retrig=mono self-cuts
      // this pad. padNote is the pad identity for the mono cut. (Worklet path only;
      // the offline renderer pools voices per-clip and doesn't apply choke.)
      chokeGroup: pad.chokeGroup,
      padNote: entry.rootNote,
      retrig: pad.retrig,
    };
    return { kind: 'sampler', spawn, buffer: buf };
  }

  /** Silence the live voices (a long loop/song clip would otherwise play to the
   *  end). `atSec` (audio-clock seconds) schedules the cut for that instant — the
   *  gapless scene switch cuts the outgoing clip exactly when the incoming one
   *  starts. Omit it for an immediate cut (transport Stop). The registry's stop
   *  seam routes here via the voice's release(time). */
  silence(atSec?: number): void { this.node?.silenceAll(atSec); }


  buildParamUI(container: HTMLElement, ctx?: EngineUIContext): void {
    container.innerHTML = '';
    if (!ctx) return;

    this.setPadEditHook(ctx.sessionState
      ? () => mirrorPadParams(ctx.sessionState!, ctx.laneId, this.getPadStore() as Record<number, Record<string, number>>)
      : null);

    const rebuild = () => { container.innerHTML = ''; this.buildParamUI(container, ctx); };
    this.uiCtx = ctx;
    this.uiRebuild = rebuild;

    const laneSampler = ctx.sessionState?.lanes.find((l) => l.id === ctx.laneId)?.engineState?.sampler;
    const singleNote = this.isDrumkit();
    const isLoop = singleNote && !!laneSampler?.instrumentId;
    const isDrumkitView = singleNote && !laneSampler?.instrumentId;
    const isMelodicView = this.keymap.length > 0 && !singleNote;
    const isChannelView = this.keymap.length > 0;

    // Hosts for canvas/imperative sub-renderers come from one-shot templates
    // (renderElement) and are interpolated into the scaffold at the end; the
    // sub-renderers themselves stay imperative (canvas drawing).
    let loopOverview: HTMLElement | null = null;
    if (isLoop) {
      loopOverview = renderElement(html`<div class="sampler-loop-overview"></div>`);
      renderLoopOverview(loopOverview, this.keymap);
    }

    let keyboardHost: HTMLElement | null = null;
    if (this.keymap.length) {
      keyboardHost = renderElement(html`<div class="sampler-keymap-viz"></div>`);
      renderSamplerKeyboardMap(keyboardHost, this.keymap, { drumkit: singleNote });
    }

    // Import status + the two hidden pickers are leaf nodes built up-front so
    // the scaffold's buttons and the async import path can close over them.
    const importStatus = renderElement<HTMLSpanElement>(html`<span class="sampler-import-status"></span>`);
    const loopInput = renderElement<HTMLInputElement>(html`<input type="file" accept="audio/*"
      class="sampler-load-loop" style="display:none" @change=${(e: Event) => {
        const input = e.currentTarget as HTMLInputElement;
        const file = input.files?.[0];
        if (file) {
          document.dispatchEvent(new CustomEvent('loom:import-loop', {
            detail: { laneId: ctx.laneId, file },
          }));
        }
        input.value = '';
      }}>`);
    const fileInput = renderElement<HTMLInputElement>(html`<input type="file" multiple accept="audio/*"
      class="sampler-load" style="display:none" @change=${(e: Event) => {
        const input = e.currentTarget as HTMLInputElement;
        const files = Array.from(input.files ?? []);
        if (files.length) void loadFiles(files);
        input.value = '';
      }}>`);

    const loadFiles = async (files: File[]) => {
      const audioCtx = ctx.audioContext;
      if (!audioCtx) {
        importStatus.textContent = ' audio not ready — press play once, then import';
        return;
      }
      let km = this.getKeymap();
      const failed: string[] = [];
      for (const file of files) {
        try {
          const asset = await importFile(file, audioCtx);
          await sampleStore.put(asset);
          const buf = await audioCtx.decodeAudioData(asset.bytes.slice(0));
          sampleCache.put(asset.id, buf);
          km = addSampleToKeymap(km, asset.id, { rootNote: guessRootNoteFromName(file.name) });
        } catch (err) {
          failed.push(`${file.name}: ${(err as Error).message}`);
        }
      }
      const commit = () => {
        this.setKeymap(km);
        if (ctx.sessionState) mirrorKeymapChange(ctx.sessionState, ctx.laneId, km);
      };
      if (ctx.historyDeps) withUndo(ctx.historyDeps, commit); else commit();
      importStatus.textContent = failed.length ? ` ${failed.join('; ')}` : '';
      rebuild();
    };

    let connHost: HTMLElement | null = null;
    let rackHost: HTMLElement | null = null;
    let viewerHost: HTMLElement | null = null;
    let renderViewer: () => void = () => {};
    if (isChannelView) {
      connHost = renderElement(html`<div class="sampler-keyboard-conn"></div>`);

      const rack = renderElement(html`<div></div>`);
      rackHost = rack;
      const voices = this.keymap.map((e) => padKeyForNote(e.rootNote));
      const voiceNote = new Map(this.keymap.map((e) => [padKeyForNote(e.rootNote), e.rootNote] as const));

      const padNotes = this.keymap.map((e) => e.rootNote);
      if (this.selectedPadNote == null || !padNotes.includes(this.selectedPadNote)) {
        this.selectedPadNote = padNotes[0] ?? null;
      }
      const viewer = renderElement(html`<div class="sampler-sample-viewer"></div>`);
      viewerHost = viewer;
      renderViewer = () => {
        const note = this.selectedPadNote;
        const idx = this.keymap.findIndex((e) => e.rootNote === note);
        if (idx < 0) { viewer.innerHTML = ''; return; }
        const entry = this.keymap[idx];
        const pad = this.getPad(note!);
        renderSampleViewer(viewer, {
          sampleId: entry.sampleId,
          keyLabel: noteName(note!),
          color: padColor(idx, this.keymap.length),
          loop: pad.loop >= 0.5,
          loopStart: pad.loopStart,
          loopEnd: pad.loopEnd,
          sampleStart: pad.sampleStart,
          sampleEnd: pad.sampleEnd,
          onEdit: (leaf, value) => {
            this.setBaseValue(`${padKeyForNote(note!)}.${leaf}`, value);
          },
        });
        if (isMelodicView) {
          const commit = (km: typeof this.keymap) => {
            this.setKeymap(km);
            if (ctx.sessionState) mirrorKeymapChange(ctx.sessionState, ctx.laneId, km);
            rebuild();
          };
          viewer.appendChild(renderElement(zoneRangeRowTemplate(entry, {
            root: (v) => { this.selectedPadNote = v; commit(setEntryRoot(this.getKeymap(), idx, v)); },
            lo: (v) => { commit(setEntryRange(this.getKeymap(), idx, v, this.keymap[idx].hiNote)); },
            hi: (v) => { commit(setEntryRange(this.getKeymap(), idx, this.keymap[idx].loNote, v)); },
          })));
        }
      };

      const noteOf = (voice: string): number => voiceNote.get(voice) ?? noteForPadKey(voice);
      const sliceIdx = new Map([...voiceNote.values()].sort((a, b) => a - b).map((n, i) => [n, i] as const));
      const labelFor = (voice: string): string => {
        const note = noteOf(voice);
        if (isLoop) return `Slice ${(sliceIdx.get(note) ?? 0) + 1}`;
        if (isDrumkitView) { const gm = GM_DRUM_MAP[note]; return gm ? VOICE_LABELS[gm] : noteName(note); }
        return noteName(note);
      };
      renderDrumVoiceRack(this, ctx, rack, voices, {
        labelOf: labelFor,
        ...((isDrumkitView || isLoop) ? { keyOf: (voice: string) => noteName(noteOf(voice)) } : {}),
        onDelete: (voice) => {
          if (this.keymap.length <= 1) return;
          const km = this.keymap.filter((e) => padKeyForNote(e.rootNote) !== voice);
          this.setKeymap(km);
          if (ctx.sessionState) mirrorKeymapChange(ctx.sessionState, ctx.laneId, this.keymap);
          rebuild();
        },
        isSelected: (voice) => voiceNote.get(voice) === this.selectedPadNote,
        onSelect: (voice) => { this.selectedPadNote = voiceNote.get(voice) ?? null; renderViewer(); },
        onAudition: (voice) => {
          document.dispatchEvent(new CustomEvent('loom:audition-note', { detail: { laneId: ctx.laneId, note: noteOf(voice) } }));
        },
        onAdd: isLoop ? undefined : (() => {
          if (isDrumkitView) {
            const proto = this.keymap[this.keymap.length - 1];
            if (!proto) return;
            const note = nextFreePadNote(this.keymap.map((e) => e.rootNote));
            this.setKeymap([...this.keymap, { sampleId: proto.sampleId, rootNote: note, loNote: note, hiNote: note }]);
            if (ctx.sessionState) mirrorKeymapChange(ctx.sessionState, ctx.laneId, this.keymap);
            rebuild();
          } else {
            // Transient picker — never attached to the DOM; clicked to open the chooser.
            const input = renderElement<HTMLInputElement>(html`<input type="file" multiple accept="audio/*"
              @change=${() => { const fs = Array.from(input.files ?? []); if (fs.length) void loadFiles(fs); }}>`);
            input.click();
          }
        }),
      });

      if (keyboardHost) {
        const pads = this.keymap.map((e, i) => ({
          note: e.rootNote, voice: padKeyForNote(e.rootNote), color: padColor(i, this.keymap.length),
        }));
        mountKeyboardConnectors(connHost, keyboardHost, rack, pads);
      }

      for (const e of this.keymap) {
        const v = padKeyForNote(e.rootNote);
        void sampleStore.get(e.sampleId).then((asset) => {
          if (!asset) return;
          const col = rack.querySelector<HTMLElement>(`.dv-col[data-voice="${v}"]`);
          if (col) col.title = asset.name;
        }).catch(() => { /* no store / no IndexedDB (tests) — skip the tooltip */ });
      }
    }

    const knobRow = renderElement(html`<div class="knob-row"></div>`);
    buildEngineParamGrid(this, ctx, knobRow, {
      layout: 'flat', skip: (id) => !SAMPLER_PARAMS.some((p) => p.id === id) || id.startsWith('filter.'),
      formatter: (id, v) => {
        if (id === 'poly.voices') return `${Math.round(v)}`;
        if (id.endsWith('.attack') || id.endsWith('.release')) {
          return v < 1 ? `${Math.round(v * 1000)}ms` : `${v.toFixed(2)}s`;
        }
        return `${Math.round(v * 100)}%`;
      },
    });

    // CHANNEL FILTER row — filter.* are excluded from the generic knobRow above
    // so they only appear inside the labelled section the scaffold renders.
    const filterRow = renderElement(html`<div class="knob-row"></div>`);
    buildEngineParamGrid(this, ctx, filterRow, {
      layout: 'flat', skip: (id) => id !== 'filter.cutoff' && id !== 'filter.resonance',
      formatter: (id, v) =>
        id === 'filter.cutoff'
          ? (v >= 1000 ? `${(v / 1000).toFixed(1)}k` : `${Math.round(v)}`)
          : v.toFixed(1),
    });

    // One-shot scaffold render into a throwaway fragment: every structural
    // change funnels through rebuild() (wipe + buildParamUI), so there is no
    // repaint lifecycle to manage — same pattern as engine-param-grid.ts.
    const frag = document.createDocumentFragment();
    render(samplerEditorTemplate({
      isLoop, isDrumkitView, isMelodicView, isChannelView,
      keymap: this.getKeymap(),
      loopOverview, keyboardViz: keyboardHost, connHost, rackHost, viewerHost,
      knobRow, filterRow, loopInput, fileInput, importStatus,
      onRootChange: (i, value) => {
        const km = setEntryRoot(this.getKeymap(), i, value);
        this.setKeymap(km);
        if (ctx.sessionState) mirrorKeymapChange(ctx.sessionState, ctx.laneId, km);
      },
      onDeleteEntry: (i) => {
        const km = removeKeymapEntry(this.getKeymap(), i);
        this.setKeymap(km);
        if (ctx.sessionState) mirrorKeymapChange(ctx.sessionState, ctx.laneId, km);
        rebuild();
      },
      zoneParamsFor: (entry) => {
        const zoneKey = padKeyForNote(entry.rootNote); // zone<root>
        const params = renderElement(html`<div class="sampler-zone-params knob-row"></div>`);
        buildEngineParamGrid(this, ctx, params, {
          layout: 'flat', knobSize: 30,
          skip: (id) => !id.startsWith(`${zoneKey}.`),
        });
        return params;
      },
    }), frag);
    container.appendChild(frag);
    renderViewer();

    // MODULATORS panel — lets LFO/ADSR route to the channel filter (Task 11b).
    // Mirrors the drums engine pattern so the sampler filter is modulatable from
    // the UI (acceptance #5: "modulatable" must be reachable from the editor).
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
      host: this.getModHost(),
      registry: ctx.registry as Map<string, KnobHandle>,
      registerKnob: (k) => ctx.registerKnob(k),
      lookupLaneDisplayName: ctx.lookupLaneDisplayName,
      sessionState: ctx.sessionState,
      historyDeps: ctx.historyDeps,
      destinations: ctx.destinations,
      onLiveEdit: () => { if (this.currentLaneId) this.onModulationEdited(this.currentLaneId); },
      onChange: () => {
        if (this.currentLaneId) reapplyLaneModulations(this.currentLaneId);
        renderModulatorsPanel(container, modDeps);
      },
    };
    renderModulatorsPanel(container, modDeps);
  }

  dispose(): void {
    disposeEngineMods(this.engineModVoices, this.currentLaneId);
    this.engineModVoices = null;
    this.currentLaneId = null;
    this.keymap = [];
    this.node?.dispose();   // kill the processor, not just disconnect (phantom-processor leak)
    this.node = null;
  }
}

/** A neutral (no filter colour, no sends) audio-clip spawn — the Audio channel
 *  and the Sampler's loop/song path play a buffer flat. cutoff=1 (wide open),
 *  res=0; the AudioClipRenderer ignores the filter/env fields anyway. */
export function neutralAudioSpawn(
  sampleId: string, beginSec: number, gateSec: number, rate: number, offsetSec: number, gain: number,
): SampleSpawn {
  return {
    sampleId, beginSec, gateSec, rate, offsetSec,
    loop: false, loopStartSec: 0, loopEndSec: 0,
    cutoff: 1, res: 0, attack: 0.005, decay: 0.05,
    level: 1, pan: 0, rev: 0, dly: 0, gain,
  };
}
