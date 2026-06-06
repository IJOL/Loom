# Frente C · Mixer del master — plan de implementación

**Fecha:** 2026-06-06
**Spec de origen:** [docs/superpowers/specs/2026-06-06-mixer-master-design.md](../specs/2026-06-06-mixer-master-design.md)
**Coordinación:** [docs/superpowers/specs/2026-06-06-coordinacion-frentes.md](../specs/2026-06-06-coordinacion-frentes.md) (§5: `#volume` sobrevive en Performance; el fader del master se SINCRONIZA con él, no lo reemplaza).
**Frente:** C (revisión UX `2026-06-06-loom-ux-overhaul-overview.md`)
**Modo de trabajo:** worktree `loom-ux-overhaul` (ya activo). Commit libre en la rama; rebase
sobre `main` muy a menudo; al terminar, `rebase main` + `merge --ff-only`.
**Orden global (coordinación §6):** A primero, luego C, luego D, luego E. C es ortogonal en
código a A/D; la única superficie compartida con B es la fila de transporte de `#volume`, que
este frente **no modifica** (solo lee/sincroniza el `volInput` existente).

---

## Resumen del enfoque

El audio **no cambia** (salvo un tap de medición aditivo para el VU). Esto es
**reubicación + recableado de UI**:

1. Construir un **strip del master** (`MASTER` + fader **proxy de `#volume`** + VU + botón `FX`)
   en la última columna de `session-row-mixer` (la columna de scenes), donde hoy va un
   `session-spacer`.
2. **Mover** el contenido de `.page[data-page="fx"]` a un panel `#master-fx-panel` colapsable
   bajo el grid+inspector, **conservando todos los ids internos** para que `wireFxUI` los siga
   encontrando sin tocar `fx-ui.ts`.
3. **Quitar** la pestaña `data-tab="fx"` (y arreglar la shot del manual que la usaba).
4. Persistir abierto/cerrado en un flag de UI de `SessionHost` (no serializado), análogo a
   `activeEditLane`.
5. **Crear el canal de teardown de VU meters** (`registerDisposable`) que hoy NO existe, para no
   agravar (y de paso corregir) la fuga de RAF/analyser de las columnas de lane.

**Corrección clave del plan anterior (revisión adversarial):** el fader del master **NO escribe
`master.gain.value` directamente** ni bracketea su propio undo. Escribe `volInput.value` y
dispara el evento `input` de `#volume`, reaprovechando su handler (que escribe `master.gain` y
participa del bracket de undo, [main.ts:269,276-289](../../../src/main.ts)). Motivo verificado:
el snapshot de guardado/undo lee `volInput.value`, no `master.gain.value`
([saved-state-v3.ts:73,97](../../../src/save/saved-state-v3.ts)). El master volume **ya se
persiste y ya es undo-able** — no hay que promover nada al modelo.

### Referencias de código verificadas (worktree)

- Grafo: `master → masterInsertChain → masterComp → analyser → destination`
  ([audio-graph.ts:21-35](../../../src/app/audio-graph.ts)). `analyser` es `fftSize=2048`
  conectado a `destination`. **No hay** un analyser de medición dedicado del master todavía.
- `master`, `analyser`, `masterComp` se desestructuran del audio-graph en `main.ts`.
- `#volume` es `<input id="volume" type="range" min="0" max="1" step="0.01" value="0.5">`
  ([index.html:107](../../../index.html)); su handler escribe `master.gain.value`
  ([main.ts:269-270](../../../src/main.ts)) y ya está bracketeado para undo
  ([main.ts:276-289](../../../src/main.ts), sobre `_discreteHistoryDeps`).
- **El master volume se PERSISTE y es UNDO-ABLE hoy:** `masterVol: parseFloat(volInput.value)`
  ([saved-state-v3.ts:73](../../../src/save/saved-state-v3.ts)) y se restaura en :97.
