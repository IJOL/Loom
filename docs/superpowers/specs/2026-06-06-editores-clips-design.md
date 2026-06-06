# Frente E · Editores de clips — Spec de diseño

**Fecha:** 2026-06-06
**Frente:** E (del [índice maestro del overhaul UX](2026-06-06-loom-ux-overhaul-overview.md))
**Estado:** spec de diseño. Pendiente → plan → implementación.
**Ámbito de código:** `src/session/clip-editors/**`, `src/session/session-inspector.ts`, `src/core/pianoroll.ts`, `src/core/piano-roll-editing.ts`, `src/core/drum-grid-editing.ts`, `index.html` (fila del inspector), SCSS asociado.

---

## Objetivo

Aclarar los dos editores de clip (piano-roll de notas y drum-grid de percusión) que hoy **mezclan conceptos** (transporte/launch vs. edición de contenido), tienen **exceso de texto** y muestran **controles que no aplican** al tipo de clip abierto. La meta es una barra de edición que:

1. **Separe** el *launch-quantize* (transporte: cuándo se lanza el clip) de las acciones de edición (qué hay dentro del clip).
2. **Diga la verdad** en sus etiquetas: lo que copia/pega notas debe llamarse "notas", no "clip".
3. **Muestre solo lo relevante** por tipo de clip (notas melódicas / percusión / audio), en vez de 10 botones siempre visibles.
4. **Unifique** el control "de rejilla" entre piano-roll (octava) y drum-grid (resolución) bajo un mismo patrón visual.
5. **Anuncie en la UI** los atajos hoy ocultos (octava con z/x, teclado de ordenador a-s-d-f… para introducir notas) en vez de mantenerlos invisibles.
6. **Elimine el texto estático duplicado** de la cabecera de audio (`BPM 120` / `1 bar`) que repite `Length (bars)` del inspector, y saque del "editor" lo que es un acto de transporte/importación (Slice → pads, Warp).

No se cambia el modelo de datos (`SessionClip`, `NoteEvent`) ni la lógica DSP. Es una reorganización de UI + reetiquetado + visibilidad condicional.

---

## Alcance

### Qué entra

- **Reetiquetar** "Copy Clip" / "Paste (Replace)" / "Paste (Layer)" → vocabulario "notas" (copian/pegan `clip.notes`, no el clip entero). [session-inspector.ts:162-167, 260-289](../../../src/session/session-inspector.ts); [index.html:332-334](../../../index.html).
- **Mover** el control "Quantize" (que es `clip.launchQuantize`, lanzamiento) **fuera** de la barra de edición a una zona de **transporte/lanzamiento** del clip, separada visualmente de la edición. [session-inspector.ts:118,138-144](../../../src/session/session-inspector.ts); [index.html:321-331](../../../index.html).
- **Repensar "↔ Editor"**: el override por-clip de piano-roll↔drum-grid pasa a ser un toggle de **vista** con etiqueta clara, visible **solo cuando tiene sentido** (un clip de percusión que el usuario quiera ver/editar como piano-roll, o viceversa). [session-inspector.ts:168-175, 295-297](../../../src/session/session-inspector.ts); [clip-editor-router.ts:43-53](../../../src/session/clip-editors/clip-editor-router.ts).
- **Convertir "oct: C3"** (hoy `<span>` informativo) en un **control real** con botones ◂/▸ (o ±octava) + etiqueta, alineado con el patrón del drum-grid. [pianoroll.ts:178-188, 599-602](../../../src/core/pianoroll.ts).
- **Anunciar el teclado de ordenador**: una ayuda (icono "?"/tooltip o leyenda compacta) que documente a-s-d-f…=notas, w-e-t-y-u=alteraciones, z/x=octava, 1/2=herramienta. [piano-roll-editing.ts:10-22](../../../src/core/piano-roll-editing.ts).
- **Unificar** octava (piano-roll) y resolución (drum-grid) como **un mismo componente de "control de rejilla"** en la misma posición de la barra (un selector + ayuda), para que se perciban como el mismo tipo de control. [pianoroll.ts:178-188](../../../src/core/pianoroll.ts); [clip-editor-drum-grid.ts:80-90](../../../src/session/clip-editors/clip-editor-drum-grid.ts).
- **Limpiar la cabecera de audio** (`renderAudioClipEditor`): quitar el texto estático `BPM` y `bars` (duplican `originalBpm`/`Length`); decidir el destino de Warp y "Slice → pads" (ver Dudas abiertas — se sincroniza con el frente D). [clip-waveform-header.ts:108-144](../../../src/session/clip-editors/clip-waveform-header.ts).
- **Visibilidad condicional de la barra del inspector**: dividir los 10 controles fijos en grupos y mostrar solo los aplicables al **tipo de clip** (melódico / percusión / audio). [index.html:318-339](../../../index.html); [session-inspector.ts:108-194](../../../src/session/session-inspector.ts).
- Una **función pura** que clasifique el clip (`classifyClip(lane, clip) → 'notes' | 'drums' | 'audio'`) para decidir qué grupo de controles renderizar, testeable sin DOM (mismo patrón que `chooseClipEditor`/`isAudioClip`). [clip-editor-router.ts:43-58](../../../src/session/clip-editors/clip-editor-router.ts).

