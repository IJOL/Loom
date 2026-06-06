# Frente A · Gestión de sesión — Spec de diseño

**Fecha:** 2026-06-06
**Estado:** spec de diseño (no implementación). Deriva del índice maestro [2026-06-06-loom-ux-overhaul-overview.md](2026-06-06-loom-ux-overhaul-overview.md), sección "Frente A · Gestión de sesión".
**Depende de:** Frente B (cabecera/saneamiento) se implementa antes, pero este frente no toca su superficie; pueden solaparse si B no ha cerrado. Sin acoplamiento de código.

---

## Objetivo

Hacer que la gestión del grid de sesión (lanes × scenes × clips) sea **directa, consistente y sin estado fantasma**:

1. **Borrado con aspa ✕** a la izquierda de cada **clip**, **scene** y **lane**, con un patrón único y predecible. Reemplaza el borrado por teclado (Delete/Backspace) del inspector, que es engorroso porque pinchar el clip abre el editor.
2. **Confirmación solo cuando hay contenido** (lane con clips, scene con clips lanzables). Vacías → se borran directas, sin diálogo.
3. **Borrar una lane libera sus recursos de audio** (`LaneResourceMap.dispose`), sin orphans.
4. **Nunca rellenar con clips vacíos al crear**: una lane de instrumento nace con **0 clips** (`null` de verdad), un canal de audio lleva su clip **solo en la fila 1**, el resto `null`.
5. **Arreglar el bug del ▶ ausente**: al insertar lanes no-audio con clips recortados/slice, a veces no aparece el botón de scene-launch (▶) de la fila. Causa raíz identificada (ver más abajo).
6. **Menús contextuales** (botón derecho) reutilizables sobre lane / scene / clip / celda vacía, mediante un nuevo módulo `context-menu.ts`. Coexisten con el aspa.

---

## Alcance

### Qué entra

- Aspa ✕ de borrado en: cabecera de lane (`session-lane-header`), celda de scene-launch (`session-scene-cell`) y clip lleno (`session-cell-filled`).
- Lógica pura de borrado de lane y de scene en el modelo (`session.ts`): `deleteLane`, `deleteScene` (y reutilizar el borrado de clip ya existente).
- Predicados puros de "¿tiene contenido?" para decidir si confirmar: `laneHasContent`, `sceneHasContent`.
- Wiring de los callbacks `onDeleteLane` / `onDeleteScene` / `onDeleteClip` en `SessionHost`, envueltos en `withUndo`, llamando a `dispose` de recursos al borrar lane.
- Diálogo de confirmación mínimo (reusar `window.confirm` o un componente ligero — ver Dudas abiertas), solo cuando hay contenido.
- Cambio de la siembra de clips al crear lanes/canales: `onAddLane`, `addAudioChannel`, `onSliceToBank`, `onAddStemLanes`, `addNoteLane`, `onAddStemLanes` (runAdd/runReplace) y `buildStemLane`.
- Fix del bug ▶ ausente: garantizar que toda fila con un clip tenga su scene, en **todos** los caminos que insertan un clip — incluido `installClip` (el camino del import de loop del Sampler, que hoy **no** llama a `ensureScenesForRows`).
- Módulo nuevo `src/core/context-menu.ts`: helper genérico de menú contextual (abrir en `contextmenu`, posicionar, cerrar al clicar fuera / Escape, ítems con label + acción + `disabled`/`danger`).
- Menús contextuales en lane / scene / clip lleno / celda vacía, con acciones que reutilizan los callbacks ya existentes (borrar, duplicar, editar, lanzar, añadir scene, etc.).
- Tests: unitarios de la lógica pura (modelo + predicados) y e2e Playwright del aspa + menú + ausencia de relleno + presencia del ▶.

### Qué NO entra

