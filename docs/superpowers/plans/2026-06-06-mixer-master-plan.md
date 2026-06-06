# Frente C · Mixer del master — plan de implementación

**Fecha:** 2026-06-06
**Spec de origen:** [docs/superpowers/specs/2026-06-06-mixer-master-design.md](../specs/2026-06-06-mixer-master-design.md)
**Frente:** C (revisión UX `2026-06-06-loom-ux-overhaul-overview.md`)
**Modo de trabajo:** worktree `loom-ux-overhaul` (ya activo). Commit libre en la rama; rebase
sobre `main` muy a menudo; al terminar, `rebase main` + `merge --ff-only`.

---

## Resumen del enfoque

El audio **no cambia**. Esto es **reubicación + recableado de UI**:

1. Construir un **strip del master** (`MASTER` + fader → `master.gain` + VU + botón `FX`) en
   la última columna de `session-row-mixer` (la columna de scenes), donde hoy va un
   `session-spacer`.
2. **Mover** el contenido de `.page[data-page="fx"]` a un panel `#master-fx-panel`
   colapsable bajo el grid, **conservando todos los ids internos** para que `wireFxUI`
   los siga encontrando sin tocar `fx-ui.ts`.
3. **Quitar** la pestaña `data-tab="fx"`.
4. Persistir abierto/cerrado en un flag de UI de `SessionHost` (no serializado), análogo a
   `activeEditLane`.

Orden de tareas: **de menor a mayor riesgo**, TDD donde aplique (test rojo → implementar →
verificar). Las **dudas abiertas** del spec se marcan como bloqueos a confirmar con el
usuario **antes** de la tarea afectada.

### Referencias de código verificadas (worktree)

- `master`, `analyser`, `masterComp` se desestructuran del audio-graph en
  [src/main.ts:109](../../../src/main.ts). Grafo: `master → masterInsertChain → masterComp →
  analyser → destination` ([src/app/audio-graph.ts:21-35](../../../src/app/audio-graph.ts)).
- `#volume` es `<input id="volume" type="range" min="0" max="1" step="0.01" value="0.5">`
  ([index.html:107](../../../index.html)); su handler escribe `master.gain.value`
  ([src/main.ts:269-270](../../../src/main.ts)) y ya está bracketeado para undo
  ([src/main.ts:276](../../../src/main.ts)).
- La fila de mixer se rellena en `renderWithMixer`
  ([src/session/session-host.ts:483-498](../../../src/session/session-host.ts)): `sp` inicial,
  un `buildMixerColumn` por lane, y un `sp2` final (← **aquí va el master strip**).
- `_mixerRow` se expone en `renderSessionGrid`
  ([src/session/session-ui.ts:113-116](../../../src/session/session-ui.ts)).
- `wireFxUI` localiza por id: `#fx-reverb-knobs`, `#fx-delay-knobs`,
  `#fx-master-comp-knobs`, `#fx-filters`, `#fx-add-filter`
  ([src/core/fx-ui.ts:109-110,146,183-186](../../../src/core/fx-ui.ts)); se invoca una vez en
  boot ([src/main.ts:601](../../../src/main.ts)).
- `SessionHost` se construye en [src/main.ts:372-428](../../../src/main.ts);
  `mixerDeps` en [src/main.ts:220](../../../src/main.ts).
- Patrón fader+VU a calcar: [src/core/mixer.ts:158-194](../../../src/core/mixer.ts).
  `createLevelMeter({ analyser })` lee `analyser.fftSize` muestras
  ([src/core/level-meter.ts:194](../../../src/core/level-meter.ts)).
- Grid template con la columna de scenes de `140px`:
  [src/styles/_session-grid.scss:37](../../../src/styles/_session-grid.scss).
- Bucle genérico de tabs estáticos: [src/main.ts:348-356](../../../src/main.ts) (al borrar el
  botón `data-tab="fx"`, este bucle deja de tener nada que togglear para `fx`).

---

## DUDAS ABIERTAS — confirmar con el usuario ANTES de la tarea indicada

> No se resuelven aquí. Cada una bloquea la tarea citada; el resto del plan puede avanzar.

