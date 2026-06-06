# Frente E · Editores de clips — Spec de diseño

**Fecha:** 2026-06-06
**Frente:** E (del [índice maestro del overhaul UX](2026-06-06-loom-ux-overhaul-overview.md))
**Estado:** spec de diseño CORREGIDO tras la revisión adversarial y el [documento de coordinación transversal](2026-06-06-coordinacion-frentes.md). Pendiente → plan → implementación.
**Ámbito de código:** `src/session/clip-editors/**`, `src/session/session-inspector.ts`, `src/core/pianoroll.ts`, `src/core/piano-roll-editing.ts`, `src/core/drum-grid-editing.ts`, `index.html` (fila del inspector), SCSS asociado.

> **Correcciones aplicadas en esta revisión** (ver [hallazgos del frente E](2026-06-06-loom-review-findings.md) §«Frente E»):
> - **E1/E4** — *premisa falsa «Copy copia solo las notas»*: el handler `#insp-copy` hace `JSON.parse(JSON.stringify(clip))` (clip ENTERO), no `clip.notes` (verificado en `session-inspector.ts:163`). El reetiqueta a «Copy notes» SIN tocar el handler sería deshonesto. **Decisión:** ajustar el handler a copiar solo `clip.notes` para que el rótulo diga la verdad.
> - **E3** — *e2e del clip de audio supuestamente no ejecutable*: la premisa «no hay forma de tener una lane audio en e2e» es FALSA. `tests/e2e/audio-channel.spec.ts` crea una lane audio en boot vía `input.session-add-audio-input` + un WAV generado en memoria (`loopWav()`). El frente E reusa ese patrón; NO hace falta un fixture en `public/demos/`.
> - **E4** — *primer-click no-op del toggle de vista*: el handler alterna sobre el OVERRIDE almacenado (`cur = override ?? null`), no sobre el editor resuelto; en un lane melódico sin override el primer click es no-op. Se corrige basando el toggle en el editor RESUELTO.
> - **Leyenda de teclado incompleta** (BAJA): `PIANO_KEY_LEGEND` debe incluir Ctrl+A/C/X/V, Esc y ↑/↓ (con selección nudge/transponen), no solo notas+z/x+1/2. Verificado en `pianoroll.ts:565-666`.
> - **E2 / orden E↔D**: resuelto por el doc de coordinación §3 — **D ejecuta PRIMERO** (quita el slicing del audio lane), E construye encima. Propietario por archivo fijado. E **no toca** `onSliceToBank` ni el botón Slice.
> - **Octava real arranca en C4** (`octaveBase = …60…`, `pianoroll.ts:171`), no «C3» como decía el spec anterior.

---

## Objetivo

Aclarar los dos editores de clip (piano-roll de notas y drum-grid de percusión) que hoy **mezclan conceptos** (transporte/launch vs. edición de contenido), tienen **exceso de texto** y muestran **controles que no aplican** al tipo de clip abierto. La meta es una barra de edición que:

1. **Separe** el *launch-quantize* (transporte: cuándo se lanza el clip) de las acciones de edición (qué hay dentro del clip).
2. **Diga la verdad** en sus etiquetas: lo que copia/pega notas debe llamarse "notas", no "clip" — y para ello el handler de Copy debe **copiar solo `clip.notes`** (no el clip entero, como hace hoy).
3. **Muestre solo lo relevante** por tipo de clip (notas melódicas / percusión / audio), en vez de 10 botones siempre visibles.
4. **Unifique** el control "de rejilla" entre piano-roll (octava) y drum-grid (resolución) bajo un mismo patrón visual.
5. **Anuncie en la UI** los atajos hoy ocultos (octava con z/x, teclado de ordenador a-s-d-f… para introducir notas, y los atajos de edición Ctrl+A/C/X/V, Esc, flechas) en vez de mantenerlos invisibles.
6. **Elimine el texto estático duplicado** de la cabecera de audio (`BPM 120` / `1 bar`) que repite `Length (bars)` del inspector.

No se cambia el modelo de datos (`SessionClip`, `NoteEvent`) ni la lógica DSP. Es una reorganización de UI + reetiquetado + visibilidad condicional + un ajuste mínimo del handler de Copy.

---

## Alcance

### Qué entra

