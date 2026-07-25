# Spec — Eje temporal único del clip, automatización alineada con loop + LFO, y COMP/SC usable

Fecha: 2026-07-25 · Estado: **PENDIENTE DE APROBACIÓN**

## 0. Lo que has pedido (literal → requisito)

| Nº | Lo que dijiste | Requisito |
|----|----------------|-----------|
| R1 | "tenemos un compresor y un chisme conectado por lane, y no tengo ni repajoleras idea de cómo se usa" | El COMP y el SC (sidechain) por lane deben explicarse solos: nombres legibles, ayuda, tooltips y **feedback visual de que están actuando**. |
| R2 | "el módulo adicional que sale es vertical, no horizontal" | Los mandos DEPTH/ATK/REL que aparecen al elegir fuente de sidechain deben salir en fila, como el resto. |
| R3 | "las automatizaciones deberían mostrar el loop activo" | El carril de automatización pinta la región de loop del clip (ámbar), igual que el editor. |
| R4 | "y estar alineadas con el clip al que están unidas… las rejillas ocupan espacios diferentes" | Alineación al píxel entre editor y automatización: mismo origen, mismo ancho, mismo `pxPerTick`. |
| R5 | "lo estoy mirando en clip de audio pero los de notas ocurre lo mismo" | Vale para los tres editores: audio, piano-roll y drum-grid. |
| R6 | "debería haber un botón para imitar un LFO usando la automatización, variando el dibujo según la forma de onda o la frecuencia, con límites de frecuencia" | Generador de curva LFO dentro del carril: forma + ritmo (con límites) + profundidad → escribe los valores. |
| R7 | "la automatización debe zoomear enlazada al clip, e igual que el clip" | Un solo zoom/scroll horizontal compartido: zoomas el clip y la automatización zooma con él. |
| R8 | "estoy harto de soluciones miopes que no ven el total del código" | La causa raíz se arregla en un sitio, no cuatro parches. |

## 1. Diagnóstico (por qué pasa)

Hoy **el mismo clip tiene cuatro geometrías horizontales independientes**, cada una dueña de su zoom y su scroll:

| Vista | Dónde vive el estado | Gutter izq. | Ancho de contenido |
|---|---|---|---|
| Piano-roll | `viewStateByClip` — `clip-editor-router.ts:77` | 42 px (`KEYS_W`) | `viewportW × zoomX` |
| Drum-grid | `hViewByClip` — `clip-editor-drum-grid.ts:33` | `LABEL_W` | `viewportW × zoomX` |
| Onda / clip de audio | `audioHViewByClip` — `clip-waveform-header.ts:26` | 0 | `viewportW × zoomX` |
| Automatización | *no hay* — `clip-automation-lanes.ts:164` | 0 | `max(800, bars × 240)` px **fijos** |

Consecuencias, exactamente las que ves:

- **R4/R5**: un clip de notas con muestra monta la cabecera de onda (geometría 3) encima de la rejilla (geometría 1) → dos rejillas del mismo compás con anchos distintos.
- **R7**: la automatización no tiene zoom porque no participa de ninguna geometría; su lienzo es un ancho fijo por barras.
- **R3**: `mountClipLoopOverlay` se monta en los tres editores y **nunca** en la automatización, así que ahí el loop no existe.
- **R2**: `.lane-fx-sc-knobs` (`lane-fx-panel.ts:154`) es un `div` sin `display` dentro de `.knob-row` (que sí es flex): sus hijos `.knob` caen en bloque → columna.
- **R1**: `CompBlock.getReduction()` (`comp-block.ts:58`) existe y **nadie lo llama** — el comentario dice literalmente "útil para un futuro medidor GR". No hay ayuda ni tooltips en ninguno de los 9 mandos.

## 2. Frente A — `ClipAxis`: un solo eje temporal por clip

**Nuevo módulo `src/core/clip-axis.ts`.** Un objeto por `clip.id` que es el **único** dueño del eje horizontal. Los tres mapas de la tabla desaparecen.

