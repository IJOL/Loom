# Un solo dado, mostrado por capacidad — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** que el botón "🎲 Sound" sea uno solo, con un solo comportamiento, mostrado
únicamente en las pistas cuyo motor declara `isRandomizable` — y que al pulsarlo los
knobs se repinten y sus anillos de modulación sigan vivos.

**Architecture:** el dado deja de pasar por `rebuildEngineParamUI()` (la herramienta
del cambio de motor, que desregistra los knobs de la pista) y pasa por
`refreshLaneKnobs`, que repinta en el sitio. La acción vive una sola vez en
`core/randomize-ui.ts`; la visibilidad del botón se pregunta por la puerta única de
capacidades, `isRandomizable(engineId)`.

**Tech Stack:** TypeScript + Vite, Vitest (jsdom para UI, sin AudioContext),
lit-html para plantillas, Playwright para e2e.

**Spec:** [2026-08-01-dado-unico-por-capacidad-design.md](../specs/2026-08-01-dado-unico-por-capacidad-design.md)

## Global Constraints

- **Texto de UI en INGLÉS.** El label del botón es `🎲 Sound` y su `title`
  `Randomize sound (sets preset to Custom)`, exactamente como hoy. Comentarios de
  código en inglés; sólo la conversación va en español.
- **Nunca `engineId === '…'`.** Toda pregunta sobre lo que un motor puede hacer va
  por `src/plugins/capabilities.ts`. Es la regla que la rebanada de capacidades
  acaba de establecer (`26db8d9`).
- **Tamaño de fichero:** objetivo 300 líneas de código, tope duro 500 (líneas de
  código, sin comentarios ni blancos).
- **Tests sin color:** `NO_COLOR=1 npx vitest run <fichero>`. No añadir `--reporter`.
- **Escribir un param de motor desde la UI** va por `commitParam` /
  `commitEngineBaseValues`, nunca `engine.setBaseValue` a pelo.
- **Commit por tarea**, en la rama `fix/randomize-unify`. Mensajes de commit en
  inglés (convención del repo desde `b23d25d`).

---

### Task 1: La acción única — `randomizeLaneSound`

Mata el bug. Los dos botones melódicos siguen siendo estáticos en `index.html` en
esta tarea; lo único que cambia es **qué hacen** al pulsarlos, y que hay un solo
sitio donde eso está escrito.

**Dos desviaciones sobre el borrador de este plan, decididas al implementar:**

1. **El listener del inspector se lo queda `wireRandomizeUI`**, y
   `polysynth-presets.ts` pierde el suyo del todo. El borrador hacía que
   `polysynth-presets` llamara a la acción, lo que creaba un **ciclo de imports**
   (ese módulo ya es importado por `randomize-ui`). Así no hay ciclo, no hace falta
   un campo de deps que la Task 2 borraría, y es un paso hacia el botón único.
2. **El dado de drums se borra aquí, no en la Task 2.** Si se dejara para después,
   la rama pasaría un commit entero con un botón visible que ya no hace nada.

**Files:**
- Modify: `src/core/randomize-ui.ts` (reescritura casi total del módulo)
- Modify: `src/polysynth/polysynth-presets.ts:236-240, 265-275, 361-385`
- Modify: `src/main.ts:794-804` (deps de `wireRandomizeUI`)
- Test: `src/core/randomize-ui.test.ts`

**Interfaces:**
- Consumes: `commitEngineBaseValues(engine, sessionState, laneId)` de
  `engines/engine-param-commit`; `withUndo(historyDeps, fn)` de
  `save/history-wiring`; `refreshLaneKnobs(laneId, engine)` de
  `app/knob-mounting` (ya existe, mismo nombre y firma).
- Produces:
  - `randomizeLaneSound(deps: RandomizeDeps, laneId: string): void`
  - `interface RandomizeDeps { getEngine(laneId: string): SynthEngine | null;
    getLaneEngineId(laneId: string): string;
    getActiveLaneId(): string;
    getSessionState?(): SessionState | undefined;
    refreshLaneKnobs(laneId: string, engine: SynthEngine): void;
    historyDeps: HistoryDeps; }`
    `getActiveLaneId` no lo usa la Task 1: lo declara ya para que la Task 2 (que
    monta el botón contra la pista activa) no cambie la forma de las deps a medio
    plan y deje los tests de esta tarea sin compilar.
  - `markPresetCustomForLane(laneId: string): void` en `polysynth-presets.ts`,
    que **sustituye** a `markPagePresetCustom` y a `markPolyPresetCustom` (ningún
    otro llamador: verificado).

