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
                                   engineId;
  for (let i = 1; i <= 99; i++) {
    const candidate = `${prefix}-${i}`;
    if (!existingIds.has(candidate)) return candidate;
  }
  return `${prefix}-overflow`;
}
