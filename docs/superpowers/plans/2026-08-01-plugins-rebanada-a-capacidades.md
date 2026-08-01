# Rebanada A — un plugin puede ser una caja de ritmos o un canal de audio

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** que un plugin declare que es un canal de audio o una caja de ritmos y el
host se comporte en consecuencia, sin que ningún fichero de `src/` lo nombre.

**Architecture:** un manifiesto único por componente (`kind` + `id` +
`capabilities`) y **una sola puerta** — `src/plugins/capabilities.ts` — por la que
el core pregunta. La puerta lee de dos fuentes y el que pregunta no sabe cuál:
manifiesto de fichero si el componente es plugin, registro en código si es
integrado. Ésa es la propiedad que hace mecánico el trozo 3.

**Tech Stack:** TypeScript, Vite, Vitest, Playwright. Sin dependencias nuevas.

Spec: [2026-08-01-plugins-core-por-capacidades-design.md](../specs/2026-08-01-plugins-core-por-capacidades-design.md).

## Global Constraints

- **Ningún `switch` ni `===` sobre un id de componente en el core.** Si hace falta
  una pregunta nueva, nace como capacidad en la puerta.
- **Los defaults son los de un instrumento melódico normal.** Un manifiesto que no
  dice nada se comporta como Subtractive. Sólo lo raro se declara.
- **`loomApi` SE QUEDA EN 1.** Esto es la primera implementación: el único plugin
  del mundo es el nuestro y se convierte en esta misma rama. La versión existe
  para que un plugin viejo falle a gritos, y no hay ninguno viejo. En su lugar,
  **`components` es obligatorio** — así un manifiesto con la forma antigua
  (`engines`) falla con "components must be an array" en vez de validar y
  registrar cero componentes, que sería un fallo mudo.
- **`engine` gana a `synth`** como nombre del `PluginKind`.
- **Fuera de alcance en esta rebanada:** los backends del allocator, `editorPage`,
  `patternCategory`, `slideOnOverlap`, `roles`, y los moduladores/note-FX.
- **TODO EL CÓDIGO VA EN INGLÉS: identificadores, comentarios y nombres de test.**
  Los bloques de código de este plan llevan algunos comentarios en español por
  descuido del autor — **tradúcelos al escribirlos, no los copies tal cual**. Un
  comentario en inglés que ya exista en el fichero NO se traduce jamás. (La
  Task 1 tradujo uno al español y hubo que revertirlo.) Los mensajes de commit
  también van en inglés.
- Tests sin color: `NO_COLOR=1 npx vitest run <fichero>`.
- **`npm run build` antes de cualquier e2e** — Playwright sirve `dist/` sin
  construir.

## Hechos verificados

Comprobados en el código el 2026-08-01. No inferidos.

| hecho | dónde |
|---|---|
| `chooseClipEditor` ya consulta el editor declarado | `clip-editor-router.ts:108` |
| `loom-api` convierte `clipEditor:'audio'` en `'piano-roll'` en silencio | `loom-api.ts:30` |
| `engine-swap` ya rechaza por editor ≠ `piano-roll` en las dos direcciones | `engine-swap.ts:39-40` |
| el clic en celda vacía abre el picker sólo por `engineId === 'audio'` | `session-grid-templates.ts:152` |
| `PluginKind` dice `'synth'`; hay 3+ consumidores (la lista del brief se quedó corta) | `plugins/types.ts:5`, `main.ts:109`, `plugin-bootstrap.ts` |
| `src/plugins/synths/` NO existe en git (dir vacío = no versionado) | `ls` en el worktree |
| `SynthEngine.editor` sólo admite `'piano-roll' \| 'drum-grid'` | `engine-types.ts:105` |
| `registerEngineFactory` existe y sus factorías devuelven descriptores inertes | `registry.ts:47` |
| `createEngineInstance` está importado sin usarse en el allocator | `lane-allocator.ts:4` |

## File Structure

**Crear:**
- `src/plugins/capabilities.ts` — la puerta. Un `Map<string, EngineCapabilities>`
  alimentado por los integrados (`registerEngineCapabilities`) y por los plugins
  (`adoptEngine`), más los accesores con nombre. **Único lector.**
- `src/plugins/capabilities.test.ts`
- `plugins/audio-probe/` — plugin sonda de canal de audio (prueba de aceptación).

**Modificar:**
- `packages/loom-plugin-sdk/src/manifest.ts` — `ComponentManifest`,
  `EngineCapabilities`, `PluginManifestFile.components` (obligatorio).
- `src/plugin-host/manifest-validate.ts` — valida `components` + capacidades.
- `src/plugin-host/loom-api.ts` — deja de aplastar `'audio'`; alimenta la puerta.
- `src/plugin-host/plugin-capabilities.ts` — **se borra**; su contenido vive ahora
  en `src/plugins/capabilities.ts`.
- `src/plugins/types.ts`, `src/plugins/registry.ts` — `'synth'` → `'engine'`.
- `src/engines/engine-types.ts`, `src/engines/registry.ts`,
  `src/engines/descriptor-engine.ts` — `editor` admite `'audio'`.
- Los 3 motores con capacidades no-melódicas: `src/engines/audio.ts`,
  `src/engines/sampler.ts`, `src/engines/drums-engine.ts`.
- Consumidores: `session-grid-templates.ts`, `session-host-audio-import.ts`,
  `lane-editor-panels.ts`, `engine-swap.ts`, `session-inspector.ts`,
  `trigger-dispatch.ts`, `clip-editor-router.ts`.
- `plugins/karplus/plugin.json` + `public/plugins/karplus/plugin.json` → forma de componentes.

**Borrar:** nada. `src/plugins/synths/` sólo existe como carpeta vacía sin
trackear en el checkout principal; git no versiona directorios vacíos, así que en
esta rama no hay nada que borrar.

