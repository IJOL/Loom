# Sampler B2 — Onda de muestra editable (recorte + loop)

Fecha: 2026-06-10 · Estado: **aprobado** (brainstorming visual sobre la app real).
Mockup aprobado: [2026-06-10-sampler-b2-waveform-edit-mockup.png](../mockups/2026-06-10-sampler-b2-waveform-edit-mockup.png)
(asas dibujadas sobre la onda real del preset *Sweep Pad*).

## Por qué

El panel **"Selected sample"** del inspector del Sampler
([sampler-sample-viewer.ts](../../../src/engines/sampler-sample-viewer.ts)) ya pinta la
forma de onda de la muestra seleccionada con zoom, **pero es de solo lectura** — el
propio código lo dice: *"Read-only for now (trim/loop-point dragging is a later
refinement)"*, y el cabecero promete *"trim + loop"* sin cumplirlo. Es el último hueco
real de la "Parte B" del rediseño del Sampler: las demás piezas (knobs por zona =
tiras de canal, badge one-shot/loop, mapa de teclas) ya están en `main`.

Este spec cubre **solo B2**. B1 (layout per-zona) quedó resuelto con la opción de
"tiras de canal + panel Selected sample". B3 (trim/warp del canal de audio, auto-spread
multi-muestra) queda **fuera de alcance** por decisión del usuario.

## Estado actual (verificado contra el código)

- **Modelo per-muestra** ([sampler-pad-params.ts](../../../src/engines/sampler-pad-params.ts)):
  `PadParams` ya tiene `loop` (0/1) y `loopStart` (0..1). **No** tiene recorte
  (`sampleStart`/`sampleEnd`) ni `loopEnd` — hoy el loop va forzado de `loopStart` al
  final del buffer.
- **Reproducción** ([sampler.ts](../../../src/engines/sampler.ts), método `trigger`,
  ~líneas 138–173): `src.start(time, 0)` arranca el buffer **entero** desde 0;
  el loop hace `src.loopStart = loopStart·dur`, `src.loopEnd = dur`. No respeta ningún
  recorte ni fin de loop.
- **Visor** ([sampler-sample-viewer.ts](../../../src/engines/sampler-sample-viewer.ts)):
  dibuja la onda (canvas) + zoom −/+ + sombrea la región de loop (de `loopStart` al final).
  Sin interacción de puntero.

## Diseño aprobado

### 1 · Interacción — el panel "Selected sample" se vuelve editable

Cuatro asas arrastrables sobre el canvas de la onda:

- **Recorte**: asa de **inicio** y asa de **fin** en los bordes. La parte fuera de
  `[sampleStart, sampleEnd]` se oscurece (no suena).
- **Loop**: banda interior con asa de **inicio** y asa de **fin**
  (`loopStart`/`loopEnd`). Solo visible cuando la muestra está en modo loop.

Detalles:

- El **badge** "one-shot ⟷ loop" del cabecero pasa a ser **clicable** (toggle del
  param `loop` de esa muestra). Hoy solo informa. Al activar el loop aparecen sus dos
  asas; al desactivar, desaparecen y vuelve a one-shot.
- El **zoom −/+** existente sigue mandando. Las asas viven en **coordenadas del
  buffer** (fracción 0..1), de modo que con zoom se afina al detalle. El arrastre
  convierte `clientX` → fracción teniendo en cuenta el scroll horizontal y el ancho
  escalado del canvas.
- Se edita **la muestra seleccionada** (una zona/pad). Persiste **por nota**, por el
  mismo camino que el resto de params per-pad (no se inventa un store nuevo).
- Restricciones de arrastre (clamp): `0 ≤ sampleStart < sampleEnd ≤ 1`;
  `sampleStart ≤ loopStart < loopEnd ≤ sampleEnd`. Un margen mínimo entre asas evita
  regiones de ancho cero.
- Feedback al arrastrar: la región se repinta en vivo; el cursor del asa es `ew-resize`.

### 2 · Modelo de datos

Añadir tres campos a `PadParams` y a `PAD_DEFAULTS` / `PAD_LEAF_SPECS`
([sampler-pad-params.ts](../../../src/engines/sampler-pad-params.ts)):