- Renombrar lanes/scenes inline (existe el campo `lane.name`/`scene.name`; el menú contextual puede ofrecer "Renombrar…" que abra un prompt, pero el editor inline no es objetivo de este frente).
- Reordenar lanes o scenes (drag de cabeceras). Fuera de alcance.
- Cualquier cambio en la cabecera/transporte (Frente B), el mixer del master (Frente C), el Sampler/audio (Frente D) o los editores de clip (Frente E). Tocamos `session-host.ts` y `session-ui.ts`, pero solo en lo relativo al grid y a la creación de lanes.
- Borrado múltiple/selección de varias scenes o lanes a la vez.
- Persistencia de un "papelera/undo visual" más allá del `withUndo` global ya existente.

---

## Diseño

### Arquitectura actual (lo que tocamos)

El grid de sesión se construye en `renderSessionGrid` ([session-ui.ts:47](../../../src/session/session-ui.ts)), que es **DOM puro sin audio**: recibe `state`, `laneStates` y un objeto `cb: SessionUICallbacks`. Toda la interactividad sale por esos callbacks. El propietario de estado y de los callbacks es `SessionHost` ([session-host.ts:160](../../../src/session/session-host.ts)), que también posee `laneStates` y delega audio en `LaneResourceMap` vía `deps.laneResources` / `deps.ensureLaneResource` / `deps.swapLaneEngine`.

El modelo es puro en [session.ts](../../../src/session/session.ts): `SessionLane.clips: (SessionClip | null)[]`, `SessionScene.clipPerLane`, helpers `emptyClip`/`emptyLane`/`emptyScene`. El borrado de **clip** ya existe pero **solo** vía teclado en el inspector (`deleteSelectedClip`, [session-inspector.ts:77](../../../src/session/session-inspector.ts)): pone `lane.clips[idx] = null` dentro de `withUndo`.

`ensureScenesForRows` ([scene-ensure.ts:9](../../../src/core/scene-ensure.ts)) añade scenes hasta que `state.scenes.length >= max(lane.clips.length)` — es lo que garantiza que cada fila con clip tenga su botón ▶ scene-launch (el grid solo pinta el botón si existe `state.scenes[r]`, ver [session-ui.ts:79](../../../src/session/session-ui.ts) y [session-ui.ts:222](../../../src/session/session-ui.ts)).

La liberación de recursos ya está disponible: `LaneResourceMap.dispose(laneId)` ([lane-resources.ts:42](../../../src/core/lane-resources.ts)) dispone strip + engine + inserts y borra la entrada. Hoy solo se invoca al detectar orphans en `applyLoadedSessionState` ([session-host.ts:322](../../../src/session/session-host.ts)).

### Componentes nuevos / modificados

#### 1. Modelo puro de borrado (`session.ts`)

Añadir helpers puros, en la misma línea que `moveClip`/`copyClip` (devuelven nuevo estado o mutan in-place de forma consistente con el resto del módulo; mantenemos el estilo de mutación in-place que ya usa `ensureScenesForRows` y `reconcileLaneEnvelopes`, para que `SessionHost` decida cuándo clonar/snapshot vía `withUndo`):

- `deleteClipAt(lane: SessionLane, clipIdx: number): void` — `lane.clips[clipIdx] = null` (no `splice`: hay que preservar el índice de fila para que el resto de la columna no se desplace). Encapsula lo que hoy hace `deleteSelectedClip` para reutilizarlo desde el aspa y el menú.
- `deleteLane(state: SessionState, laneId: string): void` — `splice` de la lane en `state.lanes`; limpia `scene.clipPerLane[laneId]` de cada scene (la lane desaparece como columna, así que su entrada en cada scene queda colgada). **No** toca recursos de audio: eso lo hace el host tras la mutación (separación pura/efecto).
- `deleteScene(state: SessionState, sceneIdx: number): void` — `splice` de la scene en `state.scenes`. Decisión: las **filas de clips NO se desplazan** al borrar una scene (un clip vive en `lane.clips[rowIdx]`, indexado por posición; borrar la scene N elimina la fila lanzable N pero los clips de las filas N+1… mantienen su índice). Esto evita reescribir todas las columnas. Documentar explícitamente este comportamiento (ver Dudas abiertas: el usuario podría querer "compactar").

Predicados puros (para decidir confirmación):

