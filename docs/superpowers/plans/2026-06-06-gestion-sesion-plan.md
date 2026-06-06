# Frente A · Gestión de sesión — Plan de implementación

**Fecha:** 2026-06-06 (revisado tras la revisión adversarial + coordinación transversal)
**Estado:** plan de implementación (TDD donde aplique).
**Deriva de:** [2026-06-06-gestion-sesion-design.md](../specs/2026-06-06-gestion-sesion-design.md).
**Coordinación:** [2026-06-06-coordinacion-frentes.md](../specs/2026-06-06-coordinacion-frentes.md). **Frente A va PRIMERO** (cimiento de D y de la estabilidad del grid).

---

## Cómo usar este plan

- Tareas ordenadas de **menor a mayor riesgo**. Primero lógica pura (modelo + predicados + módulo aislado), testeable al 100% en Vitest. Después la UI/wiring sobre `SessionHost` (estado + audio + undo), lo delicado.
- **TDD donde aplique:** lógica pura → test rojo, implementar, verde. UI/wiring → e2e después de implementar (Playwright sirve `dist/`, el ciclo rojo→verde es caro; ahí prima typecheck + smoke).
- **Verificación por tarea.** Comandos de referencia:
  - `npx tsc --noEmit` — typecheck sin bundle.
  - `NO_COLOR=1 npx vitest run ruta/al/fichero.test.ts` — un test suelto.
  - `npm run test:unit` — toda la batería Vitest (re-run si `ERR_IPC_CHANNEL_CLOSED` en teardown — flaky conocido).
  - `npm run build && npm run test:e2e` — e2e Playwright (build OBLIGATORIO antes; `test:e2e` sirve `dist/` sin construir).
- **Dudas reales** (bloque siguiente): solo 3, todas decisiones de producto. Marcadas en la tarea que bloquean con `⚠️ CONFIRMAR (Duda N)`. **No las resuelvas tú.**

---

## DUDAS REALES — confirmar con el usuario ANTES de las tareas marcadas

> Las pseudo-dudas de la versión anterior se ELIMINARON porque la revisión las resolvió contra el código (ver spec, sección "Dudas reales"): `deleteScene` **compacta** (decidido), siembra **mínima de 1 scene** (decidido), `installClip` se **elimina** y el bug real es `onCellClick` (decidido). Quedan SOLO estas 3 decisiones de producto:

| # | Duda | Bloquea |
|---|------|---------|
| **D1** | **Estilo de confirmación:** `window.confirm` nativo vs. mini-diálogo propio. El plan asume `window.confirm` en v1. | T8, T9 |
| **D2** | **¿Retirar el borrado por teclado del inspector?** Propuesta: **mantenerlo** (Delete/Backspace + `#insp-delete`, no estorban). | T11 |
| **D3** | **Ítem "Duplicar clip" en el menú contextual:** ¿v1 (reusando `insp-duplicate`, que hace `clips.push` append) o más tarde? | T13 |

---

## Mapa de archivos (resumen)

| Archivo | Tarea(s) |
|---|---|
| `src/session/session.ts` | T1–T4 (helpers + predicados) |
| `src/session/session.test.ts` (ya existe) | T1–T4 (tests pura) |
| `src/core/scene-ensure.ts` | T5 (siembra mínima de scene) |
| `src/core/scene-ensure.test.ts` (ya existe) | T5 (tests siembra/▶) |
| `src/core/context-menu.ts` (**NUEVO**) | T6 |
| `src/core/context-menu.test.ts` (**NUEVO**) | T6 |
| `src/styles/_context-menu.scss` (**NUEVO**) + `src/style.scss` | T6 |
| `src/session/session-ui.ts` | T7 (callbacks + aspa + data-lane-id), T12 (contextmenu) |
| `src/styles/_session-grid.scss` | T7 (`.session-del-cross`) |
| `src/session/session-host.ts` | T8–T10 (wiring), T14 (helper único + siembra + eliminar installClip + installSamplerClip) |
| `src/engines/engine-types.ts` | T14 (eliminar declaración `installClip?`) |
| `src/session/session-inspector.ts` | T11 (mantener/documentar) |
| `tests/e2e/session-management.spec.ts` (**NUEVO**) | T15 |

---

## Tareas

### Tarea 1 — `deleteClipAt(lane, clipIdx)` (lógica pura)

**Archivos:** `src/session/session.ts`, `src/session/session.test.ts`.

