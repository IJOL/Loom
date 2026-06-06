# Frente D · Sampler & audio — Spec de diseño

**Fecha:** 2026-06-06
**Frente:** D del [overhaul UX de Loom](./2026-06-06-loom-ux-overhaul-overview.md)
**Estado:** spec de diseño (no de implementación). Genera su propio plan → implementación.
**Revisión:** corregido tras la revisión adversarial ([loom-review-findings.md](./2026-06-06-loom-review-findings.md), Frente D: ALTA D1-D4, MEDIA D5-D11) y alineado con el [documento de coordinación transversal](./2026-06-06-coordinacion-frentes.md) (§1 helper único, §2 inserción al Sampler, §3 orden E↔D, §6 orden global).

---

## Objetivo

Reconvertir el **Sampler** en un verdadero **instrumento de muestras** organizado en **tres familias de presets** —Melódicos, Percusión/Drumkits y Loops particionados— y **revertir** la dirección "audio-channel": el **audio lane** vuelve a ser **solo para WAV puros** (grabaciones, stems, takes), sin loops ni slicing. Los **loops particionados regresan al Sampler**, donde un loop sliced **es** un instrumento melódico cuyas notas son slices, reproducido por un clip de notas normal en el piano-roll.

El resultado debe:

1. Unificar el Sampler bajo un único modelo de **preset = muestras + keymap + params** (como ya hacen los drumkits de muestra), añadiendo presets melódicos y presets de loop, hoy inexistentes (`SamplerEngine.presets = []`, [sampler.ts:204](../../../src/engines/sampler.ts)).
2. Convertir los **drumkits** de "modo aparte" en **presets de la familia Percusión** (el motor ya los trata así vía `drum-kits.json` + `drumkitId`; [drum-kits.json](../../../public/presets/drum-kits.json), [apply-lane-engine-state.ts:53](../../../src/export/apply-lane-engine-state.ts)).
3. Sustituir la **zona de drag** ([sampler.ts:475-508](../../../src/engines/sampler.ts)) por un **botón de selección múltiple** de ficheros.
4. **Reubicar el slicing** desde el audio lane (Mode 2 `onSliceToBank`) hacia el flujo de importación de loops del Sampler, manteniendo **un único editor** (el piano-roll normal), nunca un editor de notas dentro del Sampler.

### Correcciones de premisas falsas que cazó la revisión (NO repetir)

La revisión adversarial demostró que el spec original partía de afirmaciones falsas sobre el código. Este spec las corrige de raíz:

- **El seam `EngineUIContext.installClip` NO se reutiliza: se ELIMINA** (decisión transversal §1 del doc de coordinación). El spec original lo ignoraba; la revisión señaló (D1) que existe y está cableado, pero el doc de coordinación verificó que es **código MUERTO** (declarado en [engine-types.ts:76](../../../src/engines/engine-types.ts), implementado en [session-host.ts:999-1006](../../../src/session/session-host.ts), **cero llamadas en `src/`**). Su antiguo invocador desapareció con el refactor "audio-channel direction" (`clip-editor-loop.ts` borrado). **El frente A lo borra**; el frente D inserta su clip de loop por el punto único `installSamplerClip` (ver §2 más abajo). NO se resucita `installClip`, NO se crea un mecanismo paralelo.
- **El flujo de "import de loop al Sampler" NO existe hoy: se CONSTRUYE, no se "reorienta"** (corrige D5). [sampler.ts:469-508](../../../src/engines/sampler.ts) solo tiene fileInput + dropzone que llaman a `addSampleToKeymap` (keymap melódico full-range). No hay `buildSliceClip` ni `slicesToKeymap` en el lado Sampler. El único slice→bank que funciona hoy es `onSliceToBank` desde el **audio lane**. El camino Sampler-side es nuevo.
- **`onSliceToBank` NO se "renombra": su lógica de creación-de-lane se descarta** (corrige D7). El `onSliceToBank(laneId, clipIdx)` real ([session-host.ts:197-258](../../../src/session/session-host.ts)) recibe un **índice de clip**, lee el sample de un **clip de audio existente**, y **crea una lane sampler NUEVA**. El flujo Sampler-side opera sobre la **lane Sampler actual** desde un **fichero**, sin crear lane. Es un camino nuevo, no un rename.

---

## Alcance

### Qué ENTRA

- **Familia de presets del Sampler (3 tipos)**, descritos por un manifiesto bundled análogo a `drum-kits.json`/`drumkits/*.json`:
  - **Melódico**: multi-zona cromático → vista teclado/keymap. Carga muestras + keymap + params (per-pad/zona), self-healing por id como los drumkits. El **multi-zona real con rangos `loNote..hiNote`** llega **solo vía presets bundled** (ver §3 sobre la limitación de la importación multi-muestra).
  - **Percusión/Drumkit**: vista pads (8 GM). **Es el mismo mecanismo que ya existe** (`drumkitId` → `loadDrumkit` → keymap mono-nota en notas GM, editor `drum-grid`). Se reencuadra como "familia" del selector de presets del Sampler, no como un picker aparte.
  - **Loop sliced**: un preset **bundled** guarda **slices + notas**; al cargarlo reconstruye instrumento (banco de slices como keymap mono-nota) **+ un clip de notas** que reproduce el loop **+ una escena** si hace falta.
