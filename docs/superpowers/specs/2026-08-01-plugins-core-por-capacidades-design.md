# Plugins drop-in, trozo 2 — el core deja de decidir por nombre

Segundo de los cuatro trozos abiertos en
[2026-07-29-plugins-drop-in-abi-design.md](2026-07-29-plugins-drop-in-abi-design.md).
El trozo 1 (ABI + SDK + CLI + host, validados sacando Karplus del árbol) está
mergeado en `main` = `67c1efb`.

## El problema, medido

`tools/plugin-id-census.mjs` cuenta las líneas de `src/` donde el core nombra un
componente. No es una impresión, es un número que se puede volver a ejecutar
antes y después de cada rebanada.

| grupo | líneas en producción | ficheros |
|---|---|---|
| engines | 116 | 43 |
| modulators | 18 | 5 |
| note-FX | 9 | 5 |
| inserts (fx) | 4 | 2 |

El censo clasifica cada mención en `test` / `comment` / `own-file` /
`core-decides` y sólo cuenta la última. Las 584 menciones en tests son correctas:
un test nombra lo que ejercita.

Pero los cuatro grupos **no tienen la misma enfermedad**, y ésa es la conclusión
que da forma al trozo:

- **Inserts: ya están sanos.** Sus 4 líneas son `createInstance('fx','delay')`
  sembrando los dos sends por defecto y la migración de sends — configuración de
  producto, no decisiones por nombre. Es el único grupo donde el punto de
  extensión existe *y se usa*: `InsertChain` construye por registro y el
  selector lo recorre. Añadir el insert número 12 no toca el core. **Los inserts
  son la prueba de que el patrón funciona**, y el modelo que copian las otras
  rebanadas.
- **Engines: el punto de extensión existe y el core lo rodea.** Hay registro
  (`registerEngine`/`getEngineDescriptor`), y aun así el core pregunta
  `engineId === 'sampler'` 116 veces.
- **Modulators y note-FX: la sustancia vive en el host.** `src/plugins/modulators/lfo.ts`
  tiene 29 líneas y no contiene el LFO; importa las cuatro piezas que sí lo
  contienen. Ver la sección "Un plugin contiene lo suyo".

## Qué NO es deuda

El criterio "cero menciones" del trozo 1 resultó estar mal formulado, así que
aquí se dice explícitamente qué sobrevive **con razón**:

- **`kind === 'audio'` donde `kind` es un `ClipKind`** ([clip-editor-router.ts:160](../../../src/session/clip-editors/clip-editor-router.ts))
  — eso YA es la abstracción buena. No se toca.
- **El fichero de un componente nombrándose a sí mismo** (`registerRenderer('fm', …)`).
  Se va con él en el trozo 3.
- **`kind: 'sampler' | 'audio'` dentro del backend del Sampler** — discriminador
  interno entre "golpe de pad" y "fichero entero". Se va con el Sampler.
- **Tests que nombran el id que ejercitan.**
- **`perf-view.ts:71`** (`data-f="audio"`, el medidor de CPU): falso positivo del
  censo.

## Decisiones cerradas

No re-discutir. Cada una tiene fecha 2026-08-01 y salió de una pregunta directa.

1. **Criterio de hecho:** capacidad demostrable primero, barrido después.
2. **Los backends siguen siendo del host** hasta el trozo 3. `DrumsWorkletEngine`
   (8 salidas), `SamplerWorkletEngine` y `AudioWorkletEngine` se construyen por
   `if (engineId === …)` en el allocator y así se quedan: su código sale de `src/`
   en el trozo 3 de todas formas, y tocar el camino de audio de los tres motores
   más complicados antes de eso es trabajo que se repite.
3. **Capacidades ortogonales**, una por pregunta — no un `kind:
   'instrument' | 'drum-machine' | 'audio-channel'`. Un `kind` sería la misma
   enfermedad con mejor ortografía: el host seguiría haciendo `switch` sobre un
   nombre, sólo que inventado por nosotros.
4. **Roles declarados por el componente**, y **gana el primer reclamante en orden
   de registro**.
5. **Los cuatro tipos, un solo mecanismo.** Un manifiesto y una puerta para
   engine/fx/modulator/notefx, para que el trozo 3 no invente un segundo.
6. **Un plugin es 100% autocontenido.** El plugin del LFO contiene *todo* el LFO.

Y dos correcciones al diseño que salieron durante la revisión, ambas de Nacho y
ambas quitando cosas que yo había propuesto de más:

- **(7) `scope` no es una capacidad, es dato de sesión.** Es un campo por
  instancia de `ModulatorState`, editable por el usuario: el control RETRIG del
  LFO es un 3-vías Free/Note/Voice donde "Voice" hace `mod.scope = 'per-voice'`
  ([mod-config-templates.ts:90-116](../../../src/modulation/mod-config-templates.ts)).
  Un mismo LFO usa los dos scopes.
- **(8) No hay `defaultScope`.** La capacidad es `scopes: ScopeName[]` y **el
  primero de la lista es el valor inicial**. LFO → `["shared","per-voice"]`,
  ADSR → `["per-voice"]`, que es exactamente lo que hacen hoy `makeDefaultLFO` /
  `makeDefaultADSR`.

## Un plugin contiene lo suyo

Hoy `src/plugins/modulators/lfo.ts` es una fachada. El LFO está repartido en
cinco sitios y el "plugin" no es dueño de ninguno:

| dónde | qué |
|---|---|
| `src/modulation/lfo-voice.ts` | el DSP del hilo principal |
| `src/audio-dsp/modulation-runtime.ts` | el DSP del lado worklet |
| `src/modulation/types.ts` | los campos de estado (`rateHz`, `waveform`, `syncBars`…) |
| `src/modulation/mod-config-templates.ts` | la plantilla de UI a medida |
| `src/plugins/modulators/lfo.ts` | la fachada, que importa las otras cuatro |

Ahí está la causa raíz de que el SPI esté roto. [modulation-host.ts:84-95](../../../src/modulation/modulation-host.ts)
lo documenta contra sí mismo:

> *"The plugin registry's `create(ctx, bpm)` signature can't receive `m`, so a
> registry-made instance is a stateless stub (its LFOVoice uses a throwaway state
> and the wrapper's `currentValue()` returns 0) — never route lfo/adsr through
> it."*

Es decir: **un modulador de terceros se puede registrar hoy, y sale mudo.** Peor
que imposible: posible y roto. Y la firma no puede recibir el estado porque *la
forma del estado es del host*. Arreglar la firma sin mover el contenido sería una
tirita.

La frontera aprobada en el trozo 1 se mantiene y se afina: el **sistema** de
modulación (conexiones, profundidades, el reparto shared/per-voice, el binder,
los destinos) es **core**; **el modulador** es **plugin**. Igual que la cadena de
inserts es core y cada insert es un plugin.

## Arquitectura

### Un manifiesto

Hoy hay tres formas: `PluginManifest` (interno, [src/plugins/types.ts](../../../src/plugins/types.ts)),
`PluginManifestFile` + `EngineManifest` (externo, `@loom/plugin-sdk`) y
`NoteFxManifest` (su propia interfaz, sin params ni presets). Convergen en una,
discriminada por `kind`:

```ts
type ComponentManifest =
  | { kind: 'engine';    id, name, params, presets?, capabilities: EngineCapabilities }
  | { kind: 'fx';        id, name, params, presets?, capabilities: FxCapabilities }
  | { kind: 'modulator'; id, name, params, presets?, capabilities: ModulatorCapabilities }
  | { kind: 'notefx';    id, name, params, presets?, capabilities: NoteFxCapabilities }
```

Un `plugin.json` pasa a ser un **paquete de componentes**: `components: [...]` en
lugar de `engines: [...]`. Un componente integrado registra la misma forma desde
código.

Eso sube **`loomApi` a 2**. Sólo existe un plugin publicado y es nuestro
(Karplus), así que se convierte y el validador rechaza la v1 con un mensaje
claro. Sin migración.

#### Colisión de nombres: `synth` vs `engine`

Los dos registros usan **nombres distintos para lo mismo**. `PluginKind` de
[src/plugins/types.ts](../../../src/plugins/types.ts) dice `'synth'`; el registro
de motores y el manifiesto del trozo 1 dicen `engine`. Hay consumidores vivos de
la primera forma: `listPlugins('synth')` en [main.ts:109](../../../src/main.ts) y
en [plugin-bootstrap.ts](../../../src/app/plugin-bootstrap.ts).

**Gana `engine`**, que es el nombre que usa todo lo demás (el registro de
motores, `EngineManifest`, `engineId` en la sesión, el `plugin.json` publicado).
`'synth'` desaparece del `PluginKind` en la rebanada A y sus dos consumidores se
actualizan. `src/plugins/synths/` es un directorio **vacío** y se borra.

Dejarlo sin decidir garantizaba una tercera forma más, que es exactamente lo que
este trozo existe para evitar.

### Una puerta

`src/plugins/capabilities.ts` — `capabilityOf(kind, id)` — con **accesores con
nombre** (`clipEditorFor`, `acceptsFileDrop`, `scopesFor`). Nunca un `switch`
suelto en el core.

Responde de dos fuentes y el que pregunta **no sabe cuál**: manifiesto de fichero
si el componente es un plugin, registro en código si es integrado. Ésa es la
propiedad que hace que el trozo 3 sea mecánico — migrar un componente muda su
respuesta de una fuente a otra **sin tocar el core**.

Sustituye a `src/plugin-host/plugin-capabilities.ts`, que hoy se llama así porque
pregunta primero "¿esto es un plugin?" — el reflejo exacto que estamos quitando.

### El catálogo por tipo

**engine** (11 preguntas):

| capacidad | sustituye a |
|---|---|
| `clipEditor: 'piano-roll' \| 'drum-grid' \| 'audio'` | ya existe y es obligatoria, pero [loom-api.ts:30](../../../src/plugin-host/loom-api.ts) convierte `'audio'` en `'piano-roll'` en silencio |
| `editorPage: 'poly' \| '303' \| 'drums'` | `session-host-lane-editor.ts:33-34`, `knob-mounting.ts:132`, `main.ts:409-410` |
| `accepts: ['audio-file']` | `=== 'sampler' \|\| === 'audio'` en `session-grid-templates.ts:130`, `session-host-audio-import.ts:80` |
| `acceptsNoteFx: boolean` | `lane-editor-panels.ts:19`, `trigger-dispatch.ts:48` |
| `swappable: boolean` | `engine-swap.ts:38` |
| `listedInSelector: boolean` | `session-grid-templates.ts:304` |
| `harmonic: boolean` | `session-inspector.ts:519,536` (botón de acordes y filtro de pistas) |
| `slideOnOverlap: boolean` | `lane-scheduler.ts:228` (el 303 deja de ser un nombre en el scheduler) |
| `shortLabel: string` | ya existe y aún convive con la cadena de seis `? :` de `session-host-util.ts:12-17` |
| `patternCategory: string` | `pattern-picker-ui.ts:19-20` |
| `roles: string[]` | los defaults de producto: `main.ts:177,455`, `lane-host-wiring.ts:20`, `midi-import-ui.ts:173,209`, `transcribe-to-clip.ts`, `session-inspector.ts:549`, `midi-to-session.ts:132,142` |

**modulator** (1): `scopes: ('shared' | 'per-voice')[]`, el primero es el inicial.
No hay `configEditor`: los mandos salen de `params: ParamSpec[]` por el grid
genérico, igual que en cualquier motor. Con dos moduladores y dos plantillas a
medida, un `configEditor` sería el id escrito de otra manera.

**notefx** (0 propias hoy) y **fx** (0 propias hoy): el registro de capacidades
existe igualmente para que el componente número 12 tenga dónde declarar sin abrir
otro mecanismo.

`clipEditor` y `editorPage` **no** hacen la UI extensible: el plugin elige de un
catálogo cerrado que publica el host. Es la decisión ya tomada en el trozo 1 — la
UI grande no es enchufable, sólo se elige por capacidad en vez de por nombre.

### Roles

Un componente declara `roles: ['default-melodic']` y el core deja de escribir
`'subtractive'` en seis sitios.

**Resolución: gana el primer reclamante en orden de registro.** Los integrados se
registran en el arranque, los plugins se cargan después, así que **instalar un
plugin no puede cambiar en silencio el motor por defecto**. Sin números de
prioridad ni desempates. Si nadie reclama un rol, cae al primer componente
registrado que cumpla el requisito estructural (para `default-melodic`:
`clipEditor === 'piano-roll'`).

## Las tres rebanadas

Verticales, no por tipo de trabajo. El trozo 1 enseñó que trocear por tipo de
trabajo deja ventanas donde el build o el sonido están rotos (entre sus tareas 5
y 6 `npm run build` salía 1; entre la 7 y la 8 una pista Karplus quedaba muda).
Cada rebanada termina en algo que se oye o se ve.

### A — Un plugin puede ser una caja de ritmos o un canal de audio

Manifiesto unificado + la puerta + las capacidades de motor de ese camino:
`clipEditor` (con el `'audio'` que hoy se tira), `accepts`, `acceptsNoteFx`,
`swappable`, `listedInSelector`, `harmonic`.

**Aceptación:** un plugin sonda declara canal de audio; se le arrastra un fichero
a su pista y **suena**, sin que ningún fichero de `src/` lo nombre. Un segundo
plugin sonda declara `clipEditor: 'drum-grid'` y recibe la rejilla de batería.

### B — El LFO y el ADSR salen del árbol

Los dos moduladores se convierten en plugins autocontenidos: su DSP a los **dos**
lados (hilo principal y worklet, con el hermano de `registerRenderer` que hace
falta en el worklet), sus params, su estado. Desaparecen `lfo-voice.ts`, las
ramas por kind de `modulation-runtime.ts`, las plantillas a medida de
`mod-config-templates.ts` y los dos botones literales de `modulation-ui.ts:63-64`.
El SPI pasa a `create(ctx, { state, bpm })`. `NoteFxKind` deja de ser una unión
cerrada y `notefx-chain`/`notefx-ui` construyen y se pintan por registro.

**Aceptación:** se borran los directorios del LFO y del ADSR del árbol y **siguen
sonando** desde `public/plugins/` — la misma forma de prueba que ya funcionó con
Karplus. Y un S&H que llega como plugin modula un filtro de forma **audible**,
que es la prueba de que el SPI dejó de producir moduladores mudos.

### C — El barrido

Lo que queda del censo: `shortLabel`, `editorPage`, `patternCategory`,
`slideOnOverlap`, `roles`.

**Aceptación:** `node tools/plugin-id-census.mjs` baja a su mínimo y **cada línea
que sobrevive tiene escrita la razón** — en el código o en este spec. Ésa es la
parte que faltó la vez anterior.

## Riesgo conocido: los params discretos con valor de cadena

Hoy el LFO guarda `waveform: 'sine'` y `trigger: 'free'` como **cadenas**,
mientras que los params discretos del sistema genérico se guardan como **índice
numérico** (`EngineParamSpec.default: number`, `options[]` para las etiquetas).

Al sacar el LFO del árbol, sus mandos pasan al grid genérico y hay que elegir: o
el sistema de params admite discretos con valor de cadena, o esos dos campos
cambian de forma en las sesiones ya guardadas. **Se elige lo primero**, que no
rompe nada guardado. Es trabajo de la rebanada B y hay que preverlo, no
descubrirlo a mitad.

## Lo que este trozo NO hace

- **No toca los backends** (`DrumsWorkletEngine`, `SamplerWorkletEngine`,
  `AudioWorkletEngine`). Trozo 3.
- **No migra los 8 motores restantes ni los 11 inserts.** Trozo 3.
- **No hace la UI extensible por plugin.** Decisión firme del trozo 1.
- **No toca los inserts**: ya están sanos, y sus 4 líneas son configuración de
  producto.
- **No arregla** el LFO cuyos anillos se congelan tras Random (preexistente en
  `main`, verificado) ni el `WorkletLaneEngine.bpm` que nadie asigna y que deja
  un LFO en SYNC sin seguir el tempo. Cada uno necesita su propia rama.

## Hechos verificados

Comprobados en el código el 2026-08-01, no inferidos.

| hecho | dónde |
|---|---|
| `chooseClipEditor` YA consulta el editor declarado por el motor | `clip-editor-router.ts:108` |
| `clipEditor` ya es campo obligatorio y validado del manifiesto | `manifest-validate.ts:31` |
| …y `'audio'` se convierte en `'piano-roll'` en silencio | `loom-api.ts:30` |
| `ModulatorKind` YA es `string`, no una unión cerrada | `modulation/types.ts:4` |
| `NoteFxKind` SÍ es una unión cerrada | `notefx-types.ts:20` |
| `scope` es campo por instancia y el usuario lo cambia | `mod-config-templates.ts:90-116` |
| el SPI de modulador no puede pasar estado, y el código lo dice | `modulation-host.ts:84-95` |
| `registerEngineFactory` existe pero sus factorías devuelven descriptores inertes | `registry.ts:47`, `fm.ts:72` |
| `createEngineInstance` está importado en el allocator y no se usa (import muerto) | `lane-allocator.ts:4` |
| `DescriptorEngineConfig` es extensible y TODOS los integrados pasan por ella | `descriptor-engine.ts:27` |
| `SynthEngine.editor` sólo admite `'piano-roll' \| 'drum-grid'` | `engine-types.ts:105` |
| los inserts ya construyen y se pintan por registro | `insert-slot.ts:45`, `lane-insert-ui.ts:218` |