- `laneHasContent(lane: SessionLane): boolean` — `lane.clips.some(c => c != null)`.
- `sceneHasContent(state: SessionState, sceneIdx: number): boolean` — true si alguna lane tiene un clip en `lane.clips[sceneIdx]` **o** si `scene.clipPerLane` referencia algún clip. (El criterio operativo: ¿borrarla pierde algo lanzable? Si la fila tiene cualquier clip → sí.)

#### 2. Siembra de lanes "vacías de verdad"

Hoy todos los caminos de creación hacen `for (r..rows) clips.push(r===0 ? clip : emptyClip(defaultLen))` o `clips.push(emptyClip(...))`. El cambio:

- **Lane de instrumento** (`onAddLane`, [session-host.ts:736](../../../src/session/session-host.ts)): nace con `clips: []` (0 clips). No se hace push de ningún `emptyClip`. El grid ya pinta celdas vacías para filas sin clip (`lane.clips[rowIdx] ?? null` → `session-cell-empty`), así que visualmente la columna sigue alineada con las scenes existentes, pero sin clips fantasma.
- **`addNoteLane`** ([session-host.ts:523](../../../src/session/session-host.ts)): el clip de notas va en `clips[0]`; el resto se deja como huecos `null` implícitos (no rellenar). Si hay scenes existentes, basta con `lane.clips = [clip]` (las filas >0 quedan vacías al leerse con `?? null`).
- **Canal de audio** (`addAudioChannel` [session-host.ts:562](../../../src/session/session-host.ts) y `onCellDropAudio` para `engineId === 'audio'`): clip en `clips[0]`, resto vacío (`lane.clips = [clip]`).
- **`onSliceToBank`** ([session-host.ts:197](../../../src/session/session-host.ts)): `noteClip` en `clips[0]`, resto vacío.
- **Stems** (`onAddStemLanes` runAdd/runReplace + `buildStemLane`, [session-host.ts:770](../../../src/session/session-host.ts)): cada lane de stem lleva su `audioClip` en `clips[0]`, resto vacío.

Patrón uniforme a aplicar en todos: sustituir el bucle de relleno por `lane.clips = [clip]` (cuando hay un clip de fila 0) o `lane.clips = []` (instrumento sin clip). Tras la mutación, **siempre** `ensureScenesForRows(state)` para que las scenes existentes mantengan sus ▶ (no se quita ninguna scene; solo nos aseguramos de que la fila 0 sea lanzable).

> **Importante:** quitar el relleno **no** rompe `ensureScenesForRows`, porque esa función calcula `maxClipRows` sobre `lane.clips.length`. Una lane vacía aporta `length 0`; las lanes con clip en fila 0 aportan `length 1`. Sigue creando al menos 1 scene si hace falta. El comportamiento de scenes existentes (p.ej. al añadir una lane a una sesión con 4 scenes) se conserva porque otras lanes ya empujan `maxClipRows`.

#### 3. Fix del bug "▶ ausente" (clips recortados/slice)

**Causa raíz:** el camino `installClip` del import de loop del Sampler ([session-host.ts:999-1006](../../../src/session/session-host.ts)) coloca el clip en `lane.clips[idx]` y re-renderiza, **pero nunca llama a `ensureScenesForRows`**. Si el slot elegido (`idx`) cae en una fila para la que no existe `state.scenes[idx]`, el grid no pinta el ▶ scene-launch de esa fila ([session-ui.ts:79/222](../../../src/session/session-ui.ts)) → "el ▶ no aparece". Esto coincide con el síntoma descrito ("ocurría con clips recortados/slice", que es justo el flujo del Sampler que usa `installClip`).

**Arreglo:**
- En `installClip` ([session-host.ts:999](../../../src/session/session-host.ts)), añadir `ensureScenesForRows(this.state)` antes de `renderWithMixer()`, igual que ya hacen `onSliceToBank`, `addAudioChannel`, `onCellDropAudio`, `onAddLane`, `onAddStemLanes`.
- Defensa en profundidad: hacer del par "insertar clip + asegurar scene" un único helper de instancia en `SessionHost`, p.ej. `private placeClipEnsuringScene(lane, idx, clip)`, para que ningún camino futuro vuelva a olvidarlo. Migrar a él los puntos de inserción de clip (los `lane.clips[idx] = clip` de `onCellClick`, `onCellDropAudio`, `installClip`, y el `clips[0]` de las creaciones de lane).
- Test de regresión (unitario + e2e) que reproduzca: import de loop → clip en fila sin scene previa → assert de que existe `state.scenes[idx]` y que el grid renderiza un `.session-scene-launch` para esa fila.

