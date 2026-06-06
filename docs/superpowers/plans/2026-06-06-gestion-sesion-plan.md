# Frente A · Gestión de sesión — Plan de implementación

**Fecha:** 2026-06-06
**Estado:** plan de implementación (TDD donde aplique).
**Deriva de:** [2026-06-06-gestion-sesion-design.md](../specs/2026-06-06-gestion-sesion-design.md).
**Índice maestro:** [2026-06-06-loom-ux-overhaul-overview.md](../specs/2026-06-06-loom-ux-overhaul-overview.md), sección "Frente A".

---

## Cómo usar este plan

- Las tareas están ordenadas de **menor a mayor riesgo**. Las primeras son lógica pura (modelo + predicados + módulo nuevo aislado), testeables al 100% en Vitest sin tocar la UI ni el audio. Las últimas tocan `SessionHost` (estado + audio + undo), que es lo delicado.
- **TDD donde aplique:** para la lógica pura, escribe primero el test (rojo), luego implementa, luego verde. Para la UI / wiring, escribe el e2e después de implementar (Playwright sirve `dist/`, así que el ciclo rojo→verde es más caro; ahí prima el typecheck + smoke).
- **Verificación por tarea:** cada tarea dice cómo comprobarla. Comandos de referencia:
  - `npx tsc --noEmit` — typecheck sin bundle.
  - `NO_COLOR=1 npx vitest run ruta/al/fichero.test.ts` — un test unitario suelto.
  - `npm run test:unit` — toda la batería Vitest (re-run si salta `ERR_IPC_CHANNEL_CLOSED` en teardown, flaky conocido).
  - `npm run build && npm run test:e2e` — e2e Playwright (el build es OBLIGATORIO antes; `test:e2e` sirve `dist/` sin construir).
- **DUDAS ABIERTAS:** hay un bloque al principio con las decisiones pendientes del usuario. Cada una está marcada en la tarea que bloquea con `⚠️ CONFIRMAR ANTES (Duda N)`. **No las resuelvas tú**; pregunta al usuario antes de empezar esa tarea.

---

## DUDAS ABIERTAS — confirmar con el usuario ANTES de las tareas marcadas

Copiadas del spec (sección "Dudas abiertas"). Bloquean la tarea indicada.

| # | Duda | Bloquea |
|---|------|---------|
| **D1** | **Estilo de confirmación:** ¿`window.confirm` nativo (rápido, feo) o un mini-diálogo propio coherente con la UI de Loom? El plan asume `window.confirm` en v1. | Tarea 9, Tarea 10 |
| **D2** | **`deleteScene` ¿compacta o no?** El diseño propuesto **no** desplaza las filas de clips al borrar una scene (mantiene índices). Alternativa: compactar (`splice(idx,1)` en cada columna). | Tarea 4 |
| **D3** | **¿Retirar el borrado por teclado del inspector?** Propuesta: **mantenerlo** (no estorba, es un atajo). | Tarea 11 |
| **D4** | **Confirmación al borrar clip:** el plan borra clips **siempre directo** (sin confirmar). ¿Un clip con muchas notas merece confirmación? | Tarea 8 |
| **D5** | **Ítem "Duplicar clip" en el menú contextual:** ¿se incluye en v1 (reusando la lógica de `insp-duplicate`) o se deja para más tarde? | Tarea 13 |
| **D6** | **Migrar los `contextmenu` existentes** (drum-grid, piano-roll) al nuevo `context-menu.ts`: hoy solo hacen `preventDefault`. ¿Darles menú real o dejarlo fuera? | Fuera de alcance v1 (no bloquea ninguna tarea; mencionado en Tarea 12) |

> Las dudas del **Frente D** (Sampler & audio) NO se deciden aquí. Este frente solo arregla la **siembra** de canales de audio (clip en fila 0, resto vacío) y el bug del ▶; no reubica la responsabilidad loop↔audio.

---

## Mapa de archivos (resumen)

| Archivo | Tarea(s) |
|---|---|
| `src/session/session.ts` | T1–T5 (helpers puros + predicados) |
| `src/session/session.test.ts` (nuevo o existente) | T1–T5 (tests pura) |
| `src/core/context-menu.ts` (**NUEVO**) | T6 |
| `src/core/context-menu.test.ts` (**NUEVO**) | T6 |
| `src/styles/_context-menu.scss` (**NUEVO**) | T6 |
| `src/session/session-ui.ts` | T7 (callbacks + aspa), T12 (contextmenu) |
| `src/styles/_session-grid.scss` | T7 (`.session-del-cross`) |
| `src/session/session-host.ts` | T8–T11 (wiring + siembra), T14 (fix ▶) |
| `src/session/session-inspector.ts` | T11 (refactor `deleteSelectedClip`) |
| `src/core/scene-ensure.test.ts` | T14 (regresión ▶) |
| `tests/e2e/session-management.spec.ts` (**NUEVO**) | T15 |

---

## Tareas