### Qué NO entra

- **No** se cambia `SessionClip` ni `saved-state-v3` (nada de nuevos campos persistidos; `launchQuantize`/`gridResolution` ya existen). [session.ts:42-66](../../../src/session/session.ts).
- **No** se toca la lógica DSP del scheduler ni cómo se reproduce un clip de audio/loop.
- **No** se reescribe la mecánica de edición del piano-roll/drum-grid (marquee, group-move, velocity lane, clipboard interno con Ctrl+C/V): se conserva tal cual. [pianoroll.ts:430-686](../../../src/core/pianoroll.ts); [clip-editor-drum-grid.ts:209-340](../../../src/session/clip-editors/clip-editor-drum-grid.ts).
- **No** se implementa el rediseño del Sampler/loops (frente D) — este spec solo **consume** la decisión sobre el destino de Slice/Warp; no la toma aquí.
- **No** se añade un editor de audio (trim/warp para WAV puro): tentativo y no fijado en el frente D (ver Dudas abiertas del índice).
- **No** se elimina la lógica de override de editor; se reetiqueta/condiciona su botón.

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

Reusa `isAudioClip` y `chooseClipEditor` (ya existentes) para no duplicar la precedencia override→drumkit→engine→piano-roll. [clip-editor-router.ts:43-58](../../../src/session/clip-editors/clip-editor-router.ts).

Y **dos planos** de UI claramente separados en la barra del inspector:

- **Plano de transporte/lanzamiento** (propiedades del clip *como objeto en la sesión*): **Name**, **Length (bars)**, **Launch Quantize**, **Duplicate**, **Delete**. Aplican a **todos** los tipos.
- **Plano de edición de contenido** (lo que hay *dentro* del clip): **Copy/Paste notas**, **🎲 Notes** (randomize), control de **rejilla** (octava o resolución), **vista** (toggle piano↔grid), **ayuda de teclado**. Aplican **según el tipo**.

### 2. Reorganización de la barra del inspector

Hoy `index.html:318-339` es una sola `.session-inspector-row` con 10 hijos planos. Se reorganiza en **dos sub-filas semánticas** dentro del mismo `#session-inspector`:

```
#session-inspector
├─ .clip-transport-row          (siempre visible, todos los tipos)
│   ├─ label Name        → #insp-name
│   ├─ label Length      → #insp-length
│   ├─ label Launch      → #insp-quantize        (movido aquí; ya NO en la barra de edición)
│   ├─ button Duplicate  → #insp-duplicate
│   └─ button ✕ Delete   → #insp-delete
├─ .clip-edit-row               (condicional por tipo de clip)
│   ├─ [notes|drums] Copy notes / Paste ▸ Replace / Layer  → #insp-copy / #insp-paste-replace / #insp-paste-layer
│   ├─ [notes|drums] 🎲 Notes                              → #insp-random-notes
│   ├─ [notes]  control de rejilla = OCTAVA (en la pr-toolbar, ver §3)
│   ├─ [drums]  control de rejilla = RESOLUCIÓN (en la drum-toolbar, ver §3)
│   ├─ [notes|drums] toggle de vista piano↔grid → #insp-toggle-editor (condicional, ver §4)
│   └─ [notes|drums] ayuda de teclado "?" (ver §5)
└─ #insp-roll-host (editor + automation lanes, sin cambios estructurales)
```