- **Selector de presets del Sampler en 3 familias** en el inspector del Sampler (reemplaza/expande el `Drumkit ▾` actual de [sampler.ts:404-467](../../../src/engines/sampler.ts)).
- **Importación por selección múltiple** (`<input type="file" multiple>`) de muestras melódicas. **Limitación explícita** (corrige D2): la importación multi-muestra **apila zonas full-range** (cada muestra a `loNote:0, hiNote:127`, root C3=60 por defecto o por heurística de nombre); con `keymapEntryFor` "last match wins" ([keymap.ts:9-15](../../../src/samples/keymap.ts)) **solo suena la última en cualquier nota**. Esto es **un instrumento de una sola muestra ampliable a mano** (el usuario reasigna root/rango por zona en el rack), NO un multi-zona automático. El **multi-zona cromático real** se entrega vía presets bundled con `loNote/hiNote` ya repartidos. Ver §3 para la decisión sobre el reparto automático (Duda (e)).
- **Importación de loop al Sampler** (selección de un WAV de loop) → recorta + mapea slices + auto-crea clip de notas en la lane (+escena). Reutiliza la maquinaria de slicing ya existente (`detectLoop`, `sliceBuffer`, `slicesToKeymap`, `buildSliceClip`) **pero construyendo un camino nuevo Sampler-side** y colocando el clip vía `installSamplerClip` (§2). Un loop **importado por el usuario** es **IndexedDB-only** (no self-healing por id, corrige D4).
- **Revertir audio-channel direction**: el `audio` engine y la lane `audio` quedan **solo para WAV puros**. Se retira del audio lane el botón **`✂ Slice → pads`** y el editor especial de audio-clip con barra BPM/bar/Warp deja de ofrecer slicing. **El frente D ejecuta este cambio PRIMERO** sobre `clip-editor-router.ts`/`clip-waveform-header.ts` (orden transversal §3); reescribe **sus** tests (`clip-waveform-header.test.ts`, `tests/e2e/audio-channel.spec.ts`).
- **Drums sigue reusando el motor del Sampler** para kits de muestra (`kitMode: 'sample'`, [drums-engine.ts:402-425](../../../src/engines/drums-engine.ts)). No se toca ese contrato.
- **Persistencia self-healing SOLO para presets bundled**: presets bundled (melódico/percusión/loop, con `instrumentId`/`drumkitId`) se reconstruyen por id en `applyLaneEngineState`. Los keymaps **importados por el usuario** (multi-muestra o loop suelto) siguen atados a IndexedDB del navegador (limitación preexistente, no la introduce este spec).

### Qué NO entra (fuera de alcance / otros frentes)

- **No** se rediseña la **cabecera del editor de clips** (BPM/bar/Warp), eso es del **Frente E**; este spec solo retira el slicing del audio lane y deja la barra como está. La limpieza de BPM/bars duplicados de esa barra es propiedad de E (coordinación §3). Ver Dudas abiertas (b).
- **No** se rediseñan las aspas de borrado de clips/lanes (Frente A) ni la cabecera de transporte (Frente B) ni el mixer del master (Frente C).
- **No** se añade edición de notas dentro del Sampler: las notas de un loop se editan **siempre** en el piano-roll normal.
- **No** se descargan/empaquetan aún los WAV reales de [SOURCES.md](../../../public/instruments/SOURCES.md) a gran escala; el spec define el **formato del manifiesto** y la **maquinaria de carga**. **Excepción de orden** (corrige el hallazgo marginal): como `public/instruments/` hoy contiene **solo `SOURCES.md`** (ni `index.json` ni WAVs), los **2-3 presets bundled mínimos CC0** son **prerequisito** del e2e/smoke que cargan un preset bundled, no un extra opcional posterior. El plan los coloca ANTES de las tareas que los consumen.
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
  // params por-pad/zona (mismas leaves que PadParams), keyed por rootNote.
  // OJO: el tipo persistido es Record<number, Record<string, number>> (ver §nota de tipos).
  padParams?: Record<number, Partial<PadParams>>;
}