**Qué hacer (TDD):**
- Test:
  - `lane.clips = [A, B, C]`, `deleteClipAt(lane, 1)` → `clips[1] === null`, `clips[0] === A`, `clips[2] === C` (NO `splice`).
  - `deleteClipAt(lane, 0)` con un solo clip → `clips[0] === null`, `length` conservado.
  - Idempotente sobre `null`.
- Implementa junto a `moveClip`/`copyClip`:
  ```ts
  export function deleteClipAt(lane: SessionLane, clipIdx: number): void {
    if (clipIdx >= 0 && clipIdx < lane.clips.length) lane.clips[clipIdx] = null;
  }
  ```

**Verificar:** `NO_COLOR=1 npx vitest run src/session/session.test.ts` verde; `npx tsc --noEmit` limpio.

---

### Tarea 2 — `deleteLane(state, laneId)` (lógica pura, sin tocar audio)

**Archivos:** `src/session/session.ts`, `src/session/session.test.ts`.

**Qué hacer (TDD):**
- Test:
  - `deleteLane(state, 'L2')` quita la lane de `state.lanes`.
  - `delete scene.clipPerLane['L2']` en TODAS las scenes.
  - No toca otras lanes; no-op si el id no existe.
- Implementa:
  ```ts
  export function deleteLane(state: SessionState, laneId: string): void {
    const i = state.lanes.findIndex((l) => l.id === laneId);
    if (i < 0) return;
    state.lanes.splice(i, 1);
    for (const scene of state.scenes) delete scene.clipPerLane[laneId];
  }
  ```
  No toca recursos de audio (el host hace `dispose`, T9).

**Verificar:** vitest verde; `tsc --noEmit` limpio.

---

### Tarea 3 — Predicados `laneHasContent` / `sceneHasContent` (lógica pura)

**Archivos:** `src/session/session.ts`, `src/session/session.test.ts`.

**Qué hacer (TDD):**
- Test:
  - `laneHasContent(lane)` → true si `clips.some(c => c != null)`; false con `[]` o todo `null`.
  - `sceneHasContent(state, idx)` → true si alguna lane tiene clip en `lane.clips[idx]` **O** si algún `scene.clipPerLane` apunta explícitamente a `idx` con clip presente. Caso clave del test: una lane cuyo `clips[idx]` es null pero otra scene tiene `clipPerLane[laneId] = idx` apuntando a un clip presente → `true` (no se debe borrar sin confirmar).
- Implementa:
  ```ts
  export function laneHasContent(lane: SessionLane): boolean {
    return lane.clips.some((c) => c != null);
  }
  export function sceneHasContent(state: SessionState, sceneIdx: number): boolean {
    // Contenido lanzable directo: cualquier lane con clip en esa fila.
    if (state.lanes.some((l) => l.clips[sceneIdx] != null)) return true;
    // Contenido lanzable indirecto: un mapeo clipPerLane explícito a esa fila.
    for (const scene of state.scenes) {
      for (const [laneId, row] of Object.entries(scene.clipPerLane)) {
        if (row !== sceneIdx) continue;
        const lane = state.lanes.find((l) => l.id === laneId);
        if (lane?.clips[row] != null) return true;
      }
    }
    return false;
  }
  ```
  (Corrige el hallazgo "sceneHasContent ignora clipPerLane": no es defensivo, hay mapeos explícitos reales — `addNoteLane`, stems, MIDI import.)

**Verificar:** vitest verde; `tsc --noEmit` limpio.

---

### Tarea 4 — `deleteScene(state, sceneIdx)` COMPACTANTE (lógica pura)

**Archivos:** `src/session/session.ts`, `src/session/session.test.ts`.

> **Decisión cerrada (NO es duda):** `deleteScene` COMPACTA. El lanzamiento de scene es posicional (`session-runtime.ts:103`: `idx = hasExplicit ? clipPerLane[lane.id] : sceneIdx`); no compactar emparejaría cada scene superviviente con clips de otra fila y lanzaría clips equivocados (corrupción funcional, no UX).

**Qué hacer (TDD):**
- Test `'deleteScene compacts clip rows and reindexes clipPerLane'`:
  - `deleteScene(state, 1)` → `scenes.length` baja 1.
  - Para una lane con `clips = [A, B, C]`, tras borrar idx 1 → `clips = [A, C]` (assert explícito de que se desplazó).
  - `clipPerLane` reindexado: un mapeo `row = 2` con `idx = 1` pasa a `row = 1`; un mapeo `row = 1 === idx` se elimina; `row = 0 < idx` intacto.
  - No-op si el índice está fuera de rango.