- **Reetiquetar Y corregir Copy** "Copy Clip" / "Paste (Replace)" / "Paste (Layer)" → vocabulario "notas". El reetiqueta del botón va acompañado de un **cambio en el handler de Copy** para que copie solo `clip.notes` (no el clip entero) — así el rótulo "Copy notes" es honesto. Paste-replace/layer ya leen `clipClipboard.notes`, así que siguen funcionando con un clipboard que ahora guarda solo notas. [session-inspector.ts:162-167, 260-289](../../../src/session/session-inspector.ts); [index.html:332-334](../../../index.html).
- **Mover** el control "Quantize" (que es `clip.launchQuantize`, lanzamiento) **fuera** de la barra de edición a una zona de **transporte/lanzamiento** del clip, separada visualmente de la edición. [session-inspector.ts:118,138-144](../../../src/session/session-inspector.ts); [index.html:321-331](../../../index.html).
- **Repensar "↔ Editor"**: el override por-clip de piano-roll↔drum-grid pasa a ser un toggle de **vista** con etiqueta clara, basado en el editor RESUELTO (no en el override almacenado) para que el primer click siempre cambie algo. Visible **solo cuando tiene sentido**. [session-inspector.ts:168-175, 295-297](../../../src/session/session-inspector.ts); [clip-editor-router.ts:43-53](../../../src/session/clip-editors/clip-editor-router.ts).
- **Convertir "oct: C4"** (hoy `<span>` informativo) en un **control real** con botones ◂/▸ + etiqueta, alineado con el patrón del drum-grid. El default es **C4** (`octaveBase=60`), no C3. [pianoroll.ts:171, 178-188, 599-602](../../../src/core/pianoroll.ts).
- **Anunciar el teclado de ordenador y los atajos de edición**: una ayuda (botón "?"/popover) que documente, en el piano-roll, a-s-d-f…=notas, w-e-t-y-u=alteraciones, z/x=octava, 1/2=herramienta, **Ctrl+A=seleccionar todo, Ctrl+C/X/V=copiar/cortar/pegar, Esc=deseleccionar, ←/→=mover cursor o nudge, ↑/↓=transponer la selección, ⌫=borrar**. [piano-roll-editing.ts:10-22](../../../src/core/piano-roll-editing.ts); [pianoroll.ts:561-666](../../../src/core/pianoroll.ts).
- **Unificar** octava (piano-roll) y resolución (drum-grid) como **un mismo patrón visual de "control de rejilla"** en la misma posición de la barra. [pianoroll.ts:178-188](../../../src/core/pianoroll.ts); [clip-editor-drum-grid.ts:80-90](../../../src/session/clip-editors/clip-editor-drum-grid.ts).
- **Limpiar la cabecera de audio** (`renderAudioClipEditor`): quitar el texto estático `BPM` y `bars` (duplican `originalBpm`/`Length`). **El slicing/Warp del audio lane ya NO existe en este punto**: el frente D los retira ANTES (ver §Coordinación). E construye sobre una cabecera de audio ya despojada del slicing — E **solo** elimina los spans BPM/bars. [clip-waveform-header.ts:108-144](../../../src/session/clip-editors/clip-waveform-header.ts).
- **Visibilidad condicional de la barra del inspector**: dividir los controles fijos en grupos y mostrar solo los aplicables al **tipo de clip** (melódico / percusión / audio). [index.html:318-339](../../../index.html); [session-inspector.ts:108-194](../../../src/session/session-inspector.ts).
- Una **función pura** que clasifique el clip (`classifyClip(lane, clip) → 'notes' | 'drums' | 'audio'`) para decidir qué grupo de controles renderizar, testeable sin DOM (mismo patrón que `chooseClipEditor`/`isAudioClip`). [clip-editor-router.ts:43-58](../../../src/session/clip-editors/clip-editor-router.ts).

### Qué NO entra

- **No** se cambia `SessionClip` ni `saved-state-v3` (nada de nuevos campos persistidos; `launchQuantize`/`gridResolution` ya existen). [session.ts:42-66](../../../src/session/session.ts).
- **No** se toca la lógica DSP del scheduler ni cómo se reproduce un clip de audio/loop.
- **No** se reescribe la mecánica de edición del piano-roll/drum-grid (marquee, group-move, velocity lane, clipboard interno con Ctrl+C/V): se conserva tal cual. [pianoroll.ts:430-686](../../../src/core/pianoroll.ts); [clip-editor-drum-grid.ts:209-340](../../../src/session/clip-editors/clip-editor-drum-grid.ts).
- **No** se toca `onSliceToBank` ni el botón "✂ Slice → pads" ni el toggle "♺ Warp": **son propiedad del frente D**, que los retira del audio lane ANTES de que E actúe (coordinación §3). E nunca añade placeholders sobre `onSliceToBank`.
- **No** se elimina la lógica de override de editor; se reetiqueta/condiciona/corrige su botón.

---

## Coordinación con otros frentes (PRESCRIPTIVO)

Tomado del [documento de coordinación](2026-06-06-coordinacion-frentes.md) §3 y §6.

