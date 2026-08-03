# Trozo 3, fase 2 — los cinco melódicos salen del árbol

**Estado:** aprobado por Nacho el 2026-08-02. Continuación directa de
[2026-08-01-motores-a-plugins-design.md](2026-08-01-motores-a-plugins-design.md),
cuya **fase 1 está mergeada en `main` en `820744d`**.

## 1. Qué se construye

`tb303`, `subtractive`, `fm`, `wavetable` y `westcoast` dejan de vivir en `src/`
y pasan a ser **plugins externos** en `plugins/<id>/`, compilados a
`public/plugins/<id>/` y cargados en runtime — exactamente como
[`plugins/karplus/`](../../../plugins/karplus/).

El objetivo, en las palabras de Nacho: **que cualquiera de los cinco sea
prescindible e instalable**. Borras su carpeta y la app sigue arrancando; la
vuelves a poner y suena igual que antes.

**El procedimiento NO se inventa aquí.** Karplus ya lo definió y lo mantiene
vivo; este spec sólo describe lo que hay que resolver *antes* de poder
aplicarlo cinco veces, y en qué orden.

## 2. Hechos verificados en el código

Comprobados el 2026-08-02 sobre `main` = `6fdeaab`. Ninguna línea de esta
sección es una suposición.

> **Revisado tras un `main` que se movió.** Este spec se escribió sobre
> `820744d`; mientras se redactaba, otra sesión mergeó
> `worktree-subtractive-ringmod` en fast-forward (21 commits, +4007/−298). Eso
> añadió a Subtractive un ring modulator, un filtro comb, un **segundo filtro
> con enrutado** y 17 presets, más tres ficheros DSP nuevos y un mecanismo de
> UI (`optionsFrom`) que **rompía el supuesto central de este spec**. Las
> secciones §2.4, §3.5 y §6 recogen el estado nuevo.

### 2.1 El procedimiento existente

`plugins/karplus/` contiene `plugin.json`, un `main.ts` de una línea
(`Loom.registerComponent(manifest.components[0])`), `dsp.ts` que se registra
solo con `Loom.registerRenderer(id, make)` en el ámbito del módulo,
`presets.json`, `reference-render.json` y sus dos tests. El host lo construye
con el **mismo** `WorkletLaneEngine` que usa para los cinco de este spec.

El descubrimiento es `public/plugins/index.json`, reescrito por
`writePluginIndex()` en [tools/loom-plugin/build.mjs:143](../../../tools/loom-plugin/build.mjs);
el navegador no puede listar un directorio, así que **ese fichero ES el
mecanismo**. Un manifiesto con `private: true` se construye pero no se lista.

`loadPlugins()` ([src/plugin-host/plugin-host.ts](../../../src/plugin-host/plugin-host.ts))
valida cada `plugin.json` **como datos, antes de ejecutar una sola línea** del
plugin, y un plugin que peta se anota en `report.failed` y se salta. En
[src/main.ts:98](../../../src/main.ts) la promesa `pluginsReady` guarda tanto la
carga de presets (línea 108) como el registro del DSP en el worklet (línea 139).

### 2.2 Un motor ausente hoy enmudece en silencio

[src/app/lane-allocator.ts:147](../../../src/app/lane-allocator.ts) devuelve
`null` cuando ningún camino reconoce el `engineId`, y `ensureLaneVoice` propaga
ese `null`. La pista existe, se dibuja, y **no suena ni dice nada**. Con motores
de serie eso era inalcanzable; con motores prescindibles ocurre en cuanto
alguien borra una carpeta o abre una sesión hecha en otra máquina.

`emptySessionState()` no crea pistas, así que **"New" es seguro** sin ningún
plugin. `testSessionState()` ([src/session/session.ts:160](../../../src/session/session.ts))
sí nombra `tb303` y `subtractive`, pero es una fixture de tests, no el arranque.

### 2.3 Los tres sitios donde el core pregunta por el id del 303

| dónde | qué hace | destino |
| --- | --- | --- |
| [lane-scheduler.ts:228](../../../src/core/lane-scheduler.ts) | `slidingIn` sólo se calcula si `engineId === 'tb303'` | capacidad de manifiesto (§3.2) |
| [lane-allocator.ts:9](../../../src/app/lane-allocator.ts) y `:131` | `presetKeyRemap` de las claves legacy de sus presets | muere: el `presets.json` del plugin se reescribe con dot-ids |
| [knob-mounting.ts:79](../../../src/app/knob-mounting.ts) | `refreshKnobsFromSynth` sale si `engine.id !== 'tb303'` | se comprueba si sigue vivo; si lo está, se generaliza |

