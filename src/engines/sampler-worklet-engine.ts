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

import type {
  SynthEngine, Voice, EngineSequencer, EngineUIContext, VoiceTriggerOptions,
} from './engine-types';
import type { EngineParamSpec } from './engine-params';
import { ModulationHostImpl } from '../modulation/modulation-host';
import type { KeymapEntry } from '../samples/types';
import { sampleCache } from '../samples/sample-cache';
import { keymapEntryFor, repitchRate } from '../samples/keymap';
import { wireEngineParams } from './engine-ui';
import { sampleStore } from '../samples/store-singleton';
import { importFile } from '../samples/import';
import { addSampleToKeymap, removeKeymapEntry, setEntryRoot, setEntryRange } from '../samples/keymap-edit';
import { mirrorKeymapChange, mirrorDrumkitId, mirrorInstrumentId, mirrorPadParams } from '../session/session-engine-state';
import { fetchDrumkitManifest, loadDrumkit } from '../samples/drumkit-loader';
import { fetchInstrumentManifest, loadInstrument } from '../samples/instrument-loader';
import { PAD_DEFAULTS, PAD_LEAF_SPECS, padKeyForNote, noteForPadKey, nextFreePadNote, type PadParams } from './sampler-pad-params';
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
import { SamplerWorkletNode } from '../audio-worklet/sampler-node';
import type { SampleSpawn } from '../audio-dsp/sample/types';

const SAMPLER_PARAMS: EngineParamSpec[] = [
  { id: 'gain',        label: 'Gain',   kind: 'continuous', min: 0, max: 1.5, default: 1 },
  { id: 'poly.voices', label: 'Voices', kind: 'continuous', min: 1, max: 16,  default: 8 },
];

