# WEAVE Evolution Switch + Debts — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Separate WEAVE's two jobs — arranging by hand and letting it run — behind one on-screen switch, and clear the four debts around it.

**Architecture:** The fold that turns position 1 back into 0 stops being unconditional and becomes a property of EVOLVE. `applyFlow` grows one boolean and `flowPositions` clamps instead of wrapping when it is off; the panel's gesture and the host's clock finally call the same writer with the same arity. On top of that: the re-hook pool learns to advance a lane's clips in order, the lane row gets the clip editor's own ×2/÷2, and modulator depth becomes a real automation destination so Motion has somewhere to land.

**Tech Stack:** TypeScript, Vite, Vitest, Web Audio + AudioWorklet. The panel is an external plugin (`plugins/weave/`) talking to the host through `@loom/plugin-sdk`.

## Global Constraints

- **UI text, labels, comments and commit messages in ENGLISH.** No exceptions.
- **File size:** target 300 lines of code, hard cap 500. Comments and blanks do not count.
- **Never add `engineId === '…'` to the core.** Ask [src/plugins/capabilities.ts](../../../src/plugins/capabilities.ts).
- **Anything listing automatable params** goes through `DestinationRegistry.list()` — never a parallel list.
- **A plugin change is invisible until `npm run build:plugins` runs.** The app loads `public/plugins/`, not `plugins/`.
- **Tests assert RELATIVE**: ratios, never absolute magnitudes.
- **Colour-free test output:** `NO_COLOR=1 npx vitest run <file>`, or the npm scripts, which already set it.
- Work happens in the worktree `.claude/worktrees/weave-dynamic-panel` on branch `worktree-weave-dynamic-panel`. Rebase onto `main` after most commits.

## File Structure

| File | Responsibility | Change |
|---|---|---|
| `src/weave/flow.ts` | pure position arithmetic | `flowPositions`/`applyFlow` gain `wrap` |
| `src/weave/weave-state.ts` | the saved shape | `FlowState.evolve` |
| `src/app/panel-context.ts` | the panel's one door | `setFlow` takes and forwards `evolve` |
| `src/app/weave-wiring.ts` | clock side | passes `evolve` to `applyFlow`, re-hook only when on |
| `src/app/weave-loops.ts` | loop ids → notes, and the re-hook | clips in order, library shuffled |
| `packages/loom-plugin-sdk/src/manifest.ts` | the ABI | `PanelFlow.evolve`, `setFlow` signature, `setClipLength` |
| `plugins/weave/main.ts` | the flow row | the EVOLVE switch |
| `plugins/weave/lane-row.ts` | one lane | the ×2 / ÷2 buttons |
| `src/automation/automation-targets.ts` | the catalogue | emits modulator depths |
| `src/automation/automation-apply.ts` | the apply | a `modDepth` branch |

---

### Task 1: The hand stops at the end

**Files:**
- Modify: `src/weave/flow.ts`
- Test: `src/weave/flow.test.ts`

**Interfaces:**
- Produces: `flowPositions(flow, laneCount, drift, current?, wrap?)` and
  `applyFlow(lanes, laneIds, flow, drift, base?, onWrap?, wrap?)`, both with
  `wrap` defaulting to `true` so every existing caller is unchanged.

- [ ] **Step 1: Write the failing tests**

Append to `src/weave/flow.test.ts`:

```ts
describe('with wrapping off, the journey has ends', () => {
  it('stops at 1 instead of folding back to 0', () => {
    expect(flowPositions(1, 2, 'together', [], false)).toEqual([1, 1]);
  });

  it('still folds when wrapping is on — that is what a lap is', () => {
    expect(flowPositions(1, 2, 'together')).toEqual([0, 0]);
  });

  it('clamps below zero too', () => {
    expect(flowPositions(-0.25, 1, 'together', [], false)).toEqual([0]);
  });

  it('offset still fans, but each lane stops at its own end', () => {
    // Two lanes half a lap apart: at flow 0.75 the second would be at 1.25.
    const out = flowPositions(0.75, 2, 'offset', [], false);
    expect(out[0]).toBeCloseTo(0.75, 6);
    expect(out[1]).toBe(1);
  });

  it("free counts from the base and stops there too", () => {
    expect(flowPositions(0.5, 1, 'free', [0.8], false)).toEqual([1]);
  });

  it('applyFlow leaves a lane parked at the end without calling onWrap', () => {
    const lanes: Record<string, { weave: { x: number } }> = {
      l1: { weave: { x: 0.99 } },
    };
    const wrapped: string[] = [];
    applyFlow(lanes, ['l1'], 1, 'together', undefined, (id) => wrapped.push(id), false);
    expect(lanes.l1.weave.x).toBe(1);
    expect(wrapped).toEqual([]);
  });
});
```

