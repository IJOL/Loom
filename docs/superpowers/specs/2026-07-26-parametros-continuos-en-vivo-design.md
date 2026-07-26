# Parámetros de síntesis continuos: que el mando mueva la nota que ya suena

**Fecha:** 2026-07-26
**Estado:** diseño aprobado, pendiente de plan

> En castellano a propósito: su lector es quien lo aprueba. El código y la UI van en inglés.

## El problema, tal y como se vive

Tienes una nota larga sonando. Giras el cutoff. No pasa nada. El filtro solo se mueve
cuando llega la **siguiente** nota.

En un sintetizador analógico el filtro está siempre ahí, en el camino de la señal, y
oyes el barrido bajo la mano. En Loom, cada voz se hace una foto de los mandos en el
instante del disparo y ya no vuelve a mirarlos.

Lo curioso es que el camino para hacerlo bien **ya existe y funciona**: si pones un LFO
sobre el cutoff, ese LFO *sí* barre la nota que está sonando. El renderer recalcula el
filtro muestra a muestra cuando ve un desplazamiento de modulación
(`tb303-renderer.ts` `renderSample`). Lo que no tiene ese privilegio es tu mano.

Y hay un corolario que no es evidente: la **automatización grabada** de un mando viaja
por el mismo sitio (`commitParam` → `setBaseValue` → `setParams`), así que hoy tampoco
mueve una nota sostenida. Eso es un bug, no una decisión.

## Diagnóstico

Dos hechos del código, y el hueco entre ellos:

1. El bag de parámetros **sí llega vivo al worklet**. `LoomWorkletNode.setParams` postea
   el cambio y `VoiceManager.setParams` muta en sitio el objeto compartido de la pista.
   El dato correcto está ahí, en el instante en que mueves el mando.
2. Cada renderer **precalcula en su constructor**. `TB303Renderer` hace
   `this.baseCutHz = 80 * Math.pow(100, cutoff)` una vez y guarda el resultado. El
   Subtractive va más lejos: convierte el bag entero a su estructura interna
   (`subParamsFromBag`) una vez por voz.

Nadie relee. Ese es todo el bug.

## Alcance

### Motores

- **Dentro:** los 6 melódicos (TB-303, Subtractive, FM, Wavetable, Karplus, Westcoast) y
  el **Sampler**.
- **Fuera:** **Drums**. Un golpe de batería dura 100-300 ms; el gesto "muevo el mando y
  lo oigo" no existe ahí, y su camino de parámetros es distinto. No es una limitación
  técnica, es que no paga.

### Parámetros

**Continuos** (responden a mitad de nota) — todos los declarados `kind: 'continuous'` en
el `EngineParamSpec` de cada motor **menos** las exclusiones de abajo. En la práctica:
cutoff, resonancia, drive, key-track, niveles de oscilador / sub / ruido, color de ruido,
detune y afinación maestra, ancho de pulso, morph de wavetable, ratio e índice de FM,
fold y simetría del Westcoast, nivel de amplitud; y en el Sampler cutoff, res, nivel, pan
y los envíos de reverb y delay.

**Excluido nº 1 — los tiempos de envolvente** (`amp.attack/decay/sustain/release`,
`filter.attack/…`, `contour.attack/decay/amount`, `env.decay` del 303 donde aplique).

Hay una razón física, no de pereza. Un ADSR analógico es un condensador cargándose:
**integra**, tiene estado, y si le mueves el Decay a mitad de camino la pendiente cambia
*desde donde está*. Nuestros renderers calculan la envolvente con una fórmula cerrada
sobre "cuánto lleva sonando la nota". Si a los 200 ms de un ataque de 500 ms bajas el
ataque a 10 ms, la fórmula salta de 0.4 a 1.0 de golpe: **un clic**, no un gesto musical.

Hacerlos continuos de verdad exige reescribir las envolventes de los 9 motores como
integradores con estado. Es un proyecto aparte, con su propio riesgo de regresión.
Queda registrado como trabajo futuro, no como olvido.

> **Nota:** el TB-303 ya lee `env.decay` en vivo por la vía de la modulación, y ahí el
> cutoff es `base + (peak−base)·e^(−dt/decay)`. Ese comportamiento existente **no se
> toca**; la exclusión es sobre *añadir* nuevos tiempos de envolvente al conjunto
> continuo, no sobre retirar lo que ya funciona.

**Excluido nº 2 — los discretos** (forma de onda, algoritmo FM, modelo y tipo de filtro,
número de voces de unison, choke). Cambiarlos a mitad de nota es reconstruir el
oscilador. Ningún analógico lo hace tampoco.

### Presets

Un preset **también morphea la nota sonando** — decisión explícita del usuario. Si un
parámetro es continuo, lo es venga de donde venga: mano, preset, automatización o MIDI.
No hay marcado de origen. Los estructurales del preset siguen aplicándose al siguiente
disparo, como cualquier discreto.

## Arquitectura

### El punto de entrada ya es único

Todo lo que escribe un parámetro acaba en `WorkletLaneEngine.setBaseValue`, que guarda
el valor en `this.state` y lo postea al worklet. **No se toca nada del hilo principal.**
El arreglo entero vive del worklet hacia dentro.

### La pieza nueva: un deslizador con lista de activos

El `VoiceManager` gana un juego de parámetros *que persiguen a los reales*. Cuando llega
un `setParams`, el valor **objetivo** salta; el valor **efectivo** se desliza hasta él
con una constante de tiempo de ~15 ms.

El deslizamiento no es cosmético. Los mensajes de un mando llegan a golpes de ~16 ms; en
parámetros de amplitud (nivel, ganancia) un salto seco es una discontinuidad de señal, o
sea un clic audible. La rampa lo elimina, y de paso convierte el cambio de preset en un
barrido en vez de un corte.