### Tarea 1 — `deleteClipAt(lane, clipIdx)` (lógica pura)

**Archivos:** `src/session/session.ts`, `src/session/session.test.ts` (crear si no existe).

**Qué hacer:**
- TDD. Escribe primero el test:
  - Dado `lane.clips = [clipA, clipB, clipC]`, `deleteClipAt(lane, 1)` deja `clips[1] === null` y **no desplaza**: `clips[0] === clipA`, `clips[2] === clipC` (NO `splice`).
  - `deleteClipAt(lane, 0)` con un solo clip → `clips[0] === null`, `length` se conserva.
  - Idempotente sobre un `null`: `deleteClipAt(lane, idx)` donde ya es `null` no rompe.
- Implementa junto a `moveClip`/`copyClip` (`session.ts:266`), estilo mutación in-place:
  ```ts
  export function deleteClipAt(lane: SessionLane, clipIdx: number): void {
    if (clipIdx >= 0 && clipIdx < lane.clips.length) lane.clips[clipIdx] = null;
  }
  ```
  (No usar `splice`: hay que preservar el índice de fila para que el resto de la columna no se desplace.)

**Cómo verificar:** `NO_COLOR=1 npx vitest run src/session/session.test.ts` verde; `npx tsc --noEmit` limpio.

---

### Tarea 2 — `deleteLane(state, laneId)` (lógica pura, sin tocar audio)

**Archivos:** `src/session/session.ts`, `src/session/session.test.ts`.

**Qué hacer:**
- TDD. Test:
  - `deleteLane(state, 'L2')` quita la lane de `state.lanes` (queda fuera del array).
  - Limpia `scene.clipPerLane['L2']` en **todas** las scenes (la entrada colgada se borra: `delete scene.clipPerLane[laneId]`).
  - No toca las otras lanes (sus `clips` y su entrada en `clipPerLane` intactas).
  - No-op silencioso si el `laneId` no existe.
- Implementa:
  ```ts
  export function deleteLane(state: SessionState, laneId: string): void {
    const i = state.lanes.findIndex((l) => l.id === laneId);
    if (i < 0) return;
    state.lanes.splice(i, 1);
    for (const scene of state.scenes) delete scene.clipPerLane[laneId];
  }
  ```
  **No** toca recursos de audio (separación pura/efecto: el host hace `dispose` tras la mutación, ver Tarea 9).

**Cómo verificar:** vitest del fichero verde; `npx tsc --noEmit` limpio.

---

### Tarea 3 — Predicados `laneHasContent` / `sceneHasContent` (lógica pura)

**Archivos:** `src/session/session.ts`, `src/session/session.test.ts`.

**Qué hacer:**
- TDD. Test:
  - `laneHasContent(lane)` → `true` si `lane.clips.some(c => c != null)`; `false` con `clips: []` o todo `null`.
  - `sceneHasContent(state, idx)` → `true` si alguna lane tiene un clip en `lane.clips[idx]` **o** si alguna `scene.clipPerLane` referencia algún clip de esa fila; `false` cuando la fila no tiene nada lanzable.
- Implementa:
  ```ts
  export function laneHasContent(lane: SessionLane): boolean {
    return lane.clips.some((c) => c != null);
  }
  export function sceneHasContent(state: SessionState, sceneIdx: number): boolean {
    return state.lanes.some((l) => l.clips[sceneIdx] != null);
  }
  ```
  (Criterio operativo del spec: ¿borrar la fila pierde algo lanzable? Si la fila tiene cualquier clip → sí. La rama `clipPerLane` es defensiva; basta con la presencia de clip en la fila.)

**Cómo verificar:** vitest verde; `npx tsc --noEmit` limpio.

---

### Tarea 4 — `deleteScene(state, sceneIdx)` (lógica pura) ⚠️ CONFIRMAR ANTES (Duda D2)

**Archivos:** `src/session/session.ts`, `src/session/session.test.ts`.

> ⚠️ **Antes de implementar, confirma D2 con el usuario:** ¿`deleteScene` compacta las filas de clips o no? El plan asume **NO compactar** (mantener índices de fila). Si el usuario quiere compactar, la implementación cambia (cada columna hace `splice(idx,1)` y hay que revisar `clipPerLane`).

**Qué hacer (variante NO-compacta, la propuesta):**
- TDD. Test:
  - `deleteScene(state, 1)` quita `state.scenes[1]` del array (`scenes.length` baja en 1).
  - **No** desplaza filas de clips: para una lane con `clips = [A, B, C]`, tras borrar la scene 1 sigue siendo `clips = [A, B, C]` (assert explícito de que `clips[2]` no se movió). Documentar este comportamiento con un comentario en el código y en el nombre del test (`'deleteScene does NOT compact clip rows'`).
- Implementa:
  ```ts
  export function deleteScene(state: SessionState, sceneIdx: number): void {
    if (sceneIdx >= 0 && sceneIdx < state.scenes.length) state.scenes.splice(sceneIdx, 1);
  }
  ```

