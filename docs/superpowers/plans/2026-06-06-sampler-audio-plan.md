# Frente D · Sampler & audio — Plan de implementación

**Fecha:** 2026-06-06
**Spec de origen:** [2026-06-06-sampler-audio-design.md](../specs/2026-06-06-sampler-audio-design.md)
**Estilo:** TDD donde aplique (test rojo → implementar → verde). Tareas pequeñas, ordenadas de **menor a mayor riesgo**.

---

## Cómo leer este plan

- Cada tarea lleva: **título**, **archivos a tocar**, **qué hacer**, **cómo verificar**.
- "Verde" = el comando de verificación pasa. Usa siempre `NO_COLOR=1 npx vitest run <file>` para un solo archivo, o los scripts npm (`test:unit`, `build`).
- **Antes de cada tarea afectada por una DUDA ABIERTA hay un bloque `⛔ CONFIRMAR CON EL USUARIO`.** No se resuelve aquí; hay que parar y preguntar.
- Trabajamos en el worktree `loom-ux-overhaul` (ya activo). Commits frecuentes + `git rebase main` casi por commit.
- Recordatorio de e2e: `npm run test:e2e` sirve `dist/` **sin** build. Ejecuta `npm run build` ANTES de cualquier tarea Playwright.

---

## Mapa de seams ya verificados (referencia rápida)

Confirmado leyendo el código en el worktree:

- **Patrón a imitar (carga bundled self-healing):** [drumkit-loader.ts](../../../src/samples/drumkit-loader.ts) — `listDrumkits` (try/catch → `[]`), `fetchDrumkitManifest` (lanza), `loadDrumkit` (fetch+decode+`store.put`+`cache.put`, ids frescos vía `newSampleId`), `LoadDeps` (seams `store`/`cache`/`fetchFn`/`now`). Su test [drumkit-loader.test.ts](../../../src/samples/drumkit-loader.test.ts) es el molde exacto.
- **Slicing reutilizable (sin tocar firmas):** `sliceBuffer(ctx, buf, slicePointsSec)` [slice-buffer.ts:20](../../../src/samples/slice-buffer.ts); `slicesToKeymap(sliceIds, base=SLICE_BASE_NOTE)` [slice-to-bank.ts:12](../../../src/samples/slice-to-bank.ts); `buildSliceClip({slicePointsSec,durationSec,originalBpm,projectMeter,gridResolution})` [slice-clip.ts:28](../../../src/core/slice-clip.ts) con `SLICE_BASE_NOTE = 36`; `detectLoop(buffer, meter)` [loop-analysis.ts:85](../../../src/samples/loop-analysis.ts) → `{ slicePointsSec, originalBpm, ... }`.
- **Determinismo nota↔slice:** `buildSliceClip` re-ancla onsets a `[0, ...slicePointsSec]` ordenado/dedup ([slice-clip.ts:39-49](../../../src/core/slice-clip.ts)); `slicesToKeymap` asigna `SLICE_BASE_NOTE + i` consecutivo. Mismo `slicePointsSec` ⇒ mismo orden ⇒ nota[i].midi === 36 + i.
- **Resolución de keymap multi-zona:** `keymapEntryFor` es "last match wins" ([keymap.ts:9-15](../../../src/samples/keymap.ts)) → las zonas melódicas con `loNote..hiNote` funcionan sin cambios.
- **Mirror de sub-state sampler (spread obligatorio):** [session-engine-state.ts](../../../src/session/session-engine-state.ts) `mirrorKeymapChange`/`mirrorDrumkitId`/`mirrorPadParams` SIEMPRE hacen `{ ...lane.engineState.sampler, ... }` para no pisar hermanos.
- **Load path:** `applyLaneEngineState` ([apply-lane-engine-state.ts:53-61](../../../src/export/apply-lane-engine-state.ts)) trata `drumkitId` → `reloadDrumkit` (async ⇒ await; sync ⇒ fire-and-forget) ANTES de `setPadStore`. `reloadDrumkit` real vive en `SessionHost` ([session-host.ts:406-419](../../../src/session/session-host.ts)) e inyectado en `applyEngineState` ([session-host.ts:389-400](../../../src/session/session-host.ts)).
- **Slicing del audio lane a retirar:** botón `sliceBtn` `✂ Slice → pads` (`.audio-clip-slice`) en `renderAudioClipEditor` ([clip-waveform-header.ts:132-138](../../../src/session/clip-editors/clip-waveform-header.ts)); `onSliceToBank` en `AudioClipEditorDeps` [103-106], en `ClipEditorDeps` ([clip-editor-router.ts:31](../../../src/session/clip-editors/clip-editor-router.ts)) y pasado en [82-85]; cableado desde el inspector ([session-inspector.ts:217-219](../../../src/session/session-inspector.ts)) → `SessionHost.onSliceToBank` ([session-host.ts:197-258](../../../src/session/session-host.ts)).
- **Migración (riesgo controlado):** `migrateClip` "modern clip" hace passthrough del objeto entero (incluye `sample`/`waveformRef`) ([session-migration.ts:38-40](../../../src/session/session-migration.ts)); el branch legacy [60-64] NO copia esos campos, pero los clips legacy nunca los tienen. Confirmado.
- **Stems:** `onAddStemLanes` ([session-host.ts:770-838](../../../src/session/session-host.ts)) ya crea lanes `sampler` con 1 zona melódica (`rootNote:60, loNote:0, hiNote:127`) → encajan en la familia melódica sin cambios.

