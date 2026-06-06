# Frente D · Sampler & audio — Spec de diseño

**Fecha:** 2026-06-06
**Frente:** D del [overhaul UX de Loom](./2026-06-06-loom-ux-overhaul-overview.md)
**Estado:** spec de diseño (no de implementación). Genera su propio plan → implementación.

---

## Objetivo

Reconvertir el **Sampler** en un verdadero **instrumento de muestras** organizado en **tres familias de presets** —Melódicos, Percusión/Drumkits y Loops particionados— y **revertir** la dirección "audio-channel": el **audio lane** vuelve a ser **solo para WAV puros** (grabaciones, stems, takes), sin loops ni slicing. Los **loops particionados regresan al Sampler**, donde un loop sliced **es** un instrumento melódico cuyas notas son slices, reproducido por un clip de notas normal en el piano-roll.

El resultado debe:

1. Unificar el Sampler bajo un único modelo de **preset = muestras + keymap + params** (como ya hacen los drumkits de muestra), añadiendo presets melódicos y presets de loop, hoy inexistentes (`SamplerEngine.presets = []`, [sampler.ts:204](../../../src/engines/sampler.ts)).
2. Convertir los **drumkits** de "modo aparte" en **presets de la familia Percusión** (el motor ya los trata así vía `drum-kits.json` + `drumkitId`; [drum-kits.json](../../../public/presets/drum-kits.json), [apply-lane-engine-state.ts:53](../../../src/export/apply-lane-engine-state.ts)).
3. Sustituir la **zona de drag** ([sampler.ts:475-508](../../../src/engines/sampler.ts), [audio-clip-toolbar Slice→pads](../../../src/session/clip-editors/clip-waveform-header.ts)) por un **botón de selección múltiple** de ficheros.
4. **Reubicar el slicing** desde el audio lane (Mode 2 `onSliceToBank`) hacia el flujo de importación de loops del Sampler, manteniendo **un único editor** (el piano-roll normal), nunca un editor de notas dentro del Sampler.

---

## Alcance

### Qué ENTRA

- **Familia de presets del Sampler (3 tipos)**, descritos por un manifiesto bundled análogo a `drum-kits.json`/`drumkits/*.json`:
  - **Melódico**: multi-zona cromático → vista teclado/keymap. Carga muestras + keymap + params (per-pad/zona), self-healing por id como los drumkits.
  - **Percusión/Drumkit**: vista pads (8 GM). **Es el mismo mecanismo que ya existe** (`drumkitId` → `loadDrumkit` → keymap mono-nota en notas GM, editor `drum-grid`). Se reencuadra como "familia" del selector de presets del Sampler, no como un picker aparte.
  - **Loop sliced**: el preset guarda **slices + notas**; al cargarlo reconstruye instrumento (banco de slices como keymap mono-nota) **+ un clip de notas** que reproduce el loop **+ una escena** si hace falta.
- **Selector de presets del Sampler en 3 familias** en el inspector del Sampler (reemplaza/expande el `Drumkit ▾` actual de [sampler.ts:404-467](../../../src/engines/sampler.ts)).
- **Importación por selección múltiple** (`<input type="file" multiple>`) de muestras melódicas, con auto-asignación de root note por nombre cuando sea detectable (heurística sencilla; nota raíz por defecto C3 = 60 si no, como [keymap-edit.ts:13](../../../src/samples/keymap-edit.ts)).
- **Importación de loop al Sampler** (selección de un WAV de loop) → recorta + mapea slices + auto-crea clip de notas en la lane (+escena). Reutiliza la maquinaria ya existente: `detectLoop`, `sliceBuffer`, `slicesToKeymap`, `buildSliceClip` ([slice-to-bank.ts](../../../src/samples/slice-to-bank.ts), [slice-clip.ts](../../../src/core/slice-clip.ts), [session-host.ts:197-258](../../../src/session/session-host.ts)).
- **Revertir audio-channel direction**: el `audio` engine y la lane `audio` quedan **solo para WAV puros**. Se retira del audio lane el botón **`✂ Slice → pads`** y el editor especial de audio-clip con barra BPM/bar/Warp deja de ofrecer slicing.
- **Drums sigue reusando el motor del Sampler** para kits de muestra (`kitMode: 'sample'`, [drums-engine.ts:402-425](../../../src/engines/drums-engine.ts)). No se toca ese contrato.
- **Persistencia self-healing**: presets bundled (melódico/percusión/loop) se reconstruyen por id en `applyLaneEngineState`, igual que el drumkit, sin depender de IndexedDB para los bytes.

