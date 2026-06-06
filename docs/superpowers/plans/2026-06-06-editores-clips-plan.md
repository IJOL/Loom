# Frente E · Editores de clips — Plan de implementación

**Fecha:** 2026-06-06
**Spec de origen:** [2026-06-06-editores-clips-design.md](../specs/2026-06-06-editores-clips-design.md)
**Coordinación:** [2026-06-06-coordinacion-frentes.md](../specs/2026-06-06-coordinacion-frentes.md) — **D ejecuta ANTES que E** (§3, §6).
**Estado:** plan CORREGIDO tras la revisión adversarial, listo para ejecutar.

## Contexto rápido para quien ejecute

Esto es una **reorganización de UI + reetiquetado + visibilidad condicional + un ajuste mínimo del handler de Copy**. No se toca el modelo de datos (`SessionClip`, `NoteEvent`, `saved-state-v3`) ni la lógica DSP. Los campos que se usan (`launchQuantize`, `gridResolution`) ya existen.

**Correcciones de la revisión que este plan incorpora** (frente E, ALTA 0 · MEDIA 4 · BAJA 5):

- **E1/E4 (Copy):** `#insp-copy` copia hoy el CLIP ENTERO (`JSON.parse(JSON.stringify(clip))`, `session-inspector.ts:163`), no `clip.notes`. El reetiqueta a "Copy notes" exige **ajustar el handler** a copiar solo notas (Tarea 3b). Sin eso, el rótulo mentiría.
- **E4 (toggle):** el toggle alterna sobre el OVERRIDE almacenado → primer-click no-op en lanes melódicos. Se corrige basándolo en el editor RESUELTO (Tarea 8).
- **E3 (e2e audio):** la lane audio SÍ se puede crear en e2e con `input.session-add-audio-input` + WAV en memoria (patrón de `tests/e2e/audio-channel.spec.ts`). No hace falta fixture en `public/demos/` (Tarea 11).
- **Leyenda incompleta (BAJA):** `PIANO_KEY_LEGEND` debe incluir Ctrl+A/C/X/V, Esc, ←/→, ↑/↓ (verificado `pianoroll.ts:565-666`). El test de coherencia los exige (Tarea 2).
- **Octava real = C4** (`octaveBase=60`, `pianoroll.ts:171`), no C3 (Tarea 5).
- **E2 / orden E↔D:** resuelto. **D va primero** y retira el slicing del audio lane + el campo `onSliceToBank` de `ClipEditorDeps`. E construye encima; E **no toca** `onSliceToBank`/botón Slice (Tareas 4 y 9).

Archivos clave (ya leídos al redactar el plan):

- `src/session/clip-editors/clip-editor-router.ts` — `chooseClipEditor` (43-53) e `isAudioClip` (55-58); aquí va `classifyClip` nuevo. (D ya habrá quitado `onSliceToBank` de `ClipEditorDeps`.)
- `src/session/session-inspector.ts` — `openInspector()` (108-194); handler Copy (162-165, copia el CLIP), Paste (166-167, 260-289), toggle-editor (168-175, alterna sobre override); `editorOverride` map (297); `editorDeps.onSliceToBank` (217-219, lo retira D del tipo).
- `index.html` (318-339) — una sola `.session-inspector-row` con 10 hijos: Name, Length, Quantize, Copy Clip, Paste(Replace), Paste(Layer), Duplicate, ↔ Editor, 🎲 Notes, Delete.
- `src/core/pianoroll.ts` — `octaveBase=60` default (171), `octLabel` span (178-184, muestra `oct: C4`), mutación de octava z/x (599-602), tool toggle 1/2 (561-562), Ctrl+A/C/X/V/Esc (565-596), flechas (604-666), teclado de notas (609-630).
- `src/core/piano-roll-editing.ts` — `KEY_SEMITONES` (10-12, **module-local, no exportada**); aquí van `PIANO_KEY_LEGEND` y el export de `KEY_SEMITONES`.
- `src/session/clip-editors/clip-editor-drum-grid.ts` — toolbar + `resSel` montado plano (78-91); keydown real (300-340: 1/2, Ctrl+A, Esc, ⌫, Ctrl+C/X/V, ←/→ mover, ↑/↓ cambiar voz).
- `src/session/clip-editors/clip-waveform-header.ts` — `renderAudioClipEditor` (108-144); spans BPM/bars (118-124); Slice/Warp (126-138, **propiedad de D, ya retirados**); `mountWaveformHeader` (25-101) NO se toca.
- `src/styles/_session-inspector.scss` — `.session-inspector-row` (10-18).
- Tests: `clip-editor-router.test.ts`, `piano-roll-editing.test.ts` (existe), `clip-waveform-header.test.ts` (jsdom, lo reescribe D), `tests/e2e/clip-click.spec.ts` y `tests/e2e/audio-channel.spec.ts` (patrón de lane audio en e2e).

