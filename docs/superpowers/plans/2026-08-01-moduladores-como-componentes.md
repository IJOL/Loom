# Rebanada B — moduladores como componentes: plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task.
> Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** que un modulador que el core no conoce se suelte en un directorio, se
cargue de disco, module un filtro y se oiga — en vivo y en el render offline.

**Spec:** [2026-08-01-moduladores-como-componentes-design.md](../specs/2026-08-01-moduladores-como-componentes-design.md).
Léelo antes de la tarea 1. Sus §2 (hechos verificados) y §3 (diseño) son
vinculantes; este plan sólo los ejecuta.

**Architecture:** un modulador deja de ser una cadena sobre la que se hace
`switch` y pasa a ser un componente registrado en dos registros: el del hilo
principal (declaración, estado por defecto, mandos, voz de Web Audio) y el del
worklet (kernel por muestra). El ADSR conserva intacto su camino de envolvente
por voz; sólo cambia su declaración.

**Tech Stack:** TypeScript, Vite, lit-html, AudioWorklet, Vitest, Playwright,
esbuild (el empaquetador de plugins, `tools/loom-plugin/cli.mjs`).

## Global Constraints

Vinculan a TODAS las tareas.

- **Todo el código va en inglés**: identificadores, comentarios, nombres de test.
  Los bloques de código de este plan ya están en inglés — cópialos tal cual. Un
  comentario que ya esté en inglés **nunca** se traduce.
- **Los mensajes de commit van en inglés**, escritos con heredoc de bash
  (`git commit -F - <<'EOF'`), nunca con here-string de PowerShell.
- **No se cambia la forma de los campos existentes de `ModulatorState`.** Lo
  único que se añade es `params?: Record<string, number>` (tarea 8). Ningún
  campo se mueve, se renombra ni cambia de significado.
- **No se toca el DSP del ADSR** — su envolvente por voz (`getAdsrMods` →
  `ModEnvHost` → renderer) es la envolvente de amplitud del Subtractive. Sólo
  cambia su declaración.
- **Aserciones siempre relativas** (ratios, comparaciones), nunca umbrales
  absolutos. Si escribes uno, justifícalo en un comentario.
- Al final de cada tarea: `npx tsc --noEmit` en 0, `npm run test:unit` verde y
  `npm run build` en 0. `build:plugins` recorre `plugins/*` con un glob — nunca
  lo sustituyas por un nombre a mano.
- Un test se ejecuta así: `NO_COLOR=1 npx vitest run <ruta>`. No añadas
  `--reporter=...`.
- Commit al final de cada tarea. Después del commit, `git rebase main`.

---

## Estructura de ficheros

**Nuevos:**

| fichero | responsabilidad |
| --- | --- |
| `src/modulation/modulator-registry.ts` | el registro del hilo principal: `ModulatorComponent`, `registerModulator`, `getModulator`, `listModulators` |
| `src/audio-dsp/modulator-kernels.ts` | el registro del worklet: `ModulatorKernel`, `registerModulatorKernel`, `getModulatorKernel` |
| `src/audio-dsp/modulators/lfo-kernel.ts` | la matemática de onda del LFO, salida de `modulation-runtime.ts` |
| `plugins/sh/plugin.json` · `main.ts` · `dsp.ts` | el plugin Sample & Hold |

**Modificados de fondo:**

| fichero | qué le pasa |
| --- | --- |
| `src/plugins/modulators/lfo.ts` | de stub de 29 líneas a **el componente LFO**: declaración, `defaultState`, `configTemplate` (venida de `mod-config-templates.ts`) y `createVoice` |
| `src/plugins/modulators/adsr.ts` | lo mismo para el ADSR |
| `src/modulation/mod-config-templates.ts` | **se borra**: sus dos plantillas se van a sus componentes |
| `src/modulation/types.ts` | pierde `makeDefaultLFO`/`makeDefaultADSR`/`defaultScopeFor`; gana el cajón `params` |
| `src/audio-dsp/modulation-runtime.ts` | deja de comparar `kind`; busca el kernel |
| `src/engines/worklet-lane-engine.ts` | `toModLite` deja de colapsar el `kind` y pasa el cajón |
| `src/modulation/modulation-host.ts` · `modulation-ui.ts` | leen el registro |
| `src/plugin-host/loom-api.ts` | `adoptComponent` reparte por `kind`; la ABI gana la puerta del kernel |
| `packages/loom-plugin-sdk/src/manifest.ts` | `ComponentManifest` gana el miembro `kind: 'modulator'` |

`src/modulation/lfo-voice.ts`, `adsr-voice.ts`, `rate-sync.ts`, `waveform.ts` y
`adsr-curve.ts` **no se mueven**: pasan a ser la implementación privada de sus
componentes. Mover ficheros con muchos importadores sólo añade ruido al diff.

---

### Task 1: La red de seguridad — las envolventes del Subtractive y del Westcoast

Va la primera y **no cambia nada de producción**. Fija por escrito que el ADSR
por defecto de esos dos motores modela la amplitud y el filtro. Si cualquier
tarea posterior lo rompe, salta aquí.

**Files:**
- Create: `src/audio-dsp/default-envelopes.dsp.test.ts`

**Interfaces:**
- Consumes: `SUBTRACTIVE_DEFAULT_MODULATORS` (`src/engines/subtractive.ts`),
  `WESTCOAST_DEFAULT_MODULATORS` (`src/engines/westcoast.ts`),
  `renderKernelLane`-style rendering vía `VoiceManager` (mira cómo lo hace
  `src/audio-dsp/modulation-pipeline.test.ts`, que ya renderiza cada motor por
  el camino real).
- Produces: nada. Es una red, no una API.

- [ ] **Step 1: Read the reference test**

Lee `src/audio-dsp/modulation-pipeline.test.ts` entero. Renderiza cada motor por
el camino REAL (`ModulationRuntime` → `VoiceManager` → renderer) y es el patrón a
copiar. No inventes un arnés nuevo.

- [ ] **Step 2: Write the characterisation test**

```ts
// src/audio-dsp/default-envelopes.dsp.test.ts
// The amp and filter envelopes of Subtractive and Westcoast ARE ADSR
// modulators (adsr-amp → 'amp', adsr-filter → 'filter.env'). This test pins
// that down BEFORE the modulator refactor touches anything, so a regression
// surfaces here instead of as "the synth went quiet".
//
// Shape assertions only, all relative: an envelope that attacks, decays to a
// sustain and releases towards silence. No absolute magnitudes — the point is
// the SHAPE, and absolute levels drift with unrelated gain work.
```