- **Orden E↔D: D PRIMERO, E DESPUÉS.** D elimina superficie (botón Slice, campo `onSliceToBank` de `ClipEditorDeps` línea 31 y de `AudioClipEditorDeps` línea 104, y reescribe `clip-waveform-header.test.ts` + `tests/e2e/audio-channel.spec.ts`). E reorganiza lo que queda. Si E fuese primero con placeholders sobre `onSliceToBank`, D los borraría → conflicto.
- **Propietario por cambio (sin solapamiento de líneas):**

  | Archivo | Cambio | Propietario |
  |---|---|---|
  | `clip-editor-router.ts` | quitar `onSliceToBank?` de `ClipEditorDeps` y de la llamada a `renderAudioClipEditor` | **D** |
  | `clip-editor-router.ts` | `classifyClip` + toggle de vista honesto / routing | **E** |
  | `clip-waveform-header.ts` | quitar botón `.audio-clip-slice` + `AudioClipEditorDeps.onSliceToBank` + toggle Warp | **D** |
  | `clip-waveform-header.ts` | quitar los spans BPM/bars de la cabecera de audio | **E** |
  | `clip-waveform-header.test.ts` | reescribir (ya no hay botón Slice **ni** label BPM) | **D escribe la base; E confirma que el test no afirma BPM** |
  | `tests/e2e/audio-channel.spec.ts` | reescribir/eliminar el flujo Slice→pads | **D** |

- **Regla de oro:** E **no toca** `onSliceToBank` ni el botón Slice (habrán desaparecido por D). D **no toca** la presentación de BPM/bars (es de E). Como D ya reescribe `clip-waveform-header.test.ts` al quitar el botón Slice, ese test dejará de afirmar `120`/BPM en la misma pasada; E **verifica** ese punto (no reescribe el archivo entero) y, si D dejó la aserción de BPM, E la elimina.
- **`session-inspector.ts:217-219`** hoy construye `onSliceToBank` en `editorDeps`. Como D retira ese campo de `ClipEditorDeps`, E **elimina** ese bloque del `editorDeps` al integrar (ya no existe el tipo). Esto es consecuencia mecánica de que D va primero; no es trabajo de diseño de E.

---

## Diseño

### 1. Modelo conceptual: tres tipos de clip, dos planos

Un clip pertenece a **uno de tres tipos**, derivado del lane + el contenido del clip (no es un campo nuevo, se calcula):

| Tipo | Condición (pura) | Editor | Controles de rejilla |
|------|------------------|--------|----------------------|
| **`notes`** (melódico) | lane no-audio + editor resuelto `piano-roll` | piano-roll | **Octava** (teclado de ordenador) |
| **`drums`** (percusión) | editor resuelto `drum-grid` (drums-machine, o sampler con `drumkitId`) | drum-grid | **Resolución** (1/4…1/32, triplets, free) |
| **`audio`** (WAV/loop) | `isAudioClip(lane, clip)` (lane `audio` + `sample` + sin notas) | waveform-only | (sin rejilla de notas) |

La clasificación se centraliza en una **función pura nueva** en `clip-editor-router.ts`:

```
export type ClipKind = 'notes' | 'drums' | 'audio';
export function classifyClip(lane, clip, engineEditor, override): ClipKind
```

Reusa `isAudioClip` y `chooseClipEditor` (ya existentes) para no duplicar la precedencia override→drumkit→engine→piano-roll. El orden importa: **audio se comprueba ANTES** (un audio-clip nunca se clasifica por editor). [clip-editor-router.ts:43-58](../../../src/session/clip-editors/clip-editor-router.ts).

Y **dos planos** de UI claramente separados en la barra del inspector:

- **Plano de transporte/lanzamiento** (propiedades del clip *como objeto en la sesión*): **Name**, **Length (bars)**, **Launch Quantize**, **Duplicate**, **Delete**. Aplican a **todos** los tipos.
- **Plano de edición de contenido** (lo que hay *dentro* del clip): **Copy/Paste notas**, **🎲 Notes** (randomize), control de **rejilla** (octava o resolución), **vista** (toggle piano↔grid), **ayuda de teclado**. Aplican **según el tipo**.

### 2. Reorganización de la barra del inspector

Hoy `index.html:318-339` es una sola `.session-inspector-row` con 10 hijos planos. Orden real verificado: Name, Length, Quantize, Copy Clip, Paste (Replace), Paste (Layer), Duplicate, ↔ Editor, 🎲 Notes, Delete. Se reorganiza en **dos sub-filas semánticas** dentro del mismo `#session-inspector`:

```
#session-inspector
├─ #insp-transport-row  .clip-transport-row   (siempre visible, todos los tipos)
│   ├─ label Name        → #insp-name
│   ├─ label Length      → #insp-length
│   ├─ label Launch      → #insp-quantize        (movido aquí; ya NO en la barra de edición)
│   ├─ button Duplicate  → #insp-duplicate
│   └─ button Delete     → #insp-delete
├─ #insp-edit-row  .clip-edit-row              (condicional por tipo de clip)
│   ├─ [notes|drums] Copy notes / Paste ▸ Replace / Layer  → #insp-copy / #insp-paste-replace / #insp-paste-layer
│   ├─ [notes|drums] 🎲 Notes                              → #insp-random-notes
│   └─ [notes|drums] toggle de vista piano↔grid → #insp-toggle-editor (condicional, ver §4)
└─ #insp-roll-host (editor + automation lanes, sin cambios estructurales)
```