// Loop sliced (bundled)
interface LoopInstrumentManifest {
  id: string; name: string; family: 'loop';
  file: string;                 // el WAV del loop entero (1 archivo)
  originalBpm: number;
  slicePointsSec: number[];     // cortes FIJADOS (determinismo nota↔slice)
  gridResolution?: ResolutionKey;
}
```

**Carga (nuevo `loadInstrument`, espejo de `loadDrumkit`):**

- **Melódico** → fetch+decode de cada zona, `store.put` + `cache.put` con ids frescos (mismo patrón self-healing de [drumkit-loader.ts:88-110](../../../src/samples/drumkit-loader.ts)), devuelve `{ keymap: KeymapEntry[], padParams? }` multi-zona (a diferencia del kit, las zonas cubren rangos `loNote..hiNote`; `keymapEntryFor` ya resuelve "last match wins", [keymap.ts:9-15](../../../src/samples/keymap.ts)). El caller aplica `padParams` vía `setPadStore`.
- **Loop (bundled)** → fetch+decode del WAV entero, **reusar exactamente** el pipeline de slice existente: `sliceBuffer(ctx, buf, slicePointsSec)` → `slicesToKeymap(sliceIds)` ([slice-to-bank.ts:12](../../../src/samples/slice-to-bank.ts)). El instrumento queda como keymap mono-nota desde `SLICE_BASE_NOTE` (36). El loader devuelve `{ keymap, slicePointsSec, durationSec, originalBpm }`; el `buildSliceClip` + inserción del clip viven en `SessionHost` (NO en el loader).

**Nota de tipos `padParams`** (corrige D11): el manifiesto declara `Record<number, Partial<PadParams>>` pero la cadena persistida (`SessionLane.engineState.sampler.padParams` en [session.ts:78](../../../src/session/session.ts), `mirrorPadParams` en [session-engine-state.ts:97-100](../../../src/session/session-engine-state.ts), `setPadStore` que **toma** `Record<number, Partial<PadParams>>` en [sampler.ts:284](../../../src/engines/sampler.ts) pero el load path lo invoca como `Record<number, Record<string, number>>` en [apply-lane-engine-state.ts:24,64](../../../src/export/apply-lane-engine-state.ts)) usa `Record<number, Record<string, number>>`. **Decisión:** el manifiesto tipa `Partial<PadParams>`; al pasarlo a `setPadStore`/`mirrorPadParams` se hace un cast `as Record<number, Record<string, number>>` (igual que [sampler.ts:359](../../../src/engines/sampler.ts) ya hace `this.getPadStore() as Record<number, Record<string, number>>`). El plan lo aborda explícitamente para que no aflore en `tsc --noEmit`.

**Persistencia (engineState):** se amplía `engineState.sampler` con `instrumentId?` (espejo de `drumkitId`), de modo que el load path reconstruya **presets bundled** por id sin depender de los `sampleId` de IndexedDB. **Exclusión mutua con `drumkitId`** (corrige D9): un Sampler tiene `instrumentId` **O** `drumkitId`, nunca ambos. La UI los hace mutuamente excluyentes (al elegir familia, limpia el otro) **y** el load path añade una **guarda defensiva**: si por estado corrupto/migración ambos coexisten, **`drumkitId` tiene precedencia** y se ignora `instrumentId` (ver §2).

### 2. Reconstrucción en el load path + inserción del clip de loop

**Self-healing del keymap (presets bundled).** `applyLaneEngineState` ([apply-lane-engine-state.ts:53-61](../../../src/export/apply-lane-engine-state.ts)) ya tiene el patrón a imitar: si hay `drumkitId`, llama a `reloadDrumkit` (fire-and-forget en vivo, awaited en offline) y luego aplica `padParams`. Se añade el caso simétrico, **con la guarda de precedencia**:

```
// Pseudocódigo del nuevo bloque en applyLaneEngineState, tras el de drumkitId:
const drumkitId = es?.sampler?.drumkitId;
const instrumentId = es?.sampler?.instrumentId;
if (drumkitId) { /* reloadDrumkit ... (sin cambios) */ }
else if (instrumentId && engine.setKeymap) {          // ← else: drumkitId gana (guarda D9)
  const r = deps.reloadInstrument(lane.id, instrumentId, engine);
  if (r && r.then) await r;                            // offline: decodifica antes de setPadStore
}
```

`reloadInstrument` vive en `SessionHost` (espejo de `reloadDrumkit`, [session-host.ts:406-419](../../../src/session/session-host.ts)):
- **melódico**: `fetchInstrumentManifest` → `loadInstrument` → `engine.setKeymap(km)` + `mirrorKeymapChange` + (si `padParams`) `setPadStore`/`mirrorPadParams`.
- **loop bundled**: `loadInstrument` reconstruye el **banco de slices** (keymap mono-nota) por id; el **clip de notas + escena NO se reconstruyen aquí** porque ya están materializados en `SessionState` (ver abajo). Solo se regenera el audio del banco.

**El clip de notas y la escena del loop se guardan en el propio `SessionState`** (no son efímeros). Cuando se importa/carga un loop, el clip de notas real queda en `lane.clips` y la escena en `state.scenes`, exactamente como ya hace `onSliceToBank` con `ensureScenesForRows`. Por tanto, tras `applyLoadedSessionState` el clip ya existe; lo único self-healing es **el audio del banco** (los `sampleId` de los slices), que se regenera vía `instrumentId` + `slicePointsSec` del manifiesto **solo para presets bundled**.

**Inserción del clip de loop — vía `installSamplerClip` (decisión transversal §2).** El frente D **no** crea su propio camino de colocación ni resucita `installClip`. SessionHost (frente A) expone un método público único:

```ts
/** Coloca el clip de loop (notas + waveformRef) recién construido sobre la lane
 *  Sampler indicada, garantiza su scene (placeClipEnsuringScene), lo envuelve en
 *  undo y abre el piano-roll. Reemplaza al difunto installClip. */