- **D1 · Rango del fader del master** (`0..1.5` como las lanes vs `0..1` como `#volume`).
  → Bloquea **Tarea 3** (constante de rango en `buildMasterStrip` y su test).
  *Por defecto del spec si no hay respuesta a tiempo: `0..1` para casar con `#volume` y no
  romper la sincronía.*
- **D2 · `#volume` vs fader del master** (¿coexisten sincronizados, o se elimina `#volume`?).
  → Bloquea **Tarea 6** (sincronización cruzada) y la decisión de tocar o no la fila de
  transporte. El spec asume **coexistencia** (cambio mínimo); eliminar `#volume` solaparía
  con el frente B. *Por defecto: coexistencia con sincronía bidireccional.*
- **D3 · Undo/bracket del fader del master.** `master.gain` no está en `SessionState`, así que
  el snapshot de historia no lo restaura (igual que hoy `#volume`). ¿Se deja sin undo, o se
  promueve `master.gain` al modelo persistido (amplía alcance)? → Afecta a **Tarea 3**
  (bracketear o no). *Por defecto: bracketear solo si es trivial; sin persistencia nueva.*
- **D4 · VU del master: analyser dedicado vs el existente** (`analyser` 2048 del visualizer).
  Decisión **menor / técnica** (el spec la marca "no de usuario"): recomendado dedicado
  `fftSize=512` tapado de `masterComp.output`. → Se decide en **Tarea 2**; *por defecto:
  analyser dedicado, para que el VU mida lo mismo que oye el usuario y con el mismo buffer
  que el resto de VUs.*
- **D5 · Posición del panel desplegable** (full-width bajo el grid vs popover pegado al
  strip). El spec recomienda full-width. → Afecta a **Tarea 4/8** (markup + SCSS). *Por
  defecto: full-width bajo el grid.*

---

## Tareas

### Tarea 0 — Preparación y baseline verde

**Archivos:** ninguno (solo verificación).
**Qué hacer:**
- Confirmar el worktree activo y `git status` limpio.
- Correr `npm run test:unit` y `npx tsc --noEmit` para fijar un baseline verde antes de tocar
  nada (recordar el flaky `ERR_IPC_CHANNEL_CLOSED` en teardown de `test:unit`: re-ejecutar para
  confirmar).
**Verificar:** `npx tsc --noEmit` limpio; `npm run test:unit` verde (re-run si teardown flaky).
**Riesgo:** nulo. Es el ancla para detectar regresiones.

---

### Tarea 1 — Mover el bloque Master FX a `#master-fx-panel` y quitar la pestaña (HTML puro, sin lógica)

**Archivos:** `index.html`.
**Qué hacer:**
- **Quitar** `<button class="tab" data-tab="fx">Master FX</button>`
  ([index.html:178](../../../index.html)). Si el `.tab-bar` queda vacío, dejarlo vacío (no
  borrar el contenedor todavía; B podría reusarlo) o eliminarlo si está claramente huérfano —
  decisión de bajo riesgo, comprobar que nada más lo referencia.
- **Mover** el bloque completo `<div class="page" data-page="fx" hidden>…</div>`
  ([index.html:272-303](../../../index.html)) a un nuevo contenedor dentro de `.session-view`,
  **después** de `#session-grid` ([index.html:315-316](../../../index.html)):
  ```html
  <div id="master-fx-panel" hidden>
    <!-- ...las TRES secciones íntegras: SENDS / MASTER COMP / INSERTS... -->
  </div>
  ```
  Cambiar el wrapper de `class="page" data-page="fx"` a `id="master-fx-panel"` y mantener
  `hidden`. **No tocar** ni un solo id interno: `#fx-reverb-knobs`, `#fx-delay-knobs`,
  `#fx-master-comp-knobs`, `#fx-add-filter`, `#fx-filters`, y las clases `.fx-zone`,
  `.poly-section`, `.fx-zone-content`.
**Verificar:**
- `npm run build` (typecheck + bundle) limpio.
- **Smoke manual** en `http://localhost:5173`: la app arranca; el bloque FX ya no aparece
  como pestaña; el panel existe en el DOM (oculto). `wireFxUI` no debe romper en consola
  (sigue encontrando sus ids; aún no hay botón para abrirlo, eso es la Tarea 5).
