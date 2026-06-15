# Asistencia musical (Spec 1) — Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Dar a un usuario sin teoría musical una tonalidad global, un candado de escala en el piano-roll, generadores de bajo/melodía/beat por estilo y una galería de ejemplos cargables — todo anclado a una única tonalidad de proyecto.

**Architecture:** Un módulo puro nuevo `core/musicality.ts` es la única fuente de verdad de escalas. `SessionState.musicality` guarda tónica+escala+estilo+candado (override por pista). El piano-roll recibe un `scaleCtx` y pinta/encaja la escala. Los generadores y los ejemplos producen `NoteEvent[]` dentro de esa tonalidad. Todo es aditivo: ningún cambio de `schemaVersion`, ninguna ruptura de saves.

**Tech Stack:** TypeScript + Vite, Vitest (unit), Web Audio (sin tests DSP nuevos: todo es lógica pura + UI). Convención de tests del repo: aserciones **relativas** y `NO_COLOR=1 npx vitest run <archivo>`.

---

## Mapa de ficheros

**Nuevos:**
- `src/core/musicality.ts` — escalas, catálogos por sensación, `inScale`/`snapToScale`/`degreesOf`/`scaleDegreeToMidi`, `rootNameEs`. (Tarea 1)
- `src/core/musicality.test.ts` — tests del núcleo. (Tarea 1)
- `src/core/generators.ts` — `generate(kind, style, ctx)` + tablas por estilo. (Tarea 12)
- `src/core/generators.test.ts` — tests de generadores. (Tarea 12)
- `src/session/musicality-bar.ts` — panel de tonalidad+estilo de la barra superior. (Tarea 5)
- `src/session/musicality-bar.test.ts` — tests del panel. (Tarea 5)
- `src/session/example-loader.ts` — carga/valida ejemplos JSON + render por grados. (Tarea 14)
- `src/session/example-loader.test.ts` — tests del loader. (Tarea 14)
- `public/examples/{acid,house,synthwave,lofi}.json` — set inicial de ejemplos. (Tarea 15)
- `tools/build-examples.mjs` — siembra/regenera el set con los generadores. (Tarea 15)

**Modificados:**
- `src/session/session.ts` — `MusicalityState`, `LaneMusicalityOverride`, campos en `SessionState`/`SessionLane`, `DEFAULT_MUSICALITY`, `resolveTonality`. (Tarea 2)
- `src/session/session-migration.ts` — backfill del default. (Tarea 3)
- `src/save/saved-state-v3.test.ts` (o nuevo) — round-trip de `musicality`. (Tarea 4)
- `src/core/piano-roll-editing.ts` — `snapNoteMidi` puro. (Tarea 8)
- `src/core/pianoroll.ts` — `PianoRollOpts.scaleCtx`/`scaleLock`, resaltado, snap en 4 puntos, botón candado. (Tareas 9–11)
- `src/session/clip-editors/clip-editor-router.ts` — inyectar `scaleCtx`/`scaleLock` resueltos. (Tarea 11)
- `src/session/session-inspector.ts` — 🎲 usa generadores; override por pista; botón "Ejemplos…". (Tareas 7, 13, 16)
- `src/main.ts` — instanciar la barra; pasar `sessionState` al router. (Tareas 6, 11)
- `index.html` — reemplazar `#scale`/`#root` por `#musicality-bar`; botón `#insp-examples`. (Tareas 6, 16)

---

## FASE 0 — Núcleo musical

### Tarea 1: `core/musicality.ts` (módulo puro)

**Files:**
- Create: `src/core/musicality.ts`
- Test: `src/core/musicality.test.ts`

- [ ] **Step 1: Escribir el test que falla**

```ts
// src/core/musicality.test.ts
import { describe, it, expect } from 'vitest';
import {
  inScale, snapToScale, degreesOf, scaleDegreeToMidi, rootNameEs,
  SCALE_CATALOG, STYLE_CATALOG, scaleIntervals,
} from './musicality';

describe('musicality core', () => {
  it('inScale knows A minor notes (A B C D E F G)', () => {
    // A=9. In A minor the natural notes are pcs 9,11,0,2,4,5,7.
    expect(inScale(69, 9, 'minor')).toBe(true);  // A4
    expect(inScale(60, 9, 'minor')).toBe(true);  // C4
    expect(inScale(70, 9, 'minor')).toBe(false); // A#4 (not in A minor)
  });

  it('snapToScale pulls an out-of-scale note to the nearest in-scale note', () => {
    // A#4 (70) in A minor → nearest in-scale is A4 (69) or B4 (71); tie → up (71).
    expect(snapToScale(70, 9, 'minor')).toBe(71);
    // C#4 (61) in A minor → C4 (60) is 1 below, D4 (62) is 1 above; tie → up (62).
    expect(snapToScale(61, 9, 'minor')).toBe(62);
    // an already in-scale note is unchanged
    expect(snapToScale(60, 9, 'minor')).toBe(60);
  });

  it('degreesOf returns the pitch classes of the scale', () => {
    expect(degreesOf(9, 'minor').sort((a, b) => a - b)).toEqual([0, 2, 4, 5, 7, 9, 11]);
    expect(degreesOf(0, 'pentMinor').sort((a, b) => a - b)).toEqual([0, 3, 5, 7, 10]);
  });

  it('scaleDegreeToMidi maps degree index + octave to a midi in scale', () => {
    // degree 0, octave 4 (C4 region base 60) in C minor → C4 = 60
    const m = scaleDegreeToMidi(0, 60, 0, 'minor');
    expect(inScale(m, 0, 'minor')).toBe(true);
    // degree 7 wraps an octave up and stays in scale
    expect(inScale(scaleDegreeToMidi(7, 60, 0, 'minor'), 0, 'minor')).toBe(true);
  });

  it('rootNameEs uses Spanish note names', () => {
    expect(rootNameEs(9)).toBe('La');
    expect(rootNameEs(0)).toBe('Do');
  });

  it('catalogs are non-empty and every scale has intervals', () => {
    expect(SCALE_CATALOG.length).toBeGreaterThan(3);
    expect(STYLE_CATALOG.length).toBe(4);
    for (const s of SCALE_CATALOG) expect(scaleIntervals(s.id).length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Ejecutar el test y verlo fallar**

Run: `NO_COLOR=1 npx vitest run src/core/musicality.test.ts`
Expected: FAIL — `Cannot find module './musicality'`.

- [ ] **Step 3: Implementar `core/musicality.ts`**

```ts
// src/core/musicality.ts
// Única fuente de verdad de escalas/tonalidad para todo Loom. Puro: sin DOM,
// sin audio. Lo consumen el piano-roll (resaltado + candado), los generadores
// y la galería de ejemplos.

export type ScaleId = 'minor' | 'major' | 'pentMinor' | 'phrygian' | 'dorian' | 'chromatic';
export type StyleId = 'acid' | 'house' | 'synthwave' | 'lofi';

const INTERVALS: Record<ScaleId, number[]> = {
  major:     [0, 2, 4, 5, 7, 9, 11],
  minor:     [0, 2, 3, 5, 7, 8, 10],
  pentMinor: [0, 3, 5, 7, 10],
  phrygian:  [0, 1, 3, 5, 7, 8, 10],
  dorian:    [0, 2, 3, 5, 7, 9, 10],
  chromatic: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
};

export interface ScaleEntry { id: ScaleId; label: string; mood: string; hint: string; }
export const SCALE_CATALOG: ScaleEntry[] = [
  { id: 'minor',     label: 'menor',          mood: '🌙 Oscura / tensa',       hint: 'el sonido acid/techno clásico' },
  { id: 'pentMinor', label: 'pentatónica menor', mood: '🛡️ Segura (casi todo pega)', hint: 'difícil sonar mal; riffs y bajos' },
  { id: 'major',     label: 'mayor',          mood: '☀️ Alegre / abierta',      hint: 'pop, casi todo lo "feliz"' },
  { id: 'phrygian',  label: 'frigia',         mood: '🔥 Misteriosa / hipnótica', hint: 'acid oscuro, EBM' },
  { id: 'dorian',    label: 'dórica',         mood: '🌊 Groovy / con swing',    hint: 'house y funk' },
  { id: 'chromatic', label: 'cromática',      mood: '🎛️ Todo vale (sin red)',   hint: 'cualquier nota; sin ayuda' },
];

export interface StyleEntry { id: StyleId; label: string; }
export const STYLE_CATALOG: StyleEntry[] = [
  { id: 'acid',      label: 'Acid / Techno' },
  { id: 'house',     label: 'House' },
  { id: 'synthwave', label: 'Synthwave / Electro' },
  { id: 'lofi',      label: 'Lo-fi / Ambient' },
];

