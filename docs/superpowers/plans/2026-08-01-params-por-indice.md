# Params por índice — Implementation Plan (fase 1 de 2)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** que el bucle de audio lea los parámetros por **índice** en vez de por
nombre, en los seis motores melódicos a la vez, sin que cambie ni una muestra del
sonido.

**Architecture:** los nombres se quedan en la frontera (manifiesto, presets,
estado de sesión, mensajes al worklet). Al construir un motor, el host numera sus
params declarados y produce un `ParamIndex`. Los valores vivos pasan de ser un
objeto por nombre a un `Float64Array`, y cada renderer resuelve **una vez** los
índices que le importan.

**Tech Stack:** TypeScript, Vitest (los `.dsp.test.ts` ejecutan el kernel puro sin
`AudioContext`), esbuild para los plugins.

**Spec:** [2026-08-01-motores-a-plugins-design.md](../specs/2026-08-01-motores-a-plugins-design.md)

**Esta fase NO mueve ningún motor.** La mudanza a `plugins/` es la fase 2 y
tendrá su propio plan, escrito cuando ésta esté verde. Esta fase entrega
software que funciona por sí sola: los mismos nueve motores, el mismo sonido,
el bucle caliente más rápido.

## Global Constraints

- **Ni una muestra de diferencia.** La red es la paridad muestra a muestra, y se
  captura **antes** de tocar la primera línea de producción (Tasks 1-2).
- **Sin versiones de ABI, sin migraciones, sin rutas de escape.** Lo que cambia,
  cambia entero y en el mismo commit — `plugins/karplus` y `plugins/sh`
  incluidos.
- **Comentarios, identificadores, tests y mensajes de commit en INGLÉS.** La
  prosa de los documentos, en castellano.
- **Tamaño de fichero:** objetivo 300 líneas de código, tope duro 500 (sin contar
  comentarios ni blancos).
- **Tests sin color:** `NO_COLOR=1 npx vitest run <fichero>`. No añadir
  `--reporter`.
- **Un commit por tarea**, en la rama `feat/engines-as-plugins`.

---

### Task 1: El generador de referencias, validado contra Karplus

`plugins/karplus/karplus-parity.dsp.test.ts` cita dos veces
`tools/gen-karplus-reference.ts`, y **ese fichero no existe** — ni en el árbol ni
borrado en el historial. La referencia se generó con algo que nunca se commiteó.
Antes de repetir el método cinco veces hace falta la herramienta, y la única
forma de confiar en ella es que **reproduzca exactamente** la referencia que ya
está commiteada.

**Files:**
- Create: `tools/gen-engine-reference.mjs`
- Test: `tools/gen-engine-reference.test.mjs`

**Interfaces:**
- Produces:
  - `renderReference(engineId: string): Promise<number[]>`
  - `node tools/gen-engine-reference.mjs <engineId> --out <path>`

**El formato ya está fijado por el fichero commiteado, y está comprobado:**
`plugins/karplus/reference-render.json` es un **array pelado de 57 números**
(`[0, 0.0541…, -0.3896…, …]`), no un objeto con metadatos. El generador emite
exactamente eso — no una forma parecida y mejor.

- [ ] **Step 1: Confirmar el formato con tus propios ojos**

```bash
node -e "const r=require('./plugins/karplus/reference-render.json'); console.log(Array.isArray(r), r.length, JSON.stringify(r.slice(0,4)))"
```

Esperado: `true 57 [0,0.05410319656762985,-0.3896956726182558,0.7139081970381999]`.
Si no coincide, **para**: el resto del plan asume esta forma.

- [ ] **Step 2: Escribir el test que exige reproducir Karplus**

```js
// tools/gen-engine-reference.test.mjs
import { describe, it, expect } from 'vitest';
import { renderReference } from './gen-engine-reference.mjs';
import committed from '../plugins/karplus/reference-render.json';

describe('the engine reference generator', () => {
  it('reproduces the committed Karplus reference exactly', async () => {
    const fresh = await renderReference('karplus');
    expect(Array.isArray(fresh)).toBe(true);
    expect(fresh.length).toBe(committed.length);      // 57
    expect(fresh).toEqual(committed);                 // bit for bit
  });
});
```

