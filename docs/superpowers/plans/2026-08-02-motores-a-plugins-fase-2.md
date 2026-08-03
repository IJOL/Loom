# Motores a plugins, fase 2 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Dejar el host capaz de alojar los cinco motores melódicos como plugins externos — sin mover todavía ni uno.

**Architecture:** Ocho tareas que cierran, una a una, cada hueco que hoy impide que `tb303`, `subtractive`, `fm`, `wavetable` y `westcoast` se expresen como un `plugin.json` al estilo Karplus: el `EngineParamSpec` del SDK es más pobre que el del host, `optionsFrom` lleva una función, los primitivos DSP que arrastran viven en `src/`, el slide del 303 es un `engineId === 'tb303'` en el core, un motor ausente enmudece en silencio, y 21 tests registran motores importando su módulo. Al terminar, **ningún motor se ha movido y la suite está verde**.

**Tech Stack:** TypeScript 5.4, Vite 5, Vitest 3 (serial, entorno `node`), Playwright 1.60, esbuild 0.21, lit-html. Sin linter.

**Spec:** [docs/superpowers/specs/2026-08-02-motores-a-plugins-fase-2-design.md](../specs/2026-08-02-motores-a-plugins-fase-2-design.md)

**Worktree:** `.claude/worktrees/engines-as-plugins-p2`, rama `feat/engines-as-plugins-p2`.

## Global Constraints

- **Idioma:** todo el código, identificadores, comentarios, manifiestos y texto de UI en **inglés**. Sólo este plan y el spec van en castellano. **Los mensajes de commit en inglés SIEMPRE.**
- **Tamaño de fichero:** objetivo 300 líneas de código, tope duro 500 (líneas en blanco y comentarios NO cuentan).
- **Aserciones de test siempre relativas** (ratios, `>`, `<`), nunca magnitudes absolutas; un umbral absoluto se justifica en un comentario.
- **Colores de test:** invoca por script npm (`npm run test:unit`), o `NO_COLOR=1 npx vitest run <ruta>` para un fichero suelto. **No** añadas `--reporter=…`.
- **`npm run build` ANTES de `npm run test:e2e`** — Playwright sirve `dist/` sin construir.
- **`test:unit` tiene un teardown inestable**: puede salir con `ERR_IPC_CHANNEL_CLOSED` DESPUÉS de pasar todos los tests. No es un fallo; re-ejecuta para confirmar.
- **Commits con heredoc de Bash** (`git commit -F - <<'EOF'`), nunca here-string de PowerShell.
- **`git rebase main` muy a menudo.** `main` se mueve bajo este trabajo: ya introdujo `optionsFrom` con función mientras se escribía el spec. Tras cada rebase que toque un motor, relee §2 del spec.
- **Ningún `switch`/comparación nueva sobre `engineId` en `src/`.** Si el core necesita saber algo de un motor, lo pregunta a `src/plugins/capabilities.ts`.

---

## File Structure

**SDK (`packages/loom-plugin-sdk/src/`)** — pasa a ser el dueño de lo que un plugin compila:
- `manifest.ts` — `EngineParamSpec` gana los campos declarativos que hoy sólo tiene el host; `EngineCapabilities` gana `slide`.
- `dsp/osc.ts`, `dsp/ladder.ts`, `dsp/filter.ts`, `dsp/unison.ts`, `dsp/fold.ts`, `dsp/comb.ts`, `dsp/filter-stack.ts`, `dsp/filter-kinds.ts` — **movidos** desde `src/audio-dsp/`.
- `index.ts` — los re-exporta.

**Host (`src/`)** — modificados:
- `engines/engine-params.ts` — `EngineParamSpec` deja de declararse aquí y extiende el del SDK.
- `engines/engine-param-grid.ts`, `app/knob-mounting.ts` — leen `optionsFrom.table` en vez de llamar `.build()`.
- `engines/subtractive-params.ts` — sus dos `optionsFrom` pasan a tabla.
- `audio-dsp/osc.ts`, `ladder.ts`, `filter.ts`, `unison.ts`, `fold.ts`, `comb.ts`, `filter-stack.ts`, `filter-kinds.ts` — quedan como re-exports de una línea.
- `plugins/capabilities.ts` — gana `slidesOnOverlap(id)`.
- `core/lane-scheduler.ts` — `noteTrigger` pregunta la capacidad, no el id.
- `engines/tb303.ts`, `subtractive.ts`, `fm.ts`, `wavetable.ts`, `westcoast.ts` — cada uno registra sus capacidades.
- `session/session-host-util.ts` — muere la cadena ternaria de `nextLaneSlug`.
- `session/lane-editor-panels.ts` — nuevo panel `missingEngine`.

**Nuevos:**
- `packages/loom-plugin-sdk/src/dsp/unison.test.ts`, `dsp/fold.test.ts` — los dos primitivos que hoy no tienen test.
- `test/plugin-fixtures.ts` — registra un plugin leyendo su `plugin.json` real.
- `src/session/missing-engine.test.ts` — el contrato de motor ausente.

---

### Task 1: Un solo `EngineParamSpec`

Hoy hay **dos** tipos con ese nombre: el del host ([src/engines/engine-params.ts:6](../../../src/engines/engine-params.ts)) con `curve`, `color`, `drawnBy`, `optionsFrom`, `selectStyle` y `showLabel`; y el del SDK ([packages/loom-plugin-sdk/src/manifest.ts:14](../../../packages/loom-plugin-sdk/src/manifest.ts)) sin ninguno de ellos. Un manifiesto no puede declararlos, y los cinco motores los usan: `curve` (fm 1, wavetable 3, westcoast 2), `drawnBy` (subtractive **10**, wavetable 1), `selectStyle` (fm 1), `color` (los cuatro). Verificado por conteo el 2026-08-02.

**Files:**
- Modify: `packages/loom-plugin-sdk/src/manifest.ts:14-27`
- Modify: `src/engines/engine-params.ts:6-60`
- Test: `packages/loom-plugin-sdk/src/manifest.test.ts` (crear si no existe)

**Interfaces:**
- Produces: `EngineParamSpec` con `curve?: 'linear' | 'exponential' | 'log'`, `color?: string`, `drawnBy?: 'mixer' | 'modulators'`, `selectStyle?: 'dropdown'`, `showLabel?: boolean`. Exportado desde `@loom/plugin-sdk`. `src/engines/engine-params.ts` lo re-exporta con el mismo nombre, así que **ningún importador del host cambia**.

- [ ] **Step 1: Write the failing test**

En `packages/loom-plugin-sdk/src/manifest.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import type { EngineParamSpec } from './manifest';

describe('the SDK EngineParamSpec', () => {
  it('carries every declarative field the host grid reads', () => {
    // A manifest is JSON, so this is the whole vocabulary a plugin author has.
    // Anything the host's grid honours but this type omits is a field a plugin
    // silently cannot use — which is how the five in-tree engines came to
    // depend on curve/color/drawnBy/selectStyle while Karplus could not.
    const spec: EngineParamSpec = {
      id: 'filter.cutoff', label: 'Cutoff', kind: 'continuous',
      min: 0, max: 1, default: 0.5,
      curve: 'exponential', color: 'var(--knob-cyan)',
      drawnBy: 'modulators', selectStyle: 'dropdown', showLabel: false,
      unit: 'Hz', group: 'filter',
    };
    expect(spec.curve).toBe('exponential');
    expect(spec.drawnBy).toBe('modulators');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `NO_COLOR=1 npx vitest run packages/loom-plugin-sdk/src/manifest.test.ts`
Expected: FAIL — `tsc`/vitest rechaza `curve`, `color`, `drawnBy`, `selectStyle`, `showLabel` como propiedades desconocidas de `EngineParamSpec`.

- [ ] **Step 3: Add the fields to the SDK type**

En `packages/loom-plugin-sdk/src/manifest.ts`, dentro de `interface EngineParamSpec`, después de `options?`:

```ts
  /** Knob taper. Absent ⇒ linear. */
  curve?: 'linear' | 'exponential' | 'log';
  /** Knob ring colour (any CSS colour, including a custom property). Overrides
   *  the colour the param's group declares. */
  color?: string;
  /** Declared for automation / modulation / presets / saves, but NOT drawn by
   *  the editor grid — the named surface draws it. Never means "drawn nowhere". */
  drawnBy?: 'mixer' | 'modulators';
  /** Discrete only: force a native <select> instead of the radio strip. */
  selectStyle?: 'dropdown';
  /** Discrete only: suppress the control's own name. Default true in the grid. */
  showLabel?: boolean;
```

- [ ] **Step 4: Make the host type extend it instead of redeclaring it**

En `src/engines/engine-params.ts`, sustituye la declaración de la interfaz por:

```ts
// The shape is owned by @loom/plugin-sdk: it is what a plugin's manifest
// declares, so the host cannot honour a field the SDK does not publish — that
// asymmetry is exactly what kept curve/color/drawnBy out of reach of a plugin.
// Re-exported under the same name so no importer in src/ changes.
export type { EngineParamSpec } from '@loom/plugin-sdk';
```

Conserva en este fichero todo lo que NO sea la interfaz (constantes, helpers). Los comentarios largos de cada campo se mueven al SDK junto al campo que documentan.

- [ ] **Step 5: Run the test and the typecheck**

Run: `NO_COLOR=1 npx vitest run packages/loom-plugin-sdk/src/manifest.test.ts && npx tsc --noEmit`
Expected: PASS y typecheck limpio. Si `tsc` se queja en algún fichero de `src/engines/`, es que ese fichero usaba un campo que el SDK aún no declara — añádelo al SDK, no lo quites del uso.

- [ ] **Step 6: Run the full unit suite**

Run: `npm run test:unit`
Expected: verde. (Recuerda: `ERR_IPC_CHANNEL_CLOSED` en el teardown no es un fallo — re-ejecuta.)

- [ ] **Step 7: Commit**

```bash
git add packages/loom-plugin-sdk/src/manifest.ts packages/loom-plugin-sdk/src/manifest.test.ts src/engines/engine-params.ts
git commit -F - <<'EOF'
refactor(sdk): one EngineParamSpec, owned by the SDK

