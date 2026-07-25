# Auditoría — "N soluciones al mismo problema"

Esta auditoría nació del eje temporal horizontal del clip, que existía **cuatro veces**: `viewStateByClip`
en [clip-editor-router.ts:77](../../../src/session/clip-editors/clip-editor-router.ts) (gutter 42 px),
`hViewByClip` en [clip-editor-drum-grid.ts:33](../../../src/session/clip-editors/clip-editor-drum-grid.ts)
(gutter `LABEL_W`), `audioHViewByClip` en
[clip-waveform-header.ts:26](../../../src/session/clip-editors/clip-waveform-header.ts) (gutter 0) y un
ancho fijo `max(800, bars*240)` sin zoom en
[clip-automation-lanes.ts:164](../../../src/session/clip-automation-lanes.ts). Resultado: rejillas del
mismo compás con anchos distintos, automatización que no podía hacer zoom con el clip, y la región de loop
ausente en una de las cuatro. **Ése es el listón de severidad**: una inconsistencia real y visible para el
usuario causada por estado/matemáticas duplicados, no repetición estilística.

Esto es una auditoría de **SOLO LECTURA**. No se ha modificado, creado ni borrado ningún fichero del código:
este documento es el único artefacto escrito. Todos los `file:line` han sido verificados literalmente contra
el árbol de trabajo (`.claude/worktrees/clip-axis-automation`) durante la auditoría — no vienen de memoria.

---

## Tabla resumen

| # | Concern | Copias | Severidad | Esfuerzo | Dueño propuesto |
|---|---------|:------:|:---------:|:--------:|-----------------|
| 1 | Param spec → knob/select + registro + write-back (y el *mirror* a `engineState.params`) | 3 (+1 muerta) | **alta** | 3-4 commits | `src/engines/engine-param-grid.ts` + nuevo `commitParam` |
| 2 | Velocity + accent → ganancia de la voz | 6 + 1 dueño ignorado | media | 2-3 commits | `src/core/velocity-gain.ts` (nuevo `velGain01`) |
| 3 | Segundos de un compás (bar ↔ sec) | 4 en Performance (+2 divergentes) | media | 2-3 commits | `src/core/song-position.ts` `songBarSec` |
| 4 | Pasos por compás de la automatización del clip | 6 literales `16` | media | 3 commits | nuevo `src/core/clip-envelope-length.ts` |
| 5 | Segundos de una iteración del clip (`clipDurSec`) | 4 | media | 1-2 commits | `src/core/launch-timing.ts` `clipRegionSec` |

---

## 1. Param spec → control de UI, registro y write-back (severidad ALTA)

### El concern

Recorrer `engine.params`, construir un knob o un select por spec, registrarlo bajo el id canónico
`${ctx.laneId}.${spec.id}` vía `ctx.registerKnob`, y escribir el valor de vuelta con `engine.setBaseValue`.
**Y — crucialmente — espejar la edición en `lane.engineState.params`, que es el único vehículo por el que
un valor de knob llega a un save.**

### Las copias

| Fichero:línea | Qué hace | ¿Espeja a `engineState.params`? | Motores que sirve |
|---|---|:---:|---|
| [engine-ui.ts:33](../../../src/engines/engine-ui.ts) `wireEngineParams` | recorre specs, knob o `createSelectControl` | **SÍ** (`mirrorParamChange` en :56 continuo, :79 discreto) | subtractive ([knob-mounting.ts:92](../../../src/app/knob-mounting.ts)), drums ([drum-voice-rack.ts:100,103,106](../../../src/engines/drum-voice-rack.ts)), sampler ([sampler-worklet-engine.ts:673,687,718](../../../src/engines/sampler-worklet-engine.ts)), audio ([audio-worklet-engine.ts:141](../../../src/engines/audio-worklet-engine.ts)), clip gain ([clip-waveform-header.ts:255](../../../src/session/clip-editors/clip-waveform-header.ts)) |
| [engine-param-grid.ts:28](../../../src/engines/engine-param-grid.ts) `buildControl` / :74 `buildEngineParamGrid` | mismo recorrido, mismo id, mismo `setBaseValue`, + layout por grupos | **NO** — cero llamadas a `mirrorParamChange` en todo el fichero | fm, wavetable, karplus, westcoast, tb303 (vía [worklet-lane-engine.ts:332](../../../src/engines/worklet-lane-engine.ts)) |
| [worklet-lane-engine.ts:306](../../../src/engines/worklet-lane-engine.ts) | tercera copia a mano del mismo pegamento: knob `VOICES` (`createKnob` + `ctx.registerKnob` + `setBaseValue`) | **NO** → `poly.voices` tampoco persiste | todos los poly |
| [knob-mounting.ts:66](../../../src/app/knob-mounting.ts) `wireLaneKnobs` | delegación de 2 líneas a `wireEngineParams` | (hereda) | **NINGUNO — código muerto**, sin llamantes; su import de `mirrorParamChange` en :11 tampoco se usa |

Contexto que cierra el círculo:

- [session-engine-state.ts:14](../../../src/session/session-engine-state.ts) `mirrorParamChange` es el
  **único escritor** de `lane.engineState.params` en todo `src/` (verificado por grep).
- [session-host-persistence.ts:171](../../../src/session/session-host-persistence.ts) `collectEngineState`
  refresca solo modulators/noteFx/mixer, y su docstring en :155-158 afirma un invariante ahora **falso**:
  *"Params are mirrored live on every knob change"*.
- La rejilla **no está desabastecida de datos**:
  [session-host-lane-editor.ts:146](../../../src/session/session-host-lane-editor.ts) pasa
  `sessionState: self.state` a `buildParamUI` para **todos** los motores. La rejilla recibe
  `ctx.sessionState` y lo ignora.
- Orden de restauración: [session-host-persistence.ts:101-103](../../../src/session/session-host-persistence.ts)
  aplica `enginePresetName`, y :105 `applyEngineState` →
  [apply-lane-engine-state.ts:49-54](../../../src/export/apply-lane-engine-state.ts) reproduce
  `es.params` con `setBaseValue` **después** del preset. Es decir: el mirror es lo único que puede
  sobreponerse a un preset.
- [worklet-lane-engine.ts:254](../../../src/engines/worklet-lane-engine.ts) `setBaseValue` actualiza su
  `ParamBag` privado y postea al worklet; nunca toca `sessionState`.

### En qué difieren (más allá del mirror)

Ambos constructores honran campos del *mismo* `EngineParamSpec` de forma distinta:

- **`spec.unit`**: la rejilla formatea `${v.toFixed(2)}${unit}` ([engine-param-grid.ts:66](../../../src/engines/engine-param-grid.ts));
  `wireEngineParams` ignora `unit` por completo y `mountSubtractiveLaneKnobs` no pasa formatter → las
  unidades declaradas de subtractive (`'¢'`, `'st'`) **nunca se pintan**.
- **`step`**: la rejilla cuantiza a `(max-min)/200` ([engine-param-grid.ts:60](../../../src/engines/engine-param-grid.ts));
  `engine-ui.ts` lo deja `undefined` y `knob.ts:198` solo cuantiza si es truthy → granularidad de arrastre
  distinta según la familia de motor.
- **`knobSize`** existe solo en `engine-ui.ts`; el **layout por grupos** solo en la rejilla.
- La rejilla clampa el índice discreto ([engine-param-grid.ts:38](../../../src/engines/engine-param-grid.ts));
  `engine-ui.ts:66-67` no.