Escribe, por cada uno de los dos motores, un test que:
1. Renderice una nota larga (p. ej. 1.5 s a 44100) con los modificadores por
   defecto del motor.
2. Trocee la salida en ventanas y calcule el RMS de cada ventana.
3. Afirme, con ratios:
   - el RMS de la ventana del ataque es **menor** que el del pico posterior;
   - tras el pico, el RMS **baja** hasta una meseta (sustain): la última ventana
     antes del note-off es menor que el pico y mayor que cero;
   - tras el note-off el RMS **cae** por debajo de una fracción de la meseta.
4. Un control negativo por motor: con el modulador de amplitud **deshabilitado**
   (`enabled: false`), la envolvente medida es distinta de la del caso normal.

Nombra los tests en inglés, p. ej.
`'subtractive: the default amp ADSR shapes the note (attack → sustain → release)'`.

- [ ] **Step 3: Run it and see it PASS against today's code**

```bash
NO_COLOR=1 npx vitest run src/audio-dsp/default-envelopes.dsp.test.ts
```

Expected: PASS. Es una red sobre código que funciona, no TDD — si sale en rojo,
**para**: o la red está mal escrita o hay un problema previo. Repórtalo antes de
seguir.

- [ ] **Step 4: Commit**

```bash
git add src/audio-dsp/default-envelopes.dsp.test.ts
git commit -F - <<'EOF'
test(modulation): pin the Subtractive and Westcoast default envelopes

Their amp and filter envelopes ARE ADSR modulators, so the modulator
refactor could silence them. Shape assertions, all relative, green against
the current code: this is a safety net, not TDD.
EOF
git rebase main
```

---

### Task 2: Los dos registros, con LFO y ADSR dentro y nadie leyéndolos

**Files:**
- Create: `src/modulation/modulator-registry.ts`
- Create: `src/modulation/modulator-registry.test.ts`
- Create: `src/audio-dsp/modulator-kernels.ts`
- Modify: `src/plugins/modulators/lfo.ts`, `src/plugins/modulators/adsr.ts`

**Interfaces:**
- Produces: `ModulatorComponent`, `registerModulator(c)`, `getModulator(id)`,
  `listModulators()`, `__resetModulators()` (sólo test);
  `ModulatorKernel`, `registerModulatorKernel(k)`, `getModulatorKernel(id)`.

- [ ] **Step 1: Write the failing test**

```ts
// src/modulation/modulator-registry.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import {
  registerModulator, getModulator, listModulators, __resetModulators,
} from './modulator-registry';

const stub = (id: string) => ({
  id, name: id.toUpperCase(), driver: 'time' as const,
  scopes: ['shared' as const, 'per-voice' as const],
  idPrefix: id,
  defaultState: (instanceId: string) => ({
    id: instanceId, kind: id, enabled: true, connections: [], scope: 'shared' as const,
  }),
  createVoice: () => { throw new Error('not used in this test'); },
});

describe('modulator registry', () => {
  beforeEach(() => __resetModulators());

  it('answers a registered component by id', () => {
    registerModulator(stub('sh'));
    expect(getModulator('sh')?.name).toBe('SH');
  });

  it('answers undefined for an unknown id instead of guessing', () => {
    expect(getModulator('nope')).toBeUndefined();
  });

  it('lists components in registration order', () => {
    registerModulator(stub('a'));
    registerModulator(stub('b'));
    expect(listModulators().map((c) => c.id)).toEqual(['a', 'b']);
  });

  it('the first declared scope is the default — there is no defaultScope field', () => {
    registerModulator(stub('sh'));
    expect(getModulator('sh')!.scopes[0]).toBe('shared');
  });
});
```

- [ ] **Step 2: Run it to make sure it fails**

```bash
NO_COLOR=1 npx vitest run src/modulation/modulator-registry.test.ts
```

Expected: FAIL — `Cannot find module './modulator-registry'`.

- [ ] **Step 3: Write the registry**

```ts
// src/modulation/modulator-registry.ts
// The one door for "what is this modulator and what can it do". A modulator
// kind is a REGISTERED COMPONENT, never a string the core compares against.
// When a plugin can register one (Task 9) this same function answers from the
// manifest instead, and no caller notices.
import type { TemplateResult } from 'lit-html';
import type { ModulatorState, ModulatorScope, ModulatorVoice } from './types';
import type { EngineParamSpec } from '../engines/engine-params';
import type { PanelCtx } from './mod-ui-shared';

export interface ModulatorComponent {
  id: string;
  name: string;
  /** What drives the value. 'time' runs off the clock (LFO, S&H) and travels
   *  the worklet's per-sample offset sum; 'gate' is driven by the note (ADSR)
   *  and travels the renderer's per-voice envelope road instead. */
  driver: 'time' | 'gate';
  /** Scopes this modulator supports. The FIRST is the default for a new
   *  instance; there is deliberately no separate defaultScope field. */
  scopes: ModulatorScope[];
  /** Prefix for generated instance ids ('lfo' → lfo1, lfo2…). */
  idPrefix: string;
  defaultState(id: string): ModulatorState;
  /** Settings the host renders when the component brings no template of its
   *  own. A plugin can only take this route: its compiled main.js cannot
   *  import our bundled lit-html. */
  params?: EngineParamSpec[];
  /** Optional hand-built config row, for a panel the generic grid cannot
   *  express. The LFO has one by legacy, not by rule. */
  configTemplate?(mod: ModulatorState, ctx: PanelCtx): TemplateResult;
  createVoice(
    ctx: AudioContext,
    opts: { state: ModulatorState; bpm: () => number },
  ): ModulatorVoice;
}

const components = new Map<string, ModulatorComponent>();

export function registerModulator(c: ModulatorComponent): void {
  components.set(c.id, c);
}

export function getModulator(id: string): ModulatorComponent | undefined {
  return components.get(id);
}

export function listModulators(): ModulatorComponent[] {
  return [...components.values()];
}

/** Test-only. */
export function __resetModulators(): void {
  components.clear();
}
```