### Qué NO entra (fuera de alcance / otros frentes)

- **No** se rediseña la **cabecera del editor de clips** (BPM/bar/Warp), eso es del **Frente E**; este spec solo registra qué parte de la cabecera waveform deja de tener sentido tras revertir el slicing del audio lane (ver Dudas abiertas (b)).
- **No** se rediseñan los aspas de borrado de clips/lanes (Frente A) ni la cabecera de transporte (Frente B) ni el mixer del master (Frente C).
- **No** se añade edición de notas dentro del Sampler: las notas de un loop se editan **siempre** en el piano-roll normal.
- **No** se descargan/empaquetan aún los WAV reales de [SOURCES.md](../../../public/instruments/SOURCES.md): este spec define el **formato del manifiesto** y la **maquinaria de carga**; el acopio/recorte/empaquetado real de samples es una tarea de contenido posterior (se pueden arrancar con 2-3 presets ligeros CC0, p. ej. Sweep Pad ~5.6 MiB, Synth Bass FreePats, VCSL).
- **No** se decide aquí la edición del audio lane (trim/warp) ni el destino del `loop`/`loopStart` per-pad → ver Dudas abiertas.

---

## Diseño

### 1. Arquitectura: presets del Sampler como manifiestos bundled

Hoy conviven dos vocabularios de "preset":

- **Presets de engine** (`public/presets/<engine>.json`, validados por `validatePresetEntry` que **exige `gm: number[]`** y `params`, [preset-loader.ts:3-13](../../../src/presets/preset-loader.ts)). Son solo **valores de parámetros**, no muestras. El Sampler los tiene a `[]`.
- **Drumkits de muestra** (`public/drumkits/index.json` + `public/drumkits/<id>.json`, cargados por `listDrumkits`/`fetchDrumkitManifest`/`loadDrumkit`, [drumkit-loader.ts](../../../src/samples/drumkit-loader.ts)), referenciados desde `drum-kits.json` con `kind: 'sample'` + `drumkitId`.

**Decisión de diseño:** los presets del Sampler siguen el **modelo de los drumkits** (muestras bundled + keymap, self-healing por id), NO el de `validatePresetEntry` (que es solo-params y exige `gm`). Se introduce un **manifiesto de instrumentos** análogo:

```
public/instruments/
  index.json                 # [{ id, name, family }]  family ∈ 'melodic'|'loop'  (drumkits siguen en public/drumkits/)
  <id>.json                  # InstrumentManifest
  <id>/...wav                # los WAV del preset
```

`InstrumentManifest` (nuevo tipo en `src/samples/instrument-loader.ts`, hermano de `DrumkitManifest`):

```ts
// Melódico
interface MelodicInstrumentManifest {
  id: string; name: string; family: 'melodic';
  zones: Array<{ file: string; rootNote: number; loNote: number; hiNote: number; gain?: number }>;
  // params por-pad/zona (mismas leaves que PadParams), keyed por rootNote:
  padParams?: Record<number, Partial<PadParams>>;
}

// Loop sliced
interface LoopInstrumentManifest {
  id: string; name: string; family: 'loop';
  file: string;                 // el WAV del loop entero (1 archivo)
  originalBpm: number;
  slicePointsSec: number[];     // cortes (o se recalculan con detectLoop al importar)
  gridResolution?: ResolutionKey;
}
```

**Carga (nuevo `loadInstrument`, espejo de `loadDrumkit`):**

- **Melódico** → fetch+decode de cada zona, `store.put` + `cache.put` con ids frescos (mismo patrón self-healing de [drumkit-loader.ts:88-110](../../../src/samples/drumkit-loader.ts)), devuelve `KeymapEntry[]` multi-zona (a diferencia del kit, las zonas pueden cubrir rangos: `loNote..hiNote`, `keymapEntryFor` ya resuelve "last match wins", [keymap.ts:9-15](../../../src/samples/keymap.ts)). Aplica `padParams` vía `setPadStore`.
- **Loop** → fetch+decode del WAV, **reusar exactamente** el pipeline de slice ya existente: `sliceBuffer(ctx, buf, slicePointsSec)` → `slicesToKeymap(sliceIds)` ([slice-to-bank.ts:12](../../../src/samples/slice-to-bank.ts)) + `buildSliceClip(...)` ([slice-clip.ts:28](../../../src/core/slice-clip.ts)) para las notas. El instrumento queda como keymap mono-nota desde `SLICE_BASE_NOTE` (36); el clip de notas se inserta en la lane.

