# Inserts a plugins — plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** los once inserts dejan `src/` y pasan a ser plugins de disco, entran cuatro inserts nuevos, y el host deja de obedecer una fotocopia del manifiesto para obedecer el fichero que ya validaba.

**Architecture:** el host adopta los componentes del `plugin.json` que valida, así que `main.js` sólo aporta código. Un insert entra por un miembro nuevo del manifiesto (`kind: 'fx'`) y una llamada nueva de la ABI (`Loom.registerFx`), y se registra en el registro de plugins que ya existe — nada de un armario paralelo. Un insert que no está instalado deja un tapón visible que conserva sus ajustes, calcado del contrato de "motor no instalado" que ya vive en `main`.

**Tech Stack:** TypeScript, Vite, Web Audio API nativa (los inserts NO son worklets), Vitest, Playwright, esbuild (empaquetador de plugins).

**Spec:** [2026-08-02-inserts-a-plugins-design.md](../specs/2026-08-02-inserts-a-plugins-design.md)

## Global Constraints

- **Todo el texto de UI, etiquetas y comentarios de código, en INGLÉS.** El español es sólo para la conversación. **Los mensajes de commit, en inglés, sin excepción.**
- **Tamaño de fichero: objetivo 300 líneas de código, tope duro 500.** Cuentan líneas de código, no comentarios ni blancos.
- **Aserciones de test siempre RELATIVAS** (ratios, `>`, `<`, `> x * 2`). Un umbral absoluto necesita un comentario que lo justifique.
- **`npm run build` verde en CADA tarea**, no sólo al final. La rebanada A dejó el build roto entre dos tareas por trocear por tipo de trabajo en vez de por estado funcional.
- **Los tests se lanzan sin color**: `NO_COLOR=1 npx vitest run <fichero>` para uno suelto; `npm run test:unit` para la suite. No añadir `--reporter=`.
- **`npm run test:e2e` sirve `dist/` SIN construir.** Siempre `npm run build` antes.
- **Nada de migraciones de sesiones guardadas.** Si un dato viejo no encaja, se decide un comportamiento y se sigue.
- **Un insert es Web Audio NATIVO.** Ninguna tarea de este plan añade un `AudioWorkletProcessor`.
- **Antes de cada tarea de la fase 1 y 2**, comprobar que `main` no ha movido `packages/loom-plugin-sdk/src/manifest.ts`, `src/plugins/capabilities.ts`, `src/plugin-host/` ni `tools/loom-plugin/`. Si los ha movido, `git rebase main` antes de seguir.

## Estado de partida verificado (2026-08-03, `main` = `ceb5741`)

Hechos comprobados fichero a fichero. No re-derivar.

- Los **ocho** `plugins/*/main.ts` (`tb303`, `subtractive`, `fm`, `wavetable`, `westcoast`, `karplus`, `sh`, `audio-probe`) son **idénticos**: comentarios + `import manifest from './plugin.json'` + `Loom.registerComponent(manifest.components[0] as never)`. Ninguno hace nada más.
- `dsp.js` viaja por `src/plugin-host/plugin-dsp.ts` a las dos realidades (worklet y hilo principal para el export offline). Ese camino NO se toca en este plan.
- `main` es obligatorio en `manifest-validate.ts:116` y en `tools/loom-plugin/build.mjs`.
- `snapshotInsertSlot` **no tiene llamante en producción**: sólo `src/session/insert-slot.test.ts`. Los ajustes de un insert los posee la sesión (`InsertSlot.params`) y nadie los recolecta del objeto vivo — ver el comentario de `collectEngineState` en `session-host-persistence.ts:210`, *"inserts are session-owned, preserved via prev"*.
- `rehydrateInsertChain` sale **CRITICAL** en GitNexus: 4 llamantes directos, 6 flujos de ejecución, uno de ellos `record` de `src/export/offline-recorder.ts`.
- `FxInstance` sale **HIGH**: 19 dependientes directos, 96 en total.
- `src/core/fx.test.ts` registra a mano `reverbPlugin` y `delayPlugin` y **espera que el `FxBus` nazca sembrado**. Es el único test que lo espera.
- Censo: `node tools/plugin-id-census.mjs --group fx` = **0 en producción**.

---

## Fase 0 — el fallo que ya existe

### Task 0: El rack empareja por identidad, no por posición

Va **primero y solo**. Es un fallo de hoy en `main`, no toca la ABI y puede salir por su cuenta si el resto se atasca.

`rehydrateInsertChain` se salta en silencio un hueco cuyo plugin no está registrado, así que `chain.list()` queda más corta que `slots[]`. El rack recorre `chain.list()` y saca los datos de `slots[idx]` — desde el hueco saltado en adelante, cada unidad se pinta con el nombre, el color y los mandos de su vecina.

**Files:**
- Modify: `src/session/lane-insert-ui.ts:80-99` (el `repeat` y `unitTemplate`)
- Test: `src/session/lane-insert-ui.test.ts` (crear si no existe)

**Interfaces:**
- Consumes: `InsertChain.list(): readonly ChainSlot[]` y `ChainSlot.id`, ambos ya existentes.
- Produces: nada nuevo. Es un arreglo interno.

- [ ] **Step 1: Escribe el test que falla**

`ChainSlot` ya lleva `id`, así que la pareja correcta se puede encontrar por él.

```ts
// src/session/lane-insert-ui.test.ts
import { describe, it, expect } from 'vitest';
import { InsertChain } from '../plugins/fx/insert-chain';
import { limiterPlugin } from '../plugins/fx/limiter';
import { compressorPlugin } from '../plugins/fx/compressor';
import type { InsertSlot } from './insert-slot';

describe('insert rack pairing', () => {
  it('pairs a chain entry with its own slot, not with the one at its index', () => {
    const ctx = new AudioContext();
    const chain = new InsertChain(ctx.createGain(), ctx.createGain());
    // Three slots persisted, but the MIDDLE one's plugin is not registered, so
    // only two ever reach the chain. Index pairing would show slot[1]'s data
    // on the unit that is really slot[2].
    const slots: InsertSlot[] = [
      { id: 'sA', pluginId: 'limiter',    params: {}, bypass: false },
      { id: 'sB', pluginId: 'ghost-fx',   params: {}, bypass: false },
      { id: 'sC', pluginId: 'compressor', params: {}, bypass: false },
    ];
    chain.insert(limiterPlugin.create(ctx), 'sA');
    chain.insert(compressorPlugin.create(ctx), 'sC');

    const paired = chain.list().map((cs) => slots.find((s) => s.id === cs.id));
    expect(paired.map((s) => s?.pluginId)).toEqual(['limiter', 'compressor']);
    // The bug, stated as the thing that must NOT happen: index pairing would
    // put 'ghost-fx' on the second unit.
    expect(chain.list().map((_cs, i) => slots[i].pluginId))
      .not.toEqual(paired.map((s) => s?.pluginId));
  });
});
```

- [ ] **Step 2: Lánzalo y comprueba que falla**

Run: `NO_COLOR=1 npx vitest run src/session/lane-insert-ui.test.ts`
Expected: FAIL — el fichero de test no existe todavía, o la última aserción no se cumple.

- [ ] **Step 3: Cambia el emparejamiento del rack**

En `src/session/lane-insert-ui.ts`, el `repeat` deja de usar el índice para buscar el hueco. Sustituye el bloque de `renderRack`:

```ts
      ${repeat(
        chain.list(),
        (cs) => cs.id,
        (cs, idx) => unitTemplate(h, cs, idx),
      )}
```

y en `unitTemplate` cambia la primera línea:

```ts
function unitTemplate(h: Rack, cs: ChainSlot, idx: number): TemplateResult | typeof nothing {
  const { chain, slots, onChange } = h.deps;
  // By ID, never by position. Removing a slot renumbers every later one, and a
  // slot whose plugin is missing never reaches the chain at all — either way the
  // two lists stop lining up and every later unit renders its neighbour's data.
  const slot = slots.find((s) => s.id === cs.id);
  if (!slot) return nothing;
```

`idx` se sigue usando para `chain.setBypass(idx, …)` y `chain.remove(idx)`, que sí son operaciones posicionales sobre la cadena — eso es correcto y no cambia. Lo que cambia es de dónde salen los DATOS.

Y en el borrado, `slots.splice(idx, 1)` pasa a borrar por identidad:

```ts
          chain.remove(idx);
          const at = slots.findIndex((s) => s.id === cs.id);
          if (at >= 0) slots.splice(at, 1);
```

- [ ] **Step 4: Lánzalo y comprueba que pasa**

Run: `NO_COLOR=1 npx vitest run src/session/lane-insert-ui.test.ts`
Expected: PASS

- [ ] **Step 5: La suite entera y el build**

Run: `npm run test:unit` y luego `npm run build`
Expected: ambos verdes.

- [ ] **Step 6: Commit**

```bash
git add src/session/lane-insert-ui.ts src/session/lane-insert-ui.test.ts
git commit -m "fix(rack): an insert unit takes its data from its own slot, not from the one at its index

A slot whose plugin id is not registered never reaches the chain, so
chain.list() runs shorter than slots[]. The rack walked the chain and read
slots[idx], which means every unit after the skipped one rendered its
neighbour's name, colour and knobs.

Reachable today only by hand-editing a save. It becomes reachable by design
the moment an insert can be uninstalled, which is what the rest of this
branch builds."
```

---

## Fase 1 — la ficha manda

### Task 1: `main` deja de ser obligatorio

Preparatoria y sin efecto observable: nadie quita todavía su `main.js`. Sale sola para que la tarea 2 sea un cambio de conducta y no dos a la vez.

**Files:**
- Modify: `src/plugin-host/manifest-validate.ts:116-124`
- Modify: `src/plugin-host/plugin-host.ts:76`
- Modify: `tools/loom-plugin/build.mjs` (`assertValidManifest`)
- Modify: `packages/loom-plugin-sdk/src/manifest.ts` (`PluginManifestFile.main`)
- Test: `src/plugin-host/manifest-validate.test.ts`, `tools/loom-plugin/build.test.mjs`

**Interfaces:**
- Consumes: `validatePluginManifest(raw): ValidationResult` — sin cambio de firma.
- Produces: `PluginManifestFile.main?: string` (antes `main: string`). La tarea 2 depende de que sea opcional.

- [ ] **Step 1: Escribe el test que falla**

```ts
// src/plugin-host/manifest-validate.test.ts — añadir dentro del describe existente
  it('accepts a manifest with no main: a plugin may be pure data', () => {
    const res = validatePluginManifest({
      id: 'nomain', name: 'No Main', version: '1.0.0', loomApi: 1,
      components: [{
        kind: 'modulator', id: 'nomain', name: 'No Main', params: [],
        modulator: { driver: 'time', scopes: ['shared'], idPrefix: 'nm' },
      }],
    });
    expect(res.ok).toBe(true);
  });

  it('still rejects a main that is present but not a string', () => {
    const res = validatePluginManifest({
      id: 'badmain', name: 'Bad', version: '1.0.0', loomApi: 1, main: 42,
      components: [],
    });
    expect(res.ok).toBe(false);
  });
```

- [ ] **Step 2: Lánzalo y comprueba que falla**

Run: `NO_COLOR=1 npx vitest run src/plugin-host/manifest-validate.test.ts`
Expected: FAIL en el primero — `main must be a non-empty string`.

- [ ] **Step 3: Haz `main` opcional en las cuatro puertas**

`packages/loom-plugin-sdk/src/manifest.ts`:

```ts
  /** Entry point loaded on the MAIN thread. Absent ⇒ this plugin contributes no
   *  main-thread code. Its components come from THIS file, which the host reads
   *  and validates; a manifest is data, and data needs no entry point to be
   *  believed. Present for anything that must register a function the ABI cannot
   *  carry as JSON — an insert's `create`, for one. */
  main?: string;
```

`src/plugin-host/manifest-validate.ts` — saca `'main'` del bucle obligatorio y mételo en el opcional:

```ts
  for (const k of ['id', 'name', 'version'] as const) {
    if (!isStr(raw[k])) return { ok: false, error: `${k} must be a non-empty string` };
  }
  ...
  for (const k of ['main', 'dsp', 'presets'] as const) {
    if (raw[k] !== undefined && !isStr(raw[k])) return { ok: false, error: `${k} must be a string when present` };
  }
```

`src/plugin-host/plugin-host.ts` — el import se salta cuando no hay entrada:

```ts
      if (manifest.main) await doImport(`${dir}${manifest.main}`);
```

`tools/loom-plugin/build.mjs` — en `assertValidManifest`, saca `main` del bucle y compruébalo sólo si está:

```js
  for (const k of ['id', 'name', 'version']) {
    if (typeof m[k] !== 'string' || !m[k]) throw new Error(`plugin.json: ${k} must be a non-empty string`);
  }
  if (m.main !== undefined && (typeof m.main !== 'string' || !m.main)) {
    throw new Error('plugin.json: main must be a non-empty string when present');
  }
```

Y donde `build.mjs` empaquete `m.main`, envuélvelo en `if (m.main)`.

- [ ] **Step 4: Lánzalos y comprueba que pasan**

Run: `NO_COLOR=1 npx vitest run src/plugin-host/manifest-validate.test.ts tools/loom-plugin/build.test.mjs`
Expected: PASS

- [ ] **Step 5: La suite y el build**

Run: `npm run test:unit` y `npm run build`
Expected: verdes. Los ocho plugins siguen declarando su `main` y siguen cargándose.

- [ ] **Step 6: Commit**

```bash
git add packages/loom-plugin-sdk/src/manifest.ts src/plugin-host/manifest-validate.ts src/plugin-host/plugin-host.ts src/plugin-host/manifest-validate.test.ts tools/loom-plugin/build.mjs tools/loom-plugin/build.test.mjs
git commit -m "feat(plugin-host): a plugin may ship no main-thread entry point

main becomes optional in the type, the validator, the loader and the packer.
Nothing drops its main.js yet — this is the door the next commit walks
through, split out so that one is a change of behaviour rather than two."
```

### Task 2: El host adopta la ficha que acaba de validar

El cambio de conducta. Es una sola tarea porque las tres piezas —adoptar en el host, quitar la llamada de la ABI, borrar los ocho `main.ts`— **no se pueden separar sin registrar dos veces o no registrar ninguna**.

**Files:**
- Modify: `src/plugin-host/loom-api.ts` (exportar `adoptComponents`, quitar `registerComponent` de la ABI)
- Modify: `src/plugin-host/plugin-host.ts` (adoptar tras validar, antes de importar `main`)
- Modify: `packages/loom-plugin-sdk/src/manifest.ts` (`LoomApi` pierde `registerComponent`)
- Modify: `test/plugin-fixtures.ts`
- Modify: `tools/loom-plugin/scaffold.mjs` (deja de generar un `main.ts` que sólo repite la ficha)
- Delete: `plugins/tb303/main.ts`, `plugins/subtractive/main.ts`, `plugins/fm/main.ts`, `plugins/wavetable/main.ts`, `plugins/westcoast/main.ts`, `plugins/karplus/main.ts`, `plugins/sh/main.ts`, `plugins/audio-probe/main.ts`
- Modify: los ocho `plugins/*/plugin.json` (quitar `"main": "main.js"`)
- Test: `src/plugin-host/plugin-host.test.ts`

**Interfaces:**
- Consumes: `validatePluginManifest`, `PluginManifestFile.components`.
- Produces: `export function adoptComponents(components: ComponentManifest[]): void` en `src/plugin-host/loom-api.ts`. La tarea 5 y `test/plugin-fixtures.ts` la usan. `globalThis.Loom` deja de tener `registerComponent`.

- [ ] **Step 1: Escribe el test que falla**

El test tiene que afirmar que manda **el fichero**, no la copia. Se consigue dando al host un manifiesto cuyo `main` NO registra nada.

```ts
// src/plugin-host/plugin-host.test.ts — añadir
  it('registers a component from the validated plugin.json, with no help from main.js', async () => {
    const manifest = {
      id: 'jsonly', name: 'JSON Only', version: '1.0.0', loomApi: 1,
      components: [{
        kind: 'modulator', id: 'jsonly', name: 'JSON Only', params: [],
        modulator: { driver: 'time', scopes: ['shared'], idPrefix: 'jo' },
      }],
    };
    const report = await loadPlugins({
      baseUrl: '/',
      fetchImpl: (async (url: string) => ({
        ok: true,
        json: async () => (url.endsWith('index.json') ? { plugins: ['jsonly'] } : manifest),
      })) as unknown as typeof fetch,
      // No main in the manifest, so this must never be reached.
      importImpl: async () => { throw new Error('main.js must not be imported'); },
    });
    expect(report.loaded).toEqual(['jsonly']);
    expect(getModulator('jsonly')).toBeDefined();
  });
```

Importa `getModulator` de `../modulation/modulator-registry` y llama a `__resetPluginEngines()` en el `beforeEach` que ya usa ese fichero.

- [ ] **Step 2: Lánzalo y comprueba que falla**

Run: `NO_COLOR=1 npx vitest run src/plugin-host/plugin-host.test.ts`
Expected: FAIL — `getModulator('jsonly')` es `undefined`: hoy nadie adopta el componente porque no hay `main.js` que lo entregue.

- [ ] **Step 3: El host adopta**

`src/plugin-host/loom-api.ts` — exporta la adopción y quítala de la ABI:

```ts
/** Adopt every component a validated manifest declares. This is the ONE path a
 *  component enters by. It runs from loadPlugins with the manifest the host just
 *  fetched and checked — NOT from a copy esbuild baked into main.js, which is
 *  what let the host validate one document and obey another. */
export function adoptComponents(components: ComponentManifest[]): void {
  for (const c of components) adoptComponent(c);
}
```

y en `installMainThreadLoomApi`, borra la propiedad `registerComponent` del objeto. `registerRenderer` y `registerModulatorKernel` se quedan: sí son código.

`packages/loom-plugin-sdk/src/manifest.ts` — borra `registerComponent(manifest: ComponentManifest): void;` de `LoomApi` y añade encima:

```ts
/** The runtime handshake. Installed by the host on globalThis in BOTH realms
 *  before any plugin code runs; a plugin never imports anything from the host.
 *  It carries CODE ONLY. A component's description is data, and data travels in
 *  plugin.json — the file the host reads, validates and obeys. */
```

`src/plugin-host/plugin-host.ts` — adopta después de los presets y antes del import:

```ts
      // Components come from the file we just validated. Presets first: an
      // engine descriptor reads getCachedPresets(id) as it is built.
      adoptComponents(manifest.components);

      if (manifest.main) await doImport(`${dir}${manifest.main}`);
```

- [ ] **Step 4: Borra los ocho `main.ts` y su declaración**

```bash
git rm plugins/tb303/main.ts plugins/subtractive/main.ts plugins/fm/main.ts \
       plugins/wavetable/main.ts plugins/westcoast/main.ts plugins/karplus/main.ts \
       plugins/sh/main.ts plugins/audio-probe/main.ts
```

Y en los ocho `plugin.json`, borra la línea `"main": "main.js",`.

- [ ] **Step 5: El fixture usa la puerta del host**

`test/plugin-fixtures.ts` — cambia el rodeo por el global por la llamada directa, y actualiza la cabecera:

```ts
// ...pushes it through the same door production uses: adoptComponents, the one
// path a component enters by. Reading the real file is the point — a
// hand-written stub would keep passing while the manifest it stands in for was
// broken.
import { adoptComponents } from '../src/plugin-host/loom-api';
...
  const manifest = JSON.parse(raw) as { components: ComponentManifest[] };
  adoptComponents(manifest.components);
```

`installMainThreadLoomApi()` deja de hacer falta aquí: la adopción ya no pasa por el global. Bórralo del fixture.

- [ ] **Step 6: El generador de plugins deja de escribir la fotocopia**

En `tools/loom-plugin/scaffold.mjs`, la plantilla `MAIN` deja de existir para un plugin sin código de hilo principal, y `main` sale del `plugin.json` generado. Un plugin generado con `--js` que sí traiga DSP conserva su `dsp.js`.

- [ ] **Step 7: Lánzalo todo**

Run: `NO_COLOR=1 npx vitest run src/plugin-host/ test/plugin-fixtures.test.ts`
Expected: PASS

Run: `npm run test:unit`
Expected: verde. Presta atención a los tests de motor: cuelgan de `registerPluginEngine`.

Run: `npm run build && npm run test:e2e`
Expected: verde. Los seis motores de plugin siguen apareciendo y sonando.

- [ ] **Step 8: Comprueba que el símbolo ha desaparecido**

Run: `grep -rn "registerComponent" src/ packages/ plugins/ test/ tools/`
Expected: sin resultados (comentarios incluidos: actualiza los de `src/engines/engine-selector-ui.ts:37` y `src/plugins/types.ts:62`, que lo nombran).

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "feat(plugin-host): the manifest the host validates is the manifest it obeys

Until now the host fetched plugin.json, checked it was well formed, threw it
away, and ran the copy esbuild had baked into main.js. It reviewed one
document and obeyed another. Harmless while the same person packs the
plugin; a trap the moment somebody drops in a folder and edits its manifest.