- [ ] **Step 3: Ejecutar y ver el rojo**

```bash
NO_COLOR=1 npx vitest run tools/gen-engine-reference.test.mjs
```

Esperado: FAIL — el módulo no existe.

- [ ] **Step 4: Escribir el generador**

Copia las tres decisiones del test de paridad, que son las que hacen la
referencia comparable, y **no las cambies**:

- `STRIDE = 512` (guarda una de cada 512 muestras);
- la nota de prueba `{ midi: 57, beginSec: 0, durationSec: 0.5, velocity: 0.8, accent: false, slide: false }`;
- el generador pseudoaleatorio con semilla `12345` y la recurrencia
  `s = (s * 1103515245 + 12345) & 0x7fffffff`, porque la excitación del Karplus
  es aleatoria por diseño y sin la misma semilla la referencia no significa nada.

Registra un `Loom` mínimo (`{ apiVersion: 1, registerRenderer }`) **antes** de
importar el DSP, igual que hace el test.

⚠️ Si el resultado no coincide con el commiteado, **el fallo es del generador,
no de la referencia**: la referencia es el hecho conocido. Ajusta el generador
hasta que coincida.

- [ ] **Step 5: Verde**

```bash
NO_COLOR=1 npx vitest run tools/gen-engine-reference.test.mjs
```

- [ ] **Step 6: Corregir las dos menciones mentirosas del test de Karplus**

En `plugins/karplus/karplus-parity.dsp.test.ts`, sustituye las dos referencias a
`tools/gen-karplus-reference.ts` por `tools/gen-engine-reference.mjs`.

- [ ] **Step 7: Commit**

```bash
git add tools/gen-engine-reference.mjs tools/gen-engine-reference.test.mjs plugins/karplus/karplus-parity.dsp.test.ts
git commit -m "test(tools): the reference generator the parity test always named"
```

---

### Task 2: Capturar la referencia de los cinco motores del árbol

La red de seguridad de todo el plan. Se hace **antes** de tocar producción: una
referencia capturada después del cambio prueba que el cambio es igual a sí mismo.

**Files:**
- Create: `src/audio-dsp/reference/tb303.json`, `subtractive.json`, `fm.json`,
  `wavetable.json`, `westcoast.json`
- Create: `src/audio-dsp/engine-parity.dsp.test.ts`

**Interfaces:**
- Consumes: `renderReference(engineId)` de la Task 1.

- [ ] **Step 1: Generar las cinco referencias**

```bash
for e in tb303 subtractive fm wavetable westcoast; do
  node tools/gen-engine-reference.mjs $e --out src/audio-dsp/reference/$e.json
done
```

- [ ] **Step 2: Escribir el test que las defiende**

```ts
// src/audio-dsp/engine-parity.dsp.test.ts
import { describe, it, expect } from 'vitest';
import { renderReference } from '../../tools/gen-engine-reference.mjs';

const ENGINES = ['tb303', 'subtractive', 'fm', 'wavetable', 'westcoast'];

describe('engine render parity', () => {
  for (const id of ENGINES) {
    it(`${id} renders exactly what it rendered before the index change`, async () => {
      // A bare number[], the same shape as plugins/karplus/reference-render.json.
      const committed: number[] = (await import(`./reference/${id}.json`)).default;
      const fresh = await renderReference(id);
      expect(fresh.length).toBe(committed.length);
      for (let i = 0; i < committed.length; i++) {
        expect(fresh[i]).toBeCloseTo(committed[i], 10);
      }
    });
  }
});
```

⚠️ `toBeCloseTo(..., 10)` y no igualdad exacta: el orden de las sumas en coma
flotante puede cambiar al reordenar lecturas sin que el sonido cambie. Diez
decimales están muy por debajo de lo audible y muy por encima del ruido de
redondeo. **No lo relajes cuando algo falle** — si un motor necesita más margen,
eso ES el hallazgo.

- [ ] **Step 3: Verde ANTES de tocar producción**

