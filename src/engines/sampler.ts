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
import { keymapEntryFor, repitchRate } from '../samples/keymap';
import { wireEngineParams } from './engine-ui';
import { sampleStore } from '../samples/store-singleton';
import { importFile } from '../samples/import';
import { addSampleToKeymap, removeKeymapEntry, setEntryRoot } from '../samples/keymap-edit';
import { mirrorKeymapChange, mirrorDrumkitId, mirrorInstrumentId, mirrorPadParams } from '../session/session-engine-state';
import { listDrumkits, fetchDrumkitManifest, loadDrumkit } from '../samples/drumkit-loader';
import { listInstruments, fetchInstrumentManifest, loadInstrument, type InstrumentIndexEntry } from '../samples/instrument-loader';
import { PAD_DEFAULTS, PAD_LEAF_SPECS, padKeyForNote, noteForPadKey, type PadParams } from './sampler-pad-params';
import type { FxBus } from '../core/fx';
import { computeVoiceMutes } from '../core/mute-solo';
import { renderDrumVoiceRack } from './drum-voice-rack';
import { velGain } from '../core/velocity-gain';
import { playAudioClip, OUTPUT_TRIM } from './audio-clip-voice';
import { withUndo } from '../save/history-wiring';

const SAMPLER_PARAMS: EngineParamSpec[] = [
  { id: 'gain',        label: 'Gain',   kind: 'continuous', min: 0, max: 1.5, default: 1 },
  { id: 'poly.voices', label: 'Voices', kind: 'continuous', min: 1, max: 16,  default: 8 },
];

const NOTE_NAMES: Record<string, number> = {
  c: 0, 'c#': 1, db: 1, d: 2, 'd#': 3, eb: 3, e: 4, f: 5,
  'f#': 6, gb: 6, g: 7, 'g#': 8, ab: 8, a: 9, 'a#': 10, bb: 10, b: 11,
};

/** Guess a sample's root MIDI note from its file name. Recognises a note name
 *  with octave (e.g. `C3`, `A#4`, `Db2`) or a bare MIDI number (`60`); falls
 *  back to C3 = 60 when nothing matches. Octave convention: C3 = 60 (yamaha). */
