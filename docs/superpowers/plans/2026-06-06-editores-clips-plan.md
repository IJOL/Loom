# Frente E · Editores de clips — Plan de implementación

**Fecha:** 2026-06-06
**Spec de origen:** [2026-06-06-editores-clips-design.md](../specs/2026-06-06-editores-clips-design.md)
**Estado:** plan listo para ejecutar.

## Contexto rápido para quien ejecute

Esto es una **reorganización de UI + reetiquetado + visibilidad condicional**. No se toca el modelo de datos (`SessionClip`, `NoteEvent`, `saved-state-v3`) ni la lógica DSP. Los campos que se usan (`launchQuantize`, `gridResolution`) ya existen.

Archivos clave (ya leídos al redactar el plan):

- `src/session/clip-editors/clip-editor-router.ts` — `chooseClipEditor` (43-53) e `isAudioClip` (55-58); aquí va `classifyClip` nuevo.
- `src/session/session-inspector.ts` — `openInspector()` (108-194); cablea Launch-quantize (138-144), Copy/Paste (162-167), toggle-editor (168-175); el `editorOverride` map (297).
- `index.html` (318-340) — una sola `.session-inspector-row` con 10 hijos planos + `#insp-roll-host`.
- `src/core/pianoroll.ts` — `octLabel` span (178-184), mutación de octava z/x (599-602), tool toggle 1/2 (561-562), teclado de notas (609-630), toolbar en `buildEditorFrame` (137-147).
- `src/core/piano-roll-editing.ts` — `KEY_SEMITONES` (10-12); aquí va la constante de leyenda.
- `src/session/clip-editors/clip-editor-drum-grid.ts` — toolbar + `resSel` (78-91); keydown set real (300-340).
- `src/session/clip-editors/clip-waveform-header.ts` — `renderAudioClipEditor` (108-144); spans BPM/bars (118-124); `mountWaveformHeader` (25-101) NO se toca.
- `src/styles/_session-inspector.scss` — `.session-inspector-row` (10-18).
- Tests: `src/session/clip-editors/clip-editor-router.test.ts`, `src/core/piano-roll-editing.test.ts`, `tests/e2e/clip-click.spec.ts` (patrón `waitForBoot`).

**Convención del proyecto:** `npm run build` ANTES de `npm run test:e2e` (sirve `dist/` sin build). `test:unit` puede salir non-zero con `ERR_IPC_CHANNEL_CLOSED` en teardown — flaky conocido, re-ejecutar para confirmar verde. Aserciones de test siempre relativas. Idioma de tooltips/etiquetas de cara al usuario: el spec mezcla rótulos en inglés ("Copy notes", "Paste ▸ Replace") con tooltips en español; respetar exactamente lo que diga el spec en cada caso y confirmar dudas de copy en la duda abierta D5 si surge ambigüedad.

---

## DUDAS ABIERTAS — confirmar con el usuario ANTES de la tarea afectada

Estas decisiones NO se resuelven en el plan. Cada una marca la tarea que bloquea.