**Riesgo:** bajo. Es mover markup; `wireFxUI` sigue funcionando porque busca por id, no por
ancestro `.page`. Único matiz: confirmar que ninguna regla SCSS de `.fx-zone`/`.poly-section`
dependía de `.page[data-page="fx"]` como ancestro (se aborda en la Tarea 8; si rompe el estilo
aquí, solo es cosmético y temporal).

---

### Tarea 2 — Analyser dedicado del master en el audio-graph *(decisión D4)*

> Confirmar **D4** antes (decisión técnica menor; por defecto: dedicado).

**Archivos:** `src/app/audio-graph.ts`, `src/main.ts`.
**Qué hacer (si D4 = dedicado, recomendado):**
- En `buildAudioGraph` ([src/app/audio-graph.ts:21-35](../../../src/app/audio-graph.ts)) añadir
  un `masterMeterAnalyser = ctx.createAnalyser()` con `fftSize = 512`, conectado tapando
  `masterComp.output` (`masterComp.output.connect(masterMeterAnalyser)`), **sin** conectarlo a
  `destination` (es solo un tap de medición, igual que los analysers de strip). Exponerlo en la
  interfaz `AudioGraph` y en el objeto devuelto.
- En `src/main.ts` desestructurar `masterMeterAnalyser` del `audio`
  ([src/main.ts:109](../../../src/main.ts)).
- **Impacto:** correr `gitnexus_impact({target: "buildAudioGraph", direction: "upstream"})`
  antes de editar y reportar el blast radius (lo consume `createAudioGraph` + el render
  offline). Verificar que añadir un campo a `AudioGraph` no rompe consumidores (es aditivo).
**Qué hacer (si D4 = reutilizar el `analyser` existente):** nada en audio-graph; se pasa el
`analyser` 2048 ya desestructurado.
**Verificar:**
- `npx tsc --noEmit` limpio (la interfaz `AudioGraph` compila con el campo nuevo).
- `npm run test:unit` verde (audio-graph no tiene test DSP que dependa del conteo de nodos;
  confirmar que ningún test mockeaba la forma exacta de `AudioGraph`).
- `gitnexus_detect_changes()` antes de commitear: solo `buildAudioGraph`/`AudioGraph` afectados.
**Riesgo:** bajo. Aditivo y sin re-cableado del path de salida. El offline render reusa
`buildAudioGraph`, así que el tap extra existe también allí (inocuo: no se conecta a destino).

---

### Tarea 3 — `buildMasterStrip` con test rojo primero (TDD) *(decisiones D1, D3)*

> Confirmar **D1** (rango) y **D3** (bracket de undo) antes de fijar la constante y los
> listeners. Por defecto: rango `0..1`, bracket solo si trivial.

**Archivos (test):** `src/core/master-strip.test.ts` *(nuevo)*.
**Archivos (impl):** `src/core/master-strip.ts` *(nuevo)*.

**3a · Test rojo.** Escribir `src/core/master-strip.test.ts` ejercitando `buildMasterStrip`
contra un GainNode y un AnalyserNode **mockeados** (siguiendo el estilo DOM-only de
`session-host-active-lane.test.ts`, que stubea `document` si hace falta — aunque vitest aquí
usa jsdom; comprobar el entorno). Casos:
- Devuelve un `HTMLElement` con clases `mix-col master-strip`.
- Contiene un `.mix-name` cuyo `textContent === 'MASTER'`.
- El `<input type="range">` (fader): tras `fader.value = '0.5'` + dispatch `input`,
  `deps.masterGain.gain.value === 0.5`. (Mock: `{ gain: { value: 0 } }`.)
- El fader respeta el rango decidido en **D1** (`min`/`max` correctos).
- El botón FX (`.master-fx-toggle`) invoca `deps.onToggleFx` al `click`.
- Refleja `deps.isFxOpen()` en la clase `.active` del botón al construir.
- Si se pasa `deps.registerDisposable`, registra el handle del VU meter (verificar que se llama
  ≥1 vez con un objeto `{ dispose }`). Mock de `createLevelMeter`: o bien se inyecta, o se
  pasa un AnalyserNode mock con `fftSize` y `getFloatTimeDomainData` no-op para que
  `createLevelMeter` real no pete (preferible inyección/mock del analyser con
  `fftSize: 512`).
- Assertions **relativas/estructurales** (DOM/estado), no magnitudes de audio.

