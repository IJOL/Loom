// src/engines/sampler.ts
// Sampler engine: plays one-shot samples pitched per MIDI note. Phase 2 of the
// sampler spec (loop/song clip playback, modulation wiring, voice-stealing and
// the keymap UI arrive in later plans). The voice is built in Task 7.

import type {
  SynthEngine, Voice, EngineSequencer, EngineUIContext,
} from './engine-types';
import type { EngineParamSpec } from './engine-params';
import { registerEngine, registerEngineFactory } from './registry';
import { ModulationHostImpl } from '../modulation/modulation-host';
import type { KeymapEntry } from '../samples/types';
import type { VoiceTriggerOptions } from './engine-types';
import { sampleCache } from '../samples/sample-cache';
import { stretchCache } from '../samples/stretch-cache';
import { keymapEntryFor, repitchRate } from '../samples/keymap';
import { wireEngineParams } from './engine-ui';
import { sampleStore } from '../samples/store-singleton';
import { importFile } from '../samples/import';
import { addSampleToKeymap, removeKeymapEntry, setEntryRoot } from '../samples/keymap-edit';
import { mirrorKeymapChange, mirrorDrumkitId, mirrorPadParams } from '../session/session-engine-state';
import { listDrumkits, fetchDrumkitManifest, loadDrumkit } from '../samples/drumkit-loader';
import { PAD_DEFAULTS, PAD_LEAF_SPECS, padKeyForNote, noteForPadKey, type PadParams } from './sampler-pad-params';
import type { FxBus } from '../core/fx';
import { computeVoiceMutes } from '../core/mute-solo';
import { renderDrumVoiceRack } from './drum-voice-rack';

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

const OUTPUT_TRIM = 0.7; // headroom so a full-scale sample + resonance stays < 0 dBFS

interface SamplerVoiceApi {
  getPad: (note: number) => PadParams;
  getGlobal: (id: string) => number;
  /** Shared FX bus — used by the per-pad reverb/delay sends (next task). */
  fx: FxBus | null;
  onTrigger: (note: number, voice: SamplerVoice, time: number) => void;
  onDispose: (note: number, voice: SamplerVoice) => void;
  isPadAudible: (note: number) => boolean;
}

class SamplerVoice implements Voice {
  private src: AudioBufferSourceNode | null = null;
  private readonly filter: BiquadFilterNode;
  private readonly ampGain: GainNode;
  private readonly panner: StereoPannerNode;
  private readonly revSend: GainNode;
  private readonly dlySend: GainNode;
  private started = false;
  private endTime = Infinity;
  private note = -1;

  constructor(
    private ctx: AudioContext,
    output: AudioNode,
    private keymap: KeymapEntry[],
    private api: SamplerVoiceApi,
  ) {
    this.filter = ctx.createBiquadFilter();
    this.filter.type = 'lowpass';
    this.ampGain = ctx.createGain();
    this.ampGain.gain.value = 0;
    this.panner = ctx.createStereoPanner();
    this.revSend = ctx.createGain(); this.revSend.gain.value = 0;
    this.dlySend = ctx.createGain(); this.dlySend.gain.value = 0;
    this.filter.connect(this.ampGain).connect(this.panner).connect(output);
    if (this.api.fx) {
      this.panner.connect(this.revSend).connect(this.api.fx.reverbInput);
      this.panner.connect(this.dlySend).connect(this.api.fx.delayInput);
    }
  }