```ts
// src/audio-dsp/modulator-kernels.ts
// The worklet half of the modulator door. A kernel is per-sample maths and
// nothing else — no DOM, no AudioContext — so it runs unchanged inside the
// AudioWorklet and on the main thread for the offline render.
import type { ModLite } from './modulation-runtime';

export interface ModulatorKernel {
  id: string;
  /** Normalised signal at absolute time `t`: -1..+1 when bipolar, 0..1 when
   *  unipolar. `origin` is the phase origin the runtime already resolved for
   *  this modulator (shared/free = 0, note = last note-on, voice = that
   *  voice's start).
   *
   *  MUST be pure: same inputs, same output. The offline render calls it in a
   *  different order from the live one, so a kernel holding mutable state
   *  would make an export sound different from what you heard. */
  valueAt(m: ModLite, t: number, origin: number): number;
}

const kernels = new Map<string, ModulatorKernel>();

export function registerModulatorKernel(k: ModulatorKernel): void {
  kernels.set(k.id, k);
}

export function getModulatorKernel(id: string): ModulatorKernel | undefined {
  return kernels.get(id);
}

/** Test-only. */
export function __resetModulatorKernels(): void {
  kernels.clear();
}
```

- [ ] **Step 4: Register LFO and ADSR as components (nobody reads them yet)**

En `src/plugins/modulators/lfo.ts`, **conserva** el `lfoPlugin` que ya existe
(todavía lo usa el registro de plugins) y **añade** al final del fichero:

```ts
registerModulator({
  id: 'lfo',
  name: 'LFO',
  driver: 'time',
  scopes: ['shared', 'per-voice'],
  idPrefix: 'lfo',
  defaultState: (id) => makeDefaultLFO(id),
  configTemplate: (mod, ctx) => lfoConfigTemplate(mod, ctx),
  createVoice: (ctx, { state, bpm }) => new LFOVoice(ctx, state, bpm),
});
```

Igual en `adsr.ts` con `driver: 'gate'`, `scopes: ['per-voice']`,
`idPrefix: 'adsr'`, `makeDefaultADSR` y `adsrConfigTemplate`.

`plugin-bootstrap` importa `src/plugins/modulators/*` de forma **eager**, así que
la llamada a `registerModulator` en el ámbito del módulo se ejecuta sola. Su
comprobación por forma sólo decide si además lo registra como `PluginFactory`;
no impide el import.

- [ ] **Step 5: Run the tests**

```bash
NO_COLOR=1 npx vitest run src/modulation/modulator-registry.test.ts
npx tsc --noEmit
```

Expected: PASS y 0 errores. Nada de producción ha cambiado de comportamiento.

- [ ] **Step 6: Commit**

```bash
git add src/modulation/modulator-registry.ts src/modulation/modulator-registry.test.ts src/audio-dsp/modulator-kernels.ts src/plugins/modulators/lfo.ts src/plugins/modulators/adsr.ts
git commit -F - <<'EOF'
feat(modulation): two registries for modulator components and kernels

A modulator kind becomes a registered component instead of a string the core
compares against. LFO and ADSR register themselves; nothing reads the
registries yet, so behaviour is unchanged.
EOF
git rebase main
```

---

### Task 3: `ModulationRuntime` busca el kernel

**Files:**
- Create: `src/audio-dsp/modulators/lfo-kernel.ts`
- Modify: `src/audio-dsp/modulation-runtime.ts`
- Modify: `src/audio-worklet/loom-processor.ts` (import de efecto lateral)
- Modify: `src/export/kernel-lane-render.ts` (el mismo import, hilo principal)
- Test: `src/audio-dsp/modulation-runtime.test.ts` (ya existe; amplíalo)

**Interfaces:**
- Consumes: `registerModulatorKernel`, `getModulatorKernel` (tarea 2).
- Produces: `lfoKernel` registrado con id `'lfo'`.

- [ ] **Step 1: Write the failing test**

Añade a `src/audio-dsp/modulation-runtime.test.ts`:

```ts
it('ignores a modulator whose kind has no kernel instead of treating it as an LFO', () => {
  const rt = new ModulationRuntime(44100);
  rt.setMods([{
    id: 'x1', kind: 'no-such-kernel', enabled: true, rateHz: 4,
    waveform: 'sine', depthByParam: { 'filter.cutoff': 1 },
  } as never]);
  // A kind with no kernel contributes nothing. The old code compared against
  // 'lfo' and would have summed this one's sine.
  expect(rt.offsetFor('filter.cutoff' as never, 0.25)).toBe(0);
});
```

- [ ] **Step 2: Run it to make sure it fails**

```bash
NO_COLOR=1 npx vitest run src/audio-dsp/modulation-runtime.test.ts
```

Expected: FAIL — hoy el bucle filtra por `m.kind !== 'lfo'`, así que un
`'no-such-kernel'` también queda fuera **por accidente**; el test pasa por el
motivo equivocado. Para verlo fallar de verdad, escribe primero el caso positivo
del paso 3 y comprueba que un kernel registrado ajeno al `'lfo'` NO contribuye.

- [ ] **Step 3: Move the LFO wave maths into its kernel**

```ts
// src/audio-dsp/modulators/lfo-kernel.ts
// The LFO's per-sample maths, moved out of ModulationRuntime so the runtime
// stops knowing what an LFO is.
import { registerModulatorKernel } from '../modulator-kernels';
import type { ModLite } from '../modulation-runtime';

function wave(w: ModLite['waveform'], phase: number): number {
  switch (w) {
    case 'square':   return phase < 0.5 ? 1 : -1;
    case 'saw':      return phase * 2 - 1;
    case 'triangle': return phase < 0.5 ? phase * 4 - 1 : 3 - phase * 4;
    default:         return Math.sin(phase * 2 * Math.PI);
  }
}

registerModulatorKernel({
  id: 'lfo',
  valueAt(m, t, origin) {
    const dt = t - origin;
    const phase = dt <= 0 ? 0 : (dt * m.rateHz) % 1;
    const w = wave(m.waveform, phase);
    // Polarity: bipolar (default) swings -1..+1; unipolar maps to 0..1 so the
    // offset only pushes the target one way.
    return m.bipolar === false ? (w + 1) / 2 : w;
  },
});
```

- [ ] **Step 4: Make the runtime ask the registry**