### 2.4 Lo que los cinco renderers arrastran

| primitivo | lo usan | hoy vive en |
| --- | --- | --- |
| `osc` (Saw/Square/Sine/Tri/WhiteNoise) | tb303, subtractive, westcoast | `src/audio-dsp/osc.ts` |
| `ladder` (LadderFilter, LadderTap) | tb303, subtractive | `src/audio-dsp/ladder.ts` |
| `filter` (Svf) | subtractive, wavetable, westcoast | `src/audio-dsp/filter.ts` |
| `unison` (UnisonStack, driftDepthFor) | subtractive | `src/audio-dsp/unison.ts` |
| `sync-osc` (SyncOsc) | **`unison.ts`**, no un motor | `src/audio-dsp/sync-osc.ts` |
| `fold` | westcoast | `src/audio-dsp/fold.ts` |
| `comb` (CombFilter) | subtractive | `src/audio-dsp/comb.ts` |
| `filter-stack` (FilterStack, trackedCutoff) | subtractive | `src/audio-dsp/filter-stack.ts` |
| `filter-kinds` (FILTER_MODES, tapFor, routings) | subtractive | `src/audio-dsp/filter-kinds.ts` |
| `wavetable-data` (getWaveTables) | wavetable | `src/audio-dsp/wavetable-data.ts` |
| `ACCENT_VCA_LADDER` | tb303 | `src/core/velocity-gain.ts` |

Las tres últimas altas llegaron con el merge de la nota de arriba.
`filter-stack.ts` hace `export * from './filter-kinds'`, así que los dos son
**una sola unidad** y viajan juntos.

El SDK ya publica `adsr`, `mod-env-host`, `util` y `velocity`.

Los cinco llaman además a `synthTrim()` de `gain-staging.ts`, cuya tabla
`ENGINE_TRIM` guarda hoy: `tb303: 0.45`, `subtractive: 0.25`, `fm: 0.179`,
`wavetable: 0.6`, `westcoast: 0.5`. Ese fichero ya dice por escrito que **sólo
los motores de serie pertenecen ahí** y que un plugin declara su balance como
`outputTrim` en su manifiesto.

### 2.5 El coste real está en los tests

**26 ficheros** importan uno de los cinco módulos de motor; **21 son tests**, y
en casi todos el import existe sólo para registrar el descriptor
(`import '../engines/subtractive';`). Es más volumen que los cinco renderers
juntos.

Además, cinco ficheros compartidos enumeran los cinco ids como tabla de casos:
`declared-params.dsp.test.ts`, `live-params.dsp.test.ts`,
`engine-parity.dsp.test.ts`, `modulation-pipeline.test.ts` y
`velocity-response.test.ts`.

### 2.6 Los puntos compartidos que los cinco tocan

- [loom-processor.ts:17-21](../../../src/audio-worklet/loom-processor.ts) — cinco imports por efecto secundario, contiguos.
- [kernel-lane-render.ts:26-30](../../../src/export/kernel-lane-render.ts) — los mismos cinco, para el render offline.
- [lane-allocator.ts:26](../../../src/app/lane-allocator.ts) — `BUILTIN_WORKLET_ENGINE_IDS`, que se va vaciando id a id.
- `src/audio-dsp/gain-staging.ts`, `src/session/session-host-util.ts` (slugs de pista), `test/engine-fixtures.ts`, `tools/gen-engine-reference.ts`, `tools/lane-bench.ts`, `tools/param-read-bench.ts`.

## 3. Las tres decisiones de diseño

### 3.1 Contrato de motor ausente: visible, mudo y avisado

Un `engineId` que ningún plugin registra deja de ser un `null` anónimo y pasa a
ser un estado con nombre.

- La pista **se aloja igual**: su `ChannelStrip`, su `InsertChain` y su sitio en
  la rejilla de sesión. Lo único que falta es el motor.
- La cabecera de la pista y el inspector muestran *"engine not installed:
  `<id>`"* en lugar de la rejilla de knobs. Texto en inglés, como toda la UI.