#### 4. Aspa ✕ de borrado (UI en `session-ui.ts`)

Patrón visual y de evento consistente para los tres niveles. Un helper interno en `session-ui.ts`:

```
function deleteCross(title: string, onDelete: () => void): HTMLElement
```

Crea un `<button class="session-del-cross" title=...>✕</button>` que en `click` hace `e.stopPropagation()` + `onDelete()`. Posición "a la izquierda" del elemento (orden DOM primero; CSS lo coloca a la izquierda dentro del header/celda). Se inserta:

- **Lane:** en `laneHeader` ([session-ui.ts:135](../../../src/session/session-ui.ts)), como primer hijo del `.session-lane-header`, antes del nombre. `title = "Borrar pista"`. Acción → `cb.onDeleteLane(lane.id)`.
- **Scene:** en `sceneLaunchCell` ([session-ui.ts:219](../../../src/session/session-ui.ts)), dentro del `.session-scene-cell` cuando hay scene, antes del botón `▶`. `title = "Borrar escena"`. Acción → `cb.onDeleteScene(idx)`. (Las celdas de scene vacías —filas sin scene— no llevan aspa.)
- **Clip:** en `clipCell` ([session-ui.ts:170](../../../src/session/session-ui.ts)), solo en la rama `if (clip)` (`session-cell-filled`), como primer hijo, antes del label. `title = "Borrar clip"`. Acción → `cb.onDeleteClip(lane.id, rowIdx)`. Importante: igual que el `playIcon`, el aspa debe `stopPropagation` en `pointerdown`/`pointerup`/`click` para no disparar `wireClipDrag`/`onClipClick`.

CSS: añadir `.session-del-cross` en el SCSS del grid (`src/styles/_session-grid.scss` — el mismo donde vive `session-cell-filled`). Pequeña, esquina superior izquierda, atenuada por defecto, con hover de aviso (color "danger"). Coexiste con el ▶ (que está a la derecha en el clip) y con el ⚙ edit de la lane.

Extender `SessionUICallbacks` ([session-ui.ts:8](../../../src/session/session-ui.ts)) con:

```
onDeleteClip:  (laneId: string, clipIdx: number) => void;
onDeleteLane:  (laneId: string) => void;
onDeleteScene: (sceneIdx: number) => void;
```

#### 5. Confirmación condicional + wiring en `SessionHost`

En `buildCallbacks` ([session-host.ts:604](../../../src/session/session-host.ts)) añadir los tres handlers:

- `onDeleteClip(laneId, clipIdx)`:
  - Clip vacío/`null` → no-op. Clip con notas o sample → es "contenido", pero **un clip individual siempre se borra directo** (es la unidad mínima; el inspector ya lo borra directo con Delete). Sin confirmación. (Coherente con el índice maestro: la confirmación es por **lane/scene**, no por clip.)
  - `withUndo(hd, () => deleteClipAt(lane, clipIdx))`. Si el clip borrado era el `selectedClip` del inspector, cerrar/ocultar el panel (reusar la lógica de `deleteSelectedClip`). `renderWithMixer()`.
- `onDeleteLane(laneId)`:
  - Si `laneHasContent(lane)` → `confirm("Borrar la pista «X» y todos sus clips?")`. Vacía → directo.
  - `withUndo(hd, () => { deleteLane(state, laneId); ... })`. Tras la mutación: `this.laneStates.delete(laneId)`; `this.deps.laneResources?.dispose(laneId)` (libera audio); si `activeEditLane === laneId`, limpiar el editor (mismo gesto que el toggle-off de `onEditLane`); `ensureScenesForRows` no hace falta (borrar columnas no añade filas), pero re-render sí. `refreshSynthTabs()` + `renderWithMixer()`.
  - **Undo de un borrado de lane** restaura la lane en el estado; los recursos de audio se re-asignan por el camino normal: `applyLoadedSessionState`/`onStateApplied` ya re-allocan cualquier lane sin recurso (`ensureLaneResource`). Verificar que el undo de borrado de lane pasa por un re-allocate (puede requerir un `ensureLaneResource` explícito en el `restore`, igual que hace `applyLoadedSessionState` [session-host.ts:336-341](../../../src/session/session-host.ts)). **Esto es el punto más delicado** del frente (ver Plan de pruebas).