En `modulation-runtime.ts`:
- borra `wave()` y `signal()`;
- `phaseOf`/`originFor` se quedan (el origen sigue siendo del runtime, no del
  kernel), pero `originFor` pasa a devolver el origen y el kernel recibe el
  número;
- los tres bucles (`offsetFor`, `activeOffsets`, `offsetsInto`) sustituyen
  `if (!m.enabled || m.kind !== 'lfo') continue;` por:

```ts
if (!m.enabled) continue;
const kernel = getModulatorKernel(m.kind);
if (!kernel) continue;
```

  y `signal(m, phaseOf(...))` por `kernel.valueAt(m, t, originFor(m, o))`;
- `setMods` cambia `m.kind === 'lfo'` por `getModulatorKernel(m.kind) !== undefined`;
- `getAdsrMods` **no se toca** (es el camino de puerta, §3.3 del spec).

- [ ] **Step 5: Side-effect import the kernel in both realms**

En `src/audio-worklet/loom-processor.ts`, junto a los imports de renderers:

```ts
import '../audio-dsp/modulators/lfo-kernel';
```

Y la misma línea en `src/export/kernel-lane-render.ts`, junto a
`import '../audio-dsp/subtractive-renderer';`. **Sin las dos, el LFO enmudece**
en un realm o en el otro — y `tsc` no lo detecta.

- [ ] **Step 6: Run the tests**

```bash
NO_COLOR=1 npx vitest run src/audio-dsp/modulation-runtime.test.ts src/audio-dsp/modulation-pipeline.test.ts src/audio-dsp/default-envelopes.dsp.test.ts
```

Expected: PASS los tres. El tercero es la red de la tarea 1.

- [ ] **Step 7: Commit**

```bash
git add src/audio-dsp/modulators/lfo-kernel.ts src/audio-dsp/modulation-runtime.ts src/audio-dsp/modulation-runtime.test.ts src/audio-worklet/loom-processor.ts src/export/kernel-lane-render.ts
git commit -F - <<'EOF'
feat(modulation): the worklet runtime looks up a kernel instead of comparing kinds

The LFO's wave maths moves into its own kernel, registered by side-effect
import in both realms (the worklet and the main thread, which runs the same
kernel for the offline render). A kind with no kernel now contributes
nothing instead of being ignored by accident.
EOF
git rebase main
```

---

### Task 4: `toModLite` deja de colapsar el `kind`

**Files:**
- Modify: `src/engines/worklet-lane-engine.ts`
- Modify: `src/audio-dsp/modulation-runtime.ts` (el tipo `ModLite`)
- Test: `src/engines/worklet-lane-engine.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
it('carries an unknown modulator kind through instead of turning it into an ADSR', () => {
  const mods = toModLite([{
    id: 'sh1', kind: 'sh', enabled: true, connections: [], scope: 'shared',
  } as never]);
  expect(mods[0].kind).toBe('sh');
});
```

- [ ] **Step 2: Run it to make sure it fails**

```bash
NO_COLOR=1 npx vitest run src/engines/worklet-lane-engine.test.ts
```

Expected: FAIL — `expected 'adsr' to be 'sh'`.

- [ ] **Step 3: Widen the type and stop collapsing**

En `modulation-runtime.ts`, `ModLite.kind` pasa de `'lfo' | 'adsr'` a `string`,
con el comentario:

```ts
  /** The modulator component's id. NOT a closed union: the runtime resolves it
   *  through the kernel registry, so a plugin's kind travels here untouched.
   *  It used to be 'lfo' | 'adsr', and toModLite coerced anything else into
   *  'adsr' — a third modulator silently became an envelope. */
  kind: string;
```

En `worklet-lane-engine.ts`, `toModLite` sustituye
`kind: m.kind === 'lfo' ? 'lfo' : 'adsr',` por `kind: m.kind,`.

- [ ] **Step 4: Run the tests**

```bash
NO_COLOR=1 npx vitest run src/engines/worklet-lane-engine.test.ts src/audio-dsp/modulation-runtime.test.ts
npx tsc --noEmit
```

`tsc` señalará todo sitio que asumía la unión cerrada. Arréglalos consultando el
registro de kernels, nunca comparando con `'lfo'`.

- [ ] **Step 5: Commit**

```bash
git add -u
git commit -F - <<'EOF'
fix(modulation): toModLite stops turning an unknown modulator into an ADSR

ModLite.kind was a closed union and any kind that was not 'lfo' became
'adsr'. A third modulator therefore arrived at the audio thread disguised as
an envelope. The kind now travels untouched and the runtime resolves it
through the kernel registry.
EOF
git rebase main
```

---

### Task 5: `ModulationHostImpl` lee el registro

**Files:**
- Modify: `src/modulation/modulation-host.ts`
- Modify: `src/modulation/types.ts` (borrar `makeDefaultLFO`, `makeDefaultADSR`,
  `defaultScopeFor`)
- Test: `src/modulation/modulation-host.test.ts`

**Interfaces:**
- Consumes: `getModulator` (tarea 2).
- Produces: `ModulationHostImpl.addModulator(kind)` funciona para cualquier id
  registrado; los siete motores que importaban `makeDefaultLFO`/`makeDefaultADSR`
  pasan a `getModulator('lfo')!.defaultState('lfo1')`.

- [ ] **Step 1: Write the failing test**

```ts
it('adds a modulator of any registered kind, not just lfo and adsr', () => {
  registerModulator(shStub);            // driver 'time', idPrefix 'sh'
  const host = new ModulationHostImpl([]);
  const fresh = host.addModulator('sh');
  expect(fresh.kind).toBe('sh');
  expect(fresh.id).toBe('sh1');
  expect(fresh.scope).toBe('shared');   // the first declared scope
});

it('refuses an unregistered kind instead of inventing an ADSR', () => {
  const host = new ModulationHostImpl([]);
  expect(() => host.addModulator('nope')).toThrow();
});
```

- [ ] **Step 2: Run it to make sure it fails**

```bash
NO_COLOR=1 npx vitest run src/modulation/modulation-host.test.ts
```

Expected: FAIL — hoy `addModulator` hace `kind === 'lfo' ? 'lfo' : 'adsr'` para
el prefijo y `kind === 'lfo' ? makeDefaultLFO(id) : makeDefaultADSR(id)` para el
estado, así que `'sh'` sale como un ADSR llamado `adsr1`.