There were two types with that name. The host's carried curve, color,
drawnBy, selectStyle and showLabel; the SDK's carried none of them. A
manifest is JSON, so that asymmetry meant a plugin silently could not use
fields the five in-tree engines depend on — subtractive alone declares
drawnBy ten times.

The SDK now owns the shape and the host re-exports it, so no importer in
src/ changes.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
```

---

### Task 2: `optionsFrom` deja de llevar una función

`{ paramId: 'filter.model', build: typeOptionsFor }` no cabe en un JSON. Pasa a ser una tabla: una lista de opciones por cada valor del param de origen.

**Files:**
- Modify: `packages/loom-plugin-sdk/src/manifest.ts` (el campo, junto a los de la Task 1)
- Modify: `src/engines/engine-param-grid.ts:93-94`
- Modify: `src/app/knob-mounting.ts:99-103`
- Modify: `src/engines/subtractive-params.ts:69,95`
- Modify: `src/audio-dsp/filter-kinds.ts` (añadir el generador de la tabla)
- Test: `src/app/refresh-lane-knobs-optionsfrom.test.ts`, `src/engines/engine-param-grid.test.ts`

**Interfaces:**
- Consumes: `EngineParamSpec` del SDK (Task 1).
- Produces: `optionsFrom?: { paramId: string; table: Record<string, Array<{ value: string; label: string }>> }`. La clave de `table` es el valor del param de origen **como string** (`"0"`, `"1"`, …), porque un JSON no tiene claves numéricas. Y `TYPE_OPTIONS_BY_MODE: Record<string, Array<{ value: string; label: string }>>` exportado desde `filter-kinds.ts`.

- [ ] **Step 1: Write the failing test**

Añade a `src/engines/engine-param-grid.test.ts`:

```ts
it('builds a derived control from the table, not a function', () => {
  // The manifest of a plugin is JSON: it cannot carry `build`. The grid must
  // read the SAME derivation from data, or Subtractive cannot be a plugin.
  const specs: EngineParamSpec[] = [
    { id: 'filter.model', label: 'Mode', kind: 'discrete', min: 0, max: 3, default: 0,
      options: FILTER_MODE_OPTIONS, group: 'filter' },
    { id: 'filter.type', label: 'Type', kind: 'discrete', min: 0, max: 3, default: 0,
      options: TYPE_OPTIONS_BY_MODE['0'],
      optionsFrom: { paramId: 'filter.model', table: TYPE_OPTIONS_BY_MODE },
      group: 'filter' },
  ];
  const engine = makeStubEngine(specs, { 'filter.model': 1, 'filter.type': 0 });
  const el = buildEngineParamGrid(engine, makeCtx());
  const typeControl = el.querySelector('[data-param-id="filter.type"]')!;
  // Mode 1 (MOG) offers three taps, not the four DIG offers. Relative
  // assertion: the derived list must differ in length from the static one.
  expect(typeControl.querySelectorAll('button').length)
    .toBe(TYPE_OPTIONS_BY_MODE['1'].length);
  expect(TYPE_OPTIONS_BY_MODE['1'].length)
    .toBeLessThan(TYPE_OPTIONS_BY_MODE['0'].length);
});
```

Ajusta `makeStubEngine`/`makeCtx`/el selector a los helpers que ya usa ese fichero (léelo antes: sus tests actuales de `optionsFrom` están en las líneas 446 y 472 y ya construyen un motor de prueba).

- [ ] **Step 2: Run it to verify it fails**

Run: `NO_COLOR=1 npx vitest run src/engines/engine-param-grid.test.ts`
Expected: FAIL — `TYPE_OPTIONS_BY_MODE` no existe y `optionsFrom.table` no es una propiedad válida.

- [ ] **Step 3: Publish the table from `filter-kinds.ts`**

En `src/audio-dsp/filter-kinds.ts`, junto a `typeOptionsFor`:

```ts
/** The Type control's options for EVERY mode, keyed by the mode's index as a
 *  string. This is the form a manifest can carry — JSON has no numeric keys and
 *  no functions — and it is what `optionsFrom.table` reads. `typeOptionsFor`
 *  stays as the generator that builds it, and as the accessor the DSP uses. */
export const TYPE_OPTIONS_BY_MODE: Record<string, Array<{ value: string; label: string }>> =
  Object.fromEntries(FILTER_MODES.map((_m, i) => [String(i), typeOptionsFor(i)]));
```

- [ ] **Step 4: Change the field's type**

En `packages/loom-plugin-sdk/src/manifest.ts`, dentro de `EngineParamSpec`:

```ts
  /** Discrete params only: this control's options come from ANOTHER param's
   *  current value, and the control is rebuilt when that param changes. It is
   *  how a control offers only what the rest of the patch makes honest — the
   *  filter Type offers only the taps the chosen Mode has.
   *
   *  A TABLE, not a function: a plugin declares its params in plugin.json, and
   *  JSON carries neither functions nor numeric keys. The key is the source
   *  param's value as a string; a value with no entry falls back to `options`.
   *  `options` stays as the list for the source param's DEFAULT value, so
   *  anything reading the spec statically still sees a valid list. */
  optionsFrom?: { paramId: string; table: Record<string, Array<{ value: string; label: string }>> };
```

- [ ] **Step 5: Change the two production consumers**

En `src/engines/engine-param-grid.ts`, sustituye las líneas 93-95:

```ts
    const options = spec.optionsFrom
      ? (spec.optionsFrom.table[String(Math.round(engine.getBaseValue(spec.optionsFrom.paramId)))]
         ?? spec.options!)
      : spec.options!;
```

En `src/app/knob-mounting.ts`, sustituye las líneas 99-103:

```ts
        const options = spec.kind === 'discrete'
          ? (spec.optionsFrom
              ? (spec.optionsFrom.table[String(Math.round(engine.getBaseValue(spec.optionsFrom.paramId)))]
                 ?? spec.options)
              : spec.options)
          : undefined;
```

El `Math.round` es el mismo redondeo que ya hacían ambos sitios sobre el valor del param; el `?? spec.options` es la caída documentada en el tipo, para un valor de origen sin entrada.

- [ ] **Step 6: Change the two declarations**

En `src/engines/subtractive-params.ts`, líneas 69 y 95, sustituye `optionsFrom: { paramId: 'filter.model', build: typeOptionsFor }` por `optionsFrom: { paramId: 'filter.model', table: TYPE_OPTIONS_BY_MODE }` (y `filter2.model` en la segunda). Cambia el import de `typeOptionsFor` por `TYPE_OPTIONS_BY_MODE` donde ya no se use la función, y sustituye `options: typeOptionsFor(0)` por `options: TYPE_OPTIONS_BY_MODE['0']`.

- [ ] **Step 7: Update the existing optionsFrom tests**

En `src/app/refresh-lane-knobs-optionsfrom.test.ts:33` y en `src/engines/engine-param-grid.test.ts:446,472`, cambia `build: typeOptionsFor` por `table: TYPE_OPTIONS_BY_MODE`. **No cambies lo que afirman** — siguen probando lo mismo: que la lista derivada puede tener otra longitud que la estática.

- [ ] **Step 8: Run the affected tests, then the suite**

Run: `NO_COLOR=1 npx vitest run src/engines/engine-param-grid.test.ts src/app/refresh-lane-knobs-optionsfrom.test.ts src/presets/subtractive-filter-presets.test.ts`
Expected: PASS.

Run: `npm run test:unit && npx tsc --noEmit`
Expected: verde.

- [ ] **Step 9: Commit**

```bash
git add packages/loom-plugin-sdk/src/manifest.ts src/audio-dsp/filter-kinds.ts src/engines/engine-param-grid.ts src/engines/engine-param-grid.test.ts src/engines/subtractive-params.ts src/app/knob-mounting.ts src/app/refresh-lane-knobs-optionsfrom.test.ts
git commit -F - <<'EOF'
refactor(params): optionsFrom is a table, not a function

A plugin declares its params in plugin.json, and JSON carries neither
functions nor numeric keys. optionsFrom shipped as { paramId, build: fn },
which meant Subtractive — the engine with the most presets and the most use
— could not be expressed as a manifest at all.

It is now { paramId, table }, keyed by the source param's value as a string.
typeOptionsFor survives as the generator that builds the table. Two
production consumers called .build(); both now index the table.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
```

---

### Task 3: `unison` y `fold` estrenan test

Ninguno de los dos tiene test propio (comprobado: `src/audio-dsp/` tiene `osc.test.ts`, `ladder.test.ts` y `filter.test.ts`, pero no `unison.test.ts` ni `fold.test.ts`). En la Task 4 se convierten en **API pública** del SDK, y un tercero dependiendo de un primitivo sin cobertura es deuda que se paga fuera de este repo. Los tests se escriben **antes** de moverlos, contra su ubicación actual.

**Files:**
- Test: `src/audio-dsp/unison.test.ts` (crear), `src/audio-dsp/fold.test.ts` (crear)

**Interfaces:**
- Consumes: `fold(input: number, driveGain: number): number` de `src/audio-dsp/fold.ts` — es `sin(clamp(input·driveGain, −1, 1) · 4π)`. Y de `src/audio-dsp/unison.ts`: `new UnisonStack(wave: number, count: number, sr: number)`, su método `update(freq, pw, baseCents, spreadCents, driftAmt): number`, la propiedad `gain = 1/n^0.3`, `MAX_UNISON = 7` y `driftDepthFor(freq: number)` — que toma una **frecuencia**, no un tamaño de pila (`freq < 200 ? 0.002 : 0.005`).

⚠️ Estas firmas están verificadas leyendo los dos ficheros el 2026-08-02. Dos trampas que ya costaron una versión mala de estos tests: `fold(x, 0)` devuelve **0**, no `x` (el drive multiplica ANTES del seno, así que no hay camino de paso directo); y el folder tiene ganancia ~4π cerca de cero, no 1.

- [ ] **Step 1: Write the fold test**

`src/audio-dsp/fold.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { fold } from './fold';