---

## DUDAS ABIERTAS del spec (NO resolver — parar y preguntar antes de la tarea afectada)

| # | Duda | Tarea(s) afectada(s) |
|---|------|----------------------|
| **(a)** | `loop` / `loopStart` per-pad ([sampler-pad-params.ts:43-44](../../../src/engines/sampler-pad-params.ts)): ¿se mantienen o se retiran? | **Tarea 12** (rack de zona melódica). Por defecto NO se tocan; solo si el usuario decide retirarlos. |
| **(b)** | Destino del resto de la barra de `renderAudioClipEditor` (BPM/bar/♺ Warp) tras quitar `✂ Slice`. Decisión transversal con el Frente E. | **Tarea 9** (revert audio lane). Esta tarea SOLO quita el slicing; NO rediseña la barra. |
| **(c)** | Edición del audio lane (trim/warp): ¿se expone UI ahora o display-only? | Fuera del alcance de este plan salvo que el usuario lo pida; **no** hay tarea de UI de trim aquí. |
| **(d)** | Waveform del loop = solo display detrás del piano-roll (sin reslice/drag). | **Tarea 13** (importar loop al Sampler). Se asume display-only. |

Las dudas **no bloquean** las tareas previas (loader, mirror, load path, revert del slicing). Solo bloquean la UI de zona (a) y el rediseño de la barra (b).

---

## Fase 0 — Andamiaje de tipos (riesgo mínimo, sin lógica)

### Tarea 1 · Ampliar `engineState.sampler` con `instrumentId?`

- **Archivos:** [src/session/session.ts](../../../src/session/session.ts) (línea ~78).
- **Qué hacer:** en `SessionLane.engineState.sampler`, añadir `instrumentId?: string` junto a `drumkitId?`. Campo aditivo/opcional → **sin** bump de `schemaVersion` (igual que `drumkitId`/`padParams`). Documentar en comentario que es el espejo de `drumkitId` para presets bundled melódicos/loop.
- **Cómo verificar:** `npx tsc --noEmit` verde (no debe romper nada; solo amplía un tipo opcional).

### Tarea 2 · `mirrorInstrumentId` + `readLaneInstrumentId` (TDD)

- **Archivos:** [src/session/session-engine-state.ts](../../../src/session/session-engine-state.ts), `src/session/session-engine-state.test.ts` (crear si no existe).
- **Test rojo primero:**
  - `mirrorInstrumentId(state, laneId, 'sweep-pad')` escribe `engineState.sampler.instrumentId` y **preserva** un `keymap`/`drumkitId`/`padParams` preexistente (mismo riesgo de spread que `mirrorDrumkitId`).
  - `mirrorInstrumentId(state, laneId, undefined)` borra el id (`|| undefined`), sin pisar keymap.
  - `readLaneInstrumentId` devuelve el id o `undefined`.
  - No-op si la lane es desconocida.
