# Trozo 3, primera mitad — los cinco motores melódicos salen del árbol

> Trozo 3 del trabajo de plugins. El trozo 1 (ABI + SDK + CLI + host, validado
> sacando Karplus) y el trozo 2 (rebanadas A y B: manifiesto por componentes,
> puerta de capacidades, moduladores como componentes) están en `main`.
> Specs hermanos:
> [plugins-core-por-capacidades](2026-08-01-plugins-core-por-capacidades-design.md),
> [moduladores-como-componentes](2026-08-01-moduladores-como-componentes-design.md).

**Objetivo en una frase:** que `tb303`, `subtractive`, `fm`, `wavetable` y
`westcoast` vivan en `plugins/<id>/` exactamente como Karplus, y que `src/` deje
de nombrarlos.

**Idioma:** la prosa va en castellano; **todo lo que sea código va en inglés** —
identificadores, comentarios, nombres de test y mensajes de commit.

---

## 1. Decisiones cerradas (no rediscutir)

**Todo como Karplus.** No se diseña una segunda forma de empaquetar un motor: la
que hay funciona y está publicada.

**No hay compatibilidad que respetar.** La aplicación se está construyendo; no se
diseñan migraciones ni rutas de escape para sesiones guardadas. (Regla
permanente del proyecto.)

**Subtractive suelta su struct tipado.** Es la condición para que pueda ser un
plugin, y se explica en §3.

**Orden: los cuatro fáciles primero, Subtractive al final.** Si su colapso se
complica, los otros cuatro ya están dentro y no arrastran nada.

**Fuera de alcance, y va a su propio spec:** los backends de `sampler`, `audio` y
`drums-machine` (Decisión 2 del trozo 2 — siguen eligiéndose por `if (engineId
=== …)` en el allocator), los once inserts, y el instalador del trozo 4.

---

## 2. Hechos verificados en el código

Comprobados el 2026-08-01 sobre `main` = `8fead73`.

### 2.1 La forma exacta de un motor-plugin

`plugins/karplus/` contiene, y nada más:

| fichero | qué es |
| --- | --- |
| `plugin.json` | id, `loomApi: 1`, `main`, `dsp`, `presets`, y **un** `components[]` con `kind: "engine"`, sus `params`, sus `groups`, sus `modulators` y sus `capabilities` |
| `main.ts` | **una línea**: `Loom.registerComponent(manifest.components[0])` |
| `dsp.ts` | el renderer, que se registra solo con `Loom.registerRenderer(id, make)` **en el ámbito del módulo** |
| `presets.json` | los presets del motor |
| `reference-render.json` | la referencia de paridad muestra a muestra |
| `dsp.test.ts`, `karplus-parity.dsp.test.ts` | sus pruebas, dentro del plugin |

El host construye el motor con el **mismo** `WorkletLaneEngine` que usa para los
melódicos del árbol: `isWorkletHosted(id)` es cierto para todo id que llegó por
manifiesto ([capabilities.ts](../../../src/plugins/capabilities.ts)), y el
allocator lee el descriptor del registro. Por eso los cinco de este spec son
mecánicos: **comparten backend con Karplus**.

### 2.2 Qué hay que mover, motor a motor

| motor | en `src/engines/` | en `src/audio-dsp/` | extra |
| --- | --- | --- | --- |
| `tb303` | `tb303.ts` | `tb303-renderer.ts` | `presetKeyRemap` (§2.4); `slideOnOverlap` en `lane-scheduler.ts:228` |
| `fm` | `fm.ts` | `fm-renderer.ts` | — |
| `wavetable` | `wavetable.ts` | `wavetable-renderer.ts` | — |
| `westcoast` | `westcoast.ts`, `westcoast-fold.ts` | `westcoast-renderer.ts` | — |
| `subtractive` | `subtractive.ts`, `subtractive-params.ts` | `subtractive-renderer.ts` | el struct tipado, §3 |

Los presets viven hoy en `public/presets/<id>.json` y pasan al `presets.json` de
cada plugin, como el de Karplus.

### 2.4 El `presetKeyRemap` del 303 muere, no viaja

`lane-allocator.ts:131` pasa `TB303_PRESET_KEY_TO_SPEC` al construir un
`WorkletLaneEngine` de `tb303`: un remapeo de las claves planas heredadas de sus
presets (`cutoff`) a los dot-ids del spec (`filter.cutoff`). Existe sólo porque
el JSON de presets del 303 se escribió antes que el vocabulario dot-id.

