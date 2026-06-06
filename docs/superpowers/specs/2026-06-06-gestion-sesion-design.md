# Frente A · Gestión de sesión — Spec de diseño

**Fecha:** 2026-06-06 (revisado tras la revisión adversarial + coordinación transversal)
**Estado:** spec de diseño (no implementación). Deriva del índice maestro [2026-06-06-loom-ux-overhaul-overview.md](2026-06-06-loom-ux-overhaul-overview.md), sección "Frente A · Gestión de sesión".
**Coordinación:** se ajusta a [2026-06-06-coordinacion-frentes.md](2026-06-06-coordinacion-frentes.md) (decisiones cerradas: `placeClipEnsuringScene` único, `installClip` eliminado, `deleteScene` compacta, `installSamplerClip` como seam de D, siembra mínima de scene).
**Orden global:** **Frente A va PRIMERO** (es el cimiento del que dependen D y la estabilidad del grid). D consume `installSamplerClip`; A no espera a D.

> **Nota de revisión.** La versión anterior de este spec partía de dos premisas FALSAS verificadas contra el código: (1) que la causa del "▶ ausente" era que `installClip` no llamaba a `ensureScenesForRows` — pero `installClip` es **código muerto** (sin invocador); el camino real es `onCellClick`. (2) que `deleteScene` podía no compactar como mera preferencia visual — pero el lanzamiento de scene es **posicional** (`session-runtime.ts:103`), así que no compactar **corrompe** el mapeo scene→clip. Ambas se corrigen abajo.

---

## Objetivo

Hacer que la gestión del grid de sesión (lanes × scenes × clips) sea **directa, consistente y sin estado fantasma**:

1. **Borrado con aspa ✕** a la izquierda de cada **clip**, **scene** y **lane**, con un patrón único y predecible. Reemplaza al borrado por teclado (Delete/Backspace) del inspector como camino primario, que es engorroso porque pinchar el clip abre el editor.
2. **Confirmación solo cuando hay contenido** (lane con clips, scene con algo lanzable). Vacías → se borran directas, sin diálogo.
3. **Borrar una lane libera sus recursos de audio** (`LaneResourceMap.dispose`), sin orphans, **parándola antes** (cortar voces/loops en vuelo).
4. **Nunca rellenar con clips vacíos al crear**: una lane de instrumento nace con **0 clips** (`clips: []`), un canal de audio / sampler lleva su clip **solo en la fila 0**, el resto vacío implícito (`?? null`).
5. **Arreglar el bug del ▶ ausente** en su causa REAL: `onCellClick` coloca un clip sin garantizar la scene de esa fila. Se unifica con un helper único `placeClipEnsuringScene`.
6. **Menús contextuales** (botón derecho) reutilizables sobre lane / scene / clip / celda vacía, mediante un nuevo módulo `context-menu.ts`. Coexisten con el aspa.
7. **`deleteScene` compacta**: borrar la scene N elimina la fila N en TODAS las lanes y desplaza las posteriores (mantiene la correspondencia posicional scene→clip que usa el lanzamiento). Decisión cerrada (no es duda de UX).

---

## Alcance

### Qué entra

- Aspa ✕ de borrado en: cabecera de lane (`session-lane-header`), celda de scene-launch (`session-scene-cell` con scene) y clip lleno (`session-cell-filled`).
- Lógica pura de borrado en el modelo (`session.ts`): `deleteClipAt`, `deleteLane`, `deleteScene` **compactante** (+ reindexado de `clipPerLane`).
- Predicados puros para decidir confirmación: `laneHasContent`, `sceneHasContent` (este último contemplando los mapeos `clipPerLane` explícitos).
- Helper de instancia único en `SessionHost`: `placeClipEnsuringScene(laneId, clipIdx, clip)` — punto ÚNICO de colocación de clip que garantiza la scene.
- Método público nuevo `installSamplerClip(laneId, clip)` (seam del Frente D) que coloca el clip de loop vía `placeClipEnsuringScene`, lo envuelve en `withUndo` y abre el inspector. **Reemplaza al difunto `installClip`.**
- **Eliminación de `installClip`**: su implementación (`session-host.ts:999-1006`) y su declaración (`engine-types.ts:76`), por ser un hook huérfano sin invocador.
- Wiring de `onDeleteClip` / `onDeleteLane` / `onDeleteScene` en `SessionHost`, envueltos en `withUndo`, con `stopLane` + `dispose` de recursos al borrar lane.
- Diálogo de confirmación mínimo (`window.confirm` en v1 — ver Dudas reales), solo cuando hay contenido.
- Cambio de la siembra de clips al crear lanes/canales (quitar el relleno con `emptyClip`): `onAddLane`, `addAudioChannel`, `onSliceToBank`, `addNoteLane`, `onAddStemLanes` (runAdd/runReplace) y `buildStemLane`.
- **Siembra mínima de scene**: garantizar ≥1 scene cuando hay ≥1 lane, para que quitar el relleno no deje la sesión sin ningún ▶ de scene-launch.
- Fix del bug ▶: migrar `onCellClick` (y `onCellDropAudio`) al helper único; añadir `ensureScenesForRows` al `addNoteLane` (hoy es el único camino de creación que NO lo llama).
- Módulo nuevo `src/core/context-menu.ts`: helper genérico de menú contextual.
- Menús contextuales en lane / scene / clip lleno / celda vacía, reutilizando los callbacks ya existentes.
- `data-lane-id` en el `.session-lane-header` (hoy NO lo lleva): selector estable para identificar la columna de una lane (lo necesita el aspa de lane y el e2e).
- Tests: unitarios de la lógica pura (modelo + predicados + helper) y e2e Playwright del aspa + menú + ausencia de relleno + presencia del ▶ + `deleteScene` compactante.

