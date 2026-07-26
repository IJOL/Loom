# Plan maestro — de código acumulado a framework coherente

**Fecha:** 2026-07-26
**Estado:** BORRADOR — pendiente de revisión por Nacho
**Base:** `main` @ `578545d`
**Objetivo declarado:** pasar de código generado por acumulación a un framework coherente y bien ingenierizado.

---

## 1. Diagnóstico

Todo lo que sigue está **medido sobre `main`**, no supuesto. 400 ficheros de producción, 23 subsistemas.

### 1.1 Los dos síntomas estructurales

**No hay capas: 28 pares de subsistemas se importan mutuamente.**

`core` — la supuesta base — importa hacia arriba: `session` (17 veces), `save` (9), `engines` (5), `polysynth` (2), `samples` (2), `presets` (1). El par `core ↔ save` es 9/8, casi perfectamente simétrico. No existe ningún orden en que se puedan apilar estos 23 subsistemas: la base depende del tejado.

> **PRECISIÓN IMPORTANTE (revisión con GitNexus, 2026-07-26).** Estos 28 son ciclos entre **carpetas**, no entre ficheros. A nivel de FICHERO el grafo sólo encuentra **2 ciclos de import reales**:
>
> 1. `lane-allocator.ts → engine-types.ts → history-wiring.ts → saved-state-v3.ts → lane-allocator.ts`
> 2. `performance-ui-templates.ts ↔ performance-ui.ts`
>
> Es una distinción que cambia el diagnóstico y hay que decirla sin adornos: **el código NO tiene una maraña de imports circulares**. Los módulos individuales están razonablemente ordenados. Lo que falta es la **capa declarada**: `core/` y `session/` se importan mutuamente porque son cajones, no porque haya bucles reales.
>
> Consecuencia para el frente 5: su valor no es "desactivar bombas", es **impedir que el desorden crezca** y dar un sitio a cada cosa. Baja de urgencia y sube de disciplina.
>
> Y una confirmación bonita: el ciclo de fichero nº 1 pasa **exactamente** por `engine-types.ts` → el sistema de undo → el guardado → el allocator → vuelta a `engine-types.ts`. Es el frente 2 en una línea: el contrato del motor de audio está enredado con la UI y la persistencia. Arreglarlo lo rompe.

Esto es la firma de código que creció por acumulación: cada función nueva se puso donde cayó y se importó lo que hizo falta.

Los diez peores (`A→B / B→A`):

| Ciclo | Cuenta |
|---|---|
| `session ↔ core` | 125 / 17 |
| `engines ↔ core` | 32 / 5 |
| `app ↔ session` | 30 / 2 |
| `engines ↔ samples` | 20 / 2 |
| `session ↔ samples` | 20 / 4 |
| `automation ↔ session` | 11 / 8 |
| `engines ↔ presets` | 11 / 2 |
| `core ↔ save` | **9 / 8** |
| `session ↔ engines` | 9 / 6 |
| `export ↔ session` | 9 / 2 |

Medido con un script ad-hoc (matriz de imports entre carpetas de primer nivel de `src/`) que **no está versionado**: convertirlo en el test del frente 5 es precisamente parte de ese frente. Los ciclos de FICHERO se comprueban con `check({cycles: true})` de GitNexus, que sí es reproducible hoy.

**El sistema de plugins no es un sistema de plugins: añadir un engine son SEIS registros.**

| # | Mecanismo | Dónde | Si lo olvidas |
|---|---|---|---|
| 1 | `registerEngineFactory(id, fn)` | el fichero del engine | no se puede instanciar |
| 2 | `registerEngine(instance)` | el mismo fichero | no aparece en listados |
| 3 | `import.meta.glob` (por forma) | [plugin-bootstrap.ts](../../../src/app/plugin-bootstrap.ts) | (automático) |
| 4 | `registerRenderer(id, ctor)` | `src/audio-dsp/<id>-renderer.ts` | **silencio al tocar** |
| 5 | import por efecto secundario | [loom-processor.ts](../../../src/audio-worklet/loom-processor.ts) | **silencio al tocar** |
| 6 | `WORKLET_ENGINE_IDS` — un `Set` **a mano** | [lane-allocator.ts:22](../../../src/app/lane-allocator.ts) | **silencio al tocar** |

Los mecanismos 1 y 2 son **dos sistemas de registro coexistiendo** para lo mismo; el propio [registry.ts](../../../src/engines/registry.ts) los documenta como *"1. Singleton (legacy)"* y *"2. Factory (new)"* — una migración que nunca terminó. Y los tres fallos silenciosos son la peor clase de fallo posible: el engine **aparece en el selector** y la pista no suena.

CLAUDE.md ya lo confiesa: *"Add an engine — FOUR steps, not one. Since the worklet cutover, 'drop a file' is NOT enough"*. Documentar la anomalía en vez de eliminarla es, precisamente, el hábito que separa código acumulado de framework.