const ROOT_NAMES_ES = ['Do', 'Do♯', 'Re', 'Re♯', 'Mi', 'Fa', 'Fa♯', 'Sol', 'Sol♯', 'La', 'La♯', 'Si'];

export function scaleIntervals(scale: ScaleId): number[] {
  return INTERVALS[scale] ?? INTERVALS.minor;
}
export function rootNameEs(pc: number): string {
  return ROOT_NAMES_ES[((pc % 12) + 12) % 12];
}
/** Pitch classes (0-11) that belong to `scale` rooted at `key`. */
export function degreesOf(key: number, scale: ScaleId): number[] {
  const k = ((key % 12) + 12) % 12;
  return scaleIntervals(scale).map((iv) => (k + iv) % 12);
}
export function inScale(midi: number, key: number, scale: ScaleId): boolean {
  const pc = ((midi % 12) + 12) % 12;
  return degreesOf(key, scale).includes(pc);
}
/** Nearest in-scale midi. Ties (equal distance up/down) resolve UP. */
export function snapToScale(midi: number, key: number, scale: ScaleId): number {
  if (inScale(midi, key, scale)) return midi;
  for (let d = 1; d <= 6; d++) {
    if (inScale(midi + d, key, scale)) return midi + d; // up wins ties (checked first)
    if (inScale(midi - d, key, scale)) return midi - d;
  }
  return midi;
}
/** Map a scale-degree index (0-based, may exceed the scale length → wraps octaves)
 *  to an absolute midi, relative to `octaveBase` (midi of the scale root in the
 *  lowest on-screen octave). */
export function scaleDegreeToMidi(degree: number, octaveBase: number, key: number, scale: ScaleId): number {
  const ivs = scaleIntervals(scale);
  const n = ivs.length;
  const oct = Math.floor(degree / n);
  const idx = ((degree % n) + n) % n;
  const k = ((key % 12) + 12) % 12;
  return octaveBase + k + ivs[idx] + 12 * oct;
}
```

- [ ] **Step 4: Ejecutar el test y verlo pasar**

Run: `NO_COLOR=1 npx vitest run src/core/musicality.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add src/core/musicality.ts src/core/musicality.test.ts
git commit -m "feat(musicality): pure scale core (catalog, inScale, snapToScale, degrees)"
```

---

## FASE 1 — Estado, migración y persistencia

### Tarea 2: estado de tonalidad en `session.ts`

**Files:**
- Modify: `src/session/session.ts` (interfaces `SessionState` ~120, `SessionLane` ~82; helpers tras ~126)
- Test: `src/session/session-musicality.test.ts` (nuevo)

- [ ] **Step 1: Escribir el test que falla**

```ts
// src/session/session-musicality.test.ts
import { describe, it, expect } from 'vitest';
import { resolveTonality, DEFAULT_MUSICALITY } from './session';
import type { SessionState, SessionLane } from './session';

const baseState = (): SessionState => ({
  lanes: [], scenes: [], globalQuantize: 'immediate',
  musicality: { key: 9, scale: 'minor', style: 'acid', lock: true },
});

describe('resolveTonality', () => {
  it('uses the global tonality when the lane has no override', () => {
    const lane = { id: 'l1', engineId: 'tb303', clips: [] } as SessionLane;
    expect(resolveTonality(lane, baseState())).toEqual({ key: 9, scale: 'minor' });
  });
  it('lets a lane override key and/or scale field-by-field', () => {
    const lane = { id: 'l1', engineId: 'tb303', clips: [], musicalityOverride: { scale: 'major' } } as SessionLane;
    expect(resolveTonality(lane, baseState())).toEqual({ key: 9, scale: 'major' });
  });
  it('falls back to DEFAULT_MUSICALITY when the state has none', () => {
    const lane = { id: 'l1', engineId: 'tb303', clips: [] } as SessionLane;
    const s = { lanes: [], scenes: [], globalQuantize: 'immediate' } as SessionState;
    expect(resolveTonality(lane, s)).toEqual({ key: DEFAULT_MUSICALITY.key, scale: DEFAULT_MUSICALITY.scale });
  });
});
```

- [ ] **Step 2: Ejecutar y ver fallar**

Run: `NO_COLOR=1 npx vitest run src/session/session-musicality.test.ts`
Expected: FAIL — `resolveTonality is not a function`.

- [ ] **Step 3: Añadir tipos + campos + helpers**

En `src/session/session.ts`, justo bajo el import inicial (tras la línea 5 `import { barCountFor } ...`), añadir:

```ts
import type { ScaleId, StyleId } from '../core/musicality';

export interface MusicalityState {
  key: number;        // pitch class 0-11 (0 = Do … 9 = La)
  scale: ScaleId;
  style: StyleId;
  lock: boolean;      // candado de escala del piano-roll
}
export interface LaneMusicalityOverride { key?: number; scale?: ScaleId; }
export const DEFAULT_MUSICALITY: MusicalityState = { key: 9, scale: 'minor', style: 'acid', lock: true };
```

En `interface SessionLane` (tras `inserts?: ...;`, antes del cierre `}` ~línea 112) añadir:

```ts
  /** Per-lane tonality override (Spec 1). Absent ⇒ inherits the global musicality. */
  musicalityOverride?: LaneMusicalityOverride;
```

En `interface SessionState` (tras `masterInserts?: ...;` ~línea 125) añadir:

```ts
  /** Global tonality + style + scale-lock (Spec 1). Optional/additive; absent ⇒
   *  DEFAULT_MUSICALITY (backfilled by session-migration). */
  musicality?: MusicalityState;
```

Tras los helpers existentes (p. ej. después de `emptyClip`, ~línea 148) añadir:

```ts
/** Resolve a lane's effective tonality: its override (field-by-field) over the
 *  global musicality, over DEFAULT_MUSICALITY. */
export function resolveTonality(
  lane: Pick<SessionLane, 'musicalityOverride'>,
  state: Pick<SessionState, 'musicality'>,
): { key: number; scale: ScaleId } {
  const g = state.musicality ?? DEFAULT_MUSICALITY;
  const o = lane.musicalityOverride ?? {};
  return { key: o.key ?? g.key, scale: o.scale ?? g.scale };
}
```

- [ ] **Step 4: Ejecutar y ver pasar**

Run: `NO_COLOR=1 npx vitest run src/session/session-musicality.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Typecheck + commit**

```bash
npx tsc --noEmit
git add src/session/session.ts src/session/session-musicality.test.ts
git commit -m "feat(musicality): SessionState.musicality + per-lane override + resolveTonality"
```

---

### Tarea 3: backfill del default en la migración

**Files:**
- Modify: `src/session/session-migration.ts` (`migrateLoadedSessionState`, líneas 10-19)
- Test: `src/session/session-migration.test.ts` (añadir caso; si no existe, crear)

- [ ] **Step 1: Escribir el test que falla**

```ts
// añadir a src/session/session-migration.test.ts
import { describe, it, expect } from 'vitest';
import { migrateLoadedSessionState } from './session-migration';
import { DEFAULT_MUSICALITY } from './session';
import type { SessionState } from './session';

describe('migration backfills musicality', () => {
  it('adds DEFAULT_MUSICALITY when an old save has none', () => {
    const s = { lanes: [], scenes: [], globalQuantize: 'immediate' } as SessionState;
    const out = migrateLoadedSessionState(s);
    expect(out.musicality).toEqual(DEFAULT_MUSICALITY);
  });
  it('keeps an existing musicality untouched', () => {
    const s = { lanes: [], scenes: [], globalQuantize: 'immediate',
      musicality: { key: 0, scale: 'major', style: 'house', lock: false } } as SessionState;
    const out = migrateLoadedSessionState(s);
    expect(out.musicality).toEqual({ key: 0, scale: 'major', style: 'house', lock: false });
  });
});
```

- [ ] **Step 2: Ejecutar y ver fallar**

Run: `NO_COLOR=1 npx vitest run src/session/session-migration.test.ts`
Expected: FAIL — `out.musicality` es `undefined` en el primer caso.

- [ ] **Step 3: Implementar el backfill**

En `src/session/session-migration.ts`:
- Cambiar el import de la línea 6 para incluir el default:
  ```ts
  import { CLIP_COLOR_PALETTE, DEFAULT_MUSICALITY, type SessionClip, type SessionState } from './session';
  ```
- En `migrateLoadedSessionState`, antes de `return s;` (línea 18) añadir:
  ```ts
  if (!s.musicality) s.musicality = { ...DEFAULT_MUSICALITY };
  ```

- [ ] **Step 4: Ejecutar y ver pasar**