**Convenciones del proyecto:** `npm run build` ANTES de `npm run test:e2e`. `test:unit` puede salir non-zero con `ERR_IPC_CHANNEL_CLOSED` en teardown (flaky, re-ejecutar). Aserciones de test siempre relativas. **Vitest es `environment: 'node'` por defecto**: los tests que construyen DOM real necesitan `// @vitest-environment jsdom` por archivo (como `clip-waveform-header.test.ts:1`). Rótulos de botón en inglés según el spec; tooltips en español. (Si el usuario decide traducir los rótulos — Duda real 4 — aplicar su decisión.)

---

## DEPENDENCIA DE FRENTE — D va antes

Antes de empezar la Tarea 4 y la Tarea 9, **confirmar que el frente D ya aterrizó** en `clip-editor-router.ts` y `clip-waveform-header.ts`:

- D ha quitado `onSliceToBank?` de `ClipEditorDeps` (`clip-editor-router.ts:31`) y de la llamada a `renderAudioClipEditor` (82-85).
- D ha quitado el botón `.audio-clip-slice`, el toggle Warp y `AudioClipEditorDeps.onSliceToBank` de `clip-waveform-header.ts`.
- D ha reescrito `clip-waveform-header.test.ts` y `tests/e2e/audio-channel.spec.ts`.

Si D NO ha aterrizado todavía, E puede ejecutar las Tareas 1, 2, 3, 5, 6a, 6b, 10 (no tocan esos archivos compartidos) y dejar 4, 7, 8, 9 para cuando D termine. **E nunca toca `onSliceToBank` ni el botón Slice** (es de D y habrá desaparecido).

---

## DUDAS REALES — confirmar con el usuario ANTES de la tarea afectada

Solo quedan decisiones legítimas de UX/copy. Las "acopladas a D" y la posición del grid-control YA están decididas por el spec/coordinación y NO bloquean.

- **[U1] Visibilidad del toggle de vista**: ¿visible para `notes` y `drums` (propuesta) o solo para `drums`? → **afecta a la Tarea 8** (a quién se muestra; el fix del no-op no depende de esto). El plan asume "notes y drums, oculto para audio".
- **[U2] Forma de la ayuda de teclado**: ¿botón "?" con popover (propuesta) o leyenda permanente bajo la toolbar? → **afecta a las Tareas 6a/6b**. El plan asume botón "?" con `title`/popover.
- **[U3] ¿Octava como ◂ [C4] ▸ o `<select>`?** → **afecta a la Tarea 5**. El plan asume ◂ [C4] ▸.
- **[U4] Idioma de los rótulos de botón** (EN como fija el spec vs traducir a castellano) → **afecta a las Tareas 3a/7**. El plan asume EN; si el usuario pide castellano, traducir los rótulos manteniendo los ids.

> Si el usuario no confirma a tiempo, ejecutar la propuesta por defecto y dejar nota en el commit.

---

## Orden de ejecución (de menor a mayor riesgo)

Primero lo puro/aislado (lógica sin DOM, constantes, tests rojos→verdes), que además NO toca archivos compartidos con D. Luego el reetiquetado/handler de Copy (riesgo bajo). Después los cambios de toolbar de cada editor (riesgo medio). Por último la reestructuración del inspector + toggle (riesgo alto), el SCSS, el e2e y la verificación final.

Cada tarea se commitea por separado en la rama (worktree ya activo). **Rebase sobre `main` tras casi cada commit** (instrucción global).

---

### Tarea 1 — `classifyClip` puro (TDD: rojo → verde) · NO toca archivos de D

**Archivos:** `src/session/clip-editors/clip-editor-router.test.ts` (test primero), `src/session/clip-editors/clip-editor-router.ts`.