- **[D-A] Destino de "✂ Slice → pads"** (acoplada al frente D). ¿Se elimina el botón ya en este frente o se deja hasta que D aterrice? Propuesta del spec: eliminar spans BPM/bars ya; retirar Slice cuando D lo confirme. → **Bloquea la Tarea 9** (decide si se borra el botón Slice o solo se quitan los spans).
- **[D-B] Destino de "♺ Warp ON/OFF"** (acoplada al frente D). ¿Warp se retira o se mantiene como toggle del WAV puro? → **Bloquea la Tarea 9**.
- **[D-C] Edición del audio lane (WAV puro): ¿trim sí/no? ¿warp sí/no?** (acoplada al frente D). Si hay trim/warp, la cabecera necesita esos controles. → **Bloquea la Tarea 9** (determina si la cabecera queda "solo waveform" o con un hueco para trim).
- **[D-D] `loop`/`loopStart` per-pad** (acoplada al frente D). No afecta a los editores directamente pero sí a qué controles aparecen en clips con sample. → Informativa; no bloquea ninguna tarea de este plan salvo que D cambie `isAudioClip`.
- **[D-E] Posición del control de rejilla**: ¿pegado-al-canvas (propuesta del spec — octava/resolución en la toolbar del editor) o centralizado en el inspector? → **Bloquea las Tareas 5 y 7** (dónde se monta el grid-control). El plan asume la propuesta (toolbar del editor); confirmar antes de empezar la Tarea 5.
- **[D-F] Condición de visibilidad del toggle de vista** (piano↔grid): ¿visible para `notes` y `drums` (propuesta) o solo para percusión? → **Bloquea la Tarea 8**. El plan asume "notes y drums, oculto para audio".
- **[D-G] Forma de la ayuda de teclado**: ¿botón "?" con popover (propuesta) o leyenda permanente bajo la toolbar? → **Bloquea las Tareas 6a/6b**. El plan asume botón "?" con `title`/popover.
- **[D-H] ¿Botón de octava o `<select>`?**: ◂ [C4] ▸ (propuesta) vs un `<select>` de octavas. → **Bloquea la Tarea 5**. El plan asume ◂ [C4] ▸.

> Cuando el usuario confirme, sustituir la suposición en la tarea afectada y seguir. Si NO confirma a tiempo, ejecutar la propuesta por defecto (es lo que asume el plan) y dejar nota.

---

## Orden de ejecución (de menor a mayor riesgo)

Las primeras tareas son puras/aisladas (riesgo bajo: lógica sin DOM, constantes, tests rojos→verdes). Luego el reetiquetado HTML (riesgo bajo, sin lógica). Después los cambios de toolbar de cada editor (riesgo medio: DOM + cableado). Por último la reestructuración del inspector (riesgo más alto: mueve controles, visibilidad condicional, depende de todo lo anterior), el SCSS y la verificación e2e completa.

Cada tarea se commitea por separado en la rama (worktree ya activo). **Rebase sobre `main` tras casi cada commit** (instrucción global del usuario).

---

### Tarea 1 — `classifyClip` puro (TDD: rojo → verde)

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
   Reusa `isAudioClip` + `chooseClipEditor` (no duplicar la precedencia). El orden importa: audio se comprueba ANTES (un audio-clip nunca debe clasificarse por editor).
3. No tocar `renderClipEditor` en esta tarea.

**Verificar:** `NO_COLOR=1 npx vitest run src/session/clip-editors/clip-editor-router.test.ts` verde. `npx tsc --noEmit` limpio.

---

### Tarea 2 — Constante de leyenda de teclado del piano-roll (TDD)

**Archivos:** `src/core/piano-roll-editing.test.ts` (test primero), `src/core/piano-roll-editing.ts`.

**Qué hacer:**
1. En `piano-roll-editing.ts`, junto a `KEY_SEMITONES`, añadir y exportar una constante (fuente única para el popover "?"). Texto según §5 del spec:
   ```ts
   export const PIANO_KEY_LEGEND =
     'Teclado:  a s d f g h j k = notas (C…C) · w e t y u = sostenidos\n' +
     '          z / x = octava abajo/arriba · 1 / 2 = lápiz / selección\n' +
     '          ←/→ = mover cursor · ⌫ = borrar última · click = dibujar';
   ```
2. (Test de coherencia, evita drift UI↔comportamiento) En `piano-roll-editing.test.ts` añadir un test: toda tecla letra de `KEY_SEMITONES` (`a w s e d f t g y h u j k`) aparece en `PIANO_KEY_LEGEND`; además `z`, `x`, `1`, `2` aparecen. Iterar `Object.keys(KEY_SEMITONES)` y `['z','x','1','2']` y comprobar `PIANO_KEY_LEGEND.includes(k)`.
   - Si `KEY_SEMITONES` no está exportada hoy, exportarla (o exportar un helper `keysInLegend()`); preferible exportar `KEY_SEMITONES` para que el test la lea directamente.