loadPlugins now adopts the components from the manifest it just validated.
Loom.registerComponent is gone from the ABI, which carries code only, and all
eight plugins/*/main.ts — identical one-liners that existed to repeat their
own plugin.json — are deleted outright. The test fixture calls adoptComponents
directly, which is the same door production uses rather than a detour through
a global.

Each file now means one thing: plugin.json is data, main.js is main-thread
code, dsp.js is worklet code."
```

### Task 3: La ficha editada a mano se obedece (aceptación §5.0)

Es el único criterio que distingue las dos conductas: la suite entera pasa verde con la fotocopia y sin ella.

**Files:**
- Create: `tests/e2e/plugin-manifest-is-the-file.spec.ts`

**Interfaces:**
- Consumes: la app construida en `dist/`, con `dist/plugins/karplus/plugin.json` ya empaquetado.
- Produces: nada. Es un criterio.

- [ ] **Step 1: Escribe el e2e**

```ts
// tests/e2e/plugin-manifest-is-the-file.spec.ts
import { test, expect } from '@playwright/test';
import { readFileSync, writeFileSync, copyFileSync } from 'node:fs';

const MANIFEST = 'dist/plugins/karplus/plugin.json';

test('the UI follows a hand-edited plugin.json, not a copy baked into main.js', async ({ page }) => {
  copyFileSync(MANIFEST, `${MANIFEST}.bak`);
  const raw = JSON.parse(readFileSync(MANIFEST, 'utf8'));
  const first = raw.components[0].params[0];
  first.label = 'EDITED';
  writeFileSync(MANIFEST, JSON.stringify(raw));
  try {
    await page.goto('/');
    // Presence, not absence: the edited label must BE on screen. A plugin that
    // failed to load would show nothing at all and pass an absence check.
    await page.locator('#session-tab').click();
    await page.locator('.session-lane-header').first().click();
    await expect(page.getByText('EDITED')).toBeVisible();
  } finally {
    copyFileSync(`${MANIFEST}.bak`, MANIFEST);
  }
});
```

Ajusta los selectores a los reales del proyecto tras mirar el DOM: la pista de Karplus tiene que existir en la sesión de arranque, o el test la crea con el selector de motor primero.

- [ ] **Step 2: Constrúyelo y lánzalo**

Run: `npm run build && NO_COLOR=1 npx playwright test tests/e2e/plugin-manifest-is-the-file.spec.ts`
Expected: PASS. Si sale FAIL con la etiqueta vieja, el host sigue obedeciendo la fotocopia.

- [ ] **Step 3: Commit**

```bash
git add tests/e2e/plugin-manifest-is-the-file.spec.ts
git commit -m "test(e2e): a hand-edited manifest changes what the app shows

The one check that separates obeying the file from obeying the baked copy —
the whole unit suite passes either way, which is exactly why the fix needed a
test that could tell them apart. It asserts the edited label is PRESENT: a
plugin that failed to load shows nothing and would sail through an
absence check."
```

---

## Fase 2 — la puerta de los inserts

### Task 4: `kind: 'fx'` en el manifiesto, y `FxInstance` con un solo dueño

**Files:**
- Create: `packages/loom-plugin-sdk/src/fx.ts`
- Modify: `packages/loom-plugin-sdk/src/index.ts`
- Modify: `packages/loom-plugin-sdk/src/manifest.ts` (`ComponentManifest`, `LoomApi`)
- Modify: `src/plugins/types.ts` (reexporta `FxInstance`)
- Modify: `src/plugin-host/manifest-validate.ts` (rama `fx`)
- Modify: `tools/loom-plugin/build.mjs` (rama `fx`)
- Test: `src/plugin-host/manifest-validate.test.ts`, `tools/loom-plugin/build.test.mjs`

**Interfaces:**
- Consumes: `ComponentManifestBase`, `EngineParamSpec` del SDK.
- Produces:
  - `interface FxInstance` (SDK, `fx.ts`) — la misma forma que hoy vive en `src/plugins/types.ts`.
  - `interface FxDeclaration { color: string }`
  - `ComponentManifest` gana `| (ComponentManifestBase & { kind: 'fx'; fx: FxDeclaration })`
  - `type FxFactory = (ctx: AudioContext) => FxInstance`

- [ ] **Step 1: Escribe el test que falla**

```ts
// src/plugin-host/manifest-validate.test.ts — añadir
  const fxManifest = (fx: unknown) => ({
    id: 'wah', name: 'Wah', version: '1.0.0', loomApi: 1, main: 'main.js',
    components: [{ kind: 'fx', id: 'wah', name: 'Auto-Wah', params: [], fx }],
  });

  it('accepts an fx component that declares its colour', () => {
    expect(validatePluginManifest(fxManifest({ color: '#ffa726' })).ok).toBe(true);
  });

  it('rejects an fx component with no fx block', () => {
    const res = validatePluginManifest(fxManifest(undefined));
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/needs an fx object/);
  });

  it('rejects an fx component whose colour is missing', () => {
    const res = validatePluginManifest(fxManifest({}));
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/fx\.color/);
  });
```

- [ ] **Step 2: Lánzalo y comprueba que falla**

Run: `NO_COLOR=1 npx vitest run src/plugin-host/manifest-validate.test.ts`
Expected: FAIL en el primero — `components[0].kind must be engine|modulator`.

- [ ] **Step 3: `FxInstance` sube al SDK**

Crea `packages/loom-plugin-sdk/src/fx.ts` con el contenido que hoy está en `src/plugins/types.ts` (el bloque `FxInstance` entero, comentarios incluidos) más:

```ts
/** What an fx component declares beyond the common fields. */
export interface FxDeclaration {
  /** The unit's colour in the insert rack — the dot, the name and the box's
   *  --fx-color. Any CSS colour.
   *
   *  It is a THIRD place a colour can live, and that needs saying: a group
   *  declares the colour of an editor section, a param the ring of one knob.
   *  An insert has no sections — its unit is a single visual object — so its
   *  colour belongs to the component. Required, not optional: the six effects
   *  the old hand-written table covered looked deliberate and the other five
   *  looked deliberate too, and one of those was an oversight.
   */
  color: string;
}

/** The factory a plugin hands the host through Loom.registerFx. */
export type FxFactory = (ctx: AudioContext) => FxInstance;
```

`packages/loom-plugin-sdk/src/index.ts` gana `export * from './fx';`.

`src/plugins/types.ts` borra su bloque `FxInstance` y lo reexporta:

```ts
// FxInstance lives in the SDK: it is the shape a third-party insert compiles
// against, and two declarations of one shape guarantee an author picks the
// wrong one — the ModLite lesson, paid once already.
export type { FxInstance, FxFactory, FxDeclaration } from '@loom/plugin-sdk';
```

- [ ] **Step 4: El miembro `fx` del manifiesto y sus dos validadores**

`packages/loom-plugin-sdk/src/manifest.ts`, en `ComponentManifest`:

```ts
  | (ComponentManifestBase & { kind: 'fx'; fx: import('./fx').FxDeclaration })
```

`src/plugin-host/manifest-validate.ts`:

```ts
function fxDeclarationError(f: unknown, i: number): string | null {
  if (!isObj(f)) return `components[${i}] needs an fx object`;
  if (!isStr(f.color)) return `components[${i}].fx.color must be a non-empty string`;
  return null;
}
```

y en `componentError`:

```ts
  if (c.kind !== 'engine' && c.kind !== 'modulator' && c.kind !== 'fx') {
    return `components[${i}].kind must be engine|modulator|fx`;
  }
  ...
  if (c.kind === 'modulator') return modulatorDeclarationError(c.modulator, i);
  // An fx declares no polyphony, no capabilities and no editor layout: it has no
  // lane of its own. Its params render in the rack, which has no sections.
  if (c.kind === 'fx') return fxDeclarationError(c.fx, i);
```

`tools/loom-plugin/build.mjs`, en el bucle de componentes, junto a las ramas `engine` y `modulator`:

```js
    } else if (c.kind === 'fx') {
      if (!c.fx || typeof c.fx !== 'object') {
        throw new Error(`plugin.json: component ${c.id} needs an fx object`);
      }
      if (typeof c.fx.color !== 'string' || !c.fx.color) {
        throw new Error(`plugin.json: component ${c.id} needs fx.color`);
      }
    }
```

- [ ] **Step 5: Lánzalos**

Run: `NO_COLOR=1 npx vitest run src/plugin-host/manifest-validate.test.ts tools/loom-plugin/build.test.mjs packages/`
Expected: PASS

- [ ] **Step 6: La suite y el build**

Run: `npm run test:unit && npm run build`
Expected: verdes. `FxInstance` se ha movido y 19 dependientes directos la importan por el reexport — si alguno la importaba por ruta profunda, `tsc` lo dirá.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat(sdk): an insert is a manifest component, and FxInstance has one owner

kind: 'fx' joins engine and modulator, declaring exactly one thing the
manifest could not already express: the unit's colour in the rack. It is a
third home for a colour and the type says why — a group colours an editor
section, a param colours one knob ring, and an insert has neither because its
unit is a single visual object.

FxInstance moves to the SDK and src re-exports it in one line. Two
declarations of one shape is how an author picks the wrong one; that lesson
was already paid for once with ModLite."
```

### Task 5: `Loom.registerFx`, y un plugin que promete un efecto y no lo entrega falla RUIDOSAMENTE

**Files:**
- Modify: `src/plugin-host/loom-api.ts`
- Modify: `src/plugin-host/plugin-host.ts`
- Modify: `packages/loom-plugin-sdk/src/manifest.ts` (`LoomApi`)
- Test: `src/plugin-host/loom-api.test.ts`, `src/plugin-host/plugin-host.test.ts`

**Interfaces:**
- Consumes: `adoptComponents` (Task 2), `FxFactory` (Task 4), `registerPlugin` / `getPlugin` de `src/plugins/registry.ts`.
- Produces:
  - `globalThis.Loom.registerFx(id: string, create: FxFactory): void`
  - `export function assertFxFactories(manifest: PluginManifestFile): void` en `loom-api.ts` — lanza si algún componente `kind: 'fx'` no tiene fábrica registrada.

- [ ] **Step 1: Escribe los dos tests que fallan**

```ts
// src/plugin-host/loom-api.test.ts — añadir
  it('a registered fx factory lands in the plugin registry with its manifest', () => {
    installMainThreadLoomApi();
    adoptComponents([{ kind: 'fx', id: 'wah', name: 'Auto-Wah', params: [], fx: { color: '#abc' } }]);
    const gain = {} as GainNode;
    (globalThis as { Loom: { registerFx(id: string, c: unknown): void } }).Loom
      .registerFx('wah', () => ({ input: gain, output: gain } as unknown as FxInstance));
    const p = getPlugin('fx', 'wah');
    expect(p?.manifest.name).toBe('Auto-Wah');
    expect(p?.manifest.color).toBe('#abc');
  });

  it('registerFx for an id the manifest never declared is refused, not registered silently', () => {
    installMainThreadLoomApi();
    expect(() => (globalThis as { Loom: { registerFx(id: string, c: unknown): void } }).Loom
      .registerFx('ghost', () => ({} as FxInstance))).toThrow(/never declared/);
  });
```

```ts
// src/plugin-host/plugin-host.test.ts — añadir
  it('a plugin that declares an fx and registers no factory is a load failure', async () => {
    const manifest = {
      id: 'broken', name: 'Broken', version: '1.0.0', loomApi: 1, main: 'main.js',
      components: [{ kind: 'fx', id: 'broken', name: 'Broken', params: [], fx: { color: '#f00' } }],
    };
    const report = await loadPlugins({
      baseUrl: '/',
      fetchImpl: (async (url: string) => ({
        ok: true,
        json: async () => (url.endsWith('index.json') ? { plugins: ['broken'] } : manifest),
      })) as unknown as typeof fetch,
      importImpl: async () => undefined,   // main.js runs and registers nothing
    });
    expect(report.loaded).toEqual([]);
    expect(report.failed[0].error).toMatch(/declared fx component/);
    // And it is NOT in the picker: a dead entry that does nothing when inserted
    // is worse than an absent one.
    expect(getPlugin('fx', 'broken')).toBeUndefined();
  });
```

- [ ] **Step 2: Lánzalos y comprueba que fallan**

Run: `NO_COLOR=1 npx vitest run src/plugin-host/`
Expected: FAIL — `Loom.registerFx is not a function`.

- [ ] **Step 3: Impleméntalo**

`src/plugin-host/loom-api.ts`:

```ts
// An fx component enters in two halves: its description comes from the manifest
// the host validated, its factory from main.js — a function cannot travel as
// JSON. adoptFx parks the description; registerFx marries the two and registers
// the pair. A half that never arrives is a broken plugin, and assertFxFactories
// is what refuses to let it look like a working one.
const pendingFx = new Map<string, ComponentManifest & { kind: 'fx' }>();

function adoptFx(m: ComponentManifest & { kind: 'fx' }): void {
  pendingFx.set(m.id, m);
}

function registerFxFactory(id: string, create: FxFactory, version: string): void {
  const m = pendingFx.get(id);
  if (!m) throw new Error(`registerFx("${id}"): this plugin's manifest never declared an fx component with that id`);
  pendingFx.delete(id);
  registerPlugin({
    kind: 'fx',
    manifest: { id: m.id, name: m.name, kind: 'fx', version, params: m.params, presets: [], color: m.fx.color },
    create,
  });
}

/** Every fx a manifest promised must have arrived by the time its main.js has
 *  run. Throwing here puts the plugin in report.failed instead of listing an
 *  effect that does nothing when you insert it. */
export function assertFxFactories(manifest: PluginManifestFile): void {
  const missing = manifest.components
    .filter((c): c is ComponentManifest & { kind: 'fx' } => c.kind === 'fx')
    .filter((c) => !getPlugin('fx', c.id))
    .map((c) => c.id);
  if (missing.length) {
    throw new Error(`declared fx component(s) [${missing.join(', ')}] but registered no factory for them`);
  }
}
```

`adoptComponent` gana su rama:

```ts
function adoptComponent(m: ComponentManifest): void {
  if (m.kind === 'modulator') return adoptModulator(m);
  if (m.kind === 'fx') return adoptFx(m);
  return adoptEngine(m);
}
```

y el objeto global, la llamada. Necesita la `version` del fichero, así que `adoptComponents` pasa a recibirla:

```ts
export function adoptComponents(components: ComponentManifest[], version = '1.0.0'): void {
  currentPluginVersion = version;
  for (const c of components) adoptComponent(c);
}
```

con `currentPluginVersion` leído por `registerFxFactory`. En `installMainThreadLoomApi`:

```ts
      registerFx: (id: string, create: FxFactory) => registerFxFactory(id, create, currentPluginVersion),
```

`packages/loom-plugin-sdk/src/manifest.ts`, en `LoomApi`:

```ts
  /** Hand the host the function that builds an insert's Web Audio nodes. The id
   *  must match an `kind: 'fx'` component in this plugin's manifest — a factory
   *  for anything else is refused rather than registered under a name nothing
   *  declared. */
  registerFx(id: string, create: import('./fx').FxFactory): void;