Definir la interfaz en el test/módulo:
```ts
export interface MasterStripDeps {
  masterGain: GainNode;
  masterMeterAnalyser: AnalyserNode;
  historyDeps?: HistoryDeps;
  isFxOpen(): boolean;
  onToggleFx(): void;
  registerDisposable?(d: { dispose(): void }): void;
}
export function buildMasterStrip(deps: MasterStripDeps): HTMLElement;
```

Correr el test → **debe fallar** (módulo inexistente).

**3b · Implementar.** Crear `src/core/master-strip.ts` calcando el bloque fader/VU de
`buildMixerColumn` ([src/core/mixer.ts:158-194](../../../src/core/mixer.ts)) pero simplificado:
- `.mix-col.master-strip` → `.mix-name` = "MASTER".
- Botón `.master-fx-toggle` (`textContent` `FX` o `⛭ FX`, `title="Master effects"`), toggle de
  `onToggleFx`, `.active` reflejando `isFxOpen()`.
- `.mix-fader-wrap` / `.mix-fader-row` con `<input type="range">` (rango **D1**) cuyo `input`
  escribe `deps.masterGain.gain.value` y actualiza el `.mix-fader-val` (reusar `fmtPct`).
- VU: `createLevelMeter({ analyser: deps.masterMeterAnalyser })`; si `deps.registerDisposable`,
  registrar el handle.
- **D3:** si se decide bracketear, copiar los listeners `pointerdown/up` + `focus/blur` de
  [src/core/mixer.ts:170-179](../../../src/core/mixer.ts) usando `deps.historyDeps`. Si no, omitir.

**Verificar:**
- `npx tsc --noEmit` limpio.
- `NO_COLOR=1 npx vitest run src/core/master-strip.test.ts` → **verde**.
- `gitnexus_detect_changes()` antes de commitear.
**Riesgo:** bajo (módulo nuevo, sin consumidores aún). El único riesgo es el entorno del VU
meter en test (RAF/analyser): mitigado mockeando el analyser.

---

### Tarea 4 — Estilos del master strip y del panel *(decisión D5)*

> Confirmar **D5** (posición del panel). Por defecto: full-width bajo el grid.

**Archivos:** `src/styles/_mixer.scss` (o `_session-grid.scss`).
**Qué hacer:**
- Añadir reglas para `.master-strip` (acento distinto, p.ej. borde `--amber` reforzado, para
  diferenciarlo visualmente de una lane), `.master-fx-toggle` (coherente con `.rnd`; estado
  `.active`), y `#master-fx-panel` (full-width bajo el grid, margen superior; el `hidden` nativo
  ya lo oculta).
- Reutilizar `.mix-col` / `.mix-name` / `.mix-fader-wrap` / `.mix-fader` / `.mix-vu-host` ya
  existentes ([src/styles/_mixer.scss](../../../src/styles/_mixer.scss)).
**Verificar:** `npm run build` limpio (SCSS compila). Smoke visual diferido a la Tarea 9 (el
botón aún no togglea hasta la Tarea 5). De momento, inspeccionar que el strip tiene aspecto de
columna y el panel se ve si se le quita `hidden` a mano en DevTools.
**Riesgo:** bajo (solo CSS; no afecta a lógica ni a tests). El grid template ya reserva 140px
para la última columna, así que el strip encaja sin cambiar `_session-grid.scss:37`.

---

### Tarea 5 — Flag `masterFxOpen` + `toggleMasterFx()` en SessionHost (con test) — TDD

**Archivos (test):** un test de `SessionHost` (extender un fixture existente como
`src/session/session-host-active-lane.test.ts`, que ya stubea `document`, o un nuevo
`src/session/session-host-master-fx.test.ts`).
**Archivos (impl):** `src/session/session-host.ts`.

**5a · Test rojo.** Verificar que:
- `new SessionHost(deps).masterFxOpen === false` por defecto (campo público, no serializado,
  junto a `activeEditLane` [session-host.ts:165](../../../src/session/session-host.ts)).
- `host.toggleMasterFx()` alterna el flag `false → true → false`.
- (Si el stub de `document.getElementById` devuelve un elemento fake con `hidden`/`classList`):
  `toggleMasterFx()` aplica `hidden` al `#master-fx-panel` y `.active` al botón. En el fixture
  actual `getElementById` devuelve `null`, así que el test mínimo verifica **solo el flag**; el
  efecto DOM se cubre en e2e (Tarea 9). Mantenerlo simple para no acoplar el unit a jsdom.

