# Performance view — Lanes de automatización dibujables (con editor + zoom)

**Date:** 2026-05-31
**Status:** Approved (brainstorm complete) — pendiente de revisión del spec
**Branch:** `feat/perf-automation-lanes`
**Scope:** Hacer la automatización de la Performance view **autorable a mano**: poder fijar la longitud de un performance en compases, **crear lanes de automatización** para cualquier parámetro, **dibujarlas** con un editor (reutilizando el painter existente) y **navegar con zoom** continuo sobre toda la timeline. Sin necesidad de grabar.

Es el **Spec 1** de un par secuenciado. El **Spec 2** (limpieza completa del sustrato Classic `seq.pattern`, incluido el tab "Automation" global) es posterior y separado, y queda **gated** a que este Spec 1 esté implementado (ver §12 y la memoria `project_classic_pattern_removal_deferred`).

---

## 1. Goal & Non-goals

**Goal.** En Performance view, el usuario puede:
1. Fijar la **longitud** del performance en compases desde una toolbar (`Length: N bars`), saliendo del empty-state aunque no haya ninguna grabación.
2. **Crear** una lane de automatización eligiendo un parámetro de un picker agrupado; la lane se coloca automáticamente bajo su synth-lane o en la sección global/master según el prefijo del `paramId`.
3. **Editar** la curva dibujándola sobre un canvas (pincel line/flat, stepped/smooth, doble-clic resetea un step), con header por-lane (enable, stepped, rango, quitar).
4. **Zoom** continuo (Ctrl+rueda con punto focal + slider) que escala **toda** la timeline (ruler + bandas de clip + lanes de automatización) de forma coherente, con scroll horizontal.
5. La automatización dibujada **suena** al reproducir el performance y se **guarda** con el save.

**Non-goals (MVP).**
- Edición de los bloques de clip en la timeline (mover/recortar): sigue siendo non-goal de Performance view.
- Selección múltiple, copiar/pegar curvas entre lanes, edición por puntos (handles bezier). Solo dibujo con pincel.
- Zoom vertical / alto de lane configurable. Solo zoom horizontal.
- "Follow BPM" / reescalado al cambiar BPM (igual que el spec original).
- Borrar el tab "Automation" global Classic — eso es Spec 2.
- Automatización con curvas por-lane de **longitud independiente** (como el tab global): en Performance todas las curvas abarcan **todo** el arrangement.

---

## 2. Contexto (estado tras el merge de Performance view)

Performance view ya está enviada a `main`. Hoy:
- [performance-ui.ts](../../../src/performance/performance-ui.ts) `renderPerformanceView`: empty-state si `durationSec === 0`; si no, ruler + por-lane banda de clips + bandas de automatización **solo-lectura** (`makeAutomationBand` solo dibuja la curva, sin painter ni header) + sección global + playhead. `PX_PER_BAR = 80` **fijo**. **No hay toolbar, ni zoom, ni edición, ni forma de crear lanes ni de fijar longitud sin grabar.**
- [arrangement-runtime.ts](../../../src/performance/arrangement-runtime.ts) `tickArrangement`: aplica `curve.samples` a los knobs vía `sampleAutomationAt` — la reproducción de curvas ya funciona.
- El save v3 ya persiste el `arrangement` completo (commit `e77fd5c`).

**Reutilización clave — el editor de automatización ya existe** en [automation-painter.ts](../../../src/automation/automation-painter.ts) y se usa dos veces ([automation-ui.ts](../../../src/automation/automation-ui.ts), [clip-automation-lanes.ts](../../../src/session/clip-automation-lanes.ts)):
- `attachLanePainter(canvas, lane, draw, getBrush)` — dibujo con puntero (pincel `line`/`flat`), doble-clic resetea un step a 0.5, snap stepped. Opera sobre cualquier `{ values: number[]; stepped? }`.
- `drawLane(canvas, lane, deps)` — pinta rejilla + curva rellena + playhead. Necesita `{ values, enabled, stepped }` + `deps {seq, getAutoAbsSubIdx}`.
- `ensureLaneSize`, `snapLaneToSteps`, `formatNum`, `clamp01`.

El painter trabaja en **espacio de índice normalizado**: mapea todo el array `values` al ancho del canvas. **No** sabe de compases/zoom/scroll — el consumidor controla el ancho del canvas. Eso encaja perfecto con zoom = ancho variable.