```

`src/plugin-host/plugin-host.ts`, tras el import:

```ts
      adoptComponents(manifest.components, manifest.version);
      if (manifest.main) await doImport(`${dir}${manifest.main}`);
      assertFxFactories(manifest);
```

`src/plugins/types.ts` — `PluginManifest` gana el color:

```ts
  /** Rack colour, for an fx manifest. Absent on engines. */
  readonly color?: string;
```

- [ ] **Step 4: Lánzalos y comprueba que pasan**

Run: `NO_COLOR=1 npx vitest run src/plugin-host/`
Expected: PASS

- [ ] **Step 5: La suite y el build**

Run: `npm run test:unit && npm run build`
Expected: verdes.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(plugin-host): an insert enters through registerFx, and a broken one says so

An fx arrives in two halves — its description from the manifest the host
validated, its factory from main.js, because a function cannot travel as
JSON. adoptFx parks the description, registerFx marries the two into the
registry that already existed. No parallel cupboard: listPlugins('fx') and
createInstance('fx', …) stay the one door, so the rack, automation and the
modulation binder never learn that an effect came from outside.

The half that never arrives is the interesting case. A plugin that declares
an fx and registers no factory now fails to load, instead of appearing in the
picker and doing nothing when you insert it. Not crashing is right; going
quiet is not — this repo has paid for that three times."
```

### Task 6: Un insert que no está instalado deja un tapón visible

**Files:**
- Create: `src/core/missing-fx.ts`
- Modify: `src/session/insert-slot.ts` (`rehydrateInsertChain`)
- Modify: `src/session/lane-insert-ui.ts` (`unitTemplate`)
- Test: `src/core/missing-fx.test.ts`, `src/session/insert-slot.test.ts`

**Interfaces:**
- Consumes: `FxInstance` (Task 4), `InsertChain.insert`.
- Produces:
  - `export function createMissingFx(ctx: AudioContext, pluginId: string, params: Record<string, number>): FxInstance`
  - `export function isMissingFx(fx: FxInstance): boolean`
  - `export function __resetMissingFxWarnings(): void` (sólo tests)

- [ ] **Step 1: Escribe los tests que fallan**

```ts
// src/core/missing-fx.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createMissingFx, isMissingFx, __resetMissingFxWarnings } from './missing-fx';

describe('missing fx placeholder', () => {
  beforeEach(() => __resetMissingFxWarnings());

  it('passes audio through untouched', async () => {
    const ctx = new OfflineAudioContext(1, 4096, 44100);
    const src = ctx.createConstantSource();
    src.offset.value = 0.5;
    const fx = createMissingFx(ctx as unknown as AudioContext, 'delay', {});
    src.connect(fx.input);
    fx.output.connect(ctx.destination);
    src.start();
    const buf = await ctx.startRendering();
    const tail = buf.getChannelData(0).slice(2048);
    // Relative: the placeholder must not attenuate. Compare against the source
    // level rather than an absolute figure.
    expect(Math.min(...tail)).toBeGreaterThan(0.5 * 0.99);
  });

  it('hands back the params it was given, so a save round-trips them', () => {
    const ctx = new AudioContext();
    const fx = createMissingFx(ctx, 'delay', { time: 0.375, feedback: 0.4 });
    expect(fx.getBaseValue('time')).toBe(0.375);
    fx.setBaseValue('time', 0.5);
    expect(fx.getBaseValue('time')).toBe(0.5);
    expect(isMissingFx(fx)).toBe(true);
  });

  it('warns once per missing id, not once per slot', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const ctx = new AudioContext();
    createMissingFx(ctx, 'delay', {});
    createMissingFx(ctx, 'delay', {});
    createMissingFx(ctx, 'reverb', {});
    expect(warn.mock.calls.filter((c) => String(c[0]).includes('delay'))).toHaveLength(1);
    expect(warn.mock.calls.filter((c) => String(c[0]).includes('reverb'))).toHaveLength(1);
    warn.mockRestore();
  });
});
```

```ts
// src/session/insert-slot.test.ts — añadir
  it('keeps a slot whose plugin is missing, so the chain and the slots stay 1:1', () => {
    const ctx = new AudioContext();
    const chain = new InsertChain(ctx.createGain(), ctx.createGain());
    rehydrateInsertChain(ctx, chain, [
      { id: 'sA', pluginId: 'limiter',  params: {}, bypass: false },
      { id: 'sB', pluginId: 'ghost-fx', params: { x: 3 }, bypass: false },
    ]);
    expect(chain.size()).toBe(2);
    expect(chain.list()[1].id).toBe('sB');
  });
```

- [ ] **Step 2: Lánzalos y comprueba que fallan**

Run: `NO_COLOR=1 npx vitest run src/core/missing-fx.test.ts src/session/insert-slot.test.ts`
Expected: FAIL — el módulo no existe; y `chain.size()` es 1, no 2.

- [ ] **Step 3: Escribe el tapón**

```ts
// src/core/missing-fx.ts
// The stand-in for an insert whose plugin is not installed here.
//
// It is a pass-through, but it is NOT a silence: it keeps the slot's id and its
// saved params, so the rack can draw a marked unit and a save re-writes the
// settings untouched. Uninstalling a plugin must never delete what the user set.
//
// The rule this obeys is the one the modulator slice wrote down: what is only
// USED can be removed; what is also REFERENCED from saved data cannot. An insert
// slot is referenced from saved data, so the reference survives as this.
import type { FxInstance } from '../plugins/types';

const warned = new Set<string>();
const MISSING = Symbol('loom.missingFx');

export function createMissingFx(
  ctx: AudioContext, pluginId: string, params: Record<string, number>,
): FxInstance {
  if (!warned.has(pluginId)) {
    warned.add(pluginId);
    // Once per id, not once per slot: a session with the same effect on eight
    // lanes should say one thing, not eight.
    console.warn(`[inserts] "${pluginId}" is not installed. Its slots keep their settings; install the plugin and reload.`);
  }
  const node = ctx.createGain();
  const values = { ...params };
  const inst = {
    input: node,
    output: node,
    getAudioParams: () => new Map<string, AudioParam>(),
    getBaseValue: (id: string) => values[id] ?? 0,
    setBaseValue: (id: string, v: number) => { values[id] = v; },
    applyPreset: () => {},
    dispose: () => { try { node.disconnect(); } catch { /* ok */ } },
  } as FxInstance;
  (inst as unknown as Record<symbol, boolean>)[MISSING] = true;
  return inst;
}

export function isMissingFx(fx: FxInstance): boolean {
  return (fx as unknown as Record<symbol, boolean>)[MISSING] === true;
}

/** Test-only. */
export function __resetMissingFxWarnings(): void { warned.clear(); }
```

- [ ] **Step 4: `rehydrateInsertChain` deja de saltarse el hueco**

```ts
export function rehydrateInsertChain(
  ctx: AudioContext, chain: InsertChain, slots: InsertSlot[],
): void {
  for (const slot of slots) {
    // A slot whose plugin is not installed becomes a marked pass-through rather
    // than nothing. Skipping it desynchronised the chain from the slot list and
    // every later unit rendered its neighbour's data; and it silently dropped a
    // reference the session still carries.
    const inst = createInstance('fx', slot.pluginId, ctx)
      ?? createMissingFx(ctx, slot.pluginId, slot.params);
    applyInsertSlot(slot, inst);
    chain.insert(inst, slot.id);
    if (slot.bypass) chain.setBypass(chain.size() - 1, true);
  }
}
```

Actualiza el comentario de la cabecera de la función, que hoy dice *"silently skipped"*.

- [ ] **Step 5: El rack lo pinta**

En `src/session/lane-insert-ui.ts`, `unitTemplate` deja de devolver `nothing` cuando no encuentra la fábrica:

```ts
  const factory = listPlugins('fx').find((p) => p.manifest.id === slot.pluginId);
  if (!factory) return missingUnitTemplate(h, cs, idx, slot);
```

y añade:

```ts
/** The unit for a slot whose plugin is not installed. Mirrors the lane header's
 *  ⚠ for a missing engine — same contract, same words, so a user meets one idea
 *  and not two. No knobs to draw and nothing to bypass; the × is there because
 *  removing it must stay the user's decision, not ours. */
function missingUnitTemplate(
  h: Rack, cs: ChainSlot, idx: number, slot: InsertSlot,
): TemplateResult {
  const { chain, slots, onChange } = h.deps;
  return html`
    <div class="insert-unit insert-unit-missing"
         title=${`Insert not installed: ${slot.pluginId}. This slot keeps its settings — install the plugin and reload.`}>
      <div class="insert-unit-head"><span class="insert-dot"></span><b class="insert-name">⚠ ${slot.pluginId}</b></div>
      <div class="insert-unit-ctl">
        <span class="insert-missing-note">not installed</span>
        <button class="insert-btn insert-rm" title="Remove insert" @click=${() => {
          chain.remove(idx);
          const at = slots.findIndex((s) => s.id === cs.id);
          if (at >= 0) slots.splice(at, 1);
          onChange();
          h.deps.onDestinationsChanged?.();
          h.rerender();
        }}>×</button>
      </div>
    </div>
  `;
}
```

Añade `.insert-unit-missing` a la hoja de estilos junto a `.insert-unit`, apagada (`opacity: .55`, borde punteado).

- [ ] **Step 6: Lánzalos**

Run: `NO_COLOR=1 npx vitest run src/core/missing-fx.test.ts src/session/`
Expected: PASS

- [ ] **Step 7: La suite y el build**

Run: `npm run test:unit && npm run build`
Expected: verdes.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "feat(inserts): a slot whose plugin is missing keeps its place and its settings

rehydrateInsertChain used to skip it silently, which did two kinds of harm:
the chain ran shorter than the slot list, and a reference the session still
carries vanished from the graph. It now becomes a marked pass-through that
holds the id and the saved params, so the rack draws an off unit and a save
re-writes the settings untouched.