- **Guardar no pierde nada.** Los params ya viven en `lane.engineState`, dentro
  de la sesión, no dentro del motor: el trabajo no es guardarlos, es **verificar
  que ningún camino de guardado los pisa** cuando el motor no existe. Eso es un
  test, no una función nueva.
- Instalas el plugin, recargas, y la pista vuelve a sonar exactamente igual.

**Fuera de alcance a propósito:** no hay UI de instalación, ni descarga, ni
gestor de plugins. "Instalable" aquí significa *dejar la carpeta y recargar*.

### 3.2 El slide del 303 pasa a ser una capacidad

El 303 declara `capabilities.slide: "overlap"` en su `plugin.json`.
`src/plugins/capabilities.ts` gana un lector — la misma puerta única por la que
ya pasan `outputTrim`, `shortLabel`, `gm` y `clipContent` — y `noteTrigger()`
consulta la capacidad en vez de comparar el id.

Se eligió esto frente a "que lo decida el motor" (mandar el dato crudo de
solape en el `NoteSpec` de los seis) porque esa alternativa obliga a
re-verificar la paridad de **todos** los motores para resolver el acoplamiento
de **uno**.

### 3.3 Primitivos: lo genérico al SDK, la identidad de un motor al plugin

El criterio **no** es cuántos motores del árbol lo usan hoy. El SDK es API para
terceros, así que la pregunta es si el trozo **cabe en cualquier motor**. Una
pila de unísono cabe en todo lo que tenga osciladores — es decir, en todos — y
un plegador de onda es un primitivo de síntesis, no un rasgo de Westcoast. Que
hoy los use un solo motor nuestro es un accidente del árbol, no una propiedad
del primitivo.

Regla, sin excepciones:

- **Primitivo de síntesis genérico → sube a
  `packages/loom-plugin-sdk/src/dsp/`**: `osc`, `ladder`, `filter`, `unison`,
  `fold`, `comb`, y `filter-stack` + `filter-kinds` como unidad. Un filtro comb
  y una pila de dos filtros con enrutado SER/PAR/DIFF caben en cualquier motor
  igual que el unísono; que hoy sólo los use Subtractive es, otra vez, un
  accidente del árbol.
- **Datos o constantes que SON la identidad de un motor → dentro de su
  plugin**: `wavetable-data` (sus tablas de onda son su sonido) a
  `plugins/wavetable/`, `ACCENT_VCA_LADDER` (la curva de acento del 303) a
  `plugins/tb303/`, `subtractive-params` y `westcoast-fold` a los suyos.
- **`synthTrim()` desaparece del renderer.** Cada motor lleva su número de
  `ENGINE_TRIM` a `capabilities.outputTrim` y lo aplica el host en el punto de
  suma, igual que ya hace con Karplus. Su entrada en la tabla se borra.
- **El test de un primitivo viaja con el primitivo**: `osc.test.ts`,
  `ladder.test.ts` y `filter.test.ts` al SDK; `subtractive-renderer.test.ts`,
  `wavetable-renderer.test.ts` y compañía, dentro de su plugin.
- **`unison.ts` y `fold.ts` no tienen test propio** (comprobado). Suben al SDK
  desnudos y pasan a ser API pública en el mismo movimiento, así que el plan les
  escribe uno **antes** de moverlos: un plugin de tercero que dependa de un
  plegador sin cobertura es deuda que se paga fuera de este repo.

Verificado el 2026-08-02, consumidor a consumidor: `osc` lo usan tb303,
subtractive y westcoast; `filter` subtractive, wavetable y westcoast; `ladder`
tb303 y subtractive; `unison` sólo subtractive; `fold` sólo westcoast;
`wavetable-data` sólo wavetable. Ese censo **describe el árbol de hoy y no
decide nada**. Los casos que lo zanjan son concretos: a Subtractive se le puede
querer añadir un plegador de onda mañana, y a Wavetable o al propio 303 una pila
de unísono. Con `fold` y `unison` enterrados dentro de Westcoast y Subtractive,
cualquiera de esas dos ideas obligaría a copiar el fichero. `unison.ts` importa
`osc`, así que ambos suben juntos y el import interno del SDK no cruza ninguna
frontera.

La contrapartida se asume con los ojos abiertos: **la superficie DSP del SDK
pasa a ser API pública** que terceros compilan, así que cambiarla rompe plugins
de fuera. Lo cubre el `loomApi: 1` que Karplus ya declara.

