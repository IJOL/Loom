# Plugins drop-in — trozo vertical (Karplus fuera del árbol) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Sacar el motor Karplus completamente fuera de `src/`, convertido en un plugin de JavaScript ya compilado que la app carga en runtime, y dejar montada la ABI, el SDK, el empaquetador y el host que los siguientes plugins van a reutilizar.

**Architecture:** El host publica `globalThis.Loom` en DOS realms — el hilo principal y el AudioWorklet — antes de cargar plugin alguno. Un plugin es un directorio de JS compilado (`plugin.json` + `main.js` + `dsp.js` + `presets.json`); `main.js` llama a `Loom.registerEngine(manifest)` y `dsp.js` llama a `Loom.registerRenderer(id, factory)`. El core deja de comparar `engineId === '…'` y pasa a leer capacidades del manifiesto. Los primitivos DSP viajan al plugin por un paquete de workspace en tiempo de compilación, nunca por la ABI.

**Tech Stack:** TypeScript 5.4, Vite 5, Vitest 3 (serial, `node` env), Playwright 1.60, esbuild (nuevo devDependency), lit-html. Sin linter.

**Spec:** [docs/superpowers/specs/2026-07-29-plugins-drop-in-abi-design.md](../specs/2026-07-29-plugins-drop-in-abi-design.md)

## Global Constraints

- **Idioma:** todo el código, los identificadores, los comentarios, el manifiesto y cualquier texto de UI van en **inglés**. Solo este plan y el spec están en castellano.
- **Tamaño de fichero:** objetivo 300 líneas de código, tope duro 500 (líneas en blanco y comentarios NO cuentan).
- **Aserciones de tests siempre relativas** (ratios, `>`, `<`), nunca magnitudes absolutas; si escribes un umbral absoluto, justifícalo en un comentario.
- **Colores de test:** invoca siempre por script npm (`npm run test:unit`), o `NO_COLOR=1 npx vitest run <ruta>` para un fichero suelto. **No** añadas `--reporter=…`.
- **`npm run build` ANTES de `npm run test:e2e`** — Playwright sirve `dist/` sin construir. Sin ese build estarías probando un bundle viejo.
- **`test:unit` tiene un teardown inestable**: puede salir con `ERR_IPC_CHANNEL_CLOSED` DESPUÉS de pasar todos los tests. No es un fallo; re-ejecuta para confirmar.
- **Commits frecuentes**, uno por tarea como mínimo. Mensajes con heredoc de Bash (`git commit -F - <<'EOF'`), **nunca** here-string de PowerShell (`@'…'@` deja un `@` literal en el asunto).
- **Ningún `switch`/comparación nueva sobre `engineId` en `src/`.** Si el core necesita saber algo de un motor, lo pregunta al manifiesto.
- La ABI (`LoomApi`) **no crece** en este plan más allá de lo que aquí se define.

---

## Hechos verificados antes de escribir esto

Nada de lo que sigue es una suposición. Cada línea se comprobó ejecutándola o leyendo el código, el 2026-07-29.

| Hecho | Cómo se comprobó |
|---|---|
| Un módulo añadido al AudioWorklet en runtime **publica en el scope global**, y un SEGUNDO módulo llega al mismo registro. Vale tanto `blob:` como http. La factoría que cruza la frontera es invocable. | [tests/e2e/worklet-external-module.spec.ts](../../../tests/e2e/worklet-external-module.spec.ts), verde en Chromium: `host-blob ok, plugin-blob ok, plugin-http ok, construct-node ok`, `ids ["from-blob","from-http"]`, `sample 0.25`. Commit `c556b2c`. |
| `page.route()` de Playwright **no** intercepta las peticiones de módulo del worklet. | El primer intento del spike fallaba con `Unable to load a worklet's module`; sirviendo el fichero de verdad desde `dist/`, pasa. |
| **`VoiceManager` NO aplica ningún trim**: cada renderer llama a `synthTrim(<su id>)` por su cuenta (`tb303:92`, `subtractive:186`, `fm:214`, `wavetable:174`, `westcoast:252`, `karplus:229`). El único punto de suma es `renderSample`, línea 225: `out += s.v.renderSample(t, mo)`. | `grep synthTrim src/` + lectura de `voice-manager.ts`. |
| `VoiceManager` se construye en exactamente **dos** sitios: `loom-processor.ts:44` (`new VoiceManager(sampleRate, engineId, {})`) y `kernel-lane-render.ts:61` (`new VoiceManager(sampleRate, spec.engineId, spec.params)`). | `grep "new VoiceManager("`. |
| `LoomWorkletNode` se construye en **un** sitio de producción: `worklet-lane-engine.ts:240`, `new LoomWorkletNode(ctx, cfg.engineId)`. | `grep "new LoomWorkletNode"`. |
| **`LANE_HOST_ENGINE_IDS` está muerto.** Su bucle escribe `.bpm` sobre lo que devuelve `getEngine(id)`, que es el descriptor de `createDescriptorEngine` — un objeto sin propiedad `bpm`. Los únicos objetos con `bpm` son `WorkletLaneEngine`, `DrumsWorkletEngine` y `SamplerWorkletEngine`, que son **instancias por pista**, no lo que hay en el registro. | `grep -i bpm src/engines/` + `grep "\.bpm\s*=[^=]" src/`: el único escritor es ese bucle. |
| El único consumidor de `WORKLET_ENGINE_IDS` que hace algo distinto de `.has()` es `live-params.dsp.test.ts:100`, que lo expande con `[...WORKLET_ENGINE_IDS]`. | `grep WORKLET_ENGINE_IDS`. |
| El selector de motor es **`#engine-select`** (`index.html:208`); hay un segundo, `#engine-select-303` (`index.html:167`), para el carril del 303. | `grep` en `index.html` + `main.ts:205-206`. |
| **esbuild 0.21.5 ya está instalado** (transitivo de Vite), soporta `--alias:`, deja `Loom.x` como global libre con `platform: neutral`, y su `metafile.inputs` da rutas **relativas al cwd del proceso** — que es lo que hace correcta la comprobación "no importes `src/` del host". | Bundle real ejecutado en el scratchpad. |
| El selector `#engine-select` se rellena desde `melodicSynthEngineIds()`, que filtra por `getEngineDescriptor(id)?.editor === 'piano-roll'`. Un motor de plugin aparece ahí en cuanto su descriptor se registra. | `engine-selector-ui.ts:41-45`. |
| **Ocho ficheros** importan Karplus, y en cinco tests es una **fila de tabla**, no solo un import. `KARPLUS_DEFAULT_MODULATORS` no lo importa nadie fuera de su propio fichero. La lista exacta está en la Task 9. | `grep -n "engines/karplus\|karplus-renderer\|KARPLUS_DEFAULT_MODULATORS"`. |
| **`gain-staging-velocity.test.ts` se rompe por un motivo aparte**: su `levelRatio` lee `ENGINE_TRIM['karplus']` (líneas 16-21), así que borrar esa entrada lo vuelve `NaN` y caen cinco casos. | Lectura del fichero. |
| `tsconfig.json` **no** tiene `resolveJsonModule`, y el `main.ts` de un plugin importa su `plugin.json`. | Lectura de `tsconfig.json`. |
| esbuild 0.21 bundlea JSON de forma nativa; la sintaxis de atributos de import (`with { type: 'json' }`) es más nueva que esta cadena de herramientas, así que el plan usa el import plano. | Versión comprobada + documentación de esbuild. |

### Un bug latente encontrado por el camino (FUERA de este plan)

Como `LANE_HOST_ENGINE_IDS` escribe sobre los descriptores del registro y no sobre las
instancias por pista, **nadie asigna nunca `WorkletLaneEngine.bpm`** — cuyo setter existe
precisamente para re-postear los modulators y que un LFO sincronizado al tempo vuelva a
resolver su frecuencia (`worklet-lane-engine.ts:216-219`). Es decir: **un LFO en modo SYNC
sobre uno de los seis motores melódicos no sigue los cambios de tempo.** No se arregla
aquí — este plan solo borra el bucle muerto — pero queda anotado para que el borrado no lo
entierre.

---

## File Structure

**Paquete nuevo — el SDK que se publica a los autores** (`packages/loom-plugin-sdk/src/`):
- `index.ts` — la superficie pública única del paquete (re-exporta todo lo de abajo).
- `types.ts` — `NoteSpec`, `ParamBag`, `VoiceModOffsets`, `VoiceRenderer`, `param()`.
- `manifest.ts` — `EngineManifest`, `EngineParamSpec`, `PresetEntry`, `LoomApi`, `LOOM_API_VERSION`.
- `global.d.ts` — `declare const Loom: LoomApi` para que un plugin en TS compile.
- `dsp/velocity.ts`, `dsp/util.ts`, `dsp/adsr.ts`, `dsp/mod-env-host.ts` — los primitivos que Karplus necesita, **movidos** desde `src/` (el SDK pasa a ser su único dueño).

**Empaquetador nuevo** (`tools/loom-plugin/`):
- `cli.mjs` — parseo de argumentos y despacho de `new` / `build`.
- `build.mjs` — bundle con esbuild, validación del manifiesto, comprobación de imports prohibidos, `public/plugins/index.json`.
- `scaffold.mjs` — plantillas de `new` (TS y JS).
- `build.test.mjs`, `scaffold.test.mjs` — tests (vitest ya incluye `tools/**/*.test.mjs`).

**Host nuevo, dentro de la app** (`src/plugin-host/`):
- `manifest-validate.ts` — valida un `plugin.json` desconocido; una función pura.
- `loom-api.ts` — construye e instala el objeto `Loom` del hilo principal; puentea al registro de motores y al de renderers.
- `plugin-host.ts` — descubrimiento, carga de `main.js`, aislamiento de fallos, `ready()`.
- `plugin-dsp.ts` — `addModule` de cada `dsp.js` en un `BaseAudioContext`, y el import del mismo fichero en el hilo principal para el render offline.
- `plugin-capabilities.ts` — el único lector de capacidades: `outputTrimFor`, `shortLabelFor`, `gmHints`, `isWorkletHosted`.

**Plugin nuevo, fuente en el repo** (`plugins/karplus/`):
- `plugin.json`, `main.ts`, `dsp.ts`, `presets.json`.

**Modificados en `src/`:**
- `audio-dsp/types.ts` — re-exporta los cuatro tipos que se van al SDK.
- `audio-dsp/adsr.ts`, `audio-dsp/mod-env-host.ts`, `audio-dsp/dsp-util.ts`, `core/velocity-gain.ts` — pasan a ser re-exports de una línea.
- `audio-dsp/gain-staging.ts` — `synthTrim` consulta primero las capacidades de plugin.
- `session/session-host-util.ts` — `nextLaneSlug` consulta `shortLabelFor`.
- `midi/gm-lookup.ts` — `NAME_ENGINE_HINTS` se fusiona con las pistas de los plugins.
- `app/lane-allocator.ts` — `WORKLET_ENGINE_IDS` deja de ser una constante escrita a mano.
- `app/bpm-broadcast.ts` — se borra `LANE_HOST_ENGINE_IDS` y su bucle muerto.
- `presets/preset-loader.ts` — `seedEnginePresets` deja de ser solo-para-tests.
- `main.ts` — la puerta `pluginsReady` delante de presets y worklet.
- `export/kernel-lane-render.ts`, `audio-worklet/loom-processor.ts` — fuera el import de karplus.

**Borrados al final:** `src/engines/karplus.ts`, `src/audio-dsp/karplus-renderer.ts`, `public/presets/karplus.json`.

**Config:** `package.json` (scripts + esbuild), `tsconfig.json` (include + paths), `vite.config.ts` (alias), `vitest.config.ts` (alias + include).

---

### Task 1: Spike — ¿puede el AudioWorklet cargar DSP externo? — ✅ HECHA (`c556b2c`)

Era lo único capaz de tumbar el diseño entero, así que se hizo **antes** de dar el plan por bueno, con un test real en un navegador real.

**Files:**
- Created: [tests/e2e/worklet-external-module.spec.ts](../../../tests/e2e/worklet-external-module.spec.ts)

- [x] **Step 1: Write the test** — hecho.
- [x] **Step 2: Run it** — `npm run build` ya estaba hecho; `npx playwright test tests/e2e/worklet-external-module.spec.ts` → **1 passed**.
- [x] **Step 3: Commit** — `c556b2c`.

**Resultado, literal:**

```
addModule steps: { "host-blob": "ok", "plugin-blob": "ok",
                   "plugin-http": "ok", "construct-node": "ok" }
msg: {"ids":["from-blob","from-http"],"sample":0.25,"apiVersion":1}
```

Los dos módulos de plugin —uno servido como `blob:` y otro por http normal desde `dist/`— alcanzaron el **mismo** registro que creó el módulo del host, y la factoría que cruzó la frontera se pudo invocar (devolvió `0.25`). **GO.**

Un detalle que costó el primer intento y conviene no re-descubrir: `page.route()` de Playwright **no** intercepta las peticiones de módulo del worklet. El fichero http hay que servirlo de verdad.

---

### Task 2: El paquete SDK y su cableado

El SDK pasa a ser el **único dueño** de los primitivos que un plugin necesita; `src/` los importa desde ahí. Nada se copia — un duplicado se desincroniza y el proyecto tiene una regla explícita de un solo dueño por dato.