  trigger(midi: number, time: number, opts: VoiceTriggerOptions): void {
    if (opts.slice) { this.triggerSlice(midi, time, opts); return; }
    if (opts.sample) { this.triggerSample(time, opts); return; }
    const entry = keymapEntryFor(this.keymap, midi);
    if (!entry) return;
    const buf = sampleCache.get(entry.sampleId);
    if (!buf) return;
    const pad = this.api.getPad(entry.rootNote);

    // Defensive: if this voice is re-triggered, stop + disconnect the previous
    // source before replacing it so the old node doesn't leak. The poly host
    // normally creates a fresh voice per note, so this is the non-default path.
    if (this.src && this.started) {
      try { this.src.stop(); } catch { /* already stopped */ }
      this.src.disconnect();
    }

    this.note = entry.rootNote;
    this.api.onTrigger(entry.rootNote, this, time);

    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    // repitch by key distance + per-pad TUNE semitones.
    src.playbackRate.value = repitchRate(midi, entry.rootNote, pad.tune);
    if (pad.loop > 0.5) {
      src.loop = true;
      src.loopStart = Math.min(pad.loopStart, 0.999) * buf.duration;
      src.loopEnd = buf.duration;
    }
    src.connect(this.filter);
    this.src = src;

    // Per-pad lowpass.
    this.filter.frequency.setValueAtTime(60 * Math.pow(300, pad.cutoff), time);
    this.filter.Q.setValueAtTime(0.5 + pad.res * 20, time);

    // Per-pad amp envelope.
    const audible = this.api.isPadAudible(entry.rootNote) ? 1 : 0;
    const peak = this.api.getGlobal('gain') * (entry.gain ?? 1) * (opts.accent ? 1.0 : 0.8) * OUTPUT_TRIM * pad.level * audible;
    const atk = Math.max(0.001, pad.attack);
    const rel = Math.max(0.005, pad.decay);
    const g = this.ampGain.gain;
    g.cancelScheduledValues(time);
    g.setValueAtTime(0, time);
    g.linearRampToValueAtTime(peak, time + atk);
    const releaseAt = Math.max(time + atk, time + opts.gateDuration);
    g.setValueAtTime(peak, releaseAt);
    g.linearRampToValueAtTime(0, releaseAt + rel);

    this.panner.pan.setValueAtTime(pad.pan, time);
    this.revSend.gain.setValueAtTime(pad.rev, time);
    this.dlySend.gain.setValueAtTime(pad.dly, time);

    this.endTime = releaseAt + rel + 0.01;
    src.start(time, 0);
    src.stop(this.endTime);
    this.started = true;
  }

  /** Loop/song path: play the clip's buffer flat (no ADSR), repitched so a
   *  loop fills the clip exactly; song plays at natural rate. ~5 ms anti-click
   *  fades at the edges. Re-fired once per clip iteration by the scheduler. */
  private triggerSample(time: number, opts: VoiceTriggerOptions): void {
    const cs = opts.sample!;
    const buf = sampleCache.get(cs.sampleId);
    if (!buf) return;

    if (this.src && this.started) {
      try { this.src.stop(); } catch { /* already stopped */ }
      this.src.disconnect();
    }

    const trimStart = Math.max(0, cs.trimStart);
    const trimEnd = cs.trimEnd > trimStart ? Math.min(cs.trimEnd, buf.duration) : buf.duration;
    const region = Math.max(0.001, trimEnd - trimStart);
    const gate = Math.max(0.001, opts.gateDuration);

    const src = this.ctx.createBufferSource();
    const wantStretch = cs.mode === 'loop' && cs.warp && cs.warpMode === 'stretch';
    const ratio = gate / region;
    const stretched = wantStretch ? stretchCache.get(cs.sampleId, ratio) : undefined;
    if (stretched) {
      src.buffer = stretched;
      src.playbackRate.value = 1; // pitch preserved; buffer already fills the gate
    } else {
      src.buffer = buf;
      // loop → varispeed fill (also the stretch-miss fallback); song → natural.
      src.playbackRate.value = cs.mode === 'loop' ? region / gate : 1;
    }
    src.connect(this.filter);
    this.src = src;

    // Audio clips: use neutral defaults (filter wide open, flat gain).
    this.filter.frequency.setValueAtTime(60 * Math.pow(300, PAD_DEFAULTS.cutoff), time);
    this.filter.Q.setValueAtTime(0.5 + PAD_DEFAULTS.res * 20, time);

    // Flat gain with short anti-click fades — no amp envelope for audio clips.
    const peak = this.api.getGlobal('gain') * (cs.gain ?? 1) * OUTPUT_TRIM;
    const fade = Math.min(0.005, gate / 4);
    const g = this.ampGain.gain;
    g.cancelScheduledValues(time);
    g.setValueAtTime(0, time);
    g.linearRampToValueAtTime(peak, time + fade);
    g.setValueAtTime(peak, Math.max(time + fade, time + gate - fade));
    g.linearRampToValueAtTime(0, time + gate);

    this.endTime = time + gate + 0.01;
    src.start(time, stretched ? 0 : trimStart);
    src.stop(this.endTime);
    this.started = true;
  }

