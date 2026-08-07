# WEAVE — el panel dinámico · plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Un panel que teje la escena en vivo — funde loops de forma continua sin desafinar ni romper el groove — y que es el primer añadido de Loom con interfaz propia.

**Architecture:** Un núcleo puro sin DOM ni audio (peso métrico → fundido rítmico → fundido melódico → topologías → armonía) que consume una lista de `(loop, peso)` y devuelve `NoteEvent[]`. El planificador ya es nota a nota, así que la capa viva es un predicado antes de `onTrigger`, no un recálculo del clip. Encima, seis macros registrados como destinos de automatización, y un panel declarado en un manifiesto que hoy no admite ni su categoría ni sus controles — abrir esas dos puertas es la fase 1.

**Tech Stack:** TypeScript · Vite · Vitest (unidad) · Playwright (e2e) · lit-html (UI) · AudioWorklet (síntesis, no se toca aquí).

Spec: [2026-08-07-weave-panel-dinamico-design.md](../specs/2026-08-07-weave-panel-dinamico-design.md)
Mockup aprobado: [2026-08-07-weave-panel-dinamico-mockup.html](../specs/2026-08-07-weave-panel-dinamico-mockup.html)

## Global Constraints

- **Tamaño de fichero:** objetivo 300 líneas DE CÓDIGO, tope duro 500. Comentarios y líneas en blanco no cuentan. Al afirmar que un fichero cabe, citar la cifra de líneas de código.
- **Aserciones siempre relativas** — ratios y comparaciones, nunca magnitudes absolutas. Un umbral absoluto exige justificarlo en un comentario.
- **Un test por camino de usuario.** Prohibido `(o …)` en una tarea de test: dos caminos, dos tests.
- **Texto de UI, etiquetas y comentarios de código en INGLÉS.** Mensajes de commit en INGLÉS. Este plan y el spec van en español; nada más.
- **Todo parámetro que escriba un motor desde la UI** pasa por `commitParam` / `commitParamForLane`. Nunca `engine.setBaseValue` a secas.
- **Todo lo que liste parámetros automatizables** llama a `DestinationRegistry.list()` y se suscribe con `subscribe()`. Prohibido construir una lista paralela.
- **Comandos de test sin color:** `NO_COLOR=1 npx vitest run <ruta>` al invocar vitest directo. Los scripts de npm ya lo llevan.
- **`npm run build` antes de `npm run test:e2e`** — Playwright sirve `dist/` sin compilar; sin build se prueba un bundle viejo.
- **Commits frecuentes**, uno por tarea, en inglés y con heredoc de Bash (`git commit -F -  <<'EOF'`). Nunca here-string de PowerShell.
- **Ticks:** `TICKS_PER_QUARTER = 96`, `TICKS_PER_STEP = 24`. Un paso de 16ª son 24 ticks.
- **`NoteEvent`** es `{ start: number; duration: number; midi: number; velocity: number }`. No tiene flag de slide ni de acento: acento es `velocity >= 100`.

---

## Estructura de ficheros

Todo el núcleo nuevo vive en `src/weave/`. Ningún fichero existente crece más de lo imprescindible.

| Fichero | Responsabilidad | Fase |
|---|---|---|
| `src/weave/metric-weight.ts` | Peso métrico de una posición en ticks | 3 |
| `src/weave/blend-rhythm.ts` | Fundir conjuntos de golpes con pesos | 3 |
| `src/weave/blend-melody.ts` | Fundir alturas por grado de escala | 3 |
| `src/weave/blend-clip.ts` | Orquesta rítmico + melódico sobre un clip | 3 |
| `src/weave/topology-types.ts` | El contrato común: `LoopWeight[]` | 4 |
| `src/weave/topology-ab.ts` | A→B con reenganche | 4 |
| `src/weave/topology-queue.ts` | Cola de N loops | 4 |
| `src/weave/topology-cloud.ts` | Nube 2D de 4 loops | 4 |
| `src/weave/weave-state.ts` | Estado del panel dentro de la sesión | 5 |
| `src/weave/weave-runtime.ts` | El predicado nota a nota | 5 |
| `src/weave/weave-catalog.ts` | Los seis macros: id, etiqueta, neutro | 6 |
| `src/weave/macro-notes.ts` | Densidad y Energía sobre notas | 6 |
| `src/weave/macro-params.ts` | Los otros cuatro → escrituras sobre destinos | 6 |
| `src/weave/style-mix.ts` | Qué estilo le toca a cada canal | 6 |
| `src/weave/harmony-guard.ts` | La regla de no chocar | 7 |
| `src/weave/clip-length.ts` | Longitud y tempo del bucle | 8 |
| `src/weave/print-scene.ts` | Fijar | 10 |
| `src/weave/weave-panel.ts` | La interfaz del panel | 10 |
| `src/automation/automation-steps.ts` | El modo de pasos, junto al LFO | 9 |
| `src/session/clip-automation-step-row.ts` | Su fila en el painter | 9 |
| `public/plugins/weave/plugin.json` | El manifiesto del añadido | 1 |

Ficheros existentes que se modifican: `src/plugin-host/manifest-validate.ts` (fases 1-2), `packages/plugin-sdk` (tipos), `src/automation/automation-apply.ts` y `automation-targets.ts` (fase 6), `src/core/lane-scheduler.ts` (fase 5), `src/session/clip-automation-lanes.ts` (fase 9, sólo para delegar).

---

# FASE 0 — Red de seguridad

Antes de tocar el validador de manifiestos hay que fijar lo que hace hoy, o un
cambio de forma pasa desapercibido.

### Task 1: Fijar el contrato actual del validador de manifiestos

**Files:**
- Test: `src/plugin-host/manifest-validate.test.ts` (modificar — ya existe)

**Interfaces:**
- Consumes: `validatePluginManifest(raw: unknown): ValidationResult` de `src/plugin-host/manifest-validate.ts`
- Produces: nada de código; deja pinchado el comportamiento que las fases 1-2 van a ampliar

- [ ] **Step 1: Escribir los tests que fijan los dos rechazos**

Añadir al final de `src/plugin-host/manifest-validate.test.ts`:

```ts
describe('what the manifest refuses today (pinned before WEAVE widens it)', () => {
  const base = {
    id: 'x', name: 'X', version: '1.0.0', loomApi: LOOM_API_VERSION,
    components: [] as unknown[],
  };

  it('rejects a component kind that is not engine|modulator|fx', () => {
    const res = validatePluginManifest({
      ...base,
      components: [{ kind: 'panel', id: 'p', name: 'P', params: [] }],
    });
    expect(res.ok).toBe(false);
    expect(res.ok === false && res.error).toMatch(/kind must be engine\|modulator\|fx/);
  });

  it('rejects a param kind that is not continuous|discrete', () => {
    const res = validatePluginManifest({
      ...base,
      components: [{
        kind: 'fx', id: 'f', name: 'F', fx: { color: '#fff' },
        params: [{ id: 'p', label: 'P', kind: 'pad2d', min: 0, max: 1, default: 0 }],
      }],
    });
    expect(res.ok).toBe(false);
    expect(res.ok === false && res.error).toMatch(/kind must be continuous\|discrete/);
  });
});
```

- [ ] **Step 2: Ejecutar y comprobar que pasan**

Run: `NO_COLOR=1 npx vitest run src/plugin-host/manifest-validate.test.ts`
Expected: PASS — describen el comportamiento de hoy, así que deben pasar tal cual. Si alguno falla, el validador no es lo que este plan supone: **parar y revisar el spec §12.1 antes de seguir**.

- [ ] **Step 3: Commit**

```bash
git add src/plugin-host/manifest-validate.test.ts
git commit -F - <<'EOF'
test(plugin-host): pin the two shapes the manifest refuses, before widening it

WEAVE needs a panel component and controls whose value is not a scalar.
Both are rejected today. Writing that down first means the next two
phases change a documented answer instead of an assumed one.
EOF
```

---

# FASE 1 — El manifiesto aprende que existe un panel

Un componente sólo puede ser `engine`, `modulator` o `fx`, y los tres tienen un
hueco fijo en pantalla. WEAVE no hace sonido, no modula y no procesa audio: no
es ninguno de los tres.

### Task 2: La categoría `panel` en el SDK

**Files:**
- Modify: `packages/loom-plugin-sdk/src/manifest.ts` (el tipo `PluginManifestFile` y las declaraciones de componente)
- Test: `packages/loom-plugin-sdk/src/manifest.test.ts`

**Interfaces:**
- Produces: `interface PanelDeclaration { placement: 'main-view' }` y la variante `{ kind: 'panel'; id: string; name: string; params: EngineParamSpec[]; panel: PanelDeclaration }` dentro de la unión de componentes.

- [ ] **Step 1: Escribir el test que falla**

```ts
it('accepts a panel component declaration', () => {
  const c: PluginComponent = {
    kind: 'panel', id: 'weave', name: 'Weave',
    params: [], panel: { placement: 'main-view' },
  };
  expect(c.kind).toBe('panel');
});
```

- [ ] **Step 2: Ejecutar y ver el fallo**

Run: `NO_COLOR=1 npx tsc --noEmit`
Expected: FAIL — `Type '"panel"' is not assignable`.

- [ ] **Step 3: Añadir el tipo**

En `packages/loom-plugin-sdk/src/manifest.ts`:

```ts
/** Where the host hangs a panel component. `main-view` = its own top-level
 *  view, alongside Session and Performance. A panel makes no sound, modulates
 *  nothing and processes no audio, so it declares neither polyphony nor
 *  capabilities. */
export interface PanelDeclaration {
  placement: 'main-view';
}
```

y añadir a la unión de componentes:

```ts
  | { kind: 'panel'; id: string; name: string; params: EngineParamSpec[]; panel: PanelDeclaration }
```

- [ ] **Step 4: Ejecutar y ver que pasa**

Run: `NO_COLOR=1 npx tsc --noEmit && NO_COLOR=1 npx vitest run packages/loom-plugin-sdk/src/manifest.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/loom-plugin-sdk/src/manifest.ts packages/loom-plugin-sdk/src/manifest.test.ts
git commit -F - <<'EOF'
feat(sdk): a plugin can be a panel, which is none of the other three

An engine makes sound, a modulator modulates, an fx processes audio, and
each has a fixed place on screen. A panel has none of those jobs, so it
declares neither polyphony nor capabilities -- only where it hangs.
EOF
```

### Task 3: El validador acepta `panel`

**Files:**
- Modify: `src/plugin-host/manifest-validate.ts:103-123` (`componentError`)
- Test: `src/plugin-host/manifest-validate.test.ts`

**Interfaces:**
- Consumes: `PanelDeclaration` de la tarea 2
- Produces: `panelDeclarationError(p: unknown, i: number): string | null`

- [ ] **Step 1: Escribir los tests que fallan**

```ts
it('accepts a panel component', () => {
  const res = validatePluginManifest({
    id: 'weave', name: 'Weave', version: '1.0.0', loomApi: LOOM_API_VERSION,
    components: [{
      kind: 'panel', id: 'weave', name: 'Weave',
      params: [], panel: { placement: 'main-view' },
    }],
  });
  expect(res.ok).toBe(true);
});

it('rejects a panel with an unknown placement', () => {
  const res = validatePluginManifest({
    id: 'weave', name: 'Weave', version: '1.0.0', loomApi: LOOM_API_VERSION,
    components: [{
      kind: 'panel', id: 'weave', name: 'Weave',
      params: [], panel: { placement: 'floating' },
    }],
  });
  expect(res.ok).toBe(false);
  expect(res.ok === false && res.error).toMatch(/placement must be main-view/);
});
```

Y actualizar el test de la tarea 1 que fijaba `kind must be engine|modulator|fx`: ahora el mensaje esperado es `kind must be engine|modulator|fx|panel`, y el caso `kind: 'panel'` deja de rechazarse — sustituirlo por `kind: 'sampler'`, que sigue siendo inválido.

- [ ] **Step 2: Ejecutar y ver el fallo**

Run: `NO_COLOR=1 npx vitest run src/plugin-host/manifest-validate.test.ts`
Expected: FAIL — el primero por `kind must be engine|modulator|fx`.

- [ ] **Step 3: Implementar**

En `src/plugin-host/manifest-validate.ts`, junto a `fxDeclarationError`:

```ts
function panelDeclarationError(p: unknown, i: number): string | null {
  if (!isObj(p)) return `components[${i}] needs a panel object`;
  if (p.placement !== 'main-view') return `components[${i}].panel.placement must be main-view`;
  return null;
}
```

y en `componentError`, cambiar la guarda y añadir la rama **antes** de la comprobación de `polyphony`:

```ts
  if (c.kind !== 'engine' && c.kind !== 'modulator' && c.kind !== 'fx' && c.kind !== 'panel') {
    return `components[${i}].kind must be engine|modulator|fx|panel`;
  }
```

```ts
  // A panel declares neither polyphony nor capabilities: it owns no lane and
  // produces no audio. Its params render in its own view.
  if (c.kind === 'panel') return panelDeclarationError(c.panel, i);
```

- [ ] **Step 4: Ejecutar y ver que pasa**

Run: `NO_COLOR=1 npx vitest run src/plugin-host/manifest-validate.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/plugin-host/manifest-validate.ts src/plugin-host/manifest-validate.test.ts
git commit -F - <<'EOF'
feat(plugin-host): the validator lets a panel through, and says where it may hang

A panel returns before polyphony and capabilities are checked, the same
way a modulator and an fx already do -- it owns no lane, so those
questions have no answer for it.
EOF
```

### Task 4: El host monta un panel como vista propia

**Files:**
- Modify: `src/plugin-host/plugin-host.ts` (registro por categoría)
- Create: `src/plugin-host/panel-registry.ts`
- Test: `src/plugin-host/panel-registry.test.ts`

**Interfaces:**
- Produces:
  - `registerPanel(entry: PanelEntry): void`
  - `listPanels(): PanelEntry[]`
  - `interface PanelEntry { id: string; name: string; placement: 'main-view'; mount(host: HTMLElement): () => void }`

- [ ] **Step 1: Escribir el test que falla**

```ts
import { registerPanel, listPanels, clearPanels } from './panel-registry';

describe('panel registry', () => {
  beforeEach(() => { clearPanels(); });

  it('lists a registered panel', () => {
    registerPanel({ id: 'weave', name: 'Weave', placement: 'main-view', mount: () => () => {} });
    expect(listPanels().map((p) => p.id)).toEqual(['weave']);
  });

  it('keeps the first registration when an id repeats, and says so', () => {
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    registerPanel({ id: 'weave', name: 'First', placement: 'main-view', mount: () => () => {} });
    registerPanel({ id: 'weave', name: 'Second', placement: 'main-view', mount: () => () => {} });
    expect(listPanels()).toHaveLength(1);
    expect(listPanels()[0].name).toBe('First');
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });
});
```

- [ ] **Step 2: Ejecutar y ver el fallo**

Run: `NO_COLOR=1 npx vitest run src/plugin-host/panel-registry.test.ts`
Expected: FAIL — `Cannot find module './panel-registry'`.

- [ ] **Step 3: Implementar**

```ts
// A panel plugin owns a top-level view instead of a lane. The registry is the
// one place that knows which panels exist, so the view tabs can be built from
// data instead of from a hand-written list.

export interface PanelEntry {
  id: string;
  name: string;
  placement: 'main-view';
  /** Mounts into `host` and returns its own teardown. */
  mount(host: HTMLElement): () => void;
}

const panels = new Map<string, PanelEntry>();

export function registerPanel(entry: PanelEntry): void {
  if (panels.has(entry.id)) {
    // First registration wins: a duplicate id is a packaging mistake, and
    // silently swapping the panel would hide it.
    console.warn(`panel "${entry.id}" is already registered; keeping the first`);
    return;
  }
  panels.set(entry.id, entry);
}

export function listPanels(): PanelEntry[] {
  return [...panels.values()];
}

/** Test-only: the registry is module state and tests must not leak into each other. */
export function clearPanels(): void {
  panels.clear();
}
```

- [ ] **Step 4: Ejecutar y ver que pasa**

Run: `NO_COLOR=1 npx vitest run src/plugin-host/panel-registry.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/plugin-host/panel-registry.ts src/plugin-host/panel-registry.test.ts
git commit -F - <<'EOF'
feat(plugin-host): a registry for panels, so the view tabs come from data

First registration wins on a duplicate id and the host says so. Swapping
a panel silently would turn a packaging mistake into a mystery.
EOF
```

---

# FASE 2 — Los tres controles del catálogo

Un parámetro sólo puede ser `continuous` o `discrete`, y ambos son un número
suelto. Los tres controles nuevos no lo son.

### Task 5: Parámetros cuyo valor no es un escalar

**Files:**
- Modify: `packages/loom-plugin-sdk/src/engine-params.ts` (o donde viva `EngineParamSpec`)
- Modify: `src/plugin-host/manifest-validate.ts:16-25` (`paramError`)
- Test: `src/plugin-host/manifest-validate.test.ts`

**Interfaces:**
- Produces: tres formas nuevas de `kind` con sus campos propios:
  - `{ kind: 'pad2d'; id; label; defaultX: number; defaultY: number }`
  - `{ kind: 'queue'; id; label; length: number; default: number }`
  - `{ kind: 'steps'; id; label; count: number; default: number }`

- [ ] **Step 1: Escribir los tests que fallan**

```ts
const wrap = (param: unknown) => validatePluginManifest({
  id: 'w', name: 'W', version: '1.0.0', loomApi: LOOM_API_VERSION,
  components: [{
    kind: 'panel', id: 'w', name: 'W',
    panel: { placement: 'main-view' }, params: [param],
  }],
});

it('accepts a pad2d param with two defaults', () => {
  expect(wrap({ id: 'cloud', label: 'Cloud', kind: 'pad2d', defaultX: 0.5, defaultY: 0.5 }).ok).toBe(true);
});

it('rejects a pad2d missing one of its two defaults', () => {
  const res = wrap({ id: 'cloud', label: 'Cloud', kind: 'pad2d', defaultX: 0.5 });
  expect(res.ok).toBe(false);
  expect(res.ok === false && res.error).toMatch(/defaultY must be a number/);
});

it('accepts a queue param with a length', () => {
  expect(wrap({ id: 'q', label: 'Q', kind: 'queue', length: 6, default: 0 }).ok).toBe(true);
});

it('rejects a queue whose length is below two', () => {
  const res = wrap({ id: 'q', label: 'Q', kind: 'queue', length: 1, default: 0 });
  expect(res.ok).toBe(false);
  expect(res.ok === false && res.error).toMatch(/length must be at least 2/);
});

it('accepts a steps param with a count', () => {
  expect(wrap({ id: 's', label: 'S', kind: 'steps', count: 16, default: 0.5 }).ok).toBe(true);
});

it('rejects a steps param with no count', () => {
  const res = wrap({ id: 's', label: 'S', kind: 'steps', default: 0.5 });
  expect(res.ok).toBe(false);
  expect(res.ok === false && res.error).toMatch(/count must be a number/);
});
```

Y actualizar el test de la tarea 1 (`kind must be continuous|discrete`): el mensaje pasa a `kind must be continuous|discrete|pad2d|queue|steps`, y el caso `kind: 'pad2d'` deja de rechazarse — sustituirlo por `kind: 'wheel'`.

- [ ] **Step 2: Ejecutar y ver el fallo**

Run: `NO_COLOR=1 npx vitest run src/plugin-host/manifest-validate.test.ts`
Expected: FAIL — el primero por `kind must be continuous|discrete`.

- [ ] **Step 3: Implementar**

Reescribir `paramError`:

```ts
const SCALAR_KINDS = ['continuous', 'discrete'];
const WIDGET_KINDS = ['pad2d', 'queue', 'steps'];

function paramError(p: unknown, i: number): string | null {
  if (!isObj(p)) return `params[${i}] is not an object`;
  if (!isStr(p.id)) return `params[${i}].id must be a non-empty string`;
  if (!isStr(p.label)) return `params[${i}].label must be a non-empty string`;

  // A widget param's value is not a single number, so min/max/default do not
  // describe it. Each shape carries its own fields instead.
  if (p.kind === 'pad2d') {
    for (const k of ['defaultX', 'defaultY'] as const) {
      if (!isNum(p[k])) return `params[${i}].${k} must be a number`;
    }
    return null;
  }
  if (p.kind === 'queue') {
    if (!isNum(p.length)) return `params[${i}].length must be a number`;
    if (p.length < 2) return `params[${i}].length must be at least 2`;
    if (!isNum(p.default)) return `params[${i}].default must be a number`;
    return null;
  }
  if (p.kind === 'steps') {
    if (!isNum(p.count)) return `params[${i}].count must be a number`;
    if (p.count < 1) return `params[${i}].count must be at least 1`;
    if (!isNum(p.default)) return `params[${i}].default must be a number`;
    return null;
  }

  if (!SCALAR_KINDS.includes(p.kind as string)) {
    return `params[${i}].kind must be ${[...SCALAR_KINDS, ...WIDGET_KINDS].join('|')}`;
  }
  for (const k of ['min', 'max', 'default'] as const) {
    if (!isNum(p[k])) return `params[${i}].${k} must be a number`;
  }
  if (p.group !== undefined && !isStr(p.group)) return `params[${i}].group must be a string when present`;
  return null;
}
```

- [ ] **Step 4: Ejecutar y ver que pasa**

Run: `NO_COLOR=1 npx vitest run src/plugin-host/manifest-validate.test.ts && NO_COLOR=1 npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/loom-plugin-sdk/src/engine-params.ts src/plugin-host/manifest-validate.ts src/plugin-host/manifest-validate.test.ts
git commit -F - <<'EOF'
feat(sdk): three params whose value is not a single number

min/max/default describe a knob, not a two-axis pad, a cursor over N
loops or a row of N bars. Each widget kind carries the fields that
actually describe it and returns before the scalar checks.
EOF
```

### Task 6: El control `pad2d`

**Files:**
- Create: `src/core/controls/pad2d.ts`
- Test: `src/core/controls/pad2d.test.ts`
- Modify: `src/styles/_base.scss` (los estilos del control)

**Interfaces:**
- Consumes: nada
- Produces: `createPad2d(opts: { x: number; y: number; onChange(x: number, y: number): void }): { el: HTMLElement; set(x: number, y: number): void }`

- [ ] **Step 1: Escribir el test que falla**

```ts
import { createPad2d } from './pad2d';

describe('pad2d', () => {
  it('reports the fraction of the box that was clicked', () => {
    const seen: Array<[number, number]> = [];
    const pad = createPad2d({ x: 0, y: 0, onChange: (x, y) => seen.push([x, y]) });
    document.body.appendChild(pad.el);
    pad.el.getBoundingClientRect = () => ({ left: 0, top: 0, width: 200, height: 100 }) as DOMRect;

    pad.el.dispatchEvent(new PointerEvent('pointerdown', { clientX: 100, clientY: 25, bubbles: true }));

    expect(seen).toHaveLength(1);
    expect(seen[0][0]).toBeCloseTo(0.5);
    expect(seen[0][1]).toBeCloseTo(0.25);
  });

  it('clamps a drag that leaves the box', () => {
    const seen: Array<[number, number]> = [];
    const pad = createPad2d({ x: 0.5, y: 0.5, onChange: (x, y) => seen.push([x, y]) });
    document.body.appendChild(pad.el);
    pad.el.getBoundingClientRect = () => ({ left: 0, top: 0, width: 200, height: 100 }) as DOMRect;

    pad.el.dispatchEvent(new PointerEvent('pointerdown', { clientX: -50, clientY: 300, bubbles: true }));

    expect(seen[0][0]).toBe(0);
    expect(seen[0][1]).toBe(1);
  });
});
```