- Implementa:
  ```ts
  export function deleteScene(state: SessionState, sceneIdx: number): void {
    if (sceneIdx < 0 || sceneIdx >= state.scenes.length) return;
    state.scenes.splice(sceneIdx, 1);
    for (const lane of state.lanes) {
      if (sceneIdx < lane.clips.length) lane.clips.splice(sceneIdx, 1);
    }
    for (const scene of state.scenes) {
      for (const [laneId, row] of Object.entries(scene.clipPerLane)) {
        if (row == null) continue;
        if (row === sceneIdx) delete scene.clipPerLane[laneId];
        else if (row > sceneIdx) scene.clipPerLane[laneId] = row - 1;
      }
    }
  }
  ```

**Verificar:** vitest verde; `tsc --noEmit` limpio.

---

### Tarea 5 — `ensureScenesForRows` siembra mínima de scene + regresión ▶ (lógica pura)

**Archivos:** `src/core/scene-ensure.ts`, `src/core/scene-ensure.test.ts`.

> Corrige A5: con la nueva siembra "vacía de verdad", si todas las lanes nacen con `clips:[]`, `maxClipRows = 0` → 0 scenes → grid sin ningún ▶. Garantizar ≥1 scene cuando hay ≥1 lane.

**Antes de editar:** `gitnexus_impact({target: "ensureScenesForRows", direction: "upstream"})` y reportar blast radius (es llamada desde varios caminos de creación de lane). Avisar si HIGH/CRITICAL.

**Qué hacer (TDD):**
- Test:
  - Con ≥1 lane y todas a `clips:[]` → `ensureScenesForRows(s)` deja `s.scenes.length >= 1`.
  - Con 0 lanes → 0 scenes (no inventa filas de la nada).
  - Regresión ▶: lane con un clip en fila 0 y `scenes:[]` → tras `ensureScenesForRows`, `scenes.length >= 1` (la fila 0 queda lanzable).
  - No reduce scenes existentes (idempotente al alza).
- Implementa (modificar el cálculo de `maxClipRows`):
  ```ts
  export function ensureScenesForRows(state: SessionState): boolean {
    let maxClipRows = 0;
    for (const lane of state.lanes) maxClipRows = Math.max(maxClipRows, lane.clips.length);
    // Siembra mínima: con al menos una lane, garantiza al menos una scene lanzable
    // (quitar el relleno automático de clips puede dejar todas las lanes a [] → 0 scenes).
    if (state.lanes.length > 0) maxClipRows = Math.max(maxClipRows, 1);
    let added = false;
    while (state.scenes.length < maxClipRows) {
      state.scenes.push({ id: `scene-${Date.now().toString(36)}-${state.scenes.length}`,
        name: `Scene ${state.scenes.length + 1}`, clipPerLane: {} });
      added = true;
    }
    return added;
  }
  ```

**Verificar:** `NO_COLOR=1 npx vitest run src/core/scene-ensure.test.ts` verde; `tsc --noEmit` limpio. **Antes de commit:** `gitnexus_detect_changes()`.

---

### Tarea 6 — Módulo `context-menu.ts` + estilos + tests jsdom (aislado, riesgo bajo)

**Archivos NUEVOS:** `src/core/context-menu.ts`, `src/core/context-menu.test.ts`, `src/styles/_context-menu.scss`; + 1 línea en `src/style.scss`.

**Qué hacer (TDD, jsdom):**
- **Importante (corrige una premisa frecuente):** vitest corre en `environment: 'node'` por defecto (`vitest.config.ts:5`); `test/setup.ts` NO globaliza `document`. Para un test que construye DOM real, usa la directiva por-archivo `// @vitest-environment jsdom` en la primera línea del `.test.ts` (como `src/core/lane-fx-panel.test.ts:1`). NO sigas el patrón de stub trivial de `session-host-active-lane.test.ts`.
- Tests:
  - `openContextMenu(e, items)` añade `<ul class="context-menu">` a `document.body`, posicionado en `e.clientX/clientY`.
  - Click en un ítem dispara su `onSelect` y cierra el menú (se elimina del DOM).
  - Click fuera lo cierra; `Escape` lo cierra.
  - `disabled: true` NO dispara `onSelect` (clase `disabled`).
  - Abrir un segundo menú cierra el primero.
  - `e.preventDefault()` se llama (mock + assert).
- Implementa la API del spec:
  ```ts
  export interface ContextMenuItem {
    label: string; onSelect: () => void;
    disabled?: boolean; danger?: boolean; separatorBefore?: boolean;
  }
  export function openContextMenu(e: MouseEvent, items: ContextMenuItem[]): void;
  ```
  DOM puro, sin dependencias. `<ul>` con `<li>` por ítem (`separatorBefore` → borde/`<li class="context-menu-sep">`). Cierre: `click` (capture) en `document` + `keydown` Escape; limpia ambos al cerrar. Singleton module-level (`let openMenu`) para cerrar el anterior. `danger` añade clase roja.
