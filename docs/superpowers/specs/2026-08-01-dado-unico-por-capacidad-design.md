# Un solo dado, mostrado por capacidad

Estado: aprobado el 2026-08-01. Rama `fix/randomize-unify`.

## El síntoma

Con un LFO activo sobre un parámetro, pulsar **🎲 Sound** en una pista fm / wavetable
/ westcoast / karplus deja los **anillos ámbar de modulación congelados** y los
**knobs clavados en el valor viejo**, mientras el sonido sí cambia. Subtractive no
falla. El TB-303 tampoco. Preexistente en `main`, verificado sirviendo `main` y la
rama de plugins en paralelo.

## La causa

El dado del inspector llama a `rebuildEngineParamUI()`, que hace
`unregisterKnobsByPrefix('<laneId>.')` — **borra del `automationRegistry` todos los
knobs de la pista** — y sólo los repone para el panel de FX y, bajo un
`if (engineId === 'subtractive')`, las secciones fijas de Subtractive. Los demás
motores tienen sus knobs en la rejilla genérica de `WorkletLaneEngine.buildParamUI`,
que nadie vuelve a llamar.

De ahí salen los dos síntomas, que son el mismo:

- el anillo lo pinta un rAF que recorre **el registro entero cada frame**
  (`automation/automation-tick.ts` `applyModulationRings`); un knob fuera del
  registro no vuelve a recibir `setModulationOffset` nunca → se queda congelado;
- nadie hace `setValue` sobre esos knobs → siguen mostrando el valor anterior.

`rebuildEngineParamUI` es la herramienta del **cambio de motor**. Su `if subtractive`
es correcto ahí. El error es que el dado la use.

## La causa de la causa

La fila `PRESET [select] [Load] [Save As…] [Delete] [🎲 Sound]` está escrita **tres
veces a mano** en `index.html` (páginas `303`, `drums` y `poly`). Tres botones con el
mismo texto, el mismo icono y el mismo tooltip, con **tres comportamientos
distintos**:

| Botón | Qué hace hoy |
|---|---|
| `#bass-random-sound` (303) | `engine.randomize()` → repinta con `refreshKnobsFromSynth` → marca Custom → envuelto en `withUndo` ✅ |
| `#poly-randomize` (poly) | `engine.randomize()` → **`rebuildEngineParamUI()`** → marca Custom → sin `withUndo` ❌ |
| `#drums-random-sound` (drums) | no toca el motor: elige un kit al azar desde la UI |

Además, en una pista **Sampler** (que vive en la página poly) el dado se muestra y
**no hace nada**: el handler se sale por `if (!engine?.randomize) return;`.

**Matiz sobre el `withUndo`, comprobado en el código y no supuesto:**
`withUndo<R>(_d, fn) { return fn(); }` es hoy un **paso a través** que ignora sus
deps (`save/history-wiring.ts:58`). El deshacer real lo produce AutoHistory con su
checkpoint por microtarea, para las dos rutas por igual. O sea que la divergencia del
`withUndo` es **cosmética, no de comportamiento**: el dado del inspector SÍ se
deshace hoy. Se unifica igual — que dos llamadas al mismo gesto se escriban distinto
es la clase de detalle que se vuelve real el día que `withUndo` deje de ser un
no-op — pero **no se le vende al usuario como un bug arreglado**, y no lleva test
propio: un test sobre un no-op no afirma nada.

Arreglar sólo el camino roto deja las tres copias en pie para que vuelvan a divergir.

## La regla

> **El 🎲 se muestra si y sólo si el motor de la pista declara `isRandomizable`.**

Capacidad **declarada**, no identidad ni husmeo de métodos. Se pregunta por la puerta
única, `isRandomizable(engineId)` de [`src/plugins/capabilities.ts`](../../../src/plugins/capabilities.ts)
— la misma línea de la rebanada de capacidades (`26db8d9`, "seven core sites stop
comparing engine ids") y del frente 2 del
[master plan de simetría](2026-07-26-architecture-symmetry-master-plan.md).

**La capacidad ya existe y está esperando a este spec.** Su docstring dice que su
lector es el dado y que se dejó sin cablear a propósito porque esconderlo era una
decisión de UI aparte. Esta es esa decisión. Estado verificado en `main`:

- `audio`, `drums-machine` y `sampler` declaran **`isRandomizable: false`**, con el
  motivo escrito ("sound is a loaded kit/keymap, not a bag of params");
- todo lo demás hereda el **`true`** por defecto — los seis melódicos, incluido
  karplus como plugin externo;
- hay tests que ya afirman esas tres declaraciones, y `manifest-validate` acepta la
  clave, así que un plugin de terceros puede declararla igual que un motor interno.

Corrobora, pero **no es el criterio**: `randomize()` lo implementa sólo
`WorkletLaneEngine`. Las dos vías coinciden hoy en los nueve motores. La capacidad
manda porque es una **declaración** que un plugin puede hacer sin heredar de nada; el
método sigue siendo la implementación, y el handler se protege igual con
`if (!engine?.randomize) return;` por si alguna vez divergen.

## Qué cambia

1. **Un único handler**, `randomizeLaneSound(laneId)` en `core/randomize-ui.ts`:
   `engine.randomize()` → `commitEngineBaseValues(...)` → **`refreshLaneKnobs(laneId, engine)`**
   → marcar el preset de esa pista como Custom → todo envuelto en `withUndo`.
   `rebuildEngineParamUI` desaparece del camino del dado.
2. **Un único botón, definido una vez.** Los tres `<button>` estáticos salen de
   `index.html`; cada fila PRESET deja un ancla vacía y el módulo del dado monta ahí
   **el** botón, y sólo si `isRandomizable(engineId)` de la pista activa. El Sampler
   deja de enseñar un botón que miente, sin que nadie tenga que acordarse de
   esconderlo: ya declara que no se randomiza.
3. **El dado de drums se borra.** Nunca fue un randomize: era un selector de preset
   disfrazado, y `drums-machine` ya declara `isRandomizable: false`. El desplegable de
   kits cubre ese gesto. Se van con él `randomizeDrumsSound` y `pickRandomDrumKit` si
   no les queda otro llamador.
4. **`refreshKnobsFromSynth()`** queda revisado: hoy sólo sirve al bajo y sólo si el
   motor es `tb303`. Si tras el cambio no le queda ningún llamador legítimo (lo usa
   el cargado de sesión), se va.
5. **Las dos docstrings dejan de mentir.** `capabilities.ts` y el `manifest.ts` del
   SDK dicen que `isRandomizable` *"NOT read by any consumer yet"*. En cuanto el dado
   la lea, eso es falso y hay que corregirlo en el mismo commit — este repo ya tiene
   commits dedicados a docstrings que mentían (`d5bd814`).

## Simetría total: muere la página 303

**Ampliación de alcance decidida por Nacho el 2026-08-01**, a media implementación:
*"debería haber sólo 1 [botón], no entiendo cómo el 303 tiene uno propio"* → *"sí,
simetría total"*. El alcance original (un botón definido una vez, montado en dos
anclas) dejaba en pie la razón de que hubiera dos anclas.

