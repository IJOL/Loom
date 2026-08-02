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

## Estado a 2026-08-02 (rama `feat/engines-as-plugins`)

**Hechas y commiteadas:**

- **Task 1** `5766653` — el generador de referencias (`tools/gen-engine-reference.ts`).
- **Task 2** `141c738` — referencias de los cinco motores congeladas.
- **Task 3** `1a7de68` — medición de partida (tabla más abajo).
- **Task 4** `bb4ff40` — `ParamIndex` (`src/audio-dsp/param-index.ts`).
- **Task 5** `30adfd9` — `SlotSmoother` (`src/audio-dsp/slot-smoother.ts`).
- **Task 6** `0e44183` + `59efb05` — los ids declarados viajan al worklet, el
  `VoiceManager` suaviza sobre `Float64Array`, y el SDK publica
  `setLiveValues(values, index)` + `slotOf`. Karplus es el primero en cruzar.
- **Task 7** `218c34c` + `21687ef` — los cinco motores en árbol cruzan;
  Subtractive el último, y con él muere `setLiveSubParams`. `VoiceRenderer` del
  host ya no añade nada al del SDK.

Suite entera verde en `0e44183` (426 ficheros / 3552 tests); desde entonces,
verdes las suites `audio-dsp` + `plugins` + `audio-worklet` + `engines` (93
ficheros / 830 tests) con **paridad muestra a muestra intacta** en los cinco
motores y en Karplus.

**Lo que Task 6 destapó, y que no estaba en el plan:** el conjunto declarado de
una lane **no es** `cfg.params`. Se excluyen los params de mezcla, se añade
`poly.voices`, y `output.trim` es un param VIVO que leen `fm-renderer` y
`plugins/karplus` **sin que ningún motor lo declare** — entraba en la bolsa por
la puerta de atrás. Semilla y numeración salen ahora del mismo objeto.

**Qué queda:** Task 8 (los offsets de modulación pasan a slots y muere el caso
especial de `fillOffsets`), Task 9 (**la medición**) y Task 10.

**Tres correcciones que la ejecución impuso sobre lo escrito aquí:**

1. **La validación contra Karplus NO puede ser bit a bit**: el plugin dejó de
   aplicar su propio trim (lo hace el host), así que se compara la FORMA
   normalizada al pico, el mismo criterio que ya usaba su test.
2. **La medición de partida desmiente la expectativa cómoda**: Subtractive no es
   el motor rápido pese a su struct — 9,5× más lento que el 303. La ganancia se
   medirá en puntos porcentuales, no en múltiplos.
3. **`ParamSmoother` no se convirtió en el sitio**: el Sampler también lo usa y
   le hace `setLivePad(sm.values as unknown as LivePadParams)` — un cast que NO
   falla al compilar si debajo hay un `Float64Array`, sólo lee basura.
   `SlotSmoother` es clase nueva; el viejo se queda con el Sampler hasta que su
   backend se mude. Escrito en ambos ficheros.

**Siguiente paso concreto (Task 6):** el `VoiceManager` vive en el worklet y
**no conoce la lista de params declarados** de su motor, sólo recibe una bolsa de
valores. Decisión tomada: **el motor le envía la lista de ids explícitamente** en
el mensaje de construcción, en vez de deducirla del orden de las claves de esa
bolsa. Deducirlo funciona hoy y se rompe en silencio, en el camino de audio, el
día que alguien añada una clave fuera del orden del spec.

Orden del tramo acoplado: el motor envía sus ids → el `VoiceManager` construye
índice y `SlotSmoother` → se añade `setLiveValues` **junto** al método viejo →
se convierten los seis renderers de uno en uno con su paridad verde → y sólo
entonces se borra el camino viejo y los offsets de modulación pasan a slots.

### La medición de CPU es LA entrega, no el epílogo

El cambio no tiene efecto visible: mismo sonido, misma UI, mismos tests. **Lo
único que justifica haberlo hecho es el número de la Task 9.** Por eso la partida
se midió antes de tocar producción (Task 3) y por eso la comparación cierra el
trabajo. Reglas que no se negocian:

- **Mismo comando, misma máquina, misma metodología** que la partida — 10 s de
  audio, 8 voces, mediana de 5 pasadas — o los dos números no se pueden restar.
  El comando real es `npx tsx tools/param-read-bench.ts <id>`: el plan lo
  escribió `.mjs` y la ejecución entregó `.ts`; la Task 9 usa el `.ts`.
- **Se informan los cinco motores**, no sólo los que mejoraron.
- **Un empate o un empeoramiento se publica igual y se para.** No se ensancha
  el contrato ni se relaja la paridad para conseguir un número bonito. La
  medición de la Task 3 ya desmintió una hipótesis cómoda (el `39×` del
  micro-bench); ésta tiene el mismo derecho a desmentir el diseño.

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