**Files:**
- Create: `packages/loom-plugin-sdk/package.json`
- Create: `packages/loom-plugin-sdk/src/index.ts`
- Create: `packages/loom-plugin-sdk/src/types.ts`
- Create: `packages/loom-plugin-sdk/src/dsp/util.ts`, `dsp/velocity.ts`, `dsp/adsr.ts`, `dsp/mod-env-host.ts`
- Create: `packages/loom-plugin-sdk/src/sdk-parity.test.ts`
- Modify: `src/audio-dsp/types.ts`, `src/audio-dsp/dsp-util.ts`, `src/audio-dsp/adsr.ts`, `src/audio-dsp/mod-env-host.ts`, `src/core/velocity-gain.ts`
- Modify: `tsconfig.json`, `vite.config.ts`, `vitest.config.ts`, `package.json`

**Interfaces:**
- Produces: el especificador de módulo `@loom/plugin-sdk`, que exporta
  `param(bag, id, default): number`, `midiToFreq(midi): number`, `clamp01(v): number`,
  `velGain01(v01, accent, accentMul?): number`, `ACCENT_PUNCH`, `ACCENT_VCA_LADDER`,
  la clase `Adsr` (`update(t, gate, a, d, s, r): number`, `isOff`),
  la clase `ModEnvHost` (`setModEnvelopes(mods)`, `active`, `getAdsrOffsets()`, `combine(t, gate, moIn?)`),
  y los tipos `NoteSpec`, `ParamBag`, `VoiceModOffsets`, `VoiceRenderer`, `ModLite`.

- [ ] **Step 1: Mueve los cuatro módulos DSP al SDK, sin editarlos**

```bash
mkdir -p packages/loom-plugin-sdk/src/dsp
git mv src/audio-dsp/adsr.ts        packages/loom-plugin-sdk/src/dsp/adsr.ts
git mv src/audio-dsp/mod-env-host.ts packages/loom-plugin-sdk/src/dsp/mod-env-host.ts
git mv src/audio-dsp/dsp-util.ts    packages/loom-plugin-sdk/src/dsp/util.ts
git mv src/core/velocity-gain.ts    packages/loom-plugin-sdk/src/dsp/velocity.ts
```

En `packages/loom-plugin-sdk/src/dsp/mod-env-host.ts` corrige sus tres imports, que ahora son locales al SDK:

```ts
import { Adsr } from './adsr';
import type { ModLite, VoiceModOffsets } from '../types';
```

- [ ] **Step 2: Escribe los tipos del SDK**

`packages/loom-plugin-sdk/src/types.ts` — copia **textualmente** desde `src/audio-dsp/types.ts` los bloques `NoteSpec`, `ParamBag`, `param`, `VoiceModOffsets` y `VoiceRenderer` (con sus comentarios: explican por qué `setLiveParams` excluye los tiempos de envolvente, y un autor de plugins necesita leer eso). Quita `setLiveSubParams` de `VoiceRenderer` — es un detalle interno de Subtractive, no parte del contrato público. Añade además el tipo que `ModEnvHost` necesita:

```ts
/** The per-voice slice of a modulator the worklet hands to a renderer at spawn:
 *  its envelope times plus how deep it drives each param dot-id. */
export interface ModLite {
  attackSec?: number;
  decaySec?: number;
  sustain?: number;
  releaseSec?: number;
  depthByParam: Record<string, number>;
}
```

`packages/loom-plugin-sdk/src/index.ts`:

```ts
// @loom/plugin-sdk — the published surface a Loom plugin author compiles against.
// Everything here ends up INSIDE the plugin's own bundle: the runtime ABI
// (globalThis.Loom) carries no DSP, which is what keeps it small enough to hold
// stable across versions.
export * from './types';
export * from './dsp/util';
export * from './dsp/velocity';
export { Adsr } from './dsp/adsr';
export { ModEnvHost } from './dsp/mod-env-host';
```

`packages/loom-plugin-sdk/package.json`:

```json
{
  "name": "@loom/plugin-sdk",
  "version": "0.1.0",
  "type": "module",
  "license": "AGPL-3.0-or-later",
  "exports": { ".": "./src/index.ts" },
  "types": "./src/index.ts"
}
```

- [ ] **Step 3: Cablea el alias en las tres configuraciones**

`tsconfig.json` — añade `paths` y mete los directorios nuevos en `include`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "skipLibCheck": true,
    "isolatedModules": true,
    "noEmit": true,
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "baseUrl": ".",
    "paths": { "@loom/plugin-sdk": ["packages/loom-plugin-sdk/src/index.ts"] },
    "resolveJsonModule": true
  },
  "include": ["src", "test", "scripts", "packages", "plugins"]
}
```

> `resolveJsonModule` no es opcional: el `main.ts` de un plugin importa su propio `plugin.json` (Task 6), y un test de gain-staging pasará a leer el trim desde ese mismo JSON (Task 9). Sin esta línea, `tsc` falla en las dos.

`vite.config.ts` — dentro de `defineConfig({...})`, junto a `plugins`:

```ts
  resolve: {
    alias: { '@loom/plugin-sdk': join(ROOT, 'packages', 'loom-plugin-sdk', 'src', 'index.ts') },
  },
```

`vitest.config.ts` — el alias y los tests de los directorios nuevos:

```ts
import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  resolve: {
    alias: { '@loom/plugin-sdk': join(ROOT, 'packages', 'loom-plugin-sdk', 'src', 'index.ts') },
  },
  test: {
    environment: 'node',
    include: [
      'src/**/*.test.ts', 'src/**/*.dsp.test.ts', 'src/**/*.wiring.test.ts',
      'packages/**/*.test.ts', 'plugins/**/*.test.ts',
      'tools/**/*.test.mjs',
    ],
    globals: false,
    setupFiles: ['test/setup.ts'],
    testTimeout: 15000,
    fileParallelism: false,
  },
});
```

- [ ] **Step 4: Deja re-exports de una línea donde estaban los módulos**

Así ningún import existente de `src/` cambia y el radio de impacto es cero.

`src/audio-dsp/dsp-util.ts`:

```ts
// Moved to @loom/plugin-sdk — plugins need these primitives, and one copy is the
// rule. Re-exported here so existing imports keep resolving.
export { midiToFreq, clamp01 } from '@loom/plugin-sdk';
```

`src/audio-dsp/adsr.ts`:

```ts
export { Adsr } from '@loom/plugin-sdk';
```

`src/audio-dsp/mod-env-host.ts`:

```ts
export { ModEnvHost } from '@loom/plugin-sdk';
```

`src/core/velocity-gain.ts`:

```ts
export {
  DEFAULT_VELOCITY, ACCENT_PUNCH, ACCENT_VCA_LADDER,
  velNorm, velGain01, velToGain, resolveVelocity, velGain,
} from '@loom/plugin-sdk';
```

En `src/audio-dsp/types.ts`, **borra** las declaraciones de `NoteSpec`, `ParamBag`, `param`, `VoiceModOffsets` y `VoiceRenderer`, y pon en su lugar (dejando `SubParams` y `ModTarget` donde están):

```ts
// The plugin-facing half of this module now lives in @loom/plugin-sdk (a plugin
// compiles against it). Re-exported so every existing import keeps working.
export type { NoteSpec, ParamBag, VoiceModOffsets, ModLite } from '@loom/plugin-sdk';
export { param } from '@loom/plugin-sdk';
import type { VoiceRenderer as SdkVoiceRenderer } from '@loom/plugin-sdk';

/** The host's renderer interface: the published contract plus the one hook that
 *  is deliberately NOT public — Subtractive reads a typed SubParams instead of
 *  the dot-id bag, an internal optimisation no plugin should depend on.
 *  `SubParams` stays declared in this same file. */
export interface VoiceRenderer extends SdkVoiceRenderer {
  setLiveSubParams?(live: SubParams): void;
}
```

- [ ] **Step 5: Escribe el test de paridad del SDK**

`packages/loom-plugin-sdk/src/sdk-parity.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { velGain01, midiToFreq, param, Adsr, ModEnvHost } from './index';

describe('@loom/plugin-sdk', () => {
  it('exports the velocity curve the renderers were tuned against', () => {
    // Relative: full velocity must sit above the 0.3 floor by the curve's own
    // ratio (0.3 + 1.1) / 0.3, not an absolute number.
    expect(velGain01(1, false) / velGain01(0, false)).toBeCloseTo(1.4 / 0.3, 6);
    expect(velGain01(1, true)).toBeGreaterThan(velGain01(1, false));
  });

  it('maps MIDI to frequency with A4 = 69 as the anchor octave', () => {
    expect(midiToFreq(81) / midiToFreq(69)).toBeCloseTo(2, 9);
  });

  it('reads a param bag with a fallback', () => {
    expect(param({ 'amp.level': 0.4 }, 'amp.level', 1)).toBe(0.4);
    expect(param({}, 'amp.level', 1)).toBe(1);
  });

  it('runs an ADSR that rises under gate and falls after release', () => {
    const a = new Adsr();
    a.update(0, 1, 0.1, 0.1, 0.5, 0.1);
    const rising = a.update(0.05, 1, 0.1, 0.1, 0.5, 0.1);
    const held = a.update(0.3, 1, 0.1, 0.1, 0.5, 0.1);
    const released = a.update(0.5, 0, 0.1, 0.1, 0.5, 0.1);
    expect(rising).toBeGreaterThan(0);
    expect(released).toBeLessThan(held);
  });

  it('folds ADSR offsets on top of the shared-LFO offsets', () => {
    const h = new ModEnvHost();
    expect(h.active).toBe(false);
    h.setModEnvelopes([{ attackSec: 0.01, decaySec: 0.1, sustain: 1, releaseSec: 0.1, depthByParam: { 'amp.level': 0.5 } }]);
    h.combine(0, 1);
    const out = h.combine(0.5, 1, { 'amp.level': 0.1 });
    expect(out['amp.level']).toBeGreaterThan(0.1);
  });
});
```

- [ ] **Step 6: Run it — the alias must resolve and the suite must stay green**

```bash
npx tsc --noEmit
NO_COLOR=1 npx vitest run packages/loom-plugin-sdk/src/sdk-parity.test.ts
npm run test:unit
```

Expected: tsc limpio, el fichero nuevo PASS, y la suite completa igual de verde que antes del cambio. Si `test:unit` sale con `ERR_IPC_CHANNEL_CLOSED` después de pasar todo, re-ejecútalo.

- [ ] **Step 7: Commit**

```bash
git add packages tsconfig.json vite.config.ts vitest.config.ts src/audio-dsp src/core/velocity-gain.ts
git commit -F - <<'EOF'
feat(sdk): @loom/plugin-sdk pasa a ser el dueno de los primitivos DSP

Los cuatro modulos que un plugin necesita (adsr, mod-env-host, dsp-util,
velocity-gain) se MUEVEN al paquete del SDK y src/ los re-exporta en una linea,
asi que sigue habiendo una sola copia y ningun import existente cambia.

El SDK es lo que un autor compila dentro de su bundle: la ABI de runtime no
lleva DSP, que es lo que permite que sea diminuta y estable.
EOF
```

---

### Task 3: El manifiesto y su validador

Un `plugin.json` viene de fuera y puede ser cualquier cosa. Se valida antes de ejecutar una sola línea del plugin.

**Files:**
- Create: `packages/loom-plugin-sdk/src/manifest.ts`
- Create: `packages/loom-plugin-sdk/src/global.d.ts`
- Create: `src/plugin-host/manifest-validate.ts`
- Create: `src/plugin-host/manifest-validate.test.ts`
- Modify: `packages/loom-plugin-sdk/src/index.ts`

**Interfaces:**
- Consumes: nada de tareas anteriores.
- Produces: el tipo `EngineManifest` y `LOOM_API_VERSION` (número, valor `1`); la función `validatePluginManifest(raw: unknown): { ok: true; manifest: PluginManifestFile } | { ok: false; error: string }`.

- [ ] **Step 1: Escribe los tipos del manifiesto en el SDK**

`packages/loom-plugin-sdk/src/manifest.ts`:

```ts
// The plugin manifest: everything the host needs to know about a plugin WITHOUT
// running it, and every question the host used to answer by comparing engine ids.
// Adding a field here is how a capability is born; a `switch` on an id in the
// host is, from now on, a bug.

/** Bumped only on an INCOMPATIBLE change. The host refuses to execute a plugin
 *  whose `loomApi` differs, so a stale plugin fails loudly instead of silently
 *  half-working. */
export const LOOM_API_VERSION = 1;

export interface EngineParamSpec {
  id: string;
  label: string;
  kind: 'continuous' | 'discrete';
  min: number;
  max: number;
  default: number;
  unit?: string;
  options?: { value: string; label: string }[];
}

export interface PresetEntry {
  name: string;
  gm?: number[];
  params: Record<string, number>;
  modulators?: unknown[];
}

/** Track-name keywords that should route a MIDI import onto this engine, plus
 *  where this engine sits when several plugins claim the same word (lower runs
 *  first). Replaces the hand-written NAME_ENGINE_HINTS table. */
export interface GmHint {
  keywords: string[];
  priority: number;
}

export interface EngineManifest {
  id: string;
  name: string;
  polyphony: 'mono' | 'poly';
  /** Which host clip editor this engine wants. */
  clipEditor: 'piano-roll' | 'drum-grid' | 'audio';
  params: EngineParamSpec[];
  /** Default modulator set, serialized — seeds the lane's modulation host. */
  modulators?: unknown[];
  /** Per-engine output balance against the other engines (what the host's
   *  ENGINE_TRIM table used to hold for built-ins). */
  outputTrim: number;
  /** Prefix for generated lane ids ("karplus" → "karplus-1"). */
  shortLabel: string;
  gm?: GmHint;
}