- [ ] **Step 2: Run them and watch them fail**

Run: `NO_COLOR=1 npx vitest run src/weave/flow.test.ts`
Expected: FAIL — `flowPositions` ignores the fifth argument, so the first case
returns `[0, 0]`.

- [ ] **Step 3: Implement**

In `src/weave/flow.ts`, add beside `wrap01`:

```ts
/** Hold a position inside 0..1 by STOPPING at the ends.
 *
 *  The counterpart of `wrap01`, and the difference between the panel's two
 *  jobs. A lap that never ends folds; a fader a hand is holding has to have a
 *  far end, or dragging it all the way over lands you back where you started —
 *  which is the bug this pair exists to fix. */
const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
```

Change `flowPositions` to take the flag and pick the fold:

```ts
export function flowPositions(
  flow: number, laneCount: number, drift: DriftMode, current: readonly number[] = [],
  /** True — the default — folds 1 back to 0, which is what a lap does. False
   *  stops at the ends, which is what a hand on the fader means. */
  wrap = true,
): number[] {
  if (laneCount <= 0) return [];
  const fold = wrap ? wrap01 : clamp01;
  const f = fold(flow);

  if (drift === 'together') return Array.from({ length: laneCount }, () => f);

  if (drift === 'offset') {
    const span = laneCount === 1 ? 0 : 1 / laneCount;
    return Array.from({ length: laneCount }, (_, i) => fold(f + i * span));
  }

  return Array.from({ length: laneCount }, (_, i) => fold((current[i] ?? 0) + f));
}
```

And thread it through `applyFlow`:

```ts
export function applyFlow(
  lanes: Record<string, { weave?: PositionedWeave | null; locked?: boolean } | undefined>,
  laneIds: readonly string[],
  flow: number,
  drift: DriftMode,
  base?: ReadonlyMap<string, number>,
  onWrap?: (laneId: string) => void,
  /** See flowPositions. With wrapping off no lane can ever wrap, so `onWrap`
   *  cannot fire — which is exactly what STATIC means. */
  wrap = true,
): boolean {
```

and inside, `const next = flowPositions(flow, laneIds.length, drift, current, wrap);`.

- [ ] **Step 4: Run the tests**

Run: `NO_COLOR=1 npx vitest run src/weave/flow.test.ts`
Expected: PASS, including every pre-existing case — the defaults keep the old
behaviour.

- [ ] **Step 5: Commit**

```bash
git add src/weave/flow.ts src/weave/flow.test.ts
git commit -m "feat(weave): a flow that can have ends, not only laps"
```

---

### Task 2: EVOLVE in the state and across the ABI

**Files:**
- Modify: `src/weave/weave-state.ts`, `src/app/panel-context.ts`, `src/app/weave-wiring.ts`, `packages/loom-plugin-sdk/src/manifest.ts`
- Test: `src/weave/weave-state.test.ts`, `src/app/panel-context.test.ts`

**Interfaces:**
- Consumes: `applyFlow(..., wrap)` from Task 1.
- Produces: `FlowState.evolve?: boolean`; `PanelFlow.evolve: boolean`;
  `setFlow(position: number, drift: string, speedBars: number, evolve: boolean)`.

- [ ] **Step 1: Write the failing tests**

In `src/weave/weave-state.test.ts`:

```ts
it('a fresh weave does not evolve — the pair you choose is the pair you keep', () => {
  expect(defaultWeaveState().flow.evolve).toBe(false);
});
```

In `src/app/panel-context.test.ts`:

```ts
it('setFlow carries the evolve flag into the state', () => {
  const h = harness();
  h.ctx.setFlow(0.5, 'together', 0, true);
  expect(h.weave.flow.evolve).toBe(true);
  expect(h.ctx.flow().evolve).toBe(true);
});

it('STATIC parks a lane at the end instead of sending it back to the start', () => {
  const h = harness();
  const id = h.ctx.addLane('subtractive');
  h.ctx.setFlow(1, 'together', 0, false);
  expect(h.weave.lanes[id].weave.x).toBe(1);
});

it('EVOLVE wraps, which is what lets a lane hand over', () => {
  const h = harness();
  const id = h.ctx.addLane('subtractive');
  h.ctx.setFlow(1, 'together', 0, true);
  expect(h.weave.lanes[id].weave.x).toBe(0);
});
```