**Persistencia (engineState):** se amplía `engineState.sampler` con `instrumentId?` (espejo de `drumkitId`), de modo que el load path reconstruya por id sin depender de los `sampleId` de IndexedDB. Para los keymaps importados **por el usuario** (no bundled), se sigue persistiendo el keymap con `sampleId` directos (comportamiento actual de [mirrorKeymapChange](../../../src/session/session-engine-state.ts:57)); estos solo sobreviven dentro del mismo navegador (limitación ya existente, no la introduce este spec).

### 2. Reconstrucción en el load path

`applyLaneEngineState` ([apply-lane-engine-state.ts:28-68](../../../src/export/apply-lane-engine-state.ts)) ya tiene el patrón exacto a imitar: si hay `drumkitId`, llama a `reloadDrumkit` (fire-and-forget en vivo, awaited en offline) y luego aplica `padParams`. Se añade el caso simétrico:

- `instrumentId` (familia melódica/loop) → `reloadInstrument(laneId, instrumentId, engine)`:
  - melódico: `loadInstrument` → `engine.setKeymap(km)` + `setPadStore` + `mirrorKeymapChange`.
  - loop: `loadInstrument` reconstruye keymap del banco de slices **y** debe **garantizar el clip de notas + escena**. Como `applyLaneEngineState` opera sobre el engine (no sobre `SessionState`), la **reconstrucción del clip/escena** vive en `SessionHost` (que sí tiene `this.state`), análogo a `onSliceToBank` ([session-host.ts:197-258](../../../src/session/session-host.ts)). Mecanismo: al cargar un preset de loop **el clip de notas y la escena se guardan en el propio `SessionState`** (no son efímeros) — un loop importado deja un clip de notas real en `lane.clips` y una entrada en `scene.clipPerLane`, exactamente como hoy `onSliceToBank` empuja `noteClip` + `ensureScenesForRows`. Por tanto, tras `applyLoadedSessionState` el clip ya existe; lo único self-healing es **el audio del banco** (los `sampleId` de los slices), que se regenera vía `instrumentId` + `slicePointsSec` del manifiesto. El `waveformRef` del clip ([session.ts:65](../../../src/session/session.ts)) se re-apunta al nuevo `sampleId` del loop entero para que el display detrás del piano-roll siga funcionando.

> **Punto delicado (documentar en el plan):** los `sampleId` de los slices cambian en cada `loadInstrument` (ids frescos). El clip de notas referencia notas MIDI (`SLICE_BASE_NOTE + i`), **no** `sampleId`, así que las notas siguen siendo válidas mientras el keymap se reconstruya con el **mismo orden de slices**. `slicesToKeymap` y `buildSliceClip` parten ambos de `slicePointsSec` ordenado ([slice-clip.ts:39-49](../../../src/core/slice-clip.ts)), de modo que el orden es determinista. Es **obligatorio** que el manifiesto de loop fije `slicePointsSec` (o que se vuelva a derivar idénticamente con `detectLoop` sobre el mismo buffer) para que nota↔slice no se descuadre.

### 3. UI del inspector del Sampler

Reemplaza la sección actual de `buildParamUI` ([sampler.ts:352-570](../../../src/engines/sampler.ts)):

**Cabecera de preset (3 familias):** un selector/segmentado con tres pestañas o un `<select>` agrupado por familia:

- **Melódico** (`family: 'melodic'`): lista los presets melódicos de `instruments/index.json`. Al elegir uno → `loadInstrument` + `setKeymap` + `mirrorInstrumentId`. Vista debajo: **teclado/keymap** (lista de zonas con root + rango + knobs per-zona, lo que ya hace [sampler.ts:514-563](../../../src/engines/sampler.ts), conservando `wireEngineParams` per-zona).
- **Percusión** (`family: 'drumkit'`): lista los drumkits (`listDrumkits`, sin cambios) + flip a `drum-grid` vía `mirrorDrumkitId` + `fireEditorReroute` (idéntico al actual [sampler.ts:436-467](../../../src/engines/sampler.ts)). Vista: **pads** (rack `renderDrumVoiceRack`, [sampler.ts:364-369](../../../src/engines/sampler.ts)).
- **Loop** (`family: 'loop'`): lista los presets de loop. Al elegir uno → `loadInstrument` + reconstrucción de clip/escena (ver §2). Vista: el Sampler muestra **solo el banco de slices** (keymap mono-nota informativo); **las notas se editan en el piano-roll** del clip auto-creado, NO aquí.