describe('the wavefolder', () => {
  it('a drive of zero silences it — it is not a bypass', () => {
    // sin(0) = 0. Worth pinning because "amount 0 = clean" is the intuition
    // every other FX in the tree obeys, and this one does not: the drive
    // multiplies the input BEFORE the sine, so zero drive is silence. The West
    // Coast renderer relies on that (its floor is 0.1, never 0).
    expect(fold(0.5, 0)).toBe(0);
  });

  it('folds back instead of clipping: more input, less output', () => {
    // THE property, and what separates a folder from a clipper. At drive 1 the
    // input 0.125 sits on the sine's first peak and 0.25 on its zero crossing,
    // so pushing HARDER gives LESS. A clipper can never do this.
    expect(Math.abs(fold(0.25, 1))).toBeLessThan(Math.abs(fold(0.125, 1)));
  });

  it('is odd-symmetric, so it adds no DC', () => {
    // A folder that is not odd-symmetric thumps the amp with an offset.
    for (const x of [0.2, 0.5, 0.8, 1.0]) {
      expect(fold(-x, 1)).toBeCloseTo(-fold(x, 1), 12);
    }
  });

  it('clamps before folding, so it never runs away', () => {
    // Input beyond ±1/drive is clamped, so an enormous input lands exactly
    // where the boundary does rather than spinning through more lobes.
    expect(fold(5, 1)).toBeCloseTo(fold(1, 1), 12);
    for (const x of [2, 5, 20]) expect(Math.abs(fold(x, 1))).toBeLessThanOrEqual(1);
  });
});
```

- [ ] **Step 2: Write the unison test**

`src/audio-dsp/unison.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { UnisonStack, driftDepthFor, MAX_UNISON } from './unison';

const SR = 48000;
const SAW = 0;

function rms(xs: number[]): number {
  let s = 0;
  for (const x of xs) s += x * x;
  return Math.sqrt(s / xs.length);
}

/** One second of a stack at 220 Hz with the given size and spread. */
function capture(count: number, spreadCents: number, n = SR): number[] {
  const s = new UnisonStack(SAW, count, SR);
  const out: number[] = [];
  for (let i = 0; i < n; i++) out.push(s.update(220, 0.5, 0, spreadCents, 0));
  return out;
}

describe('the unison stack', () => {
  it('one copy is exactly one oscillator — gain 1, no compensation', () => {
    // The degenerate case has to be free, or turning unison off would still
    // change the level of every patch. 1^0.3 === 1.
    expect(new UnisonStack(SAW, 1, SR).gain).toBe(1);
  });

  it('a detuned stack is fatter but not N times louder', () => {
    // A stack that summed N copies without compensating would blow the
    // headroom of every preset that raises the voice count. Relative: the wide
    // stack must stay within a small factor of one copy, nowhere near 7x.
    const ratio = rms(capture(MAX_UNISON, 20)) / rms(capture(1, 20));
    expect(ratio).toBeGreaterThan(1);
    expect(ratio).toBeLessThan(3);
  });

  it('spread makes the copies beat; no spread leaves them coherent', () => {
    // Beating is amplitude variation over time. Relative: the spread stack's
    // envelope must move more between two windows than the coherent one's.
    const wander = (spreadCents: number): number => {
      const out = capture(MAX_UNISON, spreadCents);
      return Math.abs(rms(out.slice(0, SR / 8)) - rms(out.slice(SR / 2, SR / 2 + SR / 8)));
    };
    expect(wander(20)).toBeGreaterThan(wander(0));
  });

  it('the stack never exceeds MAX_UNISON copies however many are asked for', () => {
    // An unbounded count would allocate per voice on the audio thread.
    expect(new UnisonStack(SAW, 99, SR).gain)
      .toBeCloseTo(new UnisonStack(SAW, MAX_UNISON, SR).gain, 12);
  });

  it('drift depth is chosen by FREQUENCY, not by stack size', () => {
    // The same number of cents is far more Hz down low, so a drifting bass
    // just sounds out of tune. This also pins the argument's meaning, which
    // reads like a count and is not one.
    expect(driftDepthFor(400)).toBeGreaterThan(driftDepthFor(100));
  });
});
```

- [ ] **Step 3: Run both**

Run: `NO_COLOR=1 npx vitest run src/audio-dsp/fold.test.ts src/audio-dsp/unison.test.ts`
Expected: PASS, 9 tests. Si alguno falla, **el test miente y el primitivo no** — aquí se está capturando comportamiento existente, no cambiándolo. Corrige el test contra lo que el fichero hace.

- [ ] **Step 5: Commit**

```bash
git add src/audio-dsp/fold.test.ts src/audio-dsp/unison.test.ts
git commit -F - <<'EOF'
test(dsp): cover the wavefolder and the unison stack

Neither had a test. They are about to become public SDK API, and a
third-party plugin depending on an uncovered primitive is debt paid outside
this repo — so the cover goes on before the move, against the code as it
stands today.

The folder is pinned on the property that separates it from a clipper: past
the turning point the output decreases instead of flattening. The stack is
pinned on not getting louder as voices are added, which is what protects the
headroom of every preset that raises the voice count.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
```

---

### Task 4: los primitivos suben al SDK

**Files:**
- Create: `packages/loom-plugin-sdk/src/dsp/{osc,sync-osc,ladder,filter,unison,fold,comb,filter-stack,filter-kinds}.ts` (movidos con `git mv`)
- Create: `packages/loom-plugin-sdk/src/dsp/{osc,sync-osc,ladder,filter,comb,filter-stack,unison,fold}.test.ts` (movidos con sus primitivos; `unison`/`fold` los estrenó la Task 3)
- Modify: `packages/loom-plugin-sdk/src/index.ts`
- Modify: `src/audio-dsp/{osc,sync-osc,ladder,filter,unison,fold,comb,filter-stack,filter-kinds}.ts` → re-exports de una línea

**Interfaces:**
- Produces: `SawOsc`, `SquareOsc`, `SineOsc`, `TriOsc`, `WhiteNoise`, `SyncOsc`, `SYNC_RATIO_MIN`, `SYNC_RATIO_MAX`, `LadderFilter`, `LadderTap`, `Svf`, `UnisonStack`, `makeOsc`, `Osc`, `MAX_UNISON`, `driftDepthFor`, `fold`, `CombFilter`, `FilterStack`, `trackedCutoff`, `FilterTap`, `FILTER_MODES`, `tapFor`, `typeOptionsFor`, `TYPE_OPTIONS_BY_MODE`, `FILTER_MODE_OPTIONS`, `FILTER_ROUTING_OPTIONS`, `ROUTING_OFF|SER|PAR|DIFF` — todos desde `@loom/plugin-sdk`.

⚠️ **`sync-osc` va en la lista aunque el spec no lo nombre.** `unison.ts` lo importa (`import { SyncOsc } from './sync-osc'`) para su forma de onda 4, y sus únicos consumidores son `unison.ts` y su propio test — verificado el 2026-08-02. Un `UnisonStack` en el SDK que importara de `src/` sería precisamente el error de diseño que el Step 2 manda cazar.

El patrón de re-export ya existe y se copia literalmente: `src/audio-dsp/adsr.ts` es hoy `export { Adsr } from '@loom/plugin-sdk';`.

- [ ] **Step 1: Move the files with git mv, preserving history**

```bash
cd .claude/worktrees/engines-as-plugins-p2
for f in osc sync-osc ladder filter unison fold comb filter-stack filter-kinds; do
  git mv "src/audio-dsp/$f.ts" "packages/loom-plugin-sdk/src/dsp/$f.ts"
  if [ -f "src/audio-dsp/$f.test.ts" ]; then
    git mv "src/audio-dsp/$f.test.ts" "packages/loom-plugin-sdk/src/dsp/$f.test.ts"
  fi
done
```

- [ ] **Step 2: Fix the moved files' own imports**

Dentro de `packages/loom-plugin-sdk/src/dsp/`, los imports relativos a otros módulos de `src/audio-dsp/` ya no resuelven. Los que quedan dentro del SDK se ajustan a rutas hermanas (`./osc`, `./sync-osc`, `./filter-kinds`); cualquiera que apunte a algo que sigue en `src/` es un **error de diseño** — un primitivo del SDK no puede depender del host. Si aparece uno, párate y decide si esa dependencia también sube o si el primitivo no era genérico.

Run: `npx tsc --noEmit`
Expected: los errores que queden nombran exactamente esos casos.

- [ ] **Step 3: Export them from the SDK index**

En `packages/loom-plugin-sdk/src/index.ts`, después de las líneas que ya existen:

```ts
export * from './dsp/osc';
export * from './dsp/ladder';
export * from './dsp/filter';
export * from './dsp/unison';
export * from './dsp/fold';
export * from './dsp/comb';
export * from './dsp/filter-stack';   // re-exports ./filter-kinds
```

- [ ] **Step 4: Leave one-line re-exports behind**

Crea cada `src/audio-dsp/<f>.ts` con el mismo patrón que `adsr.ts`. Por ejemplo `src/audio-dsp/osc.ts`:

```ts
// Moved to @loom/plugin-sdk — see dsp-util.ts for why.
export { SawOsc, SquareOsc, SineOsc, TriOsc, WhiteNoise } from '@loom/plugin-sdk';
```

Y `src/audio-dsp/filter-stack.ts`:

```ts
// Moved to @loom/plugin-sdk — see dsp-util.ts for why. Re-exports filter-kinds
// too, exactly as the original did.
export * from '@loom/plugin-sdk';
```

⚠️ `export *` desde el SDK re-exportaría TODO el SDK bajo ese módulo. Si eso ensucia un importador, nombra los símbolos uno a uno como en `osc.ts`. Comprueba con `npx tsc --noEmit` y decide por el resultado, no por la estética.

- [ ] **Step 5: Run the whole suite**

Run: `npm run test:unit && npx tsc --noEmit`
Expected: verde. Los tests movidos siguen ejecutándose (vitest ya incluye `packages/**`; si no los recoge, añade el glob a `vitest.config.ts` — el fichero ya tuvo que admitir `tools/**/*.test.ts` por lo mismo).

- [ ] **Step 6: Verify no plugin-facing regression**

Run: `NO_COLOR=1 npx vitest run plugins/karplus/`
Expected: PASS — Karplus ya compilaba contra el SDK y debe seguir igual.

- [ ] **Step 7: Commit**

```bash
git add -A packages/loom-plugin-sdk src/audio-dsp
git commit -F - <<'EOF'
refactor(sdk): the generic DSP primitives move to the plugin SDK