**Visibilidad:** `openInspector()` calcula `classifyClip(...)` y aplica `hidden`/`display` a `.clip-edit-row` y a sus grupos:

- `audio` → `.clip-edit-row` oculta entera (un clip de audio no tiene notas que copiar ni rejilla); el editor de audio trae su propia mini-barra (§6).
- `notes`/`drums` → `.clip-edit-row` visible; el control de rejilla y el toggle de vista viven en la **toolbar del propio editor** (pr-toolbar / drum-toolbar), que ya existe — así la octava/resolución quedan pegadas a su canvas, no flotando en el inspector.

> **Decisión de diseño:** el control de rejilla (octava/resolución) **se queda en la toolbar del editor** (donde ya está la resolución del drum-grid hoy), NO se sube al inspector. Lo que se unifica es el **patrón visual** (mismo componente "grid-control": etiqueta + selector + tooltip), no la ubicación. Esto resuelve la inconsistencia (obs. 6) sin mover el control de sitio en el drum-grid y subiendo el de octava al mismo nivel en el piano-roll.

Esto reduce la barra del inspector de **10 controles fijos** a **5 fijos (transporte) + 2-4 condicionales (edición)**, y elimina del inspector todo lo que es "edición interna" del editor.

### 3. Control de rejilla unificado: octava (piano-roll) ↔ resolución (drum-grid)

Hoy:
- Piano-roll: `octLabel` es un `<span>` informativo (`oct: C3`), la octava solo se cambia con z/x ocultas. [pianoroll.ts:178-184, 599-602](../../../src/core/pianoroll.ts).
- Drum-grid: `resSel` es un `<select>` funcional. [clip-editor-drum-grid.ts:80-90](../../../src/session/clip-editors/clip-editor-drum-grid.ts).

**Propuesta:** ambos comparten un patrón visual de **"grid-control"** en la misma posición de su toolbar (a la derecha, donde hoy va `octLabel` con `margin-left:auto`):

- **Piano-roll → control de octava activo:** sustituir el `<span>` por un grupo `◂ [C3] ▸` (dos botones + etiqueta) que muta `octaveBase` igual que las teclas z/x. Clicar ▸ = subir octava (= tecla `x`), ◂ = bajar (= tecla `z`). El `refreshToolbar()` ya recalcula la etiqueta; se añade el cableado de click reusando exactamente la fórmula de clamping de [pianoroll.ts:600](../../../src/core/pianoroll.ts). Mantener z/x como atajos (ahora **anunciados**, ya no ocultos).
- **Drum-grid → resolución:** se mantiene el `<select>`; solo se le aplica la misma clase/estilo y se le antepone una etiqueta "Grid" para que se lea como el mismo tipo de control.

Ambos llevan un `title`/tooltip con el atajo (octava: "z/x"; resolución: ninguno, es selector).

> El piano-roll y el drum-grid son módulos independientes; **no** se factoriza un componente compartido en este spec (sería sobre-ingeniería para dos botones + un select). La "unificación" es de **estilo y posición**, mediante una clase SCSS común `.editor-grid-control`. Se documenta como decisión para no abrir una refactor de los dos editores.

### 4. "↔ Editor" → toggle de vista, condicional y honesto

Hoy `↔ Editor` (`#insp-toggle-editor`) escribe en un `Map` module-level `editorOverride` que fuerza piano-roll↔drum-grid por clip, sobreescribiendo el editor nativo del engine — confuso porque parece global y no dice qué hace. [session-inspector.ts:168-175, 295-297](../../../src/session/session-inspector.ts).