> ## ⛔ ESTA TABLA DE PARTIDA ES INVÁLIDA — NO LA USES
>
> Medida el 2026-08-01 con `tools/param-read-bench.ts`: tb303 48,5 · subtractive
> 460,1 · fm 962,4 · wavetable 502,1 · westcoast 894,6.
>
> Tiene **dos defectos**, y cada uno por separado ya la invalidaba:
>
> 1. **El banco enchufaba los params vivos él mismo**, llamando al hook del
>    renderer. Subtractive **nunca implementó `setLiveParams`** — tenía el suyo,
>    `setLiveSubParams`, que reparte el `VoiceManager` —, así que la llamada era
>    un no-op silencioso y lo que se midió fue su camino CONGELADO, con la caché
>    de `Math.pow` sin invalidarse nunca porque nadie leía el mando que se movía.
> 2. **Las voces se morían.** El banco pasaba `NOTE` con su duración corta, así
>    que al cabo de ~1 s las ocho voces estaban `done` y los otros nueve segundos
>    no renderizaban nada. Cada motor medía una fracción distinta del tiempo:
>    eso explica el "tb303 es 9,5× más rápido que subtractive", que no era una
>    propiedad del 303 sino de cuánto vivían sus voces.
>
> La lección: **un banco que decide él cómo conectar el sistema mide su propia
> decisión.** El sustituto, `tools/lane-bench.ts`, conduce un `VoiceManager` de
> verdad — es producción quien elige el contrato — y sostiene las notas los 10 s.
> Ver más abajo la medición buena.

**La medición buena (Task 9)** — `npx tsx tools/lane-bench.ts <id>`, 10 s × 8
voces a 48 kHz, mediana de 5, misma máquina, sin nada más corriendo, y **los dos
lados con el mismo fichero**: el "antes" en un worktree en `1a7de68`, el
"después" en `3323b78`.

| motor | ANTES (ms) | DESPUÉS (ms) | |
| --- | --- | --- | --- |
| tb303 | 765,2 | 698,5 | −8,7 % |
| subtractive | 757,6 | 669,8 | −11,6 % |
| fm | 1081,5 | 518,8 | **−52,0 %** |
| wavetable | 508,8 | 429,7 | −15,5 % |
| westcoast | 123,0 | 85,5 | −30,5 % |

**Veredicto: los cinco mejoran, y el que más tenía que perder es de los que más
gana.** Subtractive era el motor con la optimización privada — un struct tipado
que el spec describía como algo "de lo que ningún plugin debería depender" — y
soltarlo por slots le da un 11,6 %. La hipótesis cómoda era que empataría; leer
por índice es más rápido que leer campos de un struct que además había que
refrescar entero, una vez por lane y por muestra, con 35 lecturas por nombre.

FM se parte por la mitad porque era el que más nombres buscaba: tres por lane más
tres por operador, quince por voz y por muestra.

**Una asimetría que hay que declarar:** el arnés construye el índice con
`Object.keys(params)`, que no incluye `output.trim`. En el lado nuevo FM y
Karplus se quedan con slot -1 para ese id y caen al valor congelado; en el lado
viejo hacían una búsqueda fallida en la tabla. Producción **sí** le da slot (la
lane lo añade a la semilla), así que el arnés subestima ligeramente el trabajo
del lado nuevo. Va en la dirección conservadora sólo para ese id, y no explica
ninguna de las cinco diferencias.

**Westcoast rinde poco trabajo medido**: su contorno AD termina y las voces se
reaprovechan antes de los 10 s, en ambos lados por igual. La comparación es
válida; la magnitud absoluta, pequeña.

### ✅ Verificado A OÍDO — Nacho, 2026-08-02, en `1dfeb34`

Demo de arranque (TB-303 + batería + **dos lanes de Subtractive**, el motor que
más cambió), Escena 1 lanzada por el botón de escena y Escena 2 conmutada **en
caliente por Nacho**. Veredicto suyo: *"va perfecto"*, y **los LFOs también**
(comprobación no exhaustiva, dicho por él).

Medición objetiva en la misma tirada, tap en el bus máster: **pico 0,963, 0
recortes, 0 frames casi mudos de 4834, 0 errores de consola** — el cambio de
escena en caliente cayó DENTRO de esa ventana y no metió ningún hueco.

Y la señal que más vale: los dos avisos que este trabajo introdujo —
`[slot-smoother] no slot for param` y `[modulation] no slot for target` — **no
aparecen ni una vez**. Si algún mando o alguna conexión se hubiera quedado
descolgada al pasar a índices, habría gritado ahí.

### El camino de MODULACIÓN, medido aparte (Task 8)