**Cómo verificar:** vitest verde; `npx tsc --noEmit` limpio.

---

### Tarea 5 — Tests de "siembra vacía" como contrato puro (rojo→verde tardío)

**Archivos:** `src/session/session.test.ts`.

**Qué hacer:**
- Estos tests **codifican el contrato** que las Tareas 8/9 harán cumplir en el host. Escríbelos ahora sobre helpers puros, donde sea posible, para fijar la expectativa:
  - `emptyLane(id, engineId)` ya nace con `clips: []` (verificar — es el contrato de instrumento "vacío de verdad"). Test trivial de regresión: `emptyLane('x','tb303').clips.length === 0`.
  - Patrón de canal de audio: dado un `clip` y `lane.clips = [clip]`, leer `lane.clips[1] ?? null` da `null` (no hay clip fantasma). Test que documenta el patrón `lane.clips = [clip]` (clip en fila 0, resto vacío).
- No hay implementación en esta tarea (los helpers ya existen); es para **fijar el contrato** antes de tocar el host. Si `emptyLane` ya devuelve `clips: []`, el test pasa en verde de inmediato y sirve de red de seguridad.

**Cómo verificar:** vitest verde; `npx tsc --noEmit` limpio.

> Nota: el cumplimiento real de "lane nace vacía" en los caminos del host (`onAddLane`, etc.) se verifica con e2e en Tarea 15 (caso "Lane nace vacía") porque esos caminos son métodos de instancia con efectos (audio, render), difíciles de testear como pura.

---

### Tarea 6 — Módulo nuevo `context-menu.ts` + estilos + tests jsdom (aislado, riesgo bajo)

**Archivos NUEVOS:** `src/core/context-menu.ts`, `src/core/context-menu.test.ts`, `src/styles/_context-menu.scss`.

**Qué hacer:**
- TDD (jsdom, Vitest ya corre en jsdom para tests de DOM puro). Tests:
  - `openContextMenu(e, items)` añade un `<ul class="context-menu">` al `document.body`.
  - Posiciona en `e.clientX/clientY` (assert de que `style.left/top` reflejan las coords; corrección de viewport puede testearse con un caso de coords grandes).
  - Click en un ítem dispara su `onSelect` y **cierra** el menú (se elimina del DOM).
  - Click fuera del menú lo cierra; `Escape` lo cierra.
  - Un ítem con `disabled: true` NO dispara `onSelect` y se renderiza con clase `disabled`.
  - Abrir un segundo menú cierra el primero (solo uno a la vez).
  - `e.preventDefault()` se llama (mockear `preventDefault` y assertar).
- Implementa la API mínima del spec:
  ```ts
  export interface ContextMenuItem {
    label: string;
    onSelect: () => void;
    disabled?: boolean;
    danger?: boolean;        // estilo "borrar"
    separatorBefore?: boolean;
  }
  export function openContextMenu(e: MouseEvent, items: ContextMenuItem[]): void;
  ```
  - DOM puro, sin dependencias. Construye `<ul>` con `<li>` por ítem (los `separatorBefore` insertan un `<li class="context-menu-sep">` o un borde CSS).
  - Cierre: registra `click` (capture) en `document`, `keydown` Escape, y limpia ambos al cerrar. Guarda el menú abierto en un módulo-singleton (`let openMenu`) para cerrar el anterior.
  - `danger` añade una clase para el estilo rojo.
- SCSS `_context-menu.scss`: lista vertical, `position: fixed`, z-index alto, ítem `danger` rojo, `disabled` atenuado + `pointer-events: none`. Importar el parcial en el SCSS raíz (revisar `src/styles/` para el `@use`/`@import` del índice; añadir la línea).

**Cómo verificar:** `NO_COLOR=1 npx vitest run src/core/context-menu.test.ts` verde; `npx tsc --noEmit` limpio; `npm run build` compila el SCSS sin error.

---

### Tarea 7 — Aspa ✕ de borrado en el grid (UI en `session-ui.ts` + SCSS)

**Archivos:** `src/session/session-ui.ts`, `src/styles/_session-grid.scss`.

**Qué hacer:**
1. Extender `SessionUICallbacks` (`session-ui.ts:8`) con:
   ```ts
   onDeleteClip:  (laneId: string, clipIdx: number) => void;
   onDeleteLane:  (laneId: string) => void;
   onDeleteScene: (sceneIdx: number) => void;
   ```
   (Esto romperá el typecheck hasta que `SessionHost` los provea en Tareas 8–10 — es esperado; puedes hacer T7–T10 en una rama y typecheckear al final, o stubear temporalmente.)
2. Helper interno `deleteCross(title, onDelete)`:
   ```ts
   function deleteCross(title: string, onDelete: () => void): HTMLElement {
     const b = document.createElement('button');
     b.className = 'session-del-cross';
     b.title = title;
     b.textContent = '✕';
     b.addEventListener('click', (e) => { e.stopPropagation(); onDelete(); });
     return b;
   }
   ```