Run: `NO_COLOR=1 npx vitest run src/session/session-migration.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/session/session-migration.ts src/session/session-migration.test.ts
git commit -m "feat(musicality): backfill DEFAULT_MUSICALITY on load"
```

---

### Tarea 4: round-trip de persistencia (verificación)

`musicality` viaja dentro de `SessionState`, que ya se serializa entero por
`sessionHost.getStateForSave()` y se aplica por `applyLoadedSessionState`. Esta tarea
**verifica** que no se pierde (no toca código de save salvo que el test falle).

**Files:**
- Test: `src/session/session-musicality-roundtrip.test.ts` (nuevo)

- [ ] **Step 1: Escribir el test**

```ts
// src/session/session-musicality-roundtrip.test.ts
import { describe, it, expect } from 'vitest';
import { migrateLoadedSessionState } from './session-migration';
import type { SessionState } from './session';

describe('musicality survives a JSON round-trip + migration', () => {
  it('preserves key/scale/style/lock and a lane override', () => {
    const s: SessionState = {
      lanes: [{ id: 'l1', engineId: 'tb303', clips: [], musicalityOverride: { scale: 'major' } }],
      scenes: [], globalQuantize: 'immediate',
      musicality: { key: 2, scale: 'dorian', style: 'house', lock: false },
    };
    const reloaded = migrateLoadedSessionState(JSON.parse(JSON.stringify(s)) as SessionState);
    expect(reloaded.musicality).toEqual({ key: 2, scale: 'dorian', style: 'house', lock: false });
    expect(reloaded.lanes[0].musicalityOverride).toEqual({ scale: 'major' });
  });
});
```

- [ ] **Step 2: Ejecutar**

Run: `NO_COLOR=1 npx vitest run src/session/session-musicality-roundtrip.test.ts`
Expected: PASS. Si falla porque `getStateForSave()` filtra campos desconocidos, abrir `src/session/session-host.ts`, localizar `getStateForSave()` y asegurarse de que serializa `state.musicality` y `lane.musicalityOverride` (normalmente es un `JSON.parse(JSON.stringify(state))`, que ya los incluye).

- [ ] **Step 3: Commit**

```bash
git add src/session/session-musicality-roundtrip.test.ts
git commit -m "test(musicality): persistence round-trip"
```

---

## FASE 2 — UI de tonalidad y estilo

### Tarea 5: panel de tonalidad `musicality-bar.ts`

**Files:**
- Create: `src/session/musicality-bar.ts`
- Test: `src/session/musicality-bar.test.ts`

- [ ] **Step 1: Escribir el test que falla**

```ts
// src/session/musicality-bar.test.ts
import { describe, it, expect, vi } from 'vitest';
import { renderMusicalityBar } from './musicality-bar';
import { DEFAULT_MUSICALITY } from './session';

describe('musicality bar', () => {
  it('shows the current tonality label and emits changes', () => {
    const host = document.createElement('div');
    const onChange = vi.fn();
    const handle = renderMusicalityBar(host, { get: () => ({ ...DEFAULT_MUSICALITY }), onChange });
    // Summary button shows "La menor · Acid / Techno"
    const summary = host.querySelector('.musicality-summary') as HTMLButtonElement;
    expect(summary.textContent).toContain('La menor');
    // Changing the scale select emits the new musicality
    const scaleSel = host.querySelector('select[data-musicality="scale"]') as HTMLSelectElement;
    scaleSel.value = 'major';
    scaleSel.dispatchEvent(new Event('change'));
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ scale: 'major' }));
    // refresh() re-reads the getter and updates the summary
    handle.refresh();
    expect(summary.textContent).toContain('La');
  });
});
```

- [ ] **Step 2: Ejecutar y ver fallar**

Run: `NO_COLOR=1 npx vitest run src/session/musicality-bar.test.ts`
Expected: FAIL — módulo inexistente.

- [ ] **Step 3: Implementar `musicality-bar.ts`**

```ts
// src/session/musicality-bar.ts
// Panel de tonalidad + estilo de la barra superior. Reemplaza los <select>
// #scale/#root sueltos. Muestra las escalas por sensación (mood + hint).
import {
  SCALE_CATALOG, STYLE_CATALOG, rootNameEs, type ScaleId, type StyleId,
} from '../core/musicality';
import type { MusicalityState } from './session';

export interface MusicalityBarDeps {
  get: () => MusicalityState;
  onChange: (next: MusicalityState) => void;
}
export interface MusicalityBarHandle { refresh: () => void; }

export function renderMusicalityBar(host: HTMLElement, deps: MusicalityBarDeps): MusicalityBarHandle {
  host.innerHTML = '';
  host.className = 'musicality-bar';

  const summary = document.createElement('button');
  summary.className = 'musicality-summary';
  summary.title = 'Tonalidad y estilo del proyecto';

  const popover = document.createElement('div');
  popover.className = 'musicality-popover';
  popover.hidden = true;

  // Tónica
  const rootSel = document.createElement('select');
  rootSel.dataset.musicality = 'root';
  for (let pc = 0; pc < 12; pc++) {
    const o = document.createElement('option'); o.value = String(pc); o.textContent = rootNameEs(pc);
    rootSel.appendChild(o);
  }
  // Escala (por sensación)
  const scaleSel = document.createElement('select');
  scaleSel.dataset.musicality = 'scale';
  for (const s of SCALE_CATALOG) {
    const o = document.createElement('option');
    o.value = s.id; o.textContent = `${s.mood} — ${s.label} · ${s.hint}`;
    scaleSel.appendChild(o);
  }
  // Estilo del proyecto
  const styleSel = document.createElement('select');
  styleSel.dataset.musicality = 'style';
  for (const s of STYLE_CATALOG) {
    const o = document.createElement('option'); o.value = s.id; o.textContent = s.label;
    styleSel.appendChild(o);
  }

  const mkRow = (label: string, el: HTMLElement) => {
    const row = document.createElement('label'); row.className = 'musicality-row';
    const span = document.createElement('span'); span.textContent = label;
    row.append(span, el); return row;
  };
  popover.append(
    mkRow('Tónica', rootSel),
    mkRow('Escala', scaleSel),
    mkRow('Estilo', styleSel),
  );

  const summaryText = (m: MusicalityState) => {
    const sc = SCALE_CATALOG.find((s) => s.id === m.scale);
    const st = STYLE_CATALOG.find((s) => s.id === m.style);
    return `${rootNameEs(m.key)} ${sc?.label ?? m.scale} · ${st?.label ?? m.style}`;
  };
  const refresh = () => {
    const m = deps.get();
    rootSel.value = String(((m.key % 12) + 12) % 12);
    scaleSel.value = m.scale;
    styleSel.value = m.style;
    summary.textContent = `🎼 ${summaryText(m)}`;
  };

  const emit = () => {
    const cur = deps.get();
    deps.onChange({
      ...cur,
      key: parseInt(rootSel.value, 10),
      scale: scaleSel.value as ScaleId,
      style: styleSel.value as StyleId,
    });
    refresh();
  };
  for (const el of [rootSel, scaleSel, styleSel]) el.addEventListener('change', emit);
  summary.addEventListener('click', () => { popover.hidden = !popover.hidden; });

  host.append(summary, popover);
  refresh();
  return { refresh };
}
```

- [ ] **Step 4: Ejecutar y ver pasar**

Run: `NO_COLOR=1 npx vitest run src/session/musicality-bar.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/session/musicality-bar.ts src/session/musicality-bar.test.ts
git commit -m "feat(musicality): tonality+style bar panel (by feel)"
```

---

### Tarea 6: cablear la barra en el HTML + `main.ts`

**Files:**
- Modify: `index.html` (bloque `.row.tools`, líneas 165-175)
- Modify: `src/main.ts` (refs ~184-185, deps del inspector ~453-457)

- [ ] **Step 1: Reemplazar el bloque de selects en `index.html`**

Sustituir las líneas 165-175 (`<div class="row tools">…</div>`) por:

```html
      <div class="row tools">
        <div class="tool-group" id="musicality-bar"></div>
      </div>
```

- [ ] **Step 2: Instanciar la barra en `main.ts`**

En `src/main.ts`, borrar las refs `scaleSel`/`rootSel` (líneas 184-185) y el bucle que puebla `rootSel` (líneas 197-203). Añadir, tras las refs DOM (~línea 188):

```ts
import { renderMusicalityBar } from './session/musicality-bar';
import { DEFAULT_MUSICALITY } from './session/session';
// ...
const musicalityHost = $<HTMLDivElement>('musicality-bar');
const musicalityBar = renderMusicalityBar(musicalityHost, {
  get: () => sessionHost.getState().musicality ?? DEFAULT_MUSICALITY,
  onChange: (next) => {
    const run = () => { sessionHost.getState().musicality = next; sessionHost.renderInspector?.(); };
    if (historyDeps) withUndo(historyDeps, run); else run();
  },
});
```

