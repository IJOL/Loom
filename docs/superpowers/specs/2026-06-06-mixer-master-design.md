# Frente C · Mixer del master — spec de diseño

**Fecha:** 2026-06-06
**Frente:** C (de la revisión UX `2026-06-06-loom-ux-overhaul-overview.md`)
**Estado:** spec corregido tras revisión adversarial + coordinación transversal
(`2026-06-06-coordinacion-frentes.md`). Sigue a → plan → implementación (en worktree).
**Depende de:** nada bloqueante. Por el **orden global** del documento de coordinación
(§6), C se ejecuta **después de A** y antes/paralelo a D, pero su código es
ortogonal: A toca la inserción de clips y `deleteScene`; C añade una columna de
mixer del master y reubica el panel FX. La única superficie compartida con B es la
**fila de transporte** donde vive `#volume` — y este frente **NO la toca** (ver §5
de coordinación: `#volume` se conserva).

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

## Hechos verificados contra el código (correcciones de la revisión)

La revisión adversarial cazó varias premisas FALSAS del spec anterior. Verificadas
contra el árbol real y corregidas aquí:

1. **El master volume SÍ se persiste y SÍ es undo-able.** [src/save/saved-state-v3.ts:73](../../../src/save/saved-state-v3.ts)
   guarda `masterVol: parseFloat(volInput.value)` en el snapshot `SavedStateV3`, y
   [:97](../../../src/save/saved-state-v3.ts) lo restaura (`master.gain.value = s.masterVol;
   volInput.value = String(s.masterVol)`). El snapshot `SavedStateV3` es exactamente
   lo que usa el historial; y `#volume` **ya está bracketeado para undo**
   ([src/main.ts:276-289](../../../src/main.ts): `pointerdown/up` + `focus/blur` sobre
   `volInput` abren/cierran un gesto). **Consecuencia de diseño:** no hay que
   "promover `master.gain` al modelo persistido" (no amplía alcance, ya está hecho).
2. **El snapshot lee `volInput.value`, NO `master.gain.value`.** Por tanto el fader
   del master strip **debe escribir `volInput.value`** (no `master.gain` a pelo) y
   disparar el evento `input` de `#volume`. De lo contrario, al guardar se
   persistiría el valor viejo de `volInput`, y un undo del fader restauraría desde un
   snapshot que tomó `volInput.value`. La sincronía fader↔`#volume` **no es una duda
   de UX: es un requisito de corrección de save/undo.**
3. **`#volume` sobrevive en modo Performance; el master strip NO.** `.session-view`
   (donde van el strip y el panel FX) vive dentro de `#session-view-root`, que se
   oculta al entrar en Performance ([src/app/performance-feature.ts:191](../../../src/app/performance-feature.ts):
   `sessionRoot.hidden = next !== 'session'`). `#volume` está en la fila de transporte
   global ([index.html:107](../../../index.html)), FUERA de ese root. Por eso `#volume`
   **no se elimina** (es el único control de master en Performance) y el VU del master
   desaparece en Performance (limitación aceptada de este alcance).
4. **El entorno de vitest es `node`, no jsdom.** [vitest.config.ts:5](../../../vitest.config.ts)
   declara `environment: 'node'` y [test/setup.ts](../../../test/setup.ts) NO globaliza
   `document`. Un test que construye DOM real (`createElement`/`addEventListener`/
   `dispatchEvent`) requiere la directiva por-archivo `// @vitest-environment jsdom`
   (como [src/core/lane-fx-panel.test.ts:1](../../../src/core/lane-fx-panel.test.ts)),
   NO el stub trivial de `session-host-active-lane.test.ts`.
