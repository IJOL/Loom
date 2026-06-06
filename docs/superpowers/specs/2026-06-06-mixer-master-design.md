# Frente C · Mixer del master — spec de diseño

**Fecha:** 2026-06-06
**Frente:** C (de la revisión UX `2026-06-06-loom-ux-overhaul-overview.md`)
**Estado:** spec. Sigue a → plan → implementación (en worktree).
**Depende de:** nada bloqueante. Toca la misma fila de mixer y la columna de scenes
que el frente B reordena, pero los cambios son ortogonales (B reordena la cabecera/
transporte; C añade una columna de mixer del master). Conviene rebasar sobre B si B
aterriza antes, pero no hay acoplamiento de código.

---

## Objetivo

Dar al usuario un **strip del master** visible y permanente dentro del grid de
sesión —en la columna de **scenes**, al fondo, en la fila de mixer— y mover los
**Master FX** desde su pestaña separada ("Master FX", `data-tab="fx"`) a un **botón
en ese strip** que despliega los efectos del master **justo debajo**, en contexto.

Con esto:

- El master deja de estar escondido detrás de una pestaña que el usuario nunca
  encuentra; vive donde ya está el resto del mixer (la fila `session-row-mixer`).
- Los efectos del master (returns reverb/delay, master compressor, inserts) se
  controlan desde el mismo sitio donde se ve el nivel y el VU del master.

El audio **no cambia**: el grafo del master (`master → masterInsertChain →
masterComp → analyser → destination`, [src/app/audio-graph.ts:21-35](../../../src/app/audio-graph.ts))
y la UI que lo edita (`wireFxUI`, [src/core/fx-ui.ts:106-212](../../../src/core/fx-ui.ts))
ya existen. Esto es **reubicación + recableado de UI**, no DSP nuevo.

---

## Alcance

### Qué entra

1. **Columna del master en la fila de mixer.** Una nueva celda de mixer ("master
   strip") al final de `session-row-mixer`, ocupando la columna de scenes (la
   última, de 140px). Contiene:
   - Etiqueta **MASTER**.
   - **Fader de volumen del master** + **VU del master**, cableados al `master`
     GainNode (`master.gain`, hoy gobernado por `#volume`, [src/main.ts:269-270](../../../src/main.ts))
     y a un analizador del bus master.
   - Un **botón "FX"** (despliegue de los efectos del master).

2. **Despliegue de Master FX bajo el strip.** El botón "FX" del master abre/cierra
   un panel **debajo del grid** (no una pestaña) que aloja las tres secciones que
   hoy viven en `.page[data-page="fx"]`:
   - **SENDS** (returns reverb + delay del `FxBus`).
   - **MASTER COMP** (`MasterCompressor`).
   - **INSERTS** (cadena de inserts del master, `masterInsertChain`).

3. **Eliminación de la pestaña "Master FX".** Quitar el botón
   `<button class="tab" data-tab="fx">Master FX</button>` ([index.html:178](../../../index.html))
   del `.tab-bar`. El contenido de `.page[data-page="fx"]` se **reubica** (no se
   reescribe la lógica de `wireFxUI`): los mismos contenedores
   (`#fx-reverb-knobs`, `#fx-delay-knobs`, `#fx-master-comp-knobs`, `#fx-filters`)
   se montan dentro del panel desplegable, de modo que `wireFxUI` siga
   encontrándolos por id.

4. **Persistencia del estado abierto/cerrado del panel** dentro de la sesión de
   navegador (no en el `SessionState` guardado): un flag de UI en `SessionHost`
   (no serializado), igual de efímero que `activeEditLane`.

### Qué NO entra

- **No** se introduce un `ChannelStrip` para el master. El master es el destino del
  grafo; no tiene EQ propia, ni pan, ni mute/solo, ni sends salientes. La columna
  del master **NO** reutiliza `buildMixerColumn` ([src/core/mixer.ts:60](../../../src/core/mixer.ts))
  tal cual (ese builder asume un `ChannelStrip` con EQ/sends/pan/mute/solo). Se
  construye un builder específico, más simple (nombre + fader + VU + botón FX).
