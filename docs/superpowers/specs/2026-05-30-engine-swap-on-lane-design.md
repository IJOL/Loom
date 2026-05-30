# Cambiar el motor de un canal existente — Diseño

**Fecha:** 2026-05-30
**Estado:** Aprobado (pendiente de plan de implementación)

## Problema

Cada canal (lane) de la sesión tiene un motor de síntesis fijo asignado en su
creación (`SessionLane.engineId`). El selector de motor de la página poly
(`<select id="engine-select">`) ya existe y ya apunta al canal activo, pero su
handler `change` solo llama a `rebuildEngineParamUI()`, que **lee** el motor
actual del lane desde `SessionState` — nunca escribe el motor recién
seleccionado. En la práctica el selector es cosmético: no se puede cambiar el
motor de un canal ya creado.

Queremos que seleccionar un motor distinto **reemplace el motor del canal de
verdad**, conservando los clips y la mezcla del canal, reseteando el sonido al
patch por defecto del nuevo motor.

## Decisiones (acordadas)

| Decisión | Resolución |
|---|---|
| Alcance | Los 5 motores melódicos (editor `piano-roll`): `tb303`, `subtractive`, `fm`, `wavetable`, `karplus`. `drums-machine` queda fuera por su `editor: 'drum-grid'` (aunque siga creable como canal nuevo). Swap **simétrico**: tb303 incluido como origen y destino. |
| Superficies de UI | Dos selectores, ambos apuntan al canal en edición: el `#engine-select` existente (página poly, para subtractive/FM/wavetable/karplus) y un **selector espejo nuevo `#engine-select-303`** en la página 303 (para tb303). Tras el swap, el editor se re-rutea a la página del motor nuevo. |
| Sonido al cambiar | Reset al patch por defecto del motor nuevo. Se descartan params y moduladores del anterior. |
| Clips/notas | Las notas se conservan (todos los motores melódicos comparten el modelo `NoteEvent[]`). Los `envelopes` de automatización por-clip se reconcilian: se podan los que apuntan a params ausentes del motor nuevo. |
| Dónde | Reusar el `<select id="engine-select">` existente de la página poly. |
| Confirmación | Sin diálogo; se deshace con undo (una entrada). |
| Enfoque técnico | Reemplazo quirúrgico in place: sustituir solo el motor + voz, reusar `ChannelStrip` e `InsertChain`. |
| Workflow | Rama + worktree separados; sin commit de merge; rebase sobre `main` antes de mergear. |

## Arquitectura

El cambio de motor es una operación sobre un canal existente que reemplaza solo
el motor de audio, conserva el `ChannelStrip` y la `InsertChain` del canal,
conserva los clips, y resetea el sonido a su patch por defecto. Es una entrada
de undo y se persiste.

Una función de orquestación (`swapLaneEngineFlow`) coordina tres capas
existentes:

- **Estado de sesión** (`SessionState`): fuente de verdad de `engineId` y
  `engineState` por lane.
- **Recursos de audio** (`LaneAllocator` / `LaneResourceMap`): el grafo Web
  Audio vivo (strip + motor + inserts por lane).
- **UI**: selector de motor, panel de params, panel de moduladores, editor de
  clip.

**Invariante de canal:** `ChannelStrip` (volumen/pan/sends/sidechain) e
`InsertChain` (FX del canal) son propiedades del *canal*, no del motor, y
sobreviven al cambio de motor. Solo el motor y su voz se reconstruyen.

## Componentes (qué se toca)

### `src/core/lane-resources.ts`
Nuevo método `replaceEngine(laneId, engine)`: desecha **solo** el motor viejo
(`engine.dispose()`), deja intactos `strip` e `inserts`, reescribe el campo
`engine`. Contrasta con `set()`, que desecha los tres recursos.

### `src/app/lane-allocator.ts`
- **Extraer** el cableado por-motor que hoy vive inline en `ensureLaneResource`
  a un helper compartido **`wireEngineIntoLane(engineId, { strip, inserts })`**:
  - `subtractive` → crear `PolySynth(ctx, inserts.inputNode)`, `setPolySynth`.
  - `drums-machine` → `setSharedFx` / `setBusStrip` / `setOutputTarget`
    (no aplica al swap melódico, pero el helper debe cubrirlo para no divergir
    de `ensureLaneResource`, que sí lo usa).
  - fallback plugin-synth (`getPlugin('synth', id)` → `createInstance` →
    `pluginSynthAsEngine`).
  - `tb303` → auto-registrante en `createVoice`, sin llamada extra.
  `ensureLaneResource` pasa a usar este helper para no mantener dos copias.
