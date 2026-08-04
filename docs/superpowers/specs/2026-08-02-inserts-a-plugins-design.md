# Trozo 3, fase 3 — los inserts salen del árbol

**Estado:** aprobado por Nacho el 2026-08-02. Worktree `plugins-inserts-notefx`,
rama `worktree-plugins-inserts-notefx`, rebasada sobre `main` = `ceb5741`.

Continuación directa de
[2026-08-02-motores-a-plugins-fase-2-design.md](2026-08-02-motores-a-plugins-fase-2-design.md),
**mergeada en `main` el 2026-08-03**. Numeración: fase 1 = params por índice +
Karplus; fase 2 = los cinco melódicos; **fase 3 = los inserts** (ésta); la
siguiente, los note-FX. Quedan fuera del trozo 3 tal como está escrito hoy los
tres motores que siguen integrados (`sampler`, `audio`, `drums-machine`).

**Esta es la primera de dos rebanadas.** Aquí van los **inserts**; los note-FX
(arp y chord) van en la siguiente, que se apoya en la ABI que ésta deja hecha.
Se trocearon así porque comparten una sola cosa —la puerta de la ABI— y por lo
demás son registros, UI y riesgos distintos: la de inserts entra verde pronto,
la de note-FX carga sola con el rediseño del panel.

## 0. Lo que la fase 2 ya dejó hecho, y lo que sigue pendiente

La fase 2 se escribió y se mergeó **mientras se redactaba este spec**: 14
commits, 203 ficheros, `main` de `6fdeaab` a `ceb5741`. Eso desbloquea esta
rebanada, que estaba secuenciada detrás, y cambia tres cosas de lo que aquí se
daba por futuro.

**Lo que ya existe y esta rebanada REUTILIZA en vez de inventar:**

- **El contrato de "componente no instalado", implementado y verificado a oído.**
  Vive en cuatro sitios: [lane-allocator.ts:281](../../../src/app/lane-allocator.ts)
  (la pista se aloja igual — conserva su `ChannelStrip` y su `InsertChain` — y
  sólo le falta el motor), [session-grid-templates.ts:116-135](../../../src/session/session-grid-templates.ts)
  (un `⚠` en la cabecera de la pista, con `title` explicando que los ajustes
  siguen ahí), [session-host-lane-editor.ts:146-152](../../../src/session/session-host-lane-editor.ts)
  (*"Engine not installed: `<id>`"* en lugar de una página vacía) y
  [session-host-persistence.ts:90](../../../src/session/session-host-persistence.ts)
  (guardar no pierde los ajustes del componente ausente).
- **El SDK ya publica los primitivos de síntesis**: `osc`, `ladder`, `filter`,
  `unison`, `fold`, `sync-osc`, `comb`, `filter-stack`, además de `adsr`,
  `mod-env-host`, `util` y `velocity`.
- **`EngineParamSpec` ya sabe expresar casi todo lo que un insert necesita**:
  `curve`, `color`, `drawnBy`, `selectStyle`, `showLabel` y `optionsFrom`
  (opciones de un control que dependen del valor de otro — el mecanismo que
  Subtractive estrenó con Mode×Type). Un insert-plugin los hereda gratis.
- **`vitest.config.ts` recoge ahora también `test/**/*.test.ts`**, y `tools/`
  entró por fin en el `include` de `tsconfig.json`.

**Lo que sigue pendiente, y por qué NO se arregla aquí:**

- **El aviso no distingue *no instalado* de *falló al cargar*.** `loadPlugins`
  anota los segundos en `report.failed`, pero el contrato de §0 sólo pregunta si
  hay componente registrado. Esta rebanada **hereda la carencia tal cual** y no
  la agranda: el mensaje del hueco de insert dirá lo mismo que dice hoy el de la
  pista.

**Lección de su ejecución que esta rebanada aplica desde el primer día:** el
aviso de motor ausente *"sólo se veía al ABRIR la pista"*, y lo destapó un e2e,
no una lectura del código. El equivalente aquí es el hueco de insert: se verifica
**donde el usuario mira**, con su propio e2e, no sólo en el sitio donde es fácil
escribirlo.

## 1. Qué se construye

Los once inserts dejan de vivir en [`src/plugins/fx/`](../../../src/plugins/fx/)
y pasan a ser **plugins externos**, una carpeta por efecto en `plugins/<id>/`,
cargados en runtime. Sueltas la carpeta y el efecto aparece en el desplegable;
la borras y desaparece — sin que eso te descoloque el rack ni te borre los
ajustes guardados.

