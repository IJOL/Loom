# Plan maestro — de código acumulado a framework coherente

**Fecha:** 2026-07-26
**Estado:** BORRADOR — pendiente de revisión por Nacho
**Base:** `main` @ `578545d`; **revisado sobre `9086f99`** (2026-07-26, índice de GitNexus reconstruido)
**Objetivo declarado:** pasar de código generado por acumulación a un framework coherente y bien ingenierizado.

> **REVISIÓN 2026-07-26 — el borrador era alarmista en el hallazgo de los imports circulares.** Se ha vuelto a medir todo con el índice de GitNexus reconstruido (el anterior tenía ficheros ya borrados) y con `tools/dep-matrix.mjs` reescrito para **distinguir import de valor de `import type`**. Resultado corto: **cero ciclos de import en tiempo de ejecución en todo el código**. El detalle está en §1.1, y las consecuencias en §2, frente 5 y §5. El resto del diagnóstico aguanta la medición; dos claims suben de tamaño (`SynthEngine`, casos especiales por id) y el frente 0 ya está **hecho y en `main`**.

---

## 1. Diagnóstico

Todo lo que sigue está **medido sobre `main`**, no supuesto. 399 ficheros de producción, 23 subsistemas.

### 1.1 Los dos síntomas estructurales

**No hay capas declaradas: 28 pares de carpetas se importan mutuamente — 16 de ellos de verdad.**

La medición honesta necesita separar dos cosas que el borrador sumaba:

- **import de valor** — sobrevive a la compilación. Es una dependencia real de carga.
- **`import type`** (o `import('x').T` en posición de tipo) — **`tsc` lo borra**. No obliga a nada en ejecución y no puede formar un ciclo de carga.

Con esa separación, sobre `main` (`node tools/dep-matrix.mjs`):

- **28 pares** de carpetas se importan mutuamente contando todo.
- **16** lo hacen con imports de **valor en ambos sentidos** → dependencia mutua real.
- **12 son sólo de tipos** — desaparecen en el bundle. Entre ellos `engines ↔ modulation` (38/1), `session ↔ samples` (21/4), `engines ↔ samples` (20/2) y `engines ↔ presets` (11/2), que en el borrador figuraban entre los peores.

Y a nivel de **fichero**, que es donde un ciclo puede hacer daño de verdad (orden de carga, `undefined` en el módulo a medio inicializar), `check({cycles: true})` de GitNexus encuentra **2**:

1. `lane-allocator.ts → engine-types.ts → history-wiring.ts → saved-state-v3.ts → lane-allocator.ts`
2. `performance-ui-templates.ts ↔ performance-ui.ts`

**Los dos son de tipos.** Verificado arista por arista: [lane-allocator.ts:14](../../../src/app/lane-allocator.ts) `import type { SynthEngine, Voice }`; [engine-types.ts:61](../../../src/engines/engine-types.ts) `historyDeps?: import('../save/history-wiring').HistoryDeps` (posición de tipo — `engine-types.ts` no tiene **ni un solo `import` de valor**); [history-wiring.ts:2](../../../src/save/history-wiring.ts) `import type { SavedStateV3 }`; [saved-state-v3.ts:4](../../../src/save/saved-state-v3.ts) `import type { LaneAllocator }`. El segundo, igual: `performance-ui-templates.ts:17` importa `type PerfUICallbacks`.

> **Conclusión, sin adornos: el código no tiene ciclos de import en tiempo de ejecución. Ni uno.** El borrador decía "la base depende del tejado" y "no existe ningún orden en que se puedan apilar estos 23 subsistemas". Lo primero es cierto sólo en parte y lo segundo era falso: 12 de los 28 pares no restringen nada y los 2 ciclos de fichero se evaporan al compilar. Un ciclo hecho sólo de tipos es un problema de **dónde vive el nombre**, no de arranque.
>
> Lo que **sí** queda en pie, medido: `core` importa hacia arriba con imports de valor — 7 a `save`, 3 a `session`, 3 a `engines`, 2 a `samples`. Es poco volumen y es una inversión de capa real. Curiosamente al revés de como lo contaba el borrador: `save → core` son 17 imports pero sólo **2** de valor; el tráfico de ejecución va de `core` hacia arriba, no al contrario.

