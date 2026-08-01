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
- **`loomApi` pasa a 2.** El validador rechaza la 1 con un mensaje que nombra la
  versión. Sin migración: sólo existe un plugin publicado y es nuestro.
- **`engine` gana a `synth`** como nombre del `PluginKind`.
- **Fuera de alcance en esta rebanada:** los backends del allocator, `editorPage`,
  `patternCategory`, `slideOnOverlap`, `roles`, y los moduladores/note-FX.
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
| `PluginKind` dice `'synth'`; hay 2 consumidores vivos | `plugins/types.ts:5`, `main.ts:109`, `plugin-bootstrap.ts` |
| `src/plugins/synths/` está VACÍO | `ls src/plugins/synths/` |
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
  `EngineCapabilities`, `LOOM_API_VERSION = 2`, `PluginManifestFile.components`.
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
- `plugins/karplus/plugin.json` + `public/plugins/karplus/plugin.json` → v2.

**Borrar:** `src/plugins/synths/` (vacío).

---

### Task 1: El manifiesto v2 y su validador

**Files:**
- Modify: `packages/loom-plugin-sdk/src/manifest.ts`
- Modify: `src/plugin-host/manifest-validate.ts`
- Test: `src/plugin-host/manifest-validate.test.ts`

**Interfaces:**
- Produce: `EngineCapabilities`, `ComponentManifest`, `LOOM_API_VERSION = 2`,
  `PluginManifestFile.components?: ComponentManifest[]`.

- [ ] **Step 1: Write the failing tests**

En `src/plugin-host/manifest-validate.test.ts`, sustituye el `baseEngine` por un
componente v2 y añade estos casos:

```ts
const engineComponent = {
  kind: 'engine' as const,
  id: 'karplus', name: 'Karplus', polyphony: 'poly' as const,
  params: [{ id: 'a', label: 'A', kind: 'continuous' as const, min: 0, max: 1, default: 0 }],
  capabilities: { clipEditor: 'piano-roll' as const, shortLabel: 'karp', outputTrim: 0.857 },
};
const v2 = (over: Record<string, unknown> = {}) => ({
  id: 'p', name: 'P', version: '1.0.0', loomApi: 2, main: 'main.js',
  components: [engineComponent], ...over,
});

it('rejects a v1 manifest naming both versions', () => {
  const r = validatePluginManifest({ ...v2(), loomApi: 1 });
  expect(r.ok).toBe(false);
  if (!r.ok) expect(r.error).toMatch(/loomApi 1 .*2/);
});

it('accepts clipEditor audio', () => {
  const caps = { ...engineComponent.capabilities, clipEditor: 'audio' as const };
  expect(validatePluginManifest(v2({ components: [{ ...engineComponent, capabilities: caps }] })).ok).toBe(true);
});

it('rejects an unknown component kind', () => {
  const r = validatePluginManifest(v2({ components: [{ ...engineComponent, kind: 'wat' }] }));
  expect(r.ok).toBe(false);
  if (!r.ok) expect(r.error).toMatch(/kind/);
});

it('rejects an accepts entry that is not a known asset kind', () => {
  const caps = { ...engineComponent.capabilities, accepts: ['midi-file'] };
  const r = validatePluginManifest(v2({ components: [{ ...engineComponent, capabilities: caps }] }));
  expect(r.ok).toBe(false);
  if (!r.ok) expect(r.error).toMatch(/accepts/);
});

it('defaults the optional capabilities so a plain manifest is a normal instrument', () => {
  const r = validatePluginManifest(v2());
  expect(r.ok).toBe(true);
  if (r.ok) {
    const c = r.manifest.components![0];
    // Ausentes en el JSON: el LECTOR aplica los defaults, no el validador.
    expect(c.capabilities.acceptsNoteFx).toBeUndefined();
  }
});
```

- [ ] **Step 2: Run and watch them fail**

`NO_COLOR=1 npx vitest run src/plugin-host/manifest-validate.test.ts`
Esperado: FAIL — `loomApi 2` no está soportado, `components` no se valida.

- [ ] **Step 3: The SDK types**

En `packages/loom-plugin-sdk/src/manifest.ts`, sube la versión y añade las
capacidades. `EngineManifest` desaparece; su contenido se reparte entre el
componente y sus capacidades.