---

### Task 1: El manifiesto por componentes y su validador

**Files:**
- Modify: `packages/loom-plugin-sdk/src/manifest.ts`
- Modify: `src/plugin-host/manifest-validate.ts`
- Test: `src/plugin-host/manifest-validate.test.ts`

**Interfaces:**
- Produce: `EngineCapabilities`, `ComponentManifest`,
  `PluginManifestFile.components: ComponentManifest[]` (obligatorio).
  `LOOM_API_VERSION` NO cambia: sigue en 1.

- [ ] **Step 1: Write the failing tests**

En `src/plugin-host/manifest-validate.test.ts`, sustituye el `baseEngine` por un
componente con capacidades y añade estos casos:

```ts
const engineComponent = {
  kind: 'engine' as const,
  id: 'karplus', name: 'Karplus', polyphony: 'poly' as const,
  params: [{ id: 'a', label: 'A', kind: 'continuous' as const, min: 0, max: 1, default: 0 }],
  capabilities: { clipEditor: 'piano-roll' as const, shortLabel: 'karp', outputTrim: 0.857 },
};
const ok = (over: Record<string, unknown> = {}) => ({
  id: 'p', name: 'P', version: '1.0.0', loomApi: 1, main: 'main.js',
  components: [engineComponent], ...over,
});

it('rejects the OLD shape loudly instead of registering nothing', () => {
  // Without `components`, a manifest in the old shape would validate and
  // register ZERO components: the plugin would load and its engine would never
  // appear, without a single message. That is why `components` is required.
  const viejo = { id: 'p', name: 'P', version: '1.0.0', loomApi: 1, main: 'main.js',
    engines: [{ id: 'x', name: 'X' }] };
  const r = validatePluginManifest(viejo);
  expect(r.ok).toBe(false);
  if (!r.ok) expect(r.error).toMatch(/components/);
});

it('accepts clipEditor audio', () => {
  const caps = { ...engineComponent.capabilities, clipEditor: 'audio' as const };
  expect(validatePluginManifest(ok({ components: [{ ...engineComponent, capabilities: caps }] })).ok).toBe(true);
});

it('rejects an unknown component kind', () => {
  const r = validatePluginManifest(ok({ components: [{ ...engineComponent, kind: 'wat' }] }));
  expect(r.ok).toBe(false);
  if (!r.ok) expect(r.error).toMatch(/kind/);
});

it('rejects an accepts entry that is not a known asset kind', () => {
  const caps = { ...engineComponent.capabilities, accepts: ['midi-file'] };
  const r = validatePluginManifest(ok({ components: [{ ...engineComponent, capabilities: caps }] }));
  expect(r.ok).toBe(false);
  if (!r.ok) expect(r.error).toMatch(/accepts/);
});

it('leaves optional capabilities absent so the READER can apply the defaults', () => {
  const r = validatePluginManifest(ok());
  expect(r.ok).toBe(true);
  if (r.ok) {
    const c = r.manifest.components![0];
    // Absent from the JSON: the READER applies the defaults, not the validator.
    expect(c.capabilities.acceptsNoteFx).toBeUndefined();
  }
});
```

- [ ] **Step 2: Run and watch them fail**

`NO_COLOR=1 npx vitest run src/plugin-host/manifest-validate.test.ts`
Esperado: FAIL — `components` no se valida todavía, así que el manifiesto de
forma antigua pasa la validación en vez de ser rechazado.

- [ ] **Step 3: The SDK types**

En `packages/loom-plugin-sdk/src/manifest.ts`, sube la versión y añade las
capacidades. `EngineManifest` desaparece; su contenido se reparte entre el
componente y sus capacidades.

```ts
// UNCHANGED: still 1. This is the first implementation — no published plugin
// exists whose compatibility we could break, and the only one there is gets
// converted in Task 7 of this same branch.
export const LOOM_API_VERSION = 1;

/** Assets a component accepts by drag-and-drop. */
export type AssetKind = 'audio-file';

/** Every question the host used to answer comparing engine ids.
 *  OMITIR es lo normal: un manifiesto que calla se comporta como un
 *  instrumento melódico corriente. Sólo lo raro se declara. */
export interface EngineCapabilities {
  /** Which host clip editor this engine wants. */
  clipEditor: 'piano-roll' | 'drum-grid' | 'audio';
  /** Prefix for generated lane ids ("karplus" → "karplus-1"). */
  shortLabel: string;
  /** Output balance against the other engines. */
  outputTrim: number;
  /** Drag-and-drop targets. Default: none. */
  accepts?: AssetKind[];
  /** False for engines that are not note-transformed (drums, audio). Default true. */
  acceptsNoteFx?: boolean;
  /** False hides it from the "add lane" engine list. Default true. */
  listedInSelector?: boolean;
  /** False for engines that cannot host a chord accompaniment. Default true. */
  harmonic?: boolean;
  gm?: GmHint;
}

export interface ComponentManifestBase {
  id: string;
  name: string;
  params: EngineParamSpec[];
}

export type ComponentManifest =
  | (ComponentManifestBase & { kind: 'engine'; polyphony: 'mono' | 'poly';
      modulators?: unknown[]; capabilities: EngineCapabilities });

export interface PluginManifestFile {
  id: string;
  name: string;
  version: string;
  loomApi: number;
  author?: string;
  main: string;
  dsp?: string;
  presets?: string;
  /** REQUIRED. A manifest with no components carries nothing, and making it
   *  optional turns the old shape (`engines`) into a SILENT failure: it
   *  validates, loads, and registers zero. */
  components: ComponentManifest[];
}
```

