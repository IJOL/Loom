// src/midi/midi-import-ui.ts — per-track preset picker + audition + Add/Replace.
//
// Replaces the legacy wireMidiImport flow. Each track row gets:
//   - selection checkbox
//   - preset dropdown (GM-suggested matches first, then "any preset")
//   - ▶ audition button (plays a 3-note arpeggio without touching the session)
//
// On Load, calls midiToSession with the per-track mapping the user picked
// and presents an Add/Replace/Cancel confirm. Add appends lanes + scene to
// the current session; Replace seeds a fresh session with just the imported
// content. Every track — drum-channel included — is treated identically.

import { html, type TemplateResult } from 'lit-html';
import { repeat } from 'lit-html/directives/repeat.js';
import { renderInto } from '../core/lit-fill';
import { parseMidiFile, type ParsedMidi, type ParsedTrack } from './midi-parse';
import { alertDialog, choiceDialog } from '../core/dialog';
import { midiToSession } from './midi-to-session';
import { findGMMatches, suggestDefaultMapping, isDrumkitTrack, type GMMatch } from './gm-lookup';
import { gmInstrumentName } from './gm-instruments';
import { auditionPreset } from './audition';
import { isPresetsReady, getCachedPresets } from '../presets/preset-loader';
import { listEngines } from '../engines/registry';
import type { SessionState } from '../session/session';

export interface MidiImportUiDeps {
  session: SessionState;
  /** Apply a new tempo. The caller updates whatever holds the global BPM
   *  (Sequencer.bpm, UI input, downstream engines). */
  setBpm: (bpm: number) => void;
  /** Set (or clear) the active song tempo map so the transport shows the live
   *  current BPM during tempo-varying playback. Called on every import. */
  setTempoMap?: (map: import('../core/tempo-map').TempoMap | undefined, songTicks: number) => void;
  audioContext: AudioContext;
  /** Node the audition voice connects into — typically the master gain. */
  auditionOutput: AudioNode;
  /** Called after the session is mutated so the UI re-renders + the new
   *  lanes/scenes appear in the session view. */
  onSessionChanged: () => void;
  /** Switch to the freshly-created scene by id (host resolves index). */
  launchScene: (sceneId: string) => void;
  flashButton: (b: HTMLButtonElement, msg: string) => void;
  /** Resolves when engine presets finish loading. Used to re-enable the Import
   *  button if a file was picked before presets were ready (boot race) — the
   *  button is gated on isPresetsReady() and would otherwise stay stuck. */
  presetsReady?: Promise<unknown>;
  /** Called after a successful import so the caller can e.g. copy to the
   *  arrangement and switch to Performance view. */
  onImported?: () => void;
  /** Fully reset the previous session before a Replace import seeds the fresh
   *  lanes/scene — disposes old lane resources (engines + their modulators/LFOs),
   *  closes open synth/clip editors, stops the transport, and wipes the
   *  arrangement. Mirrors the "New session" button. Without it, Replace left the
   *  old engines + modular LFOs alive and the old editor open. */
  resetSession?: () => void;
  /** Allocate audio resources (strip + engine, applying each lane's preset) for
   *  the freshly-seeded lanes. MUST run BEFORE onSessionChanged: renderWithMixer
   *  asks the allocator for every lane's strip and throws on a missing one, so a
   *  lane added to the session without a resource crashes the render. (The old
   *  resources used to mask this; Replace's full reset disposes them.) */
  prepareLanes?: () => void;
}

/** Build the imported lanes/scene from a chosen action and seed them into the
 *  session. Extracted from the Load button handler so the Add/Replace branching
 *  (and the Replace full-reset) is unit-testable without the DOM. */