- **Render de discretos: NO tocar.** `engine-ui.ts` manda todo discreto a `createSelectControl`; la rejilla
  lo pinta como knob salvo `selectStyle:'dropdown'`. Esto es **deliberado y está comentado**
  ([engine-param-grid.ts:32-35](../../../src/engines/engine-param-grid.ts)) y fijado por dos tests
  ([engine-param-grid.test.ts:43-64](../../../src/engines/engine-param-grid.test.ts)). Unificarlo
  regresaría visuales aprobados: debe sobrevivir como flag por spec.

### Síntoma visible

**Giras un knob en una pista FM, Wavetable, Karplus, Westcoast o TB-303, guardas la sesión, la recargas — y
el ajuste ha desaparecido**: la pista vuelve a su `enginePresetName` (o a los defaults del renderer si no
tiene preset). El mismo ajuste en una pista Subtractive, Drums, Sampler o Audio **sí** sobrevive. Y
`poly.voices` no persiste en ninguna. No está registrado en
[REMAINING-WORK.md](../REMAINING-WORK.md): es un bug vivo y sin documentar.

> Ojo, dos afirmaciones que **NO** se sostienen y que no hay que usar para vender el fix: (a) el export
> offline **no** conserva el ajuste — `OfflineSceneRecorder` construye motores nuevos y aplica preset +
> `engineState` antes de leer `getParamBag` ([offline-recorder.ts:140-171,272,310](../../../src/export/offline-recorder.ts)),
> así que pierde el tweak exactamente igual que la recarga; no hay desacuerdo live-vs-export (solo una
> grabación de take en vivo lo conservaría). (b) La divergencia de render de discretos es diseño, no drift.

### Dueño único propuesto

`buildEngineParamGrid` se queda como **el** constructor, y el mirror deja de ser opcional al moverse a un
seam que ninguna ruta de UI puede olvidar:

```ts
// NUEVO: src/engines/engine-param-commit.ts  (~15 líneas)
import { mirrorParamChange } from '../session/session-engine-state';
import type { EngineUIContext } from './engine-types';

/** Único punto de escritura de un param desde la UI: motor + mirror a engineState.
 *  Toda ruta de UI (grid, VOICES, sampler, drums, clip gain) pasa por aquí. */
export function commitParam(
  engine: { setBaseValue(id: string, v: number): void },
  ctx: EngineUIContext,
  paramId: string,
  value: number,
): void {
  engine.setBaseValue(paramId, value);
  if (ctx.sessionState) mirrorParamChange(ctx.sessionState, ctx.laneId, paramId, value);
}
```

```ts
// src/engines/engine-param-grid.ts — el constructor único
export interface BuildGridOpts {
  skip?: (id: string) => boolean;
  knobSize?: number;                                   // absorbido de wireEngineParams
  formatter?: (specId: string, v: number) => string;   // absorbido de wireEngineParams
  layout?: 'grouped' | 'flat';                         // 'flat' = orden de append antiguo
}
export function buildEngineParamGrid(
  engine: GridEngine, ctx: EngineUIContext, container: HTMLElement, opts?: BuildGridOpts,
): void;
```

(La alternativa más radical — meter el mirror dentro de `WorkletLaneEngine.setBaseValue` — exigiría que el
motor tuviese referencia a `sessionState`, lo que rompe el aislamiento del path offline, que llama
`setBaseValue` sin sesión. `commitParam` es el seam correcto.)

### Plan de colapso

- [ ] **1. Crear `src/engines/engine-param-commit.ts`** con `commitParam` (arriba). Reemplazar los
      `onChange` de `engine-param-grid.ts:48` (select) y `:66` (knob) por `commitParam(engine, ctx, spec.id, …)`,
      y el `onChange` del knob `VOICES` en `worklet-lane-engine.ts:311`. **Se borra**: nada todavía; esto
      solo cierra el agujero de persistencia. *Este paso ya arregla el síntoma y debe ir en su propio commit.*
- [ ] **2. Borrar el código muerto**: `wireLaneKnobs` en `knob-mounting.ts:66-70` y su import de
      `mirrorParamChange` en `knob-mounting.ts:11`. **Se borra**: 1 función + 1 import.
- [ ] **3. Absorber `wireEngineParams` en la rejilla**: añadir `knobSize`, `formatter` y `layout:'flat'` a
      `BuildGridOpts`; conservar la regla de discretos como `spec.selectStyle === 'dropdown'` **más** un nuevo
      `layout:'flat'` que enrute los discretos a `createSelectControl` para los llamantes que hoy usan
      `wireEngineParams` (así drums/sampler/audio no cambian de aspecto). Migrar los 5 llamantes
      (`knob-mounting.ts:92`, `drum-voice-rack.ts:100,103,106`, `sampler-worklet-engine.ts:673,687,718`,
      `audio-worklet-engine.ts:141`, `clip-waveform-header.ts:255`).
- [ ] **4. Borrar `wireEngineParams`** de `engine-ui.ts` (líneas 27-86) junto con `WireEngineParamsOptions`
      y el import de `mirrorParamChange` en `engine-ui.ts:15`. **Se borra**: la segunda copia entera del
      recorrido de specs, los dos `mirrorParamChange` inline (:56, :79) y el fichero queda solo con
      `EngineUIContext`/tipos si algo más los usa.
- [ ] **5. Corregir el docstring miente** en `session-host-persistence.ts:155-158`: ahora el invariante *sí*
      es cierto, pero debe nombrar `commitParam` como el garante.

### Tests que lo prueban

Romperán y hay que actualizar: [engine-ui-knobsize.test.ts](../../../src/engines/engine-ui-knobsize.test.ts)
(desaparece `wireEngineParams`), [engine-param-grid.test.ts](../../../src/engines/engine-param-grid.test.ts)
(nuevas opciones), [session-inspector-registerknob.test.ts](../../../src/session/session-inspector-registerknob.test.ts),
[drum-voice-rack.test.ts](../../../src/engines/drum-voice-rack.test.ts),
[sampler-pad-params.test.ts](../../../src/engines/sampler-pad-params.test.ts).

Casos nuevos (aserciones **relativas**, sin magnitudes absolutas):

- [ ] `session-host-save.test.ts` › **"a knob turned on every worklet engine survives getStateForSave"** —
      parametrizado sobre `['fm','wavetable','karplus','westcoast','tb303','subtractive']`: girar un param,
      `getStateForSave()`, y aserción de que `engineState.params[id]` está presente y **difiere** del default
      del spec (`expect(saved).not.toBe(spec.default)`), nunca "es 0.42".
- [ ] `engine-param-grid.test.ts` › **"buildEngineParamGrid mirrors into sessionState"** — el mismo test que
      hoy existe para `wireEngineParams`, aplicado a la rejilla.
- [ ] `worklet-lane-engine.test.ts` › **"poly.voices is mirrored into engineState"**.
- [ ] `engine-param-commit.test.ts` (nuevo) › **"commitParam is a no-op on sessionState when ctx.sessionState is absent"**
      (el path offline no debe petar).
- [ ] `engine-param-grid.test.ts` › **"discrete specs without selectStyle:'dropdown' still render as knobs"** —
      test de regresión que impide "unificar" el render aprobado.

### Esfuerzo y radio de impacto

**3-4 commits** (el paso 1 solo, aislado y mergeable ya; 2-4 juntos). Radio: `src/engines/` (todos los
motores con param UI), `src/session/` (inspector + persistencia + lane editor), `src/app/knob-mounting`,
`src/export/apply-lane-engine-state` (lector del otro lado), y `src/automation/destination-registry`
(los ids registrados no deben cambiar — si cambian, se rompen los pickers de modulación).