- [ ] **Step 1: Escribir los tests que fallan**

Sustituye el contenido de `src/core/randomize-ui.test.ts` por esto. Los tests de
`pickRandomDrumKit` desaparecen en la Task 2 junto con la función; aquí ya no se
tocan porque el fichero se reescribe entero.

```ts
import { describe, it, expect, vi } from 'vitest';
import { randomizeLaneSound, type RandomizeDeps } from './randomize-ui';
import type { SynthEngine } from '../engines/engine-types';

// A lane engine that rolls two params. Only the members randomizeLaneSound
// touches are real; the rest of SynthEngine is irrelevant here.
function fakeEngine(): SynthEngine & { rolled: boolean } {
  const state: Record<string, number> = { 'filter.cutoff': 1000, 'osc.level': 0.5 };
  return {
    id: 'fm',
    params: [
      { id: 'filter.cutoff', label: 'CUTOFF', min: 20, max: 8000, default: 1000 },
      { id: 'osc.level',     label: 'LEVEL',  min: 0,  max: 1,    default: 0.5 },
    ],
    rolled: false,
    getBaseValue: (id: string) => state[id],
    setBaseValue: (id: string, v: number) => { state[id] = v; },
    randomize() { this.rolled = true; state['filter.cutoff'] = 4321; state['osc.level'] = 0.9; },
  } as unknown as SynthEngine & { rolled: boolean };
}

function makeDeps(engine: SynthEngine | null) {
  const refreshLaneKnobs = vi.fn();
  const deps: RandomizeDeps = {
    getEngine: () => engine,
    getLaneEngineId: () => 'fm',
    getActiveLaneId: () => 'fm-1',
    getSessionState: () => undefined,
    refreshLaneKnobs,
    // withUndo is a pass-through today (history-wiring.ts): the real undo comes
    // from AutoHistory's microtask checkpoint. Nothing to assert here.
    historyDeps: {} as RandomizeDeps['historyDeps'],
  };
  return { deps, refreshLaneKnobs };
}

describe('randomizeLaneSound', () => {
  it('user: rolls the engine and repaints that lane\'s knobs in place', () => {
    const engine = fakeEngine();
    const { deps, refreshLaneKnobs } = makeDeps(engine);

    randomizeLaneSound(deps, 'fm-1');

    expect(engine.rolled).toBe(true);
    // The repaint is what keeps the knobs registered AND shows the new value.
    // The dice must never reach rebuildEngineParamUI, which unregisters them.
    expect(refreshLaneKnobs).toHaveBeenCalledWith('fm-1', engine);
  });

  it('user: the knob handles show the value the engine just rolled', () => {
    const engine = fakeEngine();
    const seen: Array<[string, number]> = [];
    const { deps } = makeDeps(engine);
    deps.refreshLaneKnobs = (laneId, eng) => {
      for (const spec of eng.params) seen.push([`${laneId}.${spec.id}`, eng.getBaseValue(spec.id)]);
    };

    randomizeLaneSound(deps, 'fm-1');

    expect(seen).toEqual([['fm-1.filter.cutoff', 4321], ['fm-1.osc.level', 0.9]]);
  });

  it('user: an engine that cannot roll is left alone', () => {
    const { deps, refreshLaneKnobs } = makeDeps(null);
    randomizeLaneSound(deps, 'sampler-1');
    expect(refreshLaneKnobs).not.toHaveBeenCalled();
  });

});
```

**No hay test de "el dado es deshacible", a propósito.** `withUndo<R>(_d, fn)` es hoy
`return fn()` — un paso a través que ignora sus deps (`save/history-wiring.ts:58`);
el deshacer lo produce AutoHistory por su cuenta. Un test sobre un no-op no afirma
nada. El envoltorio se pone igual por coherencia entre las dos rutas, pero no se
vende como bug arreglado.