**5b · Implementar.**
- Añadir `masterFxOpen = false;` junto a `activeEditLane`
  ([session-host.ts:165](../../../src/session/session-host.ts)).
- Añadir método `toggleMasterFx()`: conmuta el flag y refleja en DOM **sin** re-render
  completo (evita perder scroll/flicker; lo dicta el spec):
  ```ts
  toggleMasterFx(): void {
    this.masterFxOpen = !this.masterFxOpen;
    const panel = document.getElementById('master-fx-panel');
    if (panel) panel.hidden = !this.masterFxOpen;
    // el botón refleja .active al re-construirse el strip; aquí togglear directo si está cacheado
  }
  ```
- En `renderWithMixer` ([session-host.ts:483-498](../../../src/session/session-host.ts))
  **re-aplicar** `masterFxOpen` al panel tras (re)construir el strip, para que los re-render por
  play-state (`startRenderTick`) no pierdan el estado.
- **Impacto:** correr `gitnexus_impact({target: "renderWithMixer", direction: "upstream"})`
  antes de editarlo y reportar el blast radius.
**Verificar:**
- `npx tsc --noEmit` limpio.
- `NO_COLOR=1 npx vitest run <archivo del test>` → verde.
- `gitnexus_detect_changes()` antes de commitear.
**Riesgo:** medio-bajo. `renderWithMixer` está en el camino caliente del render del grid;
el cambio es aditivo (re-aplica un `hidden`). El impacto upstream confirma que solo lo llama
`onStateApplied`/`startRenderTick` y los flujos de edición.

---

### Tarea 6 — Cablear `buildMasterStrip` en `renderWithMixer` + pasar deps desde main *(depende de D2 para la sincronía con `#volume`)*

> Confirmar **D2** antes de la sub-tarea de sincronía con `#volume`. El cableado del strip en sí
> no depende de D2; la sincronía cruzada sí.

**Archivos:** `src/session/session-host.ts`, `src/main.ts`.
**Qué hacer:**
- En `SessionHostDeps` añadir:
  ```ts
  masterGain: GainNode;
  masterMeterAnalyser: AnalyserNode;
  ```
  (Opcionales `?` si hace falta para que los fixtures de test sin audio no rompan — comprobar
  los `mixerDeps: {} as never` de los tests existentes; probablemente convenga hacerlos
  **opcionales** y que `renderWithMixer` haga fallback al `sp2` actual cuando falten, para no
  obligar a cada fixture a inyectar audio.)
- En `renderWithMixer`, **sustituir el `sp2` final**
  ([session-host.ts:495-497](../../../src/session/session-host.ts)) por:
  ```ts
  if (this.deps.masterGain && this.deps.masterMeterAnalyser) {
    row.appendChild(buildMasterStrip({
      masterGain: this.deps.masterGain,
      masterMeterAnalyser: this.deps.masterMeterAnalyser,
      historyDeps: this.deps.historyDeps,
      isFxOpen: () => this.masterFxOpen,
      onToggleFx: () => this.toggleMasterFx(),
      registerDisposable: /* mismo canal que las MixerColumn si existe */,
    }));
  } else {
    const sp2 = document.createElement('div');
    sp2.className = 'session-spacer';
    row.appendChild(sp2);
  }
  // re-aplicar masterFxOpen al panel (Tarea 5)
  ```
  Importar `buildMasterStrip` arriba (junto a `buildMixerColumn`,
  [session-host.ts:65](../../../src/session/session-host.ts)).
- En `src/main.ts` ([src/main.ts:372-428](../../../src/main.ts)) pasar
  `masterGain: master` y `masterMeterAnalyser` (el dedicado de la Tarea 2, o `analyser` si D4 =
  reusar) al constructor de `SessionHost`.
- **Sincronía con `#volume` (D2 = coexistencia):** añadir un listener cruzado para que mover el
  fader del strip refleje `#volume` y viceversa. Mínimo: el `input` del fader del strip también
  fija `volInput.value` (y dispara su readout/undo si procede), y el `input` de `#volume`
  ([src/main.ts:269](../../../src/main.ts)) también actualiza el fader del strip. Ambos escriben
  el **mismo** `master.gain.value`, así que basta con sincronizar el valor mostrado. Si **D2 =
  eliminar `#volume`**: NO hacerlo aquí (solapa con frente B); dejar nota de coordinación.