class SamplerSequencer implements EngineSequencer {
  getStepAt(): unknown { return null; }
  setLength(): void {}
  highlight(): void {}
  serialize(): unknown { return null; }
  deserialize(): void {}
  dispose(): void {}
}

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
  readonly presets: import('./engine-types').EnginePreset[] = [];

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
  private modHost = new ModulationHostImpl([]);
  /** Per-category output gain (sampler vs drum vs audio). DrumsWorkletEngine sets
   *  this so its embedded sampler plays at the 'drum' category level. */
  private categoryGain = CATEGORY_GAIN.sampler;
  setCategoryGain(g: number): void { this.categoryGain = g; }

  // ── Worklet node (built lazily once the ctx is known) ─────────────────────────
  private node: SamplerWorkletNode | null = null;
  private ctx: AudioContext | null = null;
  /** Connect targets, applied to the node when it is (re)built. */
  private dryTarget: AudioNode | null = null;

  /** Build the worklet node + connect it (dry → lane strip, send → FxBus). The
   *  allocator calls setOutputTarget before the first createVoice. Idempotent. */
  private ensureNode(ctx: AudioContext): SamplerWorkletNode {
    if (this.node && this.ctx === ctx) return this.node;
    this.ctx = ctx;
    this.node = new SamplerWorkletNode(ctx);
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

  /** Resolved pad params for a note (defaults merged with stored overrides). */
  getPad(note: number): PadParams {
    const canonical = noteForPadKey(padKeyForNote(note));
    return { ...PAD_DEFAULTS, ...(this.padStore[canonical] ?? {}) };
  }

  getPadStore(): Record<number, Partial<PadParams>> { return this.padStore; }
  setPadStore(store: Record<number, Partial<PadParams>>): void {
    this.padStore = {};
    for (const [k, v] of Object.entries(store)) this.padStore[Number(k)] = { ...v };
  }

  get modulators(): ModulationHostImpl { return this.modHost; }

  constructor() {
    for (const p of SAMPLER_PARAMS) this.paramValues[p.id] = p.default;
  }

  getBaseValue(id: string): number {
    if (id in this.paramValues) return this.paramValues[id];
    const dot = id.indexOf('.');
    if (dot > 0) {
      const key = id.slice(0, dot);
      const leaf = id.slice(dot + 1) as keyof PadParams;
      if (leaf in PAD_DEFAULTS) {
        const note = noteForPadKey(key);
        const stored = this.padStore[note]?.[leaf];
        return typeof stored === 'number' ? stored : PAD_DEFAULTS[leaf];
      }
    }
    return SAMPLER_PARAMS.find((p) => p.id === id)?.default ?? 0;
  }

  setBaseValue(id: string, v: number): void {
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
    this.onPadEdit?.();
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

  /** Load a bundled instrument by namespaced ref ('drumkit:<id>' / 'melodic:<id>'
   *  / 'loop:<id>') — the unified PRESET path. Identical to the legacy engine. */
  async loadFamilyRef(ref: string): Promise<void> {
    const ctx = this.uiCtx;
    const audioCtx = ctx?.audioContext;
    if (!ctx || !audioCtx) return;
    const sep = ref.indexOf(':');
    if (sep < 0) return;
    const family = ref.slice(0, sep) as 'melodic' | 'drumkit' | 'loop';
    const id = ref.slice(sep + 1);
    if (family === 'drumkit') {
      const manifest = await fetchDrumkitManifest(id);
      const km = await loadDrumkit(manifest, audioCtx);
      this.setKeymap(km);
      if (ctx.sessionState) {
        mirrorKeymapChange(ctx.sessionState, ctx.laneId, km);
        mirrorDrumkitId(ctx.sessionState, ctx.laneId, id);
        mirrorInstrumentId(ctx.sessionState, ctx.laneId, undefined);
      }
    } else {
      const manifest = await fetchInstrumentManifest(id);
      const loaded = await loadInstrument(manifest, audioCtx);
      this.setKeymap(loaded.keymap);
      if (ctx.sessionState) {
        mirrorKeymapChange(ctx.sessionState, ctx.laneId, loaded.keymap);
        mirrorInstrumentId(ctx.sessionState, ctx.laneId, id);
        mirrorDrumkitId(ctx.sessionState, ctx.laneId, undefined);
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
    };
    return { kind: 'sampler', spawn, buffer: buf };
  }

  /** Silence the live voices (a long loop/song clip would otherwise play to the
   *  end). `atSec` (audio-clock seconds) schedules the cut for that instant — the
   *  gapless scene switch cuts the outgoing clip exactly when the incoming one
   *  starts. Omit it for an immediate cut (transport Stop). The registry's stop
   *  seam routes here via the voice's release(time). */
  silence(atSec?: number): void { this.node?.silenceAll(atSec); }

  buildSequencer(_c: HTMLElement, _n: number): EngineSequencer { return new SamplerSequencer(); }

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

    if (isLoop) {
      const loHost = document.createElement('div');
      loHost.className = 'sampler-loop-overview';
      container.appendChild(loHost);
      renderLoopOverview(loHost, this.keymap);
    }

    let keyboardHost: HTMLElement | null = null;
    if (this.keymap.length) {
      keyboardHost = document.createElement('div');
      keyboardHost.className = 'sampler-keymap-viz';
      container.appendChild(keyboardHost);
      renderSamplerKeyboardMap(keyboardHost, this.keymap, { drumkit: singleNote });
    }

    if (isChannelView) {
      const connHost = document.createElement('div');
      connHost.className = 'sampler-keyboard-conn';
      container.appendChild(connHost);

      const rackHost = document.createElement('div');
      container.appendChild(rackHost);
      const voices = this.keymap.map((e) => padKeyForNote(e.rootNote));
      const voiceNote = new Map(this.keymap.map((e) => [padKeyForNote(e.rootNote), e.rootNote] as const));

      const padNotes = this.keymap.map((e) => e.rootNote);
      if (this.selectedPadNote == null || !padNotes.includes(this.selectedPadNote)) {
        this.selectedPadNote = padNotes[0] ?? null;
      }
      const viewerLabel = document.createElement('div');
      viewerLabel.className = 'label sampler-viewer-label';
      viewerLabel.textContent = 'Selected sample';
      const viewerHost = document.createElement('div');
      viewerHost.className = 'sampler-sample-viewer';
      const renderViewer = () => {
        const note = this.selectedPadNote;
        const idx = this.keymap.findIndex((e) => e.rootNote === note);
        if (idx < 0) { viewerHost.innerHTML = ''; return; }
        const entry = this.keymap[idx];
        const pad = this.getPad(note!);
        renderSampleViewer(viewerHost, {
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
          const zr = document.createElement('div');
          zr.className = 'ssv-zone';
          const num = (label: string, val: number, onCh: (v: number) => void): HTMLElement => {
            const wrap = document.createElement('label');
            wrap.className = 'ssv-znum';
            wrap.append(label);
            const inp = document.createElement('input');
            inp.type = 'number'; inp.min = '0'; inp.max = '127'; inp.value = String(val);
            inp.addEventListener('change', () => onCh(Math.max(0, Math.min(127, Math.round(Number(inp.value))))));
            wrap.appendChild(inp);
            return wrap;
          };
          const commit = (km: typeof this.keymap) => {
            this.setKeymap(km);
            if (ctx.sessionState) mirrorKeymapChange(ctx.sessionState, ctx.laneId, km);
            rebuild();
          };
          zr.append(
            num('root ', entry.rootNote, (v) => { this.selectedPadNote = v; commit(setEntryRoot(this.getKeymap(), idx, v)); }),
            num('lo ', entry.loNote, (v) => { commit(setEntryRange(this.getKeymap(), idx, v, this.keymap[idx].hiNote)); }),
            num('hi ', entry.hiNote, (v) => { commit(setEntryRange(this.getKeymap(), idx, this.keymap[idx].loNote, v)); }),
          );
          viewerHost.appendChild(zr);
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
      renderDrumVoiceRack(this, ctx, rackHost, voices, {
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
            const input = document.createElement('input');
            input.type = 'file'; input.multiple = true; input.accept = 'audio/*';
            input.addEventListener('change', () => { const fs = Array.from(input.files ?? []); if (fs.length) void loadFiles(fs); });
            input.click();
          }
        }),
      });

      if (keyboardHost) {
        const pads = this.keymap.map((e, i) => ({
          note: e.rootNote, voice: padKeyForNote(e.rootNote), color: padColor(i, this.keymap.length),
        }));
        mountKeyboardConnectors(connHost, keyboardHost, rackHost, pads);
      }

      for (const e of this.keymap) {
        const v = padKeyForNote(e.rootNote);
        void sampleStore.get(e.sampleId).then((asset) => {
          if (!asset) return;
          const col = rackHost.querySelector<HTMLElement>(`.dv-col[data-voice="${v}"]`);
          if (col) col.title = asset.name;
        }).catch(() => { /* no store / no IndexedDB (tests) — skip the tooltip */ });
      }

      container.appendChild(viewerLabel);
      container.appendChild(viewerHost);
      renderViewer();
    }

    const knobRow = document.createElement('div');
    knobRow.className = 'knob-row';
    container.appendChild(knobRow);
    wireEngineParams(this, ctx, knobRow, {
      filter: (id) => SAMPLER_PARAMS.some((p) => p.id === id),
      formatter: (id, v) => {
        if (id === 'poly.voices') return `${Math.round(v)}`;
        if (id.endsWith('.attack') || id.endsWith('.release')) {
          return v < 1 ? `${Math.round(v * 1000)}ms` : `${v.toFixed(2)}s`;
        }
        return `${Math.round(v * 100)}%`;
      },
    });

    const section = document.createElement('div');
    section.className = 'sampler-keymap';
    container.appendChild(section);

    const heading = document.createElement('div');
    heading.className = 'label';
    heading.textContent = isDrumkitView ? 'Load kit' : (isMelodicView ? 'Load instrument' : 'Keymap');
    section.appendChild(heading);

    if (isLoop) {
      const loopHint = document.createElement('div');
      loopHint.className = 'sampler-loop-hint label';
      loopHint.textContent = 'Loop: each note is a slice. The notes are edited in the clip\'s piano-roll.';
      section.appendChild(loopHint);
    }

    const loopInput = document.createElement('input');
    loopInput.type = 'file';
    loopInput.accept = 'audio/*';
    loopInput.className = 'sampler-load-loop';
    loopInput.style.display = 'none';
    section.appendChild(loopInput);

    const importRow = document.createElement('div');
    importRow.className = 'sampler-import-row';

    const loopBtn = document.createElement('button');
    loopBtn.className = 'sampler-import-loop-btn';
    loopBtn.textContent = 'Import loop…';
    loopBtn.title = 'Import a loop: slices it and creates a note clip with its piano-roll';
    loopBtn.addEventListener('click', () => loopInput.click());
    importRow.appendChild(loopBtn);

    loopInput.addEventListener('change', () => {
      const file = loopInput.files?.[0];
      if (file) {
        document.dispatchEvent(new CustomEvent('loom:import-loop', {
          detail: { laneId: ctx.laneId, file },
        }));
      }
      loopInput.value = '';
    });

    const fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.multiple = true;
    fileInput.accept = 'audio/*';
    fileInput.className = 'sampler-load';
    fileInput.style.display = 'none';
    section.appendChild(fileInput);

    const importBtn = document.createElement('button');
    importBtn.className = 'sampler-import-btn';
    importBtn.textContent = 'Import samples…';
    importBtn.title = 'Import one or more audio files as keymap zones';
    importBtn.addEventListener('click', () => fileInput.click());
    importRow.appendChild(importBtn);
    section.appendChild(importRow);

    const importHint = document.createElement('div');
    importHint.className = 'sampler-import-hint label';
    importHint.textContent = 'Each audio file is added as a zone. Adjust each zone\'s range below.';
    if (isChannelView) importHint.style.display = 'none';
    section.appendChild(importHint);

    const importStatus = document.createElement('span');
    importStatus.className = 'sampler-import-status';
    section.appendChild(importStatus);

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

    fileInput.addEventListener('change', () => {
      const files = Array.from(fileInput.files ?? []);
      if (files.length) void loadFiles(files);
      fileInput.value = '';
    });

    const list = document.createElement('div');
    list.className = 'sampler-keymap-list';
    section.appendChild(list);
    const keymap = this.getKeymap();
    if (!isChannelView) keymap.forEach((entry, i) => {
      const row = document.createElement('div');
      row.className = 'sampler-keymap-row';

      const name = document.createElement('span');
      name.className = 'sampler-keymap-name';
      name.textContent = entry.sampleId;
      row.appendChild(name);

      const rootLabel = document.createElement('label');
      rootLabel.textContent = 'root ';
      const root = document.createElement('input');
      root.type = 'number';
      root.min = '0'; root.max = '127';
      root.value = String(entry.rootNote);
      root.className = 'sampler-keymap-root';
      root.addEventListener('change', () => {
        const km = setEntryRoot(this.getKeymap(), i, Number(root.value));
        this.setKeymap(km);
        if (ctx.sessionState) mirrorKeymapChange(ctx.sessionState, ctx.laneId, km);
      });
      rootLabel.appendChild(root);
      row.appendChild(rootLabel);

      const del = document.createElement('button');
      del.className = 'sampler-keymap-del';
      del.textContent = '✕';
      del.title = 'Remove';
      del.addEventListener('click', () => {
        const km = removeKeymapEntry(this.getKeymap(), i);
        this.setKeymap(km);
        if (ctx.sessionState) mirrorKeymapChange(ctx.sessionState, ctx.laneId, km);
        rebuild();
      });
      row.appendChild(del);

      if (!isChannelView) {
        const zoneKey = padKeyForNote(entry.rootNote); // zone<root>
        const params = document.createElement('div');
        params.className = 'sampler-zone-params knob-row';
        row.appendChild(params);
        wireEngineParams(this, ctx, params, {
          knobSize: 30,
          filter: (id) => id.startsWith(`${zoneKey}.`),
        });
      }

      list.appendChild(row);
    });
    if (keymap.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'sampler-keymap-empty';
      empty.textContent = 'No samples loaded yet.';
      list.appendChild(empty);
    }
  }

  dispose(): void {
    this.keymap = [];
    this.node?.disconnect();
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