- **No** se añaden sends/EQ/pan al master. Las "sends" del master son los *returns*
  reverb/delay que ya existen como `FxBus`; se reubican, no se amplían.
- **No** se toca el DSP: ni `FxBus`, ni `MasterCompressor`, ni `InsertChain`, ni el
  cableado de `audio-graph.ts`. `wireFxUI` se reutiliza intacto.
- **No** se persiste el master volume en el `SessionState` (sigue siendo el control
  global `#volume`, fuera del modelo de sesión — coherente con hoy).
- **No** se aborda la cabecera/transporte (frente B), ni el sampler (D), ni los
  editores (E).
- **No** se elimina `#volume` de la fila de transporte en este frente (ver Dudas
  abiertas): el fader del master en el strip y `#volume` pueden coexistir
  controlando el mismo `master.gain`, o consolidarse — decisión del usuario.

---

## Diseño

### Arquitectura

El grid de sesión se construye en [src/session/session-ui.ts](../../../src/session/session-ui.ts)
(`renderSessionGrid`, DOM puro) y la fila de mixer se rellena en
[src/session/session-host.ts](../../../src/session/session-host.ts) (`renderWithMixer`,
líneas 483-498). El patrón actual:

- `renderSessionGrid` crea una `mixerRow` vacía y la expone vía
  `cb._mixerRow` ([session-ui.ts:113-116](../../../src/session/session-ui.ts)).
- `renderWithMixer` la limpia y la rellena con: un `session-spacer` (alineado bajo
  la columna de etiquetas de fila), **una `buildMixerColumn` por lane**, y un
  `session-spacer` final ([session-host.ts:486-497](../../../src/session/session-host.ts)).

Ese **spacer final** ocupa hoy la columna de scenes (la última columna de 140px del
grid template, [_session-grid.scss:36-40](../../../src/styles/_session-grid.scss)).
**Ahí va el strip del master.** El cambio mínimo y fiel al patrón es: en
`renderWithMixer`, sustituir el `sp2` final por una **celda de master strip** y
montar el panel de Master FX (colapsable) **debajo de la tabla del grid**.

```
session-row-mixer:
  [spacer] [mix-col lane1] [mix-col lane2] … [mix-col laneN] [MASTER STRIP]   ← columna de scenes
                                                              └ botón FX ─┐
  ──────────────────────────────────────────────────────────────────────┘
  [ panel Master FX desplegable: SENDS · MASTER COMP · INSERTS ]   ← bajo el grid, full-width
```

### Componentes

#### 1. `buildMasterStrip(deps)` — nuevo builder

Un builder propio (no reutiliza `buildMixerColumn` por la razón de Alcance), en un
módulo nuevo **`src/core/master-strip.ts`** (junto a `mixer.ts`, mismo subsistema).
Construye una columna `.mix-col.master-strip` con:

- **Nombre** `MASTER` (`.mix-name`, reutiliza el estilo existente).
- **Fader vertical + VU**, calcado del bloque fader de `buildMixerColumn`
  ([mixer.ts:158-194](../../../src/core/mixer.ts)) pero cableado a:
  - `setLevel`/`getLevel` = `master.gain.value` (rango 0..1.5 como las lanes, o
    0..1 — ver Dudas: alinear con el rango de `#volume`).
  - VU = `createLevelMeter({ analyser })` con un **analizador dedicado del master**.
- **Botón "FX"** (`.master-fx-toggle`): hace toggle de un flag de UI y re-renderiza
  el grid (o sólo el panel) para mostrar/ocultar el desplegable. Estado visual
  `.active` cuando está abierto.