Y entran **cuatro inserts nuevos**, que nacen ya como plugin de disco y no pisan
`src/` en ningún momento: **auto-wah**, **puerta / moldeador de golpe**,
**anchura estéreo / auto-pan** y **modulador en anillo**.

"Instalable" aquí significa *dejar la carpeta y recargar*. **No hay instalador
de UI, ni descarga, ni gestor de plugins** — eso es el trozo 4.

## 2. Hechos verificados en el código

Tomados el 2026-08-02 sobre `820744d` y **re-verificados el 2026-08-03 sobre
`ceb5741`**, después de que la fase 2 mergease. Ninguna línea de esta sección es
una suposición.

De los 203 ficheros que la fase 2 movió, **ni uno solo** está en
`src/plugins/fx/`, `src/plugin-host/`, `src/notefx/`,
`src/session/lane-insert-ui.ts`, `src/session/insert-slot.ts`, `src/core/fx.ts`,
`src/core/send-migration.ts` ni `tools/loom-plugin/`. Dentro de `src/plugins/`
tocó **sólo** `capabilities.ts`. La superficie de esta rebanada llegó intacta.

### 2.1 La puerta de los inserts ya está casi abierta

`node tools/plugin-id-census.mjs --group fx` da **0 menciones en producción**: el
core no decide ni un solo comportamiento comparando el id de un efecto. Sólo
quedan cuatro líneas de la categoría "nombra", en dos ficheros, más una tabla que
el censo **no ve**:

| dónde | qué hace | destino |
| --- | --- | --- |
| [core/fx.ts:30-31](../../../src/core/fx.ts) | siembra `delay` y `reverb` en los buses de envío A y B | se mueve detrás de `pluginsReady` (§3.4) |
| [core/send-migration.ts:6-7](../../../src/core/send-migration.ts) | el estado por defecto de los envíos nombra `pluginId: 'delay'` y `'reverb'` | **se queda** (§3.4) |
| [lane-insert-ui.ts:39-47](../../../src/session/lane-insert-ui.ts) | `FX_COLORS`, tabla escrita a mano que cubre 6 de los 11 y da ámbar al resto | capacidad `color` del manifiesto |

La tercera fila **no la cuenta el censo**, porque sus claves van sin comillas
(`multifilter: '#ffa726'`) y el patrón sólo reconoce el id entrecomillado. Es un
recordatorio de la regla que la rebanada B pagó cara: *mira QUÉ cuenta un número
antes de aceptarlo*. Un censo en 0 no es lo mismo que un core que no sabe nada.

Los inserts ya se descubren y se instancian por un registro genérico
(`listPlugins('fx')` / `createInstance('fx', id, ctx)`) y sus mandos ya se pintan
desde `manifest.params`. La UI del rack **no cambia de forma**: cambia de dónde
salen los datos que ya consume.

### 2.2 Un insert es main-thread puro

Los once son nodos nativos de Web Audio construidos sobre el `AudioContext` que
el host pasa a `create(ctx)`. **Ninguno usa AudioWorklet** (verificado: sólo
`createWaveShaper`, `createBiquadFilter`, `createDelay`, `createStereoPanner`,
`createDynamicsCompressor`, osciladores y ganancias). Un insert-plugin es por
tanto **más simple que un motor**: carpeta con `plugin.json` y `main.js`, sin
`dsp.js` y sin nada que registrar en el worklet.

El render offline vive en el mismo realm del hilo principal, así que **el export
sale gratis**: no hay un segundo sitio donde registrar nada.

### 2.3 Los ayudantes compartidos

| fichero | lo usan |
| --- | --- |
| `src/plugins/fx/modulated-delay.ts` (95 líneas) | chorus, flanger |
| `src/plugins/fx/reverb-ir.ts` (167 líneas) | reverb |

Ambos son primitivos genéricos, no la identidad de un efecto concreto. Por la
regla que la fase 2 fijó en su §3.3 —*"¿cabe en cualquier plugin de su tipo?"*—
suben a `packages/loom-plugin-sdk/src/dsp/`, que tras la fase 2 ya publica
`osc`, `ladder`, `filter`, `unison`, `fold`, `sync-osc`, `comb` y `filter-stack`
junto a `adsr`, `mod-env-host`, `util` y `velocity`.

Con sus tests: `reverb-ir.test.ts` existe; `modulated-delay.ts` **no tiene test
propio**, así que el plan le escribe uno **antes** de moverlo. Subirlo desnudo lo
convertiría en API pública sin cobertura, y ésa fue exactamente la regla que la
fase 2 aplicó a `unison` y `fold`.