> El control de rejilla (octava/resolución) **NO va en el inspector**: vive en la toolbar del propio editor (donde ya está la resolución del drum-grid hoy). Lo que se unifica es el **patrón visual**, no la ubicación (ver §3). Por eso no aparece en `#insp-edit-row`.

**Visibilidad:** `openInspector()` calcula `classifyClip(...)` y aplica `hidden` a `#insp-edit-row`:

- `audio` → `#insp-edit-row` oculta entera (un clip de audio no tiene notas que copiar ni rejilla); el editor de audio es solo waveform (§6).
- `notes`/`drums` → `#insp-edit-row` visible; el control de rejilla y el toggle de vista viven en la **toolbar del propio editor** (pr-toolbar / drum-toolbar), que ya existe.

> **Selectores con id estable:** se dan ids a las dos filas (`#insp-transport-row`, `#insp-edit-row`) además de la clase, para que el e2e seleccione de forma robusta (la revisión señaló selectores frágiles en otros frentes).

Esto reduce la barra del inspector de **10 controles fijos** a **5 fijos (transporte) + 4 condicionales (edición)**, y saca del inspector todo lo que es "edición interna" del editor.

### 3. Control de rejilla unificado: octava (piano-roll) ↔ resolución (drum-grid)

Hoy:
- Piano-roll: `octLabel` es un `<span>` informativo (`oct: C4`), la octava solo se cambia con z/x ocultas. `octaveBase` arranca en `60` (C4). [pianoroll.ts:171, 178-184, 599-602](../../../src/core/pianoroll.ts).
- Drum-grid: `resSel` es un `<select>` funcional, montado **plano** en la toolbar (no a la derecha). [clip-editor-drum-grid.ts:80-90](../../../src/session/clip-editors/clip-editor-drum-grid.ts).

**Propuesta:** ambos comparten un patrón visual de **"grid-control"** en la misma posición de su toolbar (a la derecha, donde hoy va `octLabel` con `margin-left:auto`):

- **Piano-roll → control de octava activo:** sustituir el `<span>` por un grupo `◂ [C4] ▸` (dos botones + etiqueta) que muta `octaveBase` igual que las teclas z/x. Clicar ▸ = subir octava (= tecla `x`), ◂ = bajar (= tecla `z`). Se extrae un helper de clamping compartido entre los botones y z/x (`octaveBase = Math.max(minMidi, Math.min(maxMidi-12, octaveBase ± 12))`, fórmula real de [pianoroll.ts:600](../../../src/core/pianoroll.ts)). Mantener z/x como atajos (ahora **anunciados**).
- **Drum-grid → resolución:** se mantiene el `<select>`; se le antepone una etiqueta "Grid", se le aplica la misma clase y se ancla a la derecha (`margin-left:auto` en el contenedor) para igualar el patrón del piano-roll (hoy va plano).

> El piano-roll y el drum-grid son módulos independientes; **no** se factoriza un componente compartido (sería sobre-ingeniería para dos botones + un select). La "unificación" es de **estilo y posición**, mediante una clase SCSS común `.editor-grid-control`.

### 4. "↔ Editor" → toggle de vista, condicional, honesto y SIN primer-click no-op

Hoy `↔ Editor` (`#insp-toggle-editor`) alterna `editorOverride` con `cur === 'piano-roll' ? 'drum-grid' : 'piano-roll'`, partiendo de `cur = editorOverride.get(clip.id) ?? null`. **Bug verificado (E4):** en un lane melódico puro sin override, `cur=null → next='piano-roll'` = el editor ya activo → el primer click no cambia nada visible. [session-inspector.ts:168-175](../../../src/session/session-inspector.ts).

**Propuesta:**
- **Basar el toggle en el editor RESUELTO, no en el override almacenado.** Calcular `const resolved = chooseClipEditor(lane, getEngine(lane.engineId)?.editor, editorOverride.get(clip.id))`; el siguiente estado es `resolved === 'piano-roll' ? 'drum-grid' : 'piano-roll'`. Así el primer click SIEMPRE conmuta respecto a lo que se ve, sin importar si había override.
- **Rótulo dinámico** según el editor resuelto: si resuelve `drum-grid` → botón **"Ver como piano-roll"**; si resuelve `piano-roll` → **"Ver como rejilla"** (dice a qué se cambia). Tooltip: "Cambia cómo se EDITA este clip; no cambia el sonido."
- **El rótulo se recalcula tras el click**: como el `onclick` llama a `renderEditor` (no a `openInspector`), se extrae el cálculo del rótulo a un método `refreshToggleLabel()` llamado tanto en `openInspector` como al final del `onclick`.
- **Visibilidad condicional:** solo aparece para `notes` y `drums` (oculto para `audio`). Esta condición es una **duda real** abierta (ver Dudas).