Los diez peores pares, con las dos cuentas (total y **de valor**):

| Par | total A→B / B→A | **valor** A→B / B→A | ¿mutuo en ejecución? |
|---|---|---|---|
| `session ↔ core` | 144 / 19 | **98 / 3** | sí |
| `engines ↔ modulation` | 38 / 1 | 24 / 0 | **no — sólo tipos** |
| `engines ↔ core` | 33 / 6 | **23 / 3** | sí |
| `app ↔ session` | 31 / 3 | **10 / 2** | sí |
| `session ↔ samples` | 21 / 4 | 18 / 0 | **no — sólo tipos** |
| `engines ↔ samples` | 20 / 2 | 15 / 0 | **no — sólo tipos** |
| `save ↔ core` | 17 / 9 | **2 / 7** | sí |
| `session ↔ save` | 14 / 3 | 8 / 0 | **no — sólo tipos** |
| `engines ↔ presets` | 11 / 2 | 11 / 0 | **no — sólo tipos** |
| `engines ↔ session` | 10 / 10 | **3 / 7** | sí |

El único par que es de verdad grande es `session ↔ core`: **98 imports de valor** de `session` a `core` y 3 de vuelta. Ése es el hallazgo que aguanta, y es exactamente el que el paso 4 del frente 5 ataca (repartir `core/`).

Medido con [tools/dep-matrix.mjs](../../../tools/dep-matrix.mjs), que ya clasifica valor/tipo y ya está versionado (era un script ad-hoc sin commitear; ahora la medición es reproducible por cualquiera). Convertirlo en **test** sigue siendo parte del frente 5. Los ciclos de FICHERO se comprueban con `check({cycles: true})` de GitNexus, reproducible hoy — con la advertencia de que **GitNexus no distingue `import type`**, así que su cuenta de 2 hay que leerla junto a la clasificación de arriba.

Esto sigue siendo la firma de código que creció por acumulación — cada función se puso donde cayó — pero la firma está en **la ausencia de capas declaradas**, no en una maraña de bucles. Consecuencia para el frente 5: su valor no es "desactivar bombas", es **impedir que el desorden crezca** y dar un sitio a cada cosa. Baja de urgencia y sube de disciplina.

Y una observación que se conserva porque ilustra bien el frente 2, ahora con su etiqueta correcta: el ciclo de fichero nº 1 pasa por `engine-types.ts` → el sistema de undo → el guardado → el allocator → vuelta. Es el contrato del motor enredado con la persistencia — **en la firma, no en la ejecución**. Arreglarlo limpia el diseño; no desactiva nada.

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

- **Interfaces que mienten.** ~~`EngineSequencer` completo (interfaz + `buildSequencer` + 5 implementaciones + 2 métodos del `Sequencer`) tiene **cero llamadas**.~~ **BORRADO — `d7e6272`.** `Voice` tiene 3 de 5 métodos inertes en el camino vivo, y `release(time)` ignoraba el tiempo y silenciaba la pista entera (**arreglado — `a165ec5`**, frente 2.2b).
- **El DOM en el contrato de audio.** `SynthEngine.buildParamUI(container: HTMLElement)` obliga a que un fichero sobre osciladores importe `lit-html`, `createKnob` y el sistema de undo.
- **Cinco vocabularios para "una nota"** en un solo camino, con dos escalas de velocity y cuatro nombres para la duración. Cuesta funcionalidad: el arpegiador no puede variar la dinámica.
- **Cuatro escritores de params** con políticas de persistencia opuestas y no declaradas en ningún sitio.
- **Estado que vive en el DOM** (~15-20 sitios), uno de ellos un defecto real: el save lee el volumen maestro de un `<input>`.
- **Casos especiales por nombre de engine** (`engineId === 'subtractive'`) repartidos por el núcleo: **23 ficheros** (la cuenta de ocurrencias baila entre 54 y 63 según el patrón que se use; el número de ficheros es estable y es el que importa).
- ~~**Código muerto que parece vivo:** `PolySynth` se construye entero…~~ **BORRADO — `df13688`.** Lo que queda en `src/polysynth/` **no es código muerto**: son cinco ficheros vivos que forman la superficie de presets del subtractive (ver §2).