- **Implementar:** copiar `mirrorDrumkitId`/`readLaneDrumkitId` (líneas 78-93) sustituyendo `drumkitId` por `instrumentId`, manteniendo el spread `{ ...lane.engineState.sampler, keymap, instrumentId: id || undefined }`.
- **Cómo verificar:** `NO_COLOR=1 npx vitest run src/session/session-engine-state.test.ts` verde.

---

## Fase 1 — Loader de instrumentos (pura + impura testeable, sin UI)

### Tarea 3 · Tipos + helpers PUROS del loader (TDD)

- **Archivos:** `src/samples/instrument-loader.ts` (nuevo), `src/samples/instrument-loader.test.ts` (nuevo).
- **Qué hacer (solo lo PURO en esta tarea):**
  - Tipos: `InstrumentIndexEntry { id; name; family: 'melodic' | 'loop' }`, `MelodicInstrumentManifest`, `LoopInstrumentManifest` (exactamente como el §1 del spec; `padParams?: Record<number, Partial<PadParams>>` importando `PadParams` de [sampler-pad-params.ts](../../../src/engines/sampler-pad-params.ts)).
  - PURO `buildMelodicKeymap(zones, sampleIds): KeymapEntry[]` → una entrada por zona con `rootNote/loNote/hiNote` de la zona (+ `gain?`), `sampleId` alineado por índice; lanza si `zones.length !== sampleIds.length` (espejo de `buildDrumkitKeymap`).
- **Test rojo:**
  - `buildMelodicKeymap` con 2 zonas → 2 entradas, root/lo/hi correctos, ids alineados por orden, `gain` solo cuando está presente; lanza con mismatch de longitudes.
- **Cómo verificar:** `NO_COLOR=1 npx vitest run src/samples/instrument-loader.test.ts` verde.

### Tarea 4 · `listInstruments` / `fetchInstrumentManifest` (TDD, contrato igual a drumkits)

- **Archivos:** `src/samples/instrument-loader.ts`, `src/samples/instrument-loader.test.ts`.
- **Qué hacer:** `listInstruments(fetchFn = fetch)` lee `${BASE_URL}instruments/index.json`, try/catch → `[]` si falta/falla (igual que `listDrumkits`). `fetchInstrumentManifest(id, fetchFn = fetch)` lee `${BASE_URL}instruments/<id>.json`, **lanza** si no `ok`.
- **Test rojo:** lee el índice mockeado; lanza/`[]` según el caso (copia los tres tests de `listDrumkits`/`fetchDrumkitManifest`).
- **Cómo verificar:** vitest del archivo verde.

### Tarea 5 · `loadInstrument` melódico (TDD, impuro con deps inyectables)

- **Archivos:** `src/samples/instrument-loader.ts`, `src/samples/instrument-loader.test.ts`.
- **Qué hacer:** `LoadDeps` igual que el drumkit (`store`/`cache`/`fetchFn`/`now`). `loadInstrument(manifest, ctx, deps?)` para `family: 'melodic'`: por cada zona → fetch `${BASE_URL}instruments/<file>` → `decodeAudioData(bytes.slice(0))` → `newSampleId()` → `store.put(buildSampleAsset(...))` + `cache.put` → `buildMelodicKeymap(zones, ids)`. Devuelve `{ keymap: KeymapEntry[]; padParams?: Record<number, Partial<PadParams>> }` (el caller decide cómo aplicar `padParams`). Aún SIN rama loop (Tarea 6).
- **Test rojo:**
  - mock `fetchFn`/`store`/`cache`/`now` → devuelve keymap con tantas zonas como `zones`, root/lo/hi correctos; `store.put` y `cache.put` una vez por zona, ids alineados.
  - **Self-healing:** dos llamadas a `loadInstrument` dan `sampleId` **distintos** pero el **mismo** mapeo nota↔zona (mismos root/lo/hi).
- **Cómo verificar:** vitest del archivo verde.

### Tarea 6 · `loadInstrument` loop (TDD, determinismo nota↔slice)