installSamplerClip(laneId: string, clip: SessionClip): void
```

`installSamplerClip` hace las tres cosas que el difunto `installClip` NO hacía (corrige D1): (a) garantiza scene vía `placeClipEnsuringScene` → `ensureScenesForRows`, (b) envuelve en `withUndo`, (c) abre el inspector/piano-roll. El frente D **construye el `SessionClip`** (notas + `waveformRef`) y llama a `host.installSamplerClip(laneId, clip)`. La construcción es de D; la **colocación** es del seam único de A. Esto resuelve la colisión D6 (ambos frentes tocaban el mismo punto de inserción): hay un solo punto.

> **Orden A↔D** (coordinación §2/§6): el frente **A** introduce primero `placeClipEnsuringScene` + `installSamplerClip` y elimina `installClip`. El frente **D** consume `installSamplerClip` (no lo redefine). Si por planificación D se ejecuta antes que A, D crea `installSamplerClip` con la firma de arriba y A lo adopta sin reescribirlo.

> **Determinismo nota↔slice (documentar en el plan):** los `sampleId` de los slices cambian en cada `loadInstrument` (ids frescos). El clip de notas referencia notas MIDI (`SLICE_BASE_NOTE + i`), **no** `sampleId`, así que las notas siguen siendo válidas mientras el keymap se reconstruya con el **mismo orden de slices**. `slicesToKeymap` y `buildSliceClip` parten ambos de `slicePointsSec` ordenado ([slice-clip.ts:39-49](../../../src/core/slice-clip.ts)), de modo que el orden es determinista. Es **obligatorio** que el manifiesto de loop fije `slicePointsSec` para que nota↔slice no se descuadre.

**`waveformRef` del loop (corrige D8).** El `waveformRef.sampleId` del clip ([session.ts:65](../../../src/session/session.ts)) apunta al **WAV del loop entero**, que `loadInstrument` (loop) NO persiste (solo persiste los slices). Para presets **bundled**, tras recargar en otro navegador no hay buffer del loop entero en cache → el header de waveform quedaría en blanco. **Decisión:** `reloadInstrument` (loop bundled) **también** fetch+decode+`store.put`+`cache.put` del WAV entero con id fresco y **re-apunta** `clip.waveformRef.sampleId` a ese id nuevo (un `store.put` adicional al banco de slices). Así el header se rehidrata. Para loops **importados por el usuario** (no bundled, sin `reloadInstrument`), el `waveformRef` sigue atado a IndexedDB de ese navegador (limitación preexistente; el banco de slices también lo está).

### 3. UI del inspector del Sampler

Reemplaza la sección actual de `buildParamUI` ([sampler.ts:352-570](../../../src/engines/sampler.ts)):

**Cabecera de preset (3 familias):** un selector/segmentado con tres pestañas o un `<select>` agrupado por familia:

- **Melódico** (`family: 'melodic'`): lista los presets melódicos de `instruments/index.json`. Al elegir uno → `fetchInstrumentManifest` → `loadInstrument` + `setKeymap` + (si `padParams`) `setPadStore` + `mirrorInstrumentId` + `mirrorKeymapChange` + `mirrorPadParams`. Limpia `drumkitId` (`mirrorDrumkitId(undefined)`). Vista debajo: **teclado/keymap** (lista de zonas con root + rango + knobs per-zona, lo que ya hace [sampler.ts:514-563](../../../src/engines/sampler.ts), conservando `wireEngineParams` per-zona).
- **Percusión** (`family: 'drumkit'`): lista los drumkits (`listDrumkits`, sin cambios) + flip a `drum-grid` vía `mirrorDrumkitId` + `fireEditorReroute` (idéntico al actual [sampler.ts:436-467](../../../src/engines/sampler.ts)). Limpia `instrumentId` (`mirrorInstrumentId(undefined)`). Vista: **pads** (rack `renderDrumVoiceRack`, [sampler.ts:364-369](../../../src/engines/sampler.ts)).
- **Loop** (`family: 'loop'`): lista los presets de loop **bundled**. Al elegir uno → `reloadInstrument`(loop) reconstruye el banco; la inserción del clip va por `installSamplerClip` (§2). Limpia `drumkitId`. Vista: el Sampler muestra **solo el banco de slices** (keymap mono-nota informativo) con el rótulo "Las notas se editan en el piano-roll del clip"; las notas se editan en el piano-roll del clip auto-creado, NO aquí.

**`chooseClipEditor`** ([clip-editor-router.ts:43-53](../../../src/session/clip-editors/clip-editor-router.ts)) sigue eligiendo `drum-grid` solo para sampler con `drumkitId`; melódico y loop → `piano-roll`. La **exclusión mutua instrumentId/drumkitId** garantiza que un loop (con `instrumentId`, sin `drumkitId`) nunca rutee a drum-grid (corrige el segundo síntoma de D9). El loop, además, lleva `waveformRef` para el header de waveform (display detrás del piano-roll, [clip-editor-router.ts:91-95](../../../src/session/clip-editors/clip-editor-router.ts)).

**Importación por selección múltiple** (reemplaza el bloque file-input + dropzone, [sampler.ts:469-508](../../../src/engines/sampler.ts)):

- `<input type="file" multiple accept="audio/*">` + un botón "Importar muestras…". Por cada archivo: `importFile` → `sampleStore.put` → `decodeAudioData` → `sampleCache.put` → `addSampleToKeymap` ([keymap-edit.ts:8-15](../../../src/samples/keymap-edit.ts)). Se elimina la `div.sampler-dropzone` y sus listeners `dragover/dragleave/drop`.
- **Limitación documentada (corrige D2):** `addSampleToKeymap` fija **siempre** `loNote:0, hiNote:127` ([keymap-edit.ts:13-14](../../../src/samples/keymap-edit.ts)). Con N muestras importadas, todas cubren el teclado entero y solo la **última** suena (last-match-wins). El usuario reparte rangos a mano en el rack de zonas (cada zona tiene su root/lo/hi). El **multi-zona automático** se entrega vía presets bundled, no por la importación multi-muestra. Ver Duda (e) sobre si se quiere un reparto automático.
- **Importar loop**: un segundo control "Importar loop…" (un solo archivo) que dispara el flujo loop Sampler-side (recorte + clip + escena). Construye el banco + `buildSliceClip` y coloca el clip vía `installSamplerClip`. Un loop importado así es **IndexedDB-only**: **NO** se llama a `mirrorInstrumentId` (no hay manifiesto → sería `undefined` → no-op, y `reloadInstrument` lanzaría al recargar; corrige D4). El banco de slices y el `waveformRef` quedan atados al navegador, como cualquier keymap importado por el usuario.

### 4. Revertir la dirección "audio-channel"

> **Orden transversal §3:** el frente **D ejecuta esto PRIMERO** sobre `clip-editor-router.ts`/`clip-waveform-header.ts`. El frente E construye encima del estado resultante (cabecera de audio ya despojada del slicing). D es propietario de quitar el botón Slice + `onSliceToBank`; E es propietario de la presentación BPM/bars de la cabecera. No se solapan líneas.

- **`audio` engine** ([audio.ts](../../../src/engines/audio.ts)): sin cambios de motor — ya reproduce **solo** el `ClipSample` (WSOLA al tempo) y nada más. Se mantiene para WAV puros (grabaciones/stems/takes). `addAudioChannel` ([session-host.ts:562-600](../../../src/session/session-host.ts)) sigue creando la lane `audio` con su clip en fila 1.
- **Quitar slicing del audio lane:**
  - `renderAudioClipEditor` ([clip-waveform-header.ts:108-144](../../../src/session/clip-editors/clip-waveform-header.ts)): **eliminar** el botón `✂ Slice → pads` (`sliceBtn`, `.audio-clip-slice`, [132-138](../../../src/session/clip-editors/clip-waveform-header.ts)) y el campo `onSliceToBank` de `AudioClipEditorDeps` ([103-106](../../../src/session/clip-editors/clip-waveform-header.ts)). La barra del audio clip queda como display de BPM/bar/Warp (su rediseño/limpieza es del Frente E — Duda (b)).
  - `clip-editor-router.ts`: quitar `onSliceToBank` de `ClipEditorDeps` ([31](../../../src/session/clip-editors/clip-editor-router.ts)) y de la llamada a `renderAudioClipEditor` ([82-85](../../../src/session/clip-editors/clip-editor-router.ts)).
  - `SessionHost.onSliceToBank` ([session-host.ts:197-258](../../../src/session/session-host.ts)): **se elimina** (no se "reorienta"). Su lógica de creación-de-lane no se reaprovecha; el flujo loop Sampler-side es nuevo y opera sobre la lane Sampler actual sin crear lane (corrige D7). El cableado `onSliceToBank` del inspector ([session-host.ts:276](../../../src/session/session-host.ts), [session-inspector.ts:217-219](../../../src/session/session-inspector.ts)) se retira.
- **Tests existentes que codifican el comportamiento revertido — son de D, hay que REESCRIBIR/ELIMINAR** (corrige D3; el spec original los omitía):
  - [clip-waveform-header.test.ts:26-36](../../../src/session/clip-editors/clip-waveform-header.test.ts) afirma HOY que `.audio-clip-slice` existe y llama a `onSliceToBank`. **Reescribir**: aseverar que el botón ya NO existe y que la barra (BPM/Warp) sigue presente.
  - [tests/e2e/audio-channel.spec.ts:65-78](../../../tests/e2e/audio-channel.spec.ts) tiene un tercer test "Slice → pads adds a sampler lane…" que ejercita el flujo eliminado. **Eliminar** ese `test(...)` (los otros dos —añadir audio channel, lanzar su escena— se conservan).
- **Stems** ([session-host.ts:770-838](../../../src/session/session-host.ts)): sin cambios funcionales. Los stems siguen creando lanes Sampler con una zona melódica + clip `song`. Encajan en la familia melódica de forma natural.

**Compatibilidad hacia atrás** (corrige D10): las sesiones/demos creadas con la dirección "audio-channel" pudieron materializar lanes `sampler` con clip de notas + `waveformRef` (vía el antiguo `onSliceToBank`). Esas lanes **siguen cargando sin cambios**: son lanes `sampler` con `keymap` + clip de notas, **sin `instrumentId`** → caen por el camino IndexedDB-only (su audio sobrevive solo en el navegador que las creó, como cualquier keymap de usuario; no dependen del botón Slice retirado, que era solo una acción de UI). No hay datos que migrar (campos aditivos). El plan añade un test de regresión de migración que confirma el passthrough de `sample`/`waveformRef`/`notes`.

### 5. Flujo de datos (resumen)

```
IMPORTAR MUESTRAS MELÓDICAS (multi) — full-range apilado, NO multi-zona automático
  picker(multi) → por archivo: importFile → store.put → decode → cache.put → addSampleToKeymap
                → setKeymap → mirrorKeymapChange → rebuild UI (vista teclado; el usuario reparte rangos)