- **Nuevo `swapLaneEngine(laneId, newEngineId)`**:
  1. Crear el motor nuevo (`createEngineInstance` con fallback plugin).
  2. `wireEngineIntoLane(newEngineId, { strip, inserts })` reusando el strip e
     inserts del recurso existente.
  3. `resources.replaceEngine(laneId, engineNuevo)`.
  4. Liberar la nota sonando (si hay) e invalidar la voz cacheada:
     `laneVoices.delete(laneId)`. La próxima `ensureLaneVoice` crea voz nueva.

### `src/engines/engine-selector-ui.ts` (selector página poly)
- `populateEngineSelect`: filtrar a motores melódicos
  (`getEngine(id)?.editor === 'piano-roll'`), excluyendo `drum-grid`. Drums
  desaparece de las opciones. Resultado: tb303, subtractive, FM, wavetable,
  karplus.
- Handler `change`: en vez de solo `rebuildEngineParamUI()`, invocar
  `swapLaneEngineFlow(deps, activeLaneId, newId)` (sigue envuelto en `withUndo`
  cuando hay `historyDeps` → una entrada de undo).

### `index.html` + selector página 303
- Añadir una fila ENGINE en la página 303 (antes de la fila PRESET) con
  `#engine-lane-label-303` + `#engine-select-303`.
- Nuevo `wireEngineSelector303`: puebla `#engine-select-303` con los mismos 5
  motores melódicos y su `change` llama `swapLaneEngineFlow(deps, activeEditLane,
  newId)`. El canal objetivo es `sessionHost.activeEditLane` (la lane en
  edición), válido tanto para lanes poly como tb303.

### `swapLaneEngineFlow` (orquestador)
Módulo nuevo `src/app/engine-swap.ts`, función con deps inyectadas (para test
unitario puro sin registry global ni DOM). Ver "Flujo de datos".

### `SessionHost.onEditLane` — extraer `showLaneEditor`
`onEditLane` hace dos cosas: si el lane ya está activo, lo apaga (toggle off);
si no, **muestra su editor** (visibilidad de página, `setActiveEngineLane` para
poly, labels, `injectEngineModulatorPanel`). Extraer el segundo bloque a un
método público `showLaneEditor(laneId)` (sin el toggle) para que el re-ruteo
post-swap pueda mostrar la página correcta sin apagar la lane. `onEditLane`
conserva la rama de toggle-off y delega el resto en `showLaneEditor`.

### `SessionHost` — reconciliación de motor
`applyLoadedSessionState` itera lanes y llama `ensureLaneResource(id, engineId)`,
que es **idempotente** (bail si el recurso existe). Por sí solo eso deja
desincronizado el motor tras un undo o al cargar una sesión con motor cambiado.

**Cambio:** al iterar, si ya existe recurso pero
`resource.engine.id !== lane.engineId`, llamar `swapLaneEngine(id, lane.engineId)`
en lugar de saltar. `applyEngineState()` debe correr **después** de la
reconciliación para aplicar params/mods restaurados al motor ya reconstruido.
Esto hace que **undo/redo y cargar una sesión guardada** reconstruyan el motor
correctamente.

## Flujo de datos — `swapLaneEngineFlow(laneId, newId)`

1. **Guardas:**
   - `newId === currentId` → no-op (no resetea el sonido).
   - motor de `newId` es `drum-grid`, o el lane actual es `drum-grid` → ignorar.
2. **Estado:** `lane.engineId = newId`; resetear sonido →
   `lane.engineState = {}` (params y modulators vacíos);
   `lane.enginePresetName = undefined` (limpiar el preset aplicado).
3. **Clips:** conservar `notes`; reconciliar `envelopes` de cada clip del lane
   → podar (o deshabilitar) los que apunten a un paramId ausente del set del
   motor nuevo, reutilizando `getEngineParamIds(newId)` del registry (mismo
   criterio que la capa clip-ops usa al mover/copiar clips entre motores).
4. **Audio:** `lanes.swapLaneEngine(laneId, newId)`. El motor nuevo se
   construye fresco vía `createEngineInstance`, por lo que arranca con sus
   **defaults de construcción** = el "patch por defecto". No se aplica preset.
