# Sampler (Front D) — lo que quedó sin hacer · Plan

> **For agentic workers:** REQUIRED SUB-SKILL: use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** terminar de verdad el Sampler de 3 familias: que **cargar un preset de loop reproduzca el loop** (hoy no pinta notas) y que el inspector **deje de amontonar** un rack de knobs por cada slice; acercarlo al [mockup](../../../.superpowers/brainstorm/39946-1780156939/content/sampler-ui.html).

**Architecture:** el motor (`sampler.ts buildParamUI`) habla con `SessionHost` por `CustomEvent` (`loom:import-loop`). El camino de **import de loop por el usuario** ya construye un clip jugable vía `SessionHost.installSamplerClip`; el camino de **preset de loop** del picker NO. Reutilizamos el mismo seam para el preset, y separamos la vista de loop (banco informativo) de la vista melódica (racks per-zona).

**Tech Stack:** TypeScript + Web Audio, Vitest (unit), Playwright (e2e), SCSS.

---

## Auditoría honesta — qué se hizo ayer y qué NO (Front D)

Verificado leyendo el código + reproducido en navegador (Playwright) el 2026-06-07.

| Item del diseño ([spec](../specs/2026-06-06-sampler-audio-design.md)) | Estado real | Evidencia |
|---|---|---|
| Picker de 3 familias (Melodic/Percussion/Loop) | ✅ HECHO | `sampler.ts:445-526` — pobla optgroups desde `listInstruments()`/`listDrumkits()`. Reproducido: las 7 opciones aparecen. |
| Presets bundled en disco | ✅ HECHO | `public/instruments/index.json` (sweep-pad, synth-bass, amen-175) + `dist/`. |
| Import de loop por el USUARIO → clip jugable | ✅ HECHO | `session-host.ts:768-827` `importLoopToSampler` (slice + `buildSliceClip` + `installSamplerClip`). |
| Import multi-muestra | ✅ HECHO | `sampler.ts:641-697` (`<input multiple>` → `addSampleToKeymap`). |
| `reloadInstrument` self-healing + rehidratar `waveformRef` | ✅ HECHO | `session-host.ts:475-516`; `apply-lane-engine-state.ts:67-72` (con precedencia `drumkitId`). |
| Revertir audio-channel (quitar `✂ Slice → pads`) | ✅ HECHO | `clip-waveform-header.ts` sin `.audio-clip-slice`; `onSliceToBank` eliminado. |
| **Cargar PRESET de loop → clip de notas + escena** | ❌ **NO HECHO** | `sampler.ts:576-593`: la rama `family==='loop'` solo hace `setKeymap`+`mirrorInstrumentId`. **No** `buildSliceClip`, **no** `installSamplerClip`. Reproducido: cargar "Amen Break" → `celdas llenas 0→0`, el hint dice "edita las notas en el piano-roll" pero **no hay clip ni piano-roll**. El loop queda mudo. |
| **Vista de loop = banco informativo compacto** | ❌ **NO HECHO** | `sampler.ts:739-749`: para todo no-drumkit pinta un **rack per-zona completo**. Un loop = ~20 slices → 20 racks. El diseño (§3 Loop) pedía "solo el banco de slices informativo". |
| **Layout de las filas de keymap** | ❌ **ROTO** | `_session-inspector.scss:360` `.sampler-keymap-row{display:flex;align-items:center}` mete nombre+`root`+`✕`+rack **en una línea**; `.sampler-zone-params` **sin CSS** → envuelve distinto por fila → "se desordenan y amontonan". |
| **Rediseño visual hacia el mockup** | ❌ **NO HECHO** | Sin CSS para `.sampler-family-row`/`.sampler-import-*`/`.sampler-loop-hint`; `.sampler-dropzone` CSS **muerto** (la dropzone se quitó). Inspector "fundamentalmente igual" que antes. |
| e2e del camino PRESET de loop | ❌ NO HECHO | `tests/e2e/sampler-audio.spec.ts` solo cubre import por usuario. Por eso el bug del preset pasó "verde". |
| Dudas (c) trim/warp audio lane, (e) multi-zona auto, (d) editor waveform con trim/Loop-Tema | ⏳ PENDIENTES | Eran decisiones del usuario; ninguna implementada. |