### 1.3 El criterio

"Bonito por dentro" no es verificable. Se traduce a cuatro leyes, y **cada una lleva su test**. Ese es el salto: hoy estas reglas existen como prosa en comentarios y en CLAUDE.md; un framework las tiene ejecutables.

> **L1 — Dependencias en una sola dirección.** Ninguna dependencia **de valor** mutua entre subsistemas. Cada carpeta declara su capa y sólo importa hacia abajo. Un `import type` que sube de capa no viola L1 por sí solo (no existe en ejecución), pero sí señala que el tipo está en la carpeta equivocada: se anota, no se persigue.
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
- No promete romper los 28 pares mutuos de golpe (ver frente 5: trinquete, no big-bang) — y **no los trata como urgentes**, porque ninguno es un ciclo de ejecución.
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
- **`session/` se parte en dos**: los tipos y operaciones del modelo (L1) y sus vistas (L4). Hoy están juntos, y es la causa del único par mutuo grande de verdad (`session ↔ core`, **98 imports de valor** hacia abajo y 3 de vuelta).
- **`polysynth/` se renombra, no desaparece.** La clase `PolySynth` murió en `df13688`, pero la carpeta conserva cinco ficheros **vivos** — `polysynth-presets.ts`, `poly-preset-apply.ts`, `poly-preset-store.ts`, `poly-preset-templates.ts`, `poly-params.ts` — que son el desplegable de presets + Randomize del subtractive, importados desde `main.ts`, `engine-selector-wiring`, `engine-selector-ui`, `midi-import-wiring`, `randomize-ui` y `session-host-lane-editor`. Con el frente 2.3 (los presets se resuelven fuera del motor) su sitio natural es `presets/` o `engines/subtractive/`; el nombre `polysynth` ya no describe nada que exista.

**La regla se verifica**, no se confía: `tools/dep-matrix.mjs` pasa a ser un test que falla si aparece una dependencia **de valor** mutua nueva o si una capa importa hacia arriba.

---

## 3. Los frentes

Orden pensado para que cada uno destrabe al siguiente y para que el riesgo alto llegue con el terreno ya despejado.

### Frente 0 — Código muerto ✅ HECHO Y EN `main`

No cambiaba comportamiento. Despejó el terreno de todo lo demás.

**0.1 `EngineSequencer` — interfaz zombi completa.** ✅ **`d7e6272`** — *"fuera EngineSequencer, una interfaz entera sin una sola llamada"*. Fuera la interfaz, el método del contrato, las cuatro implementaciones (`SamplerSequencer`, `DrumsSequencer`, `AudioSequencer`, `inertSequencer`), el stub de `WorkletLaneEngine` y los dos métodos de `Sequencer`. `buildSequencer` ya no está en `SynthEngine` — eso adelanta parte del frente 2.1.

**0.2 `PolySynth` — ramas protegidas por casts a métodos inexistentes.** ✅ **`df13688`** — *"fuera la clase PolySynth y los seis caminos que colgaban de ella"*. `polysynth.ts`, `ensureExtraPoly` y los cinco casts a `getPolySynth`/`setPolySynth` ya no existen. La pregunta abierta sobre `EXTRA_IDS` / `poly1..poly16` queda **resuelta: estaba muerto** (sólo sobreviven mocks `ensureExtraPoly: () => ({})` en siete tests de `session-host`, que son basura de test a barrer cuando se toque ese fichero).