- La fila de mixer se rellena en `renderWithMixer`
  ([session-host.ts:483-498](../../../src/session/session-host.ts)): `sp` inicial, un
  `buildMixerColumn` por lane, y un `sp2` final (← **aquí va el master strip**). Hace
  `row.innerHTML=''` sin disponer los VU anteriores (fuga). Se invoca en cada cambio de
  play-state vía `startRenderTick` ([session-host.ts:1044-1057](../../../src/session/session-host.ts)).
- `mixerDeps` ([main.ts:220-239](../../../src/main.ts)) **NO** incluye `registerDisposable`;
  `historyDeps` se expone vía **getter lazy** (`get historyDeps()`) porque `_discreteHistoryDeps`
  se asigna post-boot.
- `buildMixerColumn` fader es `min=0 max=1.5` y escribe `strip.setLevel`
  ([mixer.ts:164-194](../../../src/core/mixer.ts)); `createLevelMeter` registra un RAF + retiene
  el analyser y expone `dispose()`. `mixer.ts:155-157` documenta que el caller DEBE disponerlo.
- `wireFxUI` localiza por id: `#fx-reverb-knobs`, `#fx-delay-knobs`, `#fx-master-comp-knobs`,
  `#fx-filters`, `#fx-add-filter` ([fx-ui.ts:109-110,146,183-186](../../../src/core/fx-ui.ts));
  se invoca una vez en boot ([main.ts:601](../../../src/main.ts)).
- `.page[data-page="fx"]` ([index.html:272-303](../../../index.html)) está ANTES de
  `.session-view` ([index.html:315](../../../index.html)); dentro de `.session-view` el orden es
  `#session-grid` → `#session-inspector` ([index.html:316-317](../../../index.html)).
- `.page[hidden] { display: none !important; }` ([_tabs.scss:33](../../../src/styles/_tabs.scss)):
  al sacar el bloque de `.page` se pierde esta regla → el panel necesita su propia regla `[hidden]`.
- `session-stop-all` vive en la fila `session-row-stop` ([session-ui.ts:95-111](../../../src/session/session-ui.ts)),
  **no** en la fila de mixer → el master strip (fila de mixer) no colisiona con él.
- En Performance, `#session-view-root` se oculta
  ([performance-feature.ts:191](../../../src/app/performance-feature.ts)) → el master strip
  desaparece; `#volume` (fuera del root) sobrevive.
- vitest es `environment:'node'` ([vitest.config.ts:5](../../../vitest.config.ts)); un test con
  DOM real necesita `// @vitest-environment jsdom` como [lane-fx-panel.test.ts:1](../../../src/core/lane-fx-panel.test.ts).
- La shot `master-fx` del manual usa `.tab[data-tab="fx"]` / `.page[data-page="fx"]`
  ([tools/manual/shot-list.mjs:96-98](../../../tools/manual/shot-list.mjs)) → romperá al borrarlos.

---

## Decisiones CERRADAS (ya no son dudas)

> El plan anterior tenía 5 "dudas abiertas". La revisión demostró que la mayoría partían de
> premisas falsas o ya estaban resueltas por coordinación. Quedan cerradas así:

- **Persistencia/undo del master volume:** YA existe (`SavedStateV3.masterVol` + bracket de
  `#volume`). El fader delega en `volInput`. **No** se promueve `master.gain` al modelo.
- **Rango del fader:** `0..1` (idéntico a `#volume`), porque es su proxy.
- **`#volume` vs fader:** coexisten sincronizados (coordinación §5). No se elimina `#volume`.
- **VU del master:** analyser dedicado `fftSize=512` tapado de `masterComp.output` (técnico).
- **Posición del panel:** full-width bajo el grid+inspector, **tras `#session-inspector`**.

**Dudas reales restantes (estéticas, del usuario):** acento visual del master strip; icono vs
texto del botón FX. Ninguna bloquea la implementación; por defecto: borde `--amber` reforzado y
etiqueta `FX`. Se aplican y se confirman en el smoke (Tarea 10).

---

## Tareas (de menor a mayor riesgo, TDD donde aplique)

### Tarea 0 — Preparación y baseline verde