- [ ] **Step 2: Run them and watch them fail**

Run: `NO_COLOR=1 npx vitest run src/weave/weave-state.test.ts src/app/panel-context.test.ts`
Expected: FAIL — `setFlow` takes three arguments and `evolve` does not exist.

- [ ] **Step 3: Implement**

`src/weave/weave-state.ts` — add to `FlowState` and its default:

```ts
export interface FlowState {
  drift: DriftMode;
  speedBars: number;
  base?: Record<string, number>;
  /** OFF by default. On, arriving at the far end is a handover: the loop on the
   *  right becomes the left and new material arrives. Off, the pair you chose is
   *  the pair you keep and the fader simply has two ends. */
  evolve?: boolean;
}
```

and in `defaultWeaveState()`: `flow: { drift: 'together', speedBars: 0, evolve: false },`.

`packages/loom-plugin-sdk/src/manifest.ts`:

```ts
export interface PanelFlow {
  position: number;
  drift: string;
  speedBars: number;
  /** Whether arriving at the far end hands over to new material. */
  evolve: boolean;
}
```

```ts
  setFlow(position: number, drift: string, speedBars: number, evolve: boolean): void;
```

`src/app/panel-context.ts` — `setFlow` keeps its shape and gains the flag:

```ts
    setFlow(position, drift, speedBars, evolve) {
      const mode = asDrift(drift);
      const was = deps.weave.flow;
      const evolving = !!evolve;

      const base = mode !== 'free' ? undefined
        : was?.drift === 'free' && was.base ? was.base
          : Object.fromEntries(deps.sessionHost.state.lanes.map((l) =>
            [l.id, positionOf(deps.weave.lanes[l.id]?.weave)]));

      deps.weave.flow = {
        drift: mode, speedBars: Math.max(0, speedBars || 0), base, evolve: evolving,
      };
      applyFlow(
        deps.weave.lanes,
        deps.sessionHost.state.lanes.map((l) => l.id),
        position,
        mode,
        base && new Map(Object.entries(base)),
        undefined,
        evolving,
      );
      deps.onWeaveChanged?.('*');
    },
```

and `flow()` returns `evolve: !!deps.weave.flow?.evolve` alongside what it
already returns.

`src/app/weave-wiring.ts` — in `advance`, pass the same flag as the last
argument of its `applyFlow` call, and only hand it a re-hook when evolving:

```ts
      const evolving = !!state.flow?.evolve;
      const moved = applyFlow(
        state.lanes, laneIds, pos, state.flow.drift,
        base,
        evolving ? rehook : undefined,
        evolving,
      );
```

- [ ] **Step 4: Run the tests**

Run: `NO_COLOR=1 npx vitest run src/weave/weave-state.test.ts src/app/panel-context.test.ts src/app/weave-wiring.test.ts`
Expected: PASS. Fix any call site the compiler flags: `npx tsc --noEmit`.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(weave): EVOLVE as state, off by default, across the ABI"
```

---

### Task 3: The switch on screen

**Files:**
- Modify: `plugins/weave/main.ts`, `src/styles/_weave.scss`

**Interfaces:**
- Consumes: `ctx.flow().evolve` and the four-argument `ctx.setFlow` from Task 2.

- [ ] **Step 1: Add the control**

In `plugins/weave/main.ts`, in the master-flow block, after `speed` is built:

```ts
  // Two jobs, one switch. STATIC is a scene you place by hand and it stays
  // placed; EVOLVE is a scene that keeps finding new material. Default is
  // STATIC because a panel that reshuffles a session nobody touched is the
  // thing this whole feature has to not do.
  const evolve = document.createElement('button');
  evolve.className = 'weave-evolve';
  evolve.id = 'weave-evolve';
  const paintEvolve = () => {
    const on = !!ctx.flow().evolve;
    evolve.dataset.on = on ? '1' : '';
    evolve.textContent = on ? '∞ EVOLVE' : '⏸ STATIC';
    evolve.title = on
      ? 'Arriving at the far end hands over: clips advance in order, library loops are drawn at random.'
      : 'The pair you chose is the pair you keep. The fader has two ends.';
  };
  paintEvolve();
  evolve.addEventListener('click', () => {
    ctx.setFlow(Number(flow.value), drift.value, Number(speed.value), !ctx.flow().evolve);
    paintEvolve();
  });
