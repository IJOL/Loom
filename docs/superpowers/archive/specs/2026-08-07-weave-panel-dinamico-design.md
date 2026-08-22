# WEAVE — el panel dinámico

Fecha: 2026-08-07
Mockup aprobado: [2026-08-07-weave-panel-dinamico-mockup.html](2026-08-07-weave-panel-dinamico-mockup.html)

## Problema

Loom tiene mucho material y ninguna forma rápida de combinarlo. Hay 20 estilos
× ~20 patrones × 3 pools en la biblioteca importada
([pattern-library.ts](../../../../src/patterns/pattern-library.ts)), nueve motores,
más de veinte presets por motor melódico y 81 kits de batería. Combinar cuatro
canales son hoy ocho decisiones repartidas por el inspector, canal a canal, y el
resultado es **estático**: una vez elegido el patrón, el bucle se repite igual
hasta que alguien lo cambia a mano.

Lo que falta no es un atajo para elegir más rápido. Es que la escena **no deje
de moverse**: que un ritmo se funda en otro, que melodías y bajos fluyan de una
forma a otra, y que nada de eso desafine ni rompa el groove.

## Concepto

**WEAVE** es un panel que teje la escena en vivo. Cada canal tiene loops y una
posición entre ellos; mover esa posición cruza de un loop al siguiente de forma
continua. Encima, seis mandos musicales desplazan el conjunto. El resultado se
puede congelar en una escena nueva cuando algo suena bien, pero congelar es una
**salida**, no el objetivo: el estado natural del panel es el movimiento.

Es además el **primer añadido de Loom con interfaz propia**, y por eso obliga a
ampliar el catálogo de controles que el host sabe dibujar.

## Decisiones tomadas

| Decisión | Elección | Motivo |
|---|---|---|
| Qué hace el panel | **Genera y muta** | Siembra la escena y luego la retuerce; sin material de partida el panel no sirve de nada |
| Gesto principal | **Mandos macro musicales** | Un dado da saltos; un mando permite buscar. Y un mando es automatizable, un dado no |
| Ejes | **Densidad, Energía, Oscuridad, Espacio, Movimiento, Mezcla de estilos** | Los seis que Nacho eligió; ver §3 |
| Aplicación | **Capa viva + botón Fijar** | Los clips no se tocan mientras tejes; Fijar imprime el resultado |
| Dónde vive la curva de un macro | **Inspector de clip, como un destino más** | Cero infraestructura nueva: el painter ya existe |
| Mecanismo del fundido | **Esqueleto compartido + relevo por peso métrico** | Ver §1.1 — es lo que impide que el groove se caiga |
| Alturas | **Grados de escala, no semitonos** | Por construcción no puede desafinar |
| Topologías | **Las tres conviven, selector por canal** | Comparten contrato; ver §1.3 |
| Cuándo entra el cambio | **Continuo, mientras suena** | Es lo que significa «dinamismo extremo» |
| Nota ya sonando | **Termina siempre, en todos los canales** | Una regla, cero cortes; ver §1.5 |
| Armonía | **Versión mínima: no chocar** | Sin acordes; ver §1.4 |
| Estilo | **Global + el canal puede forzar** | Un mando para lo normal, una salida para mandar tú |
| Candado | **Congela sólo el bucle** | Los mandos generales siguen llegando, o la mezcla se descuadra |
| Fijar | **Escena nueva entera** | Foto completa del momento; sirve para montar un tema con las buenas |
| Controles nuevos | **Loom aprende a dibujarlos** | Un añadido que pinta libre puede tirar la aplicación |

---

## 1. El modelo musical

Todo el núcleo es **puro**: sin DOM, sin `AudioContext`, sin estado global. Es
lo que permite probarlo con aserciones relativas y sin renderizar audio.

### 1.1 El fundido de un patrón rítmico

Un patrón es un conjunto de golpes en posiciones de una rejilla. Fundir A → B
con una posición `x ∈ [0,1]` reparte los golpes en tres grupos:

- **Compartidos** (en A y en B): suenan siempre, en toda la travesía. Son el
  esqueleto, y es lo que impide que el compás se desarme a mitad de camino.
- **Sólo de A**: se van a medida que `x` sube.
- **Sólo de B**: entran a medida que `x` sube.

El orden del relevo lo decide el **peso métrico** de la posición, no el azar:

```
peso(s) = s ≡ 0 (mod 16) → 1.00     el uno
          s = 8          → 0.90     el tres
          s ≡ 0 (mod 4)  → 0.72     negras
          s ≡ 0 (mod 2)  → 0.50     corcheas
          resto          → 0.28     contratiempos
```