**Verificar:** `NO_COLOR=1 npx vitest run src/core/piano-roll-editing.test.ts` verde. `npx tsc --noEmit` limpio.

> Nota: el drum-grid no tiene teclado de notas; su leyenda (1/2, flechas, Ctrl+C/V, Ctrl+A, Esc) puede vivir como constante separada `DRUM_KEY_LEGEND` en `clip-editor-drum-grid.ts` o junto a la del piano-roll. Definirla en la Tarea 6b para no adelantar trabajo sin test.

---

### Tarea 3 — Reetiquetado honesto en `index.html` (sin lógica)

**Archivos:** `index.html` (332-336).

**Qué hacer (solo rótulos/tooltips, NADA de mover nodos todavía — la reestructuración es la Tarea 7):**
- `#insp-copy`: `Copy Clip` → `Copy notes`; `title` en español: "Copia las notas de este clip".
- `#insp-paste-replace`: `Paste (Replace)` → `Paste ▸ Replace`; `title`: "Reemplaza las notas con las copiadas".
- `#insp-paste-layer`: `Paste (Layer)` → `Paste ▸ Layer`; `title`: "Añade las notas copiadas a las existentes".
- `#insp-toggle-editor`: el rótulo pasará a ser dinámico (Tarea 8); por ahora dejar el `title` en español: "Cambia cómo se EDITA este clip; no cambia el sonido." El texto del botón se gestiona en JS en la Tarea 8.

**Verificar:** `npx tsc --noEmit` limpio (HTML no afecta a tsc, pero confirma que nada se rompió). Visual rápido en `npm run dev` (`http://localhost:5173`): abrir un clip, ver los rótulos nuevos. No hay test unit aquí; queda cubierto por el e2e de la Tarea 11 (rótulos honestos).

---

### Tarea 4 — `renderClipEditor` propaga el tipo (preparación, sin cambio de comportamiento)

**Archivos:** `src/session/clip-editors/clip-editor-router.ts`.

**Qué hacer:** evaluar si `renderClipEditor` necesita exponer el `ClipKind` calculado para que el inspector no recompute. Hoy el inspector llama a `renderClipEditor(...)` y aparte necesitará `classifyClip` para la visibilidad. Para no duplicar la lógica de precedencia en dos sitios:
- Opción A (mínima, preferida): el inspector llama a `classifyClip` por su cuenta (ya es puro y barato) y `renderClipEditor` queda intacto. NO se cambia la firma.
- Opción B: `renderClipEditor` devuelve `{ handle, kind }`. Más invasiva (rompe el tipo de retorno usado en `session-inspector.ts:221` que asigna a `this.roll`).

**Decisión:** Opción A. Esta tarea se reduce a **confirmar que no hace falta cambiar la firma** y dejar `renderClipEditor` como está. Es un checkpoint, no un cambio de código. (Si durante la Tarea 7 se descubre que recomputar diverge, reconsiderar, pero el spec §7 muestra `classifyClip` llamado en `openInspector`, no dentro del router.)

**Verificar:** `npx tsc --noEmit` limpio. Sin commit propio si no hay cambio (fusionar con Tarea 7).

---

### Tarea 5 — Piano-roll: octava como grid-control real ◂ [C4] ▸ (riesgo medio)

> ⚠️ **Confirmar D-E (posición) y D-H (botón vs select) antes de empezar.** El plan asume: control en la toolbar del editor (pegado al canvas) y formato ◂ [C4] ▸.

**Archivos:** `src/core/pianoroll.ts` (174-188, reusar fórmula de 600).