### 5. Anunciar el teclado de ordenador y los atajos de edición (obs. 4 y 5)

El mapa de teclas existe y funciona pero es invisible. Set REAL verificado en `pianoroll.ts`:
- a-s-d-f-g-h-j-k = blancas (C-D-E-F-G-A-B-C), w-e-t-y-u = negras [piano-roll-editing.ts:10-12](../../../src/core/piano-roll-editing.ts).
- z/x = octava ([pianoroll.ts:599-602](../../../src/core/pianoroll.ts)); 1/2 = herramienta draw/select ([561-562](../../../src/core/pianoroll.ts)).
- **Ctrl+A = seleccionar todo (565); Ctrl+C/X/V = copiar/cortar/pegar (570-594); Esc = deseleccionar (596); ←/→ = mover cursor (sin selección) o nudand (con selección); ↑/↓ = transponer la selección (654-666); ⌫ = borrar selección o última nota.**

**Propuesta (mínima, sin robar espacio):** un botón **"?"** en la toolbar del editor que despliega un `title`/popover con la leyenda COMPLETA:

```
Teclado:  a s d f g h j k = notas (C…C) · w e t y u = sostenidos
          z / x = octava abajo/arriba · 1 / 2 = lápiz / selección
          Ctrl+A = seleccionar todo · Ctrl+C / X / V = copiar / cortar / pegar
          Esc = deseleccionar · ←/→ = mover cursor (o nudge con selección)
          ↑/↓ = transponer selección · ⌫ = borrar
```

- En el **piano-roll** la leyenda incluye el teclado de notas + todos los atajos de edición; en el **drum-grid** (sin teclado de notas) incluye 1/2 + flechas (←/→ mover, ↑/↓ cambiar voz) + Ctrl+A/C/X/V + Esc + ⌫ (set real, [clip-editor-drum-grid.ts:300-340](../../../src/session/clip-editors/clip-editor-drum-grid.ts)).
- El texto vive como constante junto al mapa de teclas (`PIANO_KEY_LEGEND` en `piano-roll-editing.ts`; `DRUM_KEY_LEGEND` junto al drum-grid) para que UI y comportamiento no diverjan.
- **Test de coherencia reforzado:** debe comprobar no solo las teclas de notas + z/x/1/2, sino también que `Ctrl+A`, `Ctrl+C`, `Ctrl+X`, `Ctrl+V`, `Esc` y las flechas estén mencionadas en `PIANO_KEY_LEGEND` (la revisión señaló que el test anterior pasaría con una leyenda incompleta).

### 6. Cabecera de audio: quitar texto estático duplicado (obs. 7)

Tras el paso de D, `renderAudioClipEditor` ya **no tiene** botón Slice ni toggle Warp. Lo que queda y E retira:

**Propuesta:**
- **Eliminar** los `<span>` `BPM …` (118-122) y `… bar(s)` (123-124): el BPM detectado ya vive en `clip.sample.originalBpm` (no editable aquí, no accionable) y la longitud está en `Length (bars)` del inspector — son **texto estático duplicado**.
- Si tras quitar los spans (y tras la retirada de Slice/Warp por D) la `toolbar` queda vacía, **no montarla**: dejar `renderAudioClipEditor` como **solo waveform** (`mountWaveformHeader`).
- La eliminación de los spans BPM/bars es **duplicación pura e independiente de D**, así que entra sí o sí.

`mountWaveformHeader` (el strip de waveform sobre el editor de notas) **no cambia**: es display puro. [clip-waveform-header.ts:25-101](../../../src/session/clip-editors/clip-waveform-header.ts).

### 7. Copy honesto: copiar solo `clip.notes`

**Bug verificado (E1):** `#insp-copy` hace `clipClipboard = JSON.parse(JSON.stringify(clip))` — clona el clip ENTERO (id, name, lengthBars, sample, launchQuantize, gridResolution…), no solo las notas. Solo `pasteReplace`/`pasteLayer` leen `clipClipboard.notes`. [session-inspector.ts:162-167, 260-289](../../../src/session/session-inspector.ts).

**Propuesta:** para que el rótulo "Copy notes" sea honesto, el handler de Copy guarda **solo las notas**:

```
clipClipboard = { notes: JSON.parse(JSON.stringify(clip.notes ?? [])) };
```