**Propuesta:**
- Reetiquetar a una etiqueta clara según estado actual: si el editor activo es drum-grid → botón **"Ver como piano-roll"**; si es piano-roll → **"Ver como rejilla"** (texto que dice a qué se cambia). Tooltip: "Cambia cómo se EDITA este clip; no cambia el sonido."
- **Visibilidad condicional:** solo aparece cuando el toggle tiene sentido, es decir cuando el lane puede razonablemente verse de las dos formas: lane de percusión (drums-machine o sampler-drumkit) — donde un usuario querría editar las notas en piano-roll — y, simétricamente, un lane melódico que quiera la rejilla. Para `audio` nunca aparece. La condición exacta queda como **decisión menor**: por defecto mostrarlo para `notes` y `drums` (no para `audio`), que es el comportamiento actual menos el caso audio.
- El mecanismo (`editorOverride` map) se conserva; solo cambia su botón y su rótulo.

### 5. Anunciar el teclado de ordenador (obs. 4 y 5)

El mapa de teclas existe y funciona pero es invisible: a-s-d-f-g-h-j-k = blancas (C-D-E-F-G-A-B-C), w-e-t-y-u = negras, z/x = octava, 1/2 = herramienta draw/select. [piano-roll-editing.ts:10-12](../../../src/core/piano-roll-editing.ts); [pianoroll.ts:561-562, 599-602, 609-630](../../../src/core/pianoroll.ts).

**Propuesta (mínima, sin robar espacio):** un botón **"?"** (o icono teclado) en la toolbar del editor que despliega un `title`/popover con la leyenda:

```
Teclado:  a s d f g h j k = notas (C…C) · w e t y u = sostenidos
          z / x = octava abajo/arriba · 1 / 2 = lápiz / selección
          ←/→ = mover cursor · ⌫ = borrar última · click = dibujar
```

- En el **piano-roll** la leyenda incluye el teclado de notas; en el **drum-grid** (que no tiene teclado de notas) incluye 1/2 + flechas + Ctrl+C/V (su set real, [clip-editor-drum-grid.ts:300-340](../../../src/session/clip-editors/clip-editor-drum-grid.ts)).
- El texto vive como constante junto al mapa de teclas (en `piano-roll-editing.ts`) para que UI y comportamiento no diverjan.

### 6. Cabecera de audio: quitar texto estático duplicado (obs. 7)

`renderAudioClipEditor` monta una mini-toolbar con `BPM 120`, `1 bar`, `♺ Warp ON/OFF`, `✂ Slice → pads`. [clip-waveform-header.ts:108-144](../../../src/session/clip-editors/clip-waveform-header.ts).

**Propuesta:**
- **Eliminar** los `<span>` `BPM …` y `… bar(s)`: el BPM detectado ya vive en `clip.sample.originalBpm` (no es editable aquí y no aporta nada accionable), y la longitud está en `Length (bars)` del inspector — son **texto estático duplicado**.
- **Warp** y **Slice → pads**: su destino depende del frente D (que revierte la "audio-channel direction": loops vuelven al Sampler, el audio lane pasa a WAV puro sin slicing). En coherencia con eso, **Slice → pads sale del editor** (pasa a ser un acto de importar al Sampler), y **Warp** probablemente también sale para loops. **No** se decide aquí (ver Dudas abiertas). El cambio concreto en este frente: dejar la cabecera de audio como **solo waveform** (display) + (si el frente D lo confirma) un trim mínimo. La eliminación de los spans BPM/bars **sí** entra en este frente porque es duplicación pura e independiente de D.

`mountWaveformHeader` (el strip de waveform sobre el editor de notas, modo-2 sliced) **no cambia**: es display puro. [clip-waveform-header.ts:25-101](../../../src/session/clip-editors/clip-waveform-header.ts).

### 7. Flujo de datos (sin cambios de modelo)