**Qué hacer:**
1. Sustituir el `octLabel` span (178-184) por un grupo de tres elementos en la `toolbar`:
   - botón `◂` (bajar octava = misma mutación que tecla `z`),
   - `octLabel` span (se mantiene, muestra `C${...}`),
   - botón `▸` (subir octava = tecla `x`).
   Mantener `octLabel.style.cssText` con `margin-left:auto` en el contenedor del grupo (un `<div class="editor-grid-control">` que envuelve los tres) para que quede a la derecha como hoy.
2. Extraer la fórmula de clamping a un helper local para no duplicarla entre los botones y las teclas z/x:
   ```ts
   const shiftOctave = (dir: 1 | -1) => {
     octaveBase = Math.max(minMidi, Math.min(maxMidi - 12, octaveBase + dir * 12));
     refreshToolbar();
   };
   ```
   - El botón `▸` llama `shiftOctave(1)`, `◂` llama `shiftOctave(-1)`.
   - En el keydown (599-602) reemplazar el cuerpo por `shiftOctave(e.key === 'x' ? 1 : -1)` (misma fórmula, ahora compartida). Mantener `e.preventDefault()`.
3. Aplicar clase `.editor-grid-control` al contenedor del grupo (estilo en Tarea 10). `title` en los botones: "Octava (z / x)".
4. Mantener z/x como atajos; ahora "anunciados" vía el "?" (Tarea 6a).

**Verificar:**
- `npx tsc --noEmit` limpio.
- Regresión de octava: si `shiftOctave` se extrae a `piano-roll-editing.ts` como helper puro (`clampOctaveBase(octaveBase, dir, minMidi, maxMidi)`), añadir un test unit que verifique el clamping (mismo `Math.max/min`). Si se deja inline en `pianoroll.ts` (que es lo más simple, sin DOM-test trivial), basta el e2e de la Tarea 11 (octava operable por UI). **Recomendado:** extraer a helper puro y testear, para cumplir §Plan-de-pruebas/Unit-3.
- Smoke en `npm run dev`: abrir clip melódico, clicar ▸/◂ cambia la etiqueta; pulsar `x` produce el mismo cambio.

---

### Tarea 6a — Piano-roll: botón "?" de ayuda de teclado (riesgo medio)

> ⚠️ **Confirmar D-G (popover vs leyenda permanente) antes de empezar.** El plan asume botón "?" con popover/`title`.

**Archivos:** `src/core/pianoroll.ts` (toolbar), usa `PIANO_KEY_LEGEND` de la Tarea 2.

**Qué hacer:**
1. Importar `PIANO_KEY_LEGEND` desde `piano-roll-editing.ts`.
2. Añadir a la toolbar un botón `?` (o icono teclado) con clase `.editor-help-btn`.
   - Implementación mínima: `helpBtn.title = PIANO_KEY_LEGEND` (tooltip nativo, multilínea con `\n`).
   - Si se quiere popover propio (mejor UX): al click, togglear un `<pre class="editor-help-popover">` con el texto, posicionado bajo la toolbar; cerrar al re-click o blur. Mantenerlo simple — es la propuesta D-G.
3. Colocar el `?` en la toolbar (a la izquierda del grid-control de octava o al final; coherente con el drum-grid de la Tarea 6b).

**Verificar:** `npx tsc --noEmit` limpio. Smoke: el `?` muestra "a s d f…". Cubierto por e2e Tarea 11 (ayuda descubrible).

---

### Tarea 6b — Drum-grid: grid-control de resolución + "?" de ayuda (riesgo medio)

> ⚠️ Hereda D-E y D-G.

**Archivos:** `src/session/clip-editors/clip-editor-drum-grid.ts` (78-91), constante de leyenda del drum-grid.