`LoomApi` gana `registerComponent(manifest: ComponentManifest)` **y conserva
`registerEngine(manifest: EngineManifest)`**. Actualiza también
`packages/loom-plugin-sdk/src/global.d.ts` y `src/index.ts`.

> `ComponentManifest` es una unión de un solo miembro **a propósito**: las
> rebanadas B y C añaden `'modulator'` y `'notefx'` sin cambiar su forma.

> **NO borres `EngineManifest` en esta tarea.** `loom-api.ts` y
> `plugin-capabilities.ts` lo siguen importando, y quitarlo aquí deja `tsc` en
> rojo al final de la Task 1 — exactamente la ventana de build roto que el trozo
> 1 nos enseñó a no abrir. Déjalo como está, marcado:
>
> ```ts
> /** @deprecated Forma v1. La Task 2 mueve sus dos consumidores a
>  *  ComponentManifest y entonces esto se borra. */
> export interface EngineManifest { /* … sin tocar … */ }
> ```

- [ ] **Step 4: The validator**

En `src/plugin-host/manifest-validate.ts`, sustituye `engineError` por
`componentError` y valida las capacidades:

```ts
const ASSET_KINDS = ['audio-file'];
const CLIP_EDITORS = ['piano-roll', 'drum-grid', 'audio'];

function capabilitiesError(c: unknown, i: number): string | null {
  if (!isObj(c)) return `components[${i}].capabilities is not an object`;
  if (typeof c.clipEditor !== 'string' || !CLIP_EDITORS.includes(c.clipEditor)) {
    return `components[${i}].capabilities.clipEditor must be ${CLIP_EDITORS.join('|')}`;
  }
  if (!isStr(c.shortLabel)) return `components[${i}].capabilities.shortLabel must be a non-empty string`;
  // No default: a missing trim is a plugin that never thought about gain
  // staging, and guessing 1 would ship it louder than everything else.
  if (!isNum(c.outputTrim)) return `components[${i}].capabilities.outputTrim must be a number`;
  if (c.accepts !== undefined) {
    if (!Array.isArray(c.accepts) || c.accepts.some((a) => !ASSET_KINDS.includes(a as string))) {
      return `components[${i}].capabilities.accepts must be an array of ${ASSET_KINDS.join('|')}`;
    }
  }
  for (const k of ['acceptsNoteFx', 'listedInSelector', 'harmonic'] as const) {
    if (c[k] !== undefined && typeof c[k] !== 'boolean') {
      return `components[${i}].capabilities.${k} must be a boolean when present`;
    }
  }
  if (c.gm !== undefined) {
    if (!isObj(c.gm) || !Array.isArray(c.gm.keywords) || !isNum(c.gm.priority)) {
      return `components[${i}].capabilities.gm must be { keywords: string[], priority: number }`;
    }
  }
  return null;
}

function componentError(c: unknown, i: number): string | null {
  if (!isObj(c)) return `components[${i}] is not an object`;
  if (c.kind !== 'engine') return `components[${i}].kind must be engine`;
  if (!isStr(c.id)) return `components[${i}].id must be a non-empty string`;
  if (!isStr(c.name)) return `components[${i}].name must be a non-empty string`;
  if (c.polyphony !== 'mono' && c.polyphony !== 'poly') return `components[${i}].polyphony must be mono|poly`;
  if (!Array.isArray(c.params)) return `components[${i}].params must be an array`;
  for (let j = 0; j < c.params.length; j++) {
    const err = paramError(c.params[j], j);
    if (err) return `components[${i}].${err}`;
  }
  return capabilitiesError(c.capabilities, i);
}
```

En `validatePluginManifest`, deja el chequeo de versión **exactamente como está**
y sustituye el bloque de `raw.engines` por uno que exige `components`:

```ts
if (!Array.isArray(raw.components)) return { ok: false, error: 'components must be an array' };
for (let i = 0; i < raw.components.length; i++) {
  const err = componentError(raw.components[i], i);
  if (err) return { ok: false, error: err };
}
```

Fíjate en que **ya no es `if (raw.components !== undefined)`**: ausente es
inválido. Ésa es la sustituta del bump de versión.

- [ ] **Step 5: Green**

`NO_COLOR=1 npx vitest run src/plugin-host/manifest-validate.test.ts packages/loom-plugin-sdk`
Esperado: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/loom-plugin-sdk src/plugin-host/manifest-validate.ts src/plugin-host/manifest-validate.test.ts
git commit -F - <<'EOF'
feat(plugins): the manifest becomes a bundle of components

A plugin.json now declares `components: [...]`, each with a `kind`, an id and
a `capabilities` record, replacing the engine-only `engines: [...]`. Optional
capabilities are omitted: a manifest that says nothing behaves like an ordinary
melodic instrument, which is the right default.

`components` is REQUIRED, so a manifest in the old shape fails loudly with
"components must be an array" instead of registering zero components.

The ComponentManifest union deliberately has one member; slices B and C add
modulator and notefx without changing its shape.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
```

---

### Task 2: La puerta

**Files:**
- Create: `src/plugins/capabilities.ts`
- Create: `src/plugins/capabilities.test.ts`
- Delete: `src/plugin-host/plugin-capabilities.ts` y su test
- Modify: `src/plugin-host/loom-api.ts`, `src/app/lane-allocator.ts` (el import)

**Interfaces:**
- Consume: `EngineCapabilities` (Task 1).
- Produce: `registerEngineCapabilities(id, caps)`, `engineCapabilities(id)`,
  `clipEditorFor(id)`, `acceptsAudioFile(id)`, `acceptsNoteFx(id)`,
  `isHarmonic(id)`, `isListedInSelector(id)`, `isWorkletHosted(id)`,
  `pluginSynthTrim(id)`, `shortLabelFor(id)`, `pluginGmHints()`,
  `__resetCapabilities()`.

- [ ] **Step 1: Write the failing test**

```ts
// src/plugins/capabilities.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import {
  registerEngineCapabilities, clipEditorFor, acceptsAudioFile,
  acceptsNoteFx, isHarmonic, isListedInSelector, __resetCapabilities,
} from './capabilities';