Un golpe de A **aguanta tanto más cuanto más fuerte es**, y uno de B **llega
tanto antes**:

```
saleEn(s)  = 0.14 + 0.72 · peso(s)      un golpe de A suena mientras x < saleEn(s)
entraEn(s) = 0.86 − 0.72 · peso(s)      un golpe de B suena cuando  x > entraEn(s)
```

Consecuencia buscada: los contratiempos de A se caen enseguida y el bombo del
uno es el último en irse, mientras que los golpes fuertes de B llegan primero.
En `x = 0.5` lo que suena es **un tercer ritmo** que no está en la biblioteca,
no una mezcla sucia de dos.

Las constantes `0.14`/`0.72`/`0.86` fijan que ningún golpe cambie de estado en
los extremos: en `x = 0` suena exactamente A y en `x = 1` exactamente B. Es un
requisito, no un ajuste estético, y hay un test por cada extremo.

### 1.2 El fundido melódico

Los ataques se relevan igual que en §1.1 — un patrón melódico también es un
conjunto de posiciones. Lo que cambia son las **alturas**.

Cada nota se convierte primero a **grado de escala** (`midiToScaleDegree` en
[musicality.ts](../../../../src/core/musicality.ts) ya lo hace), se interpola el
grado, y se vuelve a nota. El grado 1 de A camina hacia el grado 5 de B pasando
por el 3, y nunca por nada que esté fuera de la escala:

```
grado(x) = redondear( gradoA · (1 − x) + gradoB · x )
```

Interpolar en grados y no en semitonos es lo que hace que **por construcción**
no se pueda desafinar. No hay corrección posterior porque no hace falta.

Para un golpe que sólo existe en uno de los dos patrones no hay pareja con la
que interpolar: se queda con su propia altura y sólo entra o sale según §1.1.

**Percusión no se transporta nunca.** Una nota de batería elige una voz, no una
altura, así que en un canal de batería el fundido sólo mueve el conjunto de
golpes. Es la misma regla que ya respeta `patternNotes()`.

### 1.3 Las tres topologías, un solo contrato

Las tres emiten lo mismo — una posición — y de ahí que convivan sin coste:

| Topología | Qué emite | Qué hace |
|---|---|---|
| **A→B con reenganche** | un número `[0,1]` | Al llegar a 1, B pasa a ser el nuevo A, se sortea una B nueva del pool y la posición vuelve a 0. El viaje no termina nunca ni repite |
| **Cola** | un número `[0,1]` | Recorre una lista ordenada de N loops; siempre funde entre los dos vecinos de la posición. Finito y navegable a mano |
| **Nube** | **dos** números `[0,1]²` | Cuatro loops en las esquinas de un cuadrado; los pesos salen de la distancia al punto. Funde los cuatro a la vez |

El motor de fundido consume **una lista de (loop, peso)** que suma 1. A→B y cola
producen dos entradas; nube produce cuatro. Nada más las diferencia, así que una
cuarta topología en el futuro es un archivo nuevo, no un cambio del motor.

⚠️ **La nube ensucia el esqueleto compartido.** Con cuatro patrones a la vez, la
intersección de los cuatro suele estar vacía y el resultado tiende a papilla
rítmica. Se acepta a propósito porque en material melódico funciona bien; el
selector la ofrece en todos los canales y el usuario decide.

### 1.4 Armonía mínima: no chocar

Loom no sabe qué es un acorde y este spec **no se lo enseña**. Lo que sí hace:

- Un canal se marca como **jefe de armonía** (un interruptor en su fila; sólo
  uno a la vez). Por defecto ninguno, y entonces esta sección no hace nada.
- En cada instante el jefe tiene una **nota base**: la más grave que esté
  sonando en él.
- Al resto de canales melódicos se les prohíben dos intervalos contra esa base:
  el **semitono** (1) y el **tritono** (6). Una nota prohibida se empuja al
  grado vecino de la escala; si el vecino también choca, se deja como está —
  nunca se silencia una nota.

Es barato, se nota, y no bloquea nada: si más adelante hace falta armonía de
verdad, esta regla es un caso particular suyo y no hay que deshacerla.

### 1.5 La nota ya sonando

**Lo que ha empezado a sonar termina siempre.** El fundido sólo decide lo que
aún no ha empezado.

Sale gratis porque la decisión se toma **nota a nota, en el instante en que a
cada paso le toca sonar**, no recalculando el patrón entero: un golpe o se
dispara o no, pero jamás se interrumpe a medias. Es además la lección que Loom
ya aprendió cuando un límite de voces expulsaba voces vivas y se oían
chasquidos (ver CLAUDE.md, «Voice cap REMOVED»).