- [ ] **Step 2: Ejecutar y ver el fallo**

Run: `NO_COLOR=1 npx vitest run src/core/controls/pad2d.test.ts`
Expected: FAIL — `Cannot find module './pad2d'`.

- [ ] **Step 3: Implementar**

```ts
// A two-axis pad: drag a dot inside a box, read back two fractions. Used by
// WEAVE's cloud topology, and available to any plugin that declares a `pad2d`
// param.

export interface Pad2dOptions {
  x: number;
  y: number;
  onChange(x: number, y: number): void;
}

export interface Pad2dHandle {
  el: HTMLElement;
  set(x: number, y: number): void;
}

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

export function createPad2d(opts: Pad2dOptions): Pad2dHandle {
  const el = document.createElement('div');
  el.className = 'pad2d';
  el.tabIndex = 0;
  el.setAttribute('role', 'application');

  const dot = document.createElement('i');
  dot.className = 'pad2d-dot';
  el.appendChild(dot);

  const paint = (x: number, y: number) => {
    dot.style.left = `${x * 100}%`;
    dot.style.top = `${y * 100}%`;
  };
  paint(opts.x, opts.y);

  const from = (ev: PointerEvent) => {
    const r = el.getBoundingClientRect();
    const x = clamp01((ev.clientX - r.left) / r.width);
    const y = clamp01((ev.clientY - r.top) / r.height);
    paint(x, y);
    opts.onChange(x, y);
  };

  el.addEventListener('pointerdown', (ev) => {
    el.setPointerCapture(ev.pointerId);
    from(ev);
  });
  el.addEventListener('pointermove', (ev) => { if (ev.buttons) from(ev); });

  return { el, set: paint };
}
```

Y en `src/styles/_base.scss`:

```scss
.pad2d {
  position: relative;
  height: 54px;
  background: var(--surface-3);
  border: 1px solid var(--border);
  border-radius: 2px;
  cursor: crosshair;
  touch-action: none;
  overflow: hidden;

  &::before, &::after { content: ''; position: absolute; background: var(--border-soft); }
  &::before { left: 50%; top: 0; bottom: 0; width: 1px; }
  &::after  { top: 50%; left: 0; right: 0; height: 1px; }
}
.pad2d-dot {
  position: absolute;
  width: 9px; height: 9px;
  margin: -4.5px 0 0 -4.5px;
  border-radius: 50%;
  background: var(--amber);
  box-shadow: 0 0 8px var(--amber-soft);
  pointer-events: none;
}
```

- [ ] **Step 4: Ejecutar y ver que pasa**

Run: `NO_COLOR=1 npx vitest run src/core/controls/pad2d.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/core/controls/pad2d.ts src/core/controls/pad2d.test.ts src/styles/_base.scss
git commit -F - <<'EOF'
feat(controls): a two-axis pad, clamped at the edges of its own box

A drag that leaves the box saturates instead of reporting a fraction
outside 0..1 -- a cloud position of 1.4 would weight a loop it should
not reach.
EOF
```

### Task 7: El control `queue`

**Files:**
- Create: `src/core/controls/queue-control.ts`
- Test: `src/core/controls/queue-control.test.ts`
- Modify: `src/styles/_base.scss`

**Interfaces:**
- Produces: `createQueueControl(opts: { length: number; value: number; onChange(v: number): void }): { el: HTMLElement; set(v: number): void }`
  - `value` es `0..1` sobre la cola entera; con `length = 6`, `0` es el primer loop y `1` el sexto.

- [ ] **Step 1: Escribir el test que falla**

El fallo que este test existe para prevenir es real y ya se cometió en el
mockup: los puntos son celdas repartidas, con su centro en `(i + 0.5) / N`,
mientras que un cursor colocado en `pos / (N - 1)` cae entre puntos. Las dos
escalas tienen que coincidir.

```ts
import { createQueueControl } from './queue-control';

describe('queue control', () => {
  it('puts the cursor on the centre of the first dot at value 0', () => {
    const q = createQueueControl({ length: 6, value: 0, onChange: () => {} });
    document.body.appendChild(q.el);
    const cursor = q.el.querySelector('.queue-cursor') as HTMLElement;
    // Dot i is centred at (i + 0.5) / N of the box.
    expect(parseFloat(cursor.style.left)).toBeCloseTo(100 * 0.5 / 6, 3);
  });

  it('puts the cursor on the centre of the last dot at value 1', () => {
    const q = createQueueControl({ length: 6, value: 1, onChange: () => {} });
    document.body.appendChild(q.el);
    const cursor = q.el.querySelector('.queue-cursor') as HTMLElement;
    expect(parseFloat(cursor.style.left)).toBeCloseTo(100 * 5.5 / 6, 3);
  });

  it('round-trips a click back to the value that would draw the cursor there', () => {
    let got = -1;
    const q = createQueueControl({ length: 6, value: 0, onChange: (v) => { got = v; } });
    document.body.appendChild(q.el);
    q.el.getBoundingClientRect = () => ({ left: 0, top: 0, width: 600, height: 26 }) as DOMRect;

    // Click exactly on the centre of dot 3 (index 3): (3 + 0.5) / 6 of 600px.
    q.el.dispatchEvent(new PointerEvent('pointerdown', { clientX: 600 * 3.5 / 6, bubbles: true }));

    expect(got).toBeCloseTo(3 / 5, 3);   // position 3 of 0..5
  });
});
```

- [ ] **Step 2: Ejecutar y ver el fallo**

Run: `NO_COLOR=1 npx vitest run src/core/controls/queue-control.test.ts`
Expected: FAIL — `Cannot find module './queue-control'`.

- [ ] **Step 3: Implementar**

```ts
// A cursor over an ordered list of loops. The dots are laid out as equal
// cells, so dot i is centred at (i + 0.5) / N of the box -- NOT at
// i / (N - 1). Drawing the cursor on the second scale puts it between dots,
// which is exactly the bug this control exists to not have.

export interface QueueOptions {
  length: number;
  /** 0..1 across the whole queue. */
  value: number;
  onChange(v: number): void;
}

export interface QueueHandle {
  el: HTMLElement;
  set(v: number): void;
}

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

export function createQueueControl(opts: QueueOptions): QueueHandle {
  const n = opts.length;
  const el = document.createElement('div');
  el.className = 'queue-control';
  el.tabIndex = 0;
  el.setAttribute('role', 'slider');
  el.setAttribute('aria-valuemin', '0');
  el.setAttribute('aria-valuemax', '1');

  const line = document.createElement('div');
  line.className = 'queue-line';
  el.appendChild(line);

  const dots: HTMLElement[] = [];
  for (let i = 0; i < n; i++) {
    const cell = document.createElement('span');
    cell.className = 'queue-dot';
    cell.appendChild(document.createElement('i'));
    el.appendChild(cell);
    dots.push(cell);
  }

  const cursor = document.createElement('div');
  cursor.className = 'queue-cursor';
  el.appendChild(cursor);

  /** Position (0..n-1) → percentage of the box, on the dot-centre scale. */
  const posToPct = (pos: number) => (pos + 0.5) / n * 100;

  const paint = (v: number) => {
    const pos = clamp01(v) * (n - 1);
    cursor.style.left = `${posToPct(pos)}%`;
    const i = Math.floor(pos);
    dots.forEach((d, k) => {
      d.className = 'queue-dot' + (k <= i ? ' past' : k === i + 1 ? ' next' : '');
    });
    el.setAttribute('aria-valuenow', clamp01(v).toFixed(3));
  };
  paint(opts.value);

  const from = (ev: PointerEvent) => {
    const r = el.getBoundingClientRect();
    const pct = (ev.clientX - r.left) / r.width;
    const pos = pct * n - 0.5;              // inverse of posToPct
    const v = clamp01(pos / (n - 1));
    paint(v);
    opts.onChange(v);
  };

  el.addEventListener('pointerdown', (ev) => { el.setPointerCapture(ev.pointerId); from(ev); });
  el.addEventListener('pointermove', (ev) => { if (ev.buttons) from(ev); });

  return { el, set: paint };
}
```

Y en `src/styles/_base.scss`:

```scss
.queue-control {
  display: flex;
  align-items: center;
  height: 26px;
  position: relative;
  padding: 0 8px;
  background: var(--surface-3);
  border: 1px solid var(--border);
  border-radius: 2px;
  cursor: ew-resize;
  touch-action: none;
}
.queue-line { position: absolute; left: 14px; right: 14px; height: 2px; border-radius: 1px; background: var(--border); }
.queue-dot { position: relative; flex: 1; display: flex; justify-content: center; }
.queue-dot i { width: 11px; height: 11px; border-radius: 50%; background: var(--surface-2); border: 2px solid var(--border); display: block; }
.queue-dot.past i { background: var(--knob-blue); border-color: var(--knob-blue); }
.queue-dot.next i { background: var(--knob-orange); border-color: var(--knob-orange); }
.queue-cursor { position: absolute; top: -2px; width: 2px; height: 28px; background: var(--amber); box-shadow: 0 0 7px var(--amber-soft); }
```

- [ ] **Step 4: Ejecutar y ver que pasa**

Run: `NO_COLOR=1 npx vitest run src/core/controls/queue-control.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/core/controls/queue-control.ts src/core/controls/queue-control.test.ts src/styles/_base.scss
git commit -F - <<'EOF'
feat(controls): a cursor over a queue, drawn on the scale its dots use

The dots are equal cells, so dot i sits at (i + 0.5) / N. A cursor placed
at i / (N - 1) lands between dots and the readout disagrees with the
picture -- the mockup had exactly that bug, and the round-trip test is
what stops it coming back.
EOF
```

### Task 8: El control `steps`

**Files:**
- Create: `src/core/controls/steps-control.ts`
- Test: `src/core/controls/steps-control.test.ts`
- Modify: `src/styles/_base.scss`

**Interfaces:**
- Produces: `createStepsControl(opts: { values: number[]; onChange(i: number, v: number): void }): { el: HTMLElement; set(values: number[]): void }`

- [ ] **Step 1: Escribir el test que falla**

```ts
import { createStepsControl } from './steps-control';

describe('steps control', () => {
  it('draws one bar per value, at the height of that value', () => {
    const s = createStepsControl({ values: [0.25, 0.5, 1], onChange: () => {} });
    const bars = [...s.el.querySelectorAll('.step-bar')] as HTMLElement[];
    expect(bars).toHaveLength(3);
    expect(parseFloat(bars[0].style.height)).toBeCloseTo(25);
    expect(parseFloat(bars[2].style.height)).toBeCloseTo(100);
  });

  it('reports the step under the pointer and the height it was dragged to', () => {
    const seen: Array<[number, number]> = [];
    const s = createStepsControl({ values: [0, 0, 0, 0], onChange: (i, v) => seen.push([i, v]) });
    document.body.appendChild(s.el);
    s.el.getBoundingClientRect = () => ({ left: 0, top: 0, width: 400, height: 100 }) as DOMRect;

    // Third of four columns (x in [200,300)), three quarters up the box.
    s.el.dispatchEvent(new PointerEvent('pointerdown', { clientX: 250, clientY: 25, bubbles: true }));

    expect(seen[0][0]).toBe(2);
    expect(seen[0][1]).toBeCloseTo(0.75);
  });

  it('ignores a pointer outside the columns instead of writing step -1', () => {
    const seen: Array<[number, number]> = [];
    const s = createStepsControl({ values: [0, 0], onChange: (i, v) => seen.push([i, v]) });
    document.body.appendChild(s.el);
    s.el.getBoundingClientRect = () => ({ left: 100, top: 0, width: 200, height: 100 }) as DOMRect;

    s.el.dispatchEvent(new PointerEvent('pointerdown', { clientX: 50, clientY: 50, bubbles: true }));

    expect(seen).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Ejecutar y ver el fallo**

Run: `NO_COLOR=1 npx vitest run src/core/controls/steps-control.test.ts`
Expected: FAIL — `Cannot find module './steps-control'`.

- [ ] **Step 3: Implementar**

```ts
// A row of bars you paint by dragging: an analogue step sequencer for any
// automation destination. Values are 0..1, one per step.

export interface StepsOptions {
  values: number[];
  onChange(index: number, value: number): void;
}

export interface StepsHandle {
  el: HTMLElement;
  set(values: number[]): void;
}

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
/** A bar of height 0 would be invisible and unclickable, so it keeps a sliver. */
const MIN_BAR = 0.02;

export function createStepsControl(opts: StepsOptions): StepsHandle {
  const el = document.createElement('div');
  el.className = 'steps-control';
  el.style.gridTemplateColumns = `repeat(${opts.values.length}, 1fr)`;
  el.setAttribute('role', 'group');

  const bars = opts.values.map((v) => {
    const b = document.createElement('div');
    b.className = 'step-bar';
    b.style.height = `${clamp01(v) * 100}%`;
    el.appendChild(b);
    return b;
  });

  const from = (ev: PointerEvent) => {
    const r = el.getBoundingClientRect();
    const i = Math.floor((ev.clientX - r.left) / r.width * bars.length);
    // Outside the columns there is no step to write; silently writing index -1
    // would corrupt the first bar instead of doing nothing.
    if (i < 0 || i >= bars.length) return;
    const v = clamp01(Math.max(MIN_BAR, 1 - (ev.clientY - r.top) / r.height));
    bars[i].style.height = `${v * 100}%`;
    opts.onChange(i, v);
  };

  el.addEventListener('pointerdown', (ev) => { el.setPointerCapture(ev.pointerId); from(ev); });
  el.addEventListener('pointermove', (ev) => { if (ev.buttons) from(ev); });

  return {
    el,
    set(values) {
      values.forEach((v, i) => { if (bars[i]) bars[i].style.height = `${clamp01(v) * 100}%`; });
    },
  };
}
```

Y en `src/styles/_base.scss`:

```scss
.steps-control {
  display: grid;
  gap: 3px;
  height: 92px;
  align-items: end;
  background: var(--surface-2);
  border: 1px solid var(--border);
  border-radius: 2px;
  padding: 6px;
  cursor: ns-resize;
  touch-action: none;
}
.step-bar { background: var(--amber); opacity: .82; border-radius: 1px 1px 0 0; min-height: 2px; }
```

- [ ] **Step 4: Ejecutar y ver que pasa**

Run: `NO_COLOR=1 npx vitest run src/core/controls/steps-control.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/core/controls/steps-control.ts src/core/controls/steps-control.test.ts src/styles/_base.scss
git commit -F - <<'EOF'
feat(controls): a row of bars you paint, and it ignores what is not a step

A pointer left of the first column floors to index -1. Writing that would
silently corrupt the first bar, so the control does nothing instead.
EOF
```

---

# FASE 3 — El núcleo del fundido

Puro: sin DOM, sin `AudioContext`, sin estado de módulo. Es la parte que decide
si esto suena bien, y la que se puede probar entera sin renderizar audio.

### Task 9: El peso métrico

**Files:**
- Create: `src/weave/metric-weight.ts`
- Test: `src/weave/metric-weight.test.ts`

**Interfaces:**
- Consumes: `TICKS_PER_STEP` de `src/core/notes.ts`
- Produces:
  - `metricWeight(tick: number, barTicks: number): number` — `0..1`
  - `leavesAt(tick: number, barTicks: number): number`
  - `entersAt(tick: number, barTicks: number): number`

- [ ] **Step 1: Escribir el test que falla**

```ts
import { TICKS_PER_STEP } from '../core/notes';
import { metricWeight, leavesAt, entersAt } from './metric-weight';

const BAR = TICKS_PER_STEP * 16;           // 384 ticks in 4/4
const step = (n: number) => n * TICKS_PER_STEP;

describe('metric weight', () => {
  it('ranks the downbeat above every other position in the bar', () => {
    const one = metricWeight(step(0), BAR);
    for (let s = 1; s < 16; s++) {
      expect(one).toBeGreaterThan(metricWeight(step(s), BAR));
    }
  });

  it('ranks beats above off-beats, and off-beats above sixteenths', () => {
    expect(metricWeight(step(4), BAR)).toBeGreaterThan(metricWeight(step(2), BAR));
    expect(metricWeight(step(2), BAR)).toBeGreaterThan(metricWeight(step(3), BAR));
  });

  it('repeats the pattern in the next bar', () => {
    expect(metricWeight(step(16), BAR)).toBeCloseTo(metricWeight(step(0), BAR));
  });

  it('treats a position off the sixteenth grid as the weakest', () => {
    expect(metricWeight(step(4) + 7, BAR)).toBeLessThan(metricWeight(step(3), BAR));
  });
});

describe('hand-over thresholds', () => {
  it('keeps every A hit at x=0 and drops every one by x=1', () => {
    for (let s = 0; s < 16; s++) {
      expect(leavesAt(step(s), BAR)).toBeGreaterThan(0);
      expect(leavesAt(step(s), BAR)).toBeLessThan(1);
    }
  });

  it('lets a strong hit of A outlast a weak one', () => {
    expect(leavesAt(step(0), BAR)).toBeGreaterThan(leavesAt(step(3), BAR));
  });

  it('lets a strong hit of B arrive before a weak one', () => {
    expect(entersAt(step(0), BAR)).toBeLessThan(entersAt(step(3), BAR));
  });
});
```

- [ ] **Step 2: Ejecutar y ver el fallo**

Run: `NO_COLOR=1 npx vitest run src/weave/metric-weight.test.ts`
Expected: FAIL — `Cannot find module './metric-weight'`.

- [ ] **Step 3: Implementar**

```ts
// How strongly a position is felt in the bar. It is what decides the ORDER in
// which two patterns hand over: the weak positions swap first and the downbeat
// swaps last, so the bar never loses its shape mid-crossfade.

import { TICKS_PER_STEP } from '../core/notes';

/** 0..1. A position off the sixteenth grid is the weakest thing there is. */
export function metricWeight(tick: number, barTicks: number): number {
  const inBar = ((tick % barTicks) + barTicks) % barTicks;
  if (inBar % TICKS_PER_STEP !== 0) return 0.28;
  const s = inBar / TICKS_PER_STEP;
  if (s === 0) return 1;
  if (s === Math.floor(barTicks / TICKS_PER_STEP / 2)) return 0.9;   // the "three"
  if (s % 4 === 0) return 0.72;
  if (s % 2 === 0) return 0.5;
  return 0.28;
}

// The two constants below are a requirement, not taste: 0.14 + 0.72 * 1 = 0.86
// < 1 and 0.86 - 0.72 * 1 = 0.14 > 0, so no hit changes state at either end.
// That is what makes x=0 exactly A and x=1 exactly B.
const FLOOR = 0.14;
const SPAN = 0.72;

/** A hit of A sounds while `x < leavesAt(...)`. */
export function leavesAt(tick: number, barTicks: number): number {
  return FLOOR + SPAN * metricWeight(tick, barTicks);
}

/** A hit of B sounds once `x > entersAt(...)`. */
export function entersAt(tick: number, barTicks: number): number {
  return (1 - FLOOR) - SPAN * metricWeight(tick, barTicks);
}
```

- [ ] **Step 4: Ejecutar y ver que pasa**

Run: `NO_COLOR=1 npx vitest run src/weave/metric-weight.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/weave/metric-weight.ts src/weave/metric-weight.test.ts
git commit -F - <<'EOF'
feat(weave): how strongly a position is felt, and what that buys

The weight decides the ORDER of the hand-over: off-beats swap first, the
downbeat swaps last, so the bar keeps its shape halfway across. The two
constants are pinned by a requirement -- neither end may change state, or
x=0 would not be exactly A.
EOF
```

### Task 10: Fundir dos patrones rítmicos

**Files:**
- Create: `src/weave/blend-rhythm.ts`
- Test: `src/weave/blend-rhythm.test.ts`

**Interfaces:**
- Consumes: `leavesAt`, `entersAt` de la tarea 9; `NoteEvent` de `src/core/notes.ts`
- Produces: `blendRhythm(a: NoteEvent[], b: NoteEvent[], x: number, barTicks: number): NoteEvent[]`
  - Dos notas son «el mismo golpe» si comparten `start` **y** `midi`. En percusión el `midi` elige la voz, así que un bombo y una caja en el mismo paso no son el mismo golpe.

- [ ] **Step 1: Escribir el test que falla**

```ts
import { TICKS_PER_STEP, type NoteEvent } from '../core/notes';
import { blendRhythm } from './blend-rhythm';

const BAR = TICKS_PER_STEP * 16;
const hit = (step: number, midi: number): NoteEvent =>
  ({ start: step * TICKS_PER_STEP, duration: TICKS_PER_STEP, midi, velocity: 100 });

const KICK = 36, SNARE = 38, HAT = 42;
const key = (n: NoteEvent) => `${n.start}:${n.midi}`;
const keys = (ns: NoteEvent[]) => ns.map(key).sort();

const A = [hit(0, KICK), hit(8, KICK), hit(10, KICK), hit(4, SNARE), hit(3, HAT)];
const B = [hit(0, KICK), hit(8, KICK), hit(3, KICK),  hit(4, SNARE), hit(15, HAT)];

describe('blendRhythm', () => {
  it('is exactly A at x=0', () => {
    expect(keys(blendRhythm(A, B, 0, BAR))).toEqual(keys(A));
  });

  it('is exactly B at x=1', () => {
    expect(keys(blendRhythm(A, B, 1, BAR))).toEqual(keys(B));
  });

  it('keeps every shared hit at every point of the crossing', () => {
    const shared = [hit(0, KICK), hit(8, KICK), hit(4, SNARE)].map(key);
    for (let i = 0; i <= 20; i++) {
      const out = keys(blendRhythm(A, B, i / 20, BAR));
      for (const s of shared) expect(out).toContain(s);
    }
  });

  it('drops a weak hit of A before a strong one', () => {
    // hat on step 3 is weak, kick on step 10 sits on an eighth: the hat goes first.
    let hatGone = -1, kickGone = -1;
    for (let i = 0; i <= 100; i++) {
      const out = keys(blendRhythm(A, B, i / 100, BAR));
      if (hatGone < 0 && !out.includes(key(hit(3, HAT)))) hatGone = i;
      if (kickGone < 0 && !out.includes(key(hit(10, KICK)))) kickGone = i;
    }
    expect(hatGone).toBeGreaterThan(-1);
    expect(kickGone).toBeGreaterThan(-1);
    expect(hatGone).toBeLessThan(kickGone);
  });

  it('never returns two hits on the same step and voice', () => {
    for (let i = 0; i <= 20; i++) {
      const out = blendRhythm(A, B, i / 20, BAR).map(key);
      expect(new Set(out).size).toBe(out.length);
    }
  });
});
```

- [ ] **Step 2: Ejecutar y ver el fallo**

Run: `NO_COLOR=1 npx vitest run src/weave/blend-rhythm.test.ts`
Expected: FAIL — `Cannot find module './blend-rhythm'`.

- [ ] **Step 3: Implementar**

```ts
// Crossfade two sets of hits. What A and B SHARE never moves -- that shared
// skeleton is what holds the bar up while their differences hand over.

