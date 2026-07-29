# Plugins de verdad: ABI de runtime, SDK y empaquetador

**Fecha:** 2026-07-29
**Estado:** diseño aprobado, pendiente de plan
**Alcance de ESTE spec:** el trozo vertical (Karplus fuera del árbol). La descomposición
completa queda registrada al final, pero cada trozo siguiente tendrá su propio spec.

> En castellano a propósito: su lector es quien lo aprueba. El código, la UI y el
> manifiesto van en inglés.

## El problema, tal y como se vive

El CLAUDE.md dice que todo es «un plugin detrás de un registro». Para los inserts es casi
verdad. Para un motor es falso: añadir uno son **cinco pasos** en cuatro directorios, y
tres de ellos editan ficheros del core.

Y no es solo el alta. El core no le *pregunta* nada a un motor: compara su nombre. Hay del
orden de sesenta sitios repartidos por `session/`, `app/`, `core/lane-scheduler.ts`,
`worklet-lane-engine.ts`, `midi/` y `control/` con la forma `engineId === 'tb303'`,
`=== 'sampler'`, `=== 'audio'`, `=== 'drums-machine'`, `=== 'subtractive'`.

La medida concreta: **Karplus, que es el motor fácil** — sin UI propia, sin IndexedDB, sin
pads — aparece nombrado en **ocho sitios** fuera de sus dos ficheros.