- `onDeleteScene(sceneIdx)`:
  - Si `sceneHasContent(state, sceneIdx)` → `confirm("Borrar la escena «X»?")`. Vacía → directo.
  - `withUndo(hd, () => deleteScene(state, sceneIdx))`. Si alguna lane estaba reproduciendo/encolada un clip de esa fila, conviene `stopLane`/limpiar `laneStates` de los afectados (decidir: parar lo que sonaba de esa fila). `renderWithMixer()`.

`withUndo` snapshot+mutación ya existe ([history-wiring.ts:50](../../../src/save/history-wiring.ts)); todo borrado es undoable, como el resto de mutaciones del host.

El borrado por teclado del inspector (`wireKeyboardShortcuts`/`deleteSelectedClip`, [session-inspector.ts:67-91](../../../src/session/session-inspector.ts)) **se mantiene** (el índice dice "sustituye al borrado por teclado", pero conservarlo no estorba y el aspa es el camino primario; ver Dudas abiertas si se quiere retirarlo). Refactor: `deleteSelectedClip` puede delegar en el nuevo `onDeleteClip` para no duplicar la lógica de cierre del panel.

#### 6. Módulo reutilizable `context-menu.ts`

Nuevo archivo `src/core/context-menu.ts`. API mínima y agnóstica de dominio:

```
export interface ContextMenuItem {
  label: string;
  onSelect: () => void;
  disabled?: boolean;
  danger?: boolean;      // estilo de "borrar"
  separatorBefore?: boolean;
}
export function openContextMenu(e: MouseEvent, items: ContextMenuItem[]): void;
```

Comportamiento:
- `e.preventDefault()` (suprime el menú nativo, como ya hace el drum-grid en [clip-editor-drum-grid.ts:297](../../../src/session/clip-editors/clip-editor-drum-grid.ts) y el piano-roll en [pianoroll.ts:545](../../../src/core/pianoroll.ts) — esos pueden migrar a este módulo más adelante, pero no es obligatorio en este frente).
- Construye un `<ul class="context-menu">` posicionado en `e.clientX/clientY` (con corrección si se sale del viewport).
- Cierra al hacer click fuera, al pulsar Escape, o al seleccionar un ítem. Solo un menú abierto a la vez (cerrar el anterior).
- Sin dependencias; DOM puro; testeable con jsdom para la construcción y con Playwright para la interacción.
- CSS en un parcial nuevo `src/styles/_context-menu.scss` (o dentro de `_session-grid.scss`).

Wiring en `session-ui.ts` — `addEventListener('contextmenu', ...)` en cada elemento, llamando a `openContextMenu(e, items)` con ítems que reutilizan los callbacks ya existentes:

- **Cabecera de lane** (`.session-lane-header`): "Editar instrumento" (`cb.onEditLane`), "Parar pista" (`cb.onStopLane`), separador, "Borrar pista" (danger → `cb.onDeleteLane`).
- **Scene** (`.session-scene-cell` con scene): "Lanzar escena" (`cb.onLaunchScene`), "Añadir escena" (`cb.onAddScene`), separador, "Borrar escena" (danger → `cb.onDeleteScene`).
- **Clip lleno** (`.session-cell-filled`): "Abrir editor" (`cb.onClipClick`), "Reproducir / Parar" (`cb.onClipPlayPause`), "Duplicar" (nuevo callback opcional `cb.onDuplicateClip` que reusa la lógica de `insp-duplicate` [session-inspector.ts:146](../../../src/session/session-inspector.ts), o se omite en v1), separador, "Borrar clip" (danger → `cb.onDeleteClip`).
- **Celda vacía** (`.session-cell-empty`): "Crear clip" (`cb.onCellClick`, que ya crea un `emptyClip` salvo en lanes audio); para lanes `audio`/`sampler`, ítem deshabilitado o "Importar audio…" (fuera de alcance v1 — dejar solo "Crear clip" donde aplique).