- El tipo del clipboard module-level pasa de `SessionClip | null` a un objeto con solo `notes` (o se mantiene `Pick<SessionClip, 'notes'>`), porque ya nadie lee otros campos del clipboard.
- `pasteReplace`/`pasteLayer` siguen leyendo `clipClipboard.notes` sin cambios. [session-inspector.ts:267, 281-284](../../../src/session/session-inspector.ts).
- `updatePasteBtnState` habilita los botones de paste si hay notas en el clipboard (igual que hoy, solo cambia la forma del objeto).

### 8. Flujo de datos (sin cambios de modelo)

```
SessionInspector.openInspector()
  ├─ classifyClip(lane, clip, engine.editor, override)   ← NUEVO (puro)
  ├─ rellena #insp-transport-row (Name/Length/Launch/Dup/Del)  ← Launch movido aquí
  ├─ muestra/oculta #insp-edit-row según ClipKind              ← NUEVO (visibilidad)
  ├─ refreshToggleLabel()                                       ← NUEVO (rótulo del toggle, basado en editor resuelto)
  └─ renderEditor() → renderClipEditor(...)              ← sin cambios de firma
        ├─ audio  → renderAudioClipEditor (sin spans BPM/bars; sin Slice/Warp por D)  ← simplificado
        ├─ drums  → renderDrumGridEditor (toolbar: Draw/Select + GRID-control resolución + ? help)
        └─ notes  → buildPianoRoll → createPianoRoll (toolbar: Draw/Select + GRID-control OCTAVA activa + ? help)
```

- Copy ahora copia **solo `clip.notes`** (§7). Paste-replace/layer operan sobre `clip.notes` vía el clipboard, con `withUndo`. [session-inspector.ts:260-289](../../../src/session/session-inspector.ts).
- Launch-quantize sigue escribiendo `clip.launchQuantize` con `withUndo`; solo cambia su **ubicación visual** (transporte) — el id `#insp-quantize` no cambia, así que el cableado existente funciona. [session-inspector.ts:138-144](../../../src/session/session-inspector.ts).
- Toggle de vista: basado en el editor **resuelto** (no en el override). [§4].
- Octava: muta `octaveBase` (estado local del piano-roll), sin persistencia (igual que hoy). [pianoroll.ts:171, 600](../../../src/core/pianoroll.ts).
- Resolución: sigue persistiendo en `clip.gridResolution`. [clip-editor-drum-grid.ts:56-57, 89](../../../src/session/clip-editors/clip-editor-drum-grid.ts).

### 9. UI / estilo

- Nuevas clases `.clip-transport-row` y `.clip-edit-row` (reemplazan `.session-inspector-row`) en `_session-inspector.scss`, con un separador visual sutil entre planos. Migrar los selectores hijos (`label`, `input[type=text]`, `input[type=number]`) a ambas clases. [_session-inspector.scss:10-18](../../../src/styles/_session-inspector.scss).
- Clase compartida `.editor-grid-control` para octava/resolución (mismo look) — definida en el SCSS del editor o en `_session-inspector.scss`.
- `.editor-help-btn` (botón "?") y, si se usa popover, `.editor-help-popover`.
- Tooltips en español en todos los controles reetiquetados. (Sobre la mezcla rótulos-EN/tooltips-ES, ver Dudas reales.)
- El botón Delete del inspector adopta el aspa/confirmación del **frente A** (consistencia); E solo organiza su ubicación en la fila de transporte. La confirmación/aspa es de A.

---

## Archivos a tocar