- [ ] **Step 3: Rewrite addModulator and spawnVoiceFiltered**

```ts
  addModulator(kind: ModulatorKind): ModulatorState {
    const comp = getModulator(kind);
    if (!comp) throw new Error(`unknown modulator kind: ${kind}`);
    const used = new Set(this.modulators.filter((m) => m.kind === kind).map((m) => m.id));
    let n = 1;
    while (used.has(`${comp.idPrefix}${n}`)) n++;
    const fresh = comp.defaultState(`${comp.idPrefix}${n}`);
    this.modulators.push(fresh);
    return fresh;
  }
```

```ts
  spawnVoiceFiltered(
    ctx: AudioContext,
    bpm: () => number,
    predicate: (m: ModulatorState) => boolean,
  ): Map<string, ModulatorVoice> {
    const out = new Map<string, ModulatorVoice>();
    for (const m of this.modulators) {
      if (!m.enabled || !predicate(m)) continue;
      // Every modulator is built from its component with the LIVE state object,
      // so a rate or waveform edit reaches the running voice. The old code had
      // to special-case lfo/adsr because the plugin SPI could not receive
      // state at all.
      const comp = getModulator(m.kind);
      if (comp) out.set(m.id, comp.createVoice(ctx, { state: m, bpm }));
    }
    return out;
  }
```

Borra de `modulation-host.ts` los imports de `LFOVoice`, `ADSRVoice`,
`createInstance` y el ayudante `modulatorInstanceAsVoice`.

- [ ] **Step 4: Move the default factories into their components**

Borra `makeDefaultLFO`, `makeDefaultADSR` y `defaultScopeFor` de `types.ts`, y
lleva sus cuerpos a `src/plugins/modulators/lfo.ts` y `adsr.ts` como funciones de
módulo que su `defaultState` usa. Los siete ficheros que las importaban
(`subtractive.ts`, `fm.ts`, `wavetable.ts`, `westcoast.ts`, `tb303.ts`,
`drums-engine.ts`, `drums-worklet-engine.ts`, `sampler-worklet-engine.ts`) pasan
a `getModulator('lfo')!.defaultState('lfo1')`.

> ⚠️ Ese `!` sólo es seguro si el componente ya está registrado cuando se
> construye el descriptor del motor. Si el orden de módulos lo impide,
> **no** metas un fallback silencioso: haz que el descriptor construya sus
> modulators de forma perezosa (un getter), igual que `descriptor-engine.ts`
> hace con `editor`. Un `?? []` aquí deja motores sin envolvente.

- [ ] **Step 5: Run the tests**

```bash
NO_COLOR=1 npx vitest run src/modulation/ src/engines/ src/audio-dsp/default-envelopes.dsp.test.ts
npx tsc --noEmit
```

- [ ] **Step 6: Commit**

```bash
git add -u
git commit -F - <<'EOF'
refactor(modulation): the host builds modulators from the registry

addModulator and spawnVoiceFiltered stop switching on 'lfo'/'adsr' and ask
the component registry instead. makeDefaultLFO/makeDefaultADSR/defaultScopeFor
move into the components that own them.
EOF
git rebase main
```

---

### Task 6: El panel lee el registro; las plantillas se van a sus componentes

**Files:**
- Modify: `src/modulation/modulation-ui.ts`
- Delete: `src/modulation/mod-config-templates.ts`
- Modify: `src/plugins/modulators/lfo.ts`, `adsr.ts` (reciben las plantillas)
- Test: `src/modulation/modulation-ui.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
it('offers a + button for every registered modulator, not a hardcoded pair', () => {
  registerModulator(shStub);
  const host = document.createElement('div');
  renderModulatorsPanel(host, deps);
  const labels = [...host.querySelectorAll('.mod-panel-header button')]
    .map((b) => b.textContent?.trim());
  expect(labels).toContain('+ S&H');
});
```

- [ ] **Step 2: Run it to make sure it fails**

```bash
NO_COLOR=1 npx vitest run src/modulation/modulation-ui.test.ts
```

Expected: FAIL — sólo hay `+ LFO` y `+ ADSR`.

- [ ] **Step 3: Build the header from the registry**

```ts
      <div class="mod-panel-header">
        ${listModulators().map(
          (c) => html`<button class="rnd" @click=${add(c.id)}>+ ${c.name}</button>`,
        )}
      </div>
```

y en `modCardTemplate`, sustituye el ternario
`mod.kind === 'lfo' ? lfoConfigTemplate(...) : adsrConfigTemplate(...)` por:

```ts
        ${configRowFor(mod, ctx)}
```

con:

```ts
/** A component's own config row when it brings one; otherwise the panel the
 *  host builds from its declared params. A plugin can only take the second
 *  route — its compiled main.js cannot import our bundled lit-html. */
function configRowFor(mod: ModulatorState, ctx: PanelCtx): TemplateResult {
  const comp = getModulator(mod.kind);
  if (!comp) return html`<div class="mod-card-config">unknown modulator: ${mod.kind}</div>`;
  if (comp.configTemplate) return comp.configTemplate(mod, ctx);
  return genericModConfigTemplate(comp, mod, ctx);   // Task 8
}
```

En esta tarea `genericModConfigTemplate` todavía no existe: deja el segundo
`return` como `html``<div class="mod-card-config"></div>`` **con un `// TODO:
Task 8` explícito**, y la tarea 8 lo sustituye. No es un hueco escondido: hasta
la tarea 8 no hay ningún componente sin plantilla.

- [ ] **Step 4: Move the two templates into their components**

Corta `lfoConfigTemplate` y `adsrConfigTemplate` de `mod-config-templates.ts` a
`src/plugins/modulators/lfo.ts` y `adsr.ts`, y **borra**
`mod-config-templates.ts`. Comprueba que ningún otro fichero lo importaba:

```bash
grep -rn "mod-config-templates" src/
```

- [ ] **Step 5: Run the tests**

```bash
NO_COLOR=1 npx vitest run src/modulation/
npx tsc --noEmit
```

- [ ] **Step 6: Commit**

```bash
git add -A src/modulation src/plugins/modulators
git commit -F - <<'EOF'
refactor(modulation): the panel is built from the registry