**Archivos:** ninguno (solo verificación).
**Qué hacer:**
- Confirmar el worktree activo y `git status` limpio.
- Correr `npm run test:unit` y `npx tsc --noEmit` para fijar un baseline verde antes de tocar
  nada (recordar el flaky `ERR_IPC_CHANNEL_CLOSED` en teardown de `test:unit`: re-ejecutar para
  confirmar).
**Verificar:** `npx tsc --noEmit` limpio; `npm run test:unit` verde (re-run si teardown flaky).
**Riesgo:** nulo. Ancla para detectar regresiones.

---

### Tarea 1 — Mover el bloque Master FX a `#master-fx-panel` y quitar la pestaña (HTML puro)

**Archivos:** `index.html`.
**Qué hacer:**
- **Quitar** `<button class="tab" data-tab="fx">Master FX</button>` ([index.html:178](../../../index.html)).
  El `.tab-bar` queda vacío; dejarlo vacío (B podría reusarlo) — no borrar el contenedor.
- **Mover** el bloque completo `<div class="page" data-page="fx" hidden>…</div>`
  ([index.html:272-303](../../../index.html)) dentro de `.session-view`, **después de
  `#session-inspector`** ([index.html:317](../../../index.html)) — NO entre `#session-grid` e
  inspector. Renombrar el wrapper a `<div id="master-fx-panel" hidden>` y **no tocar** ningún id
  interno (`#fx-reverb-knobs`, `#fx-delay-knobs`, `#fx-master-comp-knobs`, `#fx-add-filter`,
  `#fx-filters`) ni las clases `.fx-zone`, `.poly-section`, `.fx-zone-content`.
**Verificar:**
- `npm run build` (typecheck + bundle) limpio.
- **Smoke manual** en `http://localhost:5173`: la app arranca; el bloque FX ya no es pestaña; el
  panel existe en el DOM (oculto por `hidden` nativo). `wireFxUI` no rompe en consola (encuentra
  sus ids; aún no hay botón para abrirlo, eso es la Tarea 5).
**Riesgo:** bajo. Es mover markup; `wireFxUI` busca por id, no por ancestro `.page`. El estilo
del panel puede verse degradado temporalmente (pierde `.page[hidden]` y reglas de `.page`); se
arregla en la Tarea 8. Cosmético y temporal.

---

### Tarea 2 — Analyser dedicado del master en el audio-graph

**Archivos:** `src/app/audio-graph.ts`, `src/main.ts`.
**Qué hacer:**
- En `buildAudioGraph` ([audio-graph.ts:21-35](../../../src/app/audio-graph.ts)) añadir
  `const masterMeterAnalyser = ctx.createAnalyser(); masterMeterAnalyser.fftSize = 512;
  masterComp.output.connect(masterMeterAnalyser);` **sin** conectarlo a `destination` (tap de
  medición, igual que los analysers de strip). Exponerlo en la interfaz `AudioGraph` y en el
  objeto devuelto.
- En `src/main.ts` desestructurar `masterMeterAnalyser` del audio-graph.
- **Impacto (GitNexus):** `gitnexus_impact({target: "buildAudioGraph", direction: "upstream"})`
  antes de editar y reportar el blast radius (lo consume `createAudioGraph` + el render offline).
  Verificar que añadir un campo a `AudioGraph` es aditivo y no rompe consumidores.
**Verificar:**
- `npx tsc --noEmit` limpio (la interfaz `AudioGraph` compila con el campo nuevo).
- `npm run test:unit` verde (audio-graph no tiene test que dependa del conteo de nodos; confirmar
  que ningún test mockeaba la forma exacta de `AudioGraph`).
- `gitnexus_detect_changes()` antes de commitear: solo `buildAudioGraph`/`AudioGraph` afectados.
**Riesgo:** bajo. Aditivo, sin re-cableado del path de salida. El offline render reusa
`buildAudioGraph`; el tap extra existe también allí, inocuo (no se conecta a destino).

---

### Tarea 3 — Canal de teardown de VU meters (`registerDisposable`)

> Esta tarea CREA el mecanismo que el plan anterior daba erróneamente por existente. Va ANTES de
> cablear cualquier VU (master o el del fader) para que ningún VU nuevo fugue.

