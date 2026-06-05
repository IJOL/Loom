# Editable arrangement timeline — diseño

Fecha: 2026-06-05 · Estado: aprobado (brainstorming), pendiente de plan.

## Contexto y motivación

La vista Performance ya reproduce un arrangement (loop A–B + play, con el playhead
alineado) pero es **solo lectura**: las bandas de clips se generan con *Copiar a
Performance* o grabando una toma, y no se pueden tocar. El usuario quiere **edición
directa** de la timeline estilo Arrangement de Ableton: **mover, redimensionar y borrar**
las bandas arrastrándolas.

Cada banda es un `ArrangementClipEvent { clipId, laneId, atSec, untilSec }` dentro de
`lane.clipEvents` ([performance.ts](../../src/performance/performance.ts)); la dibuja
`makeClipBand` ([performance-ui.ts](../../src/performance/performance-ui.ts)) en
`left = atSec/barSec·pxPerBar`, `width = (untilSec−atSec)/barSec·pxPerBar`. El runtime
`tickArrangement` lanza el clip en `atSec`, lo para en `untilSec`, y el clip loopea su
contenido dentro de la banda. **Editar = mutar `atSec`/`untilSec` o quitar el evento**; el
motor no cambia.

## Alcance

### Dentro
- **Mover** una banda (arrastre horizontal del cuerpo) dentro de su lane.
- **Redimensionar** una banda (asas en los bordes izquierdo/derecho).
- **Borrar** una banda (botón × al pasar el ratón).
- **Snap a beats** (negras) en todas las ediciones.
- **Ripple**: mover/estirar empuja en cascada a las bandas siguientes del lane para que
  el lane quede ordenado y sin solapes.
- **Undo/redo (Ctrl+Z / Ctrl+Shift+Z)** de las ediciones, vía un history dedicado al
  arrangement.

### Fuera (decisiones tomadas en brainstorming)
- **Crear** bandas nuevas (arrastrar un clip de sesión a la timeline, duplicar): fuera.
  Solo se ajusta lo que ya hay.
- **Mover entre lanes** (arrastre vertical): fuera — un `clipEvent` referencia un clip de
  *su* lane; moverlo a otro lane no tiene sentido. Solo movimiento horizontal.
- **Multi-selección**: fuera (una banda a la vez).
- **Ripple al borrar**: fuera — borrar **deja el hueco** (las demás bandas no se mueven).
  El ripple actúa solo al mover/redimensionar.

## Arquitectura

Tres unidades, una responsabilidad cada una:

1. **`src/performance/arrangement-edit.ts`** *(nuevo, puro)* — la matemática de edición
   sobre un array de `clipEvents`. Sin DOM, testeable como `piano-roll-editing.ts`.
2. **`src/performance/performance-ui.ts`** *(modificar `makeClipBand`)* — la interacción
   (drag del cuerpo, asas de resize, botón ×), actualizando la banda imperativamente
   durante el gesto y aplicando el modelo al soltar.
3. **`src/app/performance-feature.ts`** *(modificar)* — un `HistoryController<ArrangementState>`
   dedicado, el enrutado de Ctrl+Z por modo, y el pegamento que aplica las ediciones a
   `arrangement` + refresca la vista.

El runtime (`arrangement-runtime.ts`) y el modelo (`performance.ts`) **no cambian**.

## Lógica pura — `arrangement-edit.ts`

Todas las funciones reciben y devuelven `ArrangementClipEvent[]` (inmutable; nunca mutan
el array de entrada) y trabajan en segundos, con `bpm` para el snap.

```ts
/** Segundos → negra más cercana. */
export function snapSecToBeat(sec: number, bpm: number): number;

/** Mueve el evento `index` a `newAtSec` (snap), manteniendo su duración. Reordena el
 *  lane y empuja en cascada (ripple) a las bandas que quedarían solapadas, de modo que
 *  el resultado quede ordenado por atSec y sin solapes. Devuelve el array nuevo. */
export function moveEvent(events: ArrangementClipEvent[], index: number, newAtSec: number, bpm: number): ArrangementClipEvent[];

/** Redimensiona el borde 'start' (cambia atSec) o 'end' (cambia untilSec) del evento
 *  `index` a `newSec` (snap), con duración mínima de 1 beat. Si el borde 'end' empuja a
 *  la banda siguiente, aplica ripple. Devuelve el array nuevo. */
export function resizeEvent(events: ArrangementClipEvent[], index: number, edge: 'start' | 'end', newSec: number, bpm: number): ArrangementClipEvent[];

/** Quita el evento `index`. Deja el hueco (sin ripple). Devuelve el array nuevo. */
export function deleteEvent(events: ArrangementClipEvent[], index: number): ArrangementClipEvent[];
```