**Ojo a la asimetría**: los primitivos del SDK que subió la fase 2 son DSP puro
por muestra, sin `AudioContext`. Estos dos **construyen nodos de Web Audio**.
Conviven en la misma carpeta pero no son la misma clase de cosa, y el plan lo
hace explícito al colocarlos — un tercero que abra `dsp/` tiene que poder
distinguir "esto corre en el worklet" de "esto te fabrica un grafo".

### 2.4 Dos fallos vivos hoy en `main`

**(a) Un hueco que falta descoloca a los siguientes.**
[insert-slot.ts:39-51](../../../src/session/insert-slot.ts) dice por escrito
*"Slots that reference an unknown plugin id are silently skipped"*. Pero el rack
empareja **por posición**: [lane-insert-ui.ts:80-99](../../../src/session/lane-insert-ui.ts)
recorre `chain.list()` y saca los datos de `slots[idx]`. Si el hueco 2 de 5 se
salta, la cadena tiene 4 elementos y la lista de huecos 5: los tres siguientes se
pintan con el nombre, el color y los mandos del vecino. Hoy sólo se alcanza
editando un guardado a mano; **en cuanto un insert sea desinstalable se alcanza
por diseño**.

**(b) Los buses de envío nacen antes que los plugins.**
[core/fx.ts:24-38](../../../src/core/fx.ts) siembra `delay` y `reverb` de forma
**síncrona** en el constructor de `FxBus`; `loadPlugins()` es **asíncrona**. Con
esos dos convertidos en plugins, los envíos A y B nacen vacíos y en seco. Es el
mismo fallo de orden que ya hizo que Karplus no saliera en el selector de motores
(el arreglo fue repintar en `pluginsReady`).

### 2.5 Los note-FX no entran aquí, y por qué

Censo `--group notefx`: **4 decisiones por nombre en producción**
(`notefx-chain.ts` ×2, `notefx-ui.ts`, `control/live-notefx.ts`), `NoteFxKind` es
una unión cerrada `'arp' | 'chord'`, y su panel está escrito **a mano control por
control** (`ARP_PATTERNS`, `ARP_SCALES`, `ARP_RATES`, `CHORD_TYPES` son constantes
del fichero de UI). Convertirlos exige **inventar un panel genérico que hoy no
existe**, con parecido visual que hay que verificar con los ojos. Rebanada aparte.

Dato para esa rebanada, ya comprobado: los ajustes de un note-FX **no son
automatizables ni modulables** (cero menciones de `notefx` en `src/automation/` y
`src/modulation/`), así que no están obligados al convenio numérico por índice que
sí ata a los mandos de motor y de insert.

## 3. Las decisiones de diseño

### 3.1 Un insert entra por la ABI como `kind: 'fx'`

`ComponentManifest` gana un tercer miembro, hermano de `'engine'` y `'modulator'`:

```ts
| (ComponentManifestBase & { kind: 'fx'; fx: FxDeclaration })
```

donde `FxDeclaration` declara **una sola cosa que el manifiesto no tuviera ya**:

- `color` — el color de la unidad en el rack. Sustituye a `FX_COLORS`, que hoy
  sólo conoce 6 de 11. **Obligatorio**: si fuera opcional, los cinco efectos que
  hoy caen en el ámbar por defecto seguirían pareciendo una decisión cuando son
  un olvido.

**Es un TERCER sitio donde vive un color, y hace falta justificarlo**, porque el
manifiesto ya tiene dos: `EngineParamGroup.color` (el color de una sección del
editor, que es donde viven de verdad los colores de los motores) y
`EngineParamSpec.color` (el anillo de un mando suelto). Ninguno de los dos sirve
aquí: el rack pinta la unidad **entera** —el punto, el nombre y la variable CSS
`--fx-color` del recuadro— y un insert **no tiene secciones**. Su unidad es un
solo objeto visual, así que su color es del componente, no de un grupo que no
existe ni de un mando concreto. Es la razón por la que se añade en vez de
reutilizar; si algún día un insert declarase grupos, el color de grupo mandaría
dentro de ellos y éste seguiría siendo el del recuadro.

`params` ya vive en `ComponentManifestBase` y ya es la fuente de los mandos del
rack. Y tras la fase 2 esa base sabe expresar `curve`, `drawnBy`, `selectStyle`,
`showLabel` y `optionsFrom` — un insert los hereda sin pedir nada nuevo, así que
el rack puede tener por fin mandos con curva logarítmica y desplegables cuyas
opciones dependan de otro control (por ejemplo, el tipo de respuesta de un filtro
según su modo). Los presets, si los hay, viajan por el campo `presets` del
**fichero** de manifiesto, que es de plugin y no de componente — igual que hoy
con Karplus.