- SCSS `_context-menu.scss`: `position: fixed`, z-index alto, `danger` rojo, `disabled` atenuado + `pointer-events: none`. Añadir `@use 'styles/context-menu';` en `src/style.scss`.

**Verificar:** `NO_COLOR=1 npx vitest run src/core/context-menu.test.ts` verde; `tsc --noEmit` limpio; `npm run build` compila el SCSS.

---

### Tarea 7 — Aspa ✕ + `data-lane-id` en el grid (UI en `session-ui.ts` + SCSS)

**Archivos:** `src/session/session-ui.ts`, `src/styles/_session-grid.scss`.

**Qué hacer:**
1. Extender `SessionUICallbacks` (`session-ui.ts:8`):
   ```ts
   onDeleteClip:  (laneId: string, clipIdx: number) => void;
   onDeleteLane:  (laneId: string) => void;
   onDeleteScene: (sceneIdx: number) => void;
   ```
   (Romperá el typecheck hasta que el host los provea en T8–T10; implementa T7–T10 en la misma rama y typecheckea al cerrar T10.)
2. Helper `deleteCross(title, onDelete)`:
   ```ts
   function deleteCross(title: string, onDelete: () => void): HTMLElement {
     const b = document.createElement('button');
     b.className = 'session-del-cross'; b.title = title; b.textContent = '✕';
     b.addEventListener('click', (e) => { e.stopPropagation(); onDelete(); });
     return b;
   }
   ```
3. Insertar el aspa + `data-lane-id`:
   - **Lane:** en `laneHeader` (`session-ui.ts:135`), aspa como **primer hijo** antes del `name`. `title="Borrar pista"` → `cb.onDeleteLane(lane.id)`. **Añadir `el.dataset.laneId = lane.id`** al `.session-lane-header` (hoy NO lo lleva — verificado; lo necesita el e2e para identificar la columna).
   - **Scene:** en `sceneLaunchCell` (`session-ui.ts:219`), rama `if (scene)`, antes del `▶`. `title="Borrar escena"` → `cb.onDeleteScene(idx)`. La rama `else` (sin scene) NO lleva aspa.
   - **Clip:** en `clipCell` (`session-ui.ts:170`), rama `if (clip)`, **primer hijo** antes del `label`. `title="Borrar clip"` → `cb.onDeleteClip(lane.id, rowIdx)`. **Crítico:** añade `stopPropagation` en `pointerdown`/`pointerup`/`click` al botón aspa (replica el patrón del `playIcon`, `session-ui.ts:183-184`) para no disparar `wireClipDrag`.
4. SCSS `.session-del-cross` en `_session-grid.scss`: pequeña, esquina superior izquierda (`position: absolute; top/left`), `opacity` baja por defecto, hover rojo. El clip lleno y el header deben ser `position: relative`. Coexistencia con `▶` (derecha) y `⚙` (`.session-lane-edit`) — ajustar paddings.

**Verificar:** `tsc --noEmit` limpio una vez existan los callbacks del host (cierra hasta T10 antes de typecheckear el conjunto). `npm run build` compila el SCSS. Verificación visual en T15.

---

### Tarea 8 — Wiring `onDeleteClip` en `SessionHost` ⚠️ CONFIRMAR (Duda D1 no aplica: clip se borra directo)

**Archivos:** `src/session/session-host.ts`.

**Antes de editar `buildCallbacks`:** `gitnexus_impact({target: "buildCallbacks", direction: "upstream"})` y reportar blast radius (método grande y central). Avisar si HIGH/CRITICAL.