El menú **coexiste** con el aspa: el aspa es el atajo de borrado de un click; el menú agrupa las demás acciones + borrado. No hay conflicto de eventos (uno es `click` en el botón aspa, otro es `contextmenu` en el contenedor).

### Flujo de datos (resumen)

```
contextmenu / click-en-aspa
        │
        ▼
SessionUICallbacks.onDelete{Clip,Lane,Scene}   (session-ui.ts dispara)
        │
        ▼
SessionHost.buildCallbacks handler             (decide confirmación según *HasContent)
        │  withUndo(hd, …)
        ▼
modelo puro: deleteClipAt / deleteLane / deleteScene   (session.ts muta state)
        │  (solo en deleteLane:)
        ▼
laneStates.delete(id) + laneResources.dispose(id)      (efecto de audio)
        │
        ▼
ensureScenesForRows? (no en delete) + renderWithMixer() + refreshSynthTabs()
```

### UI

- **Aspa ✕**: pequeña, color tenue, hover rojo; arriba-izquierda del header de lane / celda de scene / clip lleno. No aparece en celdas vacías ni en filas de scene sin scene.
- **Menú contextual**: lista vertical, ítem "Borrar…" siempre al final con estilo `danger`, separador antes.
- **Confirmación**: `window.confirm` en v1 (decisión a confirmar con el usuario — ver Dudas). Solo cuando hay contenido.

---

## Archivos a tocar

| Archivo | Cambio |
|---|---|
| [src/session/session.ts](../../../src/session/session.ts) | **Añadir** helpers puros: `deleteClipAt(lane, idx)`, `deleteLane(state, laneId)`, `deleteScene(state, idx)`, y predicados `laneHasContent(lane)`, `sceneHasContent(state, idx)`. Junto a `moveClip`/`copyClip` ([session.ts:266-314](../../../src/session/session.ts)). Sin tocar tipos existentes. |
| [src/session/session-ui.ts](../../../src/session/session-ui.ts) | **Añadir** a `SessionUICallbacks` ([:8](../../../src/session/session-ui.ts)) `onDeleteClip`/`onDeleteLane`/`onDeleteScene` (+ opcional `onDuplicateClip`). **Añadir** helper `deleteCross(...)`. Insertar aspa en `laneHeader` ([:135](../../../src/session/session-ui.ts)), `sceneLaunchCell` ([:219](../../../src/session/session-ui.ts)) y rama `if (clip)` de `clipCell` ([:170](../../../src/session/session-ui.ts)) con `stopPropagation`. **Añadir** listeners `contextmenu` en lane-header, scene-cell, clip lleno y celda vacía, llamando a `openContextMenu`. |
| [src/session/session-host.ts](../../../src/session/session-host.ts) | **`buildCallbacks`** ([:604](../../../src/session/session-host.ts)): añadir `onDeleteClip`/`onDeleteLane`/`onDeleteScene` (confirmación condicional + `withUndo` + `dispose` de recursos en lane + limpieza de `laneStates`/`activeEditLane`). **Quitar el relleno** con `emptyClip` en: `onAddLane` ([:749-751](../../../src/session/session-host.ts)), `addNoteLane` ([:541](../../../src/session/session-host.ts)), `addAudioChannel` ([:586](../../../src/session/session-host.ts)), `onSliceToBank` ([:244](../../../src/session/session-host.ts)), `onCellDropAudio` (camino audio), `onAddStemLanes` (`buildStemLane` [:797](../../../src/session/session-host.ts) y los runAdd/runReplace). **Arreglar `installClip`** ([:999](../../../src/session/session-host.ts)) añadiendo `ensureScenesForRows`. Opcional: helper `placeClipEnsuringScene`. |
| [src/session/session-inspector.ts](../../../src/session/session-inspector.ts) | Refactor de `deleteSelectedClip` ([:77](../../../src/session/session-inspector.ts)) para delegar en el nuevo `onDeleteClip` del host (evitar duplicar cierre de panel). Mantener el atajo Delete/Backspace. |
| **NUEVO** `src/core/context-menu.ts` | Módulo reutilizable: `ContextMenuItem`, `openContextMenu(e, items)`. DOM puro, sin dependencias. |
| **NUEVO** `src/styles/_context-menu.scss` (o dentro de `_session-grid.scss`) | Estilos del menú contextual. |
| `src/styles/_session-grid.scss` | **Añadir** `.session-del-cross` (aspa) + ajustes de layout para que coexista con `▶`/`⚙` sin solaparse. (Confirmar nombre de archivo del parcial al implementar.) |
| `src/core/lane-resources.ts` | **Sin cambios** — `dispose` ([:42](../../../src/core/lane-resources.ts)) ya hace lo necesario; solo se invoca desde el nuevo `onDeleteLane`. |
| `src/core/scene-ensure.ts` | **Sin cambios** — se reutiliza tal cual; el fix es llamarla desde `installClip`. |

