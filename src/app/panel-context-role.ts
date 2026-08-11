// The three PanelContext members that answer "what part does this lane play".
//
// Their own file rather than three more members inside panel-context.ts, which
// is at its size limit — and they belong together anyway: the list, the mark and
// the write are one control, and the write does two things beyond the field
// (moves the loops, seeds the arpeggiator) that read as a unit here and as noise
// in a five-hundred-line switchboard.

import type { PanelChoice, PanelContext } from '@loom/plugin-sdk';
import { withUndo, type HistoryDeps } from '../save/history-wiring';
import type { SessionState, SessionLane } from '../session/session';
import type { LaneRole } from '../session/session-types';
import { LANE_ROLES, roleLabel } from '../session/lane-role';
import { isHarmonic, defaultRoleOf, acceptsNoteFx } from '../plugins/capabilities';
import { getNoteFxChain } from '../notefx/notefx-registry';
import { syncNoteFx } from '../session/session-engine-state';

export interface RoleDeps {
  getState: () => SessionState;
  /** Drop a selection the lane may no longer read. Owned by panel-context,
   *  which is also the only other caller. */
  reseedLoops: (laneId: string) => void;
  onWeaveChanged?: (laneId: string) => void;
  refresh: () => void;
  /** Read at call time, not captured: the host wires history into the session
   *  AFTER construction, so a context built at boot would hold undefined for
   *  the rest of the run and every mark would land outside undo. */
  history: () => HistoryDeps | undefined;
}

/** The three members, ready to spread into the panel context. */
export function roleMembers(d: RoleDeps):
Pick<PanelContext, 'roleChoices' | 'laneRole' | 'setLaneRole'> {
  return {
    roleChoices: (laneId) => roleChoices(d, laneId),
    laneRole: (laneId) => laneRole(d, laneId),
    setLaneRole: (laneId, role) => {
      // Undoable, unlike the style beside it. The asymmetry is deliberate and
      // not an oversight: the style is WEAVE's own state, which is deliberately
      // not an undo entry, and the part is on the LANE — session state, saved
      // by the same whole-object clone as its name.
      const run = (): void => setLaneRole(d, laneId, role);
      const hd = d.history();
      if (hd) withUndo(hd, run); else run();
    },
  };
}

const laneOf = (d: RoleDeps, laneId: string): SessionLane | undefined =>
  d.getState().lanes.find((l) => l.id === laneId);

/** The parts this lane may be marked as, the unmarked option first — or NOTHING
 *  at all when the question does not apply. */
export function roleChoices(d: RoleDeps, laneId: string): PanelChoice[] {
  const lane = laneOf(d, laneId);
  // A drum lane cannot have a part: it draws percussion whatever anyone says.
  // An empty list is how this ABI says "do not show the control" — a picker
  // whose every choice is ignored is worse than no picker.
  if (!lane || !isHarmonic(lane.engineId)) return [];
  const auto = defaultRoleOf(lane.engineId);
  return [
    // Named after what it actually does. On an instrument that declares the part
    // it is built for, leaving this alone is not "no part" — it is that part,
    // and a bare dash would read as the lane being unassigned while its loop
    // list showed only basslines.
    { id: '', name: auto ? `— auto · ${roleLabel(auto)} —` : '— any —' },
    ...LANE_ROLES.map((r) => ({ id: r.id, name: r.label })),
  ];
}

export function laneRole(d: RoleDeps, laneId: string): string | null {
  return laneOf(d, laneId)?.role ?? null;
}

/** An ARP lane gets an arpeggiator, because otherwise the part is a promise the
 *  app does not keep: every chordal part draws the same five shapes, so marking
 *  a lane Arp without this gives you a pad in the lead register and nothing
 *  else. The note-FX is what turns a held chord into one note at a time.
 *
 *  SEEDED, never removed. Un-marking the lane leaves the arpeggiator where it
 *  is: by then it is a card in the lane's note-FX panel with the user's own
 *  settings on it, and quietly deleting somebody's edits because they changed a
 *  dropdown is worse than leaving a control they can see and switch off.
 *
 *  One only. Marking, clearing and marking again must not stack three of them. */
function seedArpeggiator(d: RoleDeps, lane: SessionLane): void {
  if (!acceptsNoteFx(lane.engineId)) return;
  const chain = getNoteFxChain(lane.id);
  if (chain.noteFx.some((s) => s.kind === 'arp')) return;
  chain.addNoteFx('arp');
  // The chain is live and the session is what gets SAVED; the panel's own add
  // button mirrors through this same seam for the same reason.
  syncNoteFx(d.getState(), lane.id, chain.serialize());
}

/** Mark a lane, or clear it with null. */
export function setLaneRole(d: RoleDeps, laneId: string, role: string | null): void {
  const lane = laneOf(d, laneId);
  if (!lane) return;
  if (role === null) delete lane.role;
  else lane.role = role as LaneRole;
  if (role === 'arp') seedArpeggiator(d, lane);
  // The material a part draws from IS the point of the mark, so the loops move
  // with it — the same reason setLaneStyle reseeds. A loop id carries its own
  // kind and still RESOLVES whatever the role says, so without this a lane
  // marked Pad goes on playing the lead loop it had while its picker lists five
  // chord shapes, none of them selected.
  d.reseedLoops(laneId);
  d.onWeaveChanged?.(laneId);
  d.refresh();
}