**`chooseClipEditor`** ([clip-editor-router.ts:43-53](../../../src/session/clip-editors/clip-editor-router.ts)) sigue eligiendo `drum-grid` solo para sampler con `drumkitId`; melódico y loop → `piano-roll`. El loop, además, lleva `waveformRef` para el header de waveform (display detrás del piano-roll, [clip-editor-router.ts:91-95](../../../src/session/clip-editors/clip-editor-router.ts)).

**Importación por selección múltiple** (reemplaza el bloque file-input + dropzone, [sampler.ts:469-508](../../../src/engines/sampler.ts)):

- `<input type="file" multiple accept="audio/*">` + un botón "Importar muestras…". Por cada archivo: `importFile` → `sampleStore.put` → `decodeAudioData` → `sampleCache.put` → `addSampleToKeymap` ([keymap-edit.ts:8](../../../src/samples/keymap-edit.ts)). Se elimina la `div.sampler-dropzone` y sus listeners `dragover/dragleave/drop`.
- **Importar loop**: un segundo control "Importar loop…" (un solo archivo) que dispara el flujo loop (recorte + clip + escena). Internamente reusa `onSliceToBank`-like, pero **sobre la propia lane Sampler** en vez de crear una lane nueva desde un audio lane.

### 4. Revertir la dirección "audio-channel"

- **`audio` engine** ([audio.ts](../../../src/engines/audio.ts)): sin cambios de motor — ya reproduce **solo** el `ClipSample` (WSOLA al tempo) y nada más. Se mantiene para WAV puros (grabaciones/stems/takes). `addAudioChannel` ([session-host.ts:562-600](../../../src/session/session-host.ts)) sigue creando la lane `audio` con su clip en fila 1.
- **Quitar slicing del audio lane:**
  - `renderAudioClipEditor` ([clip-waveform-header.ts:108-144](../../../src/session/clip-editors/clip-waveform-header.ts)): **eliminar** el botón `✂ Slice → pads` (`sliceBtn`) y su `deps.onSliceToBank`. La barra del audio clip queda como display de BPM/bar/Warp (su rediseño es del Frente E — ver Duda (b)).
  - `clip-editor-router.ts`: quitar `onSliceToBank` de `ClipEditorDeps` y de la llamada a `renderAudioClipEditor` ([clip-editor-router.ts:31,82-85](../../../src/session/clip-editors/clip-editor-router.ts)).
  - `SessionHost.onSliceToBank` ([session-host.ts:197-258](../../../src/session/session-host.ts)): se **reorienta** — su lógica (slice + keymap + clip de notas) pasa a ser el **flujo de importación de loop del Sampler** (sobre una lane Sampler), no un comando del audio lane. La función no se borra entera; se reaprovecha movida/renombrada (p. ej. `importLoopToSampler`). El `onSliceToBank` del inspector ([session-host.ts:276](../../../src/session/session-host.ts)) deja de cablearse al editor de audio.
- **Stems** ([session-host.ts:770-838](../../../src/session/session-host.ts)): sin cambios funcionales. Los stems siguen creando lanes Sampler con una zona melódica + clip `song`. (Nota: hoy crean lanes `sampler` con keymap melódico de 1 zona; encajan en la familia melódica de forma natural.)

### 5. Flujo de datos (resumen)