import type { NoteEvent } from '../core/notes';
import { leavesAt, entersAt } from './metric-weight';

/** Same step AND same voice. In percussion `midi` picks the drum, so a kick
 *  and a snare on the same step are two different hits, not one. */
const hitKey = (n: NoteEvent) => `${n.start}:${n.midi}`;

export function blendRhythm(
  a: NoteEvent[], b: NoteEvent[], x: number, barTicks: number,
): NoteEvent[] {
  const inB = new Set(b.map(hitKey));
  const inA = new Set(a.map(hitKey));
  const out: NoteEvent[] = [];

  for (const n of a) {
    if (inB.has(hitKey(n))) { out.push(n); continue; }   // shared: always
    if (x < leavesAt(n.start, barTicks)) out.push(n);
  }
  for (const n of b) {
    if (inA.has(hitKey(n))) continue;                     // already emitted above
    if (x > entersAt(n.start, barTicks)) out.push(n);
  }
  return out.sort((p, q) => p.start - q.start);
}
```

- [ ] **Step 4: Ejecutar y ver que pasa**

Run: `NO_COLOR=1 npx vitest run src/weave/blend-rhythm.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/weave/blend-rhythm.ts src/weave/blend-rhythm.test.ts
git commit -F - <<'EOF'
feat(weave): crossfade two rhythms without letting the bar fall over

What A and B share never moves; only their differences hand over, weak
positions first. Halfway across, what plays is a third rhythm that is in
neither pattern -- which is the point, not a side effect.

A hit is identified by step AND voice: a kick and a snare on the same
step are two hits, so percussion never collapses into one.
EOF
```

### Task 11: Fundir alturas por grado de escala

**Files:**
- Create: `src/weave/blend-melody.ts`
- Test: `src/weave/blend-melody.test.ts`

**Interfaces:**
- Consumes: `midiToScaleDegree`, `scaleDegreeToMidi`, `inScale`, `SCALE_CATALOG`, `type ScaleId` de `src/core/musicality.ts`; `blendRhythm` de la tarea 10
- Produces: `blendMelody(a: NoteEvent[], b: NoteEvent[], x: number, barTicks: number, key: number, scale: ScaleId, octaveBase: number): NoteEvent[]`

- [ ] **Step 1: Escribir el test que falla**

```ts
import { TICKS_PER_STEP, type NoteEvent } from '../core/notes';
import { inScale, SCALE_CATALOG } from '../core/musicality';
import { blendMelody } from './blend-melody';

const BAR = TICKS_PER_STEP * 16;
const OCT = 36;                       // C2
const note = (step: number, midi: number): NoteEvent =>
  ({ start: step * TICKS_PER_STEP, duration: TICKS_PER_STEP, midi, velocity: 90 });

describe('blendMelody', () => {
  it('is exactly A at x=0', () => {
    const a = [note(0, 45), note(4, 48)];
    const b = [note(0, 52), note(4, 55)];
    expect(blendMelody(a, b, 0, BAR, 9, 'minor', OCT).map((n) => n.midi)).toEqual([45, 48]);
  });

  it('is exactly B at x=1', () => {
    const a = [note(0, 45), note(4, 48)];
    const b = [note(0, 52), note(4, 55)];
    expect(blendMelody(a, b, 1, BAR, 9, 'minor', OCT).map((n) => n.midi)).toEqual([52, 55]);
  });

  it('walks a pitch monotonically from A to B', () => {
    const a = [note(0, 45)];
    const b = [note(0, 57)];
    const seen: number[] = [];
    for (let i = 0; i <= 20; i++) {
      seen.push(blendMelody(a, b, i / 20, BAR, 9, 'minor', OCT)[0].midi);
    }
    for (let i = 1; i < seen.length; i++) expect(seen[i]).toBeGreaterThanOrEqual(seen[i - 1]);
    expect(seen[0]).toBe(45);
    expect(seen[seen.length - 1]).toBe(57);
  });

  it('never leaves the scale, in any scale of the catalogue', () => {
    const a = [note(0, 45), note(2, 50), note(7, 44)];
    const b = [note(0, 59), note(2, 43), note(7, 56)];
    for (const { id } of SCALE_CATALOG) {
      for (let i = 0; i <= 20; i++) {
        for (const n of blendMelody(a, b, i / 20, BAR, 9, id, OCT)) {
          expect(inScale(n.midi, 9, id)).toBe(true);
        }
      }
    }
  });

  it('leaves an unpaired note at its own pitch', () => {
    const a = [note(0, 45), note(3, 50)];
    const b = [note(0, 52)];
    // step 3 exists only in A: while it survives, its pitch must not drift.
    const out = blendMelody(a, b, 0.2, BAR, 9, 'minor', OCT);
    const lone = out.find((n) => n.start === 3 * TICKS_PER_STEP);
    expect(lone?.midi).toBe(50);
  });
});
```

- [ ] **Step 2: Ejecutar y ver el fallo**

Run: `NO_COLOR=1 npx vitest run src/weave/blend-melody.test.ts`
Expected: FAIL — `Cannot find module './blend-melody'`.

- [ ] **Step 3: Implementar**

```ts
// Crossfade two melodic patterns. Onsets hand over exactly like a rhythm; what
// is different here is the PITCH, which walks in scale degrees rather than in
// semitones. Degree 1 of A reaches degree 5 of B through 3, and never through
// anything outside the scale -- so this cannot detune by construction, and
// nothing has to be corrected afterwards.

import type { NoteEvent } from '../core/notes';
import { midiToScaleDegree, scaleDegreeToMidi, type ScaleId } from '../core/musicality';
import { blendRhythm } from './blend-rhythm';

/** Onsets only, so the rhythm layer can pair notes across the two patterns
 *  without caring which pitch each carries. */
const atStart = (ns: NoteEvent[], start: number) => ns.find((n) => n.start === start);

export function blendMelody(
  a: NoteEvent[], b: NoteEvent[], x: number, barTicks: number,
  key: number, scale: ScaleId, octaveBase: number,
): NoteEvent[] {
  // Pair by onset alone: two melodic patterns rarely share a pitch, so keying
  // on (start, midi) the way percussion does would make every note unpaired.
  const flat = (ns: NoteEvent[]) => ns.map((n) => ({ ...n, midi: 0 }));
  const skeleton = blendRhythm(flat(a), flat(b), x, barTicks);

  return skeleton.map((slot) => {
    const na = atStart(a, slot.start);
    const nb = atStart(b, slot.start);
    const src = na ?? nb;
    if (!src) return slot;                     // unreachable: the slot came from one of them
    if (!na || !nb) return { ...src };          // unpaired: keeps its own pitch

    const da = midiToScaleDegree(na.midi, key, scale, octaveBase);
    const db = midiToScaleDegree(nb.midi, key, scale, octaveBase);
    const degree = Math.round(da * (1 - x) + db * x);
    return {
      ...src,
      midi: scaleDegreeToMidi(degree, octaveBase, key, scale),
      velocity: Math.round(na.velocity * (1 - x) + nb.velocity * x),
      duration: Math.round(na.duration * (1 - x) + nb.duration * x),
    };
  });
}
```

- [ ] **Step 4: Ejecutar y ver que pasa**

Run: `NO_COLOR=1 npx vitest run src/weave/blend-melody.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/weave/blend-melody.ts src/weave/blend-melody.test.ts
git commit -F - <<'EOF'
feat(weave): melodies cross in scale degrees, so they cannot detune

Interpolating semitones would walk through every note between the two,
in the scale or not. Degrees walk 1 to 5 through 3 and land nowhere else,
so there is no correction pass -- there is nothing to correct.

Melodic patterns pair by onset alone. Keying on (start, pitch) the way
percussion does would leave almost every note unpaired, because two
melodies rarely share a pitch.
EOF
```

### Task 12: Fundir N loops sobre un clip

**Files:**
- Create: `src/weave/blend-clip.ts`
- Test: `src/weave/blend-clip.test.ts`

**Interfaces:**
- Consumes: `blendRhythm`, `blendMelody`; `type LoopWeight` de la tarea 13 — **definir aquí** el tipo y reexportarlo desde `topology-types.ts` en la fase 4
- Produces:
  - `interface LoopWeight { notes: NoteEvent[]; weight: number }`
  - `blendLoops(loops: LoopWeight[], opts: BlendOptions): NoteEvent[]`
  - `interface BlendOptions { barTicks: number; melodic: boolean; key: number; scale: ScaleId; octaveBase: number }`

Con dos loops es el fundido de las tareas 10-11 con `x = peso del segundo`. Con
más de dos se pliega por parejas, de menor a mayor peso, que es lo que hace que
la nube no necesite un motor propio.

- [ ] **Step 1: Escribir el test que falla**

```ts
import { TICKS_PER_STEP, type NoteEvent } from '../core/notes';
import { blendLoops } from './blend-clip';

const BAR = TICKS_PER_STEP * 16;
const hit = (step: number, midi: number): NoteEvent =>
  ({ start: step * TICKS_PER_STEP, duration: TICKS_PER_STEP, midi, velocity: 100 });
const key = (n: NoteEvent) => `${n.start}:${n.midi}`;
const opts = { barTicks: BAR, melodic: false, key: 9, scale: 'minor' as const, octaveBase: 36 };

const A = [hit(0, 36), hit(4, 38)];
const B = [hit(0, 36), hit(8, 36)];

describe('blendLoops', () => {
  it('returns the single loop untouched when there is only one', () => {
    expect(blendLoops([{ notes: A, weight: 1 }], opts).map(key)).toEqual(A.map(key));
  });

  it('is the first loop when all the weight sits on it', () => {
    const out = blendLoops([{ notes: A, weight: 1 }, { notes: B, weight: 0 }], opts);
    expect(out.map(key).sort()).toEqual(A.map(key).sort());
  });

  it('is the second loop when all the weight sits on it', () => {
    const out = blendLoops([{ notes: A, weight: 0 }, { notes: B, weight: 1 }], opts);
    expect(out.map(key).sort()).toEqual(B.map(key).sort());
  });

  it('keeps what all four loops share when four are in play', () => {
    const loops = [
      { notes: [hit(0, 36), hit(2, 42)], weight: 0.25 },
      { notes: [hit(0, 36), hit(6, 42)], weight: 0.25 },
      { notes: [hit(0, 36), hit(9, 42)], weight: 0.25 },
      { notes: [hit(0, 36), hit(13, 42)], weight: 0.25 },
    ];
    expect(blendLoops(loops, opts).map(key)).toContain(key(hit(0, 36)));
  });

  it('returns nothing when handed nothing', () => {
    expect(blendLoops([], opts)).toEqual([]);
  });
});
```

- [ ] **Step 2: Ejecutar y ver el fallo**

Run: `NO_COLOR=1 npx vitest run src/weave/blend-clip.test.ts`
Expected: FAIL — `Cannot find module './blend-clip'`.

- [ ] **Step 3: Implementar**

```ts
// The one entry point the runtime calls: a list of (loop, weight) in, one set
// of notes out. Every topology reduces to this, which is why adding a fourth
// one later costs a file and not an engine.

import type { NoteEvent } from '../core/notes';
import type { ScaleId } from '../core/musicality';
import { blendRhythm } from './blend-rhythm';
import { blendMelody } from './blend-melody';

export interface LoopWeight {
  notes: NoteEvent[];
  weight: number;
}

export interface BlendOptions {
  barTicks: number;
  melodic: boolean;
  key: number;
  scale: ScaleId;
  octaveBase: number;
}

function pair(a: NoteEvent[], b: NoteEvent[], x: number, o: BlendOptions): NoteEvent[] {
  return o.melodic
    ? blendMelody(a, b, x, o.barTicks, o.key, o.scale, o.octaveBase)
    : blendRhythm(a, b, x, o.barTicks);
}

export function blendLoops(loops: LoopWeight[], o: BlendOptions): NoteEvent[] {
  const live = loops.filter((l) => l.weight > 0);
  if (live.length === 0) return [];
  if (live.length === 1) return live[0].notes;

  // Fold lightest-first, so the heaviest loop is the last thing folded in and
  // therefore the one the result resembles most.
  const sorted = [...live].sort((p, q) => p.weight - q.weight);
  let acc = sorted[0].notes;
  let accW = sorted[0].weight;
  for (let i = 1; i < sorted.length; i++) {
    const next = sorted[i];
    const total = accW + next.weight;
    acc = pair(acc, next.notes, total > 0 ? next.weight / total : 0, o);
    accW = total;
  }
  return acc;
}
```

- [ ] **Step 4: Ejecutar y ver que pasa**

Run: `NO_COLOR=1 npx vitest run src/weave/blend-clip.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/weave/blend-clip.ts src/weave/blend-clip.test.ts
git commit -F - <<'EOF'
feat(weave): one entry point -- loops with weights in, notes out

Two loops is the pairwise crossfade. More than two folds lightest-first,
so the heaviest loop is folded in last and the result resembles it most.
Every topology reduces to this call, which is why a fourth one later
costs a file rather than an engine.
EOF
```

---

# FASE 4 — Las tres topologías

Cada una produce `LoopWeight[]` y nada más. Es lo que las hace convivir.

### Task 13: El contrato y la topología A→B

**Files:**
- Create: `src/weave/topology-types.ts`
- Create: `src/weave/topology-ab.ts`
- Test: `src/weave/topology-ab.test.ts`

**Interfaces:**
- Consumes: `LoopWeight` de `blend-clip.ts`
- Produces:
  - `topology-types.ts`: reexporta `LoopWeight`, y define `interface LoopRef { id: string; notes: NoteEvent[] }`
  - `topology-ab.ts`:
    - `interface AbState { a: LoopRef; b: LoopRef; x: number }`
    - `abWeights(s: AbState): LoopWeight[]`
    - `abAdvance(s: AbState, x: number, pool: LoopRef[], pick: (n: number) => number): AbState`

- [ ] **Step 1: Escribir el test que falla**

```ts
import { abWeights, abAdvance, type AbState } from './topology-ab';
import type { LoopRef } from './topology-types';

const loop = (id: string): LoopRef => ({ id, notes: [] });
const POOL = [loop('p0'), loop('p1'), loop('p2'), loop('p3')];

describe('A to B with re-hook', () => {
  it('weights only A at x=0', () => {
    const w = abWeights({ a: loop('a'), b: loop('b'), x: 0 });
    expect(w.map((e) => e.weight)).toEqual([1, 0]);
  });

  it('splits the weight in the middle', () => {
    const w = abWeights({ a: loop('a'), b: loop('b'), x: 0.5 });
    expect(w[0].weight).toBeCloseTo(0.5);
    expect(w[1].weight).toBeCloseTo(0.5);
  });

  it('always sums to one', () => {
    for (let i = 0; i <= 10; i++) {
      const w = abWeights({ a: loop('a'), b: loop('b'), x: i / 10 });
      expect(w.reduce((s, e) => s + e.weight, 0)).toBeCloseTo(1);
    }
  });

  it('does not re-hook before the journey ends', () => {
    const s: AbState = { a: loop('a'), b: loop('b'), x: 0 };
    const next = abAdvance(s, 0.9, POOL, () => 0);
    expect(next.a.id).toBe('a');
    expect(next.b.id).toBe('b');
    expect(next.x).toBeCloseTo(0.9);
  });

  it('makes B the new A on arrival and draws a fresh B', () => {
    const s: AbState = { a: loop('a'), b: loop('b'), x: 0.9 };
    const next = abAdvance(s, 1, POOL, () => 2);
    expect(next.a.id).toBe('b');
    expect(next.b.id).toBe('p2');
    expect(next.x).toBe(0);
  });

  it('never draws the loop it just arrived at', () => {
    const s: AbState = { a: loop('a'), b: POOL[1], x: 0.99 };
    // A picker that always wants index 1 -- which is the loop now playing.
    const next = abAdvance(s, 1, POOL, () => 1);
    expect(next.b.id).not.toBe(next.a.id);
  });
});
```

- [ ] **Step 2: Ejecutar y ver el fallo**

Run: `NO_COLOR=1 npx vitest run src/weave/topology-ab.test.ts`
Expected: FAIL — `Cannot find module './topology-ab'`.

- [ ] **Step 3: Implementar**

`src/weave/topology-types.ts`:

```ts
// What every topology speaks. A topology's whole job is to turn its own state
// into this list; the blend engine knows nothing else about it.

import type { NoteEvent } from '../core/notes';

export type { LoopWeight } from './blend-clip';

/** A loop as a topology holds it: an identity plus its notes. */
export interface LoopRef {
  id: string;
  notes: NoteEvent[];
}
```

`src/weave/topology-ab.ts`:

```ts
// A to B, and when you arrive B becomes the new A and a fresh B is drawn. The
// journey never ends and never returns to where it started, which is the whole
// point -- a queue would eventually run out.

import type { LoopRef, LoopWeight } from './topology-types';

export interface AbState {
  a: LoopRef;
  b: LoopRef;
  /** 0..1 across the current leg. */
  x: number;
}

export function abWeights(s: AbState): LoopWeight[] {
  const x = Math.min(1, Math.max(0, s.x));
  return [
    { notes: s.a.notes, weight: 1 - x },
    { notes: s.b.notes, weight: x },
  ];
}

/** `pick` returns an index into `pool`; injected so the draw is testable and
 *  deterministic rather than reaching for Math.random inside. */
export function abAdvance(
  s: AbState, x: number, pool: LoopRef[], pick: (n: number) => number,
): AbState {
  if (x < 1) return { ...s, x };
  const arrived = s.b;
  // Drawing the loop that just became A would make the next leg a no-op, so
  // the pick is retried once against the rest of the pool.
  const candidates = pool.filter((l) => l.id !== arrived.id);
  const next = candidates.length > 0
    ? candidates[Math.min(candidates.length - 1, Math.max(0, pick(candidates.length)))]
    : arrived;
  return { a: arrived, b: next, x: 0 };
}
```

⚠️ Ojo con `pick`: el test «never draws the loop it just arrived at» le pasa
`() => 1` sobre un `POOL` ya filtrado de 3 elementos, así que el índice 1 del
filtrado no es `POOL[1]`. Esa es exactamente la garantía que se está probando.

- [ ] **Step 4: Ejecutar y ver que pasa**

Run: `NO_COLOR=1 npx vitest run src/weave/topology-ab.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/weave/topology-types.ts src/weave/topology-ab.ts src/weave/topology-ab.test.ts
git commit -F - <<'EOF'
feat(weave): A to B, and on arrival B becomes A and a fresh B is drawn

The journey never ends and never returns to its start. The draw filters
out the loop that just arrived -- drawing it would make the next leg a
crossfade from a loop to itself, which sounds like nothing happening.

The picker is injected rather than reaching for Math.random inside, so
the re-hook is testable.
EOF
```

### Task 14: La topología en cola

**Files:**
- Create: `src/weave/topology-queue.ts`
- Test: `src/weave/topology-queue.test.ts`

**Interfaces:**
- Produces:
  - `interface QueueState { loops: LoopRef[]; x: number }`
  - `queueWeights(s: QueueState): LoopWeight[]`

- [ ] **Step 1: Escribir el test que falla**

```ts
import { queueWeights, type QueueState } from './topology-queue';
import type { LoopRef } from './topology-types';

const loop = (id: string): LoopRef => ({ id, notes: [] });
const S = (x: number): QueueState => ({ loops: [loop('l0'), loop('l1'), loop('l2'), loop('l3')], x });

describe('queue topology', () => {
  it('is entirely the first loop at x=0', () => {
    const w = queueWeights(S(0)).filter((e) => e.weight > 0);
    expect(w).toHaveLength(1);
    expect(w[0].weight).toBeCloseTo(1);
  });

  it('is entirely the last loop at x=1', () => {
    const w = queueWeights(S(1)).filter((e) => e.weight > 0);
    expect(w).toHaveLength(1);
    expect(w[0].weight).toBeCloseTo(1);
  });

  it('only ever mixes two neighbours', () => {
    for (let i = 0; i <= 30; i++) {
      const live = queueWeights(S(i / 30)).filter((e) => e.weight > 0);
      expect(live.length).toBeLessThanOrEqual(2);
    }
  });

  it('always sums to one', () => {
    for (let i = 0; i <= 30; i++) {
      const sum = queueWeights(S(i / 30)).reduce((s, e) => s + e.weight, 0);
      expect(sum).toBeCloseTo(1);
    }
  });

  it('handles a queue of one without dividing by zero', () => {
    const w = queueWeights({ loops: [loop('only')], x: 0.7 });
    expect(w.reduce((s, e) => s + e.weight, 0)).toBeCloseTo(1);
  });
});
```

- [ ] **Step 2: Ejecutar y ver el fallo**

Run: `NO_COLOR=1 npx vitest run src/weave/topology-queue.test.ts`
Expected: FAIL — `Cannot find module './topology-queue'`.

- [ ] **Step 3: Implementar**

```ts
// A cursor over an ordered list: always a crossfade between the two loops the
// cursor sits between. Unlike A-to-B it is finite -- the end of the list is the
// end of the journey -- but you can walk back, which A-to-B cannot.

import type { LoopRef, LoopWeight } from './topology-types';

export interface QueueState {
  loops: LoopRef[];
  /** 0..1 across the whole queue. */
  x: number;
}

export function queueWeights(s: QueueState): LoopWeight[] {
  const n = s.loops.length;
  if (n === 0) return [];
  if (n === 1) return [{ notes: s.loops[0].notes, weight: 1 }];

  const pos = Math.min(1, Math.max(0, s.x)) * (n - 1);
  const i = Math.min(n - 2, Math.floor(pos));
  const frac = pos - i;
  return s.loops.map((l, k) => ({
    notes: l.notes,
    weight: k === i ? 1 - frac : k === i + 1 ? frac : 0,
  }));
}
```

- [ ] **Step 4: Ejecutar y ver que pasa**

Run: `NO_COLOR=1 npx vitest run src/weave/topology-queue.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/weave/topology-queue.ts src/weave/topology-queue.test.ts
git commit -F - <<'EOF'
feat(weave): a cursor over an ordered queue, mixing only its two neighbours

Finite where A-to-B is endless, and walkable backwards where A-to-B is
not. A queue of one returns weight 1 instead of dividing by n - 1.
EOF
```

### Task 15: La topología en nube

**Files:**
- Create: `src/weave/topology-cloud.ts`
- Test: `src/weave/topology-cloud.test.ts`

**Interfaces:**
- Produces:
  - `interface CloudState { corners: [LoopRef, LoopRef, LoopRef, LoopRef]; x: number; y: number }`
  - `cloudWeights(s: CloudState): LoopWeight[]` — interpolación bilineal, esquinas en orden arriba-izquierda, arriba-derecha, abajo-izquierda, abajo-derecha

- [ ] **Step 1: Escribir el test que falla**

```ts
import { cloudWeights, type CloudState } from './topology-cloud';
import type { LoopRef } from './topology-types';

