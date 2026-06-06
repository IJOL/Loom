# Frente D · Sampler & audio — Plan de implementación

**Fecha:** 2026-06-06
**Spec de origen:** [2026-06-06-sampler-audio-design.md](../specs/2026-06-06-sampler-audio-design.md)
**Coordinación transversal:** [2026-06-06-coordinacion-frentes.md](../specs/2026-06-06-coordinacion-frentes.md) (§1 helper único, §2 `installSamplerClip`, §3 orden E↔D, §6 orden global A→C→D→E).
**Estilo:** TDD donde aplique (test rojo → implementar → verde). Tareas pequeñas, ordenadas de **menor a mayor riesgo**.

---

## Cómo leer este plan

- Cada tarea lleva: **título**, **archivos a tocar**, **qué hacer**, **cómo verificar**.
- "Verde" = el comando de verificación pasa. Usa siempre `NO_COLOR=1 npx vitest run <file>` para un solo archivo, o los scripts npm (`test:unit`, `build`).
- **Antes de cada tarea afectada por una DUDA ABIERTA hay un bloque `⛔ CONFIRMAR CON EL USUARIO`.** No se resuelve aquí; hay que parar y preguntar.
- Trabajamos en el worktree `loom-ux-overhaul` (ya activo). Commits frecuentes + `git rebase main` casi por commit.
- Recordatorio de e2e: `npm run test:e2e` sirve `dist/` **sin** build. Ejecuta `npm run build` ANTES de cualquier tarea Playwright.

### Dependencia con el frente A (orden global §6)

`installSamplerClip` y `placeClipEnsuringScene` son **propiedad del frente A** (viven en `session-host.ts`, son su unificación de inserción de clips). El frente A se ejecuta ANTES que D y:
- introduce `placeClipEnsuringScene(laneId, clipIdx, clip)` + `installSamplerClip(laneId, clip): void`;
- **elimina** el seam muerto `installClip` (declaración `engine-types.ts:76` + impl `session-host.ts:999-1006`).

**Este plan asume que A ya hizo eso.** Si por planificación D se ejecuta antes que A, la **Tarea 7b** crea `installSamplerClip` con la firma del doc de coordinación §2 y A lo adopta sin reescribirlo. D **nunca** resucita `installClip` ni crea un camino de inserción paralelo.

---

## Mapa de seams ya verificados (referencia rápida)

Confirmado leyendo el código en el worktree:

- **Patrón a imitar (carga bundled self-healing):** [drumkit-loader.ts](../../../src/samples/drumkit-loader.ts) — `listDrumkits` (try/catch → `[]`), `fetchDrumkitManifest` (lanza si no `ok`), `loadDrumkit` (fetch+decode+`store.put`+`cache.put`, ids frescos vía `newSampleId`), `LoadDeps` (seams `store`/`cache`/`fetchFn`/`now`), `buildDrumkitKeymap` (PURO, lanza con mismatch de longitudes). Su test [drumkit-loader.test.ts](../../../src/samples/drumkit-loader.test.ts) es el molde exacto.
- **Slicing reutilizable (sin tocar firmas):** `sliceBuffer(ctx, buf, slicePointsSec)` [slice-buffer.ts:20](../../../src/samples/slice-buffer.ts); `slicesToKeymap(sliceIds, base=SLICE_BASE_NOTE)` [slice-to-bank.ts:12](../../../src/samples/slice-to-bank.ts); `buildSliceClip({slicePointsSec,durationSec,originalBpm,projectMeter,gridResolution})` [slice-clip.ts:28](../../../src/core/slice-clip.ts) con `SLICE_BASE_NOTE = 36`; `detectLoop(buffer, meter)` [loop-analysis.ts:85](../../../src/samples/loop-analysis.ts) → `{ slicePointsSec, originalBpm, ... }`.
- **Determinismo nota↔slice:** `buildSliceClip` re-ancla onsets a `[0, ...slicePointsSec]` ordenado/dedup ([slice-clip.ts:39-49](../../../src/core/slice-clip.ts)); `slicesToKeymap` asigna `SLICE_BASE_NOTE + i` consecutivo. Mismo `slicePointsSec` ⇒ mismo orden ⇒ `keymap[i].rootNote === 36 + i` y `notes[i].midi === 36 + i`.
- **Resolución de keymap multi-zona:** `keymapEntryFor` es "last match wins" ([keymap.ts:9-15](../../../src/samples/keymap.ts)) → las zonas melódicas con `loNote..hiNote` funcionan sin cambios; **pero** `addSampleToKeymap` fija SIEMPRE `loNote:0, hiNote:127` ([keymap-edit.ts:13-14](../../../src/samples/keymap-edit.ts)) → la importación multi apila full-range (solo suena la última). VERIFICADO.
- **Mirror de sub-state sampler (spread obligatorio):** [session-engine-state.ts](../../../src/session/session-engine-state.ts) `mirrorKeymapChange`/`mirrorDrumkitId`/`mirrorPadParams` SIEMPRE hacen `{ ...lane.engineState.sampler, ... }` para no pisar hermanos.
- **Tipos `padParams` (VERIFICADO):** persistido `Record<number, Record<string, number>>` ([session.ts:78](../../../src/session/session.ts)); `setPadStore(store: Record<number, Partial<PadParams>>)` ([sampler.ts:284](../../../src/engines/sampler.ts)); el load path lo invoca como `Record<number, Record<string, number>>` ([apply-lane-engine-state.ts:24,64](../../../src/export/apply-lane-engine-state.ts)); `mirrorPadParams` toma `Record<number, Record<string, number>>` y el caller hace cast ([sampler.ts:359](../../../src/engines/sampler.ts) `getPadStore() as Record<number, Record<string, number>>`). El manifiesto declara `Partial<PadParams>` → cast al persistir.
- **Load path:** `applyLaneEngineState` ([apply-lane-engine-state.ts:53-64](../../../src/export/apply-lane-engine-state.ts)) trata `drumkitId` → `reloadDrumkit` (async ⇒ await; sync ⇒ fire-and-forget) ANTES de `setPadStore`. `reloadDrumkit` real vive en `SessionHost` ([session-host.ts:406-419](../../../src/session/session-host.ts)) e inyectado en `applyEngineState` ([session-host.ts:389-400](../../../src/session/session-host.ts)).
- **`installClip` es código MUERTO (VERIFICADO):** declarado [engine-types.ts:74-76](../../../src/engines/engine-types.ts), impl [session-host.ts:999-1006](../../../src/session/session-host.ts) (solo coloca el clip + `renderWithMixer`; NO `ensureScenesForRows`, NO `withUndo`, NO abre piano-roll). **Cero llamadas en `src/`.** Lo elimina el frente A; D usa `installSamplerClip`.
- **Slicing del audio lane a retirar (D, primero):** botón `sliceBtn` `.audio-clip-slice` en `renderAudioClipEditor` ([clip-waveform-header.ts:132-138](../../../src/session/clip-editors/clip-waveform-header.ts)); `onSliceToBank` en `AudioClipEditorDeps` [103-106], en `ClipEditorDeps` ([clip-editor-router.ts:31](../../../src/session/clip-editors/clip-editor-router.ts)) y pasado en [82-85]; cableado desde el inspector ([session-inspector.ts:217-219](../../../src/session/session-inspector.ts)) → `SessionHost.onSliceToBank` ([session-host.ts:197-258](../../../src/session/session-host.ts)).
- **Tests que codifican el comportamiento revertido (VERIFICADO — D los reescribe):** [clip-waveform-header.test.ts:26-36](../../../src/session/clip-editors/clip-waveform-header.test.ts) (afirma que `.audio-clip-slice` existe, ya con `// @vitest-environment jsdom` en la línea 1); [tests/e2e/audio-channel.spec.ts:65-78](../../../tests/e2e/audio-channel.spec.ts) (tercer `test` "Slice → pads…").
- **Migración (riesgo controlado):** `migrateClip` "modern clip" hace passthrough del objeto entero (incluye `sample`/`waveformRef`/`notes`) ([session-migration.ts:38-40](../../../src/session/session-migration.ts)); el branch legacy NO copia esos campos, pero los clips legacy nunca los tienen. Confirmado.
- **Stems:** `onAddStemLanes` ([session-host.ts:770-838](../../../src/session/session-host.ts)) ya crea lanes `sampler` con 1 zona melódica → encajan en la familia melódica sin cambios.
- **`public/instruments/` (VERIFICADO):** contiene ÚNICAMENTE `SOURCES.md` (ni `index.json`, ni `<id>.json`, ni WAVs). `listInstruments` devolverá `[]` sin `index.json`. Los presets bundled mínimos (Fase 7) son **prerequisito** del e2e/smoke, no opcionales.

---

## DUDAS ABIERTAS del spec (NO resolver — parar y preguntar antes de la tarea afectada)

| # | Duda | Tarea(s) afectada(s) | Default |
|---|------|----------------------|---------|
| **(a)** | `loop`/`loopStart` per-pad ([sampler-pad-params.ts:43-44](../../../src/engines/sampler-pad-params.ts)): ¿se mantienen o se retiran? | **Tarea 12** (rack de zona melódica) | Se MANTIENEN (no tocar `PAD_LEAF_SPECS`) |
| **(b)** | Limpieza de la barra de `renderAudioClipEditor` (BPM/bar/♺ Warp). **Propiedad del Frente E** (coordinación §3). | **Tarea 9** (D SOLO quita el slicing; NO toca la barra) | D no decide; E sí |
| **(c)** | Edición del audio lane (trim/warp): ¿UI ahora o display-only? | Fuera del alcance de este plan salvo petición | display-only |
| **(d)** | Waveform del loop = solo display (sin reslice/drag). | **Tarea 13** | display-only |
| **(e)** | Reparto automático de rangos en importación multi-muestra. | **Tarea 11** | Apilar full-range (sin reparto automático) |