`deps` (interfaz `MasterStripDeps`):
```
masterGain: GainNode            // el master bus (audio-graph master)
masterMeterAnalyser: AnalyserNode
historyDeps?: HistoryDeps       // para bracketear el fader como un gesto de undo
isFxOpen(): boolean
onToggleFx(): void
registerDisposable?(d): void    // VU meter teardown, igual que MixerColumnDeps
```

> Reutilizar el `analyser` existente de `audio-graph` (`fftSize=2048`,
> [audio-graph.ts:23-27](../../../src/app/audio-graph.ts)) es viable —
> `createLevelMeter` lee `analyser.fftSize` muestras
> ([level-meter.ts:194](../../../src/core/level-meter.ts)). Alternativa más limpia:
> añadir `masterMeterAnalyser` dedicado (`fftSize=512`, como los strips de lane)
> tapado de `masterComp.output`, para que el VU del master mida lo mismo que oye el
> usuario y con el mismo tamaño de buffer que el resto de VUs. **Recomendado:** un
> analyser dedicado del master (decisión menor, no de usuario).

#### 2. Panel desplegable de Master FX

El panel reutiliza **el contenido actual de `.page[data-page="fx"]`** y la lógica de
`wireFxUI` **sin cambios en `fx-ui.ts`**, porque `wireFxUI` localiza sus
contenedores por id (`getElementById('fx-reverb-knobs')`, etc.,
[fx-ui.ts:109-110,146,183](../../../src/core/fx-ui.ts)). Plan:

- En `index.html`, **sacar** el `<div class="page" data-page="fx">…</div>`
  ([index.html:272-303](../../../index.html)) de la zona de pages y convertirlo en
  un contenedor `#master-fx-panel` **dentro de `.session-view`**, después del
  `#session-grid` (o dentro de la fila de mixer como hijo full-width). Conserva
  **íntegros** los ids internos para que `wireFxUI` siga funcionando.
- El contenedor `#master-fx-panel` arranca con `hidden`; el botón FX del master lo
  alterna.
- `wireFxUI(fxUIDeps)` se sigue invocando una sola vez en boot
  ([main.ts:601](../../../src/main.ts)); como los ids siguen existiendo, los knobs
  del Master FX se montan igual. **No** se reconstruyen al abrir/cerrar (solo se
  muestra/oculta el contenedor) → cero coste de re-mount, cero pérdida de estado de
  knobs.

#### 3. Flag de apertura en `SessionHost`

Análogo a `activeEditLane` ([session-host.ts:165](../../../src/session/session-host.ts)):
un campo `masterFxOpen = false` (no serializado). `renderWithMixer` lee el flag al
construir el strip y aplica `hidden` al panel. El toggle:

```
onToggleMasterFx() { this.masterFxOpen = !this.masterFxOpen; <reflejar en DOM>; }
```

Para evitar reconstruir todo el grid en cada toggle (que perdería el scroll y haría
flicker), el toggle **solo** conmuta `panel.hidden` y la clase `.active` del botón —
no llama a `renderWithMixer`. El estado se re-aplica en `renderWithMixer` para que
los re-render por play-state (el `startRenderTick`,
[session-host.ts:1044-1057](../../../src/session/session-host.ts)) no lo pierdan.

### Flujo de datos

```
master.gain (audio-graph)  ──┐
                             ├─► buildMasterStrip ──► fader (input) → master.gain.value
masterMeterAnalyser ─────────┘                   └─► createLevelMeter (VU)

FxBus / MasterCompressor / masterInsertChain
   └─► wireFxUI (sin cambios) ──► #fx-* contenedores (ahora dentro de #master-fx-panel)

SessionHost.masterFxOpen (UI flag, no serializado)
   └─► botón FX toggle ──► #master-fx-panel.hidden
```