> Nota de implementación: usar las referencias que `main.ts` ya tiene a `sessionHost`
> y `historyDeps`. Si el nombre del getter del estado no es `getState()`, localizar el
> accesor real en `session-host.ts` (es el mismo que usa el inspector vía `deps.state`).
> `renderInspector` puede no existir con ese nombre — usar el re-render del inspector que
> ya exista (p. ej. `sessionHost.refreshInspector()` / `renderWithMixer`). El objetivo:
> cambiar la tonalidad re-pinta el editor abierto para que el resaltado se actualice.

- [ ] **Step 3: Actualizar las deps del inspector**

En `src/main.ts`, en el objeto de deps del inspector (~453-457), eliminar `scaleSel,`
y `rootSel,`. (El 🎲 dejará de usarlos en la Tarea 13.)

- [ ] **Step 4: Build + smoke**

Run: `npx tsc --noEmit`
Expected: limpio. (Si `tsc` se queja de `scaleSel`/`rootSel` aún referenciados, esos usos se retiran en las Tareas 7/13; comentar temporalmente el handler del 🎲 si bloquea el build, y restaurarlo en la Tarea 13.)

Run: `npm run dev` y comprobar que la barra muestra `🎼 La menor · Acid / Techno` y que al abrirla se ven las escalas por sensación.

- [ ] **Step 5: Commit**

```bash
git add index.html src/main.ts
git commit -m "feat(musicality): mount tonality bar; drop legacy scale/root selects"
```

---

### Tarea 7: override de tonalidad por pista (inspector)

**Files:**
- Modify: `src/session/session-inspector.ts` (cuerpo de `openInspector`, junto a los botones ~193)

- [ ] **Step 1: Añadir la línea de override en el inspector**

En `session-inspector.ts`, dentro del método que renderiza el detalle del clip (donde se
cablea `#insp-random-notes`, ~línea 193), añadir un bloque que pinte el estado de tonalidad
de la pista y permita sobrescribirlo. Insertar tras `updatePasteBtnState();` (~línea 213):

```ts
this.renderTonalityOverride(lane!);
```

Y añadir el método a la clase `SessionInspector`:

```ts
private renderTonalityOverride(lane: import('./session').SessionLane): void {
  const host = document.getElementById('insp-tonality');
  if (!host) return;
  host.innerHTML = '';
  const { resolveTonality, DEFAULT_MUSICALITY } = require('./session'); // o import estático arriba
  const g = this.deps.state.musicality ?? DEFAULT_MUSICALITY;
  const eff = resolveTonality(lane, this.deps.state);
  const overridden = !!lane.musicalityOverride;
  const label = document.createElement('span');
  label.textContent = overridden
    ? `Tono: propio (${rootNameEs(eff.key)} ${eff.scale})`
    : `Tono: hereda ${rootNameEs(g.key)} ${g.scale}`;
  const btn = document.createElement('button');
  btn.className = 'rnd';
  btn.textContent = overridden ? 'Volver al global' : 'Cambiar';
  btn.onclick = () => {
    const d = this.deps.historyDeps;
    const run = () => {
      if (overridden) delete lane.musicalityOverride;
      else lane.musicalityOverride = { key: g.key, scale: g.scale };
      this.renderTonalityOverride(lane);
      this.renderEditor();
    };
    if (d) withUndo(d, run); else run();
  };
  host.append(label, btn);
}
```

> Usar imports estáticos al principio del fichero (no `require`): añadir
> `import { resolveTonality, DEFAULT_MUSICALITY } from './session';` y
> `import { rootNameEs } from '../core/musicality';`. El `require` de arriba es solo
> ilustrativo; el ejecutor debe usar el import estático.

Añadir el contenedor en `index.html`, dentro de la fila de botones del inspector (tras la
línea 314, el `#insp-toggle-editor`), una zona para la línea de tono:

```html
            <span id="insp-tonality" class="insp-tonality"></span>
```

> El "cambiar a un tono concreto" (elegir otra tónica/escala para la pista) se hará en una
> iteración de pulido reabriendo el panel de la barra sobre `lane.musicalityOverride`. En
> esta tarea, "Cambiar" crea un override igual al global (punto de partida visible) y "Volver
> al global" lo elimina. Esto cumple el spec (override por pista existe y es visible) sin un
> segundo selector completo.

- [ ] **Step 2: Build + smoke**

Run: `npx tsc --noEmit`
Expected: limpio.
Smoke: abrir el inspector de una pista → ver "Tono: hereda La menor"; "Cambiar" lo fija como propio; "Volver al global" lo quita.

- [ ] **Step 3: Commit**

```bash
git add src/session/session-inspector.ts index.html
git commit -m "feat(musicality): per-lane tonality override line in the inspector"
```

---

## FASE 3 — Piano-roll: resaltado + candado

### Tarea 8: `snapNoteMidi` puro

**Files:**
- Modify: `src/core/piano-roll-editing.ts` (añadir al final, antes del EOF)
- Test: `src/core/piano-roll-editing.test.ts` (añadir; si no existe, crear)

- [ ] **Step 1: Escribir el test que falla**

```ts
// añadir a src/core/piano-roll-editing.test.ts
import { describe, it, expect } from 'vitest';
import { snapNoteMidi } from './piano-roll-editing';

describe('snapNoteMidi', () => {
  const ctx = { inScale: (m: number) => [0, 2, 4, 5, 7, 9, 11].includes(((m % 12) + 12) % 12) }; // C major
  it('snaps when locked and out of scale', () => {
    expect(snapNoteMidi(61, ctx, true)).not.toBe(61); // C# → C or D
    expect(ctx.inScale(snapNoteMidi(61, ctx, true))).toBe(true);
  });
  it('passes through when locked and already in scale', () => {
    expect(snapNoteMidi(60, ctx, true)).toBe(60);
  });
  it('passes through unchanged when unlocked', () => {
    expect(snapNoteMidi(61, ctx, false)).toBe(61);
  });
});
```

- [ ] **Step 2: Ejecutar y ver fallar**

Run: `NO_COLOR=1 npx vitest run src/core/piano-roll-editing.test.ts`
Expected: FAIL — `snapNoteMidi` no exportada.

- [ ] **Step 3: Implementar (sin acoplar musicality al piano-roll: recibe un predicado)**

Añadir al final de `src/core/piano-roll-editing.ts`:

```ts
/** Scale context the piano-roll uses to paint + lock. Kept as a tiny interface
 *  (a predicate, not a ScaleId) so pianoroll.ts stays free of musicality imports. */
export interface ScaleCtx { inScale: (midi: number) => boolean; }

/** Nearest in-scale midi when `lock` is on; unchanged otherwise. Tie → up. */
export function snapNoteMidi(midi: number, ctx: ScaleCtx | undefined, lock: boolean): number {
  if (!lock || !ctx || ctx.inScale(midi)) return midi;
  for (let d = 1; d <= 6; d++) {
    if (ctx.inScale(midi + d)) return midi + d;
    if (ctx.inScale(midi - d)) return midi - d;
  }
  return midi;
}
```

- [ ] **Step 4: Ejecutar y ver pasar**

Run: `NO_COLOR=1 npx vitest run src/core/piano-roll-editing.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/core/piano-roll-editing.ts src/core/piano-roll-editing.test.ts
git commit -m "feat(musicality): snapNoteMidi pure helper for the scale lock"
```

---

### Tarea 9: opts del piano-roll + resaltado de escala

**Files:**
- Modify: `src/core/pianoroll.ts` (`PianoRollOpts` ~30-57; `drawGrid` ~250; `drawKeys` ~348)

- [ ] **Step 1: Extender `PianoRollOpts`**

En `PianoRollOpts` (tras `auditionNote?` ~línea 56) añadir:

```ts
  /** Scale highlight + lock context (musicality). Absent ⇒ no highlight, no snap. */
  scaleCtx?: import('./piano-roll-editing').ScaleCtx & { isRoot?: (midi: number) => boolean };
  /** When true (and scaleCtx present), placed notes snap to scale. */
  scaleLock?: boolean;
```

Y actualizar el import de `piano-roll-editing` (línea 16-18) para incluir `snapNoteMidi`:

```ts
import {
  notesInRect, translateGroup, serializeClipboard, pasteTranslate, midiForKey,
  quantizeRecorded, clampOctaveBase, octaveBaseLabel, PIANO_KEY_LEGEND, snapNoteMidi, type ClipboardNote,
} from './piano-roll-editing';
```

- [ ] **Step 2: Resaltar la escala en `drawGrid()`**