### 1.2 Los síntomas locales

Cada uno verificado; el detalle está en los frentes.

- **Interfaces que mienten.** `EngineSequencer` completo (interfaz + `buildSequencer` + 5 implementaciones + 2 métodos del `Sequencer`) tiene **cero llamadas**. `Voice` tiene 3 de 5 métodos inertes en el camino vivo, y `release(time)` ignora el tiempo y silencia la pista entera.
- **El DOM en el contrato de audio.** `SynthEngine.buildParamUI(container: HTMLElement)` obliga a que un fichero sobre osciladores importe `lit-html`, `createKnob` y el sistema de undo.
- **Cinco vocabularios para "una nota"** en un solo camino, con dos escalas de velocity y cuatro nombres para la duración. Cuesta funcionalidad: el arpegiador no puede variar la dinámica.
- **Cuatro escritores de params** con políticas de persistencia opuestas y no declaradas en ningún sitio.
- **Estado que vive en el DOM** (~15-20 sitios), uno de ellos un defecto real: el save lee el volumen maestro de un `<input>`.
- **~20 casos especiales por nombre de engine** (`engineId === 'subtractive'`) repartidos por el núcleo.
- **Código muerto que parece vivo:** `PolySynth` se construye entero, con strip y cadena de inserts, para entregárselo a un `setPolySynth` que **ningún engine implementa**.

### 1.3 El criterio

"Bonito por dentro" no es verificable. Se traduce a cuatro leyes, y **cada una lleva su test**. Ese es el salto: hoy estas reglas existen como prosa en comentarios y en CLAUDE.md; un framework las tiene ejecutables.

> **L1 — Dependencias en una sola dirección.** Ningún ciclo entre subsistemas. Cada carpeta declara su capa y sólo importa hacia abajo.
>
> **L2 — Cada interfaz dice la verdad.** Nada declarado sin usar. Nada implementado que sea inerte. Ninguna firma que prometa algo distinto de lo que hace.
>
> **L3 — Una sola forma de hacer cada cosa.** Un dato, un dueño. Una representación por concepto. Un punto de registro por tipo de extensión. Un punto de escritura por destino, con la política declarada ahí.
>
> **L4 — Extender no exige tocar el núcleo.** Añadir un engine, un FX o un modulador es añadir ficheros, nunca editar una lista.

### 1.4 Lo que este plan NO hace

- No toca el AudioWorklet ni el modelo de voces: funciona, está verificado y no se re-litiga.
- No convierte a lit-html el canvas, la geometría del layout ni el drag por `pointermove`.
- No introduce ninguna capa de indirección nueva sobre el DOM. La que hay (`lit-html` + `mountPanel` + `ControlCache`) es la que se usa.
- No introduce un framework MVC formal. El modelo ya existe; lo que falta es dirección única.
- No promete romper los 28 ciclos de golpe (ver frente 5: trinquete, no big-bang).
- No revive `runStandardEngineBattery` ni las baterías WAV.

---

## 2. La arquitectura objetivo

Seis capas. **Una capa sólo importa capas por debajo.** Los 23 subsistemas actuales se asignan a una capa cada uno; no hace falta mover carpetas para empezar, sólo declarar y romper lo que viole la dirección.

```
L5  boot        app/, (root)              cableado y arranque
L4  ui          session/(vistas), performance/, midi/(ui), stems/, control/, perf/, demo/
L3  runtime     runtime/ (scheduler, lane-resources, buses), export/, save/, automation/, modulation/
L2  contracts   engines/ (contrato + registro), plugins/, presets/, samples/, notefx/
L1  model       model/ (NoteEvent, meter, musicality, session types, patterns)
L0  dsp         audio-dsp/, audio-worklet/     DSP puro: sin DOM, sin AudioContext, sin sesión
```

Cambios de nombre y contenido que esto implica:

- **`core/` desaparece como cajón.** Hoy tiene 100+ ficheros que van desde `NoteEvent` (datos puros, L1) hasta `pianoroll.ts` (canvas, L4). Un cajón llamado "core" es *la* señal de que no hay capas. Se reparte entre `model/`, `runtime/` y `ui/`.
- **`session/` se parte en dos**: los tipos y operaciones del modelo (L1) y sus vistas (L4). Hoy están juntos, y es la causa del ciclo más grande (`session ↔ core`, 125/17).
- **`polysynth/` desaparece** (frente 0: está muerto).

**La regla se verifica**, no se confía: `tools/dep-matrix.mjs` pasa a ser un test que falla si aparece un ciclo nuevo o si una capa importa hacia arriba.

---

## 3. Los frentes

Orden pensado para que cada uno destrabe al siguiente y para que el riesgo alto llegue con el terreno ya despejado.

### Frente 0 — Código muerto