export function applyMidiImport(
  action: 'add' | 'replace',
  parsed: ParsedMidi,
  indices: number[],
  presetPerTrack: Record<number, GMMatch>,
  deps: MidiImportUiDeps,
): { laneCount: number } {
  const doAdd = action === 'add';
  // Add places the import on a NEW row (= current scene count) so its clips align
  // with their scene's launch button; Replace builds a fresh session at row 0.
  const sceneRow = doAdd ? deps.session.scenes.length : 0;
  const result = midiToSession(parsed, {
    selectedTrackIndices: indices,
    presetPerTrack,
    sceneRow,
  });

  if (doAdd) {
    deps.session.lanes.push(...result.newLanes);
    deps.session.scenes.push(result.scene);
  } else {
    // Replace: FULLY reset the previous session first (dispose old lane resources
    // + their modulators/LFOs, close open editors, stop transport, wipe the
    // arrangement) — exactly what "New session" does — THEN seed the fresh lanes
    // + scene. Without the reset the old engines + modular LFOs lingered in the
    // LaneResourceMap and the old synth/clip editor stayed open.
    deps.resetSession?.();
    deps.session.lanes = [...result.newLanes];
    deps.session.scenes = [result.scene];
  }

  // Allocate resources for the new lanes BEFORE rendering — renderWithMixer (in
  // onSessionChanged) asks the allocator for each lane's strip and throws on a
  // missing one. launchScene also allocates, but it runs after the render.
  deps.prepareLanes?.();

  if (result.bpm) deps.setBpm(result.bpm);
  // Activate (or clear) the live tempo-map readout for this import.
  deps.setTempoMap?.(result.tempoMap, result.songTicks ?? 0);

  deps.onSessionChanged();
  deps.launchScene(result.scene.id);
  deps.onImported?.();
  return { laneCount: result.newLanes.length };
}