Las dudas **no bloquean** las tareas previas (loader, mirror, load path, revert del slicing). Solo bloquean la UI de zona (a), el rediseño de la barra (b, que además es de E) y el reparto de rangos (e).

---

## Fase 0 — Andamiaje de tipos (riesgo mínimo, sin lógica)

### Tarea 1 · Ampliar `engineState.sampler` con `instrumentId?`

- **Archivos:** [src/session/session.ts](../../../src/session/session.ts) (línea ~78).
- **Qué hacer:** en `SessionLane.engineState.sampler`, añadir `instrumentId?: string` junto a `drumkitId?`. Campo aditivo/opcional → **sin** bump de `schemaVersion`. Comentario: "espejo de `drumkitId` para presets bundled melódicos/loop; mutuamente excluyente con `drumkitId` (drumkit gana en el load path)".
- **Cómo verificar:** `npx tsc --noEmit` verde.

### Tarea 2 · `mirrorInstrumentId` + `readLaneInstrumentId` (TDD)

- **Archivos:** [src/session/session-engine-state.ts](../../../src/session/session-engine-state.ts), `src/session/session-engine-state.test.ts` (ampliar/crear).
- **Test rojo primero:**
  - `mirrorInstrumentId(state, laneId, 'sweep-pad')` escribe `engineState.sampler.instrumentId` y **preserva** un `keymap`/`drumkitId`/`padParams` preexistente (spread).
  - `mirrorInstrumentId(state, laneId, undefined)` borra el id (`|| undefined`), sin pisar keymap.
  - `readLaneInstrumentId` devuelve el id o `undefined`.
  - No-op si la lane es desconocida.
- **Implementar:** copiar `mirrorDrumkitId`/`readLaneDrumkitId` (78-93) sustituyendo `drumkitId` por `instrumentId`, manteniendo el spread `{ ...lane.engineState.sampler, keymap, instrumentId: id || undefined }`.
- **Cómo verificar:** `NO_COLOR=1 npx vitest run src/session/session-engine-state.test.ts` verde.

---

## Fase 1 — Loader de instrumentos (puro + impuro testeable, sin UI)

### Tarea 3 · Tipos + helper PURO del loader (TDD)

- **Archivos:** `src/samples/instrument-loader.ts` (nuevo), `src/samples/instrument-loader.test.ts` (nuevo).
- **Qué hacer (solo lo PURO):**
  - Tipos: `InstrumentIndexEntry { id; name; family: 'melodic' | 'loop' }`, `MelodicInstrumentManifest`, `LoopInstrumentManifest` (como §1 del spec; `padParams?: Record<number, Partial<PadParams>>` importando `PadParams` de [sampler-pad-params.ts](../../../src/engines/sampler-pad-params.ts)).
  - PURO `buildMelodicKeymap(zones, sampleIds): KeymapEntry[]` → una entrada por zona con `rootNote/loNote/hiNote` (+ `gain?`), `sampleId` alineado por índice; lanza si `zones.length !== sampleIds.length` (espejo de `buildDrumkitKeymap`).
- **Test rojo:** `buildMelodicKeymap` con 2 zonas → 2 entradas, root/lo/hi correctos, ids alineados por orden, `gain` solo cuando está presente; lanza con mismatch.
- **Cómo verificar:** `NO_COLOR=1 npx vitest run src/samples/instrument-loader.test.ts` verde.

### Tarea 4 · `listInstruments` / `fetchInstrumentManifest` (TDD, contrato igual a drumkits)

- **Archivos:** `src/samples/instrument-loader.ts`, `src/samples/instrument-loader.test.ts`.
- **Qué hacer:** `listInstruments(fetchFn = fetch)` lee `${BASE_URL}instruments/index.json`, try/catch → `[]` si falta/falla (igual que `listDrumkits`). `fetchInstrumentManifest(id, fetchFn = fetch)` lee `${BASE_URL}instruments/<id>.json`, **lanza** si no `ok`.
- **Test rojo:** lee el índice mockeado; lanza/`[]` según el caso (copia los tests de `listDrumkits`/`fetchDrumkitManifest`).
- **Cómo verificar:** vitest del archivo verde.

### Tarea 5 · `loadInstrument` melódico (TDD, impuro con deps inyectables)

- **Archivos:** `src/samples/instrument-loader.ts`, `src/samples/instrument-loader.test.ts`.
- **Qué hacer:** `LoadDeps` igual que el drumkit (`store`/`cache`/`fetchFn`/`now`). `loadInstrument(manifest, ctx, deps?)` para `family: 'melodic'`: por cada zona → fetch `${BASE_URL}instruments/<file>` → `decodeAudioData(bytes.slice(0))` → `newSampleId()` → `store.put(buildSampleAsset(...))` + `cache.put` → `buildMelodicKeymap(zones, ids)`. Devuelve `{ keymap: KeymapEntry[]; padParams?: Record<number, Partial<PadParams>> }`. Aún SIN rama loop.
- **Test rojo:**
  - mock `fetchFn`/`store`/`cache`/`now` → keymap con tantas zonas como `zones`, root/lo/hi correctos; `store.put` y `cache.put` una vez por zona, ids alineados.
  - **Self-healing:** dos llamadas dan `sampleId` distintos pero mismo mapeo nota↔zona.