```
IMPORTAR MUESTRAS MELÓDICAS (multi)
  picker(multi) → por archivo: importFile → store.put → decode → cache.put → addSampleToKeymap
                → setKeymap → mirrorKeymapChange → rebuild UI (vista teclado)

CARGAR PRESET MELÓDICO (bundled)
  pick(melodic) → loadInstrument(manifest) [self-healing] → setKeymap + setPadStore
                → mirrorInstrumentId + mirrorKeymapChange → vista teclado

CARGAR PRESET PERCUSIÓN (= drumkit, sin cambios)
  pick(drumkit) → fetchDrumkitManifest → loadDrumkit → setKeymap
                → mirrorDrumkitId → fireEditorReroute → vista pads (drum-grid)

IMPORTAR / CARGAR LOOP
  pick(loop) → buf → detectLoop (o slicePointsSec del manifiesto)
             → sliceBuffer → store.put×N → slicesToKeymap → setKeymap (banco)
             → buildSliceClip → noteClip (notes + waveformRef) en lane.clips[fila]
             → ensureScenesForRows (auto-escena) → abrir piano-roll del clip
             → mirrorInstrumentId (self-healing del banco por id)

AUDIO LANE (WAV puro) — sin slicing
  addAudioChannel(file) → audioChannelClip (warp WSOLA) → lane 'audio' fila 1
```

---

## Archivos a tocar

| Archivo | Cambio |
|---|---|
| **`src/samples/instrument-loader.ts`** *(nuevo)* | Espejo de [drumkit-loader.ts](../../../src/samples/drumkit-loader.ts): `InstrumentIndexEntry`, `MelodicInstrumentManifest`, `LoopInstrumentManifest`, `listInstruments()`, `fetchInstrumentManifest(id)`, `loadInstrument(manifest, ctx, deps?)`. Melódico → `KeymapEntry[]` multi-zona + `padParams`; loop → keymap de slices reusando `sliceBuffer`+`slicesToKeymap`. Mismo patrón self-healing (ids frescos, `store.put`+`cache.put`). |
| **`public/instruments/index.json`** *(nuevo)* | `[{ id, name, family }]`. Arrancar con 2-3 entradas CC0 ligeras (p. ej. Sweep Pad, Synth Bass). |
| **`public/instruments/<id>.json` + `<id>/*.wav`** *(nuevo)* | Manifiestos + WAV recortados de [SOURCES.md](../../../public/instruments/SOURCES.md). Acopio de contenido = tarea posterior; el spec fija el formato. |
| **`src/engines/sampler.ts`** | (1) `presets` deja de ser `[]` solo si se decide exponer presets vía el contrato de engine; preferible: el **selector de presets vive en `buildParamUI`** leyendo `instrument-loader` (no en `engine.presets`, que está atado a `validatePresetEntry`+`gm`). (2) `buildParamUI` [352-570]: nuevo selector de 3 familias; sustituir `Drumkit ▾` por el segmentado; eliminar `div.sampler-dropzone` + listeners drag [475-508]; `<input multiple>` para importar muestras [469-500]; control "Importar loop…". |
| **`src/session/session.ts`** | `SessionLane.engineState.sampler` [74-78]: añadir `instrumentId?: string` (espejo de `drumkitId`). Sin bump de schema (campo opcional/aditivo, como `drumkitId`/`padParams`). |
| **`src/session/session-engine-state.ts`** | Añadir `mirrorInstrumentId(state, laneId, id)` + `readLaneInstrumentId(...)`, espejo de [mirrorDrumkitId 78-93](../../../src/session/session-engine-state.ts) (preservando `keymap`/`drumkitId`/`padParams` con spread). |
| **`src/export/apply-lane-engine-state.ts`** | Tras el bloque `drumkitId` [53-61]: añadir bloque `instrumentId` → `reloadInstrument(laneId, id, engine)` con el mismo patrón sync/await (vivo fire-and-forget; offline awaited). Ampliar `ApplyLaneEngineStateDeps`. |
| **`src/session/session-host.ts`** | (1) `reloadInstrument` (espejo de [reloadDrumkit 406-419](../../../src/session/session-host.ts)) inyectado en `applyEngineState` [389-400]. (2) Renombrar/reorientar `onSliceToBank` [197-258] → `importLoopToSampler(laneId, file|clip)` que opera sobre una lane Sampler (crea/usa el banco + clip + escena en `this.state`). (3) Quitar el cableado `onSliceToBank` del inspector [276]. (4) `addAudioChannel` [562-600] sin cambios (WAV puro). |
| **`src/session/clip-editors/clip-waveform-header.ts`** | `renderAudioClipEditor` [108-144]: eliminar `sliceBtn` (`✂ Slice → pads`) + `onSliceToBank` de `AudioClipEditorDeps` [103-106]. `mountWaveformHeader` se mantiene (header detrás del piano-roll para clips de loop con `waveformRef`). |
| **`src/session/clip-editors/clip-editor-router.ts`** | Quitar `onSliceToBank` de `ClipEditorDeps` [31] y de la llamada a `renderAudioClipEditor` [82-85]. `chooseClipEditor` [43-53] sin cambios (drumkit→drum-grid; melódico/loop→piano-roll). |
| **`src/session/session-inspector.ts`** | Dejar de pasar `onSliceToBank` (proviene de [session-host.ts:276](../../../src/session/session-host.ts)); el botón Slice ya no existe en el audio lane. |
| **`src/session/session-migration.ts`** | Sin cambios obligatorios (campos aditivos). Verificar que `migrateClip` [35-65] preserva `waveformRef`/`sample` (hoy el branch "modern clip" hace passthrough; el branch legacy NO copia `waveformRef`/`sample` — confirmar que ningún loop pasa por el branch legacy). |
| **`src/samples/slice-to-bank.ts`, `src/core/slice-clip.ts`** | Reutilizados tal cual; sin cambios de firma. |
| **`docs/manual/`** *(LAST)* | Actualizar capítulo de Sampler/audio tras implementar (no en este spec). |