const melodic = { clipEditor: 'piano-roll' as const, shortLabel: 'm', outputTrim: 1 };

describe('the capability door', () => {
  beforeEach(() => __resetCapabilities());

  it('a component that says nothing is an ordinary melodic instrument', () => {
    registerEngineCapabilities('quiet', melodic);
    expect(clipEditorFor('quiet')).toBe('piano-roll');
    expect(acceptsNoteFx('quiet')).toBe(true);
    expect(isHarmonic('quiet')).toBe(true);
    expect(isListedInSelector('quiet')).toBe(true);
    expect(acceptsAudioFile('quiet')).toBe(false);
  });

  it('an unknown id answers as melodic, never undefined', () => {
    // An engine not yet registered must NOT blank out its lane's UI.
    expect(clipEditorFor('nope')).toBe('piano-roll');
    expect(acceptsNoteFx('nope')).toBe(true);
  });

  it('an audio channel declares its own shape and the door honours it', () => {
    registerEngineCapabilities('probe-audio', {
      clipEditor: 'audio', shortLabel: 'aud', outputTrim: 1,
      accepts: ['audio-file'], acceptsNoteFx: false, harmonic: false, listedInSelector: false,
    });
    expect(clipEditorFor('probe-audio')).toBe('audio');
    expect(acceptsAudioFile('probe-audio')).toBe(true);
    expect(acceptsNoteFx('probe-audio')).toBe(false);
    expect(isHarmonic('probe-audio')).toBe(false);
    expect(isListedInSelector('probe-audio')).toBe(false);
  });

  it('the last registration wins, so a plugin can replace a built-in', () => {
    registerEngineCapabilities('dup', melodic);
    registerEngineCapabilities('dup', { ...melodic, clipEditor: 'drum-grid' });
    expect(clipEditorFor('dup')).toBe('drum-grid');
  });
});
```

- [ ] **Step 2: Run and watch it fail**

`NO_COLOR=1 npx vitest run src/plugins/capabilities.test.ts`
Esperado: FAIL — `Cannot find module './capabilities'`.

- [ ] **Step 3: Write the door**

```ts
// src/plugins/capabilities.ts
//
// The ONE door through which the core asks what a component can do. Every
// `engineId === '…'` left outside this file is a bug.
//
// Two sources, and the caller cannot tell which: a built-in component registers
// from code, a plugin one from its manifest. Migrating an engine in slice 3
// moves its answer from one source to the other WITHOUT touching the core.
import type { EngineCapabilities, GmHint } from '@loom/plugin-sdk';
import { CATEGORY_GAIN } from '../audio-dsp/gain-staging';

const caps = new Map<string, EngineCapabilities>();
/** Ids that arrived through a plugin manifest. Kept apart from the map because
 *  "is a plugin" is NOT a capability: it is how the thing was loaded. */
const fromPlugin = new Set<string>();

export function registerEngineCapabilities(id: string, c: EngineCapabilities, isPlugin = false): void {
  caps.set(id, c);
  if (isPlugin) fromPlugin.add(id);
}

export function engineCapabilities(id: string): EngineCapabilities | undefined {
  return caps.get(id);
}

// ── Named accessors ────────────────────────────────────────────────────────
// An unknown id answers like an ordinary melodic instrument. NEVER undefined: an
// engine not yet registered would blank out its lane's UI, and that failure is
// silent. The safe default is "normal".

export function clipEditorFor(id: string): 'piano-roll' | 'drum-grid' | 'audio' {
  return caps.get(id)?.clipEditor ?? 'piano-roll';
}
export function acceptsAudioFile(id: string): boolean {
  return caps.get(id)?.accepts?.includes('audio-file') ?? false;
}
export function acceptsNoteFx(id: string): boolean {
  return caps.get(id)?.acceptsNoteFx ?? true;
}
export function isHarmonic(id: string): boolean {
  return caps.get(id)?.harmonic ?? true;
}
export function isListedInSelector(id: string): boolean {
  return caps.get(id)?.listedInSelector ?? true;
}
export function shortLabelFor(id: string): string | undefined {
  return caps.get(id)?.shortLabel;
}

/** A plugin component synthesises in the worklet exactly when it arrived by
 *  manifest: its renderer ships in the same bundle. */
export function isWorkletHosted(id: string): boolean {
  return fromPlugin.has(id);
}

/** What the host must multiply a PLUGIN engine's voices by: its declared
 *  balance times the category gain — exactly what synthTrim() computes for an
 *  in-tree engine. undefined when it is not a plugin, so callers fall back to 1
 *  and the in-tree renderer's own multiplication still stands. */
export function pluginSynthTrim(id: string): number | undefined {
  if (!fromPlugin.has(id)) return undefined;
  const t = caps.get(id)?.outputTrim;
  return t === undefined ? undefined : t * CATEGORY_GAIN.synth;
}

export function pluginGmHints(): { keywords: string[]; engineId: string; priority: number }[] {
  const out: { keywords: string[]; engineId: string; priority: number }[] = [];
  for (const id of fromPlugin) {
    const gm: GmHint | undefined = caps.get(id)?.gm;
    if (gm) out.push({ keywords: gm.keywords, engineId: id, priority: gm.priority });
  }
  return out.sort((a, b) => a.priority - b.priority);
}