**Archivos:** `src/session/session-host.ts`, `src/core/mixer.ts` (deps type), `src/main.ts`.
**Qué hacer:**
- En `SessionHost` añadir `private mixerDisposables: { dispose(): void }[] = [];`.
- En `renderWithMixer` ([session-host.ts:483-498](../../../src/session/session-host.ts)),
  **antes** de `row.innerHTML = ''`: `for (const d of this.mixerDisposables) d.dispose();
  this.mixerDisposables = [];`.
- `mixerDeps` ([main.ts:220-239](../../../src/main.ts)) ya consume `MixerColumnDeps`, que ya tiene
  `registerDisposable?` opcional ([mixer.ts:181-182](../../../src/core/mixer.ts) lo usa). Añadir
  en `main.ts` `registerDisposable: (d) => sessionHost.registerMixerDisposable(d)` a `mixerDeps`,
  y exponer en `SessionHost` un método `registerMixerDisposable(d) { this.mixerDisposables.push(d); }`.
- **Impacto (GitNexus):** `gitnexus_impact({target: "renderWithMixer", direction: "upstream"})`
  antes de editar.
**Verificar:**
- `npx tsc --noEmit` limpio.
- `npm run test:unit` verde.
- **Smoke manual:** lanzar varios clips (fuerza re-render de la fila de mixer repetidamente) y
  confirmar en el perfilador / `getEntriesByType` que el número de RAF no crece sin tope (o, más
  simple, que la app no se ralentiza tras decenas de re-renders). Confirma que la fuga se corrige.
- `gitnexus_detect_changes()` antes de commitear.
**Riesgo:** bajo-medio. Toca `renderWithMixer` (camino caliente) pero el cambio es aditivo
(disponer antes de vaciar). Corrige una fuga preexistente; ninguna regresión de comportamiento.

---

### Tarea 4 — `buildMasterStrip` con test rojo primero (TDD)

**Archivos (test):** `src/core/master-strip.test.ts` *(nuevo)*.
**Archivos (impl):** `src/core/master-strip.ts` *(nuevo)*.

**4a · Test rojo.** Crear `src/core/master-strip.test.ts` con `// @vitest-environment jsdom` en
la **primera línea** (vitest es `node`; ver Referencias). Ejercitar `buildMasterStrip` con un
`volInput` real (jsdom: `document.createElement('input')`, `type=range`, `min=0 max=1`) y un
AnalyserNode **mockeado** (`{ fftSize: 512, getFloatTimeDomainData() {} }`). Casos:
- Devuelve un `HTMLElement` con clases `mix-col master-strip`.
- Contiene un `.mix-name` con `textContent === 'MASTER'`.
- El `<input type="range">` (fader) tiene `min === '0'` y `max === '1'`.
- **Proxy de `volInput`:** spy en `volInput.addEventListener('input', spy)`; tras
  `fader.value = '0.5'` + `fader.dispatchEvent(new Event('input'))` ⇒ `volInput.value === '0.5'`
  y el spy se llamó (el fader escribe `volInput` y dispara su `input`). **No** se asserta sobre
  `master.gain` — el contrato es la delegación a `volInput`.
- El botón FX (`.master-fx-toggle`) invoca `deps.onToggleFx` al `click`.
- Refleja `deps.isFxOpen()` en la clase `.active` del botón al construir (probar `true` y `false`).
- Con `deps.registerDisposable` (spy), registra el handle del VU meter (≥1 llamada con `{ dispose }`).
- Assertions **estructurales** (DOM/estado), no magnitudes de audio.

Interfaz (en el módulo):
```ts
export interface MasterStripDeps {
  volInput: HTMLInputElement;
  masterMeterAnalyser: AnalyserNode;
  isFxOpen(): boolean;
  onToggleFx(): void;
  registerDisposable?(d: { dispose(): void }): void;
}
export function buildMasterStrip(deps: MasterStripDeps): HTMLElement;
```

Correr `NO_COLOR=1 npx vitest run src/core/master-strip.test.ts` → **debe fallar** (módulo
inexistente).