3. Insertar el aspa:
   - **Lane:** en `laneHeader` (`session-ui.ts:135`), como **primer hijo** del `.session-lane-header`, antes del `name`. `title="Borrar pista"` → `cb.onDeleteLane(lane.id)`.
   - **Scene:** en `sceneLaunchCell` (`session-ui.ts:219`), dentro de la rama `if (scene)`, antes del botón `▶`. `title="Borrar escena"` → `cb.onDeleteScene(idx)`. Las celdas de scene vacías (`else`) **no** llevan aspa.
   - **Clip:** en `clipCell` (`session-ui.ts:170`), solo en la rama `if (clip)`, como **primer hijo** antes del `label`. `title="Borrar clip"` → `cb.onDeleteClip(lane.id, rowIdx)`. **Crítico:** igual que el `playIcon`, el aspa debe `stopPropagation` en `pointerdown`/`pointerup`/`click` para no disparar `wireClipDrag`/`onClipClick` (el helper ya hace `stopPropagation` en `click`; añade los handlers `pointerdown`/`pointerup` al botón del clip — replica el patrón del `playIcon` en `session-ui.ts:183-184`).
4. SCSS `.session-del-cross` en `_session-grid.scss` (mismo parcial que `session-cell-filled`): pequeña, esquina superior izquierda (`position: absolute; top/left`), atenuada por defecto (`opacity` baja), hover color "danger" (rojo). Asegurar que coexiste con `▶` (a la derecha del clip) y con `⚙` (`.session-lane-edit`) sin solaparse — ajustar paddings si hace falta. El clip lleno y el header de lane deben ser `position: relative` para anclar el aspa absoluta.

**Cómo verificar:** `npx tsc --noEmit` (limpio una vez existan los callbacks del host; si haces T7 antes que T8–T10, el typecheck fallará por callbacks faltantes — completa hasta T10 antes de typecheckear el conjunto). `npm run build` compila el SCSS. Verificación visual real en Tarea 15 (e2e).

---

### Tarea 8 — Wiring `onDeleteClip` en `SessionHost` ⚠️ CONFIRMAR ANTES (Duda D4)

**Archivos:** `src/session/session-host.ts`.

> ⚠️ **Antes de implementar, confirma D4:** ¿un clip con muchas notas se borra directo (sin confirmar)? El plan asume **sí, directo** (la confirmación se reserva a lane/scene).

**Antes de editar `buildCallbacks`:** correr `gitnexus_impact({target: "buildCallbacks", direction: "upstream"})` y reportar el blast radius (instrucción del CLAUDE.md del proyecto). Es un método grande y central; avisar si HIGH/CRITICAL.

**Qué hacer:**
- En `buildCallbacks` (`session-host.ts:604`), añadir al objeto `this.callbacks`:
  ```ts
  onDeleteClip(laneId, clipIdx) {
    const lane = self.state.lanes.find((l) => l.id === laneId);
    if (!lane || lane.clips[clipIdx] == null) return; // vacío → no-op
    const hd = self.deps.historyDeps;
    const run = () => {
      deleteClipAt(lane, clipIdx);
      // Si el clip borrado era el seleccionado del inspector, cerrar el panel.
      const sel = self.inspector.getSelectedClip?.();
      if (sel && sel.laneId === laneId && sel.clipIdx === clipIdx) {
        self.inspector.setSelectedClip(null);
        const panel = document.getElementById('session-inspector');
        if (panel) panel.hidden = true;
      }
      self.renderWithMixer();
    };
    if (hd) withUndo(hd, run); else run();
  },
  ```
  - Importar `deleteClipAt` de `./session`.
  - Un clip individual **siempre se borra directo** (sin confirmación), coherente con el índice maestro.

**Cómo verificar:** `npx tsc --noEmit` limpio (junto con T7/T9/T10); cobertura de comportamiento en e2e Tarea 15 (caso "Aspa borra clip").

---

### Tarea 9 — Wiring `onDeleteLane` (confirmación + dispose de audio + limpieza) ⚠️ CONFIRMAR ANTES (Duda D1)

**Archivos:** `src/session/session-host.ts`.

> ⚠️ **Antes de implementar, confirma D1:** ¿`window.confirm` nativo o mini-diálogo propio? El plan asume `window.confirm` en v1. Si el usuario quiere componente propio, es una sub-tarea de UI adicional.

**Esta es una de las tareas más delicadas** (toca estado + audio + undo). `gitnexus_impact` sobre `buildCallbacks` ya hecho en T8.