**Se resuelve en el origen:** el `presets.json` del plugin se escribe ya en
dot-ids, y el remapeo desaparece con el campo. No se mueve al manifiesto: sería
mudar de sitio una compatibilidad que este proyecto no tiene que respetar, y
dejaría al ABI cargando con la historia de un motor concreto. Una línea menos en
el censo y un campo menos en `WorkletEngineConfig`.

### 2.3 El método de prueba que ya funcionó

`plugins/karplus/karplus-parity.dsp.test.ts` es el patrón a repetir, y sus tres
decisiones son deliberadas:

- La referencia (`reference-render.json`) **guarda una de cada 512 muestras** —
  bastante para fijar la forma, poco para commitear.
- La excitación es **determinista con semilla fija**; sin la misma semilla la
  referencia no significaría nada.
- El test instala un `Loom` **de dos líneas** con `vi.hoisted` antes de importar
  el DSP, lo que a la vez **demuestra que la mitad DSP de un plugin no necesita
  del host nada más que `registerRenderer`**.

---

## 3. El nudo: Subtractive lee un struct tipado

No es deuda histórica. Está documentado como optimización deliberada en
[audio-dsp/types.ts:35-44](../../../src/audio-dsp/types.ts#L35-L44):

> *"Subtractive reads a typed `SubParams` instead of the dot-id bag, **an
> internal optimisation no plugin should depend on** … the lane keeps ONE live
> snapshot and every voice reads through it — refreshed once per lane per
> sample, never once per voice."*

Se materializa en cuatro comparaciones por id en el **camino de audio**:

| sitio | qué hace |
| --- | --- |
| `voice-manager.ts:123` | construye `subParamsFromBag(...)` y lo entrega por `setLiveSubParams` |
| `voice-manager.ts:182` | rellena un `VoiceModOffsets` **por campos** (`filterCutoff`, `osc1Level`, …) en vez del mapa dot-id genérico |
| `worklet-lane-engine.ts:149` | `fieldForParamId` en vez de `makeDotIdMapper` |
| `worklet-lane-engine.ts:280` | rama propia |

**El propio comentario dice que ningún plugin debe depender de eso.** Mientras
exista, Subtractive no puede ser un plugin: el core lo trataría distinto donde
más importa.

**El cambio:** su renderer pasa a leer el bag por dot-id y el mapa de modulación
genérico. Mueren `SubParams`, `subParamsFromBag`, `setLiveSubParams`,
`fieldForParamId` y las cuatro comparaciones. Con ellas desaparece la última
asimetría de audio del core.

**El riesgo es de CPU, no de corrección**, y por eso no se resuelve opinando.
Sustituir una optimización medida por una suposición sería cambiar un hecho por
una corazonada.

**Cómo se mide, para que el número signifique algo.** El kernel es JS puro y se
puede ejecutar sin `AudioContext` — es lo que ya hacen los `.dsp.test.ts`. La
medida es: renderizar muestra a muestra **10 s a 48 kHz con 8 voces
simultáneas** de Subtractive, cronometrado, **cinco veces**, y quedarse con la
mediana; una vez sobre `main` y otra sobre la rama. Se compara la mediana, no
una tirada suelta, porque una sola medición en una máquina con otras cosas
abiertas no distingue una regresión de un pico del sistema.

El número va escrito en el plan. Si el coste resulta inaceptable, la decisión
vuelve a Nacho con la medición delante — no se "arregla" ensanchando el ABI por
la puerta de atrás.

---

## 4. Aceptación

Por motor, y en este orden:

1. **Paridad muestra a muestra.** `reference-render.json` capturado ANTES de
   mover nada y verde DESPUÉS, con el mismo estilo que el de Karplus.
2. **El motor desaparece de `src/`** — sus ficheros borrados, y `grep` del id por
   `src/` sin resultados salvo los que este spec justifique por escrito.
3. **La suite entera verde**: unidad, e2e y `tsc --noEmit`.
4. **Se oye.** El e2e `engine-knobs.spec.ts` ya afirma que cada motor pinta sus
   knobs; esto es lo otro: que el motor **suena** desde `plugins/`, medido con el
   tap de master que ya usan los e2e de audio.

Y una sola vez, para Subtractive: **la medición de CPU** descrita en §3, antes y
después, con la mediana de cinco tiradas escrita en el plan.

## 5. Riesgos conocidos

- **Subtractive es el motor con más presets y más uso.** Va el último a
  propósito, y su paridad es la que más importa.
- **El censo cuenta líneas que no son ids de motor** (tipos de clip y de zona,
  `kind === 'audio'`). Al medir el resultado con `tools/plugin-id-census.mjs`
  hay que separarlas, o el número mentirá en la dirección cómoda.