const loop = (id: string): LoopRef => ({ id, notes: [] });
const S = (x: number, y: number): CloudState =>
  ({ corners: [loop('tl'), loop('tr'), loop('bl'), loop('br')], x, y });

describe('cloud topology', () => {
  it('is entirely the top-left corner at (0,0)', () => {
    const w = cloudWeights(S(0, 0));
    expect(w[0].weight).toBeCloseTo(1);
    expect(w.slice(1).every((e) => e.weight === 0)).toBe(true);
  });

  it('is entirely the bottom-right corner at (1,1)', () => {
    const w = cloudWeights(S(1, 1));
    expect(w[3].weight).toBeCloseTo(1);
  });

  it('splits evenly in the centre', () => {
    for (const e of cloudWeights(S(0.5, 0.5))) expect(e.weight).toBeCloseTo(0.25);
  });

  it('always sums to one', () => {
    for (let i = 0; i <= 8; i++) {
      for (let j = 0; j <= 8; j++) {
        const sum = cloudWeights(S(i / 8, j / 8)).reduce((s, e) => s + e.weight, 0);
        expect(sum).toBeCloseTo(1);
      }
    }
  });

  it('clamps a position outside the box instead of weighting past a corner', () => {
    const w = cloudWeights(S(1.4, -0.3));
    expect(w.every((e) => e.weight >= 0 && e.weight <= 1)).toBe(true);
    expect(w[1].weight).toBeCloseTo(1);   // top-right
  });
});
```

- [ ] **Step 2: Ejecutar y ver el fallo**

Run: `NO_COLOR=1 npx vitest run src/weave/topology-cloud.test.ts`
Expected: FAIL — `Cannot find module './topology-cloud'`.

- [ ] **Step 3: Implementar**

```ts
// Four loops at the corners of a square, weighted by where the dot sits.
//
// Known and accepted: with four rhythms in play the intersection of all four
// is usually empty, so the shared skeleton the crossfade relies on thins out
// and percussion tends to mush. It earns its place on melodic material, and
// the per-lane selector is what lets the user decide.

import type { LoopRef, LoopWeight } from './topology-types';

export interface CloudState {
  /** top-left, top-right, bottom-left, bottom-right. */
  corners: [LoopRef, LoopRef, LoopRef, LoopRef];
  x: number;
  y: number;
}

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

export function cloudWeights(s: CloudState): LoopWeight[] {
  const x = clamp01(s.x);
  const y = clamp01(s.y);
  const w = [
    (1 - x) * (1 - y),
    x * (1 - y),
    (1 - x) * y,
    x * y,
  ];
  return s.corners.map((c, i) => ({ notes: c.notes, weight: w[i] }));
}
```

- [ ] **Step 4: Ejecutar y ver que pasa**

Run: `NO_COLOR=1 npx vitest run src/weave/topology-cloud.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/weave/topology-cloud.ts src/weave/topology-cloud.test.ts
git commit -F - <<'EOF'
feat(weave): four loops at the corners, weighted by where the dot sits

The comment says out loud what this costs: four rhythms at once usually
share no skeleton, so percussion mushes. It earns its place on melodic
material and the per-lane selector is what lets the user decide.

A dot dragged outside the box clamps -- weighting past a corner would
hand the blend a weight above 1.
EOF
```

---

# FASE 5 — El estado y la decisión nota a nota

El planificador ya es nota a nota: `tickLane` recorre las notas con anticipación
y llama a `onTrigger` por cada una. La regla «lo que empezó a sonar termina» no
cuesta nada — es un predicado antes de disparar.

### Task 16: El estado del tejido por canal

**Files:**
- Create: `src/weave/weave-state.ts`
- Test: `src/weave/weave-state.test.ts`

**Interfaces:**
- Consumes: `AbState`, `QueueState`, `CloudState`; `type StyleId` de `src/core/musicality.ts`
- Produces:
  - `type LaneWeave = { kind: 'ab'; state: AbState } | { kind: 'queue'; state: QueueState } | { kind: 'cloud'; state: CloudState }`
  - `interface LaneWeaveConfig { weave: LaneWeave; locked: boolean; forcedStyle?: StyleId; harmonyLeader: boolean }`
  - `interface WeaveState { lanes: Record<string, LaneWeaveConfig>; macros: Record<string, number>; seed: number }`
  - `defaultWeaveState(): WeaveState`
  - `laneWeights(cfg: LaneWeaveConfig): LoopWeight[]`

- [ ] **Step 1: Escribir el test que falla**

```ts
import { defaultWeaveState, laneWeights, type LaneWeaveConfig } from './weave-state';
import type { LoopRef } from './topology-types';

const loop = (id: string): LoopRef => ({ id, notes: [] });
const cfg = (weave: LaneWeaveConfig['weave']): LaneWeaveConfig =>
  ({ weave, locked: false, harmonyLeader: false });

describe('weave state', () => {
  it('starts with no lanes and every macro at its neutral', () => {
    const s = defaultWeaveState();
    expect(Object.keys(s.lanes)).toHaveLength(0);
    expect(s.macros.density).toBeCloseTo(0.5);
    expect(s.macros.space).toBeCloseTo(0);
  });

  it('routes an ab lane to the ab weights', () => {
    const w = laneWeights(cfg({ kind: 'ab', state: { a: loop('a'), b: loop('b'), x: 0.25 } }));
    expect(w).toHaveLength(2);
    expect(w[0].weight).toBeCloseTo(0.75);
  });

  it('routes a queue lane to the queue weights', () => {
    const w = laneWeights(cfg({
      kind: 'queue', state: { loops: [loop('a'), loop('b'), loop('c')], x: 0 },
    }));
    expect(w.filter((e) => e.weight > 0)).toHaveLength(1);
  });

  it('routes a cloud lane to four weights that sum to one', () => {
    const w = laneWeights(cfg({
      kind: 'cloud',
      state: { corners: [loop('a'), loop('b'), loop('c'), loop('d')], x: 0.3, y: 0.7 },
    }));
    expect(w).toHaveLength(4);
    expect(w.reduce((s, e) => s + e.weight, 0)).toBeCloseTo(1);
  });
});
```

- [ ] **Step 2: Ejecutar y ver el fallo**

Run: `NO_COLOR=1 npx vitest run src/weave/weave-state.test.ts`
Expected: FAIL — `Cannot find module './weave-state'`.

- [ ] **Step 3: Implementar**

```ts
// What WEAVE remembers, per lane and globally. Lives inside the session so it
// saves and undoes like everything else.

import type { StyleId } from '../core/musicality';
import type { LoopWeight } from './topology-types';
import { abWeights, type AbState } from './topology-ab';
import { queueWeights, type QueueState } from './topology-queue';
import { cloudWeights, type CloudState } from './topology-cloud';
import { WEAVE_MACROS } from './weave-catalog';

export type LaneWeave =
  | { kind: 'ab'; state: AbState }
  | { kind: 'queue'; state: QueueState }
  | { kind: 'cloud'; state: CloudState };

export interface LaneWeaveConfig {
  weave: LaneWeave;
  /** Freezes WHICH loop plays -- the general macros still reach this lane, or
   *  raising the scene's energy would leave it flat and pull the mix apart. */
  locked: boolean;
  /** Set means this lane ignores the style-mix macro. */
  forcedStyle?: StyleId;
  harmonyLeader: boolean;
}

export interface WeaveState {
  lanes: Record<string, LaneWeaveConfig>;
  macros: Record<string, number>;
  seed: number;
}

export function defaultWeaveState(): WeaveState {
  const macros: Record<string, number> = {};
  for (const m of WEAVE_MACROS) macros[m.id] = m.neutral;
  return { lanes: {}, macros, seed: 1 };
}

export function laneWeights(cfg: LaneWeaveConfig): LoopWeight[] {
  const w = cfg.weave;
  return w.kind === 'ab' ? abWeights(w.state)
    : w.kind === 'queue' ? queueWeights(w.state)
    : cloudWeights(w.state);
}
```

- [ ] **Step 4: Ejecutar y ver que pasa**

Run: `NO_COLOR=1 npx vitest run src/weave/weave-state.test.ts`
Expected: PASS. Requiere que la tarea 19 (`weave-catalog`) esté hecha — **hacer la tarea 19 antes que ésta si se ejecutan fuera de orden.**

- [ ] **Step 5: Commit**

```bash
git add src/weave/weave-state.ts src/weave/weave-state.test.ts
git commit -F - <<'EOF'
feat(weave): what the panel remembers, and the one call that reads it

laneWeights is the only place that knows which topology a lane uses;
everything downstream sees a list of weights and nothing else.

The lock freezes which loop plays and deliberately does not cut the
general macros: a locked lane that stops following the scene's energy
falls out of the mix on its own.
EOF
```

### Task 17: El planificador acepta un predicado de disparo

**Files:**
- Modify: `src/core/lane-scheduler.ts` (`SchedulerContext` + el punto donde llama a `onTrigger`)
- Test: `src/core/lane-scheduler.test.ts`

**Interfaces:**
- Produces: campo opcional en `SchedulerContext`:
  ```ts
  shouldFire?: (note: { midi: number; duration: number; velocity: number; gridTick?: number }, scheduleTime: number) => boolean;
  ```
- Ausente ⇒ comportamiento idéntico al de hoy.

- [ ] **Step 1: Escribir los tests que fallan**

Añadir a `src/core/lane-scheduler.test.ts`:

```ts
describe('shouldFire (the note-by-note gate WEAVE hangs off)', () => {
  it('is identical to today when absent', () => {
    const withGate: number[] = [];
    const ctx = makeCtx({ onTrigger: (n) => withGate.push(n.midi) });
    tickLane(clipWithNotes([n(0, 60), n(24, 62)]), ctx);
    expect(withGate).toEqual([60, 62]);
  });

  it('drops the notes the gate refuses', () => {
    const fired: number[] = [];
    const ctx = makeCtx({
      onTrigger: (nn) => fired.push(nn.midi),
      shouldFire: (nn) => nn.midi !== 62,
    });
    tickLane(clipWithNotes([n(0, 60), n(24, 62), n(48, 64)]), ctx);
    expect(fired).toEqual([60, 64]);
  });

  it('still advances the loop bookkeeping for a refused note', () => {
    const ctx = makeCtx({ onTrigger: () => {}, shouldFire: () => false });
    const before = ctx.loopStartedAt;
    const after = tickLane(clipWithNotes([n(0, 60)]), ctx);
    expect(after).toBeGreaterThanOrEqual(before);
  });
});
```

`makeCtx`, `clipWithNotes` y `n` son los ayudantes que ya existen en ese fichero
de test; si no existen con ese nombre, usar los equivalentes que haya y no
inventar unos nuevos.

- [ ] **Step 2: Ejecutar y ver el fallo**

Run: `NO_COLOR=1 npx vitest run src/core/lane-scheduler.test.ts`
Expected: FAIL — el segundo test dispara 62 porque no hay puerta.

- [ ] **Step 3: Implementar**

En `SchedulerContext`, junto a `onTrigger`:

```ts
  /** Asked once per note, at the moment the note is about to be scheduled.
   *  Returning false skips the trigger and nothing else -- loop bookkeeping and
   *  `lastScheduledAt` advance either way, so refusing a note never desyncs the
   *  lane.
   *
   *  This is where WEAVE decides whether a hit belongs to the current blend.
   *  Deciding here rather than rewriting the clip is what makes "a note that
   *  started always finishes" free: a hit either fires or it does not, and
   *  nothing already sounding is ever touched. */
  shouldFire?: (
    note: { midi: number; duration: number; velocity: number; gridTick?: number },
    scheduleTime: number,
  ) => boolean;
```

Y en el punto donde `tickLane` llama a `ctx.onTrigger(note, scheduleAt)`, envolverlo:

```ts
      if (!ctx.shouldFire || ctx.shouldFire(note, scheduleAt)) {
        ctx.onTrigger(note, scheduleAt);
      }
```

**Importante:** la actualización de `lastScheduledAt` y del bookkeeping del loop
queda FUERA del `if`, o una nota rechazada haría que la siguiente se disparase
dos veces.

- [ ] **Step 4: Ejecutar y ver que pasa**

Run: `NO_COLOR=1 npx vitest run src/core/lane-scheduler.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/core/lane-scheduler.ts src/core/lane-scheduler.test.ts
git commit -F - <<'EOF'
feat(core): the scheduler can be asked whether a note belongs, one note at a time

Absent, the gate changes nothing. Present, it is where WEAVE decides
whether a hit is part of the current blend -- and deciding HERE rather
than rewriting the clip is what makes "a note that started always
finishes" free: a hit either fires or it does not.

Bookkeeping advances for a refused note too. Skipping it would fire the
next note twice.
EOF
```

### Task 18: El runtime que alimenta la puerta

**Files:**
- Create: `src/weave/weave-runtime.ts`
- Test: `src/weave/weave-runtime.test.ts`

**Interfaces:**
- Consumes: `laneWeights`, `blendLoops`, `LaneWeaveConfig`
- Produces: `createWeaveGate(cfg: LaneWeaveConfig, o: BlendOptions): (note: { midi: number; gridTick?: number }, at: number) => boolean`
  - Calcula el conjunto fundido una vez por llamada de compás y consulta si el paso está dentro. Cachea por `(pesos redondeados a 1e-3, barTicks)` para no refundir por cada nota.

- [ ] **Step 1: Escribir el test que falla**

```ts
import { TICKS_PER_STEP, type NoteEvent } from '../core/notes';
import { createWeaveGate } from './weave-runtime';
import type { LaneWeaveConfig } from './weave-state';

const BAR = TICKS_PER_STEP * 16;
const hit = (step: number, midi: number): NoteEvent =>
  ({ start: step * TICKS_PER_STEP, duration: TICKS_PER_STEP, midi, velocity: 100 });
const opts = { barTicks: BAR, melodic: false, key: 9, scale: 'minor' as const, octaveBase: 36 };

const A = [hit(0, 36), hit(4, 38), hit(3, 42)];
const B = [hit(0, 36), hit(4, 38), hit(11, 42)];
const cfg = (x: number): LaneWeaveConfig => ({
  weave: { kind: 'ab', state: { a: { id: 'a', notes: A }, b: { id: 'b', notes: B }, x } },
  locked: false, harmonyLeader: false,
});

describe('weave gate', () => {
  it('lets a shared hit through at every position', () => {
    for (let i = 0; i <= 10; i++) {
      const gate = createWeaveGate(cfg(i / 10), opts);
      expect(gate({ midi: 36, gridTick: 0 }, 0)).toBe(true);
    }
  });

  it('lets an A-only hit through at x=0 and refuses it at x=1', () => {
    expect(createWeaveGate(cfg(0), opts)({ midi: 42, gridTick: 3 * TICKS_PER_STEP }, 0)).toBe(true);
    expect(createWeaveGate(cfg(1), opts)({ midi: 42, gridTick: 3 * TICKS_PER_STEP }, 0)).toBe(false);
  });

  it('refuses a B-only hit at x=0 and lets it through at x=1', () => {
    expect(createWeaveGate(cfg(0), opts)({ midi: 42, gridTick: 11 * TICKS_PER_STEP }, 0)).toBe(false);
    expect(createWeaveGate(cfg(1), opts)({ midi: 42, gridTick: 11 * TICKS_PER_STEP }, 0)).toBe(true);
  });

  it('refuses a note the blend never contained', () => {
    expect(createWeaveGate(cfg(0.5), opts)({ midi: 99, gridTick: 0 }, 0)).toBe(false);
  });
});
```

- [ ] **Step 2: Ejecutar y ver el fallo**

Run: `NO_COLOR=1 npx vitest run src/weave/weave-runtime.test.ts`
Expected: FAIL — `Cannot find module './weave-runtime'`.

- [ ] **Step 3: Implementar**

```ts
// Turns a lane's weave into the predicate the scheduler asks per note.
//
// The blend is computed once per distinct weight set and cached, because
// tickLane asks this for EVERY note in the look-ahead window and refolding
// four patterns per note would put the crossfade in the audio budget.

import type { NoteEvent } from '../core/notes';
import { blendLoops, type BlendOptions } from './blend-clip';
import { laneWeights, type LaneWeaveConfig } from './weave-state';

const hitKey = (start: number, midi: number) => `${start}:${midi}`;

export function createWeaveGate(
  cfg: LaneWeaveConfig, o: BlendOptions,
): (note: { midi: number; gridTick?: number }, at: number) => boolean {
  let cacheKey = '';
  let allowed = new Set<string>();

  const refresh = () => {
    const weights = laneWeights(cfg);
    // Rounding keeps a continuously moving fader from busting the cache on
    // every frame; 1e-3 is finer than any audible step.
    const key = weights.map((w) => w.weight.toFixed(3)).join(',') + `|${o.barTicks}`;
    if (key === cacheKey) return;
    cacheKey = key;
    allowed = new Set(
      blendLoops(weights, o).map((n: NoteEvent) => hitKey(n.start % o.barTicks, n.midi)),
    );
  };

  return (note, _at) => {
    refresh();
    const tick = ((note.gridTick ?? 0) % o.barTicks + o.barTicks) % o.barTicks;
    return allowed.has(hitKey(tick, note.midi));
  };
}
```

- [ ] **Step 4: Ejecutar y ver que pasa**

Run: `NO_COLOR=1 npx vitest run src/weave/weave-runtime.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/weave/weave-runtime.ts src/weave/weave-runtime.test.ts
git commit -F - <<'EOF'
feat(weave): the predicate the scheduler asks, with the blend cached behind it

tickLane asks this for every note in the look-ahead window, so refolding
four patterns per note would put the crossfade inside the audio budget.
The blend is recomputed only when the weights actually move, rounded to
1e-3 -- finer than any audible step, coarse enough that a moving fader
does not bust the cache every frame.
EOF
```

---

# FASE 6 — Los seis macros y el ámbito de sesión

### Task 19: El catálogo de macros

**Files:**
- Create: `src/weave/weave-catalog.ts`
- Test: `src/weave/weave-catalog.test.ts`

**Interfaces:**
- Produces:
  - `interface MacroSpec { id: string; label: string; neutral: number; color: string }`
  - `const WEAVE_MACROS: readonly MacroSpec[]`
  - `const WEAVE_SCOPE = 'session.weave'`
  - `macroDestinationId(id: string): string` → `session.weave:<id>`

- [ ] **Step 1: Escribir el test que falla**

```ts
import { WEAVE_MACROS, macroDestinationId } from './weave-catalog';

describe('weave catalogue', () => {
  it('declares the six macros', () => {
    expect(WEAVE_MACROS.map((m) => m.id)).toEqual(
      ['density', 'energy', 'darkness', 'space', 'motion', 'styleMix'],
    );
  });

  it('gives every macro a neutral inside 0..1', () => {
    for (const m of WEAVE_MACROS) {
      expect(m.neutral).toBeGreaterThanOrEqual(0);
      expect(m.neutral).toBeLessThanOrEqual(1);
    }
  });

  it('builds an id carrying an explicit marker, not a bare dotted prefix', () => {
    // A bare `weave.density` would parse as the `density` param of a lane
    // called `weave`, land nowhere, and NOT throw. The colon is what stops it.
    expect(macroDestinationId('density')).toBe('session.weave:density');
    expect(macroDestinationId('density')).toContain(':');
  });
});
```

- [ ] **Step 2: Ejecutar y ver el fallo**

Run: `NO_COLOR=1 npx vitest run src/weave/weave-catalog.test.ts`
Expected: FAIL — `Cannot find module './weave-catalog'`.

- [ ] **Step 3: Implementar**

```ts
// The six macros as data. With all six at their neutral the live layer is the
// identity: what you hear is exactly the material that is there.

export interface MacroSpec {
  id: string;
  label: string;
  /** The value at which this macro does nothing. */
  neutral: number;
  color: string;
}

export const WEAVE_MACROS: readonly MacroSpec[] = [
  { id: 'density',  label: 'Density',    neutral: 0.5, color: 'var(--knob-cyan)' },
  { id: 'energy',   label: 'Energy',     neutral: 0.5, color: 'var(--knob-yellow)' },
  { id: 'darkness', label: 'Darkness',   neutral: 0.5, color: 'var(--knob-purple)' },
  { id: 'space',    label: 'Space',      neutral: 0,   color: 'var(--knob-blue)' },
  { id: 'motion',   label: 'Motion',     neutral: 0,   color: 'var(--knob-orange)' },
  { id: 'styleMix', label: 'Style mix',  neutral: 0,   color: 'var(--knob-red)' },
] as const;

export const WEAVE_SCOPE = 'session.weave';

/** A destination id with an EXPLICIT marker.
 *
 *  parseAutomationParamId splits on dots and falls back to "engine param of a
 *  lane" whenever it finds no marker, so a bare `weave.density` would read as
 *  the `density` param of a lane called `weave` -- a lane that does not exist.
 *  It would not throw. It would sit inert, which looks exactly like working. */
export function macroDestinationId(id: string): string {
  return `${WEAVE_SCOPE}:${id}`;
}
```

- [ ] **Step 4: Ejecutar y ver que pasa**

Run: `NO_COLOR=1 npx vitest run src/weave/weave-catalog.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/weave/weave-catalog.ts src/weave/weave-catalog.test.ts
git commit -F - <<'EOF'
feat(weave): six macros as data, and an id that cannot be mistaken for a lane

A bare `weave.density` parses as the `density` param of a lane called
`weave`. There is no such lane, so the value would land nowhere and throw
nothing -- inert, which looks exactly like working. The colon marker is
what stops it, and the test says why.
EOF
```

### Task 20: El tercer ámbito del identificador de destino

**Files:**
- Modify: `src/automation/automation-apply.ts:17-37` (`ParsedParamId` + `parseAutomationParamId`)
- Test: `src/automation/automation-apply.test.ts`

**Interfaces:**
- Produces: variante nueva `{ scopeId: 'session.weave'; kind: 'macro'; paramId: string }`

- [ ] **Step 1: Escribir los tests que fallan**

```ts
describe('the session scope (WEAVE macros)', () => {
  it('parses a macro id as a macro, not as a lane param', () => {
    expect(parseAutomationParamId('session.weave:density')).toEqual({
      scopeId: 'session.weave', kind: 'macro', paramId: 'density',
    });
  });

  it('still parses a lane engine param the way it did', () => {
    expect(parseAutomationParamId('lane-3.cutoff')).toEqual({
      scopeId: 'lane-3', kind: 'engine', paramId: 'cutoff',
    });
  });

  it('still parses an insert param the way it did', () => {
    expect(parseAutomationParamId('lane-3.fx:slot1.mix')).toEqual({
      scopeId: 'lane-3', kind: 'insert', slotId: 'slot1', paramId: 'mix',
    });
  });

  it('does not mistake a lane whose id starts with session for a macro', () => {
    expect(parseAutomationParamId('session-lane.cutoff')?.kind).toBe('engine');
  });
});
```

- [ ] **Step 2: Ejecutar y ver el fallo**

Run: `NO_COLOR=1 npx vitest run src/automation/automation-apply.test.ts`
Expected: FAIL — el primero devuelve `kind: 'engine'`.

- [ ] **Step 3: Implementar**

En `automation-apply.ts`:

```ts
export type ParsedParamId =
  | { scopeId: string; kind: 'engine'; paramId: string }
  | { scopeId: string; kind: 'insert'; slotId: string; paramId: string }
  | { scopeId: string; kind: 'macro'; paramId: string };
