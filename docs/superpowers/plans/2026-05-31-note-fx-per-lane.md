# Note-FX per-lane Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the broken global arpeggiator with a per-lane "note-FX" plugin category (arp + chord generator) that lives in `lane.engineState`, so it serializes and loads with every demo like LFO/ADSR.

**Architecture:** Note-FX are pure `NoteFxEvent[] → NoteFxEvent[]` processors stored as an ordered chain in `lane.engineState.noteFx`. A per-lane `NoteFxChain` (sibling of `ModulationHostImpl`) folds the chain in `trigger-dispatch.ts` before firing voices. Plugins register via a new `'notefx'` `PluginKind`, discovered by the existing build-time glob. The legacy global arp singleton is removed.

**Tech Stack:** TypeScript, Vite, Web Audio (untouched by note-FX — they only decide which notes fire), Vitest (pure + integration), existing plugin registry.

**Spec:** `docs/superpowers/specs/2026-05-31-note-fx-per-lane-design.md`

**Conventions:** `NO_COLOR=1 npx vitest run <file>` for a single test file. `npx tsc --noEmit` to typecheck. Commit after each green step.

---

### Task 0: Isolated workspace (skill, not manual git)

**Files:** none (workspace setup).

- [ ] **Step 1: Create the worktree via the skill**

Invoke the `superpowers:using-git-worktrees` skill. It will detect isolation, then use the native `EnterWorktree` tool to create a branch+worktree named `notefx-per-lane`. Do NOT run `git worktree add` / `git checkout -b` manually.

- [ ] **Step 2: Install deps + baseline green**

Run: `npm install`
Run: `npx cross-env NO_COLOR=1 npx vitest run`
Expected: baseline suite passes (657+ tests). If red, stop and report before implementing.

---

### Task 1: Note-FX core types

**Files:**
- Create: `src/notefx/notefx-types.ts`

- [ ] **Step 1: Write the types** (no test — pure declarations)

```ts
// src/notefx/notefx-types.ts
// A note-FX transforms the stream of note events a lane is about to fire.
// 1 note in → 0..N notes out. Pure: no Web Audio.

export interface NoteFxEvent {
  note: number;      // MIDI note number
  time: number;      // absolute AudioContext seconds
  gate: number;      // seconds the note holds
  accent: boolean;
}

export interface NoteFxContext {
  bpm: number;
}

export interface NoteFxProcessor {
  process(input: NoteFxEvent[], ctx: NoteFxContext): NoteFxEvent[];
}

export type NoteFxKind = 'arp' | 'chord';

export interface NoteFxState {
  id: string;                 // 'arp1', 'chord1', …
  kind: NoteFxKind;
  enabled: boolean;
  params: Record<string, number | string>;
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: PASS (no consumers yet).

- [ ] **Step 3: Commit**

```bash
git add src/notefx/notefx-types.ts
git commit -m "feat(notefx): core note-FX event + processor types"
```

---

### Task 2: Arp pure logic relocation + processor

The arp's pure logic already exists in `src/arp/arp.ts` (`SCALE_INTERVALS`, `buildPool`, `generateArpSequence`, `arpIntervalSec`). Move it into a note-FX processor module, reused not rewritten. Keep `src/arp/arp.ts` untouched until Task 11 (removal) so nothing breaks mid-plan.

**Files:**
- Create: `src/notefx/arp-processor.ts`
- Test: `src/notefx/arp-processor.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/notefx/arp-processor.test.ts
import { describe, it, expect } from 'vitest';
import { ArpProcessor, ARP_PROCESSOR_DEFAULTS } from './arp-processor';
import type { NoteFxEvent } from './notefx-types';

const ev = (note: number): NoteFxEvent => ({ note, time: 0, gate: 1.0, accent: true });