- **Archivos:** `src/samples/instrument-loader.ts`, `src/samples/instrument-loader.test.ts`.
- **Qué hacer:** rama `family: 'loop'` de `loadInstrument`: fetch+decode del WAV único; `slicePointsSec = manifest.slicePointsSec` (o re-derivar con `detectLoop` si está vacío); `sliceBuffer(ctx, buf, slicePointsSec)` → por slice `audioBufferToWavBytes` + `store.put` + `cache.put` con ids frescos → `slicesToKeymap(sliceIds)`. Devolver además lo necesario para que el caller reconstruya el clip: `{ keymap, slicePointsSec, durationSec: buf.duration, originalBpm }` (el `buildSliceClip` + inserción del clip viven en `SessionHost`, Tarea 7/13 — el loader NO toca `SessionState`).
- **Test rojo (aserción clave de determinismo):**
  - Dado `slicePointsSec` de N cortes, el keymap resultante tiene N entradas mono-nota; `nota[i].midi === SLICE_BASE_NOTE + i` para todo `i` (consecutivas desde 36).
  - `buildSliceClip` sobre el mismo `slicePointsSec` produce N notas en el mismo orden (cruza loader↔slice-clip para fijar el contrato).
- **Cómo verificar:** vitest del archivo verde.

---

## Fase 2 — Load path self-healing (reconstrucción por id)

### Tarea 7 · `reloadInstrument` en SessionHost + cableado en `applyEngineState` (TDD donde aplique)

- **Archivos:** [src/session/session-host.ts](../../../src/session/session-host.ts), [src/export/apply-lane-engine-state.ts](../../../src/export/apply-lane-engine-state.ts), `src/export/apply-lane-engine-state.test.ts`.
- **Qué hacer:**
  1. **`apply-lane-engine-state.ts`:** ampliar `ApplyLaneEngineStateDeps` con `reloadInstrument(laneId, instrumentId, engine): void | Promise<void>`. Tras el bloque `drumkitId` (líneas 53-61), añadir el bloque simétrico `instrumentId`: si `es?.sampler?.instrumentId` y `engine.setKeymap`, llamar a `deps.reloadInstrument(...)`; `if (r && r.then) await r` (mismo patrón sync/await que el drumkit, para que offline decodifique antes de `setPadStore`).
  2. **`session-host.ts`:** `reloadInstrument(laneId, id, engine)` privado, espejo de `reloadDrumkit` (líneas 406-419): `fetchInstrumentManifest` → `loadInstrument(manifest, ctx)` → `engine.setKeymap(km)` + `mirrorKeymapChange` + (melódico) `setPadStore`/`mirrorPadParams` si trae `padParams`. **Loop:** la reconstrucción del clip/escena NO va aquí (se garantiza al guardar el clip real en `SessionState`, ver Tarea 13); aquí solo se regenera el **banco** (keymap de slices) y se re-apunta `waveformRef` si procede. Inyectarlo en `applyEngineState` (líneas 389-400): `reloadInstrument: (laneId, id, eng) => { void this.reloadInstrument(laneId, id, eng); }`.
- **Test rojo (ampliar `apply-lane-engine-state.test.ts`):**
  - una lane con `engineState.sampler.instrumentId` (melódico) llama a `reloadInstrument(laneId, id, eng)`; con `reloadInstrument` async, `applyLaneEngineState` lo **awaitea** (offline); con sync, fire-and-forget.
  - **Orden:** `setKeymap`/reload ANTES de `setPadStore` (añadir aserción de orden con `mock.invocationCallOrder` si hace falta). Actualizar los `fakeEngine`/llamadas existentes para pasar el nuevo dep (los tests actuales no lo pasan → fallarán a compilar hasta añadir un `reloadInstrument: vi.fn()`).
- **Cómo verificar:** `NO_COLOR=1 npx vitest run src/export/apply-lane-engine-state.test.ts` verde + `npx tsc --noEmit`.

### Tarea 8 · Migración: un clip con `sample`+`waveformRef`+`notes` sobrevive (TDD de regresión)

- **Archivos:** `src/session/session-migration.test.ts` (ampliar), [src/session/session-migration.ts](../../../src/session/session-migration.ts) (probablemente SIN cambios).
- **Qué hacer:** verificar (no cambiar de entrada) que `migrateLoadedSessionState` con un clip "modern" que lleva `sample` + `waveformRef` + `notes` NO pierde esos campos (el branch [38-40] hace passthrough del objeto). Si el test pasa en verde sin tocar `session-migration.ts`, dejarlo. Si por algún motivo el clip de loop cayera por el branch legacy, ajustar el passthrough — pero el spec ya confirma que no debería.
- **Cómo verificar:** `NO_COLOR=1 npx vitest run src/session/session-migration.test.ts` verde.

