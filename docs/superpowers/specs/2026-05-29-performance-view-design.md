# Performance view — Arrangement reproducible con REC

**Date:** 2026-05-29
**Status:** Approved (brainstorm complete)
**Scope:** Añadir un segundo modo de UI, **Performance view**, que es un Arrangement reproducible estilo Ableton. Un lane horizontal por synth lane, un botón REC global que captura clip-launches y movimientos de knobs mientras la Session está sonando; el Arrangement resultante se reproduce con su propio transporte y reusa engines + scheduler existentes.

---

## 1. Goal & Non-goals

**Goal.** Un segundo modo (toggle `Session | Performance` en transport). Mientras REC esté armado y la Session esté sonando, el sistema graba (a) cada clip-launch del usuario y (b) cada movimiento de knob registrado en `automationRegistry`. En modo Performance, el Arrangement grabado se reproduce con un transporte propio; durante esa reproducción, lanzar un clip a mano "overrideá" esa lane hasta pulsar "Back to Arrangement".

**Non-goals (MVP).**
- Edición del timeline (mover, recortar, redibujar bloques o curvas).
- Multi-take / historial de takes — el overdub manda, no hay lista de takes.
- Export WAV/MIDI.
- Auto-grabación de notas tocadas con teclado/MIDI fuera de un clip.
- Reverse: convertir un Arrangement grabado en clips de Session.
- Botón visible de "Back to Arrangement" / Session grid embebida en Performance view — el override queda cableado en runtime pero sin UI alcanzable en MVP (queda para fase posterior).
- Migración formal de saves antiguos. Solo se añade el campo `arrangement` al save; si no está, Performance arranca vacío. Sin bump de versión, sin lógica de migración.

---

## 2. Architecture summary

- **Mismo runtime de audio.** Performance reusa engines, channel strips, mixer y `automationRegistry`. Nada de DSP nuevo.
- **`mode: 'session' | 'performance'`** en el runtime, con toggle en la barra de transport. Cambiar de modo emite `stopAll()` y oculta/muestra el árbol UI correspondiente.
- **Dos modelos coexisten en memoria y en saves.** `SessionState` (existe) y `ArrangementState` (nuevo). Evolucionan independientes — Session sigue siendo la fuente de clips, Arrangement es el canvas temporal.
- **Tres modos de scheduling:** (1) Session play = `tickSession` existente. (2) Performance play = nuevo `tickArrangement` que lee `clipEvents` y `automationCurves` por lane. (3) Session play **con REC armado** = `tickSession` con un proxy que appendea cada acción del usuario a `ArrangementState`.
- **Override por lane durante Performance play.** Si el usuario lanza un clip a mano (alcanzable solo desde runtime/keyboard en MVP, no desde UI), `laneOverridden[id] = true` y `tickArrangement` ignora esa lane.
- **REC armado solo es válido con la Session sonando.** Si REC está armado y se pulsa Play en Performance, REC se desarma con un toast informativo.

---

## 3. Data model

```ts
// New, in src/performance/performance.ts
export interface ArrangementClipEvent {
  clipId: string;           // ref a SessionClip por id
  laneId: string;
  atSec: number;            // tiempo absoluto desde t=0 del arrangement
  untilSec: number;         // hasta cuándo suena (overdub puede recortar al añadir uno nuevo)
}

export interface AutomationCurve {
  paramId: string;          // mismo namespace que automationRegistry
  // Muestreado a AUTOMATION_SUB_RES por step a BPM "de grabación".
  // Length = ceil(durationSec * stepsPerSec * AUTOMATION_SUB_RES).
  samples: number[];
}

export interface ArrangementLaneRec {
  laneId: string;
  clipEvents: ArrangementClipEvent[];     // ordenados por atSec, sin solape
  automation: AutomationCurve[];          // 0..N, solo paramIds tocados
}

export interface ArrangementState {
  bpm: number;                             // BPM al que se grabó
  durationSec: number;                     // 0 si vacío; max untilSec entre lanes
  lanes: ArrangementLaneRec[];             // 1 entry por laneId tocada
  /** Automation a paramIds que no pertenecen a ninguna lane (mix global / master FX). */
  globalAutomation: AutomationCurve[];
}
```

