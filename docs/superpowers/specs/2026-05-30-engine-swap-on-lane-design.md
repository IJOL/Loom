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
| Alcance | Solo motores melódicos: `tb303`, `subtractive`, `fm`, `wavetable`, `karplus` (todos editor `piano-roll`). `drums-machine` (editor `drum-grid`) queda fuera. |
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

### `src/engines/engine-selector-ui.ts`
- `populateEngineSelect`: filtrar a motores melódicos (`editor === 'piano-roll'`),
  excluyendo `drum-grid`. Drums desaparece de las opciones.
- Handler `change`: en vez de solo `rebuildEngineParamUI()`, invocar
  `swapLaneEngineFlow(activeLaneId, newId)` (sigue envuelto en `withUndo` cuando
  hay `historyDeps`).
- Si el lane activo usa un motor `drum-grid`, el `<select>` se deshabilita
  (un canal de batería no se convierte a melódico).

### `swapLaneEngineFlow` (orquestador)
Módulo nuevo `src/app/engine-swap.ts` (o función en `main.ts` con deps
inyectadas). Ver "Flujo de datos".

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
4. **Audio:** `lanes.swapLaneEngine(laneId, newId)`.
5. **Sonido por defecto:** aplicar el primer preset del motor nuevo si existe
   (`applyPresetToEngine(engine, engine.presets[0]?.name)`); si no, quedan los
   defaults de construcción del motor.
6. **UI:**
   - `engineSel.value = newId` → `rebuildEngineParamUI()` (lee el nuevo
     engineId desde el estado).
   - `injectEngineModulatorPanel(laneId)` (re-render del panel de moduladores).
   - refrescar el dropdown de presets.
   - re-renderizar el editor de clip del lane: el rango MIDI del piano-roll
     cambia (`tb303` 24–60, resto 36–96).
7. **Persistir:** disparar el autosave / save-manager existente.
8. Los pasos 2–7 ocurren dentro del `withUndo` del handler → **una** entrada de
   undo.

## Casos borde y manejo de errores

- **Mismo motor:** no-op; no resetea el sonido.
- **Lane de drums:** selector deshabilitado; drums fuera de las opciones; el
  swap ignora targets `drum-grid`. Un canal de batería sigue siendo batería.
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
5. **`engine-selector-ui`:** `drum-grid` excluido de las opciones; selector
   deshabilitado en lane `drum-grid`.
6. **Reconciliación de envelopes:** un clip con un envelope sobre un paramId
   que no existe en el motor nuevo → tras el swap ese envelope se poda; un
   envelope sobre un paramId compartido sobrevive.

## Fuera de alcance (YAGNI)

- Conversión de clips melódico↔drums (drums excluido del alcance).
- Preservar o mapear params entre motores (decidido: reset).
- Diálogo de confirmación (decidido: undo).
- Control de motor por-strip en el mixer (decidido: reusar el selector
  existente).