**Conclusión:** Front D entregó el **plumbing** (loader, picker, mirror, self-healing, import-de-usuario) pero dejó **sin cablear el preset de loop** (lo más visible) y **sin tocar la presentación** (de ahí el "amontonan" y el "igual que antes").

---

## Parte A — arreglos cerrados (camino claro, implementar ya)

### Task A1: Cargar un preset de loop crea el clip jugable

**Files:**
- Modify: `src/session/session-host.ts` (añadir `loadLoopPresetIntoSampler`; registrar listener `loom:load-loop-preset` junto al de `loom:import-loop`, ~`:328`)
- Modify: `src/engines/sampler.ts:576-593` (rama `family==='loop'`: dejar de hacer solo `setKeymap`; despachar el evento)
- Test: `tests/e2e/sampler-audio.spec.ts`

- [ ] **Step 1 — e2e que falla (reproduce el bug):** añadir a `sampler-audio.spec.ts`:

```ts
test('selecting a bundled loop preset creates a playable note clip', async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(() => document.querySelectorAll('.session-cell-filled').length > 0, { timeout: 10_000 });
  // add a sampler lane + open it + resume audio
  await page.evaluate(() => {
    const sel = document.querySelector('select.session-tabs-engine') as HTMLSelectElement; sel.value = 'sampler';
    (document.querySelector('button.session-tabs-add-btn') as HTMLButtonElement).click();
  });
  (document.getElementById('play') as HTMLButtonElement | null)?.click?.();
  await page.locator('button.session-lane-tab', { hasText: 'Sampler 1' }).click();
  const before = await page.locator('.session-cell-filled[data-lane-id="sampler-1"]').count();
  // pick the loop preset
  await page.locator('select.sampler-family-select').selectOption('loop:amen-175');
  // a playable clip appears on the sampler lane + the piano-roll opens
  await expect.poll(() => page.locator('.session-cell-filled[data-lane-id="sampler-1"]').count())
    .toBeGreaterThan(before);
  await expect(page.locator('#insp-roll-host .pr-frame, #insp-roll-host .clip-waveform-header').first())
    .toBeVisible({ timeout: 10_000 });
});
```

- [ ] **Step 2 — verlo fallar:** `npm run build && NO_COLOR=1 npx playwright test tests/e2e/sampler-audio.spec.ts -g "bundled loop preset"`. Esperado: FALLA (la celda sigue vacía).

- [ ] **Step 3 — `SessionHost.loadLoopPresetIntoSampler` (espejo de `importLoopToSampler`, pero desde el manifiesto bundled).** En `session-host.ts`, junto a `importLoopToSampler`:

```ts
/** Front D follow-up — load a BUNDLED loop preset into the named sampler lane:
 *  reconstruye el banco de slices con los `slicePointsSec` FIJOS del manifiesto,
 *  re-almacena el WAV entero (para el waveformRef), construye el clip de notas y
 *  lo coloca con `installSamplerClip`. A diferencia del import de usuario, SÍ
 *  hace `mirrorInstrumentId` (es bundled → self-healing por id). */
loadLoopPresetIntoSampler(laneId: string, instrumentId: string): void {
  const self = this;
  const { ctx, seq } = this.deps;
  const lane = this.state.lanes.find((l) => l.id === laneId);
  if (!lane || lane.engineId !== 'sampler') return;
  void ctx.resume();
  void (async () => {
    try {
      const manifest = await fetchInstrumentManifest(instrumentId);
      if (manifest.family !== 'loop') return;
      // WAV entero (para el waveformRef display-only).
      const res = await fetch(`${import.meta.env.BASE_URL}instruments/${manifest.file}`);
      const buf = await ctx.decodeAudioData(await res.arrayBuffer());
      const loopId = newSampleId();
      sampleCache.put(loopId, buf);
      await sampleStore.put(buildSampleAsset({
        id: loopId, name: manifest.name, mime: 'audio/wav',
        bytes: await audioBufferToWavBytes(buf), buffer: buf, createdAt: Date.now(),
      }));
      // Banco de slices con los cortes FIJOS del manifiesto (determinismo nota↔slice).
      const cuts = sliceBuffer(ctx, buf, manifest.slicePointsSec);
      const sliceIds: string[] = [];
      for (const cut of cuts) {
        const id = newSampleId();
        await sampleStore.put(buildSampleAsset({
          id, name: `${manifest.name} ${sliceIds.length + 1}`, mime: 'audio/wav',
          bytes: await audioBufferToWavBytes(cut.buffer), buffer: cut.buffer, createdAt: Date.now(),
        }));
        sampleCache.put(id, cut.buffer);
        sliceIds.push(id);
      }
      const km = slicesToKeymap(sliceIds);
      const eng = self.deps.laneResources?.get(laneId)?.engine as unknown as { setKeymap?(k: typeof km): void } | undefined;
      eng?.setKeymap?.(km);
      mirrorKeymapChange(self.state, laneId, km);
      mirrorInstrumentId(self.state, laneId, instrumentId);
      mirrorDrumkitId(self.state, laneId, undefined);
      const built = buildSliceClip({
        slicePointsSec: manifest.slicePointsSec, durationSec: buf.duration,
        originalBpm: manifest.originalBpm, projectMeter: seq.meter, gridResolution: DEFAULT_RESOLUTION,
      });
      const noteClip: SessionClip = {
        id: `clip-${Date.now().toString(36)}`, name: `${manifest.name} loop`,
        lengthBars: built.lengthBars, notes: built.notes, gridResolution: DEFAULT_RESOLUTION,
        waveformRef: { sampleId: loopId, slices: built.slices },
      };
      self.installSamplerClip(laneId, noteClip);
    } catch (err) {
      console.warn('Sampler loop preset: could not load loop:', err);
    }
  })();
}
```

Registrar el listener junto al de `loom:import-loop`:

```ts
document.addEventListener('loom:load-loop-preset', (e) => {
  const d = (e as CustomEvent).detail as { laneId: string; instrumentId: string };
  this.loadLoopPresetIntoSampler(d.laneId, d.instrumentId);
});
```

> Nota DRY: `importLoopToSampler` y `loadLoopPresetIntoSampler` comparten el bloque "slice + store + keymap + buildSliceClip + installSamplerClip". Extraer un privado `installLoopBank(laneId, {buf, slicePointsSec, originalBpm, name, loopId, instrumentId?})` y que ambos lo llamen (uno con `detectLoop`, otro con los cortes del manifiesto). Hacerlo en este step para no duplicar.

- [ ] **Step 4 — la rama `loop` del picker delega en SessionHost.** En `sampler.ts:576-593`, separar melódico de loop. Para loop, **no** cargar el keymap en el motor aquí; despachar el evento (SessionHost reconstruye banco+clip):

```ts
} else if (family === 'loop') {
  document.dispatchEvent(new CustomEvent('loom:load-loop-preset', {
    detail: { laneId: ctx.laneId, instrumentId: id },
  }));
  // El reroute/rebuild lo provoca installSamplerClip al abrir el piano-roll.
} else {
  // melodic: igual que ahora (setKeymap + padParams + mirrors)
  const manifest = await fetchInstrumentManifest(id);
  const loaded = await loadInstrument(manifest, audioCtx);
  this.setKeymap(loaded.keymap);
  if (ctx.sessionState) { mirrorKeymapChange(...); mirrorInstrumentId(...); mirrorDrumkitId(..., undefined); }
  if ('padParams' in loaded && loaded.padParams) { /* setPadStore + mirror */ }
  fireEditorReroute(); rebuild();
}
```

- [ ] **Step 5 — verlo pasar:** `npm run build && NO_COLOR=1 npx playwright test tests/e2e/sampler-audio.spec.ts -g "bundled loop preset"`. Esperado: PASA (aparece la celda + el piano-roll/waveform).