### Qué NO entra

- Renombrar lanes/scenes inline (el menú contextual puede ofrecer "Renombrar…" con un prompt, pero el editor inline no es objetivo).
- Reordenar lanes o scenes (drag de cabeceras).
- Cualquier cambio en la cabecera/transporte (Frente B), el mixer del master (Frente C), el Sampler/audio (Frente D) o los editores de clip (Frente E). Tocamos `session-host.ts` y `session-ui.ts`, pero solo en lo relativo al grid y a la creación de lanes. **Coordinación con D:** A introduce `placeClipEnsuringScene` + `installSamplerClip` y elimina `installClip`; D consume `installSamplerClip` (no redefine la colocación).
- Borrado múltiple/selección de varias scenes o lanes a la vez.
- Persistencia de una "papelera/undo visual" más allá del `withUndo` global ya existente.

---

## Diseño

### Arquitectura actual (lo que tocamos)

El grid de sesión se construye en `renderSessionGrid` ([session-ui.ts:47](../../../src/session/session-ui.ts)), **DOM puro sin audio**: recibe `state`, `laneStates` y `cb: SessionUICallbacks`. El propietario de estado y callbacks es `SessionHost` ([session-host.ts](../../../src/session/session-host.ts)), que posee `laneStates` y delega audio en `LaneResourceMap` vía `deps.laneResources` / `deps.ensureLaneResource` / `deps.swapLaneEngine`.

El modelo es puro en [session.ts](../../../src/session/session.ts): `SessionLane.clips: (SessionClip | null)[]`, `SessionScene.clipPerLane`, helpers `emptyClip`/`emptyLane`/`emptyScene`. **Verificado:** `emptyLane(id, engineId)` ya devuelve `{ id, engineId, clips: [] }` (session.ts:186-188), y `emptyScene(name)` devuelve `{ id, name, clipPerLane: {} }` (session.ts:190-192). El borrado de **clip** ya existe vía teclado en el inspector (`deleteSelectedClip`, [session-inspector.ts:77-91](../../../src/session/session-inspector.ts)): pone `lane.clips[idx] = null` dentro de `withUndo`; y vía el botón `#insp-delete` (session-inspector.ts:159), que delega en el mismo `deleteSelectedClip`.

`ensureScenesForRows` ([scene-ensure.ts:9-22](../../../src/core/scene-ensure.ts)) añade scenes hasta que `state.scenes.length >= max(lane.clips.length)` — es lo que garantiza que cada fila con clip tenga su botón ▶ (el grid solo pinta el botón si existe `state.scenes[r]`, ver [session-ui.ts:79](../../../src/session/session-ui.ts) y [session-ui.ts:222](../../../src/session/session-ui.ts)).

La liberación de recursos: `LaneResourceMap.dispose(laneId)` ([lane-resources.ts:42-49](../../../src/core/lane-resources.ts)) dispone strip + engine + inserts y borra la entrada. Hoy solo se invoca al detectar orphans en `applyLoadedSessionState` ([session-host.ts:322-324](../../../src/session/session-host.ts)).

**El lanzamiento de scene es POSICIONAL** (clave para `deleteScene`): `launchScene` ([session-runtime.ts:101-103](../../../src/session/session-runtime.ts)) resuelve por lane `idx = hasExplicit ? scene.clipPerLane[lane.id] : sceneIdx`. `clipPerLane` está casi siempre vacío (`emptyScene → clipPerLane:{}`), así que el lanzamiento cae al índice de fila. Esto obliga a que `deleteScene` compacte (ver abajo).

### El bug "▶ ausente" — causa REAL y fix único (corrige la premisa falsa anterior)