```ts
export class ClipAxis {
  readonly clipId: string;
  totalTicks: number;                       // clip.lengthBars × ticksPerBar(meter)
  get zoomX(): number;                      // ≥ 1 (1 = el clip entero cabe)
  get scrollLeft(): number;

  setBasisWidth(px: number): void;          // el editor PRIMARIO publica el ancho de su viewport
  setTotalTicks(t: number): void;           // cambio de longitud / tempo *2 · /2
  contentWidth(): number;                   // round(basis × clampZoom(zoomX, maxZoomX(basis)))
  pxPerTick(): number;
  tickToX(tick: number): number;
  tickFromContentX(x: number): number;

  scrub(dyPx: number, anchorPx: number): void;   // zoom por arrastre, ancla estable
  setScrollLeft(px: number): void;
  subscribe(cb: (axis: ClipAxis) => void): () => void;   // devuelve unsubscribe
}

export function clipAxis(clipId: string, totalTicks: number): ClipAxis;  // registro por clip
export function releaseClipAxis(clipId: string): void;
```

Reglas:

- **Primario vs. seguidores.** Sólo hay un editor primario montado por clip (piano-roll *o* drum-grid *o* audio). Él publica `setBasisWidth()` y es el único que hace scroll real. Los **seguidores** (cabecera de onda, carriles de automatización) no tienen zoom propio: se miden contra el rect del viewport primario y copian `contentWidth()` y `scrollLeft`.
- **Alineación medida, no calculada.** Helper puro `followerGeometry(hostRect, primaryVpRect) → { marginLeft, width }`. Al medir el rect real nos da igual el gutter (42 / `LABEL_W` / 0), el borde de 1 px y el `scrollbar-gutter: stable` del piano-roll: cuadra por construcción, sin duplicar constantes.
- **Vertical se queda local.** `zoomY`/`scrollTop` siguen en cada editor; el eje es sólo horizontal.
- La matemática (`clampZoom`, `maxZoomX`, `zoomAroundAnchor`, `scrubToZoom`) se reutiliza de `pianoroll-zoom.ts` — no se reimplementa.

**Deuda que se paga de paso:** `pianoroll.ts` está en 782 líneas (tope duro del proyecto: 500). Sacarle el estado de zoom/scroll horizontal al eje lo reduce; el objetivo es que este frente deje `pianoroll.ts` **más corto**, no más largo.

## 3. Frente B — La automatización como seguidor del eje

`clip-automation-lanes.ts` se divide (hoy 197 líneas y va a crecer):

- `clip-automation-lanes.ts` — el panel (cabecera, selector de destino, lista de carriles).
- `clip-auto-strip.ts` — **nuevo**: la tira alineada de un carril: viewport propio (`overflow:hidden`), lienzo de `axis.contentWidth()`, sombra de loop y playhead.

Cada carril pasa de `[cabecera ancho completo][lienzo 800 px fijos]` a:

```
┌──────────────────────────────────────────────────────────────┐
│ FILTER CUTOFF   On  Smooth  [0.0 .. 1.0]                  ×  │  ← cabecera (ancho completo)
├────────────┬─────────────────────────────────────────────────┤
│  (gutter)  │▓▓▓▓▓ región de loop ámbar ▓▓▓▓▓                 │  ← tira alineada al viewport
│  medido    │  curva + rejilla de compases + playhead          │     del editor de arriba
└────────────┴─────────────────────────────────────────────────┘
     ↑ mismo left y mismo width que la rejilla del editor; mismo scrollLeft; mismo pxPerTick
```