```
SessionInspector.openInspector()
  ├─ classifyClip(lane, clip, engine.editor, override)   ← NUEVO (puro)
  ├─ rellena .clip-transport-row (Name/Length/Launch/Dup/Del)  ← Launch movido aquí
  ├─ muestra/oculta .clip-edit-row + grupos según ClipKind     ← NUEVO (visibilidad)
  └─ renderEditor() → renderClipEditor(...)              ← sin cambios de firma
        ├─ audio  → renderAudioClipEditor (sin spans BPM/bars)  ← simplificado
        ├─ drums  → renderDrumGridEditor (toolbar: Draw/Select + GRID-control resolución + ? help)
        └─ notes  → buildPianoRoll → createPianoRoll (toolbar: Draw/Select + GRID-control OCTAVA activa + ? help)
```

- Copy/Paste siguen operando sobre `clip.notes` vía el clipboard module-level `clipClipboard` (`pasteReplace`/`pasteLayer`), con `withUndo`. Solo cambian sus **rótulos**. [session-inspector.ts:260-289](../../../src/session/session-inspector.ts).
- Launch-quantize sigue escribiendo `clip.launchQuantize` con `withUndo`; solo cambia su **ubicación visual** (transporte). [session-inspector.ts:138-144](../../../src/session/session-inspector.ts).
- Octava: muta `octaveBase` (estado local del piano-roll), sin persistencia (igual que hoy). [pianoroll.ts:171, 600](../../../src/core/pianoroll.ts).
- Resolución: sigue persistiendo en `clip.gridResolution` (ya existe). [clip-editor-drum-grid.ts:56-57, 89](../../../src/session/clip-editors/clip-editor-drum-grid.ts).

### 8. UI / estilo

- Nueva clase `.clip-transport-row` y `.clip-edit-row` (reemplazan `.session-inspector-row`) en `_session-inspector.scss`, con un separador visual sutil entre planos (los dos planos se leen como "propiedades del clip" vs "edición"). [_session-inspector.scss:10-18](../../../src/styles/_session-inspector.scss).
- Clase compartida `.editor-grid-control` para octava/resolución (mismo look) — definida en el SCSS del editor (o en `_session-inspector.scss` si es donde se centralizan los estilos del editor).
- El botón ✕ Delete adopta el patrón de aspa del frente A (consistencia); aquí solo el rótulo/icono, la confirmación es del frente A.
- Tooltips en español en todos los controles reetiquetados.

---

## Archivos a tocar

| Archivo | Cambio |
|---------|--------|
| [src/session/clip-editors/clip-editor-router.ts](../../../src/session/clip-editors/clip-editor-router.ts) | **Añadir** `classifyClip(lane, clip, engineEditor, override): ClipKind` (puro, reusa `isAudioClip`+`chooseClipEditor`, líneas 43-58). Exportar `ClipKind`. Sin cambios en `renderClipEditor` salvo, si procede, propagar el flag de tipo. |
| [src/session/session-inspector.ts](../../../src/session/session-inspector.ts) | En `openInspector()` (108-194): leer `classifyClip`, mostrar/ocultar `.clip-edit-row` y sus grupos; cablear el Launch-quantize en su nueva fila (mover el handler de 138-144 sin cambiar lógica). Reetiquetado de los handlers Copy/Paste (162-167) es solo en `index.html`. Toggle-editor (168-175): nuevo rótulo dinámico según editor activo + visibilidad condicional. |
| [index.html](../../../index.html) (318-339) | Reestructurar `#session-inspector`: dividir en `.clip-transport-row` (Name/Length/**Launch**/Duplicate/✕Delete) y `.clip-edit-row` (Copy/Paste **notas**/🎲 Notes/toggle vista). Mover `#insp-quantize` a transporte. Reetiquetar `#insp-copy`→"Copy notes", `#insp-paste-replace`→"Paste ▸ Replace", `#insp-paste-layer`→"Paste ▸ Layer", `#insp-toggle-editor` rótulo dinámico. Etiqueta "Launch" en vez de "Quantize". |
| [src/core/pianoroll.ts](../../../src/core/pianoroll.ts) (174-188, 599-602) | Sustituir `octLabel` (span informativo) por un **grid-control de octava** real (◂ etiqueta ▸) que llama a la misma mutación que z/x. Añadir botón **"?"** de ayuda con la leyenda de teclado. Aplicar clase `.editor-grid-control`. |
| [src/core/piano-roll-editing.ts](../../../src/core/piano-roll-editing.ts) (10-22) | **Añadir** y exportar una constante con el **texto de la leyenda** del teclado (notas + atajos), fuente única para el popover "?" del piano-roll. |
| [src/session/clip-editors/clip-editor-drum-grid.ts](../../../src/session/clip-editors/clip-editor-drum-grid.ts) (80-90) | Aplicar clase `.editor-grid-control` + etiqueta "Grid" al `resSel` para igualar el patrón visual. Añadir botón **"?"** con la leyenda de atajos del drum-grid (1/2, flechas, Ctrl+C/V; sin teclado de notas). |
| [src/session/clip-editors/clip-waveform-header.ts](../../../src/session/clip-editors/clip-waveform-header.ts) (108-144) | En `renderAudioClipEditor`: **eliminar** los spans `BPM …` (118-122) y `… bar(s)` (123-124). Warp/Slice→pads: dejar como placeholder mínimo o retirar según decisión del frente D (no fijar aquí). `mountWaveformHeader` intacto. |
| [src/styles/_session-inspector.scss](../../../src/styles/_session-inspector.scss) (10-18) | Reemplazar `.session-inspector-row` por `.clip-transport-row` + `.clip-edit-row` con separación visual. Añadir `.editor-grid-control` (estilo compartido octava/resolución) y estilo del popover de ayuda "?". |

