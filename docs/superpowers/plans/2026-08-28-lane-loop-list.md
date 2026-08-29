# Lane loop list — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A lane carries an ordered list of loops it draws from, and the two things that pick material on their own — A→B's hand-over and the generator's seeding — read that list instead of dealing from the shelf.

**Architecture:** One optional field, `pool?: string[]`, on the lane's weave selection (saved, undone and keyed per lane like everything else there). One pure successor function. Two consumers that prefer it where it exists and behave exactly as today where it does not. One editor in the panel row's settings line, built from buttons because the panel remounts on every write.

**Tech Stack:** TypeScript, Vitest, the WEAVE panel plugin (`plugins/weave/`) against `@loom/plugin-sdk`.

**Spec:** [docs/superpowers/specs/2026-08-28-lane-loop-list-design.md](../specs/2026-08-28-lane-loop-list-design.md)

## Global Constraints

- **Absent `pool` must change nothing.** Every existing session sounds the same after this ships; each consumer's task carries a negative-control test that pins the old behaviour.
- **Loop ids are the ones `src/weave/loop-ids.ts` defines** — `clip:<id>`, `lib:<style>:<kind>:<index>`, `chord:<shape>`. Never invent a fourth shape.
- **The panel is a plugin with no hot reload.** Any edit under `plugins/` needs `npm run build:plugins` and a full page reload before it is visible.
- **No drag-and-drop in the panel.** `refresh()` does `root.replaceChildren()`, so a drag dies on its second event. Buttons only.
- **Commit messages in English**, and run `NO_COLOR=1 npx vitest run <file>` for single files.

---

### Task 1: The field, and the pure successor

**Files:**
- Modify: `src/weave/weave-state.ts` (the `LaneSelection` interface, after `harmonyLeader`)
- Create: `src/weave/loop-pool.ts`
- Test: `src/weave/loop-pool.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `LaneSelection.pool?: string[]`, and `nextFromPool(pool: readonly string[], leaving: string): string | null`.

- [ ] **Step 1: Write the failing test**

```ts
// src/weave/loop-pool.test.ts
// The list a lane draws from, walked in the order it was written.
import { describe, it, expect } from 'vitest';
import { nextFromPool } from './loop-pool';