- [ ] **Step 6 — commit:** `git add -A && git commit -m "fix(sampler): loading a bundled loop preset creates the playable note clip"`

### Task A2: la vista de loop son TIRAS VERTICALES (como el drumkit), no filas que se amontonan

El drumkit ya se pinta con `renderDrumVoiceRack` → una **columna vertical** (`.dv-col`, `min-width:58px`) por voz, dentro de un flex con `overflow-x:auto` (`_drum-rack.scss:1-6`): ordenado, regular y **caben muchas** (scroll horizontal). El loop debe usar EXACTAMENTE eso — cada slice = una tira vertical. Hoy solo lo bloquea la guarda `if (this.isDrumkit())`; el Sampler ya implementa `getRackLayout`/`getDrumVoiceMute/Solo` para voces string arbitrarias (`sampler.ts:272-282`), así que el rack vale para los slices tal cual.

**Files:** Modify `src/engines/sampler.ts:394-399` (rack) + `:739-749` (filas per-zona)

- [ ] **Step 1 — detectar lane de loop (síncrono).** En `buildParamUI`: `const laneClips = ctx.sessionState?.lanes.find(l => l.id === ctx.laneId)?.clips ?? []; const isLoopBank = laneClips.some(c => c?.waveformRef);` (un loop tiene un clip con `waveformRef`+slices, creado por A1; un melódico no).

- [ ] **Step 2 — pintar el rack vertical también en loops.** Cambiar la guarda del top de `buildParamUI` de `if (this.isDrumkit())` a `if (this.isDrumkit() || isLoopBank)`, pasando `voices = this.keymap.map(e => padKeyForNote(e.rootNote))` (idéntico al drumkit). Cada slice → una `.dv-col`.

- [ ] **Step 3 — NO pintar las filas horizontales per-zona en loops.** La guarda de `:740` pasa de `if (!this.isDrumkit())` a `if (!this.isDrumkit() && !isLoopBank)`. (Así el loop SOLO muestra las tiras verticales del rack.)

- [ ] **Step 4 — etiqueta de cada tira = índice de slice.** `VOICE_LABELS` cae hoy a `voice.toUpperCase()` ("ZONE36"). Pasar un `labels?: Record<string,string>` opcional a `renderDrumVoiceRack` y, para loops, mapear `padKeyForNote(SLICE_BASE_NOTE+i) → String(i+1)` para que la cabecera sea "1,2,3…". (Polish; no bloquea la funcionalidad.)

- [ ] **Step 5 — e2e + visual.** Extender el test de A1: tras cargar el loop, `expect(page.locator('.drum-voice-rack .dv-col')).toHaveCount(nSlices)` y `expect(page.locator('.sampler-zone-params')).toHaveCount(0)`. Screenshot del inspector → tiras verticales alineadas.

- [ ] **Step 6 — commit:** `git commit -m "fix(sampler): loop slices render as vertical strips (drum-voice-rack), not a pile of horizontal rows"`

### Task A3: las filas de keymap melódicas dejan de amontonarse

**Files:** Modify `src/styles/_session-inspector.scss:360-374`

- [ ] **Step 1 — apilar identidad y rack.** `.sampler-keymap-row` pasa a columna; la identidad (nombre/root/✕) en su línea, el rack debajo, alineado:

```scss
.sampler-keymap-row {
  display: flex;
  flex-direction: column;      // identidad arriba, rack debajo (no se pisan)
  gap: 4px;
  font-size: 12px;
  padding: 6px 8px;
  border: 1px solid rgba(255,255,255,0.08);
  border-radius: 6px;
}
.sampler-keymap-row > .sampler-zone-params { width: 100%; }   // el rack ocupa la fila completa
.sampler-zone-params.knob-row { flex-wrap: wrap; gap: 10px; row-gap: 8px; }
```