- [ ] **Step 2: Ejecutar los tests y verificar que fallan**

```bash
NO_COLOR=1 npx vitest run src/core/randomize-ui.test.ts
```

Esperado: FAIL — `randomizeLaneSound` no existe (`does not provide an export named`).

- [ ] **Step 3: Escribir `randomizeLaneSound`**

En `src/core/randomize-ui.ts`, sustituye `randomizeMelodicSound` por esto y borra
la interfaz `RandomizeUIDeps` vieja:

```ts
export interface RandomizeDeps {
  /** The live engine of a lane, or null before it is allocated. */
  getEngine: (laneId: string) => SynthEngine | null;
  /** The lane's engine id — the key the capability door is asked about. */
  getLaneEngineId: (laneId: string) => string;
  /** The lane the poly editor is pointing at. Read by syncRandomizeButtons in
   *  Task 2; declared here so the deps shape does not change mid-plan. */
  getActiveLaneId: () => string;
  /** Live session, so a rolled sound is mirrored into the lane and survives a save. */
  getSessionState?: () => SessionState | undefined;
  /** Repaint the lane's mounted knobs from the engine's base values. IN PLACE:
   *  this is the whole point. rebuildEngineParamUI would unregister them, and a
   *  knob outside the automation registry loses its modulation ring forever. */
  refreshLaneKnobs: (laneId: string, engine: SynthEngine) => void;
  historyDeps: HistoryDeps;
}

/** The ONE dice action, for every lane and every page. */
export function randomizeLaneSound(deps: RandomizeDeps, laneId: string): void {
  const engine = deps.getEngine(laneId);
  if (!engine?.randomize) return;
  withUndo(deps.historyDeps, () => {
    engine.randomize!();
    // The engine writes through setBaseValue, so no knob onChange fires and
    // commitParam never runs: mirror the whole bag or the rolled sound is lost
    // on save.
    commitEngineBaseValues(engine, deps.getSessionState?.(), laneId);
    deps.refreshLaneKnobs(laneId, engine);
    markPresetCustomForLane(laneId);
  });
}
```

- [ ] **Step 4: Escribir `markPresetCustomForLane`**

En `src/polysynth/polysynth-presets.ts`, **borra** `markPagePresetCustom` (líneas
236-240) y `markPolyPresetCustom` (265-275) y pon en su lugar:

```ts
/** Forget a lane's preset binding and show "(custom — no preset)" on every
 *  select currently displaying that lane. Called after a dice roll: the sound no
 *  longer matches any saved preset.
 *
 *  This replaced two functions that differed only in how they found the select —
 *  one took its id, the other assumed "the active lane". They existed because the
 *  dice was written twice. */
export function markPresetCustomForLane(laneId: string): void {
  pagePresetName.delete(laneId);
  const setCustom = (selectId: string) => {
    const sel = document.getElementById(selectId) as HTMLSelectElement | null;
    if (sel) sel.value = '__custom__';
  };
  for (const [selectId, holder] of pageSelectActiveLane) {
    if (holder.laneId === laneId) setCustom(selectId);
  }
  // #poly-preset-select never registers a holder in pageSelectActiveLane (it is
  // populated per-lane by populatePolyPresetSelectForLane), so it is synced
  // explicitly when the lane it shows is the active one.
  if (_deps?.getActiveEngineLaneId() === laneId) setCustom('poly-preset-select');
}
```

- [ ] **Step 5: Apuntar los dos botones a la acción única**

En `src/polysynth/polysynth-presets.ts`, el handler de `#poly-randomize`
(líneas 361-385) pierde su cuerpo entero. Conserva el comentario histórico sobre el
dado compartido (explica por qué no hay ramas por motor) y deja:

```ts
  const btn = document.getElementById('poly-randomize') as HTMLButtonElement;
  btn.addEventListener('click', () => {
    _randomizeDeps && randomizeLaneSound(_randomizeDeps, deps.getActiveEngineLaneId());
  });
```

Para que `polysynth-presets` pueda llamar a la acción sin crear un ciclo de
imports con `core/randomize-ui`, expón un setter en `randomize-ui.ts` y llámalo
desde `main.ts`:

```ts
// core/randomize-ui.ts
let _deps: RandomizeDeps | null = null;
/** Hand the dice its dependencies once, at boot. */
export function initRandomize(deps: RandomizeDeps): void { _deps = deps; }
/** The wired action for a lane. No-op before boot has run. */
export function randomizeLane(laneId: string): void {
  if (_deps) randomizeLaneSound(_deps, laneId);
}
```

Y entonces `polysynth-presets.ts` importa sólo `randomizeLane`, y el handler es:

```ts
  btn.addEventListener('click', () => randomizeLane(deps.getActiveEngineLaneId()));
```

En `src/core/randomize-ui.ts`, `wireRandomizeUI` pasa a cablear el botón del 303
contra la misma acción (el de drums se borra en la Task 2, aquí sólo cambia el
melódico):

```ts
  $btn('bass-random-sound')?.addEventListener('click', () => randomizeLane(LANE_ID_BASS));
```

- [ ] **Step 6: Actualizar el cableado de boot**

En `src/main.ts:794-804`, la llamada pasa a ser:

```ts
initRandomize({
  getEngine: (laneId) => laneResources.get(laneId)?.engine ?? null,
  getLaneEngineId,
  getActiveLaneId: () => _lehState.activeLaneId,
  getSessionState: () => sessionHost?.state,
  refreshLaneKnobs,
  historyDeps,
});
wireRandomizeUI();
```

`getLaneEngineId` y `refreshLaneKnobs` ya existen como bindings en `main.ts` (los
usa `wireEngineSelectors`, líneas ~616-636). `refreshKnobsFromSynth`,
`getBassLaneId`, `getDrumsLaneId` y `applyDrumKitPreset` **salen** de estas deps.

- [ ] **Step 7: Ejecutar los tests y verificar que pasan**

```bash
NO_COLOR=1 npx vitest run src/core/randomize-ui.test.ts
NO_COLOR=1 npx tsc --noEmit
```

Esperado: los 3 tests en verde y el typecheck limpio. Si `tsc` se queja de
`pickRandomDrumKit` sin usar o de imports muertos en `main.ts`, arréglalo aquí: la
limpieza pertenece a la tarea que la provoca.

- [ ] **Step 8: Commit**

```bash
git add src/core/randomize-ui.ts src/core/randomize-ui.test.ts \
        src/polysynth/polysynth-presets.ts src/main.ts
git commit -m "fix(randomize): the dice repaints the knobs instead of unregistering them"
```

---

### Task 2: Simetría total — muere la página 303, y queda UN botón

