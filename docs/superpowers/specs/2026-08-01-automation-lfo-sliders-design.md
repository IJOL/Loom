# LFO de automatización: sliders continuos y ciclos exactos

Fecha: 2026-08-01

## Problema

El generador de curvas LFO de las lanes de automatización de clip
([src/session/clip-automation-lanes.ts](../../../src/session/clip-automation-lanes.ts))
expone hoy tres desplegables: forma, *rate* (una lista fija de siete divisiones
musicales, de "4 bars" a "1/16") y *depth* (cuatro porcentajes: 100/75/50/25 %).

Eso deja fuera dos cosas que el usuario necesita:

1. **No se puede decir "quiero exactamente N ciclos aquí"**. La lista de rates
   sólo cubre potencias de dos por compás; tres ciclos en una región de dos
   compases no es expresable.
2. **Ni la altura ni la fase de la onda son accesibles.** `LfoFill` ya tiene
   `center` y `phase`, y `fillLfo` los respeta, pero ningún control los toca:
   la UI siempre manda los valores por defecto (`center: 0.5`, `phase: 0`).

Y el tamaño (`depth`), que sí es accesible, lo es en cuatro escalones discretos
en vez de continuo.

## Objetivo

Sustituir forma + rate + depth por: forma, un **campo de ciclos** libre y **tres
sliders continuos** — tamaño, altura y fase — con repintado en vivo.

## Decisiones tomadas

| Decisión | Elección | Motivo |
|---|---|---|
| Unidad de "ciclos" | Ciclos en la **región pintada** (el loop si "Loop only" está activo, si no el clip entero) | Es lo que hace falta para que una onda cierre limpia dentro de un loop |
| Lista de rates | **Se elimina** | Con ciclos-por-región queda cubierta: un clip de 2 compases con rate 1/4 son 8 ciclos |
| Sitio de los controles | **Segunda fila plegable** bajo el header de la lane | El header ya va lleno; los sliders necesitan ancho real para ser usables |
| Aplicación | **Repintado en vivo** al arrastrar | Mover un slider a ciegas es justo lo incómodo del sistema actual |
| Ámbito de los ajustes | **Compartido** por todas las lanes (variable de módulo, como hoy) | Configuras una onda y la vas pintando lane por lane; no toca el esquema guardado |

## Diseño

### 1. Matemáticas — [src/automation/automation-lfo.ts](../../../src/automation/automation-lfo.ts)

El módulo ya sabe hacer `depth`, `center` y `phase`, y acepta cualquier
`cyclesPerBar` continuo. Los cambios son de **encuadre**, no de fórmula.

**Ancla de fase nueva: `LfoFill.originSub`.**
Hoy el sub-paso 0 del clip es siempre fase 0, de modo que un relleno windowed
("Loop only") que empiece a mitad de compás entra por donde le toca a la onda,
no por donde empieza la región. "Exactamente N ciclos aquí dentro" sólo
significa algo si el primer ciclo arranca en el borde de la región. Se añade
`originSub?: number` (por defecto `0`, es decir, el comportamiento de hoy) y la
UI le pasa el inicio de la región.

Restricción: en una lane *stepped*, el centro-de-paso se sigue calculando sobre
el índice **absoluto**; `originSub` sólo entra en el cálculo de la fase. Así la
rejilla de pasos no se desalinea aunque el origen no sea múltiplo de
`stepSubRes`. Concretamente:

```
pos = stepSub > 0 ? (floor(i / stepSub) + 0.5) * stepSub : i     // absoluto
cyc = ((pos - originSub) / subResPerBar) * cyclesPerBar + phase  // relativo
```

**Conversión ciclos ↔ cyclesPerBar.** Dos ayudantes puros:

- `cyclesToCyclesPerBar(cycles, regionSubs, subResPerBar)` — `regionBars` es
  `regionSubs / subResPerBar`; el resultado es `cycles / regionBars`.
- `maxCyclesInRegion(regionSubs, subResPerBar, stepSubRes?)` —
  `maxCyclesPerBar(...) * regionBars`, para que la UI pueda limitar en la unidad
  que el usuario teclea.

El techo real lo sigue mandando `maxCyclesPerBar()` (16 ciclos/compás en una
lane continua, la mitad en una *stepped*): esa lógica no se reimplementa.

**Se elimina el suelo `LFO_MIN_CYCLES_PER_BAR`.** Existía porque la lista de
rates paraba en "4 bars". Con ciclos-por-región el mínimo útil es "0,25 ciclos
en lo que ves", y esa es una decisión de UI. `clampCyclesPerBar` conserva sólo
el techo y exige un valor finito positivo.

**Se borran `LFO_RATES`, `LfoRate`, `rateById` y `lfoRatesFor`.** Sin el
desplegable no les queda ni un llamante fuera de sus propios tests.

**Recorte contra los bordes del lane.** Con `center` alto y `depth` grande, la
onda se aplasta contra 1.0 (el `clamp01` actual). Se mantiene a propósito:
aplastar es una forma legítima y visible, y la alternativa —que un slider limite
a otro— produce controles que se mueven solos.

### 2. UI — [src/session/clip-automation-lanes.ts](../../../src/session/clip-automation-lanes.ts)