**Notas.**
- `clipEvents` no se solapan dentro de un lane: overdub recorta el `untilSec` del anterior antes de pushear el nuevo.
- **Routing lane vs global.** Convención existente del repo: paramIds per-lane son `<laneId>.<param>` (ver [src/core/lane-display.ts](src/core/lane-display.ts) y `extraIds` en [src/automation/automation-ui.ts](src/automation/automation-ui.ts)). Regla: si el `paramId` empieza por `<laneId>.` para alguna lane en `sessionState.lanes`, va a `lane.automation`; en caso contrario (prefijos `fx.`, `mix.`, `tb303.`, `poly.`, `main.`, …) va a `globalAutomation`.
- `stepsPerSec = bpm / 60 * 4` (16th notes por segundo al BPM dado).
- `bpm` se congela al grabar. En MVP el playback siempre usa `ArrangementState.bpm`. Knob "follow BPM" queda fuera.
- Una `AutomationCurve` solo existe si su `paramId` se tocó al menos una vez durante una grabación.
- Referencia por id: si el usuario edita las notas del `SessionClip` en Session, la reproducción del Arrangement refleja los cambios (decisión de la brainstorm).

---

## 4. REC + grabación

### 4.1 Estado de REC

```ts
interface RecState {
  armed: boolean;
  recording: boolean;                         // armed && session.transport.isPlaying
  startedAtSec: number;                       // ctx.currentTime al empezar
  pendingClipEnds: Map<string, number>;       // laneId → índice del clipEvent abierto
  lastSampledStepIdx: number;                 // para sample-and-hold de automation
}
```

`recording` es derivado: pasa a `true` cuando el usuario pulsa Play en Session con REC armado; vuelve a `false` cuando para el transport o desarma REC. Cambiar a `false` cierra todo `clipEvent` abierto fijando `untilSec = now - startedAtSec`.

### 4.2 Captura de clip-launches

Hook en `launchClip` / `stopLane` / `launchScene` de `session-runtime.ts`. Cuando `recording === true`:

1. **launchClip** → al **promover** (cuando el queue cruza el `queuedBoundary` y el clip empieza a sonar), no en el click:
   - Si hay `pendingClipEnds.get(lane.id)`, cierra ese evento: `event.untilSec = arrangementNow`.
   - Crea `{ clipId, laneId, atSec: arrangementNow, untilSec: +∞ }`, añade a `lane.clipEvents`, guarda índice en `pendingClipEnds`.
2. **stopLane** → cierra el evento abierto si existe, borra de `pendingClipEnds`.
3. **launchScene** → emite N launchClips, mismo tratamiento.

`arrangementNow = ctx.currentTime - rec.startedAtSec`.

### 4.3 Captura de automation

Cada `KnobHandle.set` se envuelve con un proxy que, si `recording === true`, marca el paramId como "tocado" en un buffer transitorio. Cada tick del clock (25 ms) hace **sample-and-hold**:

- Para cada `paramId` tocado desde la última muestra, escribe el valor actual del knob en `curve.samples[subIdx]`, donde `subIdx = floor(arrangementNow * stepsPerSec * AUTOMATION_SUB_RES)`.
- Si un `paramId` no se toca en un sub-step, **se rellena por hold** con el último valor escrito (curva continua al reproducir).
- Sub-bandas: paramIds que mapean a un synth lane van a `lane.automation`; el resto a `globalAutomation`.

### 4.4 Overdub

- `arrangementNow` se reinicia a 0 en cada take (Play del Session con REC armado arranca desde 0 en MVP).
- Para `clipEvents`: el nuevo evento recorta el `untilSec` del previo en la misma lane si solapa.
- Para `automation`: el sample-and-hold sobrescribe `curve.samples[subIdx]` solo en los sub-steps donde el knob se tocó durante esta take. Lo no tocado conserva el valor previo. → semántica de overdub: solo cambia lo que tocaste.

---

## 5. Playback (modo Performance)

### 5.1 Transport propio

El Arrangement tiene su propio Play/Pause/Stop, independiente del Play de Session. Durante playback aplica `arrangement.bpm`, no el BPM del transport global. El playhead avanza en segundos absolutos desde 0.

```ts
interface ArrangementPlayState {
  isPlaying: boolean;
  playheadSec: number;
  startedAtCtxTime: number;
  laneOverridden: Map<string, boolean>;
  nextEventIdxPerLane: Map<string, number>;
  pendingClipPlays: Map<string, {clipId: string, startedAtCtx: number}>;
}
```

### 5.2 `tickArrangement`

Nueva rama del lookahead loop, paralela a `tickSession`:

```
arrangementNow = ctx.currentTime - startedAtCtxTime
lookahead = 0.12

for each lane in arrangement.lanes:
  if laneOverridden[lane.id]: continue
  while nextEvent.atSec < arrangementNow + lookahead:
    schedule launchClip(lane, clipById(event.clipId)) at startedAtCtxTime + event.atSec
    schedule stopLane(lane) at startedAtCtxTime + event.untilSec
    nextEventIdxPerLane[lane.id]++

// automation:
for each laneRec (and globalAutomation):
  if lane.id in lanes and laneOverridden[lane.id]: continue
  for each curve:
    subIdx = floor(arrangementNow * stepsPerSec * AUTOMATION_SUB_RES)
    automationRegistry.get(curve.paramId)?.set(curve.samples[subIdx])
```