**Qué hacer:**
1. (Rojo) En `clip-editor-router.test.ts` añadir `describe('classifyClip')` con los 5 casos de la tabla §1 del spec, reusando el helper `lane(...)` existente:
   - lane melódico (no-audio) + editor `piano-roll` → `'notes'`.
   - lane `drums-machine` (editor `drum-grid`) → `'drums'`.
   - lane `sampler` con `engineState.sampler.drumkitId` → `'drums'`.
   - audio-clip (`isAudioClip` true: lane `audio` + `sample` + sin notas) → `'audio'`.
   - override `piano-roll` sobre un drumkit-sampler → `'notes'`.
2. (Verde) En `clip-editor-router.ts` añadir y exportar:
   ```ts
   export type ClipKind = 'notes' | 'drums' | 'audio';
   export function classifyClip(
     lane: SessionLane,
     clip: SessionClip,
     engineEditor: 'piano-roll' | 'drum-grid' | undefined,
     override?: 'piano-roll' | 'drum-grid',
   ): ClipKind {
     if (isAudioClip(lane, clip)) return 'audio';
     return chooseClipEditor(lane, engineEditor, override) === 'drum-grid' ? 'drums' : 'notes';
   }
   ```
   Reusa `isAudioClip` + `chooseClipEditor` (no duplicar la precedencia). El orden importa: audio ANTES.
3. NO tocar `renderClipEditor`. NO tocar `onSliceToBank` (es de D).

**Verificar:** `NO_COLOR=1 npx vitest run src/session/clip-editors/clip-editor-router.test.ts` verde. `npx tsc --noEmit` limpio.

---

### Tarea 2 — `PIANO_KEY_LEGEND` COMPLETA + export de `KEY_SEMITONES` (TDD) · NO toca archivos de D

**Archivos:** `src/core/piano-roll-editing.test.ts` (test primero), `src/core/piano-roll-editing.ts`.

**Qué hacer:**
1. En `piano-roll-editing.ts`: **exportar `KEY_SEMITONES`** (hoy es `const` module-local, línea 10) para que el test la lea. Añadir y exportar `PIANO_KEY_LEGEND` con la leyenda COMPLETA (§5 del spec — incluye los atajos de edición, no solo notas):
   ```ts
   export const PIANO_KEY_LEGEND =
     'Teclado:  a s d f g h j k = notas (C…C) · w e t y u = sostenidos\n' +
     '          z / x = octava abajo/arriba · 1 / 2 = lápiz / selección\n' +
     '          Ctrl+A = seleccionar todo · Ctrl+C / X / V = copiar / cortar / pegar\n' +
     '          Esc = deseleccionar · ←/→ = mover cursor (o nudge con selección)\n' +
     '          ↑/↓ = transponer selección · ⌫ = borrar';
   ```
2. (Test de coherencia REFORZADO) En `piano-roll-editing.test.ts`: toda tecla de `KEY_SEMITONES` (`a w s e d f t g y h u j k`) aparece en `PIANO_KEY_LEGEND`; **además** `z`, `x`, `1`, `2`, `Ctrl+A`, `Ctrl+C`, `Ctrl+X`, `Ctrl+V`, `Esc`, `←`, `→`, `↑`, `↓` aparecen. Iterar `Object.keys(KEY_SEMITONES)` y la lista extra y comprobar `PIANO_KEY_LEGEND.includes(k)`.

**Verificar:** `NO_COLOR=1 npx vitest run src/core/piano-roll-editing.test.ts` verde. `npx tsc --noEmit` limpio.

> Nota: `DRUM_KEY_LEGEND` (1/2, ←/→ mover, ↑/↓ cambiar voz, Ctrl+A/C/X/V, Esc, ⌫; sin teclado de notas) se define en la Tarea 6b para no adelantar trabajo sin test.

---

### Tarea 3a — Reetiquetado honesto en `index.html` (sin lógica)

**Archivos:** `index.html` (332-336).

**Qué hacer (solo rótulos/tooltips, NADA de mover nodos — la reestructuración es la Tarea 7):**
- `#insp-copy`: `Copy Clip` → `Copy notes`; `title`: "Copia las notas de este clip".
- `#insp-paste-replace`: `Paste (Replace)` → `Paste ▸ Replace`; `title`: "Reemplaza las notas con las copiadas".
- `#insp-paste-layer`: `Paste (Layer)` → `Paste ▸ Layer`; `title`: "Añade las notas copiadas a las existentes".
- `#insp-toggle-editor`: el rótulo pasará a ser dinámico (Tarea 8); por ahora dejar solo el `title`: "Cambia cómo se EDITA este clip; no cambia el sonido." El texto del botón se gestiona en JS en la Tarea 8.