```bash
NO_COLOR=1 npx vitest run src/audio-dsp/engine-parity.dsp.test.ts
```

Los cinco en verde. Si alguno falla aquí, el generador no es determinista y hay
que arreglarlo antes de seguir.

- [ ] **Step 4: Commit**

```bash
git add src/audio-dsp/reference src/audio-dsp/engine-parity.dsp.test.ts
git commit -m "test(dsp): pin what the five in-tree engines render, before any change"
```

---

### Task 3: La medición de CPU de partida

El spec exige el número antes y después. Éste es el "antes", y se toma sobre esta
rama **sin cambios de producción todavía**, que es idéntica a `main` en el camino
de audio.

**Files:**
- Create: `tools/param-read-bench.mjs`

**Interfaces:**
- Produces: `node tools/param-read-bench.mjs <engineId>` → mediana de ms de 5
  tiradas renderizando 10 s a 48 kHz con 8 voces.

- [ ] **Step 1: Escribir el banco sobre el kernel REAL**

No reutilices `tools/param-access-bench.mjs`: ése mide lecturas sueltas y sirvió
sólo para descartar una hipótesis. Éste ejecuta el renderer de verdad:

```js
// tools/param-read-bench.mjs
const SR = 48000, SECONDS = 10, VOICES = 8, RUNS = 5;

function once(engineId) {
  // Build VOICES renderers through the SAME registry the worklet uses, so the
  // bench measures the shipping code path and not a copy of it.
  const voices = Array.from({ length: VOICES }, () => createRenderer(engineId, /* trigger snapshot */));
  const t0 = process.hrtime.bigint();
  for (let i = 0; i < SR * SECONDS; i++) {
    const t = i / SR;
    for (const v of voices) v.renderSample(t);
  }
  return Number(process.hrtime.bigint() - t0) / 1e6;   // ms
}

const times = Array.from({ length: RUNS }, () => once(process.argv[2]));
const median = [...times].sort((a, b) => a - b)[RUNS >> 1];
console.log(`${process.argv[2].padEnd(12)} median ${median.toFixed(1)} ms  (${times.map(t => t.toFixed(0)).join(', ')})`);
```

⚠️ Antes de medir, **mueve un param en vuelo** — llama a `setTargets` con un
valor nuevo cada N muestras. Sin nada moviéndose, el compilador puede sacar las
lecturas del bucle y medirías su ausencia, que es exactamente el error que
invalidó el `39×` de `tools/param-access-bench.mjs`.

- [ ] **Step 2: Tomar el "antes" de los cinco motores**

```bash
for e in tb303 subtractive fm wavetable westcoast; do node tools/param-read-bench.mjs $e; done
```

- [ ] **Step 3: Escribir los números en este plan**

Sustituye la tabla de abajo por los valores reales. Es el punto de comparación
del resto del trabajo; sin él, la Task 9 no puede afirmar nada.

| motor | mediana ANTES (ms) | mediana DESPUÉS (ms) |
| --- | --- | --- |
| tb303 | _(rellenar)_ | |
| subtractive | _(rellenar)_ | |
| fm | _(rellenar)_ | |
| wavetable | _(rellenar)_ | |
| westcoast | _(rellenar)_ | |

- [ ] **Step 4: Commit**

```bash
git add tools/param-read-bench.mjs docs/superpowers/plans/2026-08-01-params-por-indice.md
git commit -m "bench(dsp): the before number, measured on the real kernel"
```

---

### Task 4: `ParamIndex` — numerar los params declarados

**Files:**
- Create: `src/audio-dsp/param-index.ts`
- Test: `src/audio-dsp/param-index.test.ts`

**Interfaces:**
- Produces:
  - `interface ParamIndex { readonly slot: Readonly<Record<string, number>>; readonly length: number; }`
  - `buildParamIndex(ids: readonly string[]): ParamIndex`
  - `SYNTHETIC_TARGETS = ['amp', 'ampGain', 'filterEnv'] as const`

- [ ] **Step 1: Escribir los tests**