(La línea de identidad nombre+root+✕ se envuelve en un `<div class="sampler-keymap-id">` flex en `sampler.ts` para que `flex-direction:column` no rompa el orden — añadir ese wrapper en este step.)

- [ ] **Step 2 — limpiar CSS muerto:** borrar `.sampler-dropzone` / `.sampler-dropzone.over` (`_session-inspector.scss:349-358`) — la dropzone ya no existe.

- [ ] **Step 3 — verificación visual (Playwright):** screenshot del inspector con un preset melódico (Sweep Pad) → filas alineadas, sin solapes.

- [ ] **Step 4 — commit:** `git commit -m "style(sampler): stack per-zone knob rack below each keymap row (stop the pile-up); drop dead dropzone CSS"`

### Task A4: estilar el picker de familias + controles de import

**Files:** Modify `src/styles/_session-inspector.scss`

- [ ] **Step 1 — añadir reglas** para `.sampler-family-row` (flex, gap, label en mayúsculas como el resto), `.sampler-family-select`, `.sampler-import-loop-btn`/`.sampler-import-samples-btn` (mismo look que los botones del inspector, ancho contenido, no barras a sangre completa), `.sampler-loop-hint` (texto tenue). Tomar tokens de las reglas existentes del inspector.

- [ ] **Step 2 — commit:** `git commit -m "style(sampler): style the 3-family picker + import controls"`

---

## Parte B — necesita decisión de diseño (NO implementar a ciegas)

El mockup ([sampler-ui.html](../../../.superpowers/brainstorm/39946-1780156939/content/sampler-ui.html)) es un **wireframe** del 30-may, no un diseño final. Antes de un plan detallado de la parte visual hace falta cerrar:

- **B1 · Reconciliar per-zona vs mockup limpio.** El mockup muestra filas de keymap **compactas** (nombre + root + rango + ✕) + un **mini-teclado** de colores, **sin** knobs per-zona a la vista. Pero el control per-pad/zona es una feature deliberada ([per-pad control](./2026-06-04-sampler-per-pad-control.md)). **Decisión:** ¿los knobs per-zona van (a) colapsados tras un expander por zona, (b) en una fila propia siempre (Task A3), o (c) fuera de la lista, en un panel del zona seleccionada? + ¿añadimos el mini-teclado del mockup?
- **B2 · Editor de clip con forma de onda (panel derecho del mockup).** Trim arrastrable (inicio/fin) + toggle **Loop/Tema** + campos BPM/ajuste/velocidad. Hoy `clip-waveform-header` pinta la waveform **display-only**. **Decisión:** ¿se añade trim arrastrable + modo Loop/Tema ahora? (Es la Duda (d) del spec + parte de la (c).)
- **B3 · Dudas abiertas del spec:** (c) UI de trim/warp para el **audio lane** (WAV puro), (e) reparto automático multi-zona en el import multi-muestra. Siguen pendientes de tu decisión.

> Recomendación: ejecutar **Parte A** ya (arregla el bug visible + el amontonamiento), y abrir una sesión corta de **brainstorming** para B1/B2 (con companion visual) que produzca su propio plan detallado.

---

## Self-review

- **Cobertura del spec:** A1 cubre §3/§5 "CARGAR PRESET LOOP" (lo único crítico que faltaba). A2 cubre §3 "vista de loop = banco informativo". A3/A4 cubren la presentación que el spec dejó fuera (era "fuera de alcance / Frente E" pero rompe la UX → se aborda aquí). B1-B3 son las Dudas explícitamente pendientes.
- **Sin placeholders en Parte A:** A1 lleva el código real del método + el evento; A2/A3 llevan el cambio exacto de guarda y de CSS.
- **Consistencia de tipos:** `fetchInstrumentManifest`/`loadInstrument`/`sliceBuffer`/`slicesToKeymap`/`buildSliceClip`/`installSamplerClip`/`mirrorInstrumentId` ya existen con esas firmas (verificado en el código). `newSampleId`/`buildSampleAsset`/`audioBufferToWavBytes` ya se importan en `session-host.ts` (los usa `importLoopToSampler`).