- **Cómo verificar:** vitest del archivo verde.

### Tarea 6 · `loadInstrument` loop (TDD, determinismo nota↔slice)

- **Archivos:** `src/samples/instrument-loader.ts`, `src/samples/instrument-loader.test.ts`.
- **Qué hacer:** rama `family: 'loop'`: fetch+decode del WAV único; `slicePointsSec = manifest.slicePointsSec` (obligatorio en el manifiesto; re-derivar con `detectLoop` solo si está vacío); `sliceBuffer(ctx, buf, slicePointsSec)` → por slice `audioBufferToWavBytes` + `store.put` + `cache.put` con ids frescos → `slicesToKeymap(sliceIds)`. Devolver `{ keymap, slicePointsSec, durationSec: buf.duration, originalBpm }` (el `buildSliceClip` + inserción del clip viven en `SessionHost`; el loader NO toca `SessionState`).
- **Test rojo (determinismo):**
  - Dado `slicePointsSec` de N cortes, el keymap tiene N entradas mono-nota; `keymap[i].rootNote === SLICE_BASE_NOTE + i` para todo `i`.
  - `buildSliceClip` sobre el mismo `slicePointsSec` produce N notas en el mismo orden; `notes[i].midi === SLICE_BASE_NOTE + i` (cruza loader↔slice-clip para fijar el contrato).
- **Cómo verificar:** vitest del archivo verde.

---

## Fase 2 — Load path self-healing (reconstrucción por id) + exclusión mutua

### Tarea 7a · Bloque `instrumentId` en `applyLaneEngineState` con guarda de exclusión mutua (TDD)

- **Archivos:** [src/export/apply-lane-engine-state.ts](../../../src/export/apply-lane-engine-state.ts), `src/export/apply-lane-engine-state.test.ts`.
- **Qué hacer:**
  - Ampliar `ApplyLaneEngineStateDeps` con `reloadInstrument(laneId, instrumentId, engine): void | Promise<void>`.
  - Tras el bloque `drumkitId` [53-61], añadir el bloque **`else if`** (precedencia drumkit, D9): `const instrumentId = es?.sampler?.instrumentId; if (drumkitId) {…} else if (instrumentId && engine.setKeymap) { const r = deps.reloadInstrument(...); if (r && r.then) await r; }`. Misma semántica sync/await que el drumkit (offline decodifica antes de `setPadStore`).
- **Test rojo (ampliar `apply-lane-engine-state.test.ts`):**
  - lane con `instrumentId` melódico → llama `reloadInstrument`; async ⇒ awaitea (offline); sync ⇒ fire-and-forget.
  - **Orden:** `reloadInstrument` ANTES de `setPadStore` (`mock.invocationCallOrder`).
  - **Guarda D9:** lane con `drumkitId` Y `instrumentId` → llama `reloadDrumkit`, **NO** `reloadInstrument`.
  - Actualizar los `fakeEngine`/llamadas existentes con `reloadInstrument: vi.fn()` (compilará en rojo hasta añadirlo).
- **Cómo verificar:** `NO_COLOR=1 npx vitest run src/export/apply-lane-engine-state.test.ts` verde + `npx tsc --noEmit`.

### Tarea 7b · `reloadInstrument` en SessionHost + `installSamplerClip` (consumir el seam de A)

- **Archivos:** [src/session/session-host.ts](../../../src/session/session-host.ts).
- **Qué hacer:**
  1. `reloadInstrument(laneId, id, engine)` privado, espejo de `reloadDrumkit` [406-419]: `fetchInstrumentManifest` → `loadInstrument(manifest, ctx)` → `engine.setKeymap(km)` + `mirrorKeymapChange` + (melódico) `setPadStore`/`mirrorPadParams` si trae `padParams` (cast `as Record<number, Record<string, number>>`). **Loop bundled:** regenera el banco (keymap de slices) **y** fetch+decode+`store.put`+`cache.put` del WAV entero con id fresco, re-apuntando el `waveformRef.sampleId` del clip de loop de esa lane (corrige D8). El clip/escena NO se reconstruyen aquí (ya están en `SessionState`). Inyectarlo en `applyEngineState` [389-400]: `reloadInstrument: (laneId, id, eng) => { void this.reloadInstrument(laneId, id, eng); }`.
  2. **`installSamplerClip(laneId, clip)`** — punto de entrada único del flujo loop (firma del doc de coordinación §2). **Si el frente A ya lo creó, NO lo redefinas** (consúmelo). Si A aún no se ejecutó, créalo aquí con: buscar primer slot vacío de la lane → `placeClipEnsuringScene(laneId, idx, clip)` → `inspector.setSelectedClip` + `openInspector` (abre piano-roll) → `renderWithMixer`, todo dentro de `withUndo(hd, run)`. **No** dupliques la lógica de `placeClipEnsuringScene` (también de A); si no existe aún, créala mínima (`while push null` + `ensureScenesForRows`).