No cambia comportamiento. Reduce el terreno de todo lo demás.

**0.1 `EngineSequencer` — interfaz zombi completa.** Cero llamadas a `buildSequencer`, `registerEngineSequencer` y `unregisterEngineSequencer`. Se borran los ocho elementos: la interfaz, el método del contrato, las cuatro implementaciones (`SamplerSequencer`, `DrumsSequencer`, `AudioSequencer`, `inertSequencer`), el stub de `WorkletLaneEngine` y los dos métodos de `Sequencer`.

**0.2 `PolySynth` — ramas protegidas por casts a métodos inexistentes.** Ningún engine implementa `getPolySynth`/`setPolySynth` (cero definiciones en `src/engines/` y `src/polysynth/`), pero cuatro sitios las invocan tras un cast defensivo: [main.ts:198](../../../src/main.ts), [main.ts:744](../../../src/main.ts), [lane-allocator.ts:176](../../../src/app/lane-allocator.ts), [preset-apply.ts:29](../../../src/presets/preset-apply.ts), [session-host-lane-editor.ts:38](../../../src/session/session-host-lane-editor.ts). Peor: `ensureExtraPoly` ([lane-allocator.ts:163](../../../src/app/lane-allocator.ts)) construye un `PolySynth` completo con su `ChannelStrip` y su `InsertChain`, y se lo intenta pasar al `setPolySynth` inexistente. Queda conectado al grafo de audio sin que nada pueda dispararlo.

> **⛔ VERIFICAR ANTES DE BORRAR:** `ensureExtraPoly` se dispara si algo pide una lane con id `poly1..poly16` (`EXTRA_IDS`). Con el modelo de lanes actual los ids son `subtractive-1`, así que probablemente nunca ocurre — pero se confirma con una traza, no se asume. Si estuviera vivo, este punto cambia de "borrar" a "arreglar".

Si está muerto: fuera `ensureExtraPoly`, los cinco casts, `polysynth.ts` y satélites (`poly-preset-apply`, `poly-preset-store`, `polysynth-presets`) y los 6 tests que sólo prueban la clase muerta.

**0.3 Restos menores.**
- `core/synth.ts` (clase `TB303`) — sólo la construye su test; los tres importadores vivos la usan **sólo como tipo**. El sonido lo hace `TB303Renderer`, otra clase.
- `ParamDef` ([engine-types.ts:5](../../../src/engines/engine-types.ts)) — alias de compatibilidad con cero usos.

> **NO se borra `test/dsp-battery.ts`.** Un borrador anterior de este plan lo metía aquí; era un error de categorización. Ver frente 0.5.

**Verificación:** `npx tsc --noEmit` + `npm run test:unit` en verde.

---

### Frente 0.5 — Revivir la batería DSP (PRECONDICIÓN de los frentes 2 y 3)

**Dos cosas sin uso no son la misma cosa.** `EngineSequencer` está muerto *y no debería existir*: nadie quiere ese concepto. `runStandardEngineBattery` está muerto *y debería estar vivo*: es la red de seguridad para refactorizar audio, y este plan reescribe el camino de la nota.

**Por qué murió — un accidente, no una decisión.** La batería construye sus voces así:

```ts
const voice: Voice = engine.createVoice(ctx as unknown as AudioContext, output);   // dsp-battery.ts:40
```

Es el camino **node-per-note**. Tras el cambio al worklet, `createVoice` devuelve un `WorkletVoice` cuyo `trigger()` es un `postMessage` a un procesador que no existe bajo `OfflineAudioContext`: renders en silencio. Sus llamadores no se retiraron por criterio, dejaron de funcionar.

**Lo que aporta** (cinco comprobaciones, todas relativas, como manda el proyecto):

| Comprobación | Assertion |
|---|---|
| suena al disparar | `!isSilent && peak > 0.01` |
| no clipea con params al máximo | `peak < 1.0` |
| abrir el cutoff abre el timbre | `centroide(hi) > centroide(low) * 2` |
| el accent sube el nivel | `rms(accent) > rms(normal)` |
| el release corta el gate | `rms(cola) < rms(cabeza) * 0.1` |

**Cambio:** reapuntar la batería del `OfflineAudioContext` al **kernel puro**. La infraestructura ya existe, porque el exportador offline la necesitaba: `WorkletLaneEngine.getParamBag()` y `getModLite()` entregan exactamente lo que el kernel lee, y hay dos tests que ya conducen el kernel muestra a muestra ([audio-dsp/drums/new-voices.dsp.test.ts](../../../src/audio-dsp/drums), [modulation-scope.dsp.test.ts](../../../src/audio-dsp)).

Al reapuntarla se reconecta a los **9 engines**, no sólo a los que la tenían antes.

