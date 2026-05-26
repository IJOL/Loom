import { classicState, EXTRA_IDS, type ClassicDeps, type ExtraId } from './classic-state';
import type { PolyTrack } from '../core/pattern';
import type { PolySynth } from '../polysynth/polysynth';

export function setActivePolyTarget(
  target: PolySynth,
  labelText: string,
  deps: ClassicDeps,
): void {
  classicState.activePolyTarget = target;
  const labelEl = document.getElementById('poly-active-label');
  if (labelEl) labelEl.textContent = labelText;
  deps.refreshPolyKnobsFromState();
  deps.refreshPolyPresetSelect();
  refreshPolyTargetSelect(deps);
  document.querySelectorAll('.track-label.active-edit').forEach((el) =>
    el.classList.remove('active-edit'),
  );
  const node = document.querySelector(`.track-label[data-poly-target="${labelText}"]`);
  if (node) node.classList.add('active-edit');
  // Switch engine selector + params panel to this lane
  let laneId: string = 'main';
  if (target !== deps.polysynth) {
    for (const id of EXTRA_IDS) {
      if (deps.extraPolys[id] && deps.extraPolys[id] === target) { laneId = id; break; }
    }
  }
  deps.setActiveEngineLane(laneId);
}

export function ensureExtraTrack(id: ExtraId, deps: ClassicDeps): PolyTrack {
  let track = deps.seq.pattern.extraPolyTracks.find((t) => t.id === id);
  if (!track) {
    track = { id, name: deps.laneLabels[id], enabled: true, notes: [] };
    deps.seq.pattern.extraPolyTracks.push(track);
  }
  deps.ensureExtraPoly(id);
  return track;
}

export function refreshPolyTargetSelect(deps: ClassicDeps): void {
  const sel = document.getElementById('poly-target-select') as HTMLSelectElement | null;
  if (!sel) return;
  sel.innerHTML = '';
  const opts: Array<{ value: string; label: string }> = [{ value: 'main', label: 'MAIN' }];
  for (const id of EXTRA_IDS) {
    const hasTrack = !!deps.seq.pattern.extraPolyTracks.find((t) => t.id === id);
    opts.push({
      value: id,
      label: hasTrack ? `${deps.laneLabels[id]} ●` : `${deps.laneLabels[id]} (empty)`,
    });
  }
  for (const o of opts) {
    const opt = document.createElement('option');
    opt.value = o.value;
    opt.textContent = o.label;
    sel.appendChild(opt);
  }
  if (classicState.activePolyTarget === deps.polysynth) {
    sel.value = 'main';
  } else {
    for (const id of EXTRA_IDS) {
      if (deps.extraPolys[id] && deps.extraPolys[id] === classicState.activePolyTarget) {
        sel.value = id;
        break;
      }
    }
  }
}