```ts
import { describe, it, expect } from 'vitest';
import { buildParamIndex, SYNTHETIC_TARGETS } from './param-index';

describe('buildParamIndex', () => {
  it('numbers declared params in declaration order, from zero', () => {
    const ix = buildParamIndex(['filter.cutoff', 'osc1.level']);
    expect(ix.slot['filter.cutoff']).toBe(0);
    expect(ix.slot['osc1.level']).toBe(1);
  });

  it('puts the synthetic targets AFTER every declared param', () => {
    const ix = buildParamIndex(['a', 'b']);
    for (const t of SYNTHETIC_TARGETS) expect(ix.slot[t]).toBeGreaterThanOrEqual(2);
  });

  it('length covers declared params plus the synthetic targets', () => {
    const ix = buildParamIndex(['a', 'b']);
    expect(ix.length).toBe(2 + SYNTHETIC_TARGETS.length);
  });

  it('user: an id it never heard of has no slot', () => {
    const ix = buildParamIndex(['a']);
    expect(ix.slot['typo.here']).toBeUndefined();
  });
});
```

- [ ] **Step 2: Rojo**

```bash
NO_COLOR=1 npx vitest run src/audio-dsp/param-index.test.ts
```

- [ ] **Step 3: Implementar**

```ts
// src/audio-dsp/param-index.ts
/** Modulation targets that are not declared params: the per-voice amplitude
 *  envelope, a multiplicative output gain, and the filter envelope. They get
 *  slots AFTER the declared ones so a declared param's index never moves when
 *  this list changes. */
export const SYNTHETIC_TARGETS = ['amp', 'ampGain', 'filterEnv'] as const;

export interface ParamIndex {
  /** id → slot. An id with no slot is not addressable: that is the point. */
  readonly slot: Readonly<Record<string, number>>;
  readonly length: number;
}

export function buildParamIndex(ids: readonly string[]): ParamIndex {
  const slot: Record<string, number> = {};
  let n = 0;
  for (const id of ids) if (!(id in slot)) slot[id] = n++;
  for (const t of SYNTHETIC_TARGETS) if (!(t in slot)) slot[t] = n++;
  return { slot, length: n };
}
```

- [ ] **Step 4: Verde y commit**

```bash
NO_COLOR=1 npx vitest run src/audio-dsp/param-index.test.ts
git add src/audio-dsp/param-index.ts src/audio-dsp/param-index.test.ts
git commit -m "feat(dsp): number a declared param set once, so the hot loop can index it"
```

---

### Task 5: `ParamSmoother` guarda los valores en un `Float64Array`

**Files:**
- Modify: `src/audio-dsp/param-smoother.ts`
- Modify: `src/audio-dsp/param-smoother.test.ts`

**Interfaces:**
- Consumes: `ParamIndex` de la Task 4.
- Produces: `new ParamSmoother(sr, index, timeConstantSec?)`, con
  `readonly values: Float64Array` (mutado en el sitio, nunca reasignado),
  `reset(patch: ParamBag)`, `setTargets(patch: ParamBag)`, `tick(): boolean`,
  `moving: boolean`. Las entradas siguen siendo bolsas **por nombre**: la
  resolución a índice ocurre aquí, en la frontera.

- [ ] **Step 1: Añadir los tests de la frontera**

```ts
it('resolves incoming names to slots and stores them by index', () => {
  const ix = buildParamIndex(['filter.cutoff']);
  const s = new ParamSmoother(48000, ix);
  s.reset({ 'filter.cutoff': 0.4 });
  expect(s.values[ix.slot['filter.cutoff']]).toBeCloseTo(0.4, 12);
});

it('user: an id with no slot is ignored instead of silently stored', () => {
  const ix = buildParamIndex(['filter.cutoff']);
  const s = new ParamSmoother(48000, ix);
  s.reset({ 'typo.here': 1 });          // must not throw
  expect(s.values.length).toBe(ix.length);
});
```

⚠️ Conserva **todos** los tests existentes de `param-smoother.test.ts`
adaptando sólo cómo se lee el valor. El comportamiento del suavizado —el
`landedInstantly`, la guarda de no-finitos, la lista de activos— no se toca en
esta tarea, y sus tests son los que lo prueban.