### Cómo verificarlo a mano

1. `npm run dev`, vista **Session**, añade una pista y ponle engine **Karplus**.
2. Abre el editor de pista y mueve el knob `STRING DAMPING` a un extremo bien audible.
3. **File → Save** (o el botón de guardado) → recarga la página → carga la sesión.
4. Antes del fix: el knob vuelve a su sitio de preset. Después: se queda donde lo dejaste.
5. Repite con una pista **Subtractive** para comprobar que el path que ya funcionaba sigue funcionando.

---

## 2. Velocity + accent → ganancia de la voz (severidad MEDIA)

### El concern

"velocity de la nota + flag de accent → la ganancia de amplitud de esta voz, calculada una vez al spawn".
[velocity-gain.ts:33](../../../src/core/velocity-gain.ts) es el dueño declarado
(`velGain = velToGain(v) * (accent ? ACCENT_PUNCH : 1)`, curva `0.3 + 1.1·v`, `ACCENT_PUNCH = 1.1`).
**Ningún fichero de `src/audio-dsp/` lo importa** (verificado por grep sobre todo `src/`): los seis
renderers del worklet reinlinean su propia versión, con tres fórmulas distintas.

El seam de arriba confirma que no hay doble aplicación:
[worklet-lane-engine.ts:138](../../../src/engines/worklet-lane-engine.ts) envía
`velNorm(resolveVelocity(o.velocity, accent))` — velocity normalizada cruda, **accent NO plegado** — así que
cada renderer *tiene* que aplicar la curva por su cuenta.

### Las copias

| Fichero:línea | Fórmula | Curva | Accent |
|---|---|:---:|:---:|
| [velocity-gain.ts:33](../../../src/core/velocity-gain.ts) | `velToGain(v) * (accent?1.1:1)` — **el dueño** | `0.3+1.1v` | 1.1 |
| [fm-renderer.ts:94](../../../src/audio-dsp/fm-renderer.ts) | `note.velocity * (note.accent ? 1.3 : 1)` | **ninguna** | 1.3 |
| [karplus-renderer.ts:131](../../../src/audio-dsp/karplus-renderer.ts) | `note.velocity * (note.accent ? 1.3 : 1)` | **ninguna** | 1.3 |
| [wavetable-renderer.ts:87](../../../src/audio-dsp/wavetable-renderer.ts) | `(0.3 + 1.1*v) * (accent?1.1:1.0)` | `0.3+1.1v` | 1.1 |
| [subtractive-renderer.ts:144](../../../src/audio-dsp/subtractive-renderer.ts) | `synthTrim × output.trim × (0.3+1.1v) × (accent?1.1:1.0)`; :141-142 reescribe la fórmula del dueño **en prosa** | `0.3+1.1v` | 1.1 |
| [westcoast-renderer.ts:251](../../../src/audio-dsp/westcoast-renderer.ts) | `(0.3+1.1v) * accentMul`, con `accentMul=1.3` definido en :221 y **reutilizado como timbre** en :222 (`driveGain`) y :233 (`cutoffEnvScale`) | `0.3+1.1v` | 1.3 |
| [tb303-renderer.ts:27](../../../src/audio-dsp/tb303-renderer.ts) (aplicado en :108) | `velGain()` privado + `ACCENT_VCA = 1.3` | `0.3+1.1v` | 1.3 |

Llamantes vivos del dueño: solo drums ([drums-worklet-engine.ts:217](../../../src/engines/drums-worklet-engine.ts))
y sampler ([sampler-worklet-engine.ts:437](../../../src/engines/sampler-worklet-engine.ts)) — que además
plegan el accent **en el hilo principal** y envían la ganancia ya plegada, mientras los melódicos envían
velocity cruda y la pliegan seis veces dentro del worklet: **dos convenciones sobre *dónde* se pliega**.
[polysynth.ts:211](../../../src/polysynth/polysynth.ts) es la rama legacy `ensureExtraPoly` y
[synth.ts:93](../../../src/core/synth.ts) está muerto para playback (TB303 se importa solo como tipo).

### En qué difieren

Tres fórmulas incompatibles para la misma entrada:

- **La curva.** fm/karplus usan `v` pelada; wavetable/subtractive/westcoast/tb303 usan `0.3 + 1.1·v`.
  Normalizado al `v=1.0` de la propia pista, un `v=0.3` es **−10,5 dB** en FM/Karplus y **−6,9 dB** en las
  demás; y `v→0` llega a silencio real en FM/Karplus frente a un suelo de −13,4 dB (`0.3/1.4`) en el resto.
- **El factor de accent.** 1.1 (= `ACCENT_PUNCH`) en wavetable/subtractive vs 1.3 en
  fm/karplus/westcoast/tb303: **+0,83 dB vs +2,28 dB** para el mismo flag.
- **Westcoast conflaciona** su multiplicador de accent de *loudness* con el de *timbre*.

Que es **drift y no diseño** lo demuestra el propio repo: el commit `b452eee` migró `fm.ts`, `karplus.ts` y
`wavetable.ts` a llamar al `velGain(...)` compartido; el port al AudioWorklet reinlineó las matemáticas por
renderer y fm/karplus **perdieron la curva** en el camino. Westcoast es la prueba más fina: el legacy
`westcoast.ts:263-264` mantenía `accentMul = 1.3` (timbre) **separado** de `vel = velGain(...)` (loudness),
y la cabecera del renderer dice que "mirrors WestVoice.trigger exactly" mientras :251 los colapsa.

**La única excepción legítima** es tb303: [tb303-renderer.ts:20-26](../../../src/audio-dsp/tb303-renderer.ts)
documenta que una diode ladder pierde nivel cuando sube la Q, así que con 1.1 el accent salía *más bajo* que
la nota que debía reforzar. Eso debe sobrevivir como **parámetro explícito**, no como función local sombreada.

Y hay un obstáculo real de API que explica (sin justificar) el inlineado: `velGain()` toma 0..127 y normaliza
por dentro, mientras `NoteSpec.velocity` ya viene 0..1.

### Síntoma visible

El mismo MIDI a la misma velocity suena **más alto o más bajo según el motor de la pista**, y sobre todo la
*forma* de la respuesta a velocity difiere: los pasajes suaves de un MIDI importado **desaparecen** en una
pista FM/Karplus y sobreviven en una Wavetable/Subtractive, así que reapuntar el mismo clip a otro motor
cambia su dinámica. Los accents pegan 1,45 dB más en FM/Karplus/Westcoast/303 que en Wavetable/Subtractive,
o sea que la programación de accents no traduce al cambiar de motor.

Honestamente: la parte **constante** del desajuste ya está tapada un piso más abajo por
[gain-staging.ts:22-34](../../../src/audio-dsp/gain-staging.ts), afinado de oído **con estas fórmulas puestas**
(karplus subió 0.8→1.2 porque "sat too quiet vs the other engines"). Eso es el drift siendo maquillado en otra
capa, no ausente — pero significa que el titular "FM/Karplus están 6 dB bajos" **no** se sostiene tal cual.
Lo que un trim constante no puede absorber es la forma de la curva. Nada lo guarda:
[dsp-battery.ts:112](../../../test/dsp-battery.ts) solo asegura "accent raises RMS", cierto con 1.1 y con 1.3.

### Dueño único propuesto