export interface PluginManifestFile {
  id: string;
  name: string;
  version: string;
  loomApi: number;
  author?: string;
  /** Entry point loaded on the MAIN thread. */
  main: string;
  /** Entry point added to the AudioWorklet (and imported on the main thread for
   *  offline render). Absent ⇒ this plugin has no per-sample DSP. */
  dsp?: string;
  /** Preset file, relative to the plugin directory. */
  presets?: string;
  engines?: EngineManifest[];
}

/** The runtime handshake. Installed by the host on globalThis in BOTH realms
 *  before any plugin code runs; a plugin never imports anything from the host. */
export interface LoomApi {
  readonly apiVersion: number;
  registerEngine(manifest: EngineManifest): void;
  registerRenderer(engineId: string, make: RendererFactory): void;
}

export type RendererFactory = (
  note: import('./types').NoteSpec,
  params: import('./types').ParamBag,
  sampleRate: number,
) => import('./types').VoiceRenderer;
```

`packages/loom-plugin-sdk/src/global.d.ts`:

```ts
import type { LoomApi } from './manifest';

declare global {
  /** Installed by the host before any plugin module is evaluated. */
  const Loom: LoomApi;
}

export {};
```

Añade a `packages/loom-plugin-sdk/src/index.ts`:

```ts
export * from './manifest';
```

- [ ] **Step 2: Write the failing test**

`src/plugin-host/manifest-validate.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { validatePluginManifest } from './manifest-validate';

const good = {
  id: 'karplus', name: 'Karp', version: '1.0.0', loomApi: 1,
  main: 'main.js', dsp: 'dsp.js', presets: 'presets.json',
  engines: [{
    id: 'karplus', name: 'Karp', polyphony: 'poly', clipEditor: 'piano-roll',
    outputTrim: 0.857, shortLabel: 'karplus',
    params: [{ id: 'amp.level', label: 'Level', kind: 'continuous', min: 0, max: 1, default: 0.8 }],
  }],
};

describe('validatePluginManifest', () => {
  it('accepts a well-formed manifest', () => {
    const r = validatePluginManifest(good);
    expect(r.ok).toBe(true);
  });

  it('rejects a manifest built for a different API version', () => {
    const r = validatePluginManifest({ ...good, loomApi: 99 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain('loomApi');
  });

  it('rejects a manifest with no id', () => {
    const r = validatePluginManifest({ ...good, id: '' });
    expect(r.ok).toBe(false);
  });

  it('rejects an engine whose param spec is malformed', () => {
    const bad = { ...good, engines: [{ ...good.engines[0], params: [{ id: 'x' }] }] };
    const r = validatePluginManifest(bad);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain('params');
  });

  it('rejects an engine with no outputTrim, rather than guessing one', () => {
    const e = { ...good.engines[0] } as Record<string, unknown>;
    delete e.outputTrim;
    const r = validatePluginManifest({ ...good, engines: [e] });
    expect(r.ok).toBe(false);
  });

  it('rejects a non-object', () => {
    expect(validatePluginManifest(null).ok).toBe(false);
    expect(validatePluginManifest('nope').ok).toBe(false);
  });
});
```

- [ ] **Step 3: Run it to watch it fail**

```bash
NO_COLOR=1 npx vitest run src/plugin-host/manifest-validate.test.ts
```

Expected: FAIL — `Failed to resolve import "./manifest-validate"`.

- [ ] **Step 4: Write the implementation**

`src/plugin-host/manifest-validate.ts`:

```ts
// Validates a plugin.json that came from OUTSIDE. Runs before a single line of
// plugin code is evaluated, so a malformed or incompatible plugin fails as data
// rather than as a mid-boot exception.
import { LOOM_API_VERSION, type PluginManifestFile, type EngineManifest, type EngineParamSpec } from '@loom/plugin-sdk';

export type ValidationResult =
  | { ok: true; manifest: PluginManifestFile }
  | { ok: false; error: string };

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);
const isStr = (v: unknown): v is string => typeof v === 'string' && v.length > 0;
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

function paramError(p: unknown, i: number): string | null {
  if (!isObj(p)) return `params[${i}] is not an object`;
  if (!isStr(p.id)) return `params[${i}].id must be a non-empty string`;
  if (!isStr(p.label)) return `params[${i}].label must be a non-empty string`;
  if (p.kind !== 'continuous' && p.kind !== 'discrete') return `params[${i}].kind must be continuous|discrete`;
  for (const k of ['min', 'max', 'default'] as const) {
    if (!isNum(p[k])) return `params[${i}].${k} must be a number`;
  }
  return null;
}

function engineError(e: unknown, i: number): string | null {
  if (!isObj(e)) return `engines[${i}] is not an object`;
  if (!isStr(e.id)) return `engines[${i}].id must be a non-empty string`;
  if (!isStr(e.name)) return `engines[${i}].name must be a non-empty string`;
  if (e.polyphony !== 'mono' && e.polyphony !== 'poly') return `engines[${i}].polyphony must be mono|poly`;
  if (e.clipEditor !== 'piano-roll' && e.clipEditor !== 'drum-grid' && e.clipEditor !== 'audio') {
    return `engines[${i}].clipEditor must be piano-roll|drum-grid|audio`;
  }
  // No default: a missing trim is a plugin that never thought about gain
  // staging, and guessing 1 would ship it louder than everything else.
  if (!isNum(e.outputTrim)) return `engines[${i}].outputTrim must be a number`;
  if (!isStr(e.shortLabel)) return `engines[${i}].shortLabel must be a non-empty string`;
  if (!Array.isArray(e.params)) return `engines[${i}].params must be an array`;
  for (let j = 0; j < e.params.length; j++) {
    const err = paramError(e.params[j], j);
    if (err) return `engines[${i}].${err}`;
  }
  if (e.gm !== undefined) {
    if (!isObj(e.gm) || !Array.isArray(e.gm.keywords) || !isNum(e.gm.priority)) {
      return `engines[${i}].gm must be { keywords: string[], priority: number }`;
    }
  }
  return null;
}

export function validatePluginManifest(raw: unknown): ValidationResult {
  if (!isObj(raw)) return { ok: false, error: 'manifest is not an object' };
  for (const k of ['id', 'name', 'version', 'main'] as const) {
    if (!isStr(raw[k])) return { ok: false, error: `${k} must be a non-empty string` };
  }
  if (raw.loomApi !== LOOM_API_VERSION) {
    return { ok: false, error: `loomApi ${String(raw.loomApi)} is not supported (host speaks ${LOOM_API_VERSION})` };
  }
  for (const k of ['dsp', 'presets'] as const) {
    if (raw[k] !== undefined && !isStr(raw[k])) return { ok: false, error: `${k} must be a string when present` };
  }
  if (raw.engines !== undefined) {
    if (!Array.isArray(raw.engines)) return { ok: false, error: 'engines must be an array' };
    for (let i = 0; i < raw.engines.length; i++) {
      const err = engineError(raw.engines[i], i);
      if (err) return { ok: false, error: err };
    }
  }
  return { ok: true, manifest: raw as unknown as PluginManifestFile };
}

/** Narrowed accessor used by the capability readers. */
export function enginesOf(m: PluginManifestFile): EngineManifest[] { return m.engines ?? []; }
export type { EngineManifest, EngineParamSpec };
```

- [ ] **Step 5: Run the test**

```bash
NO_COLOR=1 npx vitest run src/plugin-host/manifest-validate.test.ts
npx tsc --noEmit
```

Expected: PASS, tsc limpio.

- [ ] **Step 6: Commit**

```bash
git add packages/loom-plugin-sdk/src src/plugin-host
git commit -F - <<'EOF'
feat(plugins): manifiesto y validador

El manifiesto es donde vive cada capacidad que el core preguntaba comparando
ids: outputTrim, shortLabel, clipEditor, gm. Se valida ANTES de ejecutar nada
del plugin, y outputTrim no tiene default a proposito — adivinar 1 enviaria el
plugin mas alto que todo lo demas.
EOF
```

---

### Task 4: El objeto `Loom` en los dos mundos

**Files:**
- Create: `src/plugin-host/loom-api.ts`
- Create: `src/plugin-host/loom-api.test.ts`
- Modify: `src/audio-worklet/loom-processor.ts`

**Interfaces:**
- Consumes: `EngineManifest`, `LOOM_API_VERSION` (Task 3); `registerEngine`/`registerEngineFactory` de `src/engines/registry`; `createDescriptorEngine` de `src/engines/descriptor-engine`; `registerRenderer` de `src/audio-dsp/renderer-registry`.
- Produces:
  - `installMainThreadLoomApi(): void` — idempotente; instala `globalThis.Loom`.
  - `registeredPluginEngines(): ReadonlyMap<string, EngineManifest>` — el mapa que leen las capacidades.
  - `__resetPluginEngines(): void` — solo para tests.

- [ ] **Step 1: Write the failing test**

`src/plugin-host/loom-api.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { installMainThreadLoomApi, registeredPluginEngines, __resetPluginEngines } from './loom-api';
import { getEngineDescriptor } from '../engines/registry';
import { LOOM_API_VERSION, type EngineManifest } from '@loom/plugin-sdk';

const manifest: EngineManifest = {
  id: 'probe', name: 'Probe', polyphony: 'poly', clipEditor: 'piano-roll',
  outputTrim: 0.5, shortLabel: 'probe',
  params: [{ id: 'amp.level', label: 'Level', kind: 'continuous', min: 0, max: 1, default: 0.8 }],
};

describe('the main-thread Loom API', () => {
  beforeEach(() => { __resetPluginEngines(); installMainThreadLoomApi(); });

  it('publishes its API version', () => {
    expect((globalThis as unknown as { Loom: { apiVersion: number } }).Loom.apiVersion).toBe(LOOM_API_VERSION);
  });

  it('turns a registered engine manifest into a real engine descriptor', () => {
    (globalThis as unknown as { Loom: { registerEngine(m: EngineManifest): void } }).Loom.registerEngine(manifest);
    const d = getEngineDescriptor('probe');
    expect(d?.name).toBe('Probe');
    expect(d?.polyphony).toBe('poly');
    // The engine's own param plus the seven the channel strip contributes to
    // every lane — so a plugin engine is automatable exactly like a built-in.
    expect(d?.params.length).toBeGreaterThan(1);
    expect(d?.params.some((p) => p.id === 'amp.level')).toBe(true);
  });

  it('keeps the manifest so capability readers can answer without the engine id', () => {
    (globalThis as unknown as { Loom: { registerEngine(m: EngineManifest): void } }).Loom.registerEngine(manifest);
    expect(registeredPluginEngines().get('probe')?.outputTrim).toBe(0.5);
  });

  it('is idempotent — installing twice keeps one object', () => {
    const first = (globalThis as unknown as { Loom: unknown }).Loom;
    installMainThreadLoomApi();
    expect((globalThis as unknown as { Loom: unknown }).Loom).toBe(first);
  });
});
```

- [ ] **Step 2: Run it to watch it fail**

```bash
NO_COLOR=1 npx vitest run src/plugin-host/loom-api.test.ts
```

Expected: FAIL — no existe `./loom-api`.

- [ ] **Step 3: Write the implementation**

`src/plugin-host/loom-api.ts`:

```ts
// The runtime handshake, main-thread half.
//
// A plugin's main.js is compiled JS that cannot import anything of ours (our
// modules are bundled and hashed), so the meeting point is a global object. The
// worklet half lives in loom-processor.ts and installs the same shape there —
// separately addModule'd worklet modules do not share module instances, so a
// global is the ONLY place both halves can meet.
import { LOOM_API_VERSION, type EngineManifest, type RendererFactory } from '@loom/plugin-sdk';
import { registerEngine, registerEngineFactory } from '../engines/registry';
import { createDescriptorEngine } from '../engines/descriptor-engine';
import { registerRenderer } from '../audio-dsp/renderer-registry';
import { getCachedPresets } from '../presets/preset-loader';
import type { ModulatorState } from '../modulation/types';

const pluginEngines = new Map<string, EngineManifest>();

/** Every engine manifest a plugin has registered, by engine id. The capability
 *  readers ask this; nothing else should reach for it. */
export function registeredPluginEngines(): ReadonlyMap<string, EngineManifest> {
  return pluginEngines;
}

function adoptEngine(m: EngineManifest): void {
  pluginEngines.set(m.id, m);
  const make = () => createDescriptorEngine({
    id: m.id,
    name: m.name,
    polyphony: m.polyphony,
    // The host owns the clip editors; the plugin only says which one it wants.
    editor: m.clipEditor === 'drum-grid' ? 'drum-grid' : 'piano-roll',
    params: m.params,
    presets: () => getCachedPresets(m.id),
    modulators: (m.modulators ?? []) as ModulatorState[],
  });
  registerEngineFactory(m.id, make);
  registerEngine(make());
}

let installed = false;

export function installMainThreadLoomApi(): void {
  if (installed) return;
  installed = true;
  Object.defineProperty(globalThis, 'Loom', {
    value: {
      apiVersion: LOOM_API_VERSION,
      registerEngine: (m: EngineManifest) => adoptEngine(m),
      // The main thread needs renderers too: the offline exporter runs the same
      // pure kernel here, not in the worklet.
      registerRenderer: (id: string, make: RendererFactory) => registerRenderer(id, make),
    },
    writable: false,
    configurable: true,
  });
}

/** Test-only. */
export function __resetPluginEngines(): void {
  pluginEngines.clear();
  installed = false;
}
```

- [ ] **Step 4: Run the test**

```bash
NO_COLOR=1 npx vitest run src/plugin-host/loom-api.test.ts
```

Expected: PASS.

- [ ] **Step 5: Install the same shape inside the worklet**

En `src/audio-worklet/loom-processor.ts`, justo **después** de los imports de renderers existentes y **antes** de la clase, añade:

```ts
import { registerRenderer } from '../audio-dsp/renderer-registry';
import { LOOM_API_VERSION } from '@loom/plugin-sdk';

// The worklet half of the runtime handshake. A plugin's dsp.js is addModule'd
// SEPARATELY, so it shares this realm's globals but not this module's instance —
// reaching registerRenderer through a global is the only thing that works. This
// must be installed before any plugin module is added, which the host guarantees
// by awaiting this module's addModule first.
Object.defineProperty(globalThis, 'Loom', {
  value: {
    apiVersion: LOOM_API_VERSION,
    registerEngine: () => { /* main-thread only; harmless no-op inside the worklet */ },
    registerRenderer,
  },
  writable: false,
  configurable: true,
});
```

- [ ] **Step 6: Verify the worklet bundle still builds and the suite is green**

```bash
npx tsc --noEmit
npm run build
npm run test:unit
```

Expected: los tres limpios.

- [ ] **Step 7: Commit**

```bash
git add src/plugin-host src/audio-worklet/loom-processor.ts
git commit -F - <<'EOF'
feat(plugins): el objeto Loom en el hilo principal y dentro del worklet

registerEngine convierte un manifiesto en un descriptor real del registro de
motores (con los siete params del strip incluidos, como cualquier built-in), y
registerRenderer existe en LOS DOS mundos porque el export offline corre el
mismo kernel en el hilo principal.
EOF
```

---

### Task 5: El empaquetador `loom-plugin`

**Files:**
- Create: `tools/loom-plugin/cli.mjs`, `build.mjs`, `scaffold.mjs`
- Create: `tools/loom-plugin/build.test.mjs`
- Modify: `package.json`

**Interfaces:**
- Consumes: `validatePluginManifest` NO — el CLI corre en Node sin el alias de Vite, así que valida con su propia copia mínima; el validador de verdad es el del host, que es quien protege a la app.
- Produces:
  - `buildPlugin({ srcDir, outDir }): Promise<{ id: string, files: string[] }>`
  - `writePluginIndex(outRoot): Promise<string[]>` — escribe `public/plugins/index.json` con los ids presentes.
  - `scaffoldPlugin({ dir, id, lang })`

- [ ] **Step 1: Add esbuild and the scripts**

```bash
npm install --save-dev esbuild@^0.21.5
```

> Esa versión **ya está** en `node_modules` (Vite la trae). Declararla explícitamente en la misma línea evita instalar una segunda copia, y es la versión con la que se comprobó que `--alias:` funciona, que `platform: neutral` deja `Loom.x` como global libre y que `metafile.inputs` da rutas relativas al cwd del proceso.

En `package.json`, dentro de `scripts`, añade y ajusta:

```json
    "plugin": "node tools/loom-plugin/cli.mjs",
    "build:plugins": "node tools/loom-plugin/cli.mjs build plugins/*",
    "build": "npm run build:plugins && tsc && vite build",
    "build:pages": "npm run build:plugins && tsc && vite build --base=/Loom/",
```

- [ ] **Step 2: Write the failing test**

`tools/loom-plugin/build.test.mjs`:

```js
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { buildPlugin, writePluginIndex } from './build.mjs';

let root;
beforeEach(() => { root = mkdtempSync(join(tmpdir(), 'loom-plugin-')); });
afterEach(() => { rmSync(root, { recursive: true, force: true }); });

function writePlugin(dir, extra = {}) {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'plugin.json'), JSON.stringify({
    id: 'probe', name: 'Probe', version: '1.0.0', loomApi: 1,
    main: 'main.js', dsp: 'dsp.js',
    engines: [{
      id: 'probe', name: 'Probe', polyphony: 'poly', clipEditor: 'piano-roll',
      outputTrim: 0.5, shortLabel: 'probe',
      params: [{ id: 'amp.level', label: 'Level', kind: 'continuous', min: 0, max: 1, default: 0.8 }],
    }],
    ...extra,
  }));
  writeFileSync(join(dir, 'main.ts'), `Loom.registerEngine(${JSON.stringify({ id: 'probe' })});\n`);
  writeFileSync(join(dir, 'dsp.ts'), `Loom.registerRenderer('probe', () => ({ renderSample: () => 0, noteOff() {}, done: false }));\n`);
}