| Campo         | Rango | Default | Significado                              |
|---------------|-------|---------|------------------------------------------|
| `sampleStart` | 0..1  | `0`     | Inicio de reproducción (fracción del buffer) |
| `sampleEnd`   | 0..1  | `1`     | Fin de reproducción                      |
| `loopEnd`     | 0..1  | `1`     | Fin de la región de loop (par de `loopStart`) |

Los defaults reproducen **exactamente** el comportamiento actual (start 0, end 1,
loop hasta el final), así que muestras y presets existentes no cambian de sonido.
Se persisten y migran como los demás (un pad sin estos campos → defaults).

### 3 · Reproducción (que suene de verdad)

En `Sampler*.trigger` ([sampler.ts](../../../src/engines/sampler.ts)):

- Calcular `startSec = sampleStart·dur`, `endSec = sampleEnd·dur`.
- **One-shot**: `src.start(time, startSec, (endSec − startSec) / playbackRate)` — arranca
  recortado y dura solo el tramo audible (ajustado por `playbackRate`, ya que el repitch
  cambia la duración real).
- **Loop**: `src.loopStart = loopStart·dur`, `src.loopEnd = loopEnd·dur`, y el arranque
  sigue en `startSec`. El gate/ADSR (attack/decay) no cambia; el loop cicla mientras la
  nota está sostenida.
- Extraer el cálculo de `{ offset, duration, loopStart, loopEnd }` a una **función pura**
  (entrada: PadParams + `dur` + `playbackRate`; salida: argumentos de reproducción) para
  poder testearla sin DOM ni audio.

### Pruebas

Una por camino de usuario (sin alternativas "(o…)"):

1. **Pura** — `samplePlaybackWindow(pad, dur, rate)` devuelve offset/duration/loop
   correctos: defaults = buffer completo; recorte = ventana reducida; loop = límites
   `[loopStart, loopEnd]`. Casos de clamp (asas cruzadas, ancho cero).
2. **Pura** — hit-testing del visor: dado un `clientX` y el layout (zoom, scroll, ancho),
   `pickHandle(x)` elige el asa correcta (inicio/fin/loopStart/loopEnd) y `xToFrac(x)`
   convierte a fracción de buffer.
3. **DSP real** ([sampler-trim.dsp.test.ts] nuevo) — render por `OfflineAudioContext` a
   través del engine+scheduler: una muestra con `sampleStart=0.5` arranca más tarde / una
   con `sampleEnd=0.5` produce menos energía total que sin recortar (aserción **relativa**,
   ratio < 1). Verde == audible.
4. **e2e Playwright** — abrir el inspector del Sampler con un preset melódico, arrastrar el
   asa de inicio y comprobar que `sampleStart` del pad cambió (vía el estado), confirmando
   que el arrastre llega al modelo.

## Fuera de alcance (YAGNI)

- Campos numéricos de ms (la precisión la da el zoom).
- Trim/warp del **canal de audio** y la cabecera de clip
  ([clip-waveform-header.ts](../../../src/session/clip-editors/clip-waveform-header.ts)) —
  eso es B3, otra pista.
- Crossfade de loop, snap a zero-crossing, detección automática de loop.
- Auto-spread multi-muestra en el import (B3(e), anulado por el usuario).

## Archivos afectados (previsión)

- `src/engines/sampler-pad-params.ts` — 3 campos nuevos + specs + defaults.
- `src/engines/sampler.ts` — `trigger` usa la ventana de reproducción; función pura nueva.
- `src/engines/sampler-sample-viewer.ts` — asas arrastrables + badge clicable + repintado.
- `src/engines/sampler-playback-window.ts` (nuevo) — función pura de ventana de reproducción.
- Tests: `*-playback-window.test.ts`, `sampler-sample-viewer.test.ts` (hit-test),
  `sampler-trim.dsp.test.ts`, `tests/e2e/sampler-trim.spec.ts`.
- Persistencia: el camino per-pad existente (mismo sitio que `loop`/`loopStart`).