```ts
// src/core/velocity-gain.ts — añadir el hermano de dominio 0..1
export const ACCENT_PUNCH = 1.1;
/** El accent del TB-303 también sube la Q, y una diode ladder PIERDE nivel al subir
 *  la Q (su feedback se resta), así que 1.1 dejaba el accent más bajo que la nota.
 *  Ver tb303-renderer.ts:20-26. */
export const ACCENT_VCA_LADDER = 1.3;

/** Hermano 0..1 de velGain: NoteSpec.velocity ya viene normalizada.
 *  `accentMul` deja que un motor declare su propio punch de amp (nunca de timbre). */
export function velGain01(v01: number, accent: boolean, accentMul = ACCENT_PUNCH): number {
  const g = 0.3 + 1.1 * Math.max(0, Math.min(1, v01));
  return accent ? g * accentMul : g;
}
```

### Plan de colapso

- [ ] **1. Añadir `velGain01` + `ACCENT_VCA_LADDER`** a `src/core/velocity-gain.ts` y un test de identidad
      (`velGain01(velNorm(v), a) === velGain(v, a)`). **Se borra**: nada.
- [ ] **2. Colapsar las cuatro copias fieles.** `wavetable-renderer.ts:87`, `subtractive-renderer.ts:144`,
      `westcoast-renderer.ts:251` y `tb303-renderer.ts:108` pasan a `velGain01(note.velocity, note.accent[, ACCENT_VCA_LADDER])`.
      **Se borra**: la función privada `velGain` de `tb303-renderer.ts:27-31` y su `const ACCENT_VCA`
      (el comentario :17-26 se traslada al nuevo `ACCENT_VCA_LADDER`), el comentario en prosa de
      `subtractive-renderer.ts:141-142`, y los cuatro `(0.3 + 1.1 * …)` inline. Cambio de sonido: **cero**
      (numéricamente idéntico) → los golden WAV no se mueven. *Commit propio y verificable.*
- [ ] **3. Desconflacionar westcoast.** Separar `accentMul` (timbre, 1.3, se queda en :221-233) del punch de
      amp, que pasa a ser `ACCENT_PUNCH` vía `velGain01`, restaurando `westcoast.ts:263-264`. **Se borra**:
      el uso de `accentMul` en :251. Esto **sí** cambia el sonido de los accents de westcoast.
- [ ] **4. Arreglar la regresión de fm/karplus.** `fm-renderer.ts:94` y `karplus-renderer.ts:131` pasan a
      `velGain01(note.velocity, note.accent)`, recuperando la curva perdida en el port. **Se borra**: los dos
      `note.velocity * (note.accent ? 1.3 : 1)`. Esto **sube el nivel medio** de ambos motores → hay que
      **re-afinar `ENGINE_TRIM.fm` y `ENGINE_TRIM.karplus`** en `gain-staging.ts:23-34` (medir, no adivinar)
      y luego `npm run test:wav-bless` + commit de `test/golden/`.

### Tests que lo prueban

Romperán / hay que revisar: los renders de `test/output/` de fm y karplus contra `test/golden/`
(`npm run test:wav-diff` primero, `test:wav-bless` después, deliberadamente),
[modulation-pipeline.test.ts](../../../src/audio-dsp/modulation-pipeline.test.ts) si algún umbral relativo
quedaba justo, y [velocity-gain.test.ts](../../../src/core/velocity-gain.test.ts) (se amplía).

Casos nuevos, todos con **ratios**:

- [ ] `velocity-gain.test.ts` › **"velGain01 agrees with velGain over the MIDI domain"** — para varias
      velocities, `velGain01(velNorm(v), a) / velGain(v, a)` ≈ 1.
- [ ] `test/dsp-battery.ts` › **"velocity response shape is the same across engines"** (nuevo caso de la
      batería estándar): renderizar la misma nota a `v=0.3` y a `v=1.0` y aserción de que la **ratio**
      `rms(0.3)/rms(1.0)` de cada motor cae dentro de un factor de la del motor de referencia — nunca un
      dBFS absoluto. Éste es el test que hoy no existe y que habría pillado el port.
- [ ] `test/dsp-battery.ts` › **"accent gain ratio is consistent across engines"** —
      `rms(accent)/rms(noAccent)` comparable entre motores, con tb303 declarado como excepción esperada.
- [ ] `westcoast-fold.test.ts` › **"accent brightens the fold without doubling the amp punch"** — que el
      centroide espectral suba con accent **más** de lo que sube el RMS.

### Esfuerzo y radio de impacto

**2-3 commits** (el paso 2 es gratis y sin riesgo; 3 y 4 cambian sonido). Radio: `src/audio-dsp/` (los 6
renderers), `src/audio-dsp/gain-staging.ts`, `test/golden/`, los demos horneados (`src/demo/` — su balance
se afinó con las fórmulas viejas) y los presets con `output.trim` de fm/karplus.

### Cómo verificarlo a mano

1. `npm run dev`. Importa un MIDI con dinámica real (**⬇ MIDI** → *Choose File* → **Import MIDI** → **Sustituir**).
2. Vista **Session** → `▶ MIDI Import`. Escucha en **Chrome real**, no en el navegador de VS Code.
3. Pon el engine de una pista en **Karplus** y luego en **Wavetable** sin tocar el fader: hoy las notas más
   suaves se caen en Karplus y no en Wavetable. Después del fix, la dinámica se mantiene al cambiar de motor.
4. Programa un accent en un clip y alterna FM ↔ Wavetable: hoy el pinchazo del accent es notablemente más
   agresivo en FM.

---

## 3. Segundos de un compás — bar ↔ sec (severidad MEDIA)

### El concern

"¿Cuántos segundos dura un compás?". [song-position.ts:8](../../../src/core/song-position.ts)
`songBarSec(bpm, meter)` es el dueño declarado y consciente del compás. El subsistema
Performance/Arrangement lo reimplementa **cuatro veces** con un `4` literal de negras por compás.

### Las copias

| Fichero:línea | Expresión | ¿Meter-aware? | Consumidores |
|---|---|:---:|---|
| [song-position.ts:8](../../../src/core/song-position.ts) `songBarSec` | `ticksPerBar(meter) * secPerTick` | **sí** — dueño | [global-loop.ts:21](../../../src/core/global-loop.ts), [session-host.ts:348,360](../../../src/session/session-host.ts) |
| [arrangement-ops.ts:151](../../../src/performance/arrangement-ops.ts) `barSec` (privada) | `(60/bpm)*4` | no | :156, :166-168, :192, :208 |
| [performance-ui-templates.ts:22](../../../src/performance/performance-ui-templates.ts) `barSecOf` | `(60/bpm)*4` — **segunda definición idéntica, otro nombre** | no | :35, :107, :154-156, :184-185, :198, :214-216, :221 |
| [performance-feature.ts:261](../../../src/app/performance-feature.ts) | `(60 / arrangement.bpm) * 4` inline (default de `loopEndBar`) | no | — |
| [performance-feature.ts:476](../../../src/app/performance-feature.ts) | `(60 / (arrangement.bpm \|\| seq.bpm)) * 4` inline (playhead RAF) | no | — |
| [arrangement-from-session.ts:18](../../../src/performance/arrangement-from-session.ts) | `(60/bpm)*quartersPerBar(meter)` | **sí** | pero lo consumen las copias 4/4 de arriba |
| [session.ts:68](../../../src/session/session.ts) `audioClip()` | `(4*60)/opts.bpm` hardcoded | no | mientras la rama hermana en [session-host-audio-import.ts:89-94](../../../src/session/session-host-audio-import.ts) **sí** pasa `seq.meter` a `audioChannelClip` |

`performance-ui.ts:84` importa `barSecOf` — eso es **reuso**, no copia.

### En qué difieren