**Ampliación de alcance decidida por Nacho a media implementación** (*"debería haber
sólo 1, no entiendo cómo el 303 tiene uno propio"* → *"sí, simetría total"*). El
borrador de esta tarea montaba el botón en DOS anclas, una por página; eso dejaba en
pie la razón de que hubiera dos. Lo que se hizo en su lugar:

**Files:**
- Modify: `index.html` (borrado el bloque `data-page="303"` + sus restos de CSS; el
  `<button id="poly-randomize">` sustituido por `<span class="dice-slot" data-dice-slot>`)
- Modify: `src/session/session-host-lane-editor.ts` (el router pasa de 3 páginas a 2;
  monta el dado)
- Modify: `src/session/lane-editor-panels.ts` (+ su test) — el campo `dice`
- Modify: `src/core/randomize-ui.ts` — `mountRandomizeButton`
- Modify: `src/engines/engine-selector-ui.ts`, `src/app/engine-selector-wiring.ts`,
  `src/polysynth/polysynth-presets.ts`, `src/app/knob-mounting.ts`, `src/main.ts`
- Modify: `src/plugins/capabilities.ts`, `packages/loom-plugin-sdk/src/manifest.ts`
  (docstrings que dejaban de ser ciertas)
- Modify: `tests/e2e/preset-on-load.spec.ts`, `tests/e2e/preset-recovery.spec.ts`

**La decisión de diseño que cambió respecto al borrador:** el botón NO lo monta un
`syncRandomizeButtons()` que escanea slots por el documento. Lo monta el **editor de
pista**, que ya decide qué paneles tiene una pista preguntando capacidades
(`laneEditorPanels`). El dado es una decisión más de esa lista — `dice:
!isAudio && isRandomizable(engineId)` — no un mecanismo aparte. Menos código, y la
pregunta vive donde ya viven sus hermanas.

- [x] **Step 1: El rojo** — añadir `dice` a los objetos esperados de
  `lane-editor-panels.test.ts` (4 tests comparan el objeto entero, así que caen) más
  un test de que el Sampler no lo tiene y otro de que quien no declara nada sí.
- [x] **Step 2: Verificar el rojo** — `NO_COLOR=1 npx vitest run src/session/lane-editor-panels.test.ts`
- [x] **Step 3: `laneEditorPanels` gana `dice`**, leyendo `isRandomizable`.
- [x] **Step 4: Matar la página 303** — router, HTML, y en cadena
  `wireEngineSelector303` / `populateEngineSelect303` / `mountBassPresetSelect` /
  `populateEnginePresetSelectById` / `wireEnginePresetSelectById` / `engineSel303`.
- [x] **Step 5: `mountRandomizeButton(slot, laneId, show)`** en `randomize-ui`, y el
  editor de pista lo llama con `panels.dice`.
- [x] **Step 6: Las dos docstrings** de `capabilities.ts` y del SDK dejan de decir
  "NOT read by any consumer yet".
- [x] **Step 7: e2e** — los dos specs que mapeaban `tb303 → #bass-preset-select`
  pasan a `#poly-preset-select`.
- [x] **Step 8: Verde** — `tsc --noEmit` limpio y la suite de unidad completa.

---

### Task 3: Verificación final

Sin código nuevo. Es la tarea que decide si esto se puede dar por hecho.

**Files:** ninguno que modificar salvo que algo falle.

- [ ] **Step 1: Suite completa de unidad**

```bash
npm run test:unit
```

Si sale `ERR_IPC_CHANNEL_CLOSED` **después** de que todos los tests pasen, es el
teardown flaky conocido de `node-web-audio-api`, no un fallo: re-ejecuta para
confirmar verde.

- [ ] **Step 2: Build y e2e**

```bash
npm run build && npm run test:e2e
```

⚠️ `test:e2e` sirve `dist/` **sin** compilar. El `npm run build` de arriba no es
opcional: sin él estarías probando el bundle viejo.

- [ ] **Step 3: Rebase sobre main**

```bash
git rebase main
```

- [ ] **Step 4: La comprobación a ojo, que ningún test sustituye**

En Chrome de verdad (no el navegador embebido de VS Code), sobre `npm run dev`:

1. Pista **FM**, abre su inspector. Pon un **LFO** sobre `filter.cutoff` y
   comprueba que el anillo ámbar del knob gira.
2. Pulsa **🎲 Sound**. Esperado: los knobs **se mueven** al valor nuevo **y** el
   anillo **sigue girando**. Ese es el bug del spec, y es lo único que prueba que
   está muerto.
3. Cambia el motor de esa pista a **Sampler**. Esperado: **el dado desaparece**.
   Vuelve a FM: reaparece.
4. Edita la pista de **drums**. Esperado: **no hay dado**.
5. Edita la pista del **bajo (TB-303)**. Esperado, y es el punto sin cobertura
   automática de toda la rama: se abre **el panel común**, con su fila
   ENGINE/PRESET, sus knobs (Wave, Cutoff, Resonance, Env, Decay, Accent) y **su
   dado**. El desplegable de presets debe traer los del 303, y cargar uno debe
   cambiar el sonido.
6. Con el bajo abierto, **cambia su motor** en el desplegable ENGINE y vuelve a
   `tb303`. Esperado: sin pantallas en blanco ni knobs huérfanos.
7. **Ctrl+Z** tras una tirada. Esperado: el sonido vuelve al de antes.

- [ ] **Step 5: Informe honesto**

Escribe qué pasó en cada uno de los siete puntos. Si alguno falla, NO lo des por
bueno: es un fallo de esta rama, no "un preexistente". El punto 5 es el que más
importa: la ruta del 303 **no tenía ni un test** antes de esta rama, así que el ojo
es la única red.