/** Test-only. */
export function __resetCapabilities(): void { caps.clear(); fromPlugin.clear(); }
```

- [ ] **Step 4: Green, then move the old callers**

`NO_COLOR=1 npx vitest run src/plugins/capabilities.test.ts` → PASS.

Ahora borra `src/plugin-host/plugin-capabilities.ts` y
`src/plugin-host/plugin-capabilities.test.ts`, y reapunta sus dos importadores:

- `src/app/lane-allocator.ts:17` →
  `import { isWorkletHosted, pluginSynthTrim } from '../plugins/capabilities';`
- `src/midi/gm-lookup.ts` (el que importe `pluginGmHints`) → mismo módulo.

En `src/plugin-host/loom-api.ts`, `adoptEngine` alimenta la puerta:

```ts
function adoptComponent(m: ComponentManifest): void {
  registerEngineCapabilities(m.id, m.capabilities, true);
  const make = () => createDescriptorEngine({
    id: m.id, name: m.name, polyphony: m.polyphony,
    editor: m.capabilities.clipEditor,
    params: m.params,
    presets: () => getCachedPresets(m.id),
    modulators: (m.modulators ?? []) as ModulatorState[],
  });
  registerEngineFactory(m.id, make);
  registerEngine(make());
}
```

`registeredPluginEngines()` desaparece: la puerta es ahora la dueña. Borra
también su export y `__resetPluginEngines` pasa a llamar a
`__resetCapabilities()`.

> **Ojo, esto ya mordió una vez:** `tsc --noEmit` NO detecta imports de
> side-effect a módulos borrados. Corre la suite unitaria completa, no sólo el
> typecheck.

- [ ] **Step 5: Full unit suite**

`npm run test:unit`
Esperado: todo verde. Si algo importa `plugin-capabilities`, sale aquí.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -F - <<'EOF'
feat(plugins): a single capability door, over components

plugin-capabilities.ts was named that way because it asked "is this a plugin?"
first — the very reflex we are removing. The door is now plugins/capabilities.ts
and answers from two sources without the caller knowing which: a manifest when
the component is a plugin, a code registration when it is built in.

Its accessors never return undefined for an unknown id: they answer like an
ordinary melodic instrument. An engine not yet registered would blank out its
lane's UI, and that failure would be silent.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
```

---

### Task 3: `synth` → `engine`

**Files:**
- Modify: `src/plugins/types.ts:5`, `src/plugins/registry.ts:25`
- Modify: `src/main.ts:109`, `src/app/plugin-bootstrap.ts`
- Delete: `src/plugins/synths/`
- Test: `src/app/plugin-bootstrap.test.ts`

**Interfaces:**
- Produce: `PluginKind = 'engine' | 'fx' | 'modulator' | 'notefx'`.

- [ ] **Step 1: Write the failing test**

En `src/app/plugin-bootstrap.test.ts`, añade:

```ts
import { registerPlugin, listPlugins, _resetRegistry } from '../plugins/registry';

it('lists an engine component under the kind the rest of the app uses', () => {
  // The two registries used different names for the same thing. This test pins
  // which one wins, so there is never a second one again.
  _resetRegistry();
  registerPlugin({
    kind: 'engine',
    manifest: { id: 'probe', name: 'Probe', kind: 'engine', version: '1.0.0', params: [], presets: [] },
    create: () => { throw new Error('not built in this test'); },
  } as never);
  expect(listPlugins('engine').map((p) => p.manifest.id)).toEqual(['probe']);
});
```

> El test comprueba que un componente registrado **sale** por el kind nuevo. No
> vale un `expect(...).toBeDefined()` sobre la llamada: eso pasa siempre y no
> distingue el antes del después.

- [ ] **Step 2: Run and watch it fail**

`NO_COLOR=1 npx vitest run src/app/plugin-bootstrap.test.ts`
Esperado: FAIL — `'engine'` no es asignable a `PluginKind`.

- [ ] **Step 3: Rename**

- `src/plugins/types.ts:5` → `export type PluginKind = 'engine' | 'fx' | 'modulator' | 'notefx';`
- En el mismo fichero, `PluginFactory`: `{ kind: 'synth'; … }` → `{ kind: 'engine'; … }`,
  y `SynthInstance` conserva su nombre (es la instancia, no el kind).
- `src/plugins/registry.ts:25` y `:31` → `'engine'`.
- `src/main.ts:109` y `src/app/plugin-bootstrap.ts` → `listPlugins('engine')`.
- `rm -r src/plugins/synths`

- [ ] **Step 4: Green**

`npm run test:unit` → verde. `npx tsc --noEmit` → 0.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -F - <<'EOF'
fix(plugins): one name for one thing — `engine` wins

PluginKind said 'synth' while the engine registry, engineId in the session and
the published plugin.json all said engine. Two names for one thing is how you
end up with three.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
```

---

### Task 4: `clipEditor: 'audio'` deja de mentir

**Files:**
- Modify: `src/engines/engine-types.ts:105`, `src/engines/registry.ts:32`,
  `src/engines/descriptor-engine.ts:31,80`
- Modify: `src/session/clip-editors/clip-editor-router.ts:155-172`
- Test: `src/session/clip-editors/clip-editor-router.test.ts`

**Interfaces:**
- Consume: `clipEditorFor` (Task 2).
- Produce: `isAudioClip(lane, clip)` sin comparar ids.

- [ ] **Step 1: Write the failing test**

```ts
// en clip-editor-router.test.ts
import { registerEngineCapabilities, __resetCapabilities } from '../../plugins/capabilities';