**Qué hacer:**
1. Añadir y exportar (o local) `DRUM_KEY_LEGEND` con el set real del drum-grid (verificado en keydown 300-340):
   ```
   Teclado:  1 / 2 = lápiz / selección · ←/→ = mover · ↑/↓ = cambiar voz
             Ctrl+A = todo · Ctrl+C/X/V = copiar/cortar/pegar · ⌫ = borrar · Esc = deseleccionar
   ```
   (Sin teclado de notas — el drum-grid no lo tiene.)
2. Envolver el `resSel` en un `<div class="editor-grid-control">` con una etiqueta "Grid" antepuesta (un `<span>` o `<label>`), para que se lea como el mismo tipo de control que la octava. Aplicar la clase y mantener `margin-left:auto` en el contenedor para alinearlo a la derecha (hoy `resSel` va plano en la toolbar, no a la derecha — alinear con el patrón del piano-roll). `title` del select: "Resolución de rejilla".
3. Añadir botón `?` `.editor-help-btn` con `DRUM_KEY_LEGEND` (mismo patrón que 6a).

**Verificar:** `npx tsc --noEmit` limpio. Smoke: drum-grid muestra "Grid [select]" a la derecha y un "?". El cambio de resolución sigue persistiendo en `clip.gridResolution` (no romper el handler `change` de la línea 89).

---

### Tarea 7 — Reestructurar la barra del inspector en index.html + cablear visibilidad (riesgo más alto)

> ⚠️ Depende de la Tarea 1 (`classifyClip`) y del reetiquetado (Tarea 3). Asume D-E confirmada (los grid-controls quedan en la toolbar del editor, NO suben al inspector).

**Archivos:** `index.html` (318-340), `src/session/session-inspector.ts` (`openInspector` 108-194).

**Qué hacer (HTML):** dividir la única `.session-inspector-row` en dos sub-filas dentro de `#session-inspector`, según §2 del spec:
```html
<div class="clip-transport-row">
  <label>Name <input id="insp-name" type="text" /></label>
  <label>Length (bars) <input id="insp-length" type="number" min="1" step="1" /></label>
  <label>Launch
    <select id="insp-quantize"> … (mismas opciones, mover aquí) … </select>
  </label>
  <button class="rnd" id="insp-duplicate">Duplicate</button>
  <button class="rnd" id="insp-delete">✕ Delete</button>
</div>
<div class="clip-edit-row">
  <button class="rnd" id="insp-copy">Copy notes</button>
  <button class="rnd" id="insp-paste-replace" disabled>Paste ▸ Replace</button>
  <button class="rnd" id="insp-paste-layer" disabled>Paste ▸ Layer</button>
  <button class="rnd primary" id="insp-random-notes" title="Aleatoriza las notas del clip">🎲 Notes</button>
  <button class="rnd" id="insp-toggle-editor" title="Cambia cómo se EDITA este clip; no cambia el sonido."></button>
</div>
<div id="insp-roll-host" class="session-inspector-roll"></div>
```
- Cambiar la etiqueta del select de "Quantize" a "Launch".
- El grid-control de octava/resolución NO va aquí (vive en la toolbar del editor — Tareas 5/6b).

**Qué hacer (JS, `openInspector`):**
1. Tras resolver `lane`/`clip`, calcular `const kind = classifyClip(lane, clip, getEngine(lane.engineId)?.editor, editorOverride.get(clip.id))`. (Importar `classifyClip` y `getEngine`.)
2. Mostrar/ocultar `.clip-edit-row` según `kind`:
   - `audio` → `.clip-edit-row` `hidden = true` (un audio-clip no tiene notas que copiar ni rejilla).
   - `notes` / `drums` → `.clip-edit-row` `hidden = false`.
   - Obtener la fila con `document.querySelector('.clip-edit-row')` o darle un id (`#insp-edit-row`) para selección robusta. **Preferible un id** (`#insp-edit-row`, `#insp-transport-row`) por estabilidad de selectores en el e2e.