**Ripple (precisión):** tras colocar/estirar la banda editada, se recorre el lane ordenado
por `atSec`; cualquier banda cuyo `atSec` caiga antes del `untilSec` de la anterior se
desplaza hacia adelante (`atSec = prev.untilSec`, manteniendo su duración), en cascada.
`atSec` nunca baja de 0. La banda editada conserva la posición que pidió el usuario; las
demás ceden.

## UI — `makeClipBand`

Cada `.perf-clip` recibe interacción (siguiendo el patrón del brace de loop: mover
`style` durante el gesto, aplicar el modelo + re-render solo en `pointerup`, para no
detachar el nodo a media):

- **Mover** — `pointerdown` en el cuerpo → `pointermove` desplaza `style.left` en vivo →
  `pointerup` aplica `moveEvent(lane.clipEvents, i, newAtSec, bpm)`, reemplaza
  `lane.clipEvents`, snapshot+commit al history, refresca.
- **Redimensionar** — dos `<span class="perf-clip-handle l|r">` (visibles al hover);
  `pointerdown` en una hace `stopPropagation` (no mueve el cuerpo) → arrastre cambia
  `style.left/width` en vivo → `pointerup` aplica `resizeEvent(...)`.
- **Borrar** — un `<button class="perf-clip-del">×</button>` (visible al hover) → clic
  aplica `deleteEvent(...)`.

`makeClipBand` recibe nuevos callbacks (`onMoveBand`, `onResizeBand`, `onDeleteBand`) que
`renderPerformanceView` cablea desde `PerfUICallbacks`. La conversión px↔segundos usa el
mismo `barSec`/`pxPerBar` que ya emplea para dibujar.

## Undo — history dedicado al arrangement

El history de sesión excluye el arrangement a propósito ([main.ts](../../src/main.ts):
"snapshots session state only … so a recorded take is never wiped by undoing an unrelated
session edit"). Para no romper esa separación, el arrangement tiene su **propio**
`HistoryController<ArrangementState>` (reusa `createHistory` genérico):

- Cada edición de banda: `beginGesture(snapshot)` al empezar el arrastre / `commit(snapshot)`
  antes de borrar, y `commitGesture()` al soltar. El snapshot es una copia profunda del
  `ArrangementState`.
- **Enrutado de teclado por modo**: un listener (en `performance-feature`) intercepta
  Ctrl+Z / Ctrl+Shift+Z **solo cuando `getMode() === 'performance'`**, opera sobre el
  history del arrangement (`undo/redo` → `setArrangement` + refresh) y hace
  `preventDefault` para que el undo de sesión no actúe. En modo Session, no intercepta y
  el undo de sesión funciona igual que hoy.
- De regalo, `onPerformanceEdited` (hoy no-op: longitud/brace/curvas) se cablea al mismo
  history → esas ediciones también se vuelven deshacibles.
- El undo es **runtime** (no se persiste). Al guardar/cargar se persiste el estado final
  del `arrangement` (como ya ocurre en v3).

## Testing
- **Pure** (`arrangement-edit.test.ts`): `snapSecToBeat`; `moveEvent` (mantiene duración,
  snap, ripple en cascada, clamp a 0); `resizeEvent` (cada borde, mínimo 1 beat, ripple
  del borde derecho); `deleteEvent` (deja hueco). Aserciones sobre los `clipEvents`
  resultantes (relativas).
- **Undo**: test del enrutado por modo (mock de `getMode`); el `createHistory` ya está
  testeado.
- **e2e** (`tests/e2e/arrangement-edit.spec.ts`): arrastrar una banda cambia su `left`;
  redimensionar cambia su `width`; × la borra (desaparece del DOM); Ctrl+Z restaura.
  Medidas con `boundingBox`/conteo, como los e2e del playhead.

## Riesgos y decisiones
- **Conflicto de gestos**: cuerpo=mover, asas=resize (`stopPropagation`), ×=borrar. Sin
  estado de selección.
- **Drag en vivo sin re-render**: mover `style` durante el gesto; aplicar modelo + refresh
  solo en `pointerup` (si re-renderizáramos a media, `host.innerHTML=''` detacharía el
  nodo arrastrado — lección del brace de loop).
- **Undo por modo**: cuidar de no romper el undo de Sesión; el listener del arrangement
  solo actúa en modo Performance.
- **Ripple en cascada**: bien acotado en la función pura; cubierto por tests.

## Fuera de alcance / extensiones futuras
- Crear/duplicar bandas; mover entre lanes; multi-selección; ripple al borrar; marcadores.