**El código que fabrica los nodos no cabe en un JSON**, así que viaja por una
llamada aparte, calco exacto de `registerRenderer`:

```ts
Loom.registerFx(id, (ctx: AudioContext) => FxInstance)
```

Se instala **sólo en el hilo principal** (`installMainThreadLoomApi`): un insert
no tiene mitad en el worklet. `adoptFx` registra en el registro que ya existe
(`registerPlugin({ kind: 'fx', manifest, create })`), **no en uno paralelo** —
`listPlugins('fx')`, `getPlugin('fx', …)` y `createInstance('fx', …)` siguen
siendo la única puerta, y el rack, la automatización y el binder de modulación no
se enteran de que el efecto viene de fuera.

### 3.1b La ficha manda: se lee, se comprueba y se obedece la MISMA

**Decisión de Nacho, 2026-08-03**, contra mi propuesta de aplazarlo. Entra en el
andamiaje de esta rebanada.

**El problema.** Al empaquetar, `plugin.json` queda fotocopiado dentro de
`main.js`. Al arrancar, el host lee el fichero, comprueba que está bien escrito,
**lo descarta** y ejecuta la fotocopia. Revisa un papel y obedece otro. Mientras
el plugin lo empaquete uno mismo los dos son idénticos y da igual; en un mundo
donde alguien suelta una carpeta ajena y toca su ficha, editas lo que el host
revisa y no cambia nada.

**El arreglo.** `loadPlugins` ya tiene el manifiesto validado en la mano
(`verdict.manifest`): adopta sus componentes él mismo, y `main.js` pasa a aportar
**sólo código**. `Loom.registerComponent` desaparece de la ABI.

**Por qué es barato — verificado fichero a fichero el 2026-08-03**, después de
haberlo dimensionado mal dos veces:

- Los **ocho** `main.ts` de `plugins/` (`tb303`, `subtractive`, `fm`, `wavetable`,
  `westcoast`, `karplus`, `sh`, `audio-probe`) son **idénticos**: una sola línea
  de código, `Loom.registerComponent(manifest.components[0])`, más comentarios.
  **Se borran enteros.** No hay un noveno caso escondido.
- El `dsp.js` —el único código de verdad que llevan hoy— viaja por un camino
  aparte (`plugin-dsp.ts`, a las dos realidades) que esto no toca.
- [`test/plugin-fixtures.ts`](../../../test/plugin-fixtures.ts) deja de dar el
  rodeo por el global y llama a la adopción del host directamente: una línea, y
  además pasa a usar exactamente la misma puerta que producción.
- `main` deja de ser obligatorio en la ficha: validador
  ([manifest-validate.ts:116](../../../src/plugin-host/manifest-validate.ts)),
  empaquetador y generador de plugins nuevos.

**Lo que se gana además del arreglo**, y es la razón de que encaje justo aquí:

1. **Cada fichero pasa a significar una cosa.** La ficha es DATOS; `main.js` es
   código del hilo principal; `dsp.js` es código del worklet. Hoy la ficha está
   en dos sitios y `main.js` es un fichero que existe para repetirla.
2. **Los inserts nacen ya con la forma buena.** Un insert-plugin **sí** necesita
   `main.js` —ahí va `Loom.registerFx(id, create)`, que es una función y no cabe
   en un JSON— pero ya no lleva la ficha fotocopiada dentro. Si el arreglo llegase
   después, los 15 inserts nacerían con el vicio y habría que repasarlos.
3. **Un plugin roto puede fallar RUIDOSAMENTE.** Con la ficha en la mano antes de
   ejecutar nada, el host sabe qué componentes DEBERÍA entregar el plugin. Un
   `kind: 'fx'` declarado cuyo `main.js` nunca llama a `registerFx` es un plugin
   incompleto, y se anota en `report.failed` en vez de aparecer en el desplegable
   y no hacer nada al insertarlo. Es exactamente el modo de fallo que este repo se
   ha comido tres veces: no crashear está bien, quedarse mudo no.

**Orden dentro del arranque, que es lo único delicado:** el host adopta los
componentes de la ficha **antes** de ejecutar `main.js`. Así, cuando llega
`registerFx(id, create)`, el componente ya existe y la llamada sólo le engancha su
fábrica. Un `registerFx` con un id que la ficha no declara es un error del plugin,
no un registro silencioso.