**Verificar:** visual rápido en `npm run dev`. Cubierto por el e2e de la Tarea 11 (rótulos honestos).

---

### Tarea 3b — Copy honesto: copiar SOLO `clip.notes` (corrige E1) · TDD jsdom

**Archivos:** `src/session/session-inspector.ts` (handler `#insp-copy`, 162-165; clipboard module-level, 293); `src/session/session-inspector.test.ts` (test primero; jsdom).

**Qué hacer:**
1. (Rojo) Test jsdom (`// @vitest-environment jsdom` en cabecera): montar el inspector mínimo, abrir un clip con `notes` + `name`/`sample`/`launchQuantize`, disparar el handler de Copy, y aseverar que el clipboard resultante tiene `notes` pero **no** `name`/`sample`/`launchQuantize`. (Si `clipClipboard` es module-local y no observable, exponer un getter de test `_getClipClipboardForTesting()` o aseverar indirectamente vía `pasteReplace` sobre un clip vacío → solo aparecen notas.)
2. (Verde) Cambiar el handler de Copy:
   ```ts
   document.getElementById('insp-copy')!.onclick = () => {
     clipClipboard = { notes: JSON.parse(JSON.stringify(clip.notes ?? [])) };
     updatePasteBtnState();
   };
   ```
   Y ajustar el tipo del clipboard module-level (293) de `SessionClip | null` a `{ notes: NoteEvent[] } | null` (o `Pick<SessionClip,'notes'> | null`). `pasteReplace`/`pasteLayer` (267, 281-284) ya leen `clipClipboard.notes` → siguen compilando. `updatePasteBtnState` (299) comprueba `clipClipboard?.notes?.length` (ajustar si hoy mira otra cosa).

**Verificar:** `NO_COLOR=1 npx vitest run src/session/session-inspector.test.ts` verde. `npx tsc --noEmit` limpio. Smoke: Copy en un clip, Paste en otro → solo se pegan notas (ya era el efecto; ahora el clipboard también es honesto).

---

### Tarea 4 — Integrar la retirada de `onSliceToBank` por D (consecuencia mecánica) · DEPENDE DE D

> ⚠️ Solo cuando D haya quitado `onSliceToBank` de `ClipEditorDeps`. Si aún no, saltar y volver luego.

**Archivos:** `src/session/session-inspector.ts` (217-219).

**Qué hacer:** tras D, el campo `onSliceToBank` ya no existe en `ClipEditorDeps`. Eliminar el bloque que lo construye en `editorDeps`:
```ts
// BORRAR (217-219):
onSliceToBank: this.selectedClip
  ? () => this.deps.onSliceToBank?.(this.selectedClip!.laneId, this.selectedClip!.clipIdx)
  : undefined,
```
Si `SessionInspectorDeps.onSliceToBank` queda sin uso tras esto, evaluar si lo elimina E o lo dejó D; coordinar para no romper el contrato del host. **E no reintroduce el slicing.**

**Verificar:** `npx tsc --noEmit` limpio (es el detector: si D quitó el campo, este bloque no compila hasta borrarlo).

---

### Tarea 5 — Piano-roll: octava como grid-control real ◂ [C4] ▸ (riesgo medio) · NO toca archivos de D

> ⚠️ **Confirmar U3 (botón vs select) antes.** El plan asume ◂ [C4] ▸. La posición (toolbar del editor) YA está decidida por el spec.

**Archivos:** `src/core/pianoroll.ts` (171-188, reusar fórmula de 600).

**Qué hacer:**
1. Sustituir el `octLabel` span (178-184) por un grupo de tres elementos en la `toolbar`, dentro de un `<div class="editor-grid-control">`:
   - botón `◂` (bajar octava = misma mutación que tecla `z`),
   - `octLabel` span (se mantiene, muestra `C${Math.floor(octaveBase/12)-1}` — con `octaveBase=60` → C4),
   - botón `▸` (subir octava = tecla `x`).
   Mantener el anclaje a la derecha con `margin-left:auto` en el contenedor (`.editor-grid-control`).
2. Extraer la fórmula de clamping a un helper local (o a `piano-roll-editing.ts` como `clampOctaveBase` puro, preferido para testear §Unit-3) para no duplicarla:
   ```ts
   const shiftOctave = (dir: 1 | -1) => {
     octaveBase = Math.max(minMidi, Math.min(maxMidi - 12, octaveBase + dir * 12));
     refreshToolbar();
   };
   ```
   - `▸` → `shiftOctave(1)`, `◂` → `shiftOctave(-1)`.
   - En el keydown (599-602) reemplazar el cuerpo por `shiftOctave(e.key === 'x' ? 1 : -1)` (misma fórmula, compartida). Mantener `e.preventDefault()`.