3. El handler del Launch-quantize (`qEl`, 138-144) NO cambia su lógica; solo vive bajo `.clip-transport-row`. El `qEl` se sigue obteniendo por `getElementById('insp-quantize')` (id no cambia), así que el cableado existente funciona sin tocarlo.
4. Copy/Paste/Duplicate/Delete/random: los `getElementById` por id no cambian (los ids se conservan), así que el cableado de 146-190 sigue válido. Solo cambió su contenedor en el HTML.

**Verificar:**
- `npx tsc --noEmit` limpio.
- `NO_COLOR=1 npx vitest run` (el suite unit no toca el DOM del inspector, pero confirma que nada de la lógica pura se rompió).
- Smoke en `npm run dev`: abrir clip melódico (edit-row visible), clip de audio (edit-row oculta), confirmar Launch en la fila de transporte.

---

### Tarea 8 — Toggle de vista: rótulo dinámico + visibilidad condicional (riesgo medio)

> ⚠️ **Confirmar D-F (visibilidad: notes+drums vs solo drums) antes de empezar.** El plan asume notes+drums, oculto para audio.

**Archivos:** `src/session/session-inspector.ts` (`openInspector`, toggle-editor 168-175).

**Qué hacer:**
1. Rótulo dinámico según el editor activo (no según el override): calcular el editor resuelto con `chooseClipEditor(lane, getEngine(lane.engineId)?.editor, editorOverride.get(clip.id))`:
   - si resuelve `drum-grid` → texto del botón "Ver como piano-roll".
   - si resuelve `piano-roll` → texto "Ver como rejilla".
   Asignar `toggleBtn.textContent` en `openInspector` (tras calcular `kind`).
2. Visibilidad: ocultar `#insp-toggle-editor` cuando `kind === 'audio'` (o cuando D-F restrinja a solo `drums`). Mostrar para `notes`/`drums`.
3. El handler `onclick` (168-175) mantiene su lógica (escribe en `editorOverride`, llama `renderEditor`). Tras el toggle, `renderEditor` re-renderiza; el rótulo se recalcula en el siguiente `openInspector` — **pero el toggle no llama a `openInspector`**, solo a `renderEditor`. Para que el rótulo se actualice tras el click, extraer el cálculo del rótulo a un método `private refreshToggleLabel()` y llamarlo tanto en `openInspector` como al final del `onclick` del toggle.

**Verificar:** `npx tsc --noEmit` limpio. Smoke: en un lane de drums el botón lee "Ver como piano-roll"; al pulsarlo cambia a piano-roll y el rótulo pasa a "Ver como rejilla". En un clip de audio el botón no aparece. Cubierto por e2e Tarea 11 (rótulos honestos: tooltip "no cambia el sonido").

---

### Tarea 9 — Cabecera de audio: quitar texto estático duplicado (riesgo bajo, pero acoplada al frente D)

> ⚠️ **Confirmar D-A (Slice), D-B (Warp), D-C (trim/warp WAV puro) antes de decidir cuánto se quita.** Lo que SÍ entra sin depender de D: eliminar los spans BPM/bars (duplicación pura).

**Archivos:** `src/session/clip-editors/clip-waveform-header.ts` (`renderAudioClipEditor` 108-144).

**Qué hacer:**
1. **Sin depender de D (hacer siempre):** eliminar `bpmLabel` (118-122) y `barsLabel` (123-124) y quitarlos del `toolbar.append(...)` (138). El BPM vive en `clip.sample.originalBpm` y la longitud en `Length (bars)` del inspector — son texto estático duplicado.
2. **Según D-A/D-B/D-C:**
   - Si D confirma que Slice→pads sale del editor → eliminar `sliceBtn` (132-136) y su append.
   - Si D confirma que Warp sale → eliminar `warpBtn` (126-130) y su append.
   - Si la decisión de D no ha aterrizado → eliminar SOLO los spans BPM/bars y dejar Warp/Slice como están (placeholder), con un comentario `// TODO(frente D): destino de Warp/Slice pendiente`.