```ts
export const LOOM_API_VERSION = 2;

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
  components?: ComponentManifest[];
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
  // Sin default: un trim ausente es un plugin que no pensó en el gain staging,
  // y adivinar 1 lo publica más alto que todo lo demás.
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

En `validatePluginManifest`, cambia el bucle de `raw.engines` por `raw.components`
y deja el chequeo de versión como está (ya nombra las dos versiones:
`` `loomApi ${String(raw.loomApi)} is not supported (host speaks ${LOOM_API_VERSION})` ``).

- [ ] **Step 5: Green**

`NO_COLOR=1 npx vitest run src/plugin-host/manifest-validate.test.ts packages/loom-plugin-sdk`
Esperado: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/loom-plugin-sdk src/plugin-host/manifest-validate.ts src/plugin-host/manifest-validate.test.ts
git commit -F - <<'EOF'
feat(plugins): manifiesto v2 — componentes con capacidades

Un manifiesto pasa a ser un paquete de COMPONENTES discriminados por kind,
y cada uno declara sus capacidades. Los opcionales se omiten: un manifiesto
que calla se comporta como un instrumento melodico corriente, que es el
default correcto.

La union ComponentManifest tiene un solo miembro a proposito; las rebanadas
B y C anaden modulator y notefx sin cambiarle la forma.

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

describe('la puerta de capacidades', () => {
  beforeEach(() => __resetCapabilities());

  it('un componente que calla es un instrumento melodico normal', () => {
    registerEngineCapabilities('quiet', melodic);
    expect(clipEditorFor('quiet')).toBe('piano-roll');
    expect(acceptsNoteFx('quiet')).toBe(true);
    expect(isHarmonic('quiet')).toBe(true);
    expect(isListedInSelector('quiet')).toBe(true);
    expect(acceptsAudioFile('quiet')).toBe(false);
  });

  it('un id desconocido responde como melodico, nunca undefined', () => {
    // Un motor que aun no se ha registrado NO debe apagar la UI de su pista.
    expect(clipEditorFor('nope')).toBe('piano-roll');
    expect(acceptsNoteFx('nope')).toBe(true);
  });

  it('un canal de audio declara lo suyo y la puerta lo respeta', () => {
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

  it('el ultimo registro gana, para que un plugin pueda sustituir a un integrado', () => {
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
// La UNICA puerta por la que el core pregunta que sabe hacer un componente.
// Cada `engineId === '…'` que quede fuera de aqui es un bug.
//
// Dos fuentes, y el que pregunta no sabe cual: un componente integrado se
// registra desde codigo, uno de plugin desde su manifiesto. Migrar un motor en
// el trozo 3 muda su respuesta de una fuente a la otra SIN tocar el core.
import type { EngineCapabilities, GmHint } from '@loom/plugin-sdk';
import { CATEGORY_GAIN } from '../audio-dsp/gain-staging';

const caps = new Map<string, EngineCapabilities>();
/** Ids que llegaron por manifiesto de plugin. Separado del mapa porque
 *  "es un plugin" NO es una capacidad: es como se cargo. */
const fromPlugin = new Set<string>();

export function registerEngineCapabilities(id: string, c: EngineCapabilities, isPlugin = false): void {
  caps.set(id, c);
  if (isPlugin) fromPlugin.add(id);
}

export function engineCapabilities(id: string): EngineCapabilities | undefined {
  return caps.get(id);
}

// ── Accesores con nombre ───────────────────────────────────────────────────
// Un id desconocido responde como un instrumento melodico corriente. NUNCA
// undefined: un motor todavia sin registrar apagaria la UI de su pista, y ese
// fallo es mudo. El default seguro es "normal".

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

/** Un componente de plugin sintetiza en el worklet exactamente cuando llego por
 *  manifiesto: su renderer viene en el mismo paquete. */
export function isWorkletHosted(id: string): boolean {
  return fromPlugin.has(id);
}

/** Lo que el host debe multiplicar a las voces de un motor de PLUGIN: su balance
 *  declarado por la ganancia de categoria — justo lo que synthTrim() calcula
 *  para un motor integrado. undefined si no es plugin, para que el llamante caiga
 *  a 1 y la multiplicacion del renderer integrado siga valiendo. */
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
feat(plugins): una sola puerta de capacidades, sobre componentes

plugin-capabilities.ts se llamaba asi porque preguntaba primero "es esto un
plugin?" — el reflejo exacto que estamos quitando. Ahora la puerta es
plugins/capabilities.ts y responde de dos fuentes sin que el llamante sepa
cual: manifiesto si el componente es plugin, registro en codigo si es
integrado.

Los accesores nunca devuelven undefined para un id desconocido: responden
como instrumento melodico corriente. Un motor aun sin registrar apagaria la
UI de su pista, y ese fallo seria mudo.

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
it('lists engine components under the kind the rest of the app uses', () => {
  // Los dos registros usaban nombres distintos para lo mismo. Este test fija
  // cual gana, para que no vuelva a haber dos.
  expect(listPlugins('engine')).toBeDefined();
  // @ts-expect-error 'synth' ya no es un PluginKind
  expect(() => listPlugins('synth')).toBeDefined();
});
```

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
fix(plugins): un solo nombre para lo mismo — gana `engine`