**Desajuste de forma a reconciliar:** el `AutomationCurve` de Performance es `{ paramId, samples: number[] }` (sin `enabled`/`stepped`); el painter espera `{ values, enabled, stepped }`. Ver §4.

---

## 3. Arquitectura (enfoque A)

Módulo nuevo **`src/performance/performance-automation-ui.ts`** que reutiliza `automation-painter` y renderiza al `pxPerBar` actual de la timeline. `renderPerformanceView` gana una toolbar (length + zoom) y delega las bandas de automatización (ahora editables) a este módulo. Performance queda **self-contained**: no depende del módulo Classic `automation-ui.ts` (que el Spec 2 borrará), evitando enredo entre los dos specs.

Descartados: **B** (generalizar `automation-ui.ts` para servir a ambos) acopla Performance a código que el Spec 2 elimina — mala dirección de dependencia. **C** (editar `makeAutomationBand` in-situ sin módulo) hincha `renderPerformanceView` y dificulta el testeo.

---

## 4. Cambios de modelo de datos

En [performance.ts](../../../src/performance/performance.ts):

```ts
export interface AutomationCurve {
  paramId: string;
  values: number[];        // RENOMBRADO desde `samples`. Normalizado 0..1 por sub-step.
  enabled?: boolean;       // NUEVO. undefined/true = activa. false = no se aplica al reproducir.
  stepped?: boolean;       // NUEVO. snap a step al editar (igual que clip envelopes / tab global).
}

export interface ArrangementState {
  bpm: number;
  durationSec: number;     // derivada de grabación (max untilSec). Igual que ahora.
  lengthBars: number;      // NUEVO. Longitud fijada por el usuario en la toolbar. 0 = sin fijar.
  lanes: ArrangementLaneRec[];
  globalAutomation: AutomationCurve[];
}
```

**Longitud efectiva.** Render y tamaño de curvas usan:
```
effectiveDurationSec = max(durationSec, lengthBars * (60/bpm)*4)
```
El empty-state pasa a comprobar `effectiveDurationSec === 0` (ni grabación ni longitud fijada). Así una grabación posterior nunca encoge el lienzo que el usuario fijó, y fijar longitud sin grabar saca del empty-state.

**Rename `samples` → `values`.** Impacto GitNexus sobre `AutomationCurve`: **MEDIUM, `processes_affected: 0`**. Puntos de código reales (no imports transitivos): `performance.ts` (def), `arrangement-ops.ts` (`getOrCreateCurve`/`writeAutomationSample`/`sampleAutomationAt`), `performance-ui.ts` (`makeAutomationBand`), `rec-state.ts` (vía `writeAutomationSample`) + tests. El rename alinea Performance con el resto del repo (clip envelopes y automation global ya usan `values`) y deja la curva consumible directamente por el painter.

**Helpers nuevos** en [arrangement-ops.ts](../../../src/performance/arrangement-ops.ts):
- `setArrangementLengthBars(state, bars)` — fija `lengthBars` y redimensiona TODAS las curvas (lane + global) a la longitud efectiva (extiende por hold del último valor, trunca si encoge). Reusa la lógica de `ensureLaneSize`.
- `addAutomationCurve(state, paramId, laneIds)` — `routeParamId(paramId, laneIds)` decide destino (`lane.automation` o `globalAutomation`); crea `{ paramId, values: fill(len, 0.5), enabled: true, stepped: false }` con `len` = sub-steps de la longitud efectiva; no-op si ya existe esa curva en ese destino.
- `removeAutomationCurve(state, paramId, route)`.

---

## 5. Toolbar (length + zoom)

Nueva fila bajo el transport, dentro de la Performance view (`#perf-toolbar`):

```
┌ Toolbar ───────────────────────────────────────────────────────┐
│ Length: [ 8 ] bars   ·   Zoom [────●───]   ·   8 bars · 130 BPM │
└────────────────────────────────────────────────────────────────┘
```

- **Length: N bars** — `<input type="number" min=1>`; on change → `setArrangementLengthBars` + re-render. Siempre visible.
- **Zoom continuo** — estado `pxPerBar` (rango ~16..400, default 80). Dos entradas:
  - **Ctrl + rueda** sobre la timeline: zoom alrededor del cursor — preserva el compás bajo el puntero ajustando `scrollLeft` (`newScrollLeft = barUnderCursor * newPxPerBar - (cursorClientX - trackLeft)`).
  - **Slider** en la toolbar (fallback explícito).
- **Lectura** `N bars · BPM`.