The + buttons and each card's config row come from the registered components
instead of a hardcoded LFO/ADSR pair. mod-config-templates.ts is gone: each
template now lives with the component that owns it.
EOF
git rebase main
```

---

### Task 7: El SPI de modulador recibe el estado

**Files:**
- Modify: `src/plugins/types.ts` (la firma `create`)
- Modify: `src/plugins/modulators/lfo.ts`, `adsr.ts` (mueren los stubs)
- Modify: cualquier llamante de `createInstance('modulator', …)`
- Test: `src/plugins/registry.test.ts` (o donde viva el test del SPI)

- [ ] **Step 1: Write the failing test**

```ts
it('hands a modulator its live state, so a rate edit reaches the running voice', () => {
  const state = { id: 'lfo1', kind: 'lfo', enabled: true, connections: [], scope: 'shared', rateHz: 2 };
  const voice = getModulator('lfo')!.createVoice(ctx, { state, bpm: () => 120 });
  state.rateHz = 8;
  // currentValue() syncs the live oscillator from state; with the old
  // create(ctx, bpm) SPI the voice held a throwaway state and never moved.
  voice.currentValue();
  expect(oscFrequencyOf(voice)).toBeCloseTo(8);
});
```

- [ ] **Step 2: Run it to make sure it fails**

```bash
NO_COLOR=1 npx vitest run src/plugins/
```

- [ ] **Step 3: Change the SPI**

En `src/plugins/types.ts`, la firma pasa de `create(ctx, bpm)` a
`create(ctx, opts: { state: ModulatorState; bpm: () => number })` **sólo para
`kind: 'modulator'`**. Motores e inserts no se tocan.

Borra `lfoPlugin` y `adsrPlugin` (los stubs de 29 líneas): sus componentes ya
hacen todo lo que hacían, y mejor.

- [ ] **Step 4: Run the tests**

```bash
NO_COLOR=1 npx vitest run
npx tsc --noEmit
npm run build
```

- [ ] **Step 5: Commit**

```bash
git add -u
git commit -F - <<'EOF'
feat(plugins): the modulator SPI receives live state

create(ctx, bpm) could not hand a modulator its state, so anything that was
not one of the two built-ins came out mute. The two 29-line stubs that owned
nothing are gone, absorbed by their components.
EOF
git rebase main
```

---

### Task 8: El cajón de params y el panel que construye el host

**Files:**
- Modify: `src/modulation/types.ts` (`params?: Record<string, number>`)
- Modify: `src/audio-dsp/modulation-runtime.ts` (`ModLite` lo lleva)
- Modify: `src/engines/worklet-lane-engine.ts` (`toModLite` lo pasa)
- Create: `src/modulation/generic-mod-config.ts` (`genericModConfigTemplate`)
- Test: `src/modulation/generic-mod-config.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
it('builds a control per declared param and writes into the modulator params bag', () => {
  const comp = { ...shStub, params: [
    { id: 'rate', label: 'Rate', kind: 'continuous', min: 0.1, max: 20, default: 6 },
  ] };
  const mod = comp.defaultState('sh1');
  const el = renderToElement(genericModConfigTemplate(comp, mod, ctx));
  setKnob(el, 'rate', 9);
  expect(mod.params?.rate).toBe(9);
});
```

- [ ] **Step 2: Run it to make sure it fails**

```bash
NO_COLOR=1 npx vitest run src/modulation/generic-mod-config.test.ts
```

- [ ] **Step 3: Add the bag**

En `types.ts`, dentro de `ModulatorState`:

```ts
  /** Settings of a modulator the core does not know — a plugin's. The named
   *  fields above are the sum of the modulators we happen to ship, so a plugin
   *  has nowhere to put its own; this bag is that place, and it is NUMERIC, so
   *  a discrete param is an index like everywhere else in the param SPI.
   *
   *  The named fields above are CLOSED: nothing new is ever added to them.
   *  They stay only because saved sessions and 6 Subtractive presets are
   *  written in terms of them. See §3.5 and §7 of the design doc. */
  params?: Record<string, number>;
```

`ModLite` gana el mismo campo y `toModLite` lo pasa tal cual
(`params: m.params`), o el kernel de un plugin llega al hilo de audio sin sus
ajustes.

- [ ] **Step 4: Write the generic panel**

`genericModConfigTemplate(comp, mod, ctx)` construye un control por cada
`comp.params`, reutilizando `createKnob`/`createSelectControl` y la
`ControlCache` del panel exactamente como hace `lfoConfigTemplate`. Lee de
`mod.params?.[spec.id] ?? spec.default` y escribe en
`(mod.params ??= {})[spec.id]`, llamando a `sync(deps)` después de cada cambio —
sin eso el worklet no se entera.

Sustituye el `// TODO: Task 8` de `modulation-ui.ts` por la llamada real.

- [ ] **Step 5: Run the tests**

```bash
NO_COLOR=1 npx vitest run src/modulation/
npx tsc --noEmit
```

- [ ] **Step 6: Commit**

```bash
git add -A src/modulation src/audio-dsp/modulation-runtime.ts src/engines/worklet-lane-engine.ts
git commit -F - <<'EOF'
feat(modulation): a numeric params bag for modulators the core does not know

ModulatorState's named fields are the sum of the modulators we ship, so a
plugin had nowhere to store its settings. One optional numeric bag is added
and carried through to the worklet; no existing field moves and nothing
saved needs converting. The named fields are closed from here on.

The host also gains the generic config panel it builds from a component's
declared params, which is the only route a plugin can take: its compiled
main.js cannot import our bundled lit-html.
EOF
git rebase main
```

---

### Task 9: La vía de plugin — el manifiesto, el reparto por tipo y la puerta del kernel

**Files:**
- Modify: `packages/loom-plugin-sdk/src/manifest.ts`
- Modify: `src/plugin-host/loom-api.ts`
- Modify: `src/plugin-host/manifest-validate.ts` (si valida el `kind`)
- Modify: `src/audio-worklet/loom-processor.ts` (la mitad worklet de la ABI)
- Test: `src/plugin-host/loom-api.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
it('registers a modulator component as a modulator, not as an engine', () => {
  installMainThreadLoomApi();
  Loom.registerComponent({
    kind: 'modulator', id: 'sh', name: 'S&H',
    params: [{ id: 'rate', label: 'Rate', kind: 'continuous', min: 0.1, max: 20, default: 6 }],
    modulator: { driver: 'time', scopes: ['shared', 'per-voice'], idPrefix: 'sh' },
  } as never);
  expect(getModulator('sh')?.name).toBe('S&H');
  // The bug this fixes: adoptComponent never read m.kind, so ANY component
  // was registered as an engine and would show up in the engine selector.
  expect(listEngines().map((e) => e.id)).not.toContain('sh');
});
```