```

Change `pushFlow` to carry the current flag, and append the button to the row:

```ts
  const pushFlow = () => {
    ctx.setFlow(Number(flow.value), drift.value, Number(speed.value), !!ctx.flow().evolve);
    flow.disabled = Number(speed.value) > 0;
    showFlow();
  };
```

```ts
  flowRow.append(flowLabel, flow, flowOut, driftLabel, drift, speedLabel, speed, evolve);
```

- [ ] **Step 2: Style it**

In `src/styles/_weave.scss`, beside the other flow-row controls:

```scss
.weave-evolve {
  font: inherit;
  padding: 0.15rem 0.6rem;
  border: 1px solid var(--line);
  border-radius: 3px;
  background: transparent;
  color: var(--dim);
  cursor: pointer;
  white-space: nowrap;

  &[data-on='1'] {
    color: var(--accent);
    border-color: var(--accent);
  }
}
```

- [ ] **Step 3: Build the plugin and look at it**

Run: `npm run build:plugins`
Then reload <http://localhost:5173>, open WEAVE, and confirm the button reads
`⏸ STATIC`, turns into `∞ EVOLVE` when clicked, and survives a panel repaint
(switch to Session and back).

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat(weave): the switch that says whether the scene evolves"
```

---

### Task 4: Clips advance in order, the library is drawn

**Files:**
- Modify: `src/app/weave-loops.ts`
- Test: `src/app/weave-loops.test.ts`

**Interfaces:**
- Produces: `rehookOnArrival(sel, c, seed, laneId)` unchanged in signature; only
  what it draws from changes.

- [ ] **Step 1: Write the failing tests**

Append to `src/app/weave-loops.test.ts`:

```ts
describe('what a lane hands over TO', () => {
  const note = { start: 0, duration: 24, midi: 40, velocity: 100 };
  const laneWith = (ids: string[]) => ({
    id: 'l1', engineId: 'subtractive', name: 'l1', inserts: [],
    clips: ids.map((id) => ({ id, name: id, notes: [note] })),
  }) as unknown as SessionLane;

  const ctxFor = (lane: SessionLane) => weaveLoopContext(
    lane, { ...DEFAULT_MUSICALITY, lock: false }, undefined,
    { styleMix: 0, darkness: 0.5, laneIndex: 0, seed: 1 },
  );

  it('advances to the NEXT clip, in order', () => {
    const c = ctxFor(laneWith(['c1', 'c2', 'c3']));
    const next = rehookOnArrival(
      { kind: 'ab', a: 'clip:c1', b: 'clip:c2', x: 1 } as never, c, 1, 'l1',
    );
    expect(next).toMatchObject({ a: 'clip:c2', b: 'clip:c3' });
  });

  it('wraps round to the first clip rather than running out', () => {
    const c = ctxFor(laneWith(['c1', 'c2', 'c3']));
    const next = rehookOnArrival(
      { kind: 'ab', a: 'clip:c2', b: 'clip:c3', x: 1 } as never, c, 1, 'l1',
    );
    expect(next).toMatchObject({ a: 'clip:c3', b: 'clip:c1' });
  });

  it('skips an EMPTY clip — the carrier a weaving track is born with', () => {
    const lane = laneWith(['c1', 'c2', 'c3']);
    (lane.clips[1] as { notes: unknown[] }).notes = [];
    const c = ctxFor(lane);
    const next = rehookOnArrival(
      { kind: 'ab', a: 'clip:c3', b: 'clip:c1', x: 1 } as never, c, 1, 'l1',
    );
    expect(next).toMatchObject({ a: 'clip:c1', b: 'clip:c3' });
  });

  it('falls through to the library when the lane has nowhere else to go', () => {
    const c = ctxFor(laneWith(['c1']));
    const next = rehookOnArrival(
      { kind: 'ab', a: 'clip:c1', b: 'clip:c1', x: 1 } as never, c, 1, 'l1',
    );
    expect(next!.b.startsWith('lib:')).toBe(true);
  });

  it('a library loop still draws at random, never the one just left', () => {
    const c = ctxFor(laneWith([]));
    const next = rehookOnArrival(
      { kind: 'ab', a: `lib:${STYLE}:bass:0`, b: `lib:${STYLE}:bass:0`, x: 1 } as never,
      c, 1, 'l1',
    );
    expect(next).toBeNull();   // one-pattern library: nowhere else to go
  });
});
```

Import `rehookOnArrival` at the top of the file alongside the others.