osc, ladder, filter, unison, fold, comb and filter-stack (with filter-kinds,
which it re-exports) are synthesis primitives, not traits of the engine that
happens to use them today. A unison stack fits anything with oscillators —
that is every engine — and a wavefolder is exactly what a plugin author
wants. Left behind in src/audio-dsp are one-line re-exports, the same shape
adsr.ts already had.

What stays out is what IS an engine's identity: the wavetables, the 303's
accent curve.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
```

---

### Task 5: los cinco motores declaran sus capacidades

Hoy **ninguno** de los cinco llama a `registerEngineCapabilities` — sólo lo hacen `audio`, `drums-machine` y `sampler`. Viven de los valores por defecto de `capabilities.ts`. Eso significa que su `shortLabel` está codificado a mano en una cadena ternaria y su `outputTrim` en otra tabla. Declararlas es el paso que hace que su futuro manifiesto no invente nada.

**Files:**
- Modify: `src/engines/tb303.ts`, `subtractive.ts`, `fm.ts`, `wavetable.ts`, `westcoast.ts`
- Modify: `src/session/session-host-util.ts:10-18`
- Test: `src/session/session-host-util.test.ts` (existe; si no, créalo)

**Interfaces:**
- Consumes: `registerEngineCapabilities(id, caps, isPlugin?)` de `src/plugins/capabilities.ts`, y `ENGINE_TRIM` de `src/audio-dsp/gain-staging.ts`.
- Produces: cada uno de los cinco ids responde a `shortLabelFor()` sin fallback. Valores exactos, tomados de las dos tablas actuales:

| motor | shortLabel | outputTrim |
| --- | --- | --- |
| `tb303` | `tb-303` | 0.45 |
| `subtractive` | `subtractive` | 0.25 |
| `fm` | `fm-4-op` | 0.179 |
| `wavetable` | `wavetable` | 0.6 |
| `westcoast` | `west` | 0.5 |

- [ ] **Step 1: Write the failing test**

En `src/session/session-host-util.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { nextLaneSlug } from './session-host-util';
import '../engines/tb303';
import '../engines/subtractive';
import '../engines/fm';
import '../engines/wavetable';
import '../engines/westcoast';

describe('nextLaneSlug after the five declare their capabilities', () => {
  it('reads every prefix from the capability, with no hardcoded chain left', () => {
    // Each engine must ANSWER for itself. While the ternary chain existed these
    // passed for the wrong reason, so this test only means something once the
    // fallback is gone (same step).
    expect(nextLaneSlug(new Set(), 'tb303')).toBe('tb-303-1');
    expect(nextLaneSlug(new Set(), 'subtractive')).toBe('subtractive-1');
    expect(nextLaneSlug(new Set(), 'fm')).toBe('fm-4-op-1');
    expect(nextLaneSlug(new Set(), 'wavetable')).toBe('wavetable-1');
    expect(nextLaneSlug(new Set(), 'westcoast')).toBe('west-1');
  });

  it('an engine that declares nothing still gets its own id as the prefix', () => {
    expect(nextLaneSlug(new Set(), 'nobody')).toBe('nobody-1');
  });
});
```

- [ ] **Step 2: Run it — it passes for the WRONG reason**

Run: `NO_COLOR=1 npx vitest run src/session/session-host-util.test.ts`
Expected: PASS, porque la cadena ternaria sigue ahí. Esto es deliberado: el test se vuelve capaz de fallar en el Step 4, cuando se borra el fallback. Antes de seguir, **comprueba que puede fallar**: borra temporalmente la línea `engineId === 'fm' ? 'fm-4-op' :`, re-ejecuta, confirma que el caso de `fm` cae, y restáurala.

- [ ] **Step 3: Register the capabilities**

En cada uno de los cinco ficheros de motor, junto a su `registerEngineFactory`/`registerEngine`, añade (ejemplo de `src/engines/tb303.ts`):

```ts
import { registerEngineCapabilities } from '../plugins/capabilities';

// Declared, not defaulted: these are the two numbers the engine's future
// manifest will carry, and they must already be answered by the engine rather
// than by a table in the host. The slug prefix used to live in a ternary chain
// in session-host-util.ts; the trim still lives in ENGINE_TRIM, which the
// in-tree renderer reads through synthTrim() — that second owner disappears
// when the engine becomes a plugin and the host applies outputTrim instead.
registerEngineCapabilities('tb303', {
  clipContent: 'notes',
  shortLabel: 'tb-303',
  outputTrim: 0.45,
});
```

Repite con los valores de la tabla de arriba para `subtractive` (`subtractive`, 0.25), `fm` (`fm-4-op`, 0.179), `wavetable` (`wavetable`, 0.6) y `westcoast` (`west`, 0.5).

- [ ] **Step 4: Delete the ternary chain**

En `src/session/session-host-util.ts`, sustituye las líneas 10-18 por:

```ts
  // Every engine answers for itself now — a built-in through
  // registerEngineCapabilities, a plugin through its manifest. An engine that
  // declares no shortLabel falls back to its own id, which is a readable slug.
  const prefix = shortLabelFor(engineId) ?? engineId;
```

`drums-machine` ya declara su `shortLabel`, así que su rama del ternario también sobra.

- [ ] **Step 5: Run the test and the suite**

Run: `NO_COLOR=1 npx vitest run src/session/session-host-util.test.ts && npm run test:unit`
Expected: verde. Si algún test de sesión esperaba un slug distinto, el valor correcto es el de la tabla de arriba — no ajustes la tabla al test sin comprobar cuál de los dos miente.

- [ ] **Step 6: Commit**

```bash
git add src/engines/tb303.ts src/engines/subtractive.ts src/engines/fm.ts src/engines/wavetable.ts src/engines/westcoast.ts src/session/session-host-util.ts src/session/session-host-util.test.ts
git commit -F - <<'EOF'
feat(engines): the five melodic engines declare their own capabilities

None of them called registerEngineCapabilities — only audio, drums and the
sampler did. They lived on the defaults, which meant their lane-slug prefix
was a ternary chain in session-host-util and their output balance a second
table in gain-staging.

Each now declares shortLabel and outputTrim itself: the two numbers its
future manifest carries. The ternary chain is gone, so nextLaneSlug asks the
engine and nothing else.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
```

---

### Task 6: el slide del 303 es una capacidad

[src/core/lane-scheduler.ts:228](../../../src/core/lane-scheduler.ts) calcula `slidingIn` sólo si `engineId === 'tb303'`. Es una regla musical que vive en el core preguntando por un id, y un plugin no puede ser un caso especial.

**Files:**
- Modify: `packages/loom-plugin-sdk/src/manifest.ts` (`EngineCapabilities`)
- Modify: `src/plugins/capabilities.ts`
- Modify: `src/core/lane-scheduler.ts:228`
- Modify: `src/engines/tb303.ts` (su bloque de la Task 5)
- Test: `src/core/lane-scheduler.test.ts`

**Interfaces:**
- Consumes: `registerEngineCapabilities` (Task 5).
- Produces: `EngineCapabilities.slide?: 'overlap'` y `slidesOnOverlap(id: string): boolean` desde `src/plugins/capabilities.ts`.

- [ ] **Step 1: Write the failing test**

En `src/core/lane-scheduler.test.ts`:

```ts
import { registerEngineCapabilities, __resetCapabilities } from '../plugins/capabilities';

describe('slide is a declared capability, not an engine id', () => {
  afterEach(() => __resetCapabilities());

  it('an engine that declares slide gets slidingIn from an overlapping note', () => {
    // Two notes where the first still covers the second's start. That overlap
    // IS the slide on a 303 — there is no slide flag on a note.
    registerEngineCapabilities('any-slider', {
      clipContent: 'notes', shortLabel: 'sl', outputTrim: 1, slide: 'overlap',
    });
    const clip = makeClip([
      { start: 0, duration: 24, midi: 36, velocity: 90 },
      { start: 16, duration: 16, midi: 43, velocity: 90 },
    ]);
    const t = noteTrigger('any-slider', clip.notes[1], clip, 0, 0, 120, undefined);
    expect(t.slidingIn).toBe(true);
  });

  it('an engine that declares nothing never slides, however the notes overlap', () => {
    registerEngineCapabilities('no-slider', {
      clipContent: 'notes', shortLabel: 'ns', outputTrim: 1,
    });
    const clip = makeClip([
      { start: 0, duration: 24, midi: 36, velocity: 90 },
      { start: 16, duration: 16, midi: 43, velocity: 90 },
    ]);
    const t = noteTrigger('no-slider', clip.notes[1], clip, 0, 0, 120, undefined);
    expect(t.slidingIn).toBe(false);
  });
});
```

Ajusta `makeClip` y el orden exacto de argumentos de `noteTrigger` a lo que ya use ese fichero — su firma está en `lane-scheduler.ts:213` y toma `(engineId, note, clip, scheduleTime, loopStart, bpm, meter)`. Léela antes de escribir.

- [ ] **Step 2: Run it to verify it fails**

Run: `NO_COLOR=1 npx vitest run src/core/lane-scheduler.test.ts`
Expected: FAIL — `slide` no es una propiedad de `EngineCapabilities`, y el primer caso da `false` porque el id no es `'tb303'`.

- [ ] **Step 3: Add the capability to the SDK**

En `packages/loom-plugin-sdk/src/manifest.ts`, dentro de `EngineCapabilities`:

```ts
  /** How this engine decides a note slides into the previous one. 'overlap':
   *  a note slides when another note in the clip started earlier and still
   *  covers this note's start tick — the TB-303 rule, and the reason a slide
   *  is not a flag on a NoteEvent. Absent ⇒ this engine never slides. */
  slide?: 'overlap';