En `drawGrid()`, dentro del bucle de filas (líneas 253-262), tras el bloque que pinta las
teclas negras, añadir un tinte para las filas EN ESCALA y un realce de la tónica:

```ts
      // Resaltado de escala (musicality): filas en tono con un tinte verde sutil,
      // la tónica algo más marcada. Las de fuera quedan como están (más oscuras).
      if (opts.scaleCtx?.inScale(midi)) {
        gctx.fillStyle = opts.scaleCtx.isRoot?.(midi) ? 'rgba(57,217,138,0.13)' : 'rgba(57,217,138,0.05)';
        gctx.fillRect(0, i * rowHeight, w, rowHeight);
      }
```

- [ ] **Step 3: Resaltar en el teclado lateral `drawKeys()`**

En `drawKeys()` (líneas 350-358), tras pintar la tecla base, añadir:

```ts
      if (opts.scaleCtx?.inScale(midi)) {
        kctx.fillStyle = opts.scaleCtx.isRoot?.(midi) ? '#39d98a' : 'rgba(57,217,138,0.35)';
        kctx.fillRect(KEYS_W - 5, i * rowHeight + 1, 4, rowHeight - 2); // marca en el borde derecho
      }
```

- [ ] **Step 4: Build + smoke**

Run: `npx tsc --noEmit`
Expected: limpio (los nuevos opts son opcionales; los callers existentes siguen compilando).

> Smoke real en la Tarea 11 (cuando el router inyecta `scaleCtx`).

- [ ] **Step 5: Commit**

```bash
git add src/core/pianoroll.ts
git commit -m "feat(musicality): piano-roll scale highlight (grid rows + key strip)"
```

---

### Tarea 10: aplicar el candado en los puntos de colocación

**Files:**
- Modify: `src/core/pianoroll.ts` (4 puntos: crear ~508, mover-single ~549, teclado ~646, pegar ~623)

> El nudge con flechas ↑/↓ y el arrastre de grupo NO snappean (microajuste deliberado;
> mantienen la forma de la selección). Decisión de producto del Spec 1.

- [ ] **Step 1: Helper local de snap**

En `createPianoRoll`, cerca de la cabecera de la función (junto a `const snap = ...`),
añadir:

```ts
  const snapMidi = (m: number) => snapNoteMidi(m, opts.scaleCtx, opts.scaleLock ?? false);
```

- [ ] **Step 2: Crear nota (lápiz) — línea ~508**

Reemplazar:

```ts
      const newNote: NoteEvent = { start: snappedStart, duration: snap, midi, velocity: DEFAULT_VELOCITY };
```

por:

```ts
      const newNote: NoteEvent = { start: snappedStart, duration: snap, midi: snapMidi(midi), velocity: DEFAULT_VELOCITY };
```

- [ ] **Step 3: Mover una nota — línea ~549**

Reemplazar:

```ts
      interaction.note.midi = Math.max(minMidi, Math.min(maxMidi, midi));
```

por:

```ts
      interaction.note.midi = snapMidi(Math.max(minMidi, Math.min(maxMidi, midi)));
```

- [ ] **Step 4: Teclado de ordenador — línea ~646**

Reemplazar:

```ts
      const midi = midiForKey(e.key, octaveBase);
```

por:

```ts
      const rawMidi = midiForKey(e.key, octaveBase);
      const midi = rawMidi === null ? null : snapMidi(rawMidi);
```

- [ ] **Step 5: Pegar — línea ~623**

Tras `const pasted = pasteTranslate(...)`, añadir:

```ts
      for (const n of pasted) n.midi = snapMidi(n.midi);
```

- [ ] **Step 6: Build + commit**

Run: `npx tsc --noEmit`
Expected: limpio.

```bash
git add src/core/pianoroll.ts
git commit -m "feat(musicality): scale-lock snap on create/move/keyboard/paste"
```

---

### Tarea 11: inyectar `scaleCtx`/`scaleLock` desde el router + botón candado

**Files:**
- Modify: `src/session/clip-editors/clip-editor-router.ts` (`buildPianoRoll` ~232-277)
- Modify: `src/core/pianoroll.ts` (toolbar: añadir el botón 🔒, junto a `createToolToggle`)
- Modify: `src/main.ts` (asegurar que el inspector pasa `sessionState` al router)

- [ ] **Step 1: Resolver la tonalidad en `buildPianoRoll`**

En `clip-editor-router.ts`, en `buildPianoRoll` (tras `const { minMidi, maxMidi } = ...`, ~línea 244), añadir:

```ts
  const state = deps.sessionState;
  const ton = state ? resolveTonality(lane, state) : undefined;
  const scaleCtx = ton
    ? {
        inScale: (m: number) => inScale(m, ton.key, ton.scale),
        isRoot: (m: number) => (((m % 12) + 12) % 12) === (((ton.key % 12) + 12) % 12),
      }
    : undefined;
  const scaleLock = state?.musicality?.lock ?? false;
```

Pasar ambos a `createPianoRoll({ ... })` (añadir al objeto, p. ej. tras `maxMidi,`):

```ts
    scaleCtx,
    scaleLock,
```

Añadir los imports al principio de `clip-editor-router.ts`:

```ts
import { resolveTonality } from '../session';
import { inScale } from '../../core/musicality';
```

- [ ] **Step 2: Botón candado en el toolbar del piano-roll**

En `pianoroll.ts`, donde se construye el toolbar (busca `createToolToggle(currentTool, ...)`),
añadir un botón candado que conmuta `opts.scaleLock` en vivo y persiste vía un callback.
Primero, extender `PianoRollOpts` (Tarea 9) con:

```ts
  /** Persistir el cambio de candado (el caller escribe musicality.lock). */
  onScaleLockChange?: (lock: boolean) => void;
```

Luego, junto al toggle de herramientas, añadir:

```ts
  let lockOn = opts.scaleLock ?? false;
  const lockBtn = document.createElement('button');
  const refreshLock = () => { lockBtn.textContent = lockOn ? '🔒 Escala' : '🔓 Escala'; lockBtn.title = lockOn ? 'Candado de escala ON (las notas caen en tono)' : 'Candado de escala OFF'; };
  lockBtn.addEventListener('click', () => { lockOn = !lockOn; opts.scaleLock = lockOn; refreshLock(); opts.onScaleLockChange?.(lockOn); });
  refreshLock();
  // el botón solo tiene sentido con scaleCtx; ocultarlo si no hay tonalidad
  lockBtn.hidden = !opts.scaleCtx;
```

Añadir `lockBtn` a la fila del toolbar (donde se hace `.append(...)` de los botones).
> `opts.scaleLock` se lee de forma viva por `snapMidi` (Tarea 10), así que mutarlo basta
> para activar/desactivar el snap sin recrear el editor.

- [ ] **Step 3: Conectar el persistido del candado en el router**

En `buildPianoRoll`, añadir al objeto `createPianoRoll`:

```ts
    onScaleLockChange: (lock) => {
      if (state?.musicality) state.musicality.lock = lock;
    },
```

- [ ] **Step 4: Asegurar `sessionState` en las deps del editor**

En `session-inspector.ts`, donde construye `ClipEditorDeps` para `renderClipEditor`,
confirmar que pasa `sessionState: this.deps.state` (el router ya declara `sessionState?`).
Si no lo pasa, añadirlo.

- [ ] **Step 5: Build + smoke a oído/vista**

Run: `npx tsc --noEmit` → limpio.
Run: `npm run dev`. En el editor de una pista melódica:
1. Las filas/teclas en tono se ven resaltadas; la tónica más marcada.
2. Con 🔒, dibujar/teclear una nota fuera de tono la coloca en la nota en tono más cercana.
3. Con 🔓, se puede colocar fuera.

- [ ] **Step 6: Commit**

```bash
git add src/session/clip-editors/clip-editor-router.ts src/core/pianoroll.ts src/session/session-inspector.ts
git commit -m "feat(musicality): wire scaleCtx/lock into the piano-roll + lock toolbar button"
```

---

## FASE 4 — Generadores de género

### Tarea 12: `core/generators.ts`

**Files:**
- Create: `src/core/generators.ts`
- Test: `src/core/generators.test.ts`

- [ ] **Step 1: Escribir el test que falla**