- **Cómo verificar:** `npx tsc --noEmit` verde + `npm run test:unit` verde.

### Tarea 8 · Migración: clip `sample`+`waveformRef`+`notes` sobrevive (TDD de regresión, cubre D10)

- **Archivos:** `src/session/session-migration.test.ts` (ampliar), [src/session/session-migration.ts](../../../src/session/session-migration.ts) (probablemente SIN cambios).
- **Qué hacer:** verificar que `migrateLoadedSessionState` con un clip "modern" (`sample` + `waveformRef` + `notes`) NO pierde esos campos (branch passthrough [38-40]). Esto cubre la **compatibilidad hacia atrás** de lanes `sampler` materializadas por el antiguo `onSliceToBank` (D10): cargan sin `instrumentId`, IndexedDB-only. Si el test pasa sin tocar `session-migration.ts`, dejarlo.
- **Cómo verificar:** `NO_COLOR=1 npx vitest run src/session/session-migration.test.ts` verde.

---

## Fase 3 — Revertir la dirección "audio-channel" (D ejecuta PRIMERO, coordinación §3)

> ⛔ **CONFIRMAR CON EL USUARIO — Duda (b)** antes de empezar: esta tarea **solo** retira el botón `✂ Slice → pads` y `onSliceToBank` del audio lane. **NO** rediseña BPM/bar/♺ Warp — eso es del Frente E (coordinación §3). Confirmar que dejamos la barra como está (display BPM/bar + Warp) y solo quitamos el slicing.

### Tarea 9 · Quitar `✂ Slice → pads` del audio lane + REESCRIBIR sus tests (TDD de regresión, corrige D3)

- **Archivos:** [clip-waveform-header.ts](../../../src/session/clip-editors/clip-waveform-header.ts), [clip-editor-router.ts](../../../src/session/clip-editors/clip-editor-router.ts), [session-inspector.ts](../../../src/session/session-inspector.ts), [clip-waveform-header.test.ts](../../../src/session/clip-editors/clip-waveform-header.test.ts) **(ya existe — REESCRIBIR, no crear)**, [tests/e2e/audio-channel.spec.ts](../../../tests/e2e/audio-channel.spec.ts) **(ya existe — editar)**.
- **Test rojo (reescritura de `clip-waveform-header.test.ts`):** el test actual [26-36] afirma que `.audio-clip-slice` existe y llama a `onSliceToBank`. Reescribirlo: renderizar `renderAudioClipEditor(host, audioClip, meter, {})` y aseverar `host.querySelector('.audio-clip-slice') === null`; comprobar que `.audio-clip-bpm` / el toggle Warp **siguen** presentes. (La directiva `// @vitest-environment jsdom` ya está en la línea 1; el `mountWaveformHeader` test se mantiene.)
- **Implementar:**
  - `clip-waveform-header.ts`: eliminar `sliceBtn` [132-138] y el campo `onSliceToBank` de `AudioClipEditorDeps` [103-106]. Mantener `mountWaveformHeader` y el resto de la barra. NO tocar la presentación BPM/bars (propiedad de E).
  - `clip-editor-router.ts`: quitar `onSliceToBank?` de `ClipEditorDeps` [31] y de la llamada a `renderAudioClipEditor` [82-85]. `chooseClipEditor` SIN cambios. NO tocar el toggle de vista (propiedad de E).
  - `session-inspector.ts`: dejar de construir/pasar `onSliceToBank` [217-219].
  - `tests/e2e/audio-channel.spec.ts`: **eliminar** el `test('Slice → pads adds a sampler lane…')` [65-78]; conservar los otros dos `test`.
- **Cómo verificar:** `NO_COLOR=1 npx vitest run src/session/clip-editors/clip-waveform-header.test.ts` verde + `npx tsc --noEmit` (los huecos de tipo de `onSliceToBank` deben quedar limpios).

### Tarea 10 · Eliminar `SessionHost.onSliceToBank` (no se reorienta — corrige D7)

- **Archivos:** [session-host.ts](../../../src/session/session-host.ts), [session-inspector.ts](../../../src/session/session-inspector.ts).
- **Qué hacer:** **eliminar** `onSliceToBank(laneId, clipIdx)` [197-258] y su cableado al inspector [276]. **No se "renombra"**: su lógica (lee un clip de audio existente + crea una lane sampler NUEVA) NO es la del flujo loop Sampler-side, que opera sobre la **lane Sampler actual** desde un **fichero** sin crear lane (Tarea 13). Borrar también `onSliceToBank` de `SessionInspector.deps`/constructor si ya nadie lo pasa.
- **Detalle:** si algún test referenciaba `onSliceToBank`, eliminarlo/actualizarlo (el e2e ya lo cubre la Tarea 9).
- **Cómo verificar:** `npx tsc --noEmit` verde + `npm run test:unit` verde.