  /** Slice path: play a sub-region of a buffer at natural pitch, applying the
   *  per-pad params keyed by the trigger note (same envelope/filter/pan/sends
   *  as the keymap path). Set by the scheduler for warpMode==='slice' loops. */
  private triggerSlice(midi: number, time: number, opts: VoiceTriggerOptions): void {
    const sl = opts.slice!;
    const buf = sampleCache.get(sl.sampleId);
    if (!buf) return;
    const pad = this.api.getPad(midi);

    if (this.src && this.started) {
      try { this.src.stop(); } catch { /* already stopped */ }
      this.src.disconnect();
    }
    this.note = midi;
    this.api.onTrigger(midi, this, time);

    const start = Math.max(0, Math.min(sl.start, buf.duration));
    const end = sl.end > start ? Math.min(sl.end, buf.duration) : buf.duration;
    const region = Math.max(0.001, end - start);

    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = Math.pow(2, pad.tune / 12); // natural pitch + TUNE only
    src.connect(this.filter);
    this.src = src;

    this.filter.frequency.setValueAtTime(60 * Math.pow(300, pad.cutoff), time);
    this.filter.Q.setValueAtTime(0.5 + pad.res * 20, time);

    const audible = this.api.isPadAudible(midi) ? 1 : 0;
    const peak = this.api.getGlobal('gain') * (opts.accent ? 1.0 : 0.8) * OUTPUT_TRIM * pad.level * audible;
    const atk = Math.max(0.001, pad.attack);
    const rel = Math.max(0.005, pad.decay);
    const g = this.ampGain.gain;
    g.cancelScheduledValues(time);
    g.setValueAtTime(0, time);
    g.linearRampToValueAtTime(peak, time + atk);
    // gate to the slice's own region length OR the note gate (whichever is shorter)
    const playDur = Math.min(region / src.playbackRate.value, Math.max(opts.gateDuration, atk));
    const releaseAt = Math.max(time + atk, time + playDur);
    g.setValueAtTime(peak, releaseAt);
    g.linearRampToValueAtTime(0, releaseAt + rel);

    this.panner.pan.setValueAtTime(pad.pan, time);
    this.revSend.gain.setValueAtTime(pad.rev, time);
    this.dlySend.gain.setValueAtTime(pad.dly, time);

    this.endTime = releaseAt + rel + 0.01;
    src.start(time, start, region + 0.01);
    src.stop(this.endTime);
    this.started = true;
  }

  release(time: number): void {
    const g = this.ampGain.gain;
    g.cancelScheduledValues(time);
    g.setValueAtTime(g.value, time);
    g.linearRampToValueAtTime(0, time + 0.005); // gate cut, not a musical release
    if (this.src && this.started && time + 0.02 < this.endTime) {
      try { this.src.stop(time + 0.02); } catch { /* already stopped */ }
    }
  }

  connect(_dest: AudioNode): void { /* already connected to output */ }

  getAudioParams(): Map<string, AudioParam> {
    // Only the master amp gain is exposed today. Per-pad modulation
    // destinations (cutoff/level/pan per voice) are wired in Plan A2, which
    // binds modulators at trigger time when the pad/note is known.
    return new Map<string, AudioParam>([['gain', this.ampGain.gain]]);
  }

  dispose(): void {
    if (this.note >= 0) this.api.onDispose(this.note, this);
    if (this.src) { try { this.src.stop(); } catch { /* */ } this.src.disconnect(); }
    this.filter.disconnect();
    this.ampGain.disconnect();
    this.panner.disconnect();
    this.revSend.disconnect();
    this.dlySend.disconnect();
  }
}

export class SamplerEngine implements SynthEngine {
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
  private modHost = new ModulationHostImpl([]);
  private activeByNote = new Map<number, SamplerVoice>();