**Sobre los goldens:** los 90 WAV de `test/golden/` se renderizaron con el camino node-per-note, así que como referencia byte a byte ya no valen. Se re-bendicen una vez (`npm run test:wav-bless`) contra el camino actual y se commitean. `test/output/` (137 WAV de una ejecución vieja) está en `.gitignore` y se regenera solo.

**Reparto de papeles, que hoy está confundido:**
- Las **cinco assertions relativas** son la red automática: fallan y paran el refactor.
- Los **WAV + `wav-diff`** son inspección humana: hoy `wav-diff` nunca falla CI a propósito, y así se queda. Sirve para mirar un delta de peak/RMS cuando una assertion pasa pero algo suena raro.

**Por qué va antes que los frentes 2 y 3:** el frente 2 cambia el contrato de `Voice` y el 3 reescribe el camino de la nota. Sin esta batería, la única verificación de que los nueve engines siguen sonando igual es escucharlos a mano uno por uno.

**Riesgo:** bajo. Es test, no producción. Si al revivirla alguna assertion falla en `main`, ese es un hallazgo con valor propio: significa que hay una regresión de audio viviendo sin ser detectada desde el cambio al worklet.

---

### Frente 1 — Un solo mecanismo de extensión

El que más se acerca a lo que pediste: *"un interfaz claro de engine"*. Convierte los seis registros en uno.

**Cambio:** un engine se declara en **un** manifiesto y el sistema deriva el resto.

```ts
// src/engines/<id>/index.ts  — lo ÚNICO que se escribe
export default defineEngine({
  id: 'karplus',
  name: 'Karplus',
  polyphony: 'poly',
  params: KARPLUS_PARAMS,
  renderer: KarplusRenderer,        // el registro del worklet se deriva de aquí
  capabilities: { … },              // sustituye los `engineId === '…'` (ver §4)
});
```

- **`registerEngine` + `registerEngineFactory` → uno.** Se termina la migración singleton→factory que quedó a medias.
- **`WORKLET_ENGINE_IDS` desaparece:** se deriva de si el manifiesto declara `renderer`. Se acabó la lista a mano.
- **El import por efecto secundario en `loom-processor.ts` se genera**, no se escribe: el bundle del worklet importa los renderers desde el mismo manifiesto.
- **Un test de completitud:** para cada engine registrado, existe su renderer y está alcanzable desde el bundle del worklet. Un engine incompleto **falla en el test, no en silencio a las 3 de la mañana**.

**Riesgo:** medio. Toca el arranque y el bundle del worklet.
**Ganancia:** "añadir un engine = añadir un fichero" pasa a ser cierto, y CLAUDE.md pierde su sección de cuatro pasos.

---

### Frente 2 — El interfaz de engine dice la verdad

**2.1 Sacar el DOM del contrato de audio.** `buildParamUI(container: HTMLElement)` y `buildSequencer(container, n)` salen de `SynthEngine`. El engine declara (`editor`, `params: EngineParamSpec[]`); quien monta paneles los busca en un `EngineUiRegistry` paralelo. Cinco de los nueve engines no necesitan UI propia — `buildEngineParamGrid` ya deriva la rejilla del spec. Sólo `subtractive`, `sampler` y `drums` tienen UI de verdad.

> **Parada obligatoria de parity visual:** abrir los 9 engines en Chrome real y comparar contra el estado actual. Los tests no comprueban si la pantalla sigue pareciéndose a lo aprobado.

**2.2 `Voice` deja de mentir.** De sus cinco métodos, en el camino vivo `connect()` es no-op, `getAudioParams()` devuelve mapa vacío, `dispose()` es no-op y `createVoice(_ctx, _output)` ignora ambos parámetros. Se reduce a lo que se usa. Drums y Sampler sí entregan `AudioParam`s reales, así que `getAudioParams()` se conserva como opcional declarado.

**2.2b — `Voice.release` NO era deuda de estilo: era un DEFECTO.** ✅ **ARREGLADO Y EN `main`** (`a165ec5`, 2026-07-26, verificado a oído y pusheado).

Diagnosticado 2026-07-26. Cadena completa:

| Paso | Dónde |
|---|---|
| tocas 3 notas → 3 voces con `gateDuration: 3600` (se mantienen hasta soltar) | [live-keyboard.ts:60](../../../src/control/live-keyboard.ts) |
| sueltas UNA tecla → `releaseGroup` → `v.release(t)` | [live-keyboard.ts:46](../../../src/control/live-keyboard.ts) |
| `WorkletVoice.release()` ignora `t` y llama `silenceAll()` | [worklet-lane-engine.ts:147](../../../src/engines/worklet-lane-engine.ts) |
| `silenceAll()` es `steal(1024)` → apaga TODAS las voces de la pista | [loom-node.ts:211](../../../src/audio-worklet/loom-node.ts) |