### Tests a crear/actualizar

| Archivo | Cambio |
|---------|--------|
| [src/session/clip-editors/clip-editor-router.test.ts](../../../src/session/clip-editors/clip-editor-router.test.ts) | **Añadir** `describe('classifyClip')`: melódico→`notes`, drums-machine→`drums`, sampler+drumkit→`drums`, audio-clip→`audio`, override piano-roll sobre drumkit→`notes`. |
| `src/core/piano-roll-editing.test.ts` (existe) | Si la leyenda se deriva del mapa de teclas, un test de coherencia: cada tecla del mapa aparece en la leyenda (evita drift UI↔comportamiento). |
| `tests/e2e/clip-editor-inspector.spec.ts` (NUEVO) | Playwright: ver Plan de pruebas. |

---

## Plan de pruebas

### Unit (Vitest, sin DOM)

1. **`classifyClip`** — los 5 casos de la tabla §1 (espejo de los tests ya existentes de `chooseClipEditor`/`isAudioClip`, mismo fixture `lane(...)`). [clip-editor-router.test.ts:6-49](../../../src/session/clip-editors/clip-editor-router.test.ts).
2. **Leyenda de teclado coherente** — toda tecla de `KEY_SEMITONES` ([piano-roll-editing.ts:10-12](../../../src/core/piano-roll-editing.ts)) está mencionada en la constante de leyenda; z/x y 1/2 también.
3. **Octava (regresión)** — la fórmula de clamping del grid-control de octava es la misma que la de z/x (mismo `Math.max(minMidi, Math.min(maxMidi-12, octaveBase±12))`); si se extrae a un helper, testearlo; si no, basta el e2e de §Playwright.

### Playwright (e2e) — `tests/e2e/clip-editor-inspector.spec.ts`

Reusa el patrón de [clip-click.spec.ts](../../../tests/e2e/clip-click.spec.ts) (`waitForBoot`, clic en `.session-cell-filled` para abrir el inspector). **Recordatorio del proyecto:** `npm run build` antes de `npm run test:e2e` (sirve `dist/` sin build).

