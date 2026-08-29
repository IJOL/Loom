// The list a lane draws from, and how it is walked.
//
// A lane's material used to be dealt to it: a seeded hash over everything its
// role allowed. The pool is the user writing that list themselves — which
// loops, in which order — and this is the whole of "in which order".
//
// Pure: ids in, id out. No state, no session, no clock.

/** The loop that follows `leaving` in the list, wrapping at the end.
 *
 *  Null only for an EMPTY list, which is a lane with no list at all — every
 *  other case has a successor, including a list of one, which stays where it
 *  is. A `leaving` the list does not contain rejoins at the head: the list was
 *  edited under a travelling lane, and the front is what the user wrote next. */
export function nextFromPool(
  pool: readonly string[], leaving: string,
): string | null {
  if (pool.length === 0) return null;
  const at = pool.indexOf(leaving);
  if (at < 0) return pool[0];
  return pool[(at + 1) % pool.length];
}