3. Aplicar `.editor-grid-control` al contenedor (estilo en Tarea 10). `title` en los botones: "Octava (z / x)".
4. Mantener z/x como atajos; ahora anunciados vía el "?" (Tarea 6a).

**Verificar:**
- `npx tsc --noEmit` limpio.
- Si se extrae `clampOctaveBase` puro, test unit del clamping (mismo `Math.max/min`). Si no, basta el e2e de la Tarea 11. **Recomendado:** extraer y testear.
- Smoke: abrir clip melódico, clicar ▸/◂ cambia la etiqueta (C4→C5…); pulsar `x` produce el mismo cambio.

---

### Tarea 6a — Piano-roll: botón "?" con la leyenda COMPLETA (riesgo medio) · NO toca archivos de D

> ⚠️ **Confirmar U2 (popover vs leyenda permanente) antes.** El plan asume botón "?" con popover/`title`.

**Archivos:** `src/core/pianoroll.ts` (toolbar), usa `PIANO_KEY_LEGEND` de la Tarea 2.

**Qué hacer:**
1. Importar `PIANO_KEY_LEGEND` desde `piano-roll-editing.ts`.
2. Añadir a la toolbar un botón `?` con clase `.editor-help-btn`.
   - Mínimo: `helpBtn.title = PIANO_KEY_LEGEND` (tooltip nativo multilínea con `\n`).
   - Popover propio (mejor UX): al click, togglear un `<pre class="editor-help-popover">` con el texto bajo la toolbar; cerrar al re-click o blur.
3. Colocar el `?` en la toolbar coherente con el drum-grid (Tarea 6b).

**Verificar:** `npx tsc --noEmit` limpio. Smoke: el `?` muestra "a s d f…" y "Ctrl+A". Cubierto por e2e Tarea 11.

---

### Tarea 6b — Drum-grid: grid-control de resolución a la derecha + "?" (riesgo medio) · NO toca archivos de D

> ⚠️ Hereda U2. Posición (toolbar) ya decidida.

**Archivos:** `src/session/clip-editors/clip-editor-drum-grid.ts` (78-91), constante `DRUM_KEY_LEGEND`.

**Qué hacer:**
1. Añadir `DRUM_KEY_LEGEND` con el set REAL (verificado en keydown 300-340):
   ```
   Teclado:  1 / 2 = lápiz / selección · ←/→ = mover · ↑/↓ = cambiar voz
             Ctrl+A = todo · Ctrl+C / X / V = copiar/cortar/pegar · Esc = deseleccionar · ⌫ = borrar
   ```
   (Sin teclado de notas.)
2. Envolver el `resSel` en `<div class="editor-grid-control">` con una etiqueta "Grid" antepuesta y anclar a la derecha (`margin-left:auto` en el contenedor) — hoy `resSel` va plano (90). `title` del select: "Resolución de rejilla". **No romper** el handler `change` (89) que persiste en `clip.gridResolution`.
3. Añadir botón `?` `.editor-help-btn` con `DRUM_KEY_LEGEND`.

**Verificar:** `npx tsc --noEmit` limpio. Smoke: drum-grid muestra "Grid [select]" a la derecha y un "?"; cambiar resolución sigue persistiendo en `clip.gridResolution`.

---

### Tarea 7 — Reestructurar la barra del inspector + visibilidad (riesgo alto) · NO toca archivos de D

> ⚠️ Depende de la Tarea 1 (`classifyClip`) y del reetiquetado (Tarea 3a). El grid-control queda en la toolbar del editor (NO sube al inspector).

**Archivos:** `index.html` (318-339), `src/session/session-inspector.ts` (`openInspector` 108-194).