describe('nextFromPool', () => {
  it('hands over to the next entry in the list', () => {
    expect(nextFromPool(['a', 'b', 'c'], 'a')).toBe('b');
    expect(nextFromPool(['a', 'b', 'c'], 'b')).toBe('c');
  });

  it('wraps at the end rather than running out', () => {
    // A lane that reached the last entry and stopped would go quietly static
    // while the rest of the scene travels — the same rule the clip walk uses.
    expect(nextFromPool(['a', 'b', 'c'], 'c')).toBe('a');
  });

  it('starts at the head when the loop leaving is not in the list', () => {
    // The list was edited under a lane that was already travelling. Rejoining
    // at the front is the answer that plays what the user wrote next.
    expect(nextFromPool(['a', 'b'], 'zzz')).toBe('a');
  });

  it('says nothing for an empty list — there is no successor', () => {
    expect(nextFromPool([], 'a')).toBeNull();
  });

  it('holds a list of ONE where it is', () => {
    // Honest rather than clever: one entry is one entry, and the caller decides
    // whether that means "do not hand over".
    expect(nextFromPool(['a'], 'a')).toBe('a');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `NO_COLOR=1 npx vitest run src/weave/loop-pool.test.ts`
Expected: FAIL — `Failed to resolve import "./loop-pool"`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/weave/loop-pool.ts
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
```

- [ ] **Step 4: Add the field to the lane's selection**

In `src/weave/weave-state.ts`, inside `interface LaneSelection`, immediately after the `harmonyLeader: boolean;` line that belongs to it (the SECOND one, around line 76 — the first is `LaneWeaveConfig`):

```ts
  /** The loops this lane draws from, in the order they were written.
   *
   *  Absent or empty ⇒ the whole shelf its role allows, which is how every
   *  session before this one behaves and must keep behaving. Present, it is
   *  what the A→B hand-over walks and what the generator seeds from.
   *
   *  Ids only — `clip:`, `lib:` or `chord:` — never notes: this is a choice
   *  about material, and the notes behind an id are resolved fresh every time
   *  so an edited clip is heard as edited. */
  pool?: string[];
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `NO_COLOR=1 npx vitest run src/weave/loop-pool.test.ts && npx tsc --noEmit`
Expected: 5 passed, and a clean typecheck.

- [ ] **Step 6: Commit**

```bash
git add src/weave/loop-pool.ts src/weave/loop-pool.test.ts src/weave/weave-state.ts
git commit -m "feat(weave): the list a lane draws from, and how it is walked"
```

---

### Task 2: A→B hands over along the list

**Files:**
- Modify: `src/app/weave-loops.ts` (`rehookOnArrival`, around line 464-548)
- Modify: `src/app/weave-wiring.ts` (the `rehook` closure that calls it)
- Test: `src/app/weave-loops.test.ts` (the existing `describe('what a lane hands over TO')`)

**Interfaces:**
- Consumes: `nextFromPool` from Task 1.
- Produces: `rehookOnArrival(sel, c, seed, laneId, trail?, pool?)` — one new optional trailing parameter, `pool?: readonly string[]`.

- [ ] **Step 1: Write the failing tests**

Add inside the existing `describe('what a lane hands over TO')` block in `src/app/weave-loops.test.ts`:

```ts
  it('walks the POOL in order when the lane has one', () => {
    // The whole feature: what plays next is what the user wrote next, rather
    // than a seeded draw over everything the role allows.
    const c = ctxFor(laneWith(['c1', 'c2', 'c3']));
    const pool = ['clip:c1', 'clip:c3', ID];
    const next = rehookOnArrival(
      { kind: 'ab', a: 'clip:c1', b: 'clip:c3', x: 1 } as never, c, 1, 'l1', undefined, pool,
    );
    expect(next).toMatchObject({ a: 'clip:c3', b: ID });
  });

  it('wraps the pool rather than running out', () => {
    const c = ctxFor(laneWith(['c1', 'c2', 'c3']));
    const pool = ['clip:c1', 'clip:c3'];
    const next = rehookOnArrival(
      { kind: 'ab', a: 'clip:c1', b: 'clip:c3', x: 1 } as never, c, 1, 'l1', undefined, pool,
    );
    expect(next).toMatchObject({ a: 'clip:c3', b: 'clip:c1' });
  });

  it('holds still on a pool of ONE — there is nowhere to hand over to', () => {
    // A list of one names one piece of material. Handing over to the loop
    // already sounding is not evolution, and re-drawing from the shelf would
    // ignore the list the user wrote.
    const c = ctxFor(laneWith(['c1', 'c2', 'c3']));
    const next = rehookOnArrival(
      { kind: 'ab', a: 'clip:c1', b: 'clip:c3', x: 1 } as never, c, 1, 'l1', undefined, ['clip:c3'],
    );
    expect(next).toBeNull();
  });

  it('draws exactly as before when there is NO pool (negative control)', () => {
    // Every session that exists has no pool. This is the test that says so.
    const c = ctxFor(laneWith(['c1', 'c2', 'c3']));
    const args = [{ kind: 'ab', a: 'clip:c1', b: 'clip:c2', x: 1 } as never, c, 1, 'l1'] as const;
    expect(rehookOnArrival(...args)).toMatchObject({ a: 'clip:c2', b: 'clip:c3' });
    expect(rehookOnArrival(...args, undefined, [])).toMatchObject({ a: 'clip:c2', b: 'clip:c3' });
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `NO_COLOR=1 npx vitest run src/app/weave-loops.test.ts`
Expected: the four new tests FAIL (the pool argument is ignored, so the clip walk answers instead); every existing test in the file still passes.

- [ ] **Step 3: Implement**

In `src/app/weave-loops.ts`, add the import at the top:

```ts
import { nextFromPool } from '../weave/loop-pool';
```

Then in `rehookOnArrival`, add the parameter after `trail`:

```ts
  /** The loops this lane draws from, in the order the user wrote them. When it
   *  has one, the hand-over WALKS it instead of drawing: the far end becomes
   *  the entry after the one being left. Absent or empty ⇒ the draw below,
   *  which is how every session without a list behaves. */
  pool?: readonly string[],
```

and insert this block immediately after the `if (sel.kind !== 'ab') return null;` guard, BEFORE the `clipIds` block:

```ts
  // The written list wins over every draw below it — that is what writing one
  // means. It is read here rather than filtered into the pool further down
  // because the order is the point: a filter would still hash, and the whole
  // request was "en qué orden".
  if (pool && pool.length > 0) {
    // A list of ONE names one piece of material, so there is nowhere to hand
    // over to. Returning null holds the lane where it is, which is honest;
    // falling through to the shelf would play what the list excludes.
    if (pool.length === 1) return null;
    const b = nextFromPool(pool, sel.b);
    if (!b || b === sel.b) return null;
    return { ...sel, a: sel.b, b };
  }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `NO_COLOR=1 npx vitest run src/app/weave-loops.test.ts`
Expected: PASS, including every pre-existing test in the file.

- [ ] **Step 5: Hand the pool in from the wiring**

In `src/app/weave-wiring.ts`, find the `rehook` closure (the one passed to `applyFlow` as `onWrap`, which calls `rehookOnArrival`). Add the pool as the last argument:

```ts
        rehookOnArrival(entry?.weave, loopContext(laneId), state.seed, laneId, entry?.trail,
          state.lanes[laneId]?.pool),
```

- [ ] **Step 6: Verify the whole app suite is still green**

Run: `npx tsc --noEmit && NO_COLOR=1 npx vitest run src/app/ src/weave/`
Expected: clean typecheck, all files pass.

- [ ] **Step 7: Commit**

```bash
git add src/app/weave-loops.ts src/app/weave-loops.test.ts src/app/weave-wiring.ts
git commit -m "feat(weave): A to B hands over along the list, where there is one"
```

---

### Task 3: The generator seeds from the list

**Files:**
- Modify: `src/app/panel-context-generator.ts` (`GeneratorDepsUI`, and `setGeneratorOn` around line 172-205)
- Modify: `src/app/panel-context.ts` (the `generatorMembers({...})` call, around line 450)
- Test: `src/app/panel-context-generator.test.ts`

**Interfaces:**
- Consumes: `LaneSelection.pool` from Task 1 (read by the host, handed in as a dep).
- Produces: `GeneratorDepsUI.poolIds?: (laneId: string) => string[]`.

- [ ] **Step 1: Write the failing tests**

Add to the `describe('the generator switch')` block in `src/app/panel-context-generator.test.ts`:

```ts
  it('seeds from the lane s LIST before anything else', () => {
    // The list is the user's own answer to "what may this lane play", so it
    // outranks both the clips it happens to hold and the shelf its role allows.
    const h = harness();                       // this lane HAS a clip with notes
    h.deps.poolIds = () => ['lib:acid-techno:bass:2', 'lib:acid-techno:bass:3'];
    setGeneratorOn(h.deps, 'lane1', true);
    expect(h.lane().generator?.selection)
      .toMatchObject({ kind: 'ab', a: 'lib:acid-techno:bass:2' });
  });

  it('ignores an EMPTY list — that is a lane with no list at all', () => {
    const h = harness();
    h.deps.poolIds = () => [];
    setGeneratorOn(h.deps, 'lane1', true);
    expect(h.lane().generator?.selection).toMatchObject({ kind: 'ab', a: 'clip:clipA' });
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `NO_COLOR=1 npx vitest run src/app/panel-context-generator.test.ts`
Expected: the first new test FAILS (`a` is `clip:clipA`); the second passes already.

- [ ] **Step 3: Implement**

In `src/app/panel-context-generator.ts`, add to `interface GeneratorDepsUI`, after `shelfIds`:

```ts
  /** The loops this lane draws from, in the order the user wrote them —
   *  `LaneSelection.pool`, handed in by the host.
   *
   *  It outranks both sources below it: a list is the user's own answer to what
   *  this lane may play, and seeding past it would generate from material they
   *  excluded. Empty or absent ⇒ the clips, then the shelf. */
  poolIds?: (laneId: string) => string[];
```

and in `setGeneratorOn`, replace the `const shelf = ...` line with:

```ts
      const written = (d.poolIds?.(laneId) ?? []).filter((id) => id.length > 0);
      const shelf = written.length > 0 ? written
        : own.length > 0 ? own
          : (d.shelfIds?.(laneId) ?? []).filter((id) => !id.startsWith('clip:'));
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `NO_COLOR=1 npx vitest run src/app/panel-context-generator.test.ts`
Expected: PASS — 15 tests.

- [ ] **Step 5: Wire it from the host**

In `src/app/panel-context.ts`, in the `generatorMembers({...})` call, beside `shelfIds`:

```ts
      poolIds: (laneId) => deps.weave.lanes[laneId]?.pool ?? [],
```

- [ ] **Step 6: Verify**

Run: `npx tsc --noEmit && NO_COLOR=1 npx vitest run src/app/`
Expected: clean typecheck, all pass.

- [ ] **Step 7: Commit**

```bash
git add src/app/panel-context-generator.ts src/app/panel-context-generator.test.ts src/app/panel-context.ts
git commit -m "feat(generator): the list outranks the clips and the shelf"
```

---

### Task 4: The panel ABI — read and write the list

**Files:**
- Modify: `packages/loom-plugin-sdk/src/manifest.ts` (`PanelContext`, beside `setLaneWeave`)
- Modify: `src/app/panel-context.ts` (implement the two members)
- Test: `src/app/panel-context.test.ts`

**Interfaces:**
- Consumes: `LaneSelection.pool` from Task 1.
- Produces: `PanelContext.lanePool(laneId): string[]` and `PanelContext.setLanePool(laneId, ids): void`.

- [ ] **Step 1: Write the failing tests**

Add a new describe to `src/app/panel-context.test.ts`:

```ts
describe('the list a lane draws from', () => {
  it('is empty until one is written', () => {
    const h = harness();
    expect(h.ctx.lanePool('lane1')).toEqual([]);
  });

  it('round-trips what the panel writes, in order', () => {
    const h = harness();
    h.ctx.setLanePool('lane1', ['clip:clipA', 'clip:clipB']);
    expect(h.ctx.lanePool('lane1')).toEqual(['clip:clipA', 'clip:clipB']);
  });

  it('refuses an id the lane is not offered', () => {
    // The panel is a plugin: an id nobody offers would be a lane pointing at
    // material that does not exist, and it would be stored and saved.
    const h = harness();
    h.ctx.setLanePool('lane1', ['clip:clipA', 'lib:nonsense:bass:99']);
    expect(h.ctx.lanePool('lane1')).toEqual(['clip:clipA']);
  });

  it('drops duplicates, keeping the FIRST place each loop was given', () => {
    // A list is an order; the same loop twice would make "the next one"
    // ambiguous at exactly the moment the hand-over asks.
    const h = harness();
    h.ctx.setLanePool('lane1', ['clip:clipA', 'clip:clipB', 'clip:clipA']);
    expect(h.ctx.lanePool('lane1')).toEqual(['clip:clipA', 'clip:clipB']);
  });
});
```

Note for the implementer: `harness()` in that file already builds a session whose lane has clips; read the top of the file and use the clip ids it actually creates (`clipA`/`clipB` above are placeholders for whatever the fixture names them — if the fixture has one clip, add a second the same way it adds the first, or use library ids that `weaveLoopChoices` offers under the test's library).

- [ ] **Step 2: Run tests to verify they fail**

Run: `NO_COLOR=1 npx vitest run src/app/panel-context.test.ts`
Expected: FAIL — `h.ctx.lanePool is not a function`.

- [ ] **Step 3: Declare the ABI**

In `packages/loom-plugin-sdk/src/manifest.ts`, immediately after the `setLaneWeave` declaration:

```ts
  /** The loops this lane draws from, in the order they were written.
   *
   *  Empty means no list: the lane draws from the whole shelf its role allows,
   *  which is what every lane did before lists existed. */
  lanePool(laneId: string): string[];
  /** Write that list. Ids the lane is not offered are dropped, and so are
   *  duplicates — a list is an order, and the same loop twice makes "the next
   *  one" ambiguous exactly when the hand-over asks. */
  setLanePool(laneId: string, ids: string[]): void;
```

- [ ] **Step 4: Implement in the host**

In `src/app/panel-context.ts`, beside `setLaneWeave` in the returned object:

```ts
    lanePool(laneId) {
      return [...(deps.weave.lanes[laneId]?.pool ?? [])];
    },

    setLanePool(laneId, ids) {
      // Validated against what this lane is actually OFFERED, not trusted: the
      // panel is a plugin, and an id nobody offers would be saved material that
      // does not exist. Deduped keeping the first place each loop was given,
      // because the list is an order.
      const offered = new Set(weaveLoopChoices(loopContext(laneId)).map((c) => c.id));
      const seen = new Set<string>();
      const clean = ids.filter((id) => {
        if (!offered.has(id) || seen.has(id)) return false;
        seen.add(id);
        return true;
      });
      const cur = deps.weave.lanes[laneId] ?? defaultLaneSelection();
      deps.weave.lanes[laneId] = { ...cur, pool: clean };
      deps.onWeaveChanged?.(laneId);
    },
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx tsc --noEmit && NO_COLOR=1 npx vitest run src/app/panel-context.test.ts`
Expected: clean typecheck, all pass.

- [ ] **Step 6: Commit**

```bash
git add packages/loom-plugin-sdk/src/manifest.ts src/app/panel-context.ts src/app/panel-context.test.ts
git commit -m "feat(sdk): a lane's loop list, read and written by the panel"
```

---

### Task 5: The editor on the lane row

**Files:**
- Modify: `plugins/weave/lane-row.ts` (build the list, append it to the `weave-lane-setup` line around line 900)
- Modify: `src/styles/_weave.scss` (the list's own styles, beside `.weave-lane-setup`)

**Interfaces:**
- Consumes: `ctx.lanePool` / `ctx.setLanePool` from Task 4, and `weaveLoopChoices`'s output as already handed to the row as `loops: PanelChoice[]`.
- Produces: nothing other tasks read.

- [ ] **Step 1: Build the list control**

In `plugins/weave/lane-row.ts`, add this function beside `weaveCell`:

```ts
/** The loops this lane draws from, in order — the list itself, editable.
 *
 *  Buttons and not drag-and-drop: every write ends in `refresh()`, which
 *  remounts the panel, so a drag would die on its second event. That has
 *  shipped as a bug twice.
 *
 *  Empty is a real state and says so: a lane with no list draws from the whole
 *  shelf, which is what every lane did before lists existed. */
function poolEditor(
  laneId: string, ctx: PanelContext, loops: PanelChoice[], onChanged: () => void,
): HTMLElement {
  const wrap = el('div', 'weave-pool');
  const ids = ctx.lanePool(laneId);
  const nameOf = (id: string) => loops.find((l) => l.id === id)?.name ?? id;

  const write = (next: string[]) => { ctx.setLanePool(laneId, next); onChanged(); };

  if (ids.length === 0) {
    wrap.appendChild(el('span', 'weave-pool-empty', 'Draws from everything'));
  }

  ids.forEach((id, i) => {
    const row = el('span', 'weave-pool-item');
    row.appendChild(el('span', 'weave-pool-name', `${i + 1}. ${nameOf(id)}`));
    const btn = (cls: string, text: string, title: string, on: () => void) => {
      const b = el('button', `weave-pool-btn ${cls}`, text) as HTMLButtonElement;
      b.type = 'button';
      b.title = title;
      b.addEventListener('click', on);
      row.appendChild(b);
    };
    if (i > 0) {
      btn('up', '↑', 'Play this one earlier', () => {
        const next = [...ids];
        [next[i - 1], next[i]] = [next[i], next[i - 1]];
        write(next);
      });
    }
    if (i < ids.length - 1) {
      btn('down', '↓', 'Play this one later', () => {
        const next = [...ids];
        [next[i], next[i + 1]] = [next[i + 1], next[i]];
        write(next);
      });
    }
    btn('kill', '✕', 'Take it out of the list', () => {
      write(ids.filter((_, k) => k !== i));
    });
    wrap.appendChild(row);
  });

  // Adding is the same picker the cell's slots use, so the list can only ever
  // name material the lane is actually offered.
  const add = picker('weave-pool-add', 'Add a loop to this list', loops, '', (id) => {
    write([...ids, id]);
  });
  wrap.appendChild(add);
  return wrap;
}
```

- [ ] **Step 2: Put it on the row**

In the same file, in the `setup` line assembly (the `weave-lane-setup` block around line 900), append the editor after the existing setup controls:

```ts
  setup.appendChild(poolEditor(lane.id, ctx, loops, () => { ctx.refresh?.(); }));
```

If the row's other setup controls call a local `onChanged`, use that instead of `ctx.refresh?.()` — read the neighbouring appends and follow whatever they do, since the list must redraw the same way they do.

- [ ] **Step 3: Style it**

In `src/styles/_weave.scss`, beside the other `.weave-lane-setup` rules:

```scss
// The list a lane draws from: its entries in order, then the picker that adds
// to it. Wraps rather than scrolling — a list long enough to need a scrollbar
// is a list you can no longer read at a glance, and the row is allowed to grow.
.weave-pool {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px;
}

.weave-pool-empty {
  color: var(--text-dim, #9a9aa2);
  font-size: 10px;
  font-style: italic;
}

.weave-pool-item {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  background: var(--surface-2);
  border: 1px solid var(--border);
  border-radius: 3px;
  padding: 1px 4px;
  font-size: 10px;
}

.weave-pool-name { max-width: 14ch; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

.weave-pool-btn {
  background: transparent;
  border: 0;
  color: var(--text-dim, #9a9aa2);
  cursor: pointer;
  padding: 0 2px;
  font-size: 10px;

  &:hover { color: var(--amber); }
}
```

- [ ] **Step 4: Build the plugin and look at it**

Run: `npm run build:plugins`
Then run the dev server in this worktree (`npx vite --port 5182 --strictPort`), open it, and **reload the page fully** — the panel never hot-reloads.

Check, in this order:
1. A weaving lane shows "Draws from everything" and a picker.
2. Adding three loops lists them `1. … 2. … 3. …` in the order added.
3. ↑ and ↓ move one entry and the numbers follow.
4. ✕ removes the right one.
5. **Reload the page**: the list is still there. It is saved state, and this is the only step that proves it.

- [ ] **Step 5: Verify nothing else broke**

Run: `npx tsc --noEmit && NO_COLOR=1 npm run test:unit`
Expected: clean typecheck; 586+ files pass.

- [ ] **Step 6: Commit**

```bash
git add plugins/weave/lane-row.ts src/styles/_weave.scss public/plugins/weave/main.js public/plugins/weave/plugin.json
git commit -m "feat(weave): the editor for the list a lane draws from"
```

---

## Self-review

- **Spec coverage**: state (Task 1), A→B (Task 2), generator (Task 3), ABI (Task 4), editor (Task 5), negative controls in Tasks 2 and 3. The spec's two named risks are handled: a pool of one holds the lane (Task 2, tested), and ids that no longer exist are dropped on write (Task 4, tested) — a clip deleted AFTER the list was written still leaves a stale id, which the hand-over survives because `nextFromPool` returns the head for an unknown `leaving`, and the resolver already answers "no notes" for an id that names nothing.
- **Types**: `pool?: string[]` on the state; `readonly string[]` where it is only read (`nextFromPool`, `rehookOnArrival`); `string[]` across the ABI, because a plugin cannot be handed a frozen array it may want to copy.
- **Not covered, by design**: no scene-level list, no styles, QUEUE stays retired, cloud keeps its own draw.