**4b · Implementar.** Crear `src/core/master-strip.ts` calcando el bloque fader/VU de
`buildMixerColumn` ([mixer.ts:158-194](../../../src/core/mixer.ts)) pero simplificado:
- `.mix-col.master-strip` → `.mix-name` = "MASTER".
- Botón `.master-fx-toggle` (`FX`, `title="Master effects"`); `click` → `onToggleFx()`; clase
  `.active` reflejando `isFxOpen()`.
- `.mix-fader-wrap`/`.mix-fader-row` con `<input type="range" min=0 max=1 step=0.01>`, `value`
  inicial = `deps.volInput.value`. En `input`: `deps.volInput.value = fader.value;
  deps.volInput.dispatchEvent(new Event('input'));` y actualizar el `.mix-fader-val` (reusar
  `fmtPct`). **NO** escribir `master.gain` ni añadir listeners de `pointerdown/up`/`focus/blur`
  (el bracket de undo lo aporta `#volume`).
- VU: `createLevelMeter({ analyser: deps.masterMeterAnalyser })`; si `deps.registerDisposable`,
  registrar el handle.
**Verificar:**
- `npx tsc --noEmit` limpio.
- `NO_COLOR=1 npx vitest run src/core/master-strip.test.ts` → **verde**.
- `gitnexus_detect_changes()` antes de commitear.
**Riesgo:** bajo (módulo nuevo, sin consumidores aún).

---

### Tarea 5 — Flag `masterFxOpen` + `toggleMasterFx()` en SessionHost (TDD)

**Archivos (test):** `src/session/session-host-master-fx.test.ts` *(nuevo)* (o extender un fixture
existente como `session-host-active-lane.test.ts`).
**Archivos (impl):** `src/session/session-host.ts`.

**5a · Test rojo.** Verificar que:
- `new SessionHost(deps).masterFxOpen === false` por defecto (campo público, no serializado,
  junto a `activeEditLane` [session-host.ts:165](../../../src/session/session-host.ts)).
- `host.toggleMasterFx()` alterna el flag `false → true → false`.
- (El efecto DOM `#master-fx-panel.hidden` se cubre en e2e — Tarea 9 — porque el stub de
  `getElementById` del fixture devuelve `null`. El unit verifica **solo el flag**, sin acoplar a
  jsdom.)

**5b · Implementar.**
- Añadir `masterFxOpen = false;` junto a `activeEditLane`.
- Método `toggleMasterFx()`: conmuta el flag y refleja en DOM **sin** re-render completo:
  ```ts
  toggleMasterFx(): void {
    this.masterFxOpen = !this.masterFxOpen;
    const panel = document.getElementById('master-fx-panel');
    if (panel) (panel as HTMLElement).hidden = !this.masterFxOpen;
    const btn = document.querySelector('.master-fx-toggle');
    if (btn) btn.classList.toggle('active', this.masterFxOpen);
  }
  ```
- En `renderWithMixer`, tras (re)construir el strip, **re-aplicar** `masterFxOpen` al
  `#master-fx-panel` (`panel.hidden = !this.masterFxOpen`) para sobrevivir a los re-render por
  play-state.
**Verificar:**
- `npx tsc --noEmit` limpio.
- `NO_COLOR=1 npx vitest run src/session/session-host-master-fx.test.ts` → verde.
- `gitnexus_detect_changes()`.
**Riesgo:** medio-bajo. `renderWithMixer` es camino caliente; el cambio es aditivo (re-aplica un
`hidden`).

---

### Tarea 6 — Cablear `buildMasterStrip` en `renderWithMixer` + pasar deps desde main

**Archivos:** `src/session/session-host.ts`, `src/main.ts`.
**Qué hacer:**
- En `SessionHostDeps` añadir (opcionales para no romper fixtures sin audio):
  ```ts
  volInput?: HTMLInputElement;
  masterMeterAnalyser?: AnalyserNode;
  ```
- Importar `buildMasterStrip` arriba (junto a `buildMixerColumn`,
  [session-host.ts:65](../../../src/session/session-host.ts)).