Consecuencia, y es la prueba de que el trozo valía la pena: `src/audio-dsp/`
queda con `voice-manager`, `scheduler-queue`, `modulation-runtime`,
`renderer-registry` y los de drums/sampler. **El host puro, sin un solo motor
melódico dentro.**

### 3.4 Los tests registran el manifiesto de verdad

Un fixture único (`test/plugin-fixtures.ts`) lee el `plugin.json` **real** del
plugin y lo registra por el camino de producción (`installMainThreadLoomApi` +
`registerComponent`). Los 21 tests cambian su `import '../engines/<id>'` por una
llamada a ese fixture.

No se acepta un stub escrito a mano por test: el fixture leyendo el manifiesto
real es lo que hace que **romper un manifiesto rompa los tests**. Las cinco
tablas de §2.5 se alimentan de la lista de plugins instalados en vez de una
constante.

Los `.dsp.test.ts` de paridad se mudan junto a su plugin
(`plugins/<id>/<id>-parity.dsp.test.ts`), como el de Karplus, y usan el mismo
stub hoisted de dos líneas para probar que el DSP de un plugin no necesita del
host nada más que `registerRenderer`.

### 3.5 `optionsFrom` pasa de función a tabla

**Este es el hallazgo que casi tumba el spec.** El Mode×Type que llegó con el
merge declara las opciones de un knob a partir del valor de otro, y lo hace con
**una función**:

```ts
{ id: 'filter.type', kind: 'discrete',
  options: typeOptionsFor(0),
  optionsFrom: { paramId: 'filter.model', build: typeOptionsFor } }
```

Los params de un plugin se declaran en `plugin.json`. **Un JSON no puede llevar
una función**, así que tal cual está, Subtractive ya no se puede expresar como
manifiesto — el motor con más presets y más uso se habría quedado fuera del
trozo sin que nadie lo viera venir hasta la última tarea.

La forma pasa a ser declarativa: una lista de opciones **por cada valor** del
param de origen.

```jsonc
"optionsFrom": { "paramId": "filter.model",
                 "table": { "0": [...], "1": [...], "2": [...], "3": [...] } }
```

Con cuatro modos son cuatro entradas. `typeOptionsFor` deja de ser una función
exportada y pasa a ser el generador que **construye esa tabla** dentro de
`filter-kinds.ts`, que ya viaja al SDK (§3.3).

Se eligió frente a "que el `main.ts` del plugin enganche la función" — que
también funcionaría, porque `main.ts` es TypeScript de verdad — porque esa
salida deja el `plugin.json` sin ser la verdad entera: quien lo lea no vería de
dónde salen las opciones de *Type*. Va en la dirección contraria a la que lleva
el repo con la UI de motores desde datos.

**Superficie exacta a tocar** (verificado, no estimado): el tipo en
[engine-params.ts:41](../../../src/engines/engine-params.ts), **dos** consumidores de
producción — [engine-param-grid.ts:93](../../../src/engines/engine-param-grid.ts) y
[knob-mounting.ts:100](../../../src/app/knob-mounting.ts), que hoy llaman `.build(...)` y
pasan a indexar la tabla — las dos declaraciones de
`subtractive-params.ts` (líneas 69 y 95), y tres tests
(`refresh-lane-knobs-optionsfrom.test.ts`, `engine-param-grid.test.ts`,
`subtractive-filter-presets.test.ts`).

Es andamiaje: va en la fase 1 del orden de §4, **antes** de mover ningún motor,
y con la suite verde al acabar.

### 3.6 Un solo `EngineParamSpec`

Encontrado al escribir el plan, y del mismo tamaño que §3.5: **hay dos tipos con
ese nombre**. El del host ([src/engines/engine-params.ts:6](../../../src/engines/engine-params.ts))
declara `curve`, `color`, `drawnBy`, `optionsFrom`, `selectStyle` y
`showLabel`; el del SDK ([packages/loom-plugin-sdk/src/manifest.ts:14](../../../packages/loom-plugin-sdk/src/manifest.ts))
no declara ninguno.

Un manifiesto es JSON, así que esa asimetría significa que **un plugin no puede
usar campos de los que los cinco dependen**: `curve` (fm 1, wavetable 3,
westcoast 2), `drawnBy` (subtractive **10**, wavetable 1), `selectStyle` (fm 1)
y `color` (los cuatro). Conteo verificado el 2026-08-02.