3. Si tras quitar elementos el `toolbar` queda vacío, no montarlo (evitar una barra vacía); dejar `renderAudioClipEditor` como "solo waveform" (`mountWaveformHeader`).
4. `mountWaveformHeader` (25-101) NO se toca.

**Verificar:** `npx tsc --noEmit` limpio. Smoke: abrir clip de audio, confirmar que la cabecera ya no muestra `BPM …`/`… bar`. Cubierto por e2e Tarea 11 (la cabecera de audio no contiene texto `BPM`/`bar`).

---

### Tarea 10 — SCSS: filas del inspector + `.editor-grid-control` + popover de ayuda

**Archivos:** `src/styles/_session-inspector.scss` (10-18).

**Qué hacer:**
1. Reemplazar `.session-inspector-row` por `.clip-transport-row` y `.clip-edit-row` (mismo `display:flex; gap; align-items; flex-wrap`), con un **separador visual sutil** entre planos: p.ej. un `border-top: 1px solid var(--border); margin-top/padding-top` en `.clip-edit-row` para leerse como "edición" vs "propiedades del clip". Migrar los selectores hijos `label`, `input[type=text]`, `input[type=number]` a ambas clases (o a un selector común `.clip-transport-row, .clip-edit-row`).
2. Añadir `.editor-grid-control` (estilo compartido octava/resolución): contenedor flex con `gap` pequeño, `margin-left:auto` para anclar a la derecha de la toolbar, botones ◂/▸ compactos, etiqueta monoespaciada. Definir en este SCSS o en el del editor; el spec acepta cualquiera de los dos.
3. Añadir `.editor-help-btn` (botón "?") y, si se usa popover (D-G), `.editor-help-popover` (`<pre>` posicionado, fondo `var(--surface-2)`, borde, `white-space:pre`, font monoespaciada, z-index sobre el canvas).

**Verificar:** `npm run build` (compila SCSS). Smoke visual en `npm run dev`: las dos filas se distinguen; octava/resolución se leen igual; el "?" tiene aspecto de botón.

---

### Tarea 11 — Playwright e2e: `tests/e2e/clip-editor-inspector.spec.ts` (NUEVO)

> ⚠️ **`npm run build` ANTES de `npm run test:e2e`** (sirve `dist/` sin build). Esta tarea va al final porque ejercita toda la UI ya integrada.

**Archivos:** `tests/e2e/clip-editor-inspector.spec.ts` (nuevo), patrón de `clip-click.spec.ts` (`waitForBoot`, clic en `.session-cell-filled`).

**Qué hacer:** cubrir los 6 escenarios del §Plan-de-pruebas/Playwright:
1. **Separación transporte vs edición** — abrir un clip melódico: `#insp-quantize` (Launch) está dentro de `.clip-transport-row` (o `#insp-transport-row`) y NO dentro de `.clip-edit-row`; Name/Length/Duplicate/Delete también en transporte.
2. **Visibilidad por tipo:**
   - clip melódico → `.clip-edit-row` visible con "Copy notes" / "🎲 Notes"; la toolbar del editor muestra el grid-control de octava (texto `C…`).
   - clip de percusión (lane drums-machine o sampler-drumkit) → toolbar muestra el grid-control de resolución (el `<select>` con "Grid"); `.clip-edit-row` visible. (Elegir un clip de un lane de drums del proyecto de arranque; si el boot no trae uno, crear/usar el demo apropiado — verificar qué clips trae `waitForBoot`.)
   - clip de audio (lane audio con sample) → `.clip-edit-row` oculta (`hidden`); la cabecera de audio no contiene texto `BPM`/`bar`. (Si el boot no trae un clip de audio, este sub-caso puede requerir un fixture; si no es viable en e2e, documentarlo y cubrir audio en smoke manual + el unit de `classifyClip`.)