**Qué hacer:**
- En `buildCallbacks`, añadir a `this.callbacks`:
  ```ts
  onDeleteClip(laneId, clipIdx) {
    const lane = self.state.lanes.find((l) => l.id === laneId);
    if (!lane || lane.clips[clipIdx] == null) return; // vacío → no-op
    const hd = self.deps.historyDeps;
    const run = () => {
      deleteClipAt(lane, clipIdx);
      const sel = self.inspector.getSelectedClip();
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
  - Importar `deleteClipAt` de `./session`. `getSelectedClip()`/`setSelectedClip(null)` existen (session-inspector.ts:100-106).
  - Un clip individual **siempre directo** (sin confirmación), coherente con el índice maestro.

**Verificar:** `tsc --noEmit` limpio (con T7/T9/T10); comportamiento en e2e T15 (caso 1).

---

### Tarea 9 — Wiring `onDeleteLane` (confirmación + stop + dispose + limpieza) ⚠️ CONFIRMAR (Duda D1)

**Archivos:** `src/session/session-host.ts`.

> ⚠️ **Confirma D1:** `window.confirm` nativo o mini-diálogo propio. El plan asume `window.confirm` en v1.

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
    // Parar la lane ANTES de disponerla: corta voces/loops en vuelo (simetría con
    // onDeleteScene; evita el análogo de "New no libera synths").
    stopLane(self.laneStates, laneId,
      self.deps.recHooks ? { ...self.deps.recHooks, nowCtx: ctx.currentTime } : undefined);
    const hd = self.deps.historyDeps;
    const run = () => {
      deleteLane(self.state, laneId);
      self.laneStates.delete(laneId);
      self.deps.laneResources?.dispose(laneId);   // libera strip+engine+inserts
      if (self.activeEditLane === laneId) {
        // mismo gesto que el toggle-off de onEditLane (session-host.ts:858-865)
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
  - Importar `deleteLane`, `laneHasContent` de `./session`. `stopLane` y `ctx` ya están en scope de `buildCallbacks`.
  - NO llamar `ensureScenesForRows` (borrar columnas no añade filas).
- **Undo de borrado de lane:** VERIFICADO que el `restore` del historial pasa por `applyLoadedSessionState`, que dispone orphans (`session-host.ts:321-324`) y re-asigna recursos a las lanes sin recurso (`ensureLaneResource`/`swapLaneEngine`, :325-341). El mecanismo ya existe; basta con cubrirlo con el e2e T15 (caso 8: lanzar el clip restaurado no da `stripFor: no resource`). No requiere código extra en `run`.

**Verificar:** `tsc --noEmit` limpio; e2e T15 (casos 2/3/8).

---

### Tarea 10 — Wiring `onDeleteScene` (confirmación + stop + compactante) ⚠️ CONFIRMAR (Duda D1)

**Archivos:** `src/session/session-host.ts`.

> ⚠️ Misma Duda D1 (estilo de confirmación).

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
      // Parar lo que suene/encolado de esa fila antes de compactar.
      for (const lp of self.laneStates.values()) {
        const lane = self.state.lanes.find((l) => l.id === lp.laneId);
        const clipInRow = lane?.clips[sceneIdx];
        if (clipInRow && (lp.playing?.id === clipInRow.id || lp.queued?.id === clipInRow.id)) {
          stopLane(self.laneStates, lp.laneId,
            self.deps.recHooks ? { ...self.deps.recHooks, nowCtx: ctx.currentTime } : undefined);
        }
      }
      deleteScene(self.state, sceneIdx);   // COMPACTANTE (T4)
      self.renderWithMixer();
    };
    if (hd) withUndo(hd, run); else run();
  },
  ```
  - Importar `deleteScene`, `sceneHasContent` de `./session`.
  - `LanePlayState` expone `laneId` (verificado: `lp.laneId`); `playing`/`queued` son clips con `.id`.

**Verificar:** `tsc --noEmit` limpio; e2e T15 (caso 4: compacta).

---

### Tarea 11 — `deleteSelectedClip` del inspector: mantener + documentar ⚠️ CONFIRMAR (Duda D2)

**Archivos:** `src/session/session-inspector.ts`.

> ⚠️ **Confirma D2:** ¿se MANTIENE el borrado por teclado (Delete/Backspace) + `#insp-delete` del inspector? Propuesta: **sí** (el aspa es el primario; el atajo no estorba). Si el usuario quiere retirarlo, esta tarea pasa a "eliminar `wireKeyboardShortcuts`/`deleteSelectedClip`/`#insp-delete`".

**Qué hacer (variante mantener — recomendada):**
- `deleteSelectedClip` (`session-inspector.ts:77-91`) y `onDeleteClip` del host comparten la semántica "poner null + cerrar panel" por dos caminos pequeños y acotados. **No deduplicar en v1** (deduplicar exigiría que el inspector reciba el callback del host, hoy NO recibe `SessionUICallbacks` → más invasivo y de mayor riesgo). Dejar `deleteSelectedClip` tal cual; añadir un comentario que documente que aspa (host) y teclado/`#insp-delete` (inspector) coexisten intencionadamente.
- `#insp-delete` (`session-inspector.ts:159`) ya delega en `deleteSelectedClip`; sin cambios.