### 3.2 `FxInstance` tiene un solo dueño: el SDK

La forma que debe cumplir un efecto (`input`, `output`, `getAudioParams`,
`getAudioParamRange`, `getBaseValue`, `setBaseValue`, `applyPreset`, `setBpm`,
`dispose`) pasa a `packages/loom-plugin-sdk/`, y `src/plugins/types.ts` la
reexporta en una línea.

Es literalmente la lección de la rebanada B: existían **dos** interfaces `ModLite`
—una del runtime y otra del SDK— y la conclusión fue que quien escribiese el
plugin cogería la equivocada. Declarar `FxInstance` en los dos sitios repetiría el
error a sabiendas.

### 3.3 Insert no instalado: se ve, deja pasar y conserva

Reutiliza el contrato que la fase 2 **ya implementó** para motores (§0), aplicado
al rack. El paralelismo es exacto y conviene verlo en columnas, porque es lo que
impide que salgan dos mecanismos para lo mismo:

| | motor ausente (ya en `main`) | insert ausente (esta rebanada) |
| --- | --- | --- |
| se aloja igual | la pista conserva strip e insert chain (`lane-allocator.ts:281`) | el hueco conserva su `id` y sus `params` |
| se ve donde el usuario mira | `⚠` en la cabecera de la rejilla | unidad apagada en el rack |
| lo dice al abrir | *"Engine not installed: `<id>`"* en el editor | `⚠ <id> (not installed)` en la unidad |
| guardar no pierde | `session-host-persistence.ts:90` | los `params` se re-guardan intactos |

Aplicado:

- `rehydrateInsertChain` **deja de saltarse** el hueco. Mete un **tapón**: un
  `FxInstance` que conecta su entrada a su salida y no hace nada más, portando el
  `id` y los `params` del hueco **intactos**.
- El rack lo pinta como unidad apagada: `⚠ <id> (not installed)`, sin mandos, con
  su × para quitarla **si el usuario quiere**. Texto en inglés, como toda la UI.
- **Guardar no pierde nada**: los `params` del hueco se re-guardan tal cual.
  Desinstalar un plugin no puede borrar ajustes.
- **Un aviso por consola, una vez por id ausente**, no uno por hueco. Que no
  crashee está bien; que se calle, no.
  ⚠️ **No distingue *no instalado* de *falló al cargar***, y es deliberado: el
  contrato de motor que ya está en `main` tampoco lo distingue (§0), y añadir esa
  distinción sólo en el rack de inserts crearía dos comportamientos para la misma
  pregunta. Se arregla en los dos sitios a la vez, en su propia rebanada.
- **El emparejamiento del rack pasa a hacerse por el `id` del hueco, no por su
  posición.** Con el tapón las dos listas vuelven a ir 1:1 y el síntoma
  desaparece, pero emparejar por posición es el fallo de raíz (§2.4a) y es la
  regla que este repo ya aprendió con el registro de destinos: *la posición no es
  identidad*.

### 3.4 La siembra de los envíos se mueve detrás de `pluginsReady`

`FxBus` deja de sembrar en su constructor. La siembra pasa al mismo gancho que ya
usa el repintado del selector de motores. Y si el `delay` o la `reverb` no están
instalados, **el bus nace vacío y deja pasar el sonido en seco**: es la
consecuencia honesta de haberlos hecho desinstalables, y no se disimula con un
sustituto silencioso.

`src/core/send-migration.ts` **se queda como está**, nombrando `'delay'` y
`'reverb'` en el estado por defecto de los envíos. No es el core decidiendo por
un nombre: es **vocabulario de datos guardados**, igual que un preset que trae su
propio modulador. La regla que la rebanada B dejó escrita se aplica tal cual:
*lo que sólo se USA se puede quitar; lo que además se REFERENCIA desde datos
guardados, no*. Aquí la referencia sobrevive a la desinstalación porque el hueco
se convierte en el tapón de §3.3 en vez de desaparecer.

### 3.5 Los cuatro inserts nuevos

Todos nativos. **Ninguno abre la puerta de "un insert con DSP dentro del
worklet"** — eso sería otra rebanada, con su propia clase de processor.

| insert | qué hace | mandos |
| --- | --- | --- |
| `autowah` | un seguidor de nivel gobierna la frecuencia de un pasa-banda | sens, range, attack, release, Q, mix |
| `gate` | el mismo seguidor abre o cierra una ganancia | threshold, attack, hold, release, range |
| `width` | medio/lados para ensanchar + paseo izquierda-derecha con oscilador | width, rate, depth, sync |
| `ringmod` | un oscilador multiplicando la señal | freq, mix |