- [ ] **Step 2: Run them and watch them fail**

Run: `NO_COLOR=1 npx vitest run src/app/weave-loops.test.ts`
Expected: FAIL — the pool is `filter(id => id.startsWith('lib:'))`, so the first
case draws a library pattern instead of `clip:c2`.

- [ ] **Step 3: Implement**

Replace the pool in `rehookOnArrival`:

```ts
  // A lane's CLIPS are an arrangement: they advance in order, and shuffling
  // them would not be evolution, it would be noise. Only the library is drawn.
  //
  // EMPTY clips are skipped rather than the whole clip family being excluded,
  // which is what this did before: a weaving track is born with an empty
  // carrier clip, and landing the journey on it is silence with no way to tell
  // why. Skipping only the empty ones keeps the useful ones in.
  const choices = weaveLoopChoices(c);
  const clipIds = (c.lane?.clips ?? [])
    .filter((cl) => cl && cl.notes.length > 0)
    .map((cl) => formatLoopId({ source: 'clip', clipId: cl!.id }));

  const arrived = sel.b;
  const atClip = clipIds.indexOf(arrived);
  if (atClip >= 0 && clipIds.length > 1) {
    const next = clipIds[(atClip + 1) % clipIds.length];
    return { ...sel, a: arrived, b: next };
  }

  const pool = choices.map((ch) => ch.id).filter((id) => id.startsWith('lib:'));
  if (pool.length === 0) return null;
```

and leave the hashed `pick` and the `abAdvance` call below exactly as they are.

- [ ] **Step 4: Run the tests**

Run: `NO_COLOR=1 npx vitest run src/app/weave-loops.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/app/weave-loops.ts src/app/weave-loops.test.ts
git commit -m "feat(weave): clips hand over in order, only the library is drawn"
```

---

### Task 5: ×2 and ÷2 on a WEAVE lane

**Files:**
- Modify: `packages/loom-plugin-sdk/src/manifest.ts`, `src/app/panel-context.ts`, `plugins/weave/lane-row.ts`
- Test: `src/app/panel-context.test.ts`

**Interfaces:**
- Produces: `PanelContext.setClipLength(laneId: string, factor: number): void`.

- [ ] **Step 1: Write the failing test**

In `src/app/panel-context.test.ts`:

```ts
describe('clip length from the panel', () => {
  it('doubles the lane clip, repeating the bar rather than stretching it', () => {
    const h = harness();
    const id = h.ctx.addLane('subtractive');
    const clip = h.host.state.lanes.find((l) => l.id === id)!.clips[0]!;
    clip.notes = [{ start: 0, duration: 24, midi: 40, velocity: 100 }];
    const bars = clip.lengthBars;

    h.ctx.setClipLength(id, 2);

    expect(clip.lengthBars).toBe(bars * 2);
    expect(clip.notes).toHaveLength(2);
    expect(clip.notes[1].duration).toBe(24);   // repeated, not stretched
  });

  it('halves it back', () => {
    const h = harness();
    const id = h.ctx.addLane('subtractive');
    const clip = h.host.state.lanes.find((l) => l.id === id)!.clips[0]!;
    const bars = clip.lengthBars;
    h.ctx.setClipLength(id, 2);
    h.ctx.setClipLength(id, 0.5);
    expect(clip.lengthBars).toBe(bars);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `NO_COLOR=1 npx vitest run src/app/panel-context.test.ts`
Expected: FAIL — `setClipLength` is not a function.

- [ ] **Step 3: Implement**

`packages/loom-plugin-sdk/src/manifest.ts`, on `PanelContext`:

```ts
  /** Grow or shrink a lane's carrier clip by `factor` (2 doubles, 0.5 halves),
   *  REPEATING the bar rather than stretching it — the same operation the clip
   *  editor's ×2 performs, through the same host function. */
  setClipLength(laneId: string, factor: number): void;
```

`src/app/panel-context.ts` — import and add the method:

```ts
import { applyClipLength } from '../core/clip-time-scale';
```

```ts
    setClipLength(laneId, factor) {
      // The clip editor's own operation, not a second one: applyClipLength
      // keeps the bar count, the loop region and the automation curves in step
      // with the notes. Building this on the pure note maths alone is how a
      // clip ends up with automation that no longer lines up.
      const lane = deps.sessionHost.state.lanes.find((l) => l.id === laneId);
      const clip = lane?.clips.find((c) => c);
      if (!clip) return;
      applyClipLength(clip, factor, 'repeat', ticksPerBar(deps.seq.meter));
      deps.onWeaveChanged?.(laneId);
      deps.refresh();
    },