**Header.** Pierde los tres desplegables y se queda con un botón desplegable
`▾ LFO` y el `×` de siempre. El estado abierto/cerrado es un `Set<paramId>`
**del cierre del panel**, no de módulo: la onda se comparte entre lanes porque
así lo quiere el usuario, pero "qué filas están desplegadas" es estado de vista
de un inspector concreto, y un inspector recién abierto debe salir plegado.
Varias lanes pueden estar abiertas a la vez.

**Segunda línea** (se renderiza sólo si la lane está abierta). Todo va en **una
sola línea de la altura de una fila** — 25 px contra los 20 px del header:

```
┌─ auto-lane ───────────────────────────────────────────────────────────────┐
│ Cutoff  [On][Smooth] [0..1]                                  [▾ LFO] [×]  │
├───────────────────────────────────────────────────────────────────────────┤
│ [Sine▾] Cycles[4]  Size ────●── 100% Height ──●──── 50% Phase ●──── 0° [LOOP][LFO] │
├───────────────────────────────────────────────────────────────────────────┤
│  (la curva dibujada)                                                      │
└───────────────────────────────────────────────────────────────────────────┘
```

Corregido 2026-08-01 tras verlo montado: la primera versión apilaba los tres
sliders en filas propias y ocupaba cuatro líneas. Nacho lo rechazó por
aparatoso — *"esperaba algo mucho más compacto, discreto"*. Los tres sliders
comparten a partes iguales el espacio que sobra (`flex: 1 1 0` + `min-width: 0`)
y lo devuelven al estrecharse el panel, así que la línea nunca se desborda ni se
parte: a 1150 px de inspector cada slider mide ~215 px, a 900 px ~130 px.

- **Size** — `depth`, `<input type=range>` 0..1, leído como 0–100 %.
- **Height** — `center`, 0..1, leído como 0–100 %.
- **Phase** — `phase`, 0..1 ciclos, leído como 0–360°.
- **Cycles** — `<input type=number>`, decimales permitidos (0,5 = media onda),
  limitado a `[0.25, maxCyclesInRegion(...)]`. En una lane *stepped* el techo
  baja solo y el campo lo refleja.

**Estado.** `lfoState` sigue siendo uno compartido a nivel de módulo:
`{ shape, cycles, depth, center, phase, loopOnly, seed }`. No toca
`SavedStateV3` ni se persiste.

**Bug arreglado de paso: el motor *stepped* estaba desconectado.** La UI
anterior nunca pasaba `stepSubRes` a `fillLfo` — sólo llamaba a
`snapLaneToSteps()` después. Es decir, toda la maquinaria de escalera de
`automation-lfo.ts` (y su ceiling de dos pasos por ciclo) no llegaba a
ejecutarse nunca desde la aplicación, que es exactamente el modo de fallo que el
propio módulo documenta: *stepped* + rate rápido = línea plana. La fila nueva lo
pasa.

**Repintado en vivo.** Un único `repaint()` alimenta el `@input` de los tres
sliders, el `@change` de forma y ciclos, y el botón `LFO`. Como `fillLfo`
sobrescribe la región entera, repintar es idempotente: arrastrar no acumula
deriva.

**Un solo paso de undo por gesto.** `@pointerdown` → `beginGesture()`,
`@pointerup` / `@change` → `endGesture()` — el mismo bracket de
`attachKnobUndo` que ya usan knobs y faders. El botón `LFO` conserva su
`withUndo`.

**Estilos.** `.clip-auto-lfo` deja de ser un `span` en el header y pasa a ser la
fila propia (`_session-inspector.scss`), con los `input[type=range]` heredando
el aspecto ya definido en `_base.scss`.

### 3. Pruebas

Puras, en `src/automation/automation-lfo.test.ts` y
`automation-lfo-stepped.test.ts` — hay que tocarlas igualmente, porque importan
`LFO_RATES`. También `automation-lfo-meter.test.ts` usa `rateById`.

- `originSub` sitúa la fase 0 en el inicio de la región; con `originSub: 0` el
  resultado es exactamente el de hoy (no-regresión).
- Un test por slider: `depth` escala pico-a-pico, `center` mueve la media,
  `phase` rota, y `phase: 1` ≡ `phase: 0` (incluida la forma `random`).
- Recuento de ciclos: pedir N ciclos en una región produce N máximos — para N
  entero y para N fraccionario, y con una región que no empieza en compás
  entero.
- Limitación: pedir más ciclos de los que la región puede expresar recorta al
  techo; en una lane *stepped* recorta una octava antes y **no** produce una
  lane plana (la regresión ya documentada en el módulo).

En `src/session/clip-automation-lanes.test.ts`, un test por camino de usuario:

- El botón `▾ LFO` abre y cierra la fila.
- Mover un slider escribe en el envelope.
- Cambiar el campo de ciclos escribe en el envelope.
- El botón `LFO` escribe en el envelope.

Todas las aserciones relativas (ratios, comparaciones), según la regla del
repositorio; nada de umbrales absolutos sin justificación en comentario.

## Fuera de alcance (a propósito)

- **La deuda de "el rate asume un compás de 16 pasos"** anotada en
  `automation-lfo.ts`: se disuelve sola al desaparecer la tabla de rates.
- **Preview fantasma** (dibujar la curva propuesta sin escribirla): se descartó
  frente al repintado en vivo, que no necesita tocar `drawLane`.
- **Persistir los ajustes del LFO en la sesión**: seguirían siendo compartidos y
  volátiles.
