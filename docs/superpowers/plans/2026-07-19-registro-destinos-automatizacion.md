# Master Automation-Destination Registry — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make one derived-from-the-session list the only source of "what can be automated", addressed by one stable id format, resolved by one resolver, with a standard change notification — so a newly added insert appears in every picker and deleting one stops silently repointing modulations.

**Architecture:** `src/automation/automation-targets.ts` already derives destinations from `SessionState` and is used by two of the four pickers. It becomes the single source. Each insert gains a stable `id` (on both the persisted `InsertSlot` and the live `ChainSlot`) so array position stops being identity. A thin `destination-registry.ts` wraps the catalogue with `subscribe`/`invalidate`. The knob registry is demoted to a live-handle cache: labels, ranges, and the write path only.

**Tech Stack:** TypeScript, Vite, Web Audio, Vitest (+ jsdom for UI tests), Playwright for e2e.

## Global Constraints

- Branch: `worktree-automation-destination-registry`. **All work happens in the worktree at `c:\Users\nacho\git\tb303-synth\.claude\worktrees\automation-destination-registry`, never in the main checkout.**
- The worktree has no `node_modules`. Run `npm install` there once before Task 1.
- Test commands are colour-free: prefix direct vitest calls with `NO_COLOR=1`.
- UI strings in English. Code comments in English.
- Source files ≤300 lines target, 500 hard limit (CLAUDE.md).
- Assertions relative, never absolute magnitudes.
- No user-facing migration prompts. Load-time normalisation happens silently.
- Commit after every task. Rebase onto `main` after every commit.

---

### Task 0: Worktree setup

**Files:** none modified.

- [ ] **Step 1: Install dependencies in the worktree**

```bash
cd "c:/Users/nacho/git/tb303-synth/.claude/worktrees/automation-destination-registry"
npm install
```

- [ ] **Step 2: Confirm the baseline is green**

Run: `NO_COLOR=1 npx vitest run src/automation/ src/modulation/ src/session/`
Expected: all pass. If `ERR_IPC_CHANNEL_CLOSED` appears after all tests pass, re-run — it is a known flaky teardown, not a failure.

- [ ] **Step 3: Confirm the LFO fix from `1d8ba7e` is present**

Run: `grep -n "buildDestOptions" src/modulation/modulation-ui.ts`
Expected: matches. If it does NOT match, you are in the main checkout — stop and move to the worktree.

---

### Task 1: Stable ids on InsertSlot and ChainSlot

**Files:**
- Modify: `src/session/insert-slot.ts`
- Modify: `src/plugins/fx/insert-chain.ts`
- Modify: `src/session/lane-insert-ui.ts:191`
- Modify: `src/core/send-migration.ts:5-6`
- Test: `src/session/insert-slot.test.ts`

**Interfaces:**
- Produces: `InsertSlot.id: string`; `ChainSlot.id: string`; `InsertChain.insert(fx: FxInstance, id: string, at?: number): void`; `newInsertId(): string`; `backfillInsertIds(slots: InsertSlot[]): void`.

**Why both:** `addInsertChainParams` in `voice-mod-binding.ts:85` iterates `chain.list()` (`ChainSlot[]`) and never sees `InsertSlot`. `rehydrateInsertChain` is the only place both are in scope, so the id must be threaded through `insert()`.

- [ ] **Step 1: Write the failing test**

Append to `src/session/insert-slot.test.ts`:

```ts
import { newInsertId, backfillInsertIds, rehydrateInsertChain } from './insert-slot';

describe('stable insert ids', () => {
  it('mints distinct ids', () => {
    expect(newInsertId()).not.toBe(newInsertId());
  });

  it('backfills only slots that lack an id, leaving existing ones alone', () => {
    const slots = [
      { pluginId: 'delay', params: {}, bypass: false },
      { id: 'keep-me', pluginId: 'reverb', params: {}, bypass: false },
    ] as InsertSlot[];
    backfillInsertIds(slots);
    expect(slots[0].id).toBeTruthy();
    expect(slots[1].id).toBe('keep-me');
    expect(slots[0].id).not.toBe(slots[1].id);
  });

  it('carries the slot id onto the live chain slot', () => {
    const ctx = new AudioContext();
    const chain = new InsertChain(ctx.createGain(), ctx.createGain());
    const slots: InsertSlot[] = [
      { id: 'slot-a', pluginId: 'delay', params: {}, bypass: false },
    ];
    rehydrateInsertChain(ctx, chain, slots);
    expect(chain.list().map((s) => s.id)).toEqual(['slot-a']);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `NO_COLOR=1 npx vitest run src/session/insert-slot.test.ts`
Expected: FAIL — `newInsertId is not a function`.

- [ ] **Step 3: Add the id to InsertSlot and the helpers**

In `src/session/insert-slot.ts`, change the interface and add the helpers:

```ts
export interface InsertSlot {
  /** Stable identity, independent of position in the chain. Minted on
   *  creation and backfilled at load for sessions saved before it existed.
   *  Position must never be used as identity: removing a slot renumbers
   *  every later one, which silently repoints anything addressing them. */
  id: string;
  pluginId: string;
  params: Record<string, number>;
  presetName?: string;
  modulators?: ModulatorState[];
  bypass: boolean;
}

let insertIdCounter = 0;

/** Mint a fresh slot id. Counter + random so ids stay unique across a reload
 *  where the counter restarts but old ids are already in the session. */
export function newInsertId(): string {
  insertIdCounter += 1;
  return `i${insertIdCounter.toString(36)}${Math.random().toString(36).slice(2, 7)}`;
}

/** Give an id to any slot saved before ids existed. Idempotent. */
export function backfillInsertIds(slots: InsertSlot[] | undefined): void {
  for (const slot of slots ?? []) {
    if (!slot.id) slot.id = newInsertId();
  }
}
```

And thread the id through rehydration:

```ts
export function rehydrateInsertChain(
  ctx: AudioContext, chain: InsertChain, slots: InsertSlot[],
): void {
  for (const slot of slots) {
    const inst = createInstance('fx', slot.pluginId, ctx);
    if (!inst) continue;
    applyInsertSlot(slot, inst);
    chain.insert(inst, slot.id);
    if (slot.bypass) chain.setBypass(chain.size() - 1, true);
  }
}
```

- [ ] **Step 4: Add the id to ChainSlot**

In `src/plugins/fx/insert-chain.ts`:

```ts
export interface ChainSlot {
  /** Mirrors the persisted InsertSlot.id, so anything addressing a live slot
   *  (the modulation binder) uses the same identity the session saved. */
  id: string;
  fx: FxInstance;
  bypass: boolean;
}
```

and

```ts
  insert(fx: FxInstance, id: string, at?: number): void {
    const idx = at ?? this.slots.length;
    this.slots.splice(idx, 0, { id, fx, bypass: false });
    this.rewire();
  }