---

## Fase 3 — Revertir la dirección "audio-channel" (riesgo medio: toca UI compartida)

> ⛔ **CONFIRMAR CON EL USUARIO — Duda (b)** antes de empezar: esta tarea **solo** retira el botón `✂ Slice → pads` del audio lane. NO rediseña BPM/bar/♺ Warp (eso es Frente E, decisión transversal). Confirmar que dejamos la barra como está (display BPM/bar + Warp toggle) y solo quitamos el slicing.

### Tarea 9 · Quitar `✂ Slice → pads` del audio lane (TDD de regresión)

- **Archivos:** [src/session/clip-editors/clip-waveform-header.ts](../../../src/session/clip-editors/clip-waveform-header.ts), [src/session/clip-editors/clip-editor-router.ts](../../../src/session/clip-editors/clip-editor-router.ts), [src/session/session-inspector.ts](../../../src/session/session-inspector.ts), un test de render (`src/session/clip-editors/clip-waveform-header.test.ts`, crear si no existe; usar jsdom/DOM real disponible en Vitest).
- **Test rojo (regresión revert):** renderizar `renderAudioClipEditor(host, audioClip, meter, {})` y aseverar que `host.querySelector('.audio-clip-slice')` es `null` (el slicing ya no vive en el audio lane). Comprobar que `.audio-clip-bpm` / el toggle Warp **siguen** presentes (no rediseñamos la barra).
- **Implementar:**
  - `clip-waveform-header.ts`: eliminar `sliceBtn` (líneas 132-138) y el campo `onSliceToBank` de `AudioClipEditorDeps` (103-106). Mantener `mountWaveformHeader` y el resto de la barra.
  - `clip-editor-router.ts`: quitar `onSliceToBank?` de `ClipEditorDeps` (línea 31) y de la llamada a `renderAudioClipEditor` (82-85). `chooseClipEditor` SIN cambios (drumkit→drum-grid; melódico/loop→piano-roll).
  - `session-inspector.ts`: dejar de construir/pasar `onSliceToBank` (217-219) hacia `editorDeps`. (El campo `onSliceToBank` del propio `SessionInspector.deps` se mantiene SOLO si el host sigue cableándolo en Tarea 10; si tras la 10 nadie lo usa, eliminarlo también.)
- **Cómo verificar:** vitest del test de render verde + `npx tsc --noEmit` (los huecos de tipo de `onSliceToBank` deben quedar limpios).

### Tarea 10 · Reorientar `onSliceToBank` → `importLoopToSampler` (refactor de host)

- **Archivos:** [src/session/session-host.ts](../../../src/session/session-host.ts), [src/session/session-inspector.ts](../../../src/session/session-inspector.ts).
- **Qué hacer:** la lógica de `onSliceToBank` (líneas 197-258: slice + bank + keymap + `buildSliceClip` + `noteClip` + `ensureScenesForRows` + `withUndo`) NO se borra; se **renombra/reorienta** a `importLoopToSampler(laneId, buf|file)` que opera **sobre una lane Sampler** (no crea una lane nueva desde un audio lane). Esta tarea solo hace el **rename + ajuste de firma** y quita el cableado del inspector (`onSliceToBank` del editor de audio ya no existe). El nuevo flujo de UI que la dispara llega en la Tarea 13.
- **Detalle:** mantener `withUndo(hd, run)` envolviendo toda creación de lane/clip/escena (igual que hoy). Borrar `onSliceToBank` de `SessionInspector.deps`/constructor si ya nadie lo pasa.
- **Cómo verificar:** `npx tsc --noEmit` verde + `npm run test:unit` verde (ningún test de host debe romper; si algún test referenciaba `onSliceToBank`, actualizarlo al nuevo nombre).

---

## Fase 4 — UI del inspector del Sampler (riesgo alto: render + listeners)

### Tarea 11 · Importación por **selección múltiple** + quitar dropzone

