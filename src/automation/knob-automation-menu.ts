// Right-click a knob → jump to (or create) its automation. Wires the two
// already-tested pure pieces — resolveAutomationTarget (WHERE it lives) and
// addClipEnvelope (creates a clip envelope) — into a context menu.
//
// Attached once per knob element at registerKnob time (see main.ts). Not a
// module-level singleton: every dep is threaded in explicitly so this stays
// testable without booting the app.

import type { KnobHandle } from '../core/knob';
import { openContextMenu, type ContextMenuItem } from '../core/context-menu';
import type { DestinationRegistry } from './destination-registry';
import { resolveAutomationTarget } from './automation-target-resolver';
import type { SessionState } from '../session/session';
import type { LanePlayState } from '../session/session-runtime';
import type { ArrangementState } from '../performance/performance';
import { addClipEnvelope } from '../session/clip-envelope-ops';

export interface KnobMenuDeps {
  destinations: DestinationRegistry;
  getMode: () => 'session' | 'performance';
  getState: () => SessionState;
  getLaneStates: () => ReadonlyMap<string, LanePlayState>;
  /** Read-only: only used to compute which params already have a timeline
   *  curve (for the "Edit" vs "Automate" label). Mutation goes through
   *  addTimelineCurve, not this. */
  getArrangement: () => ArrangementState;
  openClip: (laneId: string, clipIdx: number) => void;
  /** Create (or, if one already exists, do nothing to) a timeline automation
   *  curve for paramId — the whole undoable operation, owned by
   *  performance-feature.ts (PerformanceFeature.addCurve). The menu never
   *  mutates the arrangement directly, so it can't bypass arrangement undo. */
  addTimelineCurve: (paramId: string) => void;
  onClipEdited: (laneId: string, clipIdx: number) => void;
}

/** Curve param ids already present in the arrangement (lane + global). */
function timelineParamIds(arrangement: ArrangementState): string[] {
  const ids: string[] = [];
  for (const lane of arrangement.lanes) for (const c of lane.automation) ids.push(c.paramId);
  for (const c of arrangement.globalAutomation) ids.push(c.paramId);
  return ids;
}

// Guards against double-wiring: registerKnob is called again with a fresh
// element on every re-mount, but nothing guarantees the same handle is never
// re-registered.
const wired = new WeakSet<HTMLElement>();

export function attachKnobAutomationMenu(handle: KnobHandle, deps: KnobMenuDeps): void {
  if (wired.has(handle.el)) return;
  wired.add(handle.el);

  handle.el.addEventListener('contextmenu', (e: MouseEvent) => {
    const paramId = handle.meta.id;
    // A control that cannot be automated behaves exactly as it does today —
    // no menu, no side effects. This is also why select-controls (discrete
    // params) are safe to wire through the same call site: they carry no id
    // in the destination catalogue, so this check bails for them too.
    if (!paramId) return;
    if (!deps.destinations.list().some((t) => t.id === paramId)) return;

    // openContextMenu calls e.preventDefault() itself. No existing
    // 'contextmenu' listener stops propagation, so without this a knob
    // inside a lane header would open two menus in sequence.
    e.stopPropagation();

    const target = resolveAutomationTarget({
      paramId,
      mode: deps.getMode(),
      state: deps.getState(),
      laneStates: deps.getLaneStates(),
      timelineParamIds: timelineParamIds(deps.getArrangement()),
    });

    const items: ContextMenuItem[] = [];

    if (target.kind === 'clip') {
      const { laneId, clipIdx, clipName, existing } = target;
      items.push({
        label: existing
          ? `Edit automation in clip "${clipName}"`
          : `Automate in clip "${clipName}"`,
        onSelect: () => {
          if (!existing) {
            const lane = deps.getState().lanes.find((l) => l.id === laneId);
            const clip = lane?.clips[clipIdx];
            if (clip) addClipEnvelope(clip, paramId);
          }
          deps.openClip(laneId, clipIdx);
          deps.onClipEdited(laneId, clipIdx);
        },
      });
    } else if (target.kind === 'timeline') {
      const { existing } = target;
      items.push({
        label: existing ? 'Edit automation on the timeline' : 'Automate on the timeline',
        onSelect: () => {
          if (!existing) deps.addTimelineCurve(paramId);
        },
      });
    } else {
      items.push({ label: target.reason, disabled: true });
    }

    openContextMenu(e, items);
  });
}