`launchClip` / `stopLane` aquí son las mismas funciones de `session-runtime.ts`. El Arrangement controla los `LanePlayState` igual que lo haría un usuario apretando ▶︎.

### 5.3 Override "Back to Arrangement"

- La lógica de override está **cableada en runtime** (función `overrideLane(laneId)` que setea `laneOverridden[laneId] = true`, función `backToArrangement()` que limpia el mapa entero), pero **ningún path de UI la invoca en MVP** (no hay Session grid embebida en Performance, no hay botón). Queda lista para una fase posterior que añada esos puntos de entrada.
- Cuando `laneOverridden[lane.id] === true`, `tickArrangement` salta esa lane (ni clip-events ni automation curves). Al limpiar el flag, la lane vuelve a leer del timeline desde la posición actual del playhead (no se reinicia desde 0).

---

## 6. UI

### 6.1 Toggle de modo

En la barra de transport, segmented control:
```
[ Session | Performance ]
```
Click emite `stopAll()` y cambia el árbol UI. El transport bar permanece visible en ambos modos.

### 6.2 Layout del Performance view

Estructura (validada con mockup visual durante brainstorm):

```
┌─ Transport ─────────────────────────────────────────────────────┐
│ [▶] [⏹] [● REC]   BPM 130   [Session|Performance]               │
└─────────────────────────────────────────────────────────────────┘
┌─ Toolbar ───────────────────────────────────────────────────────┐
│ Zoom: 1× 2× 4×            Arrangement: 8 bars · 130 BPM         │
├─────────────────────────────────────────────────────────────────┤
│  bars  │ 1    2    3    4    5    6    7    8                   │
├────────┼────────────────────────────────────────────────────────┤
│ BASS   │ ███acid A██████ ████acid B (3 bars)████████            │
│ cutoff │ ╱╲╱╲╱─────────╲─────────────────                       │
│ reso   │ ──╱──╲──╱──╲────────────                               │
│ DRUMS  │ ████████████████ groove · 8 bars (loops) █████████████ │
│ SUB 1  │ ████pad (2 bars)    ██████pad (4 bars)████████         │
│ pan    │ ╲────╱────╲────╱────                                   │
├────────┼────────────────────────────────────────────────────────┤
│ MASTER │ fx.reverb.wet: ────╱──────────                         │
└────────┴────────────────────────────────────────────────────────┘
                              ▲ playhead
```

**Componentes:**
- **Toolbar interna** (debajo del transport, dentro del Performance view): selector de zoom (1×, 2×, 4× en MVP) y un texto con `durationSec` en bars y BPM congelado.
- **Ruler** con marcas de bar (1 bar = `60 / arrangement.bpm * 4` segundos), tick por beat.
- **Lane row** por cada `SessionLane`, mismo orden y label que en Session. Altura fija ~40px para clips + ~32px por sub-banda de automation.
  - **Banda de clip-events:** bloques con el `color` del `SessionClip` referenciado, posicionados `atSec → untilSec`. Etiqueta interna: `clip.name ?? clipId`.
  - **Sub-bandas de automation:** una franja por `paramId` automatizado en esa lane, curva renderizada en canvas. Label a la izquierda con el `paramId`. Plegable (estado plegado/desplegado no se persiste en MVP).
- **Sección global** debajo de las lanes: una banda por `paramId` en `globalAutomation`.
- **Playhead** vertical animado a `requestAnimationFrame` cuando Performance está sonando.

### 6.3 Transport / botón REC

- **REC:** toggle al lado de Play. Armado dibuja un círculo rojo. El estado armado se conserva al cambiar de modo.
- **Play en Session con REC armado** → empieza grabación.
- **Play en Performance con REC armado** → REC se desarma; toast: "REC desarmado: Performance está reproduciendo".
- **Play/Stop:** en Performance controla el transport del Arrangement; en Session controla el de Session (sin cambios).

### 6.4 Estado vacío

Si `arrangement.durationSec === 0`, Performance view muestra un placeholder: "Sin grabación. Arma REC, vuelve a Session, lanza clips y mueve knobs." con botón "Volver a Session".

### 6.5 Clips "missing"

Un clip-event cuyo `clipId` ya no existe en `SessionState` (porque el clip fue borrado) se renderiza como bloque gris rayado con etiqueta "missing". El clip-event no se borra de los datos — si el usuario hace Undo del borrado, vuelve a sonar.