- **Archivos:** [src/engines/sampler.ts](../../../src/engines/sampler.ts) (`buildParamUI`, bloque 469-508).
- **Qué hacer:** sustituir `<input type="file">` + `div.sampler-dropzone` (+ sus listeners `dragover/dragleave/drop`) por:
  - `<input type="file" multiple accept="audio/*">` + botón "Importar muestras…".
  - Handler que itera `files`: por cada uno `importFile` → `sampleStore.put` → `decodeAudioData(asset.bytes.slice(0))` → `sampleCache.put` → `addSampleToKeymap(km, asset.id, { rootNote })`. Heurística sencilla de root note por nombre (ej. detectar `C3`/`A4`/MIDI en el nombre; si no, default C3=60 como [keymap-edit.ts:13](../../../src/samples/keymap-edit.ts)). Tras procesar todos: `setKeymap` + `mirrorKeymapChange` + `rebuild()`.
  - Eliminar la `div.sampler-dropzone` y sus 3 listeners.
- **Cómo verificar:** `npx tsc --noEmit` verde. (La verificación funcional va en la Tarea 16 Playwright; aquí basta typecheck + build.)

> ⛔ **CONFIRMAR CON EL USUARIO — Duda (a)** antes de la Tarea 12: ¿se mantienen `loop`/`loopStart` per-pad en el rack de zona melódica, o se retiran? Por defecto **se mantienen** (no tocar `PAD_LEAF_SPECS`). Solo si el usuario decide retirarlos, esta tarea quita esas 2 leaves del rack/persistencia.

### Tarea 12 · Cabecera de **3 familias** en `buildParamUI`

- **Archivos:** [src/engines/sampler.ts](../../../src/engines/sampler.ts) (`buildParamUI`, bloque 352-570).
- **Qué hacer:** reemplazar el `Drumkit ▾` actual (404-467) por un selector agrupado por familia. El selector vive en `buildParamUI` leyendo `instrument-loader` (NO en `engine.presets`, que sigue `[]` por `validatePresetEntry` exigir `gm` — ver Riesgos). Tres familias:
  - **Melódico** (`family:'melodic'`): poblar desde `listInstruments()` filtrando `family==='melodic'`. Al elegir → `fetchInstrumentManifest` → `loadInstrument` → `setKeymap` + `setPadStore` (si `padParams`) + `mirrorInstrumentId` + `mirrorKeymapChange` + `mirrorPadParams`. Vista debajo: **teclado/keymap** (la lista de zonas con root + knobs per-zona que ya hace [sampler.ts:514-563], conservando `wireEngineParams` per-zona). Limpiar `drumkitId` (`mirrorDrumkitId(undefined)`) al pasar a melódico.
  - **Percusión** (`family:'drumkit'`): IDÉNTICO al actual — `listDrumkits` + `loadDrumkit` + `mirrorDrumkitId` + `mirrorKeymapChange` + `fireEditorReroute`. Vista: rack de pads (`renderDrumVoiceRack`, 364-369). Al pasar a drumkit, limpiar `instrumentId` (`mirrorInstrumentId(undefined)`).
  - **Loop** (`family:'loop'`): poblar `listInstruments()` filtrando `family==='loop'`. Al elegir → flujo de la Tarea 13 (`importLoopToSampler`/`reloadInstrument` + reconstrucción del clip). Vista: **solo el banco de slices** (keymap mono-nota informativo); rótulo "Las notas se editan en el piano-roll del clip". `fireEditorReroute`.
  - Al cambiar de familia, mantener mutuamente excluyentes `instrumentId` vs `drumkitId` (uno limpia al otro). `chooseClipEditor` ya enruta drumkit→drum-grid; melódico/loop→piano-roll **sin cambios** (líneas 43-53). Confirmado.
- **Cómo verificar:** `npx tsc --noEmit` verde + smoke manual en navegador (las 3 familias aparecen). Verificación e2e en Tarea 15.

### Tarea 13 · Importar/cargar **loop** al Sampler (clip de notas + escena + piano-roll)