3. **Rótulos honestos** — `#insp-copy` lee "Copy notes"; paste-replace/layer leen "Paste ▸ …"; `title` del toggle menciona "no cambia el sonido".
4. **Octava operable por UI** — clicar `▸` del grid-control de octava cambia la etiqueta (p.ej. C4→C5) sin teclado; pulsar `x` en el editor produce el mismo cambio (paridad UI↔atajo). Para enfocar el editor antes de pulsar `x`, clicar el `wrap` (tabIndex) o el canvas.
5. **Ayuda descubrible** — el botón "?" existe en la toolbar y, al activarlo (o vía `title`), muestra la leyenda con "a s d f" (piano-roll).
6. **Launch-quantize sigue funcionando** — cambiar Launch a "1 bar" (value `1/1`) persiste en `clip.launchQuantize` (verificar reabriendo el inspector y comprobando `value` del select, o vía un `window`-hook si existe); undo (Ctrl+Z) lo revierte.

**Verificar:** `npm run build` && `npm run test:e2e` verde (o `npx playwright test tests/e2e/clip-editor-inspector.spec.ts` para iterar). Ajustar selectores a los ids reales tras las Tareas 5-8.

---

### Tarea 12 — Verificación final (typecheck + unit + build + smoke navegador)

**Qué hacer (en orden):**
1. `npx tsc --noEmit` — limpio.
2. `npm run test:unit` — verde. (Re-ejecutar si `ERR_IPC_CHANNEL_CLOSED` en teardown — flaky conocido, no es fallo de test.)
3. `npm run build` — typecheck + bundle sin errores.
4. `npm run test:e2e` — verde (sirve el `dist/` recién construido).
5. **Smoke manual** en `http://localhost:5173` (`npm run dev`):
   - Abrir un clip de cada tipo (melódico, percusión, audio).
   - Confirmar que la barra del inspector solo muestra lo aplicable a cada tipo (audio → sin `.clip-edit-row`).
   - Octava (piano-roll) y resolución (drum-grid) se leen con el mismo patrón visual (grid-control a la derecha).
   - La cabecera de audio ya no repite BPM/Length.
   - Launch-quantize está en transporte y funciona; Copy/Paste leen "notas".
   - El "?" descubre los atajos de teclado en ambos editores.
6. Confirmar que ninguna de las Dudas Abiertas quedó sin resolver/anotar: si alguna se ejecutó por la propuesta por defecto sin confirmación del usuario, dejar nota explícita en el commit/PR.

**Verificar:** todo lo anterior verde + smoke OK. Es la puerta para `git rebase main` → `git merge --ff-only` → `ExitWorktree`.

---

## Resumen de archivos tocados

| Archivo | Tareas |
|---------|--------|
| `src/session/clip-editors/clip-editor-router.ts` (+ `.test.ts`) | 1, 4 |
| `src/core/piano-roll-editing.ts` (+ `.test.ts`) | 2, (5 si se extrae el helper de octava) |
| `index.html` | 3, 7 |
| `src/core/pianoroll.ts` | 5, 6a |
| `src/session/clip-editors/clip-editor-drum-grid.ts` | 6b |
| `src/session/session-inspector.ts` | 7, 8 |
| `src/session/clip-editors/clip-waveform-header.ts` | 9 |
| `src/styles/_session-inspector.scss` | 10 |
| `tests/e2e/clip-editor-inspector.spec.ts` (nuevo) | 11 |

## Notas de proceso

- Worktree ya activo; commitear cada tarea por separado y **rebasar sobre `main` tras casi cada commit** (instrucción global). Resolver conflictos en el momento.
- No tocar `SessionClip`/`saved-state-v3`/DSP (fuera de alcance).
- Aserciones de test siempre relativas.
- Tooltips de cara al usuario en español (castellano); los rótulos de botones siguen el inglés que fija el spec ("Copy notes", "Paste ▸ Replace", "Launch").