**Qué hacer:**
- Añadir a `this.callbacks`:
  ```ts
  onDeleteLane(laneId) {
    const lane = self.state.lanes.find((l) => l.id === laneId);
    if (!lane) return;
    if (laneHasContent(lane)) {
      const label = lane.name ?? lane.id;
      if (!window.confirm(`¿Borrar la pista «${label}» y todos sus clips?`)) return;
    }
    const hd = self.deps.historyDeps;
    const run = () => {
      deleteLane(self.state, laneId);              // mutación pura del estado
      self.laneStates.delete(laneId);              // estado de reproducción
      self.deps.laneResources?.dispose(laneId);    // libera audio (strip+engine+inserts)
      if (self.activeEditLane === laneId) {
        // mismo gesto que el toggle-off de onEditLane
        document.querySelectorAll<HTMLElement>('.page').forEach((p) => { p.hidden = true; });
        document.querySelectorAll<HTMLButtonElement>('.session-lane-tab').forEach((t) => t.classList.remove('active'));
        self.activeEditLane = null;
        self.deps.onActiveLaneChanged?.();
      }
      self.refreshSynthTabs();
      self.renderWithMixer();
    };
    if (hd) withUndo(hd, run); else run();
  },
  ```
  - Importar `deleteLane`, `laneHasContent` de `./session`.
  - **No** llamar `ensureScenesForRows` (borrar columnas no añade filas).
- **Undo de borrado de lane (el punto más delicado del frente):** verificar que al deshacer, la lane restaurada **recupera su recurso de audio**. El `restore` del historial llama por el camino de `applyLoadedSessionState`/`onStateApplied`, que re-alloca lanes sin recurso (`ensureLaneResource`, ver `session-host.ts:336-341`). **Confirmar empíricamente** que el undo pasa por ese re-allocate; si no, el `restore` debe forzar un `ensureLaneResource` para la lane restaurada. Esto se cubre con el e2e Tarea 15 (caso "Undo de borrado de lane": lanzar su clip tras el undo no debe dar `stripFor: no resource`).

**Cómo verificar:** `npx tsc --noEmit` limpio; e2e Tarea 15 (casos "Aspa borra lane", "Borrado de lane vacía sin diálogo", "Undo de borrado de lane").

---

### Tarea 10 — Wiring `onDeleteScene` (confirmación condicional) ⚠️ CONFIRMAR ANTES (Duda D1)

**Archivos:** `src/session/session-host.ts`.

> ⚠️ Misma Duda D1 (estilo de confirmación) que la Tarea 9.

**Qué hacer:**
- Añadir a `this.callbacks`:
  ```ts
  onDeleteScene(sceneIdx) {
    const scene = self.state.scenes[sceneIdx];
    if (!scene) return;
    if (sceneHasContent(self.state, sceneIdx)) {
      const label = scene.name ?? `Scene ${sceneIdx + 1}`;
      if (!window.confirm(`¿Borrar la escena «${label}»?`)) return;
    }
    const hd = self.deps.historyDeps;
    const run = () => {
      // Parar/limpiar lo que estuviera sonando o encolado de esa fila (decisión
      // del spec: parar lo lanzable de la scene borrada).
      for (const lp of self.laneStates.values()) {
        const lane = self.state.lanes.find((l) => l.id === lp.laneId);
        const clipInRow = lane?.clips[sceneIdx];
        if (clipInRow && (lp.playing?.id === clipInRow.id || lp.queued?.id === clipInRow.id)) {
          stopLane(self.laneStates, lp.laneId,
            self.deps.recHooks ? { ...self.deps.recHooks, nowCtx: ctx.currentTime } : undefined);
        }
      }
      deleteScene(self.state, sceneIdx);
      self.renderWithMixer();
    };
    if (hd) withUndo(hd, run); else run();
  },
  ```
  - Importar `deleteScene`, `sceneHasContent` de `./session`. `stopLane` y `ctx` ya están en scope dentro de `buildCallbacks`.

**Cómo verificar:** `npx tsc --noEmit` limpio; e2e Tarea 15 (caso "Aspa borra scene").

---

### Tarea 11 — Refactor `deleteSelectedClip` para delegar en `onDeleteClip` ⚠️ CONFIRMAR ANTES (Duda D3)

**Archivos:** `src/session/session-inspector.ts`.

> ⚠️ **Antes de implementar, confirma D3:** ¿se MANTIENE el borrado por teclado (Delete/Backspace) del inspector? El plan asume **sí, se mantiene** (el aspa es el camino primario, pero el atajo no estorba). Si el usuario quiere retirarlo, esta tarea cambia a "eliminar `wireKeyboardShortcuts`/`deleteSelectedClip`".

**Qué hacer (variante mantener):**
- `deleteSelectedClip` (`session-inspector.ts:77`) y `onDeleteClip` del host hacen lo mismo (poner `null` + cerrar panel). Para no duplicar, hay dos opciones:
  - **(a)** Dejar `deleteSelectedClip` tal cual (ya funciona; bajo riesgo). El spec lo permite ("conservarlo no estorba").
  - **(b)** Refactor: que `deleteSelectedClip` delegue en el `onDeleteClip` del host. Requiere que el inspector tenga acceso al callback del host. Hoy el inspector NO recibe `SessionUICallbacks`; añadir esa dependencia es más invasivo.