```ts
// src/core/generators.test.ts
import { describe, it, expect } from 'vitest';
import { generate, type GenContext } from './generators';
import { inScale } from './musicality';

const ctx = (over: Partial<GenContext> = {}): GenContext => ({
  key: 9, scale: 'minor', bars: 1, stepsPerBar: 16, octaveBase: 36,
  rng: mulberry32(1), ...over,
});
// deterministic rng for tests
function mulberry32(a: number) { return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }

describe('genre generators', () => {
  it('bass notes are all in scale and there is at least one', () => {
    const notes = generate('bass', 'acid', ctx());
    expect(notes.length).toBeGreaterThan(0);
    for (const n of notes) expect(inScale(n.midi, 9, 'minor')).toBe(true);
  });
  it('melody notes are all in scale', () => {
    const notes = generate('melody', 'synthwave', ctx());
    expect(notes.length).toBeGreaterThan(0);
    for (const n of notes) expect(inScale(n.midi, 9, 'minor')).toBe(true);
  });
  it('beat puts a kick on the first downbeat', () => {
    const notes = generate('beat', 'house', ctx());
    const kicksAtZero = notes.filter((n) => n.midi === 36 && n.start === 0);
    expect(kicksAtZero.length).toBeGreaterThan(0);
  });
  it('acid bass is denser than lofi bass', () => {
    const acid = generate('bass', 'acid', ctx()).length;
    const lofi = generate('bass', 'lofi', ctx()).length;
    expect(acid).toBeGreaterThan(lofi);
  });
  it('is deterministic for a fixed rng seed', () => {
    expect(generate('bass', 'acid', ctx())).toEqual(generate('bass', 'acid', ctx()));
  });
});
```

- [ ] **Step 2: Ejecutar y ver fallar**

Run: `NO_COLOR=1 npx vitest run src/core/generators.test.ts`
Expected: FAIL — módulo inexistente.

- [ ] **Step 3: Implementar `generators.ts`**

```ts
// src/core/generators.ts
// Generadores de notas por estilo, anclados a una tonalidad. Sustituyen el azar
// plano de session/clip-randomize. Puros: rng inyectable → deterministas en test.
import { TICKS_PER_STEP, type NoteEvent } from './notes';
import { scaleDegreeToMidi, type ScaleId, type StyleId } from './musicality';

export type GenKind = 'bass' | 'melody' | 'beat';
export interface GenContext {
  key: number; scale: ScaleId;
  bars: number; stepsPerBar: number;
  octaveBase: number;          // midi de la octava base del editor (p. ej. 36 = C2)
  rng: () => number;           // [0,1)
}

const GM = { kick: 36, snare: 38, hat: 42, openhat: 46, clap: 39 } as const;
const ACCENT = 115, NORM = 80;

interface BassCfg { density: number; octaves: number[]; slideChance: number; accentChance: number; degreePool: number[]; }
const BASS: Record<StyleId, BassCfg> = {
  acid:      { density: 0.7,  octaves: [0, 1],     slideChance: 0.35, accentChance: 0.3,  degreePool: [0, 0, 0, 2, 4, 6] },
  house:     { density: 0.45, octaves: [0],        slideChance: 0.1,  accentChance: 0.2,  degreePool: [0, 4, 0, 2] },
  synthwave: { density: 0.55, octaves: [0, 1],     slideChance: 0.05, accentChance: 0.25, degreePool: [0, 2, 4, 0] },
  lofi:      { density: 0.22, octaves: [0],        slideChance: 0.0,  accentChance: 0.1,  degreePool: [0, 4, 6] },
};
interface MelCfg { density: number; longChance: number; spanDegrees: number; }
const MEL: Record<StyleId, MelCfg> = {
  acid:      { density: 0.35, longChance: 0.1, spanDegrees: 7 },
  house:     { density: 0.3,  longChance: 0.3, spanDegrees: 7 },
  synthwave: { density: 0.45, longChance: 0.2, spanDegrees: 9 },
  lofi:      { density: 0.18, longChance: 0.5, spanDegrees: 5 },
};
interface BeatCfg { kickEveryBeat: boolean; snareBackbeat: boolean; hatChance: number; hatStep: number; openHatChance: number; }
const BEAT: Record<StyleId, BeatCfg> = {
  acid:      { kickEveryBeat: true,  snareBackbeat: false, hatChance: 0.8, hatStep: 1, openHatChance: 0.1 },
  house:     { kickEveryBeat: true,  snareBackbeat: true,  hatChance: 0.9, hatStep: 2, openHatChance: 0.2 },
  synthwave: { kickEveryBeat: false, snareBackbeat: true,  hatChance: 0.6, hatStep: 2, openHatChance: 0.05 },
  lofi:      { kickEveryBeat: false, snareBackbeat: true,  hatChance: 0.4, hatStep: 2, openHatChance: 0.0 },
};

const pick = <T,>(arr: T[], rng: () => number): T => arr[Math.floor(rng() * arr.length)];

function genBass(style: StyleId, c: GenContext): NoteEvent[] {
  const cfg = BASS[style];
  const steps = c.bars * c.stepsPerBar;
  const out: NoteEvent[] = [];
  for (let i = 0; i < steps; i++) {
    if (c.rng() >= cfg.density) continue;
    const degree = pick(cfg.degreePool, c.rng) + pick(cfg.octaves, c.rng) * 7;
    const midi = scaleDegreeToMidi(degree, c.octaveBase, c.key, c.scale);
    const slide = c.rng() < cfg.slideChance;
    out.push({
      start: i * TICKS_PER_STEP,
      duration: Math.floor(TICKS_PER_STEP * (slide ? 1.5 : 0.92)), // slide = duración solapada (ver notes.ts)
      midi,
      velocity: c.rng() < cfg.accentChance ? ACCENT : NORM,
    });
  }
  if (out.length === 0) out.push({ start: 0, duration: TICKS_PER_STEP, midi: scaleDegreeToMidi(0, c.octaveBase, c.key, c.scale), velocity: NORM });
  return out;
}

function genMelody(style: StyleId, c: GenContext): NoteEvent[] {
  const cfg = MEL[style];
  const steps = c.bars * c.stepsPerBar;
  const out: NoteEvent[] = [];
  let degree = 0;
  const melBase = c.octaveBase + 12; // una octava por encima del bajo
  for (let i = 0; i < steps; i++) {
    if (c.rng() >= cfg.density) continue;
    // contorno: paseo aleatorio acotado, sesgado a volver al centro
    degree += Math.round((c.rng() - 0.5) * 4);
    degree = Math.max(0, Math.min(cfg.spanDegrees, degree));
    const long = c.rng() < cfg.longChance;
    out.push({
      start: i * TICKS_PER_STEP,
      duration: TICKS_PER_STEP * (long ? 2 : 1),
      midi: scaleDegreeToMidi(degree, melBase, c.key, c.scale),
      velocity: c.rng() < 0.25 ? ACCENT : NORM,
    });
  }
  // resolución a la tónica en el último step si hay hueco
  const lastStart = (steps - 1) * TICKS_PER_STEP;
  if (!out.some((n) => n.start === lastStart)) {
    out.push({ start: lastStart, duration: TICKS_PER_STEP, midi: scaleDegreeToMidi(0, melBase, c.key, c.scale), velocity: NORM });
  }
  return out;
}

function genBeat(style: StyleId, c: GenContext): NoteEvent[] {
  const cfg = BEAT[style];
  const steps = c.bars * c.stepsPerBar;
  const stepsPerBeat = c.stepsPerBar / 4;
  const out: NoteEvent[] = [];
  const at = (i: number, midi: number, vel: number) => out.push({ start: i * TICKS_PER_STEP, duration: TICKS_PER_STEP, midi, velocity: vel });
  for (let i = 0; i < steps; i++) {
    const onBeat = i % stepsPerBeat === 0;
    const beatIdx = Math.floor(i / stepsPerBeat) % 4;
    if (onBeat && (cfg.kickEveryBeat || beatIdx === 0)) at(i, GM.kick, ACCENT);
    if (cfg.snareBackbeat && onBeat && (beatIdx === 1 || beatIdx === 3)) at(i, GM.snare, NORM);
    if (i % cfg.hatStep === 0 && c.rng() < cfg.hatChance) {
      at(i, c.rng() < cfg.openHatChance ? GM.openhat : GM.hat, 70);
    }
  }
  // garantía: kick en el primer downbeat
  if (!out.some((n) => n.midi === GM.kick && n.start === 0)) at(0, GM.kick, ACCENT);
  return out;
}

export function generate(kind: GenKind, style: StyleId, ctx: GenContext): NoteEvent[] {
  if (kind === 'bass') return genBass(style, ctx);
  if (kind === 'melody') return genMelody(style, ctx);
  return genBeat(style, ctx);
}
```

- [ ] **Step 4: Ejecutar y ver pasar**

Run: `NO_COLOR=1 npx vitest run src/core/generators.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/core/generators.ts src/core/generators.test.ts
git commit -m "feat(musicality): genre generators (bass/melody/beat) in scale"
```

---

### Tarea 13: el 🎲 usa los generadores y el estilo global