CARGAR PRESET MELÓDICO (bundled) — multi-zona real
  pick(melodic) → fetchInstrumentManifest → loadInstrument [self-healing]
                → setKeymap + setPadStore + mirrorInstrumentId + mirrorKeymapChange + mirrorPadParams
                → mirrorDrumkitId(undefined) → vista teclado

CARGAR PRESET PERCUSIÓN (= drumkit, sin cambios)
  pick(drumkit) → fetchDrumkitManifest → loadDrumkit → setKeymap
                → mirrorDrumkitId + mirrorInstrumentId(undefined) → fireEditorReroute → vista pads (drum-grid)

CARGAR PRESET LOOP (bundled)
  pick(loop) → reloadInstrument(loop): loadInstrument(slicePointsSec del manifiesto)
             → sliceBuffer → store.put×N (slices) + store.put (loop entero) → slicesToKeymap → setKeymap (banco)
             → mirrorInstrumentId  [clip de notas + escena YA están en SessionState]
             → re-apuntar waveformRef.sampleId al loop entero recargado

IMPORTAR LOOP (usuario, IndexedDB-only)
  pick(file) → buf → detectLoop → sliceBuffer → store.put×N → slicesToKeymap → setKeymap (banco)
             → buildSliceClip → SessionClip{notes, waveformRef}
             → host.installSamplerClip(laneId, clip)  [coloca + ensureScenesForRows + withUndo + abre piano-roll]
             → (NO mirrorInstrumentId: sin manifiesto)

