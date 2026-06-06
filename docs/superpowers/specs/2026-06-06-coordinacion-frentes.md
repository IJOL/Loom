# Coordinación transversal entre frentes — 2026-06-06

> Documento PRESCRIPTIVO. Resuelve los acoplamientos que cruzan los frentes
> A (gestión-sesión), C (mixer-master), D (sampler-audio) y E (editores-clips)
> ANTES de tocar cada spec. Cada sección fija una decisión, no una duda. Los
> specs/planes de cada frente DEBEN ajustarse a lo que aquí se decide.
>
> Todas las afirmaciones de código están verificadas contra el árbol real (no
> contra el informe). Referencias de línea válidas a fecha de este documento.

---

## 0. Resumen de decisiones (índice)

| # | Acoplamiento | Decisión |
|---|---|---|
| 1 | Causa raíz «▶ ausente» | El culpable es `onCellClick` (no `installClip`, que es código MUERTO). Helper único `placeClipEnsuringScene`. `installClip` se **ELIMINA**. |
| 2 | A ↔ D — inserción del clip de loop al Sampler | D inserta a través del MISMO `placeClipEnsuringScene` (vía un método público nuevo `installSamplerClip` en SessionHost). NO mecanismo paralelo, NO se resucita `installClip`. |
| 3 | E ↔ D — `clip-editor-router.ts` / `clip-waveform-header.ts` | **D ejecuta PRIMERO** (quita `onSliceToBank` del audio lane). E construye encima del estado resultante. Propietarios fijados por archivo. |
| 4 | A — `deleteScene` | **COMPACTA columnas** (splice de `scenes[idx]` + splice de `lane.clips[idx]` en todas las lanes). Decisión cerrada, no es duda de UX. |
| 5 | C ↔ Performance / `#volume` | `#volume` (fila de transporte) es el control de master que SOBREVIVE en Performance. El fader nuevo del master strip NO lo reemplaza; se SINCRONIZA con él. C no propone eliminar `#volume`. |

---

## 1. BUG «▶ ausente» — causa real y FIX único

### Diagnóstico verificado (corrige la premisa falsa del spec A)

`installClip` es **código muerto**:
- Declarado en `src/engines/engine-types.ts:76` (`installClip?: (clip) => void`).
- Implementado en `src/session/session-host.ts:999-1006`.
- **Ningún módulo lo invoca.** `grep installClip src/` devuelve exactamente esas
  dos líneas (la declaración y la implementación) — cero llamadas. Su antiguo
  llamador desapareció con el refactor "audio-channel direction"
  (`clip-editor-loop.ts` borrado). Por tanto, añadirle `ensureScenesForRows`
  (lo que proponen spec A §«Fix del bug ▶ ausente» y plan A Tarea 14a) parchea
  una función que NO se ejecuta y NO puede arreglar el síntoma.

El **camino real** que coloca un clip sin garantizar su scene es
`onCellClick` (`session-host.ts:658-673`):

```
onCellClick(laneId, clipIdx) {
  ...
  while (lane.clips.length <= clipIdx) lane.clips.push(null);
  lane.clips[clipIdx] = clip;          // ← coloca el clip
  // NO llama a ensureScenesForRows  ← AQUÍ está el bug
  ...
}
```

El grid solo pinta el botón ▶ de scene-launch para filas con `state.scenes[r]`
(`session-ui.ts`). Una lane con más clips que scenes deja el clip presente pero
la fila sin ▶.

Comparativa de los caminos de colocación de clip (verificado):

| Camino | Ubicación | ¿Llama hoy a `ensureScenesForRows`? |
|---|---|---|
| `onCellClick` | session-host.ts:658-673 | **NO** ← bug |
| `onCellDropAudio` | session-host.ts:674-705 (l.695) | SÍ |
| `onSliceToBank` | session-host.ts:197-258 (l.251) | SÍ |
| `onAddLane` (relleno) | session-host.ts:736-762 (l.758) | SÍ |
| `addNoteLane` | session-host.ts:523-550 | **NO** (latente: hoy se llama tras stems con scenes ya creadas) |
| `installClip` | session-host.ts:999-1006 | **NO** — pero es código MUERTO |