**Qué hacer (HTML):** dividir la única `.session-inspector-row` en dos sub-filas dentro de `#session-inspector`, con **id estable** para selección robusta en e2e:
```html
<div id="insp-transport-row" class="clip-transport-row">
  <label>Name <input id="insp-name" type="text" /></label>
  <label>Length (bars) <input id="insp-length" type="number" min="1" step="1" /></label>
  <label>Launch
    <select id="insp-quantize"> … (mismas opciones, mover aquí) … </select>
  </label>
  <button class="rnd" id="insp-duplicate">Duplicate</button>
  <button class="rnd" id="insp-delete">Delete</button>
</div>
<div id="insp-edit-row" class="clip-edit-row">
  <button class="rnd" id="insp-copy">Copy notes</button>
  <button class="rnd" id="insp-paste-replace" disabled>Paste ▸ Replace</button>
  <button class="rnd" id="insp-paste-layer" disabled>Paste ▸ Layer</button>
  <button class="rnd primary" id="insp-random-notes" title="Aleatoriza las notas del clip">🎲 Notes</button>
  <button class="rnd" id="insp-toggle-editor" title="Cambia cómo se EDITA este clip; no cambia el sonido."></button>
</div>
<div id="insp-roll-host" class="session-inspector-roll"></div>
```
- Cambiar la etiqueta del select de "Quantize" a "Launch".
- El `Delete` mantiene su id; la confirmación/aspa es del **frente A** (E no la implementa, solo lo ubica en transporte).
- El grid-control de octava/resolución NO va aquí.

**Qué hacer (JS, `openInspector`):**
1. Tras resolver `lane`/`clip`, calcular `const kind = classifyClip(lane, clip, getEngine(lane.engineId)?.editor, editorOverride.get(clip.id))`. (Importar `classifyClip` y `getEngine`.)
2. Mostrar/ocultar `#insp-edit-row` según `kind`: `audio` → `hidden = true`; `notes`/`drums` → `hidden = false`. Obtener la fila por `getElementById('insp-edit-row')`.
3. El handler del Launch-quantize (`qEl`, 138-144) NO cambia su lógica; sigue obteniéndose por `getElementById('insp-quantize')` (id intacto).
4. Copy/Paste/Duplicate/Delete/random: los `getElementById` por id no cambian (ids conservados). Solo cambió su contenedor.

**Verificar:**
- `npx tsc --noEmit` limpio.
- `NO_COLOR=1 npx vitest run` (no toca el DOM del inspector pero confirma que la lógica pura no se rompió).
- Smoke: clip melódico (edit-row visible), clip de audio (edit-row oculta), Launch en transporte.

---

### Tarea 8 — Toggle de vista: basado en editor RESUELTO + rótulo dinámico + visibilidad (riesgo medio) · corrige E4

> ⚠️ **Confirmar U1 (notes+drums vs solo drums).** El plan asume notes+drums, oculto para audio. El fix del primer-click no-op NO depende de U1.

**Archivos:** `src/session/session-inspector.ts` (`openInspector`, toggle-editor 168-175).

**Qué hacer:**
1. **Corregir el no-op (E4):** el siguiente estado del toggle se calcula desde el editor RESUELTO, no desde el override almacenado:
   ```ts
   document.getElementById('insp-toggle-editor')!.onclick = () => {
     if (!this.selectedClip) return;
     const resolved = chooseClipEditor(lane, getEngine(lane.engineId)?.editor, editorOverride.get(clip.id));
     const next: 'piano-roll' | 'drum-grid' = resolved === 'piano-roll' ? 'drum-grid' : 'piano-roll';
     editorOverride.set(clip.id, next);
     this.renderEditor();
     this.refreshToggleLabel();   // recalcular rótulo tras el cambio
   };
   ```
   Así el primer click SIEMPRE conmuta respecto a lo que se ve (antes, en un lane melódico sin override, `cur=null → next='piano-roll'` = no-op).
2. **Rótulo dinámico** (`private refreshToggleLabel()`), llamado en `openInspector` y al final del `onclick`:
   ```ts
   private refreshToggleLabel() {
     const resolved = chooseClipEditor(lane, getEngine(lane.engineId)?.editor, editorOverride.get(clip.id));
     btn.textContent = resolved === 'drum-grid' ? 'Ver como piano-roll' : 'Ver como rejilla';
   }
   ```
   (Capturar `lane`/`clip`/`btn` del scope de `openInspector`, o re-resolverlos dentro del método.)
3. **Visibilidad:** ocultar `#insp-toggle-editor` cuando `kind === 'audio'` (o, si U1 restringe, también cuando `kind === 'notes'`). Mostrar para `notes`/`drums` (propuesta).

**Verificar:** `npx tsc --noEmit` limpio. Smoke: en un lane melódico el botón lee "Ver como rejilla" y **un solo click** lo lleva a drum-grid, con el rótulo pasando a "Ver como piano-roll". En audio el botón no aparece. Cubierto por e2e Tarea 11 (caso 5, toggle sin no-op).