- **Archivos:** [src/engines/sampler.ts](../../../src/engines/sampler.ts) (control "Importar loop…"), [src/session/session-host.ts](../../../src/session/session-host.ts) (`importLoopToSampler` de la Tarea 10).
- **Qué hacer:**
  - **Control "Importar loop…"** (un solo archivo) en `buildParamUI`, junto al selector de familia Loop. Al elegir un WAV → resume ctx → leer buffer → emitir un evento/llamar al host para que `importLoopToSampler(laneId, file|buf)` haga: `detectLoop` (o `slicePointsSec` del manifiesto) → `sliceBuffer` → `store.put×N` → `slicesToKeymap` → `setKeymap` (banco) → `buildSliceClip` → `noteClip` con `notes` + `waveformRef` empujado en `lane.clips[fila]` de **la propia lane Sampler** → `ensureScenesForRows` → seleccionar/abrir el piano-roll del clip → `mirrorInstrumentId` (para el self-heal del banco por id).
  - **Diferencia clave vs `onSliceToBank` original:** opera sobre la **lane Sampler actual** (no crea una lane nueva). El clip de notas + la entrada de escena se guardan en `this.state` (no efímeros) — así, tras `applyLoadedSessionState`, el clip ya existe y solo el **audio del banco** se regenera vía `instrumentId` (Tarea 7).
  - Re-apuntar `waveformRef.sampleId` al `sampleId` del loop entero para que el header de waveform detrás del piano-roll siga pintando.
  - Envolver todo en `withUndo(hd, run)`.
- **Cómo verificar:** `npx tsc --noEmit` verde + build. Verificación funcional en Tarea 16 (Playwright) y Tarea 14 (DSP).

---

## Fase 5 — DSP real (audible, determinismo end-to-end)

### Tarea 14 · `instrument-loop.dsp.test.ts` (render no silencioso, energía comparable)

- **Archivos:** `src/samples/instrument-loop.dsp.test.ts` (nuevo), fixtures en [test/fixtures/loops/drum/](../../../test/fixtures/loops/) (ya existen amen breaks).
- **Qué hacer (espejo de [loop-recompose.dsp.test.ts](../../../src/samples/loop-recompose.dsp.test.ts)):** cargar un fixture de loop → `detectLoop` → `sliceBuffer` → `slicesToKeymap` + `buildSliceClip` → reproducir el clip de notas reconstruido a través del Sampler en un `OfflineAudioContext` y comprobar, con **aserciones relativas**, que (a) el render NO es silencioso (RMS > 0) y (b) su energía RMS es **comparable** (ratio dentro de banda, p. ej. 0.5×–2×) a la del loop original reproducido entero. Reutilizar la batería/patrones del test de loop-recompose existente.
- **Cómo verificar:** `npm run test:dsp` verde (o `NO_COLOR=1 npx vitest run src/samples/instrument-loop.dsp.test.ts`). Recordar: serial por `node-web-audio-api`; teardown `ERR_IPC_CHANNEL_CLOSED` no es fallo (re-run para confirmar).

---

## Fase 6 — e2e (Playwright; `npm run build` ANTES, sirve `dist/` stale)

> Recordatorio: ejecutar `npm run build` antes de CADA tarea Playwright. Las 3 tareas pueden vivir en un solo spec e2e (`tests/e2e/sampler-audio.spec.ts`) con 4 `test(...)`.

### Tarea 15 · e2e — selector de 3 familias conmuta editor

- **Archivos:** `tests/e2e/sampler-audio.spec.ts` (nuevo).
- **Qué hacer:** abrir el inspector de una lane Sampler; comprobar que el selector ofrece las 3 familias; elegir **Percusión** → el editor del clip pasa a `drum-grid` (pads); volver a **Melódico** → vuelve a piano-roll/keymap.
- **Cómo verificar:** `npm run build` + `npm run test:e2e` (este spec) verde.

### Tarea 16 · e2e — importación multi-muestra + importar loop

- **Archivos:** `tests/e2e/sampler-audio.spec.ts`.
- **Qué hacer:**
  - **Multi-muestra:** subir 2 ficheros con `browser_file_upload` al `<input multiple>`; verificar que el keymap muestra 2 zonas.
  - **Loop:** cargar un loop; verificar (a) aparece un clip de notas en la lane, (b) existe una escena que lo lanza, (c) el editor abierto es el piano-roll con header de waveform (`.clip-waveform-header`), (d) NO hay editor de notas dentro del Sampler.
- **Cómo verificar:** `npm run build` + `npm run test:e2e` verde.

### Tarea 17 · e2e — audio lane = WAV puro (sin `✂ Slice`)