- [ ] **Step 2: Run it to make sure it fails**

```bash
NO_COLOR=1 npx vitest run src/plugin-host/loom-api.test.ts
```

Expected: FAIL — `sh` aparece entre los motores.

- [ ] **Step 3: Widen the manifest union**

```ts
/** What a modulator component declares beyond the common fields. The host
 *  renders its params with the generic panel: a plugin cannot ship a template. */
export interface ModulatorDeclaration {
  driver: 'time' | 'gate';
  scopes: ('shared' | 'per-voice')[];
  idPrefix: string;
}

export type ComponentManifest =
  | (ComponentManifestBase & { kind: 'engine'; polyphony: 'mono' | 'poly';
      modulators?: unknown[]; capabilities: EngineCapabilities })
  | (ComponentManifestBase & { kind: 'modulator'; modulator: ModulatorDeclaration });
```

`LoomApi` gana:

```ts
  registerModulatorKernel(kernel: {
    id: string;
    valueAt(m: ModLiteLike, t: number, origin: number): number;
  }): void;
```

- [ ] **Step 4: Split adoptComponent by kind**

```ts
function adoptComponent(m: ComponentManifest): void {
  if (m.kind === 'modulator') return adoptModulator(m);
  return adoptEngine(m);
}
```

`adoptModulator` construye un `ModulatorComponent` desde el manifiesto: `id`,
`name`, `driver`/`scopes`/`idPrefix` de `m.modulator`, `params` de `m.params`,
sin `configTemplate`, y un `defaultState` que siembra el cajón con los
`default` declarados:

```ts
    defaultState: (id) => ({
      id, kind: m.id, enabled: true, connections: [],
      scope: m.modulator.scopes[0],
      params: Object.fromEntries(m.params.map((p) => [p.id, p.default])),
    }),
```

`createVoice` de un modulador de plugin devuelve una voz **silenciosa** de Web
Audio (un `ConstantSourceNode` a 0) con un comentario explícito: su señal viaja
por el kernel del worklet, no por Web Audio; sólo los params de FX usan esa
carretera y abrirla para plugins es trabajo posterior. **Declárelo, no lo
escondas.**

- [ ] **Step 5: Install the worklet half**

En `loom-processor.ts`, donde ya se instala `globalThis.Loom`, añade
`registerModulatorKernel` apuntando al registro de la tarea 2. Y en
`kernel-lane-render.ts`, lo mismo para el hilo principal — el mismo par de sitios
de la tarea 3.

- [ ] **Step 6: Run the tests**

```bash
NO_COLOR=1 npx vitest run src/plugin-host/ src/modulation/
npx tsc --noEmit
npm run build
```

- [ ] **Step 7: Commit**

```bash
git add -u
git commit -F - <<'EOF'
fix(plugins): adoptComponent stops registering every component as an engine

ComponentManifest was a union with exactly one member and adoptComponent
never read m.kind, so a modulator plugin would have appeared in the engine
selector. The manifest gains a modulator member, the host routes by kind, and
the ABI gains the kernel door in both realms.
EOF
git rebase main
```

---

### Task 10: El plugin S&H

**Files:**
- Create: `plugins/sh/plugin.json`, `plugins/sh/main.ts`, `plugins/sh/dsp.ts`
- Create: `plugins/sh/dsp.test.ts`
- Modify: `public/plugins/index.json`
- Create: `tests/e2e/plugin-modulator.spec.ts`

**Interfaces:**
- Consumes: todo lo anterior. Copia la forma de `plugins/karplus/` — es el
  plugin de referencia y ya funciona.

- [ ] **Step 1: Write the failing DSP test**

```ts
// plugins/sh/dsp.test.ts
import { describe, it, expect } from 'vitest';
import './dsp';
import { getModulatorKernel } from '../../src/audio-dsp/modulator-kernels';

const mod = { id: 'sh1', kind: 'sh', enabled: true, rateHz: 4,
  depthByParam: {}, params: { rate: 4, bipolar: 1 } } as never;

describe('sample & hold kernel', () => {
  it('holds its value for the whole step', () => {
    const k = getModulatorKernel('sh')!;
    // Two instants inside the same 1/4 s step must read identical.
    expect(k.valueAt(mod, 0.05, 0)).toBe(k.valueAt(mod, 0.20, 0));
  });

  it('latches a new value on the next step', () => {
    const k = getModulatorKernel('sh')!;
    expect(k.valueAt(mod, 0.20, 0)).not.toBe(k.valueAt(mod, 0.30, 0));
  });

  it('is pure: the same instant always reads the same, whatever the call order', () => {
    const k = getModulatorKernel('sh')!;
    const first = k.valueAt(mod, 0.55, 0);
    k.valueAt(mod, 1.9, 0);
    k.valueAt(mod, 0.1, 0);
    // Without purity the offline render would diverge from the live one: the
    // exporter calls valueAt in a different order.
    expect(k.valueAt(mod, 0.55, 0)).toBe(first);
  });

  it('stays inside its polarity range', () => {
    const k = getModulatorKernel('sh')!;
    for (let t = 0; t < 4; t += 0.037) {
      const v = k.valueAt(mod, t, 0);
      expect(v).toBeGreaterThanOrEqual(-1);
      expect(v).toBeLessThanOrEqual(1);
    }
  });
});
```

- [ ] **Step 2: Run it to make sure it fails**

```bash
NO_COLOR=1 npx vitest run plugins/sh/dsp.test.ts
```

- [ ] **Step 3: Write the kernel**