5. **No existe un "canal `registerDisposable`" en `mixerDeps`.** [src/main.ts:220-239](../../../src/main.ts)
   (`mixerDeps`) NO incluye `registerDisposable`; las `MixerColumn` de lane crean su VU
   meter sin registrar disposal, y cada `renderWithMixer` hace `row.innerHTML = ''`
   y reconstruye sin disponer los anteriores ([src/session/session-host.ts:488](../../../src/session/session-host.ts)),
   invocándose en cada cambio de play-state vía `startRenderTick`. **Ya existe una fuga
   de VU/RAF**; añadir el master strip la amplificaría con otro VU más. Este frente
   **crea el canal de teardown** y registra todos los VU (incluidos los de lane), no se
   limita a asumir uno inexistente.
6. **`historyDeps` se asigna DESPUÉS de la construcción.** `mixerDeps` accede a
   `_discreteHistoryDeps` vía **getter lazy** (`get historyDeps()`,
   [src/main.ts:235-238](../../../src/main.ts)) porque `_discreteHistoryDeps` se
   asigna tras el boot. Cualquier `deps` del master strip que necesite `historyDeps`
   debe hacerlo igual (getter lazy), no capturarlo como valor en build-time.
   **No obstante**, al delegar el fader del master en `volInput` (punto 2), el bracket
   de undo lo aporta el handler YA existente de `#volume` — el master strip **no
   necesita bracketear nada por su cuenta**.

---

## Alcance

### Qué entra

1. **Columna del master en la fila de mixer.** Una nueva celda de mixer ("master
   strip") al final de `session-row-mixer`, ocupando la columna de scenes (la
   última, de 140px). Contiene:
   - Etiqueta **MASTER**.
   - **Fader de volumen del master** + **VU del master**. El fader es **un proxy de
     `#volume`**: escribe `volInput.value` y dispara el evento `input` de `#volume`
     (que ya escribe `master.gain.value` y participa del bracket de undo). Rango
     `0..1` para casar exactamente con `#volume` ([index.html:107](../../../index.html)).
   - Un **botón "FX"** (despliegue de los efectos del master).

2. **Despliegue de Master FX bajo el grid.** El botón "FX" del master abre/cierra
   un panel **debajo del grid** (no una pestaña) que aloja las tres secciones que
   hoy viven en `.page[data-page="fx"]`:
   - **SENDS** (returns reverb + delay del `FxBus`).
   - **MASTER COMP** (`MasterCompressor`).
   - **INSERTS** (cadena de inserts del master, `masterInsertChain`).

3. **Eliminación de la pestaña "Master FX".** Quitar el botón
   `<button class="tab" data-tab="fx">Master FX</button>` ([index.html:178](../../../index.html))
   del `.tab-bar`. El contenido de `.page[data-page="fx"]` se **reubica** (no se
   reescribe la lógica de `wireFxUI`): los mismos contenedores
   (`#fx-reverb-knobs`, `#fx-delay-knobs`, `#fx-master-comp-knobs`, `#fx-filters`,
   `#fx-add-filter`) se montan dentro del panel desplegable, de modo que `wireFxUI`
   siga encontrándolos por id.

4. **Canal de teardown de VU meters (`registerDisposable`).** Crear el mecanismo que
   hoy NO existe: añadir `registerDisposable` a `mixerDeps` y a `MasterStripDeps`,
   y que `renderWithMixer` disponga los VU del render anterior antes de hacer
   `innerHTML = ''`. Esto corrige la fuga existente de VU/RAF de las columnas de lane
   y evita que el master strip la agrave (punto 5 de Hechos verificados).

5. **Persistencia del estado abierto/cerrado del panel** dentro de la sesión de
   navegador (no en el `SessionState` guardado): un flag de UI en `SessionHost`
   (no serializado), igual de efímero que `activeEditLane`.

6. **Ajuste del pipeline del manual.** [tools/manual/shot-list.mjs:96-98](../../../tools/manual/shot-list.mjs)
   captura `master-fx` clicando `.tab[data-tab="fx"]` y esperando `.page[data-page="fx"]`.
   Al desaparecer ambos selectores, esa captura del manual rompe. Actualizar el
   `setup` de esa shot para abrir el panel vía `.master-fx-toggle` y esperar a
   `#master-fx-panel` visible. (El spec anterior solo grepeaba `src/` e `index.html`
   y omitía `tools/`.)