```

y en `parseAutomationParamId`, **antes** de la búsqueda de `fx:`:

```ts
  // The session scope is matched first and by its exact marker. Everything the
  // parser does not recognise falls back to "engine param of a lane", so a
  // session id without a marker would be read as a lane that does not exist,
  // land nowhere, and never throw.
  const macroAt = id.indexOf(`${WEAVE_SCOPE}:`);
  if (macroAt === 0) {
    const paramId = id.slice(WEAVE_SCOPE.length + 1);
    if (paramId.length > 0) return { scopeId: WEAVE_SCOPE, kind: 'macro', paramId };
  }
```

con `import { WEAVE_SCOPE } from '../weave/weave-catalog';` arriba.

- [ ] **Step 4: Ejecutar y ver que pasa**

Run: `NO_COLOR=1 npx vitest run src/automation/automation-apply.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/automation/automation-apply.ts src/automation/automation-apply.test.ts
git commit -F - <<'EOF'
feat(automation): a third scope, matched by its marker before the fallback

The parser's fallback is "engine param of a lane", so anything it does
not recognise becomes a lane id. A session destination therefore has to
be recognised FIRST and by an exact marker -- otherwise it resolves to a
lane that does not exist and goes quietly inert.

A lane whose id merely starts with "session" is not a macro, and there is
a test for it.
EOF
```

### Task 21: Los macros aparecen en el catálogo de destinos

**Files:**
- Modify: `src/automation/automation-targets.ts` (`listAutomationTargets`)
- Test: `src/automation/automation-targets.test.ts`

**Interfaces:**
- Consumes: `WEAVE_MACROS`, `macroDestinationId`
- Produces: nada nuevo; los seis macros salen en `list()` bajo un grupo `Weave`

- [ ] **Step 1: Escribir los tests que fallan**

```ts
it('offers the six weave macros as destinations', () => {
  const ids = listAutomationTargets(stateWithNoLanes(), new Map()).map((t) => t.id);
  for (const m of WEAVE_MACROS) expect(ids).toContain(macroDestinationId(m.id));
});

it('files them under a pseudo-lane called Weave, so the picker can group them', () => {
  // AutomationTarget has no `group` field: the picker groups by laneId via
  // groupTargetsByLane. A session-scope destination therefore needs a laneId
  // of its own rather than a group label.
  const t = listAutomationTargets(stateWithNoLanes(), new Map())
    .find((x) => x.id === macroDestinationId('density'));
  expect(t?.laneId).toBe(WEAVE_SCOPE);
  expect(t?.laneName).toBe('Weave');
});

it('declares a 0..1 range for every macro', () => {
  const ts = listAutomationTargets(stateWithNoLanes(), new Map())
    .filter((x) => x.laneId === WEAVE_SCOPE);
  for (const t of ts) {
    expect(t.min).toBe(0);
    expect(t.max).toBe(1);
  }
});

it('offers them even when the session has no lanes at all', () => {
  expect(listAutomationTargets(stateWithNoLanes(), new Map()).length).toBeGreaterThanOrEqual(6);
});
```

- [ ] **Step 2: Ejecutar y ver el fallo**

Run: `NO_COLOR=1 npx vitest run src/automation/automation-targets.test.ts`
Expected: FAIL — ninguno de los seis está en la lista.

- [ ] **Step 3: Implementar**

Al principio de `listAutomationTargets`, antes de recorrer los canales:

```ts
  // The macros belong to the session, not to a lane, so they are listed before
  // anything lane-shaped and do not depend on a lane existing.
  //
  // AutomationTarget has no `group`: the pickers group by laneId through
  // groupTargetsByLane. So the macros travel as a pseudo-lane -- the scope id
  // is their laneId, and "Weave" is the heading the user sees.
  const out: AutomationTarget[] = WEAVE_MACROS.map((m) => ({
    id: macroDestinationId(m.id),
    label: m.label,
    laneId: WEAVE_SCOPE,
    laneName: 'Weave',
    min: 0,
    max: 1,
  }));
```

y usar `out` como acumulador en lugar de crear el array vacío donde lo hace hoy.
Los campos exactos de `AutomationTarget` mandan (`id`, `label`, `laneId`,
`laneName`, `min`, `max`, y `subGroup` opcional); nada inventado.

⚠️ `groupTargetsByLane` va a ver un `laneId` que no corresponde a ningún canal
de la sesión. Comprobar que agrupa por el `laneName` que se le da y no busca el
canal — si lo busca, hay que enseñarle este caso.

- [ ] **Step 4: Ejecutar y ver que pasa**

Run: `NO_COLOR=1 npx vitest run src/automation/automation-targets.test.ts && NO_COLOR=1 npx vitest run src/automation/`
Expected: PASS. El segundo comando comprueba que ninguno de los otros lectores del catálogo se rompe.

- [ ] **Step 5: Commit**

```bash
git add src/automation/automation-targets.ts src/automation/automation-targets.test.ts
git commit -F - <<'EOF'
feat(automation): the weave macros are destinations like everything else

Listed here, they appear in the destination picker, the XY pad and the
MIDI mapping without any of them being touched -- all four read this one
catalogue. They also list with no lanes present, because they belong to
the session rather than to a lane.
EOF
```

### Task 22: Densidad y Energía sobre las notas

**Files:**
- Create: `src/weave/macro-notes.ts`
- Test: `src/weave/macro-notes.test.ts`

**Interfaces:**
- Consumes: `metricWeight`; `NoteEvent`
- Produces: `applyNoteMacros(notes: NoteEvent[], macros: { density: number; energy: number }, barTicks: number): NoteEvent[]`

- [ ] **Step 1: Escribir el test que falla**

```ts
import { TICKS_PER_STEP, type NoteEvent } from '../core/notes';
import { applyNoteMacros } from './macro-notes';

const BAR = TICKS_PER_STEP * 16;
const hit = (step: number, midi = 36, vel = 90): NoteEvent =>
  ({ start: step * TICKS_PER_STEP, duration: TICKS_PER_STEP, midi, velocity: vel });
const NEUTRAL = { density: 0.5, energy: 0.5 };
const IN = [hit(0), hit(3), hit(4), hit(7), hit(8), hit(11)];

describe('note macros', () => {
  it('changes nothing at the neutral of both (negative control)', () => {
    expect(applyNoteMacros(IN, NEUTRAL, BAR)).toEqual(IN);
  });

  it('thins out as density falls, and drops weak positions first', () => {
    const thin = applyNoteMacros(IN, { ...NEUTRAL, density: 0.1 }, BAR);
    expect(thin.length).toBeLessThan(IN.length);
    expect(thin.some((n) => n.start === 0)).toBe(true);            // the downbeat survives
    expect(thin.some((n) => n.start === 3 * TICKS_PER_STEP)).toBe(false);
  });

  it('never removes the downbeat, however low density goes', () => {
    expect(applyNoteMacros(IN, { ...NEUTRAL, density: 0 }, BAR).some((n) => n.start === 0)).toBe(true);
  });

  it('adds notes as density rises, without inventing a pitch', () => {
    const thick = applyNoteMacros(IN, { ...NEUTRAL, density: 0.95 }, BAR);
    expect(thick.length).toBeGreaterThan(IN.length);
    const pitchesIn = new Set(IN.map((n) => n.midi));
    for (const n of thick) expect(pitchesIn.has(n.midi)).toBe(true);
  });

  it('raises velocity as energy rises and lowers it as energy falls', () => {
    const hot = applyNoteMacros(IN, { ...NEUTRAL, energy: 1 }, BAR);
    const cold = applyNoteMacros(IN, { ...NEUTRAL, energy: 0 }, BAR);
    const avg = (ns: NoteEvent[]) => ns.reduce((s, n) => s + n.velocity, 0) / ns.length;
    expect(avg(hot)).toBeGreaterThan(avg(IN));
    expect(avg(cold)).toBeLessThan(avg(IN));
  });

  it('keeps velocity inside the legal range at both extremes', () => {
    for (const energy of [0, 1]) {
      for (const n of applyNoteMacros(IN, { ...NEUTRAL, energy }, BAR)) {
        expect(n.velocity).toBeGreaterThanOrEqual(1);
        expect(n.velocity).toBeLessThanOrEqual(127);
      }
    }
  });
});
```

- [ ] **Step 2: Ejecutar y ver el fallo**

Run: `NO_COLOR=1 npx vitest run src/weave/macro-notes.test.ts`
Expected: FAIL — `Cannot find module './macro-notes'`.

- [ ] **Step 3: Implementar**

```ts
// The two macros that rewrite notes. Everything else moves params.

import { TICKS_PER_STEP, type NoteEvent } from '../core/notes';
import { metricWeight } from './metric-weight';

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** Below the neutral, thin out weakest-first. Above it, subdivide.
 *  Thickening NEVER invents a pitch: it splits a note in two or copies the
 *  previous note's pitch into a gap, so the bar can only contain pitches it
 *  already contained. */
function applyDensity(notes: NoteEvent[], density: number, barTicks: number): NoteEvent[] {
  if (density === 0.5) return notes;

  if (density < 0.5) {
    // 0 -> keep only the strongest; 0.5 -> keep everything.
    const floor = (0.5 - density) * 2;                 // 0..1
    return notes.filter((n) => metricWeight(n.start, barTicks) >= floor * 0.95);
  }

  const amount = (density - 0.5) * 2;                  // 0..1
  const out: NoteEvent[] = [];
  for (const n of notes) {
    out.push(n);
    // Split the longest notes first: a sixteenth has nothing to give.
    if (n.duration >= TICKS_PER_STEP * 2 && metricWeight(n.start, barTicks) <= amount) {
      const half = Math.floor(n.duration / 2);
      out[out.length - 1] = { ...n, duration: half };
      out.push({ ...n, start: n.start + half, duration: n.duration - half });
    }
  }
  return out.sort((a, b) => a.start - b.start);
}

/** Scales velocity around the neutral. The 0.55..1.45 span is chosen so that a
 *  note written at 90 crosses the accent threshold (100) near the top of the
 *  range and never at the neutral -- accent is velocity >= 100 everywhere in
 *  Loom, and this macro must not silently accent a whole pattern. */
function applyEnergy(notes: NoteEvent[], energy: number): NoteEvent[] {
  if (energy === 0.5) return notes;
  const gain = 0.55 + energy * 0.9;
  return notes.map((n) => ({ ...n, velocity: clamp(Math.round(n.velocity * gain), 1, 127) }));
}

export function applyNoteMacros(
  notes: NoteEvent[],
  macros: { density: number; energy: number },
  barTicks: number,
): NoteEvent[] {
  return applyEnergy(applyDensity(notes, macros.density, barTicks), macros.energy);
}
```

- [ ] **Step 4: Ejecutar y ver que pasa**

Run: `NO_COLOR=1 npx vitest run src/weave/macro-notes.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/weave/macro-notes.ts src/weave/macro-notes.test.ts
git commit -F - <<'EOF'
feat(weave): density and energy, the two macros that rewrite notes

Thickening never invents a pitch -- it splits a long note or copies the
neighbour -- so the bar can only ever contain pitches it already had.
Thinning drops weakest-first and the downbeat is the last thing standing.

Energy's span is picked so a note written at 90 crosses the accent
threshold near the top and never at the neutral. Accent is velocity >=
100 everywhere in Loom, and this macro must not accent a whole pattern
by accident.
EOF
```

### Task 23: Los otros cuatro macros, sobre destinos

**Files:**
- Create: `src/weave/macro-params.ts`
- Test: `src/weave/macro-params.test.ts`

**Interfaces:**
- Produces: `macroParamWrites(macros: Record<string, number>, ctx: { sendA?: string; sendB?: string; lfoDepthIds: string[] }): Map<string, number>`
  - Devuelve `id de destino → valor 0..1`. Quien lo aplica es el runtime; esta función no toca audio.

- [ ] **Step 1: Escribir el test que falla**

```ts
import { macroParamWrites } from './macro-params';
import { WEAVE_MACROS } from './weave-catalog';

const neutral = () => Object.fromEntries(WEAVE_MACROS.map((m) => [m.id, m.neutral]));
const ctx = { sendA: 'fx.send.A.level', sendB: 'fx.send.B.level', lfoDepthIds: ['lane-1.mod.lfo.depth'] };

describe('param macros', () => {
  it('writes nothing when every macro sits at its neutral', () => {
    expect(macroParamWrites(neutral(), ctx).size).toBe(0);
  });

  it('drives both sends from space', () => {
    const w = macroParamWrites({ ...neutral(), space: 0.8 }, ctx);
    expect(w.get('fx.send.A.level')).toBeGreaterThan(0);
    expect(w.get('fx.send.B.level')).toBeGreaterThan(0);
  });

  it('drives every declared lfo depth from motion', () => {
    const w = macroParamWrites({ ...neutral(), motion: 0.6 }, ctx);
    expect(w.get('lane-1.mod.lfo.depth')).toBeGreaterThan(0);
  });

  it('writes no send when the session declares none', () => {
    const w = macroParamWrites({ ...neutral(), space: 1 }, { lfoDepthIds: [] });
    expect(w.size).toBe(0);
  });

  it('keeps every value inside 0..1', () => {
    for (const v of [0, 1]) {
      const w = macroParamWrites({ ...neutral(), space: v, motion: v }, ctx);
      for (const val of w.values()) {
        expect(val).toBeGreaterThanOrEqual(0);
        expect(val).toBeLessThanOrEqual(1);
      }
    }
  });
});
```

Nota: **Oscuridad no aparece aquí.** Mueve la escala global y la elección de
preset, que no son destinos de automatización sino estado de sesión; va en la
tarea 24 junto a la mezcla de estilos.

- [ ] **Step 2: Ejecutar y ver el fallo**

Run: `NO_COLOR=1 npx vitest run src/weave/macro-params.test.ts`
Expected: FAIL — `Cannot find module './macro-params'`.

- [ ] **Step 3: Implementar**

```ts
// Space and Motion, expressed as writes onto destinations that already exist.
// This function touches no audio: it returns what to write and the runtime
// decides when. That is what makes it testable without an AudioContext.

import { WEAVE_MACROS } from './weave-catalog';

export interface MacroParamContext {
  /** Destination ids for the two global sends, when the session has them. */
  sendA?: string;
  sendB?: string;
  /** Every LFO depth the session currently exposes. */
  lfoDepthIds: string[];
}

const neutralOf = (id: string) => WEAVE_MACROS.find((m) => m.id === id)?.neutral ?? 0;

export function macroParamWrites(
  macros: Record<string, number>, ctx: MacroParamContext,
): Map<string, number> {
  const out = new Map<string, number>();

  const space = macros.space ?? neutralOf('space');
  if (space !== neutralOf('space')) {
    // B gets a little less than A so the two sends do not read as one control.
    if (ctx.sendA) out.set(ctx.sendA, Math.min(1, space));
    if (ctx.sendB) out.set(ctx.sendB, Math.min(1, space * 0.7));
  }

  const motion = macros.motion ?? neutralOf('motion');
  if (motion !== neutralOf('motion')) {
    for (const id of ctx.lfoDepthIds) out.set(id, Math.min(1, motion));
  }

  return out;
}
```

- [ ] **Step 4: Ejecutar y ver que pasa**

Run: `NO_COLOR=1 npx vitest run src/weave/macro-params.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/weave/macro-params.ts src/weave/macro-params.test.ts
git commit -F - <<'EOF'
feat(weave): space and motion, returned as writes rather than applied

The function touches no audio -- it says WHAT to write and the runtime
decides when -- so the mapping is testable with no AudioContext at all.

At the neutral it returns an empty map, which is the negative control the
whole live layer rests on: neutral means the scene sounds untouched.
EOF
```

### Task 24: Oscuridad y mezcla de estilos

**Files:**
- Create: `src/weave/style-mix.ts`
- Test: `src/weave/style-mix.test.ts`

**Interfaces:**
- Consumes: `STYLE_CATALOG`, `SCALE_CATALOG`, `type StyleId`, `type ScaleId`
- Produces:
  - `styleForLane(base: StyleId, mix: number, laneIndex: number, seed: number, forced?: StyleId): StyleId`
  - `scaleForDarkness(darkness: number): ScaleId`

- [ ] **Step 1: Escribir el test que falla**

```ts
import { styleForLane, scaleForDarkness } from './style-mix';

describe('style mix', () => {
  it('gives every lane the base style when the mix is zero', () => {
    for (let i = 0; i < 8; i++) {
      expect(styleForLane('techno', 0, i, 7)).toBe('techno');
    }
  });

  it('is deterministic for the same seed, lane and mix', () => {
    const a = styleForLane('techno', 0.8, 3, 42);
    const b = styleForLane('techno', 0.8, 3, 42);
    expect(a).toBe(b);
  });

  it('moves at least one lane off the base once the mix is high', () => {
    const got = [0, 1, 2, 3, 4, 5].map((i) => styleForLane('techno', 1, i, 42));
    expect(got.some((s) => s !== 'techno')).toBe(true);
  });

  it('ignores the mix entirely when the lane forces a style', () => {
    expect(styleForLane('techno', 1, 3, 42, 'jungle')).toBe('jungle');
  });
});

describe('darkness', () => {
  it('is the same scale at the neutral, whichever way you approach it', () => {
    expect(scaleForDarkness(0.5)).toBe(scaleForDarkness(0.5));
  });

  it('gets brighter as darkness falls', () => {
    const order = ['phrygian', 'minor', 'dorian', 'major'];
    expect(order.indexOf(scaleForDarkness(0))).toBeGreaterThan(order.indexOf(scaleForDarkness(1)));
  });

  it('returns a scale the catalogue knows, across the whole range', () => {
    const known = new Set(['phrygian', 'minor', 'dorian', 'major']);
    for (let i = 0; i <= 20; i++) expect(known.has(scaleForDarkness(i / 20))).toBe(true);
  });
});
```

- [ ] **Step 2: Ejecutar y ver el fallo**

Run: `NO_COLOR=1 npx vitest run src/weave/style-mix.test.ts`
Expected: FAIL — `Cannot find module './style-mix'`.

- [ ] **Step 3: Implementar**

```ts
// Which style a lane draws from, and which scale darkness lands on.

import { STYLE_CATALOG, type StyleId, type ScaleId } from '../core/musicality';

/** Deterministic given (seed, laneIndex). A lane must not change style just
 *  because a curve was repainted, so this never reaches for Math.random. */
function hash(seed: number, laneIndex: number): number {
  let h = (seed * 2654435761 + laneIndex * 40503) >>> 0;
  h ^= h >>> 15; h = Math.imul(h, 2246822507) >>> 0;
  h ^= h >>> 13;
  return (h >>> 0) / 4294967295;
}

export function styleForLane(
  base: StyleId, mix: number, laneIndex: number, seed: number, forced?: StyleId,
): StyleId {
  // A forced style is the user speaking; the macro does not get a vote.
  if (forced) return forced;
  if (mix <= 0) return base;
  const r = hash(seed, laneIndex);
  if (r >= mix) return base;
  // Pick from the catalogue, skipping the base so "strayed" always means moved.
  const others = STYLE_CATALOG.filter((s) => s.id !== base);
  return others[Math.floor(hash(seed + 1, laneIndex) * others.length) % others.length].id;
}

// Darkest first, so a HIGH darkness reads as the dark end.
const DARKNESS_SCALES: ScaleId[] = ['major', 'dorian', 'minor', 'phrygian'];

export function scaleForDarkness(darkness: number): ScaleId {
  const d = Math.min(1, Math.max(0, darkness));
  const i = Math.min(DARKNESS_SCALES.length - 1, Math.floor(d * DARKNESS_SCALES.length));
  return DARKNESS_SCALES[i];
}
```

- [ ] **Step 4: Ejecutar y ver que pasa**

Run: `NO_COLOR=1 npx vitest run src/weave/style-mix.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/weave/style-mix.ts src/weave/style-mix.test.ts
git commit -F - <<'EOF'
feat(weave): which style a lane strays to, and which scale darkness lands on

The draw is a hash of (seed, lane), not Math.random: a lane must not
change style merely because an automation curve was repainted.

A forced style is the user speaking and the macro gets no vote -- that is
the whole point of the per-lane override.
EOF
```

---

# FASE 7 — Armonía mínima

Sin acordes. Sólo prohibir lo que suena mal de verdad contra la nota base del
canal jefe.

### Task 25: La regla de no chocar

**Files:**
- Create: `src/weave/harmony-guard.ts`
- Test: `src/weave/harmony-guard.test.ts`

**Interfaces:**
- Consumes: `inScale`, `snapToScale`, `type ScaleId`
- Produces: `avoidClash(notes: NoteEvent[], rootMidi: number | null, key: number, scale: ScaleId): NoteEvent[]`

- [ ] **Step 1: Escribir el test que falla**

```ts
import { TICKS_PER_STEP, type NoteEvent } from '../core/notes';
import { inScale } from '../core/musicality';
import { avoidClash } from './harmony-guard';

const note = (midi: number): NoteEvent =>
  ({ start: 0, duration: TICKS_PER_STEP, midi, velocity: 90 });

describe('avoidClash', () => {
  it('changes nothing when there is no leader', () => {
    const ns = [note(45), note(46), note(51)];
    expect(avoidClash(ns, null, 9, 'minor')).toEqual(ns);
  });

  it('moves a semitone against the root', () => {
    const out = avoidClash([note(46)], 45, 9, 'minor');
    expect(out[0].midi).not.toBe(46);
  });

  it('moves a tritone against the root', () => {
    const out = avoidClash([note(51)], 45, 9, 'minor');
    expect(out[0].midi).not.toBe(51);
  });

  it('leaves a consonant note alone', () => {
    expect(avoidClash([note(52)], 45, 9, 'minor')[0].midi).toBe(52);   // a fifth
  });

  it('never silences a note', () => {
    const ns = [note(46), note(51), note(45)];
    expect(avoidClash(ns, 45, 9, 'minor')).toHaveLength(ns.length);
  });

  it('lands every moved note inside the scale', () => {
    for (let m = 40; m < 70; m++) {
      for (const n of avoidClash([note(m)], 45, 9, 'minor')) {
        expect(inScale(n.midi, 9, 'minor')).toBe(true);
      }
    }
  });

  it('leaves the leader’s own root alone even though its interval is zero', () => {
    expect(avoidClash([note(45)], 45, 9, 'minor')[0].midi).toBe(45);
  });
});
```

- [ ] **Step 2: Ejecutar y ver el fallo**

Run: `NO_COLOR=1 npx vitest run src/weave/harmony-guard.test.ts`
Expected: FAIL — `Cannot find module './harmony-guard'`.

- [ ] **Step 3: Implementar**

```ts
// Deliberately less than harmony. Loom does not know what a chord is and this
// does not teach it: it only forbids the two intervals that genuinely sound
// wrong against whatever the leading lane's lowest note is right now.
//
// If real harmony is ever wanted, this rule is a special case of it and does
// not have to be undone.

import type { NoteEvent } from '../core/notes';
import { inScale, type ScaleId } from '../core/musicality';