5. **UI (`onSwapped(laneId, newId)`):**
   - `sessionHost.showLaneEditor(laneId)` → re-rutea a la página del motor nuevo
     (poly o 303), reconstruye param UI + `injectEngineModulatorPanel` + labels.
     Como `renderClipEditor` lee `lane.engineId` fresco, el rango MIDI correcto
     (`tb303` 24–60, resto 36–96) se aplica al reabrir el clip.
   - Sincronizar el valor de **ambos** selectores
     (`#engine-select` y `#engine-select-303`) al `newId`.
6. **Persistir:** disparar el autosave / save-manager existente (`saveSession`).
7. Los pasos 2–6 ocurren dentro del `withUndo` del handler → **una** entrada de
   undo.

## Casos borde y manejo de errores

- **Mismo motor:** no-op; no resetea el sonido.
- **Lane de drums:** drums fuera de ambos dropdowns (su `editor` es
  `drum-grid`); un canal de drums se edita en la página `drum-grid`, que no
  tiene selector de motor. La guarda de `swapLaneEngineFlow` además rechaza
  origen o destino `drum-grid`. Un canal de batería sigue siendo batería.
- **Swap a/desde tb303 (cambio de página):** poly → tb303 re-rutea a la página
  303; tb303 → poly re-rutea a la página poly. `showLaneEditor` aplica la
  visibilidad de página y reconstruye los paneles correctos.
- **Mono↔poly:** `tb303` es mono; los demás poly. Las notas se conservan; las
  que solapen sonarán polifónicas en el motor nuevo. Aceptado.
- **Swap durante playback:** se libera la nota sonando; el próximo step usa el
  motor nuevo. Puede haber un click breve; aceptable.
- **Automatización por-clip huérfana:** envelopes que apuntan a params del motor
  viejo inexistentes en el nuevo se podan/deshabilitan en el paso 3; las notas
  permanecen intactas.
- **Undo/redo:** cubierto por la reconciliación de motor en el apply. El
  snapshot pre-swap (engineId + engineState viejos) se restaura y el motor se
  reconstruye para igualar el estado. El redo restaura engineId nuevo con
  `engineState` vacío → motor nuevo en defaults.
- **engineId desconocido / motor sin fábrica:** `swapLaneEngine` no encuentra
  motor → no reemplaza, deja el recurso intacto y registra el fallo (no rompe
  el grafo de audio).

## Testing (capas del repo)

1. **Pure/unit — `swapLaneEngineFlow`** con dobles: verifica `engineId`
   actualizado, `engineState` reseteado, preset limpiado; guardas (mismo motor,
   `drum-grid`) son no-op.
2. **`lane-allocator` unit — `swapLaneEngine`:** reusa la **misma** instancia de
   `strip` e `inserts` (identidad de objeto), desecha el motor viejo, invalida
   la voz cacheada.
3. **Reconciliación:** aplicar un `SessionState` con `engineId` cambiado sobre
   un lane ya asignado → el recurso queda con el motor nuevo (simula load +
   undo/redo).
4. **DSP real (`.dsp.test.ts`):** renderizar una clip con el motor A, hacer
   swap a B, re-renderizar la misma clip → el espectro/diff confirma cambio de
   motor (aserción **relativa**, nunca magnitud absoluta).
5. **`engine-selector-ui` — `populateEngineSelect`:** lista exactamente los 5
   motores `piano-roll` (tb303, subtractive, FM, wavetable, karplus);
   `drums-machine` (`drum-grid`) excluido.
6. **Reconciliación de envelopes:** un clip con un envelope sobre un paramId
   que no existe en el motor nuevo → tras el swap ese envelope se poda
   (`enabled=false`); un envelope sobre un paramId compartido sobrevive
   (`enabled=true`).
7. **Guardas de `swapLaneEngineFlow`:** origen `drum-grid` o destino `drum-grid`
   → no-op (estado intacto); `newId === currentId` → no-op.

## Fuera de alcance (YAGNI)

- Conversión de clips melódico↔drums (drums excluido del alcance).
- Preservar o mapear params entre motores (decidido: reset).
- Diálogo de confirmación (decidido: undo).
- Control de motor por-strip en el mixer (decidido: reusar el selector
  existente).