**Verificar:** `tsc --noEmit` limpio; el atajo Delete/Backspace y `#insp-delete` siguen funcionando (smoke en T16).

---

### Tarea 12 — Menús contextuales en el grid (`contextmenu` en `session-ui.ts`)

**Archivos:** `src/session/session-ui.ts`.

> La migración de los `contextmenu` de drum-grid/piano-roll a este módulo queda **fuera de alcance**. No tocar `clip-editor-drum-grid.ts` ni `pianoroll.ts`.

**Qué hacer:**
- Importar `openContextMenu` de `../core/context-menu`.
- `addEventListener('contextmenu', (e) => openContextMenu(e, items))` en cada elemento, con ítems que reutilizan callbacks:
  - **Cabecera de lane** (`.session-lane-header`): "Editar instrumento" (`cb.onEditLane`), "Parar pista" (`cb.onStopLane`), separador, "Borrar pista" (`danger` → `cb.onDeleteLane`).
  - **Scene** (`.session-scene-cell` rama `if (scene)`): "Lanzar escena" (`cb.onLaunchScene`), "Añadir escena" (`cb.onAddScene`), separador, "Borrar escena" (`danger` → `cb.onDeleteScene`).
  - **Clip lleno** (`.session-cell-filled`, rama `if (clip)`): "Abrir editor" (`cb.onClipClick`), "Reproducir / Parar" (`cb.onClipPlayPause`), [opcional "Duplicar" — T13], separador, "Borrar clip" (`danger` → `cb.onDeleteClip`).
  - **Celda vacía** (`.session-cell-empty`, rama `else`): "Crear clip" (`cb.onCellClick`). **Verificado:** `onCellClick` solo bloquea `engineId === 'audio'` (`session-host.ts:661`); en **sampler** SÍ crea clip. Por tanto el ítem "Crear clip" se ofrece normal para `sampler`/drumkit y se deshabilita (o se cambia a "Importar audio…") SOLO para `audio`. **NO deshabilitar en sampler** (regresionaría una capacidad existente).
- El menú **coexiste** con el aspa (uno es `click` en el botón, otro `contextmenu` en el contenedor).

**Verificar:** `tsc --noEmit` limpio; e2e T15 (caso 7); smoke del botón derecho en cada nivel.

---

### Tarea 13 — (Opcional v1) Ítem "Duplicar clip" en el menú contextual ⚠️ CONFIRMAR (Duda D3)

**Archivos:** `src/session/session-ui.ts`, `src/session/session-host.ts`.

> ⚠️ **Confirma D3:** ¿"Duplicar clip" en v1? Si **no**, omite esta tarea (el menú del clip de T12 queda completo sin "Duplicar").

**Qué hacer (si se incluye):**
- Añadir `onDuplicateClip?: (laneId: string, clipIdx: number) => void` a `SessionUICallbacks`.
- Implementarlo en `buildCallbacks` reusando la lógica de `insp-duplicate` (`session-inspector.ts:146-158`): clonar (`JSON.parse(JSON.stringify)`), nuevo id, nombre `+ ' copy'`. **Verificado:** `insp-duplicate` hace `clips.push(dup)` (append al final, NO "primer hueco libre"). Replicar ese comportamiento (append) por coherencia, o documentar si se prefiere colocar en el primer hueco libre de la columna. `withUndo` + `renderWithMixer`.
- Añadir el ítem "Duplicar" al menú del clip en T12.

**Verificar:** `tsc --noEmit` limpio; smoke.

---

### Tarea 14 — Helper único `placeClipEnsuringScene` + `installSamplerClip` + eliminar `installClip` + siembra vacía + fix ▶

**Archivos:** `src/session/session-host.ts`, `src/engines/engine-types.ts`.

**Antes de editar:** `gitnexus_impact` sobre `onCellClick`, `onCellDropAudio` y los métodos de creación de lane que se tocan; y sobre `installClip` (para confirmar que NO tiene callers — debe salir blast radius vacío de invocación). Reportar.

**Qué hacer (orden: helper → migrar caminos → eliminar installClip + seam → siembra):**

**14a. Helper único `placeClipEnsuringScene` (privado en `SessionHost`):**
```ts
private placeClipEnsuringScene(laneId: string, clipIdx: number, clip: SessionClip): void {
  const lane = this.state.lanes.find((l) => l.id === laneId);
  if (!lane) return;
  while (lane.clips.length <= clipIdx) lane.clips.push(null);
  lane.clips[clipIdx] = clip;
  ensureScenesForRows(this.state);
}
```