> **⚠️ Lo que NO se borró, y con razón:** los cinco ficheros de presets de `src/polysynth/` están vivos y en uso. El borrador los listaba como satélites a eliminar; era un error. Ver §2 — se reubican, no se borran.

**0.3 Restos menores.** ✅

- `core/synth.ts` (clase `TB303`) — fuera en **`636ab9b`**.
- `ParamDef` (alias de compatibilidad, cero usos) — fuera en **`c7d8eb6`**.

> **NO se borra `test/dsp-battery.ts`.** Un borrador anterior de este plan lo metía aquí; era un error de categorización. Ver frente 0.5. Sigue en el árbol con **cero llamadores**, esperando el frente 0.5.

**Verificación:** `npx tsc --noEmit` + `npm run test:unit` en verde. Hecha en cada commit de los tres.

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

**2.1 Sacar el DOM del contrato de audio.** `buildSequencer(container, n)` ya salió con el frente 0 (`d7e6272`); queda `buildParamUI(container: HTMLElement, ctx?: EngineUIContext)` ([engine-types.ts:119](../../../src/engines/engine-types.ts)), con 13 ficheros de producción implicados. El engine declara (`editor`, `params: EngineParamSpec[]`); quien monta paneles los busca en un `EngineUiRegistry` paralelo. Cinco de los nueve engines no necesitan UI propia — `buildEngineParamGrid` ya deriva la rejilla del spec. Sólo `subtractive`, `sampler` y `drums` tienen UI de verdad.

> **Parada obligatoria de parity visual:** abrir los 9 engines en Chrome real y comparar contra el estado actual. Los tests no comprueban si la pantalla sigue pareciéndose a lo aprobado.

**2.2 `Voice` deja de mentir.** En el camino vivo `connect()` es no-op, `getAudioParams()` devuelve mapa vacío, `dispose()` es no-op y `createVoice(_ctx, _output)` ignora ambos parámetros. Se reduce a lo que se usa. Drums y Sampler sí entregan `AudioParam`s reales, así que `getAudioParams()` se conserva como opcional declarado. **Ojo al inventario actualizado:** tras `a165ec5` la interfaz tiene **siete** miembros, no cinco — se añadieron `silenceLane?()` y `getAudioParamRange?()`, ambos legítimos y ambos con dueño real. Adelgazar aquí es quitar tres, no cinco.

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
| [engine-types.ts:136](../../../src/engines/engine-types.ts) `VoiceTriggerOptions` | `{accent, slide, velocity, gateDuration, sample, offsetSec}` |
| [audio-dsp/types.ts:26](../../../src/audio-dsp/types.ts) `NoteSpec` | `{midi, beginSec, durationSec, velocity 0..1, accent, slide, voiceId}` |

**Cuesta funcionalidad, no sólo elegancia** — reverificado sobre `main` en [trigger-dispatch.ts:53](../../../src/app/trigger-dispatch.ts):

```ts
const events = chain.process([{ note, time, gate, accent }], { bpm: deps.seq.bpm });
for (const e of events) fire(e.note, e.time, e.gate, e.accent, false);
```

La velocity **no entra** en la cadena (no hay campo) y **no sale**: `fire` la toma de la `vel` calculada una vez fuera, así que las N notas que genere un arpegio heredan todas la dinámica de la nota original. Y el `false` de la última posición es el `slide` forzado. Los dos son exactamente el mismo defecto: el vocabulario de la cadena es más pobre que el de sus dos extremos.

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

Cuatro fuentes escriben el mismo destino (knob, automatización, MIDI, XY). Medido sobre `main`: **17 llamadas a `.setBaseValue(` en producción**, repartidas en tres grupos que el borrador metía en el mismo saco —