### FIX FIJADO — helper único `placeClipEnsuringScene`

Crear un helper privado en `SessionHost` que centralice "colocar un clip y
garantizar su scene":

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

**Caminos que DEBEN pasar por `placeClipEnsuringScene`:**

1. `onCellClick` — **OBLIGATORIO** (es el bug real). Migrar el cuerpo de `run()`
   a `this.placeClipEnsuringScene(laneId, clipIdx, clip)` + (selección/inspector +
   renderWithMixer fuera del helper).
2. `onCellDropAudio` — migrar (hoy hace el `while push null` + `ensureScenesForRows`
   a mano; el helper lo unifica).
3. `addNoteLane` — la colocación del `clip` de fila 0 debe garantizar scene
   (corrige la contradicción T14a/T14b del plan A: el objetivo de "defensa en
   profundidad" exige que TODO camino de creación garantice scene). Como crea
   una lane nueva y rellena varias filas, basta con que tras el `push` de la lane
   llame a `ensureScenesForRows(this.state)` (ya lo hace `onAddLane`; `addNoteLane`
   hoy NO — añadirlo).
4. `installSamplerClip` (nuevo, ver §2) — el punto de entrada de D.

`onSliceToBank` ya crea una lane completa y llama a `ensureScenesForRows`;
NO necesita migrar su colocación de lane, pero si en el futuro coloca un clip
suelto debe usar el helper.

### Destino de `installClip`: **ELIMINAR**

- Borrar la implementación `session-host.ts:999-1006`.
- Borrar la declaración `engine-types.ts:76` (`installClip?`).
- Borrar el comentario asociado (`// Place a built clip (sampler loop import)…`).

Justificación: es un hook huérfano sin llamador; mantenerlo "por si acaso"
perpetúa la confusión que originó la causa raíz falsa del spec A. El frente D
NO lo resucita (ver §2). Cualquier mención a `installClip` en spec/plan A y D
debe sustituirse por `placeClipEnsuringScene` / `installSamplerClip`.

> Esto resuelve A1, A3, D1, D5, D6 del informe de un solo golpe.

---

## 2. A ↔ D — inserción del clip de loop al Sampler

### Decisión

El frente D inserta su clip de notas de loop **a través del mismo
`placeClipEnsuringScene`** definido en §1. NO crea un mecanismo paralelo
(`importLoopToSampler` con su propia inserción) y NO resucita `installClip`.

### Contrato exacto

SessionHost expone un método público nuevo que D invoca:

```ts
/** Punto de entrada del frente D: coloca el clip de loop (notas + waveformRef)
 *  recién construido sobre la lane Sampler indicada, garantiza su scene, lo
 *  envuelve en undo y abre el piano-roll. Reemplaza al difunto installClip. */
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

Diferencias respecto al difunto `installClip` (que sólo hacía `lane.clips[idx]=clip`
+ `renderWithMixer`): `installSamplerClip` **(a)** garantiza scene
(`ensureScenesForRows` vía el helper), **(b)** envuelve en `withUndo`, y
**(c)** abre el inspector/piano-roll. Son exactamente las tres carencias que el
informe señala (D1).

### Qué cambia en el plan D

- Tarea 10/13 del plan D: el clip de loop NO se coloca por "emitir un evento" ni
  por un camino propio; la función Sampler-side construye el `SessionClip` y llama
  a `host.installSamplerClip(laneId, clip)`. La construcción del clip (notas +
  `waveformRef`) es de D; la COLOCACIÓN es del seam único.
- El frente D debe asumir que el flujo Sampler-side **se construye** (no se
  "reorienta"): hoy `sampler.ts:469-508` sólo tiene `addSampleToKeymap`; no hay
  `buildSliceClip`/`slicesToKeymap` en el lado Sampler. (Corrige D5.)
- `onSliceToBank` (audio-lane → lane nueva) NO es el flujo Sampler-side; su
  reescritura (firma `clipIdx`→`file|buf`, eliminación de creación de lane) es un
  refactor sustancial, no un rename (corrige D7). Si D mantiene un import de loop
  desde dentro de la lane Sampler actual, ese es un camino NUEVO que termina en
  `installSamplerClip`.

### Orden A ↔ D

`placeClipEnsuringScene` e `installSamplerClip` son propiedad del **frente A**
(viven en `session-host.ts` y son su unificación de inserción). Por tanto:

1. **A introduce primero** `placeClipEnsuringScene` + `installSamplerClip` y
   elimina `installClip`.
2. **D consume** `installSamplerClip` (no lo redefine). Si D se ejecuta antes que
   A por razones de planificación, D debe crear `installSamplerClip` con la firma
   de arriba y A lo adopta sin reescribirlo.

> Resuelve D1, D5, D6 y la mitad de D7.

---

## 3. E ↔ D — `clip-editor-router.ts` y `clip-waveform-header.ts`

Ambos frentes tocan estos dos archivos. Hay que fijar orden y propietario porque
los cambios son incompatibles si se solapan.

### Cambios de cada frente (verificados contra el código)

**Frente D** (quita el slicing del audio lane):
- `clip-editor-router.ts`: elimina `onSliceToBank?` de `ClipEditorDeps`
  (l.31) y de la llamada a `renderAudioClipEditor` (l.82-85).
- `clip-waveform-header.ts`: elimina el botón `.audio-clip-slice` y su handler
  de `renderAudioClipEditor` (l.132-138), y el campo `onSliceToBank?` de
  `AudioClipEditorDeps` (l.104).
- Tests: `clip-waveform-header.test.ts` (l.26-36) afirma HOY que el botón
  `.audio-clip-slice` existe y llama a `onSliceToBank`; y `tests/e2e/audio-channel.spec.ts`
  (l.65-78) ejercita "Slice → pads". **Ambos son de D**: D debe reescribirlos/
  eliminarlos (no "crearlos si no existen", como dice por error el plan D Tarea 9).
  (Corrige D3.)

**Frente E** (reorganiza el inspector / cabecera honesta):
- `clip-waveform-header.ts`: limpia la cabecera del clip de AUDIO (quitar BPM/bars
  duplicados que también muestra el inspector).
- `clip-editor-router.ts`: ajustes del toggle de vista / routing honesto.

### ORDEN FIJADO: **D primero, E después**

Razón: D ELIMINA superficie (el botón Slice, el campo `onSliceToBank`, los tests
que lo cubren). E REORGANIZA lo que queda. Si E va primero y deja placeholders
sobre `onSliceToBank`, D los borra después → retrabajo y conflicto garantizado.
Ejecutando D primero, E construye sobre la cabecera de audio ya despojada del
slicing, sin tocar nada que D vaya a borrar.

### Propietario por cambio (sin solapamiento de líneas)

| Archivo | Cambio | Propietario |
|---|---|---|
| `clip-editor-router.ts` | quitar `onSliceToBank?` de `ClipEditorDeps` y de la llamada a `renderAudioClipEditor` | **D** |
| `clip-editor-router.ts` | toggle de vista honesto / routing | **E** |
| `clip-waveform-header.ts` | quitar botón `.audio-clip-slice` + `AudioClipEditorDeps.onSliceToBank` | **D** |
| `clip-waveform-header.ts` | limpiar BPM/bars de la cabecera de audio (no duplicar inspector) | **E** |
| `clip-waveform-header.test.ts` | reescribir: ya NO hay botón Slice | **D** |
| `tests/e2e/audio-channel.spec.ts` | reescribir/eliminar: el flujo Slice→pads del audio lane desaparece | **D** |

Regla de oro: E **no toca** `onSliceToBank` ni el botón Slice (es de D y habrá
desaparecido). D **no toca** la presentación de BPM/bars de la cabecera (es de E).
Tras D, E reescribe `renderAudioClipEditor` SOBRE la versión sin slicing.

> Resuelve E2 y la parte de inventario de tests de D3.

---

## 4. `deleteScene` — COMPACTA columnas (decisión cerrada)

### Decisión

`deleteScene(idx)` borra la scene Y la columna de clips de esa fila en TODAS las
lanes, compactando. NO es una preferencia de UX: el lanzamiento de scene es
**posicional**.

Verificado en `session-runtime.ts:90-108` (`launchScene`):

```
const idx = hasExplicit ? scene.clipPerLane[lane.id] : sceneIdx;   // l.103
```

`clipPerLane` está casi siempre vacío (`emptyScene → clipPerLane:{}`), así que el
lanzamiento cae al índice de fila. Si `deleteScene` hiciera solo
`scenes.splice(idx,1)` sin compactar las columnas, toda scene con índice > idx se
desplaza una posición hacia abajo pero sus clips NO → cada scene superviviente
queda emparejada con los clips de OTRA fila y reproduce clips equivocados. Eso es
corrupción funcional silenciosa, no cosmética.

### Implementación FIJADA

```ts
deleteScene(idx) {
  // 1) detener lo que suene/encolado en esa fila (simetría con stopLane)
  // 2) compactar: scene + columna idx de cada lane
  this.state.scenes.splice(idx, 1);
  for (const lane of this.state.lanes) {
    if (idx < lane.clips.length) lane.clips.splice(idx, 1);
  }
  // 3) reindexar clipPerLane explícitos > idx (decrementar) y borrar los == idx
  for (const scene of this.state.scenes) {
    for (const [laneId, row] of Object.entries(scene.clipPerLane)) {
      if (row == null) continue;
      if (row === idx) delete scene.clipPerLane[laneId];
      else if (row > idx) scene.clipPerLane[laneId] = row - 1;
    }
  }
  this.renderWithMixer();
}
```

Notas para el plan A:
- El paso 3 (reindexar `clipPerLane`) es necesario porque hay mapeos explícitos
  reales (`addNoteLane` l.546, stems, MIDI import) que apuntan a filas concretas;
  sin reindexar quedarían desfasados tras el splice.
- `sceneHasContent` (predicado de confirmación de borrado) debe considerar
  TAMBIÉN los mapeos `clipPerLane` explícitos que apunten a esa fila, no solo
  `lane.clips[sceneIdx] != null` — si no, una scene cuyo único contenido lanzable
  viene de un `clipPerLane` explícito se borraría sin diálogo (corrige el hallazgo
  "sceneHasContent ignora clipPerLane").

### `onDeleteLane` — parar antes de `dispose()`

Simetría con `onDeleteScene`: antes de `laneStates.delete(laneId)` +
`laneResources.dispose(laneId)`, llamar a `stopLane(this.laneStates, laneId, …)`
para cortar voces/loops en vuelo (evita el análogo del bug "New no libera synths").

### Siembra mínima de scene

Tras quitar el relleno automático de clips en `onAddLane`/`addNoteLane`, si TODAS
las lanes nacen con `clips:[]`, `ensureScenesForRows` calcula `maxClipRows = 0` →
0 scenes → grid sin ningún ▶ de scene-launch. **Decisión:** sembrar siempre al
menos 1 scene en una sesión nueva (o hacer que `ensureScenesForRows` garantice un
mínimo de 1 cuando hay ≥1 lane). El spec A debe contemplarlo explícitamente.

> Resuelve A2, A5, A6 y el matiz de `sceneHasContent`.

---

## 5. C ↔ Performance / `#volume`

### Hechos verificados

- `#volume` (slider de master) vive en la **fila de transporte global**
  (`index.html:107`), FUERA de `#session-view-root` (l.144).
- El master strip nuevo del frente C va dentro de `.session-view`
  (`index.html:315`), que está dentro de `#session-view-root`.
- En modo Performance, `performance-feature.ts:191` hace
  `sessionRoot.hidden = next !== 'session'` → TODO `.session-view` (incluido el
  master strip + su VU + el botón FX) se oculta. El único control de master que
  sobrevive en Performance es `#volume`.

### Decisión (para que el spec C la contemple)

1. **NO eliminar `#volume`.** Es el control de master del modo Performance. La
   "duda D2" del spec C (¿coexisten o se consolidan?) se resuelve a favor de
   **coexistencia**: el fader del master strip y `#volume` conviven y se
   sincronizan; eliminar `#volume` dejaría Performance sin control de volumen
   master ninguno.

2. **El fader del master strip debe escribir `volInput.value` (`#volume`), no
   solo `master.gain.value`.** Motivo de corrección (no estético): el snapshot de
   guardado/undo lee `volInput.value` (`saved-state-v3.ts:73`) y lo restaura en
   `master.gain.value` + `volInput.value` (l.97). El master volume YA se persiste
   y YA es undo-able (corrige la premisa falsa C1 del spec C: NO hay que "promover
   `master.gain` al modelo"; ya está). Si el fader escribiera solo `master.gain`
   sin tocar `volInput`, al guardar se persistiría el valor viejo y el undo no
   revertiría el fader. Por tanto `MasterStripDeps` debe recibir el `volInput`
   (o el fader y `#volume` deben compartir el mismo handler de escritura),
   manteniendo ambos sincronizados en cada cambio.

3. **Rangos:** `#volume` es `min=0 max=1` (`index.html:107`); los faders del mixer
   van 0..1.5. La sincronía debe acotar/escalar: un gain>1 puesto en el fader no
   es representable en `#volume` (slider llega a 1). El spec C debe decidir el
   mapeo (recomendación: clamp del valor reflejado a `#volume` a [0,1], o ampliar
   `#volume` a `max=1.5`). Lo señalamos como restricción a resolver dentro de C,
   no como bloqueo transversal.

4. **VU del master en Performance:** al ocultarse `.session-view`, el VU del
   master desaparece en Performance. Es una limitación aceptada (no se duplica el
   VU en la fila de transporte en este alcance); el spec C debe documentarla.

> Resuelve C4 y conecta C1/C2 con la realidad de persistencia.

---

## 6. Orden global de ejecución entre frentes

1. **Frente A primero**: introduce `placeClipEnsuringScene` + `installSamplerClip`,
   elimina `installClip`, arregla `onCellClick`/`addNoteLane`, implementa
   `deleteScene` compactante + `onDeleteLane` con stop + siembra mínima de scene.
   (Es el cimiento del que dependen D y la estabilidad del grid.)
2. **Frente C**: master strip sincronizado con `#volume`, sin eliminar `#volume`,
   fader escribiendo `volInput.value`. Independiente de A/D salvo por no tocar la
   fila de transporte donde vive `#volume`.
3. **Frente D**: construye el flujo Sampler-side, inserta vía
   `installSamplerClip`, quita el slicing del audio lane y reescribe SUS tests
   (`clip-waveform-header.test.ts`, `tests/e2e/audio-channel.spec.ts`).
4. **Frente E**: último sobre `clip-editor-router.ts`/`clip-waveform-header.ts`,
   ya despojados del slicing por D; reorganiza inspector/cabecera y el toggle
   honesto.

Patrón a vigilar (recurrente en los cuatro frentes): **verificar cada premisa de
código antes de escribir el fix** (la causa raíz falsa de A, la persistencia
"inexistente" de C, el seam "huérfano" de D, el "Copy solo notas" de E eran todas
afirmaciones desmentidas por el árbol real).