**Síntoma: sueltas una nota de un acorde y se van todas.** Afecta a los seis engines melódicos de worklet, con teclado MIDI y con teclado de ordenador. Dos manifestaciones más del mismo origen: soltar el **pedal de sustain** con un acorde sostenido, y **repetir una tecla que ya suena** (el "retrigger limpio" de [live-keyboard.ts:54](../../../src/control/live-keyboard.ts)).

**No afecta** a la reproducción de clips: ahí la duración viaja dentro de `spawn({durationSec})` y el worklet apaga cada nota sola; `release()` sólo se llama en los cortes de transporte, donde apagar todo es lo correcto.

**Por qué pasó desapercibido:** la grabación MIDI en vivo y el teclado-como-MIDI se cerraron sin verificación a oído (anotado en ambos trabajos).

**CONFIRMADO EN LA APP REAL** (2026-07-26, Chrome + medidor en el máster, lane `subtractive-1`, transporte parado):

| Prueba | Acorde sonando | Tras soltar UNA nota |
|---|---|---|
| **Control — no se suelta nada** | RMS 0.1969 | **0.2037** (se mantiene 1,2 s después) |
| A — se suelta la primera | 0.1954 | **0.0129** (−93 %) |
| B — se suelta la última | 0.1961 | **0.0127** (−94 %) |
| C — sólo dos notas, se suelta una | 0.1796 | **0.0124** (−93 %) |

El control descarta el decaimiento natural: sin soltar nada el acorde se sostiene indefinidamente. Da igual qué nota se suelte ni cuántas haya sonando. El residuo de ~0.012 es la cola de reverb/delay del máster.

**Este medidor es la base del test de regresión** del arreglo: tras el fix, la fila A debe quedar en ~2/3 del acorde, no en el 6 %.

**Arreglo — la maquinaria ya existe.** `steal(count)` está documentado como *"hace noteOff a las `count` voces más antiguas"*: el gestor de voces del worklet ya sabe soltar una voz con su cola de release. Sólo falta poder direccionarla por identidad y no por antigüedad.

1. cada `spawn` lleva un `voiceId`;
2. mensaje nuevo `{ type: 'release', voiceId }`;
3. el `VoiceManager` busca esa voz y le aplica el note-off que ya aplica `steal`;
4. `WorkletVoice` recuerda su `voiceId` y lo usa en `release()`;
5. los cortes de transporte siguen con `silenceAll()` — ese comportamiento es correcto.

> **Renombrar a `silenceLane()` queda DESCARTADO:** sería documentar el bug con mejor ortografía.

**RESULTADO** (commit `a165ec5`, 11 ficheros, +332/−17, suite 3208/3208 verde):

| Prueba en la app | Antes | Después |
|---|---|---|
| Acorde de 3 notas | RMS 0.1954 | 0.1973 |
| Tras soltar UNA | **0.0129 (−93 %)** | **0.1687 (−14 %)** |
| Soltar la última | 0.0127 | 0.1841 |
| Soltar todas | — | 0.0058 (silencio limpio) |
| Escena → Stop | — | 0.1317 → 0.0012 (sin regresión) |

Implementado como estaba previsto: `NoteSpec.voiceId`, mensaje `{type:'release', voiceId}`, `VoiceManager.releaseVoice(id)`. Dos cosas que sólo aparecieron al hacerlo:

1. **El Stop del transporte se apoyaba en el efecto colateral.** Con `release()` ya per-voice, `LiveVoiceRegistry` sólo habría soltado las voces que tiene fichadas — dejando sonando las que su tope de 64 hubiera expulsado. Hizo falta un `Voice.silenceLane?()` explícito. *Nota para el frente 2: adelgazar `Voice` no es sólo quitar; a veces el método que falta es el que hacía honesto al que sobraba.*
2. **Un note-off puede adelantar a su note-on** (toque más corto que un quantum, con el spawn aún en la cola del scheduler). Sin tratarlo, esa nota sonaría su duración nominal — que en una tecla mantenida es **una hora**. El id queda pendiente y `spawn` lo aplica al nacer.

**Y un hallazgo que vale para todo el plan:** el test existente `worklet-lane-engine.test.ts` **afirmaba el bug** (*"release() silences the worklet"*). Estaba escrito desde la perspectiva del Stop, sin ver que el mismo método recibía los key-up. Un test verde protegiendo el comportamiento equivocado porque el contrato mezclaba dos intenciones. Al adelgazar interfaces en los frentes 2 y 3, **hay que auditar los tests que las cubren**: algunos documentan la confusión, no el requisito.

**2.3 Los presets dejan de resolverse dentro del engine.** Ya son JSON externos; lo que falta es que el motor deje de saber qué es un preset. `applyPreset(name)` → `applyParams(bag: ParamBag)`, y resolver nombre→bag pasa a ser exclusivo del cargador. Desaparecen los tres caminos actuales (`applyPresetToEngine`, el `applyPreset` de cada engine, `poly-preset-apply`) y el llamador que se salta el envoltorio ([midi/audition.ts:14](../../../src/midi/audition.ts)). `presetKeyRemap` (el `'cutoff'` → `'filter.cutoff'` del TB-303) se aplica en el cargador, que es donde vive el vocabulario legado.