AUDIO LANE (WAV puro) — sin slicing
  addAudioChannel(file) → audioChannelClip (warp WSOLA) → lane 'audio' fila 1
```

---

## Archivos a tocar

| Archivo | Cambio |
|---|---|
| **`src/samples/instrument-loader.ts`** *(nuevo)* | Espejo de [drumkit-loader.ts](../../../src/samples/drumkit-loader.ts): `InstrumentIndexEntry`, `MelodicInstrumentManifest`, `LoopInstrumentManifest`, `buildMelodicKeymap`, `listInstruments()`, `fetchInstrumentManifest(id)`, `loadInstrument(manifest, ctx, deps?)`. Melódico → `{ keymap: KeymapEntry[], padParams? }` multi-zona; loop → `{ keymap, slicePointsSec, durationSec, originalBpm }` reusando `sliceBuffer`+`slicesToKeymap`. Mismo patrón self-healing (ids frescos, `store.put`+`cache.put`, `LoadDeps`). |
| **`public/instruments/index.json`** *(nuevo, PREREQUISITO del e2e/smoke)* | `[{ id, name, family }]`. Arrancar con 2-3 entradas CC0 ligeras (Sweep Pad, Synth Bass melódicos; opcional 1 loop). |
| **`public/instruments/<id>.json` + `<id>/*.wav`** *(nuevo)* | Manifiestos + WAV recortados de [SOURCES.md](../../../public/instruments/SOURCES.md). |
| **`src/engines/sampler.ts`** | (1) `presets` sigue `[]` (no se exponen vía `engine.presets`; el selector vive en `buildParamUI` leyendo `instrument-loader`, porque `validatePresetEntry` exige `gm`). (2) `buildParamUI` [352-570]: selector de 3 familias; sustituir `Drumkit ▾` por el segmentado; eliminar `div.sampler-dropzone` + listeners drag [475-508]; `<input multiple>` para importar muestras (full-range apilado); control "Importar loop…" que construye el clip y llama a `host.installSamplerClip`. Cast `as Record<number, Record<string, number>>` al pasar `padParams` del manifiesto a `setPadStore`/`mirrorPadParams`. |
| **`src/session/session.ts`** | `SessionLane.engineState.sampler` [78]: añadir `instrumentId?: string` (espejo de `drumkitId`). Sin bump de schema (campo opcional/aditivo). |
| **`src/session/session-engine-state.ts`** | Añadir `mirrorInstrumentId(state, laneId, id)` + `readLaneInstrumentId(...)`, espejo de [mirrorDrumkitId 78-93](../../../src/session/session-engine-state.ts) (preservando `keymap`/`drumkitId`/`padParams` con spread). |
| **`src/export/apply-lane-engine-state.ts`** | Tras el bloque `drumkitId` [53-61]: añadir bloque `else if instrumentId` → `reloadInstrument(laneId, id, engine)` con el mismo patrón sync/await; **`drumkitId` tiene precedencia (guarda de exclusión mutua, D9)**. Ampliar `ApplyLaneEngineStateDeps` con `reloadInstrument`. |
| **`src/session/session-host.ts`** | (1) `reloadInstrument` (espejo de [reloadDrumkit 406-419](../../../src/session/session-host.ts)) inyectado en `applyEngineState` [389-400]; melódico aplica padParams; loop bundled regenera banco + re-apunta `waveformRef`. (2) **Eliminar `onSliceToBank` [197-258]** y su cableado [276] (no se reaprovecha). (3) Consumir `installSamplerClip(laneId, clip)` desde el flujo "Importar loop" (el método lo provee el frente A; si D va antes, D lo crea con la firma del doc de coordinación §2). (4) Eliminar el seam `installClip` [999-1006] **lo hace el frente A**; D NO lo usa. (5) `addAudioChannel` [562-600] sin cambios. |
| **`src/session/clip-editors/clip-waveform-header.ts`** | `renderAudioClipEditor` [108-144]: eliminar `sliceBtn` (`.audio-clip-slice`) + `onSliceToBank` de `AudioClipEditorDeps` [103-106]. `mountWaveformHeader` se mantiene (header detrás del piano-roll para clips de loop con `waveformRef`). NO tocar la presentación BPM/bars (propiedad de E). |
| **`src/session/clip-editors/clip-waveform-header.test.ts`** *(REESCRIBIR — ya existe)* | El test [26-36] afirma que `.audio-clip-slice` existe; reescribir para aseverar que NO existe y que BPM/Warp siguen. |
| **`src/session/clip-editors/clip-editor-router.ts`** | Quitar `onSliceToBank` de `ClipEditorDeps` [31] y de la llamada a `renderAudioClipEditor` [82-85]. `chooseClipEditor` [43-53] sin cambios (drumkit→drum-grid; melódico/loop→piano-roll). NO tocar el toggle de vista (propiedad de E). |
| **`src/session/session-inspector.ts`** | Dejar de construir/pasar `onSliceToBank` [217-219]; el botón Slice ya no existe en el audio lane. |
| **`tests/e2e/audio-channel.spec.ts`** *(EDITAR — ya existe)* | Eliminar el `test('Slice → pads adds a sampler lane…')` [65-78]; conservar los otros dos. |
| **`src/session/session-migration.ts`** | Sin cambios obligatorios (campos aditivos). Verificar (con test) que `migrateClip` "modern clip" [38-40] preserva `waveformRef`/`sample`/`notes`. |
| **`src/samples/slice-to-bank.ts`, `src/core/slice-clip.ts`, `src/samples/slice-buffer.ts`** | Reutilizados tal cual; sin cambios de firma. |
| **`docs/manual/`** *(LAST)* | Actualizar capítulo de Sampler/audio tras implementar (no en este spec). |

---

## Plan de pruebas

### Unit (Vitest, puro / mocks)

1. **`instrument-loader.test.ts`** (espejo de la cobertura de `drumkit-loader`):
   - `buildMelodicKeymap`/`loadInstrument` melódico: con `fetchFn`/`store`/`cache`/`now` mock, devuelve un keymap con tantas zonas como `zones`, root/lo/hi correctos, ids frescos por llamada (self-healing). Dos llamadas → `sampleId` distintos pero mismo mapeo nota↔zona.
   - `loadInstrument` loop: dado `slicePointsSec`, el keymap (`slicesToKeymap`) tiene N entradas mono-nota consecutivas desde `SLICE_BASE_NOTE`; **aserción de determinismo:** `keymap[i].rootNote === SLICE_BASE_NOTE + i` para todo `i`. Cruzar con `buildSliceClip` (mismo `slicePointsSec` → N notas en el mismo orden, `notes[i].midi === SLICE_BASE_NOTE + i`).
   - `listInstruments`/`fetchInstrumentManifest`: contrato "devuelve [] / lanza" como [drumkit-loader.ts:64-84](../../../src/samples/drumkit-loader.ts).
2. **`session-engine-state.test.ts`**: `mirrorInstrumentId` preserva `keymap`/`drumkitId`/`padParams` (spread) y no pisa una sub-state existente; `undefined` borra el id sin pisar keymap.
3. **`apply-lane-engine-state.test.ts`** (ampliar): una lane con `instrumentId` melódico llama a `reloadInstrument` y luego `setPadStore` (orden: reload antes que `setPadStore`); caso async awaitea (offline), sync fire-and-forget. **Guarda de exclusión mutua (D9):** una lane con `drumkitId` Y `instrumentId` llama a `reloadDrumkit` y **NO** a `reloadInstrument` (precedencia drumkit). Actualizar los `fakeEngine` existentes con `reloadInstrument: vi.fn()`.
4. **`session-migration.test.ts`**: un clip "modern" con `sample`+`waveformRef`+`notes` sobrevive `migrateLoadedSessionState` sin perder esos campos (cubre compatibilidad hacia atrás, D10).
5. **Regresión revert audio-channel** (reescritura de `clip-waveform-header.test.ts`): renderizar `renderAudioClipEditor` sobre un audio clip y aseverar que `.audio-clip-slice` es `null`; que la barra BPM/Warp sigue presente. (Directiva `// @vitest-environment jsdom` ya presente en el archivo.)

### DSP real (`.dsp.test.ts`, OfflineAudioContext)

6. **`instrument-loop.dsp.test.ts`**: importar un fixture de loop ([test/fixtures/loops/drum/](../../../test/fixtures/loops/)) → `detectLoop` → `sliceBuffer` → `slicesToKeymap` + `buildSliceClip` → reproducir el clip reconstruido por el Sampler y comprobar (aserciones **relativas**) que el render no es silencioso (RMS>0) y su energía RMS es comparable (ratio 0.5×–2×) al loop original entero. Reutiliza la batería de `loop-recompose.dsp.test.ts`.

### Playwright (e2e — `npm run build` antes; sirve `dist/` stale; **requiere los presets bundled de la Fase 7**)

7. **Sampler 3 familias**: abrir el inspector de una lane Sampler; el selector ofrece las 3 familias; elegir "Percusión" → editor `drum-grid` (pads); volver a "Melódico" → piano-roll/keymap.
8. **Importación multi-muestra**: subir 2 ficheros al `<input multiple>`; verificar que el keymap muestra 2 zonas (apiladas full-range; la limitación de "solo suena la última" no se testea en e2e, es comportamiento documentado).
9. **Cargar/importar loop → clip + escena + piano-roll**: cargar un preset de loop bundled (o importar uno); verificar (a) clip de notas en la lane, (b) escena que lo lanza, (c) editor = piano-roll con header de waveform (`.clip-waveform-header`), (d) NO hay editor de notas dentro del Sampler.
10. **Audio lane = WAV puro**: añadir un audio channel (WAV); su editor NO tiene `.audio-clip-slice`.

### Manual / smoke

- `npm run build` (tsc) verde; `npm run test:unit`; smoke en navegador del flujo loop end-to-end (cargar preset bundled de loop → editar nota en piano-roll → sonar al Play).

---

## Dudas abiertas (decisiones PENDIENTES del usuario — NO resueltas aquí)

> La revisión eliminó las dudas mal planteadas. Las que quedan son decisiones legítimas del usuario que siguen abiertas.

- **(a) `loop` / `loopStart` per-pad (sustain-loop de la muestra).** Hoy existen como leaves de `PadParams` ([sampler-pad-params.ts:43-44](../../../src/engines/sampler-pad-params.ts)) y los honra `SamplerVoice.trigger` ([sampler.ts:107-111](../../../src/engines/sampler.ts)). **¿Se mantienen** (útiles para pads/sostenidos melódicos) **o se retiran** (simplificación)? Afecta a `PAD_LEAF_SPECS`, al rack de zona y a la persistencia de `padParams`. **Por defecto se mantienen** (no tocar `PAD_LEAF_SPECS`).

- **(b) Limpieza de la barra de la cabecera del audio clip (BPM · bar · ♺ Warp).** Tras quitar `✂ Slice→pads` (lo hace este spec), el resto de `renderAudioClipEditor` ([clip-waveform-header.ts:114-138](../../../src/session/clip-editors/clip-waveform-header.ts)) — BPM/bar (duplican "Length") y Warp — **es propiedad del Frente E** (coordinación §3). Este spec solo retira el slicing; **E decide** qué se queda. No es duda de D, se anota como dependencia transversal.

- **(c) Edición del audio lane (WAV puro): tentativamente trim + warp.** Tras quitar loops/slicing del audio lane, su edición disponible **no está fijada**. Tentativa: **trim + warp opcional** (el `ClipSample` ya tiene `trimStart`/`trimEnd`/`warp`/`warpMode`, [session.ts:26-40](../../../src/session/session.ts)). **¿Se expone una UI de trim/warp ahora o se deja display-only de momento?**

- **(d) Waveform en un loop: solo display detrás del piano-roll, sin controles.** El loop reconstruido lleva `waveformRef` y `mountWaveformHeader` ya lo pinta detrás del editor. **¿Confirmas que es solo display** (sin reslice/drag de marcadores en el header)?

- **(e) Reparto automático de rangos en la importación multi-muestra.** Hoy `addSampleToKeymap` apila zonas full-range (solo suena la última). El multi-zona automático (repartir `loNote/hiNote` entre las muestras importadas, p. ej. dividir el teclado en N tramos o por root detectado) **no está fijado**. **¿Se quiere un reparto automático ahora**, o se acepta que el multi-zona real solo llegue vía presets bundled y la importación multi sea "apilar a mano"? Por defecto: **apilar full-range** (lo más simple; el usuario ajusta rangos en el rack).

---

## Riesgos / notas de implementación

- **Determinismo nota↔slice** (§2): el manifiesto de loop **debe** fijar `slicePointsSec`; si el orden cambia entre crear el clip y recargarlo, las notas apuntarían a slices equivocados. Equivalente al aviso de memoria "`detectLoop` es poco fiable sobre nuestros propios renders". Cubierto por el test de determinismo (unit) y el DSP.
- **`installClip` es código MUERTO y lo ELIMINA el frente A** (coordinación §1). D NO lo resucita; inserta su clip vía `installSamplerClip` (§2). Cualquier mención a `installClip` debe sustituirse por `installSamplerClip`/`placeClipEnsuringScene`.
- **`validatePresetEntry` exige `gm`** ([preset-loader.ts:3-13](../../../src/presets/preset-loader.ts)): los presets del Sampler NO se canalizan por `engine.presets`/`public/presets/sampler.json` sino por el nuevo `instrument-loader` (modelo drumkit).
- **Self-healing solo para bundled**: presets bundled (`instrumentId`/`drumkitId`) se reconstruyen por id. Los keymaps **importados por el usuario** (multi-muestra o loop suelto) siguen atados a IndexedDB del navegador (limitación preexistente). **No** se llama a `mirrorInstrumentId` para imports de usuario (D4).
- **Exclusión mutua instrumentId/drumkitId** (D9): garantizada en la UI (limpiar uno al elegir el otro) **y** en el load path (`drumkitId` tiene precedencia; `else if` + guarda + test).
- **Tipos `padParams`** (D11): manifiesto `Partial<PadParams>` → cast `as Record<number, Record<string, number>>` al persistir, igual que [sampler.ts:359](../../../src/engines/sampler.ts).
- **`withUndo`**: toda creación de clip/escena del flujo loop va dentro de `installSamplerClip` (que ya envuelve en `withUndo`); la importación multi-muestra también se bracketea para undo.
- **Compatibilidad hacia atrás** (D10): las lanes `sampler` materializadas por el antiguo `onSliceToBank` cargan sin cambios (IndexedDB-only, sin `instrumentId`); test de migración lo confirma.