**14b. Migrar los caminos de colocación de clip al helper (corrige el bug ▶ REAL):**
- **`onCellClick`** (`session-host.ts:658-672`): dentro del `run`, sustituir `while(...push null); lane.clips[clipIdx]=clip;` por `self.placeClipEnsuringScene(laneId, clipIdx, clip);` (dejar fuera del helper la selección del inspector + `openInspector` + `renderWithMixer`). **Este es el fix del bug** (hoy NO llama a `ensureScenesForRows`).
- **`onCellDropAudio`** (`session-host.ts:674-705`): sustituir su `while(...push null); lane.clips[clipIdx]=clip; ensureScenesForRows(...)` por `self.placeClipEnsuringScene(laneId, clipIdx, clip);` (mantener selección + open + render).

**14c. `installSamplerClip` (seam de D) + ELIMINAR `installClip`:**
- Añadir el método público `installSamplerClip(laneId, clip)` (firma exacta en el spec, §Seam): busca primer hueco libre → `placeClipEnsuringScene` → `setSelectedClip` + `openInspector` → todo dentro de `withUndo`.
- **Eliminar** la implementación `installClip` en `buildParamUI`/EngineUIContext (`session-host.ts:999-1006`) y el comentario asociado (:997-998).
- **Eliminar** la declaración `installClip?: (clip) => void` en `src/engines/engine-types.ts:76` + comentario. Verificar (grep) que NINGÚN otro sitio la referencia.

**14d. Siembra vacía (quitar el relleno con `emptyClip`):**
Sustituir el bucle `for (r..rows) clips.push(r===0 ? clip : emptyClip(...))` por `lane.clips = [clip]` (clip en fila 0) o `lane.clips = []` (instrumento). Tras la mutación, `ensureScenesForRows`:
  - **`onAddLane`** (`session-host.ts:736`, bucle :749-751): instrumento → `lane.clips = []`. Quitar el `for`. `emptyLane` ya da `clips:[]`; mantener `ensureScenesForRows` (:758).
  - **`addNoteLane`** (`session-host.ts:523`, bucle :541): `lane.clips = [clip]`. Quitar el `for`. **AÑADIR `ensureScenesForRows(this.state)`** tras `this.state.lanes.push(lane)` (verificado: hoy es el único camino de creación que NO lo llama — corrige la contradicción T14a/T14b de la versión anterior).
  - **`addAudioChannel`** (`session-host.ts:562`, bucle :586): `lane.clips = [clip]`. Quitar el `for`. Mantener `ensureScenesForRows` (:590).
  - **`onSliceToBank`** (`session-host.ts:197`, bucle :244): `newLane.clips = [noteClip]`. Quitar el `for`. Mantener `ensureScenesForRows` (:251).
  - **Stems** (`buildStemLane`, `session-host.ts:780`, bucle :797): `lane.clips = [clip]`. Quitar el `for`. `runAdd` mantiene `ensureScenesForRows` (:832); `runReplace` arma su scene aparte.
- La siembra mínima de scene (T5) ya garantiza que una sesión con lanes vacías tenga ≥1 scene.

**14e. Test de regresión del ▶** ya cubierto en T5 (caso "clip en fila sin scene"). El comportamiento end-to-end de `onCellClick` se cubre en e2e T15 (caso 6).

**Verificar:** `NO_COLOR=1 npx vitest run src/core/scene-ensure.test.ts src/session/session.test.ts` verde; `tsc --noEmit` limpio (la eliminación de `installClip` no debe romper nada — grep previo); e2e T15 (casos 5/6). **Antes de commit:** `gitnexus_detect_changes()`.

---

### Tarea 15 — Suite e2e Playwright `session-management.spec.ts` (nuevo)

**Archivos NUEVOS:** `tests/e2e/session-management.spec.ts`.

> `test:e2e` sirve `dist/` sin build → **`npm run build` antes**. Boot: `page.goto('/')` + `waitForFunction(() => document.querySelectorAll('.session-cell-filled').length > 0)`.