`pxPerBar` vive en el estado de UI de la feature (no se persiste en MVP).

---

## 6. Crear lanes de automatización

En la sección de cada synth-lane y en la sección global/master, un encabezado con:
- **Picker de param agrupado** por prefijo (`tb303`/`poly`/`fx`/`mix`/`main`/`<laneId>`), construido a partir de `automationRegistry` — mismo patrón que `populateAutoParamSelect` de [automation-ui.ts](../../../src/automation/automation-ui.ts) (se replica en el módulo nuevo, no se importa el módulo Classic).
- Botón **"+ Automation"** → `addAutomationCurve(state, paramId, laneIds)`; el prefijo del `paramId` (vía `routeParamId`) coloca la curva en la lane correcta o en global. Re-render.

Empty-state: si `effectiveDurationSec === 0`, el placeholder gana un atajo "fija una longitud arriba para empezar a dibujar" además del texto de grabación.

---

## 7. Lanes editables (reutilizando el painter)

`makeAutomationBand` (solo-lectura) se reemplaza por una lane editable construida por el módulo nuevo:
- **Header por-lane:** label `paramId — meta.label`, toggle **enable** (On/Off), toggle **stepped/smooth**, rango `[min..max]`, botón **quitar** (`×`).
- **Canvas pintable:** ancho = `totalBars * pxPerBar` (zoom-aware), alto fijo (~64px para dar precisión al dibujar, más que los 32px actuales de solo-lectura). Se le adjunta `attachLanePainter(canvas, curve, draw, getBrush)` y se dibuja con `drawLane(canvas, curve, painterDeps)`.
- **Pincel** compartido (line/flat) en la toolbar, igual que en los otros editores.

Como `AutomationCurve` pasa a tener `values`/`enabled`/`stepped`, es consumible **directamente** por el painter sin adaptador. **Playhead:** se pasa `painterDeps = { seq, getAutoAbsSubIdx: () => 0 }`. Como el transport de Performance es propio (`startArrangement`) y el `seq` maestro **no** está sonando durante el play del arrangement, `drawLane` no pinta su playhead intra-lane — el único playhead es el vertical global de Performance (`#perf-playhead`, §8). Decisión: un solo playhead, sin sub-índice de arrangement dentro del painter.

---

## 8. Zoom — mecánica

Un **único `pxPerBar`** compartido por ruler, bandas de clip y lanes de automatización → todo alineado a la rejilla de compases a cualquier zoom. `renderPerformanceView` (y los helpers `makeRuler`/`makeClipBand`/lane de automatización) toman `pxPerBar` como parámetro en vez de la constante. La timeline vive en un contenedor con `overflow-x: auto`. El playhead vertical global se posiciona en `bar * pxPerBar`.

Ctrl+rueda recalcula `pxPerBar` (factor multiplicativo, p.ej. ×1.1 por notch, clamp a [16, 400]) y reajusta `scrollLeft` para mantener el compás bajo el cursor fijo en pantalla. Re-render (o reescalado de anchos + redibujo de canvases).

---

## 9. Reproducción + persistencia

- **Reproducción:** `tickArrangement` ya aplica `curve.samples`→`values` vía `sampleAutomationAt`. **Cambio:** saltar curvas con `enabled === false`. El muestreo por sub-índice ya está; las curvas dibujadas suenan sin más.
- **Persistencia:** el save v3 serializa el `arrangement` entero → `values`/`enabled`/`stepped`/`lengthBars` hacen round-trip automáticamente. **Migración de carga:** un save v3 anterior a este spec tiene `automation[].samples`; se añade un normalizador en la ruta de carga del arrangement que renombra `samples`→`values` y default `enabled=true`/`stepped=false` (pequeño, junto a la deserialización en [saved-state-v3.ts](../../../src/save/saved-state-v3.ts)).
- **Undo:** crear/quitar/editar una lane pasa por los hooks de undo existentes (`withUndo`/snapshot del estado), igual que las ediciones de Session, para que el dibujo sea deshacible.

---

## 10. Tabla de cambios por archivo

