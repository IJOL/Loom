// Pure helpers shared by SessionHost and its extracted sub-modules.

/** Returns the next available slug id for a new lane of the given engineId.
 *  The loop starts at 1, so for engines with no existing lane the first id is
 *  e.g. "fm-4-op-1". For engines that boot with a default lane (tb303 → "tb-303-1",
 *  subtractive → "subtractive-1", drums-machine → "drums-1"), the default is
 *  already in `existingIds` so the first added extra will be "-2". */
export function nextLaneSlug(existingIds: ReadonlySet<string>, engineId: string): string {
  const prefix =
    engineId === 'tb303'         ? 'tb-303'      :
    engineId === 'drums-machine' ? 'drums'       :
    engineId === 'subtractive'   ? 'subtractive' :
    engineId === 'wavetable'     ? 'wavetable'   :
    engineId === 'fm'            ? 'fm-4-op'     :
    engineId === 'karplus'       ? 'karplus'     :
    engineId === 'westcoast'     ? 'west'        :
                                   engineId;
  for (let i = 1; i <= 99; i++) {
    const candidate = `${prefix}-${i}`;
    if (!existingIds.has(candidate)) return candidate;
  }
  return `${prefix}-overflow`;
}

/** True when selecting `nextLaneId` should close the open clip editor: it is
 *  showing a clip that belongs to some other lane, so the editor and the active
 *  lane would disagree — and the edits, generators and ▶ would land on a lane the
 *  user is no longer looking at. Re-selecting the open clip's OWN lane (a header
 *  click, an engine swap, the collapse chevron, an undo repaint) must never take
 *  the editor away, so same-lane is always false. */
export function shouldCloseClipEditorOnLaneSwitch(
  openClip: { laneId: string } | null,
  nextLaneId: string,
): boolean {
  return openClip !== null && openClip.laneId !== nextLaneId;
}

/** Which scene, if any, the global ▶ should launch when it starts the transport.
 *
 *  Pressing ▶ with nothing launched must sound something — the first scene — or
 *  a fresh visitor presses it, hears silence and leaves. But launching a scene
 *  or a clip ALSO starts the transport, and those must not double-launch: by the
 *  time this runs a scene is already active (activeSceneIdx >= 0) or a lane is
 *  already playing/queued, so it returns null for them. Only a bare transport
 *  start — no scene, no lane, but scenes exist — auto-launches scene 0. */
export function sceneToAutoLaunchOnPlay(
  activeSceneIdx: number,
  anyLaneActive: boolean,
  sceneCount: number,
): number | null {
  if (activeSceneIdx >= 0) return null;   // a scene launch / resume is already running
  if (anyLaneActive) return null;         // a clip launch started the transport
  if (sceneCount <= 0) return null;       // nothing to launch
  return 0;
}