**Files:**
- Modify: `src/session/session-inspector.ts` (handler de `#insp-random-notes` ~193-212; imports ~16)

- [ ] **Step 1: Sustituir la llamada del 🎲**

En `session-inspector.ts`:
- Reemplazar el import de la línea 16 `import { randomizeClipNotes } from './clip-randomize';` por:
  ```ts
  import { generate, type GenKind } from '../core/generators';
  import { resolveTonality } from './session';
  ```
- Añadir un helper de `kind` (junto a la clase o como función de módulo):
  ```ts
  function genKindFor(engineId: string): GenKind {
    if (engineId === 'tb303') return 'bass';
    if (engineId === 'drums-machine') return 'beat';
    return 'melody';
  }
  ```
- Reemplazar el cuerpo del handler `#insp-random-notes` (líneas 196-210) por:
  ```ts
      const run = () => {
        const octaveBase = this.roll?.getOctaveBase?.() ?? 60;
        const ton = resolveTonality(lane!, this.deps.state);
        const style = this.deps.state.musicality?.style ?? 'acid';
        const stepsPerBarVal = stepsPerBar(this.deps.seq.meter);
        clip.notes = generate(genKindFor(lane!.engineId), style, {
          key: ton.key, scale: ton.scale,
          bars: clip.lengthBars, stepsPerBar: stepsPerBarVal,
          octaveBase: octaveBase - 12,   // el bajo suena una octava por debajo de la vista
          rng: Math.random,
        });
        this.renderEditor();
        this.roll?.setOctaveBase?.(octaveBase);
      };
  ```
- Añadir el import de `stepsPerBar` si no está:
  ```ts
  import { stepsPerBar } from '../core/meter';
  ```

- [ ] **Step 2: Retirar `scaleSel`/`rootSel` de `InspectorDeps`**

Eliminar los campos `scaleSel?`/`rootSel?` de `InspectorDeps` (líneas 34-37) y cualquier
referencia restante. (En `main.ts` ya se quitaron del objeto de deps en la Tarea 6.)

- [ ] **Step 3: Borrar el módulo de azar obsoleto**

`src/session/clip-randomize.ts` y `src/session/clip-randomize.test.ts` quedan sin uso.
Eliminarlos:

```bash
git rm src/session/clip-randomize.ts src/session/clip-randomize.test.ts
```

- [ ] **Step 4: Build + suite + smoke**

Run: `npx tsc --noEmit` → limpio.
Run: `NO_COLOR=1 npx vitest run` → verde (re-ejecutar si aparece el teardown flaky `ERR_IPC_CHANNEL_CLOSED`).
Smoke `npm run dev`: en una pista TB-303, 🎲 genera un bajo acid en tono; cambiar el estilo
global a "House" y volver a pulsar 🎲 da otro carácter; en la pista de drums, 🎲 da un beat.

- [ ] **Step 5: Commit**

```bash
git add src/session/session-inspector.ts
git commit -m "feat(musicality): 🎲 generates by global style in the project tonality"
```

---

## FASE 5 — Galería de ejemplos

### Tarea 14: `example-loader.ts` (formato + carga + render por grados)

**Files:**
- Create: `src/session/example-loader.ts`
- Test: `src/session/example-loader.test.ts`

- [ ] **Step 1: Escribir el test que falla**

```ts
// src/session/example-loader.test.ts
import { describe, it, expect } from 'vitest';
import { renderExampleNotes, validateExample, type Example } from './example-loader';
import { inScale } from '../core/musicality';

const melodic: Example = {
  id: 'b1', name: 'Acid roller', style: 'acid', kind: 'bass', bars: 1,
  degrees: [{ start: 0, duration: 24, degree: 0, octave: 0, velocity: 115 },
            { start: 24, duration: 24, degree: 2, octave: 0, velocity: 80 }],
};
const beat: Example = {
  id: 'd1', name: 'Four floor', style: 'house', kind: 'beat', bars: 1,
  notes: [{ start: 0, duration: 24, midi: 36, velocity: 115 }],
};

describe('example loader', () => {
  it('validates melodic and beat examples', () => {
    expect(validateExample(melodic)).toBe(true);
    expect(validateExample(beat)).toBe(true);
    expect(validateExample({ id: 'x' })).toBe(false);
  });
  it('renders melodic degrees into the target tonality (in scale)', () => {
    const notes = renderExampleNotes(melodic, { key: 9, scale: 'minor' }, 36);
    expect(notes.length).toBe(2);
    for (const n of notes) expect(inScale(n.midi, 9, 'minor')).toBe(true);
  });
  it('passes beat notes through unchanged (GM)', () => {
    const notes = renderExampleNotes(beat, { key: 9, scale: 'minor' }, 36);
    expect(notes[0].midi).toBe(36);
  });
});
```

- [ ] **Step 2: Ejecutar y ver fallar**

Run: `NO_COLOR=1 npx vitest run src/session/example-loader.test.ts`
Expected: FAIL — módulo inexistente.

- [ ] **Step 3: Implementar `example-loader.ts`**

```ts
// src/session/example-loader.ts
// Galería de ejemplos (estilo Classic). Los melódicos se guardan en GRADOS de
// escala → encajan en cualquier tonalidad; los beats en notas GM tal cual.
import { scaleDegreeToMidi, type ScaleId, type StyleId } from '../core/musicality';
import { type NoteEvent } from '../core/notes';

export interface ExampleDegree { start: number; duration: number; degree: number; octave: number; velocity: number; }
export interface Example {
  id: string; name: string; style: StyleId; kind: 'bass' | 'melody' | 'beat'; bars: number;
  degrees?: ExampleDegree[];   // melódicos
  notes?: NoteEvent[];         // beats (GM)
}
interface ExampleFile { style: StyleId; examples: unknown[]; }

export function validateExample(raw: unknown): raw is Example {
  if (typeof raw !== 'object' || raw === null) return false;
  const r = raw as Record<string, unknown>;
  if (typeof r.id !== 'string' || typeof r.name !== 'string') return false;
  if (typeof r.bars !== 'number') return false;
  if (r.kind !== 'bass' && r.kind !== 'melody' && r.kind !== 'beat') return false;
  return Array.isArray(r.degrees) || Array.isArray(r.notes);
}

/** Render an example into concrete NoteEvent[] for the given tonality. */
export function renderExampleNotes(
  ex: Example, ton: { key: number; scale: ScaleId }, octaveBase: number,
): NoteEvent[] {
  if (ex.notes) return ex.notes.map((n) => ({ ...n }));        // beats: tal cual
  return (ex.degrees ?? []).map((d) => ({
    start: d.start, duration: d.duration, velocity: d.velocity,
    midi: scaleDegreeToMidi(d.degree + d.octave * 7, octaveBase, ton.key, ton.scale),
  }));
}

const cache = new Map<StyleId, Example[]>();
export async function loadExamples(style: StyleId): Promise<Example[]> {
  if (cache.has(style)) return cache.get(style)!;
  const url = `${import.meta.env.BASE_URL}examples/${style}.json`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to load ${url}: ${res.status}`);
  const body = (await res.json()) as ExampleFile;
  const out = (body.examples ?? []).filter(validateExample) as Example[];
  cache.set(style, out);
  return out;
}
export function __resetExampleCache(): void { cache.clear(); }
```

- [ ] **Step 4: Ejecutar y ver pasar**

Run: `NO_COLOR=1 npx vitest run src/session/example-loader.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/session/example-loader.ts src/session/example-loader.test.ts
git commit -m "feat(musicality): example loader (degrees→tonality render, GM beats)"
```

---

### Tarea 15: set inicial de ejemplos + script de siembra

**Files:**
- Create: `public/examples/acid.json`, `house.json`, `synthwave.json`, `lofi.json`
- Create: `tools/build-examples.mjs`

- [ ] **Step 1: Crear un set inicial mínimo (a mano, válido)**

`public/examples/acid.json` (el resto, análogos para cada estilo, ≥2 entradas por kind):

```json
{
  "style": "acid",
  "examples": [
    { "id": "acid-bass-1", "name": "Roller 16th", "style": "acid", "kind": "bass", "bars": 1,
      "degrees": [
        { "start": 0, "duration": 36, "degree": 0, "octave": 0, "velocity": 115 },
        { "start": 24, "duration": 24, "degree": 0, "octave": 1, "velocity": 80 },
        { "start": 48, "duration": 24, "degree": 2, "octave": 0, "velocity": 80 },
        { "start": 72, "duration": 36, "degree": 0, "octave": 0, "velocity": 115 }
      ] },
    { "id": "acid-melody-1", "name": "Squelch lead", "style": "acid", "kind": "melody", "bars": 1,
      "degrees": [
        { "start": 0, "duration": 24, "degree": 4, "octave": 0, "velocity": 90 },
        { "start": 48, "duration": 24, "degree": 2, "octave": 0, "velocity": 80 },
        { "start": 96, "duration": 48, "degree": 0, "octave": 0, "velocity": 80 }
      ] },
    { "id": "acid-beat-1", "name": "Four-on-floor", "style": "acid", "kind": "beat", "bars": 1,
      "notes": [
        { "start": 0, "duration": 24, "midi": 36, "velocity": 115 },
        { "start": 24, "duration": 12, "midi": 42, "velocity": 70 },
        { "start": 48, "duration": 24, "midi": 36, "velocity": 110 },
        { "start": 72, "duration": 12, "midi": 42, "velocity": 70 }
      ] }
  ]
}
```

> Repetir la misma forma para `house.json`, `synthwave.json`, `lofi.json` con valores
> coherentes con cada estilo (densidad/octavas/patrón de hats según las tablas de la Tarea 12).

- [ ] **Step 2: Script de siembra (opcional, regenera candidatos)**

`tools/build-examples.mjs` — node script que importa los generadores y vuelca candidatos a
`public/examples/<style>.json` para que el humano los recorte/edite. Estructura mínima:

```js
// tools/build-examples.mjs
// Genera CANDIDATOS de ejemplos por estilo usando los generadores. El humano
// revisa a oído y deja los buenos. No sobrescribe sin --force.
import { writeFileSync, existsSync } from 'node:fs';
// NOTA: importar generators/musicality compilados o portar la lógica mínima aquí.
// Como el repo bundlea con Vite, lo más simple es portar un mulberry32 + llamar a
// generate() transpilado, o escribir los candidatos a mano. Este script queda como
// utilidad; el set inicial de la Step 1 es la fuente de verdad.
console.log('build-examples: ver docs; el set inicial vive en public/examples/*.json');
```

> El script es una conveniencia. La **fuente de verdad** es el JSON curado del Step 1.
> No bloquea el plan si se deja como stub documentado.

- [ ] **Step 3: Validar el JSON cargando en un test rápido**

Run: `node -e "for (const s of ['acid','house','synthwave','lofi']) JSON.parse(require('fs').readFileSync('public/examples/'+s+'.json'))"`
Expected: sin error (JSON válido).

- [ ] **Step 4: Commit**

```bash
git add public/examples tools/build-examples.mjs
git commit -m "feat(musicality): seed factory example library per style"
```

---

### Tarea 16: UI "Ejemplos…" en el inspector

**Files:**
- Modify: `index.html` (fila de botones del inspector, tras `#insp-random-notes` línea 313)
- Modify: `src/session/session-inspector.ts` (cablear el botón + picker)