El arnés no enganchaba un `ModulationRuntime`, así que la mitad de modulación del
bucle caliente era invisible: `fillOffsets` se saltaba entera y cada `mo?.<name>`
de los renderers cortocircuitaba. **Producción engancha uno SIEMPRE**, así que eso
no era simplificar, era medir un camino que no se envía. Dos modos desde
`3323b78`: `none` (runtime con CERO moduladores — el caso común) y `lfo` (uno
sobre el param que se mueve).

| motor | none: partida → guarda → +unificación | lfo: partida → guarda → +unificación |
| --- | --- | --- |
| tb303 | 723,4 → 707,9 → **697,1** | 796,1 → 804,6 → **788,0** |
| subtractive | 759,3 → 681,5 → **675,3** | 869,4 → 844,1 → **813,9** |
| fm | 801,1 → 538,3 → **533,8** | 930,5 → 920,0 → **921,9** |
| wavetable | 452,7 → 451,9 → **436,0** | 516,4 → 514,5 → **517,4** |
| westcoast | 85,1 → 82,7 → **80,0** | 147,5 → 144,2 → **138,4** |

**La guarda de una línea (`07eda6f`) es la que paga**: devolver *nada* en vez de
una bolsa de ceros cuando no hay moduladores da **fm −32,8 %** y **subtractive
−10,2 %** en una lane sin modulación. Una bolsa vacía no es gratis: hace que cada
`mo?.<target>` se ejecute y falle en vez de cortocircuitar — unas 120 búsquedas
fallidas por muestra en una lane de FM a 8 voces.

**La unificación del vocabulario (`1562324`) compra entre 1 y 4 %**, casi ruido.
Su valor es estructural, y hay que decirlo así: mata el último `=== 'subtractive'`
del camino de audio, mata `fieldForParamId`, y destapó que el **render offline /
export perdía la modulación** de cualquier param fuera de la tabla de Subtractive.

### Resultado final del camino de modulación (`7409958`)

| motor | none: partida → final | lfo: partida → final | coste de UN LFO |
| --- | --- | --- | --- |
| tb303 | 723,4 → **701,7** (−3,0 %) | 796,1 → **742,5** (−6,7 %) | +13 % → **+6 %** |
| subtractive | 759,3 → **676,9** (−10,9 %) | 869,4 → **786,1** (−9,6 %) | +21 % → **+16 %** |
| fm | 801,1 → **521,6** (−34,9 %) | 930,5 → **630,6** (−32,2 %) | **+73 % → +21 %** |
| wavetable | 452,7 → **437,2** (−3,4 %) | 516,4 → **460,4** (−10,8 %) | +19 % → **+5 %** |
| westcoast | 85,1 → **85,8** (≈0) | 147,5 → **111,8** (−24,2 %) | +73 % → **+30 %** |

**Lo que había que demostrar, demostrado:** un LFO en FM costaba un 73 % del
motor y ahora cuesta un 21 %. En wavetable pasa del 19 % al 5 %.

**Dos fallos que la propia instrumentación destapó al medir:**

1. `MOD_TARGET` en el banco seguía nombrando el destino de Subtractive como
   `filterCutoff`, así que sus tiradas `lfo` se midieron con un modulador
   **inerte** — el aviso `[modulation] no slot for target` lo cantó. Corregido y
   vuelto a medir; el 813,9 → 786,1 de arriba ya es con un modulador real.
2. `hasActive` decía "sí" para un modulador cuyos destinos no resuelven ninguno,
   lo que costaba un llenado y una tanda entera de lecturas por muestra para
   producir un array de ceros. Ahora, con índice enlazado, significa "activo en
   el camino de slots".

**Lo que queda, y por qué merece la pena:** el sobrecoste de tener UN solo LFO
activo es +73 % en fm (+388 ms) y en westcoast, +21 % en subtractive, +19 % en
wavetable, +13 % en tb303. Un LFO no puede costar eso. Son las lecturas por
nombre que siguen en el camino de modulación — `offsetsInto` escribiendo una
bolsa por nombre y cada renderer leyéndola por nombre, por voz y por muestra.
Pasarlas a slots es el resto de la Task 8: el runtime resuelve nombre→slot UNA
vez en `setMods` (por eso necesita el `ParamIndex` de la lane), llena un
`Float64Array`, y cada renderer lee `off[i]` con el slot que ya resolvió en
`setLiveValues`. Toca además el `ModEnvHost` del SDK, que mezcla los ADSR por voz
en esa misma bolsa.

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

**Esta tarea es el motivo del plan entero.** Ver _«La medición de CPU es LA
entrega»_ en la sección Estado: misma máquina, misma metodología que la Task 3,
los cinco motores informados, y un empeoramiento se publica y para el trabajo.

- [ ] **Step 1: Medir el "después"**

```bash
for e in tb303 subtractive fm wavetable westcoast; do npx tsx tools/param-read-bench.ts $e; done
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