- En `renderWithMixer`, **sustituir el `sp2` final** ([session-host.ts:495-497](../../../src/session/session-host.ts)):
  ```ts
  if (this.deps.volInput && this.deps.masterMeterAnalyser) {
    row.appendChild(buildMasterStrip({
      volInput: this.deps.volInput,
      masterMeterAnalyser: this.deps.masterMeterAnalyser,
      isFxOpen: () => this.masterFxOpen,
      onToggleFx: () => this.toggleMasterFx(),
      registerDisposable: (d) => this.registerMixerDisposable(d),
    }));
  } else {
    const sp2 = document.createElement('div');
    sp2.className = 'session-spacer';
    row.appendChild(sp2);
  }
  // re-aplicar masterFxOpen al panel (Tarea 5)
  ```
- En `src/main.ts` ([main.ts:372-428](../../../src/main.ts)) pasar `volInput` (el `#volume`
  existente) y `masterMeterAnalyser` (el dedicado de la Tarea 2) al constructor de `SessionHost`.
- **Sincronía inversa (`#volume` → fader):** en el handler `input` de `#volume`
  ([main.ts:269](../../../src/main.ts)), tras escribir `master.gain.value`, actualizar el fader
  del master si está montado:
  ```ts
  volInput.addEventListener('input', () => {
    master.gain.value = parseFloat(volInput.value);
    const mf = document.querySelector('.master-strip .mix-fader') as HTMLInputElement | null;
    if (mf && mf.value !== volInput.value) mf.value = volInput.value;
  });
  ```
  (Evita un bucle de eventos: solo asigna `.value`, no dispara `input`.) Como el fader del strip
  ya escribe `volInput` y dispara su `input`, ambos quedan sincronizados en ambas direcciones; y
  `renderWithMixer` lee `volInput.value` al construir, así que el fader nace sincronizado tras
  cada render (load de sesión, undo, etc.).
- **Impacto (GitNexus):** `gitnexus_impact({target: "renderWithMixer", direction: "upstream"})`
  (ya corrido en T5; confirmar que sigue acotado).
**Verificar:**
- `npx tsc --noEmit` limpio.
- `npm run test:unit` verde (los fixtures sin audio no inyectan `volInput`/`masterMeterAnalyser`;
  con deps opcionales + fallback al spacer, siguen pasando). Re-run si teardown flaky.
- `gitnexus_detect_changes()` antes de commitear.
**Riesgo:** medio. Toca el camino caliente (`renderWithMixer`) y el constructor de `SessionHost`
en `main.ts`, además del handler de `#volume`. El fallback al `sp2` protege los tests sin audio.
**Rebasar sobre `main` tras este commit** (punto más probable de choque con B si reordena el
transporte — aunque C no toca la fila de transporte, solo lee `volInput`).

---

### Tarea 7 — Limpiar el handler de la pestaña `data-tab="fx"` + la shot del manual

**Archivos:** `src/main.ts`, `tools/manual/shot-list.mjs`.
**Qué hacer:**
- Revisar el bucle de tabs estáticos en `main.ts`: al haber borrado el botón `data-tab="fx"`
  (Tarea 1), el bucle ya **no** itera sobre él. Confirmar con `Grep` que **nada más** abre esa
  page ni referencia `data-page="fx"` / `data-tab="fx"` en `src/`. Si queda código muerto que
  asumía la page `fx`, limpiarlo. Mantener `wireFxUI(fxUIDeps)` ([main.ts:601](../../../src/main.ts))
  y `sessionHost.onStateApplied(rebuildMasterInserts)` ([main.ts:604](../../../src/main.ts)) intactos.
- **Manual:** actualizar la shot `master-fx` ([shot-list.mjs:96-98](../../../tools/manual/shot-list.mjs)):
  cambiar `selector` a `#master-fx-panel` y `setup` para abrir vía
  `await page.locator('.master-fx-toggle').click(); await page.locator('#master-fx-panel').waitFor({ state: 'visible' });`.