Same contract and the same words as the missing-engine notice already on
main, deliberately: a user should meet one idea, not two. One console warning
per missing id, not one per slot. What it does NOT do is tell 'not installed'
apart from 'failed to load' — neither does the engine notice, and adding the
distinction to only one of them would be two behaviours for one question."
```

### Task 7: El color sale del manifiesto y `FX_COLORS` muere

**Files:**
- Modify: los once `src/plugins/fx/*.ts` (añadir `color` al manifiesto)
- Modify: `src/session/lane-insert-ui.ts:39-47,102`
- Test: `src/session/lane-insert-ui.test.ts`

**Interfaces:**
- Consumes: `PluginManifest.color` (Task 5).
- Produces: nada nuevo.

- [ ] **Step 1: Escribe el test que falla**

```ts
// src/session/lane-insert-ui.test.ts — añadir
import { listPlugins } from '../plugins/registry';
import { bootstrapPlugins } from '../app/plugin-bootstrap';

  it('every insert declares its own colour — no effect falls back to a default', () => {
    bootstrapPlugins();
    const uncoloured = listPlugins('fx').filter((p) => !p.manifest.color);
    expect(uncoloured.map((p) => p.manifest.id)).toEqual([]);
  });
```

- [ ] **Step 2: Lánzalo y comprueba que falla**

Run: `NO_COLOR=1 npx vitest run src/session/lane-insert-ui.test.ts`
Expected: FAIL — los once salen sin color.

- [ ] **Step 3: Cada efecto declara el suyo**

Los seis que la tabla ya conocía conservan su valor exacto; los cinco que caían en el ámbar por defecto reciben uno propio y distinguible:

| id | color |
| --- | --- |
| multifilter | `#ffa726` |
| delay | `#5aa9e6` |
| distortion | `#e6794a` |
| reverb | `#9b6dff` |
| compressor | `#1abc9c` |
| limiter | `#e05a8a` |
| tremolo | `#f6c445` |
| chorus | `#4dd0a7` |
| flanger | `#7fb2ff` |
| phaser | `#b98cff` |
| bitcrusher | `#ff7a5c` |

En cada fichero, dentro de `manifest`:

```ts
    color: '#f6c445',
```

- [ ] **Step 4: El rack lee el manifiesto**

Borra `FX_COLORS` y `FX_FALLBACK` de `lane-insert-ui.ts` y cambia la línea 102:

```ts
  const color = factory.manifest.color ?? 'currentColor';
```

El `?? 'currentColor'` no es un valor por defecto disfrazado: sólo cubre el tipo, que deja `color` opcional porque un manifiesto de motor no lo lleva. El test del paso 1 es lo que garantiza que ningún insert llegue ahí.

- [ ] **Step 5: Lánzalo y comprueba que pasa**

Run: `NO_COLOR=1 npx vitest run src/session/lane-insert-ui.test.ts && npm run test:unit && npm run build`
Expected: PASS y verdes.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(inserts): an effect declares its own colour instead of the rack knowing it

FX_COLORS was a hand-written table in the rack covering six of eleven, with
the other five silently landing on amber — which read as a decision and was an
oversight. The colour is now part of what an effect declares, so a plugin
arrives with its own and the rack knows nothing about any particular id.

The census never counted this table: its keys were unquoted and the pattern
only matches a quoted id. Zero in production was true and still hid a table.
Look at what a number counts before accepting the number."
```

### Task 8: Los buses de envío se siembran después de que carguen los plugins

**Files:**
- Modify: `src/core/fx.ts` (`FxBus`)
- Modify: `src/main.ts` (llamada tras `pluginsReady`)
- Test: `src/core/fx.test.ts`

**Interfaces:**
- Consumes: `pluginsReady` (ya existe en `main.ts`), `createInstance('fx', …)`.
- Produces: `FxBus.seedDefaultInserts(ctx: AudioContext): void` — idempotente, no hace nada si el bus ya tiene inserts.

- [ ] **Step 1: Escribe los tests que fallan**

```ts
// src/core/fx.test.ts — sustituir la expectativa de sembrado del constructor
  it('is born empty: plugins load asynchronously and the bus is built before they do', () => {
    _resetRegistry(); registerPlugin(delayPlugin); registerPlugin(reverbPlugin);
    const ctx = new AudioContext();
    const fx = new FxBus(ctx, ctx.destination);
    expect(fx.getSendBus('A').inserts.size()).toBe(0);
  });

  it('seeds delay on A and reverb on B when asked, after the plugins exist', () => {
    _resetRegistry(); registerPlugin(delayPlugin); registerPlugin(reverbPlugin);
    const ctx = new AudioContext();
    const fx = new FxBus(ctx, ctx.destination);
    fx.seedDefaultInserts(ctx);
    expect(fx.getSendBus('A').inserts.size()).toBe(1);
    expect(fx.getSendBus('B').inserts.size()).toBe(1);
  });

  it('seeding twice does not stack two delays', () => {
    _resetRegistry(); registerPlugin(delayPlugin); registerPlugin(reverbPlugin);
    const ctx = new AudioContext();
    const fx = new FxBus(ctx, ctx.destination);
    fx.seedDefaultInserts(ctx);
    fx.seedDefaultInserts(ctx);
    expect(fx.getSendBus('A').inserts.size()).toBe(1);
  });

  it('survives the plugins being absent: the sends pass dry', () => {
    _resetRegistry();
    const ctx = new AudioContext();
    const fx = new FxBus(ctx, ctx.destination);
    expect(() => fx.seedDefaultInserts(ctx)).not.toThrow();
    expect(fx.getSendBus('A').inserts.size()).toBe(0);
  });
```

- [ ] **Step 2: Lánzalos y comprueba que fallan**

Run: `NO_COLOR=1 npx vitest run src/core/fx.test.ts`
Expected: FAIL — el primero da 1, y `seedDefaultInserts` no existe.

- [ ] **Step 3: Saca la siembra del constructor**

```ts
export class FxBus {
  readonly sends: SendBus[];

  constructor(ctx: AudioContext, output: AudioNode) {
    this.sends = [
      new SendBus(ctx, 'A', 'Send A (Delay)', output),
      new SendBus(ctx, 'B', 'Send B (Reverb)', output),
    ];
  }

  /** Put the default delay on A and reverb on B. Called AFTER loadPlugins
   *  resolves: both are ordinary plugins now, and the graph is built
   *  synchronously long before they arrive. Idempotent, and a no-op for a bus
   *  the session already filled — rehydrateSends runs on load and must win.
   *
   *  If either plugin is not installed, its bus simply stays empty and passes
   *  dry. That is the honest consequence of having made them uninstallable, and
   *  it is not papered over with a substitute. */
  seedDefaultInserts(ctx: AudioContext): void {
    const seed = (id: 'A' | 'B', pluginId: string) => {
      const bus = this.getSendBus(id);
      if (bus.inserts.size() > 0) return;
      const inst = createInstance('fx', pluginId, ctx);
      if (inst) bus.inserts.insert(inst, newInsertId());
    };
    seed('A', 'delay');
    seed('B', 'reverb');
  }
  ...
```

- [ ] **Step 4: Llámalo en el arranque**

En `src/main.ts`, junto a los demás encadenamientos de `pluginsReady`:

```ts
// The send buses are built with the audio graph, synchronously; delay and reverb
// arrive with the plugins, asynchronously. Seed once they exist. A session load
// rehydrates the sends itself and seedDefaultInserts steps aside for it.
void pluginsReady.then(() => { fx.seedDefaultInserts(ctx); });
```

Colócalo **después** de la desestructuración de `audio` que declara `fx` y `ctx`.

- [ ] **Step 5: Lánzalos y comprueba que pasan**

Run: `NO_COLOR=1 npx vitest run src/core/fx.test.ts && npm run test:unit`
Expected: PASS y verde.

- [ ] **Step 6: Míralo en el navegador**

Run: `npm run dev`, abre <http://localhost:5173> en **Chrome real**, sube el envío A de una pista y comprueba que **se oye el delay**. Ésta es la comprobación que ningún test hace: la siembra podría llegar tarde y ningún test lo notaría.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat(sends): seed the send buses once the plugins exist, not before

FxBus seeded delay and reverb in its constructor, synchronously. loadPlugins
is asynchronous, so the moment those two become plugins the buses are born
empty and nobody notices until a send is turned up. The seeding moves behind
pluginsReady — the same hook that fixed Karplus missing from the engine
picker — and steps aside for a session load, which rehydrates the sends
itself.

With either plugin uninstalled its bus stays empty and passes dry. That is
what making them uninstallable means, and it is not hidden behind a
substitute."
```

---

## Fase 3 — los ayudantes compartidos suben al SDK

### Task 9: `modulated-delay` gana un test y sube; `reverb-ir` sube con su respuesta comparada

**Files:**
- Create: `packages/loom-plugin-sdk/src/dsp/modulated-delay.ts` (movido)
- Create: `packages/loom-plugin-sdk/src/dsp/modulated-delay.test.ts` (nuevo)
- Create: `packages/loom-plugin-sdk/src/dsp/reverb-ir.ts` (movido) y su `.test.ts` (movido)
- Delete: `src/plugins/fx/modulated-delay.ts`, `src/plugins/fx/reverb-ir.ts`, `src/plugins/fx/reverb-ir.test.ts`
- Modify: `packages/loom-plugin-sdk/src/index.ts`, `src/plugins/fx/chorus.ts`, `flanger.ts`, `reverb.ts`

**Interfaces:**
- Consumes: nada nuevo.
- Produces: los dos módulos exportados desde `@loom/plugin-sdk`. Las tareas 12 (chorus/flanger) y 14 (reverb) dependen de ello.

- [ ] **Step 1: Congela la respuesta de la reverb ANTES de mover nada**

```bash
NO_COLOR=1 npx vitest run src/plugins/fx/reverb-ir.test.ts
```

Escribe un test que capture la envolvente del impulso generado en unos pocos puntos y guárdalo como referencia — **antes** de la primera línea de cambio. Una referencia tomada después congela el bug.

```ts
// src/plugins/fx/reverb-ir.test.ts — añadir antes de mover
  it('impulse envelope is stable across the move to the SDK', () => {
    const ctx = new OfflineAudioContext(2, 44100, 44100);
    const ir = buildImpulseResponse(ctx as unknown as BaseAudioContext, 2.0, 2.0);
    const d = ir.getChannelData(0);
    const at = (s: number) => Math.abs(d[Math.floor(s * 44100)]);
    // Relative: each checkpoint must be a fraction of the one before it, which
    // is what "a decaying tail" means. No absolute amplitudes.
    expect(at(0.5)).toBeLessThan(at(0.05));
    expect(at(1.5)).toBeLessThan(at(0.5));
    expect(at(0.05)).toBeGreaterThan(0);
  });
```

- [ ] **Step 2: Escribe el test que le falta a `modulated-delay`**

```ts
// packages/loom-plugin-sdk/src/dsp/modulated-delay.test.ts
import { describe, it, expect } from 'vitest';
import { createModulatedDelay } from './modulated-delay';

describe('modulated delay', () => {
  it('moves the delay time under its LFO instead of sitting still', async () => {
    const ctx = new OfflineAudioContext(2, 44100, 44100);
    const md = createModulatedDelay(ctx as unknown as AudioContext, { rate: 4, depth: 0.004, base: 0.008 });
    const src = ctx.createOscillator();
    src.frequency.value = 440;
    src.connect(md.input);
    md.output.connect(ctx.destination);
    src.start();
    const buf = await ctx.startRendering();
    const half = buf.length / 2;
    const rms = (from: number, to: number) => {
      const d = buf.getChannelData(0);
      let s = 0; for (let i = from; i < to; i++) s += d[i] * d[i];
      return Math.sqrt(s / (to - from));
    };
    // Relative: the two halves of a swept comb differ. A static delay would make
    // them equal.
    expect(Math.abs(rms(0, half) - rms(half, buf.length))).toBeGreaterThan(rms(0, half) * 0.01);
  });
});
```

Ajusta el nombre y la firma a lo que `modulated-delay.ts` exporte de verdad — léelo antes de escribir el test.

- [ ] **Step 3: Lánzalos y comprueba que pasan en su sitio actual**

Run: `NO_COLOR=1 npx vitest run src/plugins/fx/reverb-ir.test.ts packages/loom-plugin-sdk/src/dsp/modulated-delay.test.ts`
Expected: PASS. Los dos capturan la conducta de HOY.

- [ ] **Step 4: Mueve los dos ficheros**

```bash
git mv src/plugins/fx/modulated-delay.ts packages/loom-plugin-sdk/src/dsp/modulated-delay.ts
git mv src/plugins/fx/reverb-ir.ts packages/loom-plugin-sdk/src/dsp/reverb-ir.ts
git mv src/plugins/fx/reverb-ir.test.ts packages/loom-plugin-sdk/src/dsp/reverb-ir.test.ts
```

En `packages/loom-plugin-sdk/src/index.ts`, bajo un comentario que marque la asimetría:

```ts
// Web Audio GRAPH helpers, not per-sample kernels. Everything above this line
// runs inside the worklet with no AudioContext; these two build native nodes for
// an insert. Same folder, different kind of thing — say so rather than let an
// author discover it by importing one into a renderer.
export * from './dsp/modulated-delay';
export * from './dsp/reverb-ir';
```

Y en `chorus.ts`, `flanger.ts` y `reverb.ts`, cambia el import a `@loom/plugin-sdk`.

- [ ] **Step 5: Lánzalo todo**

Run: `NO_COLOR=1 npx vitest run packages/ src/plugins/fx/ && npm run test:unit && npm run build`
Expected: verdes. Los dos tests movidos siguen pasando: es la prueba de que la respuesta de la reverb no ha cambiado.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "refactor(sdk): the two graph helpers an insert shares move to the SDK

modulated-delay (chorus + flanger) and reverb-ir (reverb) are generic
primitives rather than any one effect's identity, so they go where a
third-party insert can compile against them.