- **Master volume:** el fader escribe `master.gain.value` directamente, igual que
  `#volume` ([main.ts:269](../../../src/main.ts)). Si ambos coexisten, mantener
  sincronía: el `input` de `#volume` y el fader del master deben reflejar el mismo
  valor (un listener cruzado, o que el fader del strip emita un `input` sobre
  `#volume`). Ver Dudas abiertas.
- **Undo del fader:** se bracketea con `historyDeps.history.beginGesture/commitGesture`
  en `pointerdown/up` + `focus/blur`, copiando el patrón del fader de lane
  ([mixer.ts:170-179](../../../src/core/mixer.ts)). Nota: `master.gain` no está en el
  `SessionState`, así que el snapshot de undo del volumen master puede no capturarlo;
  si el snapshot de historia no incluye `master.gain`, el undo del fader del master
  no tendrá efecto (igual que hoy `#volume` no es undo-able). **No** introducir
  persistencia de master volume en este frente; bracketear solo si es trivial.

### UI

- **Posición:** última columna de la `session-row-mixer`, alineada bajo la columna
  de scenes (grid template `… 140px`,
  [_session-grid.scss:37](../../../src/styles/_session-grid.scss)). El strip ocupa
  esa columna; el `session-spacer` final se sustituye por él.
- **Estilo:** reutiliza `.mix-col` / `.mix-name` / `.mix-fader-wrap` /
  `.mix-fader` / `.mix-vu-host` de [_mixer.scss](../../../src/styles/_mixer.scss).
  Añadir `.master-strip` (acento distinto, p.ej. borde `--amber` reforzado) y
  `.master-fx-toggle` en un SCSS (ampliar `_mixer.scss` o `_session-grid.scss`).
- **Botón FX:** etiqueta `FX` o `⛭ FX`; `title="Master effects"`. Estado abierto =
  `.active`. Coherente con los botones `.rnd` del resto de la UI.
- **Panel desplegable:** full-width bajo el grid, con las tres secciones (SENDS /
  MASTER COMP / INSERTS) ya estilizadas por `.fx-zone` / `.poly-section`
  ([_fx.scss](../../../src/styles/_fx.scss), reutilizadas). Al moverlas fuera de
  `.page`, comprobar que esas reglas no dependían de `.page[data-page="fx"]` como
  ancestro (si dependen, generalizar el selector).

---

## Archivos a tocar

