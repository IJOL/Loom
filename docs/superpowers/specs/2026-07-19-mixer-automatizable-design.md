# Los parámetros del mixer, automatizables y modulables

**Fecha:** 2026-07-19
**Estado:** diseño aprobado, pendiente de plan
**Depende de:** el registro maestro de destinos y el menú contextual (mismo branch)

> En castellano a propósito: su lector es quien lo aprueba. El código y la UI van en inglés.

## Lo que no puedes hacer hoy

No puedes automatizar el volumen de un canal. Ni su panorama, ni sus envíos, ni su
ecualizador. Por **ninguna** vía: no aparecen en la curva de automatización del clip, ni
en la línea de tiempo, ni en el XY pad, ni en el APC, ni como destino de un LFO.

Es decir: un fundido de entrada, un auto-pan, abrir el filtro de un canal a lo largo de
un tema — nada de eso se puede grabar en el proyecto. Es un hueco grande y no estaba
señalado en ningún sitio; salió al hacer clic derecho sobre el ecualizador y no obtener
menú.

## Qué ganas

Los siete parámetros del canal —nivel, panorama, envío A, envío B, y las tres bandas de
EQ— pasan a ser destinos de pleno derecho: **automatizables por las cuatro vías y
modulables con un LFO**.

Auto-pan, fundidos dibujados, envíos que crecen en el estribillo, un EQ que respira con
un LFO lento. Todo eso deja de requerir grabarlo a mano moviendo el mando.

## Por qué es más barato de lo que parece

Los siete **ya son parámetros de audio**. El nivel y los dos envíos son nodos de
ganancia (`ctx.createGain()` en `src/core/fx.ts:109-110`), y el panorama y el EQ ya
exponen su parámetro (`getPanParam`, `getEqGainParam`). Lo único que falta es entregar
los tres que hoy se escriben por valor:

```
setLevel(g) { this.level.gain.value = g; }   // el AudioParam ya está ahí, solo no se ofrece
```

No hay cirugía del grafo de audio. Se añaden tres accesos calcados de los dos que ya
existen. Esto se comprobó en el código antes de aprobar el alcance: la primera
estimación de este documento decía "tocar el grafo, más riesgo", y era falsa.

## Decisiones

### 1. El deslizador de nivel gana identidad

El nivel no es un mando: es un `<input type="range">` sin identificador y sin registrar.
Por eso no ofrecía menú contextual y no podía ser destino.

**No se convierte en mando** — eso cambiaría tu interfaz. Se le sintetiza un `KnobHandle`
y se registra, exactamente como ya hace `src/core/select-control.ts:106` con controles
que tampoco son mandos. El aspecto no cambia; lo que cambia es que el resto del sistema
puede verlo.

### 2. Los identificadores se dan la vuelta: `<canal>.mix.<param>`

Hoy son `mix.<canal>.<param>` (`src/core/mixer.ts:80-119`). Eso no encaja con el formato
unificado en este mismo branch, donde **el primer tramo es el ámbito** — un canal,
`fx.master`, o `fx.send.<id>`. Con `mix` delante, el ámbito sería `mix`, que no es nada,
y todo el sistema los trataría como "canal desconocido".

Invertirlos a `<canal>.mix.<param>` hace que el ámbito vuelva a ser el canal, y entonces
**todo lo demás funciona sin un solo caso especial**: el catálogo los lista, el menú
contextual sabe a qué clip van, el resolvedor los enruta, el APC los alcanza.

**Y no hace falta traducir nada al cargar.** Se comprobó: el catálogo nunca emitió
identificadores `mix.*`, así que ninguna curva ni conexión guardada puede contenerlos; y
la selección de ejes del XY pad —el único sitio que llegó a ofrecerlos, cuando enumeraba
la tabla de mandos— **no se persiste**. No existe un solo `mix.*` dentro de ningún fichero
de sesión. El renombrado es puramente interno.