**Por qué había tres botones: porque había tres páginas**, y cada una se copió a mano
la fila `PRESET`. La del 303 existe desde antes de que hubiera pistas con motor
intercambiable, y al medirla resultó ser un **subconjunto estricto** de la poly: la
misma fila ENGINE/PRESET con otros ids, la misma fila FX. Lo único suyo —la fila
estática de knobs Wave/Cutoff/Resonance/Env/Decay/Accent— ya se había mudado a
`buildParamUI` como en los demás motores. Y su pestaña estaba **oculta por CSS**
(`button.tab[data-tab="303"] { display: none !important }`), así que no era ni
navegable: la página la elegía el router según la pista editada.

Coste medido antes de decidir: **28 referencias** a ids que sólo ella usaba.

Se van con ella: un segundo selector de motor (`#engine-select-303`,
`wireEngineSelector303`, `populateEngineSelect303`), un segundo desplegable de
presets (`#bass-preset-select`, `mountBassPresetSelect` y, en cadena,
`populateEnginePresetSelectById` + `wireEnginePresetSelectById`, de los que era el
único llamador), el segundo dado, `#bass-tracks` (que no referenciaba ni un `.ts`) y
el espejado de `engineSel303` repartido por `main.ts`. El router de `showLaneEditor`
pierde una de sus dos comparaciones por `engineId`: una pista es `drums` o es `poly`.

**Queda UN botón.** No "uno definido una vez y montado en dos sitios": uno.

Nada de audio cambia. Editar el bajo abre el panel común con los mismos controles,
pintados por su propio motor.

## Qué NO entra

Se nombra para que no se cuele por el camino:

- **El catálogo de presets.** El `select` + Load/Save As/Delete siguen duplicados
  entre la página poly y la de drums, con implementaciones distintas (presets de
  motor, presets de usuario poly, kits de drums). Es deuda real y reconocida, pero es
  **otro concern** — ahí sí viven diferencias por motor que hay que diseñar, no
  unificar a ciegas.
- **La página de drums.** Sí tiene contenido propio de verdad (pads, kits, los knobs
  del bus de drums), así que su separación no es un accidente histórico como lo era
  la del 303.
- **El `if (engineId === 'subtractive')` de `rebuildEngineParamUI`** y el montaje en
  secciones fijas de Subtractive. Siguen siendo correctos para el cambio de motor,
  que es su trabajo; dejan de ser dañinos en cuanto el dado no pasa por ahí.

## Verificación

Tests primero, cada uno cubriendo un camino de usuario, sin alternativas dentro del
mismo test:

1. **El registro sobrevive al dado.** Knobs de una pista `fm` registrados → disparar
   el dado → siguen en el `automationRegistry`. Falla hoy.
2. **Los knobs se repintan.** Tras el dado, el handle muestra el nuevo
   `getBaseValue`. Falla hoy.
3. **El botón aparece por capacidad**: se monta para un motor que declara
   `isRandomizable` y no se monta para el Sampler, que declara lo contrario. El test
   registra sus capacidades por la puerta, sin nombrar motores concretos en el
   assert más de lo imprescindible.
4. **Drums no tiene dado.**

Y una comprobación a ojo en Chrome, porque es UI: pista FM con un LFO sobre el
cutoff → 🎲 → los knobs se mueven **y** el anillo sigue girando.

## Riesgos

- **Un ancla por página sigue siendo tres puntos de montaje.** Son marcadores
  inertes, no widgets duplicados: el comportamiento y el markup del botón viven en un
  solo sitio. Se acepta a conciencia; la alternativa (una sola cabecera compartida
  para toda la fila) es el trabajo que queda explícitamente fuera.
- **Marcar Custom sin conocer la página.** Hoy un camino recibe el id del `<select>`
  y el otro asume "la pista activa". La versión unificada recibe `laneId`; hay que
  comprobar si `#poly-preset-select` está en el mapa `pageSelectActiveLane` de
  `polysynth-presets.ts` y meterlo si no.
- **Borrar el dado de drums es visible para el usuario.** Decisión tomada por Nacho
  el 2026-08-01.