```

- [ ] **Step 4: Add the accessor**

En `src/plugins/capabilities.ts`, junto a los demás accessors nombrados:

```ts
/** Whether an overlapping previous note makes this engine's note slide.
 *  Default false: an engine that says nothing never slides, which is what
 *  every engine but the 303 has always done. */
export function slidesOnOverlap(id: string): boolean {
  return caps.get(id)?.slide === 'overlap';
}
```

- [ ] **Step 5: Ask the capability in the scheduler**

En `src/core/lane-scheduler.ts`, añade el import y sustituye la línea 228:

```ts
import { slidesOnOverlap } from '../plugins/capabilities';
```

```ts
  const slidingIn = slidesOnOverlap(engineId)
    && (clip.notes as NoteEvent[]).some(
      (other) => other.start < scheduledStartTick
        && (other.start + other.duration) > scheduledStartTick + 1,
    );
```

- [ ] **Step 6: Declare it on the 303**

En `src/engines/tb303.ts`, añade `slide: 'overlap',` al bloque `registerEngineCapabilities` de la Task 5.

- [ ] **Step 7: Run the tests**

Run: `NO_COLOR=1 npx vitest run src/core/lane-scheduler.test.ts && npm run test:unit`
Expected: verde. Si un test de scheduler que usaba `'tb303'` cae, es porque ese test no importaba `src/engines/tb303`, así que la capacidad no estaba registrada — añade el import al test, no un caso especial al código.

- [ ] **Step 8: Commit**

```bash
git add packages/loom-plugin-sdk/src/manifest.ts src/plugins/capabilities.ts src/core/lane-scheduler.ts src/core/lane-scheduler.test.ts src/engines/tb303.ts
git commit -F - <<'EOF'
feat(scheduler): slide is a declared capability, not an engine id

lane-scheduler computed slidingIn only when engineId === 'tb303'. That is a
musical rule living in the core and asking for an id, and a plugin cannot be
special-cased — it is one of the three couplings that kept the 303 from
leaving the tree.

The 303 now declares slide: 'overlap' and the scheduler asks the capability.
An engine that declares nothing never slides, which is what every other
engine has always done.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
```

---

### Task 7: motor ausente — visible, mudo y avisado

Hoy [src/app/lane-allocator.ts:147](../../../src/app/lane-allocator.ts) devuelve `null` y la pista queda muda **sin decir nada**. Con motores prescindibles eso pasa en cuanto alguien borra una carpeta o abre una sesión de otra máquina.

**Files:**
- Modify: `src/session/lane-editor-panels.ts`
- Modify: el sitio que monta el editor de pista y consume `laneEditorPanels` (búscalo con `grep -rn "laneEditorPanels" src/`)
- Test: `src/session/lane-editor-panels.test.ts`, `src/session/missing-engine.test.ts` (crear)

**Interfaces:**
- Consumes: `getEngineDescriptor(id)` de `src/engines/registry.ts` — devuelve `undefined` para un id que nadie registró. **Ése es el discriminador**, no las capacidades: `capabilities.ts` responde "instrumento melódico normal" para un id desconocido a propósito, así que no distingue ausente de presente.
- Produces: `LaneEditorPanels.missingEngine: boolean`, verdadero cuando el motor no está registrado. Cuando es `true`, `engineParams`, `preset`, `noteFx`, `engineHeaderRow` y `dice` son todos `false`; `inserts` sigue `true`.

- [ ] **Step 1: Write the failing test for the panel decision**

En `src/session/lane-editor-panels.test.ts`:

```ts
it('an engine nobody registered shows the notice and no instrument panels', () => {
  // Nothing registers 'ghost'. Its lane must still exist and keep its inserts
  // — the strip is the host's, not the engine's — but every panel that would
  // read a descriptor is off, because there is no descriptor to read.
  const p = laneEditorPanels('ghost');
  expect(p.missingEngine).toBe(true);
  expect(p.engineParams).toBe(false);
  expect(p.preset).toBe(false);
  expect(p.noteFx).toBe(false);
  expect(p.engineHeaderRow).toBe(false);
  expect(p.dice).toBe(false);
  expect(p.inserts).toBe(true);
});

it('a registered engine is never reported as missing', () => {
  registerEngineCapabilities('present', { clipContent: 'notes', shortLabel: 'p', outputTrim: 1 });
  // Capabilities alone are NOT enough — the discriminator is the descriptor.
  // This asserts the two are not confused.
  expect(laneEditorPanels('present').missingEngine).toBe(true);
});
```

⚠️ El segundo caso afirma `true` a propósito: registrar capacidades **no** registra un descriptor. Si te parece raro, es la trampa que este test existe para pinchar. Cuando implementes, comprueba que un motor de verdad (`import '../engines/tb303'`) da `false`, y añade ese tercer caso.

- [ ] **Step 2: Run it to verify it fails**

Run: `NO_COLOR=1 npx vitest run src/session/lane-editor-panels.test.ts`
Expected: FAIL — `missingEngine` no existe en `LaneEditorPanels`.

- [ ] **Step 3: Implement the panel decision**

En `src/session/lane-editor-panels.ts`:

```ts
import { getEngineDescriptor } from '../engines/registry';

export interface LaneEditorPanels {
  engineParams: boolean;
  noteFx: boolean;
  preset: boolean;
  inserts: boolean;
  engineHeaderRow: boolean;
  dice: boolean;
  /** No plugin registered this engine. The lane keeps its strip and its
   *  inserts and says so, instead of drawing an instrument that cannot sound.
   *  The discriminator is the DESCRIPTOR, not the capabilities: an unknown id
   *  answers every capability like an ordinary melodic engine on purpose. */
  missingEngine: boolean;
}

export function laneEditorPanels(engineId: string): LaneEditorPanels {
  const missingEngine = getEngineDescriptor(engineId) === undefined;
  if (missingEngine) {
    return { engineParams: false, noteFx: false, preset: false,
             inserts: true, engineHeaderRow: false, dice: false, missingEngine: true };
  }
  const isAudio = isAudioEngine(engineId);
  return {
    engineParams: !isAudio,
    noteFx: !isAudio && acceptsNoteFx(engineId),
    preset: !isAudio,
    inserts: true,
    engineHeaderRow: !isAudio,
    dice: !isAudio && isRandomizable(engineId),
    missingEngine: false,
  };
}
```

- [ ] **Step 4: Render the notice**

El consumidor es [src/session/session-host-lane-editor.ts:142](../../../src/session/session-host-lane-editor.ts) (`const panels = laneEditorPanels(lane?.engineId ?? engine.id);`). Donde hoy monta la rejilla de params, añade la rama del aviso. El texto va en **inglés**:

```ts
if (panels.missingEngine) {
  const notice = document.createElement('div');
  notice.className = 'lane-missing-engine';
  notice.textContent = `Engine not installed: ${lane.engineId}`;
  notice.title = 'This lane keeps its settings. Install the plugin and reload to hear it again.';
  container.appendChild(notice);
  return;   // nothing below this reads a descriptor that does not exist
}
```

Añade la clase a la hoja de estilos de la sesión (`src/styles/`) siguiendo el estilo de los avisos que ya existan allí; si no hay ninguno, basta con `opacity: .7; font-style: italic; padding: .5rem;`.

- [ ] **Step 5: Fix the save path that DOES stamp over a missing engine's state**

Los params están a salvo: [session-host-persistence.ts:175-180](../../../src/session/session-host-persistence.ts) documenta que `collectEngineState` **no** los re-lee, precisamente para no tirar lo que `commitParam` ya espejó. Los modulators y el mixer están guardados por `if (host)` / `if (strip)`.

**El note-FX no.** La línea `lane.engineState.noteFx = getNoteFxChain(lane.id).serialize();` corre **sin condición**, así que una pista cuyo motor no existe pasa por ahí y se le sobrescribe el note-FX guardado con la cadena vacía que `getNoteFxChain` acaba de fabricar para un id que nunca tuvo una. Guárdala igual que sus vecinas:

```ts
    // Only mirror the note-FX chain of a lane that HAS one. A lane whose engine
    // is not installed never built a chain, so getNoteFxChain would mint an
    // empty one here and stamp it over what the save is carrying — the one
    // place on this path that loses a missing engine's state.
    const engineForLane = self.deps.laneResources?.get(lane.id)?.engine;
    if (engineForLane) {
      if (!lane.engineState) lane.engineState = {};
      lane.engineState.noteFx = getNoteFxChain(lane.id).serialize();
    }
```

- [ ] **Step 6: Write the test that proves it**

`src/session/missing-engine.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { collectEngineState } from './session-host-persistence';