Todos son declarativos — cadenas y enumerados — así que no hay ningún problema
de fondo, sólo un hueco: **el SDK pasa a ser el dueño del tipo** y el host lo
re-exporta con el mismo nombre, de modo que ningún importador de `src/` cambia.
Karplus compila hoy contra el tipo pobre y sigue compilando contra el rico.

## 4. Orden

1. **Andamiaje** (§3.1, §3.2, §3.3, §3.4) — un solo frente, secuencial. Al
   acabar, ningún motor se ha movido todavía y la suite sigue verde.
2. **wavetable, fm, westcoast** — independientes entre sí y repartibles. Cada
   uno: congelar referencia → crear `plugins/<id>/` → borrar sus ficheros de
   `src/` → quitar su id de los tres puntos compartidos → paridad verde →
   commit.
3. **subtractive y tb303** — al final, por sus acoplamientos (§2.3 y el
   `deriveSubtractiveEnvMods` que `worklet-lane-engine.ts` importa).
4. **Demolición** — vaciar `BUILTIN_WORKLET_ENGINE_IDS`, quitar los bloques de
   imports de `loom-processor.ts` y `kernel-lane-render.ts`, sacar `synthTrim`
   del camino de motores. No se paraleliza con nada: es lo que sólo puede hacer
   el último.

## 5. Aceptación

1. **Paridad por motor.** Referencia congelada con
   `tools/gen-engine-reference.ts` **antes** de tocar el motor; después, el test
   de paridad del plugin compara la forma normalizada al pico con desviación
   peor < 1e-6, como el de Karplus.
2. **Prescindible, demostrado.** Se borra `plugins/tb303/` de la carpeta
   construida: la app arranca, la sesión demo carga, la pista del 303 aparece
   marcada como no instalada y muda, y la consola no da un solo error. Se
   guarda la sesión y **el `engineState` del 303 sigue completo** en el JSON.
3. **Instalable, demostrado.** Se repone la carpeta, se recarga, y la pista
   vuelve a sonar — medido con el tap de master que ya usan los e2e de audio, no
   con que pinte sus knobs.
4. **El motor desapareció de `src/`**: sus ficheros borrados y `grep` de su id
   sin resultados salvo lo que este spec justifique por escrito.
5. **CPU sin empeorar**, con `tools/lane-bench.ts` en los dos modos (`none` y
   `lfo`), misma metodología que la fase 1 (10 s × 8 voces, mediana de 5). El
   `dsp.js` va bundleado aparte: si eso cuesta, quiero el número, no la fe.
6. **Verificación a oído** en Chrome real, **Escena 2**, con los cinco ya
   mudados.
7. **Suite entera verde**: unidad, e2e y `tsc --noEmit`.

## 6. Riesgos conocidos

- **El volumen está en los tests, no en el DSP** (§2.5). Un plan que dimensione
  esto por líneas de renderer se quedará corto por un factor grande.
- **`subtractive` es el motor con más presets y más uso**, y `worklet-lane-engine.ts`
  todavía importa código suyo. Su mudanza es la que más puede romper — y acaba
  de crecer **+4007 líneas** (ring mod, comb, segundo filtro con enrutado, 17
  presets) el día antes de empezar esto.
- **`main` se mueve bajo los pies.** Otras sesiones mergean en fast-forward
  mientras este trozo está en marcha, y una de ellas ya introdujo un mecanismo
  (`optionsFrom` con función) incompatible con el supuesto central del spec. La
  defensa es rebasar a `main` **muy a menudo** y releer §2 cuando el rebase
  traiga algo que toque a un motor: el spec de fase 2 se salvó por revisarlo,
  no por suerte.
- **La paridad se captura ANTES de la primera línea**, o no vale: una referencia
  tomada después congela el bug.
- **El render offline es un camino aparte** (`kernel-lane-render.ts` importa los
  renderers por su cuenta) y ya perdió la modulación una vez sin que ningún test
  ni ningún oído lo notara. Cada motor mudado tiene que verificarse también por
  ahí.
- **Un plugin que peta se salta en silencio** por diseño (`report.failed`). Con
  cinco motores en juego, un fallo de carga se parecerá mucho a "el motor no
  está instalado" — el aviso de §3.1 debe distinguir *no instalado* de *falló al
  cargar*.