---

## Fase 4 — UI del inspector del Sampler (riesgo alto: render + listeners)

> ⛔ **CONFIRMAR CON EL USUARIO — Duda (e)** antes de la Tarea 11: ¿la importación multi-muestra **apila full-range** (default) o reparte rangos `loNote/hiNote` automáticamente? Por defecto **apila full-range** (solo suena la última; el usuario reparte en el rack). Solo si el usuario pide reparto automático, la Tarea 11 lo implementa.

### Tarea 11 · Importación por **selección múltiple** + quitar dropzone (corrige D2: documentar la limitación)

- **Archivos:** [src/engines/sampler.ts](../../../src/engines/sampler.ts) (`buildParamUI`, bloque 469-508).
- **Qué hacer:** sustituir `<input type="file">` + `div.sampler-dropzone` (+ listeners `dragover/dragleave/drop`) por:
  - `<input type="file" multiple accept="audio/*">` + botón "Importar muestras…".
  - Handler que itera `files`: por cada uno `importFile` → `sampleStore.put` → `decodeAudioData(asset.bytes.slice(0))` → `sampleCache.put` → `addSampleToKeymap(km, asset.id, { rootNote })`. Heurística sencilla de root note por nombre (detectar `C3`/`A4`/MIDI; si no, default C3=60). Tras procesar todos: `setKeymap` + `mirrorKeymapChange` + `rebuild()`. **Bracketear en `withUndo`** la mutación del keymap.
  - **Limitación documentada (D2):** `addSampleToKeymap` fija `loNote:0, hiNote:127` → con N muestras solo suena la última (last-match-wins). El usuario ajusta root/rango por zona en el rack. NO es multi-zona automático (eso es la Duda (e) / presets bundled). Añadir un comentario en el código y, si procede, un rótulo en la UI ("Ajusta el rango de cada zona abajo").
  - Eliminar la `div.sampler-dropzone` y sus 3 listeners.
- **Cómo verificar:** `npx tsc --noEmit` verde. (Verificación funcional en Tarea 16.)

> ⛔ **CONFIRMAR CON EL USUARIO — Duda (a)** antes de la Tarea 12: ¿se mantienen `loop`/`loopStart` per-pad en el rack de zona melódica, o se retiran? Por defecto **se mantienen** (no tocar `PAD_LEAF_SPECS`).

### Tarea 12 · Cabecera de **3 familias** en `buildParamUI`

- **Archivos:** [src/engines/sampler.ts](../../../src/engines/sampler.ts) (`buildParamUI`, bloque 352-570).
- **Qué hacer:** reemplazar el `Drumkit ▾` actual [404-467] por un selector agrupado por familia, en `buildParamUI` leyendo `instrument-loader` (NO en `engine.presets`, que sigue `[]`). Tres familias:
  - **Melódico** (`family:'melodic'`): poblar desde `listInstruments()` filtrando `family==='melodic'`. Al elegir → `fetchInstrumentManifest` → `loadInstrument` → `setKeymap` + `setPadStore` (si `padParams`, con cast `as Record<number, Record<string, number>>`) + `mirrorInstrumentId` + `mirrorKeymapChange` + `mirrorPadParams` + **`mirrorDrumkitId(undefined)`** (exclusión mutua, D9). Vista: **teclado/keymap** (la lista de zonas con root + knobs per-zona que ya hace [sampler.ts:514-563], conservando `wireEngineParams`).
  - **Percusión** (`family:'drumkit'`): IDÉNTICO al actual — `listDrumkits` + `loadDrumkit` + `mirrorDrumkitId` + `mirrorKeymapChange` + **`mirrorInstrumentId(undefined)`** + `fireEditorReroute`. Vista: rack de pads (`renderDrumVoiceRack`, 364-369).
  - **Loop** (`family:'loop'`): poblar `listInstruments()` filtrando `family==='loop'`. Al elegir un preset bundled → `reloadInstrument`(loop) reconstruye el banco; el clip/escena ya están en `SessionState` (o, si es la primera vez, se crean vía Tarea 13). `mirrorDrumkitId(undefined)`. Vista: **solo el banco de slices** (keymap mono-nota informativo) + rótulo "Las notas se editan en el piano-roll del clip". `fireEditorReroute`.
  - Mantener `instrumentId` vs `drumkitId` mutuamente excluyentes (uno limpia al otro). `chooseClipEditor` ya enruta drumkit→drum-grid; melódico/loop→piano-roll SIN cambios [43-53]. La exclusión mutua garantiza que un loop nunca rutee a drum-grid.
- **Cómo verificar:** `npx tsc --noEmit` verde + smoke manual (las 3 familias aparecen). e2e en Tarea 15.

### Tarea 13 · Importar **loop** al Sampler (clip de notas + escena + piano-roll vía `installSamplerClip`)