- **Recomendación:** opción **(a)** para v1 (menor riesgo) — el aspa y el teclado comparten la lógica de "poner null + cerrar panel" pero por dos caminos pequeños y bien acotados. Documentar en un comentario que ambos existen. Si el usuario insiste en deduplicar (b), extraer un helper compartido en el host expuesto al inspector.

**Cómo verificar:** `npx tsc --noEmit` limpio; el atajo Delete/Backspace sigue funcionando (smoke manual en Tarea 16).

---

### Tarea 12 — Menús contextuales en el grid (`contextmenu` en `session-ui.ts`)

**Archivos:** `src/session/session-ui.ts`.

> Duda D6 (migrar los `contextmenu` de drum-grid / piano-roll a este módulo) queda **fuera de alcance v1**. No tocar `clip-editor-drum-grid.ts` ni `pianoroll.ts`.

**Qué hacer:**
- Importar `openContextMenu` de `../core/context-menu`.
- Añadir `addEventListener('contextmenu', (e) => openContextMenu(e, items))` en cada elemento, con ítems que reutilizan callbacks existentes:
  - **Cabecera de lane** (`.session-lane-header`, en `laneHeader`): "Editar instrumento" (`cb.onEditLane`), "Parar pista" (`cb.onStopLane`), separador, "Borrar pista" (`danger` → `cb.onDeleteLane`).
  - **Scene** (`.session-scene-cell` con scene, en `sceneLaunchCell` rama `if (scene)`): "Lanzar escena" (`cb.onLaunchScene`), "Añadir escena" (`cb.onAddScene`), separador, "Borrar escena" (`danger` → `cb.onDeleteScene`).
  - **Clip lleno** (`.session-cell-filled`, en `clipCell` rama `if (clip)`): "Abrir editor" (`cb.onClipClick`), "Reproducir / Parar" (`cb.onClipPlayPause`), [opcional "Duplicar" — ver Tarea 13], separador, "Borrar clip" (`danger` → `cb.onDeleteClip`).
  - **Celda vacía** (`.session-cell-empty`, en `clipCell` rama `else`): "Crear clip" (`cb.onCellClick`) salvo en lanes `audio`/`sampler` donde `onCellClick` no crea clip — ahí dejar el ítem deshabilitado o omitir (v1: solo "Crear clip" donde aplique; para `audio`/`sampler` un ítem `disabled`).
- El menú **coexiste** con el aspa (uno es `click` en el botón, otro `contextmenu` en el contenedor; sin conflicto).

**Cómo verificar:** `npx tsc --noEmit` limpio; e2e Tarea 15 (caso "Menú contextual"); smoke manual del botón derecho en cada nivel.

---

### Tarea 13 — (Opcional v1) Ítem "Duplicar clip" en el menú contextual ⚠️ CONFIRMAR ANTES (Duda D5)

**Archivos:** `src/session/session-ui.ts`, `src/session/session-host.ts`.

> ⚠️ **Antes de implementar, confirma D5:** ¿se incluye "Duplicar clip" en v1? Si **no**, omite esta tarea (el menú del clip de Tarea 12 ya queda completo sin "Duplicar").

**Qué hacer (si se incluye):**
- Añadir `onDuplicateClip?: (laneId: string, clipIdx: number) => void` a `SessionUICallbacks`.
- Implementarlo en `buildCallbacks` reusando la lógica de `insp-duplicate` (`session-inspector.ts:146`): clonar el clip (`JSON.parse(JSON.stringify)`), nuevo id, nombre `+ ' copy'`, colocarlo en el primer hueco libre de la columna (o append), `withUndo` + `renderWithMixer`.
- Añadir el ítem "Duplicar" al menú del clip lleno en Tarea 12.

**Cómo verificar:** `npx tsc --noEmit` limpio; smoke manual.

---

### Tarea 14 — Siembra "vacía de verdad" + fix del bug "▶ ausente"

**Archivos:** `src/session/session-host.ts`, `src/core/scene-ensure.test.ts`.

**Antes de editar:** `gitnexus_impact` sobre `installClip` (es el callback de `buildParamUI`) y sobre los métodos de creación de lane que se tocan. Reportar blast radius.

**Qué hacer (dos partes — el orden importa: primero el fix del ▶, que es un bug real, luego la siembra):**

**14a. Fix `installClip` (causa raíz del ▶ ausente):**
- En `installClip` (`session-host.ts:999-1006`, el camino del import de loop del Sampler), añadir `ensureScenesForRows(this.state)` **antes** de `this.renderWithMixer()`. Importar `ensureScenesForRows` de `../core/scene-ensure` (ya está importado en el host — verificar). Es la única función que hoy NO lo llama; el resto (`onSliceToBank`, `addAudioChannel`, `onCellDropAudio`, `onAddLane`, `onAddStemLanes`) ya lo hacen.
- **Defensa en profundidad (opcional pero recomendado):** extraer un helper de instancia `private placeClipEnsuringScene(lane, idx, clip)` que haga `lane.clips[idx] = clip; ensureScenesForRows(this.state);` y migrar a él los puntos de inserción (`onCellClick`, `onCellDropAudio`, `installClip`, y los `clips[0]` de creación). Esto evita que un camino futuro vuelva a olvidar la scene.