Negras-por-compás es el literal `4` en todo Performance/Arrangement y `quartersPerBar(meter)` en core. La
divergencia es **estructural, no accidental**: `ArrangementState`
([performance.ts:28-41](../../../src/performance/performance.ts)) lleva `bpm` y **ningún campo de meter**, así
que la vista no *puede* ser meter-aware. Encima, `arrangement-ops` y `performance-ui-templates` definen la
misma función 4/4 dos veces con dos nombres, y `performance-feature` la inlinea otras dos en vez de importar
ninguna de las dos.

### Síntoma visible (latente: requiere un compás ≠ 4/4)

[performance-feature.ts:268](../../../src/app/performance-feature.ts) escribe los compases del loop A–B de
Performance directamente en el loop global de la escena (`sessionHost.setGlobalLoop`, que los guarda crudos en
`scene.globalLoopStartBar/EndBar`, [session-host.ts:279-290](../../../src/session/session-host.ts)). Session
decodifica esos números con `songBarSec(bpm, meter)` y Performance con `(60/bpm)*4`: **a 120 bpm en 3/4 la
misma llave loopea 6 s de música en Session y 8 s en Performance** — y no es solo dibujo,
[performance-feature.ts:418](../../../src/app/performance-feature.ts) entrega `arrangementLoopWindowSec` al
runtime como loop de reproducción real.

Segundo desacuerdo, dentro del propio subsistema: `arrangementFromSession` coloca las secciones con la
longitud de compás **correcta** (llamada con `seq.meter` en
[performance-feature.ts:352](../../../src/app/performance-feature.ts)) mientras todo lo que dibuja, etiqueta,
loopea y mueve el playhead usa la 4/4 → una escena de 4 compases en 3/4 aterriza en 6 s y se pinta con 3
compases de ancho bajo una regla de 2 s/compás.

Nada de esto está observado en la UI y ningún test lo cubre: hace falta elegir un compás no-4/4 (alcanzable —
el desplegable de [main.ts:283](../../../src/main.ts) ofrece 3/4, 5/4, 6/8, 7/8, 9/8, 12/8) y entrar en
Performance. En 4/4 todo coincide, que es por lo que ha sobrevivido.

### Dueño único propuesto

`src/core/song-position.ts` `songBarSec(bpm, meter)` como **único** conversor, más un campo de meter en el
estado del arrangement:

```ts
// src/performance/performance.ts
export interface ArrangementState {
  bpm: number;
  meter: TimeSignature;   // NUEVO — sin esto la vista no puede ser meter-aware
  /* … */
}
export function emptyArrangementState(bpm: number, meter?: TimeSignature): ArrangementState;
```

### Plan de colapso

- [ ] **1. Añadir `meter` a `ArrangementState`** y a `emptyArrangementState`, rellenado desde `seq.meter` en
      `arrangement-from-session.ts:17` y en el boot de `performance-feature.ts`. Tocar
      `src/performance/performance.ts`, `arrangement-from-session.ts`, `src/save/` si el arrangement persiste
      en `SavedStateV3.arrangement` (default a `DEFAULT_METER` al cargar: **no hay migraciones**, se decide y
      se sigue).
- [ ] **2. Sustituir las cuatro copias por `songBarSec`.** **Se borra**: la función `barSec` de
      `arrangement-ops.ts:151`, la función `barSecOf` de `performance-ui-templates.ts:22` (y se actualiza el
      import de `performance-ui.ts:84`), el inline de `performance-feature.ts:261` y el de
      `performance-feature.ts:476`. También el `barSec` local de `arrangement-from-session.ts:18` → `songBarSec`.
- [ ] **3. Arreglar `audioClip`.** `session.ts:68` recibe `meter` (o el `barSec` ya calculado) desde
      `session-host-audio-import.ts`, igual que su rama hermana `audioChannelClip`. **Se borra**: el
      `(4*60)/opts.bpm`.
- [ ] **4. Anotar la deuda que NO entra**: `arrangement-ops.ts:175` `subStepsForBars` (`bars*16*SUB_RES`) es
      la automatización del arrangement, indexada por tiempo absoluto y con su propio compás de 4 negras
      ([arrangement-runtime.ts:152](../../../src/performance/arrangement-runtime.ts)). Fue un diferido
      deliberado; dejar un comentario que lo diga y **no** tocarlo aquí.

### Tests que lo prueban

Romperán: [arrangement-ops.test.ts](../../../src/performance/arrangement-ops.test.ts),
[arrangement-from-session.test.ts](../../../src/performance/arrangement-from-session.test.ts),
[performance-ui-render.test.ts](../../../src/performance/performance-ui-render.test.ts),
[performance.test.ts](../../../src/performance/performance.test.ts) (nuevo campo obligatorio en el estado).

Casos nuevos:

- [ ] `arrangement-ops.test.ts` › **"the A–B window in 3/4 matches the session's global loop window"** —
      construir el mismo `[startBar,endBar)` y aserción de que
      `arrangementLoopWindowSec(...).endSec - startSec` **iguala** `globalLoopWindowSec` del core (ratio ≈ 1),
      no un "es 6 s".
- [ ] `arrangement-from-session.test.ts` › **"section placement and ruler agree in 3/4"** — que
      `cursorSec / songBarSec(bpm, meter)` dé un número **entero** de compases.
- [ ] `song-position.test.ts` › **"songBarSec scales with the meter numerator"** — ratio
      `songBarSec(bpm, 3/4) / songBarSec(bpm, 4/4)` ≈ 3/4.
- [ ] `session.test.ts` › **"audioClip lengthBars is meter-aware"** — misma duración de audio en 3/4 da
      **más** compases que en 4/4.

### Esfuerzo y radio de impacto

**2-3 commits.** Radio: todo `src/performance/`, `src/app/performance-feature.ts`, el loop global de
`src/session/session-host.ts` + `src/core/global-loop.ts`, `src/save/` (campo nuevo en el arrangement) y
`session-host-audio-import`.

### Cómo verificarlo a mano

1. `npm run dev`. En las opciones de proyecto, pon el compás a **3/4**.
2. Crea una escena con un clip de 4 compases y arrastra un loop A–B en **Session** (compases 0→4).
3. Cambia a la vista **Performance**: la llave A–B debe cubrir **la misma música**, y la regla debe etiquetar
   el final del loop en el compás 4. Hoy la llave de Performance es un 33 % más ancha en tiempo.
4. Dale al play en Performance y comprueba que el loop repite en el mismo punto musical que en Session.

---

## 4. Pasos por compás de la automatización del clip (severidad MEDIA)

### El concern

Cuántos sub-pasos tiene la envolvente de un clip. [meter.ts:32](../../../src/core/meter.ts)
`stepsPerBar(meter)` es el dueño y los editores de notas **sí** lo usan
([clip-editor-router.ts:353-355](../../../src/session/clip-editors/clip-editor-router.ts)). Todos los caminos
de automatización hardcodean **16** por su cuenta.

### Las copias