(La primera versión de este documento prescribía una migración al cargar. Era trabajo
inventado sobre una suposición no comprobada.)

### 3. El binder de modulación gana una tercera fuente

Hoy `applyBinder` construye su mapa de destinos con los parámetros compartidos del motor
más las cadenas de inserts. Se añade una tercera: los parámetros del `ChannelStrip` del
canal.

### 4. La exportación offline DEBE aplicarlo

Requisito explícito, no detalle de implementación. Hay precedente: el filtro de canal
quedó como *live-only* y el WAV exportado no sonaba como lo que se oía. Si automatizas un
fundido y exportas, el fichero tiene que traer el fundido.

El renderizador offline ya reconstruye el `ChannelStrip` de cada canal
(`src/export/offline-recorder.ts:154,301`), así que el camino existe; lo que hay que
garantizar —y probar— es que la automatización de esos parámetros se aplica durante el
render.

## Fuera de alcance, y por qué

| Excluido | Motivo |
|---|---|
| `muted` | Es de dos estados. Automatizar booleanos necesita curvas escalonadas y decidir qué pasa a mitad de camino: es otra función |
| El compresor del canal (`comp`) | Es un sub-objeto con sus propios parámetros; merece su propia decisión |
| El sidechain | Igual: estado compuesto, no un valor continuo |
| Los mandos del **master** | Este documento es el mixer **por canal**. El master tiene su propio ámbito y sus propias implicaciones |

## Pruebas

- Cada uno de los siete aparece en el catálogo para un canal dado.
- Un identificador viejo (`mix.poly1.pan`) guardado en una curva o en una conexión de
  modulación se traduce al nuevo al cargar, y apunta al mismo parámetro.
- Una curva sobre el nivel mueve de verdad la ganancia del canal al reproducir.
- Un LFO sobre el panorama produce un render que **cambia** respecto al mismo render sin
  el LFO (control negativo incluido), siguiendo la batería de modulación que ya existe en
  `src/audio-dsp/modulation-pipeline.test.ts`.
- **El render offline de un canal con el volumen automatizado no es plano** — la prueba
  concreta contra el fallo histórico de "esto solo funciona en vivo".
- El deslizador de nivel, tras registrarse, ofrece menú contextual como cualquier mando.

Trampas conocidas de este repo, a evitar en los tests: `listAutomationTargets` devuelve
lista vacía **en silencio** si el plugin no está registrado, y `getEngine()` devuelve
`undefined` si el módulo del motor no se importó. Ver `docs/automation-destinations.md`.

## Riesgo principal: un LFO bipolar sobre una ganancia

Este es el riesgo real, y no es el que parecía. No toca datos guardados —no hay ninguno—
sino el sonido.

El nivel y los dos envíos son **ganancias**: su rango natural empieza en 0. Un LFO
bipolar (−1..+1) sobre una ganancia puede llevarla a **valores negativos**, y una
ganancia negativa no baja el volumen: **invierte la fase**. En un canal suelto casi no se
oye; sumado con otros canales, se cancela y desaparecen instrumentos. Es el peor tipo de
fallo de audio — no suena "mal", suena *ausente*, y cuesta relacionarlo con la causa.

El panorama (−1..+1) y el EQ (−18..+18 dB) sí son bipolares por naturaleza y no tienen
este problema.

Así que el plan debe decidir explícitamente el rango de modulación de nivel y envíos, y
probarlo: **un LFO a profundidad máxima sobre el nivel de un canal no debe producir
muestras de fase invertida**. El proyecto ya declara rangos de modulación por parámetro
(`getAudioParamRange` en la interfaz de los plugins de efecto), así que el mecanismo para
acotarlo existe.

## Riesgo secundario

Que la exportación offline no lo aplique y el WAV no suene como lo que oyes — cubierto
arriba como requisito con su propia prueba, por el precedente del filtro de canal.
