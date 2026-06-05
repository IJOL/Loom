# Loops de clip + arrangement reproducible — diseño

Fecha: 2026-06-05 · Estado: aprobado (brainstorming), pendiente de plan de implementación.

## Contexto y motivación

Loom es session-based: cada lane repite su clip al lanzar una escena, pero **no existe**
ningún concepto de "loop" más allá de "el clip entero se repite". Faltan dos capacidades
que el usuario pidió:

1. **Loop de zona dentro de un clip** — repetir solo una sub-región de un clip (p. ej. los
   compases 2–3 de un clip de 4), independiente del resto de clips.
2. **Loop global que afecte a todo por igual** — y, más en general, **darle significado real
   al arrangement**: hoy la vista Performance ([performance-ui.ts](../../src/performance/performance-ui.ts))
   ya es una timeline con regla, bandas de clips y playhead, pero es **solo de grabación/lectura**
   y **no reproduce con sentido** (los lanes que lanza siguen loopeando indefinidamente vía
   session-runtime; no hay parada ni loop A–B).

El sampler **ya** reproduce loops de audio segmentados (slices) y con cambio de BPM sin tocar
el pitch (estiramiento OLA, `warpMode: 'slice' | 'stretch'`); aquí solo se integra, sin DSP nuevo.

Las dos features se entregan en **un único spec** (decisión del usuario), pero son dos
subsistemas con modelos de datos distintos.

## Alcance

### Dentro
- **🅰 Loop de clip**: sub-región interna (inicio–fin) por clip, para clips de notas y de audio.
- **🅱 Arrangement reproducible**:
  - **Poblar** el arrangement sin grabar: botón *Copiar a Performance* (vuelca las escenas en
    orden) e import MIDI (genera el arrangement automáticamente).
  - **Reproducir**: modo *song* (de inicio a fin y **para**) y modo *loop* (brace A–B que repite
    ese tramo afectando a todos los lanes por igual).
  - **Integración del sampler**: los clips de audio siguen el tempo del arrangement sin pitch.

### Fuera (decisiones tomadas en brainstorming)
- **Flag "clip independiente del loop global"** (la parte de "las dos cosas"): descartado por
  YAGNI. Como el loop global vive **solo en el arrangement** (lineal), "independiente" sería una
  banda que sigue sonando fuera del brace A–B — raro y caro. Anotado como extensión futura.
- **Edición de bandas en la timeline** (mover/redimensionar/crear clips a mano): fuera. La
  timeline se puebla por *Copiar a Performance* / import / grabación; las bandas siguen siendo
  generadas, no editables a mano.
- **Repeticiones por escena configurables**: cada escena ocupa **una pasada** (la duración de su
  clip más largo). Ajuste fino = fuera.
- **Mejora del DSP de estiramiento** (OLA→WSOLA, artefactos): fuera. Solo integración.
- **Meter por-clip en el arrangement**: el arrangement asume **4/4** (como hoy: `barSec = (60/bpm)·4`).
  El meter global de la sesión sí lo respeta el loop de clip (vía `quartersPerBar(meter)`).

### Sin cambio de schema
Todos los campos nuevos son **opcionales y aditivos**, con defaults que reproducen el
comportamiento actual ⇒ **sin bump de `schemaVersion` y sin migración**. `ArrangementState` ya se
persiste en v3 ([saved-state-v3.ts](../../src/save/saved-state-v3.ts)); los nuevos campos viajan
con él. `SessionClip` ya admite campos opcionales (p. ej. `gridResolution`).

---

## 🅰 Feature A — Loop de clip