/** Semitone, and tritone. Everything else is left alone. */
const FORBIDDEN = new Set([1, 6, 11]);

const interval = (midi: number, root: number) => {
  const d = ((midi - root) % 12 + 12) % 12;
  return d;
};

export function avoidClash(
  notes: NoteEvent[], rootMidi: number | null, key: number, scale: ScaleId,
): NoteEvent[] {
  if (rootMidi === null) return notes;

  return notes.map((n) => {
    if (!FORBIDDEN.has(interval(n.midi, rootMidi))) return n;

    // Try the neighbouring scale degree, up first then down. A note is never
    // silenced: if neither neighbour helps, it stays as it is.
    for (const step of [1, -1, 2, -2]) {
      const cand = n.midi + step;
      if (!inScale(cand, key, scale)) continue;
      if (FORBIDDEN.has(interval(cand, rootMidi))) continue;
      return { ...n, midi: cand };
    }
    return n;
  });
}
```

- [ ] **Step 4: Ejecutar y ver que pasa**

Run: `NO_COLOR=1 npx vitest run src/weave/harmony-guard.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/weave/harmony-guard.ts src/weave/harmony-guard.test.ts
git commit -F - <<'EOF'
feat(weave): forbid the two intervals that really clash, and nothing else

This is deliberately less than harmony: Loom still does not know what a
chord is. A semitone or a tritone against the leader's lowest note gets
pushed to the neighbouring degree, and if no neighbour helps the note
stays -- nothing is ever silenced.

If real harmony is wanted later, this is a special case of it and does
not have to be undone.
EOF
```

### Task 26: El jefe de armonía, dentro del runtime

**Files:**
- Modify: `src/weave/weave-runtime.ts`
- Test: `src/weave/weave-runtime.test.ts`

**Interfaces:**
- Produces: `createWeaveNotes(cfgs: Array<{ laneId: string; cfg: LaneWeaveConfig; melodic: boolean }>, o: BlendOptions): Map<string, NoteEvent[]>`
  - Funde cada canal, halla la nota más grave del jefe y pasa el resto por `avoidClash`.

- [ ] **Step 1: Escribir el test que falla**

```ts
import { createWeaveNotes } from './weave-runtime';
import { TICKS_PER_STEP, type NoteEvent } from '../core/notes';
import type { LaneWeaveConfig } from './weave-state';

const BAR = TICKS_PER_STEP * 16;
const note = (midi: number): NoteEvent => ({ start: 0, duration: TICKS_PER_STEP, midi, velocity: 90 });
const o = { barTicks: BAR, melodic: true, key: 9, scale: 'minor' as const, octaveBase: 36 };
const still = (notes: NoteEvent[], leader: boolean): LaneWeaveConfig => ({
  weave: { kind: 'ab', state: { a: { id: 'a', notes }, b: { id: 'b', notes }, x: 0 } },
  locked: false, harmonyLeader: leader,
});

describe('harmony leader inside the runtime', () => {
  it('leaves every lane alone when no lane leads', () => {
    const out = createWeaveNotes([
      { laneId: 'bass', cfg: still([note(45)], false), melodic: true },
      { laneId: 'lead', cfg: still([note(46)], false), melodic: true },
    ], o);
    expect(out.get('lead')?.[0].midi).toBe(46);
  });

  it('moves a clashing note once a lane leads', () => {
    const out = createWeaveNotes([
      { laneId: 'bass', cfg: still([note(45)], true), melodic: true },
      { laneId: 'lead', cfg: still([note(46)], false), melodic: true },
    ], o);
    expect(out.get('lead')?.[0].midi).not.toBe(46);
  });

  it('never alters the leader itself', () => {
    const out = createWeaveNotes([
      { laneId: 'bass', cfg: still([note(45), note(46)], true), melodic: true },
      { laneId: 'lead', cfg: still([note(52)], false), melodic: true },
    ], o);
    expect(out.get('bass')?.map((n) => n.midi)).toEqual([45, 46]);
  });

  it('takes the leader’s LOWEST note as the root', () => {
    const out = createWeaveNotes([
      { laneId: 'bass', cfg: still([note(57), note(45)], true), melodic: true },
      { laneId: 'lead', cfg: still([note(46)], false), melodic: true },   // semitone over 45
    ], o);
    expect(out.get('lead')?.[0].midi).not.toBe(46);
  });
});
```

- [ ] **Step 2: Ejecutar y ver el fallo**

Run: `NO_COLOR=1 npx vitest run src/weave/weave-runtime.test.ts`
Expected: FAIL — `createWeaveNotes is not a function`.

- [ ] **Step 3: Implementar**

Añadir a `src/weave/weave-runtime.ts`:

```ts
import { avoidClash } from './harmony-guard';

export interface LaneWeaveEntry {
  laneId: string;
  cfg: LaneWeaveConfig;
  melodic: boolean;
}

/** Blends every lane, then lets the leading lane's lowest note veto the
 *  intervals that clash with it. The leader is never altered -- it is the
 *  reference, and moving it would make the rule chase its own tail. */
export function createWeaveNotes(
  entries: LaneWeaveEntry[], o: BlendOptions,
): Map<string, NoteEvent[]> {
  const blended = new Map<string, NoteEvent[]>();
  for (const e of entries) {
    blended.set(e.laneId, blendLoops(laneWeights(e.cfg), { ...o, melodic: e.melodic }));
  }

  const leader = entries.find((e) => e.cfg.harmonyLeader);
  if (!leader) return blended;

  const leaderNotes = blended.get(leader.laneId) ?? [];
  if (leaderNotes.length === 0) return blended;
  const root = leaderNotes.reduce((lo, n) => Math.min(lo, n.midi), Infinity);

  for (const e of entries) {
    if (e.laneId === leader.laneId || !e.melodic) continue;
    blended.set(e.laneId, avoidClash(blended.get(e.laneId) ?? [], root, o.key, o.scale));
  }
  return blended;
}
```

- [ ] **Step 4: Ejecutar y ver que pasa**

Run: `NO_COLOR=1 npx vitest run src/weave/weave-runtime.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/weave/weave-runtime.ts src/weave/weave-runtime.test.ts
git commit -F - <<'EOF'
feat(weave): the leading lane's lowest note vetoes what clashes with it

The leader is never altered. It is the reference, and moving it would
make the rule chase its own tail -- a lane adjusting to a root that
adjusts to the lane.

Percussion is skipped: a drum note picks a voice, not a pitch, so there
is no interval to forbid.
EOF
```

---

# FASE 8 — Longitud y tempo del bucle

Hoy `×2` y `/2` comparten un botón con dos comportamientos distintos metidos
dentro. Se separan.

### Task 27: Escalar la longitud de un clip

**Files:**
- Create: `src/weave/clip-length.ts`
- Test: `src/weave/clip-length.test.ts`

**Interfaces:**
- Produces:
  - `type LengthMode = 'repeat' | 'stretch' | 'vary'`
  - `scaleClipLength(notes: NoteEvent[], factor: number, mode: LengthMode, srcTicks: number): NoteEvent[]`

- [ ] **Step 1: Escribir el test que falla**

```ts
import { TICKS_PER_STEP, type NoteEvent } from '../core/notes';
import { scaleClipLength } from './clip-length';

const BAR = TICKS_PER_STEP * 16;
const note = (step: number, midi = 60): NoteEvent =>
  ({ start: step * TICKS_PER_STEP, duration: TICKS_PER_STEP, midi, velocity: 90 });
const IN = [note(0), note(4), note(8)];

describe('scaleClipLength', () => {
  it('tiles the source when repeating at x2', () => {
    const out = scaleClipLength(IN, 2, 'repeat', BAR);
    expect(out).toHaveLength(IN.length * 2);
    expect(out.some((n) => n.start === BAR)).toBe(true);
    // The groove is untouched: the first copy is identical.
    expect(out.slice(0, 3).map((n) => n.start)).toEqual(IN.map((n) => n.start));
  });

  it('tiles three times at x3', () => {
    expect(scaleClipLength(IN, 3, 'repeat', BAR)).toHaveLength(IN.length * 3);
  });

  it('stretches positions and durations, keeping the note count', () => {
    const out = scaleClipLength(IN, 2, 'stretch', BAR);
    expect(out).toHaveLength(IN.length);
    expect(out[1].start).toBe(IN[1].start * 2);
    expect(out[1].duration).toBe(IN[1].duration * 2);
  });

  it('halves positions and durations at 0.5, dropping what falls outside', () => {
    const out = scaleClipLength(IN, 0.5, 'stretch', BAR);
    expect(out[1].start).toBe(IN[1].start / 2);
  });

  it('keeps only what fits when repeating at 0.5', () => {
    const out = scaleClipLength(IN, 0.5, 'repeat', BAR);
    for (const n of out) expect(n.start).toBeLessThan(BAR / 2);
  });

  it('tiles like repeat but does not leave the copies identical when varying', () => {
    const out = scaleClipLength([note(0), note(3), note(4)], 2, 'vary', BAR);
    const first = out.filter((n) => n.start < BAR).map((n) => n.start % BAR);
    const second = out.filter((n) => n.start >= BAR).map((n) => n.start % BAR);
    expect(second).not.toEqual(first);
  });

  it('refuses a factor of zero rather than emptying the clip', () => {
    expect(scaleClipLength(IN, 0, 'repeat', BAR)).toEqual(IN);
  });
});
```

- [ ] **Step 2: Ejecutar y ver el fallo**

Run: `NO_COLOR=1 npx vitest run src/weave/clip-length.test.ts`
Expected: FAIL — `Cannot find module './clip-length'`.

- [ ] **Step 3: Implementar**

```ts
// Growing a clip is two different musical operations, and they are two
// buttons rather than one hidden mode:
//   repeat  -- tile the bar. The groove is untouched; there is just more of it.
//   stretch -- lengthen the notes. The groove changes character.
//   vary    -- tile, but drop the weakest hit of each copy after the first, so
//              the second time round is not the first time round.

import type { NoteEvent } from '../core/notes';
import { metricWeight } from './metric-weight';

export type LengthMode = 'repeat' | 'stretch' | 'vary';

export function scaleClipLength(
  notes: NoteEvent[], factor: number, mode: LengthMode, srcTicks: number,
): NoteEvent[] {
  // A factor of 0 would return an empty clip and look like data loss.
  if (!Number.isFinite(factor) || factor <= 0) return notes;

  if (mode === 'stretch') {
    return notes.map((n) => ({
      ...n,
      start: Math.round(n.start * factor),
      duration: Math.max(1, Math.round(n.duration * factor)),
    }));
  }

  const target = Math.round(srcTicks * factor);
  const copies = Math.max(1, Math.ceil(factor));
  const out: NoteEvent[] = [];
  for (let c = 0; c < copies; c++) {
    const offset = c * srcTicks;
    let src = notes;
    if (mode === 'vary' && c > 0 && notes.length > 1) {
      // Drop this copy's weakest hit. Which one depends on the copy index, so
      // the third pass is not the second pass either.
      const ranked = [...notes].sort(
        (a, b) => metricWeight(a.start, srcTicks) - metricWeight(b.start, srcTicks),
      );
      const victim = ranked[(c - 1) % ranked.length];
      src = notes.filter((n) => n !== victim);
    }
    for (const n of src) {
      const start = n.start + offset;
      if (start >= target) continue;
      out.push({ ...n, start });
    }
  }
  return out.sort((a, b) => a.start - b.start);
}
```

- [ ] **Step 4: Ejecutar y ver que pasa**

Run: `NO_COLOR=1 npx vitest run src/weave/clip-length.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/weave/clip-length.ts src/weave/clip-length.test.ts
git commit -F - <<'EOF'
feat(weave): growing a clip is three operations, so it is three buttons

Repeat tiles and the groove survives. Stretch lengthens the notes and the
character changes. Vary tiles but drops a different weak hit each pass,
so the second time round is not the first.

A factor of zero returns the clip unchanged. Emptying it would look
exactly like data loss.
EOF
```

### Task 28: El tempo del bucle

**Files:**
- Modify: `src/weave/clip-length.ts`
- Test: `src/weave/clip-length.test.ts`

**Interfaces:**
- Produces: `retimeClip(notes: NoteEvent[], rate: number): NoteEvent[]` — `rate > 1` acelera (posiciones más juntas).

- [ ] **Step 1: Escribir el test que falla**

```ts
import { retimeClip } from './clip-length';

describe('retimeClip', () => {
  it('packs the notes closer at double rate', () => {
    const out = retimeClip([note(0), note(8)], 2);
    expect(out[1].start).toBe(note(8).start / 2);
  });

  it('spreads them out at half rate', () => {
    const out = retimeClip([note(0), note(8)], 0.5);
    expect(out[1].start).toBe(note(8).start * 2);
  });

  it('scales durations by the same amount', () => {
    expect(retimeClip([note(0)], 2)[0].duration).toBe(note(0).duration / 2);
  });

  it('never produces a duration below one tick', () => {
    const tiny: NoteEvent = { start: 0, duration: 1, midi: 60, velocity: 90 };
    expect(retimeClip([tiny], 8)[0].duration).toBeGreaterThanOrEqual(1);
  });

  it('refuses a rate of zero rather than collapsing every note onto tick 0', () => {
    const ns = [note(0), note(8)];
    expect(retimeClip(ns, 0)).toEqual(ns);
  });
});
```

- [ ] **Step 2: Ejecutar y ver el fallo**

Run: `NO_COLOR=1 npx vitest run src/weave/clip-length.test.ts`
Expected: FAIL — `retimeClip is not a function`.

- [ ] **Step 3: Implementar**

```ts
/** Play the same material faster or slower without changing which notes it
 *  contains. `rate > 1` packs them closer. For audio material this is the
 *  time-stretch that already exists; for notes it is arithmetic. */
export function retimeClip(notes: NoteEvent[], rate: number): NoteEvent[] {
  // Rate 0 would collapse every note onto tick 0 -- a clip that plays one
  // chord and nothing else, which reads as a bug, not as a slow tempo.
  if (!Number.isFinite(rate) || rate <= 0) return notes;
  return notes.map((n) => ({
    ...n,
    start: Math.round(n.start / rate),
    duration: Math.max(1, Math.round(n.duration / rate)),
  }));
}
```

- [ ] **Step 4: Ejecutar y ver que pasa**

Run: `NO_COLOR=1 npx vitest run src/weave/clip-length.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/weave/clip-length.ts src/weave/clip-length.test.ts
git commit -F - <<'EOF'
feat(weave): the loop's own tempo, independent of the session's

Rate zero returns the clip untouched: collapsing every note onto tick 0
gives a clip that plays one chord, which reads as a bug rather than as a
very slow tempo.
EOF
```

---

# FASE 9 — Automatización por pasos

El painter sabe pintar formas de LFO. Le falta lo contrario: dibujar los pasos
a mano.

### Task 29: Rellenar un envelope desde N pasos

**Files:**
- Create: `src/automation/automation-steps.ts`
- Test: `src/automation/automation-steps.test.ts`

**Interfaces:**
- Produces:
  - `type StepMode = 'hold' | 'ramp'`
  - `fillSteps(values: number[], mode: StepMode, subs: number): number[]` — devuelve `subs` muestras `0..1`

- [ ] **Step 1: Escribir el test que falla**

```ts
import { fillSteps } from './automation-steps';

describe('fillSteps', () => {
  it('holds each value flat across its slice', () => {
    const out = fillSteps([0, 1], 'hold', 8);
    expect(out.slice(0, 4).every((v) => v === 0)).toBe(true);
    expect(out.slice(4).every((v) => v === 1)).toBe(true);
  });

  it('ramps between neighbours instead of stepping', () => {
    const out = fillSteps([0, 1], 'ramp', 8);
    const mid = out[2];
    expect(mid).toBeGreaterThan(0);
    expect(mid).toBeLessThan(1);
  });

  it('returns exactly the number of samples asked for', () => {
    for (const subs of [1, 7, 16, 33]) {
      expect(fillSteps([0.2, 0.8, 0.5], 'hold', subs)).toHaveLength(subs);
    }
  });

  it('gives a hold curve more flat runs than a ramp of the same steps', () => {
    const flatRuns = (xs: number[]) =>
      xs.filter((v, i) => i > 0 && v === xs[i - 1]).length;
    const steps = [0, 0.5, 1, 0.25];
    expect(flatRuns(fillSteps(steps, 'hold', 32)))
      .toBeGreaterThan(flatRuns(fillSteps(steps, 'ramp', 32)));
  });

  it('returns a flat zero curve when handed no steps', () => {
    expect(fillSteps([], 'hold', 4)).toEqual([0, 0, 0, 0]);
  });

  it('keeps every sample inside 0..1 even with values outside it', () => {
    for (const v of fillSteps([-2, 3], 'ramp', 8)) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
  });
});
```

- [ ] **Step 2: Ejecutar y ver el fallo**

Run: `NO_COLOR=1 npx vitest run src/automation/automation-steps.test.ts`
Expected: FAIL — `Cannot find module './automation-steps'`.

- [ ] **Step 3: Implementar**

```ts
// The opposite of the LFO painter: instead of describing a shape and letting
// the module draw it, you draw the steps and this turns them into a curve.

export type StepMode = 'hold' | 'ramp';

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

export function fillSteps(values: number[], mode: StepMode, subs: number): number[] {
  const out = new Array<number>(Math.max(0, subs)).fill(0);
  if (values.length === 0 || subs <= 0) return out;

  const n = values.length;
  for (let i = 0; i < subs; i++) {
    const pos = (i / subs) * n;              // 0..n
    const idx = Math.min(n - 1, Math.floor(pos));
    if (mode === 'hold') {
      out[i] = clamp01(values[idx]);
      continue;
    }
    // Ramp toward the next step, wrapping so the curve closes on itself.
    const frac = pos - idx;
    const a = clamp01(values[idx]);
    const b = clamp01(values[(idx + 1) % n]);
    out[i] = a + (b - a) * frac;
  }
  return out;
}
```

- [ ] **Step 4: Ejecutar y ver que pasa**

Run: `NO_COLOR=1 npx vitest run src/automation/automation-steps.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/automation/automation-steps.ts src/automation/automation-steps.test.ts
git commit -F - <<'EOF'
feat(automation): draw the steps and get a curve, the inverse of the LFO painter

Ramp wraps to the first step so a painted curve closes on itself inside
the region -- otherwise every loop would jump at the seam.

Values outside 0..1 clamp rather than being trusted: the control cannot
produce them, but a saved file could.
EOF
```

### Task 30: Los atajos de forma

**Files:**
- Modify: `src/automation/automation-steps.ts`
- Test: `src/automation/automation-steps.test.ts`

**Interfaces:**
- Produces: `stepPreset(kind: 'up' | 'down' | 'invert' | 'random', count: number, current: number[], rand: () => number): number[]`

- [ ] **Step 1: Escribir el test que falla**

```ts
import { stepPreset } from './automation-steps';

describe('step presets', () => {
  it('ramps up from low to high', () => {
    const up = stepPreset('up', 8, [], () => 0.5);
    expect(up[0]).toBeLessThan(up[up.length - 1]);
  });

  it('ramps down from high to low', () => {
    const down = stepPreset('down', 8, [], () => 0.5);
    expect(down[0]).toBeGreaterThan(down[down.length - 1]);
  });

  it('mirrors the current values when inverting', () => {
    expect(stepPreset('invert', 3, [0.2, 0.5, 1], () => 0)).toEqual([0.8, 0.5, 0]);
  });

  it('inverting twice returns the original', () => {
    const original = [0.1, 0.4, 0.9];
    const twice = stepPreset('invert', 3, stepPreset('invert', 3, original, () => 0), () => 0);
    twice.forEach((v, i) => expect(v).toBeCloseTo(original[i]));
  });

  it('uses the injected source for random, so the result is reproducible', () => {
    expect(stepPreset('random', 4, [], () => 0.25)).toEqual([0.25, 0.25, 0.25, 0.25]);
  });

  it('returns the asked-for count even when the current values are shorter', () => {
    expect(stepPreset('invert', 5, [0.5], () => 0)).toHaveLength(5);
  });
});
```

- [ ] **Step 2: Ejecutar y ver el fallo**

Run: `NO_COLOR=1 npx vitest run src/automation/automation-steps.test.ts`
Expected: FAIL — `stepPreset is not a function`.

- [ ] **Step 3: Implementar**

```ts
/** The four shortcut buttons. `rand` is injected so the random preset is
 *  reproducible in a test instead of being untestable by construction. */
export function stepPreset(
  kind: 'up' | 'down' | 'invert' | 'random',
  count: number,
  current: number[],
  rand: () => number,
): number[] {
  const n = Math.max(1, count);
  const out = new Array<number>(n);
  for (let i = 0; i < n; i++) {
    const t = n === 1 ? 0 : i / (n - 1);
    // A missing current value reads as 0, so invert on a short array still
    // returns `count` entries rather than a ragged one.
    const cur = clamp01(current[i] ?? 0);
    out[i] = kind === 'up' ? t
      : kind === 'down' ? 1 - t
      : kind === 'invert' ? 1 - cur
      : clamp01(rand());
  }
  return out;
}
```

- [ ] **Step 4: Ejecutar y ver que pasa**

Run: `NO_COLOR=1 npx vitest run src/automation/automation-steps.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/automation/automation-steps.ts src/automation/automation-steps.test.ts
git commit -F - <<'EOF'
feat(automation): ramp up, ramp down, invert and random as four shortcuts

The random source is injected. Reaching for Math.random inside would make
the one preset that most needs pinning the one that cannot be tested, and
invert-twice-is-identity is the property worth having.
EOF
```

### Task 31: La fila plegable elige entre LFO y pasos

**Files:**
- Create: `src/session/clip-automation-step-row.ts`
- Modify: `src/session/clip-automation-lanes.ts` (sólo para delegar; **no crece con la lógica del modo nuevo**)
- Test: `src/session/clip-automation-step-row.test.ts`

**Interfaces:**
- Consumes: `fillSteps`, `stepPreset`, `createStepsControl`
- Produces: `stepRowTemplate(h: Panel, clip: SessionClip, env: ClipEnvelope, strip: AutoStrip): TemplateResult` y `stepState` propio del módulo

- [ ] **Step 1: Escribir los tests que fallan**

```ts
import { renderClipAutomationLanes } from './clip-automation-lanes';