### Qué NO entra

- **No** se introduce un `ChannelStrip` para el master. El master es el destino del
  grafo; no tiene EQ propia, ni pan, ni mute/solo, ni sends salientes. La columna
  del master **NO** reutiliza `buildMixerColumn` ([src/core/mixer.ts:60](../../../src/core/mixer.ts))
  tal cual (ese builder asume un `ChannelStrip` con EQ/sends/pan/mute/solo). Se
  construye un builder específico, más simple (nombre + fader + VU + botón FX).
- **No** se añaden sends/EQ/pan al master. Las "sends" del master son los *returns*
  reverb/delay que ya existen como `FxBus`; se reubican, no se amplían.
- **No** se toca el DSP del path de salida: ni `FxBus`, ni `MasterCompressor`, ni
  `InsertChain`, ni el cableado de salida de `audio-graph.ts`. La ÚNICA adición al
  grafo es un **tap de medición** (`masterMeterAnalyser` para el VU, sin conectar a
  destination). `wireFxUI` se reutiliza intacto.
- **No** se promueve el master volume a un campo nuevo del modelo: **ya se persiste**
  (`SavedStateV3.masterVol`, ver Hechos verificados #1). No hay ampliación de alcance.
- **No** se elimina `#volume` de la fila de transporte (decisión fijada en
  coordinación §5: es el control de master que sobrevive en Performance). El fader
  del master strip y `#volume` **coexisten sincronizados** controlando el mismo
  `master.gain` a través del mismo handler.
- **No** se aborda la cabecera/transporte (frente B), ni el sampler (D), ni los
  editores (E).

---

## Diseño

### Arquitectura

El grid de sesión se construye en [src/session/session-ui.ts](../../../src/session/session-ui.ts)
(`renderSessionGrid`, DOM puro) y la fila de mixer se rellena en
[src/session/session-host.ts](../../../src/session/session-host.ts) (`renderWithMixer`,
líneas 483-498). El patrón actual:

- `renderSessionGrid` crea una `mixerRow` vacía y la expone vía
  `cb._mixerRow` ([session-ui.ts:113-116](../../../src/session/session-ui.ts)).
- `renderWithMixer` la limpia (`row.innerHTML = ''`) y la rellena con: un
  `session-spacer` (alineado bajo la columna de etiquetas de fila), **una
  `buildMixerColumn` por lane**, y un `session-spacer` final
  ([session-host.ts:486-497](../../../src/session/session-host.ts)).

Ese **spacer final** ocupa la columna de scenes (la última columna de 140px del
grid template, [_session-grid.scss:36-40](../../../src/styles/_session-grid.scss))
**en la fila de mixer**. Importante (corrige nota de revisión): la columna de scenes
aloja contenido distinto en CADA fila — `scenesHeader` en la cabecera, los botones
▶ de scene-launch en las filas de clips, y `session-stop-all` en la **fila stop**
(`session-row-stop`, [session-ui.ts:95-111](../../../src/session/session-ui.ts)).
En la **fila de mixer** la última columna es hoy un spacer puro, así que el master
strip NO colisiona con `session-stop-all` (vive en otra fila). **Ahí va el strip
del master.** El cambio mínimo y fiel al patrón es: en `renderWithMixer`, sustituir
el `sp2` final por una **celda de master strip** y montar el panel de Master FX
(colapsable) **bajo la `.session-view`**.

```
session-row-mixer:
  [spacer] [mix-col lane1] [mix-col lane2] … [mix-col laneN] [MASTER STRIP]   ← columna de scenes
                                                              └ botón FX ─┐
  ──────────────────────────────────────────────────────────────────────┘
  [ panel Master FX desplegable: SENDS · MASTER COMP · INSERTS ]   ← bajo el grid+inspector, full-width
```

### Componentes

#### 1. `buildMasterStrip(deps)` — nuevo builder

Un builder propio (no reutiliza `buildMixerColumn` por la razón de Alcance), en un
módulo nuevo **`src/core/master-strip.ts`** (junto a `mixer.ts`, mismo subsistema).
Construye una columna `.mix-col.master-strip` con:

- **Nombre** `MASTER` (`.mix-name`, reutiliza el estilo existente).
- **Fader vertical + VU**, calcado del bloque fader de `buildMixerColumn`
  ([mixer.ts:158-194](../../../src/core/mixer.ts)) pero cableado como **proxy de
  `#volume`**:
  - `min=0 max=1 step=0.01` (idéntico a `#volume`, [index.html:107](../../../index.html)).
  - Valor inicial = `volInput.value`.
  - En `input`: `deps.volInput.value = fader.value;
    deps.volInput.dispatchEvent(new Event('input'))`. Esto reaprovecha el handler
    de `#volume` ([main.ts:269](../../../src/main.ts): escribe `master.gain.value`) y
    su bracket de undo ([main.ts:276-289](../../../src/main.ts)). El fader **no
    escribe `master.gain` directamente ni bracketea por su cuenta** — delega.
  - VU = `createLevelMeter({ analyser: deps.masterMeterAnalyser })`; el handle se
    registra en `deps.registerDisposable` si se pasa (teardown del RAF/analyser).
- **Botón "FX"** (`.master-fx-toggle`): hace toggle de un flag de UI vía
  `deps.onToggleFx()`. Estado visual `.active` reflejando `deps.isFxOpen()` al
  construir.
- **Sincronía inversa (`#volume` → fader):** el handler de `#volume` debe actualizar
  el `.value` del fader del master cuando cambie por otra vía (teclado en `#volume`,
  load de sesión, undo). Como `renderWithMixer` reconstruye el strip a menudo y lee
  `volInput.value` al construir, el fader nace sincronizado en cada render; para los
  cambios entre renders, `main.ts` actualiza el fader del strip desde el handler de
  `#volume` si está montado (selector `.master-strip .mix-fader`). Detalle de
  cableado en el plan.

`deps` (interfaz `MasterStripDeps`):
```ts
export interface MasterStripDeps {
  volInput: HTMLInputElement;        // #volume — el fader es su proxy (persistencia/undo)
  masterMeterAnalyser: AnalyserNode; // tap de medición del master (VU)
  isFxOpen(): boolean;
  onToggleFx(): void;
  registerDisposable?(d: { dispose(): void }): void; // teardown del VU meter
}
export function buildMasterStrip(deps: MasterStripDeps): HTMLElement;
```

> Nota: la interfaz **NO** recibe `masterGain: GainNode` (el spec anterior sí, y era
> el origen del bug de save/undo). Recibe `volInput` para que la escritura pase por
> el control que el snapshot persiste. Tampoco recibe `historyDeps`: el bracket lo
> aporta `#volume`.

##### VU del master: analyser dedicado

Añadir un `masterMeterAnalyser = ctx.createAnalyser()` con `fftSize = 512` en
`buildAudioGraph` ([audio-graph.ts:21-35](../../../src/app/audio-graph.ts)), tapado de
`masterComp.output` (`masterComp.output.connect(masterMeterAnalyser)`) y **sin**
conectarlo a `destination` (es solo medición, igual que los analysers de strip).
Con `fftSize=512` el VU mide con el mismo tamaño de buffer que el resto de VUs de
lane y deja el `analyser` 2048 reservado para el visualizer. Es una decisión técnica
menor (aditiva, sin re-cableado del path de salida), no una duda de usuario.

#### 2. Panel desplegable de Master FX

El panel reutiliza **el contenido actual de `.page[data-page="fx"]`** y la lógica de
`wireFxUI` **sin cambios en `fx-ui.ts`**, porque `wireFxUI` localiza sus
contenedores por id (`getElementById('fx-reverb-knobs')`, etc.,
[fx-ui.ts:109-110,146,183](../../../src/core/fx-ui.ts)). Plan:

- En `index.html`, **sacar** el `<div class="page" data-page="fx">…</div>`
  ([index.html:272-303](../../../index.html)) de la zona de pages y convertirlo en
  un contenedor `#master-fx-panel` **dentro de `.session-view`**, **después del
  `#session-inspector`** ([index.html:317](../../../index.html)) — NO entre
  `#session-grid` e inspector (eso lo intercalaría; corrige nota de revisión).
  Conserva **íntegros** los ids internos para que `wireFxUI` siga funcionando.
- El contenedor `#master-fx-panel` arranca con `hidden`. **Atención (corrige nota de
  revisión):** la regla `.page[hidden] { display: none !important; }`
  ([_tabs.scss:33](../../../src/styles/_tabs.scss)) ya NO aplica al sacar el bloque de
  `.page`. El atributo `hidden` nativo da `display:none` por defecto, pero para
  robustez se añade una regla explícita `#master-fx-panel[hidden] { display: none; }`
  en el SCSS del frente.
- `wireFxUI(fxUIDeps)` se sigue invocando una sola vez en boot
  ([main.ts:601](../../../src/main.ts)); como los ids siguen existiendo, los knobs
  del Master FX se montan igual. **No** se reconstruyen al abrir/cerrar (solo se
  muestra/oculta el contenedor) → cero coste de re-mount, cero pérdida de estado de
  knobs.

#### 3. Flag de apertura en `SessionHost`

Análogo a `activeEditLane` ([session-host.ts:165](../../../src/session/session-host.ts)):
un campo `masterFxOpen = false` (no serializado). El toggle:

```ts
toggleMasterFx() { this.masterFxOpen = !this.masterFxOpen; <reflejar en DOM>; }
```

Para evitar reconstruir todo el grid en cada toggle (que perdería el scroll y haría
flicker), el toggle **solo** conmuta `#master-fx-panel.hidden` y la clase `.active`
del botón — no llama a `renderWithMixer`. El estado se re-aplica en `renderWithMixer`
para que los re-render por play-state (`startRenderTick`,
[session-host.ts:1044-1057](../../../src/session/session-host.ts)) no lo pierdan.

#### 4. Canal de teardown de VU meters

`createLevelMeter` registra un RAF y retiene el analyser; su handle expone
`dispose()`. Hoy nadie lo dispone porque `mixerDeps` no provee `registerDisposable`
y `renderWithMixer` hace `innerHTML = ''` sin teardown. Diseño:

- `SessionHost` mantiene una lista `private mixerDisposables: { dispose(): void }[] = []`.
- Antes de `row.innerHTML = ''` en `renderWithMixer`, disponer y vaciar esa lista.
- `mixerDeps.registerDisposable` y `MasterStripDeps.registerDisposable` empujan a esa
  lista, de modo que tanto las columnas de lane como el master strip se limpian en
  cada re-render. Resultado: la fuga preexistente queda corregida y el master strip
  no la agrava.

### Flujo de datos

```
#volume (transporte) ──input handler── master.gain.value  +  bracket undo (main.ts:269,276-289)
        ▲   │
        │   └─► (al cambiar por teclado/load/undo) actualiza .master-strip .mix-fader
        │
   master-strip fader ──escribe volInput.value + dispatch 'input'──┘  (proxy; NO toca master.gain a pelo)

masterMeterAnalyser (tap fftSize=512 de masterComp.output, sin destination)
        └─► createLevelMeter (VU)  ── handle ──► registerDisposable (teardown en cada render)

FxBus / MasterCompressor / masterInsertChain
        └─► wireFxUI (sin cambios) ──► #fx-* contenedores (ahora dentro de #master-fx-panel)

SessionHost.masterFxOpen (UI flag, no serializado)
        └─► botón FX toggle ──► #master-fx-panel.hidden
```

- **Persistencia/undo del master volume:** automáticos y correctos por delegación. El
  fader escribe `volInput.value`; el snapshot `SavedStateV3` guarda
  `masterVol: parseFloat(volInput.value)` ([saved-state-v3.ts:73](../../../src/save/saved-state-v3.ts))
  y el undo de `#volume` ya está bracketeado ([main.ts:276-289](../../../src/main.ts)).
  El master strip **no introduce ninguna persistencia ni bracket nuevos**.

### UI

- **Posición:** última columna de la `session-row-mixer`, alineada bajo la columna
  de scenes (grid template `… 140px`,
  [_session-grid.scss:37](../../../src/styles/_session-grid.scss)). El strip ocupa
  esa columna; el `session-spacer` final se sustituye por él.
- **Estilo:** reutiliza `.mix-col` / `.mix-name` / `.mix-fader-wrap` /
  `.mix-fader` / `.mix-vu-host` de [_mixer.scss](../../../src/styles/_mixer.scss).
  Añadir `.master-strip` (acento distinto, p.ej. borde `--amber` reforzado),
  `.master-fx-toggle` y `#master-fx-panel` + `#master-fx-panel[hidden]` en un SCSS
  (ampliar `_mixer.scss` o `_session-grid.scss`).
- **Botón FX:** etiqueta `FX` o `⛭ FX`; `title="Master effects"`. Estado abierto =
  `.active`. Coherente con los botones `.rnd` del resto de la UI.
- **Panel desplegable:** full-width bajo el grid+inspector, con las tres secciones
  (SENDS / MASTER COMP / INSERTS) ya estilizadas por `.fx-zone` / `.poly-section`
  ([_fx.scss](../../../src/styles/_fx.scss), reutilizadas). Al moverlas fuera de
  `.page`, comprobar que esas reglas no dependían de `.page[data-page="fx"]` como
  ancestro (si dependen, generalizar el selector) y añadir la regla `[hidden]`
  explícita del panel.

### Restricción de Performance (documentada, no es duda)

En modo Performance, `#session-view-root` se oculta
([performance-feature.ts:191](../../../src/app/performance-feature.ts)) y con él el
master strip, su VU y el botón FX. El control de master que sobrevive es `#volume`
(en la fila de transporte, fuera del root). Por eso `#volume` NO se elimina. El VU
del master no se duplica en la fila de transporte en este alcance — es una limitación
aceptada.

---

## Archivos a tocar

| Archivo | Cambio |
|---|---|
| **`src/app/audio-graph.ts`** | Añadir `masterMeterAnalyser` (`createAnalyser`, `fftSize=512`, tapado de `masterComp.output`, **sin** conectar a `destination`) a la interfaz `AudioGraph` y al objeto devuelto. Aditivo; el offline render reusa `buildAudioGraph` (el tap es inocuo allí). |
| **`index.html`** | **Quitar** la pestaña Master FX ([index.html:178](../../../index.html)). **Mover** el bloque `.page[data-page="fx"]` ([index.html:272-303](../../../index.html)) a un contenedor `#master-fx-panel` dentro de `.session-view`, **tras `#session-inspector`** (no entre grid e inspector), con `hidden` inicial. **Conservar todos los ids internos** (`#fx-reverb-knobs`, `#fx-delay-knobs`, `#fx-master-comp-knobs`, `#fx-add-filter`, `#fx-filters`). |
| **`src/core/master-strip.ts`** *(nuevo)* | `buildMasterStrip(deps: MasterStripDeps): HTMLElement`. Nombre + fader (proxy de `volInput`, rango 0..1) + VU (`createLevelMeter` con `masterMeterAnalyser`, registrado en `registerDisposable`) + botón FX (`onToggleFx`/`isFxOpen`). Espejo simplificado del bloque fader/VU de `mixer.ts`, **sin** escribir `master.gain` ni bracketear undo (lo delega a `#volume`). |
| **`src/session/session-host.ts`** | Añadir campo `masterFxOpen = false` (junto a `activeEditLane`, [session-host.ts:165](../../../src/session/session-host.ts)) y `private mixerDisposables`. En `renderWithMixer` ([session-host.ts:483-498](../../../src/session/session-host.ts)): disponer `mixerDisposables` antes de `innerHTML=''`; sustituir el `sp2` final por `buildMasterStrip(...)` (con fallback al spacer si faltan deps de audio); re-aplicar `masterFxOpen` al `#master-fx-panel`. Añadir método `toggleMasterFx()` (conmuta flag + `panel.hidden` + clase del botón, **sin** re-render completo). Nuevos `deps`: `volInput`, `masterMeterAnalyser`, `registerDisposable` (canal). |
| **`src/main.ts`** | Desestructurar `masterMeterAnalyser` del audio-graph. Pasar `volInput` (el `#volume` existente), `masterMeterAnalyser` y un `registerDisposable` (que empuja a `mixerDisposables`) al constructor de `SessionHost` ([main.ts:372-428](../../../src/main.ts)). Añadir `registerDisposable` a `mixerDeps` ([main.ts:220-239](../../../src/main.ts)) usando el mismo canal. En el handler `input` de `#volume` ([main.ts:269](../../../src/main.ts)), actualizar el `.value` del fader del master si está montado (`document.querySelector('.master-strip .mix-fader')`). Mantener `wireFxUI(fxUIDeps)` ([main.ts:601](../../../src/main.ts)) y `sessionHost.onStateApplied(rebuildMasterInserts)` ([main.ts:604](../../../src/main.ts)) intactos. |
| **`src/styles/_mixer.scss`** *(o `_session-grid.scss`)* | Reglas `.master-strip`, `.master-fx-toggle`, `#master-fx-panel` y `#master-fx-panel[hidden] { display: none; }`. Verificar que `.fx-zone`/`.poly-section` ([_fx.scss](../../../src/styles/_fx.scss)) no requieren `.page[data-page="fx"]` como ancestro; generalizar si hace falta. |
| **`tools/manual/shot-list.mjs`** | Actualizar la shot `master-fx` ([:96-98](../../../tools/manual/shot-list.mjs)): el `selector`/`setup` ya no pueden usar `.tab[data-tab="fx"]` / `.page[data-page="fx"]`. Abrir vía `.master-fx-toggle` y esperar `#master-fx-panel` visible; capturar `#master-fx-panel`. |
| **`src/core/fx-ui.ts`** | **Sin cambios de lógica.** Sigue localizando contenedores por id. Solo confirmar que los ids existen en su nueva ubicación. (El botón estático `#fx-add-filter` se sigue ocultando, [fx-ui.ts:185-186](../../../src/core/fx-ui.ts).) |

> **Invariante de orden (Phase G):** `renderWithMixer` ya está diferido a
> `onStateApplied` ([session-host.ts:296-301](../../../src/session/session-host.ts))
> porque `stripFor` lanza si la lane no está allocada. El master strip **no** depende
> de `laneResources` (usa `volInput` global + el tap del master), así que puede
> construirse siempre — y como se construye dentro de `renderWithMixer`, hereda el
> mismo diferido sin esfuerzo.

---

## Plan de pruebas

### Unit (Vitest, `src/**/*.test.ts`)

1. **`src/core/master-strip.test.ts`** *(nuevo, con `// @vitest-environment jsdom`
   en la primera línea — vitest es `node` por defecto)* — `buildMasterStrip`:
   - Devuelve un `.mix-col.master-strip` con `.mix-name` = "MASTER".
   - El fader **proxy de `volInput`**: con un `volInput` real (jsdom) y un spy en su
     evento `input`, tras `fader.value = '0.5'` + dispatch `input` ⇒
     `volInput.value === '0.5'` y se disparó un evento `input` sobre `volInput`. (No
     se mockea `master.gain`: el contrato es que el fader escribe `volInput`, no el
     gain.)
   - El fader tiene `min='0' max='1'` (casa con `#volume`).
   - El botón FX (`.master-fx-toggle`) llama `onToggleFx` al click y refleja
     `isFxOpen()` en la clase `.active` al construir.
   - Si se pasa `registerDisposable`, registra el handle del VU meter (≥1 llamada con
     un objeto `{ dispose }`). Mock del analyser con `fftSize: 512` y
     `getFloatTimeDomainData` no-op para que `createLevelMeter` no pete.
   - Assertions **estructurales/relativas** (DOM/estado), no magnitudes de audio.

2. **`session-host`** *(extender un fixture existente o nuevo
   `session-host-master-fx.test.ts`)* — verificar que `masterFxOpen === false` por
   defecto y que `toggleMasterFx()` alterna el flag `false→true→false`. El efecto DOM
   (`#master-fx-panel.hidden`) se cubre en e2e; el unit verifica solo el flag (el stub
   de `getElementById` devuelve `null`, no acoplar al DOM aquí).

### e2e (Playwright, `tests/e2e/`) — **rebuild `dist/` antes** (`npm run build`)

Nuevo **`tests/e2e/master-strip.spec.ts`**, siguiendo el patrón de
[tests/e2e/lane-ui.spec.ts](../../../tests/e2e/lane-ui.spec.ts):

1. **El master strip existe** al fondo del grid: `.master-strip` visible, con texto
   "MASTER".
2. **La pestaña Master FX ya no existe:** `expect(page.locator('button.tab[data-tab="fx"]')).toHaveCount(0)`.
3. **El botón FX despliega el panel:** `#master-fx-panel` empieza `hidden`; click en
   `.master-fx-toggle` ⇒ panel visible y contiene `#fx-reverb-knobs`,
   `#fx-master-comp-knobs`, `#fx-filters`; segundo click ⇒ vuelve a ocultarse.
4. **Los knobs del Master FX siguen vivos** tras el move: al abrir, `#fx-master-comp-knobs
   .knob` count > 0 (prueba que `wireFxUI` los encontró por id en su nueva ubicación).
5. **El fader del master sincroniza con `#volume`:** `page.evaluate` mueve el fader del
   master a `0.3` y dispara `input` ⇒ `#volume` vale `0.3` y `master.gain.value ≈ 0.3`
   (vía un hook accesible o leyendo `#volume`). Y viceversa: mover `#volume` refleja el
   fader del master. Confirma la corrección de persistencia/undo por delegación.
6. **Regresión del mixer:** las `.mix-col` de lane conservan su VU y M/S; el master
   **no** se cuela como una lane más (distinguir por `.master-strip`).

### Verificación manual (browser)

- Cargar `http://localhost:5173`, comprobar el strip del master al fondo de la
  columna de scenes, abrir/cerrar FX, tocar reverb/delay/comp/inserts y confirmar
  que afectan al sonido (igual que la antigua pestaña).
- Mover el fader del master sube/baja el volumen y mantiene `#volume` sincronizado;
  guardar y recargar conserva el nivel; Ctrl+Z revierte el gesto del fader.
- Entrar en Performance: el strip desaparece pero `#volume` sigue controlando el
  master (restricción documentada).
- `npx tsc --noEmit` y `npm run build` limpios.

---

## Dudas reales (legítimas, del usuario)

> Las "dudas" del spec anterior que la revisión demostró mal planteadas se han
> CERRADO (no son dudas): persistencia/undo del master volume (ya existe), rango del
> fader (0..1 por coordinación con `#volume`), `#volume` vs fader (coexisten,
> decisión de coordinación §5), VU dedicado vs reusado (dedicado, decisión técnica
> menor), posición del panel (full-width bajo grid+inspector). Quedan solo estas
> decisiones genuinas del usuario:

1. **Acento visual del master strip.** ¿Borde `--amber` reforzado, un fondo distinto,
   o un tratamiento más marcado para separarlo visualmente de una lane? Es estético;
   no afecta a la corrección.
2. **¿Botón FX como icono (`⛭ FX`) o texto (`FX`)?** Coherencia con el lenguaje de
   iconos del resto de la UI; trivial, decisión de gusto.

(El mapeo de rango si en el futuro se quisiera un master >0 dB —ampliar `#volume` a
`max=1.5` vs clamp— se deja FUERA de alcance: hoy `#volume` es 0..1 y el fader lo
replica; cambiarlo tocaría la fila de transporte, que es del frente B.)