```

`plugins/weave/lane-row.ts` — two buttons beside the lane's topology group:

```ts
  const half = document.createElement('button');
  half.className = 'weave-len';
  half.textContent = '÷2';
  half.title = 'Halve this lane clip';
  half.addEventListener('click', () => ctx.setClipLength(lane.id, 0.5));

  const twice = document.createElement('button');
  twice.className = 'weave-len';
  twice.textContent = '×2';
  twice.title = 'Double this lane clip, repeating the bar';
  twice.addEventListener('click', () => ctx.setClipLength(lane.id, 2));
```

and append them where the row builds its controls, next to the topology
buttons.

- [ ] **Step 4: Run the tests, typecheck, build the plugin**

```bash
NO_COLOR=1 npx vitest run src/app/panel-context.test.ts
npx tsc --noEmit
npm run build:plugins
```
Expected: PASS, clean, and the buttons appear on each lane row.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(weave): the clip editor's x2 and /2, on the lane row"
```

---

### Task 6: A modulator's depth becomes an automation destination

**Files:**
- Modify: `src/automation/automation-targets.ts`, `src/automation/automation-apply.ts`
- Test: `src/automation/automation-targets.test.ts`, `src/automation/automation-apply.test.ts`

**Interfaces:**
- Produces: destination ids shaped `<laneId>.mod.<modId>.conn.<connId>.depth`,
  range −1..1, and a `ParsedParamId` of `kind: 'modDepth'` carrying `modId`,
  `connId`.

- [ ] **Step 1: Write the failing tests**

In `src/automation/automation-targets.test.ts`:

```ts
it('lists every modulator connection depth the session holds', () => {
  const state = sessionWithLaneModulators('L1', [
    { id: 'lfo1', connections: [{ id: 'c1', paramId: 'filter.cutoff', depth: 0.5 }] },
  ]);
  const ids = listAutomationTargets(state, new Map()).map((t) => t.id);
  expect(ids).toContain('L1.mod.lfo1.conn.c1.depth');
});

it('a depth swings both ways — its range is bipolar', () => {
  const state = sessionWithLaneModulators('L1', [
    { id: 'lfo1', connections: [{ id: 'c1', paramId: 'filter.cutoff', depth: 0.5 }] },
  ]);
  const t = listAutomationTargets(state, new Map()).find((x) => x.id.endsWith('.depth'))!;
  expect(t.min).toBe(-1);
  expect(t.max).toBe(1);
});
```

In `src/automation/automation-apply.test.ts`:

```ts
it('a depth write reaches the modulation host, not the engine', () => {
  const set = vi.fn();
  const engine = { setBaseValue: vi.fn(), modHost: { setConnection: set,
    modulators: [{ id: 'lfo1', connections: [{ id: 'c1', paramId: 'filter.cutoff', depth: 0 }] }] } };
  const ok = applyAutomationToSession('L1.mod.lfo1.conn.c1.depth', 0.75, {
    getInsertFx: () => undefined,
    getEngine: () => engine as never,
    getRange: () => ({ min: -1, max: 1 }),
  });
  expect(ok).toBe(true);
  expect(engine.setBaseValue).not.toHaveBeenCalled();
  expect(set).toHaveBeenCalledWith('lfo1', expect.objectContaining({ id: 'c1', depth: 0.5 }));
});
```

Add the `sessionWithLaneModulators` helper to the targets test file:

```ts
function sessionWithLaneModulators(laneId: string, mods: unknown[]) {
  return {
    lanes: [{ id: laneId, name: laneId, engineId: 'subtractive', clips: [], inserts: [],
      engineState: { modulators: mods } }],
    scenes: [], masterInserts: [], sends: [],
  } as unknown as SessionState;
}
```

- [ ] **Step 2: Run them and watch them fail**

Run: `NO_COLOR=1 npx vitest run src/automation/automation-targets.test.ts src/automation/automation-apply.test.ts`
Expected: FAIL — no such id is emitted, and the apply falls through to
`setBaseValue`.

- [ ] **Step 3: Implement the catalogue entries**

In `src/automation/automation-targets.ts`, inside the per-lane loop, after the
engine params and before the inserts:

```ts
    // A modulator's DEPTH is an automatable value like any other, and until now
    // it was the one the catalogue did not offer — which is why WEAVE's Motion
    // macro, which addresses destinations ending in `.depth`, wrote to nothing
    // at all. The id is the one the modulation panel's own knob already
    // registers, so a mounted knob and an automation lane address the same
    // thing.
    for (const mod of lane.engineState?.modulators ?? []) {
      for (const conn of mod.connections ?? []) {
        push(
          `${lane.id}.mod.${mod.id}.conn.${conn.id}.depth`,
          `${mod.id} → ${conn.paramId}`,
          -1, 1,
          { key: `mod:${mod.id}`, label: mod.id.toUpperCase() },
        );
      }
    }
```

- [ ] **Step 4: Implement the parse and the apply**

In `src/automation/automation-apply.ts`, extend `ParsedParamId` with

```ts
  | { scopeId: string; kind: 'modDepth'; modId: string; connId: string }
```

and match it in `parseAutomationParamId` BEFORE the insert test, since a
modulator id can contain anything:

```ts
  // `<lane>.mod.<modId>.conn.<connId>.depth` — matched on its two literal
  // markers rather than by counting dots, so an id with dots in it still parses.
  const mod = /^(.+)\.mod\.([^.]+)\.conn\.([^.]+)\.depth$/.exec(id);
  if (mod) {
    return { scopeId: mod[1], kind: 'modDepth', modId: mod[2], connId: mod[3] };
  }
```

and in `applyAutomationToSession`, before the insert/engine split:

```ts
  if (parsed.kind === 'modDepth') {
    const engine = deps.getEngine(parsed.scopeId) as
      { modHost?: { modulators: { id: string; connections: { id: string }[] }[];
                    setConnection(modId: string, conn: unknown): void } } | undefined;
    const host = engine?.modHost;
    if (!host) return false;
    const range = deps.getRange(id);
    if (!range) return false;
    const mod = host.modulators.find((m) => m.id === parsed.modId);
    const conn = mod?.connections.find((c) => c.id === parsed.connId);
    if (!conn) return false;
    host.setConnection(parsed.modId, {
      ...conn, depth: range.min + normalised * (range.max - range.min),
    });
    return true;
  }
```

- [ ] **Step 5: Run the tests and the whole automation folder**

Run: `NO_COLOR=1 npx vitest run src/automation/ src/weave/macro-params.test.ts src/app/weave-param-macros.test.ts`
Expected: PASS.

- [ ] **Step 6: Hear it**

With the dev server running, open WEAVE on a session whose lanes carry an LFO,
move **Motion** off zero, and confirm the modulation panel's own depth knob for
that connection moves with it.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat(automation): a modulator depth is a destination, and Motion lands"
```

---

### Task 7: Establish whether SOLO is broken

**Files:**
- Test: `src/core/mute-solo.test.ts` (or wherever `applyMuteSolo` is covered)

**Interfaces:**
- Consumes: `src/app/mute-solo.ts`.

- [ ] **Step 1: Write the test that states the expectation**

```ts
it('soloing one lane leaves THAT lane audible', () => {
  const gains = { l1: 1, l2: 1, l3: 1 };
  applyMuteSoloTo(gains, { mute: {}, solo: { l2: true } });
  expect(gains.l2).toBeGreaterThan(0);
  expect(gains.l1).toBe(0);
  expect(gains.l3).toBe(0);
});
```

Adapt the call to the real signature in `src/app/mute-solo.ts` — read it first
and mirror it exactly rather than inventing one.

- [ ] **Step 2: Run it**

Run: `NO_COLOR=1 npx vitest run src/app/mute-solo.test.ts`

**If it PASSES:** the unit is fine and the silence was elsewhere — most likely
the panel's S button writing a different table from the mixer's. Go on to step 3.
**If it FAILS:** the bug is real and here. Fix it, keep the test, commit, and
skip step 3.

- [ ] **Step 3: Measure it in the browser**

With a scene playing, install the master tap (see CLAUDE.md, "Objective audio
measurement"), read RMS, click one lane's **S**, read RMS again.

Expected: non-zero both times, and the second lower than the first.
If the second is 0.0000, the break is between the button and the desk, not in the
maths — inspect which table the panel's S writes.

- [ ] **Step 4: Commit whatever the answer was**

```bash
git add -A
git commit -m "test(mixer): pin that solo leaves the soloed lane audible"
```

---

### Task 8: One fix for short loops, not two

**Files:**
- Modify: `src/weave/blend-clip.ts`, `src/weave/blend-clip.test.ts`, `src/weave/weave-runtime.ts`, `src/app/weave-wiring.ts`
- Restore: the stashed `clipBars` change

**Interfaces:**
- Produces: `WeaveLoopContext.clipBars?: number`, `WeaveLoopContext.barTicks?: number`.

- [ ] **Step 1: Take the stashed fix back out**

```bash
git stash list          # expect: "real fix: pass clipBars into patternNotes"
git stash pop
```

This adds `clipBars`/`barTicks` to `WeaveLoopContext`, passes them into
`patternNotes` from `weaveLoopNotes`, and fills them in from the lane's playing
clip in both `weave-wiring.ts` and `panel-context.ts`.

- [ ] **Step 2: Remove the duplicate**

Revert the tiling added to `blendLoops`: delete `tileNotesToFill`,
`loopSpanTicks` and `BlendOptions.fillTicks` from `src/weave/blend-clip.ts`,
delete the `describe('a loop shorter than the clip repeats to fill it')` block
from `src/weave/blend-clip.test.ts`, and drop `readFillTicks` from
`createWeaveSource` in `src/weave/weave-runtime.ts` along with its call site in
`weave-wiring.ts`.

Why this one goes: `patternNotes` has taken `clipBars` since it was written and
its own doc names this exact failure, so the tiling in the blend is a second
implementation of a solved problem. It is also subtly wrong — it infers a loop's
length from where its notes fall, so a two-bar clip that deliberately has notes
only in its first bar gets duplicated.

- [ ] **Step 3: Prove the behaviour survived the swap**

Run: `NO_COLOR=1 npx vitest run src/app/weave-loops.test.ts src/weave/`
Expected: PASS, with the `describe('a drawn loop fills the clip it is going into')`
cases from the stash green.

- [ ] **Step 4: Typecheck and run everything**

```bash
npx tsc --noEmit
npm run test:unit
```

Note: `plugins/bitcrusher` is flaky in the full run and passes on its own —
re-run it alone to confirm rather than treating it as a regression.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "refactor(weave): one answer for a loop shorter than its clip"
```

