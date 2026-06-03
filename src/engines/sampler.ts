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
import { mirrorKeymapChange, mirrorDrumkitId } from '../session/session-engine-state';
import { listDrumkits, fetchDrumkitManifest, loadDrumkit } from '../samples/drumkit-loader';

const SAMPLER_PARAMS: EngineParamSpec[] = [
  { id: 'gain',             label: 'Gain',    kind: 'continuous', min: 0,     max: 1.5, default: 1 },
  { id: 'amp.attack',       label: 'Attack',  kind: 'continuous', min: 0.001, max: 2,   default: 0.005, unit: 's', curve: 'exponential' },
  { id: 'amp.release',      label: 'Release', kind: 'continuous', min: 0.005, max: 4,   default: 0.08,  unit: 's', curve: 'exponential' },
  { id: 'pitch',            label: 'Pitch',   kind: 'continuous', min: -24,   max: 24,  default: 0,     unit: 'st' },
  { id: 'filter.cutoff',    label: 'Cutoff',  kind: 'continuous', min: 0,     max: 1,   default: 1 },
  { id: 'filter.resonance', label: 'Res',     kind: 'continuous', min: 0,     max: 1,   default: 0 },
  { id: 'poly.voices',      label: 'Voices',  kind: 'continuous', min: 1,     max: 16,  default: 8 },
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

class SamplerVoice implements Voice {
  private src: AudioBufferSourceNode | null = null;
  private readonly filter: BiquadFilterNode;
  private readonly ampGain: GainNode;
  private started = false;
  private endTime = Infinity;

  constructor(
    private ctx: AudioContext,
    output: AudioNode,
    private keymap: KeymapEntry[],
    private getParam: (id: string) => number,
  ) {
    this.filter = ctx.createBiquadFilter();
    this.filter.type = 'lowpass';
    this.ampGain = ctx.createGain();
    this.ampGain.gain.value = 0;
    this.filter.connect(this.ampGain).connect(output);
  }

  trigger(midi: number, time: number, opts: VoiceTriggerOptions): void {
    if (opts.sample) { this.triggerSample(time, opts); return; }
    const entry = keymapEntryFor(this.keymap, midi);
    if (!entry) return;
    const buf = sampleCache.get(entry.sampleId);
    if (!buf) return;

    // Defensive: if this voice is re-triggered, stop + disconnect the previous
    // source before replacing it so the old node doesn't leak. The poly host
    // normally creates a fresh voice per note, so this is the non-default path.
    if (this.src && this.started) {
      try { this.src.stop(); } catch { /* already stopped */ }
      this.src.disconnect();
    }

    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = repitchRate(midi, entry.rootNote, this.getParam('pitch'));
    src.connect(this.filter);
    this.src = src;

    // Static lowpass: cutoff knob 0..1 → 60..18000 Hz (exp), open by default.
    const cutoff = this.getParam('filter.cutoff');
    const res = this.getParam('filter.resonance');
    this.filter.frequency.setValueAtTime(60 * Math.pow(300, cutoff), time);
    this.filter.Q.setValueAtTime(0.5 + res * 20, time);

    // Amp envelope: attack → hold at peak until gate end → release to 0.
    const peakLevel =
      this.getParam('gain') * (entry.gain ?? 1) * (opts.accent ? 1.0 : 0.8) * OUTPUT_TRIM;
    const atk = Math.max(0.001, this.getParam('amp.attack'));
    const rel = Math.max(0.005, this.getParam('amp.release'));
    const g = this.ampGain.gain;
    g.cancelScheduledValues(time);
    g.setValueAtTime(0, time);
    g.linearRampToValueAtTime(peakLevel, time + atk);
    const releaseAt = Math.max(time + atk, time + opts.gateDuration);
    g.setValueAtTime(peakLevel, releaseAt);
    g.linearRampToValueAtTime(0, releaseAt + rel);

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
    src.buffer = buf;
    // loop → fill the clip exactly (repitch); song → natural pitch.
    src.playbackRate.value = cs.mode === 'loop' ? region / gate : 1;
    src.connect(this.filter);
    this.src = src;

    const cutoff = this.getParam('filter.cutoff');
    const res = this.getParam('filter.resonance');
    this.filter.frequency.setValueAtTime(60 * Math.pow(300, cutoff), time);
    this.filter.Q.setValueAtTime(0.5 + res * 20, time);

    // Flat gain with short anti-click fades — no amp envelope for audio clips.
    const peak = this.getParam('gain') * (cs.gain ?? 1) * OUTPUT_TRIM;
    const fade = Math.min(0.005, gate / 4);
    const g = this.ampGain.gain;
    g.cancelScheduledValues(time);
    g.setValueAtTime(0, time);
    g.linearRampToValueAtTime(peak, time + fade);
    g.setValueAtTime(peak, Math.max(time + fade, time + gate - fade));
    g.linearRampToValueAtTime(0, time + gate);

    this.endTime = time + gate + 0.01;
    src.start(time, trimStart);
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
    return new Map<string, AudioParam>([
      ['gain',             this.ampGain.gain],
      ['filter.cutoff',    this.filter.frequency],
      ['filter.resonance', this.filter.Q],
    ]);
  }

  dispose(): void {
    if (this.src) { try { this.src.stop(); } catch { /* */ } this.src.disconnect(); }
    this.filter.disconnect();
    this.ampGain.disconnect();
  }
}

export class SamplerEngine implements SynthEngine {
  readonly id = 'sampler';
  readonly name = 'Sampler';
  readonly type = 'polyhost' as const;
  readonly polyphony = 'poly' as const;
  readonly editor = 'piano-roll' as const;
  readonly params = SAMPLER_PARAMS;
  readonly presets: import('./engine-types').EnginePreset[] = [];

  private paramValues: Record<string, number> = {};
  private keymap: KeymapEntry[] = [];
  private modHost = new ModulationHostImpl([]);

  get modulators(): ModulationHostImpl { return this.modHost; }

  constructor() {
    for (const p of SAMPLER_PARAMS) this.paramValues[p.id] = p.default;
  }

  getBaseValue(id: string): number {
    return this.paramValues[id] ?? SAMPLER_PARAMS.find((p) => p.id === id)?.default ?? 0;
  }
  setBaseValue(id: string, v: number): void {
    this.paramValues[id] = v;
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
    return new SamplerVoice(ctx, output, this.keymap, (id) => this.getBaseValue(id));
  }

  buildSequencer(_c: HTMLElement, _n: number): EngineSequencer { return new SamplerSequencer(); }
  buildParamUI(container: HTMLElement, ctx?: EngineUIContext): void {
    container.innerHTML = '';
    if (!ctx) return;

    // Param knobs (gain/attack/release/pitch/cutoff/res/voices).
    const knobRow = document.createElement('div');
    knobRow.className = 'knob-row';
    container.appendChild(knobRow);
    wireEngineParams(this, ctx, knobRow, {
      formatter: (id, v) => {
        if (id === 'pitch') return `${v.toFixed(0)} st`;
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