**Esto completa la externalización de presets que pediste:** un preset podrá venir de JSON, del usuario o de la red sin tocar el motor.

---

### Frente 3 — Un solo vocabulario de nota

Hoy una nota se dice de cinco maneras en un mismo camino:

| Dónde | Forma |
|---|---|
| [core/notes.ts:13](../../../src/core/notes.ts) `NoteEvent` | `{start, duration, midi, velocity}` — ticks, 0-127 |
| [trigger-dispatch.ts:8](../../../src/app/trigger-dispatch.ts) `TriggerForLane` | **9 parámetros posicionales** |
| [notefx-types.ts:5](../../../src/notefx/notefx-types.ts) `NoteFxEvent` | `{note, time, gate, accent}` — **sin velocity** |
| [engine-types.ts:26](../../../src/engines/engine-types.ts) `VoiceTriggerOptions` | `{accent, slide, velocity, gateDuration, sample, offsetSec}` |
| [audio-dsp/types.ts:26](../../../src/audio-dsp/types.ts) `NoteSpec` | `{midi, beginSec, durationSec, velocity 0..1, accent, slide}` |

**Cuesta funcionalidad, no sólo elegancia:** el arpegiador y el chord no pueden variar la dinámica porque `NoteFxEvent` no lleva velocity, y [trigger-dispatch.ts:54](../../../src/app/trigger-dispatch.ts) fuerza `slide = false` en cuanto hay note-FX.

**Cambio:** un único `PlayedNote` en el tramo de reproducción, con las unidades declaradas una vez.

```ts
interface PlayedNote {
  midi: number;
  atSec: number;        // AudioContext seconds
  durationSec: number;
  velocity: number;     // 0..1 — UNA escala
  accent: boolean;
  slide: boolean;
  sample?: ClipSample;
  offsetSec?: number;
}
```

`NoteEvent` (ticks, 0-127) se queda: es el modelo del clip. La conversión ocurre **en un solo sitio**, el scheduler. `TriggerForLane` pasa de 9 posicionales a `(laneId, note: PlayedNote)`. Los note-FX operan sobre `PlayedNote` y ganan velocity y slide gratis.

**Riesgo:** alto — camino de audio. Red: la suite de scheduling con reloj falso + verificación a oído en Chrome real.
**Ganancia comprobable:** un test que demuestre un arpegiador variando velocity, hoy imposible.

---

### Frente 4 — Un solo punto de escritura de params

Cuatro fuentes escriben el mismo destino (knob, automatización, MIDI, XY). `setBaseValue` tiene 11 llamadores, y dos aplican políticas **opuestas** sin declararlo:

- MIDI ([live-control-apply.ts:43](../../../src/automation/live-control-apply.ts)) → `commitParamForLane` → **persiste**.
- Automatización ([automation-apply.ts:72](../../../src/automation/automation-apply.ts)) → `setBaseValue` directo → **no persiste**.

La diferencia es casi seguro deliberada. El problema es que la regla no está escrita en ningún sitio: vive implícita en qué función eligió cada llamador — y CLAUDE.md afirma que todo pasa por `commitParam`, lo que hoy es falso.

**Cambio:**

```ts
writeParam(target, paramId, value, { source: 'user' | 'automation' | 'midi' | 'preset' })
```

La política (`user` y `midi` persisten; `automation` no; `preset` persiste en bloque) queda declarada en un punto, con su razón al lado. Nadie más llama `setBaseValue` desde fuera del engine — y eso **se verifica con un test**.

**Se lleva por delante** [active-mods.ts](../../../src/modulation/active-mods.ts): la variable global mutable que hace de parámetro oculto (se pone el `laneId` justo antes de `createVoice()` y se borra después, "para no ampliar la firma"). Con el frente 3, el laneId viaja en la llamada.

---

### Frente 5 — Capas y ciclos

El más grande, y por eso **con trinquete, no de golpe**.

**Paso 1 — Declarar.** Cada subsistema declara su capa (§2) en un manifiesto. `tools/dep-matrix.mjs` se convierte en test.

**Paso 2 — Congelar.** El test registra el número actual de ciclos (28) como techo. **Sube = falla.** A partir de ese momento el problema deja de crecer, que es la mitad de la batalla.

**Paso 3 — Bajar el techo.** Cada frente rompe los ciclos que toca y baja el número. Los frentes 0-4 ya se llevan varios por delante:
- frente 0 elimina `polysynth ↔ core`, `polysynth ↔ engines`, `polysynth ↔ presets`, `session ↔ polysynth` (**4 ciclos gratis**),
- frente 2 rompe `engines ↔ presets` (el engine deja de importar el cargador) y parte de `engines ↔ core` (la UI sale del contrato),
- frente 3 rompe parte de `session ↔ core` (el vocabulario de nota deja de cruzar).