modulated-delay had no test of its own. It gets one BEFORE the move: shipping
it naked would make it public API without cover, which is the rule phase 2
applied to unison and fold. reverb-ir's impulse envelope is pinned first too —
if its render drifts the reverb sounds different and no 'the node exists' test
would catch it.

The index says out loud that these two are not the same kind of thing as the
per-sample kernels above them: they build native nodes."
```

---

## Fase 4 — los once salen, de uno en uno

### El procedimiento

**Vive en su propio fichero**, [2026-08-03-inserts-procedure.md](2026-08-03-inserts-procedure.md), porque lo comparten las siete tareas de esta fase y se escribe una vez. Cada tarea empieza leyéndolo.

### Orden

| # | id(s) | por qué ahí |
| --- | --- | --- |
| 10 | `limiter` | el más pequeño (41 líneas) y con test: estrena el procedimiento |
| 11 | `compressor`, `distortion` | `distortion` **no tiene test**: se le escribe uno primero |
| 12 | `tremolo`, `bitcrusher` | ambos con test; `tremolo` es el único con `setBpm` |
| 13 | `phaser`, `multifilter` | `multifilter` tiene `.dsp.test.ts`, que renderiza |
| 14 | `chorus`, `flanger` | juntos: comparten `modulated-delay`, ya en el SDK (Task 9) |
| 15 | `delay` | siembra el envío A: su verde incluye la comprobación de §5.5 |
| 16 | `reverb` | siembra el envío B, y arrastra `reverb-ir` (ya en el SDK) |

### Task 10: `limiter` estrena el procedimiento

**Files:**
- Create: `plugins/limiter/plugin.json`, `plugins/limiter/main.ts`, `plugins/limiter/limiter.test.ts`
- Delete: `src/plugins/fx/limiter.ts`, `src/plugins/fx/limiter.test.ts`

**Interfaces:**
- Consumes: `Loom.registerFx` (Task 5), `FxInstance` del SDK (Task 4).
- Produces: el patrón `plugins/<id>/` que las tareas 11–16 repiten.

- [ ] **Step 1: Comprueba que su test pasa hoy**

Run: `NO_COLOR=1 npx vitest run src/plugins/fx/limiter.test.ts`
Expected: PASS.

- [ ] **Step 2: Escribe la carpeta**

`plugins/limiter/plugin.json`:

```json
{
  "id": "limiter",
  "name": "Limiter",
  "version": "1.0.0",
  "loomApi": 1,
  "author": "Loom",
  "main": "main.js",
  "components": [
    {
      "kind": "fx",
      "id": "limiter",
      "name": "Limiter",
      "params": [
        { "id": "ceiling", "label": "Ceil", "kind": "continuous", "min": -30, "max": 0, "default": -1, "unit": "dB" },
        { "id": "release", "label": "Rel", "kind": "continuous", "min": 0.001, "max": 0.5, "default": 0.05, "unit": "s" }
      ],
      "fx": { "color": "#e05a8a" }
    }
  ]
}
```

`plugins/limiter/main.ts`:

```ts
// plugins/limiter/main.ts — the factory, and nothing else. The description lives
// in plugin.json, which the host reads, validates and obeys.
import type { FxInstance } from '@loom/plugin-sdk';

Loom.registerFx('limiter', (ctx): FxInstance => {
  const input  = ctx.createGain();
  const comp   = ctx.createDynamicsCompressor();
  const output = ctx.createGain();
  comp.threshold.value = -1;   // ceiling
  comp.ratio.value     = 20;   // brickwall
  comp.knee.value      = 0;
  comp.attack.value    = 0.001;
  comp.release.value   = 0.05;
  input.connect(comp).connect(output);

  const params = new Map<string, AudioParam>([
    ['ceiling', comp.threshold],
    ['release', comp.release],
  ]);

  return {
    input, output,
    getAudioParams: () => params,
    getBaseValue: (id) => params.get(id)?.value ?? 0,
    setBaseValue: (id, v) => { const p = params.get(id); if (p) p.value = v; },
    applyPreset: () => {},
    dispose: () => { try { input.disconnect(); comp.disconnect(); output.disconnect(); } catch { /* ok */ } },
  };
});
```

- [ ] **Step 3: Mueve el test y hazlo construir por la fábrica**

`plugins/limiter/limiter.test.ts` — cabecera nueva, cuerpo el de siempre:

```ts
// The plugin's own test, run against the plugin as the host runs it: a two-line
// Loom double captures the factory, which is all main.ts needs from the ABI.
import { describe, it, expect, beforeAll } from 'vitest';
import type { FxInstance } from '@loom/plugin-sdk';

let create: (ctx: AudioContext) => FxInstance;
beforeAll(async () => {
  (globalThis as unknown as { Loom: unknown }).Loom = {
    registerFx: (_id: string, c: (ctx: AudioContext) => FxInstance) => { create = c; },
  };
  await import('./main');
});

// …las mismas aserciones que tenía src/plugins/fx/limiter.test.ts, cambiando
// `limiterPlugin.create(ctx)` por `create(ctx)`…
```

- [ ] **Step 4: Borra el original**

```bash
git rm src/plugins/fx/limiter.ts src/plugins/fx/limiter.test.ts
```

- [ ] **Step 5: Verde**

Run: `NO_COLOR=1 npx vitest run plugins/limiter/ && npm run test:unit && npm run build`
Expected: verdes. El `build` construye `plugins/limiter` y lo mete en `index.json`.

- [ ] **Step 6: Míralo**

Run: `npm run dev`, abre Chrome real, mete un Limiter en una pista y comprueba que **sale en el desplegable con su color** y que suena.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat(plugins): the limiter leaves the tree

The first insert to become a folder. Its plugin.json carries the params
verbatim and the colour it declared last commit; its main.ts carries the
factory and nothing else, because the description is data and the host
already has it.

Its test moves with it and builds through the factory, using the same
two-line Loom double the Karplus parity test uses for registerRenderer —
which is what proves a plugin needs nothing from the host but the ABI."
```

### Task 11: `compressor` y `distortion`

**Files:**
- Create: `plugins/compressor/{plugin.json,main.ts,compressor.test.ts}`, `plugins/distortion/{plugin.json,main.ts,distortion.test.ts}`
- Delete: `src/plugins/fx/compressor.ts`, `src/plugins/fx/compressor.test.ts`, `src/plugins/fx/distortion.ts`

**Interfaces:** consume `Loom.registerFx` y `FxInstance` del SDK. No produce nada nuevo.

- [ ] **Step 1: Lee el procedimiento**

Lee [2026-08-03-inserts-procedure.md](2026-08-03-inserts-procedure.md) entero. Es tu guion; aquí sólo están las particularidades.

- [ ] **Step 2: `distortion` no tiene test — escríbele uno ANTES de moverlo**

Es el paso 1 del procedimiento, y en este efecto no es opcional. En `src/plugins/fx/distortion.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { distortionPlugin } from './distortion';

describe('distortion', () => {
  it('adds harmonic energy that the dry signal does not have', async () => {
    const render = async (through: boolean) => {
      const ctx = new OfflineAudioContext(1, 16384, 44100);
      const osc = ctx.createOscillator();
      osc.frequency.value = 220;
      if (through) {
        const fx = distortionPlugin.create(ctx as unknown as AudioContext);
        fx.setBaseValue('drive', 0.9);
        osc.connect(fx.input); fx.output.connect(ctx.destination);
      } else {
        osc.connect(ctx.destination);
      }
      osc.start();
      const d = (await ctx.startRendering()).getChannelData(0);
      // Crest factor stands in for harmonic content: clipping flattens the peaks
      // relative to the RMS, so the ratio drops. Relative to the dry render, not
      // to any absolute figure.
      let sum = 0, peak = 0;
      for (const v of d) { sum += v * v; peak = Math.max(peak, Math.abs(v)); }
      return peak / Math.sqrt(sum / d.length);
    };
    expect(await render(true)).toBeLessThan(await render(false));
  });
});
```

Ajusta el id del mando (`drive`) al que declare de verdad `src/plugins/fx/distortion.ts` — léelo antes.

- [ ] **Step 3: Lánzalo y comprueba que pasa donde está**

Run: `NO_COLOR=1 npx vitest run src/plugins/fx/distortion.test.ts`
Expected: PASS. Captura la conducta de HOY.

- [ ] **Step 4: Aplica el procedimiento a los dos**

Colores: `compressor` `#1abc9c`, `distortion` `#e6794a`.

- [ ] **Step 5: Verde, mirada y commit** — pasos 6 del procedimiento, un commit por efecto.

### Task 12: `tremolo` y `bitcrusher`

**Files:**
- Create: `plugins/tremolo/{plugin.json,main.ts,tremolo.test.ts}`, `plugins/bitcrusher/{plugin.json,main.ts,bitcrusher.test.ts}`
- Delete: sus cuatro ficheros en `src/plugins/fx/`

**Interfaces:** consume `Loom.registerFx`, `FxInstance`. No produce nada nuevo.

- [ ] **Step 1: Lee el procedimiento**

[2026-08-03-inserts-procedure.md](2026-08-03-inserts-procedure.md).

- [ ] **Step 2: `tremolo` es el ÚNICO insert con `setBpm`**

Su `FxInstance` devuelve `setBpm`, y `InsertChain.setBpm` lo llama para todos los huecos. Es lo único que este efecto tiene y ningún otro, así que es lo único que la mudanza puede romper en silencio. Su test tiene que cubrirlo — si el que ya existe no lo hace, añádelo:

```ts
  it('follows the tempo when synced, and ignores it when free', () => {
    const ctx = new AudioContext();
    const fx = create(ctx);
    fx.setBaseValue('sync', 1);        // 1/4
    fx.setBpm(120);
    const at120 = fx.getBaseValue('rate');
    fx.setBpm(240);
    // Relative: twice the tempo, twice the effective rate.
    expect(fx.getBaseValue('rate')).toBeGreaterThan(at120 * 1.9);

    fx.setBaseValue('sync', 0);        // free
    fx.setBaseValue('rate', 5);
    fx.setBpm(60);
    expect(fx.getBaseValue('rate')).toBe(5);
  });
```

Sus tablas de módulo `SYNC_BEATS` y `SHAPES` se mudan con él.

- [ ] **Step 3: Aplica el procedimiento a los dos**

Nombres de pantalla: `tremolo` se llama **Trem/Gate**, no "Tremolo". Colores: `tremolo` `#f6c445`, `bitcrusher` `#ff7a5c`.

- [ ] **Step 4: Verde, mirada y commit** — un commit por efecto.

### Task 13: `phaser` y `multifilter`

**Files:**
- Create: `plugins/phaser/{plugin.json,main.ts,phaser.test.ts}`, `plugins/multifilter/{plugin.json,main.ts,multifilter.dsp.test.ts}`
- Delete: sus ficheros en `src/plugins/fx/`

**Interfaces:** consume `Loom.registerFx`, `FxInstance`. No produce nada nuevo.

- [ ] **Step 1: Lee el procedimiento**

[2026-08-03-inserts-procedure.md](2026-08-03-inserts-procedure.md).

- [ ] **Step 2: El test de `multifilter` renderiza — conserva la extensión**

`src/plugins/fx/multifilter.dsp.test.ts` va a `plugins/multifilter/multifilter.dsp.test.ts`, **con `.dsp` incluido**: renderiza por `OfflineAudioContext` y la suite lo separa por eso (`npm run test:dsp`). Renombrarlo a `.test.ts` lo sacaría de ese grupo sin que nada avise.

- [ ] **Step 3: Aplica el procedimiento a los dos**

Colores: `phaser` `#b98cff`, `multifilter` `#ffa726`.

- [ ] **Step 4: Verde, mirada y commit** — un commit por efecto.

### Task 14: `chorus` y `flanger`, juntos

**Files:**
- Create: `plugins/chorus/{plugin.json,main.ts,chorus.test.ts}`, `plugins/flanger/{plugin.json,main.ts,flanger.test.ts}`
- Delete: `src/plugins/fx/chorus.ts`, `chorus.test.ts`, `flanger.ts`

**Interfaces:** consume `Loom.registerFx`, `FxInstance` y `modulated-delay`, que la tarea 9 dejó en `@loom/plugin-sdk`.