describe('collectEngineState on a lane whose engine is not installed', () => {
  it('keeps its params and its note-FX instead of stamping them flat', () => {
    // The lane has state and NO engine: laneResources.get() returns undefined,
    // which is exactly what a deleted plugin folder produces. Params were never
    // at risk (they are mirrored by commitParam, not re-read here); noteFx was,
    // because getNoteFxChain mints an empty chain for an unknown lane id.
    const lane = {
      id: 'ghost-1', engineId: 'ghost', name: 'Ghost', clips: [], inserts: [],
      engineState: {
        params: { 'filter.cutoff': 0.42, 'amp.level': 0.9 },
        noteFx: [{ kind: 'arp', enabled: true }],
      },
    };
    const self = {
      state: { lanes: [lane], sends: undefined },
      deps: { laneResources: { get: () => undefined }, fxBus: undefined },
    };

    collectEngineState(self as never);

    expect(lane.engineState.params['filter.cutoff']).toBe(0.42);
    expect(lane.engineState.params['amp.level']).toBe(0.9);
    expect(lane.engineState.noteFx).toHaveLength(1);
  });
});
```

Si la forma de `self` no encaja con lo que `collectEngineState` lee, amplíala con lo mínimo que pida — es un doble de prueba deliberadamente flaco, para que el test falle si la función empieza a leer cosas nuevas del host.

- [ ] **Step 7: Run everything**

Run: `NO_COLOR=1 npx vitest run src/session/lane-editor-panels.test.ts src/session/missing-engine.test.ts && npm run test:unit`
Expected: verde.

- [ ] **Step 8: Commit**

```bash
git add src/session/lane-editor-panels.ts src/session/lane-editor-panels.test.ts src/session/missing-engine.test.ts src/session/session-host-persistence.ts src/session/session-host-lane-editor.ts
git commit -F - <<'EOF'
feat(session): a missing engine is stated, not silently mute

lane-allocator returns null for an engine nothing registered, and the lane
draws, occupies its row and makes no sound without a word. That was
unreachable while every engine shipped in the tree; once a plugin folder can
be deleted it is routine.

The lane now keeps its strip and its inserts, drops every panel that would
read a descriptor, and says "Engine not installed: <id>". Its engineState
survives a save round-trip, so installing the plugin and reloading brings the
sound back exactly as it was.

The discriminator is the descriptor, not the capabilities — an unknown id
answers every capability like an ordinary melodic engine on purpose.

One save path did stamp over it: collectEngineState mirrored the note-FX
chain unconditionally, so a lane with no engine had its saved chain replaced
by the empty one getNoteFxChain mints for an unknown id. Guarded like its
neighbours. Params were never at risk — they are mirrored by commitParam and
deliberately not re-read there.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
```

---

### Task 8: un test registra un plugin leyendo su manifiesto real

**21 ficheros de test** hacen `import '../engines/<id>'` sólo para registrar el descriptor. Cuando los motores se muden no habrá módulo que importar. El fixture lee el `plugin.json` de verdad, así que **romper un manifiesto rompe los tests**.

**Files:**
- Create: `test/plugin-fixtures.ts`
- Test: `test/plugin-fixtures.test.ts`

**Interfaces:**
- Consumes: `installMainThreadLoomApi()` de `src/plugin-host/loom-api.ts` (instala `globalThis.Loom` con `registerComponent`), y `__resetPluginEngines()` para limpiar entre tests.
- Produces: `registerPluginEngine(id: string): void` — lee `plugins/<id>/plugin.json` desde el disco y registra su `components[0]`. Síncrona, para poder llamarse en el ámbito del módulo de un test igual que hoy se hace `import '../engines/tb303'`.

- [ ] **Step 1: Write the fixture's test first**

`test/plugin-fixtures.test.ts`:

```ts
import { describe, it, expect, afterEach } from 'vitest';
import { registerPluginEngine } from './plugin-fixtures';
import { getEngineDescriptor } from '../src/engines/registry';
import { shortLabelFor } from '../src/plugins/capabilities';
import { __resetPluginEngines } from '../src/plugin-host/loom-api';

afterEach(() => __resetPluginEngines());