**Verificar:**
- `Grep` de `data-tab="fx"` y `data-page="fx"` en `src/` e `index.html` → 0 (salvo el panel
  renombrado). **Grep también en `tools/`** → solo la shot ya actualizada (no `.page`/`.tab`).
- `npm run build` limpio. (No corremos `build:manual` aquí; basta con dejar la shot coherente.)
- `gitnexus_detect_changes()`.
**Riesgo:** bajo. Eliminación de acoplamiento muerto + un selector de captura del manual.

---

### Tarea 8 — Estilos del master strip y del panel

**Archivos:** `src/styles/_mixer.scss` (o `_session-grid.scss`), `src/styles/_fx.scss` si hace falta.
**Qué hacer:**
- Añadir reglas para `.master-strip` (acento distinto, p.ej. borde `--amber` reforzado),
  `.master-fx-toggle` (coherente con `.rnd`; estado `.active`), `#master-fx-panel` (full-width
  bajo el grid+inspector, margen superior) y **`#master-fx-panel[hidden] { display: none; }`**
  (recupera el `display:none` que daba `.page[hidden]`, [_tabs.scss:33](../../../src/styles/_tabs.scss),
  ahora inaplicable).
- Reutilizar `.mix-col` / `.mix-name` / `.mix-fader-wrap` / `.mix-fader` / `.mix-vu-host` ya
  existentes.
- **Verificar con `Grep` en `src/styles/`** si alguna regla de `.fx-zone` / `.poly-section` /
  `.fx-zone-content` usa `.page` (o `.page[data-page="fx"]`) como **ancestro**. Si lo hace,
  generalizar el selector para que aplique también bajo `#master-fx-panel`. (Lo más probable: son
  clases globales independientes del ancestro → no-op confirmatorio.)
**Verificar:** `npm run build` limpio (SCSS compila). Smoke visual: el strip parece columna; el
panel se ve correctamente con `hidden` quitado a mano en DevTools, y SENDS/MASTER COMP/INSERTS se
ven igual que en la antigua pestaña.
**Riesgo:** bajo (CSS). El grid template ya reserva 140px para la última columna; el strip encaja
sin cambiar `_session-grid.scss:37`.

---

### Tarea 9 — e2e Playwright del master strip (contrato integrado)

> **Rebuild `dist/` antes:** `npm run build` (el e2e sirve `dist/` con `vite preview`, sin build).

**Archivos:** `tests/e2e/master-strip.spec.ts` *(nuevo)*.
**Qué hacer:** siguiendo el patrón de [tests/e2e/lane-ui.spec.ts](../../../tests/e2e/lane-ui.spec.ts)
(`page.goto('/')`, `waitForFunction(() => document.querySelectorAll('.session-cell-filled').length > 0)`):
1. **El master strip existe** al fondo del grid: `.master-strip` visible, con texto "MASTER".
2. **La pestaña Master FX ya no existe:** `expect(page.locator('button.tab[data-tab="fx"]')).toHaveCount(0)`.
3. **El botón FX despliega el panel:** `#master-fx-panel` empieza `hidden`; click en
   `.master-fx-toggle` ⇒ panel visible y contiene `#fx-reverb-knobs`, `#fx-master-comp-knobs`,
   `#fx-filters`; segundo click ⇒ se oculta de nuevo.
4. **Los knobs del Master FX siguen vivos:** al abrir, `#fx-master-comp-knobs .knob` count > 0.
5. **Sincronía fader↔`#volume`:** vía `page.evaluate`, fijar el fader del master a `0.3` +
   dispatch `input` ⇒ `#volume` vale `0.3`. Y al revés: fijar `#volume` a `0.7` + dispatch
   `input` ⇒ `.master-strip .mix-fader` vale `0.7`. (Confirma la corrección de persistencia/undo
   por delegación.)
6. **Regresión del mixer:** las `.mix-col` de lane conservan su VU; el master **no** se cuela como
   lane más (distinguir por `.master-strip`; el conteo de columnas-lane no lo incluye).