- **8 escriben un engine desde fuera** (los que importan aquí): [engine-param-commit.ts:50](../../../src/engines/engine-param-commit.ts) (el sancionado), [automation-apply.ts:72](../../../src/automation/automation-apply.ts), [live-control-apply.ts:64](../../../src/automation/live-control-apply.ts), [engine-randomize.ts:72 y :79](../../../src/engines/engine-randomize.ts), [apply-lane-engine-state.ts:52](../../../src/export/apply-lane-engine-state.ts), [offline-recorder.ts:267](../../../src/export/offline-recorder.ts), [poly-preset-apply.ts:75](../../../src/polysynth/poly-preset-apply.ts).
- **4 escriben un FX, no un engine** (`loom-facade`, `insert-slot`, `lane-insert-ui` ×2) — mismo nombre de método, otro destino. Si el frente 4 los mete en el mismo `writeParam` tiene que decirlo explícitamente.
- **5 son `this.setBaseValue(...)` dentro del propio engine** (`worklet-lane-engine` ×3, `sampler-worklet-engine`, `drums-worklet-engine`) — no son llamadores externos y **no cuentan** como incumplimiento.

Dos de los ocho aplican políticas **opuestas** sin declararlo:

- MIDI ([live-control-apply.ts:64](../../../src/automation/live-control-apply.ts)) → `commitParamForLane` → **persiste**.
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

El más grande, y por eso **con trinquete, no de golpe**. Y con la urgencia recalibrada: §1.1 mide **cero ciclos de import en ejecución**, así que este frente no arregla nada roto — **impide que se rompa** y le da un sitio a cada cosa. Si hay que sacrificar un frente por tiempo, es éste.

**Paso 1 — Declarar.** Cada subsistema declara su capa (§2) en un manifiesto. `tools/dep-matrix.mjs` (ya versionado y ya clasifica valor/tipo) se convierte en test.

**Paso 2 — Congelar.** El test registra **dos** techos, y esto es el cambio de fondo de la revisión: el número de pares mutuos **de valor** (16) y el total contando tipos (28). **Sube cualquiera = falla**, pero el que se persigue es el primero. Congelar sólo el total premia convertir un import de valor en `import type` sin mover nada de sitio.

**Paso 3 — Bajar el techo.** Cada frente rompe los pares que toca:

- frente 0 **ya se llevó** `polysynth ↔ presets` de la lista de mutuos de valor; quedan `polysynth ↔ engines` (2/1) y `polysynth ↔ core` (2/1), que caen al reubicar la carpeta (§2), y `polysynth ↔ session` ya era sólo de tipos;
- frente 2 rompe `engines ↔ presets` — que **es sólo de tipos** (11/0), así que baja el total, no el techo de valor — y parte de `engines ↔ core` (23/3 de valor: ahí sí se gana);
- frente 3 rompe parte de `session ↔ core`, el único par mutuo grande de verdad (**98/3 de valor**).

**Paso 4 — Repartir `core/`.** Es la causa del único par mutuo grande y la señal más clara de ausencia de arquitectura: un cajón de 100+ ficheros que va desde `NoteEvent` (datos puros) hasta `pianoroll.ts` (canvas). Se reparte entre `model/`, `runtime/` y `ui/`. **Esto se hace al final**, cuando los frentes anteriores hayan reducido el enredo, y probablemente merezca su propio spec.

> **⛔ DECISIÓN:** ¿el reparto de `core/` entra en esta ronda o se queda como spec siguiente con el trinquete ya puesto? Recomiendo lo segundo, y la revisión de §1.1 lo refuerza: no hay bomba que desactivar, así que poner el trinquete ahora vale más que mover 100 ficheros ya.

---

### Frente 6 — El estado sale del DOM

**Los sitios verificados:**