`installClip` ([session-host.ts:999-1006](../../../src/session/session-host.ts)) está **declarado** (`engine-types.ts:76`) e **implementado**, pero **ningún módulo lo invoca** (verificado: `grep installClip src/` → solo la declaración y la implementación, cero llamadas; su antiguo invocador desapareció con el refactor "audio-channel direction" que borró `clip-editor-loop.ts`). Por tanto, parchear `installClip` con `ensureScenesForRows` **no puede arreglar ningún síntoma**: es código muerto. **Se elimina.**

El **camino real** que coloca un clip sin garantizar su scene es `onCellClick` ([session-host.ts:658-672](../../../src/session/session-host.ts)):

```
onCellClick(laneId, clipIdx) {
  ...
  while (lane.clips.length <= clipIdx) lane.clips.push(null);
  lane.clips[clipIdx] = clip;          // ← coloca el clip
  // NO llama a ensureScenesForRows    // ← AQUÍ está el bug
  ...
}
```

El grid solo pinta el ▶ de scene-launch para filas con `state.scenes[r]`. Una lane con más clips que scenes deja el clip presente pero la fila sin ▶.

Comparativa verificada de los caminos de colocación de clip:

| Camino | Ubicación | ¿Llama hoy a `ensureScenesForRows`? |
|---|---|---|
| `onCellClick` | session-host.ts:658-672 | **NO** ← bug real |
| `onCellDropAudio` | session-host.ts:674-705 (l.695) | SÍ |
| `onSliceToBank` | session-host.ts:197-258 (l.251) | SÍ |
| `onAddLane` (relleno) | session-host.ts:736-762 (l.758) | SÍ |
| `addAudioChannel` | session-host.ts:562-594 (l.590) | SÍ |
| `addNoteLane` | session-host.ts:523-550 | **NO** (latente: hoy se llama tras stems con scenes ya creadas) |
| `installClip` | session-host.ts:999-1006 | **NO** — pero es código MUERTO → se elimina |

**Fix fijado — helper único `placeClipEnsuringScene`** (privado en `SessionHost`):

```ts
/** Coloca `clip` en (laneId, clipIdx), rellenando huecos con null, y garantiza
 *  que exista una scene para cada fila con clip. Único punto de colocación. */
private placeClipEnsuringScene(laneId: string, clipIdx: number, clip: SessionClip): void {
  const lane = this.state.lanes.find((l) => l.id === laneId);
  if (!lane) return;
  while (lane.clips.length <= clipIdx) lane.clips.push(null);
  lane.clips[clipIdx] = clip;
  ensureScenesForRows(this.state);
}
```

Caminos que pasan por él: `onCellClick` (OBLIGATORIO, es el bug), `onCellDropAudio` (unifica su `while push null` + `ensureScenesForRows` manual), e `installSamplerClip` (seam de D). `addNoteLane` crea una lane completa: basta con añadirle `ensureScenesForRows(this.state)` tras el `push` de la lane (corrige que hoy es el único camino de creación que no lo llama).

### Seam para el Frente D — `installSamplerClip` (reemplaza al difunto `installClip`)

`SessionHost` expone un método público que D invoca para colocar su clip de loop (notas + `waveformRef`) sobre la lane Sampler actual:

```ts
/** Punto de entrada del frente D: coloca el clip de loop recién construido sobre
 *  la lane Sampler indicada, garantiza su scene, lo envuelve en undo y abre el
 *  piano-roll. Reemplaza al difunto installClip (que solo colocaba el clip). */
installSamplerClip(laneId: string, clip: SessionClip): void {
  const lane = this.state.lanes.find((l) => l.id === laneId);
  if (!lane) return;
  const hd = this.deps.historyDeps;
  const run = () => {
    const empty = lane.clips.findIndex((c) => c == null);
    const idx = empty >= 0 ? empty : lane.clips.length;
    this.placeClipEnsuringScene(laneId, idx, clip);   // ← misma vía que onCellClick
    this.inspector.setSelectedClip({ laneId, clipIdx: idx });
    this.inspector.openInspector();                    // ← abre el piano-roll
    this.renderWithMixer();
  };
  if (hd) withUndo(hd, run); else run();               // ← undo, que installClip NO hacía
}
```

Las tres carencias del difunto `installClip` que esto cubre: **(a)** garantiza scene, **(b)** envuelve en `withUndo`, **(c)** abre el inspector. La construcción del `SessionClip` (notas + `waveformRef`) es de D; la COLOCACIÓN es de este seam único de A.

### Componentes nuevos / modificados

#### 1. Modelo puro de borrado (`session.ts`)

Helpers puros, en la línea de `moveClip`/`copyClip` (mutación in-place, como `ensureScenesForRows`/`reconcileLaneEnvelopes`; `SessionHost` decide cuándo snapshot vía `withUndo`):