**Qué hacer:** los 8 casos del spec:
1. **Aspa borra clip:** contar `.session-cell-filled`, clicar el `.session-del-cross` del clip, conteo −1 + celda pasa a `.session-cell-empty`.
2. **Aspa borra lane (con confirmación):** añadir lane, crear un clip, `page.on('dialog', d => d.accept())`, clicar el aspa de la cabecera; `.session-lane-header[data-lane-id="…"]` desaparece (selector ya disponible por T7) y NO hay error `stripFor`/`no resource` en consola (`page.on('console', ...)`).
3. **Borrado de lane vacía sin diálogo:** añadir lane (vacía), registrar handler `dialog` con bandera, borrar; bandera NO marcada + columna desaparece.
4. **`deleteScene` compacta:** con ≥2 scenes y clips en filas distintas, borrar la scene N (aceptar diálogo); assert de que la scene que estaba en N+1 ahora lanza SU clip (no el de otra fila) — leer vía conteo de `.session-scene-launch` (baja 1) + comprobar que el clip de la fila siguiente subió de fila. Cubre A2.
5. **Lane nace vacía:** añadir lane de instrumento → 0 `.session-cell-filled` en su columna (identificada por `data-lane-id`). Cubre 14d.
6. **▶ presente tras crear clip en fila sin scene (regresión del bug REAL):** provocar `onCellClick` (click en una celda vacía de una fila sin scene previa) o `onSliceToBank`; assert de que existe `.session-scene-launch` en esa fila tras la operación. Cubre 14b. (NO se ejercita `installClip`: eliminado.)
7. **Menú contextual:** `click({ button: 'right' })` sobre una cabecera de lane → `.context-menu` con "Borrar pista"; seleccionarlo borra la lane.
8. **Undo de borrado de lane:** borrar lane → `Ctrl+Z` (en modo **session**, no Performance — `performance-feature.ts:208` enruta Ctrl+Z al arrangement) → la columna vuelve y lanzar su clip no da `stripFor: no resource` en consola. Verifica el re-allocate de `applyLoadedSessionState`.

**Verificar:** `npm run build && npm run test:e2e` con los 8 verdes. Si un caso falla por timing async, usar `waitForFunction`/`waitForSelector`.

---

### Tarea 16 — Verificación final (typecheck + unit + build + smoke)

**Archivos:** ninguno (verificación).

**Qué hacer:**
- `npx tsc --noEmit` → limpio.
- `npm run test:unit` → verde (re-run si `ERR_IPC_CHANNEL_CLOSED` en teardown — flaky conocido).
- `npm run build` → typecheck + bundle OK.
- `npm run test:e2e` → verde (incluye `session-management.spec.ts`).
- **Smoke en `http://localhost:5173`** (`npm run dev`):
  - Crear lane de instrumento → nace **vacía** (sin clips fantasma) pero la sesión tiene ≥1 scene lanzable.
  - Crear clip en una celda → aparece + su fila tiene ▶.
  - Borrar clip con el **aspa** → desaparece, sin confirmación.
  - Borrar lane **con contenido** → **confirmación**; aceptar → columna desaparece, sin errores de consola.
  - **Ctrl+Z** (modo session) → la lane vuelve y su clip se lanza sin error.
  - Borrar **scene** con contenido → confirmación; **compacta** (las posteriores suben y mantienen su clip).
  - Botón **derecho** en cada nivel → menú con acciones esperadas; "Borrar…" rojo al final; "Crear clip" disponible en sampler (no deshabilitado).
  - Crear clip en una fila sin scene → aparece el **▶** (bug ▶ arreglado en su causa real).
  - Atajo **Delete/Backspace** + `#insp-delete` siguen borrando el clip seleccionado (si se mantuvo, D2).
- **Antes de commit final:** `gitnexus_detect_changes()`.

**Verificar:** todos los comandos verdes + checklist de smoke sin errores de consola.

---

## Notas de implementación transversales

- **Orden de typecheck:** T7–T10 acopladas por el contrato de `SessionUICallbacks`. Implementa el host (T8–T10) y la UI (T7) en la misma rama; typecheckea al cerrar T10.
- **Coordinación A↔D:** A introduce primero `placeClipEnsuringScene` + `installSamplerClip` y elimina `installClip` (T14). D consume `installSamplerClip` (no lo redefine). Si por planificación D fuese antes, D crearía `installSamplerClip` con esta firma y A lo adopta.
- **Worktree:** este plan se ejecuta en el worktree aislado (`loom-ux-overhaul`). Commitea libremente; rebasea sobre `main` a menudo.
- **GitNexus:** correr `gitnexus_impact` antes de editar `buildCallbacks`, `onCellClick`, los métodos de creación de lane y `ensureScenesForRows`. Avisar si HIGH/CRITICAL. La MCP es ciega al worktree (indexa el repo principal): `detect_changes` puede no ver cambios desde aquí — informativo, no bloqueante.
- **No tocar:** `lane-resources.ts` (`dispose` ya hace lo necesario). La cabecera/transporte (B), el mixer (C), el Sampler/audio (D salvo el seam `installSamplerClip`) ni los editores de clip (E).