| Archivo | Cambio | Riesgo |
|---|---|---|
| `src/performance/performance.ts` | `AutomationCurve`: `samples`→`values`, +`enabled?`/`stepped?`; `ArrangementState`: +`lengthBars`; `emptyArrangementState` setea `lengthBars:0` | bajo (def) |
| `src/performance/arrangement-ops.ts` | rename en `getOrCreateCurve`/`writeAutomationSample`/`sampleAutomationAt`; +`setArrangementLengthBars`/`addAutomationCurve`/`removeAutomationCurve`; export `effectiveDurationSec` | medio |
| `src/performance/arrangement-runtime.ts` | `tickArrangement` salta curvas `enabled===false` | bajo |
| `src/performance/rec-state.ts` | rename `samples`→`values` en `tickRecAutomation`/`writeAutomationSample` | bajo |
| `src/performance/performance-ui.ts` | toolbar (length+zoom); `pxPerBar` param; usa `effectiveDurationSec`; delega bandas de automatización al módulo nuevo; empty-state actualizado | medio |
| `src/performance/performance-automation-ui.ts` **(NUEVO)** | editor: param picker agrupado, "+ Automation", header por-lane, canvas + painter, zoom-aware | — |
| `src/app/performance-feature.ts` | wire toolbar (length/zoom state), pasa `automationRegistry`+laneIds+labels al UI, refresca en edición, hooks de undo, `getAutoAbsSubIdx` del arrangement | medio |
| `src/save/saved-state-v3.ts` | normalizador de carga `samples`→`values` + defaults de flags | bajo |
| `index.html` + `src/styles/` | markup de la toolbar + estilos `.perf-toolbar`/lane editable | bajo |

`automation-painter.ts` se reutiliza **sin cambios**.

**GitNexus:** `impact(AutomationCurve)` = MEDIUM, 0 processes; `impact(Sequencer.pattern)` (Spec 2) = CRITICAL/0 processes — confirma que esto (Spec 1) es de blast radius acotado y aislado de la limpieza Classic.

---

## 11. Testing

Convención del repo: aserciones **relativas**.

| Capa | Qué | Cómo |
|---|---|---|
| Pura | `setArrangementLengthBars` redimensiona todas las curvas (hold/truncado) y actualiza `effectiveDurationSec` | unit `arrangement-ops.test.ts` |
| Pura | `addAutomationCurve` rutea por prefijo a lane vs global; no duplica | unit |
| Pura | rename: `sampleAutomationAt` lee `values`; round-trip con `writeAutomationSample` | unit (ajuste de los tests existentes) |
| Pura | Migración de carga `samples`→`values` + defaults | unit en `saved-state-v3` |
| Scheduling | `tickArrangement` no aplica curvas `enabled===false` | harness fake-clock existente |
| DSP | Dibujar una curva sobre un param audible (p.ej. cutoff) y reproducir el arrangement produce variación de energía coherente con la curva | `arrangement.dsp.test.ts` |
| E2E | Performance → `Length: 8` → "+ Automation" (param) → arrastrar sobre el canvas → Play → la curva persiste (`.perf-auto-lane`) | Playwright (con `npm run build` previo — el e2e sirve `dist/`) |

El painter en sí ya está cubierto por los tests de `automation-ui`/`clip-automation`.

---

## 12. Error handling / edge cases

- **Performance vacío con longitud fijada:** `lengthBars>0` y sin clips/grabación → sale del empty-state, ruler + secciones por-lane vacías listas para "+ Automation".
- **Param sin entry en `automationRegistry`** (engine cambiado / param inexistente): la lane se dibuja en gris con badge "param no disponible"; al reproducir, `applyAutomation` la ignora silenciosamente (ya lo hace).
- **Cambiar Length con curvas existentes:** todas se redimensionan por hold/truncado; nunca se pierde el inicio de la curva.
- **Zoom fuera de rango:** clamp `pxPerBar` a [16, 400]; el scroll se mantiene en el compás focal.
- **Curva `clipId`/lane borrada:** N/A para automatización (las curvas son por `paramId`, no por clip).

---

## 13. Open questions (no bloqueantes)

- Alto de lane fijo (~64px) vs plegable: MVP fijo, sin plegado persistido.
- Persistir `pxPerBar`/scroll por performance: fuera de MVP.
- Snap del dibujo a la rejilla de compás además del snap stepped: fuera de MVP (el pincel ya da line/flat).

---

## 14. Handoff al Spec 2 (limpieza Classic)

Cuando este Spec 1 esté implementado, el tab **"Automation" global Classic** (`seq.pattern.automation` + `automation-ui.ts`) queda **funcionalmente superado** por las lanes de automatización de Performance. Su borrado — junto con todo el sustrato `seq.pattern` — es el **Spec 2**, posterior y separado (spec + plan propios). Inventario completo y evidencia en la memoria `project_classic_pattern_removal_deferred`.