```

- [ ] **Step 5: Fix the three construction sites**

`src/session/lane-insert-ui.ts:191` — mint the id and pass it to the chain:

```ts
    const slot: InsertSlot = { id: newInsertId(), pluginId, params, bypass: false };
    slots.push(slot);
    chain.insert(inst, slot.id);
```

Add `newInsertId` to that file's import from `./insert-slot`.

`src/core/send-migration.ts:5-6` — the two default sends:

```ts
    { id: 'A', label: 'Send A (Delay)',  returnLevel: 1, muted: false, inserts: [{ id: newInsertId(), pluginId: 'delay',  params: {}, bypass: false }] },
    { id: 'B', label: 'Send B (Reverb)', returnLevel: 1, muted: false, inserts: [{ id: newInsertId(), pluginId: 'reverb', params: {}, bypass: false }] },
```

- [ ] **Step 6: Fix the other `chain.insert(` call sites**

Run: `grep -rn "\.insert(" src/ --include=*.ts | grep -v "\.test\."`
For every `InsertChain.insert` call, add the id argument. Mint one with `newInsertId()` where no slot exists.

- [ ] **Step 7: Fix the test fixtures**

The 8 `InsertSlot` literals in these files need an `id`:
`src/automation/automation-targets.test.ts:54`, `src/session/insert-slot.test.ts:34,51,58`, `src/session/lane-insert-ui.test.ts:83,128,157,190`.

- [ ] **Step 8: Run the tests and typecheck**

Run: `NO_COLOR=1 npx vitest run src/session/ src/automation/ && npx tsc --noEmit`
Expected: PASS, no type errors.

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "feat(fx): give every insert a stable id, on the slot and on the chain"
git rebase main
```

---

### Task 2: One canonical id format

**Files:**
- Modify: `src/automation/automation-targets.ts:32-34, 74-78, 99-112`
- Modify: `src/automation/automation-apply.ts:11-32`
- Test: `src/automation/automation-apply.test.ts` (create if absent)

**Interfaces:**
- Consumes: `InsertSlot.id` (Task 1).
- Produces: `insertParamId(scopeId: string, slotId: string, paramId: string): string` → `` `${scopeId}.fx:${slotId}.${paramId}` ``; `ParsedParamId` insert variant becomes `{ scopeId, kind: 'insert', slotId: string, paramId }`; `parseLegacyInsertParamId(id: string): { scopeId: string; slotIdx: number; paramId: string } | null`.

- [ ] **Step 1: Write the failing test**

Create `src/automation/automation-apply.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { parseAutomationParamId, parseLegacyInsertParamId } from './automation-apply';
import { insertParamId } from './automation-targets';

describe('canonical destination ids', () => {
  it('round-trips a lane insert param', () => {
    const id = insertParamId('poly1', 'i3abc', 'cutoff');
    expect(id).toBe('poly1.fx:i3abc.cutoff');
    expect(parseAutomationParamId(id)).toEqual({
      scopeId: 'poly1', kind: 'insert', slotId: 'i3abc', paramId: 'cutoff',
    });
  });

  it('round-trips a send-rack insert param, keeping the dotted scope intact', () => {
    const id = insertParamId('fx.send.A', 'i9', 'mix');
    expect(parseAutomationParamId(id)).toEqual({
      scopeId: 'fx.send.A', kind: 'insert', slotId: 'i9', paramId: 'mix',
    });
  });

  it('still reads an engine param', () => {
    expect(parseAutomationParamId('poly1.filter.cutoff')).toEqual({
      scopeId: 'poly1', kind: 'engine', paramId: 'filter.cutoff',
    });
  });

  it('reads the legacy positional form, for load-time translation only', () => {
    expect(parseLegacyInsertParamId('poly1.fx2.cutoff')).toEqual({
      scopeId: 'poly1', slotIdx: 2, paramId: 'cutoff',
    });
    expect(parseLegacyInsertParamId('poly1.fx:i3.cutoff')).toBeNull();
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `NO_COLOR=1 npx vitest run src/automation/automation-apply.test.ts`
Expected: FAIL — `parseLegacyInsertParamId is not exported`.

- [ ] **Step 3: Change the id builder**

`src/automation/automation-targets.ts`:

```ts
/** The insert-param id for a rack slot. `scopeId` is a lane id, or `fx.master` /
 *  `fx.send.<id>` for the global racks. `slotId` is the slot's stable id, never
 *  its position — position changes when a neighbour is removed. */
export function insertParamId(scopeId: string, slotId: string, paramId: string): string {
  return `${scopeId}.fx:${slotId}.${paramId}`;
}
```

Update the two call sites in the same file to pass `slot.id` instead of `idx`:

```ts
    (lane.inserts ?? []).forEach((slot) => {
      for (const spec of fxParams(slot.pluginId)) {
        push(insertParamId(lane.id, slot.id, spec.id), spec.label, spec.min, spec.max);
      }
    });
```

and in `pushRackTargets`, widen the slot type and drop the index:

```ts
function pushRackTargets(
  targets: AutomationTarget[],
  registry: ReadonlyMap<string, KnobHandle>,
  scopeId: string,
  displayName: string,
  slots: readonly { id: string; pluginId: string }[],
): void {
  for (const slot of slots) {
    for (const spec of fxParams(slot.pluginId)) {
      const id = insertParamId(scopeId, slot.id, spec.id);
      const live = registry.get(id);
      targets.push({
        id, laneId: scopeId, laneName: displayName,
        label: live?.meta.label ?? spec.label,
        min: live?.meta.min ?? spec.min,
        max: live?.meta.max ?? spec.max,
      });
    }
  }
}
```

- [ ] **Step 4: Change the parser**

`src/automation/automation-apply.ts` — replace the type and the parser:

```ts
export type ParsedParamId =
  | { scopeId: string; kind: 'engine'; paramId: string }
  | { scopeId: string; kind: 'insert'; slotId: string; paramId: string };

/** Split a canonical destination id. The insert marker is the first segment
 *  shaped `fx:<slotId>`; everything before it is the scope (which is itself
 *  dotted for the global racks: `fx.send.A`). */
export function parseAutomationParamId(id: string): ParsedParamId | null {
  const parts = id.split('.');
  if (parts.length < 2) return null;

  const slotAt = parts.findIndex((p, i) => i > 0 && p.startsWith('fx:'));
  if (slotAt > 0 && slotAt < parts.length - 1) {
    return {
      scopeId: parts.slice(0, slotAt).join('.'),
      kind: 'insert',
      slotId: parts[slotAt].slice(3),
      paramId: parts.slice(slotAt + 1).join('.'),
    };
  }
  return { scopeId: parts[0], kind: 'engine', paramId: parts.slice(1).join('.') };
}

/** Read the OLD positional insert id (`<scope>.fx2.<param>`). Used only by the
 *  load-time translation in Task 3 — nothing at runtime should produce these. */
export function parseLegacyInsertParamId(
  id: string,
): { scopeId: string; slotIdx: number; paramId: string } | null {
  const parts = id.split('.');
  const slotAt = parts.findIndex((p, i) => i > 0 && /^fx\d+$/.test(p));
  if (slotAt <= 0 || slotAt >= parts.length - 1) return null;
  return {
    scopeId: parts.slice(0, slotAt).join('.'),
    slotIdx: Number(parts[slotAt].slice(2)),
    paramId: parts.slice(slotAt + 1).join('.'),
  };
}
```

- [ ] **Step 5: Update `applyAutomationToSession` and its deps**

The insert branch now passes a slot id, so `AutomationApplyDeps.getInsertFx` changes shape:

```ts
export interface AutomationApplyDeps {
  getInsertFx(scopeId: string, slotId: string): ParamTarget | undefined;
  getEngine(laneId: string): ParamTarget | undefined;
  /** Declared range for the id, so a 0..1 envelope maps to real units. */
  getRange(id: string): { min: number; max: number } | undefined;
}
```

and in the body: `deps.getInsertFx(parsed.scopeId, parsed.slotId)`.

- [ ] **Step 6: Update the `insertChainFor` resolver in main.ts**

`src/main.ts:1180-1209` — `getInsertFx` must look the slot up by id, not index:

```ts
      getInsertFx: (scopeId, slotId) => {
        const chain = insertChainFor(scopeId);
        return chain?.list().find((s) => s.id === slotId)?.fx;
      },
```

- [ ] **Step 7: Update the knob registration id**

`src/session/lane-insert-ui.ts:107-109` — the knob id uses the slot id:

```ts
        const knobId = automationScopeId
          ? insertParamId(automationScopeId, slot.id, spec.id)
          : undefined;
```

- [ ] **Step 8: Run tests and typecheck**

Run: `NO_COLOR=1 npx vitest run src/automation/ src/session/ && npx tsc --noEmit`
Expected: PASS. Fix any fixture that still asserts the old `fx0.` form.

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "feat(automation): address inserts by stable id, not by position"
git rebase main
```

---

### Task 3: Translate stored ids at load

**Files:**
- Modify: `src/session/session-migration.ts`
- Test: `src/session/session-migration.test.ts`

**Interfaces:**
- Consumes: `backfillInsertIds` (Task 1), `parseLegacyInsertParamId`, `insertParamId` (Task 2).
- Produces: nothing new — `migrateLoadedSessionState` gains the behaviour.

**Order matters:** ids must be backfilled BEFORE translation, because translation maps `slotIdx → slots[slotIdx].id`.

- [ ] **Step 1: Confirm the entry point actually runs on load**

Run: `grep -rn "migrateLoadedSessionState" src/ --include=*.ts`
Expected: at least one non-test call site on the load path. If there is none, the translation belongs in `src/save/saved-state-v3.ts:129-136` instead — put it there and adjust the rest of this task accordingly.

- [ ] **Step 2: Write the failing test**

Add to `src/session/session-migration.test.ts`:

```ts
describe('insert id translation at load', () => {
  it('backfills ids and repoints legacy automation + modulation ids at them', () => {
    const state = {
      lanes: [{
        id: 'poly1', engineId: 'subtractive', clips: [{
          notes: [],
          automation: [{ paramId: 'poly1.fx1.cutoff', points: [] }],
        }],
        inserts: [
          { pluginId: 'delay',  params: {}, bypass: false },
          { pluginId: 'reverb', params: {}, bypass: false },
        ],
        engineState: { modulators: [
          { id: 'lfo1', kind: 'lfo', enabled: true,
            connections: [{ id: 'c1', paramId: 'lane-insert-1:cutoff', depth: 0.5 }] },
        ] },
      }],
    } as unknown as SessionState;

    migrateLoadedSessionState(state);

    const secondSlotId = state.lanes[0].inserts![1].id;
    expect(secondSlotId).toBeTruthy();
    // Both stored forms pointed at slot index 1 — both must land on that slot's id.
    expect(state.lanes[0].clips[0].automation![0].paramId)
      .toBe(`poly1.fx:${secondSlotId}.cutoff`);
    expect(state.lanes[0].engineState!.modulators![0].connections[0].paramId)
      .toBe(`poly1.fx:${secondSlotId}.cutoff`);
  });

  it('leaves an already-canonical id untouched', () => {
    const state = {
      lanes: [{
        id: 'poly1', engineId: 'subtractive', clips: [],
        inserts: [{ id: 'keep', pluginId: 'delay', params: {}, bypass: false }],
        engineState: { modulators: [
          { id: 'lfo1', kind: 'lfo', enabled: true,
            connections: [{ id: 'c1', paramId: 'poly1.fx:keep.cutoff', depth: 0.5 }] },
        ] },
      }],
    } as unknown as SessionState;

    migrateLoadedSessionState(state);
    expect(state.lanes[0].engineState!.modulators![0].connections[0].paramId)
      .toBe('poly1.fx:keep.cutoff');
  });
});
```

- [ ] **Step 3: Run it and watch it fail**

Run: `NO_COLOR=1 npx vitest run src/session/session-migration.test.ts`
Expected: FAIL — paramId still `poly1.fx1.cutoff`.

- [ ] **Step 4: Implement the translation**

Add to `src/session/session-migration.ts`:

```ts
/** Resolve a scope id to its slot list, so a legacy positional id can be
 *  mapped onto the slot that occupied that position at save time. */
function slotsForScope(s: SessionState, scopeId: string): InsertSlot[] | undefined {
  if (scopeId === 'fx.master') return s.masterInserts;
  if (scopeId.startsWith('fx.send.')) {
    return s.sends?.find((b) => b.id === scopeId.slice('fx.send.'.length))?.inserts;
  }
  return s.lanes.find((l) => l.id === scopeId)?.inserts;
}

/** Translate one stored destination id into the canonical stable-id form.
 *  Handles both legacy shapes; returns the id unchanged when already canonical
 *  or when the slot it named no longer exists. */
function canonicaliseDestinationId(s: SessionState, laneId: string, id: string): string {
  // Legacy modulation form: `lane-insert-<idx>:<param>` / `master-insert-<idx>:<param>`
  const mod = /^(lane|master)-insert-(\d+):(.+)$/.exec(id);
  if (mod) {
    const scopeId = mod[1] === 'master' ? 'fx.master' : laneId;
    const slot = slotsForScope(s, scopeId)?.[Number(mod[2])];
    return slot ? insertParamId(scopeId, slot.id, mod[3]) : id;
  }
  // Legacy automation form: `<scope>.fx<idx>.<param>`
  const legacy = parseLegacyInsertParamId(id);
  if (legacy) {
    const slot = slotsForScope(s, legacy.scopeId)?.[legacy.slotIdx];
    return slot ? insertParamId(legacy.scopeId, slot.id, legacy.paramId) : id;
  }
  return id;
}

/** Backfill slot ids everywhere, then repoint every stored destination id. */
function normaliseInsertIdentity(s: SessionState): void {
  backfillInsertIds(s.masterInserts);
  for (const bus of s.sends ?? []) backfillInsertIds(bus.inserts);
  for (const lane of s.lanes) backfillInsertIds(lane.inserts);

  for (const lane of s.lanes) {
    for (const mod of lane.engineState?.modulators ?? []) {
      for (const conn of mod.connections) {
        conn.paramId = canonicaliseDestinationId(s, lane.id, conn.paramId);
      }
    }
    for (const clip of lane.clips ?? []) {
      for (const env of clip.automation ?? []) {
        env.paramId = canonicaliseDestinationId(s, lane.id, env.paramId);
      }
    }
  }
}
```

Call `normaliseInsertIdentity(s)` from `migrateLoadedSessionState` **after** `if (!s.sends) s.sends = defaultSends();` and before the second lane pass.

- [ ] **Step 5: Run the test**

Run: `NO_COLOR=1 npx vitest run src/session/session-migration.test.ts`
Expected: PASS.

- [ ] **Step 6: Also normalise on the save path**

`src/save/saved-state-v3.ts:132-134` already does `masterInserts ??= []` and `lane.inserts ??= []` but never touches `sends[].inserts`. Add:

```ts
    for (const bus of s.sessionState.sends ?? []) bus.inserts ??= [];
```

- [ ] **Step 7: Full suite and typecheck**

Run: `NO_COLOR=1 npm run test:unit && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "fix(session): repoint stored destinations at stable slot ids on load"
git rebase main
```

---

### Task 4: The catalogue gains subscribe/invalidate

**Files:**
- Create: `src/automation/destination-registry.ts`
- Test: `src/automation/destination-registry.test.ts`

**Interfaces:**
- Consumes: `listAutomationTargets`, `AutomationTarget` (Task 2).
- Produces:
  - `createDestinationRegistry(deps: DestinationRegistryDeps): DestinationRegistry`
  - `interface DestinationRegistry { list(): AutomationTarget[]; subscribe(fn: () => void): () => void; invalidate(): void; }`
  - `interface DestinationRegistryDeps { getState(): SessionState; getKnobRegistry(): ReadonlyMap<string, KnobHandle>; }`

`subscribe` follows the shape already used by `sidechain-bus.ts:43`, `auto-history.ts:79` and `active-lane.ts:18`: it returns its own unsubscribe.

- [ ] **Step 1: Write the failing test**

Create `src/automation/destination-registry.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import { createDestinationRegistry } from './destination-registry';
import type { SessionState } from '../session/session';

function stateWith(inserts: { id: string; pluginId: string }[]): SessionState {
  return {
    lanes: [{
      id: 'poly1', name: 'Sub 1', engineId: 'subtractive', clips: [],
      inserts: inserts.map((i) => ({ ...i, params: {}, bypass: false })),
    }],
    masterInserts: [], sends: [],
  } as unknown as SessionState;
}

describe('destination registry', () => {
  it('notifies subscribers on invalidate and stops after unsubscribe', () => {
    let state = stateWith([]);
    const reg = createDestinationRegistry({
      getState: () => state,
      getKnobRegistry: () => new Map(),
    });
    const fn = vi.fn();
    const off = reg.subscribe(fn);

    reg.invalidate();
    expect(fn).toHaveBeenCalledTimes(1);

    off();
    reg.invalidate();
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('reflects an insert added after the registry was created', () => {
    let state = stateWith([]);
    const reg = createDestinationRegistry({
      getState: () => state,
      getKnobRegistry: () => new Map(),
    });
    expect(reg.list().some((t) => t.id.includes('fx:'))).toBe(false);

    state = stateWith([{ id: 'slot-a', pluginId: 'multifilter' }]);
    reg.invalidate();
    expect(reg.list().some((t) => t.id.startsWith('poly1.fx:slot-a.'))).toBe(true);
  });

  it('survives a subscriber that throws, so one bad panel cannot mute the rest', () => {
    const reg = createDestinationRegistry({
      getState: () => stateWith([]),
      getKnobRegistry: () => new Map(),
    });
    const good = vi.fn();
    reg.subscribe(() => { throw new Error('boom'); });
    reg.subscribe(good);
    expect(() => reg.invalidate()).not.toThrow();
    expect(good).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `NO_COLOR=1 npx vitest run src/automation/destination-registry.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `src/automation/destination-registry.ts`:

```ts
// The single place anything asks "what can be automated right now".
//
// It wraps listAutomationTargets — which derives destinations from the session,
// never from the mounted-knob registry — and adds the change notification the
// four pickers need. Before this existed each picker built its own list from a
// different source, so adding an insert updated some of them and not others.
//
// DO NOT build a parallel list. If a new surface needs destinations, call
// list() here and subscribe() to stay fresh.

import { listAutomationTargets, type AutomationTarget } from './automation-targets';
import type { SessionState } from '../session/session';
import type { KnobHandle } from '../core/knob';

export interface DestinationRegistryDeps {
  getState(): SessionState;
  /** Live handles, consulted only for label + range of a mounted knob. */
  getKnobRegistry(): ReadonlyMap<string, KnobHandle>;
}

export interface DestinationRegistry {
  /** Every destination the session currently declares. */
  list(): AutomationTarget[];
  /** Subscribe to structural changes. Returns its own unsubscribe. */
  subscribe(fn: () => void): () => void;
  /** Announce that the set of destinations changed. */
  invalidate(): void;
}

export function createDestinationRegistry(deps: DestinationRegistryDeps): DestinationRegistry {
  const listeners = new Set<() => void>();
  return {
    list: () => listAutomationTargets(deps.getState(), deps.getKnobRegistry()),
    subscribe(fn) {
      listeners.add(fn);
      return () => { listeners.delete(fn); };
    },
    invalidate() {
      // A throwing subscriber must not stop the others being told.
      for (const fn of [...listeners]) {
        try { fn(); } catch (err) { console.error('destination subscriber failed', err); }
      }
    },
  };
}
```

- [ ] **Step 4: Run the test**

Run: `NO_COLOR=1 npx vitest run src/automation/destination-registry.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(automation): one destination registry with a standard change signal"
git rebase main
```

---

### Task 5: Wire the registry and call invalidate at the mutation sites

**Files:**
- Modify: `src/main.ts` (construct the registry; pass it down)
- Modify: `src/session/lane-insert-ui.ts` (add/remove/bypass handlers)
- Modify: `src/session/session-inspector.ts:784-788` (the insert panel's `onChange`)
- Modify: `src/app/lane-allocator.ts` (lane add/remove, engine swap)
- Test: `src/session/lane-insert-ui.test.ts`

**Interfaces:**
- Consumes: `DestinationRegistry` (Task 4).
- Produces: `LaneInsertUIDeps.onDestinationsChanged?: () => void`.

- [ ] **Step 1: Write the failing test**

Add to `src/session/lane-insert-ui.test.ts`:

```ts
it('announces a destination change when an insert is removed', () => {
  const onDestinationsChanged = vi.fn();
  const ctx = new AudioContext();
  const chain = new InsertChain(ctx.createGain(), ctx.createGain());
  const slots: InsertSlot[] = [
    { id: 'a', pluginId: 'delay', params: {}, bypass: false },
  ];
  rehydrateInsertChain(ctx, chain, slots);

  const container = document.createElement('div');
  buildLaneInsertUI({
    ctx, container, chain, slots,
    onChange: () => {},
    onDestinationsChanged,
  });

  container.querySelector<HTMLButtonElement>('.insert-rm')!.click();
  expect(onDestinationsChanged).toHaveBeenCalled();
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `NO_COLOR=1 npx vitest run src/session/lane-insert-ui.test.ts`
Expected: FAIL — `onDestinationsChanged` never called.

- [ ] **Step 3: Add the hook to the insert panel**

`src/session/lane-insert-ui.ts` — add to `LaneInsertUIDeps`:

```ts
  /** Fired when the SET of destinations changes (an insert added or removed),
   *  not when a value changes. Drives DestinationRegistry.invalidate(). */
  onDestinationsChanged?: () => void;
```

Call it in the remove handler (after `slots.splice`), and in the add handler (after `slots.push`). Bypass does NOT change the destination set — do not call it there.

- [ ] **Step 4: Construct the registry in main.ts and pass invalidate down**

In `src/main.ts`, next to where `automationRegistry` is created:

```ts
const destinations = createDestinationRegistry({
  getState: () => sessionHost.state,
  getKnobRegistry: () => automationRegistry,
});
```

Pass `onDestinationsChanged: () => destinations.invalidate()` through `session-inspector.ts`'s `mountLaneInserts` into `buildLaneInsertUI`.

- [ ] **Step 5: Invalidate on lane add/remove, engine swap and session load**

In `src/app/lane-allocator.ts`, call `destinations.invalidate()` at the end of `ensureLaneResource` and `swapLaneEngine`. In the session-load path (`applyLoadedSessionState`), call it once after the state is applied.

Run: `grep -rn "invalidate()" src/ --include=*.ts | grep -v "\.test\."`
Expected: at least 5 call sites.

- [ ] **Step 6: Run tests and typecheck**

Run: `NO_COLOR=1 npm run test:unit && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat(automation): announce destination changes from the sites that cause them"
git rebase main
```

---

### Task 6: The modulation dropdown reads the catalogue

**Files:**
- Modify: `src/modulation/modulation-ui.ts` (`buildDestOptions`, `destinationIds`, `ModulationUIDeps`)
- Modify: `src/engines/worklet-lane-engine.ts:337`, `src/engines/drums-worklet-engine.ts:553`, `src/engines/sampler-worklet-engine.ts:837` (pass the registry through)
- Test: `src/modulation/modulation-ui-dest-refresh.test.ts`

**Interfaces:**
- Consumes: `DestinationRegistry` (Task 4).
- Produces: `ModulationUIDeps.destinations?: DestinationRegistry`; `ModulationUIDeps.laneInserts` and `.masterInserts` and `.fxBus` are DELETED.

- [ ] **Step 1: Rewrite the existing test against the registry**

Replace the body of `src/modulation/modulation-ui-dest-refresh.test.ts` so it drives a `DestinationRegistry` instead of a fake chain:

```ts
// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { renderModulatorsPanel, type ModulationUIDeps } from './modulation-ui';
import { createDestinationRegistry } from '../automation/destination-registry';
import type { SessionState } from '../session/session';
import type { ModulationHost, ModulatorState } from './types';

function stateWith(inserts: { id: string; pluginId: string }[]): SessionState {
  return {
    lanes: [{
      id: 'poly1', name: 'Sub 1', engineId: 'subtractive', clips: [],
      inserts: inserts.map((i) => ({ ...i, params: {}, bypass: false })),
    }],
    masterInserts: [], sends: [],
  } as unknown as SessionState;
}

function fakeHost(mods: ModulatorState[]): ModulationHost {
  return {
    modulators: mods,
    addModulator: () => mods[0], removeModulator: () => {},
    setConnection: () => {}, removeConnection: () => {},
  } as unknown as ModulationHost;
}

function destValues(container: HTMLElement): string[] {
  const sel = container.querySelector<HTMLSelectElement>('.mod-dest-select')!;
  return [...sel.options].map((o) => o.value);
}

describe('modulator destination picker', () => {
  it('offers an insert added after the panel was rendered', () => {
    let state = stateWith([]);
    const destinations = createDestinationRegistry({
      getState: () => state, getKnobRegistry: () => new Map(),
    });
    const mod = { id: 'lfo1', kind: 'lfo', enabled: true, connections: [] } as unknown as ModulatorState;

    const container = document.createElement('div');
    renderModulatorsPanel(container, {
      engineId: 'subtractive', laneId: 'poly1', host: fakeHost([mod]),
      registry: new Map(), registerKnob: () => {}, onChange: () => {},
      destinations,
    } as ModulationUIDeps);

    expect(destValues(container).some((v) => v.startsWith('poly1.fx:'))).toBe(false);

    state = stateWith([{ id: 'slot-a', pluginId: 'multifilter' }]);
    destinations.invalidate();

    expect(destValues(container).some((v) => v.startsWith('poly1.fx:slot-a.'))).toBe(true);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `NO_COLOR=1 npx vitest run src/modulation/modulation-ui-dest-refresh.test.ts`
Expected: FAIL — the panel ignores `destinations`.

- [ ] **Step 3: Rewrite `buildDestOptions`**

Replace the whole engine/lane-FX/master-FX block with one catalogue query, grouped by the catalogue's own lane names:

```ts
function buildDestOptions(destSel: HTMLSelectElement, mod: ModulatorState, deps: ModulationUIDeps): void {
  const used = new Set(mod.connections.map((c) => c.paramId));
  const targets = (deps.destinations?.list() ?? []).filter((t) => !used.has(t.id));
  for (const [laneName, group] of groupTargetsByLane(targets)) {
    const grp = document.createElement('optgroup');
    grp.label = laneName;
    for (const t of group) {
      const opt = document.createElement('option');
      opt.value = t.id;
      opt.textContent = t.label;
      grp.appendChild(opt);
    }
    destSel.appendChild(grp);
  }
}
```

Delete `destinationIds` entirely, and delete `laneInserts` / `masterInserts` / `fxBus` from `ModulationUIDeps`.

- [ ] **Step 4: Subscribe, with a lifetime-bound teardown**

In `renderModulatorsPanel`, create an `AbortController` for the panel and abort the previous one on re-render, mirroring `session-inspector.ts:258`:

```ts
export function renderModulatorsPanel(container: HTMLElement, deps: ModulationUIDeps): void {
  // A panel is rebuilt by wiping its container, which destroys the DOM but not
  // any subscription a previous build registered. Bind them to the container so
  // a rebuild drops the old ones instead of stacking a second redraw on top.
  const prev = panelAborts.get(container);
  if (prev) prev.abort();
  const ac = new AbortController();
  panelAborts.set(container, ac);

  const rebuild = () => renderModulatorsPanel(container, deps);
  const off = deps.destinations?.subscribe(rebuild);
  if (off) ac.signal.addEventListener('abort', off, { once: true });

  container.textContent = '';
  // …existing body…
}
```

with `const panelAborts = new WeakMap<HTMLElement, AbortController>();` at module level.

- [ ] **Step 5: Update the three engine call sites**

In `worklet-lane-engine.ts:337`, `drums-worklet-engine.ts:553` and `sampler-worklet-engine.ts:837`, drop `laneInserts` / `masterInserts` / `fxBus` from the `renderModulatorsPanel` deps and pass `destinations: ctx.destinations` instead. Add `destinations?: DestinationRegistry` to `EngineUIContext` in `src/engines/engine-types.ts:66`.

- [ ] **Step 6: Run tests and typecheck**

Run: `NO_COLOR=1 npm run test:unit && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "refactor(modulation): the destination dropdown reads the one catalogue"
git rebase main
```

---

### Task 7: The modulation binder resolves canonical ids

**Files:**
- Modify: `src/modulation/voice-mod-binding.ts:85-104, 124-136`
- Test: `src/modulation/voice-mod-binding.test.ts`

**Interfaces:**
- Consumes: `ChainSlot.id` (Task 1), canonical id format (Task 2).
- Produces: unchanged public signatures; only the destMap keys change.

- [ ] **Step 1: Write the failing test**

Add to `src/modulation/voice-mod-binding.test.ts`:

```ts
it('binds an insert param by its stable id, and survives an earlier slot being removed', () => {
  const ctx = new AudioContext();
  const chain = new InsertChain(ctx.createGain(), ctx.createGain());
  rehydrateInsertChain(ctx, chain, [
    { id: 'first',  pluginId: 'delay',       params: {}, bypass: false },
    { id: 'target', pluginId: 'multifilter', params: {}, bypass: false },
  ]);

  const destMap = new Map<string, AudioParam>();
  const rangeMap = new Map<string, ParamRange>();
  addInsertChainParams(chain, 'poly1', destMap, rangeMap);
  const before = destMap.get('poly1.fx:target.cutoff');
  expect(before).toBeDefined();

  chain.remove(0);
  destMap.clear();
  addInsertChainParams(chain, 'poly1', destMap, rangeMap);
  // Same id, same AudioParam — position changed, identity did not.
  expect(destMap.get('poly1.fx:target.cutoff')).toBe(before);
});
```

Export `addInsertChainParams` from the module so the test can reach it.

- [ ] **Step 2: Run it and watch it fail**

Run: `NO_COLOR=1 npx vitest run src/modulation/voice-mod-binding.test.ts`
Expected: FAIL — key is `lane-insert-1:cutoff`.

- [ ] **Step 3: Rekey by scope + slot id**

```ts
/** Build the FX-chain entries for destMap/rangeMap, keyed by the canonical
 *  destination id so a modulation and an automation curve address an insert
 *  param the same way. */
export function addInsertChainParams(
  chain: InsertChain,
  scopeId: string,
  destMap: Map<string, AudioParam>,
  rangeMap: Map<string, ParamRange>,
): void {
  for (const cs of chain.list()) {
    for (const [paramId, ap] of cs.fx.getAudioParams()) {
      const key = insertParamId(scopeId, cs.id, paramId);
      destMap.set(key, ap);
      rangeMap.set(key, cs.fx.getAudioParamRange?.(paramId) ?? { min: 0, max: 1 });
    }
  }
}
```

Update both call sites at `voice-mod-binding.ts:135-136`:

```ts
  if (laneInserts)   addInsertChainParams(laneInserts,   laneId,       destMap, rangeMap);
  if (masterInserts) addInsertChainParams(masterInserts, 'fx.master',  destMap, rangeMap);
```

- [ ] **Step 4: Run tests and typecheck**

Run: `NO_COLOR=1 npx vitest run src/modulation/ && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "fix(modulation): bind inserts by identity, so removing a neighbour cannot repoint them"
git rebase main
```

---

### Task 8: The XY pad reads the catalogue

**Files:**
- Modify: `src/performance/xy-pad-ui.ts:10-15, 26-30, 70-103`
- Modify: `src/main.ts:793-824` (the lazy panel construction)
- Test: `src/performance/xy-pad-ui.test.ts` (create if absent)

**Interfaces:**
- Consumes: `DestinationRegistry` (Task 4).
- Produces: `XyPadUIDeps.destinations: DestinationRegistry` replaces `XyPadUIDeps.registry` as the *list* source. `registry` stays, for the write path only.

- [ ] **Step 1: Write the failing test**

Create `src/performance/xy-pad-ui.test.ts`:

```ts
// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { createXyPad } from './xy-pad-ui';
import { createDestinationRegistry } from '../automation/destination-registry';
import type { SessionState } from '../session/session';

describe('xy pad target dropdowns', () => {
  it('offers session destinations, not leftover registry keys', () => {
    const state = {
      lanes: [{ id: 'poly1', name: 'Sub 1', engineId: 'subtractive', clips: [], inserts: [] }],
      masterInserts: [], sends: [],
    } as unknown as SessionState;
    // A knob for a lane the session no longer has — the old code offered this.
    const stale = new Map([['ghost.cutoff', { meta: { min: 0, max: 1 }, setValue: () => {} }]]);

    const pad = createXyPad({
      destinations: createDestinationRegistry({
        getState: () => state, getKnobRegistry: () => new Map(),
      }),
      registry: stale as never,
      formatLabel: (id) => id,
    });
    pad.refreshOptions();

    const values = [...pad.el.querySelectorAll('option')].map((o) => (o as HTMLOptionElement).value);
    expect(values).not.toContain('ghost.cutoff');
    expect(values.some((v) => v.startsWith('poly1.'))).toBe(true);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `NO_COLOR=1 npx vitest run src/performance/xy-pad-ui.test.ts`
Expected: FAIL — `ghost.cutoff` is offered.

- [ ] **Step 3: Source the options from the catalogue**

Replace the candidate-gathering in `refreshOptions` (`xy-pad-ui.ts:71-78`) with:

```ts
    const targets = deps.destinations.list();
    const ids = targets.map((t) => t.id);
    const byLane = groupTargetsByLane(targets);
```

and build the optgroups from `byLane`, using `t.label` for the option text and `laneName` for the group label. Delete `laneOf` — the catalogue already carries `laneName`, and the first-dot split misgrouped `fx.master.*` anyway.

- [ ] **Step 4: Subscribe instead of only refreshing on open**

In `createXyPad`, after the pad is built:

```ts
  // Keep the safety net (main.ts refreshes on open) AND subscribe, so an insert
  // added while the pad is open shows up without closing it.
  deps.destinations.subscribe(refreshOptions);
```

- [ ] **Step 5: Update the construction site**

`src/main.ts:793-824` — pass `destinations` into `createXyPad`.

- [ ] **Step 6: Run tests and typecheck**

Run: `NO_COLOR=1 npm run test:unit && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "refactor(xy-pad): targets come from the session, not from mounted knobs"
git rebase main
```

---

### Task 9: Fold the two remaining pickers onto the registry

**Files:**
- Modify: `src/session/clip-automation-lanes.ts:21-28, 65`
- Modify: `src/performance/performance-automation-ui.ts:25-38, 49-51`
- Modify: `src/performance/performance-automation-ui.ts:15-23` (delete `groupParamsByPrefix`)
- Test: `src/performance/performance-automation-ui.test.ts` (create if absent)

**Interfaces:**
- Consumes: `DestinationRegistry` (Task 4).
- Produces: `ClipAutoDeps.destinations` replaces `sessionState` + `automationRegistry` as the list source; `PerfAutoDeps.destinations` replaces the optional `sessionState`.

These two already call `listAutomationTargets`, so this is a swap, not a rewrite. The win is that `sessionState` stops being optional in `PerfAutoDeps` — today an absent one silently yields an empty picker.

- [ ] **Step 1: Write the failing test**

Create `src/performance/performance-automation-ui.test.ts`:

```ts
// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { buildAutomationHeader } from './performance-automation-ui';
import { createDestinationRegistry } from '../automation/destination-registry';
import type { SessionState } from '../session/session';

describe('performance automation header', () => {
  it('lists destinations from the registry', () => {
    const state = {
      lanes: [{ id: 'poly1', name: 'Sub 1', engineId: 'subtractive', clips: [], inserts: [] }],
      masterInserts: [], sends: [],
    } as unknown as SessionState;
    const header = buildAutomationHeader({
      destinations: createDestinationRegistry({
        getState: () => state, getKnobRegistry: () => new Map(),
      }),
      laneWidthPx: 100, getBrush: () => 'line',
      painterDeps: {} as never,
      onAdd: () => {}, onRemove: () => {}, onEdited: () => {},
    } as never);
    const values = [...header.querySelectorAll('option')].map((o) => (o as HTMLOptionElement).value);
    expect(values.some((v) => v.startsWith('poly1.'))).toBe(true);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `NO_COLOR=1 npx vitest run src/performance/performance-automation-ui.test.ts`
Expected: FAIL — deps shape mismatch.

- [ ] **Step 3: Swap both pickers onto `destinations.list()`**

In `performance-automation-ui.ts:49-51`: `const targets = deps.destinations.list();` and make `destinations` required, deleting `sessionState` and `registry` from `PerfAutoDeps` if nothing else in the file uses them.

In `clip-automation-lanes.ts:65`: `const targets = deps.destinations.list();`, replacing `sessionState` + `automationRegistry` in `ClipAutoDeps` with `destinations`.

Delete the unused export `groupParamsByPrefix` (`performance-automation-ui.ts:15-23`).

- [ ] **Step 4: Update the call sites**

Run: `grep -rn "renderClipAutomationLanes\|buildAutomationHeader" src/ --include=*.ts | grep -v "\.test\."`
Update each to pass `destinations`.

- [ ] **Step 5: Run tests and typecheck**

Run: `NO_COLOR=1 npm run test:unit && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "refactor(automation): both remaining pickers read the registry"
git rebase main
```

---

### Task 10: The MIDI surface reaches FX params

**Files:**
- Modify: `src/control/loom-facade.ts:54-63, 293-297`
- Test: `src/control/loom-facade.test.ts` (create if absent)

**Interfaces:**
- Consumes: `DestinationRegistry` (Task 4), `parseAutomationParamId` (Task 2).
- Produces: `engineParamIds(laneId)` returns canonical destination ids (engine params first, then that lane's insert params); `setEngineParam` accepts any canonical id.

Today the APC reaches only `res.engine.params` and drops any insert id. The device bank is positional (`ids[index]`), so extending the list is enough to make the knobs reach FX.

- [ ] **Step 1: Write the failing test**

```ts
it('drives an insert param through a canonical destination id', () => {
  const setBase = vi.fn();
  const facade = makeFacadeForTest({
    laneId: 'poly1',
    insertSlot: { id: 'slot-a', pluginId: 'multifilter', setBaseValue: setBase },
  });
  facade.setEngineParam('poly1', 'poly1.fx:slot-a.cutoff', 0.5);
  expect(setBase).toHaveBeenCalled();
});
```

Build `makeFacadeForTest` from the existing fixtures in `src/control/`; if none exist, construct the facade with stub `laneResources` and `knobRegistry` maps.

- [ ] **Step 2: Run it and watch it fail**

Run: `NO_COLOR=1 npx vitest run src/control/loom-facade.test.ts`
Expected: FAIL — the id is dropped by the `res.engine.params.find` guard.

- [ ] **Step 3: Route through the canonical parser**

```ts
  function setEngineParam(laneId: string, paramId: string, value01: number): void {
    // A mounted knob is the best path: it moves the ring AND drives the audio.
    const handle = knobRegistry.get(paramId);
    const parsed = parseAutomationParamId(paramId);

    if (parsed?.kind === 'insert') {
      const chain = insertChainFor(parsed.scopeId);
      const fx = chain?.list().find((s) => s.id === parsed.slotId)?.fx;
      if (!fx) return;
      const spec = fxParamSpec(parsed.scopeId, parsed.slotId, parsed.paramId);
      if (!spec) return;
      const real = spec.min + value01 * (spec.max - spec.min);
      if (handle) handle.setValue(real); else fx.setBaseValue(parsed.paramId, real);
      return;
    }

    const res = laneResources.get(laneId);
    if (!res) return;
    const localId = parsed?.kind === 'engine' ? parsed.paramId : paramId;
    const spec = res.engine.params.find((p) => p.id === localId);
    if (!spec || spec.kind !== 'continuous') return;
    const real = spec.min + value01 * (spec.max - spec.min);
    if (handle) handle.setValue(real);
    else res.engine.setBaseValue(localId, real);
  }
```

Note `setEngineParam` must keep accepting a bare local id (`cutoff`) for backwards compatibility with the profile — the `parsed?.kind === 'engine'` fallback handles both.

- [ ] **Step 4: Extend the device-bank list**

```ts
    engineParamIds: (laneId) => {
      const engineIds = destinations.list()
        .filter((t) => t.laneId === laneId)
        .map((t) => t.id);
      return engineIds.slice(0, 8);
    },
```

- [ ] **Step 5: Run tests and typecheck**

Run: `NO_COLOR=1 npm run test:unit && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(control): the APC can reach insert params, not just engine params"
git rebase main
```

---

### Task 11: Stop the knob-registry leak

**Files:**
- Modify: `src/app/knob-registry-prune.ts`
- Test: `src/app/knob-registry-prune.test.ts`

**Interfaces:**
- Consumes: `DestinationRegistry` (Task 4).
- Produces: `pruneKnobRegistryToDestinations(registry: Map<string, KnobHandle>, validIds: ReadonlySet<string>): void`.

Today `pruneKnobRegistry` only drops ids whose *lane* is gone, so deleting an insert from a surviving lane leaks its knobs forever, and `fx.*` ids (master + sends) are skipped entirely and never pruned under any circumstance. **Coordinate before starting: another session may be fixing this same file.**

- [ ] **Step 1: Write the failing test**

```ts
it('drops knobs for an insert that no longer exists, including on the master rack', () => {
  const registry = new Map<string, KnobHandle>([
    ['poly1.cutoff',            stub()],
    ['poly1.fx:gone.cutoff',    stub()],
    ['fx.master.fx:gone.gain',  stub()],
    ['fx.master.fx:alive.gain', stub()],
  ]);
  pruneKnobRegistryToDestinations(registry, new Set([
    'poly1.cutoff', 'fx.master.fx:alive.gain',
  ]));
  expect([...registry.keys()].sort()).toEqual(['fx.master.fx:alive.gain', 'poly1.cutoff']);
});

it('keeps a modulator config knob, which is never a destination', () => {
  const registry = new Map<string, KnobHandle>([['poly1.mod.lfo1.rate', stub()]]);
  pruneKnobRegistryToDestinations(registry, new Set());
  expect(registry.has('poly1.mod.lfo1.rate')).toBe(true);
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `NO_COLOR=1 npx vitest run src/app/knob-registry-prune.test.ts`
Expected: FAIL — function not exported.

- [ ] **Step 3: Implement**

```ts
/** Drop every handle that is not a live destination. Modulator-config knobs
 *  (`<lane>.mod.…`) are kept: they are real controls but never destinations,
 *  so the catalogue does not list them. */
export function pruneKnobRegistryToDestinations(
  registry: Map<string, KnobHandle>,
  validIds: ReadonlySet<string>,
): void {
  for (const id of [...registry.keys()]) {
    if (id.includes('.mod.')) continue;
    if (!validIds.has(id)) registry.delete(id);
  }
}
```

- [ ] **Step 4: Call it on invalidate**

In `src/main.ts`, subscribe once:

```ts
destinations.subscribe(() => {
  pruneKnobRegistryToDestinations(
    automationRegistry,
    new Set(destinations.list().map((t) => t.id)),
  );
});
```

Keep the old `pruneKnobRegistry` only if another call site still needs it; otherwise delete it and its test.

- [ ] **Step 5: Run tests and typecheck**

Run: `NO_COLOR=1 npm run test:unit && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "fix(automation): prune knobs whose destination is gone, master rack included"
git rebase main
```

---

### Task 12: Record the rule where a future session will actually read it

**Files:**
- Create: `docs/automation-destinations.md`
- Modify: `CLAUDE.md`
- Create: `C:\Users\nacho\.claude\projects\c--Users-nacho-git-tb303-synth\memory\project_destination_registry.md`
- Modify: `C:\Users\nacho\.claude\projects\c--Users-nacho-git-tb303-synth\memory\MEMORY.md`

The lesson learned in `61b516c` was written only as a file-header comment, so it reached one of four surfaces. A comment cannot prevent a mistake whose whole shape is not opening that file.

- [ ] **Step 1: Write the reference doc**

Create `docs/automation-destinations.md` covering: the one catalogue and why it derives from the session; the canonical id format with an example of each scope; that position is never identity; the subscribe/invalidate contract and the AbortController teardown rule; and an explicit "do not build a second list — call `destinations.list()`".

- [ ] **Step 2: Link it from CLAUDE.md**

Add under "When adding/changing things":

```markdown
- **Anything that lists parameters the user can target** (a modulation dropdown, an
  automation picker, an XY pad axis, a MIDI mapping) MUST call
  `DestinationRegistry.list()` from [src/automation/destination-registry.ts](src/automation/destination-registry.ts)
  and `subscribe()` to stay fresh. Do NOT enumerate the knob registry and do NOT
  build a parallel list — that is how four inconsistent pickers happened. See
  [docs/automation-destinations.md](docs/automation-destinations.md).
```

- [ ] **Step 3: Write the memory + index line**

Memory file `project_destination_registry.md`, type `project`, recording: what shipped, the canonical id format, that position is never identity, and the "never build a parallel list" rule. Add one line to `MEMORY.md`.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "docs(automation): the destination rule, where the next session will read it"
git rebase main
```

---

### Task 13: End-to-end verification

**Files:** none modified (unless a defect is found).

- [ ] **Step 1: Build, then run the full suite**

```bash
npm run build
NO_COLOR=1 npm test
```

Expected: PASS. `test:e2e` serves `dist/` with no build step, so the `npm run build` first is mandatory.

- [ ] **Step 2: Drive the real app**

Start `npm run dev` in the worktree, open Chrome (not the VS Code browser — its audio is unfaithful), then:

1. Add a lane, open its editor, add an **LFO**.
2. Add a **multifilter** insert to the same lane.
3. Open the LFO destination dropdown → **the filter's cutoff must be listed**, without reopening the panel.
4. Route the LFO to it and confirm the sound moves.
5. Add a **second** insert before it, then **delete** the first one.
6. Confirm the LFO still modulates the filter — not the other effect. This is the silent-repointing bug; it is the single most important check in this plan.
7. Open the clip automation picker and confirm the same filter param is offered there too — one id, both vias.

- [ ] **Step 3: Report honestly**

Record what was verified by ear and what only by test. Do not claim the UI is done without having looked at it.

---

## Risks

1. **Concurrent session.** Another session may be editing `knob-registry-prune.ts` (Task 11). Confirm ownership before starting that task.
2. **Task 3 is the only one that touches saved data.** A mistake there loses a user's modulation routings. Its tests are the ones to be strictest about.
3. **Subscription teardown (Tasks 6, 8).** Getting the AbortController wrong leaks listeners and double-redraws. If a panel starts redrawing twice, look here first.
4. **Task 10 changes what the APC's device bank drives** — the first 8 destinations of a lane now include insert params, so existing muscle memory shifts. Flag it to the user rather than assuming it is wanted.