---

### Tarea 9 — Cabecera de audio: quitar los spans BPM/bars (riesgo bajo) · DEPENDE DE D

> ⚠️ Solo cuando D haya retirado el botón Slice + toggle Warp de `renderAudioClipEditor`. E **solo** quita los spans BPM/bars; NO toca Slice/Warp/`onSliceToBank` (ya no existen).

**Archivos:** `src/session/clip-editors/clip-waveform-header.ts` (`renderAudioClipEditor`).

**Qué hacer:**
1. Eliminar `bpmLabel` (118-122) y `barsLabel` (123-124) y su `append` (138). El BPM vive en `clip.sample.originalBpm`; la longitud en `Length (bars)` del inspector — duplicación pura.
2. Si tras la retirada (Slice/Warp por D + spans por E) la `toolbar` queda vacía, **no montarla**: dejar `renderAudioClipEditor` como solo waveform (`mountWaveformHeader`).
3. `mountWaveformHeader` (25-101) NO se toca.
4. **Coordinación de test:** D reescribe `clip-waveform-header.test.ts` al quitar el botón Slice; ese test dejará de afirmar `120`/BPM en la misma pasada. E **verifica** que el test ya no afirma BPM; si D dejó esa aserción, E la elimina (no reescribe el archivo).

**Verificar:** `npx tsc --noEmit` limpio. `NO_COLOR=1 npx vitest run src/session/clip-editors/clip-waveform-header.test.ts` verde. Smoke: clip de audio, cabecera sin `BPM …`/`… bar`. Cubierto por e2e Tarea 11 (caso 2, audio).

---

### Tarea 10 — SCSS: filas del inspector + `.editor-grid-control` + popover de ayuda · NO toca archivos de D

**Archivos:** `src/styles/_session-inspector.scss` (10-18).

**Qué hacer:**
1. Reemplazar `.session-inspector-row` por `.clip-transport-row` y `.clip-edit-row` (mismo `display:flex; gap; align-items; flex-wrap`), con un **separador visual sutil** entre planos (p.ej. `border-top: 1px solid var(--border); padding-top` en `.clip-edit-row`). Migrar los selectores hijos a un selector común `.clip-transport-row, .clip-edit-row`.
2. Añadir `.editor-grid-control` (octava/resolución): contenedor flex con `gap` pequeño, `margin-left:auto` para anclar a la derecha, botones ◂/▸ compactos, etiqueta monoespaciada.
3. Añadir `.editor-help-btn` y, si se usa popover (U2), `.editor-help-popover` (`<pre>` posicionado, fondo `var(--surface-2)`, borde, `white-space:pre`, monoespaciada, z-index sobre el canvas).

**Verificar:** `npm run build` (compila SCSS). Smoke: las dos filas se distinguen; octava/resolución se leen igual; el "?" tiene aspecto de botón.

---

### Tarea 11 — Playwright e2e: `tests/e2e/clip-editor-inspector.spec.ts` (NUEVO)

> ⚠️ **`npm run build` ANTES de `npm run test:e2e`**. Va al final porque ejercita toda la UI integrada.

**Archivos:** `tests/e2e/clip-editor-inspector.spec.ts` (nuevo). Patrón melódico: `clip-click.spec.ts` (`waitForBoot`, clic en `.session-cell-filled`). Patrón audio: `audio-channel.spec.ts` (`input.session-add-audio-input` + WAV en memoria via `loopWav()` — copiar esa función helper).

**Qué hacer:** cubrir los 7 escenarios del §Plan-de-pruebas/Playwright:
1. **Separación transporte vs edición** — clip melódico: `#insp-quantize` (Launch) dentro de `#insp-transport-row` y NO dentro de `#insp-edit-row`; Name/Length/Duplicate/Delete en transporte.
2. **Visibilidad por tipo:**
   - melódico → `#insp-edit-row` visible con "Copy notes" / "🎲 Notes"; toolbar muestra grid-control de octava (texto `C…`).
   - percusión (clip de un lane drums-machine de un demo; los demos `acid-rain/cordillera/minimal-techno/neon-drive` traen lanes de drums) → toolbar muestra grid-control de resolución (`<select>` con "Grid"); `#insp-edit-row` visible.
   - **audio** (creado con `input.session-add-audio-input` + `loopWav()`; el clip auto-abre en el inspector) → `#insp-edit-row` oculta (`hidden`); la cabecera de audio no contiene texto `BPM`/`bar`.