| Archivo | Cambio |
|---|---|
| **`index.html`** | **Quitar** la pestaña Master FX ([index.html:178](../../../index.html)). **Mover** el bloque `.page[data-page="fx"]` ([index.html:272-303](../../../index.html)) a un contenedor `#master-fx-panel` dentro de `.session-view` (tras `#session-grid`, [index.html:315-316](../../../index.html)), con `hidden` inicial. **Conservar todos los ids internos** (`#fx-reverb-knobs`, `#fx-delay-knobs`, `#fx-master-comp-knobs`, `#fx-add-filter`, `#fx-filters`). |
| **`src/core/master-strip.ts`** *(nuevo)* | `buildMasterStrip(deps: MasterStripDeps): HTMLElement`. Nombre + fader (→ `master.gain`) + VU (`createLevelMeter`) + botón FX (toggle). Espejo simplificado del bloque fader/VU de `mixer.ts`. |
| **`src/session/session-host.ts`** | Añadir campo `masterFxOpen = false` (junto a `activeEditLane`, [session-host.ts:165](../../../src/session/session-host.ts)). En `renderWithMixer` ([session-host.ts:483-498](../../../src/session/session-host.ts)): sustituir el `sp2` final ([:496-497](../../../src/session/session-host.ts)) por `buildMasterStrip(...)`; aplicar `masterFxOpen` al `#master-fx-panel`. Añadir método `toggleMasterFx()` (conmuta flag + `panel.hidden` + clase del botón, **sin** re-render completo). Nuevos `deps`: `masterGain: GainNode`, `masterMeterAnalyser: AnalyserNode` (o reusar `analyser`). |
| **`src/main.ts`** | Pasar `masterGain: master` y un `masterMeterAnalyser` (analyser dedicado tapado de `masterComp.output`, o el `analyser` existente) al constructor de `SessionHost` ([main.ts:372-428](../../../src/main.ts)). **Quitar** el handler del tab `data-tab="fx"` si quedaba acoplamiento (el bucle genérico [main.ts:349-355](../../../src/main.ts) deja de tener un tab `fx` que togglear — al no existir el botón, no hace nada, pero confirmar que ninguna otra cosa abre esa page). Mantener `wireFxUI(fxUIDeps)` ([main.ts:601](../../../src/main.ts)) y `sessionHost.onStateApplied(rebuildMasterInserts)` ([main.ts:604](../../../src/main.ts)) intactos. |
| **`src/session/session-ui.ts`** | *(Posible)* Si se prefiere que `renderSessionGrid` cree el slot del master strip en lugar de hacerlo en `renderWithMixer`: exponer el master-strip-cell en `cb` igual que `_mixerRow` ([session-ui.ts:113-116](../../../src/session/session-ui.ts)). **Recomendado mínimo:** dejar `session-ui.ts` intacto y construir el strip en `renderWithMixer` (la fila de mixer ya es responsabilidad del host). |
| **`src/styles/_mixer.scss`** *(o `_session-grid.scss`)* | Reglas `.master-strip`, `.master-fx-toggle`, `#master-fx-panel`. Verificar que `.fx-zone`/`.poly-section` ([_fx.scss](../../../src/styles/_fx.scss)) no requieren `.page[data-page="fx"]` como ancestro; generalizar si hace falta. |
| **`src/core/fx-ui.ts`** | **Sin cambios de lógica.** Sigue localizando contenedores por id. Solo confirmar que los ids existen en su nueva ubicación. (El botón estático `#fx-add-filter` se sigue ocultando, [fx-ui.ts:185-186](../../../src/core/fx-ui.ts).) |

> **Invariante de orden (Phase G):** `renderWithMixer` ya está diferido a
> `onStateApplied` ([session-host.ts:296-301](../../../src/session/session-host.ts))
> porque `stripFor` lanza si la lane no está allocada. El master strip **no** depende
> de `laneResources` (usa el `master` GainNode global), así que puede construirse
> siempre — pero como se construye dentro de `renderWithMixer`, hereda el mismo
> diferido sin esfuerzo.

---

## Plan de pruebas

### Unit (Vitest, `src/**/*.test.ts`)

1. **`src/core/master-strip.test.ts`** *(nuevo)* — `buildMasterStrip`:
   - Devuelve un `.mix-col.master-strip` con `.mix-name` = "MASTER".
   - El fader mueve `master.gain.value` (mock GainNode con `gain.value`):
     mover el `input` a 0.5 ⇒ `masterGain.gain.value === 0.5`.
   - El botón FX llama `onToggleFx` al click.
   - Registra el VU meter en `registerDisposable` (si se pasa).
   - Assertions **relativas** donde aplique (no magnitudes absolutas de audio aquí;
     es DOM/estado).

2. **`session-host`** — un test de `renderWithMixer` (si hay fixture sin audio que ya
   lo ejercite) que verifique que la fila de mixer termina con el master strip y que
   `toggleMasterFx()` alterna el flag. Reutilizar el patrón de fixtures existentes de
   `session-host` (deps opcionales permiten omitir audio).

### e2e (Playwright, `tests/e2e/`) — **rebuild `dist/` antes** (`npm run build`)

Nuevo **`tests/e2e/master-strip.spec.ts`**, siguiendo el patrón de
[tests/e2e/lane-ui.spec.ts](../../../tests/e2e/lane-ui.spec.ts) (`page.goto('/')`,
esperar a que el grid tenga clips: `waitForFunction(() =>
document.querySelectorAll('.session-cell-filled').length > 0)`):