- [ ] **Step 1: Botón en el HTML**

Tras la línea 313 (`#insp-random-notes`) añadir:

```html
            <button class="rnd" id="insp-examples" title="Cargar un ejemplo de fábrica">Ejemplos…</button>
```

- [ ] **Step 2: Cablear el botón en el inspector**

En `session-inspector.ts`, junto al handler del 🎲, añadir:

```ts
    document.getElementById('insp-examples')!.onclick = async () => {
      if (!this.selectedClip) return;
      const style = this.deps.state.musicality?.style ?? 'acid';
      const kind = genKindFor(lane!.engineId);
      const all = await loadExamples(style);
      const list = all.filter((e) => e.kind === kind);
      if (list.length === 0) { void alertDialog('No hay ejemplos para este tipo de pista todavía.'); return; }
      const chosen = await pickExample(list);   // ver Step 3
      if (!chosen) return;
      const d = this.deps.historyDeps;
      const run = () => {
        const ton = resolveTonality(lane!, this.deps.state);
        const octaveBase = (this.roll?.getOctaveBase?.() ?? 60) - 12;
        clip.notes = renderExampleNotes(chosen, ton, octaveBase);
        this.renderEditor();
      };
      if (d) withUndo(d, run); else run();
    };
```

Añadir imports:

```ts
import { loadExamples, renderExampleNotes, type Example } from './example-loader';
import { alertDialog } from '../core/dialog';
```

- [ ] **Step 3: Picker simple (reusa el patrón de diálogo)**

Añadir una función de módulo (en `session-inspector.ts` o un `example-picker.ts` aparte) que
muestre la lista y devuelva el elegido. Versión mínima con `<select>` en un diálogo:

```ts
async function pickExample(list: Example[]): Promise<Example | null> {
  return new Promise((resolve) => {
    const overlay = document.createElement('div'); overlay.className = 'example-picker-overlay';
    const box = document.createElement('div'); box.className = 'example-picker';
    const sel = document.createElement('select');
    for (const e of list) { const o = document.createElement('option'); o.value = e.id; o.textContent = e.name; sel.appendChild(o); }
    const ok = document.createElement('button'); ok.textContent = 'Cargar';
    const cancel = document.createElement('button'); cancel.textContent = 'Cancelar';
    ok.onclick = () => { overlay.remove(); resolve(list.find((e) => e.id === sel.value) ?? null); };
    cancel.onclick = () => { overlay.remove(); resolve(null); };
    box.append(sel, ok, cancel); overlay.append(box); document.body.appendChild(overlay);
  });
}
```

> Si el repo tiene un helper de diálogo de selección (revisar `src/core/dialog.ts`), úsalo en
> vez de este overlay manual para mantener el estilo visual.

- [ ] **Step 4: Build + smoke (parity a oído/vista)**

Run: `npx tsc --noEmit` → limpio.
Run: `npm run dev`. En una pista TB-303 → "Ejemplos…" lista los bajos acid; elegir uno lo
carga en tono y suena bien al darle a Play. Repetir para drums (beat) y un sinte poli (melody).

- [ ] **Step 5: Commit**

```bash
git add index.html src/session/session-inspector.ts
git commit -m "feat(musicality): load factory examples from the inspector"
```

---

## FASE 6 — Cierre y verificación

### Tarea 17: verificación global

- [ ] **Step 1: Typecheck**

Run: `npx tsc --noEmit`
Expected: sin errores.

- [ ] **Step 2: Suite completa de unit**

Run: `NO_COLOR=1 npm run test:unit`
Expected: verde (re-ejecutar una vez si aparece el teardown flaky `ERR_IPC_CHANNEL_CLOSED`,
que NO es un fallo de test).

- [ ] **Step 3: Build de producción (para e2e si se corre)**

Run: `npm run build`
Expected: typecheck + bundle OK.

- [ ] **Step 4: Verificación a oído/vista (obligatoria — parity)**

`npm run dev` y comprobar, una por una:
1. Barra de tonalidad muestra `🎼 La menor · Acid / Techno`; cambiar tónica/escala/estilo persiste tras recargar.
2. Piano-roll resalta la escala + tónica; 🔒 impide colocar fuera de tono; 🔓 lo permite.
3. 🎲 en TB-303 → bajo acid en tono; cambiar estilo a House cambia el carácter.
4. 🎲 en drums → beat con kick a negras.
5. "Ejemplos…" carga un bajo/melodía/beat de fábrica que suena bien en la tonalidad actual.
6. Cargar un demo antiguo no peta y aplica el default de tonalidad.

- [ ] **Step 5: Rebase + commit final de notas (si procede)**

```bash
git rebase main
```

(Resolver conflictos si los hubiera; la rama debe quedar fast-forwardable.)

---

## Self-review (cobertura del spec)

| Requisito del spec | Tarea(s) |
|---|---|
| §1 Modelo de datos (musicality + override) | 2 |
| §1 Migración default | 3 |
| §2 Núcleo musical (inScale/snap/degrees/catálogo) | 1 |
| §3 UI tonalidad por sensación + estilo | 5, 6 |
| §3 Override por pista | 7 |
| §4 Resaltado piano-roll | 9, 11 |
| §4 Candado snap (lápiz/arrastre/teclado/pegar) | 8, 10, 11 |
| §4 Botón 🔒 conmutable + persistido | 11 |
| §5 Generadores de género (bass/melody/beat) | 12 |
| §5 🎲 usa estilo global | 13 |
| §6 Galería de ejemplos (loader + grados) | 14 |
| §6 Set inicial + script | 15 |
| §6 UI "Ejemplos…" | 16 |
| §7 Persistencia round-trip | 4 |
| §7 Tests + verificación a oído | todas + 17 |

**Decisión registrada (refina el spec):** el candado se aplica en la **colocación de notas**
(lápiz, arrastre de una nota, teclado, pegado). El **nudge ↑/↓ y el arrastre de selección NO
re-snappean** (microajuste deliberado que conserva la forma de la selección). Es coherente y
testeable; documentado en la Tarea 10.