---

## 2. Estilo: global y forzado

- La escena tiene un **estilo base** (el `style` de `MusicalityState`, que ya
  existe).
- El macro **Mezcla de estilos** decide cuánto se desvía cada canal: en 0 todos
  tiran del estilo base; subiéndolo, los pools de otros estilos entran en el
  sorteo. La desviación es determinista dado `(semilla, índice de canal, mezcla)`
  para que rebarajar no cambie sola la escena al repintar una curva.
- Un canal puede **forzar** su estilo con su desplegable. Entonces el macro deja
  de afectarle, y su desplegable se marca en pantalla para que se vea por qué
  ese canal no se mueve con los demás.

## 3. Los seis macros

Cada macro es un valor `[0,1]` con un **valor neutro** declarado. Con los seis
en su neutro la capa es la identidad: suena exactamente el material que hay.

| Macro | Neutro | Dónde actúa |
|---|---|---|
| **Densidad** | 0.5 | Adelgaza (quita golpes por peso métrico ascendente) o engorda (subdivide notas existentes; nunca inventa alturas nuevas) |
| **Energía** | 0.5 | Velocity y acento — por encima de 100 dispara el acento que ya entienden 303 y batería |
| **Oscuridad** | 0.5 | Escala global (frigio → menor → dórico → mayor) y elección de preset por rasgo |
| **Espacio** | 0.0 | Envíos A/B — ya existen, cableado trivial |
| **Movimiento** | 0.0 | Profundidad de los LFO de motor y probabilidad de que un canal rebaraje al cerrar el bucle |
| **Mezcla de estilos** | 0.0 | De qué estilo sale el loop de cada canal (§2) |

Engordar es la operación arriesgada: **subdivide notas que ya están** (una negra
se parte en dos corcheas con la misma altura) y sólo rellena posiciones vacías
copiando la altura de la nota anterior. Así no puede meter una altura que no
estuviera ya en el compás.

Los seis se registran como **destinos de automatización**
(`weave.density`, `weave.energy`, …), de modo que aparecen solos en el selector
de destinos, en el pad XY y en el mapeo MIDI, porque los cuatro leen el mismo
catálogo. Eso obliga a un cambio contenido: hoy un identificador de destino se
descompone en dos ámbitos —motor de un canal e inserto— y hace falta un tercero
de ámbito sesión.

## 4. Automatización por pasos

El painter de automatización de clip sabe pintar formas de LFO (seno, triángulo,
sierra arriba, sierra abajo, cuadrada, aleatoria) con ciclos exactos, tamaño,
altura y fase, y tiene modo escalera. Le falta lo contrario: **dibujar los pasos
a mano**.

Se añade un segundo modo junto al LFO, en la misma fila plegable:

- Rejilla de N pasos (por defecto 16, editable) que se pinta arrastrando.
- **Escalón** (cada paso mantiene su valor) o **rampa** (interpola al siguiente).
- Atajos: `Rampa ↗`, `Rampa ↘`, `Invertir`, `Al azar`.
- El destino sale del catálogo de destinos, así que los macros de WEAVE son
  destinos válidos desde el primer día.

Comparte con el LFO la región pintada (el bucle si «Loop only» está activo, si
no el clip entero) y el mismo tramo de deshacer por gesto.

## 5. Longitud y tempo del bucle

Dos cosas distintas que hoy comparten un botón y no deberían:

- **Longitud**: `÷3 ÷2 ×2 ×3 ×1½`.
- **Al alargar**: **Repetir** (tesela el bucle y conserva el groove),
  **Estirar notas** (alarga las notas y cambia el carácter), **Repetir y variar**
  (tesela y aplica el fundido un poco más adelante en cada repetición, para que
  la segunda vuelta no sea idéntica).
- **Tempo del bucle**: `×0,5 ×1 ×1,5 ×2` más un valor libre, siempre disponible.
  Para material de audio esto es el estirado que ya existe; para material de
  notas es reescalar las posiciones.

## 6. Fijar

Congela lo que suena y lo convierte en notas editables **en una escena nueva
completa**, con todos los canales. La escena original no se toca, así que fijar
varias veces durante una sesión larga deja una fila de momentos que luego se
montan como partes de un tema.

Lo que se imprime es exactamente lo que se está oyendo: mismo fundido, mismos
macros, misma armonía. Si al reproducir la escena fijada suena distinto, es un
fallo, y hay un test que lo compara.

---

## 7. El panel