it('a clip on ANY engine declaring clipEditor audio is an audio clip', () => {
  __resetCapabilities();
  registerEngineCapabilities('probe-audio', {
    clipEditor: 'audio', shortLabel: 'p', outputTrim: 1,
  });
  const lane = { id: 'l1', engineId: 'probe-audio', clips: [], inserts: [] } as unknown as SessionLane;
  const clip = { id: 'c1', lengthBars: 1, notes: [], sample: { id: 's' } } as unknown as SessionClip;
  // Today this is false: isAudioClip compares against the id 'audio'.
  expect(isAudioClip(lane, clip)).toBe(true);
});
```

- [ ] **Step 2: Run and watch it fail**

`NO_COLOR=1 npx vitest run src/session/clip-editors/clip-editor-router.test.ts`
Esperado: FAIL — recibe `false`.

- [ ] **Step 3: Widen the editor type and ask the door**

Los tres tipos admiten el tercer valor:

```ts
// engine-types.ts:105 y registry.ts:32
readonly editor: 'piano-roll' | 'drum-grid' | 'audio';
// descriptor-engine.ts:31
editor?: 'piano-roll' | 'drum-grid' | 'audio';
```

Y `isAudioClip` pregunta a la puerta:

```ts
// clip-editor-router.ts
import { clipEditorFor } from '../../plugins/capabilities';

/** An audio-channel clip: its engine says its clips ARE audio files, it has a
 *  sample, and no notes. */
export function isAudioClip(lane: SessionLane, clip: SessionClip): boolean {
  return clipEditorFor(lane.engineId) === 'audio'
    && !!clip.sample && (clip.notes?.length ?? 0) === 0;
}
```

`chooseClipEditor` ya consulta `engineEditor` y no necesita cambios; su firma
pasa a admitir `'audio'` y devolverlo tal cual.

> **BORRA `descriptorEditor()` de [src/plugin-host/loom-api.ts](../../../src/plugin-host/loom-api.ts).**
> La Task 2 lo introdujo como puente: `SynthEngine.editor` todavía no admitía
> `'audio'`, así que aplastaba `'audio' → 'piano-roll'` para ese campo. En cuanto
> el tipo se ensancha en el Step 3, el puente sobra — y si se queda, hemos
> recreado exactamente la mentira que esta tarea existe para matar, sólo que con
> un comentario mejor. Sustituye las dos llamadas por el valor directo
> (`editor: m.capabilities.clipEditor` y `editor: m.clipEditor`) y comprueba con
> grep que no queda ninguna.

- [ ] **Step 4: Green**

`NO_COLOR=1 npx vitest run src/session/clip-editors/` → PASS.
`npx tsc --noEmit` → 0.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -F - <<'EOF'
fix(plugins): clipEditor 'audio' stops being turned into 'piano-roll'

The validator accepted 'audio' as legal and the host silently flattened it to
'piano-roll': a lie in the code, and the reason a plugin could not be an audio
channel. isAudioClip now asks the capability door instead of comparing against
the id 'audio', and descriptorEditor() — the bridge Task 2 needed while the type
was still narrow — is gone.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
```

---

### Task 5: Los tres motores no-melódicos declaran lo suyo

**Files:**
- Modify: `src/engines/audio.ts`, `src/engines/sampler.ts`, `src/engines/drums-engine.ts`
- Test: `src/plugins/capabilities.test.ts`

**Interfaces:**
- Consume: `registerEngineCapabilities` (Task 2).

- [ ] **Step 1: Write the failing test**

```ts
// en capabilities.test.ts — SIN __resetCapabilities: queremos los registros reales
import '../engines/audio';
import '../engines/sampler';
import '../engines/drums-engine';

it('los tres motores no-melodicos del arbol declaran sus capacidades', () => {
  expect(clipEditorFor('audio')).toBe('audio');
  expect(acceptsAudioFile('audio')).toBe(true);
  expect(acceptsNoteFx('audio')).toBe(false);
  expect(isHarmonic('audio')).toBe(false);
  expect(isListedInSelector('audio')).toBe(false);

  expect(acceptsAudioFile('sampler')).toBe(true);
  expect(isHarmonic('sampler')).toBe(false);

  expect(clipEditorFor('drums-machine')).toBe('drum-grid');
  expect(acceptsNoteFx('drums-machine')).toBe(false);
});
```

> Este test va en un `describe` propio **sin** el `beforeEach(__resetCapabilities)`,
> porque comprueba los registros reales de los tres ficheros importados.

- [ ] **Step 2: Run and watch it fail**

`NO_COLOR=1 npx vitest run src/plugins/capabilities.test.ts`
Esperado: FAIL — los tres responden con los defaults melódicos.

- [ ] **Step 3: Declare**

Junto a cada `registerEngineFactory(...)` existente, añade la declaración. En
`src/engines/audio.ts`:

```ts
import { registerEngineCapabilities } from '../plugins/capabilities';

registerEngineCapabilities('audio', {
  clipEditor: 'audio',
  shortLabel: 'audio',
  outputTrim: 1,
  accepts: ['audio-file'],
  acceptsNoteFx: false,      // a whole file is not transformed note by note
  harmonic: false,           // cannot host a chord accompaniment
  listedInSelector: false,   // added through its own explicit entry, not the list
});
```

`src/engines/sampler.ts`:

```ts
registerEngineCapabilities('sampler', {
  clipEditor: 'piano-roll', shortLabel: 'sampler', outputTrim: 1,
  accepts: ['audio-file'],
  harmonic: false,
});
```

`src/engines/drums-engine.ts`:

```ts
registerEngineCapabilities('drums-machine', {
  clipEditor: 'drum-grid', shortLabel: 'drums', outputTrim: 1,
  acceptsNoteFx: false,
});
```

> Los `outputTrim: 1` son deliberados: estos tres NO pasan por
> `pluginSynthTrim` (no son plugins), así que el número no se usa todavía. Se
> vuelve real cuando migren en el trozo 3.

- [ ] **Step 4: Green**