---

### Task 9: Hear the whole thing

**Files:** none — this is the acceptance pass.

- [ ] **Step 1: Build and serve**

```bash
npm run build:plugins
npm run dev
```

- [ ] **Step 2: The user's own script**

Load the Minimal Techno demo. On the first three lanes set A = Clip 1, B = Clip 2.
Leave the switch on **STATIC**.

1. Master fader hard LEFT, press play. Note master peak and RMS.
2. Stop WEAVE, launch scene 1. The two readings should match within a few
   percent, and it should sound the same.
3. Master fader hard RIGHT. It must READ 1.00 on every lane and stay there.
   Compare against scene 2 the same way.

- [ ] **Step 3: The evolve pass**

Turn the switch to **∞ EVOLVE**, set Speed to 4 bars, and let it run four laps.
Each lap the lane pairs must advance in clip order and the music must not stop.

- [ ] **Step 4: Write down what you heard**

Add the measured numbers to the spec's Acceptance section as a short table. A
claim of "sounds right" with no numbers beside it is what produced two wrong
conclusions earlier in this branch.

- [ ] **Step 5: Rebase and squash**

```bash
git rebase main
```

Then squash into ONE COMMIT PER TASK with a single interactive rebase driven by
a todo file (never a temporary branch), and ask before merging anything to
`main`.

---

## Self-Review

**Spec coverage.** Switch → Tasks 2 and 3. No wrap by hand → Task 1. Clips in
order, library shuffled, empty clips skipped → Task 4. ×2/÷2 → Task 5. Motion →
Task 6. SOLO → Task 7. One short-loop fix → Task 8. Acceptance → Task 9. The
spec's "not doing" list is respected: no task touches Space, the step row or the
send rename.

**Placeholders.** None: every code step carries the actual code. Task 7 step 1
deliberately says to read the real signature first rather than inventing one,
because that file was not read while writing this plan — that is a stated
instruction, not a TBD.

**Type consistency.** `evolve` is the name in `FlowState`, in `PanelFlow` and in
the fourth parameter of `setFlow` throughout. `wrap` is the name of the new last
parameter of both `flowPositions` and `applyFlow`. `setClipLength(laneId,
factor)` is used identically in Task 5's test, its implementation and the lane
row. The destination id `<laneId>.mod.<modId>.conn.<connId>.depth` is spelled
the same in Task 6's catalogue, its parser and its test, and matches the knob id
already registered in `src/modulation/mod-routing-templates.ts:79`.