- `deleteClipAt(lane: SessionLane, clipIdx: number): void` — `lane.clips[clipIdx] = null` (NO `splice`: preserva el índice de fila para que el resto de la columna no se desplace). Idempotente sobre `null`.
- `deleteLane(state: SessionState, laneId: string): void` — `splice` de la lane en `state.lanes`; `delete scene.clipPerLane[laneId]` en cada scene (la entrada colgada). **No** toca recursos de audio (eso lo hace el host).
- `deleteScene(state: SessionState, sceneIdx: number): void` — **COMPACTANTE**:
  1. `state.scenes.splice(sceneIdx, 1)`.
  2. Para cada lane: `if (sceneIdx < lane.clips.length) lane.clips.splice(sceneIdx, 1)`.
  3. Reindexar `clipPerLane` explícitos: por cada scene superviviente, para cada `[laneId, row]`: si `row === sceneIdx` → `delete` (la fila se fue); si `row > sceneIdx` → `row - 1` (se desplazó).

  Razón verificada: el lanzamiento es posicional (`session-runtime.ts:103`). Si solo se hiciera `scenes.splice` sin compactar columnas, cada scene con índice > N quedaría emparejada con los clips de OTRA fila y lanzaría clips equivocados. El paso 3 es necesario porque hay mapeos explícitos reales (`addNoteLane` pone `clipPerLane[id]=0` en session-host.ts:546; stems `runReplace` en :804; MIDI import) que se desfasarían tras el splice.

Predicados puros (para decidir confirmación):

- `laneHasContent(lane: SessionLane): boolean` — `lane.clips.some(c => c != null)`.
- `sceneHasContent(state: SessionState, sceneIdx: number): boolean` — `true` si alguna lane tiene clip en `lane.clips[sceneIdx]` **O** si algún `scene.clipPerLane` apunta explícitamente a la fila `sceneIdx` con un clip presente. (Verificado: ignorar `clipPerLane` haría que una scene cuyo único contenido lanzable viene de un mapeo explícito se borrase sin diálogo. El criterio operativo es "¿borrar la fila pierde algo lanzable?".)

#### 2. Siembra de lanes "vacías de verdad" + scene mínima

Hoy todos los caminos de creación rellenan con `for (r..rows) clips.push(r===0 ? clip : emptyClip(...))`. El cambio:

- **Lane de instrumento** (`onAddLane`, session-host.ts:736; bucle en :749-751): nace con `clips: []` (0 clips). `emptyLane` ya devuelve `clips: []`, así que basta con NO rellenar. Mantener `ensureScenesForRows` (ya en :758).
- **`addNoteLane`** (session-host.ts:523; bucle en :541): `lane.clips = [clip]` (clip de notas en fila 0). Quitar el `for`. **Añadir `ensureScenesForRows(this.state)`** tras el `push` de la lane (hoy NO lo llama — corrige la latencia del bug).
- **`addAudioChannel`** (session-host.ts:562; bucle en :586): `lane.clips = [clip]`. Quitar el `for`. Mantener `ensureScenesForRows` (ya en :590).
- **`onSliceToBank`** (session-host.ts:197; bucle en :244): `newLane.clips = [noteClip]`. Quitar el `for`. Mantener `ensureScenesForRows` (ya en :251).
- **Stems** (`onAddStemLanes` → `buildStemLane`, session-host.ts:780; bucle en :797): cada lane de stem → `lane.clips = [clip]`. Quitar el `for`. `runReplace` arma la scene aparte; `runAdd` mantiene `ensureScenesForRows` (ya en :832).
- **`onCellClick` / `onCellDropAudio`** — colocan en una celda concreta vía `placeClipEnsuringScene` (no rellenan la columna). `onCellClick` NO es un camino de "relleno": NO aparece en la lista de quitar-relleno (eso fue un error de la versión anterior).

**Scene mínima (corrige A5):** quitar el relleno **sí** puede dejar la sesión sin scenes. Verificado: `ensureScenesForRows` calcula `maxClipRows = max(lane.clips.length)`; si TODAS las lanes nacen con `clips:[]` (caso "New" → `emptySessionState` con `scenes:[]` y 3 lanes con `clips:[]`, y el usuario añade solo instrumentos vacíos), `maxClipRows = 0` → 0 scenes → el grid no pinta ningún ▶ de scene-launch y el usuario no puede lanzar escenas. **Decisión:** garantizar un mínimo de 1 scene cuando hay ≥1 lane. Implementación: ampliar `ensureScenesForRows` para que, con `state.lanes.length >= 1`, suba `maxClipRows` a `Math.max(maxClipRows, 1)`. Así una sesión con lanes (aunque vacías) siempre tiene al menos la fila/scene 1 lanzable. Esto no cambia el comportamiento de sesiones con clips (ya tenían ≥1 fila).