`npm run test:unit` → verde.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -F - <<'EOF'
feat(plugins): audio, sampler and drums declare their own capabilities

They are still built in, but they answer through the same door a plugin does.
When they migrate in slice 3 their answer moves from one source to the other and
the core never notices — which is exactly the property we were after.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
```

---

### Task 6: Los consumidores dejan de comparar ids

**Files:**
- Modify: `src/session/session-grid-templates.ts:130,152,304`
- Modify: `src/session/session-host-audio-import.ts:80`
- Modify: `src/session/lane-editor-panels.ts:15-24`
- Modify: `src/app/trigger-dispatch.ts:48`
- Modify: `src/session/session-inspector.ts:519,536`
- Modify: `src/app/engine-swap.ts:38` (**se borra**)
- Test: `src/session/lane-editor-panels.test.ts`, `src/app/engine-swap.test.ts`

**Interfaces:**
- Consume: `acceptsAudioFile`, `acceptsNoteFx`, `isHarmonic`,
  `isListedInSelector`, `clipEditorFor` (Task 2).

- [ ] **Step 1: Write the failing tests**

```ts
// lane-editor-panels.test.ts
import { registerEngineCapabilities, __resetCapabilities } from '../plugins/capabilities';

it('an engine that declares no note-FX gets no note-FX panel, whatever its id', () => {
  __resetCapabilities();
  registerEngineCapabilities('probe-drums', {
    clipEditor: 'drum-grid', shortLabel: 'p', outputTrim: 1, acceptsNoteFx: false,
  });
  expect(laneEditorPanels('probe-drums').noteFx).toBe(false);
});

it('an audio-editor engine gets only its inserts', () => {
  __resetCapabilities();
  registerEngineCapabilities('probe-audio', {
    clipEditor: 'audio', shortLabel: 'p', outputTrim: 1, acceptsNoteFx: false,
  });
  const p = laneEditorPanels('probe-audio');
  expect(p).toEqual({ engineParams: false, noteFx: false, preset: false, inserts: true, engineHeaderRow: false });
});
```

```ts
// engine-swap.test.ts
it('rejects a swap into an audio-editor engine without naming any id', () => {
  // The id guard is deleted: the editor guard already covered both directions.
  expect(swapLaneEngineFlow(depsWith({ getEngineEditor: () => 'audio' }), 'l1', 'probe-audio')).toBe(false);
});
```

- [ ] **Step 2: Run and watch them fail**

`NO_COLOR=1 npx vitest run src/session/lane-editor-panels.test.ts src/app/engine-swap.test.ts`
Esperado: FAIL.

- [ ] **Step 3: Replace, one site at a time**

`lane-editor-panels.ts` entero:

```ts
import { clipEditorFor, acceptsNoteFx } from '../plugins/capabilities';

export function laneEditorPanels(engineId: string): LaneEditorPanels {
  // An engine whose clips ARE audio files is not an instrument: no engine knobs,
  // no preset, no selector. Only its inserts.
  const isAudio = clipEditorFor(engineId) === 'audio';
  return {
    engineParams: !isAudio,
    noteFx: !isAudio && acceptsNoteFx(engineId),
    preset: !isAudio,
    inserts: true,
    engineHeaderRow: !isAudio,
  };
}
```

`session-grid-templates.ts`:
- `:130` → `const acceptsFileDrop = acceptsAudioFile(lane.engineId) && !!cb.onCellDropAudio;`
- `:152` → `const isAudio = clipEditorFor(lane.engineId) === 'audio';`
- `:304` → `.filter((engine) => isListedInSelector(engine.id))`

`session-host-audio-import.ts:80` →
`if (!lane || !acceptsAudioFile(lane.engineId)) return;`

`trigger-dispatch.ts:48` →
```ts
// Audio clips bypass note-FX; an engine that declares none is not note-transformed.
const chain = sample == null && acceptsNoteFx(engineId) ? getNoteFxChain(laneId) : null;
```

`session-inspector.ts`:
- `:519` → `chordsBtn.hidden = exKind === 'beat' || !isHarmonic(lane!.engineId);`
- `:536` → `(l) => isHarmonic(l.engineId) && clipEditorFor(l.engineId) === 'piano-roll',`

`engine-swap.ts:38` → **borrar la línea**, dejando este comentario en su lugar:

```ts
  // No id guard: an audio channel declares clipEditor:'audio', so the two editor
  // checks below already reject it in both directions.
```

- [ ] **Step 4: Green**

`npm run test:unit` → verde. `npx tsc --noEmit` → 0.

- [ ] **Step 5: Measure**

`node tools/plugin-id-census.mjs`
Esperado: el número de `core-decides` de engines **baja** respecto a 116. Anota
la cifra en el commit.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -F - <<'EOF'
refactor(plugins): seven core sites stop comparing engine ids

File drop, the note-FX panel, the chords button, the lane filter, the selector
list and the note-FX chain now ask the capability door.

The engine-swap guard against 'audio' is DELETED with no replacement: the two
editor checks already there covered both directions once clipEditor:'audio'
stopped lying. One less capability to keep coherent.

Engine census: 116 -> N core-decides lines.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
```

---

### Task 7: Karplus pasa a la forma de componentes

**Files:**
- Modify: `plugins/karplus/plugin.json`, `plugins/karplus/main.ts`
- Modify: `tools/loom-plugin/scaffold.mjs` (la plantilla que genera `new`)
- Regenerate: `public/plugins/karplus/`
- Test: `plugins/karplus/karplus-parity.dsp.test.ts`, `tests/e2e/plugin-karplus.spec.ts`

- [ ] **Step 1: Convert the manifest**

En `plugins/karplus/plugin.json`, `engines: [...]` pasa a
`components: [...]` con `kind: 'engine'` y las tres claves de capacidad movidas
dentro de `capabilities`:

```jsonc
{
  "loomApi": 1,
  "components": [{
    "kind": "engine",
    "id": "karplus",
    "name": "Karplus",
    "polyphony": "poly",
    "params": [ ],
    "capabilities": {
      "clipEditor": "piano-roll",
      "shortLabel": "karplus",
      "outputTrim": 0.857,
      "gm": { "keywords": ["…"], "priority": 25 }
    }
  }]
}
```

> **El array `params` y el objeto `gm` se copian TAL CUAL del fichero actual** —
> arriba van vacíos sólo para que se vea la estructura. Los valores reales de
> `outputTrim`, `shortLabel`, `clipEditor` y `gm` ya están en
> `plugins/karplus/plugin.json`; esta tarea los **mueve** dentro de
> `capabilities`, no los reescribe. Si el test de paridad cambia, algo se copió
> mal.

En `plugins/karplus/main.ts`, `Loom.registerEngine(...)` → `Loom.registerComponent(...)`.

- [ ] **Step 2: Rebuild the plugin**

```bash
node tools/loom-plugin/cli.mjs build plugins/karplus --out public/plugins/karplus
```

- [ ] **Step 3: Verify by ear-proxy, then by browser**

```bash
NO_COLOR=1 npx vitest run plugins/karplus
npm run build
npx playwright test tests/e2e/plugin-karplus.spec.ts
```
Esperado: paridad muestra a muestra verde (el sonido no cambió) y Karplus sigue
apareciendo en el selector.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -F - <<'EOF'
feat(plugins): Karplus speaks the component shape

No migration: only one plugin is published and it is this one. The
sample-by-sample parity test stays green, so the sound did not change.

This also kills the v1 path: EngineManifest, LoomApi.registerEngine and
adoptEngine go with it, since Karplus was their last consumer.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
```

---

### Task 8: El plugin sonda de canal de audio — la prueba de aceptación

**Files:**
- Create: `plugins/audio-probe/plugin.json`, `plugins/audio-probe/main.ts`
- Create: `tests/e2e/plugin-audio-channel.spec.ts`
- Modify: `public/plugins/index.json`

**Interfaces:**
- Consume: todo lo anterior.

- [ ] **Step 1: Write the failing e2e**

```ts
// tests/e2e/plugin-audio-channel.spec.ts
import { test, expect } from '@playwright/test';

test('a plugin that declares itself an audio channel gets the audio behaviour', async ({ page }) => {
  await page.goto('/');
  const state = await page.evaluate(() => {
    const w = window as unknown as { Loom?: unknown };
    return { loom: !!w.Loom };
  });
  expect(state.loom).toBe(true);

  // El motor sonda NO aparece en el selector (listedInSelector: false), que es
  // la mitad observable de la capacidad.
  const options = await page.locator('#engine-select option').allTextContents();
  expect(options.join('|')).not.toContain('Audio Probe');
});
```

- [ ] **Step 2: Run and watch it fail**

`npm run build && npx playwright test tests/e2e/plugin-audio-channel.spec.ts`
Esperado: FAIL — el plugin no existe todavía.

- [ ] **Step 3: Write the probe plugin**

`plugins/audio-probe/plugin.json`:

```json
{
  "id": "audio-probe",
  "name": "Audio Probe",
  "version": "1.0.0",
  "loomApi": 1,
  "main": "main.js",
  "components": [{
    "kind": "engine",
    "id": "audio-probe",
    "name": "Audio Probe",
    "polyphony": "poly",
    "params": [],
    "capabilities": {
      "clipEditor": "audio",
      "shortLabel": "probe",
      "outputTrim": 1,
      "accepts": ["audio-file"],
      "acceptsNoteFx": false,
      "harmonic": false,
      "listedInSelector": false
    }
  }]
}
```

`plugins/audio-probe/main.ts`:

```ts
// An audio channel with NO DSP of its own: it exists to prove the capabilities
// alone are enough. It ships no `dsp`, so the host never asks it for a renderer.
declare const Loom: import('@loom/plugin-sdk').LoomApi;
import manifest from './plugin.json';

Loom.registerComponent(manifest.components[0] as never);
```

Constrúyelo y añádelo al índice:

```bash
node tools/loom-plugin/cli.mjs build plugins/audio-probe --out public/plugins/audio-probe
```

`public/plugins/index.json` → `{ "plugins": ["karplus", "audio-probe"] }`.

- [ ] **Step 4: Green**

`npm run build && npx playwright test tests/e2e/plugin-audio-channel.spec.ts` → PASS.

- [ ] **Step 5: Look at it in a real browser**

Un test verde **no** es la aceptación de esta rebanada. Abre
<http://localhost:5173>, añade una pista con el motor sonda, arrástrale un WAV a
una celda y comprueba que:
1. la celda acepta el drop (borde resaltado),
2. el clip aparece y el editor que se abre es **el de forma de onda**, no el
   piano-roll,
3. el editor de pista muestra **sólo inserts** — sin knobs de motor, sin preset,
   sin note-FX.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -F - <<'EOF'
test(plugins): a plugin declares itself an audio channel and the host believes it

Slice A's acceptance proof: the probe engine ships no DSP and still gets the
waveform editor, the file drop and a lane editor reduced to its inserts, without
any file under src/ naming it.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
```

---

## Cierre de la rebanada

- [ ] `npm run test:unit` verde
- [ ] `npm run build` sale 0
- [ ] `npx playwright test` verde
- [ ] `node tools/plugin-id-census.mjs` anotado en el commit final
- [ ] Las tres comprobaciones **a ojo** de la Task 8, paso 5
- [ ] `git rebase main` y merge sólo con permiso explícito de Nacho