PluginKind decia 'synth' y el registro de motores, engineId y el plugin.json
publicado decian engine. Dos nombres para una cosa es como se llega a tres.
src/plugins/synths/ estaba vacio y se borra.

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
  // Hoy esto es false: isAudioClip compara con el id 'audio'.
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

- [ ] **Step 4: Green**

`NO_COLOR=1 npx vitest run src/session/clip-editors/` → PASS.
`npx tsc --noEmit` → 0.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -F - <<'EOF'
fix(plugins): clipEditor 'audio' deja de convertirse en 'piano-roll'

El validador aceptaba 'audio' como legal y el host lo aplastaba a
'piano-roll' sin decir nada: una mentira en el codigo, y la razon de que un
plugin no pudiera ser un canal de audio. isAudioClip pregunta ahora a la
puerta en vez de comparar con el id 'audio'.

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
  acceptsNoteFx: false,      // un fichero entero no se transforma nota a nota
  harmonic: false,           // no puede alojar un acompañamiento de acordes
  listedInSelector: false,   // se añade por su entrada explícita, no por la lista
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
feat(plugins): audio, sampler y drums declaran sus capacidades

Siguen siendo integrados, pero contestan por la misma puerta que un plugin.
Cuando migren en el trozo 3, su respuesta se muda de fuente y el core no se
entera — que es justamente la propiedad que buscabamos.

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
  // La guarda por id se borra: la guarda por editor ya cubria las dos direcciones.
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
  // Un motor cuyos clips SON ficheros de audio no es un instrumento: no tiene
  // knobs de motor, ni preset, ni selector. Sólo sus inserts.
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
  // Sin guarda por id: un canal de audio declara clipEditor:'audio', asi que las
  // dos comprobaciones de editor de abajo ya lo rechazan en ambas direcciones.
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
refactor(plugins): siete sitios del core dejan de comparar ids de motor

Drop de ficheros, panel de note-FX, boton de acordes, filtro de pistas,
lista del selector y la cadena de note-FX preguntan ahora a la puerta.

La guarda de engine-swap por 'audio' se BORRA sin sustituto: las dos
comprobaciones de editor que ya habia cubrian las dos direcciones en cuanto
clipEditor:'audio' dejo de mentir. Una capacidad menos que mantener.

Censo de engines: 116 -> N lineas core-decides.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
```

---

### Task 7: Karplus pasa a v2

**Files:**
- Modify: `plugins/karplus/plugin.json`, `plugins/karplus/main.ts`
- Modify: `tools/loom-plugin/scaffold.mjs` (la plantilla que genera `new`)
- Regenerate: `public/plugins/karplus/`
- Test: `plugins/karplus/karplus-parity.dsp.test.ts`, `tests/e2e/plugin-karplus.spec.ts`

- [ ] **Step 1: Convert the manifest**

En `plugins/karplus/plugin.json`: `"loomApi": 2`, y `engines: [...]` pasa a
`components: [...]` con `kind: 'engine'` y las tres claves de capacidad movidas
dentro de `capabilities`:

```jsonc
{
  "loomApi": 2,
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
feat(plugins): Karplus habla la v2 del manifiesto

Sin migracion: solo existe un plugin publicado y es este. El test de
paridad muestra a muestra sigue verde, o sea que el sonido no cambio.

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
  "loomApi": 2,
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
// Un canal de audio SIN DSP propio: existe para demostrar que las capacidades
// bastan. No trae `dsp`, asi que el host no le pide renderer.
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
test(plugins): un plugin declara que es canal de audio y el host le cree

Prueba de aceptacion de la rebanada A: el motor sonda no trae DSP y aun asi
recibe el editor de forma de onda, el drop de ficheros y el editor de pista
reducido a sus inserts, sin que ningun fichero de src/ lo nombre.

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