describe('ArpProcessor', () => {
  it('passthrough when disabled params produce a single note (no expansion at gate 0)', () => {
    // A degenerate gate shorter than one interval yields exactly the root once.
    const p = new ArpProcessor({ ...ARP_PROCESSOR_DEFAULTS, rateFreeHz: 1, rate: 'free' });
    const out = p.process([{ note: 60, time: 0, gate: 0.001, accent: true }], { bpm: 120 });
    expect(out).toHaveLength(1);
    expect(out[0].note).toBe(60);
  });

  it("'up' over 1 octave pentMinor spreads ascending notes across the gate", () => {
    // pentMinor intervals [0,3,5,7,10]; 1 octave; free rate 10Hz → 0.1s interval.
    const p = new ArpProcessor({
      ...ARP_PROCESSOR_DEFAULTS,
      pattern: 'up', scale: 'pentMinor', octaves: 1, rate: 'free', rateFreeHz: 10, gate: 1.0,
    });
    const out = p.process([ev(60)], { bpm: 120 }); // gate 1.0s / 0.1s = 10 notes
    expect(out.length).toBe(10);
    expect(out[0].note).toBe(60);
    expect(out[1].note).toBe(63);   // +3
    expect(out[2].note).toBe(65);   // +5
    expect(out[0].time).toBeCloseTo(0, 5);
    expect(out[1].time).toBeCloseTo(0.1, 5);
    // accent only on the first step
    expect(out[0].accent).toBe(true);
    expect(out[1].accent).toBe(false);
  });

  it('processes EACH input note independently (chord → arp use case)', () => {
    const p = new ArpProcessor({
      ...ARP_PROCESSOR_DEFAULTS,
      pattern: 'up', scale: 'major', octaves: 1, rate: 'free', rateFreeHz: 10, gate: 1.0,
    });
    const out = p.process([ev(60), ev(67)], { bpm: 120 });
    // Two roots, each expanded; output contains both 60- and 67-rooted runs.
    expect(out.some((e) => e.note === 60)).toBe(true);
    expect(out.some((e) => e.note === 67)).toBe(true);
    expect(out.length).toBe(20);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `NO_COLOR=1 npx vitest run src/notefx/arp-processor.test.ts`
Expected: FAIL — `Cannot find module './arp-processor'`.

- [ ] **Step 3: Implement the processor**

Copy the pure helpers verbatim from `src/arp/arp.ts` (do not import from it — it is being deleted in Task 11). `syncDivToHz` stays imported from `../core/fx`.

```ts
// src/notefx/arp-processor.ts
import { type SyncDiv, syncDivToHz } from '../core/fx';
import type { NoteFxEvent, NoteFxContext, NoteFxProcessor } from './notefx-types';

export type ArpPattern = 'up' | 'down' | 'updown' | 'random' | 'cosmic';
export type ArpScale   = 'major' | 'minor' | 'pentMinor' | 'phrygian' | 'chromatic';

export interface ArpProcessorParams {
  pattern: ArpPattern;
  scale: ArpScale;
  rate: SyncDiv | 'free';
  rateFreeHz: number;
  octaves: number;
  gate: number;        // fraction (0.05..1) of the arp interval the note holds
}

export const ARP_PROCESSOR_DEFAULTS: ArpProcessorParams = {
  pattern: 'up', scale: 'pentMinor', rate: '1/16', rateFreeHz: 8, octaves: 2, gate: 0.7,
};

const SCALE_INTERVALS: Record<ArpScale, number[]> = {
  major:     [0, 2, 4, 5, 7, 9, 11],
  minor:     [0, 2, 3, 5, 7, 8, 10],
  pentMinor: [0, 3, 5, 7, 10],
  phrygian:  [0, 1, 3, 5, 7, 8, 10],
  chromatic: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
};

function buildPool(root: number, scale: ArpScale, octaves: number): number[] {
  const intervals = SCALE_INTERVALS[scale];
  const pool: number[] = [];
  for (let oct = 0; oct < octaves; oct++) {
    for (const iv of intervals) pool.push(root + iv + oct * 12);
  }
  return pool;
}

export function generateArpSequence(
  root: number, pattern: ArpPattern, octaves: number, scale: ArpScale, count: number,
): number[] {
  const pool = buildPool(root, scale, octaves);
  const out: number[] = [];
  switch (pattern) {
    case 'up':
      for (let i = 0; i < count; i++) out.push(pool[i % pool.length]);
      break;
    case 'down':
      for (let i = 0; i < count; i++) out.push(pool[pool.length - 1 - (i % pool.length)]);
      break;
    case 'updown': {
      const seq = pool.length > 1 ? [...pool, ...pool.slice(1, -1).reverse()] : pool;
      for (let i = 0; i < count; i++) out.push(seq[i % seq.length]);
      break;
    }
    case 'random':
      for (let i = 0; i < count; i++) out.push(pool[Math.floor(Math.random() * pool.length)]);
      break;
    case 'cosmic': {
      let idx = Math.floor(Math.random() * pool.length);
      for (let i = 0; i < count; i++) {
        if (Math.random() < 0.08) out.push(pool[idx] + 12);
        else out.push(pool[idx]);
        if (Math.random() < 0.18) idx = Math.floor(Math.random() * pool.length);
        else { idx += Math.random() < 0.5 ? -1 : 1; if (idx < 0) idx = pool.length - 1; if (idx >= pool.length) idx = 0; }
      }
      break;
    }
  }
  return out;
}

function intervalSec(p: ArpProcessorParams, bpm: number): number {
  if (p.rate === 'free') return 1 / Math.max(0.001, p.rateFreeHz);
  const hz = syncDivToHz(bpm, p.rate);
  return hz > 0 ? 1 / hz : 1 / Math.max(0.001, p.rateFreeHz);
}

export class ArpProcessor implements NoteFxProcessor {
  constructor(private params: ArpProcessorParams) {}

  process(input: NoteFxEvent[], ctx: NoteFxContext): NoteFxEvent[] {
    const p = this.params;
    const out: NoteFxEvent[] = [];
    const interval = intervalSec(p, ctx.bpm);
    const noteGate = Math.max(0.01, interval * p.gate);
    for (const e of input) {
      const numNotes = Math.max(1, Math.floor(e.gate / interval));
      const notes = generateArpSequence(e.note, p.pattern, p.octaves, p.scale, numNotes);
      for (let i = 0; i < numNotes; i++) {
        out.push({ note: notes[i], time: e.time + i * interval, gate: noteGate, accent: e.accent && i === 0 });
      }
    }
    return out;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `NO_COLOR=1 npx vitest run src/notefx/arp-processor.test.ts`
Expected: PASS (4 assertions in 3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/notefx/arp-processor.ts src/notefx/arp-processor.test.ts
git commit -m "feat(notefx): arp processor (pure logic ported from src/arp)"
```

---

### Task 3: Chord pure processor

**Files:**
- Create: `src/notefx/chord-processor.ts`
- Test: `src/notefx/chord-processor.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/notefx/chord-processor.test.ts
import { describe, it, expect } from 'vitest';
import { ChordProcessor, CHORD_PROCESSOR_DEFAULTS } from './chord-processor';
import type { NoteFxEvent } from './notefx-types';

const ev = (note: number): NoteFxEvent => ({ note, time: 0.5, gate: 1.0, accent: true });

describe('ChordProcessor', () => {
  it('major triad: 1 note → 3 simultaneous notes at the same time/gate', () => {
    const p = new ChordProcessor({ ...CHORD_PROCESSOR_DEFAULTS, chordType: 'maj' });
    const out = p.process([ev(60)], { bpm: 120 });
    expect(out.map((e) => e.note)).toEqual([60, 64, 67]); // root, +4, +7
    expect(out.every((e) => e.time === 0.5)).toBe(true);
    expect(out.every((e) => e.gate === 1.0)).toBe(true);
  });

  it('minor triad uses a flat third', () => {
    const p = new ChordProcessor({ ...CHORD_PROCESSOR_DEFAULTS, chordType: 'min' });
    expect(p.process([ev(60)], { bpm: 120 }).map((e) => e.note)).toEqual([60, 63, 67]);
  });

  it('accent propagates to every chord note', () => {
    const p = new ChordProcessor({ ...CHORD_PROCESSOR_DEFAULTS, chordType: 'maj' });
    const out = p.process([{ note: 60, time: 0, gate: 1, accent: true }], { bpm: 120 });
    expect(out.every((e) => e.accent === true)).toBe(true);
  });

  it('octave shift transposes the whole chord', () => {
    const p = new ChordProcessor({ ...CHORD_PROCESSOR_DEFAULTS, chordType: 'maj', octave: 1 });
    expect(p.process([ev(60)], { bpm: 120 }).map((e) => e.note)).toEqual([72, 76, 79]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `NO_COLOR=1 npx vitest run src/notefx/chord-processor.test.ts`
Expected: FAIL — `Cannot find module './chord-processor'`.

- [ ] **Step 3: Implement the processor**

```ts
// src/notefx/chord-processor.ts
import type { NoteFxEvent, NoteFxContext, NoteFxProcessor } from './notefx-types';

export type ChordType = 'maj' | 'min' | 'maj7' | 'min7' | 'sus2' | 'sus4' | 'dim';

export interface ChordProcessorParams {
  chordType: ChordType;
  octave: number;       // -2..+2 octave shift applied to all chord notes
}

export const CHORD_PROCESSOR_DEFAULTS: ChordProcessorParams = { chordType: 'maj', octave: 0 };

const CHORD_INTERVALS: Record<ChordType, number[]> = {
  maj:  [0, 4, 7],
  min:  [0, 3, 7],
  maj7: [0, 4, 7, 11],
  min7: [0, 3, 7, 10],
  sus2: [0, 2, 7],
  sus4: [0, 5, 7],
  dim:  [0, 3, 6],
};

export class ChordProcessor implements NoteFxProcessor {
  constructor(private params: ChordProcessorParams) {}

  process(input: NoteFxEvent[], _ctx: NoteFxContext): NoteFxEvent[] {
    const intervals = CHORD_INTERVALS[this.params.chordType];
    const shift = this.params.octave * 12;
    const out: NoteFxEvent[] = [];
    for (const e of input) {
      for (const iv of intervals) {
        out.push({ note: e.note + iv + shift, time: e.time, gate: e.gate, accent: e.accent });
      }
    }
    return out;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `NO_COLOR=1 npx vitest run src/notefx/chord-processor.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/notefx/chord-processor.ts src/notefx/chord-processor.test.ts
git commit -m "feat(notefx): chord processor (1 note -> simultaneous chord)"
```

---

### Task 4: NoteFxChain (per-lane CRUD + ordered fold)

**Files:**
- Create: `src/notefx/notefx-chain.ts`
- Test: `src/notefx/notefx-chain.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/notefx/notefx-chain.test.ts
import { describe, it, expect } from 'vitest';
import { NoteFxChain } from './notefx-chain';
import type { NoteFxEvent } from './notefx-types';

const root = (): NoteFxEvent[] => [{ note: 60, time: 0, gate: 1.0, accent: true }];

describe('NoteFxChain', () => {
  it('empty chain is passthrough', () => {
    const chain = new NoteFxChain([]);
    expect(chain.process(root(), { bpm: 120 })).toEqual(root());
  });

  it('addNoteFx assigns kind-prefixed unique ids', () => {
    const chain = new NoteFxChain([]);
    const a = chain.addNoteFx('arp');
    const b = chain.addNoteFx('chord');
    const c = chain.addNoteFx('arp');
    expect([a.id, b.id, c.id]).toEqual(['arp1', 'chord1', 'arp2']);
  });

  it('applies in order of addition: chord then arp arpeggiates the chord', () => {
    const chain = new NoteFxChain([]);
    const chord = chain.addNoteFx('chord');     // maj triad by default
    chord.params = { chordType: 'maj', octave: 0 };
    const arp = chain.addNoteFx('arp');
    arp.params = { pattern: 'up', scale: 'chromatic', octaves: 1, rate: 'free', rateFreeHz: 10, gate: 0.5 };
    const out = chain.process(root(), { bpm: 120 });
    // chord makes 3 notes; arp expands each across the 1s gate → many notes
    expect(out.length).toBeGreaterThan(3);
  });

  it('disabled note-FX are skipped', () => {
    const chain = new NoteFxChain([]);
    const chord = chain.addNoteFx('chord');
    chord.enabled = false;
    expect(chain.process(root(), { bpm: 120 })).toEqual(root());
  });

  it('removeNoteFx drops by id; serialize/deserialize round-trips', () => {
    const chain = new NoteFxChain([]);
    chain.addNoteFx('arp');
    const chord = chain.addNoteFx('chord');
    chain.removeNoteFx('arp1');
    expect(chain.serialize().map((s) => s.id)).toEqual(['chord1']);
    const chain2 = new NoteFxChain([]);
    chain2.deserialize(chain.serialize());
    expect(chain2.serialize()).toEqual([{ ...chord }]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `NO_COLOR=1 npx vitest run src/notefx/notefx-chain.test.ts`
Expected: FAIL — `Cannot find module './notefx-chain'`.

- [ ] **Step 3: Implement the chain**

```ts
// src/notefx/notefx-chain.ts
import type {
  NoteFxEvent, NoteFxContext, NoteFxProcessor, NoteFxState, NoteFxKind,
} from './notefx-types';
import { ArpProcessor, ARP_PROCESSOR_DEFAULTS, type ArpProcessorParams } from './arp-processor';
import { ChordProcessor, CHORD_PROCESSOR_DEFAULTS, type ChordProcessorParams } from './chord-processor';

function defaultParams(kind: NoteFxKind): Record<string, number | string> {
  return kind === 'arp'
    ? { ...ARP_PROCESSOR_DEFAULTS } as unknown as Record<string, number | string>
    : { ...CHORD_PROCESSOR_DEFAULTS } as unknown as Record<string, number | string>;
}

function makeProcessor(s: NoteFxState): NoteFxProcessor {
  if (s.kind === 'arp')   return new ArpProcessor(s.params as unknown as ArpProcessorParams);
  return new ChordProcessor(s.params as unknown as ChordProcessorParams);
}

export class NoteFxChain {
  noteFx: NoteFxState[];

  constructor(initial: NoteFxState[]) {
    this.noteFx = initial.map((s) => ({ ...s, params: { ...s.params } }));
  }

  addNoteFx(kind: NoteFxKind): NoteFxState {
    const prefix = kind;
    const used = new Set(this.noteFx.filter((s) => s.kind === kind).map((s) => s.id));
    let n = 1;
    while (used.has(`${prefix}${n}`)) n++;
    const fresh: NoteFxState = { id: `${prefix}${n}`, kind, enabled: true, params: defaultParams(kind) };
    this.noteFx.push(fresh);
    return fresh;
  }

  removeNoteFx(id: string): void {
    const i = this.noteFx.findIndex((s) => s.id === id);
    if (i >= 0) this.noteFx.splice(i, 1);
  }

  process(input: NoteFxEvent[], ctx: NoteFxContext): NoteFxEvent[] {
    let events = input;
    for (const s of this.noteFx) {
      if (!s.enabled) continue;
      events = makeProcessor(s).process(events, ctx);
    }
    return events;
  }

  serialize(): NoteFxState[] {
    return this.noteFx.map((s) => ({ ...s, params: { ...s.params } }));
  }

  deserialize(state: NoteFxState[]): void {
    this.noteFx = state.map((s) => ({ ...s, params: { ...s.params } }));
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `NO_COLOR=1 npx vitest run src/notefx/notefx-chain.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/notefx/notefx-chain.ts src/notefx/notefx-chain.test.ts
git commit -m "feat(notefx): NoteFxChain — ordered CRUD + fold + serialize"
```

---

### Task 5: Persist note-FX in the session model

**Files:**
- Modify: `src/session/session.ts` (the `engineState` type on `SessionLane`, ~L50-54)
- Modify: `src/session/session-engine-state.ts` (add `syncNoteFx`)
- Test: `src/session/session-engine-state.test.ts` (append a case)

- [ ] **Step 1: Add `noteFx` to the engineState type**

In `src/session/session.ts`, the `SessionLane.engineState` object type currently is:

```ts
  engineState?: {
    params?: Record<string, number>;
    modulators?: import('../modulation/types').ModulatorState[];
    sampler?: { keymap: import('../samples/types').KeymapEntry[] };
  };
```

Add the `noteFx` field:

```ts
  engineState?: {
    params?: Record<string, number>;
    modulators?: import('../modulation/types').ModulatorState[];
    noteFx?: import('../notefx/notefx-types').NoteFxState[];
    sampler?: { keymap: import('../samples/types').KeymapEntry[] };
  };
```

- [ ] **Step 2: Write the failing test for `syncNoteFx`**

Append to `src/session/session-engine-state.test.ts`:

```ts
import { syncNoteFx } from './session-engine-state';
import type { NoteFxState } from '../notefx/notefx-types';

describe('syncNoteFx', () => {
  it('writes a deep-cloned note-FX array into lane.engineState.noteFx', () => {
    const state = { lanes: [{ id: 'sub-1', engineId: 'subtractive', clips: [] }], scenes: [], globalQuantize: '1/1' } as any;
    const fx: NoteFxState[] = [{ id: 'arp1', kind: 'arp', enabled: true, params: { octaves: 2 } }];
    syncNoteFx(state, 'sub-1', fx);
    expect(state.lanes[0].engineState.noteFx).toEqual(fx);
    // deep clone — mutating source does not leak
    fx[0].params.octaves = 4;
    expect(state.lanes[0].engineState.noteFx[0].params.octaves).toBe(2);
  });

  it('is a no-op for an unknown lane', () => {
    const state = { lanes: [], scenes: [], globalQuantize: '1/1' } as any;
    expect(() => syncNoteFx(state, 'nope', [])).not.toThrow();
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `NO_COLOR=1 npx vitest run src/session/session-engine-state.test.ts`
Expected: FAIL — `syncNoteFx is not exported`.

- [ ] **Step 4: Implement `syncNoteFx`**

Append to `src/session/session-engine-state.ts` (mirror of `syncModulators`):

```ts
import type { NoteFxState } from '../notefx/notefx-types';

/** Writes a deep-cloned copy of the note-FX array into
 *  `state.lanes[laneId].engineState.noteFx`. No-op if lane is unknown. */
export function syncNoteFx(
  state: SessionState,
  laneId: string,
  noteFx: NoteFxState[],
): void {
  const lane = state.lanes.find((l) => l.id === laneId);
  if (!lane) return;
  if (!lane.engineState) lane.engineState = {};
  lane.engineState.noteFx = JSON.parse(JSON.stringify(noteFx));
}
```

- [ ] **Step 5: Run test + typecheck**

Run: `NO_COLOR=1 npx vitest run src/session/session-engine-state.test.ts`
Run: `npx tsc --noEmit`
Expected: PASS, PASS.

- [ ] **Step 6: Commit**

```bash
git add src/session/session.ts src/session/session-engine-state.ts src/session/session-engine-state.test.ts
git commit -m "feat(notefx): persist note-FX chain in lane.engineState"
```

---

### Task 6: Per-lane NoteFxChain ownership + load-on-demo

Each lane needs its own `NoteFxChain`. The lane resource map already owns per-lane modulation state; note-FX is a pure per-lane object keyed by laneId. Use a module-level `Map<laneId, NoteFxChain>` in a small registry so `trigger-dispatch` and the UI share the same instance, mirroring how the arp was a singleton but now per-lane.

**Files:**
- Create: `src/notefx/notefx-registry.ts`
- Test: `src/notefx/notefx-registry.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/notefx/notefx-registry.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { getNoteFxChain, loadNoteFxForLane, _resetNoteFxRegistry } from './notefx-registry';

describe('notefx-registry', () => {
  beforeEach(() => { _resetNoteFxRegistry(); });

  it('getNoteFxChain returns the same instance per lane', () => {
    const a = getNoteFxChain('sub-1');
    const b = getNoteFxChain('sub-1');
    expect(a).toBe(b);
    expect(getNoteFxChain('sub-2')).not.toBe(a);
  });

  it('loadNoteFxForLane replaces the chain contents from saved state (the demo-load fix)', () => {
    const chain = getNoteFxChain('sub-1');
    chain.addNoteFx('arp');
    loadNoteFxForLane('sub-1', [{ id: 'chord1', kind: 'chord', enabled: true, params: { chordType: 'maj', octave: 0 } }]);
    expect(getNoteFxChain('sub-1').serialize().map((s) => s.id)).toEqual(['chord1']);
  });

  it('loadNoteFxForLane with undefined clears the chain (passthrough)', () => {
    const chain = getNoteFxChain('sub-1');
    chain.addNoteFx('arp');
    loadNoteFxForLane('sub-1', undefined);
    expect(getNoteFxChain('sub-1').serialize()).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `NO_COLOR=1 npx vitest run src/notefx/notefx-registry.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the registry**

```ts
// src/notefx/notefx-registry.ts
// Per-lane NoteFxChain instances, shared between the trigger path and the UI.
// Replaces the old global arp singleton with one chain per lane id.
import { NoteFxChain } from './notefx-chain';
import type { NoteFxState } from './notefx-types';

const chains = new Map<string, NoteFxChain>();

export function getNoteFxChain(laneId: string): NoteFxChain {
  let c = chains.get(laneId);
  if (!c) { c = new NoteFxChain([]); chains.set(laneId, c); }
  return c;
}

/** Replace a lane's chain contents from saved state. `undefined` clears it
 *  (passthrough). Called on demo/session load so note-FX follow the demo. */
export function loadNoteFxForLane(laneId: string, state: NoteFxState[] | undefined): void {
  getNoteFxChain(laneId).deserialize(state ?? []);
}

/** Test-only. */
export function _resetNoteFxRegistry(): void { chains.clear(); }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `NO_COLOR=1 npx vitest run src/notefx/notefx-registry.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/notefx/notefx-registry.ts src/notefx/notefx-registry.test.ts
git commit -m "feat(notefx): per-lane chain registry + load-on-demo helper"
```

---

### Task 7: Wire note-FX into the session save + restore paths

This is the fix for "the arp stays on the initial demo's config." `SessionHost`
already (a) serializes each lane's modulators into `engineState.modulators` on
save in `collectEngineState()` and (b) restores `engineState.modulators` into the
live engine on demo/session load in `applyLoadedSessionState()`. Add the note-FX
equivalent in BOTH places, reading/writing the per-lane `NoteFxChain` from the
registry.

**Files:**
- Modify: `src/session/session-host.ts`
  - `collectEngineState()` — currently `src/session/session-host.ts:276-291`; the
    modulators-serialize block is at `:287-289`.
  - `applyLoadedSessionState()` restore loop — the modulators-restore block is at
    `src/session/session-host.ts:302-307`
    (`const mods = lane.engineState?.modulators; … host.deserialize(mods)`).
  - **Locate by content, not line** — quoted below.

- [ ] **Step 1: Add the import**

At the top of `src/session/session-host.ts`, add:

```ts
import { getNoteFxChain, loadNoteFxForLane } from '../notefx/notefx-registry';
```

- [ ] **Step 2: Save side — mirror the chain in `collectEngineState()`**

Find this block in `collectEngineState()`:

```ts
        if (!lane.engineState) lane.engineState = {};
        lane.engineState.modulators =
          host.serialize() as import('../modulation/types').ModulatorState[];
      }
```

Immediately after the closing `}` of the `if (host)` block (still inside the
`for (const lane of this.state.lanes)` loop), add:

```ts
      // Mirror the lane's note-FX chain so it persists on save.
      if (!lane.engineState) lane.engineState = {};
      lane.engineState.noteFx = getNoteFxChain(lane.id).serialize();
```

- [ ] **Step 3: Restore side — load the chain in `applyLoadedSessionState()`**

Find this block in the restore loop:

```ts
      // Restore modulator state.
      const mods = lane.engineState?.modulators;
      if (mods) {
        const host = (engine as { modulators?: { deserialize(s: unknown[]): void } } | undefined)?.modulators;
        if (host) host.deserialize(mods);
      }
```

Immediately after it, add:

```ts
      // Restore the lane's note-FX chain so it follows the loaded demo
      // (fixes the global-arp bug where note-FX kept the first demo's config).
      loadNoteFxForLane(lane.id, lane.engineState?.noteFx);
```

- [ ] **Step 4: Typecheck + full suite**

Run: `npx tsc --noEmit`
Run: `NO_COLOR=1 npx vitest run`
Expected: PASS, PASS (no audible change yet — nothing reads the chain in the
trigger path until Task 8).

- [ ] **Step 5: Commit**

```bash
git add src/session/session-host.ts
git commit -m "feat(notefx): persist + restore per-lane note-FX chain across demo loads"
```

---

### Task 8: Apply the chain in the trigger path (replace scheduleArpForNote)

**Files:**
- Modify: `src/app/trigger-dispatch.ts`
- Test: `src/app/trigger-dispatch.test.ts` (create)

- [ ] **Step 1: Write the failing test**

```ts
// src/app/trigger-dispatch.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { createTriggerForLane } from './trigger-dispatch';
import { getNoteFxChain, _resetNoteFxRegistry } from '../notefx/notefx-registry';

function fakeDeps(fired: Array<{ note: number; time: number }>) {
  const engine = {
    id: 'subtractive',
    createVoice: () => ({ trigger: (note: number, time: number) => fired.push({ note, time }) }),
  };
  return {
    ctx: {} as AudioContext,
    laneResources: { get: (_id: string) => ({ engine, strip: { input: {} } }) } as any,
    seq: { bpm: 120 } as any,
  };
}

describe('createTriggerForLane note-FX integration', () => {
  beforeEach(() => { _resetNoteFxRegistry(); });

  it('with an empty chain, fires exactly the input note (passthrough)', () => {
    const fired: Array<{ note: number; time: number }> = [];
    const trigger = createTriggerForLane(fakeDeps(fired));
    trigger('sub-1', 60, 0, 1.0, false);
    expect(fired).toEqual([{ note: 60, time: 0 }]);
  });

  it('with a chord note-FX, fires the whole chord', () => {
    const fired: Array<{ note: number; time: number }> = [];
    const chain = getNoteFxChain('sub-1');
    const chord = chain.addNoteFx('chord');
    chord.params = { chordType: 'maj', octave: 0 };
    const trigger = createTriggerForLane(fakeDeps(fired));
    trigger('sub-1', 60, 0, 1.0, false);
    expect(fired.map((f) => f.note)).toEqual([60, 64, 67]);
  });
});
```

NOTE: the exact `fakeDeps` shape must match the real `TriggerDispatchDeps` after the `arp` field is removed. Adjust the mock to the final interface (no `arp` field).

- [ ] **Step 2: Run test to verify it fails**

Run: `NO_COLOR=1 npx vitest run src/app/trigger-dispatch.test.ts`
Expected: FAIL (chord case fires only `[60]`, or import/shape error).

- [ ] **Step 3: Rewrite the dispatcher to fold the chain**

Replace the arp branch in `src/app/trigger-dispatch.ts`. Remove `import { scheduleArpForNote } from '../arp/arp';`, remove `import type { arp as ArpSingleton } from '../arp/arp-ui';`, and remove the `arp` field from `TriggerDispatchDeps`. New body:

```ts
import { setCurrentLaneForVoice } from '../modulation/active-mods';
import { getNoteFxChain } from '../notefx/notefx-registry';
import type { LaneResourceMap } from '../core/lane-resources';
import type { Sequencer } from '../core/sequencer';

export type TriggerForLane = (
  laneId: string, note: number, time: number, gate: number,
  accent: boolean, slidingIn?: boolean,
  sample?: import('../session/session').ClipSample,
) => void;

export interface TriggerDispatchDeps {
  ctx: AudioContext;
  laneResources: LaneResourceMap;
  seq: Sequencer;
}

export function createTriggerForLane(deps: TriggerDispatchDeps): TriggerForLane {
  return (laneId, note, time, gate, accent, slidingIn = false, sample) => {
    const res = deps.laneResources.get(laneId);
    if (!res) return;
    const engineId = res.engine.id;

    const fire = (m: number, t: number, g: number, a: boolean, sl: boolean) => {
      setCurrentLaneForVoice(laneId);
      const v = res.engine.createVoice(deps.ctx, res.strip.input);
      setCurrentLaneForVoice(null);
      v.trigger(m, t, { gateDuration: g, accent: a, slide: sl, sample });
    };

    // Audio clips bypass note-FX; drums lanes are not note-transformed.
    const chain = sample == null && engineId !== 'drums-machine'
      ? getNoteFxChain(laneId)
      : null;

    if (chain && chain.noteFx.some((s) => s.enabled)) {
      const events = chain.process([{ note, time, gate, accent }], { bpm: deps.seq.bpm });
      for (const e of events) fire(e.note, e.time, e.gate, e.accent, false);
      return;
    }
    fire(note, time, gate, accent, slidingIn);
  };
}
```

- [ ] **Step 4: Remove the `arp` field from the deps construction site**

In `src/main.ts`, find where `createTriggerForLane({ ... arp, ... })` is built (the `arp` is threaded in around L331). Remove `arp` from that object literal.

- [ ] **Step 5: Run test + typecheck**

Run: `NO_COLOR=1 npx vitest run src/app/trigger-dispatch.test.ts`
Run: `npx tsc --noEmit`
Expected: PASS, PASS.

- [ ] **Step 6: Commit**

```bash
git add src/app/trigger-dispatch.ts src/app/trigger-dispatch.test.ts src/main.ts
git commit -m "feat(notefx): fold per-lane note-FX chain in the trigger path"
```

---

### Task 9: Per-lane NOTE FX panel UI

Mirror the modulators panel. Render into the lane inspector next to MODULATORS.

**Files:**
- Create: `src/notefx/notefx-ui.ts`
- Modify: `src/session/session-host.ts` (call the panel from `injectEngineModulatorPanelInner`, near the existing `renderModulatorsPanel` call — **confirm exact line**)

- [ ] **Step 1: Implement the panel renderer**

```ts
// src/notefx/notefx-ui.ts
import type { NoteFxChain } from './notefx-chain';
import type { NoteFxState } from './notefx-types';

export interface NoteFxUIDeps {
  laneId: string;
  chain: NoteFxChain;
  /** Mirror chain state into the session so it persists + loads with demos. */
  onChange: (noteFx: NoteFxState[]) => void;
}

const ARP_PATTERNS = ['up', 'down', 'updown', 'random', 'cosmic'];
const ARP_SCALES = ['major', 'minor', 'pentMinor', 'phrygian', 'chromatic'];
const ARP_RATES = ['free', '1/4', '1/8', '1/8t', '1/16', '1/16t', '1/32'];
const CHORD_TYPES = ['maj', 'min', 'maj7', 'min7', 'sus2', 'sus4', 'dim'];

export function renderNoteFxPanel(container: HTMLElement, deps: NoteFxUIDeps): void {
  const box = document.createElement('div');
  box.className = 'notefx-panel';
  const title = document.createElement('div');
  title.className = 'mod-panel-title';
  title.textContent = 'NOTE FX';
  box.appendChild(title);

  const sync = () => deps.onChange(deps.chain.serialize());
  const rerender = () => { container.innerHTML = ''; renderNoteFxPanel(container, deps); };

  const header = document.createElement('div');
  header.className = 'mod-panel-header';
  for (const kind of ['arp', 'chord'] as const) {
    const b = document.createElement('button');
    b.className = 'rnd';
    b.textContent = `+ ${kind === 'arp' ? 'Arp' : 'Chord'}`;
    b.addEventListener('click', () => { deps.chain.addNoteFx(kind); sync(); rerender(); });
    header.appendChild(b);
  }
  box.appendChild(header);

  for (const fx of deps.chain.noteFx) box.appendChild(renderCard(fx, deps, sync, rerender));
  container.appendChild(box);
}

function mkSelect(
  label: string, opts: string[], value: string, onChange: (v: string) => void,
): HTMLElement {
  const wrap = document.createElement('label');
  wrap.className = 'notefx-field';
  wrap.append(document.createTextNode(label));
  const sel = document.createElement('select');
  for (const o of opts) {
    const opt = document.createElement('option');
    opt.value = o; opt.textContent = o;
    if (o === value) opt.selected = true;
    sel.appendChild(opt);
  }
  sel.addEventListener('change', () => onChange(sel.value));
  wrap.appendChild(sel);
  return wrap;
}

function renderCard(
  fx: NoteFxState, deps: NoteFxUIDeps, sync: () => void, rerender: () => void,
): HTMLElement {
  const card = document.createElement('div');
  card.className = `notefx-card notefx-${fx.kind}`;

  const row = document.createElement('div');
  row.className = 'notefx-card-row';
  const titleEl = document.createElement('span');
  titleEl.textContent = fx.id.toUpperCase();
  row.appendChild(titleEl);

  const enable = document.createElement('button');
  enable.className = 'rnd' + (fx.enabled ? ' primary' : '');
  enable.textContent = fx.enabled ? 'ON' : 'OFF';
  enable.addEventListener('click', () => { fx.enabled = !fx.enabled; sync(); rerender(); });
  row.appendChild(enable);

  const rm = document.createElement('button');
  rm.className = 'rnd';
  rm.textContent = '×';
  rm.addEventListener('click', () => { deps.chain.removeNoteFx(fx.id); sync(); rerender(); });
  row.appendChild(rm);
  card.appendChild(row);

  const set = (k: string, v: string | number) => { fx.params[k] = v; sync(); };

  if (fx.kind === 'arp') {
    card.appendChild(mkSelect('PATTERN', ARP_PATTERNS, String(fx.params.pattern ?? 'up'), (v) => set('pattern', v)));
    card.appendChild(mkSelect('SCALE', ARP_SCALES, String(fx.params.scale ?? 'pentMinor'), (v) => set('scale', v)));
    card.appendChild(mkSelect('RATE', ARP_RATES, String(fx.params.rate ?? '1/16'), (v) => set('rate', v)));
    card.appendChild(numberField('OCT', 1, 4, 1, Number(fx.params.octaves ?? 2), (v) => set('octaves', v)));
    card.appendChild(numberField('GATE', 0.05, 1, 0.01, Number(fx.params.gate ?? 0.7), (v) => set('gate', v)));
    card.appendChild(numberField('FREE Hz', 0.5, 32, 0.1, Number(fx.params.rateFreeHz ?? 8), (v) => set('rateFreeHz', v)));
  } else {
    card.appendChild(mkSelect('CHORD', CHORD_TYPES, String(fx.params.chordType ?? 'maj'), (v) => set('chordType', v)));
    card.appendChild(numberField('OCT', -2, 2, 1, Number(fx.params.octave ?? 0), (v) => set('octave', v)));
  }
  return card;
}

function numberField(
  label: string, min: number, max: number, step: number, value: number, onChange: (v: number) => void,
): HTMLElement {
  const wrap = document.createElement('label');
  wrap.className = 'notefx-field';
  wrap.append(document.createTextNode(label));
  const inp = document.createElement('input');
  inp.type = 'range';
  inp.min = String(min); inp.max = String(max); inp.step = String(step); inp.value = String(value);
  inp.addEventListener('input', () => onChange(Number(inp.value)));
  wrap.appendChild(inp);
  return wrap;
}
```

- [ ] **Step 2: Mount it in the inspector**

In `src/session/session-host.ts`, inside `injectEngineModulatorPanelInner` (where `renderModulatorsPanel` is called), append a note-FX panel for non-drum lanes. Add imports:

```ts
import { renderNoteFxPanel } from '../notefx/notefx-ui';
import { getNoteFxChain } from '../notefx/notefx-registry';
import { syncNoteFx } from './session-engine-state';
```

After the modulators panel is rendered, for a non-drum lane:

```ts
if (engine.id !== 'drums-machine') {
  const nfHost = document.createElement('div');
  nfHost.className = 'lane-notefx-panel-host';
  mountEl.appendChild(nfHost);
  renderNoteFxPanel(nfHost, {
    laneId,
    chain: getNoteFxChain(laneId),
    onChange: (noteFx) => { if (this.deps.sessionState) syncNoteFx(this.deps.sessionState, laneId, noteFx); },
  });
}
```

(Confirm the exact `sessionState` accessor name used elsewhere in `session-host.ts`; reuse the same one the modulators panel uses for `syncModulators`.)

- [ ] **Step 3: Typecheck + build**

Run: `npx tsc --noEmit`
Run: `npm run build`
Expected: PASS, PASS.

- [ ] **Step 4: Commit**

```bash
git add src/notefx/notefx-ui.ts src/session/session-host.ts
git commit -m "feat(notefx): per-lane NOTE FX inspector panel (arp + chord)"
```

---

### Task 10: Register arp + chord as discoverable plugins (optional registry parity)

The chain instantiates processors directly (Task 4), so the registry is not strictly required to make note-FX work. Register them anyway for parity with modulators/fx and to surface them in any future plugin-driven UI. Add a `'notefx'` plugin kind.

**Files:**
- Modify: `src/plugins/types.ts` (add `'notefx'` to `PluginKind`)
- Create: `src/plugins/notefx/arp.ts`, `src/plugins/notefx/chord.ts`
- Test: `src/plugins/notefx/notefx-plugins.test.ts`

- [ ] **Step 1: Add the kind**

In `src/plugins/types.ts`: `export type PluginKind = 'synth' | 'fx' | 'modulator' | 'notefx';`
Add a `NoteFxPluginFactory` variant to the `PluginFactory` union:

```ts
export interface NoteFxManifest { id: string; name: string; kind: 'notefx'; version: string; }
export interface NoteFxFactory {
  kind: 'notefx';
  manifest: NoteFxManifest;
  /** Returns default params for a fresh instance of this note-FX. */
  defaultParams(): Record<string, number | string>;
}
```
Add `| NoteFxFactory` to `PluginFactory`.

- [ ] **Step 2: Write the failing test**

```ts
// src/plugins/notefx/notefx-plugins.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { registerPlugin, listPlugins, _resetRegistry } from '../registry';
import { arpNoteFxPlugin } from './arp';
import { chordNoteFxPlugin } from './chord';

describe('note-FX plugins register', () => {
  beforeEach(() => { _resetRegistry(); });
  it('arp + chord appear under the notefx kind', () => {
    registerPlugin(arpNoteFxPlugin);
    registerPlugin(chordNoteFxPlugin);
    const ids = listPlugins('notefx').map((p) => p.manifest.id).sort();
    expect(ids).toEqual(['arp', 'chord']);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `NO_COLOR=1 npx vitest run src/plugins/notefx/notefx-plugins.test.ts`
Expected: FAIL — modules not found.

- [ ] **Step 4: Implement the plugin descriptors**

```ts
// src/plugins/notefx/arp.ts
import { registerPlugin } from '../registry';
import { ARP_PROCESSOR_DEFAULTS } from '../../notefx/arp-processor';
import type { NoteFxFactory } from '../types';

export const arpNoteFxPlugin: NoteFxFactory = {
  kind: 'notefx',
  manifest: { id: 'arp', name: 'Arpeggiator', kind: 'notefx', version: '1.0.0' },
  defaultParams: () => ({ ...ARP_PROCESSOR_DEFAULTS } as unknown as Record<string, number | string>),
};
registerPlugin(arpNoteFxPlugin);
```

```ts
// src/plugins/notefx/chord.ts
import { registerPlugin } from '../registry';
import { CHORD_PROCESSOR_DEFAULTS } from '../../notefx/chord-processor';
import type { NoteFxFactory } from '../types';

export const chordNoteFxPlugin: NoteFxFactory = {
  kind: 'notefx',
  manifest: { id: 'chord', name: 'Chord', kind: 'notefx', version: '1.0.0' },
  defaultParams: () => ({ ...CHORD_PROCESSOR_DEFAULTS } as unknown as Record<string, number | string>),
};
registerPlugin(chordNoteFxPlugin);
```

The build-time glob `import.meta.glob('../plugins/**/*.ts')` discovers these automatically — no manual import.

- [ ] **Step 5: Run test + typecheck**

Run: `NO_COLOR=1 npx vitest run src/plugins/notefx/notefx-plugins.test.ts`
Run: `npx tsc --noEmit`
Expected: PASS, PASS.

- [ ] **Step 6: Commit**

```bash
git add src/plugins/types.ts src/plugins/notefx/arp.ts src/plugins/notefx/chord.ts src/plugins/notefx/notefx-plugins.test.ts
git commit -m "feat(notefx): register arp + chord under the notefx plugin kind"
```

---

### Task 11: Remove the legacy global arp

**Files:**
- Delete: `src/arp/arp.ts`, `src/arp/arp-ui.ts`
- Modify: `src/main.ts` (remove `arp`, `buildArpUI`, `ArpUIDeps`, `arpUIDeps`, the two `buildArpUI(arpUIDeps)` calls, and the `arp` import)
- Modify: `index.html` (remove `<details class="arp-panel">…</details>` and the `.synth > .arp-panel` CSS rule)

- [ ] **Step 1: Delete the legacy modules**

```bash
git rm src/arp/arp.ts src/arp/arp-ui.ts
```

- [ ] **Step 2: Strip the wiring from `main.ts`**

Remove `import { arp, buildArpUI, type ArpUIDeps } from './arp/arp-ui';`, the `arpUIDeps` const, both `buildArpUI(arpUIDeps)` calls, and any remaining `arp` reference in the `createTriggerForLane`/dispatch deps (already removed in Task 8).

- [ ] **Step 3: Remove the markup + CSS from `index.html`**

Delete the `<details class="arp-panel"><summary>Arpeggiator</summary><div id="poly-arp-controls" …></div></details>` block and the `.synth > .arp-panel { order: 5; }` rule.

- [ ] **Step 4: Typecheck + build + full suite**

Run: `npx tsc --noEmit`
Run: `npm run build`
Run: `NO_COLOR=1 npx vitest run`
Expected: all PASS. tsc must report zero references to the deleted modules.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "refactor(notefx): remove the legacy global arp singleton + its UI"
```

---

### Task 12: Integration test — note-FX follow demos (the reported bug, locked)

**Files:**
- Test: `src/notefx/notefx-demo-load.test.ts`

- [ ] **Step 1: Write the test**

```ts
// src/notefx/notefx-demo-load.test.ts
// Regression: the arp kept the first demo's configuration. Note-FX now live
// in lane.engineState and load per demo via loadNoteFxForLane.
import { describe, it, expect, beforeEach } from 'vitest';
import { getNoteFxChain, loadNoteFxForLane, _resetNoteFxRegistry } from './notefx-registry';
import type { NoteFxState } from './notefx-types';

const demoA: NoteFxState[] = [{ id: 'arp1', kind: 'arp', enabled: true, params: { octaves: 3 } }];
const demoB: NoteFxState[] = [{ id: 'chord1', kind: 'chord', enabled: true, params: { chordType: 'min7', octave: 0 } }];

describe('note-FX follow demo loads', () => {
  beforeEach(() => { _resetNoteFxRegistry(); });

  it('loading demo A then demo B replaces the chain (no stale config)', () => {
    loadNoteFxForLane('sub-1', demoA);
    expect(getNoteFxChain('sub-1').serialize()).toEqual(demoA);
    loadNoteFxForLane('sub-1', demoB);          // load a different demo
    expect(getNoteFxChain('sub-1').serialize()).toEqual(demoB);
  });

  it('loading a demo with no note-FX clears the lane (passthrough)', () => {
    loadNoteFxForLane('sub-1', demoA);
    loadNoteFxForLane('sub-1', undefined);
    expect(getNoteFxChain('sub-1').serialize()).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test**

Run: `NO_COLOR=1 npx vitest run src/notefx/notefx-demo-load.test.ts`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/notefx/notefx-demo-load.test.ts
git commit -m "test(notefx): note-FX chain follows demo loads (arp regression locked)"
```

---

### Task 13: Final verification + integrate

- [ ] **Step 1: Full typecheck + suite + build**

Run: `npx tsc --noEmit`
Run: `NO_COLOR=1 npx vitest run`
Run: `npm run build`
Expected: all green.

- [ ] **Step 2: Manual smoke (browser)**

Start the worktree dev server on a free port, open a lane inspector, add an Arp note-FX, press Play, confirm arpeggiation; load a different demo, confirm the chain reflects the new demo (or clears). Confirm a lane with no note-FX plays unchanged.

- [ ] **Step 3: Integrate via the worktree skill**

Per the user's standing preference: rebase the branch onto `main`, then `git merge --ff` (no merge commit). Use the worktree/finish skill flow, not ad-hoc destructive git.

---

## Self-review notes

- **Spec coverage:** category infra (T1,4,6,10) ✓; per-lane storage (T5) ✓; load-with-demo fix (T6,7,12) ✓; arp port reusing pure logic (T2) ✓; chord second member (T3) ✓; chain order = addition (T4) ✓; trigger application + passthrough + slide/sample rules (T8) ✓; UI panel (T9) ✓; legacy arp removal (T11) ✓; no migrations (nothing added — correct) ✓; tests pure/chain/integration (T2,3,4,12) ✓.
- **Confirm-at-exec line numbers:** lane-allocator modulators-deserialize block (T7), `injectEngineModulatorPanelInner` mount + `sessionState` accessor (T9), `createTriggerForLane` deps construction in main.ts (T8 step 4). The surrounding code is quoted so the executor can locate by content, not line.
- **Type consistency:** `NoteFxEvent`/`NoteFxState`/`NoteFxKind` used consistently; chain method names (`addNoteFx`/`removeNoteFx`/`process`/`serialize`/`deserialize`) and registry helpers (`getNoteFxChain`/`loadNoteFxForLane`/`_resetNoteFxRegistry`) match across tasks.