**El seguidor de nivel se escribe UNA vez**, en
`packages/loom-plugin-sdk/src/dsp/envelope-follower.ts`, y lo comparten `autowah`
y `gate`. Eso es lo que demuestra que el SDK sirve para compartir de verdad y no
es un cajón: dos plugins independientes dependiendo del mismo primitivo publicado.

Dos reglas concretas, ambas por escarmiento de este repo:

- **El auto-wah conduce el `detune` del filtro (centésimas de tono), no su
  `frequency` (hercios).** Es la regla que la modulación de filtros ya sigue aquí:
  un control bipolar sumado en hercios es inaudible; en centésimas barre
  exponencialmente.
- ⚠️ **El suavizado del seguidor se queda por encima de ~2 Hz y se verifica
  midiendo.** Este proyecto ya se comió un detector de nivel desbocado: un biquad
  por debajo de 1 Hz **invertía y amplificaba** el canal en vez de suavizarlo (fue
  el bug del sidechain, arreglado con un one-pole). Un ataque/caída de 10–100 ms
  cae en 1,5–15 Hz, así que el rango útil está fuera de la zona peligrosa — pero
  el límite se pone explícito y el comportamiento se mide, no se supone.

El `ringmod` es el más pequeño de los cuatro (dos nodos) y hace de **plugin de
ejemplo mínimo** en la documentación del SDK.

*(Nota: `cb4c1df`, ya en `main`, añadió un modulador en anillo como fuente del
mezclador **dentro** del motor Subtractive. No es el mismo trabajo:
éste es un insert que se pone en cualquier pista, incluidas las de audio y las de
batería. Sitios distintos de la cadena.)*

### 3.6 Granularidad: una carpeta por insert

Quince carpetas en `plugins/` (11 mudados + 4 nuevos). Es la **única**
granularidad en la que "desinstalar la reverb" significa algo. Un solo paquete con
los once dentro construiría más rápido, pero desinstalar sería quedarse sin los
once.

Las pruebas viajan con su efecto: `vitest.config.ts` ya recoge
`plugins/**/*.test.ts`, así que un test mudado sigue corriendo sin tocar la
configuración.

Al vaciarse, `src/plugins/fx/` se queda con un único fichero que **no es un
efecto**: `insert-chain.ts`, que es el rack. Se muda a `src/core/insert-chain.ts`
para no dejar una carpeta llamada `fx` sin un solo fx dentro.

## 4. Orden

0. **El emparejamiento del rack por id** (§2.4a) va primero y **solo**: es un
   fallo de hoy en `main`, no toca la ABI y no depende de nada de lo que sigue.
   Sale a `main` por su cuenta si el resto se atasca.
1. **La ficha manda** (§3.1b), **antes que nada del resto del andamiaje**: el host
   adopta de `plugin.json`, `Loom.registerComponent` muere, los ocho `main.ts` se
   borran, `main` pasa a opcional, el fixture llama a la puerta del host. Se hace
   PRIMERO porque todo lo que venga después —la ABI de `fx`, los 15 inserts— nace
   ya con la forma buena en vez de con el vicio que habría que repasar luego. Al
   acabar, los ocho plugins de motor y modulador siguen sonando igual: es la
   comprobación de que el cambio es de fontanería y no de comportamiento.
2. **Andamiaje**, un solo frente y secuencial: `kind: 'fx'` + `Loom.registerFx` +
   `adoptFx` + validación en `build.mjs`, `FxInstance` al SDK, `color` al
   manifiesto, el contrato de §3.3 y la siembra de envíos detrás de
   `pluginsReady`. Al acabar **no se ha mudado ni un efecto** y la suite sigue
   verde.
3. **Los once, de uno en uno.** Cada uno: crear `plugins/<id>/` → borrar sus
   ficheros de `src/plugins/fx/` → mover sus tests → verde → commit. `chorus` y
   `flanger` van juntos (comparten `modulated-delay`, que sube al SDK antes).
   `delay` y `reverb` van **al final**, porque son los que siembran los envíos.
4. **Los cuatro nuevos**, uno por commit, cada uno con su test de render y su
   escucha.
5. **Demolición**: borrar `FX_COLORS`, mudar `insert-chain.ts` a `src/core/`,
   comprobar que `src/plugins/fx/` desaparece.