| Fichero:línea | Expresión | Rol |
|---|---|---|
| [meter.ts:32](../../../src/core/meter.ts) | `ticksPerBar(m)/TICKS_PER_STEP` | **dueño** (usado por el piano roll) |
| [clip-envelope-ops.ts:14](../../../src/session/clip-envelope-ops.ts) | `clip.lengthBars * 16 * AUTOMATION_SUB_RES` | asignación inicial |
| [clip-automation-lanes.ts:125](../../../src/session/clip-automation-lanes.ts) | `clip.lengthBars * 16` → `ensureLaneSize` (comentado en :119) | resize al renderizar — **tiene `deps.seq` en scope y nunca importa `meter`** |
| [automation-painter.ts:29](../../../src/automation/automation-painter.ts) | `lane.lengthBars * 16 * AUTOMATION_SUB_RES` | longitud esperada **dentro** de `ensureLaneSize` (o sea, el `*16` se calcula dos veces: en el llamante y aquí) |
| [automation-painter.ts:27](../../../src/automation/automation-painter.ts) | `seqLength / 16` | inferencia legacy de `lengthBars` |
| [automation-painter.ts:40](../../../src/automation/automation-painter.ts) | `(lane.lengthBars ?? 1) * 16` | `snapLaneToSteps` |
| [automation-painter.ts:69](../../../src/automation/automation-painter.ts) | `s % 16 === 0` | línea de compás gruesa |
| [session-runtime.ts:462](../../../src/session/session-runtime.ts) | `Math.max(1, clip.lengthBars * 16)` | índice **vivo** — la firma :451-456 no recibe meter |
| [collect-scene-automation.ts:28](../../../src/export/collect-scene-automation.ts) | idéntica | índice **offline**; su cabecera :3-5 admite el espejo |
| [clip-time-scale.ts:18](../../../src/core/clip-time-scale.ts) | `const STEPS_PER_BAR = 16`, usado en :68 y :83 | escalado de tempo |

### En qué difieren

Literal `16` en toda la automatización vs `stepsPerBar(meter)` en los editores de notas — 12 en 3/4, 14 en
7/8, 24 en 12/8. También la cadencia de líneas de compás: `drawLane` pinta la gruesa cada 16 pasos mientras el
piano roll la pinta desde `stepsPerBar`/`stepsPerBeat`.

**La prueba de que es drift y no requisito distinto está dentro de una sola función**:
[session-inspector.ts:734](../../../src/session/session-inspector.ts) llama
`scaleClipTempo(clip, tempoMult, ticksPerBar(this.deps.seq.meter))` — el llamante entrega el compás
**correcto**. Y `scaleClipTempo` usa ese valor meter-correcto para las **notas** (:53) y el `16` hardcoded
para la **envolvente** (:68/:83), en el mismo cuerpo de función.

### Síntoma visible (latente: requiere compás ≠ 4/4)

[lane-scheduler.ts:136](../../../src/core/lane-scheduler.ts) y :230 loopean el clip cada
`clip.lengthBars * ticksPerBar(meter)`, así que un clip de 4 compases en 3/4 loopea cada 48 pasos de
semicorchea mientras `tickSessionEnvelopes` envuelve a los 64. Ambos van con el mismo
`stepDur = 60/bpm/4`, así que el fallo es un **desajuste de periodo de loop**: la envolvente se desliza un
compás por cada vuelta del clip y solo se realinea a los `lcm(48,64) = 192` pasos (4 vueltas).

Sé honesto al reportar esto: **NO** es cierto que "el último cuarto de la envolvente nunca suene" — suena, en
la vuelta siguiente y en la posición musical equivocada. El síntoma de dibujo sí es literal: la lane muestra
64 pasos en 4 "compases" de 16 bajo un clip cuyo piano roll muestra 48 pasos en 4 compases de 12. Live y
offline **coinciden entre sí** (ambos `*16`), así que el export reproduce la misma posición errónea, no una
segunda distinta. Ya está registrado como deuda aceptada en la memoria
`project_session_time_signature` ("automación per-clip quedó 4/4").

Severidad acotada por el hecho de que las seis copias **coinciden en 16**: no han derivado *entre sí*, y en
4/4 (el default y la mayoría abrumadora de sesiones) nada está mal. El peligro real es el que nombra el
patrón: arreglas una y las otras cinco des-indexan en silencio.

### Dueño único propuesto

```ts
// NUEVO: src/core/clip-envelope-length.ts  (~30 líneas, junto a AUTOMATION_SUB_RES)
import { stepsPerBar, type TimeSignature, DEFAULT_METER } from './meter';
import { AUTOMATION_SUB_RES } from './pattern';

/** Pasos de semicorchea que cubre la envolvente de un clip de `lengthBars`. */
export function envelopeStepCount(lengthBars: number, meter?: TimeSignature): number;
/** Longitud del array `values` que esperan todos los consumidores. */
export function envelopeValueLength(lengthBars: number, meter?: TimeSignature): number;
/** Índice de sub-paso al que apunta `elapsedSec`, envolviendo por la longitud del clip. */
export function envelopeSubIndex(
  elapsedSec: number, bpm: number, lengthBars: number, meter?: TimeSignature,
): number;
```

Con eso, asignación, resize, índice vivo, índice offline y escalado de tempo **no pueden** discrepar.

### Plan de colapso

- [ ] **1. Crear `src/core/clip-envelope-length.ts`** con las tres funciones. **Se borra**: nada aún.
- [ ] **2. Colapsar los caminos de datos (sin UI).** `clip-envelope-ops.ts:14` → `envelopeValueLength`;
      `clip-time-scale.ts:68,83` → `envelopeValueLength` derivando `stepsPerBar` del `barTicks` que **ya**
      recibe. **Se borra**: `const STEPS_PER_BAR = 16` de `clip-time-scale.ts:18` (y su comentario :16-17), el
      `* 16 * AUTOMATION_SUB_RES` de `clip-envelope-ops.ts`.
- [ ] **3. Colapsar los índices de reproducción.** Añadir `meter` a la firma de `tickSessionEnvelopes`
      (`session-runtime.ts:451-456` — `automation-tick.ts:73` ya tiene `seq` en scope) y a
      `collectSceneAutomation` (`collect-scene-automation.ts`), ambos usando `envelopeSubIndex`. **Se borra**:
      los dos `clip.lengthBars * 16` y el cálculo manual de `subIdx`, más el comentario "mirrors
      tickSessionEnvelopes' indexing" de `collect-scene-automation.ts:3-5` (ya no hay nada que espejar).
- [ ] **4. Colapsar la UI.** `clip-automation-lanes.ts:125` pasa `envelopeStepCount(clip.lengthBars, deps.seq.meter)`;
      `ensureLaneSize` recibe la longitud esperada **ya calculada** (o el meter) en vez de re-derivarla, y
      `snapLaneToSteps`/`drawLane` reciben `stepsPerBar` para la línea gruesa. **Se borra**: el `* 16 * SUB_RES`
      de `automation-painter.ts:29`, el `seqLength / 16` de :27, el `* 16` de :40 y el `s % 16` literal de :69.

### Tests que lo prueban

Romperán: [clip-envelope-ops.test.ts](../../../src/session/clip-envelope-ops.test.ts),
[clip-automation-lanes.test.ts](../../../src/session/clip-automation-lanes.test.ts),
[clip-time-scale.test.ts](../../../src/core/clip-time-scale.test.ts),
[collect-scene-automation.test.ts](../../../src/export/collect-scene-automation.test.ts),
[session-runtime.test.ts](../../../src/session/session-runtime.test.ts) (firma nueva),
[reconcile-lane-envelopes.test.ts](../../../src/session/reconcile-lane-envelopes.test.ts).

Casos nuevos:

- [ ] `clip-envelope-length.test.ts` (nuevo) › **"envelope length tracks the meter"** — ratio
      `envelopeStepCount(4, 3/4) / envelopeStepCount(4, 4/4)` ≈ 3/4.
- [ ] `session-runtime.test.ts` › **"the envelope loop period equals the clip loop period in 3/4"** — el test
      clave: avanzar el reloj falso una vuelta de clip y aserción de que `subIdx` **vuelve a 0** (mismo
      periodo que `lane-scheduler`), en vez de comprobar un valor concreto.