describe('loom-plugin build', () => {
  it('emits plugin.json, main.js and dsp.js into the output directory', async () => {
    const src = join(root, 'src', 'probe');
    writePlugin(src);
    const out = join(root, 'out');
    const res = await buildPlugin({ srcDir: src, outDir: out });
    expect(res.id).toBe('probe');
    for (const f of ['plugin.json', 'main.js', 'dsp.js']) {
      expect(existsSync(join(out, 'probe', f))).toBe(true);
    }
  });

  it('rejects a manifest the host would refuse', async () => {
    const src = join(root, 'src', 'probe');
    writePlugin(src, { loomApi: 99 });
    await expect(buildPlugin({ srcDir: src, outDir: join(root, 'out') })).rejects.toThrow(/loomApi/);
  });

  it('refuses a bundle that reaches into the host source tree', async () => {
    const src = join(root, 'src', 'probe');
    writePlugin(src);
    writeFileSync(join(src, 'dsp.ts'),
      `import { velGain01 } from '../../../src/core/velocity-gain';\nLoom.registerRenderer('probe', () => ({ renderSample: () => velGain01(1, false), noteOff() {}, done: false }));\n`);
    await expect(buildPlugin({ srcDir: src, outDir: join(root, 'out') })).rejects.toThrow(/host source/i);
  });

  it('writes an index listing every built plugin', async () => {
    const out = join(root, 'out');
    for (const id of ['probe', 'other']) {
      const src = join(root, 'src', id);
      writePlugin(src);
      writeFileSync(join(src, 'plugin.json'), readFileSync(join(root, 'src', 'probe', 'plugin.json'), 'utf8').replaceAll('probe', id));
      await buildPlugin({ srcDir: src, outDir: out });
    }
    const ids = await writePluginIndex(out);
    expect(ids.sort()).toEqual(['other', 'probe']);
    expect(JSON.parse(readFileSync(join(out, 'index.json'), 'utf8')).plugins.sort()).toEqual(['other', 'probe']);
  });
});
```

- [ ] **Step 3: Run it to watch it fail**

```bash
NO_COLOR=1 npx vitest run tools/loom-plugin/build.test.mjs
```

Expected: FAIL — no existe `./build.mjs`.

- [ ] **Step 4: Write the implementation**

`tools/loom-plugin/build.mjs`:

```js
// Builds a plugin source directory into a distributable one: bundle main/dsp
// with esbuild, copy the manifest and presets, and refuse anything that reaches
// back into the host source tree — the check that keeps a hidden dependency
// from turning "drop-in" into a lie.
import { build } from 'esbuild';
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, copyFileSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SDK_ENTRY = join(REPO_ROOT, 'packages', 'loom-plugin-sdk', 'src', 'index.ts');
const HOST_SRC = join(REPO_ROOT, 'src');

const LOOM_API_VERSION = 1;

function assertValidManifest(m) {
  if (!m || typeof m !== 'object') throw new Error('plugin.json is not an object');
  for (const k of ['id', 'name', 'version', 'main']) {
    if (typeof m[k] !== 'string' || !m[k]) throw new Error(`plugin.json: ${k} must be a non-empty string`);
  }
  if (m.loomApi !== LOOM_API_VERSION) {
    throw new Error(`plugin.json: loomApi ${m.loomApi} is not supported (tooling speaks ${LOOM_API_VERSION})`);
  }
  for (const e of m.engines ?? []) {
    if (typeof e.outputTrim !== 'number') throw new Error(`plugin.json: engine ${e.id} needs a numeric outputTrim`);
    if (typeof e.shortLabel !== 'string' || !e.shortLabel) throw new Error(`plugin.json: engine ${e.id} needs a shortLabel`);
  }
}

async function bundleEntry(entry, outFile) {
  const result = await build({
    entryPoints: [entry],
    outfile: outFile,
    bundle: true,
    format: 'esm',
    target: 'es2022',
    platform: 'neutral',
    metafile: true,
    alias: { '@loom/plugin-sdk': SDK_ENTRY },
  });
  for (const input of Object.keys(result.metafile.inputs)) {
    const abs = resolve(REPO_ROOT, input);
    if (abs.startsWith(HOST_SRC)) {
      throw new Error(
        `plugin bundle reaches into the host source tree (${input}). A plugin may only ` +
        `import @loom/plugin-sdk and its own files — otherwise it is not drop-in.`,
      );
    }
  }
}

/** Build one plugin source directory into `<outDir>/<id>/`. */
export async function buildPlugin({ srcDir, outDir }) {
  const manifest = JSON.parse(readFileSync(join(srcDir, 'plugin.json'), 'utf8'));
  assertValidManifest(manifest);

  const dest = join(outDir, manifest.id);
  mkdirSync(dest, { recursive: true });
  const files = ['plugin.json'];

  const entryFor = (name) => {
    for (const ext of ['.ts', '.js', '.mjs']) {
      const p = join(srcDir, name.replace(/\.js$/, ext));
      if (existsSync(p)) return p;
    }
    throw new Error(`plugin.json points at ${name} but no matching source file exists in ${srcDir}`);
  };

  await bundleEntry(entryFor(manifest.main), join(dest, manifest.main));
  files.push(manifest.main);
  if (manifest.dsp) {
    await bundleEntry(entryFor(manifest.dsp), join(dest, manifest.dsp));
    files.push(manifest.dsp);
  }
  if (manifest.presets && existsSync(join(srcDir, manifest.presets))) {
    copyFileSync(join(srcDir, manifest.presets), join(dest, manifest.presets));
    files.push(manifest.presets);
  }
  writeFileSync(join(dest, 'plugin.json'), JSON.stringify(manifest, null, 2));
  return { id: manifest.id, files };
}

/** Rewrite `<outRoot>/index.json` from whatever plugin directories exist. The
 *  browser cannot list a directory, so this file IS the discovery mechanism. */
export async function writePluginIndex(outRoot) {
  const ids = readdirSync(outRoot, { withFileTypes: true })
    .filter((d) => d.isDirectory() && existsSync(join(outRoot, d.name, 'plugin.json')))
    .map((d) => d.name)
    .sort();
  writeFileSync(join(outRoot, 'index.json'), JSON.stringify({ plugins: ids }, null, 2));
  return ids;
}
```

`tools/loom-plugin/cli.mjs`:

```js
#!/usr/bin/env node
// loom-plugin — build a Loom plugin directory, or scaffold a new one.
//
//   node tools/loom-plugin/cli.mjs build plugins/*        → public/plugins/
//   node tools/loom-plugin/cli.mjs new plugins/my-synth --js
import { readdirSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname, resolve, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildPlugin, writePluginIndex } from './build.mjs';
import { scaffoldPlugin } from './scaffold.mjs';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const DEFAULT_OUT = join(REPO_ROOT, 'public', 'plugins');

function expand(pattern) {
  // Only the trailing `*` form is supported — enough for `plugins/*`, and a real
  // glob dependency for one shape would be silly.
  if (!pattern.endsWith('*')) return [resolve(REPO_ROOT, pattern)];
  const parent = resolve(REPO_ROOT, pattern.slice(0, -1));
  if (!existsSync(parent)) return [];
  return readdirSync(parent, { withFileTypes: true })
    .filter((d) => d.isDirectory() && existsSync(join(parent, d.name, 'plugin.json')))
    .map((d) => join(parent, d.name));
}

const [, , cmd, ...rest] = process.argv;

if (cmd === 'build') {
  const dirs = rest.filter((a) => !a.startsWith('-')).flatMap(expand);
  if (dirs.length === 0) { console.error('loom-plugin build: nothing to build'); process.exit(1); }
  mkdirSync(DEFAULT_OUT, { recursive: true });
  for (const dir of dirs) {
    const { id, files } = await buildPlugin({ srcDir: dir, outDir: DEFAULT_OUT });
    console.log(`built ${id}: ${files.join(', ')}`);
  }
  const ids = await writePluginIndex(DEFAULT_OUT);
  console.log(`index: ${ids.join(', ')}`);
} else if (cmd === 'new') {
  const dir = resolve(REPO_ROOT, rest.find((a) => !a.startsWith('-')) ?? '');
  scaffoldPlugin({ dir, id: basename(dir), lang: rest.includes('--js') ? 'js' : 'ts' });
  console.log(`scaffolded ${dir}`);
} else {
  console.error('usage: loom-plugin build <dir…> | new <dir> [--js]');
  process.exit(1);
}
```

`tools/loom-plugin/scaffold.mjs` — genera un motor mínimo que **suena**: un seno con envolvente, sin TypeScript si se pide `--js`.

```js
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const manifest = (id) => JSON.stringify({
  id, name: id, version: '0.1.0', loomApi: 1,
  main: 'main.js', dsp: 'dsp.js',
  engines: [{
    id, name: id, polyphony: 'poly', clipEditor: 'piano-roll',
    outputTrim: 0.5, shortLabel: id,
    params: [
      { id: 'amp.level', label: 'Level', kind: 'continuous', min: 0, max: 1, default: 0.8 },
      { id: 'amp.release', label: 'Release', kind: 'continuous', min: 0.02, max: 4, default: 0.4, unit: 's' },
    ],
  }],
}, null, 2);

const MAIN = () => `// Main-thread half: hand the host this engine's metadata.
import manifest from './plugin.json';

Loom.registerEngine(manifest.engines[0]);
`;