### A.1 Modelo de datos
En `SessionClip` ([session.ts:42](../../src/session/session.ts#L42)):
```ts
loopEnabled?: boolean;   // ausente ⇒ false (el clip se repite entero, como hoy)
loopStartTick?: number;  // ticks dentro del clip; default 0
loopEndTick?: number;    // ticks; default = lengthBars × ticksPerBar
```
- Unidad = **ticks** (igual que `NoteEvent.start`), para filtrar notas sin redondeos.
- `ticksPerBar = quartersPerBar(meter) × TICKS_PER_QUARTER`.
- Helper puro testeable `effectiveClipLoop(clip, meter) → { startTick, endTick, durSec(bpm) }`
  que aplica los defaults y la guarda `endTick > startTick` (si no, se ignora el loop). Es la
  única fuente de verdad de la sub-región; la usan el scheduler, el sampler y la UI.

### A.2 Motor — `tickLane` ([lane-scheduler.ts:68](../../src/core/lane-scheduler.ts#L68))
Hoy `clipDurSec` mide el clip entero y se itera sobre todas las notas. Con `loopEnabled`:
- **Periodo**: `clipDurSec = (endTick − startTick) / TICKS_PER_QUARTER × secPerBeat`. Toda la
  matemática de anclaje sin-deriva (`floor(elapsed/clipDurSec)`) queda intacta — solo cambia el
  periodo.
- **Clips de notas / slice**: se disparan solo las notas con `startTick ≤ n.start < endTick`,
  reposicionadas: `scheduleAt = iterStart + (n.start − startTick)/TPQ × secPerBeat`. En slice mode,
  la región de slice se adjunta igual que ahora.
- **Clips de audio (no-slice)**: hoy dispara un buffer/iteración a `clip.lengthBars`. Con
  sub-región, dispara solo la porción `[startTick, endTick)` del buffer:
  - `f0 = startTick / totalTicks`, `f1 = endTick / totalTicks` (con `totalTicks = lengthBars × ticksPerBar`).
  - `bufStart = trimStart + f0·(trimEnd − trimStart)`, `bufEnd = trimStart + f1·(trimEnd − trimStart)`.
  - Se pasan al sampler como `trimStart/trimEnd` efectivos; `duration` del trigger = sub-región en ticks.
  - Compatible con `warpMode: 'stretch'` (el buffer estirado mantiene la correspondencia por fracción).
- **Sin `loopEnabled`** ⇒ ruta actual, byte por byte. Cero regresión (test de no-regresión obligatorio).

### A.3 Sampler (integración)
El path `triggerSample` ([sampler.ts](../../src/engines/sampler.ts)) ya reproduce sub-rangos del
buffer (`trimStart/trimEnd`). El scheduler le pasa el trim efectivo de la sub-región; el sampler
no necesita lógica nueva. El estiramiento sin-pitch ya existente sigue aplicando.

### A.4 UI
Brace de loop sobre la regla de cada editor de clip (piano-roll, drum-grid, loop-editor), montado
por el router ([clip-editor-router.ts](../../src/session/clip-editors/clip-editor-router.ts)):
- Dos asas arrastrables (inicio/fin) + toggle **Loop**. *Snap* a la rejilla del clip
  (`gridResolution`). Zona activa resaltada; notas/contenido fuera de la zona atenuados.
- Toggle off ⇒ el clip vuelve a sonar entero.
- Mutaciones (`loopEnabled/loopStartTick/loopEndTick`) pasan por `withUndo`
  ([history-wiring.ts](../../src/save/history-wiring.ts)) y se reflejan en `lane.engineState` por el
  camino normal de edición de clip (no hay ruta de render paralela: se va por `session-host`).

---

## 🅱 Feature B — Arrangement reproducible

### B.1 Modelo de datos
En `ArrangementState` ([performance.ts:28](../../src/performance/performance.ts#L28)):
```ts
loopEnabled?: boolean;   // ausente ⇒ false (modo song: reproduce y para al final)
loopStartBar?: number;   // default 0
loopEndBar?: number;     // default = effectiveDuration en compases
```

### B.2 Poblar — `arrangementFromSession(session, bpm, opts?) → ArrangementState` (pura)
Nueva función pura en `performance/` que construye los `clipEvents` reutilizando
`appendClipEvent`/`getOrCreateLane` ([arrangement-ops.ts](../../src/performance/arrangement-ops.ts)).
Algoritmo (todo en segundos; `barSec = (60/bpm)·4`):
- Recorre `session.scenes` **en orden**. Acumula `sectionStartSec`.
- Para cada escena, la **duración de sección** = máximo, sobre los lanes con clip en esa escena
  (`scene.clipPerLane`), de la **duración efectiva** del clip en compases × `barSec`. Duración
  efectiva = sub-región (si `loopEnabled` del clip) o `lengthBars`.
- Para cada lane con clip en la escena: un `clipEvent` con `atSec = sectionStartSec`,
  `untilSec = sectionStartSec + sectionDurSec`. El clip **loopea dentro** de ese rango vía
  session-runtime (no se replica evento por repetición). `appendClipEvent` ya cierra el evento
  anterior del lane al abrir el siguiente.
- `durationSec` final = fin de la última sección. `loopEndBar` por defecto = `durationSec / barSec`.

Dos puntos de entrada:
- **Botón "⇉ Copiar a Performance"** en la barra de Session: llama a la función con el estado
  actual, asigna el arrangement (`setArrangement`), conmuta a modo Performance, refresca. Pasa por
  `withUndo`.
- **Import MIDI** ([midi-to-session.ts](../../src/midi/midi-to-session.ts) → su consumidor en la UI
  de import): tras crear lanes/escena, llama a la misma función. Como el clip MIDI tiene
  `lengthBars` = toda la canción, sale **una pasada por lane de 0 a fin** = el tema completo.

### B.3 Reproducción — `tickArrangement` ([arrangement-runtime.ts:61](../../src/performance/arrangement-runtime.ts#L61))
Hoy solo emite eventos y nunca para. Cambios:
- **Fin del arrangement**: `endSec = loopEnabled ? loopEndBar·barSec : effectiveDurationSec(state)`.
- **Modo *song*** (`loopEnabled` falso): al alcanzar `endSec`, programar `onStopLane` de **todos**
  los lanes en `endSec` y notificar fin (un callback `onArrangementEnd` que el feature usa para
  parar el transporte y `stopArrangement`). Sin esto, los lanes seguirían loopeando.
- **Modo *loop*** (`loopEnabled` cierto): `loopStartSec = loopStartBar·barSec`. Al cruzar `endSec`:
  1. programar `onStopLane` de todos los lanes en `endSec`;
  2. re-anclar el reloj: `startedAtCtx += (endSec − loopStartSec)` (así el nuevo `tNow` en la
     frontera vale `loopStartSec`);
  3. resetear `nextEventIdxPerLane` al primer evento con `atSec ≥ loopStartSec`;
  4. para cada lane con un clip **activo en `loopStartSec`** (evento que lo cubre), relanzarlo en la
     frontera (si no, un clip que arrancó antes de A no sonaría tras el wrap).
  Es el punto más delicado (lookahead + dedupe por índice): se cubre con tests de frontera
  (sin doble-fire, sin huecos).
- **Playhead** ([performance-feature.ts:233](../../src/app/performance-feature.ts#L233)): ya
  existe; en modo loop el `rafPlayhead` debe envolver con módulo sobre `[loopStartSec, endSec)`.

### B.4 UI
- **Brace A–B** sobre `.perf-ruler` ([performance-ui.ts:16](../../src/performance/performance-ui.ts#L16)):
  dos asas arrastrables + toggle **Loop A–B** en el toolbar. Off ⇒ song.
- **Botón "⇉ Copiar a Performance"** en la barra de Session (junto al `#mode-toggle`).
- Mutaciones (brace, length) pasan por `onPerformanceEdited` → `withUndo`, como las demás ediciones
  de Performance.

---

## Composición de A y B
Las dos features se componen sin caso especial: en `arrangementFromSession`, la duración efectiva
de un clip con sub-región de loop (A) es su sub-región, así que una escena cuyo clip más largo
tenga loop interno dimensiona la sección por la sub-región. En reproducción, cada banda lanza su
clip y el scheduler (A.2) ya respeta el loop interno dentro de la ventana de la banda.

## Testing (las 4 capas del repo)
- **Pure**: `effectiveClipLoop` (defaults, guarda `end>start`); `arrangementFromSession` (escenas en
  orden → `atSec/untilSec` correctos; sección dimensionada por el clip más largo; import MIDI = 1
  pasada).
- **Scheduling (fake clock)**: `tickLane` con `loopEnabled` (dispara solo la sub-región, periodo
  correcto, sin doble-fire, sin regresión con loop off); `tickArrangement` song (para al final,
  stop a todos los lanes) y loop (wrap A–B sin doble-fire ni hueco en la frontera; relanzado de
  clip activo en A).
- **DSP real (opcional)**: render de un clip de notas y uno de audio con sub-región para inspección
  audible (WAV en `test/output/`).
- **e2e**: *Copiar a Performance* → aparecen bandas y conmuta a Performance; brace de arrangement
  loopea; import MIDI deja el arrangement poblado; assert relativo (no magnitudes absolutas).

## Riesgos y decisiones
- **Wrap del loop de arrangement** (B.3): lookahead + dedupe por índice. Mitigación: re-anclar
  `startedAtCtx` + resetear índices + relanzar clip activo en A; tests de frontera. Riesgo principal.
- **Sub-región de audio no-slice** (A.2): mapeo compases→segundos de buffer; verificar con
  `warpMode` slice y stretch.
- **Parada al final** (B.3): el stop debe alcanzar **todos** los lanes, incluidos los que el
  arrangement no relanzó en ese instante.
- **Undo**: *Copiar a Performance* y mover braces deben ser deshacibles (`withUndo`).
- **Suposición 4/4 del arrangement**: consistente con el código actual; el meter por-clip queda fuera.

## Fuera de alcance / extensiones futuras
- Flag "clip independiente del loop global".
- Edición libre de bandas en la timeline; repeticiones por escena configurables.
- Mejora del DSP de estiramiento (WSOLA); crossfade de loop; loop-end por pad en one-shots.
- Meter por-clip / por-sección en el arrangement.