---

## Plan de pruebas

### Unit (Vitest, puro / mocks)

1. **`instrument-loader.test.ts`** (espejo de la cobertura de `drumkit-loader`):
   - `buildMelodicKeymap`/`loadInstrument` melódico: con `fetchFn`/`store`/`cache` mock, devuelve un `KeymapEntry[]` con tantas zonas como `zones`, root/lo/hi correctos, ids frescos por llamada (self-healing). Verifica que dos llamadas dan `sampleId` distintos pero mismo mapeo nota↔zona.
   - `loadInstrument` loop: dado `slicePointsSec`, el keymap resultante (`slicesToKeymap`) tiene N entradas mono-nota consecutivas desde `SLICE_BASE_NOTE`, y `buildSliceClip` produce N notas en el mismo orden. **Aserción clave de determinismo:** nota[i].midi === SLICE_BASE_NOTE + i para todo i.
   - `listInstruments`/`fetchInstrumentManifest`: contrato "devuelve [] / lanza" como [drumkit-loader.ts:64-84](../../../src/samples/drumkit-loader.ts).
2. **`session-engine-state.test.ts`**: `mirrorInstrumentId` preserva `keymap`/`drumkitId`/`padParams` y no pisa una sub-state existente (mismo riesgo que motivó el spread en `mirrorDrumkitId`/`mirrorKeymapChange`).
3. **`apply-lane-engine-state.test.ts`** (ampliar [apply-lane-engine-state.test.ts](../../../src/export/apply-lane-engine-state.test.ts)): una lane con `engineState.sampler.instrumentId` melódico llama a `reloadInstrument` y luego aplica `padParams`; el caso loop **awaitea** en modo offline (Promise) y es fire-and-forget en vivo (undefined). Verifica el orden: keymap antes que `setPadStore`.
4. **`session-migration.test.ts`**: un clip con `sample`+`waveformRef`+`notes` sobrevive `migrateLoadedSessionState` sin perder `waveformRef`/`sample`.
5. **Regresión revert audio-channel**: test que renderiza `renderAudioClipEditor` sobre un audio clip y asegura que **no** existe ningún botón `.audio-clip-slice` (el slicing ya no vive en el audio lane).

### DSP real (`.dsp.test.ts`, OfflineAudioContext)

6. **`instrument-loop.dsp.test.ts`**: importar un fixture de loop ([test/fixtures/loops/](../../../test/fixtures/loops/)) → `sliceBuffer` → reproducir el clip de notas reconstruido a través del Sampler y comprobar (aserciones relativas) que el render no es silencioso y su energía RMS es comparable al loop original reproducido entero (ratio dentro de banda). Reutiliza la batería/patrones de `loop-recompose.dsp.test.ts`.

### Playwright (e2e — recordar `npm run build` antes; sirve `dist/` stale)

7. **Sampler 3 familias**: abrir el inspector de una lane Sampler, comprobar que el selector ofrece las 3 familias; elegir "Percusión" → el editor del clip pasa a `drum-grid` (pads); volver a "Melódico" → vuelve a piano-roll/keymap.
8. **Importación multi-muestra**: subir 2 ficheros con `browser_file_upload` al `<input multiple>`; verificar que el keymap muestra 2 zonas.
9. **Importar loop → clip + escena + piano-roll**: cargar un loop; verificar que (a) aparece un clip de notas en la lane, (b) existe una escena que lo lanza, (c) el editor abierto es el piano-roll con header de waveform (`.clip-waveform-header`), (d) NO hay editor de notas dentro del Sampler.
10. **Audio lane = WAV puro**: añadir un audio channel (WAV); verificar que su editor **no** tiene el botón `✂ Slice → pads`.