3. **Rótulos honestos** — `#insp-copy` lee "Copy notes"; paste-replace/layer leen "Paste ▸ …"; `title` del toggle menciona "no cambia el sonido".
4. **Octava operable por UI** — clicar `▸` cambia la etiqueta (C4→C5) sin teclado; pulsar `x` (tras enfocar el `wrap`/canvas) produce el mismo cambio (paridad UI↔atajo).
5. **Toggle sin primer-click no-op** — clip melódico: el botón lee "Ver como rejilla"; **un click** cambia a drum-grid y el rótulo pasa a "Ver como piano-roll".
6. **Ayuda descubrible** — el `?` existe y muestra la leyenda con "a s d f" y "Ctrl+A".
7. **Launch-quantize funciona** — cambiar Launch a "1 bar" (value `1/1`) persiste (reabrir el inspector y comprobar `value`); undo (Ctrl+Z) lo revierte.

**Verificar:** `npm run build` && `npm run test:e2e` verde (o `npx playwright test tests/e2e/clip-editor-inspector.spec.ts` para iterar). Ajustar selectores a los ids reales tras las Tareas 5-8.

---

### Tarea 12 — Verificación final (typecheck + unit + build + e2e + smoke)

**Qué hacer (en orden):**
1. `npx tsc --noEmit` — limpio.
2. `npm run test:unit` — verde. (Re-ejecutar si `ERR_IPC_CHANNEL_CLOSED` en teardown — flaky conocido.)
3. `npm run build` — typecheck + bundle sin errores.
4. `npm run test:e2e` — verde (sirve el `dist/` recién construido).
5. **Smoke manual** en `http://localhost:5173` (`npm run dev`):
   - Abrir un clip de cada tipo (melódico, percusión, audio).
   - La barra del inspector solo muestra lo aplicable (audio → sin `#insp-edit-row`).
   - Octava (piano-roll) y resolución (drum-grid) se leen con el mismo patrón (grid-control a la derecha).
   - La cabecera de audio ya no repite BPM/Length.
   - **Copy notes copia solo notas** (Copy en un clip, Paste en otro → solo notas).
   - **Toggle de vista cambia al PRIMER click** en un lane melódico.
   - Launch-quantize en transporte y funciona.
   - El "?" descubre los atajos (incl. Ctrl+A) en ambos editores.
6. Confirmar que las Dudas Reales (U1-U4) quedaron resueltas/anotadas: si alguna se ejecutó por la propuesta por defecto, dejar nota en el commit/PR.

**Verificar:** todo verde + smoke OK. Puerta para `git rebase main` → `git merge --ff-only` → `ExitWorktree`.

---

## Resumen de archivos tocados

| Archivo | Tareas | ¿Compartido con D? |
|---------|--------|--------------------|
| `src/session/clip-editors/clip-editor-router.ts` (+ `.test.ts`) | 1 | sí (D quita `onSliceToBank` antes; E solo añade `classifyClip`) |
| `src/core/piano-roll-editing.ts` (+ `.test.ts`) | 2, (5 si se extrae el helper de octava) | no |
| `index.html` | 3a, 7 | no |
| `src/session/session-inspector.ts` (+ `.test.ts`) | 3b, 4, 7, 8 | sí (Tarea 4 depende de la retirada de `onSliceToBank` por D) |
| `src/core/pianoroll.ts` | 5, 6a | no |
| `src/session/clip-editors/clip-editor-drum-grid.ts` | 6b | no |
| `src/session/clip-editors/clip-waveform-header.ts` | 9 | sí (D quita Slice/Warp antes; E solo quita BPM/bars) |
| `src/styles/_session-inspector.scss` | 10 | no |
| `tests/e2e/clip-editor-inspector.spec.ts` (nuevo) | 11 | no |

## Notas de proceso

- **D ejecuta ANTES que E** en los archivos compartidos (`clip-editor-router.ts`, `clip-waveform-header.ts`). Las Tareas 4 y 9 esperan a D; el resto puede avanzar en paralelo.
- Worktree ya activo; commitear cada tarea por separado y **rebasar sobre `main` tras casi cada commit**. Resolver conflictos en el momento.
- No tocar `SessionClip`/`saved-state-v3`/DSP, ni `onSliceToBank`/botón Slice/Warp (de D).
- Aserciones de test siempre relativas. Tests con DOM real → `// @vitest-environment jsdom`.
- Tooltips en español; rótulos de botón en inglés (salvo que U4 decida castellano).