#### 3. Aspa ✕ de borrado (UI en `session-ui.ts`)

Helper interno `deleteCross(title, onDelete): HTMLElement` — crea `<button class="session-del-cross" title=...>✕</button>` que en `click` hace `e.stopPropagation()` + `onDelete()`. Posición "a la izquierda" (orden DOM primero; CSS lo coloca). Se inserta:

- **Lane:** en `laneHeader` (session-ui.ts:135), como primer hijo de `.session-lane-header`, antes del nombre. `title="Borrar pista"` → `cb.onDeleteLane(lane.id)`. **Además:** añadir `el.dataset.laneId = lane.id` al header (hoy NO lo lleva — verificado session-ui.ts:135-151), para tener selector estable de columna.
- **Scene:** en `sceneLaunchCell` (session-ui.ts:219), dentro de la rama `if (scene)`, antes del botón `▶`. `title="Borrar escena"` → `cb.onDeleteScene(idx)`. Las celdas de scene vacías no llevan aspa.
- **Clip:** en `clipCell` (session-ui.ts:170), solo en la rama `if (clip)`, como primer hijo antes del label. `title="Borrar clip"` → `cb.onDeleteClip(lane.id, rowIdx)`. **Crítico:** igual que el `playIcon` (session-ui.ts:183-184), el aspa debe `stopPropagation` en `pointerdown`/`pointerup`/`click` para no disparar `wireClipDrag`/`onCellClick`.

CSS: `.session-del-cross` en `src/styles/_session-grid.scss` (parcial real; el índice es `src/style.scss` con `@use 'styles/session-grid'`). Pequeña, esquina superior izquierda, atenuada por defecto, hover "danger". El clip lleno y el header deben ser `position: relative` para anclar el aspa absoluta; coexiste con `▶` (derecha) y `⚙` (`.session-lane-edit`).

Extender `SessionUICallbacks` (session-ui.ts:8) con:

```
onDeleteClip:  (laneId: string, clipIdx: number) => void;
onDeleteLane:  (laneId: string) => void;
onDeleteScene: (sceneIdx: number) => void;
```

#### 4. Confirmación condicional + wiring en `SessionHost`

En `buildCallbacks` añadir los tres handlers:

- `onDeleteClip(laneId, clipIdx)`:
  - Clip vacío/`null` → no-op. Un clip individual **siempre se borra directo** (sin confirmación; es la unidad mínima y el inspector ya lo borra directo con Delete). Coherente con el índice maestro (la confirmación es por lane/scene).
  - `withUndo(hd, () => { deleteClipAt(lane, clipIdx); ... })`. Si el clip borrado era el `selectedClip` del inspector (`inspector.getSelectedClip()`), cerrar el panel (reusar la lógica de `deleteSelectedClip`). `renderWithMixer()`.
- `onDeleteLane(laneId)`:
  - Si `laneHasContent(lane)` → `confirm("¿Borrar la pista «X» y todos sus clips?")`. Vacía → directo.
  - **Parar la lane ANTES de disponerla** (simetría con `onDeleteScene`, corrige A6): `stopLane(self.laneStates, laneId, recHooks?)` para cortar voces/loops en vuelo.
  - `withUndo(hd, () => { deleteLane(state, laneId); laneStates.delete(laneId); laneResources?.dispose(laneId); if (activeEditLane === laneId) <toggle-off, mismo gesto que onEditLane session-host.ts:858-865>; refreshSynthTabs(); renderWithMixer(); })`.
  - **Undo de borrado de lane:** el `restore` del historial pasa por `applyLoadedSessionState`, que YA re-asigna recursos a las lanes sin recurso (`ensureLaneResource`/`swapLaneEngine`, session-host.ts:325-341) y dispone orphans (:321-324). Verificado: el camino de restauración re-alloca; no hace falta forzar nada extra en el `run`. (Antes esto se marcaba como "el punto más delicado"; lo es de verificar, no de implementar — el mecanismo ya existe.)
- `onDeleteScene(sceneIdx)`:
  - Si `sceneHasContent(state, sceneIdx)` → `confirm("¿Borrar la escena «X»?")`. Vacía → directo.
  - **Parar lo que sonara/encolado de esa fila** antes de compactar (recorrer `laneStates`, `stopLane` de las afectadas cuyo `playing`/`queued` sea el clip de `lane.clips[sceneIdx]`).
  - `withUndo(hd, () => { deleteScene(state, sceneIdx); renderWithMixer(); })`.