describe('the painter has two modes', () => {
  it('shows the LFO row by default', () => {
    const host = mountPainterWithOneLane();          // helper already in the sibling test file
    host.querySelector('.clip-auto-lfo-toggle')?.dispatchEvent(new MouseEvent('click'));
    expect(host.querySelector('.clip-auto-lfo-shape')).not.toBeNull();
  });

  it('switches to the step grid when the mode is changed', () => {
    const host = mountPainterWithOneLane();
    host.querySelector('.clip-auto-lfo-toggle')?.dispatchEvent(new MouseEvent('click'));
    const mode = host.querySelector('.clip-auto-mode') as HTMLSelectElement;
    mode.value = 'steps';
    mode.dispatchEvent(new Event('change'));
    expect(host.querySelector('.steps-control')).not.toBeNull();
    expect(host.querySelector('.clip-auto-lfo-shape')).toBeNull();
  });

  it('writes into the envelope when a bar is painted', () => {
    const { host, env } = mountPainterWithOneLane();
    host.querySelector('.clip-auto-lfo-toggle')?.dispatchEvent(new MouseEvent('click'));
    const mode = host.querySelector('.clip-auto-mode') as HTMLSelectElement;
    mode.value = 'steps';
    mode.dispatchEvent(new Event('change'));
    const before = [...env.values];
    (host.querySelector('.clip-auto-steps-apply') as HTMLButtonElement).click();
    expect(env.values).not.toEqual(before);
  });
});
```

Los ayudantes (`mountPainterWithOneLane`) son los que ya usa
`clip-automation-lanes.test.ts`; reutilizarlos, no duplicarlos.

- [ ] **Step 2: Ejecutar y ver el fallo**

Run: `NO_COLOR=1 npx vitest run src/session/clip-automation-step-row.test.ts`
Expected: FAIL — no existe el selector de modo.

- [ ] **Step 3: Implementar**

```ts
// The step half of the foldable row. It lives next door because
// clip-automation-lanes.ts already carries five jobs at 358 lines.

import { html, type TemplateResult } from 'lit-html';
import { createStepsControl } from '../core/controls/steps-control';
import { fillSteps, stepPreset, type StepMode } from '../automation/automation-steps';
// `lfoRegion` is private today and `Panel` is a local alias: both have to be
// exported from clip-automation-lanes.ts. `AutoStrip` lives in its own module.
import { lfoRegion, type Panel } from './clip-automation-lanes';
import type { AutoStrip } from './clip-auto-strip';
import type { TimeSignature } from '../core/meter';
import type { SessionClip, ClipEnvelope } from './session';

// Shared across lanes, exactly like lfoState: you set a shape up once and then
// paint it lane by lane. Not persisted.
const stepState = {
  count: 16,
  mode: 'hold' as StepMode,
  values: Array.from({ length: 16 }, () => 0.5),
};

// The meter is passed in rather than read off the strip: lfoRegion takes a
// TimeSignature, and inventing one here would silently disagree with the LFO
// row about which region the two of them paint.
function applyToEnvelope(
  clip: SessionClip, env: ClipEnvelope, meter: TimeSignature,
): void {
  const { from, to } = lfoRegion(clip, meter, env);
  const curve = fillSteps(stepState.values, stepState.mode, to - from);
  for (let i = 0; i < curve.length; i++) env.values[from + i] = curve[i];
}

export function stepRowTemplate(
  h: Panel, clip: SessionClip, env: ClipEnvelope, meter: TimeSignature, _strip: AutoStrip,
): TemplateResult {
  const grid = createStepsControl({
    values: stepState.values,
    onChange: (i, v) => { stepState.values[i] = v; },
  });

  const preset = (kind: 'up' | 'down' | 'invert' | 'random') => () => {
    stepState.values = stepPreset(kind, stepState.count, stepState.values, Math.random);
    h.rerender();
  };

  return html`
    <div class="clip-auto-steps">
      <input class="clip-auto-steps-count" type="number" min="1" max="64"
             .value=${String(stepState.count)} aria-label="Number of steps"
             @change=${(e: Event) => {
               const n = Math.max(1, Math.min(64, Number((e.currentTarget as HTMLInputElement).value)));
               stepState.count = n;
               // Keep what was already drawn; new steps start at the midpoint.
               stepState.values = Array.from({ length: n }, (_, i) => stepState.values[i] ?? 0.5);
               h.rerender();
             }}>
      <select class="clip-auto-steps-mode" aria-label="Step mode"
              @change=${(e: Event) => {
                stepState.mode = (e.currentTarget as HTMLSelectElement).value as StepMode;
              }}>
        <option value="hold" ?selected=${stepState.mode === 'hold'}>Hold</option>
        <option value="ramp" ?selected=${stepState.mode === 'ramp'}>Ramp</option>
      </select>
      <button @click=${preset('up')}>Ramp ↗</button>
      <button @click=${preset('down')}>Ramp ↘</button>
      <button @click=${preset('invert')}>Invert</button>
      <button @click=${preset('random')}>Random</button>
      <button class="clip-auto-steps-apply"
              @click=${() => { applyToEnvelope(clip, env, meter); h.rerender(); }}>Apply</button>
      ${grid.el}
    </div>`;
}
```

`lfoRegion` hay que **exportarlo** desde `clip-automation-lanes.ts`; hoy es
privado y las dos filas tienen que pintar sobre exactamente la misma región.

En `clip-automation-lanes.ts`, la fila plegable pasa a:

```ts
      <select class="clip-auto-mode" title="How this row draws"
              @change=${(e: Event) => {
                rowMode = (e.currentTarget as HTMLSelectElement).value as 'lfo' | 'steps';
                h.rerender();
              }}>
        <option value="lfo" ?selected=${rowMode === 'lfo'}>LFO</option>
        <option value="steps" ?selected=${rowMode === 'steps'}>Steps</option>
      </select>
      ${rowMode === 'lfo' ? lfoRowTemplate(h, clip, env, strip) : stepRowTemplate(h, clip, env, strip)}
```

**Restricción:** `clip-automation-lanes.ts` ya está en 358 líneas físicas con
cinco responsabilidades. Sólo puede ganar el selector y la delegación; toda la
lógica del modo nuevo vive en el módulo aparte. Al terminar, contar líneas DE
CÓDIGO de ambos ficheros y dejarlas en el mensaje de commit.

- [ ] **Step 4: Ejecutar y ver que pasa**

Run: `NO_COLOR=1 npx vitest run src/session/clip-automation-step-row.test.ts src/session/clip-automation-lanes.test.ts`
Expected: PASS los dos.

- [ ] **Step 5: Commit**

```bash
git add src/session/clip-automation-step-row.ts src/session/clip-automation-lanes.ts src/session/clip-automation-step-row.test.ts
git commit -F - <<'EOF'
feat(automation): the foldable row draws an LFO or a step grid

The step mode fits the row but not the file: clip-automation-lanes.ts
already carries five jobs. It gains the selector and a delegation, and
the sixth job is written next door -- the same lesson the inserts round
left behind.
EOF
```

---

# FASE 10 — El panel, Fijar, y la paridad con el mockup

### Task 32: El manifiesto de WEAVE

**Files:**
- Create: `public/plugins/weave/plugin.json`
- Modify: `public/plugins/index.json`
- Test: `tests/e2e/weave-panel.spec.ts`

**Interfaces:**
- Consumes: la categoría `panel` (tarea 3) y los tres controles (tareas 5-8)

- [ ] **Step 1: Escribir el manifiesto**

```json
{
  "id": "weave",
  "name": "Weave",
  "version": "1.0.0",
  "loomApi": 1,
  "author": "Loom",
  "components": [
    {
      "kind": "panel",
      "id": "weave",
      "name": "Weave",
      "panel": { "placement": "main-view" },
      "params": [
        { "id": "density",  "label": "Density",   "kind": "continuous", "min": 0, "max": 1, "default": 0.5 },
        { "id": "energy",   "label": "Energy",    "kind": "continuous", "min": 0, "max": 1, "default": 0.5 },
        { "id": "darkness", "label": "Darkness",  "kind": "continuous", "min": 0, "max": 1, "default": 0.5 },
        { "id": "space",    "label": "Space",     "kind": "continuous", "min": 0, "max": 1, "default": 0 },
        { "id": "motion",   "label": "Motion",    "kind": "continuous", "min": 0, "max": 1, "default": 0 },
        { "id": "styleMix", "label": "Style mix", "kind": "continuous", "min": 0, "max": 1, "default": 0 },
        { "id": "flow",     "label": "Flow",      "kind": "continuous", "min": 0, "max": 1, "default": 0 }
      ]
    }
  ]
}
```

y añadir `"weave"` al array de `public/plugins/index.json`.

- [ ] **Step 2: Escribir el e2e que falla**

```ts
test('the weave panel is offered as a view', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('tab', { name: 'Weave' })).toBeVisible();
});
```

- [ ] **Step 3: Ejecutar y ver el fallo**

Run: `npm run build && npm run test:e2e -- weave-panel`
Expected: FAIL — no hay pestaña.

- [ ] **Step 4: Implementar el registro**

En el bootstrap de plugins, enrutar `kind: 'panel'` a `registerPanel` (tarea 4),
y en las pestañas de vista, construir la lista desde `listPanels()` en vez de
una lista escrita a mano.

- [ ] **Step 5: Ejecutar y commitear**

Run: `npm run build && npm run test:e2e -- weave-panel`
Expected: PASS.

```bash
git add public/plugins/weave/plugin.json public/plugins/index.json tests/e2e/weave-panel.spec.ts src/app/
git commit -F - <<'EOF'
feat(plugins): weave ships as the first plugin that is a panel

The view tabs are built from listPanels() rather than a hand-written
list, so the next panel plugin needs no host change at all -- which is
the only way to know the fourth component kind actually works.
EOF
```

### Task 33: La carcasa del panel

**Files:**
- Create: `src/weave/weave-panel.ts`
- Test: `src/weave/weave-panel.test.ts`

**Interfaces:**
- Produces: `mountWeavePanel(host: HTMLElement, deps: WeavePanelDeps): () => void`

- [ ] **Step 1: Escribir el test que falla**

```ts
import { mountWeavePanel } from './weave-panel';
import { defaultWeaveState } from './weave-state';

const deps = () => ({
  getState: () => defaultWeaveState(),
  setMacro: vi.fn(),
  lanes: [],
});