**`npm run build` tiene que quedar verde en CADA tarea**, no sólo al final. La
rebanada A dejó el build roto entre dos de sus tareas por trocear por tipo de
trabajo en vez de por estado funcional; aquí se trocea por efecto entero.

## 5. Aceptación

Cada punto afirma que algo **pasa**, no que algo falte. La aceptación de la
rebanada A fue un espejismo dos veces por certificar ausencias: un plugin roto
daba el mismo verde que uno correcto.

0. **La ficha que se revisa es la que manda.** Se edita a mano el `plugin.json`
   de un plugin **ya construido** (cambiar la etiqueta de un mando basta) y, al
   recargar, la UI muestra el cambio. Hoy no lo mostraría: mandaría la fotocopia
   de dentro de `main.js`. Es la prueba de que la ficha se obedece, y afirma una
   PRESENCIA, no una ausencia. Y `grep -rn "registerComponent" src/ packages/
   plugins/ test/` no devuelve nada.
1. **Un insert de disco suena.** Un efecto cuyo id no aparece en **ningún**
   fichero de `src/` (comprobado con grep) se carga de disco, sale en el
   desplegable de "+ Add insert", se mete en una pista y la señal medida **difiere
   de la misma pista con ese insert en bypass**. Y mover uno de sus mandos vuelve
   a cambiar la medida.
2. **El censo sigue en 0.** `node tools/plugin-id-census.mjs --group fx` da 0 en
   producción, y las menciones de §2.1 (la tabla de colores y la siembra) han
   desaparecido de la clasificación.
3. **Desinstalar no rompe ni borra.** Se borra `plugins/delay/` de la carpeta
   construida y se carga una sesión que lo usaba: aparece el tapón marcado,
   **los inserts siguientes siguen mostrando lo suyo** (nombre, color y mandos
   correctos), la consola avisa una vez, y al guardar y recargar **los ajustes del
   delay ausente siguen en el JSON**.
4. **Reinstalar devuelve el sonido.** Se repone la carpeta, se recarga y la pista
   vuelve a sonar — medido con el tap de master que ya usan los e2e de audio, no
   con que el rack pinte sus mandos.
5. **Los envíos sobreviven al orden de arranque.** Con `delay` y `reverb`
   instalados, los buses A y B llegan sembrados; sin ellos, la sesión suena en
   seco y no hay un solo error de consola.
6. **El hueco ausente se ve DONDE SE MIRA**, con su propio e2e. La fase 2 aprendió
   que su aviso *"sólo se veía al ABRIR la pista"* y lo destapó un e2e, no una
   lectura del código: aquí el test abre el rack de una pista con un insert
   desinstalado y afirma que la unidad marcada **está presente**.
7. **El render offline hace lo mismo que el vivo.** `rehydrateInsertChain` está en
   el camino de `offline-recorder.ts record` (§6): una escena exportada con un
   insert ausente produce el mismo audio que la misma escena en vivo.
8. **Los cuatro nuevos, escuchados por Nacho en Chrome real** antes de dar la
   rebanada por buena. Y el seguidor de nivel, además, **medido**: la señal de
   control no invierte ni amplifica en ningún punto de su rango de mandos.
9. **Suite entera verde**: unidad, e2e y `tsc --noEmit`.

## 6. Riesgos conocidos

- **`rehydrateInsertChain` sale CRITICAL en GitNexus** (índice reconstruido el
  2026-08-03: 12.465 nodos / 32.883 aristas). 4 llamantes directos, 23 símbolos
  alcanzados, **6 flujos de ejecución** y tres módulos —`Session` (21 impactos,
  directo), `Save` (indirecto) y `Audio-worklet` (directo)—. Entre los flujos
  está **`record` de [offline-recorder.ts](../../../src/export/offline-recorder.ts)**:
  el tapón de §3.3 cambia también el camino del export, que en este repo ya se
  desincronizó del vivo una vez sin que test ni oído lo notaran. Por eso §5.7 es
  un criterio y no una nota.
- **`FxInstance` sale HIGH**: 19 dependientes directos y 96 en total. Moverla al
  SDK es un cambio de import masivo — mecánico, pero con superficie suficiente
  para que un despiste compile y falle en runtime.
- **`reverb-ir.ts` genera su impulso por síntesis** (167 líneas) y es el fichero
  más grande que sube al SDK. Si su render cambia aunque sea poco, la reverb suena
  distinta y **ningún test de "existe el nodo" lo detecta**: hace falta comparar
  la respuesta antes y después.
