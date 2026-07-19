# Registro maestro de destinos de automatización

**Fecha:** 2026-07-19
**Estado:** diseño aprobado, pendiente de plan

> Este documento está en castellano a propósito: su lector principal ahora mismo
> es Nacho, que tiene que aprobarlo. El código y la UI siguen en inglés.

## El problema, tal y como se vive

Cuatro pantallas de Loom te dejan elegir "qué parámetro quiero gobernar", y cada
una se fabrica su propia lista de una forma distinta:

1. El desplegable de destino de un LFO/ADSR.
2. Las curvas de automatización dentro de un clip.
3. El XY pad.
4. La cabecera "+ Automation" de la vista Performance.

A ellas se suman dos piezas relacionadas: la superficie MIDI (APC Key 25), que
no construye lista ninguna porque tiene los parámetros escritos a mano en el
perfil, y el registro de knobs, que es infraestructura y hoy se usa como si
fuera un catálogo.

De ese reparto salen seis fallos que el usuario sí nota:

- Metes un insert de filtro y un LFO que ya existía no lo ve.
- Cargas una sesión y no puedes modular nada de un canal cuyo panel no hayas
  abierto: existe en el proyecto, pero no en la lista.
- **Borras un insert y las modulaciones que apuntaban a los siguientes de la
  cadena se redirigen en silencio a otro efecto.** El sonido cambia sin
  explicación. Es el peor de los seis y está en producción.
- Un parámetro automatizable con una curva de clip no es modulable con un LFO,
  y al revés. Son dos listas que no se hablan.
- El XY pad ofrece efectos ya borrados.
- El APC no alcanza ningún parámetro de efectos, solo los del sintetizador.

Nota sobre el tercero: `InsertChain` expone `reorder(from, to)`, pero **la
interfaz no ofrece reordenar hoy** — solo bypass y borrar. El disparador real es
borrar, que desplaza a los siguientes. Si algún día se añade reordenar, el mismo
fallo se multiplica.

## Qué gana el usuario

**Cualquier parámetro visible pasa a ser gobernable por las cuatro vías**: LFO,
curva de clip, XY pad y APC. Hoy cada vía alcanza un subconjunto distinto y
ninguna las alcanza todas.

Además: un efecto recién añadido aparece al instante en todas partes sin abrir
nada, y borrar uno de la cadena deja de romper las modulaciones de los demás.

## Origen de la deuda

No es código heredado. Las listas se escribieron en sesiones distintas de Claude,
una por función nueva (automatización de clip, XY pad, APC, inserts). Cada vez la
decisión local fue razonable; nunca se paró a mirar que ya había otras haciendo
lo mismo.

La lección ("los destinos se derivan del proyecto, no de los mandos dibujados")
se aprendió el **2026-07-18** en el commit `61b516c`, se aplicó a **una** de las
cuatro pantallas y quedó escrita solo en la cabecera de un fichero. Ver
"Prevención" al final.

## Diseño

### 1. Una sola lista, derivada del proyecto

`listAutomationTargets()` en `src/automation/automation-targets.ts` pasa a ser la
única fuente. Ya funciona así y ya la usa la automatización de clip: recorre
`SessionState` (los lanes que existen y los inserts que declaran) y pregunta a
cada motor y a cada plugin qué parámetros continuos ofrece.

Lo que cambia es que las otras tres pantallas dejan de fabricarse la suya, y que
el APC pasa a poder consultarla en vez de tener los parámetros escritos a mano.

**El registro de knobs queda degradado.** Hoy se usa como catálogo; pasa a
usarse solo para dos cosas: dar la etiqueta y el rango que el usuario ve en
pantalla cuando el mando está montado, y ser el sitio por donde se escribe un
valor. Deja de decidir *qué existe*.

### 2. Un solo formato de id, y estable

Formato único: `<scopeId>.<paramPath>`, con `scopeId` ∈ `<laneId>` |
`fx.master` | `fx.send.<id>`.

Para params de insert: `<scopeId>.fx:<slotId>.<paramId>`.

Desaparecen:

- `lane-insert-<idx>:<param>` y `master-insert-<idx>:<param>` (solo los usaba
  modulación, y no sabían direccionar inserts de send).
- El posicional `<scopeId>.fx<idx>.<param>` (se sustituye por `fx:<slotId>`).
- El alias sin prefijo de lane que hoy acepta el binder de modulación.

Consecuencia buscada: un mismo id sirve para modular **y** para automatizar.

### 3. Cada insert con identidad propia

`InsertSlot` (en `src/session/insert-slot.ts`) gana `id: string`, generado al
crear el insert. Hoy la identidad de un efecto es su posición en el array, y por
eso borrar uno redirige lo que apuntaba a los siguientes.

Los slots ya guardados se rellenan al cargar, junto al normalizador que ya
existe (`saved-state-v3.ts` ya hace ahí `lane.inserts ??= []`). Las conexiones
de modulación y las curvas guardadas con formato posicional se traducen **una
vez** al cargar, por posición, y a partir de ahí quedan estables. El usuario no
hace nada y no pierde nada.