1. **El save lee el volumen del DOM.** [saved-state-v3.ts:70](../../../src/save/saved-state-v3.ts): `masterVol: parseFloat(volInput.value)`. Y [master-strip.ts:18](../../../src/core/master-strip.ts) lo documenta: *"el fader es un PROXY de `#volume`"* — un `<input>` de `index.html` **es** el modelo del volumen maestro y dos vistas se sincronizan despachando eventos a través de él. **Esto es un defecto, no estilo.**
2. **La automatización lee un atributo HTML.** [performance-feature.ts:417](../../../src/app/performance-feature.ts): `k.el.getAttribute('data-value-norm')`.
3. **Transporte:** bpm, swing y compás tienen su verdad en los `<input>`.
4. **Pestaña activa por `dataset.page`, dos veces** — [main.ts:330](../../../src/main.ts), [session-host-lane-editor.ts:44](../../../src/session/session-host-lane-editor.ts). *(El borrador decía tres y citaba `synth-editor-routing.ts`: ese fichero ya no existe.)*
5. **Validez del drop en una clase CSS** — [session-clip-drag.ts:114](../../../src/session/session-clip-drag.ts) calcula, escribe `.drop-valid` y **relee** la clase para decidir.
6. **Voz de drum seleccionada en `.dv-col.selected`** — [drum-voice-rack.ts:122](../../../src/engines/drum-voice-rack.ts).

Los seis reverificados sobre `main` el 2026-07-26; sólo el nº 4 cambió.

**Excepciones legítimas — NO se tocan.** Modelarlas duplicaría estado, que es el defecto que queremos evitar:
- **El foco** (`document.activeElement`) — el navegador es su dueño.
- **La geometría** (117 usos de `getBoundingClientRect`/`scrollLeft`) — medida física del layout, no estado.
- **`e.target.value` dentro de un handler** — eso es leer el *evento*. Es la mayoría de los aciertos del grep y no es deuda.
- **Los diálogos** ([project-options-dialog](../../../src/session/project-options-dialog.ts), [stem-dialog](../../../src/stems/stem-dialog.ts)) — leen su formulario al aceptar; estado efímero de un solo dueño.

**El cierre:** un test recorre el árbol y falla ante `getAttribute`, `classList.contains`, `dataset.*` leído y `.value` fuera de handler, contra una allowlist donde **cada excepción lleva su razón escrita**. Eso es lo que una capa de indirección no da: una capa se puede llamar desde donde no toca; un test no.

---

## 4. Transversal — Capacidades declaradas en vez de nombres

Entre 54 y 63 comparaciones literales según el patrón (`engineId === 'subtractive'` / `'drums-machine'` / `'tb303'`), en **23 ficheros** — el borrador decía ~20 y se quedaba corto por un factor de tres. Repartidas por [lane-allocator](../../../src/app/lane-allocator.ts), [trigger-dispatch:48](../../../src/app/trigger-dispatch.ts), [voice-manager:113](../../../src/audio-dsp/voice-manager.ts), [session-host-lane-editor](../../../src/session/session-host-lane-editor.ts), [engine-selector-ui](../../../src/engines/engine-selector-ui.ts), [lane-editor-panels](../../../src/session/lane-editor-panels.ts), [clip-editor-router](../../../src/session/clip-editors/clip-editor-router.ts)… `subtractive` es caso especial en tres puntos del mismo fichero.

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

Riesgo medido con el grafo de GitNexus (`impact upstream`) sobre el índice **reconstruido el 2026-07-26** (10.316 nodos / 27.392 aristas), no estimado a ojo. El índice anterior contenía ficheros ya borrados, así que las cifras del borrador estaban tomadas sobre un grafo caducado:

| # | Frente | Símbolo clave | Radio real | Riesgo | Por qué ahí |
|---|---|---|---|---|---|
| 0 | Código muerto | — | — | — | ✅ **HECHO** (`d7e6272`, `df13688`, `c7d8eb6`, `636ab9b`). |
| 0.5 | Revivir la batería DSP | — | sólo tests | **Bajo** | Red de seguridad de los frentes 2 y 3. Va ANTES de tocar audio. |
| 1 | Un solo registro | `registerEngine*` | contrato de extensión (6 registros) | Medio | Todo lo demás cuelga de él. |
| 2 | Interfaz honesto | `SynthEngine` | **241** (39 directos, 20 módulos) | **CRÍTICO** | ⚠️ ver abajo. |
| 3 | Bus de notas | `NoteEvent` | camino de audio | **Alto** | Con el terreno ya despejado y la batería puesta. |
| 4 | Bus de control | `setBaseValue` | 17 llamadas, **8 externas a engine** | Bajo-medio | Cierra un agujero de guardado real. |
| 5 | Capas | — | 16 pares mutuos de valor; **0 ciclos en ejecución** | Bajo-medio (trinquete) | Disciplina, no urgencia (§1.1). |
| 6 | Estado fuera del DOM | — | 6 sitios concretos + transporte | Bajo | Independiente. |