- **Archivos:** `tests/e2e/sampler-audio.spec.ts`.
- **Qué hacer:** añadir un audio channel (WAV); verificar que su editor **no** tiene el botón `✂ Slice → pads` (`.audio-clip-slice` ausente).
- **Cómo verificar:** `npm run build` + `npm run test:e2e` verde.

---

## Fase 7 — Contenido bundled mínimo (opcional para desbloquear e2e/smoke)

### Tarea 18 · 2-3 presets CC0 ligeros + manifiestos

- **Archivos:** `public/instruments/index.json` (nuevo), `public/instruments/<id>.json` + `public/instruments/<id>/*.wav` (nuevos).
- **Qué hacer:** arrancar con 2-3 entradas **CC0 ligeras** de [SOURCES.md](../../../public/instruments/SOURCES.md): p. ej. **Sweep Pad** (~5.6 MiB, FreePats CC0) y **Synth Bass** (FreePats GM39/40, CC0) como melódicos; opcionalmente un loop de [test/fixtures/loops/](../../../test/fixtures/loops/) recortado como preset `family:'loop'` con `slicePointsSec` fijado. Recortar/diezmar capas para web. `index.json` = `[{ id, name, family }]`.
- **Nota de alcance:** el acopio/empaquetado real masivo es tarea de contenido posterior (spec, "Qué NO entra"). Aquí solo los 2-3 mínimos para que el selector tenga algo que cargar en el smoke/e2e. Si el e2e usa muestras subidas por el usuario (Tarea 16), esta tarea puede ir DESPUÉS sin bloquear.
- **Cómo verificar:** `npm run build` (los assets se sirven), y el selector melódico lista las entradas en navegador.

---

## Fase 8 — Verificación final

### Tarea 19 · Suite completa + build + smoke en navegador

- **Qué hacer / cómo verificar (en orden):**
  1. `npx tsc --noEmit` verde.
  2. `npm run test:unit` verde (re-run si aparece el `ERR_IPC_CHANNEL_CLOSED` de teardown — no es fallo).
  3. `npm run build` verde (tsc + bundle).
  4. `npm run test:e2e` verde (tras el build del paso 3).
  5. **Smoke en navegador** (`npm run dev`, http://localhost:5173):
     - Sampler → seleccionar familia Melódico → cargar un preset bundled → suena al tocar el keymap.
     - Importar 2 muestras por el `<input multiple>` → aparecen 2 zonas.
     - Familia Loop → importar un loop → se crea clip de notas + escena → abrir piano-roll → editar una nota → **suena al Play**.
     - Audio lane (WAV puro) → su editor NO tiene `✂ Slice → pads`.
  6. `gitnexus_detect_changes()` (desde el repo principal, recordar que es worktree-blind) para confirmar el blast radius antes de mergear.
- **Finish flow:** `git rebase main` → `git merge --ff-only` → `ExitWorktree` (sin merge commit, como manda el global).

---

## Notas de implementación / riesgos (del spec)

- **Determinismo nota↔slice:** el manifiesto de loop **debe** fijar `slicePointsSec` (o re-derivar idéntico con `detectLoop`). Si el orden cambia entre crear el clip y recargarlo, las notas apuntan a slices equivocados. Equivalente al aviso de memoria "`detectLoop` es poco fiable sobre nuestros propios renders". → cubierto por el test de determinismo (Tarea 6) y el DSP (Tarea 14).
- **`validatePresetEntry` exige `gm`** ([preset-loader.ts:3-13](../../../src/presets/preset-loader.ts)): por eso los presets del Sampler NO van por `engine.presets`/`public/presets/sampler.json` sino por `instrument-loader` (modelo drumkit). NO rellenar `sampler.json` con el validador actual.
- **Self-healing:** solo los presets **bundled** (`instrumentId`/`drumkitId`) se reconstruyen por id. Los keymaps importados por el usuario siguen atados a IndexedDB del navegador (limitación preexistente; documentar en el manual, no resolver aquí).
- **`withUndo`:** toda creación de lane/clip/escena del flujo loop debe envolverse en `withUndo(hd, run)` (igual que `onSliceToBank`/`addAudioChannel` hoy).
- **Stems** (Tarea no requerida): sin cambios funcionales; ya crean lanes Sampler melódicas que encajan en la familia melódica.