### 4. Un solo resolvedor

Hoy hay seis caminos distintos para convertir un id en algo escribible:
`voice-mod-binding`, `automation-apply`, `automation-tick`,
`performance-feature`, `xy-pad` y `loom-facade`. Los sustituye un único
`resolveDestination(id)`.

Para evitar ambigüedad: es **una función con tres formas de resolución
explícitas**, no una que adivine. El llamante pide la que necesita —el
`AudioParam` para el binder de modulación, el `setBaseValue` para la
automatización offline, o el `KnobHandle` para el XY pad— y recibe `null` si ese
destino no admite esa forma.

Es la pieza que hace posible que modulación y automatización compartan destinos.

### 5. Aviso de cambios

La lista expone `subscribe(fn): () => void` e `invalidate()`.

`subscribe` sigue **exactamente** la forma que el proyecto ya usa cuatro veces
por separado (`sidechain-bus`, `auto-history`, `active-lane`,
`controller-profile`): te suscribes y te devuelve tu propia función de baja.
No se añade nada al mecanismo alternativo de `document.dispatchEvent(...)` que
usa el Sampler — es global, sin tipos y sin disciplina de baja.

**Quién llama a `invalidate()`:** los sitios que mutan la estructura, no los que
la dibujan. Añadir/quitar un insert, añadir/quitar un lane, cambiar el motor de
un lane, cargar una sesión. Son pocos y están localizados. Es la inversión
clave: quien cambia algo solo anuncia que cambió, y no necesita saber quién
escucha.

**Riesgo real: acumulación de suscripciones.** El proyecto redibuja paneles
haciendo `innerHTML = ''` en 48 sitios de 34 ficheros. Eso borra el DOM pero no
las suscripciones, así que un panel reconstruido diez veces deja diez
suscripciones vivas apuntando a paneles muertos: fuga de memoria y redibujados
duplicados. El árbol ya lo sufrió (`performance-ui.ts:295`,
`session-inspector.ts:101`).

Mitigación: cada consumidor ata sus suscripciones a un `AbortController` con la
vida del panel, siguiendo el patrón que ya usa `session-inspector.ts:258`.

**Red de seguridad:** además, cada desplegable reconstruye sus opciones al
abrirse. Es redundante a propósito: si un consumidor futuro olvida suscribirse,
el fallo degrada a "se actualiza al abrirlo" en vez de "no se actualiza nunca".

## Alcance

**Se migran los cuatro desplegables, la superficie MIDI y los seis caminos de
resolución** (decisión explícita del usuario: todos de una vez, no por fases de
producto).

**Fuera de alcance:** los ficheros gordos (`main.ts` con 1452 líneas y otros
nueve por encima del tope de 500 de CLAUDE.md). Es deuda real y separada;
meterla aquí convierte un refactor acotado en uno sin fondo.

## Pruebas

Pruebas de **comportamiento**, no de conformidad:

- Por cada desplegable: "añado un insert → esta pantalla lo ofrece". Es la
  prueba que se escribió el 2026-07-19 para el desplegable del LFO y que habría
  cazado el fallo real.
- Borrar un insert de la cadena no cambia a qué apunta una modulación que
  apuntaba a otro insert posterior.
- Borrar un insert retira sus destinos de todas las pantallas.
- Un mismo id se resuelve correctamente por las dos vías (modulación y
  automatización).
- Traducción al cargar: una sesión guardada con ids posicionales conserva sus
  modulaciones apuntando al mismo efecto.

**Descartado explícitamente:** una prueba que exija que las cuatro pantallas
devuelvan la misma lista. Si el diseño funciona, las cuatro llaman a la misma
función, así que sería comprobar que una función devuelve lo mismo llamándola
cuatro veces: no puede fallar salvo sabotaje, y son cuatro ficheros de lastre
que no atraparían nada.

## Prevención

El diseño no impide por sí solo que una sesión futura vuelva a fabricarse una
lista aparte. Un sitio único hace que lo correcto sea lo cómodo; nada más.

La medida acordada es documental y va en **memoria + un documento referenciado
desde CLAUDE.md**, no en un comentario de cabecera: el fallo consiste
precisamente en no abrir ese fichero.

Honestidad sobre su fuerza: CLAUDE.md ya tiene la regla de "máximo 500 líneas" y
hay diez ficheros que la incumplen. Pero se espera que ésta se cumpla mejor,
porque salta una sola vez —al ir a construir una lista de parámetros— y dice qué
hacer en su lugar, en vez de exigir vigilancia continua.

## Riesgos abiertos

1. Superficie amplia: cuatro desplegables, la superficie MIDI y seis caminos de
   resolución. Va troceado en varios commits, no en uno.
2. La traducción de ids al cargar es el único punto que toca datos guardados. Si
   se hace mal, un usuario pierde asignaciones de modulación.
3. La disciplina de bajas de suscripción es el punto donde más fácil es
   introducir una fuga.