| Archivo | Cambio |
|---------|--------|
| [src/session/clip-editors/clip-editor-router.ts](../../../src/session/clip-editors/clip-editor-router.ts) | **Añadir** `classifyClip(lane, clip, engineEditor, override): ClipKind` (puro, reusa `isAudioClip`+`chooseClipEditor`). Exportar `ClipKind`. NO tocar `onSliceToBank` (lo retira D antes). Sin cambios en `renderClipEditor`. |
| [src/session/session-inspector.ts](../../../src/session/session-inspector.ts) | `openInspector()` (108-194): leer `classifyClip`, mostrar/ocultar `#insp-edit-row`; `refreshToggleLabel()` basado en editor resuelto; **corregir el handler de Copy a copiar solo `clip.notes`** (§7); corregir el toggle para basarse en el editor resuelto (§4). Eliminar el bloque `onSliceToBank` de `editorDeps` (217-219) — el tipo ya no existe tras D. |
| [index.html](../../../index.html) (318-339) | Reestructurar `#session-inspector` en `#insp-transport-row .clip-transport-row` (Name/Length/**Launch**/Duplicate/Delete) y `#insp-edit-row .clip-edit-row` (Copy/Paste **notas**/🎲 Notes/toggle vista). Mover `#insp-quantize` a transporte. Reetiquetar `#insp-copy`→"Copy notes", `#insp-paste-replace`→"Paste ▸ Replace", `#insp-paste-layer`→"Paste ▸ Layer", `#insp-toggle-editor` rótulo dinámico (vacío en HTML, lo pone JS). Etiqueta "Launch" en vez de "Quantize". |
| [src/core/pianoroll.ts](../../../src/core/pianoroll.ts) (171-188, 599-602) | Sustituir `octLabel` (span informativo) por un **grid-control de octava** real (◂ [C4] ▸) que llama a la misma mutación que z/x (helper de clamping compartido). Añadir botón **"?"** con la leyenda COMPLETA. Aplicar clase `.editor-grid-control`. |
| [src/core/piano-roll-editing.ts](../../../src/core/piano-roll-editing.ts) (10-22) | **Exportar `KEY_SEMITONES`** (hoy es module-local) para que el test lo lea. **Añadir** y exportar `PIANO_KEY_LEGEND` con la leyenda COMPLETA (notas + z/x + 1/2 + Ctrl+A/C/X/V + Esc + flechas). Opcional: helper puro `clampOctaveBase` si se extrae. |
| [src/session/clip-editors/clip-editor-drum-grid.ts](../../../src/session/clip-editors/clip-editor-drum-grid.ts) (80-90) | Aplicar clase `.editor-grid-control` + etiqueta "Grid" al `resSel` y anclarlo a la derecha (hoy va plano). Añadir botón **"?"** con `DRUM_KEY_LEGEND` (1/2, ←/→ mover, ↑/↓ cambiar voz, Ctrl+A/C/X/V, Esc, ⌫; sin teclado de notas). |
| [src/session/clip-editors/clip-waveform-header.ts](../../../src/session/clip-editors/clip-waveform-header.ts) (108-144) | En `renderAudioClipEditor` (ya despojado de Slice/Warp por D): **eliminar** los spans `BPM …` y `… bar(s)`. Si la toolbar queda vacía, no montarla (solo `mountWaveformHeader`). NO tocar `onSliceToBank`/`.audio-clip-slice` (los retira D). `mountWaveformHeader` intacto. |
| [src/styles/_session-inspector.scss](../../../src/styles/_session-inspector.scss) (10-18) | Reemplazar `.session-inspector-row` por `.clip-transport-row` + `.clip-edit-row` con separación visual. Añadir `.editor-grid-control` y `.editor-help-btn`/`.editor-help-popover`. |

### Tests a crear/actualizar

| Archivo | Cambio |
|---------|--------|
| [src/session/clip-editors/clip-editor-router.test.ts](../../../src/session/clip-editors/clip-editor-router.test.ts) | **Añadir** `describe('classifyClip')`: melódico→`notes`, drums-machine→`drums`, sampler+drumkit→`drums`, audio-clip→`audio`, override piano-roll sobre drumkit→`notes`. |
| `src/core/piano-roll-editing.test.ts` (existe) | Test de coherencia: cada tecla de `KEY_SEMITONES` aparece en `PIANO_KEY_LEGEND`; además `z`, `x`, `1`, `2`, **`Ctrl+A`/`Ctrl+C`/`Ctrl+X`/`Ctrl+V`, `Esc`, `←`/`→`, `↑`/`↓`** mencionados. |
| `src/session/session-inspector.test.ts` (existe o NUEVO; jsdom) | Test del Copy honesto: tras llamar al handler de Copy, el clipboard contiene SOLO `notes` (no `name`/`sample`/`launchQuantize`). Requiere `// @vitest-environment jsdom` (vitest es `node` por defecto). |
| `clip-waveform-header.test.ts` | **Propietario D** (lo reescribe al quitar Slice). E **verifica** que tras su cambio ya no se afirma `120`/BPM. |
| `tests/e2e/clip-editor-inspector.spec.ts` (NUEVO) | Playwright: ver Plan de pruebas. La lane audio se crea con el patrón de `audio-channel.spec.ts` (`input.session-add-audio-input` + WAV en memoria). |

---

## Plan de pruebas

### Unit (Vitest)

1. **`classifyClip`** (sin DOM) — los 5 casos de la tabla §1 (espejo de los tests de `chooseClipEditor`/`isAudioClip`, mismo fixture `lane(...)`). [clip-editor-router.test.ts:6-49](../../../src/session/clip-editors/clip-editor-router.test.ts).
2. **Leyenda de teclado coherente** (sin DOM) — toda tecla de `KEY_SEMITONES` está en `PIANO_KEY_LEGEND`; z/x, 1/2, **Ctrl+A/C/X/V, Esc, ←/→, ↑/↓** también. Detecta drift UI↔comportamiento.
3. **Octava (regresión)** (sin DOM, si se extrae el helper) — el clamping del grid-control es el mismo `Math.max(minMidi, Math.min(maxMidi-12, octaveBase±12))` que z/x.
4. **Copy honesto** (jsdom, `// @vitest-environment jsdom`) — tras el handler de Copy, el clipboard tiene `notes` y NO `name`/`sample`/`launchQuantize`.