**14b. Siembra vacía (quitar el relleno con `emptyClip`):**
Sustituir el bucle de relleno `for (r..rows) clips.push(r===0 ? clip : emptyClip(...))` por `lane.clips = [clip]` (clip en fila 0) o `lane.clips = []` (instrumento sin clip), y dejar que `ensureScenesForRows` mantenga las scenes. En cada sitio, tras la mutación, **siempre** `ensureScenesForRows(state)`:
  - **`onAddLane`** (`session-host.ts:736`, bucle en `:749-751`): lane de instrumento → `lane.clips = []` (0 clips). Quitar el `for` que hace push de `emptyClip`. `emptyLane` ya devuelve `clips: []`, así que basta con **no** rellenar. Mantener `ensureScenesForRows(self.state)` (ya está en `:758`).
  - **`addNoteLane`** (`session-host.ts:523`, bucle en `:541`): `lane.clips = [clip]` (clip de notas en fila 0). Quitar el `for`.
  - **`addAudioChannel`** (`session-host.ts:562`, bucle en `:586`): `lane.clips = [clip]`. Quitar el `for`. Mantener `ensureScenesForRows(self.state)` (ya en `:590`).
  - **`onSliceToBank`** (`session-host.ts:197`, bucle en `:244`): `newLane.clips = [noteClip]`. Quitar el `for`. Mantener `ensureScenesForRows` (ya en `:251`).
  - **`onCellDropAudio`** (camino audio, `session-host.ts:674`): ya coloca el clip en una celda concreta (`lane.clips[clipIdx] = clip`), NO rellena la columna — **no cambia**, pero verificar que sigue llamando `ensureScenesForRows` (ya en `:695`).
  - **Stems** (`onAddStemLanes` → `buildStemLane`, `session-host.ts:780`, bucle en `:797`): cada lane de stem → `lane.clips = [clip]`. Quitar el `for`. `runReplace` llama `buildStemLane(s, id, 1)` y arma la scene aparte; `runAdd` llama con `rows` pero el relleno ya no es necesario — `lane.clips = [clip]` + `ensureScenesForRows` (ya en `:832`) basta.
- **Importante (del spec):** quitar el relleno **no** rompe `ensureScenesForRows`, porque calcula `maxClipRows` sobre `lane.clips.length`. Una lane vacía aporta `length 0`; las lanes con clip en fila 0 aportan `length 1`. Las scenes existentes se conservan (otras lanes ya empujan `maxClipRows`).

**14c. Test de regresión del ▶ (en `scene-ensure.test.ts`):**
- Añadir un caso que reproduzca el bug de `installClip`: simular "clip colocado en una fila sin scene previa" y assertar que `ensureScenesForRows` crea la scene de esa fila. Patrón (puro, sin host):
  ```ts
  it('creates a scene for a clip placed at a row without one (installClip regression)', () => {
    const s = emptySessionState();
    s.lanes[0].clips = [];           // lane vacía
    s.lanes[0].clips[0] = emptyClip(1); // clip colocado en fila 0, 0 scenes
    expect(s.scenes.length).toBe(0);
    ensureScenesForRows(s);
    expect(s.scenes.length).toBeGreaterThanOrEqual(1); // ▶ disponible para la fila
  });
  ```

**Cómo verificar:** `NO_COLOR=1 npx vitest run src/core/scene-ensure.test.ts` verde (incluye el nuevo caso); `npx tsc --noEmit` limpio; e2e Tarea 15 (casos "Lane nace vacía" y "▶ presente tras import de loop/slice"). **Antes de commit:** `gitnexus_detect_changes()` para verificar que el alcance afectado es el esperado.

---

### Tarea 15 — Suite e2e Playwright `session-management.spec.ts` (nuevo)

**Archivos NUEVOS:** `tests/e2e/session-management.spec.ts`.

> Recordatorio: `test:e2e` sirve `dist/` sin build → **`npm run build` antes**. Patrón de boot (de `lane-ui.spec.ts`): `await page.goto('/')` + `await page.waitForFunction(() => document.querySelectorAll('.session-cell-filled').length > 0)` para esperar a que el demo async cargue.