**Paso 4 — Repartir `core/`.** Es la causa del ciclo mayor y la señal más clara de ausencia de arquitectura: un cajón de 100+ ficheros que va desde `NoteEvent` (datos puros) hasta `pianoroll.ts` (canvas). Se reparte entre `model/`, `runtime/` y `ui/`. **Esto se hace al final**, cuando los frentes anteriores hayan reducido el enredo, y probablemente merezca su propio spec.

> **⛔ DECISIÓN:** ¿el reparto de `core/` entra en esta ronda o se queda como spec siguiente con el trinquete ya puesto? Recomiendo lo segundo: poner el trinquete ahora vale más que mover 100 ficheros ya.

---

### Frente 6 — El estado sale del DOM

**Los sitios verificados:**

1. **El save lee el volumen del DOM.** [saved-state-v3.ts:70](../../../src/save/saved-state-v3.ts): `masterVol: parseFloat(volInput.value)`. Y [master-strip.ts:18](../../../src/core/master-strip.ts) lo documenta: *"el fader es un PROXY de `#volume`"* — un `<input>` de `index.html` **es** el modelo del volumen maestro y dos vistas se sincronizan despachando eventos a través de él. **Esto es un defecto, no estilo.**
2. **La automatización lee un atributo HTML.** [performance-feature.ts:417](../../../src/app/performance-feature.ts): `k.el.getAttribute('data-value-norm')`.
3. **Transporte:** bpm, swing y compás tienen su verdad en los `<input>`.
4. **Pestaña activa por `dataset.page`, tres veces** — [main.ts:348](../../../src/main.ts), [session-host-lane-editor.ts:57](../../../src/session/session-host-lane-editor.ts), [synth-editor-routing.ts:51](../../../src/session/synth-editor-routing.ts).
5. **Validez del drop en una clase CSS** — [session-clip-drag.ts:114](../../../src/session/session-clip-drag.ts) calcula, escribe `.drop-valid` y **relee** la clase para decidir.
6. **Voz de drum seleccionada en `.dv-col.selected`** — [drum-voice-rack.ts:122](../../../src/engines/drum-voice-rack.ts).

**Excepciones legítimas — NO se tocan.** Modelarlas duplicaría estado, que es el defecto que queremos evitar:
- **El foco** (`document.activeElement`) — el navegador es su dueño.
- **La geometría** (117 usos de `getBoundingClientRect`/`scrollLeft`) — medida física del layout, no estado.
- **`e.target.value` dentro de un handler** — eso es leer el *evento*. Es la mayoría de los aciertos del grep y no es deuda.
- **Los diálogos** ([project-options-dialog](../../../src/session/project-options-dialog.ts), [stem-dialog](../../../src/stems/stem-dialog.ts)) — leen su formulario al aceptar; estado efímero de un solo dueño.

**El cierre:** un test recorre el árbol y falla ante `getAttribute`, `classList.contains`, `dataset.*` leído y `.value` fuera de handler, contra una allowlist donde **cada excepción lleva su razón escrita**. Eso es lo que una capa de indirección no da: una capa se puede llamar desde donde no toca; un test no.

---

## 4. Transversal — Capacidades declaradas en vez de nombres

~20 comparaciones literales (`engineId === 'subtractive'` / `'drums-machine'` / `'tb303'`) repartidas por [lane-allocator](../../../src/app/lane-allocator.ts), [trigger-dispatch:48](../../../src/app/trigger-dispatch.ts), [voice-manager:113](../../../src/audio-dsp/voice-manager.ts), [session-host-lane-editor](../../../src/session/session-host-lane-editor.ts), [engine-selector-ui](../../../src/engines/engine-selector-ui.ts), [lane-editor-panels](../../../src/session/lane-editor-panels.ts), [clip-editor-router](../../../src/session/clip-editors/clip-editor-router.ts)… `subtractive` es caso especial en tres puntos del mismo fichero.

```ts
capabilities: {
  acceptsNoteFx: boolean;      // ← engineId !== 'drums-machine'
  acceptsAudioClips: boolean;  // ← engineId === 'sampler' || 'audio'
  hasCustomUi: boolean;        // ← id !== 'subtractive'
  editor: 'piano-roll' | 'drum-grid';
  swappable: boolean;          // ← el caso 'audio' de engine-swap
}
```

**Regla de oro:** una capacidad se añade **sólo** cuando sustituye a un `=== 'id'` existente. Nada especulativo — es la misma acumulación especulativa la que nos trajo aquí.

Se hace **dentro de cada frente**, no como paso aparte: cada frente convierte los casos que toca. Viven en el manifiesto del frente 1.