- **Los inserts se modulan por `AudioParam`**, un camino distinto al de los
  motores (que modulan dentro del worklet). Un insert-plugin que devuelva mal
  `getAudioParams()` deja el LFO mudo **sin error**. Cada efecto mudado verifica
  que sus destinos siguen apareciendo en el registro de destinos.
- **`delay` y `reverb` no son un insert cualquiera**: los buses de envío dependen
  de ellos. Van al final del orden y con su propia verificación (§5.5).
- **El seguidor de nivel es el trozo con más historia de fallos de este repo.**
  Se escribe con test de medida desde el primer commit, no de oído.
- **La tarea 1 (§3.1b) toca los ocho plugins que la fase 2 acaba de verificar a
  oído.** Es fontanería —el manifiesto que se ejecuta pasa a ser el mismo fichero
  que ya se validaba— pero si algo se tuerce, se tuerce en los seis motores a la
  vez y no en uno. Por eso va sola, primera, y su verde incluye que los ocho
  siguen registrándose y sonando; y por eso el criterio §5.0 comprueba la ficha
  editada a mano, que es lo único que distingue "obedece el fichero" de "obedece
  la fotocopia" — la suite entera pasa igual con las dos.
- **El bloqueo por la fase 2 ha desaparecido**: se mergeó en `ceb5741` el
  2026-08-03 y esta rama ya está rebasada encima. El riesgo que queda es el
  inverso — que otro frente vuelva a abrir la misma puerta mientras ésta corre.
  Antes de cada tarea del andamiaje se comprueba que `main` no ha movido
  `manifest.ts`, `capabilities.ts`, `plugin-host/` ni `tools/loom-plugin/`.

## Trabajo siguiente, anotado durante la ejecución: el compresor tiene DOS implementaciones

**Encuadre de Nacho, 2026-08-04: "como LFO y ADSR".** Es el correcto, y es mejor
que el mío — yo había puesto por delante la objeción equivocada.

**Lo que hay hoy**, verificado:

- `CompBlock` ([src/core/comp-block.ts](../../../src/core/comp-block.ts)) — una
  ganancia → `DynamicsCompressor` → compensación → salida, con `CompState`
  (bypass, umbral, ratio, ataque, caída, rodilla, compensación). Se instancia en
  **dos** sitios: dentro de cada `ChannelStrip` (`fx.ts:142`) y dentro del
  `MasterCompressor` (`fx.ts:311`). Está SIEMPRE, es parte fija del mezclador:
  EQ → comp → nivel → paneo → mute → envíos.
- El **insert `compressor`** — otra implementación, los mismos dos nodos y los
  mismos seis params con los mismos rangos. Opcional, va donde quieras en un
  rack, tantas veces como quieras.
- `DuckerSubgraph` — **no es un compresor**. Una ganancia gobernada por un
  detector que corre en el worklet, alimentado del tap post-mute de OTRA pista a
  través del bus de sidechain.

**Por qué el paralelo con LFO/ADSR es el que manda.** Aquéllos no salieron del
árbol porque los presets y las sesiones están escritos en un vocabulario que los
incluye: quitarlos no rompe una función, rompe **datos guardados**. Lo que sí se
les hizo fue darles **un solo dueño** de su DSP, sus params y su estado, y una
sola puerta de declaración. `CompState` vive en `lane.mixer` de toda sesión
guardada, así que el compresor está en la misma categoría: *lo que se REFERENCIA
desde datos guardados no se puede desinstalar* — pero sí unificar.

**La forma que tendría:** un componente "compresor" con un solo dueño de sus seis
params y de su DSP, marcado como no desinstalable. El canal lo monta **en su sitio
de siempre** y el rack monta **el mismo componente** cuando lo pides como insert.
Nada se mueve de sitio en la cadena, así que ninguna sesión existente cambia de
sonido — que era mi objeción, y cae.

**Lo que queda abierto son dos servicios del host que la ABI no expone:**

1. **Telemetría**: el panel de FX lee `getCompReduction()` cada frame; un
   `FxInstance` no tiene por dónde publicarla.
2. **Fuente de sidechain**: "dame la señal post-mute de la pista 3" es un
   servicio del host, no algo que un componente pueda pedirse solo. Es el
   equivalente exacto a abrir `driver: 'time'` y dejar `'gate'` cerrado en la
   rebanada de moduladores: se abre una puerta, no todas.

**No entra en esta rebanada** — aquí los efectos salen del árbol sin que cambie
el sonido de nada, y esto toca el mezclador, el bus de sidechain y la ABI.
