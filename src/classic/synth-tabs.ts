import { classicState, EXTRA_IDS, type ClassicDeps, type ExtraId } from './classic-state';
import { setActivePolyTarget, ensureExtraTrack } from './poly-target';

type RebuildPolyTrack = () => void;

export function rebuildSynthTabs(
  deps: ClassicDeps,
  rebuildPolyTrackFn: RebuildPolyTrack,
  rebuildMixerFn: () => void,
): void {
  const host = document.getElementById('synth-tabs');
  if (!host) return;
  host.innerHTML = '';

  const mkTab = (laneId: string, label: string) => {
    const b = document.createElement('button');
    b.className = 'tab synth-tab';
    b.dataset.tab = 'poly';
    b.dataset.synthLane = laneId;
    b.textContent = label;
    if (laneId === classicState.currentSynthLane) b.classList.add('active');
    b.addEventListener('click', () =>
      setCurrentSynthLane(laneId, deps, rebuildPolyTrackFn, rebuildMixerFn),
    );
    host.appendChild(b);
  };
  mkTab('main', 'MAIN');
  for (const track of deps.seq.pattern.extraPolyTracks) {
    mkTab(track.id, track.name.slice(0, 12));
  }

  // Refresh ARP scope checkboxes (depend on extras list)
  if (document.getElementById('poly-arp-controls')?.childElementCount) {
    deps.buildArpUI({ getExtraPolyTracks: () => deps.seq.pattern.extraPolyTracks });
  }

  const addBtn = document.createElement('button');
  addBtn.className = 'tab synth-tab-add';
  addBtn.textContent = '+ Synth';
  addBtn.title = 'Add a new polysynth lane';
  addBtn.addEventListener('click', () => {
    const used = new Set(deps.seq.pattern.extraPolyTracks.map((t) => t.id));
    const free = EXTRA_IDS.find((id) => !used.has(id));
    if (!free) {
      alert(`All ${EXTRA_IDS.length} extra polysynth slots are in use.`);
      return;
    }
    ensureExtraTrack(free, deps);
    rebuildSynthTabs(deps, rebuildPolyTrackFn, rebuildMixerFn);
    rebuildMixerFn();
    setCurrentSynthLane(free, deps, rebuildPolyTrackFn, rebuildMixerFn);
  });
  host.appendChild(addBtn);
}

export function setCurrentSynthLane(
  laneId: string,
  deps: ClassicDeps,
  rebuildPolyTrackFn: RebuildPolyTrack,
  _rebuildMixerFn?: () => void,
): void {
  classicState.currentSynthLane = laneId;
  document.querySelectorAll<HTMLButtonElement>('button.tab').forEach((t) => {
    t.classList.toggle('active', t.dataset.tab === 'poly' && t.dataset.synthLane === laneId);
  });
  document.querySelectorAll<HTMLButtonElement>('button.tab').forEach((t) => {
    if (!t.dataset.synthLane && t.dataset.tab !== 'poly') t.classList.remove('active');
  });
  document.querySelectorAll<HTMLElement>('.page').forEach((p) => {
    p.hidden = p.dataset.page !== 'poly';
  });
  if (laneId === 'main') {
    setActivePolyTarget(deps.polysynth, 'MAIN', deps);
  } else {
    const id = laneId as ExtraId;
    const track = ensureExtraTrack(id, deps);
    setActivePolyTarget(deps.ensureExtraPoly(id), track.name, deps);
  }
  rebuildPolyTrackFn();
}