**Verificar:** `npm run build` && `npm run test:e2e` (o `npx playwright test
tests/e2e/master-strip.spec.ts`) → verde.
**Riesgo:** medio (e2e frágil si `dist/` está stale — por eso el rebuild explícito). Es el
contrato real de la reubicación.

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
    botón FX (acento visual aplicado).
  - Abrir/cerrar FX; ver SENDS / MASTER COMP / INSERTS bajo el grid+inspector.
  - Tocar reverb/delay/master-comp/inserts y confirmar que **afectan al sonido** igual que la
    antigua pestaña.
  - Mover el fader del master sube/baja el volumen; `#volume` se mantiene sincronizado en ambas
    direcciones.
  - **Guardar la sesión, recargar y cargar:** el nivel del master se conserva (persistencia vía
    `SavedStateV3.masterVol`). **Ctrl+Z** tras mover el fader revierte el gesto (undo de `#volume`).
  - Entrar en Performance: el strip desaparece pero `#volume` sigue controlando el master
    (restricción documentada).
- `gitnexus_detect_changes()` final: solo `buildMasterStrip`, `buildAudioGraph`/`AudioGraph`,
  `renderWithMixer`, `SessionHost` cambiaron.
**Verificar:** todo lo anterior verde + smoke OK.
**Riesgo:** nulo (verificación). Si algo falla, volver a la tarea correspondiente.

---

### Finalización de la rama

Cuando todo esté verde y el smoke confirmado:
- `git rebase main` (resolver conflictos si los hay; probablemente con A/B en el grid/transporte —
  el código de C es ortogonal y no toca la fila de transporte).
- `git merge --ff-only` sobre `main` (avance lineal, **sin** merge commit).
- `ExitWorktree`.
- Mover el spec implementado fuera del árbol según la convención del proyecto (los design docs
  implementados no se mantienen en el repo; recuperables por git). Actualizar
  [docs/superpowers/REMAINING-WORK.md](../REMAINING-WORK.md) si listaba este frente.

---

## Invariantes y notas de riesgo transversales

- **El audio del path de salida no cambia.** Única adición al grafo: el tap de medición
  `masterMeterAnalyser` (Tarea 2), no conectado a destination. `FxBus`/`MasterCompressor`/
  `InsertChain` y `wireFxUI` intactos.
- **El fader del master es proxy de `#volume`** (escribe `volInput.value` + dispara `input`).
  Nunca escribe `master.gain` a pelo ni bracketea undo propio — eso lo aporta `#volume`. Es lo
  que garantiza que save (`SavedStateV3.masterVol`) y undo (bracket de `#volume`) sigan
  funcionando. **No** se promueve `master.gain` al modelo (ya está persistido).
- **No se elimina `#volume`** (coordinación §5): es el control de master que sobrevive en
  Performance, donde `#session-view-root` (y el strip) se ocultan.
- **Conservar todos los ids `#fx-*`** al mover el markup (Tarea 1) — sostiene que `fx-ui.ts` no
  se toque.
- **Sin re-render completo en el toggle** (Tarea 5): solo `panel.hidden` + `.active`, con
  re-aplicación del flag en `renderWithMixer` para sobrevivir a los re-render por play-state.
- **Canal de teardown de VU** (Tarea 3) creado de cero: dispone los VU del render anterior antes
  de `innerHTML=''`. Corrige la fuga preexistente de las columnas de lane y evita que el master
  strip la agrave.
- **`historyDeps` no se captura por valor** en ningún deps nuevo: si algún punto lo necesitara,
  usar el patrón getter-lazy de `mixerDeps` ([main.ts:235-238](../../../src/main.ts)). (En la
  práctica el master strip no necesita `historyDeps`.)
- **GitNexus:** `gitnexus_impact` antes de editar `buildAudioGraph` y `renderWithMixer`;
  `gitnexus_detect_changes()` antes de cada commit. (El MCP indexa el repo principal, no el
  worktree: `detect_changes` puede no ver cambios desde el worktree — verificar con `git status`.)
- **Rebase frecuente sobre `main`** tras cada commit, especialmente tras la Tarea 6.