| Sitio | Qué codifica |
|---|---|
| [loom-processor.ts:20](../../../src/audio-worklet/loom-processor.ts#L20) | import de efecto lateral para que el renderer se registre dentro del worklet |
| [kernel-lane-render.ts:29](../../../src/export/kernel-lane-render.ts#L29) | lo mismo, otra vez, para el render offline |
| [lane-allocator.ts:25](../../../src/app/lane-allocator.ts#L25) | `WORKLET_ENGINE_IDS` — si no está en la lista, la pista es muda |
| [bpm-broadcast.ts:31](../../../src/app/bpm-broadcast.ts#L31) | `LANE_HOST_ENGINE_IDS` — a quién se le avisa del BPM |
| [gain-staging.ts:45](../../../src/audio-dsp/gain-staging.ts#L45) | tabla `synthTrim` con el trim de salida de cada motor |
| [gm-lookup.ts:84](../../../src/midi/gm-lookup.ts#L84) | keywords de General MIDI que eligen este motor al importar |
| [session-host-util.ts:15](../../../src/session/session-host-util.ts#L15) | mapa de slugs para el nombre corto de la pista |
| `public/presets/karplus.json` | sus presets, en un directorio global ajeno |

Un tercero no puede hacer nada de eso. No tiene el repo.

## Lo que se decide

Un plugin es **un directorio autocontenido de JavaScript ya compilado**, que su autor
construye con nuestras herramientas y que la app carga en runtime sin recompilar nada. Los
nuestros van por ese mismísimo camino.

### La frontera

**NO es plugin** — transporte y reloj, modelo de sesión (lanes/clips/escenas), mixer,
strip, sends y sidechain, motor de modulación, undo, guardado, importador MIDI, los
editores de clip, el host de la UI.

**SÍ es plugin** — todo lo que genera o transforma sonido o notas: los 9 motores (Sampler,
canal de Audio y Drums incluidos), los 11 inserts, los 2 note-FX y los modulators.

Los editores grandes y raros (el del Sampler, el rack de Drums) **se quedan en el host**:
la UI no es extensible por plugin, es una decisión tomada. Lo que cambia es que se eligen
por capacidad declarada y no por nombre — el host ofrece un catálogo y el plugin dice cuál
quiere.

## El contrato: un handshake por globales

Un `.js` compilado por un tercero no puede importar nada nuestro: nuestros módulos van
bundleados y con hash. Y dentro del AudioWorklet no existe `import()` dinámico — solo
`addModule`, y cada módulo añadido resuelve su propio grafo, así que dos módulos distintos
que importen `renderer-registry.ts` tendrían **dos registros distintos**. El punto de
encuentro tiene que ser un objeto global del realm.

El host instala `globalThis.Loom` en los dos mundos **antes** de cargar plugin alguno:

```js
// main.js — hilo principal
Loom.registerEngine({ id: 'karplus', name: 'Karp', /* …manifiesto… */ });

// dsp.js — dentro del AudioWorklet, y también en el hilo principal para el render offline
Loom.registerRenderer('karplus', (note, params, sampleRate) =>
  new KarplusVoice(note, params, sampleRate));
```

Superficie completa de la ABI, y no crece sin decisión explícita:

```ts
interface LoomApi {
  readonly apiVersion: number;            // entero; mayor incompatible ⇒ rechazo
  registerEngine(spec: EngineManifest): void;
  registerRenderer(engineId: string, make: RendererFactory): void;
  registerFx(factory: FxFactory): void;
  registerNoteFx(factory: NoteFxFactory): void;
  registerModulator(factory: ModulatorFactory): void;
}
```

Los primitivos DSP **no viven aquí**. Llegan por npm en tiempo de compilación y acaban
dentro del bundle del plugin (modelo VST/CLAP). Es lo que permite que esta ABI sea
diminuta y realista de mantener estable durante años: si mañana cambio el filtro ladder,
no rompo a nadie.

**Tres realidades, un mismo `dsp.js`**: el worklet (camino vivo), el hilo principal (el
render offline usa el kernel puro, [kernel-lane-render.ts](../../../src/export/kernel-lane-render.ts)),
y Node (tests). Como es ESM plano que solo toca un global, el mismo fichero sirve en las
tres — se importa una vez por realm.

## El manifiesto responde, el core no adivina

Cada comparación por id de hoy es en realidad una pregunta que el core le hace al plugin.
Son unas doce, no sesenta:

| Hoy | Capacidad declarada |
|---|---|
| `WORKLET_ENGINE_IDS.has(id)` | el manifiesto trae entrada `dsp` |
| `synthTrim('karplus')` | `outputTrim: 0.857` |
| `LANE_HOST_ENGINE_IDS.includes(id)` | `wantsBpm: true` |
| `engineId === 'tb303'` en `lane-scheduler` | `slideOnOverlap: true` |
| `=== 'sampler' \|\| === 'audio'` (drop de fichero) | `accepts: ['audio-file']` |
| `clip-editor-router` por id | `clipEditor: 'piano-roll' \| 'drum-grid' \| 'audio'` |
| `noteFx: engineId !== 'drums-machine'` | `acceptsNoteFx: false` |
| tabla de keywords de `gm-lookup` | `gm: { keywords: [], programs: [] }` |
| mapa de slugs de `session-host-util` | `shortLabel: 'karplus'` |
| `public/presets/<id>.json` | `presets.json` dentro del plugin |
| las 8 salidas de drums | `outputs: 8` |
| `=== 'subtractive'` en `worklet-lane-engine` | el mapeo de params se declara |

Regla que gobierna todo lo demás: **si el core necesita saber algo de un plugin, lo
pregunta al manifiesto**. Un `switch` sobre ids en el core es, a partir de aquí, un bug.

Forma del directorio:

```
karplus/
  plugin.json     manifiesto: id, name, version, loomApi, author, provides[]
  main.js         registra el/los descriptores en el hilo principal
  dsp.js          registra el/los renderers (worklet + offline)
  presets.json    sus presets, suyos
```

El empaquetador comprime ese directorio en un `.loomplugin` (un zip) para distribuirlo;
instalar es descomprimirlo en IndexedDB y servirlo por blob URLs, que `addModule()` acepta.

## Empaquetado y SDK

Tres piezas nuevas, todas fuera de `src/`:

**`packages/loom-plugin-sdk/`** — lo que se publica a los autores. Los tipos TS del
manifiesto y del ciclo de vida de voz (`VoiceRenderer`, `NoteSpec`, `ParamBag`,
`EngineParamSpec`), los mismos tipos en JSDoc para quien escriba JS puro, y los primitivos
DSP **como código fuente**: osciladores, filtros, ladder, adsr, unison, wavefolder,
`midiToFreq`, la curva de velocity. El autor los importa; su bundle se los queda.

**`tools/loom-plugin/`** — el CLI:
- `new <dir> [--js|--ts]` — scaffold que suena desde el minuto cero.
- `build <dir>` — esbuild → `main.js` + `dsp.js`, valida `plugin.json` contra el esquema
  y **falla si el bundle resultante importa algo del host** (esa comprobación es lo que
  impide que se cuele una dependencia oculta y el formato se degrade con el tiempo).
- `pack <dir>` — zip `.loomplugin`. Fuera del primer trozo.

**`src/plugin-host/`** — dentro de la app: el objeto `Loom` de los dos mundos, el validador
de manifiesto, el cargador y la puerta de arranque.

### Los nuestros se dogfoodean, sin perder los tests

El código fuente de cada plugin propio vive en el repo (`plugins/karplus/`, TypeScript,
importando el SDK por workspace) y **nuestro propio packer** lo compila a
`public/plugins/karplus/`. La app solo ve el JS empaquetado: el mismo camino que un
tercero, sin atajo. Los tests unitarios importan el TS de origen directamente — siguen
siendo rápidos y sin build — y **un** test de integración renderiza el artefacto ya
empaquetado, que es el que prueba que el paquete real suena.

Si compilásemos los built-ins de otra manera, la API se pudriría en tres meses. Esa es
toda la razón de esta decisión.

## Arranque

`PluginHost` reúne dos fuentes: `public/plugins/index.json` (los que enviamos) e IndexedDB
(los que instale el usuario, servidos por blob URL).

Secuencia:

1. Leer manifiestos, validar esquema y `loomApi`. Un mayor incompatible se rechaza **sin
   ejecutar el código**.
2. Instalar `globalThis.Loom` en el hilo principal e importar cada `main.js`.
3. `addModule(loom-processor)` primero — es quien instala `Loom` dentro del worklet — y
   después un `addModule` por cada `dsp.js`, en orden.
4. **Puerta**: nadie asigna un lane hasta que `host.ready()` resuelve.

**Aislamiento de fallos**: un plugin que revienta al cargar no tumba el arranque. Queda
marcado como fallido, con su error, y la app sigue con el resto.

## Alcance del primer trozo

Sacar **Karplus** entero del árbol, atravesando las cuatro capas por lo estrecho.

**Dentro:** el SDK con lo mínimo que Karplus necesita; el CLI con `new` y `build`;
`src/plugin-host/` completo (ABI, validación, carga, puerta, aislamiento de fallos); y las
capacidades que Karplus toca — `dsp`, `outputTrim`, `wantsBpm`, `shortLabel`, `gm`,
`presets`, `clipEditor`.

**Fuera:** el instalador de plugins en la UI, el `.loomplugin` zip, y las otras capacidades
de la tabla — cada una llega cuando migremos el motor que la necesita.

### Riesgo a matar el día uno

Antes de escribir nada más, un spike de veinte líneas: `addModule` de un JS externo dentro
del worklet, que registre un renderer por el global y suene. Si eso falla, el diseño
cambia, y quiero saberlo el primer día y no la tercera semana.

### Criterios de aceptación

1. `git grep -i karplus src/` devuelve **cero**.
2. Karplus suena **idéntico**: un test de DSP que compara el render de una nota contra la
   referencia actual (relativo, como manda la casa).
3. Borrar `public/plugins/karplus/` hace desaparecer el motor del selector sin un solo
   error en consola.
4. `loom-plugin new --js` produce un motor que suena, sin TypeScript en ninguna parte.

## Descomposición completa (los trozos siguientes)

Cada uno con su propio spec, en este orden:

1. **Este** — trozo vertical: ABI + SDK + CLI + host, validados con Karplus.
2. **Core por capacidades** — barrer las ~60 comparaciones por id restantes y convertirlas
   en las doce preguntas al manifiesto. Es el trozo largo.
3. **Migración** — los 8 motores restantes, los 11 inserts, los 2 note-FX y los
   modulators. Los note-FX arrastran su propio arreglo: hoy `kind: 'notefx'` se cae del
   check de forma de `plugin-bootstrap`, y `notefx-chain.ts`, `notefx-ui.ts`, `live-arp.ts`
   y `live-notefx.ts` hacen `switch` sobre `'arp'`/`'chord'`.
4. **Distribución** — `.loomplugin`, instalador en la UI, gestor de plugins (activar,
   desactivar, ver fallos), y publicar el SDK.

## Lo que este diseño acepta a sabiendas

- **Ejecutas JavaScript de terceros.** No hay sandbox: un plugin puede hacer lo que quiera
  en la página. Es asumible para una app musical local, pero es una decisión, no un olvido.
- **Un plugin puede quedarse con un filtro viejo**, porque los primitivos viajan dentro de
  su bundle. Es el precio de que la ABI sea diminuta, y es el precio correcto.
- **El arranque pasa a ser asíncrono de verdad.** Hoy hay orden implícito; a partir de
  aquí hay una puerta explícita, y cualquier consumidor que lea recursos de pista antes de
  `ready()` va a fallar ruidosamente. Eso es una mejora disfrazada de riesgo.