const DSP_JS = (id) => `// Per-sample DSP half. Runs inside the AudioWorklet, and on the main thread
// for offline render. It may import @loom/plugin-sdk and its own files — nothing else.
import { param, midiToFreq, velGain01 } from '@loom/plugin-sdk';

class Voice {
  constructor(note, p, sampleRate) {
    this.sr = sampleRate;
    this.begin = note.beginSec;
    this.holdEnd = note.beginSec + note.durationSec;
    this.freq = midiToFreq(note.midi);
    this.vel = velGain01(note.velocity, note.accent);
    this.release = param(p, 'amp.release', 0.4);
    this.levelBase = param(p, 'amp.level', 0.8);
    this.live = null;
    this.phase = 0;
    this.done = false;
  }
  noteOff(t) { if (t < this.holdEnd) this.holdEnd = t; }
  setLiveParams(live) { this.live = live; }
  renderSample(t) {
    if (t < this.begin) return 0;
    const level = this.live ? param(this.live, 'amp.level', this.levelBase) : this.levelBase;
    let env = 1;
    if (t > this.holdEnd) {
      env = Math.exp(-(t - this.holdEnd) / this.release);
      if (env < 0.001) { this.done = true; return 0; }
    }
    this.phase += (2 * Math.PI * this.freq) / this.sr;
    return Math.sin(this.phase) * env * level * this.vel;
  }
}

Loom.registerRenderer('${id}', (note, p, sr) => new Voice(note, p, sr));
`;

export function scaffoldPlugin({ dir, id, lang }) {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'plugin.json'), manifest(id));
  writeFileSync(join(dir, lang === 'js' ? 'main.js' : 'main.ts'), MAIN(id));
  writeFileSync(join(dir, lang === 'js' ? 'dsp.js' : 'dsp.ts'), DSP_JS(id));
}
```

- [ ] **Step 5: Run the tests**

```bash
NO_COLOR=1 npx vitest run tools/loom-plugin/build.test.mjs
```

Expected: los cuatro PASS.

- [ ] **Step 6: Scaffold a throwaway plugin and build it, to prove the CLI end to end**

```bash
node tools/loom-plugin/cli.mjs new plugins/sine-probe --js
node tools/loom-plugin/cli.mjs build plugins/sine-probe
cat public/plugins/index.json
rm -rf plugins/sine-probe public/plugins/sine-probe
node tools/loom-plugin/cli.mjs build plugins/*
```

Expected: `built sine-probe: plugin.json, main.js, dsp.js`, y el índice lo lista. Luego se borra: era una prueba del CLI, no un plugin del producto. (El último comando puede no tener nada que construir todavía; es correcto que falle con "nothing to build" hasta la Task 6.)

- [ ] **Step 7: Commit**

```bash
git add tools/loom-plugin package.json package-lock.json
git commit -F - <<'EOF'
feat(plugins): CLI loom-plugin — build y new

build bundlea main/dsp con esbuild y FALLA si el bundle alcanza src/ del host:
esa comprobacion es lo que impide que una dependencia oculta convierta
"drop-in" en mentira. writePluginIndex genera public/plugins/index.json, que es
el mecanismo de descubrimiento (el navegador no puede listar un directorio).

new genera un motor que suena, en JS puro si se pide --js.
EOF
```

---

### Task 6: Karplus como plugin, sonando idéntico

El motor viejo **sigue en el árbol** durante esta tarea: es la referencia contra la que se compara. Se borra en la Task 9.

**Files:**
- Create: `plugins/karplus/plugin.json`, `plugins/karplus/main.ts`, `plugins/karplus/dsp.ts`, `plugins/karplus/presets.json`
- Create: `plugins/karplus/karplus-parity.dsp.test.ts`

**Interfaces:**
- Consumes: `@loom/plugin-sdk` (Task 2), el manifiesto (Task 3), el CLI (Task 5).
- Produces: `public/plugins/karplus/` tras `npm run build:plugins`.

- [ ] **Step 1: Copia los presets**

```bash
mkdir -p plugins/karplus
cp public/presets/karplus.json plugins/karplus/presets.json
```

- [ ] **Step 2: Escribe el manifiesto**

`plugins/karplus/plugin.json` — los params son **exactamente** los nueve de `src/engines/karplus.ts` (`KARPLUS_PARAMS`), copiados sin cambiar un valor, y `outputTrim` es el `ENGINE_TRIM.karplus` de hoy:

```json
{
  "id": "karplus",
  "name": "Karp",
  "version": "1.0.0",
  "loomApi": 1,
  "author": "Loom",
  "main": "main.js",
  "dsp": "dsp.js",
  "presets": "presets.json",
  "engines": [
    {
      "id": "karplus",
      "name": "Karp",
      "polyphony": "poly",
      "clipEditor": "piano-roll",
      "outputTrim": 0.857,
      "shortLabel": "karplus",
      "gm": { "keywords": ["guitar", "gtr", "pluck", "nylon"], "priority": 10 },
      "params": [
        { "id": "string.damping",    "label": "Damping",     "kind": "continuous", "min": 0,     "max": 1,   "default": 0.5 },
        { "id": "string.brightness", "label": "Brightness",  "kind": "continuous", "min": 0,     "max": 1,   "default": 0.65 },
        { "id": "excite.time",       "label": "Excite",      "kind": "continuous", "min": 0.001, "max": 0.1, "default": 0.01, "unit": "s" },
        { "id": "excite.tone",       "label": "Noise Tone",  "kind": "continuous", "min": 0,     "max": 1,   "default": 0.5 },
        { "id": "amp.builtinEnv",    "label": "Built-in Env", "kind": "discrete",  "min": 0,     "max": 1,   "default": 1,
          "options": [{ "value": "off", "label": "Off" }, { "value": "on", "label": "On" }] },
        { "id": "amp.attack",        "label": "Attack",      "kind": "continuous", "min": 0.001, "max": 0.5, "default": 0.005, "unit": "s" },
        { "id": "amp.release",       "label": "Release",     "kind": "continuous", "min": 0.05,  "max": 4,   "default": 0.5,   "unit": "s" },
        { "id": "amp.level",         "label": "Level",       "kind": "continuous", "min": 0,     "max": 1,   "default": 0.8 },
        { "id": "poly.voices",       "label": "Voices",      "kind": "continuous", "min": 1,     "max": 16,  "default": 8 }
      ],
      "modulators": [
        {
          "id": "lfo1",
          "kind": "lfo",
          "enabled": true,
          "connections": [],
          "rateHz": 4,
          "waveform": "sine",
          "bipolar": true,
          "syncToBpm": false,
          "syncBars": 0.25,
          "syncSubdiv": "straight",
          "trigger": "free",
          "scope": "shared"
        },
        {
          "id": "adsr1",
          "kind": "adsr",
          "enabled": true,
          "connections": [],
          "attackSec": 0.01,
          "decaySec": 0.3,
          "sustain": 0.7,
          "releaseSec": 0.3,
          "scope": "per-voice"
        }
      ]
    }
  ]
}
```

> Ese bloque `modulators` **no hay que calcularlo**: es la serialización literal de `[makeDefaultLFO('lfo1'), makeDefaultADSR('adsr1')]`, lo que `src/engines/karplus.ts` declara hoy, obtenida ejecutándolo el 2026-07-29. Sin él, una pista de Karplus arrancaría con el panel de modulación vacío.

- [ ] **Step 3: Escribe `main.ts`**

```ts
// plugins/karplus/main.ts — main-thread half: metadata only.
// Plain JSON import, NOT `with { type: 'json' }`: esbuild 0.21 bundles JSON
// natively, and the import-attribute syntax is newer than the toolchain here.
import manifest from './plugin.json';

Loom.registerEngine(manifest.engines[0] as never);
```

- [ ] **Step 4: Escribe `dsp.ts`**

Copia **íntegro** el contenido de `src/audio-dsp/karplus-renderer.ts` y aplícale exactamente cuatro cambios:

1. Sustituye todos los imports por uno solo:
   ```ts
   import { param, midiToFreq, velGain01, ModEnvHost } from '@loom/plugin-sdk';
   import type { NoteSpec, ParamBag, VoiceRenderer, VoiceModOffsets, ModLite } from '@loom/plugin-sdk';
   ```
2. Borra `import { synthTrim } from './gain-staging'`.
3. **Quita el trim por motor del render.** La línea

   ```ts
   let out = raw * env * level * this.vel * synthTrim('karplus') * trim;
   ```

   pasa a ser

   ```ts
   // No engine trim here: it is a manifest capability (`outputTrim`) that the
   // host multiplies in, together with its synth category gain. `trim` below is
   // the per-PRESET balance (params['output.trim']), which IS the plugin's.
   let out = raw * env * level * this.vel * trim;
   ```
4. Cambia la última línea `registerRenderer('karplus', …)` por:
   ```ts
   Loom.registerRenderer('karplus', (n, p, sr) => new KarplusRenderer(n, p, sr));
   ```

- [ ] **Step 5: Write the parity test**

`plugins/karplus/karplus-parity.dsp.test.ts` — compara el renderer del plugin contra el de `src/`, muestra a muestra, con la misma semilla de ruido:

```ts
import { describe, it, expect } from 'vitest';
import { KarplusRenderer as PluginKarplus } from './dsp';
import { KarplusRenderer as HostKarplus } from '../../src/audio-dsp/karplus-renderer';
import type { NoteSpec } from '@loom/plugin-sdk';

const SR = 48000;
const note: NoteSpec = { midi: 57, beginSec: 0, durationSec: 0.5, velocity: 0.8, accent: false, slide: false };
const params = { 'string.damping': 0.5, 'string.brightness': 0.65, 'amp.level': 0.8, 'amp.release': 0.5 };

/** Deterministic excitation so both renderers get the SAME noise burst — the
 *  pluck is random by design, and without a shared seed the comparison would be
 *  meaningless. */
function seeded(): () => number {
  let s = 12345;
  return () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; };
}

function render(make: (rng: () => number) => { renderSample(t: number): number }): Float32Array {
  const r = make(seeded());
  const n = Math.round(0.6 * SR);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = r.renderSample(i / SR);
  return out;
}

describe('the Karplus plugin renderer', () => {
  it('renders the same signal as the in-tree renderer, up to the host trim', () => {
    const host = render((rng) => new HostKarplus(note, params, SR, rng));
    const plug = render((rng) => new PluginKarplus(note, params, SR, rng));

    // The plugin no longer multiplies by its own engine trim — the host does
    // that now — so compare SHAPE: the ratio between the two must be one
    // constant across the whole render.
    let peakHost = 0;
    for (const v of host) peakHost = Math.max(peakHost, Math.abs(v));
    let peakPlug = 0;
    for (const v of plug) peakPlug = Math.max(peakPlug, Math.abs(v));
    expect(peakHost).toBeGreaterThan(0);
    expect(peakPlug).toBeGreaterThan(0);

    const k = peakHost / peakPlug;
    let worst = 0;
    for (let i = 0; i < host.length; i++) {
      const d = Math.abs(host[i] - plug[i] * k);
      if (d > worst) worst = d;
    }
    // Relative: the worst deviation must be a vanishing fraction of the peak.
    expect(worst / peakHost).toBeLessThan(1e-6);
  });
});
```

- [ ] **Step 6: Run it to watch it fail, then make it pass**

```bash
NO_COLOR=1 npx vitest run plugins/karplus/karplus-parity.dsp.test.ts
```

Expected primero: FAIL (falta `./dsp`). Tras escribir `dsp.ts`: PASS. Si la desviación no baja de `1e-6`, la copia difiere del original — encuentra la diferencia, no relajes el umbral.

- [ ] **Step 7: Build the plugin for real**

```bash
npm run build:plugins
ls public/plugins/karplus
```

Expected: `plugin.json  main.js  dsp.js  presets.json`, y `public/plugins/index.json` con `["karplus"]`.

- [ ] **Step 8: Commit**

```bash
git add plugins public/plugins
git commit -F - <<'EOF'
feat(plugins): Karplus como plugin, con test de paridad muestra a muestra

El renderer del plugin y el del arbol se comparan con la MISMA semilla de ruido
(la excitacion es aleatoria por diseno) y con tolerancia relativa al pico. El
motor viejo sigue en src/ a proposito: es la referencia. Se borra al final.

El renderer del plugin ya no multiplica por su propio trim de motor — eso pasa
a ser capacidad del manifiesto y lo aplica el host.
EOF
```

---

### Task 7: Las capacidades que el core lee

Aquí desaparecen las comparaciones por id que tocan a Karplus.

**Files:**
- Create: `src/plugin-host/plugin-capabilities.ts`
- Create: `src/plugin-host/plugin-capabilities.test.ts`
- Modify: `src/audio-dsp/gain-staging.ts`, `src/session/session-host-util.ts`, `src/midi/gm-lookup.ts`, `src/app/lane-allocator.ts`, `src/app/bpm-broadcast.ts`, `src/presets/preset-loader.ts`
- Modify: `src/session/session-host-util.test.ts` (si existe; si no, créalo con el caso nuevo)

**Interfaces:**
- Consumes: `registeredPluginEngines()` (Task 4).
- Produces:
  - `outputTrimFor(engineId): number | undefined`
  - `shortLabelFor(engineId): string | undefined`
  - `pluginGmHints(): { keywords: string[]; engineId: string; priority: number }[]`
  - `isWorkletHosted(engineId): boolean`
  - `seedEnginePresets(engineId, presets): void` (en `preset-loader`, renombrado desde `__seedPresetCache`)

- [ ] **Step 1: Write the failing test**

`src/plugin-host/plugin-capabilities.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { installMainThreadLoomApi, __resetPluginEngines } from './loom-api';
import { outputTrimFor, shortLabelFor, pluginGmHints, isWorkletHosted } from './plugin-capabilities';
import type { EngineManifest } from '@loom/plugin-sdk';