**Correcciones que salen de medir en vez de estimar:**

1. **`SynthEngine` es CRÍTICO, y más de lo que decía el borrador.** Con el índice fresco: **241** símbolos impactados (no 139), 39 directos, 39 procesos y 20 módulos. GitNexus sigue marcando el resultado como **cota inferior**: *"es una interfaz con 4 implementaciones; los que enlazan a través de ella no se trazan hasta el símbolo concreto — el impacto real puede ser mayor"*. Por tanto el frente 2 **no se hace de una pasada**: se parte en sus tres piezas (2.1 sacar la UI, 2.2 adelgazar `Voice`, 2.3 los presets) y cada una se cierra en verde antes de empezar la siguiente.

2. ~~**`PolySynth` no es un borrado trivial** (51 símbolos, 13 directos)…~~ **Resuelto: se hizo en un commit (`df13688`).** El radio de 51 símbolos no se tradujo en varias sesiones. Lección para leer esta tabla: `impact upstream` mide *cuántos símbolos alcanzan al objetivo*, y en un símbolo que sólo se importa **como tipo** eso sobreestima el trabajo. Aplícalo también a `SynthEngine`: su 241 incluye mucho tráfico de tipos.

3. **`setBaseValue` baja de nivel.** El borrador decía "11 llamadores"; son 17 llamadas de las que **8** escriben un engine desde fuera, 4 escriben un FX y 5 son internas del propio engine (frente 4). El agujero de política es real y está en 2 de esas 8.

4. **El frente 5 baja de "Medio" a "Bajo-medio".** No porque haya menos pares, sino porque ninguno es un ciclo de carga: **cero ciclos de import en ejecución** (§1.1). Es deuda de organización, no un fallo latente.

**Y un dato que se mantiene al alza, con matiz:** los casos especiales por id de engine están en **23 ficheros** — eso es firme. La cuenta de ocurrencias baila entre **54 y 63** según el patrón que se use (el borrador dio 63; un regex más estricto da 54). Los peores no cambian: `session-host-util` (7), `lane-allocator` (6), `session-inspector` (4), `clip-editor-router` (4), `session-host-lane-editor` (3). El trabajo transversal de §4 sigue siendo mayor de lo que decía el borrador original de ~20.

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
3. ~~**`ensureExtraPoly`** — confirmar con traza que el camino `poly1..poly16` está muerto antes de retirarlo.~~ **RESUELTO 2026-07-26: estaba muerto y se retiró** en `df13688`. Sólo quedan siete mocks en tests de `session-host`.
4. **Reparto de `core/`** — ¿en esta ronda o spec siguiente con el trinquete ya puesto? (recomiendo lo segundo, y la revisión de §1.1 lo refuerza)
5. **Nuevo — ¿dónde va la superficie de presets del subtractive?** `src/polysynth/` ya no contiene ningún `PolySynth`. Cinco ficheros vivos buscando carpeta: `presets/` (van con el cargador) o `engines/subtractive/` (van con su motor). Se decide al hacer el frente 2.3, no antes.
6. **Nuevo — ¿el trinquete del frente 5 vigila también los `import type`?** Recomendación: cuenta los dos techos pero **sólo falla por los de valor**; los de tipos se listan en el informe del test como deuda anotada. Si falla por tipos, el atajo obvio es convertir imports en `import type` y no haber movido nada.