### Manual / smoke

- `npm run build` (tsc) verde; `npm run test:unit`; smoke en navegador del flujo loop end-to-end (importar → editar nota en piano-roll → sonar al Play).

---

## Dudas abiertas (decisiones PENDIENTES del usuario — NO resueltas aquí)

Estas las hereda este spec del [overview](./2026-06-06-loom-ux-overhaul-overview.md#dudas-abiertas-no-fijadas) y se mantienen explícitamente abiertas; el plan de implementación NO debe darlas por cerradas sin tu decisión:

- **(a) `loop` / `loopStart` per-pad (sustain-loop de la muestra).** Hoy existen como leaves de `PadParams` ([sampler-pad-params.ts:43-44](../../../src/engines/sampler-pad-params.ts)) y los honra `SamplerVoice.trigger` ([sampler.ts:107-111](../../../src/engines/sampler.ts)). **¿Se mantienen** (útiles para pads/sostenidos melódicos) **o se retiran** (simplificación, sobre todo si chocan conceptualmente con el "loop sliced" que ahora es un instrumento entero)? Afecta a `PAD_LEAF_SPECS`, al rack de zona y a la persistencia de `padParams`.

- **(b) Cabecera waveform (BPM · bar · ♺ Warp · ✂ Slice→pads): eliminación/reparto.** Al revertir el audio-channel, `✂ Slice→pads` desaparece del audio lane (lo hace este spec). **Queda por decidir** el destino del resto de la barra de `renderAudioClipEditor` ([clip-waveform-header.ts:114-138](../../../src/session/clip-editors/clip-waveform-header.ts)): BPM/bar duplican "Length" (Frente E); Warp puede quedarse (audio lane) o irse. **Decisión transversal con el Frente E** — este spec solo retira el slicing, no rediseña la barra.

- **(c) Edición del audio lane (WAV puro): tentativamente trim + warp opcional.** Tras quitar loops/slicing del audio lane, su edición disponible **no está fijada**. Tentativa: **trim + warp opcional** (el `ClipSample` ya tiene `trimStart`/`trimEnd`/`warp`/`warpMode`, [session.ts:26-40](../../../src/session/session.ts)). **¿Se expone una UI de trim/warp ahora o se deja el audio lane como display-only de momento?**

- **(d) Waveform en un loop: solo display detrás del piano-roll, sin controles.** El loop reconstruido lleva `waveformRef` y `mountWaveformHeader` ya lo pinta detrás del editor ([clip-editor-router.ts:91-95](../../../src/session/clip-editors/clip-editor-router.ts)). **¿Confirmas que es solo display** (sin reslice/drag de marcadores en el header)? Si en el futuro se quisieran mover slices, sería un control nuevo no contemplado aquí.

---

## Riesgos / notas de implementación

- **Determinismo nota↔slice** (ver §2): el manifiesto de loop **debe** fijar `slicePointsSec`, o re-derivarlos idénticos con `detectLoop`; si el orden cambia entre la creación del clip y su recarga, las notas apuntarían a slices equivocados. Es el equivalente del aviso de memoria "`detectLoop` es poco fiable sobre nuestros propios renders".
- **`validatePresetEntry` exige `gm`** ([preset-loader.ts:3-13](../../../src/presets/preset-loader.ts)): por eso los presets del Sampler **no** se canalizan por `engine.presets`/`public/presets/sampler.json`, sino por el nuevo `instrument-loader` (modelo drumkit). No intentar rellenar `sampler.json` con el validador actual.
- **Self-healing**: solo los presets **bundled** (con `instrumentId`/`drumkitId`) se reconstruyen por id. Los keymaps importados por el usuario siguen atados a IndexedDB del navegador (limitación preexistente; documentar en el manual, no resolver aquí).
- **`withUndo`**: toda creación de lane/clip/escena del flujo loop debe envolverse en `withUndo(hd, run)` como hace `onSliceToBank`/`addAudioChannel` hoy ([session-host.ts:256,595](../../../src/session/session-host.ts)).