**Verificar:**
- `npx tsc --noEmit` limpio.
- `npm run test:unit` verde (los fixtures con `mixerDeps: {} as never` no inyectan
  `masterGain`; al hacerlo opcional + fallback, siguen pasando). Re-run si teardown flaky.
- `gitnexus_detect_changes()` antes de commitear.
**Riesgo:** medio. Toca el camino caliente (`renderWithMixer`) y el constructor de `SessionHost`
en `main.ts`. El fallback al `sp2` protege a los tests sin audio. Rebasar sobre `main` tras este
commit (es el punto donde más probable es chocar con B si B reordena el transporte).

---

### Tarea 7 — Limpiar el handler de la pestaña `data-tab="fx"`

**Archivos:** `src/main.ts`.
**Qué hacer:**
- Revisar el bucle de tabs estáticos ([src/main.ts:348-356](../../../src/main.ts)): al haber
  borrado el botón `data-tab="fx"` (Tarea 1), el bucle ya **no** itera sobre él y no togglea la
  page `fx` (que además ya no existe como `.page`). Confirmar con Grep que **nada más** abre esa
  page ni referencia `data-page="fx"` / `data-tab="fx"` en `src/`.
- Si queda código muerto que asumía la page `fx` (p.ej. al inicializar `pages`), limpiarlo.
- Mantener intactos `wireFxUI(fxUIDeps)` ([src/main.ts:601](../../../src/main.ts)) y
  `sessionHost.onStateApplied(rebuildMasterInserts)` ([src/main.ts:604](../../../src/main.ts)).
**Verificar:**
- `Grep` de `data-tab="fx"` y `data-page="fx"` en `src/` e `index.html` → 0 resultados (salvo
  el panel renombrado).
- `npm run build` limpio.
- `gitnexus_detect_changes()`.
**Riesgo:** bajo. Es eliminación de acoplamiento muerto; el bucle es genérico y tolera la
ausencia del botón.

---

### Tarea 8 — Generalizar selectores SCSS si dependían de `.page[data-page="fx"]`

**Archivos:** `src/styles/_fx.scss` (y/o `_mixer.scss`).
**Qué hacer:**
- Verificar con `Grep` en `src/styles/` si alguna regla de `.fx-zone` / `.poly-section` /
  `.fx-zone-content` usa `.page[data-page="fx"]` (o `.page`) como **ancestro**. Si lo hace,
  generalizar el selector para que aplique también bajo `#master-fx-panel`.
- Confirmar visualmente (smoke) que SENDS / MASTER COMP / INSERTS se ven igual que en la antigua
  pestaña.
**Verificar:** `npm run build` limpio; smoke visual del panel abierto (Tarea 9).
**Riesgo:** bajo (cosmético). Si `.fx-zone`/`.poly-section` ya eran independientes del ancestro
(lo más probable, son clases globales), esta tarea es un no-op confirmatorio.

---

### Tarea 9 — e2e Playwright del master strip (TDD del comportamiento integrado)

> **Rebuild `dist/` antes:** `npm run build` (el e2e sirve `dist/` con `vite preview`, sin build).

**Archivos:** `tests/e2e/master-strip.spec.ts` *(nuevo)*.
**Qué hacer:** siguiendo el patrón de
[tests/e2e/lane-ui.spec.ts](../../../tests/e2e/lane-ui.spec.ts) (`page.goto('/')`,
`waitForFunction(() => document.querySelectorAll('.session-cell-filled').length > 0)`):
1. **El master strip existe** al fondo del grid: `.master-strip` visible, con texto "MASTER".
2. **La pestaña Master FX ya no existe:** `expect(page.locator('button.tab[data-tab="fx"]'))
   .toHaveCount(0)`.
3. **El botón FX despliega el panel:** `#master-fx-panel` empieza `hidden`; click en
   `.master-fx-toggle` ⇒ panel visible y contiene `#fx-reverb-knobs`, `#fx-master-comp-knobs`,
   `#fx-filters`; segundo click ⇒ se oculta de nuevo.