export function wireMidiImportUI(deps: MidiImportUiDeps): void {
  const fileInput   = document.getElementById('poly-midi-file')      as HTMLInputElement   | null;
  const trackListEl = document.getElementById('poly-midi-tracklist') as HTMLDivElement     | null;
  const loadBtn     = document.getElementById('poly-midi-load')      as HTMLButtonElement  | null;
  if (!fileInput || !trackListEl || !loadBtn) {
    console.warn('[midi-import-ui] DOM ids missing, skipping wire');
    return;
  }

  let parsed: ParsedMidi | null = null;
  let presetPerTrack: Record<number, GMMatch> = {};
  // Bumped per parsed file so repeat() keys never match across parses: every
  // file gets FRESH rows — checkboxes reset to checked, selects back to the
  // suggested match — exactly like the old wipe-and-rebuild did.
  let parseGen = 0;

  function buildAllPresetsList(): GMMatch[] {
    const out: GMMatch[] = [];
    for (const eng of listEngines()) {
      for (const p of getCachedPresets(eng.id)) out.push({ engineId: eng.id, presetName: p.name });
    }
    return out;
  }

  function presetSelectTemplate(
    programHint: number,
    current: GMMatch,
    onChange: (m: GMMatch) => void,
  ): TemplateResult {
    // GM-suggested matches first, then a disabled divider, then every preset —
    // deduped across the two sections, like the old imperative builder.
    const seen = new Set<string>();
    const dedup = (list: GMMatch[]): { key: string; label: string }[] => {
      const out: { key: string; label: string }[] = [];
      for (const m of list) {
        const key = `${m.engineId}/${m.presetName}`;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push({ key, label: `${m.engineId} / ${m.presetName}` });
      }
      return out;
    };
    const matches = dedup(findGMMatches(programHint));
    const rest = dedup(buildAllPresetsList());
    const currentKey = `${current.engineId}/${current.presetName}`;
    const opt = (o: { key: string; label: string }) =>
      html`<option value=${o.key} ?selected=${o.key === currentKey}>${o.label}</option>`;
    return html`<select class="midi-preset-picker" @change=${(e: Event) => {
      const [engineId, ...restParts] = (e.target as HTMLSelectElement).value.split('/');
      onChange({ engineId, presetName: restParts.join('/') });
    }}>${matches.map(opt)}<option disabled>── any preset ──</option>${rest.map(opt)}</select>`;
  }

  function trackRowTemplate(tr: ParsedTrack): TemplateResult {
    const lo = Math.min(...tr.notes.map((n) => n.midi));
    const hi = Math.max(...tr.notes.map((n) => n.midi));
    // Title preference mirrors midiToSession: track name, else GM instrument
    // (so a demultiplexed format-0 channel reads as its instrument, not "untitled").
    const isDrum = isDrumkitTrack(tr);
    const instrument = tr.name || (isDrum ? 'Percussion' : (tr.program >= 0 ? gmInstrumentName(tr.program) : '') || 'untitled');
    const current = presetPerTrack[tr.index] ?? { engineId: 'subtractive', presetName: 'Init' };
    return html`<div class="midi-track-row"><input type="checkbox" data-idx=${String(tr.index)} checked /><span> [${tr.index}] ${instrument} — ${tr.notes.length} notes, ${lo}-${hi}, prog ${tr.program}</span>${presetSelectTemplate(
      tr.program < 0 ? 0 : tr.program,
      current,
      (m) => { presetPerTrack[tr.index] = m; },
    )}<button type="button" class="midi-audition" title="Audition this preset" @click=${() =>
      auditionPreset(presetPerTrack[tr.index] ?? current, deps.audioContext, deps.auditionOutput)
    }>▶</button></div>`;
  }

  // Arrow, not a hoisted `function`: the null-guard's narrowing of trackListEl
  // only flows into closures created after it runs.
  const paintTrackList = (): void => {
    const tracks = parsed ? parsed.tracks.filter((t) => t.notes.length > 0) : [];
    renderInto(trackListEl, html`${repeat(tracks, (tr) => `${parseGen}:${tr.index}`, trackRowTemplate)}`);
  };

  fileInput.addEventListener('change', async () => {
    const f = fileInput.files?.[0];
    if (!f) return;
    const buf = new Uint8Array(await f.arrayBuffer());
    try {
      parsed = parseMidiFile(buf);
    } catch (err) {
      void alertDialog('Not a valid SMF: ' + (err as Error).message);
      return;
    }
    parseGen++;

    const initialIndices = parsed.tracks.filter((t) => t.notes.length > 0).map((t) => t.index);
    const defaults = suggestDefaultMapping(parsed, initialIndices);
    presetPerTrack = { ...defaults.presetPerTrack };
    // Seed a fallback for any playable track the suggester skipped, so the row's
    // select and audition button read the same mapping the import will use.
    for (const tr of parsed.tracks) {
      if (tr.notes.length > 0 && !presetPerTrack[tr.index]) {
        presetPerTrack[tr.index] = { engineId: 'subtractive', presetName: 'Init' };
      }
    }

    paintTrackList();
    trackListEl.style.display = '';
    loadBtn.style.display = '';
    loadBtn.disabled = !isPresetsReady();
    if (loadBtn.disabled && deps.presetsReady) {
      // Picked a file before presets finished loading (boot race) — re-enable
      // once they resolve instead of leaving the button permanently disabled.
      void deps.presetsReady.then(() => { if (parsed) loadBtn.disabled = false; });
    }
  });

  loadBtn.addEventListener('click', async () => {
    if (!parsed) return;
    if (!isPresetsReady()) {
      void alertDialog('Presets still loading, retry in a moment');
      return;
    }
    const checks = Array.from(trackListEl.querySelectorAll<HTMLInputElement>('input[type=checkbox]:checked'));
    const indices = checks.map((cb) => parseInt(cb.dataset.idx ?? '', 10));

    // Ask BEFORE building the session, with EXPLICIT named buttons (not a binary
    // OK/Cancel whose meaning hides in the text). Add places the import on a NEW
    // row (= the current scene count) so its clips align with their scene's launch
    // button; Replace builds a fresh session at row 0; Cancel aborts.
    const trackCount = indices.length;
    const action = await choiceDialog(
      `${trackCount} track(s)` + (parsed.bpm ? ` @ ${Math.round(parsed.bpm)} BPM` : '') +
      `. Add to the current session or replace it?`,
      [
        { id: 'replace', label: 'Replace', danger: true },
        { id: 'add', label: 'Add', primary: true },
      ],
      { title: 'Import MIDI' },
    );
    if (action === null) return; // Cancelled — abort the import cleanly.

    const { laneCount } = applyMidiImport(action === 'add' ? 'add' : 'replace', parsed, indices, presetPerTrack, deps);
    deps.flashButton(loadBtn, `Loaded ${laneCount} lane(s)`);
  });
}