- [ ] `collect-scene-automation.test.ts` › **"offline envelope indexing matches the live one in 3/4"** —
      comparar las dos secuencias de índices entre sí, no contra constantes.
- [ ] `clip-time-scale.test.ts` › **"notes and envelope keep the same bar count after *2 in 3/4"** — ratio
      `values.length / stepsPerBar` == `lengthBars`.

### Esfuerzo y radio de impacto

**3 commits.** Radio: `src/session/` (envelope ops, automation lanes, inspector, runtime), `src/automation/`
(painter + tick), `src/export/` (automatización offline → hay que re-escuchar un export en no-4/4),
`src/core/clip-time-scale`. **No** entra `src/performance/arrangement-ops.ts:175` (`subStepsForBars`): es otro
modelo de datos con su propio compás de 4 negras, coherente consigo mismo.

### Cómo verificarlo a mano

1. `npm run dev`, compás del proyecto a **3/4**.
2. Crea un clip de 4 compases, dibuja notas en cada compás, abre las **lanes de automatización** y añade una
   envolvente de `filter.cutoff`; dibuja una rampa clara.
3. Hoy: las líneas de compás gruesas de la lane de automatización **no coinciden** con las barras del piano
   roll de arriba, y al dejarlo loopear varias vueltas la rampa se desliza respecto a las notas.
4. Después: las barras se alinean y la rampa vuelve a la misma posición en cada vuelta.

---

## 5. Segundos de una iteración del clip — `clipDurSec` (severidad MEDIA, esfuerzo PEQUEÑO)

### El concern

"Cuántos segundos dura una iteración de este clip". `tickLane` lo calcula integrando el **tempo map** del clip
(y sobre la región del loop global); tres implementaciones más **afirman en sus comentarios** espejarlo y no
honran ni una cosa ni la otra.

### Las copias

| Fichero:línea | Expresión | ¿tempoMap? |
|---|---|:---:|
| [lane-scheduler.ts:90-94](../../../src/core/lane-scheduler.ts) | `laneLoopRegion(clip, meter, ctx.globalLoop)` → `tmap ? tickRangeSec(tmap, …) : (loopTicks/TPQ)*secPerBeat` — **autoridad** | **sí** |
| [launch-timing.ts:26-34](../../../src/core/launch-timing.ts) `clipLoopSec` | `effectiveClipLoop` + multiplicación a bpm constante (:33); su doc :24-25 afirma que "equals the scheduler's clipDurSec exactly" — **falso** | no |
| [scene-duration.ts:19-22](../../../src/export/scene-duration.ts) `clipDurationSec` | misma multiplicación (:21); comentario :12 "Mirrors lane-scheduler's tickLane" — **falso** | no |
| [arrangement-from-session.ts:31-35](../../../src/performance/arrangement-from-session.ts) | ticks→compases (:32) × `barSec` (:35) — tercera ortografía del mismo producto | no |

La resolución de la **región en ticks** ya está canalizada por `core/clip-loop.ts`; lo duplicado es el paso
ticks→segundos **más** la consciencia del tempo map. `clip.tempoMap` lo pone el import de MIDI cuando hay
cambios de tempo ([midi-to-session.ts:104,191](../../../src/midi/midi-to-session.ts)).

### En qué difieren

Solo `lane-scheduler` consulta `clip.tempoMap` (y `ctx.globalLoop`). Las otras tres usan bpm constante. No hay
nada en el sistema de tipos que las ate; en su lugar, dos de ellas llevan comentarios afirmando una paridad
que no tienen. Sin estado duplicado, sin constantes distintas, sin redondeos distintos — por eso queda por
debajo del listón del eje de clip, pero los dos comentarios "yo espejo a tickLane" son drift de manual.

### Síntoma visible

**El export offline es internamente contradictorio con un MIDI multi-tempo.** El contenido viene de
[collect-scene-triggers.ts:41](../../../src/export/collect-scene-triggers.ts) → `tickLane` (integra el tempo
map), mientras la ventana viene de `soundingSceneDurationSec` ([main.ts:1091](../../../src/main.ts) →
`scene-duration.ts:21`, bpm constante). Y peor:
[offline-recorder.ts:101,224](../../../src/export/offline-recorder.ts) renderiza **dos ciclos y devuelve el
segundo**, así que `totalSec` **tiene** que igualar exactamente el `clipDurSec` de `tickLane`. Importa un MIDI
de 32 compases que baje de 120 a 60 bpm en el compás 16: la iteración real son 96 s, la calculada 64 s → el
"segundo ciclo" no es un ciclo, y el WAV exportado empieza a mitad de frase y se trunca. Misma clase, menos
apuesta, para el instante de conmutación de `launchScene`
([session-runtime.ts:192](../../../src/session/session-runtime.ts)) y `seekSession` (:281).