---

## Plan de pruebas

### Unitarios (Vitest, lógica pura) — `src/session/*.test.ts`

1. **`deleteClipAt`**: pone `null` en el índice y **no desplaza** el resto de la columna (`clips[idx+1]` sigue en su sitio).
2. **`deleteLane`**: quita la lane de `state.lanes`; limpia `scene.clipPerLane[laneId]` en todas las scenes; no toca otras lanes.
3. **`deleteScene`**: quita la scene de `state.scenes`; documenta que **no** compacta filas de clips (assert de que `clips[idx]` de otras lanes no se mueve).
4. **`laneHasContent` / `sceneHasContent`**: true con clips, false sin clips (vacía → borrado directo).
5. **Siembra vacía**: tras simular `onAddLane`-equivalente puro, la lane tiene `clips.length === 0` (no `emptyClip`). Tras `addAudioChannel`/`onSliceToBank`-equivalente, `clips[0]` lleno y `clips[1] == null`.
6. **`ensureScenesForRows` + installClip-equivalente**: insertar un clip en una fila sin scene crea la scene (regresión del bug ▶). Ya hay base en [scene-ensure.test.ts](../../../src/core/scene-ensure.test.ts) — añadir un caso que cubra el camino "clip colocado por installClip".
7. **`context-menu.ts`** (jsdom): `openContextMenu` añade `.context-menu` al DOM, dispara `onSelect` al clicar un ítem, cierra al click-fuera / Escape, y `disabled` no dispara `onSelect`.

### e2e (Playwright) — `tests/e2e/` (nuevo `session-management.spec.ts`)

> Recordatorio del repo: `test:e2e` sirve `dist/` sin build → **`npm run build` antes**.

1. **Aspa borra clip**: en la sesión demo, contar `.session-cell-filled`, clicar el `.session-del-cross` de uno, assert de que el conteo baja en 1 y la celda pasa a `.session-cell-empty`.
2. **Aspa borra lane (con confirmación)**: añadir lane (`+` del tab-bar), poner contenido, clicar aspa de la cabecera, manejar el `dialog` (aceptar), assert de que la columna desaparece (`session-lane-header` con ese `data-lane-id` ya no existe) y de que no hay error de `stripFor` en consola (recurso liberado).
3. **Borrado de lane vacía sin diálogo**: añadir lane (queda vacía), borrar, assert de que **no** salta `dialog` (registrar handler y comprobar que no se invoca) y la columna desaparece.
4. **Aspa borra scene**: contar `.session-scene-launch`, borrar una scene con contenido (aceptar diálogo), assert de que baja en 1.
5. **Lane nace vacía**: añadir una lane de instrumento, assert de que su columna tiene 0 `.session-cell-filled` (todas las celdas son `.session-cell-empty`).
6. **▶ presente tras import de loop/slice** (regresión del bug): el flujo del Sampler que llama a `installClip`/`onSliceToBank` debe dejar un `.session-scene-launch` en la fila del clip. Reusar el patrón de [sampler.spec.ts](../../../tests/e2e/sampler.spec.ts) / [loop-arrangement.spec.ts](../../../tests/e2e/loop-arrangement.spec.ts). Assert: tras la operación, `state.scenes.length >= idxDelClip+1` y existe el botón ▶ correspondiente.
7. **Menú contextual**: `click({ button: 'right' })` sobre una cabecera de lane, assert de que aparece `.context-menu` con un ítem "Borrar pista"; seleccionarlo equivale al aspa.
8. **Undo de borrado de lane** (el caso delicado): borrar lane → Ctrl+Z → assert de que la columna vuelve **y** suena/tiene recurso (p.ej. lanzar su clip no produce error `stripFor: no resource`). Verifica que el undo re-alloca recursos.

