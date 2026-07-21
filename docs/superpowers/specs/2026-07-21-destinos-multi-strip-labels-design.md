# Etiquetas de destino para motores multi-strip (drums, sampler)

**Fecha:** 2026-07-21
**Estado:** diseño aprobado, pendiente de plan
**Depende de:** el registro maestro de destinos (ya en main)

> En castellano a propósito: su lector es quien lo aprueba. El código y la UI van en inglés.

## El problema

Drums y el sampler son motores de varias voces/pads. Cada uno declara los mismos
parámetros por voz: `kick.tune`, `clap.tune`, `closedHat.tune`… El identificador **sí**
lleva la voz. Pero la etiqueta que se pinta en el desplegable de destinos es solo
`spec.label` — "TUNE", "DECAY" — y la voz se descarta.

Resultado: en un desplegable de automatización de un lane de batería ves ocho "TUNE"
seguidos y **no sabes si es el del bombo o el de la palma**. En un lane de sampler con
muchos pads, igual. La lista quedó más limpia con el registro unificado, y eso está bien,
pero perder de qué voz es cada parámetro es un problema real de uso.

Confirmado en el código: `buildPerVoiceSpecs` (drums) y el bucle de pads (sampler)
construyen `id = \`${voice}.${leaf}\``, y `listAutomationTargets` empuja `spec.label` como
etiqueta. La voz viaja en el id y se tira al etiquetar.

## Qué cambia

Cada destino gana un **subgrupo** opcional. Los desplegables, que hoy agrupan por canal
(`groupTargetsByLane`), pasan a agrupar por **canal + subgrupo**, y dentro de cada
cabecera va solo el nombre del parámetro.

Lectura elegida (con vista previa aprobada): **cabecera por voz/pad** — cada voz es su
propia cabecera del `<optgroup>` nativo, en negrita, con los parámetros debajo a secas.

```
Kick
   Tune
   Decay
Snare
   Tune
   Tone
Closed Hat
   Tune
```

