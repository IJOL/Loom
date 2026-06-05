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

import { parseMidiFile, type ParsedMidi } from './midi-parse';
import { midiToSession } from './midi-to-session';
import { findGMMatches, suggestDefaultMapping, type GMMatch } from './gm-lookup';
import { auditionPreset } from './audition';
import { isPresetsReady, getCachedPresets } from '../presets/preset-loader';
import { listEngines } from '../engines/registry';
import type { SessionState } from '../session/session';

export interface MidiImportUiDeps {
  session: SessionState;
  /** Apply a new tempo. The caller updates whatever holds the global BPM
   *  (Sequencer.bpm, UI input, downstream engines). */
  setBpm: (bpm: number) => void;
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

  function buildAllPresetsList(): GMMatch[] {
    const out: GMMatch[] = [];
    for (const eng of listEngines()) {
      for (const p of getCachedPresets(eng.id)) out.push({ engineId: eng.id, presetName: p.name });
    }
    return out;
  }

  function buildPresetSelect(
    programHint: number,
    current: GMMatch,
    onChange: (m: GMMatch) => void,
  ): HTMLSelectElement {
    const sel = document.createElement('select');
    sel.className = 'midi-preset-picker';
    const matches = findGMMatches(programHint);
    const seen = new Set<string>();
    const addOption = (m: GMMatch) => {
      const key = `${m.engineId}/${m.presetName}`;
      if (seen.has(key)) return;
      seen.add(key);
      const opt = document.createElement('option');
      opt.value = key;
      opt.textContent = `${m.engineId} / ${m.presetName}`;
      sel.appendChild(opt);
    };
    for (const m of matches) addOption(m);
    const divider = document.createElement('option');
    divider.disabled = true;
    divider.textContent = '── any preset ──';
    sel.appendChild(divider);
    for (const m of buildAllPresetsList()) addOption(m);
    sel.value = `${current.engineId}/${current.presetName}`;
    sel.addEventListener('change', () => {
      const [engineId, ...rest] = sel.value.split('/');
      onChange({ engineId, presetName: rest.join('/') });
    });
    return sel;
  }

  function buildAuditionButton(getMatch: () => GMMatch): HTMLButtonElement {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'midi-audition';
    btn.textContent = '▶'; // ▶
    btn.title = 'Audition this preset';
    btn.addEventListener('click', () => {
      auditionPreset(getMatch(), deps.audioContext, deps.auditionOutput);
    });
    return btn;
  }

  fileInput.addEventListener('change', async () => {
    const f = fileInput.files?.[0];
    if (!f) return;
    const buf = new Uint8Array(await f.arrayBuffer());
    try {
      parsed = parseMidiFile(buf);
    } catch (err) {
      alert('Not a valid SMF: ' + (err as Error).message);
      return;
    }

    const initialIndices = parsed.tracks.filter((t) => t.notes.length > 0).map((t) => t.index);
    const defaults = suggestDefaultMapping(parsed, initialIndices);
    presetPerTrack = { ...defaults.presetPerTrack };

    trackListEl.innerHTML = '';
    for (const tr of parsed.tracks) {
      if (tr.notes.length === 0) continue;
      const lo = Math.min(...tr.notes.map((n) => n.midi));
      const hi = Math.max(...tr.notes.map((n) => n.midi));

      const row = document.createElement('div');
      row.className = 'midi-track-row';

      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.dataset.idx = String(tr.index);
      cb.checked = true;
      const label = document.createElement('span');
      label.textContent = ` [${tr.index}] ${tr.name || 'untitled'} — ${tr.notes.length} notes, ${lo}-${hi}, prog ${tr.program}`;
      row.append(cb, label);

      const current = presetPerTrack[tr.index] ?? { engineId: 'subtractive', presetName: 'Init' };
      if (!presetPerTrack[tr.index]) presetPerTrack[tr.index] = current;
      const sel = buildPresetSelect(
        tr.program < 0 ? 0 : tr.program,
        current,
        (m) => { presetPerTrack[tr.index] = m; },
      );
      const audition = buildAuditionButton(() => presetPerTrack[tr.index] ?? current);
      row.append(sel, audition);
      trackListEl.appendChild(row);
    }
    trackListEl.style.display = '';
    loadBtn.style.display = '';
    loadBtn.disabled = !isPresetsReady();
    if (loadBtn.disabled && deps.presetsReady) {
      // Picked a file before presets finished loading (boot race) — re-enable
      // once they resolve instead of leaving the button permanently disabled.
      void deps.presetsReady.then(() => { if (parsed) loadBtn.disabled = false; });
    }
  });

  loadBtn.addEventListener('click', () => {
    if (!parsed) return;
    if (!isPresetsReady()) {
      alert('Presets still loading, retry in a moment');
      return;
    }
    const checks = Array.from(trackListEl.querySelectorAll<HTMLInputElement>('input[type=checkbox]:checked'));
    const indices = checks.map((cb) => parseInt(cb.dataset.idx ?? '', 10));

    // Confirm BEFORE building the session: Add places the import on a NEW row
    // (= the current scene count) so its clips align with their scene's launch
    // button; Replace builds a fresh session at row 0. (`confirm` is binary.)
    const trackCount = indices.length;
    const doAdd = window.confirm(
      `MIDI parsed: ${trackCount} track(s)` +
      (parsed.bpm ? ` @ ${Math.round(parsed.bpm)} BPM` : '') +
      `\n\nOK = Add to current session.\nCancel = Replace session.`,
    );

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
      // Replace: a fresh session built from JUST the imported lanes + scene.
      deps.session.lanes = [...result.newLanes];
      deps.session.scenes = [result.scene];
    }

    if (result.bpm) deps.setBpm(result.bpm);

    deps.onSessionChanged();
    deps.launchScene(result.scene.id);
    deps.onImported?.();
    deps.flashButton(loadBtn, `Loaded ${result.newLanes.length} lane(s)`);
  });
}