const m: EngineManifest = {
  id: 'probe', name: 'Probe', polyphony: 'poly', clipEditor: 'piano-roll',
  outputTrim: 0.5, shortLabel: 'prb',
  gm: { keywords: ['probe', 'prb'], priority: 5 },
  params: [{ id: 'amp.level', label: 'Level', kind: 'continuous', min: 0, max: 1, default: 0.8 }],
};

describe('plugin capabilities', () => {
  beforeEach(() => {
    __resetPluginEngines();
    installMainThreadLoomApi();
    (globalThis as unknown as { Loom: { registerEngine(x: EngineManifest): void } }).Loom.registerEngine(m);
  });

  it('answers the output trim from the manifest', () => {
    expect(outputTrimFor('probe')).toBe(0.5);
    expect(outputTrimFor('not-a-plugin')).toBeUndefined();
  });

  it('answers the lane-id prefix from the manifest', () => {
    expect(shortLabelFor('probe')).toBe('prb');
  });

  it('surfaces GM name hints with their priority', () => {
    expect(pluginGmHints()).toEqual([{ keywords: ['probe', 'prb'], engineId: 'probe', priority: 5 }]);
  });

  it('treats an engine that declares DSP as worklet-hosted', () => {
    expect(isWorkletHosted('probe')).toBe(true);
    expect(isWorkletHosted('sampler')).toBe(false);
  });
});
```

- [ ] **Step 2: Run it to watch it fail**

```bash
NO_COLOR=1 npx vitest run src/plugin-host/plugin-capabilities.test.ts
```

Expected: FAIL — no existe `./plugin-capabilities`.

- [ ] **Step 3: Write the implementation**

`src/plugin-host/plugin-capabilities.ts`:

```ts
// The ONLY reader of plugin capabilities. Every question the host used to answer
// with `engineId === '…'` comes through here, so there is exactly one place that
// knows how a manifest maps onto host behaviour.
import { registeredPluginEngines } from './loom-api';

export function outputTrimFor(engineId: string): number | undefined {
  return registeredPluginEngines().get(engineId)?.outputTrim;
}

export function shortLabelFor(engineId: string): string | undefined {
  return registeredPluginEngines().get(engineId)?.shortLabel;
}

export function pluginGmHints(): { keywords: string[]; engineId: string; priority: number }[] {
  const out: { keywords: string[]; engineId: string; priority: number }[] = [];
  for (const [id, m] of registeredPluginEngines()) {
    if (m.gm) out.push({ keywords: m.gm.keywords, engineId: id, priority: m.gm.priority });
  }
  return out.sort((a, b) => a.priority - b.priority);
}

/** A plugin engine synthesises in the worklet exactly when it shipped a
 *  renderer. Nothing to keep in sync by hand. */
export function isWorkletHosted(engineId: string): boolean {
  return registeredPluginEngines().has(engineId);
}
```

Nota: `isWorkletHosted` devuelve true para cualquier motor de plugin registrado. En este trozo todo plugin trae `dsp`; cuando llegue un plugin sin DSP, la comprobación se afina leyendo el fichero de manifiesto (Task 8 ya guarda el `PluginManifestFile` completo).

- [ ] **Step 4: Run the test**

```bash
NO_COLOR=1 npx vitest run src/plugin-host/plugin-capabilities.test.ts
```

Expected: PASS.

- [ ] **Step 5: Enchufa las capacidades en los cinco puntos del core**

**El trim del motor: por qué NO se toca `synthTrim`.** El renderer de un plugin no puede aplicar su propio trim — el número vive en el manifiesto y duplicarlo en el JS compilado sería dos fuentes de verdad. Así que lo aplica el host. Pero `synthTrim` lo llaman los renderers **dentro del worklet**, y `plugin-capabilities` arrastra `loom-api` → `engines/registry` → `preset-loader` (`fetch`, `import.meta.env`): meter eso en el bundle del worklet sería un error. Por eso `gain-staging.ts` se queda como está salvo por una línea, y el trim del plugin viaja como **dato**, desde el hilo principal hasta el procesador.

En `src/audio-dsp/gain-staging.ts`, **solo** borra la entrada `karplus: 0.857` de `ENGINE_TRIM` (su comentario histórico se conserva en el commit; el valor vive ahora en el manifiesto del plugin).

En `src/plugin-host/plugin-capabilities.ts` añade el único traductor:

```ts
import { CATEGORY_GAIN } from '../audio-dsp/gain-staging';

/** What the host must multiply a PLUGIN engine's voices by: the engine's own
 *  declared balance times the synth category gain — exactly what synthTrim()
 *  computes for an in-tree engine. Undefined for an engine that is not a
 *  plugin, so callers fall back to 1 and the in-tree renderer's own
 *  multiplication stands. */
