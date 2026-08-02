# Trozo 3, primera mitad — params por índice, y los cinco melódicos salen del árbol

> Trozo 3 del trabajo de plugins. El trozo 1 (ABI + SDK + CLI + host, validado
> sacando Karplus) y el trozo 2 (rebanadas A y B: manifiesto por componentes,
> puerta de capacidades, moduladores como componentes) están en `main`.
> Specs hermanos:
> [plugins-core-por-capacidades](2026-08-01-plugins-core-por-capacidades-design.md),
> [moduladores-como-componentes](2026-08-01-moduladores-como-componentes-design.md).

**Objetivo en una frase:** que `tb303`, `subtractive`, `fm`, `wavetable` y
`westcoast` vivan en `plugins/<id>/` como Karplus — y que, para que Subtractive
pueda irse sin perder velocidad, **el bucle de audio deje de leer sus parámetros
por nombre y pase a leerlos por índice**, para todos los motores a la vez.

**Idioma:** la prosa va en castellano; **todo lo que sea código va en inglés** —
identificadores, comentarios, nombres de test y mensajes de commit.

---

## 1. Decisiones cerradas (no rediscutir)

**Todo como Karplus.** No se diseña una segunda forma de empaquetar un motor.

**No hay compatibilidad que respetar.** La aplicación se está construyendo; no se
diseñan migraciones ni rutas de escape. Regla permanente del proyecto, y es lo
que hace barato el cambio de ABI de §4.

**Los params se leen por índice en el camino de audio.** Decisión de Nacho tras
ver la medición de §3: no se sacrifica la velocidad de Subtractive, se le da a
todo el mundo.

**Orden: primero el cambio a índices con los seis motores DENTRO del árbol, y
después la mudanza.** Cambiar el bucle de audio de seis motores repartidos entre
`src/` y `plugins/` es operar en seis quirófanos a la vez; hacerlo con los seis
juntos permite compararlos entre ellos. La mudanza posterior es mover ficheros.

**Fuera de alcance, cada uno a su spec:** los backends de `sampler`, `audio` y
`drums-machine`, los once inserts, y el instalador del trozo 4.

---

## 2. Hechos verificados en el código

Comprobados el 2026-08-01 sobre `main` = `8fead73`.

### 2.1 La forma exacta de un motor-plugin

`plugins/karplus/` contiene, y nada más: `plugin.json` (id, `loomApi`, `main`,
`dsp`, `presets`, y **un** `components[]` con `kind: "engine"`, sus `params`,
`groups`, `modulators` y `capabilities`), un `main.ts` de **una línea**
(`Loom.registerComponent(manifest.components[0])`), un `dsp.ts` que se registra
solo con `Loom.registerRenderer(id, make)` en el ámbito del módulo, su
`presets.json`, su `reference-render.json` y sus tests.

El host lo construye con el **mismo** `WorkletLaneEngine` que usa para los
melódicos del árbol. Por eso los cinco de este spec comparten backend con él.

### 2.2 Qué se mueve, motor a motor

| motor | en `src/engines/` | en `src/audio-dsp/` |
| --- | --- | --- |
| `tb303` | `tb303.ts` | `tb303-renderer.ts` |
| `fm` | `fm.ts` | `fm-renderer.ts` |
| `wavetable` | `wavetable.ts` | `wavetable-renderer.ts` |
| `westcoast` | `westcoast.ts`, `westcoast-fold.ts` | `westcoast-renderer.ts` |
| `subtractive` | `subtractive.ts`, `subtractive-params.ts` | `subtractive-renderer.ts` |

Los presets pasan de `public/presets/<id>.json` al `presets.json` de cada plugin.

### 2.3 El `presetKeyRemap` del 303 muere, no viaja

`lane-allocator.ts:131` pasa `TB303_PRESET_KEY_TO_SPEC` al construir un `tb303`:
un remapeo de claves planas heredadas (`cutoff`) a dot-ids (`filter.cutoff`),
que existe sólo porque el JSON de presets del 303 es anterior al vocabulario
dot-id. **Se resuelve en el origen:** el `presets.json` del plugin se escribe ya
en dot-ids y el campo desaparece. No se muda al manifiesto: sería trasladar una
compatibilidad que este proyecto no tiene que respetar y dejar al ABI cargando
con la historia de un motor concreto.

### 2.4 El método de prueba que ya funcionó

`plugins/karplus/karplus-parity.dsp.test.ts` es el patrón, y sus tres decisiones
son deliberadas: la referencia guarda **una de cada 512 muestras**, la excitación
es **determinista con semilla fija**, y el test instala un `Loom` de **dos
líneas** antes de importar el DSP — lo que de paso demuestra que la mitad DSP de
un plugin no necesita del host nada más que `registerRenderer`.

---

## 3. La medición que decidió el diseño