  // Mono retrig: if a new voice triggers a note whose pad is mono, release the
  // previous voice for that note, then register the new one.
  private retrigRegister(note: number, voice: SamplerVoice, time: number): void {
    if (this.getPad(note).retrig > 0.5) {
      const prev = this.activeByNote.get(note);
      if (prev && prev !== voice) prev.release(time);
    }
    this.activeByNote.set(note, voice);
  }
  private retrigUnregister(note: number, voice: SamplerVoice): void {
    if (this.activeByNote.get(note) === voice) this.activeByNote.delete(note);
  }

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
      // advanced synth (res/attack/loop/loopStart/retrig) + pan auto-fall into advanced.
      advancedMixer: ['pan'],
    };
  }

  /** A lane is a drumkit when every keymap entry sits on a GM drum note. */
  private isDrumkit(): boolean {
    return this.keymap.length > 0 && this.keymap.every((e) => padKeyForNote(e.rootNote) !== `zone${e.rootNote}`);
  }

  /** True if the pad at `note` should sound now (per mute/solo over the kit's
   *  voice keys). Read by the voice at trigger time. */
  isPadAudible(note: number): boolean {
    const keys = this.keymap.map((e) => padKeyForNote(e.rootNote));
    const muted = computeVoiceMutes(keys, this.voiceMute, this.voiceSolo);
    return !muted[padKeyForNote(note)];
  }

  setSharedFx(fx: FxBus): void { this.fx = fx; }

  /** Resolved pad params for a note (defaults merged with stored overrides). */
  getPad(note: number): PadParams {
    const canonical = noteForPadKey(padKeyForNote(note));
    return { ...PAD_DEFAULTS, ...(this.padStore[canonical] ?? {}) };
  }

  /** Full per-pad override store — for persistence. */
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

  /** Replace the lane's one-shot keymap. Phase-3 UI calls this; tests call it
   *  directly. */
  setKeymap(entries: KeymapEntry[]): void {
    this.keymap = entries;
  }
  getKeymap(): KeymapEntry[] {
    return this.keymap;
  }

  applyPreset(name: string): void {
    const p = this.presets.find((x) => x.name === name);
    if (!p) return;
    for (const [k, v] of Object.entries(p.params)) this.paramValues[k] = v;
  }

  createVoice(ctx: AudioContext, output: AudioNode): Voice {
    return new SamplerVoice(ctx, output, this.keymap, {
      getPad: (note) => this.getPad(note),
      getGlobal: (id) => this.getBaseValue(id),
      fx: this.fx,
      onTrigger: (note, voice, time) => this.retrigRegister(note, voice, time),
      onDispose: (note, voice) => this.retrigUnregister(note, voice),
      isPadAudible: (note) => this.isPadAudible(note),
    });
  }

  buildSequencer(_c: HTMLElement, _n: number): EngineSequencer { return new SamplerSequencer(); }
  buildParamUI(container: HTMLElement, ctx?: EngineUIContext): void {
    container.innerHTML = '';
    if (!ctx) return;

    // Install the per-pad edit hook so any per-pad setBaseValue call mirrors
    // the pad store into the session state (if one is present).
    this.setPadEditHook(ctx.sessionState
      ? () => mirrorPadParams(ctx.sessionState!, ctx.laneId, this.getPadStore() as Record<number, Record<string, number>>)
      : null);

    // Drumkit: render the per-pad rack FIRST (reuses drum-voice-rack with
    // the sampler's own getRackLayout + getDrumVoice* contract).
    if (this.isDrumkit()) {
      const rackHost = document.createElement('div');
      container.appendChild(rackHost);
      const voices = this.keymap.map((e) => padKeyForNote(e.rootNote));
      renderDrumVoiceRack(this, ctx, rackHost, voices);
    }

    // Param knobs — globals only (gain + poly.voices). Per-pad/zone params are
    // rendered in the per-zone blocks below, not in the global row.
    const knobRow = document.createElement('div');
    knobRow.className = 'knob-row';
    container.appendChild(knobRow);
    wireEngineParams(this, ctx, knobRow, {
      // Globals only. NOT `!id.includes('.')` — `poly.voices` contains a dot
      // and would be wrongly dropped; match the global spec ids explicitly.
      filter: (id) => SAMPLER_PARAMS.some((p) => p.id === id),
      formatter: (id, v) => {
        if (id === 'poly.voices') return `${Math.round(v)}`;
        if (id.endsWith('.attack') || id.endsWith('.release')) {
          return v < 1 ? `${Math.round(v * 1000)}ms` : `${v.toFixed(2)}s`;
        }
        return `${Math.round(v * 100)}%`;
      },
    });

    // Keymap editor.
    const section = document.createElement('div');
    section.className = 'sampler-keymap';
    container.appendChild(section);

    const rebuild = () => { container.innerHTML = ''; this.buildParamUI(container, ctx); };

    const heading = document.createElement('div');
    heading.className = 'label';
    heading.textContent = 'Keymap';
    section.appendChild(heading);

    // Bundled drumkit picker: load a kit (single-note pads at the GM drum
    // notes) into this lane. Selecting a kit flips the lane to the drum-grid
    // editor (drumkitId is mirrored into the session); '— none —' detaches it.
    const kitRow = document.createElement('div');
    kitRow.className = 'sampler-drumkit-row';
    const kitLabel = document.createElement('label');
    kitLabel.textContent = 'Drumkit ';
    const kitSel = document.createElement('select');
    kitSel.className = 'sampler-drumkit-select';
    const noneOpt = document.createElement('option');
    noneOpt.value = '';
    noneOpt.textContent = '— none (melodic) —';
    kitSel.appendChild(noneOpt);
    kitLabel.appendChild(kitSel);
    kitRow.appendChild(kitLabel);
    const kitStatus = document.createElement('span');
    kitStatus.className = 'sampler-drumkit-status';
    kitRow.appendChild(kitStatus);
    section.appendChild(kitRow);

    const currentKit =
      ctx.sessionState?.lanes.find((l) => l.id === ctx.laneId)?.engineState?.sampler?.drumkitId ?? '';
    void listDrumkits().then((kits) => {
      for (const k of kits) {
        const opt = document.createElement('option');
        opt.value = k.id;
        opt.textContent = k.name;
        kitSel.appendChild(opt);
      }
      kitSel.value = currentKit;
    });

    const fireEditorReroute = () =>
      document.dispatchEvent(new CustomEvent('loom:lane-engine-ui-changed', { detail: { laneId: ctx.laneId } }));

    kitSel.addEventListener('change', () => {
      const id = kitSel.value;
      if (!id) {
        if (ctx.sessionState) mirrorDrumkitId(ctx.sessionState, ctx.laneId, undefined);
        fireEditorReroute();
        return;
      }
      const audioCtx = ctx.audioContext;
      if (!audioCtx) {
        kitStatus.textContent = ' audio not ready — press play once, then pick';
        kitSel.value = currentKit;
        return;
      }
      void (async () => {
        kitSel.disabled = true;
        kitStatus.textContent = ' loading…';
        try {
          const manifest = await fetchDrumkitManifest(id);
          const km = await loadDrumkit(manifest, audioCtx);
          this.setKeymap(km);
          if (ctx.sessionState) {
            mirrorKeymapChange(ctx.sessionState, ctx.laneId, km);
            mirrorDrumkitId(ctx.sessionState, ctx.laneId, id);
          }
          fireEditorReroute();
          rebuild();
        } catch (err) {
          kitStatus.textContent = ` failed: ${(err as Error).message}`;
          kitSel.disabled = false;
        }
      })();
    });

    const fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.accept = 'audio/*';
    fileInput.className = 'sampler-load';
    section.appendChild(fileInput);

    const drop = document.createElement('div');
    drop.className = 'sampler-dropzone';
    drop.textContent = 'Drop an audio file, or use the picker above';
    section.appendChild(drop);

    const loadFile = async (file: File) => {
      const audioCtx = ctx.audioContext;
      if (!audioCtx) return;
      try {
        const asset = await importFile(file, audioCtx);
        await sampleStore.put(asset);
        const buf = await audioCtx.decodeAudioData(asset.bytes.slice(0));
        sampleCache.put(asset.id, buf);
        const km = addSampleToKeymap(this.getKeymap(), asset.id);
        this.setKeymap(km);
        if (ctx.sessionState) mirrorKeymapChange(ctx.sessionState, ctx.laneId, km);
        rebuild();
      } catch (err) {
        drop.textContent = `Could not load: ${(err as Error).message}`;
      }
    };

    fileInput.addEventListener('change', () => {
      const f = fileInput.files?.[0];
      if (f) void loadFile(f);
    });
    drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('over'); });
    drop.addEventListener('dragleave', () => drop.classList.remove('over'));
    drop.addEventListener('drop', (e) => {
      e.preventDefault();
      drop.classList.remove('over');
      const f = e.dataTransfer?.files?.[0];
      if (f) void loadFile(f);
    });

    const list = document.createElement('div');
    list.className = 'sampler-keymap-list';
    section.appendChild(list);
    const keymap = this.getKeymap();
    keymap.forEach((entry, i) => {
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

      // Per-zone params (melodic only — drumkits use the rack above).
      if (!this.isDrumkit()) {
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
  dispose(): void { this.keymap = []; }
}

export const samplerEngine = new SamplerEngine();
registerEngine(samplerEngine);
registerEngineFactory('sampler', () => new SamplerEngine());