---

## 5. Orden, riesgo y método

Riesgo medido con el grafo de GitNexus (`impact upstream`), no estimado a ojo:

| # | Frente | Símbolo clave | Radio real | Riesgo | Por qué ahí |
|---|---|---|---|---|---|
| 0 | Código muerto | `buildSequencer` | 3 (implementaciones, 0 llamadas) | **Bajo** | No cambia comportamiento. |
| 0 | Código muerto | `PolySynth` | **51** (13 directos) | **Medio** | ⚠️ más de lo estimado — ver abajo. |
| 0.5 | Revivir la batería DSP | — | sólo tests | **Bajo** | Red de seguridad de los frentes 2 y 3. Va ANTES de tocar audio. |
| 1 | Un solo registro | `registerEngine*` | contrato de extensión | Medio | Todo lo demás cuelga de él. |
| 2 | Interfaz honesto | `SynthEngine` | **139** (39 directos) | **CRÍTICO** | ⚠️ subido desde "medio-alto" — ver abajo. |
| 3 | Bus de notas | `NoteEvent` (28 ficheros) | camino de audio | **Alto** | Con el terreno ya despejado y la batería puesta. |
| 4 | Bus de control | `setBaseValue` (34 ficheros) | 11 llamadores | Bajo-medio | Cierra un agujero de guardado real. |
| 5 | Capas | — | 2 ciclos de fichero | Medio (trinquete) | Disciplina, no urgencia (ver §1.1). |
| 6 | Estado fuera del DOM | — | ~15-20 sitios | Bajo | Independiente. |

**Dos correcciones que salen de medir en vez de estimar:**

1. **`SynthEngine` es CRÍTICO, no medio-alto.** 139 símbolos impactados, 39 de ellos directos, y afecta a los procesos `swapLaneEngine` y `createLaneEngine`. Además GitNexus marca el resultado como **cota inferior**: *"es una interfaz con 4 implementaciones; los que enlazan a través de ella no se trazan hasta el símbolo concreto — el impacto real puede ser mayor"*. Por tanto el frente 2 **no se hace de una pasada**: se parte en sus tres piezas (2.1 sacar la UI, 2.2 adelgazar `Voice`, 2.3 los presets) y cada una se cierra en verde antes de empezar la siguiente.

2. **`PolySynth` no es un borrado trivial.** 51 símbolos, 13 directos. No es riesgo de que suene distinto (el camino está muerto), es **volumen de desenredo**: lo importan como tipo `session-host-deps`, `bpm-broadcast`, `core/random`, `preset-apply`, `synth-editor-routing`… Sigue siendo el primer frente, pero se planifica como varias sesiones, no como un `rm`.

**Y un dato que subo al alza:** los casos especiales por id de engine no son ~20 sino **63, repartidos en 23 ficheros**. Los peores: `session-host-util` (7), `lane-allocator` (6), `session-inspector` (4), `session-host-lane-editor` (4), `clip-editor-router` (4). El trabajo transversal de §4 es mayor de lo que decía el borrador.

### Método

- **Worktree obligatorio** para todo lo que no sea este documento. Un frente = una rama, commits pequeños, `git rebase main` muy a menudo.
- **TDD donde hay comportamiento** (frentes 3, 4, 6). Los frentes 0 y buena parte del 1-2 son borrado y movimiento: los cubre `tsc --noEmit` + la suite.
- **`npm run build` antes de cualquier `test:e2e`** — la suite sirve `dist/` sin construir.
- **Parity visual obligatoria en el frente 2**: los 9 engines abiertos en Chrome real y mirados.
- **Verificación a oído en Chrome real** al cerrar el frente 3.
- **Cada ley del §1.3 acaba con un test**, o no está hecha. Ese es el entregable que convierte esto en framework y no en una limpieza que se deshace en tres meses.
- **Nada se mergea a `main` sin permiso explícito.**

### Decisiones abiertas

1. ~~**`test/golden/` + `dsp-battery.ts`** — ¿borrar?~~ **RESUELTO 2026-07-26: se conservan y se reviven** (frente 0.5). Borrarlas era un error de categorización por mi parte: sin uso ≠ sin valor, y son precisamente la red que hace falta para los frentes 2 y 3.
2. ~~**`Voice.release`** — ¿`silenceLane()` o release por voz?~~ **RESUELTO 2026-07-26: es un DEFECTO, no una elección** (frente 2.2b). Soltar una nota de un acorde mata el acorde entero en las seis pistas melódicas. Se arregla con release por voz; renombrar queda descartado.
3. **`ensureExtraPoly`** — confirmar con traza que el camino `poly1..poly16` está muerto antes de retirarlo.
4. **Reparto de `core/`** — ¿en esta ronda o spec siguiente con el trinquete ya puesto? (recomiendo lo segundo)