```ts
// plugins/sh/dsp.ts
// Sample & Hold: latch a new pseudo-random value every 1/rate seconds and hold
// it. PURE by construction — the held value of step n is hash(seed, n), never a
// remembered variable, so the offline render and the live one agree exactly.
const SEED = 0x9e3779b9;

/** Integer hash → -1..+1. A step's value depends only on its index. */
function valueForStep(n: number): number {
  let h = (n ^ SEED) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x45d9f3b) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x45d9f3b) >>> 0;
  h = (h ^ (h >>> 16)) >>> 0;
  return (h / 0xffffffff) * 2 - 1;
}

Loom.registerModulatorKernel({
  id: 'sh',
  valueAt(m, t, origin) {
    const rate = m.params?.rate ?? 4;
    const dt = t - origin;
    const step = dt <= 0 ? 0 : Math.floor(dt * rate);
    const v = valueForStep(step);
    return m.params?.bipolar === 0 ? (v + 1) / 2 : v;
  },
});
```

- [ ] **Step 4: Write the manifest and the main-thread half**

`plugins/sh/plugin.json`, con la forma de `plugins/karplus/plugin.json`:
`id: "sh"`, `name: "S&H"`, `loomApi: 1`, `main: "main.js"`, `dsp: "dsp.js"`, y un
único componente `kind: "modulator"` con `params` (`rate` continuo 0.1–20 por
defecto 6; `bipolar` discreto con dos opciones, por defecto 1) y
`modulator: { driver: "time", scopes: ["shared", "per-voice"], idPrefix: "sh" }`.

`plugins/sh/main.ts` es idéntico en forma al de Karplus:

```ts
// plugins/sh/main.ts — main-thread half: metadata only.
import manifest from './plugin.json';

Loom.registerComponent(manifest.components[0] as never);
```

Añade `"sh"` a `public/plugins/index.json`.

- [ ] **Step 5: Write the e2e acceptance**

`tests/e2e/plugin-modulator.spec.ts` afirma una **PRESENCIA**, no una ausencia
(un plugin roto tiene que ponerlo en rojo):
1. carga la app, espera a `pluginsReady`;
2. abre una pista melódica y su panel de moduladores;
3. **el botón `+ S&H` existe** → clic;
4. aparece una tarjeta con un mando `Rate`;
5. cero errores de consola.

- [ ] **Step 6: Run everything**

```bash
NO_COLOR=1 npx vitest run plugins/sh/dsp.test.ts
npm run build
npm run test:e2e
```

⚠️ `test:e2e` sirve `dist/` **sin construir**: el `npm run build` de arriba no es
opcional.

- [ ] **Step 7: Commit**

```bash
git add plugins/sh public/plugins/index.json tests/e2e/plugin-modulator.spec.ts
git commit -F - <<'EOF'
feat(plugins): a Sample & Hold modulator loaded from disk

The third modulator is a real plugin whose id no file in src/ mentions: it is
dropped into plugins/sh/ and works. Its kernel is pure by construction — a
step's value is hash(seed, step), never a remembered variable — so the
offline render and the live one agree exactly.
EOF
git rebase main
```

---

### Task 11: El `'saw'` silencioso, el censo a cero y la salida del censo en inglés

**Files:**
- Modify: `src/modulation/lfo-voice.ts`
- Create: `src/modulation/lfo-waveform-mapping.test.ts`
- Modify: `tools/plugin-id-census.mjs`

- [ ] **Step 1: Write the failing test**

```ts
// src/modulation/lfo-waveform-mapping.test.ts
it("maps our 'saw' onto the Web Audio enum's 'sawtooth'", () => {
  // Assigning an invalid enum value to OscillatorNode.type does not throw: it
  // is IGNORED, so the oscillator silently kept its previous shape. Picking
  // Saw gave a sawtooth in the worklet and NOT on the Web-Audio path.
  const voice = new LFOVoice(ctx, { ...lfo, waveform: 'saw' }, () => 120);
  expect(oscTypeOf(voice)).toBe('sawtooth');
});
```

- [ ] **Step 2: Run it to make sure it fails**

```bash
NO_COLOR=1 npx vitest run src/modulation/lfo-waveform-mapping.test.ts
```

- [ ] **Step 3: Map the vocabulary explicitly**

En `lfo-voice.ts`, sustituye los dos `as OscillatorType` por una función de
traducción explícita:

```ts
/** Our waveform vocabulary → the Web Audio enum. They agree on three names and
 *  disagree on the fourth: ours is 'saw', the spec's is 'sawtooth'. The old
 *  `as OscillatorType` cast hid that, and an invalid enum assignment is
 *  ignored rather than thrown, so choosing Saw silently kept the previous
 *  shape on this path while the worklet produced a real sawtooth. */
function oscType(w: Waveform | undefined): OscillatorType {
  return w === 'saw' ? 'sawtooth' : (w ?? 'sine');
}
```

- [ ] **Step 4: Drive the census to zero**

```bash
node tools/plugin-id-census.mjs --group modulator --lines
```

Quedan sitios de producción comparando `'lfo'`/`'adsr'`. Convierte cada uno a
una pregunta al registro. Si alguno **no** se puede convertir, no lo escondas:
anótalo en §7 del spec con su motivo. Objetivo: `core-decides` = 0.

- [ ] **Step 5: Translate the census tool's output**

`tools/plugin-id-census.mjs` imprime en castellano ("grupo", "clasificacion",
"lineas con un id de motor", "produccion", "ficheros de produccion afectados",
"por id", "por fichero"). Es un artefacto del repo: pásalo a inglés. Sin cambiar
su comportamiento.

- [ ] **Step 6: Run the full suite**

```bash
npx tsc --noEmit
npm run test:unit
npm run build
npm run test:e2e
node tools/plugin-id-census.mjs --group modulator
```

- [ ] **Step 7: Commit**

```bash
git add -u
git commit -F - <<'EOF'
fix(modulation): our 'saw' maps onto the Web Audio 'sawtooth'

An invalid enum assignment to OscillatorNode.type is ignored, not thrown, so
picking Saw left the oscillator on its previous shape: a sawtooth in the
worklet and something else on the Web-Audio path. The `as OscillatorType`
cast is what hid it.

Also drives the modulator id census to zero and puts the census tool's own
output into English.
EOF
git rebase main
```

---

## Cierre

Con las once tareas verdes, comprueba a mano lo que ningún test comprueba
(§5.7 del spec): en **Chrome de verdad**, un S&H sobre el cutoff de una pista
melódica suena **a escalones**, y un preset de Subtractive con envolvente suena
como antes. Eso, y sólo eso, cierra la rebanada.