**Cómo se recorre, que es lo que importa para el coste:** el deslizador mantiene una
lista de los parámetros que *aún se están moviendo*. Suavizar los ~30 parámetros en cada
muestra a 48 kHz sería inaceptable. Con la lista de activos, en reposo está vacía y el
coste es **cero** — el rendimiento de hoy, intacto. Al girar un mando entra un parámetro
durante ~15 ms y sale solo al converger.

Casos que la lista tiene que cubrir:

- **Arranque:** el juego efectivo se inicializa al valor real, nunca a cero. Un
  `setParams` inicial no debe producir una rampa desde el silencio.
- **Convergencia:** un parámetro sale de la lista cuando su distancia al objetivo cae
  por debajo de un épsilon, y se le asigna el objetivo exacto (si no, nunca sale).
- **Preset:** entran muchos parámetros a la vez; la lista los acepta todos y los suelta
  a los ~15 ms.

### Las voces dejan de fotografiar y pasan a mirar

Cada renderer parte sus parámetros en dos en el constructor:

- Los **estructurales** se copian a campos propios, como hoy: congelados al disparo.
- Los **continuos** se leen del objeto compartido del `VoiceManager` en cada muestra.

Dos puntos de cuidado por motor:

- **Subtractive:** hoy hace `subParamsFromBag` una vez por voz. Pasa a ser el
  `VoiceManager` quien posee esa estructura y la refresca — **una vez por pista, no una
  por voz**. Las voces la leen; cada una conserva aparte sus campos congelados.
- **TB-303 y compañía:** conversiones caras como `80·100^cutoff` se recalculan solo
  cuando el valor crudo ha cambiado. El deslizador ya sabe qué se está moviendo, así que
  puede decirlo sin coste añadido.

### La modulación no se mueve de sitio

Los renderers ya combinan `valor base + desplazamiento del modulador`. Lo único que
cambia es que el valor base deja de ser constante. Un LFO sobre el cutoff mientras giras
el mando **se suman**, que es lo correcto y lo que hace un analógico.

### El Sampler necesita una pieza extra

Sus parámetros viajan **dentro** del disparo (`SampleSpawn`), resueltos en el hilo
principal, y su processor no tiene mensaje de parámetros: solo `loadSample`, `spawn`,
`silence` y `kill`.

Hace falta:

1. Un mensaje nuevo de parámetros **por pad** hacia `sampler-processor`.
2. Una tabla viva de parámetros por pad en el processor, alimentada por ese mensaje.
3. Que `SamplerRenderer` lea de esa tabla (por su `padNote`) en vez de del `spawn`
   congelado, para los continuos.

El resto sale gratis: su renderer **ya lee** cutoff, res, nivel, pan y sends en cada
muestra; lo único congelado era el objeto del que los leía. `rate`, `offsetSec`, `loop`
y los de choke se quedan en el spawn — son propiedades del disparo, no del mando.

### Consecuencias previstas

- La **automatización grabada** pasa a mover notas sostenidas. Es el arreglo del mismo
  bug, y es deseado.
- El **render offline** debe reproducir el mismo deslizamiento, o los exports se
  desvían de lo que oyes. Como el deslizador vive en el `VoiceManager`, que el kernel
  offline ya usa, sale gratis — pero hay que verificarlo, no suponerlo.
- Los **sonidos existentes no cambian**: sin tocar un mando, la lista de activos está
  vacía y la salida es idéntica.

## Verificación

Todo es medible con el kernel puro (capa 3 del proyecto: se dirige el `VoiceManager`
muestra a muestra sin `AudioContext`). Aserciones **relativas**, como manda el proyecto.

Una prueba por camino de usuario, sin alternativas dentro de una misma prueba:

1. **El gesto funciona.** Nota larga sostenida: se mide el brillo de la primera mitad,
   se sube el cutoff, se mide la segunda. La segunda es claramente más brillante. El
   brillo se mide como energía de la señal derivada sobre energía total — barato y sin
   transformada de Fourier.
2. **Control negativo de la 1.** La misma nota sin tocar el mando da dos mitades
   equivalentes. Sin esto, la prueba 1 podría pasar por accidente.
3. **No hay clic.** El salto máximo entre muestras consecutivas alrededor del cambio no
   supera el que ya produce la propia forma de onda. Es la prueba que justifica el
   deslizador: sin él, falla.
4. **En reposo no cambia nada.** Sin tocar ningún mando, la salida es idéntica a la
   actual. Red de seguridad contra regresiones en los sonidos existentes.
5. **Lo estructural sigue congelado.** Cambiar la forma de onda a mitad de nota no
   altera la nota en curso; sí la siguiente.
6. **Las envolventes siguen fuera.** Cambiar el ataque a mitad de nota no altera la nota
   en curso. Esta prueba **protege** la exclusión del alcance de que alguien la deshaga
   sin querer.
7. **Sampler.** El patrón de 1+2 sobre una nota sostenida del Sampler.

Además, comprobación a oído en Chrome real (no el navegador de VS Code) antes de dar
esto por terminado: nota larga de TB-303, barrido de cutoff a mano, y un cambio de
preset con notas sostenidas.

## Trabajo futuro, explícitamente fuera

- **Envolventes como integradores con estado**, para que attack/decay/sustain/release
  sean continuos de verdad sin clics.
- **Drums**, si alguna vez aparece un caso de uso.
- **`rate` del Sampler en vivo** (varispeed a mano). Interacciona con warp y tempo-lock;
  merece su propia decisión.