4. **Los knobs del Master FX siguen vivos:** al abrir, `#fx-master-comp-knobs .knob` count > 0
   (prueba que `wireFxUI` los encontró por id en su nueva ubicación).
5. **Regresión del mixer:** las `.mix-col` de lane conservan su VU y M/S; el master **no** se
   cuela como una lane más (distinguir por `.master-strip`; el conteo de columnas-lane no debe
   incluirlo).
6. *(Opcional, cableado)* `page.evaluate` mueve el fader del master a 0 ⇒
   `master.gain.value === 0` (si hay un hook accesible; si no, omitir).
**Verificar:** `npm run build` && `npm run test:e2e` (o `npx playwright test
tests/e2e/master-strip.spec.ts`) → verde.
**Riesgo:** medio (e2e frágil si el `dist/` está stale — por eso el rebuild explícito). Estos
tests son el contrato real de la reubicación.

---

### Tarea 10 — Verificación final + smoke en navegador

**Archivos:** ninguno (verificación).
**Qué hacer:**
- `npx tsc --noEmit` limpio.
- `npm run test:unit` verde (re-run si `ERR_IPC_CHANNEL_CLOSED` en teardown).
- `npm run build` limpio.
- `npm run test:e2e` verde (sobre el `dist/` recién construido).
- **Smoke manual** en `http://localhost:5173`:
  - El strip del master aparece al fondo de la columna de scenes, con `MASTER` + fader + VU +
    botón FX.
  - Abrir/cerrar FX con el botón; ver SENDS / MASTER COMP / INSERTS bajo el grid.
  - Tocar reverb/delay/master-comp/inserts y confirmar que **afectan al sonido** igual que la
    antigua pestaña.
  - Mover el fader del master baja/sube el volumen global; `#volume` y el fader se mantienen
    sincronizados (si D2 = coexistencia).
- `gitnexus_detect_changes()` final: confirmar que solo los símbolos esperados
  (`buildMasterStrip`, `buildAudioGraph`/`AudioGraph`, `renderWithMixer`, `SessionHost`)
  cambiaron.
**Verificar:** todo lo anterior verde + smoke OK.
**Riesgo:** nulo (es la verificación). Si algo falla, volver a la tarea correspondiente.

---

### Finalización de la rama

Cuando todo esté verde y el smoke confirmado:
- `git rebase main` (resolver conflictos si los hay; probablemente con frente B en el
  transporte/scenes — el cambio es ortogonal).
- `git merge --ff-only` sobre `main` (avance lineal, **sin** merge commit).
- `ExitWorktree`.
- Mover el spec implementado fuera del árbol según la convención del proyecto (los design docs
  implementados no se mantienen en el repo; recuperables por git). Actualizar
  [docs/superpowers/REMAINING-WORK.md](../REMAINING-WORK.md) si listaba este frente.

---

## Invariantes y notas de riesgo transversales

- **El audio no cambia.** Ningún cambio en `FxBus`, `MasterCompressor`, `InsertChain` ni en el
  cableado de salida de `audio-graph.ts` (salvo el tap de medición aditivo de la Tarea 2).
  `wireFxUI` se reutiliza intacto.
- **Conservar todos los ids `#fx-*`** al mover el markup (Tarea 1) — es lo que sostiene que
  `fx-ui.ts` no se toque.
- **Sin re-render completo en el toggle** (Tarea 5): solo `panel.hidden` + `.active`, y
  re-aplicación del flag en `renderWithMixer` para sobrevivir a los re-render por play-state.
- **Phase G:** el master strip **no** depende de `laneResources` (usa el `master` GainNode
  global), pero al construirse dentro de `renderWithMixer` hereda el diferido a
  `onStateApplied` sin esfuerzo — no hay que adelantar su construcción.
- **GitNexus:** correr `gitnexus_impact` antes de editar `buildAudioGraph` y `renderWithMixer`;
  `gitnexus_detect_changes()` antes de cada commit. (El MCP indexa el repo principal, no el
  worktree: `detect_changes` puede no ver cambios desde el worktree — verificar manualmente con
  `git status` si el MCP no reporta.)
- **Rebase frecuente sobre `main`** tras cada commit, especialmente tras la Tarea 6 (la que más
  toca el transporte/scenes que el frente B reordena).