- [ ] **Step 2: Rojo, luego implementar**

`values` pasa a `Float64Array(index.length)`; `targets` igual; `active` pasa a
ser una lista de **índices** (`number[]`). En `reset`/`setTargets`, para cada id
del patch: `const i = this.index.slot[id]; if (i === undefined) continue;`.

Un id desconocido se ignora, y se avisa **una sola vez por id** con
`console.warn` — hoy crearía una clave que nadie lee, que es una errata de
plugin invisible.

- [ ] **Step 3: Verde y commit**

```bash
NO_COLOR=1 npx vitest run src/audio-dsp/param-smoother.test.ts
git add src/audio-dsp/param-smoother.ts src/audio-dsp/param-smoother.test.ts
git commit -m "feat(dsp): the live param bag becomes a Float64Array addressed by slot"
```

---

### Task 6: El contrato del renderer pasa a índices

**Files:**
- Modify: `packages/loom-plugin-sdk/src/types.ts:79-103`
- Modify: `src/audio-dsp/types.ts`
- Modify: `plugins/karplus/dsp.ts`, `plugins/sh/` (lo que implemente el contrato)

**Interfaces:**
- Produces, en el SDK:
  - `setLiveValues?(values: Float64Array, index: ParamIndex): void` — sustituye a
    `setLiveParams?(live: ParamBag)`.
  - `renderSample(t: number, modOffsets?: Float64Array): number` — el mapa de
    offsets pasa a ser un array del mismo largo e índice que `values`.
- **Desaparece del host:** `setLiveSubParams`, y con él la extensión propia de
  `src/audio-dsp/types.ts` sobre el `VoiceRenderer` del SDK.

- [ ] **Step 1: Cambiar el tipo publicado**

Reescribe el bloque `VoiceRenderer` del SDK. **Conserva íntegro** el párrafo que
explica qué params son estructurales y por qué las envolventes están excluidas:
ese comentario documenta una decisión de sonido, no la forma del dato.

- [ ] **Step 2: Actualizar los plugins en el MISMO commit**

`plugins/karplus/dsp.ts` resuelve sus índices en `setLiveValues` y lee por
slot. Sin versión nueva de ABI: no hay nada con lo que ser compatible.

- [ ] **Step 3: La paridad de Karplus sigue verde**

```bash
NO_COLOR=1 npx vitest run plugins/karplus/karplus-parity.dsp.test.ts
```

Es el primer motor convertido y su referencia es la más antigua: si pasa, el
contrato nuevo rinde el mismo sonido.

- [ ] **Step 4: Commit**

```bash
git add packages/loom-plugin-sdk/src/types.ts src/audio-dsp/types.ts plugins/
git commit -m "feat(sdk): a renderer reads its params by slot, not by name"
```

---

### Tasks 7a-7e: Convertir los cinco renderers del árbol

Una tarea por motor, en este orden: **`tb303`, `fm`, `wavetable`, `westcoast` y
`subtractive` el último**. Los cuatro primeros sólo cambian cómo leen; el quinto
además **borra** su camino propio.

Para cada motor `<id>`:

**Files:**
- Modify: `src/audio-dsp/<id>-renderer.ts`
- Test: `src/audio-dsp/engine-parity.dsp.test.ts` (ya escrito, Task 2)

- [ ] **Step 1: Resolver los índices UNA vez**

En el constructor del renderer, tras recibir `index`, guarda un campo por cada
param que lea por muestra: `this.iCutoff = index.slot['filter.cutoff'] ?? -1;`.

⚠️ **Sólo los params CONTINUOS.** Los estructurales (forma de onda, modelo de
filtro, tamaño de unison, TIEMPOS de envolvente) se siguen leyendo del snapshot
de disparo. Esa regla no cambia con este plan; está en el comentario del SDK que
la Task 6 conserva.

- [ ] **Step 2: Sustituir las lecturas del bucle**