El mockup aprobado está en
[2026-08-07-weave-panel-dinamico-mockup.html](2026-08-07-weave-panel-dinamico-mockup.html)
y usa los tokens reales de Loom. **La paridad visual con él es criterio de
aceptación**: al terminar hay que abrir la pantalla de verdad, hacer captura y
compararla al lado.

De arriba abajo: cabecera (tono, escala, estilo base, BPM, Rebarajar, Fijar) ·
flujo maestro con deriva y velocidad · tabla de canales · los seis mandos ·
herramientas de clip · automatización por pasos.

Cada fila de canal lleva: piloto, nombre, **instrumento**, **preset**, estilo,
selector de topología (`A▸B` / `≡` / `◇`), el widget de tejido correspondiente,
candado y dado.

**El flujo maestro mueve los canales desfasados a propósito.** Que la batería y
el bajo no cambien a la vez es lo que quita la costura, y por eso el desfase es
el valor por defecto y no un extra.

## 8. WEAVE como añadido, y los tres controles nuevos

Hoy un añadido aporta DSP y un manifiesto que declara sus parámetros, y el host
construye los controles: mandos, interruptores, listas. WEAVE necesita tres que
no están en ese vocabulario, y **el host aprende a dibujarlos** en vez de abrir
la ventana a que el añadido pinte lo que quiera:

| Control | Emite | Para qué |
|---|---|---|
| `pad2d` | dos valores `[0,1]` | La topología en nube |
| `queue` | un valor `[0,1]` + nº de elementos | La topología en cola |
| `steps` | N valores `[0,1]` | La rejilla de pasos |

Los tres se declaran en el manifiesto igual que un mando: tipo, identificador,
etiqueta y sus datos propios. Son controles del **catálogo del host**, así que
cualquier añadido futuro los tiene disponibles y ninguno puede tirar la
aplicación pintando mal.

⚠️ **Verificado contra el código (2026-08-07, sobre `5612739`): hace falta más
de lo que decía este spec.** Dos puertas hay que abrir, no una:

1. **Un parámetro sólo puede ser `continuous` o `discrete`** — un número suelto
   ([manifest-validate.ts:19](../../../../src/plugin-host/manifest-validate.ts#L19)).
   `pad2d` emite dos valores, `queue` uno más un recuento y `steps` emite N.
   Ninguno de los tres es expresable hoy, así que el catálogo necesita **una
   forma de parámetro cuyo valor no sea escalar** antes que los controles.
2. **Un componente sólo puede ser `engine`, `modulator` o `fx`**
   ([manifest-validate.ts:103](../../../../src/plugin-host/manifest-validate.ts#L103)).
   WEAVE no es ninguna de las tres: no hace sonido, no modula y no procesa audio.
   Hace falta **una cuarta categoría** —un añadido que es un panel— con su sitio
   en la interfaz.

La segunda es la decisión de verdad: hoy cada categoría de añadido tiene un
hueco fijo (el motor en el canal, el modulador en su panel, el inserto en el
rack), y un panel no tiene hueco. Dónde vive WEAVE en pantalla es lo primero que
el plan tiene que resolver.

## 9. Módulos

Núcleo puro, un fichero por responsabilidad, ninguno cerca del tope de 300
líneas de código:

| Módulo | Responsabilidad |
|---|---|
| `weave/weave-catalog` | Los seis macros: identificador, etiqueta, neutro. Dato puro |
| `weave/metric-weight` | El peso métrico de una posición (§1.1) |
| `weave/blend-rhythm` | Fundir conjuntos de golpes con pesos |
| `weave/blend-melody` | Fundir alturas por grado de escala |
| `weave/topology-ab`, `-queue`, `-cloud` | Cada topología → lista de (loop, peso) |
| `weave/harmony-guard` | La regla de no chocar (§1.4) |
| `weave/macro-notes` | Densidad y Energía sobre las notas |
| `weave/macro-params` | Los otros cuatro macros → escrituras sobre destinos |
| `weave/style-mix` | Qué estilo le toca a cada canal (§2) |
| `weave/weave-state` | El estado del panel dentro de la sesión + su guardado |
| `weave/weave-runtime` | El pegamento con el planificador; decide nota a nota |
| `weave/print-scene` | Fijar (§6) |
| `weave/weave-panel` | La interfaz |

## 10. Pruebas

Una prueba por camino de usuario; nada de alternativas con «o». Aserciones
**siempre relativas**, según la regla del repositorio.

- **Fundido rítmico**: en `x=0` sale A exacto y en `x=1` B exacto; los
  compartidos están presentes en toda la travesía; el orden de salida respeta el
  peso (un contratiempo se va antes que el uno).
- **Fundido melódico**: toda altura resultante está en la escala, para 20
  posiciones de fundido y todas las escalas del catálogo.
- **Topologías**: las tres devuelven pesos que suman 1; A→B reengancha y no
  repite el mismo B dos veces seguidas.
- **Armonía**: sin jefe no se altera ninguna nota; con jefe desaparecen semitono
  y tritono contra la base y ninguna nota se silencia.
- **Nota en curso**: una nota disparada sigue sonando aunque su golpe salga del
  patrón en el instante siguiente.
- **Macros**: cada uno en su neutro deja las notas idénticas (control negativo);
  fuera del neutro las cambia.
- **Fijar**: la escena impresa reproduce lo mismo que sonaba.
- **Pasos**: pintar escribe en el envelope; escalón y rampa dan curvas distintas.
- **Panel**: un test por camino — cambiar topología, mover el fundido, candar,
  forzar estilo, marcar jefe de armonía.
- **Añadido**: un manifiesto editado a mano cambia lo que la aplicación muestra,
  como ya se comprueba para los inserts.

## 11. Fuera de alcance (a propósito)

- **Acordes y progresiones.** §1.4 es deliberadamente menos que eso. Si al oírlo
  hace falta, entra en un spec propio sin deshacer nada de éste.
- **Que un añadido pinte su propio DOM.** Se descartó frente al catálogo.
- **Generar la escena de cero por estilo y tonalidad.** WEAVE mastica lo que
  haya —un demo, un MIDI importado, algo montado a mano— y `Rebarajar` cubre el
  caso práctico. Un generador completo es otro spec.
- **Una cuarta topología.** El contrato la admite; nadie la ha pedido.

## 12. Verificación contra el código

Comprobado el 2026-08-07 sobre `5612739`, ya con la ronda de coherencia de
selección de lane dentro. Los cuatro puntos que este spec dejó abiertos:

### 12.1 El manifiesto — dos puertas, no una

Resuelto en §8. Resumen: un parámetro sólo puede ser `continuous` o `discrete`
(un escalar), y un componente sólo puede ser `engine`, `modulator` o `fx`. WEAVE
necesita **una forma de parámetro no escalar** y **una cuarta categoría de
componente**. Es el mayor riesgo del proyecto y la primera fase del plan.

### 12.2 El identificador de destino se parte por puntos, y eso muerde

`parseAutomationParamId`
([automation-apply.ts:24](../../../../src/automation/automation-apply.ts#L24))
devuelve `engine` o `insert`, y decide entre los dos buscando un segmento
`fx:<slot>`. **Sin ese marcador, todo lo demás cae en `engine` con el primer
segmento como identificador de canal.**

Consecuencia concreta: un destino llamado `weave.density` se interpretaría como
«el parámetro `density` del canal llamado `weave`». Un canal que no existe, así
que el valor no llegaría a ningún sitio y **no daría error** — se quedaría
inerte, que es el peor modo de fallo posible.

Por eso los macros **no pueden llamarse `weave.<id>` a secas**. Llevan marcador
explícito, con la misma forma que ya usa el rack: `session.weave:<id>`. Y el
parseo gana un tercer caso antes del actual, no después.

### 12.3 El sitio de la decisión nota a nota

`tickLane(clip, ctx)`
([lane-scheduler.ts:82](../../../../src/core/lane-scheduler.ts#L82)) recorre las
notas del clip con anticipación y dispara sólo las que entran en la ventana;
`noteTrigger` ([:214](../../../../src/core/lane-scheduler.ts#L214)) construye el
disparo. La decisión de §1.5 —«suena o no suena», nunca a medias— cuelga de ahí:
un filtro justo antes de `noteTrigger`, con la posición de fundido leída en ese
instante. Nada de recalcular el clip.

Esto confirma que §1.5 sale gratis: el planificador ya es nota a nota.

### 12.4 El painter no admite un segundo modo dentro de su fichero

[clip-automation-lanes.ts](../../../../src/session/clip-automation-lanes.ts) tiene
358 líneas físicas y ya aloja el panel, la plantilla de lane, la región, la fila
del LFO y la barra de pinceles, con un `lfoState` compartido a nivel de módulo.
El modo de pasos **cabe en la fila plegable pero no en el fichero**: va en un
módulo propio que exporta su plantilla y su estado, y la fila plegable elige
entre los dos.

Es la misma lección que dejó la ronda de inserts: cuando un fichero ya tiene
cinco responsabilidades, la sexta se escribe al lado.