export function pluginSynthTrim(engineId: string): number | undefined {
  const t = outputTrimFor(engineId);
  return t === undefined ? undefined : t * CATEGORY_GAIN.synth;
}
```

Y el dato recorre los cinco eslabones, todos verificados como puntos únicos:

1. `src/app/lane-allocator.ts` — en `createLaneEngine`, la construcción del `WorkletLaneEngine` gana un campo: `outputTrim: pluginSynthTrim(engineId) ?? 1`.
2. `src/engines/worklet-lane-engine.ts` — `WorkletLaneEngineConfig` gana `outputTrim?: number`, y la línea 240 pasa a `this.worklet = new LoomWorkletNode(ctx, cfg.engineId, cfg.outputTrim ?? 1);`.
3. `src/audio-worklet/loom-node.ts` — el constructor gana el tercer parámetro y lo mete en las opciones del procesador:

   ```ts
   constructor(ctx: BaseAudioContext, engineId = 'subtractive', outputTrim = 1) {
     this.node = new AudioWorkletNode(ctx, LOOM_PROCESSOR_NAME, {
       outputChannelCount: [2],
       // outputTrim is STRUCTURAL (it comes from the plugin manifest, not a
       // knob), so it travels once at construction rather than as a param.
       processorOptions: { engineId, outputTrim },
     });
   ```

4. `src/audio-worklet/loom-processor.ts` — lo lee junto al `engineId` y lo pasa al `VoiceManager`:

   ```ts
   const opts = (options as { processorOptions?: { engineId?: string; outputTrim?: number } } | undefined)?.processorOptions;
   const engineId = opts?.engineId ?? 'subtractive';
   this.vm = new VoiceManager(sampleRate, engineId, {}, opts?.outputTrim ?? 1);
   ```

5. `src/audio-dsp/voice-manager.ts` — el constructor gana el parámetro y `renderSample` lo aplica en el único punto de suma (línea 225):

   ```ts
   constructor(private sr: number, private engineId: string, params: ParamBag,
               private readonly outputTrim = 1) {
   ```

   ```ts
   out += s.v.renderSample(t, mo as VoiceModOffsets | undefined) * this.outputTrim;
   ```

   El valor por defecto de 1 es lo que deja intactos a los seis motores del árbol, que siguen aplicándose su `synthTrim` dentro del renderer. Cuando migren (trozo 2), esa multiplicación interna desaparece y todos pasan por aquí.

Y el camino offline: en `src/export/kernel-lane-render.ts`, `KernelLaneSpec` gana `outputTrim?: number` y la línea 61 pasa a `new VoiceManager(sampleRate, spec.engineId, spec.params, spec.outputTrim ?? 1)`. **El campo lo rellena quien construye el spec** (`offline-recorder.ts`, hilo principal, con `pluginSynthTrim(engineId) ?? 1`); `kernel-lane-render.ts` NO importa `plugin-capabilities`, para que siga siendo puro y testeable sin `fetch`.

Cúbrelo con un test en `src/audio-dsp/voice-manager.test.ts` (o créalo):

```ts
it('scales every voice by the engine output trim the host handed it', () => {
  registerRenderer('probe-trim', (): VoiceRenderer => ({
    done: false, noteOff() {}, renderSample() { return 1; },
  }));
  const note = { midi: 60, beginSec: 0, durationSec: 1, velocity: 1, accent: false, slide: false };
  const full = new VoiceManager(48000, 'probe-trim', {});
  const half = new VoiceManager(48000, 'probe-trim', {}, 0.5);
  full.spawn(note); half.spawn(note);
  // Relative: the trimmed lane must be exactly half the untrimmed one.
  expect(half.renderSample(0) / full.renderSample(0)).toBeCloseTo(0.5, 10);
});
```

`src/session/session-host-util.ts` — `nextLaneSlug` pregunta antes de mirar su tabla:

```ts
import { shortLabelFor } from '../plugin-host/plugin-capabilities';

export function nextLaneSlug(existingIds: ReadonlySet<string>, engineId: string): string {
  const prefix =
    shortLabelFor(engineId) ??
    (engineId === 'tb303'         ? 'tb-303'      :
     engineId === 'drums-machine' ? 'drums'       :
     engineId === 'subtractive'   ? 'subtractive' :
     engineId === 'wavetable'     ? 'wavetable'   :
     engineId === 'fm'            ? 'fm-4-op'     :
     engineId === 'westcoast'     ? 'west'        :
                                    engineId);
  for (let i = 1; i <= 99; i++) {
    const candidate = `${prefix}-${i}`;
    if (!existingIds.has(candidate)) return candidate;
  }
  return `${prefix}-overflow`;
}
```

`src/midi/gm-lookup.ts` — la tabla se fusiona con las pistas de los plugins. Sustituye `NAME_ENGINE_HINTS` y `engineHintFromName`:

```ts
import { pluginGmHints } from '../plugin-host/plugin-capabilities';

// Track-name → engine-family hints. Order matters (first hit wins), so each
// entry carries a priority: plugins declare theirs in their manifest and get
// merged into this list instead of being hardcoded here. (Original ordering
// preserved: karplus 10, fm 20/30, subtractive 40–70.)
const STATIC_HINTS: { kw: string[]; engineId: string; priority: number }[] = [
  { kw: ['rhodes', 'wurli', 'wurlitzer', 'tine', 'epiano', 'e.piano', 'e piano'], engineId: 'fm', priority: 20 },
  { kw: ['bell', 'glock', 'chime', 'mallet', 'vibe', 'marimba', 'kalimba'],   engineId: 'fm', priority: 30 },
  { kw: ['pad', 'string', 'choir', 'voice', 'vox', 'brass', 'horn', 'orch', 'ensemble'], engineId: 'subtractive', priority: 40 },
  { kw: ['piano', 'keys', 'organ', 'clav', 'harpsi'],                          engineId: 'subtractive', priority: 50 },
  { kw: ['bass'],                                                              engineId: 'subtractive', priority: 60 },
  { kw: ['lead', 'synth', 'saw', 'square', 'arp', 'seq', 'poly'],              engineId: 'subtractive', priority: 70 },
];

function allNameHints(): { kw: string[]; engineId: string; priority: number }[] {
  const fromPlugins = pluginGmHints().map((h) => ({ kw: h.keywords, engineId: h.engineId, priority: h.priority }));
  return [...fromPlugins, ...STATIC_HINTS].sort((a, b) => a.priority - b.priority);
}

export function engineHintFromName(name: string | undefined): string | null {
  const n = (name ?? '').toLowerCase();
  if (!n) return null;
  for (const h of allNameHints()) {
    if (h.kw.some((k) => n.includes(k))) return h.engineId;
  }
  return null;
}
```

`src/app/lane-allocator.ts` — `WORKLET_ENGINE_IDS` deja de ser una lista escrita a mano:

```ts
import { isWorkletHosted } from '../plugin-host/plugin-capabilities';

// Melodic engines that synthesise per-sample in the AudioWorklet. Built-ins are
// still listed here; a PLUGIN engine qualifies by having shipped a renderer, so
// nothing has to be added by hand when one is installed.
const BUILTIN_WORKLET_ENGINE_IDS = new Set(['subtractive', 'tb303', 'fm', 'wavetable', 'westcoast']);

/** Exported for the registry-driven live-params test, which walks every
 *  worklet-hosted engine. */
export const WORKLET_ENGINE_IDS = {
  has: (id: string): boolean => BUILTIN_WORKLET_ENGINE_IDS.has(id) || isWorkletHosted(id),
  [Symbol.iterator]: (): Iterator<string> => BUILTIN_WORKLET_ENGINE_IDS[Symbol.iterator](),
};
```

Los consumidores ya están verificados: **todos usan `.has(...)` salvo uno**, `src/audio-dsp/live-params.dsp.test.ts:100`, que lo expande con `[...WORKLET_ENGINE_IDS]` — de ahí el `[Symbol.iterator]` de arriba. Ese test recorrerá a partir de ahora solo los cinco built-ins, que es lo correcto: el renderer de Karplus ya no vive en `src/`, y su equivalente lo cubre el test de paridad de la Task 6.

`src/app/bpm-broadcast.ts` — borra `LANE_HOST_ENGINE_IDS`, la función `propagateToLaneEngines`, su llamada dentro de `broadcast`, y el `import { getEngine }`.

> **Está muerto, ya verificado** (ver "Hechos verificados"): el bucle escribe `.bpm` sobre lo que devuelve `getEngine(id)` — el descriptor de `createDescriptorEngine`, que no tiene esa propiedad. Los únicos objetos con `bpm` son las instancias POR PISTA (`WorkletLaneEngine`, `DrumsWorkletEngine`, `SamplerWorkletEngine`), que nunca están en el registro. **No arregles el bug latente aquí** (que `WorkletLaneEngine.bpm` no lo asigne nadie, y por tanto un LFO en SYNC no siga el tempo en los seis motores melódicos): eso es otro trabajo, con su propio test. Menciónalo en el mensaje del commit para que el borrado no lo entierre.

`src/presets/preset-loader.ts` — el sembrado deja de ser solo-para-tests:

```ts
/** Seed the cache directly, bypassing the fetch. Two callers: the plugin host
 *  (a plugin ships its presets inside its own directory, not in public/presets)
 *  and tests. */
export function seedEnginePresets(engineId: string, presets: EnginePreset[]): void {
  cache.set(engineId, presets);
}

/** @deprecated Use seedEnginePresets. Kept so existing tests keep compiling. */
export const __seedPresetCache = seedEnginePresets;
```

- [ ] **Step 6: Run the full suite**

```bash
npx tsc --noEmit
npm run test:unit
```

Expected: verde. Si algún test afirmaba el orden de `NAME_ENGINE_HINTS` o el contenido de `WORKLET_ENGINE_IDS`, arréglalo aquí — con los plugins registrados el resultado debe ser el MISMO que antes.

- [ ] **Step 7: Commit**

```bash
git add src/plugin-host src/audio-dsp/gain-staging.ts src/session/session-host-util.ts src/midi/gm-lookup.ts src/app/lane-allocator.ts src/app/bpm-broadcast.ts src/presets/preset-loader.ts
git commit -F - <<'EOF'
feat(plugins): el core pregunta capacidades en vez de comparar ids

outputTrim, shortLabel, pistas GM y "sintetiza en el worklet" salen ahora del
manifiesto. LANE_HOST_ENGINE_IDS se borra entero: su bucle buscaba una
propiedad `bpm` que ningun descriptor de motor tiene desde el cutover al
worklet, asi que no hacia nada.
EOF
```

---

### Task 8: El host de plugins y la puerta de arranque

**Files:**
- Create: `src/plugin-host/plugin-host.ts`
- Create: `src/plugin-host/plugin-host.test.ts`
- Create: `src/plugin-host/plugin-dsp.ts`
- Modify: `src/main.ts`
- Modify: `src/export/kernel-lane-render.ts`

**Interfaces:**
- Consumes: `validatePluginManifest` (Task 3), `installMainThreadLoomApi` (Task 4), `seedEnginePresets` (Task 7).
- Produces:
  - `loadPlugins(opts?: { baseUrl?: string; fetchImpl?: typeof fetch; importImpl?: (url: string) => Promise<unknown> }): Promise<PluginLoadReport>`
  - `PluginLoadReport = { loaded: string[]; failed: { id: string; error: string }[]; dspUrls: string[] }`
  - `loadPluginDspModules(ctx: BaseAudioContext, urls: string[]): Promise<void>`
  - `importPluginDspOnMainThread(urls: string[]): Promise<void>`

- [ ] **Step 1: Write the failing test**

`src/plugin-host/plugin-host.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { loadPlugins } from './plugin-host';
import { __resetPluginEngines } from './loom-api';
import { getEngineDescriptor } from '../engines/registry';
import { getCachedPresets, __resetPresetCache } from '../presets/preset-loader';

const MANIFEST = {
  id: 'probe', name: 'Probe', version: '1.0.0', loomApi: 1,
  main: 'main.js', dsp: 'dsp.js', presets: 'presets.json',
  engines: [{
    id: 'probe', name: 'Probe', polyphony: 'poly', clipEditor: 'piano-roll',
    outputTrim: 0.5, shortLabel: 'probe',
    params: [{ id: 'amp.level', label: 'Level', kind: 'continuous', min: 0, max: 1, default: 0.8 }],
  }],
};

function fakeFetch(files: Record<string, unknown>): typeof fetch {
  return (async (url: string) => {
    const key = Object.keys(files).find((k) => String(url).endsWith(k));
    if (key === undefined) return { ok: false, status: 404, json: async () => ({}) } as unknown as Response;
    return { ok: true, status: 200, json: async () => files[key] } as unknown as Response;
  }) as unknown as typeof fetch;
}

beforeEach(() => { __resetPluginEngines(); __resetPresetCache(); });

describe('loadPlugins', () => {
  it('loads a plugin listed in the index and registers its engine', async () => {
    const report = await loadPlugins({
      baseUrl: '/',
      fetchImpl: fakeFetch({
        'plugins/index.json': { plugins: ['probe'] },
        'plugins/probe/plugin.json': MANIFEST,
        'plugins/probe/presets.json': { engineId: 'probe', presets: [{ name: 'Init', gm: [], params: {} }] },
      }),
      importImpl: async () => {
        (globalThis as unknown as { Loom: { registerEngine(m: unknown): void } })
          .Loom.registerEngine(MANIFEST.engines[0]);
      },
    });
    expect(report.loaded).toEqual(['probe']);
    expect(report.failed).toEqual([]);
    expect(getEngineDescriptor('probe')?.name).toBe('Probe');
    expect(getCachedPresets('probe').map((p) => p.name)).toEqual(['Init']);
    expect(report.dspUrls.some((u) => u.endsWith('plugins/probe/dsp.js'))).toBe(true);
  });

  it('records a plugin whose module throws, and keeps loading the others', async () => {
    const report = await loadPlugins({
      baseUrl: '/',
      fetchImpl: fakeFetch({
        'plugins/index.json': { plugins: ['boom', 'probe'] },
        'plugins/boom/plugin.json': { ...MANIFEST, id: 'boom' },
        'plugins/probe/plugin.json': MANIFEST,
      }),
      importImpl: async (url: string) => {
        if (url.includes('boom')) throw new Error('kaboom');
        (globalThis as unknown as { Loom: { registerEngine(m: unknown): void } })
          .Loom.registerEngine(MANIFEST.engines[0]);
      },
    });
    expect(report.loaded).toEqual(['probe']);
    expect(report.failed).toEqual([{ id: 'boom', error: 'kaboom' }]);
  });

  it('refuses an incompatible plugin WITHOUT importing its code', async () => {
    let imported = false;
    const report = await loadPlugins({
      baseUrl: '/',
      fetchImpl: fakeFetch({
        'plugins/index.json': { plugins: ['future'] },
        'plugins/future/plugin.json': { ...MANIFEST, id: 'future', loomApi: 99 },
      }),
      importImpl: async () => { imported = true; },
    });
    expect(imported).toBe(false);
    expect(report.failed[0].id).toBe('future');
    expect(report.failed[0].error).toContain('loomApi');
  });

  it('survives a missing index without throwing', async () => {
    const report = await loadPlugins({ baseUrl: '/', fetchImpl: fakeFetch({}), importImpl: async () => {} });
    expect(report.loaded).toEqual([]);
    expect(report.failed).toEqual([]);
  });
});
```

- [ ] **Step 2: Run it to watch it fail**

```bash
NO_COLOR=1 npx vitest run src/plugin-host/plugin-host.test.ts
```

Expected: FAIL — no existe `./plugin-host`.

- [ ] **Step 3: Write the implementation**

`src/plugin-host/plugin-host.ts`:

```ts
// Discovery and main-thread loading of plugins.
//
// The browser cannot list a directory, so `plugins/index.json` IS the discovery
// mechanism. Each plugin is validated as DATA before a single line of it runs,
// and a plugin that throws is recorded and skipped — one bad plugin must never
// take the app down with it.
import { validatePluginManifest } from './manifest-validate';
import { installMainThreadLoomApi } from './loom-api';
import { seedEnginePresets } from '../presets/preset-loader';
import { validatePresetEntry } from '../presets/preset-loader';
import type { EnginePreset } from '../engines/engine-types';

export interface PluginLoadReport {
  loaded: string[];
  failed: { id: string; error: string }[];
  /** Absolute-ish URLs of every `dsp.js`, in load order. Handed to the worklet
   *  loader and to the offline path. */
  dspUrls: string[];
}

export interface LoadPluginsOptions {
  baseUrl?: string;
  fetchImpl?: typeof fetch;
  importImpl?: (url: string) => Promise<unknown>;
}

const errText = (e: unknown): string => (e instanceof Error ? e.message : String(e));

export async function loadPlugins(opts: LoadPluginsOptions = {}): Promise<PluginLoadReport> {
  const base = opts.baseUrl ?? import.meta.env.BASE_URL;
  const doFetch = opts.fetchImpl ?? fetch;
  const doImport = opts.importImpl ?? ((url: string) => import(/* @vite-ignore */ url));

  installMainThreadLoomApi();

  const report: PluginLoadReport = { loaded: [], failed: [], dspUrls: [] };

  let ids: string[] = [];
  try {
    const res = await doFetch(`${base}plugins/index.json`);
    if (res.ok) {
      const body = (await res.json()) as { plugins?: unknown };
      if (Array.isArray(body.plugins)) ids = body.plugins.filter((v): v is string => typeof v === 'string');
    }
  } catch {
    // No index at all: a build with no plugins. Not an error.
    return report;
  }

  for (const id of ids) {
    const dir = `${base}plugins/${id}/`;
    try {
      const res = await doFetch(`${dir}plugin.json`);
      if (!res.ok) throw new Error(`plugin.json returned ${res.status}`);
      const verdict = validatePluginManifest(await res.json());
      if (!verdict.ok) throw new Error(verdict.error);
      const manifest = verdict.manifest;

      // Presets first: a plugin's engine reads getCachedPresets(id) the moment
      // its descriptor is built, so the cache must already hold them.
      if (manifest.presets) {
        try {
          const pres = await doFetch(`${dir}${manifest.presets}`);
          if (pres.ok) {
            const body = (await pres.json()) as { presets?: unknown[] };
            const clean = (body.presets ?? []).filter(validatePresetEntry) as EnginePreset[];
            seedEnginePresets(manifest.id, clean);
          }
        } catch { /* a plugin with no usable presets still loads */ }
      }

      await doImport(`${dir}${manifest.main}`);
      if (manifest.dsp) report.dspUrls.push(`${dir}${manifest.dsp}`);
      report.loaded.push(id);
    } catch (e) {
      report.failed.push({ id, error: errText(e) });
      console.warn(`[plugin-host] "${id}" failed to load:`, e);
    }
  }
  return report;
}
```

`src/plugin-host/plugin-dsp.ts`:

```ts
// Getting a plugin's per-sample DSP into the two realms that run it.
//
// ORDER MATTERS in the worklet: loom-processor.ts installs globalThis.Loom
// there, so its addModule must have resolved before any plugin dsp.js is added.
// Callers pass a context whose Loom module is already loaded.

/** Add every plugin dsp.js to a context's AudioWorklet, sequentially. */
export async function loadPluginDspModules(ctx: BaseAudioContext, urls: string[]): Promise<void> {
  for (const url of urls) {
    try {
      await ctx.audioWorklet.addModule(url);
    } catch (e) {
      console.warn(`[plugin-host] worklet module failed: ${url}`, e);
    }
  }
}

/** Import every plugin dsp.js on the MAIN thread too — the offline exporter runs
 *  the same pure kernel here, so without this an export would render silence for
 *  every plugin engine. */
export async function importPluginDspOnMainThread(urls: string[]): Promise<void> {
  for (const url of urls) {
    try {
      await import(/* @vite-ignore */ url);
    } catch (e) {
      console.warn(`[plugin-host] main-thread dsp import failed: ${url}`, e);
    }
  }
}
```

- [ ] **Step 4: Run the test**

```bash
NO_COLOR=1 npx vitest run src/plugin-host/plugin-host.test.ts
```

Expected: los cuatro PASS.

- [ ] **Step 5: Enchufa la puerta en `main.ts`**

En `src/main.ts`, sustituye el bloque de bootstrap y el de presets (líneas ~89-99) por:

```ts
// ── Plugin bootstrap (must run BEFORE preset cache + audio graph) ─────────
bootstrapPlugins();

// Runtime plugins: fetched, validated and imported before anything reads the
// engine registry. Everything downstream chains off this promise instead of
// awaiting at module scope, so boot order stays explicit and top-level await
// stays out of the bundle.
const pluginsReady = loadPlugins();

// ── Preset cache ───────────────────────────────────────────────────────────
// Derived from the plugin registry so adding a new synth plugin automatically
// triggers its JSON preset file load (if /public/presets/<id>.json exists).
// A runtime plugin ships its own presets and has already seeded the cache, so
// it is skipped here.
const presetsLoaded = pluginsReady.then((report) => loadAllPresets(
  listPlugins('synth').map((p) => p.manifest.id).filter((id) => !report.loaded.includes(id)),
));
```

Y el bloque de `workletReady` (línea ~124) pasa a incluir los módulos DSP de los plugins:

```ts
const workletReady: Promise<void> = Promise.all([
  loadLoomWorklet(ctx).then(async () => {
    // Strictly after the host module: it is what installs globalThis.Loom inside
    // the worklet, and a plugin dsp.js added before it would find no registry.
    const report = await pluginsReady;
    await loadPluginDspModules(ctx, report.dspUrls);
    await importPluginDspOnMainThread(report.dspUrls);
  }),
  loadDrumsWorklet(ctx),
  loadSamplerWorklet(ctx),
  loadDuckWorklet(ctx),
]).then(() => undefined);
```

Añade los imports arriba:

```ts
import { loadPlugins } from './plugin-host/plugin-host';
import { loadPluginDspModules, importPluginDspOnMainThread } from './plugin-host/plugin-dsp';
```

> El bloque original (`main.ts:124-130`) es `Promise.all([loadLoomWorklet(ctx), loadDrumsWorklet(ctx), loadSamplerWorklet(ctx), loadDuckWorklet(ctx)])`. El único cambio es envolver el primer elemento; conserva el resto tal cual, incluido el comentario sobre el detector de sidechain que precede a `loadDuckWorklet`.

- [ ] **Step 6: Build + full suite + a real listen**

```bash
npx tsc --noEmit
npm run build
npm run test:unit
npm run dev
```

Abre <http://localhost:5173> **en Chrome de verdad** (no el navegador embebido de VS Code), añade una pista Karplus desde el selector de motor y toca. Tiene que sonar.

- [ ] **Step 7: Commit**

```bash
git add src/plugin-host src/main.ts
git commit -F - <<'EOF'
feat(plugins): host de carga y puerta de arranque

index.json es el mecanismo de descubrimiento (el navegador no lista
directorios). Cada plugin se valida como DATO antes de ejecutar una linea suya,
y uno que revienta se registra y se salta sin tumbar el arranque.

Los dsp.js se anaden al worklet DESPUES del modulo del host — que es quien
instala alli globalThis.Loom — y se importan tambien en el hilo principal, sin
lo cual el export offline renderizaria silencio para todo motor de plugin.
EOF
```

---

### Task 9: Borrar Karplus de `src/` y verificar la aceptación

**Files:**
- Delete: `src/engines/karplus.ts`, `src/audio-dsp/karplus-renderer.ts`, `public/presets/karplus.json`
- Modify: `src/audio-worklet/loom-processor.ts`, `src/export/kernel-lane-render.ts`
- Modify: `plugins/karplus/karplus-parity.dsp.test.ts` (deja de comparar contra el fichero borrado)
- Create: `tests/e2e/plugin-karplus.spec.ts`

**Interfaces:**
- Consumes: todo lo anterior.
- Produces: los cuatro criterios de aceptación del spec, verificados.

- [ ] **Step 1: Convierte el test de paridad en un test de referencia congelada**

El fichero contra el que comparaba va a desaparecer. Antes de borrar nada, genera la referencia y guárdala:

```bash
NO_COLOR=1 npx tsx -e "
import { KarplusRenderer } from './src/audio-dsp/karplus-renderer';
const SR = 48000;
let s = 12345; const rng = () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; };
const r = new KarplusRenderer({ midi: 57, beginSec: 0, durationSec: 0.5, velocity: 0.8, accent: false, slide: false }, { 'string.damping': 0.5, 'string.brightness': 0.65, 'amp.level': 0.8, 'amp.release': 0.5 }, SR, rng);
const n = Math.round(0.6 * SR); const out = [];
for (let i = 0; i < n; i++) out.push(r.renderSample(i / SR));
// Sample every 512th value: enough to pin the shape, small enough to commit.
console.log(JSON.stringify(out.filter((_, i) => i % 512 === 0)));
" > plugins/karplus/reference-render.json
```

Reescribe `plugins/karplus/karplus-parity.dsp.test.ts` para comparar contra ese JSON en lugar de contra el módulo borrado, manteniendo la misma tolerancia relativa (`worst / peak < 1e-6`) y la misma normalización por pico.

- [ ] **Step 2: Borra el motor del árbol**

```bash
git rm src/engines/karplus.ts src/audio-dsp/karplus-renderer.ts public/presets/karplus.json
```

**Los ocho ficheros que lo importan, enumerados** (`grep` ejecutado el 2026-07-29; `KARPLUS_DEFAULT_MODULATORS` no lo importa nadie fuera de su propio fichero):

| Fichero | Qué quitar |
|---|---|
| `src/audio-worklet/loom-processor.ts:20` | el `import '../audio-dsp/karplus-renderer';` |
| `src/export/kernel-lane-render.ts:29` | el mismo import |
| `src/app/lane-allocator.test.ts:8,117` | el import y la fila `['karplus'],` de la tabla |
| `src/engines/registry-descriptor.test.ts:13,25` | el import y la fila `['karplus', 'poly'],` |
| `src/engines/registry-boot.test.ts:16,29,42` | el import y **dos** filas `['karplus'],` |
| `src/session/engine-param-persistence.test.ts:14,41` | el import y `'karplus'` de `ENGINE_IDS` |
| `src/session/session-add-lane.test.ts:6,33-35` | el import; el test se **reescribe**, ver abajo |
| `test/engine-fixtures.ts:13,65-69,73,84` | el import, el bag `karplus:` de `DEFAULT_BAGS`, `'karplus'` de `MELODIC_IDS` y el `case 'karplus':` de `makeRenderer` |

**`session-add-lane.test.ts` se reescribe en vez de borrarse.** Su caso de hoy (`nextLaneSlug(new Set([]), 'karplus') === 'karplus-1'`) seguiría pasando por pura casualidad — sin plugins cargados, el prefijo cae al `engineId` por defecto. Cámbialo por el caso que de verdad importa ahora: que el `shortLabel` del manifiesto manda.

```ts
import { installMainThreadLoomApi, __resetPluginEngines } from '../plugin-host/loom-api';

it('a plugin engine takes its lane prefix from the manifest shortLabel', () => {
  __resetPluginEngines();
  installMainThreadLoomApi();
  (globalThis as unknown as { Loom: { registerEngine(m: unknown): void } }).Loom.registerEngine({
    id: 'karplus', name: 'Karp', polyphony: 'poly', clipEditor: 'piano-roll',
    outputTrim: 0.857, shortLabel: 'karplus', params: [],
  });
  expect(nextLaneSlug(new Set([]), 'karplus')).toBe('karplus-1');
});
```

**`src/audio-dsp/gain-staging-velocity.test.ts` también se rompe**, y no por el import: su `levelRatio` lee `ENGINE_TRIM[id]` para `id ∈ {fm, karplus}` (líneas 16-21), así que borrar `ENGINE_TRIM.karplus` lo convierte en `NaN` y caen cinco casos. La solución conserva la cobertura **y la mejora**: que lea el trim de Karplus del manifiesto del plugin, con lo que el test pasa a vigilar que el número afinado a oído en su día siga ahí.

```ts
import karplusPlugin from '../../plugins/karplus/plugin.json';

/** The per-engine trims this test compares against history. Karplus's now lives
 *  in its plugin manifest, so reading it HERE is also what keeps the ported
 *  plugin honest about the value that was tuned by ear. */
const TRIM: Record<string, number> = {
  fm: ENGINE_TRIM.fm,
  karplus: karplusPlugin.engines[0].outputTrim,
};

function levelRatio(id: string, v01: number): number {
  return (TRIM[id] * velGain01(v01, false)) / (PRE_FIX_TRIM[id] * v01);
}
```

- [ ] **Step 3: Criterio de aceptación 1 — cero menciones**

```bash
git grep -i karplus -- src/
```

Expected: **sin salida**. Si sale algo, arréglalo antes de seguir. Comentarios que mencionan Karplus de pasada (por ejemplo en `engine-param-grid.ts` o `polysynth-presets.ts`) cuentan: reescríbelos para no nombrar un motor que ya no vive aquí.

- [ ] **Step 4: Criterio de aceptación 2 — suena idéntico**

```bash
NO_COLOR=1 npx vitest run plugins/karplus/karplus-parity.dsp.test.ts
npm run test:unit
```

Expected: PASS y suite verde.

- [ ] **Step 5: Criterios 3 y 4 — write the e2e test**

`tests/e2e/plugin-karplus.spec.ts`:

```ts
import { test, expect } from '@playwright/test';

// Karplus now lives entirely in public/plugins/karplus/. These two checks are
// the spec's acceptance criteria: the plugin engine is a first-class citizen of
// the selector, and the app survives a plugin directory that isn't there.
test('the Karplus plugin appears as a selectable engine', async ({ page }) => {
  const errors: string[] = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto('/');

  const ids = await page.evaluate(async () => {
    const res = await fetch('plugins/index.json');
    return (await res.json()).plugins as string[];
  });
  expect(ids).toContain('karplus');

  // #engine-select is the main lane's engine selector (index.html:208). It is
  // filled from melodicSynthEngineIds(), which lists every registered engine
  // whose descriptor asks for the piano-roll editor — so a plugin engine shows
  // up there with no extra wiring.
  const options = await page.locator('#engine-select option').allTextContents();
  expect(options.join('|').toLowerCase()).toContain('karp');
  expect(errors).toEqual([]);
});

test('a missing plugin directory removes the engine and logs no error', async ({ page }) => {
  const errors: string[] = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  // Serve an empty index: the same thing as deleting public/plugins/karplus/.
  await page.route('**/plugins/index.json', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ plugins: [] }) }));
  await page.goto('/');
  await page.waitForTimeout(1500);

  const options = await page.locator('#engine-select option').allTextContents();
  expect(options.join('|').toLowerCase()).not.toContain('karp');
  expect(errors).toEqual([]);
});
```

- [ ] **Step 6: Run the e2e (build first — Playwright serves `dist/`)**

```bash
npm run build
NO_COLOR=1 npx playwright test tests/e2e/plugin-karplus.spec.ts
```

Expected: los dos PASS.

- [ ] **Step 7: Criterio 4 — el scaffold en JS puro suena**

```bash
node tools/loom-plugin/cli.mjs new plugins/sine-probe --js
node tools/loom-plugin/cli.mjs build plugins/sine-probe
npm run build
npm run dev
```

Abre <http://localhost:5173> en Chrome, elige el motor `sine-probe` en una pista y toca: tiene que sonar un seno. Después bórralo — era la prueba del scaffold, no un plugin del producto:

```bash
rm -rf plugins/sine-probe public/plugins/sine-probe
node tools/loom-plugin/cli.mjs build plugins/*
```

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -F - <<'EOF'
feat(plugins): Karplus sale de src/ — el trozo vertical, completo

`git grep -i karplus src/` devuelve cero. El motor vive entero en
public/plugins/karplus/, compilado por nuestro propio empaquetador y cargado
por el mismo camino que usaria un plugin de terceros.

La paridad de sonido queda fijada contra un render de referencia tomado del
motor viejo justo antes de borrarlo, con tolerancia relativa al pico.
EOF
```

---

## Self-Review

**Cobertura del spec:**

| Requisito del spec | Tarea |
|---|---|
| Spike del `addModule` externo | 1 |
| SDK con primitivos como fuente | 2 |
| ABI mínima (`registerEngine`/`registerRenderer`/`apiVersion`) | 3, 4 |
| `Loom` en los dos realms | 4 |
| Manifiesto con capacidades + validación + rechazo por `loomApi` | 3, 8 |
| CLI `new` y `build`, con comprobación de imports del host | 5 |
| Built-ins dogfoodeados por el mismo camino | 6, 8 |
| Tests unitarios sobre la fuente + uno sobre el artefacto empaquetado | 6 (fuente), 9 (e2e sobre el artefacto) |
| Descubrimiento por `index.json` + IndexedDB | 8 (index.json). **IndexedDB queda fuera a propósito**: el spec lo pone en el trozo 4 (Distribución), junto con el instalador de UI y el `.loomplugin`. |
| Puerta de arranque `ready()` | 8 — materializada como la promesa `pluginsReady` de la que cuelgan `presetsLoaded` y `workletReady`, que es la puerta que ya usa `main.ts` para las asignaciones de pista |
| Aislamiento de fallos | 8 |
| Camino offline | 8 (`importPluginDspOnMainThread`) |
| Capacidades: `dsp`, `outputTrim`, `wantsBpm`, `shortLabel`, `gm`, `presets`, `clipEditor` | 7. **`wantsBpm` no llega a existir**: al verificarlo resultó que `LANE_HOST_ENGINE_IDS` alimenta un bucle muerto (ningún descriptor tiene propiedad `bpm` desde el cutover al worklet), así que se borra en vez de convertirse en capacidad. Es una mejora sobre el spec, no un hueco. |
| Los 4 criterios de aceptación | 9 |

**Consistencia de tipos:** `EngineManifest` (Task 3) es lo que consumen `adoptEngine` (4), los lectores de capacidades (7) y el manifiesto de Karplus (6) — mismos nombres de campo en los cuatro sitios. `RendererFactory` (3) coincide con el `Ctor` de `registerRenderer` en `src/audio-dsp/renderer-registry.ts`. `seedEnginePresets` se define en 7 y se consume en 8. `registeredPluginEngines` se define en 4 y se consume en 7. `PluginLoadReport.dspUrls` se produce en 8 y se consume en el mismo `main.ts` de 8.

**Riesgos: qué se cerró antes de escribir esto, y qué queda vivo.**

Cerrados con evidencia (ver "Hechos verificados"): el `addModule` externo dentro del worklet, el `blob:` y el http como fuentes de módulo, el trim que `VoiceManager` no aplicaba, la muerte de `LANE_HOST_ENGINE_IDS`, los consumidores de `WORKLET_ENGINE_IDS`, el selector `#engine-select`, y el soporte de `--alias` y `metafile` en el esbuild ya instalado.

Queda **un** riesgo real, y es de configuración, no de diseño: que el alias `@loom/plugin-sdk` resuelva a la vez en `tsc`, Vite y Vitest. Los tres se tocan en la Task 2 Step 3 y el Step 6 los ejecuta los tres seguidos (`tsc --noEmit`, el test del SDK, y la suite entera), así que un fallo aparece dentro de la propia tarea y no más tarde. Si `tsc` se resistiera con `paths`, la salida es un `tsconfig` con `references` o mover el SDK a un workspace de npm — pero no hay motivo para creer que haga falta.