- **Loop (R3)**: sombra ámbar + líneas A/B leídas de `effectiveClipLoop(clip, meter)` (la misma fuente que usa el overlay del editor), con `pointer-events: none` para no robarle el gesto de pintar. Reutiliza los colores de `_clip-loop-brace.scss`; **no** se duplica la lógica de loop.
- **Rejilla de compases**: `drawLane` pasa de "líneas cada 16 subpasos" a compases/pulsos reales del `meter` — mismos números que el ruler del editor.
- **Playhead**: hoy `drawLane` usa `getAutoAbsSubIdx()` (índice global) y encima nadie repinta el lienzo, así que no se mueve. Pasa a usar el **mismo** playhead loop-aware del clip que el editor: se extrae el `playheadFrac()` del router (`clip-editor-router.ts:193`) a un helper compartido y lo consumen los dos. Repintado en el RAF que ya existe (`session-host.ts:846`).
- **Zoom (R7)**: gratis — el ancho del lienzo *es* `axis.contentWidth()`, y el scrub de zoom sigue haciéndose en el editor. Opcionalmente el scrub también funciona sobre la tira (misma llamada `axis.scrub`).

## 4. Frente C — Generador de curva LFO en el carril (R6)

**Módulo puro `src/automation/automation-lfo.ts`** (testeable sin DOM):

```ts
export type LfoShape = 'sine' | 'triangle' | 'sawUp' | 'sawDown' | 'square' | 'random';

export interface LfoFill {
  shape: LfoShape;
  cyclesPerBar: number;   // ritmo, ver límites abajo
  depth: number;          // 0..1 (pico a pico sobre el centro)
  center: number;         // 0..1, por defecto 0.5
  phase: number;          // 0..1
}

/** Escribe la curva en [fromIdx, toIdx) de un array de subpasos. Puro, in-place. */
export function fillLfo(values: number[], from: number, to: number, subResPerBar: number, cfg: LfoFill): void;
```

- **Límites de frecuencia (R6)**: el ritmo se elige de una lista musical, no en Hz — así no hay alias contra la resolución de la automatización (`AUTOMATION_SUB_RES` por paso de 1/16). Lista: `4 barras · 2 barras · 1 barra · 1/2 · 1/4 · 1/8 · 1/16`. El techo (1/16) es exactamente un ciclo por paso; más rápido no es representable y por eso no se ofrece.
- **UI**: en la cabecera de cada carril, `[forma ▾] [ritmo ▾] [prof. ▾] [LFO]`. El botón escribe la curva y respeta `Stepped` (si el carril está en stepped, se cuantiza con el `snapLaneToSteps` que ya existe).
- **Alcance de escritura**: si el clip tiene loop activo, escribe **sólo dentro de la región de loop**; si no, todo el carril. Un toggle `Loop only` lo hace explícito.
- **Undo**: una sola entrada por pulsación (`withUndo`).
- **No** crea un LFO real ni toca `src/plugins/modulators/lfo.ts`: dibuja valores en la envolvente del clip. Es un generador de dibujo, como pediste.

## 5. Frente D — COMP y SC comprensibles (R1, R2)

En `lane-fx-panel.ts` + `_fx.scss`:

1. **Bug vertical (R2)**: `.lane-fx-sc-knobs` pasa a `display:flex; gap:14px; align-items:flex-end` (y el ocultado deja de escribirse con `style` inline suelto).
2. **Nombres legibles**: `COMP` → `COMP — channel compressor`; `SC` → `SIDECHAIN — duck this lane`. Encima de cada sección, la fuente/estado en texto (`off` / `Kick → duck 60%`), no sólo un desplegable.
3. **Ayuda**: botón `?` con `createHelpButton()` (el mismo widget que el piano-roll) por sección, explicando en llano qué hace y qué mando toca qué:
   - COMP: "baja el volumen de lo que pasa de THR; RAT es cuánto lo baja; ATK/REL, lo rápido que reacciona y se suelta; MKUP recupera el volumen perdido; BYP lo puentea".
   - SC: "elige la pista cuyos golpes deben *agachar* esta. Clásico: la caja de bombo agacha el bajo. DEPTH cuánto agacha, ATK/REL la forma del bache".