---

## 7. Persistencia

El bloque `arrangement` se serializa dentro del save existente como un campo más, junto a `mode` (string). No hay bump de versión, no hay lógica de migración:

- Save sin `arrangement` → Performance arranca vacío.
- Save sin `mode` → arranca en `session`.
- Save con `arrangement` y `mode` → se restauran ambos.

Tamaño esperado para un Arrangement típico (≤ 64 bars a 130 BPM con ~4 params automatizados): ~30 KB por curva, total << 1 MB. Si emerge problema de tamaño, run-length encoding en una fase posterior.

---

## 8. Error handling

- **Toggle de modo durante Play** → `stopAll()` antes de cambiar UI; lanes vuelven a silencio.
- **REC armado al pulsar Play en Performance** → REC se desarma, toast, no se graba.
- **Tab background throttle** → `tickArrangement` y el sampler de automation usan el mismo guard que `tickSession`: si el callback se retrasa > 500 ms, playhead salta a "now" en vez de descargar un backlog.
- **Cambio de engine de una lane con automation grabada targeting paramIds del engine antiguo** → curves se conservan en datos; al reproducir, `automationRegistry.get(paramId)` falla silenciosamente; UI marca la curva en gris con badge "engine cambiado".
- **Lane borrada en Session que tiene grabación en Arrangement** → el `ArrangementLaneRec` se conserva pero sin lane asociada; UI lo muestra como "lane removed — restore?" con opción de añadir lane vacía o borrar la grabación.
- **Clip-event con `clipId` inexistente** → bloque gris rayado en UI; runtime lo salta sin error.

---

## 9. Testing

Aplica la convención del repo: aserciones **relativas**, nunca magnitudes absolutas (justificar absolutos en comentario si aparece alguno).

| Capa | Qué probar | Cómo |
|---|---|---|
| Pura | `appendClipEvent` overdub: nuevo evento recorta `untilSec` del previo en la misma lane | unit test sobre `src/performance/arrangement-ops.ts` |
| Pura | `sampleAutomationAt(curve, sec, bpm)` devuelve el sample correcto con hold | unit test |
| Pura | Lane-vs-global routing por prefijo de paramId | unit test |
| Scheduling | `tickArrangement` emite `launchClip` en el `atSec` correcto y `stopLane` en `untilSec` | fake-clock harness extendido en [test/sequencer-harness.ts](test/sequencer-harness.ts) |
| Scheduling | `laneOverridden[id] = true` detiene la emisión solo para esa lane | mismo harness |
| Scheduling | REC overdub: dos takes consecutivas, la segunda recorta `untilSec` del clip-event de la primera donde haya solape | mismo harness |
| Scheduling | Automation REC: mover un knob durante REC produce una curve con valores != hold default en los sub-steps tocados, valores con hold en el resto | mismo harness |
| DSP | Reproducir un Arrangement con 2 lanes + 1 automation curve produce audio coherente (energía en cada lane > 0, RMS > silencio) | nuevo `arrangement.dsp.test.ts` con `OfflineAudioContext` |
| E2E | Armar REC, lanzar un clip, parar, cambiar a Performance, Play → suena lo grabado | nuevo Playwright spec |

---

## 10. Orden de implementación (alto nivel)

Esta lista informa el plan; `writing-plans` lo descompondrá en tareas concretas con sub-pasos de TDD.

1. Tipos puros en `src/performance/performance.ts` + `arrangement-ops.ts` (append, overdub, sample-at), con unit tests.
2. `RecState` + proxy en `automationRegistry` para capturar set → buffer; sample-and-hold integrado en el tick de Session.
3. Hooks en `session-runtime.ts` (`launchClip`, `stopLane`, `launchScene`) que llaman al recorder cuando `recording`.
4. `ArrangementPlayState` + `tickArrangement` como nueva rama del lookahead loop.
5. Cableado de override por lane (sin botón UI todavía).
6. Toggle `Session | Performance` en transport + botón REC.
7. UI del Performance view: ruler, lanes, bandas de clips, bandas de automation, playhead.
8. Serialización: añadir `arrangement` y `mode` al save existente, sin migración.
9. E2E smoke + DSP smoke.

---

## 11. Open questions (ninguna bloqueante)

- "Follow BPM" durante playback (re-escalar el Arrangement si cambias el BPM del transport): fuera de MVP, posible toggle en fase posterior.
- Persistencia del estado plegado/desplegado de las sub-bandas de automation: fuera de MVP.
- Render visual de la curve en Performance vs en `clip-automation-lanes.ts`: en MVP, canvas propio sin reusar el painter de clips (que asume `lengthBars`). Posible unificación posterior.