- **Archivos:** [src/engines/sampler.ts](../../../src/engines/sampler.ts) (control "Importar loop…"), [src/session/session-host.ts](../../../src/session/session-host.ts) (método auxiliar del flujo loop).
- **Qué hacer:**
  - **Control "Importar loop…"** (un solo archivo) en `buildParamUI`, junto al selector de familia Loop. Al elegir un WAV → resume ctx → leer buffer → llamar al host para construir el flujo Sampler-side: `detectLoop` → `sliceBuffer` → `store.put×N` → `slicesToKeymap` → `setKeymap` (banco) → `buildSliceClip` → construir `SessionClip{ notes, waveformRef }` (waveformRef.sampleId = id del loop entero, ya en `sampleCache`/`sampleStore`) → **`host.installSamplerClip(laneId, clip)`** (coloca + `ensureScenesForRows` + `withUndo` + abre piano-roll; NO se duplica esa lógica, corrige D6).
  - **Operar sobre la lane Sampler ACTUAL** (no crear lane nueva). El clip de notas + la escena los materializa `installSamplerClip` en `this.state` (no efímeros) → tras `applyLoadedSessionState` el clip ya existe.
  - **NO llamar a `mirrorInstrumentId`** para un loop importado por el usuario (corrige D4): sin manifiesto, sería `undefined` (no-op) y `reloadInstrument` lanzaría al recargar. El banco + `waveformRef` quedan IndexedDB-only, como cualquier keymap de usuario. `mirrorInstrumentId` SOLO se usa al cargar un preset de loop **bundled** (Tarea 12).
  - El `waveformRef` apunta al `sampleId` del loop entero (que el usuario importó → vive en IndexedDB de ese navegador).
- **Cómo verificar:** `npx tsc --noEmit` verde + build. Verificación funcional en Tarea 16 (Playwright) y Tarea 14 (DSP).

---

## Fase 5 — DSP real (audible, determinismo end-to-end)

### Tarea 14 · `instrument-loop.dsp.test.ts` (render no silencioso, energía comparable)

- **Archivos:** `src/samples/instrument-loop.dsp.test.ts` (nuevo), fixtures en [test/fixtures/loops/drum/](../../../test/fixtures/loops/) (ya existen amen breaks).
- **Qué hacer (espejo de [loop-recompose.dsp.test.ts](../../../src/samples/loop-recompose.dsp.test.ts)):** cargar un fixture de loop → `detectLoop` → `sliceBuffer` → `slicesToKeymap` + `buildSliceClip` → reproducir el clip reconstruido por el Sampler en un `OfflineAudioContext` y comprobar, con **aserciones relativas**, que (a) el render NO es silencioso (RMS > 0) y (b) su energía RMS es **comparable** (ratio 0.5×–2×) a la del loop original entero.
- **Cómo verificar:** `npm run test:dsp` verde (o `NO_COLOR=1 npx vitest run src/samples/instrument-loop.dsp.test.ts`). Serial por `node-web-audio-api`; teardown `ERR_IPC_CHANNEL_CLOSED` no es fallo (re-run).

---

## Fase 6 — Contenido bundled mínimo (PREREQUISITO de e2e/smoke, NO opcional)

> Corrige el hallazgo marginal de la revisión: `public/instruments/` solo tiene `SOURCES.md`. Sin al menos una entrada bundled, `listInstruments` devuelve `[]` y las Tareas 15/17 (e2e de las 3 familias / cargar preset bundled) y el smoke no son ejecutables. Por eso esta fase va ANTES de las tareas e2e que la consumen.

### Tarea 15 · 2-3 presets CC0 ligeros + manifiestos

- **Archivos:** `public/instruments/index.json` (nuevo), `public/instruments/<id>.json` + `public/instruments/<id>/*.wav` (nuevos).
- **Qué hacer:** crear 2-3 entradas **CC0 ligeras** de [SOURCES.md](../../../public/instruments/SOURCES.md): p. ej. **Sweep Pad** (~5.6 MiB, FreePats CC0) y **Synth Bass** (FreePats GM39/40, CC0) como melódicos (multi-zona real con `loNote/hiNote` repartidos); **un loop** de [test/fixtures/loops/](../../../test/fixtures/loops/) recortado como preset `family:'loop'` con `slicePointsSec` FIJADO (para el determinismo). Recortar/diezmar capas para web. `index.json` = `[{ id, name, family }]`.
- **Cómo verificar:** `npm run build` (los assets se sirven); el selector melódico/loop lista las entradas en navegador.

---

## Fase 7 — e2e (Playwright; `npm run build` ANTES, sirve `dist/` stale)

> Recordatorio: ejecutar `npm run build` antes de CADA tarea Playwright. Las 3 tareas pueden vivir en un solo spec e2e (`tests/e2e/sampler-audio.spec.ts`) con varios `test(...)`. Dependen de la Fase 6 (contenido bundled).

### Tarea 16 · e2e — selector de 3 familias conmuta editor