**Refutado — no lo repitas:** el síntoma de loop global ("los clips de audio se re-disparan desde el offset de
buffer equivocado en cada frontera B") es **inventado**. `tickLane` re-deriva `loopStart` por división entera
desde el ancla ([lane-scheduler.ts:102-103](../../../src/core/lane-scheduler.ts)), así que solo importa
`anchor mod P`. Para un clip **sin** loop local — el caso normal — `laneLoopRegion` clampa la región dentro del
clip ⇒ `aSec < P_local` ⇒ `aSec mod P_local === aSec` ⇒ el ancla es **bit a bit idéntica**. Y el offset de
re-disparo está emparejado deliberadamente con `clipLoopSourceRange`
([clip-loop.ts:85-101](../../../src/core/clip-loop.ts), [session-host.ts:324-333](../../../src/session/session-host.ts)),
también basado en `effectiveClipLoop`: **meter `globalLoop` en el helper compartido crearía** una
inconsistencia ahí. Mantener `globalLoop` fuera del dueño.

### Dueño único propuesto

```ts
// src/core/launch-timing.ts  (el dueño existente crece; NO se crea módulo nuevo)
/** Segundos que abarca una región de ticks de un clip, integrando clip.tempoMap
 *  cuando existe. El llamante decide la región — así el scheduler puede pasar la
 *  región del loop GLOBAL sin que globalLoop entre en el helper. */
export function clipRegionSec(
  clip: SessionClip, startTick: number, endTick: number, bpm: number,
): number;

/** Una iteración del loop propio (local) del clip. tempoMap-aware. */
export function clipLoopSec(
  clip: SessionClip, bpm: number, meter?: TimeSignature,
): number;   // = clipRegionSec(clip, ...effectiveClipLoop(clip, meter), bpm)
```

### Plan de colapso

- [ ] **1. Añadir `clipRegionSec` a `src/core/launch-timing.ts`** (mueve ahí la lógica `tmap ? tickRangeSec :
      producto constante`) y reescribir `clipLoopSec` como una llamada a ella. **Se borra**: la multiplicación
      inline de `launch-timing.ts:33` y el comentario falso de `:24-25`.
- [ ] **2. Que el scheduler consuma el dueño.** `lane-scheduler.ts:92-94` pasa a
      `clipRegionSec(clip, startTick, endTick, bpm)` con su región ya resuelta por `laneLoopRegion`. **Se
      borra**: el ternario `tmap ? … : …` de `:92-94` y el import de `tickRangeSec` si queda huérfano.
- [ ] **3. Colapsar los dos consumidores restantes.** `scene-duration.ts:19-22` `clipDurationSec` delega en
      `clipLoopSec`; `arrangement-from-session.ts:31-35` calcula sus segundos de sección con `clipLoopSec` en
      vez de `bars × barSec` (esto se solapa con el candidato 3 — hacerlo **después** de aquél). **Se borra**:
      la multiplicación de `scene-duration.ts:21` y su comentario falso `:12-18`, y el producto de
      `arrangement-from-session.ts:35`.

### Tests que lo prueban

Romperán: [launch-timing.test.ts](../../../src/core/launch-timing.test.ts),
[scene-duration.test.ts](../../../src/export/scene-duration.test.ts),
[offline-seamless-loop.test.ts](../../../src/export/offline-seamless-loop.test.ts),
[lane-scheduler.test.ts](../../../src/core/lane-scheduler.test.ts).

Casos nuevos:

- [ ] `launch-timing.test.ts` › **"clipLoopSec equals the scheduler's iteration for a tempo-mapped clip"** —
      construir un clip con `tempoMap` de dos tramos y aserción de que la **ratio** entre `clipLoopSec` y el
      periodo que `tickLane` realmente usa ≈ 1 (hoy sale ≈ 0,67). Éste es el test que hace imposible el drift.
- [ ] `scene-duration.test.ts` › **"a tempo-mapped clip reports a longer window than its constant-bpm length"** —
      ratio `> 1`, sin segundos absolutos.
- [ ] `offline-seamless-loop.test.ts` › **"the returned cycle starts at the same musical phase as the first"** —
      con tempo map, comparar el arranque de los dos ciclos entre sí.
- [ ] `lane-scheduler.test.ts` › **"global-loop anchoring is unchanged after the collapse"** — test de
      regresión que fija lo refutado: pasar `globalLoop` **no** debe alterar el ancla para un clip sin loop local.

### Esfuerzo y radio de impacto

**1-2 commits** — el más barato de los cinco. Radio: `src/core/lane-scheduler` + `launch-timing` (el corazón
del scheduling: cualquier error aquí se oye de inmediato), `src/export/` (ventana del render offline;
re-escuchar un export de MIDI multi-tempo), `src/session/session-runtime` (launch/seek) y
`src/performance/arrangement-from-session`.

### Cómo verificarlo a mano

1. Consigue/haz un `.mid` con un cambio de tempo a mitad (p. ej. 120 → 60 bpm en el compás 16).
2. `npm run dev` → **⬇ MIDI** → *Choose File* → **Import MIDI** → **Sustituir**.
3. Vista **Session** → `▶ MIDI Import`, y exporta la escena (render offline a WAV).
4. Hoy: el WAV empieza a mitad de frase y/o está truncado respecto a lo que suena en vivo. Después: el WAV
   dura lo mismo que una vuelta real y loopea sin salto.

---

## Descartados en verificación

| Candidato | Motivo del descarte |
|---|---|
| **Escalado de profundidad de modulación / aplicación de offsets a params del motor** — se afirmaba que `connection-binder.ts:47` (genérico, desde el rango del `EngineParamSpec`) era una copia de las matemáticas re-implementadas a mano dentro de los seis renderers | **Refutado en los dos puntos de carga.** (1) Los conjuntos de params son **disjuntos**: en las seis pistas worklet `WorkletVoice.getAudioParams()` devuelve un mapa vacío ([worklet-lane-engine.ts:149](../../../src/engines/worklet-lane-engine.ts)) y [lane-allocator.ts:271-282](../../../src/app/lane-allocator.ts) solo bindea `laneInserts`/`masterInserts`, así que el binder escala `AudioParam`s de FX de insert/master mientras los renderers escalan params DSP del motor — mecanismos distintos (`GainNode` sumando a un `AudioParam` vs `base + offset` dentro del bucle de muestras), y **ningún param pasa por los dos**: no pueden discrepar. (2) La supuesta "deriva" del escalado es **calibración deliberada** y la regla única propuesta sería *errónea*: el nodo LFO es bipolar ±1, así que la regla del binder implica depth 1 ⇒ ±(max−min) (±100 ¢ sobre un detune −50..50 = el doble del knob), mientras los renderers significan a propósito ±el recorrido de un lado, documentado en [subtractive-renderer.ts:53-69](../../../src/audio-dsp/subtractive-renderer.ts). El `* 2` de FM sobre `op*.ratio` es correcto porque ese spec es min 0.1 / max 16 / `curve:'exponential'`; un span lineal derivado del spec (+15,9 sobre un ratio de 1) no tiene sentido musical. No hay convención compartida a la que converger. (3) Los huecos de cobertura son **restricciones documentadas**: karplus pre-renderiza toda la cuerda al spawn ([karplus-renderer.ts:133,157-158](../../../src/audio-dsp/karplus-renderer.ts)), westcoast declara "the contour stays native" (:276-277), subtractive excluye `master.unison` como trigger-time ([worklet-lane-engine.ts:39-41](../../../src/engines/worklet-lane-engine.ts)) — curación, no negligencia. (4) El síntoma **sí es real** (un LFO sobre `amp.level` de Westcoast mueve el ring inertemente) pero es **otro bug**: falta un contrato de capacidades — un conjunto de params modulables declarado por renderer que consulte el catálogo ([automation-targets.ts:118-121](../../../src/automation/automation-targets.ts)) — y colapsar las matemáticas de span **no arregla nada de eso**. Lo único que queda de verdad es pequeño: [wavetable-renderer.ts:105](../../../src/audio-dsp/wavetable-renderer.ts) es el resto verbatim de una extracción **ya hecha** (4 de 6 renderers usan `ModEnvHost`; wavetable nunca se migró), ~18 líneas, idéntico en comportamiento, **sin síntoma observado**: una extracción a medias, muy por debajo del listón del eje de clip. |

---

## Orden recomendado

1. **#1 paso 1 — el mirror de params, aislado (`commitParam`).** Es el único candidato con **pérdida de datos
   del usuario** ya en vivo (un knob girado en 5 de los 9 motores se tira al guardar), la corrección son ~15
   líneas nuevas y tres `onChange` redirigidos, y no cambia ni un píxel ni una muestra de audio. Mejor ratio
   dolor/esfuerzo del informe, con diferencia. Los pasos 2-5 (borrar `wireEngineParams` y `wireLaneKnobs`)
   pueden ir después, sin prisa.
2. **#5 — `clipRegionSec`.** El más barato (1-2 commits), borra dos comentarios que **mienten** sobre paridad
   —el tipo de mentira que hace que el siguiente lector duplique con confianza— y arregla un export
   demostrablemente contradictorio con MIDI multi-tempo.
3. **#2 pasos 1-2 — colapsar las cuatro copias fieles de `velGain`.** Numéricamente idéntico ⇒ riesgo cero,
   golden WAVs intactos, y deja el terreno preparado. Los pasos 3-4 (westcoast desconflacionado, fm/karplus
   recuperando la curva) exigen re-afinar `ENGINE_TRIM` y re-bendecir golden: agéndalos como trabajo de
   **sonido**, con escucha en Chrome real, no como limpieza.
4. **#4 — `envelopeLength`.** Tres commits, seis literales fuera, y cierra deuda ya reconocida
   (`project_session_time_signature`). Va antes de #3 porque los call sites ya tienen el meter en scope
   (`deps.seq`, `automation-tick.ts:73`, `session-inspector`), así que es mecánico.
5. **#3 — `songBarSec` en Performance.** El último porque es el único que exige **cambiar una estructura de
   datos** (`meter` en `ArrangementState`, con su coletazo en `src/save/`) y porque su síntoma es latente:
   solo aparece con un compás ≠ 4/4 en la vista Performance. Hazlo cuando se toque Performance por otra
   razón — y hazlo **antes** del paso 3 de #5, que se solapa con `arrangement-from-session`.