- [ ] **Step 1: Lee el procedimiento**

[2026-08-03-inserts-procedure.md](2026-08-03-inserts-procedure.md).

- [ ] **Step 2: Van juntos porque comparten el ayudante**

Los dos son de 13 líneas: casi todo su cuerpo vive en `modulated-delay`, que ya está en el SDK. Sus `main.ts` importan de `@loom/plugin-sdk`, **nunca** de una ruta relativa al árbol del host — un plugin que alcanza `src/` no es drop-in, y el empaquetador lo rechaza por diseño.

- [ ] **Step 3: `flanger` no tiene test propio**

Escríbele uno antes de moverlo (paso 1 del procedimiento): un flanger con realimentación produce un peine cuyas crestas se mueven, así que su salida difiere entre la primera y la segunda mitad del render. Relativo, como el de `modulated-delay` de la tarea 9.

- [ ] **Step 4: Aplica el procedimiento a los dos**

Colores: `chorus` `#4dd0a7`, `flanger` `#7fb2ff`.

- [ ] **Step 5: Verde, mirada y commit** — un commit por efecto.

### Task 15: `delay`

**Files:**
- Create: `plugins/delay/{plugin.json,main.ts,delay.test.ts}`
- Delete: `src/plugins/fx/delay.ts`, `src/plugins/fx/delay.test.ts`

**Interfaces:** consume `Loom.registerFx`, `FxInstance`, y `FxBus.seedDefaultInserts` (Task 8), que lo busca por id.

- [ ] **Step 1: Lee el procedimiento**

[2026-08-03-inserts-procedure.md](2026-08-03-inserts-procedure.md).

- [ ] **Step 2: Aplica el procedimiento**

Color `#5aa9e6`. Sus `StereoPanner` de ping-pong se mudan con él.

- [ ] **Step 3: Comprueba la aceptación §5.5 — el envío A**

`delay` no es un insert cualquiera: `FxBus.seedDefaultInserts` lo busca por id para sembrar el envío A. Tras mudarlo:

```bash
npm run build
npm run dev
```

En Chrome real, sube el envío A de una pista: **tiene que oírse el delay**. Después:

```bash
mv dist/plugins/delay /tmp/delay-away
npm run preview
```

Recarga: la sesión suena **en seco**, sin un solo error de consola. Repón la carpeta.

- [ ] **Step 4: Commit**

### Task 16: `reverb`

**Files:**
- Create: `plugins/reverb/{plugin.json,main.ts,reverb.test.ts}`
- Delete: `src/plugins/fx/reverb.ts`

**Interfaces:** consume `Loom.registerFx`, `FxInstance`, `reverb-ir` desde `@loom/plugin-sdk` (Task 9), y `FxBus.seedDefaultInserts` (Task 8).

- [ ] **Step 1: Lee el procedimiento**

[2026-08-03-inserts-procedure.md](2026-08-03-inserts-procedure.md).

- [ ] **Step 2: Aplica el procedimiento**

Color `#9b6dff`. `main.ts` importa el generador de impulso de `@loom/plugin-sdk`.

- [ ] **Step 3: Compara su cola contra la referencia congelada en la tarea 9**

`packages/loom-plugin-sdk/src/dsp/reverb-ir.test.ts` fija la envolvente del impulso. Lánzalo:

Run: `NO_COLOR=1 npx vitest run packages/loom-plugin-sdk/src/dsp/reverb-ir.test.ts`
Expected: PASS. Si falla, **la reverb suena distinta** y ningún test de "existe el nodo" lo habría notado.

- [ ] **Step 4: Comprueba la aceptación §5.5 — el envío B**

Igual que la tarea 15, con el envío B y `dist/plugins/reverb`.

- [ ] **Step 5: Commit**

Tras esta tarea, `src/plugins/fx/` debe contener **sólo** `insert-chain.ts`. Compruébalo:

```bash
ls src/plugins/fx/
```

---

## Fase 5 — los cuatro nuevos

### Task 17: El seguidor de nivel, en el SDK, medido

El primitivo que comparten el auto-wah y la puerta. **Es el trozo con más historia de fallos de este repo**: un detector de nivel con un filtro por debajo de 1 Hz invertía y amplificaba el canal en vez de suavizarlo (el bug del sidechain).

**Files:**
- Create: `packages/loom-plugin-sdk/src/dsp/envelope-follower.ts`, `.test.ts`
- Modify: `packages/loom-plugin-sdk/src/index.ts`

**Interfaces:**
- Produces:
  ```ts
  export interface EnvelopeFollowerOptions { attackMs: number; releaseMs: number; }
  export interface EnvelopeFollower {
    /** Feed the signal to be measured here. */
    readonly input: AudioNode;
    /** A control signal in 0..1, to be connected to an AudioParam or a gain. */
    readonly output: AudioNode;
    setAttack(ms: number): void;
    setRelease(ms: number): void;
    dispose(): void;
  }
  export function createEnvelopeFollower(ctx: AudioContext, opts: EnvelopeFollowerOptions): EnvelopeFollower;
  /** The floor the smoothing filter is clamped to, in Hz. Public so a test can
   *  assert the clamp rather than restate the number. */
  export const FOLLOWER_MIN_HZ = 2;
  ```

- [ ] **Step 1: Escribe los tests que fallan**

```ts
// packages/loom-plugin-sdk/src/dsp/envelope-follower.test.ts
import { describe, it, expect } from 'vitest';
import { createEnvelopeFollower, FOLLOWER_MIN_HZ } from './envelope-follower';

const render = async (offsetLevel: number, attackMs: number, releaseMs: number) => {
  const ctx = new OfflineAudioContext(1, 44100, 44100);
  const src = ctx.createOscillator();
  src.frequency.value = 200;
  const amp = ctx.createGain();
  amp.gain.value = offsetLevel;
  const f = createEnvelopeFollower(ctx as unknown as AudioContext, { attackMs, releaseMs });
  src.connect(amp).connect(f.input);
  f.output.connect(ctx.destination);
  src.start();
  return (await ctx.startRendering()).getChannelData(0);
};

describe('envelope follower', () => {
  it('tracks a louder signal with a larger control value', async () => {
    const quiet = await render(0.1, 10, 100);
    const loud  = await render(0.8, 10, 100);
    const tail = (d: Float32Array) => d[d.length - 1];
    // Relative: louder in, larger control out. No absolute figure.
    expect(tail(loud)).toBeGreaterThan(tail(quiet) * 2);
  });

  it('never inverts: the control signal stays non-negative across its whole range', async () => {
    // The sidechain bug in one assertion. A sub-Hz smoothing biquad phase-
    // inverted and AMPLIFIED instead of smoothing; a follower that can go
    // negative multiplies audio by a negative number and flips it.
    for (const attack of [0.5, 10, 200]) {
      const d = await render(0.8, attack, 500);
      expect(Math.min(...d)).toBeGreaterThanOrEqual(0);
    }
  });

  it('never amplifies: the control signal stays within unity for a unity input', async () => {
    const d = await render(1.0, 10, 100);
    expect(Math.max(...d)).toBeLessThanOrEqual(1.0001);
  });

  it('clamps its smoothing above the danger zone', async () => {
    const ctx = new OfflineAudioContext(1, 1024, 44100);
    const f = createEnvelopeFollower(ctx as unknown as AudioContext, { attackMs: 100000, releaseMs: 100000 });
    // A 100-second time constant asks for a sub-milliHertz cutoff. It must be
    // refused, not honoured — that is the bug this constant exists to prevent.
    expect((f as unknown as { smoothingHz(): number }).smoothingHz()).toBeGreaterThanOrEqual(FOLLOWER_MIN_HZ);
    f.dispose();
  });
});
```

- [ ] **Step 2: Lánzalos y comprueba que fallan**

Run: `NO_COLOR=1 npx vitest run packages/loom-plugin-sdk/src/dsp/envelope-follower.test.ts`
Expected: FAIL — el módulo no existe.

- [ ] **Step 3: Impleméntalo**

Cadena: rectificación por `WaveShaper` con una curva de valor absoluto → `BiquadFilter` paso bajo cuya frecuencia sale del tiempo de ataque/caída, **acotada por abajo a `FOLLOWER_MIN_HZ`** → una ganancia de escala. Documenta la cota en el fichero, citando el bug del sidechain, para que nadie la baje "para tener más suavizado".

- [ ] **Step 4: Verde y export**

Run: `NO_COLOR=1 npx vitest run packages/ && npm run test:unit && npm run build`
Añade `export * from './dsp/envelope-follower';` al `index.ts`, bajo el comentario de ayudantes de grafo.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(sdk): an envelope follower, with the sidechain bug written into its tests

The primitive the auto-wah and the gate both need, published once so two
independent plugins depend on the same thing — which is what tells a real
shared SDK from a drawer.

Its smoothing is clamped above 2 Hz and a test asserts the clamp holds even
when asked for a 100-second time constant. This repo already shipped a level
detector whose sub-Hz biquad phase-inverted and AMPLIFIED the channel instead
of smoothing it. Two of the four tests exist only to make that failure mode
impossible to reintroduce quietly: the control signal never goes negative and
never exceeds unity."
```

Los cuatro son carpetas nuevas en `plugins/`, con la misma forma que las de la fase 4 — pasos **2, 3, 4 y 6** de [2026-08-03-inserts-procedure.md](2026-08-03-inserts-procedure.md), sin el paso 1 (no hay conducta previa que congelar) ni el 5 (no hay original que borrar). **Ninguno añade un `AudioWorkletProcessor`.** Cada test mide una diferencia **relativa** contra la señal seca.

### Task 18: `ringmod`, el plugin de ejemplo mínimo

**Files:**
- Create: `plugins/ringmod/{plugin.json,main.ts,ringmod.test.ts}`

**Interfaces:** consume `Loom.registerFx` y `FxInstance` del SDK. Produce el patrón de "insert nuevo" que las tareas 19–21 repiten.

- [ ] **Step 1: Escribe el test que falla**

```ts
// plugins/ringmod/ringmod.test.ts
import { describe, it, expect, beforeAll } from 'vitest';
import type { FxInstance } from '@loom/plugin-sdk';

let create: (ctx: AudioContext) => FxInstance;
beforeAll(async () => {
  (globalThis as unknown as { Loom: unknown }).Loom = {
    registerFx: (_id: string, c: (ctx: AudioContext) => FxInstance) => { create = c; },
  };
  await import('./main');
});

describe('ring modulator', () => {
  it('moves energy away from the carrier frequency', async () => {
    const ctx = new OfflineAudioContext(1, 16384, 44100);
    const osc = ctx.createOscillator();
    osc.frequency.value = 440;
    const fx = create(ctx as unknown as AudioContext);
    fx.setBaseValue('freq', 300);
    fx.setBaseValue('mix', 1);
    const an = ctx.createAnalyser();
    an.fftSize = 2048;
    osc.connect(fx.input); fx.output.connect(an); an.connect(ctx.destination);
    osc.start();
    const out = (await ctx.startRendering()).getChannelData(0);

    // A ring modulator multiplies, so the 440 Hz tone becomes 140 and 740 and
    // the original is gone. Measured by correlating the output against the
    // carrier: a signal that still contained 440 would correlate strongly.
    let corr = 0, energy = 0;
    for (let i = 0; i < out.length; i++) {
      corr += out[i] * Math.sin(2 * Math.PI * 440 * i / 44100);
      energy += out[i] * out[i];
    }
    // Relative: the carrier's share of the output is a small fraction of its
    // total energy. No absolute amplitude anywhere.
    expect(Math.abs(corr) / out.length).toBeLessThan(Math.sqrt(energy / out.length) * 0.1);
  });

  it('mix at 0 leaves the signal alone', async () => {
    const ctx = new OfflineAudioContext(1, 4096, 44100);
    const src = ctx.createConstantSource();
    src.offset.value = 0.5;
    const fx = create(ctx as unknown as AudioContext);
    fx.setBaseValue('mix', 0);
    src.connect(fx.input); fx.output.connect(ctx.destination);
    src.start();
    const d = (await ctx.startRendering()).getChannelData(0).slice(2048);
    expect(Math.min(...d)).toBeGreaterThan(0.5 * 0.99);
  });
});
```

- [ ] **Step 2: Lánzalo y comprueba que falla**

Run: `NO_COLOR=1 npx vitest run plugins/ringmod/`
Expected: FAIL — `./main` no existe.

- [ ] **Step 3: Escribe la carpeta**

`plugin.json` con `fx.color: "#c2b280"` y dos params: `freq` (continuo, 20–4000 Hz, por defecto 300, `curve: "log"`) y `mix` (continuo, 0–1, por defecto 1).

`main.ts` — **el comentario de cabecera más cuidado del lote**: es el plugin con el que se documenta el SDK, y son dos nodos.

```ts
// plugins/ringmod/main.ts — a ring modulator, and the smallest complete example
// of a Loom insert.
//
// Everything an insert must do is here and nothing else is: plugin.json says
// what it is called and what knobs it has, this file says how to build its
// nodes, and the two meet through Loom.registerFx. There is no manifest in this
// file — the host already read and validated the one on disk.
//
// The DSP is a multiplication: an oscillator drives a GainNode's gain, so the
// audio through that gain comes out multiplied by the oscillator. That is all a
// ring modulator is.
import type { FxInstance } from '@loom/plugin-sdk';