`bag['filter.cutoff']` → `values[this.iCutoff]`. Un índice `-1` significa que el
motor declaró ese param pero no está en el índice: trátalo como el valor por
defecto del snapshot, nunca como `values[-1]`.

- [ ] **Step 3: Paridad de ESE motor**

```bash
NO_COLOR=1 npx vitest run src/audio-dsp/engine-parity.dsp.test.ts -t <id>
```

Verde antes de tocar el siguiente. Si falla, el fallo está en este motor y en
ninguna otra parte — ése es el valor de convertirlos de uno en uno.

- [ ] **Step 4: Commit** (uno por motor)

```bash
git add src/audio-dsp/<id>-renderer.ts
git commit -m "refactor(dsp): <id> reads its live params by slot"
```

**Sólo en 7e (`subtractive`), además:** borra `SubParams`, `subParamsFromBag`,
`subParamsInto` y `fieldForParamId`, y las cuatro comparaciones
`=== 'subtractive'` de `voice-manager.ts:123,182` y
`worklet-lane-engine.ts:149,280`. Su `fillOffsets` pasa a escribir el mismo
`Float64Array` por índice que los demás.

---

### Task 8: `VoiceManager` entrega array e índice

**Files:**
- Modify: `src/audio-dsp/voice-manager.ts:118-130, 175-216`

- [ ] **Step 1: Sustituir la entrega**

`v.setLiveParams?.(this.smoother.values)` → `v.setLiveValues?.(this.smoother.values, this.index)`.
Desaparece la rama `if (this.engineId === 'subtractive')` de la línea 123 y la
caché `liveSub`.

- [ ] **Step 2: `fillOffsets` escribe por índice**

Un único `Float64Array(index.length)` reutilizado, puesto a cero por muestra y
rellenado con `this.mod.offsetFor(id, t, o)` en el slot de cada destino
conectado. Desaparece la rama por campos de la línea 182 y el tipo
`VoiceModOffsets`.

- [ ] **Step 3: La suite entera**

```bash
NO_COLOR=1 npx tsc --noEmit
npm run test:unit
```

- [ ] **Step 4: Commit**

```bash
git add src/audio-dsp/voice-manager.ts
git commit -m "refactor(dsp): one offsets array by slot, for every engine alike"
```

---

### Task 9: La medición de CPU final, y el veredicto

**Files:**
- Modify: `docs/superpowers/plans/2026-08-01-params-por-indice.md` (la tabla de
  la Task 3)

- [ ] **Step 1: Medir el "después"**

```bash
for e in tb303 subtractive fm wavetable westcoast; do node tools/param-read-bench.mjs $e; done
```

- [ ] **Step 2: Rellenar la tabla y juzgar**

Lo que el spec exige: **Subtractive recupera** lo que perdería al soltar su
struct, y **los otros cuatro mejoran**. Si Subtractive sale peor que antes, el
diseño no cumplió su promesa: **para, escribe el número y consulta a Nacho.** No
lo compenses ensanchando el contrato ni relajando la paridad.

- [ ] **Step 3: Commit**

```bash
git add docs/superpowers/plans/2026-08-01-params-por-indice.md
git commit -m "bench(dsp): the after number, and what it says"
```

---

### Task 10: Verificación final

- [ ] **Step 1: Todo verde**

```bash
NO_COLOR=1 npx tsc --noEmit
npm run test:unit
npm run build && npm run test:e2e
```

⚠️ `test:e2e` sirve `dist/` **sin** compilar: el `npm run build` no es opcional.

- [ ] **Step 2: Rebase**

```bash
git rebase main
```

- [ ] **Step 3: A oído, en Chrome de verdad**

`npm run dev`, y sobre la demo del arranque: **escuchar** una pista de cada uno
de los seis motores. La paridad prueba que la muestra 512 vale lo mismo; no
prueba que no haya un clic al mover un mando en vivo, que es justo lo que este
cambio toca. Mueve el cutoff de una nota sostenida en cada motor.

- [ ] **Step 4: Informe honesto**

Qué se midió, qué salió y qué NO se comprobó. Si algo quedó sin mirar, se dice.