export function guessRootNoteFromName(fileName: string): number {
  const base = fileName.replace(/\.[a-z0-9]+$/i, '');
  // Note name + octave: C3, A#4, Db-1, gb 2 …
  const nm = base.match(/(?:^|[^a-z])([a-gA-G])([#b]?)\s*(-?\d{1,2})(?![\d])/);
  if (nm) {
    const semis = NOTE_NAMES[(nm[1] + nm[2]).toLowerCase()];
    if (semis !== undefined) {
      const midi = (Number(nm[3]) + 2) * 12 + semis; // C3 = 60 ⇒ octave+2
      if (midi >= 0 && midi <= 127) return midi;
    }
  }
  // Bare MIDI number: only when not glued to other digits.
  const mm = base.match(/(?:^|[^0-9])(\d{1,3})(?![0-9])/);
  if (mm) {
    const midi = Number(mm[1]);
    if (midi >= 0 && midi <= 127) return midi;
  }
  return 60;
}

class SamplerSequencer implements EngineSequencer {
  getStepAt(): unknown { return null; }
  setLength(): void {}
  highlight(): void {}
  serialize(): unknown { return null; }
  deserialize(): void {}
  dispose(): void {}
}

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
    const peak = this.api.getGlobal('gain') * (entry.gain ?? 1) * (0.8 * velGain(opts.velocity, !!opts.accent)) * OUTPUT_TRIM * pad.level * audible;
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

  /** Loop/song path: delegates to the shared audio-clip playback helper, then
   *  sets a neutral (wide-open) filter so audio clips aren't coloured. */
  private triggerSample(time: number, opts: VoiceTriggerOptions): void {
    if (this.src && this.started) {
      try { this.src.stop(); } catch { /* already stopped */ }
      this.src.disconnect();
    }
    // Neutral filter for audio clips (filter wide open, flat gain).
    this.filter.frequency.setValueAtTime(60 * Math.pow(300, PAD_DEFAULTS.cutoff), time);
    this.filter.Q.setValueAtTime(0.5 + PAD_DEFAULTS.res * 20, time);

    const r = playAudioClip({
      ctx: this.ctx,
      sample: opts.sample!,
      time,
      gateDuration: opts.gateDuration,
      dest: this.filter,
      ampGain: this.ampGain,
      masterGain: this.api.getGlobal('gain'),
    });
    if (!r) return;
    this.src = r.src;
    this.endTime = r.endTime;
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

  /** A lane is a drumkit when every keymap entry is a single-note pad
   *  (loNote===hiNote===rootNote). Structural + note-agnostic, so a variable-size
   *  kit (>8 pads off the GM map) still counts; a melodic instrument uses range
   *  zones (loNote<hiNote) and never matches. */
  private isDrumkit(): boolean {
    return this.keymap.length > 0 && this.keymap.every((e) => e.loNote === e.hiNote && e.hiNote === e.rootNote);
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

    // Re-render the whole param UI from scratch (used by the keymap pickers and
    // the ＋/－ Pad buttons). Declared up-front so those handlers can close over it.
    const rebuild = () => { container.innerHTML = ''; this.buildParamUI(container, ctx); };

    // Drumkit: a ＋/－ Pad toolbar (variable-size kit) THEN the per-pad rack
    // (reuses drum-voice-rack with the sampler's own getRackLayout +
    // getDrumVoice* contract). The drum-grid clip editor derives its row count
    // from this same keymap, so the kit can hold any number of sounds.
    if (this.isDrumkit()) {
      const padBar = document.createElement('div');
      padBar.className = 'sampler-padbar';
      const count = document.createElement('span');
      count.className = 'sampler-padcount';
      count.textContent = `${this.keymap.length} pads`;
      const addBtn = document.createElement('button');
      addBtn.type = 'button'; addBtn.textContent = '＋ Pad';
      addBtn.title = 'Add a pad (clones the last pad onto the next free key)';
      const delBtn = document.createElement('button');
      delBtn.type = 'button'; delBtn.textContent = '－ Pad';
      delBtn.title = 'Remove the last pad';
      // ＋ clones the last pad's sample onto the next free note (immediately
      // audible/visible); － drops the last pad (never below 1).
      addBtn.addEventListener('click', () => {
        const proto = this.keymap[this.keymap.length - 1];
        if (!proto) return;
        const used = new Set(this.keymap.map((e) => e.rootNote));
        let note = Math.min(127, Math.max(...this.keymap.map((e) => e.rootNote)) + 1);
        while (used.has(note) && note < 127) note++;
        this.setKeymap([...this.keymap, { sampleId: proto.sampleId, rootNote: note, loNote: note, hiNote: note }]);
        if (ctx.sessionState) mirrorKeymapChange(ctx.sessionState, ctx.laneId, this.keymap);
        rebuild();
      });
      delBtn.addEventListener('click', () => {
        if (this.keymap.length <= 1) return;
        this.setKeymap(this.keymap.slice(0, -1));
        if (ctx.sessionState) mirrorKeymapChange(ctx.sessionState, ctx.laneId, this.keymap);
        rebuild();
      });
      padBar.append(count, addBtn, delBtn);
      container.appendChild(padBar);

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

    const heading = document.createElement('div');
    heading.className = 'label';
    heading.textContent = 'Keymap';
    section.appendChild(heading);

    // Family picker: one grouped selector over the three Sampler instrument
    // families. Each family loads a *bundled* preset (self-healing by id) and
    // mirrors the matching id into engineState, keeping `drumkitId` and
    // `instrumentId` MUTUALLY EXCLUSIVE (choosing one clears the other, D9):
    //   • Melódico (instrument-loader `family:'melodic'`) → multi-zone chromatic
    //     keymap; view = the per-zone keymap list below (piano-roll clip editor).
    //   • Percusión (drumkit-loader) → 8 GM pads; view = the drum-voice rack
    //     above + the drum-grid clip editor (drumkitId routes it).
    //   • Loop (instrument-loader `family:'loop'`) → a slice bank (one note per
    //     slice from SLICE_BASE_NOTE); view = the bank list + a hint that the
    //     notes are edited in the clip's piano-roll. The clip/scene that play a
    //     loop are materialised by SessionHost (Task 13), not here.
    // The options are namespaced `melodic:<id>` / `drumkit:<id>` / `loop:<id>`
    // so a single change handler can dispatch on family.
    const famRow = document.createElement('div');
    famRow.className = 'sampler-family-row';
    const famLabel = document.createElement('label');
    famLabel.textContent = 'Instrument ';
    const famSel = document.createElement('select');
    famSel.className = 'sampler-family-select';
    const noneOpt = document.createElement('option');
    noneOpt.value = '';
    noneOpt.textContent = '— none (own keymap) —';
    famSel.appendChild(noneOpt);
    const melGroup = document.createElement('optgroup');
    melGroup.label = 'Melodic';
    melGroup.className = 'sampler-family-melodic';
    const kitGroup = document.createElement('optgroup');
    kitGroup.label = 'Percussion';
    kitGroup.className = 'sampler-family-drumkit';
    const loopGroup = document.createElement('optgroup');
    loopGroup.label = 'Loop';
    loopGroup.className = 'sampler-family-loop';
    famSel.appendChild(melGroup);
    famSel.appendChild(kitGroup);
    famSel.appendChild(loopGroup);
    famLabel.appendChild(famSel);
    famRow.appendChild(famLabel);
    const famStatus = document.createElement('span');
    famStatus.className = 'sampler-family-status';
    famRow.appendChild(famStatus);
    section.appendChild(famRow);

    const laneSampler =
      ctx.sessionState?.lanes.find((l) => l.id === ctx.laneId)?.engineState?.sampler;
    const currentKit = laneSampler?.drumkitId ?? '';
    const currentInstrument = laneSampler?.instrumentId ?? '';

    // Populate the three families (each list is independent + fire-and-forget;
    // an empty list — e.g. no public/instruments/index.json — just leaves that
    // optgroup empty). Resolve the persisted selection once both fetches land.
    let instruments: InstrumentIndexEntry[] = [];
    let kitsLoaded = false;
    let instrumentsLoaded = false;
    const resolveSelection = () => {
      if (!kitsLoaded || !instrumentsLoaded) return;
      if (currentKit) { famSel.value = `drumkit:${currentKit}`; return; }
      if (currentInstrument) {
        const fam = instruments.find((i) => i.id === currentInstrument)?.family ?? 'melodic';
        famSel.value = `${fam}:${currentInstrument}`;
      }
    };
    void listDrumkits().then((kits) => {
      for (const k of kits) {
        const opt = document.createElement('option');
        opt.value = `drumkit:${k.id}`;
        opt.textContent = k.name;
        kitGroup.appendChild(opt);
      }
      kitsLoaded = true;
      resolveSelection();
    });
    // Loop view hint: a loaded loop is a slice bank (each note is a slice). The
    // performance notes live in the clip's piano-roll, not here. The hint is
    // attached once we know the loaded instrument's family (the list is async).
    const loopHint = document.createElement('div');
    loopHint.className = 'sampler-loop-hint label';
    loopHint.textContent = 'Loop: each note is a slice. The notes are edited in the clip\'s piano-roll.';
    loopHint.style.display = 'none';
    section.appendChild(loopHint);

    void listInstruments().then((entries) => {
      instruments = entries;
      for (const inst of entries) {
        const opt = document.createElement('option');
        opt.value = `${inst.family}:${inst.id}`;
        opt.textContent = inst.name;
        (inst.family === 'loop' ? loopGroup : melGroup).appendChild(opt);
      }
      instrumentsLoaded = true;
      resolveSelection();
      // Show the loop hint only when the lane's bundled instrument is a loop.
      if (currentInstrument && entries.find((i) => i.id === currentInstrument)?.family === 'loop') {
        loopHint.style.display = '';
      }
    });

    const fireEditorReroute = () =>
      document.dispatchEvent(new CustomEvent('loom:lane-engine-ui-changed', { detail: { laneId: ctx.laneId } }));

    const restoreSelection = () => {
      if (currentKit) famSel.value = `drumkit:${currentKit}`;
      else if (currentInstrument) {
        const fam = instruments.find((i) => i.id === currentInstrument)?.family ?? 'melodic';
        famSel.value = `${fam}:${currentInstrument}`;
      } else famSel.value = '';
    };

    famSel.addEventListener('change', () => {
      const raw = famSel.value;
      // '— ninguno —': detach any bundled preset, keep the live keymap as a plain
      // user keymap. Clear BOTH ids (mutual exclusion); the lane reverts to the
      // melodic/piano-roll editor.
      if (!raw) {
        if (ctx.sessionState) {
          mirrorDrumkitId(ctx.sessionState, ctx.laneId, undefined);
          mirrorInstrumentId(ctx.sessionState, ctx.laneId, undefined);
        }
        fireEditorReroute();
        return;
      }
      const sep = raw.indexOf(':');
      const family = raw.slice(0, sep) as 'melodic' | 'drumkit' | 'loop';
      const id = raw.slice(sep + 1);
      const audioCtx = ctx.audioContext;
      if (!audioCtx) {
        famStatus.textContent = ' audio not ready — press play once, then pick';
        restoreSelection();
        return;
      }
      void (async () => {
        famSel.disabled = true;
        famStatus.textContent = ' loading…';
        try {
          if (family === 'drumkit') {
            // Percussion: IDENTICAL to the previous Drumkit picker. drumkitId
            // wins → mirror it, clear instrumentId, reroute to the drum grid.
            const manifest = await fetchDrumkitManifest(id);
            const km = await loadDrumkit(manifest, audioCtx);
            this.setKeymap(km);
            if (ctx.sessionState) {
              mirrorKeymapChange(ctx.sessionState, ctx.laneId, km);
              mirrorDrumkitId(ctx.sessionState, ctx.laneId, id);
              mirrorInstrumentId(ctx.sessionState, ctx.laneId, undefined);
            }
          } else {
            // Melodic / Loop: load the bundled instrument by id (self-healing).
            // instrumentId wins → mirror it, clear drumkitId. Melodic carries
            // optional per-zone padParams; loop returns a slice bank keymap.
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
          }
          fireEditorReroute();
          rebuild();
        } catch (err) {
          famStatus.textContent = ` failed: ${(err as Error).message}`;
          famSel.disabled = false;
        }
      })();
    });

    // Loop import (Task 13). One WAV → the host slices it, installs the slice
    // bank as this lane's keymap, and drops a note clip (one note per slice) +
    // scene into the lane via `installSamplerClip` (opens the piano-roll). The
    // engine has no host reference, so we hand the file off through a custom
    // event the SessionHost listens for. A user-imported loop is IndexedDB-only
    // (no bundled manifest → no `instrumentId` self-heal). The performance notes
    // are edited in the clip's piano-roll, NOT inside the Sampler inspector.
    const loopInput = document.createElement('input');
    loopInput.type = 'file';
    loopInput.accept = 'audio/*';
    loopInput.className = 'sampler-load-loop';
    loopInput.style.display = 'none';
    section.appendChild(loopInput);

    const loopBtn = document.createElement('button');
    loopBtn.className = 'sampler-import-loop-btn';
    loopBtn.textContent = 'Import loop…';
    loopBtn.title = 'Import a loop: slices it and creates a note clip with its piano-roll';
    loopBtn.addEventListener('click', () => loopInput.click());
    section.appendChild(loopBtn);

    loopInput.addEventListener('change', () => {
      const file = loopInput.files?.[0];
      if (file) {
        document.dispatchEvent(new CustomEvent('loom:import-loop', {
          detail: { laneId: ctx.laneId, file },
        }));
      }
      loopInput.value = '';
    });

    // Multi-sample import. Pick one or more audio files; each becomes a zone in
    // the keymap. `addSampleToKeymap` fixes loNote:0/hiNote:127 on every zone,
    // so with N samples only the LAST one sounds (keymapEntryFor is last-match-
    // wins). This is intentional full-range stacking — the user then dials each
    // zone's root/range in the rack below. This is NOT automatic multi-zone
    // splitting (that lives in bundled instrument presets, the Loop/Melodic
    // families). See keymap-edit.ts:addSampleToKeymap.
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
    section.appendChild(importBtn);

    const importHint = document.createElement('div');
    importHint.className = 'sampler-import-hint label';
    importHint.textContent = 'Each audio file is added as a zone. Adjust each zone\'s range below.';
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