describe('the plugin test fixture', () => {
  it('registers a real plugin from its manifest on disk', () => {
    // Karplus is the only migrated engine today, so it is the honest subject.
    registerPluginEngine('karplus');
    const d = getEngineDescriptor('karplus');
    expect(d).toBeDefined();
    expect(d!.params.length).toBeGreaterThan(0);
    expect(shortLabelFor('karplus')).toBe('karplus');
  });

  it('fails loudly for a plugin that is not there', () => {
    // A silent no-op would let a test "register" a deleted plugin and then
    // assert against an empty registry, which is how a green suite hides a
    // broken migration.
    expect(() => registerPluginEngine('not-a-plugin')).toThrow(/not-a-plugin/);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `NO_COLOR=1 npx vitest run test/plugin-fixtures.test.ts`
Expected: FAIL — `test/plugin-fixtures.ts` no existe.

- [ ] **Step 3: Write the fixture**

`test/plugin-fixtures.ts`:

```ts
// Registering a plugin engine inside a unit test, through the REAL manifest.
//
// Before the migration a test wrote `import '../engines/subtractive'` and the
// module registered itself as a side effect. A plugin has no such module in
// src/, so this reads plugins/<id>/plugin.json from disk and pushes it through
// the same door production uses: installMainThreadLoomApi() + Loom
// .registerComponent. Reading the real file is the point — a hand-written stub
// would keep passing while the manifest it stands in for was broken.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { installMainThreadLoomApi } from '../src/plugin-host/loom-api';
import type { ComponentManifest } from '@loom/plugin-sdk';

const ROOT = join(__dirname, '..', 'plugins');

export function registerPluginEngine(id: string): void {
  const path = join(ROOT, id, 'plugin.json');
  let raw: string;
  try {
    raw = readFileSync(path, 'utf8');
  } catch {
    throw new Error(`registerPluginEngine: no manifest at ${path} for plugin '${id}'`);
  }
  const manifest = JSON.parse(raw) as { components: ComponentManifest[] };
  installMainThreadLoomApi();
  const Loom = (globalThis as unknown as {
    Loom: { registerComponent(m: ComponentManifest): void };
  }).Loom;
  for (const c of manifest.components) Loom.registerComponent(c);
}
```

Si `__dirname` no está disponible (el repo es ESM), sustitúyelo por `dirname(fileURLToPath(import.meta.url))` importando de `node:url`.

- [ ] **Step 4: Run it**

Run: `NO_COLOR=1 npx vitest run test/plugin-fixtures.test.ts`
Expected: PASS, 2 tests.

- [ ] **Step 5: Prove it on a test that today imports a module**

Elige **un** test que hoy haga `import '../engines/subtractive'` — usa `src/session/session-add-lane.test.ts` — y añade, sin quitar el import existente, una aserción de que el fixture puede convivir:

```ts
import { registerPluginEngine } from '../../test/plugin-fixtures';

it('the plugin fixture registers alongside the in-tree engines', () => {
  registerPluginEngine('karplus');
  expect(getEngineDescriptor('karplus')).toBeDefined();
  expect(getEngineDescriptor('subtractive')).toBeDefined();
});
```

Esto demuestra que los dos caminos de registro coexisten, que es la condición para migrar los 21 ficheros de uno en uno sin un "big bang".

- [ ] **Step 6: Run the suite**

Run: `npm run test:unit && npx tsc --noEmit`
Expected: verde.

- [ ] **Step 7: Commit**

```bash
git add test/plugin-fixtures.ts test/plugin-fixtures.test.ts src/session/session-add-lane.test.ts
git commit -F - <<'EOF'
test: register a plugin engine from its real manifest

21 test files import an engine module purely so it registers its descriptor.
A migrated engine has no such module, so the fixture reads
plugins/<id>/plugin.json from disk and pushes it through the same door
production uses.

Reading the real file is the whole point: a hand-written stub would keep
passing while the manifest it stands in for was broken. A missing plugin
throws rather than no-opping, so a test cannot assert against an empty
registry and call it green.

Proven coexisting with the in-tree registration path, which is what lets the
21 files migrate one at a time instead of in one jump.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
```

---

## Cierre del andamiaje

- [ ] **Rebase y suite completa**

```bash
git rebase main
npm run build
npm run test:unit
npm run test:e2e
npx tsc --noEmit
```

Expected: todo verde. **Ningún motor se ha movido**: los cinco siguen en `src/`, la app suena igual, y `plugins/karplus/` sigue siendo el único motor externo.

- [ ] **Verificación a oído** — Chrome real (NO el navegador de VS Code), `npm run dev`, **Escena 2** de la demo de arranque. El andamiaje no debería cambiar un solo sample; si algo suena distinto, la Task 4 (los primitivos) o la Task 5 (los trims declarados) es la sospechosa.

---

## EL PROCEDIMIENTO DE MUDANZA

**No se inventa aquí.** `plugins/karplus/` lo define y lo mantiene vivo; esto es
ese procedimiento escrito paso a paso para poder aplicarlo cinco veces. Las
Tasks 9-13 son este procedimiento con los valores concretos de cada motor; **nada
de lo que sigue se repite en ellas**, así que léelo entero antes de empezar
cualquiera.

Para un motor `<id>`:

1. **Congela la referencia ANTES de tocar nada.**
   `npx tsx tools/gen-engine-reference.ts <id>` → `src/audio-dsp/reference/<id>.json`.
   Una referencia capturada después congela el bug. Si el motor excita con ruido,
   el generador ya fija `Math.random` durante la captura.

2. **Crea `plugins/<id>/plugin.json`.** Un `components[0]` de `kind: "engine"` con
   `params` (portados desde `src/engines/<id>.ts` sin cambiar un valor), `groups`
   (desde `engine-param-groups.ts`), `modulators` (los `<ID>_DEFAULT_MODULATORS`
   si los tiene) y `capabilities` — que ya son las que la Task 5 le hizo declarar,
   más `outputTrim` con su número de `ENGINE_TRIM`.

3. **Crea `plugins/<id>/main.ts`**, copia literal del de Karplus:

   ```ts
   import manifest from './plugin.json';
   Loom.registerComponent(manifest.components[0] as never);
   ```

4. **Crea `plugins/<id>/dsp.ts`** moviendo `src/audio-dsp/<id>-renderer.ts`. Tres
   cambios — más un CUARTO que la ejecución descubrió: si el renderer tipa algo
   como `ModLite` (de `src/audio-dsp/modulation-runtime`), pásalo a `ModEnvSpec`
   del SDK. Un plugin no puede importar ese módulo, y `ModEnvSpec` es el nombre
   del SDK para la misma forma. Sin cambio en tiempo de ejecución. Los tres:
   - Los imports pasan de `./osc`, `./filter`, … a `@loom/plugin-sdk`.
   - Fuera `import { synthTrim } from './gain-staging'` y **fuera su
     multiplicación**: el host aplica `capabilities.outputTrim`. Esto es lo que
     hace que la paridad NO sea bit a bit (ver punto 8).
   - `registerRenderer(...)` del final pasa a `Loom.registerRenderer('<id>', (n, p, sr) => new <X>Renderer(n, p, sr));`

5. **Mueve los presets**: `public/presets/<id>.json` → `plugins/<id>/presets.json`.

6. **Mueve la referencia**: `src/audio-dsp/reference/<id>.json` →
   `plugins/<id>/reference-render.json`.

7. **Crea `plugins/<id>/<id>-parity.dsp.test.ts`** copiando
   `plugins/karplus/karplus-parity.dsp.test.ts`: el stub hoisted de dos líneas
   para `globalThis.Loom` (prueba que el DSP de un plugin no necesita del host
   nada más que `registerRenderer`), el import del `dsp` y del
   `reference-render.json`, y la comparación de FORMA.

8. **La paridad es de forma, no bit a bit** — el plugin ya no multiplica por su
   trim y el host sí. Se normalizan los dos por su pico y la peor desviación debe
   ser `< 1e-6` del pico. El test de Karplus lo hace ya; cópialo tal cual.

9. **Borra de `src/`**: `src/engines/<id>.ts` (y sus ficheros satélite),
   `src/audio-dsp/<id>-renderer.ts` (y su test, que se muda al plugin).

10. **Quita su id de los tres puntos compartidos**:
    - `src/audio-worklet/loom-processor.ts` — su línea de `import '../audio-dsp/<id>-renderer'`.
    - `src/export/kernel-lane-render.ts` — la misma línea.
    - `src/app/lane-allocator.ts:26` — su id de `BUILTIN_WORKLET_ENGINE_IDS`.

11. **Migra sus tests**: cada `import '../engines/<id>'` pasa a
    `registerPluginEngine('<id>')` del fixture de la Task 8. Los ficheros que
    enumeran los cinco ids como tabla de casos (`declared-params.dsp.test.ts`,
    `live-params.dsp.test.ts`, `engine-parity.dsp.test.ts`,
    `modulation-pipeline.test.ts`, `velocity-response.test.ts`,
    `test/engine-fixtures.ts`) siguen citándolo, pero registrándolo por el fixture.

12. **Construye y comprueba que suena**:
    ```bash
    npm run build:plugins && npm run build
    NO_COLOR=1 npx vitest run plugins/<id>/
    npm run test:unit
    ```

13. **Mide la CPU**: `npx tsx tools/lane-bench.ts <id> none` y `... lfo`, mediana
    de 5, contra el número de antes de la mudanza. **No debe empeorar.** El
    `dsp.js` va bundleado aparte y ése es el riesgo real de este trozo.

---

### Task 9: wavetable → `plugins/wavetable/`

El más limpio: en los ficheros compartidos sólo aparece en comentarios y en la tabla de trims.

**Files:**
- Create: `plugins/wavetable/{plugin.json,main.ts,dsp.ts,presets.json,reference-render.json,wavetable-parity.dsp.test.ts}`
- Delete: `src/engines/wavetable.ts`, `src/audio-dsp/wavetable-renderer.ts`, `src/audio-dsp/wavetable-renderer.test.ts`, `public/presets/wavetable.json`
- Move INTO the plugin: `src/audio-dsp/wavetable-data.ts` (+ su test si lo tiene) — sus tablas de onda SON su sonido
- Modify: `loom-processor.ts`, `kernel-lane-render.ts`, `lane-allocator.ts:26`, `src/engines/wavetable-layout.test.ts`, `src/presets/wavetable-presets.test.ts`, `src/session/engine-param-persistence.test.ts`, `src/session/session-add-lane.test.ts`

**Concreto:** `outputTrim: 0.6` · `shortLabel: "wavetable"` · primitivos que usa: `filter` (Svf), `adsr`, `mod-env-host`, `dsp-util` — todos ya en el SDK tras la Task 4 · `drawnBy` 1 vez, `curve` 3 veces, `color` 3 veces en sus params · no declara `slide`.

- [ ] Aplica EL PROCEDIMIENTO DE MUDANZA de arriba, puntos 1 a 13, con esos valores.
- [ ] **Commit**

```bash
git add -A plugins/wavetable src/ public/presets
git commit -F - <<'EOF'
feat(wavetable): the wavetable engine leaves the tree

First of the five to move, and the cleanest: outside its own files it
appeared only in comments and in the trim table. Its wave tables move INTO
the plugin — they are its sound, not a generic primitive.

Parity is by shape, not bit for bit: the plugin no longer multiplies by its
own trim, the host applies outputTrim from the manifest.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
```

---

### Task 10: fm → `plugins/fm/`

**Files:**
- Create: `plugins/fm/{plugin.json,main.ts,dsp.ts,presets.json,reference-render.json,fm-parity.dsp.test.ts}`
- Delete: `src/engines/fm.ts`, `src/engines/fm.test.ts`, `src/audio-dsp/fm-renderer.ts`, `public/presets/fm.json`
- Modify: `loom-processor.ts`, `kernel-lane-render.ts`, `lane-allocator.ts:26`, `src/engines/fm-layout.test.ts`, `src/presets/fm-presets.test.ts`, `src/session/engine-param-persistence.test.ts`

**Concreto:** `outputTrim: 0.179` · `shortLabel: "fm-4-op"` · primitivos: `adsr`, `mod-env-host`, `dsp-util` · `curve` 1 vez, `selectStyle` 1 vez, `color` 4 veces · no declara `slide`.

⚠️ El comentario de `ENGINE_TRIM` explica por qué es 0.179 y no 0.25 (la curva de velocidad restaurada multiplicaba por 1.4). **Cópialo al manifiesto o al `dsp.ts`**: es la clase de número que alguien redondea a 0.18 dentro de seis meses si no encuentra el porqué.

- [ ] Aplica EL PROCEDIMIENTO DE MUDANZA, puntos 1 a 13, con esos valores.
- [ ] **Commit** (mismo formato que la Task 9, describiendo lo que este motor tuvo de particular).

---

### Task 11: westcoast → `plugins/westcoast/`

**Files:**
- Create: `plugins/westcoast/{plugin.json,main.ts,dsp.ts,presets.json,reference-render.json,westcoast-parity.dsp.test.ts}`
- Delete: `src/engines/westcoast.ts`, `src/audio-dsp/westcoast-renderer.ts`, `public/presets/westcoast.json`
- Move INTO the plugin: `src/engines/westcoast-fold.ts` + `src/engines/westcoast-fold.test.ts` — es su curva de WaveShaper, no un primitivo (el primitivo genérico, `fold`, ya está en el SDK)
- Modify: `loom-processor.ts`, `kernel-lane-render.ts`, `lane-allocator.ts:26`, `src/engines/westcoast-layout.test.ts`, `src/session/engine-param-persistence.test.ts`

**Concreto:** `outputTrim: 0.5` · `shortLabel: "west"` · primitivos: `osc` (Sine/Tri/Saw), `filter` (Svf), `fold`, `mod-env-host`, `dsp-util` · `curve` 2 veces, `color` 6 veces · no declara `slide` · el acento le mueve **sólo el plegador**, no el amplificador — no lo pierdas al portar.

- [ ] Aplica EL PROCEDIMIENTO DE MUDANZA, puntos 1 a 13, con esos valores.
- [ ] **Commit**.

---

### Task 12: subtractive → `plugins/subtractive/`

**El más grande y el que más puede romper.** Acaba de crecer +4007 líneas (ring
mod, comb, segundo filtro con enrutado, 17 presets) y su `presets.json` pesa 80 KB.

**Files:**
- Create: `plugins/subtractive/{plugin.json,main.ts,dsp.ts,presets.json,reference-render.json,subtractive-parity.dsp.test.ts}`
- Delete: `src/engines/subtractive.ts`, `src/audio-dsp/subtractive-renderer.ts`, `public/presets/subtractive.json`
- Move INTO the plugin: `src/engines/subtractive-params.ts`, `src/audio-dsp/subtractive-renderer.test.ts`, `src/presets/subtractive-presets.test.ts`, `src/presets/subtractive-filter-presets.test.ts`, `src/engines/subtractive-layout.test.ts`
- Modify: `loom-processor.ts`, `kernel-lane-render.ts`, `lane-allocator.ts:26`, y **`src/engines/worklet-lane-engine.ts`**

**Concreto:** `outputTrim: 0.25` · `shortLabel: "subtractive"` · primitivos: `osc` (Sine/WhiteNoise), `unison`, `filter` (Svf), `filter-stack` (+`filter-kinds`, +`comb`), `adsr`, `dsp-util` · `drawnBy` **10 veces**, `optionsFrom` 2 veces (ya en forma de tabla tras la Task 2) · no declara `slide`.

⚠️ **Su acoplamiento propio:** [worklet-lane-engine.ts:28](../../../src/engines/worklet-lane-engine.ts) importa `deriveSubtractiveEnvMods` de `./subtractive`, y la línea 300 tiene un `else if (this.id === 'subtractive')`. Eso es un `engineId === '…'` en el core y **tiene que morir en esta tarea**. Antes de escribir nada, lee las dos y decide: o la función viaja al plugin y el host deja de necesitarla, o lo que hace se expresa como una capacidad. Si no ves cuál, **para y pregunta** — es la última comparación por id del camino de audio y merece decidirse, no improvisarse.

- [ ] Lee `worklet-lane-engine.ts:28` y `:300` y decide qué pasa con `deriveSubtractiveEnvMods`.
- [ ] Aplica EL PROCEDIMIENTO DE MUDANZA, puntos 1 a 13, con esos valores.
- [ ] **Commit**.

---

### Task 13: tb303 → `plugins/tb303/`

**El último, porque es el que más excepciones tiene repartidas por el core.**

**Files:**
- Create: `plugins/tb303/{plugin.json,main.ts,dsp.ts,presets.json,reference-render.json,tb303-parity.dsp.test.ts}`
- Delete: `src/engines/tb303.ts`, `src/audio-dsp/tb303-renderer.ts`, `public/presets/tb303.json`
- Move INTO the plugin: `ACCENT_VCA_LADDER` (de `src/core/velocity-gain.ts` — sólo lo usa él), `src/engines/tb303-layout.test.ts`, `tools/tb303-preset-audit.ts`
- Modify: `loom-processor.ts`, `kernel-lane-render.ts`, `lane-allocator.ts:26` **y `:9`/`:131`**, `src/app/knob-mounting.ts:79`

**Concreto:** `outputTrim: 0.45` · `shortLabel: "tb-303"` · **`slide: "overlap"`** (ya declarado en la Task 5) · primitivos: `osc` (Saw/Square), `ladder`, `mod-env-host`, `dsp-util`, `velGain01` · `color` 3 veces.

⚠️ **Sus dos acoplamientos restantes:**
- `presetKeyRemap` ([lane-allocator.ts:131](../../../src/app/lane-allocator.ts), con su `PRESET_KEY_TO_SPEC` importado en la línea 9): **muere aquí**, reescribiendo `plugins/tb303/presets.json` con dot-ids en vez de las claves planas antiguas. La tabla `PRESET_KEY_TO_SPEC` es exactamente el diccionario de esa reescritura. Hecho eso, se borran el import, el campo y la tabla.
- [knob-mounting.ts:79](../../../src/app/knob-mounting.ts) (`if (!engine || engine.id !== 'tb303') return;`): **compruébalo, no lo asumas.** Es glue del carril fijo del 303 y huele a muerto desde que cayó su página dedicada. Si `refreshKnobsFromSynth` no lo llama nadie, bórralo entero; si sí, generalízalo a la pista activa.

- [ ] Reescribe `presets.json` con dot-ids usando `PRESET_KEY_TO_SPEC` como diccionario, y verifica con `tools/tb303-preset-audit.ts` que ningún preset perdió un param.
- [ ] Comprueba si `refreshKnobsFromSynth` sigue vivo antes de tocar `knob-mounting.ts`.
- [ ] Aplica EL PROCEDIMIENTO DE MUDANZA, puntos 1 a 13, con esos valores.
- [ ] **Commit**.

---

### Task 14: demolición

Sólo puede hacerla el último. Con los cinco fuera:

**Files:**
- Modify: `src/app/lane-allocator.ts`, `src/audio-worklet/loom-processor.ts`, `src/export/kernel-lane-render.ts`, `src/audio-dsp/gain-staging.ts`, `src/session/session.ts:164`

- [ ] **Step 1: `BUILTIN_WORKLET_ENGINE_IDS` queda vacío.** Si el `Set` no tiene ya ningún id, bórralo y deja `WORKLET_ENGINE_IDS` apoyado sólo en `isWorkletHosted`. El iterador que expande `[...WORKLET_ENGINE_IDS]` (lo usa `live-params.dsp.test.ts`) pasa a recorrer los plugins instalados.
- [ ] **Step 2: `ENGINE_TRIM` se queda sin las cinco entradas.** Comprueba antes quién lee la tabla — `gain-staging-velocity.test.ts` calcula un ratio con ella y se vuelve `NaN` si borras una entrada que aún usa.
- [ ] **Step 3: `synthTrim()` deja de estar en el camino de los motores.** Ningún renderer melódico lo llama ya; verifica con `grep -rn "synthTrim" src/ plugins/`.
- [ ] **Step 4: los bloques de imports por efecto secundario** de `loom-processor.ts` y `kernel-lane-render.ts` quedan sin ninguna línea de motor melódico.
- [ ] **Step 5: `testSessionState()`** ([session.ts:164](../../../src/session/session.ts)) nombra `tb303` y `subtractive`. Es una fixture de tests, no el arranque, pero ahora depende de que esos plugins estén instalados — decide si la fixture registra los plugins o si usa ids que no dependan de ninguno.
- [ ] **Step 6: el censo.** `node tools/plugin-id-census.mjs` — su número separa las líneas que son ids de motor de las que no (tipos de clip, `kind === 'audio'`). Cualquier `engineId === '<uno de los cinco>'` que sobreviva se justifica **por escrito** o se borra.

- [ ] **Commit**

```bash
git commit -F - <<'EOF'
refactor(core): the host has no melodic engine left inside it

With the five moved, the built-in worklet path has nothing to route:
BUILTIN_WORKLET_ENGINE_IDS is empty, the side-effect import blocks in
loom-processor and kernel-lane-render carry no melodic renderer, and
synthTrim is off the engine path — a plugin declares outputTrim and the host
applies it.

src/audio-dsp is now voice-manager, scheduler-queue, modulation-runtime,
renderer-registry and the drums/sampler backends. The host, with no engine
in it.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
```

---

## Aceptación final

- [ ] **Prescindible, demostrado.** Borra `dist/plugins/tb303/` (o quita su id de `dist/plugins/index.json`), sirve el build y carga la demo: la app arranca, la pista del 303 aparece marcada como no instalada y muda, y la consola no da un solo error. Guarda la sesión y comprueba que el `engineState` del 303 sigue completo en el JSON.
- [ ] **Instalable, demostrado.** Repón la carpeta, recarga, y la pista vuelve a sonar — medido con el tap de master de los e2e de audio, no con que pinte sus knobs.
- [ ] **CPU sin empeorar** en los cinco, `tools/lane-bench.ts` en modos `none` y `lfo`, mediana de 5, contra los números de antes de la mudanza. Se informan **los cinco**, mejoren o no.
- [ ] **Suite entera verde**: `npm run build && npm run test:unit && npm run test:e2e && npx tsc --noEmit`.
- [ ] **A oído**, en Chrome real (NO el navegador de VS Code), **Escena 2** de la demo de arranque.
- [ ] **Poda**: este plan y su spec se borran del árbol cuando el trabajo esté mergeado — es el paso que siempre se salta.

## RESULTADO — 2026-08-02, los cinco mudados

**`src/` no contiene ni un motor melódico.** `src/audio-dsp` es `voice-manager`,
`scheduler-queue`, `modulation-runtime`, `renderer-registry` y los backends de
drums/sampler: el host, sin un instrumento dentro.

Gates: **unit 438 ficheros / 3728 tests**, **e2e 128**, `tsc --noEmit` limpio,
`npm run build` limpio. Paridad de forma verde en los seis plugins.

**CPU — ser plugin no cuesta nada medible.** Medido con tiradas EMPAREJADAS y
alternadas entre los dos worktrees, porque la varianza entre dos medidas
idénticas de la misma máquina llega al 6% y se traga la señal:

| motor | antes | después |
| --- | --- | --- |
| tb303 | 732,5 / 715,0 / 718,5 ms | 731,3 / 715,1 / 730,2 ms |
| subtractive | 740,9 / 746,9 / 753,2 ms | 751,9 / 765,4 / 747,6 ms |

⛔ Una primera tabla daba subtractive **+8,4 %**. Era falsa: se midió con un
`tsc` mío corriendo en paralelo. El mismo error que invalidó la medición de
partida de la fase 1 — un banco contaminado por el trabajo del que mide.

### Lo que la ejecución corrigió (no re-derivar)

- **El 303 fue el único motor donde quitar el trim NO es un cambio de escala.**
  Su release apunta a un 0,001 **absoluto** y la voz se recoge en ese mismo
  valor, así que el umbral vivía en el dominio ya multiplicado. `AMP_FLOOR` es
  ahora `0.001 / 0.54`, y **0,54 = ENGINE_TRIM 0,45 × CATEGORY_GAIN.synth 1,2**
  — derivarlo del `outputTrim` del manifiesto seguía fallando, que es lo que
  destapó la ganancia de categoría. Es constante fija a propósito: la cola es
  parte de la voz y no debe moverse si alguien reequilibra el nivel del 303.
- **Los tres acoplamientos murieron sin inventar ninguna capacidad.** El
  `else if (id === 'subtractive')` era un problema de DATOS (moduladores
  horneados en sus 102 presets; 89 tocados, los 13 que ya traían los suyos se
  dejaron intactos porque hornearlos les habría cambiado el sonido). El
  `presetKeyRemap` del 303 murió por sustracción al reescribir su banco a
  dot-ids. Y `refreshKnobsFromSynth` resultó **viva pero un no-op demostrable**:
  se borró, no se generalizó.
- **El banco de CPU estaba roto y `tsc` no lo veía.** `tools/` nunca estuvo en
  el `include` del tsconfig. Ya está, y meterlo destapó dos errores más.
- **El aviso de motor ausente sólo se veía al ABRIR la pista.** Un e2e lo
  destapó en el primer intento: la rejilla mostraba una pista que no sonaba y
  no decía por qué. Ahora la cabecera lo marca.

## Hallazgos de la escritura de este plan (no re-derivar)

Cuatro cosas que sólo aparecieron al leer el código para escribir los pasos, y que están incorporadas arriba:

1. **Hay dos `EngineParamSpec`** y el del SDK es más pobre. Los cinco motores usan `curve`, `drawnBy` (subtractive 10 veces), `selectStyle` y `color`, que un manifiesto no puede declarar hoy. → Task 1, que el spec no preveía.
2. **`unison.ts` importa `sync-osc`**, que no estaba en ninguna lista de primitivos. Sube al SDK con él. → Task 4.
3. **`fold(x, 0)` devuelve 0, no `x`**, y `driftDepthFor` toma una frecuencia, no un tamaño de pila. Una primera versión de los tests de la Task 3 afirmaba lo contrario y habría fallado en verde aparente.
4. **`collectEngineState` sobrescribe el note-FX** de una pista sin motor. → Task 7, Step 5.