- **Archivos:** `tests/e2e/sampler-audio.spec.ts` (nuevo).
- **Qué hacer:** abrir el inspector de una lane Sampler; comprobar que el selector ofrece las 3 familias; elegir **Percusión** → editor `drum-grid` (pads); volver a **Melódico** → piano-roll/keymap.
- **Cómo verificar:** `npm run build` + `npm run test:e2e` (este spec) verde.

### Tarea 17 · e2e — importación multi-muestra + importar/cargar loop

- **Archivos:** `tests/e2e/sampler-audio.spec.ts`.
- **Qué hacer:**
  - **Multi-muestra:** subir 2 ficheros con `browser_file_upload` al `<input multiple>`; verificar que el keymap muestra 2 zonas (apiladas full-range; no se testea "solo suena la última", es comportamiento documentado).
  - **Loop:** cargar un preset de loop bundled (o importar uno); verificar (a) clip de notas en la lane, (b) escena que lo lanza, (c) editor = piano-roll con header de waveform (`.clip-waveform-header`), (d) NO hay editor de notas dentro del Sampler.
- **Cómo verificar:** `npm run build` + `npm run test:e2e` verde.

### Tarea 18 · e2e — audio lane = WAV puro (sin `✂ Slice`)

- **Archivos:** `tests/e2e/sampler-audio.spec.ts` (o reusar `audio-channel.spec.ts`).
- **Qué hacer:** añadir un audio channel (WAV); verificar que su editor **no** tiene el botón `.audio-clip-slice`.
- **Cómo verificar:** `npm run build` + `npm run test:e2e` verde.

---

## Fase 8 — Verificación final

### Tarea 19 · Suite completa + build + smoke en navegador

- **Qué hacer / cómo verificar (en orden):**
  1. `npx tsc --noEmit` verde.
  2. `npm run test:unit` verde (re-run si aparece el `ERR_IPC_CHANNEL_CLOSED` de teardown — no es fallo).
  3. `npm run build` verde (tsc + bundle).
  4. `npm run test:e2e` verde (tras el build del paso 3).
  5. **Smoke en navegador** (`npm run dev`, http://localhost:5173):
     - Sampler → familia Melódico → cargar un preset bundled → suena al tocar el keymap.
     - Importar 2 muestras por el `<input multiple>` → aparecen 2 zonas.
     - Familia Loop → cargar un preset de loop bundled → clip de notas + escena → abrir piano-roll → editar una nota → **suena al Play**.
     - Audio lane (WAV puro) → su editor NO tiene `✂ Slice → pads`.
  6. `gitnexus_detect_changes()` (desde el repo principal; es worktree-blind) para confirmar el blast radius antes de mergear.
- **Finish flow:** `git rebase main` → `git merge --ff-only` → `ExitWorktree` (sin merge commit).

---

## Notas de implementación / riesgos (del spec)

- **Determinismo nota↔slice:** el manifiesto de loop **debe** fijar `slicePointsSec`. Cubierto por el test de determinismo (Tarea 6) y el DSP (Tarea 14).
- **`installClip` es código MUERTO y lo ELIMINA el frente A** (coordinación §1). D NO lo resucita; inserta vía `installSamplerClip` (Tarea 7b/13). Cualquier mención a `installClip` se sustituye por `installSamplerClip`/`placeClipEnsuringScene`.
- **`validatePresetEntry` exige `gm`** ([preset-loader.ts:3-13](../../../src/presets/preset-loader.ts)): los presets del Sampler van por `instrument-loader` (modelo drumkit), no por `engine.presets`/`public/presets/sampler.json`.
- **Self-healing solo para bundled:** `instrumentId`/`drumkitId` se reconstruyen por id; los keymaps/loops importados por el usuario son IndexedDB-only (NO `mirrorInstrumentId` para imports de usuario, D4).
- **Exclusión mutua instrumentId/drumkitId (D9):** garantizada en la UI (limpiar uno al elegir el otro) **y** en el load path (`else if`, `drumkitId` gana; test en Tarea 7a).
- **Tipos `padParams` (D11):** manifiesto `Partial<PadParams>` → cast `as Record<number, Record<string, number>>` al persistir (igual que [sampler.ts:359](../../../src/engines/sampler.ts)).
- **`waveformRef` del loop bundled (D8):** `reloadInstrument`(loop) regenera + cachea el WAV entero con id fresco y re-apunta `waveformRef.sampleId`. Para loops de usuario, queda IndexedDB-only.
- **Compatibilidad hacia atrás (D10):** lanes `sampler` del antiguo `onSliceToBank` cargan sin cambios (sin `instrumentId`, IndexedDB-only); test de migración (Tarea 8) lo confirma.
- **`withUndo`:** toda creación de clip/escena del flujo loop va dentro de `installSamplerClip`; la importación multi-muestra también se bracketea (Tarea 11).
- **Stems:** sin cambios; ya crean lanes Sampler melódicas que encajan en la familia melódica.
- **Orden E↔D (coordinación §3):** D ejecuta PRIMERO sobre `clip-editor-router.ts`/`clip-waveform-header.ts` (Tarea 9, quita el slicing). E construye encima; D no toca la presentación BPM/bars (de E).