**Qué hacer:** escribir los 8 casos del plan de pruebas del spec:
1. **Aspa borra clip:** contar `.session-cell-filled`, clicar el `.session-del-cross` de uno (el del clip), assertar conteo −1 y que la celda pasa a `.session-cell-empty`.
2. **Aspa borra lane (con confirmación):** añadir lane (`+` del tab-bar), poner contenido (crear un clip), `page.on('dialog', d => d.accept())`, clicar el aspa de la cabecera, assertar que la columna desaparece (`.session-lane-header` con ese contenido ya no existe) y que **no** hay error `stripFor`/`no resource` en consola (`page.on('console', ...)`).
3. **Borrado de lane vacía sin diálogo:** añadir lane (queda vacía), registrar un handler de `dialog` que marque una bandera, borrar, assertar que el handler **no** se invocó y la columna desaparece.
4. **Aspa borra scene:** contar `.session-scene-launch`, borrar una scene con contenido (aceptar diálogo), assertar conteo −1.
5. **Lane nace vacía:** añadir una lane de instrumento, assertar que su columna tiene **0** `.session-cell-filled` (todas las celdas `.session-cell-empty`). (Verifica Tarea 14b.)
6. **▶ presente tras import de loop/slice (regresión del bug):** ejecutar el flujo del Sampler que llama a `installClip`/`onSliceToBank` (reusar patrones de `sampler.spec.ts` / `loop-arrangement.spec.ts`), assertar que tras la operación existe un `.session-scene-launch` en la fila del clip y `state.scenes.length >= idxDelClip+1` (leer `state` vía `page.evaluate` si el host lo expone, o vía conteo de botones ▶). (Verifica Tarea 14a.)
7. **Menú contextual:** `click({ button: 'right' })` sobre una cabecera de lane, assertar que aparece `.context-menu` con un ítem "Borrar pista"; seleccionarlo borra la lane (equivale al aspa).
8. **Undo de borrado de lane (caso delicado):** borrar lane → `Ctrl+Z` → assertar que la columna vuelve **y** tiene recurso (lanzar su clip no produce error `stripFor: no resource` en consola). Verifica el re-allocate del undo (Tarea 9).

**Cómo verificar:** `npm run build && npm run test:e2e` con los 8 casos verdes. Si un caso falla por timing async, usar `waitForFunction`/`waitForSelector` como en los spec existentes.

---

### Tarea 16 — Verificación final (typecheck + unit + build + smoke en navegador)

**Archivos:** ninguno (verificación).

**Qué hacer:**
- `npx tsc --noEmit` → limpio.
- `npm run test:unit` → verde (re-run si `ERR_IPC_CHANNEL_CLOSED` en teardown, flaky conocido; no es fallo real).
- `npm run build` → typecheck + bundle OK.
- `npm run test:e2e` → verde (incluye `session-management.spec.ts` nuevo).
- **Smoke manual en `http://localhost:5173`** (`npm run dev`):
  - Crear una lane de instrumento → nace **vacía** (sin clips fantasma).
  - Crear un clip en una celda → aparece.
  - Borrar el clip con el **aspa** → desaparece, la celda queda vacía, sin confirmación.
  - Borrar una lane **con contenido** con el aspa → sale la **confirmación**; aceptar → la columna desaparece; el audio no da errores en consola.
  - **Ctrl+Z** → la lane vuelve y su clip se puede lanzar sin error.
  - Borrar una **scene** con contenido → confirmación; vacía → directa.
  - Botón **derecho** en cada nivel (lane / scene / clip lleno / celda vacía) → menú contextual con las acciones esperadas; "Borrar…" en rojo al final.
  - Import de loop / slice en el Sampler → el botón **▶** de scene-launch aparece en la fila del clip (regresión del bug arreglada).
  - El atajo **Delete/Backspace** del inspector sigue borrando el clip seleccionado (si se mantuvo en Tarea 11).
- **Antes de commit final:** `gitnexus_detect_changes()` para confirmar que el alcance afectado es el esperado (instrucción del CLAUDE.md del proyecto).

**Cómo verificar:** todos los comandos verdes + checklist de smoke completado sin errores de consola.

---

## Notas de implementación transversales

- **Orden de typecheck:** las Tareas 7–10 están acopladas por el contrato de `SessionUICallbacks` (la UI declara los callbacks que el host implementa). Si haces T7 antes que T8–T10, `npx tsc --noEmit` fallará por callbacks faltantes en `this.callbacks`. Plan: implementa T8–T10 (host) y T7 (UI) en la misma rama y typecheckea el conjunto al cerrar T10.
- **Worktree:** este plan se ejecuta en un worktree aislado (ya estás en `loom-ux-overhaul`). Commitea libremente en la rama y rebasea sobre `main` a menudo.
- **GitNexus:** correr `gitnexus_impact` antes de editar `buildCallbacks`, `installClip` y los métodos de creación de lane (instrucción del proyecto). Avisar si HIGH/CRITICAL. La MCP de GitNexus es ciega al worktree (indexa el repo principal), así que `detect_changes` puede no ver cambios desde aquí — no bloquea, solo es informativo.
- **No tocar:** `lane-resources.ts` (`dispose` ya hace lo necesario) ni `scene-ensure.ts` (se reutiliza tal cual; el fix es **llamarla** desde `installClip`). Tampoco la cabecera/transporte (Frente B), el mixer (C), el Sampler/audio (D) ni los editores de clip (E).