Loom.registerFx('ringmod', (ctx): FxInstance => {
  …
});
```

El `mix` se hace con dos ganancias en paralelo (seca y procesada) sumando en la salida.

- [ ] **Step 4: Lánzalo, míralo y commitea**

Run: `NO_COLOR=1 npx vitest run plugins/ringmod/ && npm run test:unit && npm run build`
Después `npm run dev`, y **en Chrome real**: mételo en una pista con un bajo y barre `freq` — tiene que sonar metálico e inarmónico.

### Task 19: `autowah`

**Files:**
- Create: `plugins/autowah/{plugin.json,main.ts,autowah.test.ts}`

**Interfaces:** consume `createEnvelopeFollower` de `@loom/plugin-sdk` (Task 17), `Loom.registerFx`, `FxInstance`.

- [ ] **Step 1: Escribe el test que falla**

Afirma lo que define a un auto-wah: **el filtro se abre más con una señal más fuerte**.

```ts
// plugins/autowah/autowah.test.ts — mismo preámbulo de Loom double que ringmod
  it('opens the filter further for a louder input', async () => {
    const brightness = async (level: number) => {
      const ctx = new OfflineAudioContext(1, 44100, 44100);
      const osc = ctx.createOscillator();
      osc.type = 'sawtooth';
      osc.frequency.value = 110;
      const amp = ctx.createGain();
      amp.gain.value = level;
      const fx = create(ctx as unknown as AudioContext);
      fx.setBaseValue('sens', 1);
      osc.connect(amp).connect(fx.input); fx.output.connect(ctx.destination);
      osc.start();
      const d = (await ctx.startRendering()).getChannelData(0);
      // Zero crossings stand in for brightness: a filter opened further passes
      // more high harmonics, which cross zero more often. Normalised by level so
      // the two renders are comparable.
      let cross = 0;
      for (let i = 1; i < d.length; i++) if ((d[i - 1] < 0) !== (d[i] < 0)) cross++;
      return cross;
    };
    expect(await brightness(0.9)).toBeGreaterThan(await brightness(0.05));
  });
```

- [ ] **Step 2: Lánzalo y comprueba que falla**

- [ ] **Step 3: Escribe la carpeta**

`fx.color: "#8bc34a"`. Mandos: `sens`, `range`, `attack`, `release`, `q`, `mix`.

⚠️ **El seguidor conduce `filter.detune`, en centésimas de tono, NO `filter.frequency` en hercios.** Un control sumado en hercios sobre un filtro grave es inaudible; en centésimas barre exponencialmente, que es como se oye la afinación. Es la regla que la modulación de filtros ya sigue en este proyecto. Escríbelo como comentario en el fichero, o alguien lo "simplificará" a hercios.

`range` se declara **en centésimas** (por ejemplo 0–4800, cuatro octavas), no en hercios.

- [ ] **Step 4: Lánzalo, míralo y commitea** — en Chrome real, sobre un bajo con notas de distinta fuerza.

### Task 20: `gate`

**Files:**
- Create: `plugins/gate/{plugin.json,main.ts,gate.test.ts}`

**Interfaces:** consume `createEnvelopeFollower` de `@loom/plugin-sdk` (Task 17), `Loom.registerFx`, `FxInstance`.

- [ ] **Step 1: Escribe el test que falla**

```ts
  it('passes a signal above the threshold and closes on one below it', async () => {
    const through = async (level: number) => {
      const ctx = new OfflineAudioContext(1, 44100, 44100);
      const src = ctx.createOscillator();
      src.frequency.value = 200;
      const amp = ctx.createGain();
      amp.gain.value = level;
      const fx = create(ctx as unknown as AudioContext);
      fx.setBaseValue('threshold', -24);
      src.connect(amp).connect(fx.input); fx.output.connect(ctx.destination);
      src.start();
      const d = (await ctx.startRendering()).getChannelData(0).slice(22050);
      let s = 0; for (const v of d) s += v * v;
      return Math.sqrt(s / d.length) / level;   // normalised: what fraction got through
    };
    // Relative: the loud signal keeps far more of itself than the quiet one.
    expect(await through(0.8)).toBeGreaterThan(await through(0.01) * 5);
  });
```

- [ ] **Step 2: Lánzalo y comprueba que falla**

- [ ] **Step 3: Escribe la carpeta**

`fx.color: "#ef5350"`. Mandos: `threshold` (dB), `attack`, `hold`, `release`, `range` (dB — cuánto se cierra; `range: 0` significa cierre total).

- [ ] **Step 4: Lánzalo, míralo y commitea** — en Chrome real, sobre una caja o un bombo: es donde se nota.

### Task 21: `width`

**Files:**
- Create: `plugins/width/{plugin.json,main.ts,width.test.ts}`

**Interfaces:** consume `Loom.registerFx`, `FxInstance`.

- [ ] **Step 1: Escribe el test que falla**

Es el único insert del lote que maneja **dos canales**, así que su test afirma exactamente eso: los canales difieren después y no antes.

```ts
  it('makes the two channels differ, which is the only thing widening means', async () => {
    const ctx = new OfflineAudioContext(2, 44100, 44100);
    const osc = ctx.createOscillator();       // mono source: both channels identical
    osc.frequency.value = 220;
    const fx = create(ctx as unknown as AudioContext);
    fx.setBaseValue('width', 1);
    fx.setBaseValue('depth', 1);
    fx.setBaseValue('rate', 2);
    osc.connect(fx.input); fx.output.connect(ctx.destination);
    osc.start();
    const buf = await ctx.startRendering();
    const L = buf.getChannelData(0), R = buf.getChannelData(1);
    let diff = 0, energy = 0;
    for (let i = 0; i < L.length; i++) { diff += (L[i] - R[i]) ** 2; energy += L[i] * L[i]; }
    // Relative: the side signal is a real fraction of the mid, not numerical
    // dust. A pass-through would leave diff at zero.
    expect(Math.sqrt(diff / L.length)).toBeGreaterThan(Math.sqrt(energy / L.length) * 0.05);
  });

  it('width 0 and depth 0 leave a mono source mono', async () => {
    // The negative control. Without it the first test passes for an effect that
    // is broken in a way that happens to decorrelate the channels.
    …mismo montaje, width 0 y depth 0, y afirma que diff es despreciable frente a energy…
  });
```

- [ ] **Step 2: Lánzalo y comprueba que falla**

- [ ] **Step 3: Escribe la carpeta**

`fx.color: "#26c6da"`. Mandos: `width` (medio/lados), `rate`, `depth` (el paseo izquierda-derecha), `sync` (discreto, como el del `tremolo`).

La anchura se hace con `ChannelSplitter` → suma y diferencia por ganancias → escala del lado → `ChannelMerger`. El paseo, con un oscilador sobre un `StereoPanner`.

- [ ] **Step 4: Lánzalo, míralo y commitea** — en Chrome real, con auriculares: es un efecto que no se juzga por altavoces de portátil.

---

## Fase 6 — demolición

### Task 22: `src/plugins/fx/` desaparece

**Files:**
- Move: `src/plugins/fx/insert-chain.ts` → `src/core/insert-chain.ts` (y su test)
- Modify: los importadores de `insert-chain`
- Delete: `src/plugins/fx/` (vacío)

- [ ] **Step 1: Mueve el rack**

```bash
git mv src/plugins/fx/insert-chain.ts src/core/insert-chain.ts
git mv src/plugins/fx/insert-chain.test.ts src/core/insert-chain.test.ts
```

Actualiza los imports. Son pocos: `src/core/lane-resources.ts`, `src/core/fx.ts`, `src/session/insert-slot.ts`, `src/session/lane-insert-ui.ts`, `src/app/audio-graph.ts` y sus tests. Confírmalo con:

```bash
grep -rn "plugins/fx/insert-chain\|from '\.\./plugins/fx" src/ --include=*.ts
```

- [ ] **Step 2: Comprueba que la carpeta se ha vaciado**

Run: `ls src/plugins/fx/`
Expected: no existe.

- [ ] **Step 3: El censo y la suite**

Run: `node tools/plugin-id-census.mjs --group fx`
Expected: 0 en producción, y las líneas de `core/fx.ts` que nombraban `delay`/`reverb` han desaparecido de la clasificación (`send-migration.ts` **sigue ahí a propósito**: es vocabulario de datos guardados, no una decisión del core).

Run: `npm run test:unit && npm run build && npm run test:e2e`
Expected: verdes.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "refactor(core): the insert chain is host machinery, so it leaves the plugins folder

With the eleventh effect gone, src/plugins/fx held one file that is not an
effect: the rack itself. It moves to src/core and the directory disappears —
a folder called fx with no fx inside it is a place where the next one would
be put by mistake."
```

### Task 23: El barrido de aceptación

- [ ] **Step 1: §5.0 — la ficha manda**

Ya cubierto por el e2e de la tarea 3. Lánzalo otra vez ahora que hay 15 plugins más.

- [ ] **Step 2: §5.1 — un insert de disco suena**

```bash
grep -rn "'autowah'\|\"autowah\"" src/
```
Expected: sin resultados. Después, en Chrome real: mete un Auto-Wah, mide con el tap de master que la señal difiere del mismo trozo en bypass, y mueve un mando para ver que vuelve a cambiar.

- [ ] **Step 3: §5.3 y §5.4 — desinstalar y reinstalar**

```bash
npm run build
mv dist/plugins/delay /tmp/delay-away
```
Carga una sesión que usara el delay: tapón marcado, **los inserts siguientes con sus datos correctos**, un aviso en consola, y al guardar y recargar los ajustes del delay ausente siguen en el JSON. Repón la carpeta, recarga y mide con el tap de master que vuelve a sonar.

- [ ] **Step 4: §5.7 — el offline hace lo mismo que el vivo**

Exporta una escena con un insert ausente y compara con el render en vivo de la misma escena. `rehydrateInsertChain` está en el camino de `offline-recorder.ts record`, y ese camino ya se desincronizó del vivo una vez sin que test ni oído lo notaran.

- [ ] **Step 5: §5.8 — escucha**

Los cuatro nuevos, en **Chrome real**, no el navegador de VS Code.

- [ ] **Step 6: Poda**

Borra este plan y su spec del árbol cuando el trabajo esté mergeado. **Es el paso que siempre se salta.**

---

## Lo que este plan NO hace

- **Los note-FX** (arp y chord). Rebanada siguiente: exige inventar el panel genérico que hoy no existe.
- **El instalador de UI**, el `.loomplugin` y la base de datos del navegador. Trozo 4.
- **Un insert con DSP dentro del worklet.** Los quince son nodos nativos.
- **Distinguir *no instalado* de *falló al cargar*.** El contrato de motor tampoco lo distingue; se arregla en los dos sitios a la vez, en su rebanada.
- **Los tres motores que siguen integrados**: `sampler`, `audio`, `drums-machine`.
