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
| `#bass-random-sound` (303) | `engine.randomize()` → repinta con `refreshKnobsFromSynth` → marca Custom → `withUndo` ✅ |
| `#poly-randomize` (poly) | `engine.randomize()` → **`rebuildEngineParamUI()`** → marca Custom → **sin `withUndo`** ❌ |
| `#drums-random-sound` (drums) | no toca el motor: elige un kit al azar desde la UI |

Además, en una pista **Sampler** (que vive en la página poly) el dado se muestra y
**no hace nada**: el handler se sale por `if (!engine?.randomize) return;`.

Arreglar sólo el camino roto deja las tres copias en pie para que vuelvan a divergir.

## La regla

> **El 🎲 se muestra si y sólo si el motor de la pista implementa `randomize()`.**

Capacidad, no identidad — la misma línea que el core ya tomó en `7434cdf`
("el core pregunta capacidades en vez de comparar ids") y el frente 2 del
[master plan de simetría](2026-07-26-architecture-symmetry-master-plan.md).

Verificado en código: `randomize()` lo implementa **sólo `WorkletLaneEngine`**
(`src/engines/worklet-lane-engine.ts`), delegando en `randomizeEngineParams`, que lee
el spec declarado. Eso cubre los seis motores melódicos — incluido karplus, que ya es
un plugin externo pero recibe un `WorkletLaneEngine` porque el allocator lo admite
por capacidad (`isWorkletHosted`). `SamplerWorkletEngine`, `AudioWorkletEngine` y
`DrumsWorkletEngine` no lo implementan y no lo implementarán: **el dado es de los
sintes**.

## Qué cambia

1. **Un único handler**, `randomizeLaneSound(laneId)` en `core/randomize-ui.ts`:
   `engine.randomize()` → `commitEngineBaseValues(...)` → **`refreshLaneKnobs(laneId, engine)`**
   → marcar el preset de esa pista como Custom → todo envuelto en `withUndo`.
   `rebuildEngineParamUI` desaparece del camino del dado.
2. **Un único botón, definido una vez.** Los tres `<button>` estáticos salen de
   `index.html`; cada fila PRESET deja un ancla vacía y el módulo del dado monta ahí
   **el** botón, sólo si el motor de la pista activa puede tirarse los dados. El
   Sampler deja de enseñar un botón que miente, sin que nadie tenga que acordarse de
   esconderlo.
3. **El dado de drums se borra.** Nunca fue un randomize: era un selector de preset
   disfrazado. El desplegable de kits ya cubre ese gesto. Se van con él
   `randomizeDrumsSound` y `pickRandomDrumKit` si no les queda otro llamador.
4. **`refreshKnobsFromSynth()`** queda revisado: hoy sólo sirve al bajo y sólo si el
   motor es `tb303`. Si tras el cambio no le queda ningún llamador legítimo (lo usa
   el cargado de sesión), se va.

## Qué NO entra

Se nombra para que no se cuele por el camino:

- **El catálogo de presets.** El `select` + Load/Save As/Delete siguen triplicados y
  con tres implementaciones (presets de motor, presets de usuario poly, kits de
  drums). Es deuda real y reconocida, pero es **otro concern** — ahí sí viven
  diferencias por motor que hay que diseñar, no unificar a ciegas.
- **Matar la página 303** y editar el bajo en el inspector como el resto.
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
3. **El dado es deshacible** desde el inspector — deja una entrada de undo. Falla hoy.
4. **El botón aparece por capacidad**: se monta para un motor con `randomize`, no se
   monta para uno sin él (Sampler).
5. **Drums no tiene dado.**

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