Subtractive lee hoy un struct tipado (`SubParams`) en vez del bag por nombre.
[audio-dsp/types.ts:35-44](../../../src/audio-dsp/types.ts#L35-L44) lo documenta
como optimización deliberada *"no plugin should depend on"*. Un plugin no puede
tenerla: el host no conoce sus campos por adelantado.

**Primera hipótesis, refutada por la medición.** Se probó que bastaba con crear
el bag con su forma definitiva de una vez, en lugar de ir añadiéndole claves.
Banco de 31 M de lecturas, mediana de 5 tiradas:

| | mediana |
| --- | --- |
| bag construido clave a clave (hoy) | **102 ms** |
| bag pre-formado, mismas claves dot-id | **104 ms** |

Idénticos. **Pre-formar no sirve de nada**, y ésa era la base del diseño
anterior.

**Un número descartado a propósito.** El mismo banco daba "39× más rápido" para
el struct — 0,08 ns por lectura, menos de un ciclo de reloj. Es imposible: mide
al compilador eliminando el trabajo, no al trabajo. **No se usa.**

**El número que sí vale:** una lectura por nombre cuesta **~3,2 ns**. Para 8
voces × 8 params a 48 kHz son **~1% de un núcleo por pista**; con los ~30 params
que Subtractive lee de verdad, del orden del **4%**.

**Conclusión:** la ventaja del struct no está en su forma sino en que sus campos
son conocidos al compilar. Con claves de texto eso no se consigue. Con **índices
resueltos una vez** sí — y se consigue para cualquier motor, plugin incluido.

---

## 4. El diseño: texto por fuera, números por dentro

**Los nombres no desaparecen.** Siguen en el manifiesto, en los presets, en el
estado de sesión y en los mensajes hacia el worklet. Lo único que cambia es el
**bucle caliente**.

1. **Al construir un motor**, el host numera sus params a partir de la lista que
   el propio motor declara (orden de declaración). Eso da un `ParamIndex`:
   `Record<string, number>` más su longitud. Un plugin lo obtiene igual, de su
   manifiesto.
2. **Los valores vivos** dejan de ser un objeto por nombre y pasan a ser un
   `Float64Array` de esa longitud, propiedad del `ParamSmoother`, mutado en el
   sitio como hoy. Su lista de "params en vuelo" pasa a ser de índices.
3. **El renderer recibe el array y el índice UNA vez**, al construirse, y
   resuelve ahí los índices que le importan. A partir de ese momento lee
   `values[this.iCutoff]`.
4. **La modulación viaja igual**: un segundo `Float64Array` de la misma longitud,
   escrito por índice. Con eso muere también el `VoiceModOffsets` con campos
   propios de Subtractive.
5. **Los tres destinos sintéticos** (`amp`, `ampGain`, `filterEnv`) no son params
   declarados: se les reservan índices **detrás** de los declarados, de modo que
   el índice de un param declarado nunca dependa de ellos.
6. **En la frontera**, los mensajes siguen llegando como hoy (dot-id → número) y
   se resuelven a índice al recibirlos. Un id sin casilla se **ignora con un
   aviso una sola vez**: hoy crearía una clave que nadie lee, y eso es una errata
   de plugin que pasa desapercibida.

**Lo que muere con esto:** `SubParams`, `subParamsFromBag`, `subParamsInto`,
`setLiveSubParams`, `fieldForParamId` y las cuatro comparaciones
`=== 'subtractive'` del camino de audio (`voice-manager.ts:123,182`,
`worklet-lane-engine.ts:149,280`). Subtractive deja de ser especial **donde más
importa**, y no por renunciar a nada.

### 4.1 Esto cambia el ABI, y hay que decirlo

Karplus **ya está fuera del árbol**, así que su `dsp.ts` se escribe contra este
contrato: cambiarlo es cambiar el ABI, no sólo la tripa. `loomApi` sube a **2** y
el `VoiceRenderer` publicado por el SDK cambia de forma. Cualquier plugin escrito
contra la 1 dejaría de valer.

Hoy eso es gratis — los únicos plugins son nuestros. Dentro de seis meses, con un
plugin de terceros vivo, sería caro. **Es un argumento para hacerlo ahora**, y es
la razón por la que va junto y no después.

---

## 5. Aceptación

**Fase 1 — params por índice** (los seis motores dentro del árbol, más Karplus):

1. **Paridad muestra a muestra por motor.** Referencia capturada ANTES de tocar
   nada y verde DESPUÉS, con el estilo del test de Karplus.
2. **Medición de CPU antes y después**, con el método de §3 (10 s a 48 kHz, 8
   voces, mediana de 5 tiradas, sobre `main` y sobre la rama). El ~4% de
   Subtractive tiene que volver, y los otros cinco tienen que **mejorar**. Los
   números van escritos en el plan.
3. **Suite entera verde**: unidad, e2e y `tsc --noEmit`.

**Fase 2 — la mudanza** (los cinco melódicos):

1. La paridad de cada motor sigue verde **después** de mover sus ficheros.
2. El motor desaparece de `src/`: sus ficheros borrados y `grep` de su id sin
   resultados salvo lo que este spec justifique por escrito.
3. **Suena desde `plugins/`**, medido con el tap de master que ya usan los e2e de
   audio — no basta con que pinte sus knobs, que eso ya lo afirma
   `engine-knobs.spec.ts`.

## 6. Riesgos conocidos

- **Es cirugía en el camino de audio de seis motores a la vez.** La red es la
  paridad muestra a muestra, y por eso se captura **antes** de la primera línea.
- **Subtractive es el motor con más presets y más uso**, y el que más gana. Su
  paridad es la que más importa.
- **El censo cuenta líneas que no son ids de motor** (tipos de clip y de zona,
  `kind === 'audio'`). Al medir el resultado con `tools/plugin-id-census.mjs` hay
  que separarlas, o el número mentirá en la dirección cómoda.
- **El banco de §3 mide lecturas sueltas, no un renderer real.** Sirvió para
  descartar una hipótesis y para dar un orden de magnitud; la medición de
  aceptación (§5) es la que manda, y ésa sí ejecuta el kernel de verdad.