`withUndo` (snapshot+mutación) ya existe (history-wiring.ts); todo borrado es undoable.

El borrado por teclado del inspector (`wireKeyboardShortcuts`/`deleteSelectedClip`, session-inspector.ts:67-91) y el botón `#insp-delete` (:159) **se mantienen** (no estorban; el aspa es el camino primario). Son un tercer/segundo camino de borrado de clip que comparte la semántica "poner null + cerrar panel"; se documenta que coexisten (ver Tarea de refactor en el plan).

#### 5. Módulo reutilizable `context-menu.ts`

Nuevo `src/core/context-menu.ts`. API mínima y agnóstica:

```ts
export interface ContextMenuItem {
  label: string;
  onSelect: () => void;
  disabled?: boolean;
  danger?: boolean;      // estilo "borrar"
  separatorBefore?: boolean;
}
export function openContextMenu(e: MouseEvent, items: ContextMenuItem[]): void;
```

Comportamiento: `e.preventDefault()` (suprime el menú nativo, como ya hacen drum-grid [clip-editor-drum-grid.ts:297](../../../src/session/clip-editors/clip-editor-drum-grid.ts) y piano-roll [pianoroll.ts:545](../../../src/core/pianoroll.ts) — su migración a este módulo queda **fuera de alcance**). Construye `<ul class="context-menu">` posicionado en `e.clientX/clientY` (corrección si se sale del viewport). Cierra al click-fuera / Escape / seleccionar ítem. Solo un menú abierto a la vez (singleton). DOM puro, sin dependencias. CSS en parcial nuevo `src/styles/_context-menu.scss`, importado en `src/style.scss` con `@use 'styles/context-menu'`.

Wiring en `session-ui.ts` — `addEventListener('contextmenu', ...)` en cada elemento, con ítems que reutilizan callbacks:

- **Cabecera de lane** (`.session-lane-header`): "Editar instrumento" (`cb.onEditLane`), "Parar pista" (`cb.onStopLane`), separador, "Borrar pista" (danger → `cb.onDeleteLane`).
- **Scene** (`.session-scene-cell` con scene): "Lanzar escena" (`cb.onLaunchScene`), "Añadir escena" (`cb.onAddScene`), separador, "Borrar escena" (danger → `cb.onDeleteScene`).
- **Clip lleno** (`.session-cell-filled`): "Abrir editor" (`cb.onClipClick`), "Reproducir / Parar" (`cb.onClipPlayPause`), [opcional "Duplicar" — ver Dudas reales], separador, "Borrar clip" (danger → `cb.onDeleteClip`).
- **Celda vacía** (`.session-cell-empty`): "Crear clip" (`cb.onCellClick`). **Verificado:** `onCellClick` solo hace early-return para `engineId === 'audio'` (session-host.ts:661); en una lane **sampler** SÍ crea un `emptyClip` normal. Por tanto el ítem "Crear clip" se deshabilita SOLO para lanes `audio` (no para `sampler` — eso regresionaría crear clips de notas en sampler/drumkit). En `audio` se puede ofrecer "Importar audio…" o dejar el ítem `disabled`.

El menú **coexiste** con el aspa (uno es `click` en el botón aspa, otro `contextmenu` en el contenedor; sin conflicto).

### Flujo de datos (resumen)

```
contextmenu / click-en-aspa
        │
        ▼
SessionUICallbacks.onDelete{Clip,Lane,Scene}   (session-ui.ts dispara)
        │
        ▼
SessionHost.buildCallbacks handler             (confirmación según *HasContent)
        │  (onDeleteLane/Scene: stopLane antes)
        │  withUndo(hd, …)
        ▼
modelo puro: deleteClipAt / deleteLane / deleteScene(compactante)   (muta state)
        │  (solo deleteLane:)
        ▼
laneStates.delete(id) + laneResources.dispose(id)      (efecto de audio)
        │
        ▼
refreshSynthTabs()? + renderWithMixer()
```

Colocación de clip (camino único):

```
onCellClick / onCellDropAudio / installSamplerClip
        │
        ▼
placeClipEnsuringScene(laneId, idx, clip)  →  lane.clips[idx]=clip + ensureScenesForRows(state)
```

### UI

- **Aspa ✕**: pequeña, color tenue, hover rojo; arriba-izquierda del header de lane / celda de scene / clip lleno. No en celdas vacías ni en filas de scene sin scene.
- **Menú contextual**: lista vertical, "Borrar…" siempre al final con estilo `danger`, separador antes.
- **Confirmación**: `window.confirm` en v1 (ver Dudas reales). Solo cuando hay contenido.

---

## Archivos a tocar

