// src/midi/midi-import-ui.ts — per-track preset picker + audition + Add/Replace.
//
// Replaces the legacy wireMidiImport flow. Each track row gets:
//   - selection checkbox
//   - preset dropdown (GM-suggested matches first, then "any preset")
//   - ▶ audition button (plays a 3-note arpeggio without touching the session)
//
// On Load, calls midiToSession with the per-track mapping the user picked
// and presents an Add/Replace/Cancel confirm. Add appends lanes + scene to
// the current session; Replace wipes lanes (preserving the drum lane if any)
// and seeds a fresh session with just the imported content.

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
  /** Lane id that owns drum playback in the current session. Drum clips from
   *  MIDI are appended to this lane's clip list. May be null if no drum lane. */
  drumLaneId: string | null;
  audioContext: AudioContext;
  /** Node the audition voice connects into — typically the master gain. */
  auditionOutput: AudioNode;
  /** Called after the session is mutated so the UI re-renders + the new
   *  lanes/scenes appear in the session view. */
  onSessionChanged: () => void;
  /** Switch to the freshly-created scene by id (host resolves index). */
  launchScene: (sceneId: string) => void;
  flashButton: (b: HTMLButtonElement, msg: string) => void;
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
  let drumKitMatch: GMMatch | null = null;

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
    drumKitMatch = defaults.drumKitMatch;

    trackListEl.innerHTML = '';
    for (const tr of parsed.tracks) {
      if (tr.notes.length === 0) continue;
      const lo = Math.min(...tr.notes.map((n) => n.midi));
      const hi = Math.max(...tr.notes.map((n) => n.midi));
      const isDrum = tr.notes.some((n) => n.channel === 9);

      const row = document.createElement('div');
      row.className = 'midi-track-row';

      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.dataset.idx = String(tr.index);
      cb.checked = true;
      const label = document.createElement('span');
      label.textContent = ` [${tr.index}] ${tr.name || 'untitled'} — ${tr.notes.length} notes, ${lo}-${hi}, prog ${tr.program}${isDrum ? ' (DRUMS)' : ''}`;
      row.append(cb, label);

      if (!isDrum) {
        const current = presetPerTrack[tr.index] ?? { engineId: 'subtractive', presetName: 'Init' };
        if (!presetPerTrack[tr.index]) presetPerTrack[tr.index] = current;
        const sel = buildPresetSelect(
          tr.program < 0 ? 0 : tr.program,
          current,
          (m) => { presetPerTrack[tr.index] = m; },
        );
        const audition = buildAuditionButton(() => presetPerTrack[tr.index] ?? current);
        row.append(sel, audition);
      } else if (drumKitMatch) {
        const sel = buildPresetSelect(
          tr.program < 0 ? 0 : tr.program,
          drumKitMatch,
          (m) => { drumKitMatch = m; },
        );
        const audition = buildAuditionButton(() => drumKitMatch!);
        row.append(sel, audition);
      }
      trackListEl.appendChild(row);
    }
    trackListEl.style.display = '';
    loadBtn.style.display = '';
    loadBtn.disabled = !isPresetsReady();
  });

  loadBtn.addEventListener('click', () => {
    if (!parsed) return;
    if (!isPresetsReady()) {
      alert('Presets still loading, retry in a moment');
      return;
    }
    const checks = Array.from(trackListEl.querySelectorAll<HTMLInputElement>('input[type=checkbox]:checked'));
    const indices = checks.map((cb) => parseInt(cb.dataset.idx ?? '', 10));
    const result = midiToSession(parsed, {
      selectedTrackIndices: indices,
      presetPerTrack,
      drumKitMatch,
    });

    // OK = Add, Cancel = Replace. (`confirm` is binary; the spec uses the
    // window confirm prompt to keep the UI footprint minimal.)
    const doAdd = window.confirm(
      `MIDI parsed: ${result.newLanes.length} tonal tracks` +
      (result.drumClip ? ' + drum clip' : '') +
      (result.bpm ? ` @ ${Math.round(result.bpm)} BPM` : '') +
      `\n\nOK = Add to current session.\nCancel = Replace session.`,
    );

    if (doAdd) {
      deps.session.lanes.push(...result.newLanes);
      deps.session.scenes.push(result.scene);
      if (result.drumClip && deps.drumLaneId) {
        const drumLane = deps.session.lanes.find((l) => l.id === deps.drumLaneId);
        if (drumLane) {
          const idx = drumLane.clips.push(result.drumClip) - 1;
          result.scene.clipPerLane[drumLane.id] = idx;
        }
      } else if (result.drumClip) {
        console.warn('MIDI drums dropped — no drums lane in session');
      }
    } else {
      const preservedDrumLane = deps.drumLaneId
        ? deps.session.lanes.find((l) => l.id === deps.drumLaneId) ?? null
        : null;
      deps.session.lanes = preservedDrumLane
        ? [preservedDrumLane, ...result.newLanes]
        : [...result.newLanes];
      deps.session.scenes = [result.scene];
      if (result.drumClip && preservedDrumLane) {
        const idx = preservedDrumLane.clips.push(result.drumClip) - 1;
        result.scene.clipPerLane[preservedDrumLane.id] = idx;
      } else if (result.drumClip) {
        console.warn('MIDI drums dropped — no drums lane in session');
      }
    }

    if (result.bpm) deps.setBpm(result.bpm);

    deps.onSessionChanged();
    deps.launchScene(result.scene.id);
    deps.flashButton(loadBtn, `Loaded ${result.newLanes.length} lane(s), ${result.drumClip ? '1' : '0'} drum clip`);
  });
}