### Verificación manual / smoke

- `npx tsc --noEmit` limpio.
- `npm run test:unit` verde (re-run si `ERR_IPC_CHANNEL_CLOSED` en teardown — flaky conocido).
- `npm run build` + `npm run test:e2e` verde.
- Smoke en `http://localhost:5173`: crear lane (vacía), crear clip, borrar con aspa, borrar lane con contenido (sale confirmación), undo, menú derecho en cada nivel.

---

## Dudas abiertas

> Decisiones pendientes del **usuario**. Las del **Frente D** se listan explícitas y **no** se deciden aquí.

### De este frente (A) — a confirmar con el usuario

1. **Estilo de confirmación**: ¿`window.confirm` nativo (rápido, feo) o un mini-diálogo propio coherente con la UI de Loom? El spec asume `window.confirm` en v1; si se quiere componente propio, es un sub-tarea de UI.
2. **`deleteScene` ¿compacta o no?** El diseño propuesto **no** desplaza las filas de clips al borrar una scene (mantiene índices). Alternativa: compactar (todas las columnas hacen `splice(idx,1)`), que es más intuitivo visualmente pero reescribe todo el grid y puede romper `clipPerLane`. **Pendiente de decisión.**
3. **¿Retirar el borrado por teclado del inspector?** El índice dice "sustituye al borrado por teclado". Propuesta: **mantenerlo** (no estorba, es un atajo). Confirmar si se quiere eliminar Delete/Backspace del inspector.
4. **Confirmación al borrar clip**: el spec borra clips **siempre directo** (sin confirmar), reservando la confirmación a lane/scene (como dice el índice). Confirmar que un clip con muchas notas no merece confirmación.
5. **Ítem "Duplicar clip" en el menú contextual**: ¿se incluye ya en v1 (reusando `insp-duplicate`) o se deja para más tarde?
6. **Migrar los `contextmenu` existentes** (drum-grid [:297](../../../src/session/clip-editors/clip-editor-drum-grid.ts), piano-roll [pianoroll.ts:545](../../../src/core/pianoroll.ts)) al nuevo `context-menu.ts`: hoy solo hacen `preventDefault`. ¿Aprovechar para darles menú real (p.ej. borrar nota) o dejarlo fuera de este frente?

### Del Frente D (Sampler & audio) — listadas explícitamente, NO decididas aquí

(Copiadas del índice maestro; este frente A no las resuelve, pero la siembra de canales de audio y el flujo `onSliceToBank` quedarán condicionados por ellas.)

- **`loop` / `loopStart` per-pad** (sustain-loop de la muestra): ¿se mantienen o fuera?
- **Cabecera waveform** (BPM · bar · ♺ Warp · ✂ Slice→pads): probable eliminación/reparto.
- **Audio lane (WAV puro)**: edición tentativa = trim + warp opcional (no fijado).
- **Waveform en un loop**: solo como display detrás del piano-roll, sin controles.
- **Revertir la "audio-channel direction"**: el audio lane = solo WAV puros; los loops particionados vuelven al Sampler. → Esto afecta a `onSliceToBank` y `addAudioChannel`; en este frente solo arreglamos su **siembra** (clip en fila 1, resto vacío) y el bug del ▶, sin reubicar la responsabilidad loop↔audio (eso es D).