4. **Tooltips** (`title`) en los 9 mandos, con unidades.
5. **Medidor de reducción (GR)**: barra pequeña junto a BYP alimentada por `CompBlock.getReduction()` (ya existe, sin uso) → se **ve** cuándo el compresor actúa. Un solo `dispose()` registrado como el VU del mixer para no dejar RAF colgando.

## 6. Orden de trabajo, commits y pruebas

Worktree `clip-axis-automation`, rebase a `main` en cada commit, `--ff-only` al final, y te pregunto antes de mergear.

| # | Commit | Pruebas |
|---|--------|---------|
| 1 | `feat(core): ClipAxis, one horizontal time axis per clip` | unit: zoom/clamp/ancla/scroll/subscribe + `followerGeometry` |
| 2 | `refactor(clip-editors): the three editors read the shared axis` | unit de los tres editores en jsdom: mismo `contentWidth` y mismo origen |
| 3 | `feat(automation): clip lanes follow the clip axis, with loop + playhead` | unit: lienzo == `axis.contentWidth()`, sombra de loop en los ticks correctos, un test por editor (audio / notas / drums) |
| 4 | `feat(automation): LFO curve generator per lane` | unit puro por forma + límites + región de loop + stepped |
| 5 | `fix(mixer): sidechain knobs lay out horizontally` | unit del layout |
| 6 | `feat(mixer): help + tooltips + gain-reduction meter for COMP/SC` | unit: el medidor se crea y se destruye |

Además: `npm run build` antes de `test:e2e` (sirve `dist/` sin construir), y **mirar la pantalla** — parity visual es criterio de aceptación, no lo doy por hecho con los tests en verde.

## 7. Criterios de aceptación (verificables uno a uno)

1. Abro un clip de **audio**, zoomeo la onda: la tira de automatización zooma y se desplaza con ella, alineada al píxel.
2. Lo mismo en un clip de **notas** (piano-roll) y en uno de **drums**.
3. Un clip de notas **con muestra**: la cabecera de onda y la rejilla de notas tienen el mismo ancho y los compases coinciden en vertical.
4. Con loop activo, la región ámbar aparece en el carril de automatización, en los mismos ticks que en el editor, y se mueve si la arrastro arriba.
5. Reproduciendo, el playhead avanza sobre el carril y respeta el loop.
6. `[Sine][1/4][50%][LFO]` dibuja cuatro ciclos por compás dentro del loop; `Ctrl+Z` lo deshace de una vez.
7. Elijo fuente de sidechain: DEPTH/ATK/REL salen **en fila**.
8. El `?` de COMP y de SC explica en llano para qué sirven; con audio pasando, el medidor GR se mueve cuando el compresor comprime.

## 8. Riesgos y cómo los acoto

- **`pianoroll.ts` es grande y delicado** (ruler/keys "pinned" por transform, `scrollbar-gutter: stable`, bucle de relayout ya sufrido). Toco sólo el dueño del zoom/scroll horizontal; el pinning no se mueve. Si el frente 2 se pone feo, se puede parar tras el commit 1 sin dejar nada roto.
- **Alineación en jsdom**: `getBoundingClientRect` devuelve ceros. Por eso la geometría vive en un helper **puro** (`followerGeometry`) testeable, y en DOM sólo se comprueba que se llama con lo medido.
- **Sin migraciones**: el eje es estado en memoria (como los tres mapas que sustituye). Nada que persistir, ningún save que tocar.

## 9. ⛔ CONFIRMAR (tres decisiones que son tuyas)

1. **Dónde vive la automatización**: (a) panel debajo del editor, alineado al píxel *(recomendado: sirve igual para los tres editores y no toca el marco del piano-roll)*; (b) dentro del marco del editor, como una fila más bajo el carril de velocidad *(más bonito, refactor bastante mayor de los tres editores)*.
2. **El loop en la automatización**: (a) sólo visual *(recomendado: si es arrastrable, el gesto de arrastre se come el de pintar)*; (b) también arrastrable.
3. **Alcance del LFO por defecto**: (a) región de loop si está activa, si no todo el carril *(recomendado)*; (b) siempre todo el carril.