1. **El master strip existe** al fondo del grid: `.master-strip` visible, con texto
   "MASTER".
2. **La pestaña Master FX ya no existe:** `button.tab[data-tab="fx"]` ausente
   (`expect(locator).toHaveCount(0)`).
3. **El botón FX despliega el panel:** `#master-fx-panel` empieza `hidden`; click en
   `.master-fx-toggle` ⇒ panel visible y contiene `#fx-reverb-knobs`,
   `#fx-master-comp-knobs`, `#fx-filters`; segundo click ⇒ vuelve a ocultarse.
4. **Los knobs del Master FX siguen vivos** tras el move: al abrir el panel, los
   contenedores tienen knobs montados (`.knob` count > 0 en `#fx-master-comp-knobs`),
   demostrando que `wireFxUI` los encontró por id en su nueva ubicación.
5. **El fader del master no rompe el resto del mixer:** las `.mix-col` de lane siguen
   con su VU y M/S (regresión: confirmar que la columna del master no se cuela como
   una lane más en el conteo de `.mix-col` de la fila — distinguir por `.master-strip`).
6. *(Opcional, sonido)* Mover el fader del master a 0 ⇒ `master.gain.value === 0`
   (vía `page.evaluate`), confirmando el cableado.

### Verificación manual (browser)

- Cargar `http://localhost:5173`, comprobar el strip del master al fondo de la
  columna de scenes, abrir/cerrar FX, tocar reverb/delay/comp/inserts y confirmar
  que afectan al sonido (igual que la antigua pestaña).
- `npx tsc --noEmit` y `npm run build` limpios.

---

## Dudas abiertas

> El frente D (Sampler & audio) **no** se decide aquí. Las decisiones pendientes que
> rozan este frente se listan explícitamente para que las resuelva el usuario; **no
> las cierro**.

### Decisiones de este frente (C) — pendientes del usuario

1. **Fader del master vs `#volume`:** ¿el fader del strip del master **sustituye** al
   control `#volume` de la fila de transporte (consolidación), o **coexisten**
   controlando el mismo `master.gain` (sincronizados)? Este frente asume coexistencia
   por defecto (cambio mínimo); eliminar `#volume` solaparía con el frente B (cabecera).
2. **Rango del fader del master:** ¿0..1.5 (como los faders de lane,
   [mixer.ts:167](../../../src/core/mixer.ts)) o 0..1 (como `#volume` hoy)? Afecta a
   poder "empujar" el master por encima de 0 dB.
3. **¿VU del master = analyser dedicado o el existente?** Recomendado dedicado
   (`fftSize=512` tapado de `masterComp.output`); es una decisión menor (no de
   usuario) salvo que se quiera reservar el `analyser` 2048 solo para el visualizer.
4. **Posición exacta del panel desplegable:** ¿full-width bajo el grid (recomendado)
   o como popover/acordeón pegado al strip? El full-width reaprovecha el layout de
   `.fx-zone` sin reflow del grid.
5. **¿El master strip necesita botón de undo/bracket en su fader?** El master volume
   no está en el `SessionState`, así que el undo no tendría snapshot que restaurar
   (igual que hoy `#volume`). ¿Se deja sin undo, o se promueve `master.gain` al
   modelo persistido? Lo segundo amplía alcance.

### Decisiones que NO son de este frente (las decide el usuario en su frente)

- **Frente D · Sampler & audio** (del índice maestro, "Dudas abiertas"): `loop`/
  `loopStart` per-pad; cabecera waveform (BPM·bar·Warp·Slice); edición del audio lane
  (trim + warp); waveform tras el piano-roll. **No tocadas aquí.**
- **Frente B · cabecera/transporte:** la consolidación de `#volume` y la reordenación
  de filas de la cabecera son del frente B; este spec solo añade un fader del master
  en el grid y, si B decide quitar `#volume`, ambos frentes deben coordinar para no
  dejar el `master.gain` sin control.