- **Drums:** el subgrupo es la voz con nombre presentable (`closedHat` → "Closed Hat").
- **Sampler:** el subgrupo es **la nota del pad** (C1, D#1…), derivada del identificador.
- **Los demás motores:** sin subgrupo. `groupTargetsByLane` los agrupa exactamente como
  hoy. Cero cambio para tb303, subtractive, fm, wavetable, karplus, westcoast, audio.

## Por qué la nota y no el nombre del sample

Se consideró usar el nombre del sample ("kick.wav") para los pads. **Se descartó tras
comprobar el estado real:** la sesión guarda por pad un `sampleId` opaco (`smp-<base36>`)
y la nota raíz — pero **no** el nombre. El nombre vive en el `SampleAsset`, en IndexedDB,
que es estado en vivo y asíncrono. Leerlo desde el catálogo reintroduciría exactamente la
caducidad que el registro de destinos vino a eliminar (la lista dependería de lo que esté
montado/cargado, no del proyecto).

La nota sale limpia del identificador del pad, siempre está, y no crea ningún espejo. Es
la única opción coherente con "la lista se deriva del proyecto".

## Dónde vive el cambio

**Agrupar es gratis** — la voz ya está en el identificador. Lo que necesita una fuente es
el **nombre presentable** del subgrupo, y ahí está la única decisión de arquitectura.

El nombre de una voz de drums es un mapa fijo (`kick` → "Kick", `closedHat` → "Closed
Hat"). El de un pad de sampler es la nota, derivable del pad-key. Ninguno de los dos está
en la declaración estática de parámetros. Así que **el motor lo expone**:

```ts
// Nuevo, opcional, en la interfaz SynthEngine
subGroupFor?(paramId: string): { key: string; label: string } | undefined;
```

- Drums lo implementa: parsea el primer segmento del id, lo mapea al nombre de voz.
- El sampler lo implementa: parsea el pad-key, devuelve la nota.
- Los demás motores no lo implementan → `undefined` → sin subgrupo.

`listAutomationTargets` llama a `engine.subGroupFor?.(spec.id)` al construir cada destino,
y guarda el resultado en `AutomationTarget.subGroup`. El catálogo no sabe nada de voces ni
de pads — solo pregunta al motor, que es quien sabe.

## Estructura de datos

`AutomationTarget` gana:

```ts
/** Optional sub-heading within a lane: a drum voice, a sampler pad. undefined
 *  for single-strip engines, which group by lane alone as before. */
subGroup?: { key: string; label: string };
```

El agrupado de los pickers pasa de `groupTargetsByLane` (clave = `laneName`) a agrupar por
`laneName` + `subGroup.label`. La cabecera del `<optgroup>` es:

- `laneName` cuando no hay subgrupo (como hoy).
- `laneName · subGroup.label` cuando lo hay, para que dos lanes de drums en el mismo
  desplegable cross-lane no confundan sus "Kick". En el desplegable de modulación, que ya
  está acotado a un lane, esto se lee como `Drums 1 · Kick` — algo verboso pero inequívoco.

## Consumidores — más barato de lo que parece

Se comprobó en el código: **los cuatro desplegables agrupan por la MISMA función**,
`groupTargetsByLane`, y cada uno usa la clave del mapa que devuelve **directamente** como
etiqueta del `<optgroup>`:

- `src/session/clip-automation-lanes.ts` (+ Automation del clip)
- `src/performance/performance-automation-ui.ts` (cabecera de Performance)
- `src/performance/xy-pad-ui.ts` (ejes del XY pad)
- `src/modulation/mod-routing-templates.ts` (destino de LFO/ADSR — ojo, NO
  `modulation-ui.ts`: el panel se portó a lit-html y el agrupado vive aquí)

Por eso el cambio de agrupado se hace en **un solo sitio**: `groupTargetsByLane` pasa a
partir por `laneName` + `subGroup`, y los cuatro llamantes heredan las cabeceras **sin
editarse** — ya iteran `[cabecera, grupo]` y ponen la cabecera tal cual. Su única variable
se llama `laneName`; es cosmético.

El único punto extra es la **etiqueta de una lane de automatización ya creada** — hoy
muestra solo el parámetro; debe mostrar la voz para que sepas qué estás editando. Ese sí
es un sitio aparte de la función de agrupado.

## Fuera de alcance

- **El menú contextual del mando NO se toca.** Clic derecho en el mando del bombo ya sabe
  exactamente qué parámetro es; la ambigüedad solo existe en los desplegables.
- **No se toca ningún identificador ni dato guardado.** Es puramente de presentación: el
  subgrupo se calcula al listar, no se persiste.
- El nombre del sample (descartado arriba).

## Pruebas

- Un lane de drums produce un destino por voz×parámetro, cada uno con `subGroup` = la voz.
- La voz `closedHat` se etiqueta "Closed Hat", no "closedHat".
- Un lane de sampler produce `subGroup` = la nota del pad.
- Un lane single-strip (subtractive) produce destinos **sin** `subGroup` — control de que
  nada cambia para ellos.
- El agrupado de un desplegable pone los parámetros del bombo bajo una cabecera y los de
  la palma bajo otra, no todos juntos.
- Dos lanes de drums en un desplegable cross-lane no funden sus cabeceras "Kick".

Trampas conocidas: `listAutomationTargets` devuelve `[]` en silencio para un plugin no
registrado, y `getEngine()` devuelve `undefined` para un motor cuyo módulo no se importó.
Ver `docs/automation-destinations.md`.

## Riesgo

Bajo. No toca datos ni identificadores. El único punto delicado es que `subGroupFor` viva
en el motor y no en el catálogo — si se filtra lógica de drums al catálogo, se repite el
error que todo el registro vino a arreglar. El plan debe mantener esa frontera.
