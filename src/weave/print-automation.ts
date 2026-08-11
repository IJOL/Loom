// The step rack, printed into the clips it was driving.
//
// PRINT captures what the weave PLAYS, and the rack is half of that: it moves a
// parameter in time with the loop, so a scene printed without it plays the
// right notes with the movement gone — a filter that was opening and closing
// under your hand arrives frozen wherever the playhead happened to be.
//
// Two things decide the shape of this file:
//
//   - **A row's shape spans ONE BAR and repeats.** `tickSteps` reads it at
//     `bars - floor(bars)`, so a four-bar lap is the shape four times, not the
//     shape stretched over four. Stretching would print something nobody heard.
//   - **A row belongs to a LANE or to nowhere.** A clip envelope names a param
//     of the lane that owns the clip; a row aimed at the master bus, a send or
//     a WEAVE macro has no clip to live in and is left out rather than
//     misfiled.
//
// Pure: rows in, envelopes out. No session, no clock, no DOM.

import { fillSteps, type StepMode } from '../automation/automation-steps';
import { parseAutomationParamId } from '../automation/automation-apply';

/** What this needs of a rack row — the shape, where it goes, and whether it is
 *  running. Structurally typed so the weave's own state type stays out of a
 *  module that is otherwise pure arithmetic. */
export interface PrintableRow {
  destId: string;
  values: number[];
  mode: StepMode;
  on: boolean;
}

/** What this needs of a clip envelope. Matches `ClipEnvelope` field for field;
 *  declared here for the same reason. */
export interface PrintedEnvelope {
  paramId: string;
  values: number[];
  stepped?: boolean;
}

/** The rack's running rows as clip envelopes, by the lane whose clip they
 *  belong to.
 *
 *  `subsPerBar` is `envelopeValueLength(1, meter)` — asked of the one owner of
 *  that number rather than recomputed, or a printed curve would span a
 *  different length from the clip holding it and slide a bar per lap.
 *
 *  A row that is OFF, has no destination or no shape prints nothing: it was
 *  writing nothing, and an envelope of zeroes is not the same as no envelope —
 *  it would pin the param at zero for the whole clip. */
export function envelopesForPrint(
  rows: readonly PrintableRow[],
  laneIds: readonly string[],
  bars: number,
  subsPerBar: number,
): Map<string, PrintedEnvelope[]> {
  const out = new Map<string, PrintedEnvelope[]>();
  if (!(bars > 0) || !(subsPerBar > 0)) return out;
  const lanes = new Set(laneIds);

  for (const row of rows) {
    if (!row?.on || !row.destId || row.values.length === 0) continue;
    const parsed = parseAutomationParamId(row.destId);
    // Only a LANE's own params can live in that lane's clip. A macro, the
    // master bus and a send return all parse to something else, and there is no
    // clip anywhere that owns them.
    if (!parsed || parsed.kind !== 'engine' || !lanes.has(parsed.scopeId)) continue;

    // One bar of the shape, tiled — see the header. `fillSteps` already closes
    // a ramp on itself at the bar's end, so the seam between repeats is the
    // same seam the live row plays.
    const oneBar = fillSteps(row.values, row.mode, subsPerBar);
    const values = Array.from(
      { length: subsPerBar * bars }, (_, i) => oneBar[i % subsPerBar],
    );

    const list = out.get(parsed.scopeId) ?? [];
    list.push({
      paramId: row.destId,
      values,
      // 'hold' is a staircase and 'ramp' is a slope — the same distinction the
      // clip editor draws, under the name it already uses.
      stepped: row.mode === 'hold',
    });
    out.set(parsed.scopeId, list);
  }
  return out;
}