| Archivo | Cambio |
|---|---|
| [src/session/session.ts](../../../src/session/session.ts) | **Añadir** `deleteClipAt(lane, idx)`, `deleteLane(state, laneId)`, `deleteScene(state, idx)` **compactante** (+ reindex `clipPerLane`), `laneHasContent(lane)`, `sceneHasContent(state, idx)` (con rama `clipPerLane`). Junto a `moveClip`/`copyClip`. |
| [src/core/scene-ensure.ts](../../../src/core/scene-ensure.ts) | **Modificar** `ensureScenesForRows`: garantizar `maxClipRows >= 1` cuando hay ≥1 lane (siembra mínima de scene). |
| [src/session/session-ui.ts](../../../src/session/session-ui.ts) | **Añadir** a `SessionUICallbacks` (:8) `onDeleteClip`/`onDeleteLane`/`onDeleteScene`. **Añadir** `deleteCross(...)`. Insertar aspa en `laneHeader` (:135), `sceneLaunchCell` (:219) y rama `if (clip)` de `clipCell` (:170) con `stopPropagation`. **Añadir** `dataset.laneId` al `.session-lane-header`. **Añadir** listeners `contextmenu` en lane-header, scene-cell, clip lleno y celda vacía → `openContextMenu`. |
| [src/session/session-host.ts](../../../src/session/session-host.ts) | **Añadir** helper privado `placeClipEnsuringScene` + método público `installSamplerClip`. **Eliminar** `installClip` (:999-1006). **`buildCallbacks`**: `onDeleteClip`/`onDeleteLane`/`onDeleteScene` (confirmación condicional + `stopLane` antes de dispose/compactar + `withUndo`). **Migrar** `onCellClick` (:658) y `onCellDropAudio` (:674) a `placeClipEnsuringScene`. **Quitar relleno** `emptyClip` en `onAddLane` (:749-751), `addNoteLane` (:541, **+ añadir `ensureScenesForRows`**), `addAudioChannel` (:586), `onSliceToBank` (:244), `onAddStemLanes`/`buildStemLane` (:797). |
| [src/engines/engine-types.ts](../../../src/engines/engine-types.ts) | **Eliminar** la declaración `installClip?` (:76) + comentario. |
| [src/session/session-inspector.ts](../../../src/session/session-inspector.ts) | Mantener `deleteSelectedClip` (:77) y el atajo Delete/Backspace + `#insp-delete`. Documentar coexistencia con el aspa (refactor de deduplicación opcional, ver plan). |
| **NUEVO** `src/core/context-menu.ts` | `ContextMenuItem`, `openContextMenu(e, items)`. DOM puro. |
| **NUEVO** `src/styles/_context-menu.scss` | Estilos del menú. Importar en `src/style.scss` con `@use 'styles/context-menu'`. |
| `src/styles/_session-grid.scss` | **Añadir** `.session-del-cross` + `position: relative` en header/clip lleno; coexistencia con `▶`/`⚙`. |
| `src/core/lane-resources.ts` | **Sin cambios** — `dispose` (:42) ya hace lo necesario. |

---

## Plan de pruebas

### Unitarios (Vitest, lógica pura) — `src/session/session.test.ts` (ya existe), `src/core/scene-ensure.test.ts` (ya existe), `src/core/context-menu.test.ts` (nuevo)

1. **`deleteClipAt`**: pone `null` en el índice, NO desplaza el resto (`clips[idx+1]` intacto); idempotente sobre `null`.
2. **`deleteLane`**: quita la lane de `state.lanes`; `delete scene.clipPerLane[laneId]` en todas las scenes; no toca otras lanes; no-op si el id no existe.
3. **`deleteScene` COMPACTANTE**: `scenes.length` baja 1; **cada lane hace `clips.splice(idx,1)`** (assert de que `clips` se desplaza: para `[A,B,C]` borrar idx 1 → `[A,C]`); `clipPerLane` reindexado (un mapeo `row=2` con `idx=1` pasa a `row=1`; un mapeo `row=1==idx` se elimina). Nombre del test: `'deleteScene compacts clip rows and reindexes clipPerLane'`.
4. **`laneHasContent` / `sceneHasContent`**: true con clips; false sin clips. `sceneHasContent` true también cuando un `clipPerLane` explícito apunta a esa fila con clip (aunque `lane.clips[idx]` de esa lane sea null).
5. **`ensureScenesForRows` siembra mínima**: con ≥1 lane y todas a `clips:[]`, crea ≥1 scene (assert `state.scenes.length >= 1`); con 0 lanes, 0 scenes; el caso "clip en fila sin scene previa" sigue creando la scene de esa fila (regresión del ▶).
6. **`context-menu.ts`** (jsdom, directiva `// @vitest-environment jsdom` por archivo — verificado: vitest corre en `node` por defecto, ver `vitest.config.ts:5`): `openContextMenu` añade `.context-menu`; dispara `onSelect` al clicar; cierra al click-fuera / Escape; `disabled` no dispara; un segundo menú cierra el primero; `preventDefault` se llama.