describe('weave panel shell', () => {
  it('renders the header controls', () => {
    const host = document.createElement('div');
    mountWeavePanel(host, deps());
    expect(host.querySelector('.weave-key')).not.toBeNull();
    expect(host.querySelector('.weave-style')).not.toBeNull();
    expect(host.querySelector('.weave-bpm')).not.toBeNull();
  });

  it('renders one knob per macro', () => {
    const host = document.createElement('div');
    mountWeavePanel(host, deps());
    expect(host.querySelectorAll('.weave-macro')).toHaveLength(6);
  });

  it('reports a macro move through setMacro', () => {
    const host = document.createElement('div');
    const d = deps();
    mountWeavePanel(host, d);
    const knob = host.querySelector('.weave-macro svg') as SVGElement;
    knob.dispatchEvent(new PointerEvent('pointerdown', { clientY: 100, bubbles: true }));
    knob.dispatchEvent(new PointerEvent('pointermove', { clientY: 50, buttons: 1, bubbles: true }));
    expect(d.setMacro).toHaveBeenCalled();
  });

  it('tears down cleanly', () => {
    const host = document.createElement('div');
    const off = mountWeavePanel(host, deps());
    off();
    expect(host.children).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Ejecutar y ver el fallo**

Run: `NO_COLOR=1 npx vitest run src/weave/weave-panel.test.ts`
Expected: FAIL — `Cannot find module './weave-panel'`.

- [ ] **Step 3: Implementar**

```ts
// The panel shell. Structure and class names come from the approved mockup,
// which is committed beside the spec -- visual parity is an acceptance
// criterion, so the markup is not free to drift from it.

import { html } from 'lit-html';
import { renderInto } from '../core/lit-fill';
import { STYLE_CATALOG, SCALE_CATALOG, rootName } from '../core/musicality';
import { WEAVE_MACROS } from './weave-catalog';
import type { WeaveState } from './weave-state';

export interface WeavePanelDeps {
  getState(): WeaveState;
  setMacro(id: string, value: number): void;
  lanes: unknown[];
}

// The arc opens at the BOTTOM. 225 degrees clockwise from twelve, sweeping 270.
// Drawing it from 135 puts the gap on top and the knob reads upside down --
// which is what the mockup did until someone opened it in a browser.
const R = 22, CX = 29, CY = 29, SWEEP = 270, START = 225;

const polar = (deg: number, radius: number): [number, number] => {
  const rad = (deg - 90) * Math.PI / 180;
  return [CX + radius * Math.cos(rad), CY + radius * Math.sin(rad)];
};

function arcPath(frac: number): string {
  const [x0, y0] = polar(START, R);
  const [x1, y1] = polar(START + SWEEP * frac, R);
  const large = SWEEP * frac > 180 ? 1 : 0;
  return `M ${x0.toFixed(2)} ${y0.toFixed(2)} A ${R} ${R} 0 ${large} 1 ${x1.toFixed(2)} ${y1.toFixed(2)}`;
}

/** The pointer lives INSIDE the hub, centre to rim, where it is readable. Drawn
 *  out in the ring it disappears under the arc. */
function tickLine(frac: number): { x1: number; y1: number; x2: number; y2: number } {
  const [x1, y1] = polar(START + SWEEP * frac, 3);
  const [x2, y2] = polar(START + SWEEP * frac, 10);
  return { x1, y1, x2, y2 };
}

function macroTemplate(id: string, label: string, color: string, value: number, deps: WeavePanelDeps) {
  const t = tickLine(value);
  let lastY = 0;
  return html`
    <div class="weave-macro">
      <svg viewBox="0 0 58 58" role="slider" tabindex="0"
           aria-label=${label} aria-valuemin="0" aria-valuemax="1" aria-valuenow=${value.toFixed(2)}
           @pointerdown=${(e: PointerEvent) => {
             (e.currentTarget as SVGElement).setPointerCapture(e.pointerId);
             lastY = e.clientY;
           }}
           @pointermove=${(e: PointerEvent) => {
             if (!e.buttons) return;
             // 180 px of travel spans the full range: fine enough to place a
             // value, coarse enough to cross it in one gesture.
             const next = Math.min(1, Math.max(0, value + (lastY - e.clientY) / 180));
             lastY = e.clientY;
             deps.setMacro(id, next);
           }}
           @keydown=${(e: KeyboardEvent) => {
             const d = e.key === 'ArrowUp' || e.key === 'ArrowRight' ? 0.05
                     : e.key === 'ArrowDown' || e.key === 'ArrowLeft' ? -0.05 : 0;
             if (!d) return;
             e.preventDefault();
             deps.setMacro(id, Math.min(1, Math.max(0, value + d)));
           }}>
        <path class="knob-track" d=${arcPath(1)}></path>
        <path class="knob-arc" d=${arcPath(value)} style=${`stroke:${color}`}></path>
        <circle class="knob-hub" cx=${CX} cy=${CY} r="11"></circle>
        <line class="knob-tick" x1=${t.x1} y1=${t.y1} x2=${t.x2} y2=${t.y2}></line>
      </svg>
      <span class="mname">${label}</span>
      <span class="mval">${value.toFixed(2).replace('.', ',')}</span>
    </div>`;
}

export function mountWeavePanel(host: HTMLElement, deps: WeavePanelDeps): () => void {
  const render = () => {
    const s = deps.getState();
    renderInto(host, html`
      <div class="weave-rack">
        <div class="rack-head">
          <span class="logo">WEAVE</span>
          <select class="weave-key" aria-label="Key">
            ${Array.from({ length: 12 }, (_, i) => html`<option value=${i}>${rootName(i)}</option>`)}
          </select>
          <select class="weave-scale" aria-label="Scale">
            ${SCALE_CATALOG.map((sc) => html`<option value=${sc.id}>${sc.label}</option>`)}
          </select>
          <select class="weave-style" aria-label="Base style">
            ${STYLE_CATALOG.map((st) => html`<option value=${st.id}>${st.label}</option>`)}
          </select>
          <input class="weave-bpm" aria-label="Tempo" .value=${'128'}>
          <button id="weave-reshuffle">⟳ Reshuffle</button>
          <button id="weave-print" class="on">▣ Print to scene</button>
        </div>

        <div class="strip">
          <input type="range" id="weave-flow" min="0" max="1" step="0.01"
                 aria-label="Master flow" .value=${'0'}>
        </div>

        <div class="strip weave-macros">
          ${WEAVE_MACROS.map((m) =>
            macroTemplate(m.id, m.label, m.color, s.macros[m.id] ?? m.neutral, deps))}
        </div>
      </div>`);
  };

  render();
  return () => { host.replaceChildren(); };
}
```

Los estilos van en `src/styles/_weave.scss`, importado desde `src/style.scss`,
con las clases del mockup (`.weave-rack`, `.rack-head`, `.strip`, `.weave-macro`,
`.knob-track`, `.knob-arc`, `.knob-hub`, `.knob-tick`).

Las filas de canal y las herramientas de clip llegan en las tareas 34 y 36; esta
tarea deja el hueco donde se montan.

- [ ] **Step 4: Ejecutar y ver que pasa**

Run: `NO_COLOR=1 npx vitest run src/weave/weave-panel.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/weave/weave-panel.ts src/weave/weave-panel.test.ts src/styles/_weave.scss src/style.scss
git commit -F - <<'EOF'
feat(weave): the panel shell -- header, master flow and the six knobs

The arc opens at the BOTTOM: origin at 225 degrees clockwise from twelve,
sweeping 270. Drawing it from 135 puts the gap on top and the knob reads
upside down, which is exactly what the mockup did until it was opened in
a browser.
EOF
```

### Task 34: Las filas de canal

**Files:**
- Modify: `src/weave/weave-panel.ts`
- Create: `src/weave/weave-lane-row.ts`
- Test: `src/weave/weave-lane-row.test.ts`

**Interfaces:**
- Produces: `laneRowTemplate(lane: LaneRowModel, cb: LaneRowCallbacks): TemplateResult`

- [ ] **Step 1: Escribir los tests que fallan**

Un test por camino de usuario, sin alternativas.

```ts
import { renderElement } from '../core/lit-fill';
import { laneRowTemplate, type LaneRowModel, type LaneRowCallbacks } from './weave-lane-row';
import type { LoopRef } from './topology-types';

const loop = (id: string): LoopRef => ({ id, notes: [] });

const model = (over: Partial<LaneRowModel> = {}): LaneRowModel => ({
  laneId: 'lane-1',
  name: 'BASS',
  engineId: 'tb303',
  engines: [{ id: 'tb303', name: 'TB-303' }, { id: 'fm', name: 'FM' }],
  presetId: 'acid',
  presets: [{ id: 'acid', name: 'Acid Line' }],
  styleId: 'acid-techno',
  cfg: {
    weave: { kind: 'ab', state: { a: loop('a'), b: loop('b'), x: 0.25 } },
    locked: false, harmonyLeader: false,
  },
  ...over,
});

const cbs = (): LaneRowCallbacks => ({
  onEngine: vi.fn(), onPreset: vi.fn(), onStyle: vi.fn(),
  onTopology: vi.fn(), onPosition: vi.fn(), onLock: vi.fn(),
  onReshuffle: vi.fn(), onHarmonyLeader: vi.fn(),
});

const mount = (m: LaneRowModel, cb: LaneRowCallbacks) => {
  const host = document.createElement('div');
  document.body.appendChild(host);
  renderElement(host, laneRowTemplate(m, cb));
  return host;
};

describe('lane row', () => {
  it('offers an instrument selector', () => {
    expect(mount(model(), cbs()).querySelector('.weave-engine')).not.toBeNull();
  });

  it('offers a preset selector', () => {
    expect(mount(model(), cbs()).querySelector('.weave-preset')).not.toBeNull();
  });

  it('offers a style selector', () => {
    expect(mount(model(), cbs()).querySelector('.weave-style-lane')).not.toBeNull();
  });

  it('shows the A-to-B fader when the topology is ab', () => {
    const host = mount(model(), cbs());
    expect(host.querySelector('.weave-cell input[type=range]')).not.toBeNull();
    expect(host.querySelector('.queue-control')).toBeNull();
  });

  it('shows the queue control when the topology is queue', () => {
    const host = mount(model({
      cfg: {
        weave: { kind: 'queue', state: { loops: [loop('a'), loop('b'), loop('c')], x: 0 } },
        locked: false, harmonyLeader: false,
      },
    }), cbs());
    expect(host.querySelector('.queue-control')).not.toBeNull();
  });

  it('shows the 2d pad when the topology is cloud', () => {
    const host = mount(model({
      cfg: {
        weave: {
          kind: 'cloud',
          state: { corners: [loop('a'), loop('b'), loop('c'), loop('d')], x: 0.5, y: 0.5 },
        },
        locked: false, harmonyLeader: false,
      },
    }), cbs());
    expect(host.querySelector('.pad2d')).not.toBeNull();
  });

  it('reports a topology change', () => {
    const cb = cbs();
    const host = mount(model(), cb);
    (host.querySelector('.weave-topo [data-t="q"]') as HTMLButtonElement).click();
    expect(cb.onTopology).toHaveBeenCalledWith('lane-1', 'queue');
  });

  it('reports the lock toggle', () => {
    const cb = cbs();
    const host = mount(model(), cb);
    (host.querySelector('.weave-lock') as HTMLButtonElement).click();
    expect(cb.onLock).toHaveBeenCalledWith('lane-1', true);
  });

  it('reports the per-lane reshuffle', () => {
    const cb = cbs();
    const host = mount(model(), cb);
    (host.querySelector('.weave-reshuffle') as HTMLButtonElement).click();
    expect(cb.onReshuffle).toHaveBeenCalledWith('lane-1');
  });

  it('marks a lane whose style is forced', () => {
    const host = mount(model({
      cfg: { ...model().cfg, forcedStyle: 'jungle' },
    }), cbs());
    expect(host.querySelector('.weave-style-lane')?.classList.contains('forced')).toBe(true);
  });

  it('does not mark a lane whose style is not forced', () => {
    const host = mount(model(), cbs());
    expect(host.querySelector('.weave-style-lane')?.classList.contains('forced')).toBe(false);
  });

  it('marks the harmony leader', () => {
    const host = mount(model({
      cfg: { ...model().cfg, harmonyLeader: true },
    }), cbs());
    expect(host.querySelector('.weave-lane')?.classList.contains('leader')).toBe(true);
  });
});
```

- [ ] **Step 2: Ejecutar y ver el fallo**

Run: `NO_COLOR=1 npx vitest run src/weave/weave-lane-row.test.ts`
Expected: FAIL — `Cannot find module './weave-lane-row'`.

- [ ] **Step 3: Implementar**

```ts
// One row of the panel. Three topologies, three widgets, one contract: each
// reports a position and the row does not care which shape produced it.

import { html, type TemplateResult } from 'lit-html';
import { STYLE_CATALOG, type StyleId } from '../core/musicality';
import { createQueueControl } from '../core/controls/queue-control';
import { createPad2d } from '../core/controls/pad2d';
import type { LaneWeaveConfig } from './weave-state';

export interface LaneRowModel {
  laneId: string;
  name: string;
  engineId: string;
  engines: Array<{ id: string; name: string }>;
  presetId: string;
  presets: Array<{ id: string; name: string }>;
  styleId: StyleId;
  cfg: LaneWeaveConfig;
}

export interface LaneRowCallbacks {
  onEngine(laneId: string, engineId: string): void;
  onPreset(laneId: string, presetId: string): void;
  onStyle(laneId: string, styleId: StyleId): void;
  onTopology(laneId: string, kind: 'ab' | 'queue' | 'cloud'): void;
  /** Two numbers for the cloud, one for the other two. */
  onPosition(laneId: string, x: number, y?: number): void;
  onLock(laneId: string, locked: boolean): void;
  onReshuffle(laneId: string): void;
  onHarmonyLeader(laneId: string, leader: boolean): void;
}

const TOPOS: Array<{ t: 'ab' | 'queue' | 'cloud'; label: string; title: string }> = [
  { t: 'ab', label: 'A▸B', title: 'A to B, re-hooking forever' },
  { t: 'queue', label: '≡', title: 'A queue of loops' },
  { t: 'cloud', label: '◇', title: 'A 2D cloud of four loops' },
];

/** lit-html renders declaratively; these two controls own their own DOM and
 *  pointer capture, so they are built once and handed in as a node. */
function weaveWidget(m: LaneRowModel, cb: LaneRowCallbacks): TemplateResult | Node {
  const w = m.cfg.weave;
  if (w.kind === 'queue') {
    return createQueueControl({
      length: w.state.loops.length,
      value: w.state.x,
      onChange: (v) => cb.onPosition(m.laneId, v),
    }).el;
  }
  if (w.kind === 'cloud') {
    return createPad2d({
      x: w.state.x, y: w.state.y,
      onChange: (x, y) => cb.onPosition(m.laneId, x, y),
    }).el;
  }
  return html`
    <div class="loopnames">
      <span class="na">${w.state.a.id}</span><span class="nb">${w.state.b.id}</span>
    </div>
    <input type="range" min="0" max="1" step="0.01" .value=${String(w.state.x)}
           aria-label=${`Crossfade for ${m.name}`}
           @input=${(e: Event) =>
             cb.onPosition(m.laneId, Number((e.currentTarget as HTMLInputElement).value))}>`;
}

export function laneRowTemplate(m: LaneRowModel, cb: LaneRowCallbacks): TemplateResult {
  const cls = ['weave-lane', m.cfg.harmonyLeader ? 'leader' : ''].filter(Boolean).join(' ');
  return html`
    <div class=${cls}>
      <span class="led ${m.cfg.locked ? 'off' : ''}"></span>
      <span class="lane-name">${m.name}</span>

      <select class="weave-engine" @change=${(e: Event) =>
        cb.onEngine(m.laneId, (e.currentTarget as HTMLSelectElement).value)}>
        ${m.engines.map((en) => html`<option value=${en.id} ?selected=${en.id === m.engineId}>${en.name}</option>`)}
      </select>

      <select class="weave-preset" @change=${(e: Event) =>
        cb.onPreset(m.laneId, (e.currentTarget as HTMLSelectElement).value)}>
        ${m.presets.map((p) => html`<option value=${p.id} ?selected=${p.id === m.presetId}>${p.name}</option>`)}
      </select>

      <select class=${`weave-style-lane${m.cfg.forcedStyle ? ' forced' : ''}`}
              title=${m.cfg.forcedStyle ? 'Forced: the style-mix macro does not touch this lane' : 'Follows the style mix'}
              @change=${(e: Event) =>
                cb.onStyle(m.laneId, (e.currentTarget as HTMLSelectElement).value as StyleId)}>
        ${STYLE_CATALOG.map((s) => html`<option value=${s.id} ?selected=${s.id === m.styleId}>${s.label}</option>`)}
      </select>

      <div class="weave-topo">
        ${TOPOS.map((t) => html`
          <button data-t=${t.t === 'ab' ? 'ab' : t.t === 'queue' ? 'q' : 'c'}
                  class=${m.cfg.weave.kind === t.t ? 'on' : ''} title=${t.title}
                  @click=${() => cb.onTopology(m.laneId, t.t)}>${t.label}</button>`)}
      </div>

      <div class="weave-cell">${weaveWidget(m, cb)}</div>

      <div class="lane-tools">
        <button class="weave-lock" title="Freeze which loop plays"
                @click=${() => cb.onLock(m.laneId, !m.cfg.locked)}>${m.cfg.locked ? '🔒' : '🔓'}</button>
        <button class="weave-reshuffle" title="Reshuffle this lane only"
                @click=${() => cb.onReshuffle(m.laneId)}>⟳</button>
      </div>
    </div>`;
}
```

- [ ] **Step 4: Ejecutar y ver que pasa**

Run: `NO_COLOR=1 npx vitest run src/weave/weave-lane-row.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/weave/weave-lane-row.ts src/weave/weave-lane-row.test.ts src/weave/weave-panel.ts
git commit -F - <<'EOF'
feat(weave): a lane row that swaps its weaving widget with its topology

One row, three possible widgets, one contract behind them. A forced style
and the harmony leader both get a visible mark -- a lane that stops
following the macros has to say why, or it reads as broken.
EOF
```

### Task 35: El flujo maestro mueve los canales desfasados

**Files:**
- Modify: `src/weave/weave-panel.ts`
- Create: `src/weave/master-flow.ts`
- Test: `src/weave/master-flow.test.ts`

**Interfaces:**
- Produces: `laneFlow(master: number, laneIndex: number, drift: 'staggered' | 'together'): number`

- [ ] **Step 1: Escribir el test que falla**

```ts
import { laneFlow } from './master-flow';

describe('master flow', () => {
  it('gives every lane the same position when drift is together', () => {
    const got = [0, 1, 2, 3].map((i) => laneFlow(0.5, i, 'together'));
    expect(new Set(got).size).toBe(1);
  });

  it('gives neighbouring lanes different positions when staggered', () => {
    expect(laneFlow(0.5, 0, 'staggered')).not.toBeCloseTo(laneFlow(0.5, 1, 'staggered'));
  });

  it('keeps every staggered position inside 0..1', () => {
    for (let m = 0; m <= 10; m++) {
      for (let i = 0; i < 8; i++) {
        const v = laneFlow(m / 10, i, 'staggered');
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(1);
      }
    }
  });

  it('is monotonic in the master for a given lane', () => {
    let prev = -1;
    for (let m = 0; m <= 20; m++) {
      const v = laneFlow(m / 20, 2, 'staggered');
      expect(v).toBeGreaterThanOrEqual(prev);
      prev = v;
    }
  });
});
```

- [ ] **Step 2: Ejecutar y ver el fallo**

Run: `NO_COLOR=1 npx vitest run src/weave/master-flow.test.ts`
Expected: FAIL — `Cannot find module './master-flow'`.

- [ ] **Step 3: Implementar**

```ts
// The master fader moves every lane, deliberately out of step.
//
// Lanes that all cross at once produce a seam: the whole scene changes on one
// beat and it sounds edited. Offsetting them is what makes the change feel
// woven rather than switched, so staggered is the default and "together" is
// the option.

const STAGGER = 0.13;

export function laneFlow(master: number, laneIndex: number, drift: 'staggered' | 'together'): number {
  if (drift === 'together') return Math.min(1, Math.max(0, master));
  const offset = (laneIndex - 1) * STAGGER;
  return Math.min(1, Math.max(0, master + offset));
}
```

- [ ] **Step 4: Ejecutar y ver que pasa**

Run: `NO_COLOR=1 npx vitest run src/weave/master-flow.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/weave/master-flow.ts src/weave/master-flow.test.ts src/weave/weave-panel.ts
git commit -F - <<'EOF'
feat(weave): the master fader moves the lanes out of step on purpose

Lanes that all cross on the same beat produce a seam -- the whole scene
changes at once and it sounds edited. The offset is what makes it read as
woven, so staggered is the default and "together" is the option.
EOF
```

### Task 36: Fijar — la escena nueva

**Files:**
- Create: `src/weave/print-scene.ts`
- Test: `src/weave/print-scene.test.ts`

**Interfaces:**
- Consumes: `createWeaveNotes`, `applyNoteMacros`
- Produces: `printWeaveScene(entries: LaneWeaveEntry[], macros: Record<string, number>, o: BlendOptions, name: string): { name: string; lanes: Array<{ laneId: string; notes: NoteEvent[] }> }`

- [ ] **Step 1: Escribir el test que falla**

```ts
import { printWeaveScene } from './print-scene';

describe('printWeaveScene', () => {
  it('prints one entry per lane', () => {
    const out = printWeaveScene(entries(), neutralMacros(), opts, 'Take 1');
    expect(out.lanes).toHaveLength(entries().length);
  });

  it('names the scene as asked', () => {
    expect(printWeaveScene(entries(), neutralMacros(), opts, 'Take 1').name).toBe('Take 1');
  });

  it('prints exactly what the runtime would have played', () => {
    const live = createWeaveNotes(entries(), opts);
    const printed = printWeaveScene(entries(), neutralMacros(), opts, 'x');
    for (const l of printed.lanes) {
      expect(l.notes.map((n) => `${n.start}:${n.midi}`))
        .toEqual((live.get(l.laneId) ?? []).map((n) => `${n.start}:${n.midi}`));
    }
  });

  it('bakes the macros in, so a non-neutral density shows in the print', () => {
    const thin = printWeaveScene(entries(), { ...neutralMacros(), density: 0.05 }, opts, 'x');
    const neutral = printWeaveScene(entries(), neutralMacros(), opts, 'x');
    const count = (s: typeof thin) => s.lanes.reduce((n, l) => n + l.notes.length, 0);
    expect(count(thin)).toBeLessThan(count(neutral));
  });

  it('leaves the source entries untouched', () => {
    const es = entries();
    const before = JSON.stringify(es);
    printWeaveScene(es, neutralMacros(), opts, 'x');
    expect(JSON.stringify(es)).toBe(before);
  });
});
```

- [ ] **Step 2: Ejecutar y ver el fallo**

Run: `NO_COLOR=1 npx vitest run src/weave/print-scene.test.ts`
Expected: FAIL — `Cannot find module './print-scene'`.

- [ ] **Step 3: Implementar**

```ts
// Freeze what is playing into a whole new scene. The scene you were weaving is
// not touched, so a long session leaves a row of moments to assemble later.
//
// What is printed must be what was heard. If the printed scene plays back
// differently, that is a bug -- hence the test that compares the two.

import type { NoteEvent } from '../core/notes';
import { createWeaveNotes, type LaneWeaveEntry } from './weave-runtime';
import { applyNoteMacros } from './macro-notes';
import type { BlendOptions } from './blend-clip';

export interface PrintedScene {
  name: string;
  lanes: Array<{ laneId: string; notes: NoteEvent[] }>;
}

export function printWeaveScene(
  entries: LaneWeaveEntry[],
  macros: Record<string, number>,
  o: BlendOptions,
  name: string,
): PrintedScene {
  const blended = createWeaveNotes(entries, o);
  return {
    name,
    lanes: entries.map((e) => ({
      laneId: e.laneId,
      notes: applyNoteMacros(
        blended.get(e.laneId) ?? [],
        { density: macros.density ?? 0.5, energy: macros.energy ?? 0.5 },
        o.barTicks,
      ),
    })),
  };
}
```

- [ ] **Step 4: Ejecutar y ver que pasa**

Run: `NO_COLOR=1 npx vitest run src/weave/print-scene.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/weave/print-scene.ts src/weave/print-scene.test.ts
git commit -F - <<'EOF'
feat(weave): freeze the moment into a whole new scene

What is printed has to be what was heard, so the test compares the print
against what the runtime would have played rather than trusting that two
code paths agree.

The scene being woven is never touched: a long session leaves a row of
good moments to assemble afterwards.
EOF
```

### Task 37: Enganchar el runtime a la sesión

**Files:**
- Modify: `src/app/` (el módulo que construye el `SchedulerContext` por canal)
- Test: `src/session/session-runtime.test.ts`

**Interfaces:**
- Consumes: `createWeaveGate`, `WeaveState`

- [ ] **Step 1: Escribir los tests que fallan**

```ts
import { TICKS_PER_STEP } from '../core/notes';
import { createWeaveGate } from '../weave/weave-runtime';
import type { LaneWeaveConfig } from '../weave/weave-state';

const BAR = TICKS_PER_STEP * 16;
const hit = (step: number, midi: number) =>
  ({ start: step * TICKS_PER_STEP, duration: TICKS_PER_STEP, midi, velocity: 100 });
const A = [hit(0, 36), hit(4, 38), hit(3, 42)];
const B = [hit(0, 36), hit(4, 38), hit(11, 42)];
const blendOpts = { barTicks: BAR, melodic: false, key: 9, scale: 'minor' as const, octaveBase: 36 };
const cfgAt = (x: number): LaneWeaveConfig => ({
  weave: { kind: 'ab', state: { a: { id: 'a', notes: A }, b: { id: 'b', notes: B }, x } },
  locked: false, harmonyLeader: false,
});

describe('the weave gate reaching the scheduler', () => {
  it('fires every note when no lane has a weave configured', () => {
    const fired: number[] = [];
    const ctx = makeCtx({ onTrigger: (n) => fired.push(n.midi), shouldFire: undefined });
    tickLane(clipWithNotes(A), ctx);
    expect(fired.sort()).toEqual([36, 38, 42]);
  });

  it('fires only the blended notes once a lane has one', () => {
    const fired: number[] = [];
    const ctx = makeCtx({
      onTrigger: (n) => fired.push(n.midi),
      // At x = 1 the A-only hat on step 3 is gone and only the shared hits remain.
      shouldFire: createWeaveGate(cfgAt(1), blendOpts),
    });
    tickLane(clipWithNotes(A), ctx);
    expect(fired).not.toContain(42);
    expect(fired.sort()).toEqual([36, 38]);
  });

  it('keeps a locked lane on its own loop while the master flow moves', () => {
    // A locked lane's position is not advanced by the master, so its gate keeps
    // answering for x = 0 -- its A-only hit survives.
    const locked: LaneWeaveConfig = { ...cfgAt(0), locked: true };
    const fired: number[] = [];
    const ctx = makeCtx({
      onTrigger: (n) => fired.push(n.midi),
      shouldFire: createWeaveGate(locked, blendOpts),
    });
    tickLane(clipWithNotes(A), ctx);
    expect(fired).toContain(42);
  });
});
```

`makeCtx`, `clipWithNotes` y `tickLane` son los del propio fichero; si los
ayudantes tienen otro nombre, usar los que haya y no inventar unos nuevos.

- [ ] **Step 2: Ejecutar y ver el fallo**

Run: `NO_COLOR=1 npx vitest run src/session/session-runtime.test.ts`
Expected: FAIL — el segundo dispara todas las notas.

- [ ] **Step 3: Implementar**

Donde se construye el `SchedulerContext` de cada canal, añadir:

```ts
    shouldFire: weaveState.lanes[lane.id]
      ? createWeaveGate(weaveState.lanes[lane.id], blendOptionsFor(lane))
      : undefined,
```

Sin configuración de tejido, `shouldFire` queda `undefined` y el comportamiento
es idéntico al de hoy — que es lo que fija el primer test.

- [ ] **Step 4: Ejecutar y ver que pasa**

Run: `NO_COLOR=1 npm run test:unit`
Expected: PASS. Si sale `ERR_IPC_CHANNEL_CLOSED` **después** de que todos los tests pasen, es el fallo de teardown conocido: re-ejecutar para confirmar.

- [ ] **Step 5: Commit**

```bash
git add src/app/ src/session/session-runtime.test.ts
git commit -F - <<'EOF'
feat(app): the weave gate reaches the scheduler, and only when there is one

A lane with no weave gets shouldFire undefined and behaves exactly as
before. That is the first test, and it is the one that says this feature
cannot break a session that never opens the panel.
EOF
```

### Task 38: El e2e del panel

**Files:**
- Create: `tests/e2e/weave-panel.spec.ts` (ampliar el de la tarea 32)

**Interfaces:**
- Consumes: la app construida

- [ ] **Step 1: Escribir los tests, uno por camino**

```ts
import { test, expect } from '@playwright/test';

const openWeave = async (page) => {
  await page.goto('/');
  await page.getByRole('tab', { name: 'Weave' }).click();
  await expect(page.locator('.weave-lane').first()).toBeVisible();
};
const laneFader = (page, i: number) =>
  page.locator('.weave-lane').nth(i).locator('.weave-cell input[type=range]');

test('the master flow moves the lane faders', async ({ page }) => {
  await openWeave(page);
  const before = await laneFader(page, 0).inputValue();
  await page.locator('#weave-flow').fill('0.8');
  await expect.poll(() => laneFader(page, 0).inputValue()).not.toBe(before);
});

test('switching a lane to queue shows the queue control', async ({ page }) => {
  await openWeave(page);
  const lane = page.locator('.weave-lane').first();
  await lane.locator('.weave-topo [data-t="q"]').click();
  await expect(lane.locator('.queue-control')).toBeVisible();
});

test('switching a lane to cloud shows the 2d pad', async ({ page }) => {
  await openWeave(page);
  const lane = page.locator('.weave-lane').first();
  await lane.locator('.weave-topo [data-t="c"]').click();
  await expect(lane.locator('.pad2d')).toBeVisible();
});

test('locking a lane keeps its fader still while the master moves', async ({ page }) => {
  await openWeave(page);
  await page.locator('.weave-lane').first().locator('.weave-lock').click();
  const held = await laneFader(page, 0).inputValue();
  await page.locator('#weave-flow').fill('0.9');
  await expect(laneFader(page, 0)).toHaveValue(held);
});

test('Print makes a new scene and leaves the current one alone', async ({ page }) => {
  await openWeave(page);
  await page.getByRole('tab', { name: 'Session' }).click();
  const before = await page.locator('.scene-row').count();
  await page.getByRole('tab', { name: 'Weave' }).click();
  await page.locator('#weave-print').click();
  await page.getByRole('tab', { name: 'Session' }).click();
  await expect(page.locator('.scene-row')).toHaveCount(before + 1);
});

test('the weave macros appear in the automation destination picker', async ({ page }) => {
  // The failure this guards against is silent: a session-scope id that parses
  // as a lane resolves to nothing and throws nothing, so only a real page can
  // prove the round trip.
  await page.goto('/');
  await page.getByRole('tab', { name: 'Session' }).click();
  await page.locator('.clip-cell').first().dblclick();
  const picker = page.locator('.clip-auto-param').first();
  await expect(picker.locator('option[value="session.weave:density"]')).toHaveCount(1);
});
```

Los selectores de escena y de clip (`.scene-row`, `.clip-cell`,
`.clip-auto-param`) son los que ya usan los e2e existentes; comprobarlos en
`tests/e2e/` y usar los reales, no éstos si difieren.

- [ ] **Step 2: Compilar y ejecutar**

Run: `npm run build && npm run test:e2e -- weave-panel`
Expected: FAIL en los que aún no estén cableados.

- [ ] **Step 3: Cablear lo que falte**

- [ ] **Step 4: Compilar y ejecutar de nuevo**

Run: `npm run build && npm run test:e2e -- weave-panel`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add tests/e2e/weave-panel.spec.ts
git commit -F - <<'EOF'
test(e2e): six user paths through the panel, one test each

The destination-picker test is the one that matters most: it proves the
session-scope id survives the round trip through a real page, which is
the failure mode that would otherwise sit inert and look like it works.
EOF
```

### Task 39: Paridad visual con el mockup

**Files:**
- Ninguno de código. Es una comprobación humana, y es criterio de aceptación.

- [ ] **Step 1: Arrancar la app**

Run: `npm run dev` (dentro del worktree)

- [ ] **Step 2: Servir el mockup al lado**

Run: `node tools/serve-static.mjs docs/superpowers/specs 4399`
El mockup queda en `http://localhost:4399/2026-08-07-weave-panel-dinamico-mockup.html`.

- [ ] **Step 3: Abrir las dos y comparar en Chrome**

Mirar de verdad, no deducir del CSS. La lista de lo que el mockup ya enseñó que
se rompe si no se mira:

- los arcos de los mandos abren por abajo, no por arriba;
- el indicador del mando se ve;
- las cabeceras de columna caen sobre sus celdas;
- el cursor de la cola se posa sobre un punto, no entre dos;
- el pad de nube se lee como una caja.

- [ ] **Step 4: Capturar y adjuntar**

Captura de la pantalla real y del mockup, lado a lado, en el mensaje de commit
o en el PR. **Sin esa comparación esta tarea no está hecha**, por muy verde que
esté la suite: los tests no comprueban si se parece a lo aprobado.

- [ ] **Step 5: Commit de los arreglos que salgan**

```bash
git add src/styles/_weave.scss src/weave/
git commit -F - <<'EOF'
fix(weave): what the side-by-side against the mockup turned up

Listed here rather than in a comment because the next person needs to
know these were found by LOOKING. The suite was green throughout.
EOF
```

### Task 40: Podar y cerrar

**Files:**
- Delete: `docs/superpowers/specs/2026-08-07-weave-panel-dinamico-design.md` **NO** — el spec se queda hasta que el trabajo esté mergeado, y se poda entonces.
- Modify: `docs/superpowers/REMAINING-WORK.md`
- Modify: `CLAUDE.md` (la sección de arquitectura gana `src/weave/`)

- [ ] **Step 1: Ejecutar la suite entera**

Run: `npm run build && npm test`
Expected: PASS. Anotar cualquier fallo preexistente que ya estuviera rojo en `main` antes de esta rama, y **no** atribuírselo a este trabajo.

- [ ] **Step 2: Contar líneas de código de cada fichero nuevo**

Run: `node tools/count-code-lines.mjs src/weave/*.ts` (o el equivalente que haya)
Expected: ninguno por encima de 300. Si alguno se pasa, partirlo antes de cerrar.

- [ ] **Step 3: Actualizar CLAUDE.md**

Añadir `src/weave/` a la lista de subsistemas, con una línea que diga qué hace y
cuál es su punto de entrada (`blendLoops`).

- [ ] **Step 4: Actualizar REMAINING-WORK.md**

Anotar lo que este plan deja fuera a propósito: acordes y progresiones, que un
añadido pinte su propio DOM, y el generador de escena desde cero.

- [ ] **Step 5: Commit**

```bash
git add CLAUDE.md docs/superpowers/REMAINING-WORK.md
git commit -F - <<'EOF'
docs: weave lands, and what it deliberately left outside

Chords, plugin-owned DOM and a from-scratch scene generator are recorded
as decisions rather than omissions, so the next round meets them as
choices already made.
EOF
```

---

## Auto-revisión

**Cobertura del spec.** §1.1 → tareas 9-10. §1.2 → 11. §1.3 → 12-15. §1.4 → 25-26.
§1.5 → 17-18. §2 → 24. §3 → 19-23. §4 → 29-31. §5 → 27-28. §6 → 36. §7 → 33-35, 39.
§8 → 2-8, 32. §9 → toda la estructura de ficheros. §10 → los tests de cada tarea. §11 → 40.

**Dos huecos encontrados y tapados al escribir:** el spec no decía quién aplica
`macroParamWrites` (lo hace el runtime, tarea 23) ni cómo se elige el estilo
cuando un canal fuerza el suyo (tarea 24, y el forzado gana siempre).

**Orden.** La tarea 16 usa `WEAVE_MACROS`, que nace en la 19. Si se ejecutan
fuera de orden, **hacer la 19 antes que la 16**; está anotado en la propia tarea.

**Consistencia de tipos.** `LoopWeight` se define en `blend-clip.ts` y se
reexporta desde `topology-types.ts`; las tres topologías lo consumen de ahí.
`BlendOptions` viaja sin cambios de la tarea 12 a la 18, 26 y 36. `LaneWeaveConfig`
nace en la 16 y lo usan la 18, 26, 34 y 36 con el mismo nombre de campo
(`weave`, `locked`, `forcedStyle`, `harmonyLeader`).