1. **Separación transporte vs edición** — abrir un clip melódico: el selector **Launch** (#insp-quantize) está en `.clip-transport-row` y **no** en `.clip-edit-row`; Name/Length/Duplicate/Delete también en transporte.
2. **Visibilidad por tipo** —
   - Clip melódico → `.clip-edit-row` visible con Copy notes / 🎲 Notes; toolbar del editor muestra el grid-control de **octava**.
   - Clip de percusión (lane drums-machine o sampler-drumkit) → toolbar muestra el grid-control de **resolución**; `.clip-edit-row` visible.
   - Clip de audio (lane audio con sample) → `.clip-edit-row` **oculta**; la cabecera de audio **no** contiene texto `BPM`/`bar`.
3. **Rótulos honestos** — `#insp-copy` lee "Copy notes" (no "Copy Clip"); paste-replace/layer leen "Paste ▸ …"; tooltip del toggle de vista menciona "no cambia el sonido".
4. **Octava operable por UI** — clicar ▸ del grid-control de octava cambia la etiqueta (p.ej. C4→C5) sin usar teclado; y pulsar `x` en el editor produce el mismo cambio (paridad UI↔atajo).
5. **Ayuda de teclado descubrible** — el botón "?" existe en la toolbar del editor y, al activarlo, muestra la leyenda (contiene "a s d f" en piano-roll).
6. **Launch-quantize sigue funcionando** — cambiar Launch a "1 bar" persiste en `clip.launchQuantize` (verificable vía `window`-hook o reabriendo el inspector y comprobando el `value` del select); undo lo revierte (es `withUndo`).

### Verificación manual / regresión

- `npx tsc --noEmit` limpio.
- `npm run test:unit` verde (re-run si `ERR_IPC_CHANNEL_CLOSED` en teardown — flaky conocido).
- `npm run build` + `npm run test:e2e` verde.
- Smoke en navegador (`http://localhost:5173`): abrir un clip de cada tipo, confirmar que la barra solo muestra lo aplicable, que octava/resolución se leen igual, y que la cabecera de audio ya no repite BPM/Length.

---

## Dudas abiertas

> Estas son decisiones **pendientes del usuario**. Las del frente **D** (Sampler & audio) se listan explícitamente porque **condicionan** este frente pero **no se deciden aquí**.

### Acopladas al frente D (NO decidir en E — el frente D manda)

1. **Destino de "✂ Slice → pads"** en la cabecera de audio. El índice (frente D) revierte la "audio-channel direction": el audio lane pasa a **WAV puro sin slicing** y los loops particionados **vuelven al Sampler**. Si se confirma, **Slice → pads desaparece del editor** (pasa a ser "importar el loop al Sampler"). ¿Se elimina el botón ya en este frente, o se deja hasta que D aterrice? (Propuesta: eliminar el span BPM/bars ya; el botón Slice se retira cuando D lo confirme.)
2. **Destino de "♺ Warp ON/OFF"**. Frente D sugiere "warp → fuera para loops". ¿Warp se retira del editor de audio, o se mantiene como toggle del WAV puro? Depende de qué edición tendrá el audio lane (ver punto 4).
3. **Edición del audio lane (WAV puro)**. El índice la deja tentativa: "trim + warp opcional (no fijado)". Si el audio lane tendrá trim/warp, la cabecera de audio necesita esos controles (y este spec deja un hueco para ellos); si no, la cabecera es solo waveform display. **¿Trim sí/no? ¿Warp sí/no en WAV puro?**
4. **`loop` / `loopStart` per-pad** (sustain-loop de la muestra) — del índice: ¿se mantienen o fuera? No afecta directamente a los editores de clip pero sí a qué controles aparecen en clips con sample.

### Propias del frente E

5. **Posición del control de rejilla**: este spec propone dejar octava/resolución **en la toolbar del editor** (pegadas a su canvas) y solo unificar el *estilo*. Alternativa: subir ambos a una zona "rejilla" del inspector. ¿Se prefiere pegado-al-canvas (propuesta) o centralizado en el inspector?
6. **Condición de visibilidad del toggle de vista** (piano↔grid): propuesta = visible para `notes` y `drums`, oculto para `audio`. Alternativa más estricta: solo para percusión (donde tiene más sentido editar como piano-roll). ¿Mostrarlo también en lanes melódicos puros?
7. **Forma de la ayuda de teclado**: ¿botón "?" con popover (propuesta, mínimo espacio) o una leyenda permanente bajo la toolbar (más descubrible, más ruido)? 
8. **¿Botón de octava o ±/selector?** Propuesta: ◂ [C4] ▸. Alternativa: un `<select>` de octavas (paridad literal con el `<select>` de resolución del drum-grid). El select unificaría más fuerte el patrón pero cambia más la interacción del piano-roll.