### e2e (Playwright) — `tests/e2e/session-management.spec.ts` (nuevo)

> `test:e2e` sirve `dist/` sin build → **`npm run build` antes**. Boot: `page.goto('/')` + `waitForFunction(() => document.querySelectorAll('.session-cell-filled').length > 0)`.

1. **Aspa borra clip**: contar `.session-cell-filled`, clicar el `.session-del-cross` de uno, conteo −1 + la celda pasa a `.session-cell-empty`.
2. **Aspa borra lane (con confirmación)**: añadir lane, crear un clip, `page.on('dialog', d => d.accept())`, clicar el aspa de la cabecera; la columna desaparece (identificada por `.session-lane-header[data-lane-id="…"]` — **ya existe el selector** porque añadimos `dataset.laneId`) y NO hay error `stripFor`/`no resource` en consola.
3. **Borrado de lane vacía sin diálogo**: añadir lane (vacía), registrar un handler de `dialog` que marque una bandera, borrar; el handler NO se invocó y la columna desaparece.
4. **`deleteScene` compacta**: con ≥2 scenes y clips en filas distintas, borrar la scene N (aceptar diálogo); las scenes posteriores se desplazan y sus clips siguen alineados (lanzar la scene que estaba en N+1 reproduce su clip, no el de otra fila). Cubre A2.
5. **Lane nace vacía**: añadir una lane de instrumento → 0 `.session-cell-filled` en su columna.
6. **▶ presente tras crear clip en fila sin scene** (regresión del bug REAL): provocar `onCellClick` en una fila r sin scene previa (o `onSliceToBank`) → existe un `.session-scene-launch` en la fila r. (Verifica el fix de `onCellClick` vía `placeClipEnsuringScene`. NOTA: el e2e NO puede ejercitar `installClip` porque es código muerto eliminado.)
7. **Menú contextual**: `click({ button: 'right' })` sobre una cabecera de lane → `.context-menu` con "Borrar pista"; seleccionarlo borra la lane.
8. **Undo de borrado de lane**: borrar lane → `Ctrl+Z` → la columna vuelve y su clip se puede lanzar sin error `stripFor: no resource` (verifica el re-allocate de `applyLoadedSessionState`). NOTA: el `Ctrl+Z` debe dispararse en modo **session** (en Performance se enruta al arrangement, `performance-feature.ts:208`).

### Verificación manual / smoke

- `npx tsc --noEmit` limpio.
- `npm run test:unit` verde (re-run si `ERR_IPC_CHANNEL_CLOSED` en teardown — flaky conocido).
- `npm run build` + `npm run test:e2e` verde.
- Smoke en `http://localhost:5173`: crear lane (vacía), crear clip, borrar con aspa (sin confirmación), borrar lane con contenido (confirmación), undo (la lane vuelve y suena), borrar scene con contenido (compacta), menú derecho en cada nivel, crear clip en fila sin scene → aparece ▶.

---

## Dudas reales (decisiones legítimas del usuario aún abiertas)

> Las "dudas" mal planteadas de la versión anterior se han ELIMINADO porque la revisión las resolvió contra el código:
> - ~~"¿deleteScene compacta o no?"~~ → **decidido: COMPACTA** (no compactar corrompe el lanzamiento posicional; es bug, no preferencia).
> - ~~"¿la siembra vacía rompe ensureScenesForRows?"~~ → sí podía dejar 0 scenes; **decidido: siembra mínima de 1 scene**.
> - La causa del ▶ (`installClip`) era código muerto → **decidido: eliminar `installClip`, arreglar `onCellClick`**.
> - Las dudas del Frente D NO se listan aquí (las decide D; A solo arregla siembra + ▶ y expone `installSamplerClip`).

Quedan SOLO estas decisiones de producto:

1. **Estilo de confirmación:** `window.confirm` nativo (rápido, feo) vs. un mini-diálogo propio coherente con la UI de Loom. El spec asume `window.confirm` en v1. Si se quiere componente propio, es una sub-tarea de UI adicional.
2. **¿Retirar el borrado por teclado del inspector?** El índice maestro decía "sustituye al borrado por teclado". Propuesta: **mantenerlo** (Delete/Backspace + `#insp-delete` no estorban; el aspa es el camino primario). Confirmar si se quiere eliminar.
3. **Ítem "Duplicar clip" en el menú contextual:** ¿se incluye en v1 (reusando la lógica de `insp-duplicate`, que hace `clips.push(dup)` — append) o se deja para más tarde?