### Playwright (e2e) — `tests/e2e/clip-editor-inspector.spec.ts`

Reusa el patrón de [clip-click.spec.ts](../../../tests/e2e/clip-click.spec.ts) (`waitForBoot`, clic en `.session-cell-filled`). Para el clip de **audio**, reusa el patrón de [audio-channel.spec.ts](../../../tests/e2e/audio-channel.spec.ts): `input.session-add-audio-input` + un WAV generado en memoria. **Recordatorio:** `npm run build` antes de `npm run test:e2e`.

1. **Separación transporte vs edición** — abrir un clip melódico: `#insp-quantize` (Launch) está en `#insp-transport-row` y **no** en `#insp-edit-row`; Name/Length/Duplicate/Delete también en transporte.
2. **Visibilidad por tipo** —
   - Clip melódico → `#insp-edit-row` visible con Copy notes / 🎲 Notes; toolbar del editor muestra el grid-control de **octava** (texto `C…`).
   - Clip de percusión (lane drums-machine de un demo, o sampler-drumkit) → toolbar muestra el grid-control de **resolución** (`<select>` con "Grid"); `#insp-edit-row` visible.
   - Clip de **audio** (creado con `input.session-add-audio-input`) → `#insp-edit-row` **oculta** (`hidden`); la cabecera de audio **no** contiene texto `BPM`/`bar`.
3. **Rótulos honestos** — `#insp-copy` lee "Copy notes"; paste-replace/layer leen "Paste ▸ …"; tooltip del toggle menciona "no cambia el sonido".
4. **Octava operable por UI** — clicar ▸ del grid-control de octava cambia la etiqueta (p.ej. C4→C5) sin teclado; pulsar `x` produce el mismo cambio (paridad UI↔atajo).
5. **Toggle de vista honesto (sin primer-click no-op)** — en un clip melódico, el botón lee "Ver como rejilla"; **un solo click** cambia el editor a drum-grid y el rótulo pasa a "Ver como piano-roll". (Verifica el fix de E4.)
6. **Ayuda de teclado descubrible** — el botón "?" existe en la toolbar y, al activarlo (o vía `title`), muestra la leyenda (contiene "a s d f" en piano-roll y, p.ej., "Ctrl+A").
7. **Launch-quantize sigue funcionando** — cambiar Launch a "1 bar" (value `1/1`) persiste en `clip.launchQuantize` (verificable reabriendo el inspector y comprobando el `value` del select); undo (Ctrl+Z) lo revierte.

### Verificación manual / regresión

- `npx tsc --noEmit` limpio.
- `npm run test:unit` verde (re-run si `ERR_IPC_CHANNEL_CLOSED` en teardown — flaky conocido).
- `npm run build` + `npm run test:e2e` verde.
- Smoke en navegador (`http://localhost:5173`): abrir un clip de cada tipo, confirmar que la barra solo muestra lo aplicable, que octava/resolución se leen igual, y que la cabecera de audio ya no repite BPM/Length; que Copy notes copia solo notas; que el toggle cambia al primer click.

---

## Dudas reales (decisiones pendientes del usuario)

> Solo quedan aquí decisiones LEGÍTIMAS de UX/copy que la revisión no resolvió. Las "dudas acopladas a D" y la posición del grid-control YA están decididas (ver Coordinación / §3) y NO se listan como dudas.

1. **Condición de visibilidad del toggle de vista** (piano↔grid): propuesta = visible para `notes` y `drums`, oculto para `audio`. Alternativa más estricta: solo para percusión (`drums`), donde tiene más sentido editar como piano-roll. ¿Mostrarlo también en lanes melódicos puros? (El fix del primer-click-no-op ya está decidido; esto es solo a quién se le muestra.)
2. **Forma de la ayuda de teclado**: botón "?" con popover (propuesta, mínimo espacio) o una leyenda permanente bajo la toolbar (más descubrible, más ruido). ¿Cuál?
3. **¿Botón de octava o `<select>`?** Propuesta: ◂ [C4] ▸. Alternativa: un `<select>` de octavas (paridad literal con el `<select>` de resolución del drum-grid). El select unificaría más el patrón pero cambia la interacción del piano-roll.
4. **Idioma de los rótulos de botón**: el spec fija rótulos en inglés ("Copy notes", "Paste ▸ Replace", "Launch") con tooltips en español. Dado el énfasis del usuario en castellano, ¿se traducen también los rótulos de botón ("Copiar notas", "Pegar ▸ Reemplazar", "Lanzamiento")? Decisión de copy, no técnica.
