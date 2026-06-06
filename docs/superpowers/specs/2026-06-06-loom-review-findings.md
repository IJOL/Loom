# Hallazgos de la revisión adversarial (por frente)

## Frente A — 21 hallazgos (ALTA 5 · MEDIA 8 · baja 8)

### [ALTA] Causa raíz del bug «▶ ausente» (installClip) es falsa: installClip es un hook MUERTO, nunca invocado
El spec (sección «Fix del bug ▶ ausente», línea 90) y el plan (Tarea 14a, líneas 410-411) afirman categóricamente que `installClip` es «el camino del import de loop del Sampler» y que la causa del ▶ ausente es que esa función no llama a `ensureScenesForRows`. VERIFICACIÓN CONTRA EL CÓDIGO: `installClip` aparece en TODO src/ únicamente en DOS sitios — la definición del hook opcional (`engine-types.ts:76`, `installClip?: (clip)=>void`) y su implementación (`session-host.ts:999-1006`). NINGÚN engine ni módulo lo INVOCA: grep de `installClip`, `ctx.installClip`, `installLoopClip`, etc. en src/engines/** y en sampler.ts no devuelve ninguna llamada. Es decir, el callback es código muerto en la práctica (probablemente el invocador se eliminó en el trabajo previo de «audio-channel direction», que en MEMORY anota «delete clip-editor-loop.ts»). Consecuencia: el «fix» propuesto (añadir `ensureScenesForRows` a `installClip`) parchea una función que hoy no se ejecuta, así que NO puede arreglar el síntoma observado («ocurría con clips recortados/slice»). Además el flujo real de slice es `onSliceToBank`, que YA llama a `ensureScenesForRows` (`session-host.ts:251`), por lo que tampoco es el culpable. La causa raíz declarada está mal identificada.

_Ubicación:_ spec §«Fix del bug ▶ ausente» (l.32, l.90, l.93); plan Tarea 14a (l.410-411); código: src/session/session-host.ts:999-1006 y src/engines/engine-types.ts:76 (única def+impl, sin invocador)

### [MEDIA] Camino real plausible del bug ▶ (onCellClick) no identificado; sí omite ensureScenesForRows
Dado que la causa declarada (`installClip`) es código muerto, el camino real del ▶ ausente probablemente está en `onCellClick` (`session-host.ts:658-673`): hace `while (lane.clips.length <= clipIdx) push(null); lane.clips[clipIdx] = clip` SIN llamar a `ensureScenesForRows`. El grid pinta `rowCount = max(scenes.length, max(lane.clips.length))` filas (session-ui.ts:56-58) pero solo pinta el botón ▶ para filas con `state.scenes[r]` (session-ui.ts:79, rama `if(scene)` en :222). Por tanto, si una lane tiene más clips que scenes, el usuario puede crear un clip (onCellClick) o soltar audio en una fila r sin scene → clip presente pero ▶ ausente. El spec/plan menciona `onCellClick` SOLO como candidato opcional a migrar al helper `placeClipEnsuringScene` (defensa en profundidad), no como causa real, y no añade test de regresión para ese camino. El plan corre el riesgo de «arreglar» installClip (muerto) y dejar el bug real intacto.

_Ubicación:_ código: src/session/session-host.ts:658-673 (onCellClick, sin ensureScenesForRows); spec l.94 / plan Tarea 14a l.412 (solo lo cita como defensa en profundidad opcional)

### [MEDIA] Afirmación falsa: onCellClick «no crea clip» en lanes sampler
El plan Tarea 12 (l.380) y el spec (§6, l.167) afirman que «para lanes `audio`/`sampler` ... `onCellClick` no crea clip», y proponen deshabilitar el ítem «Crear clip» del menú contextual de celda vacía para ambos. VERIFICACIÓN: `onCellClick` (session-host.ts:658-661) solo hace early-return para `audio` (`if (lane.engineId === 'audio') return;`). En una lane SAMPLER `onCellClick` SÍ crea un `emptyClip` normal (líneas 665-667). La afirmación es correcta para `audio` pero falsa para `sampler`. Si se implementa tal cual, el menú contextual deshabilitaría «Crear clip» en sampler aunque la acción funcione perfectamente, regresionando una capacidad existente.

_Ubicación:_ plan Tarea 12 l.380; spec §6 l.167; código: src/session/session-host.ts:661 (solo bloquea 'audio')

### [ALTA] deleteScene NO-compactante desincroniza el mapeo scene↔clip (decisión tomada que rompe el lanzamiento, no solo lo visual)
El spec (sección Diseño §1 y Duda D2) propone como variante POR DEFECTO que deleteScene haga solo `state.scenes.splice(idx,1)` sin desplazar las filas de clips, presentando la alternativa de compactar como mero tema de 'intuición visual'. Verificado contra el código: el modelo acopla fila↔scene por ÍNDICE POSICIONAL. En session-ui.ts:78-79 la fila r pinta `clipCell(lane, r)` junto a `sceneLaunchCell(state.scenes[r], r)`, y en session-runtime.ts:102-103 `launchScene` resuelve el clip con `idx = sceneIdx` (índice de fila) cuando no hay mapeo explícito. Por tanto, al borrar la scene N sin compactar, las scenes N+1… caen a N… pero sus clips NO se mueven: cada scene superviviente queda emparejada visual y funcionalmente con los clips de OTRA fila, y al lanzarla reproduce clips equivocados. No es cosmético: corrompe la correspondencia de lanzamiento del modelo. El spec recomienda justo la variante que rompe; la D2 está mal planteada (presenta 'compactar' como la opción costosa/arriesgada cuando es la correcta).

_Ubicación:_ spec §Diseño 'deleteScene' (líneas 66-67) + Duda D2; plan Tarea 4 — vs código session-ui.ts:78-79 y session-runtime.ts:102-103

### [MEDIA] La siembra 'vacía de verdad' deja la sesión sin NINGUNA scene lanzable cuando todas las lanes nacen vacías (afirmación del spec sobre ensureScenesForRows es falsa)
El spec (sección §2, 'Importante', líneas 84-86) y el plan (Tarea 14b, línea 422) afirman: 'quitar el relleno no rompe ensureScenesForRows… Sigue creando al menos 1 scene si hace falta'. Verificado falso: ensureScenesForRows (scene-ensure.ts:9-22) calcula maxClipRows = max(lane.clips.length). Con la nueva siembra, onAddLane crea lanes de instrumento con `clips: []` (length 0). Si todas las lanes de la sesión están vacías (caso real: pulsar 'New' → emptySessionState con scenes:[] y 3 lanes con clips:[], main.ts:870; luego añadir solo instrumentos vacíos), maxClipRows = 0 → 0 scenes creadas → el grid no pinta ningún botón ▶ de scene-launch (session-ui.ts:79 con state.scenes[r] === undefined). El usuario queda sin forma de lanzar escenas hasta crear un clip a mano. El spec no contempla este caso ni propone sembrar una scene mínima.

_Ubicación:_ spec §Diseño 'Siembra' (líneas 84-86); plan Tarea 14b (línea 422) — vs scene-ensure.ts:9-22, session.ts:194-204, main.ts:870

### [MEDIA] onDeleteLane no para la lane antes de dispose() (asimetría con onDeleteScene): voz/loop colgado al borrar una lane en reproducción
El plan Tarea 10 (onDeleteScene) sí llama a stopLane para lo que esté sonando/encolado en la fila borrada, pero el plan Tarea 9 (onDeleteLane) hace `laneStates.delete(laneId)` + `laneResources.dispose(laneId)` SIN un stopLane previo. laneStates.delete quita la lane del scheduler para futuros triggers, y dispose() (lane-resources.ts:42-49) libera strip+engine+inserts confiando en que engine.dispose() pare las voces; pero el flujo no garantiza el corte de voces/loops en vuelo ni del recHooks (la memoria del proyecto ya documenta el bug análogo 'New no libera synths' donde quedaban voces vivas sin lane). El spec no aborda explícitamente parar la lane antes de disponerla, a diferencia de la scene. Completitud: caso límite 'borrar lane mientras suena' no cubierto simétricamente.

_Ubicación:_ plan Tarea 9 (líneas 287-302) vs Tarea 10 (líneas 330-339); spec §Diseño onDeleteLane (línea 130) — vs lane-resources.ts:42-49

### [MEDIA] sceneHasContent ignora clipPerLane: una scene con lanzamiento explícito mapeado se considera 'vacía' y se borra sin confirmación
El plan Tarea 3 implementa `sceneHasContent = state.lanes.some(l => l.clips[sceneIdx] != null)` y descarta la rama clipPerLane como 'defensiva' ('basta con la presencia de clip en la fila'). Pero clipPerLane es Record<laneId, fila> y el código crea mapeos EXPLÍCITOS que apuntan a filas distintas del índice de scene: addNoteLane (session-host.ts:546 `clipPerLane[newId]=0`), stems runReplace (session-host.ts:804), MIDI import (midi-to-session.ts:90 `clipPerLane[lane.id]=sceneRow`). launchScene (session-runtime.ts:102-103) respeta ese mapeo explícito sobre el índice. Por tanto, una scene cuyo contenido lanzable proviene de un mapeo explícito a otra fila será evaluada como vacía por sceneHasContent y se borrará SIN diálogo de confirmación, perdiendo silenciosamente un lanzamiento configurado. La 'simplificación' del predicado contradice el criterio operativo declarado ('¿borrar la fila pierde algo lanzable?').

_Ubicación:_ plan Tarea 3 (líneas 119-123); spec §Diseño sceneHasContent (línea 72) — vs session-runtime.ts:102-103, session-host.ts:546/804, midi-to-session.ts:90

### [ALTA] La causa raíz del bug "▶ ausente" (installClip) apunta a código MUERTO: installClip no se invoca en ningún sitio
El eje central del frente (Spec §3 "Fix del bug ▶ ausente" y Plan Tarea 14a) afirma que la causa raíz es que `installClip` (session-host.ts:999) no llama a `ensureScenesForRows`. VERIFICADO contra el código: `installClip` está DECLARADO (engine-types.ts:76) y PROVISTO (session-host.ts:999), pero NINGÚN código de `src/` lo INVOCA. Un grep de todo el repo (excl. node_modules) solo encuentra la declaración, el proveedor y los docs — no hay ninguna llamada `ctx.installClip?.(...)`; `src/engines/sampler.ts` ni lo referencia. Es un hook huérfano (su llamador fue retirado tras el refactor "audio-channel direction"). Consecuencias: (1) añadir `ensureScenesForRows` a `installClip` es inocuo pero NO arregla ningún bug reproducible; (2) los caminos reales de import/slice de loop (`onSliceToBank`:251 y `onCellDropAudio`:695) YA llaman a `ensureScenesForRows`, así que el síntoma "▶ no aparece con clips recortados/slice" no puede provenir de ahí. La premisa del fix es incorrecta o la causa raíz real está sin identificar.

_Ubicación:_ spec §3 (líneas 88-95) y plan Tarea 14a (líneas 410-411); código: src/session/session-host.ts:999-1006, src/engines/engine-types.ts:76

### [ALTA] El e2e de regresión del ▶ (T15 caso 6) no se puede escribir como se describe: ningún flujo del Sampler llama a installClip
El Plan Tarea 15 caso 6 dice "ejecutar el flujo del Sampler que llama a `installClip`/`onSliceToBank` (reusar patrones de `sampler.spec.ts` / `loop-arrangement.spec.ts`)". VERIFICADO: `sampler.spec.ts` carga una muestra al keymap vía `input.sampler-load` (NO usa installClip); `loop-arrangement.spec.ts` prueba la brace de loop en Performance (NO usa installClip). Como `installClip` no tiene llamador en producción, NO existe ninguna interacción de UI que lo dispare, así que el caso e2e "que llama a installClip" no es realizable. La única variante reproducible es vía `onSliceToBank` (slice→bank), que YA está arreglada. El test de regresión que pretende verificar la Tarea 14a ("Verifica Tarea 14a") no puede cubrir el camino que dice cubrir.

_Ubicación:_ plan Tarea 15 caso 6 (líneas 453) y spec Plan de pruebas e2e caso 6 (línea 237); verificado contra tests/e2e/sampler.spec.ts y tests/e2e/loop-arrangement.spec.ts

### [ALTA] deleteScene sin compactar relinkea silenciosamente las escenas posteriores a filas de clip equivocadas (no es solo preferencia UX)
Spec §1 (línea 67) y Plan Tarea 4 proponen como DEFAULT que `deleteScene` NO compacte (mantener índices de fila), tratándolo como mera preferencia visual (Duda D2: "más intuitivo visualmente"). VERIFICADO contra `session-runtime.ts:90-108` (`launchScene`): el lanzamiento de escena es POSICIONAL — `const idx = hasExplicit ? scene.clipPerLane[lane.id] : sceneIdx` (línea 103), con el comentario "Ableton model: scene N launches column N". Por tanto, al hacer `scenes.splice(idx,1)` sin compactar las columnas, toda escena que estaba en índice > idx se desplaza un índice hacia abajo y, al lanzarse, lee `lane.clips[nuevoÍndice]` en vez de su fila original — para CUALQUIER lane sin entrada explícita en `clipPerLane` (que es el caso común; `clipPerLane` está casi siempre vacío, ver session.ts:191 `emptyScene` → `clipPerLane: {}`). Es una corrupción funcional silenciosa del mapeo escena→clip, no un detalle estético. El spec/plan subestiman la gravedad al enmarcarlo solo como duda de UX.

_Ubicación:_ spec §1 línea 67 + Duda D2 línea 257; plan Tarea 4 + D2; corrupción verificable contra src/session/session-runtime.ts:103

### [MEDIA] Afirmación incorrecta: onCellClick "no crea clip" en lanes sampler — solo bloquea 'audio'
Plan Tarea 12 (línea 380) y spec §6 (línea 167) instruyen deshabilitar el ítem "Crear clip" del menú contextual "para lanes `audio`/`sampler` donde `onCellClick` no crea clip". VERIFICADO contra `session-host.ts:658-672`: `onCellClick` solo hace `if (lane.engineId === 'audio') return;` (línea 661) — para lanes `sampler` SÍ crea un `emptyClip` normalmente. Si el implementador deshabilita "Crear clip" en celdas de sampler basándose en esta premisa, romperá una funcionalidad que hoy funciona (crear clips de notas en una lane sampler/drumkit).

_Ubicación:_ plan Tarea 12 línea 380 y spec §6 línea 167; código real: src/session/session-host.ts:661

### [MEDIA] El e2e de borrado de lane (T15 casos 2/3) asume un data-lane-id en .session-lane-header que no existe
Plan Tarea 15 caso 2 y spec Plan de pruebas caso 2 asertan "la columna desaparece (`.session-lane-header` con ese `data-lane-id` ya no existe)". VERIFICADO contra `session-ui.ts`: `laneHeader` (líneas 135-151) NO asigna ningún `dataset.laneId` al `.session-lane-header`; solo `clipCell` (línea 163) y el tab-bar ponen `data-lane-id`. La aserción e2e tal como está redactada no es realizable sin un cambio de UI no mencionado (añadir `el.dataset.laneId = lane.id` al header). El plan no incluye esa tarea, así que el caso e2e quedaría sin un selector estable para identificar la columna borrada.

_Ubicación:_ plan Tarea 15 caso 2 (línea 449) y spec línea 233; código: src/session/session-ui.ts:135-151

### [MEDIA] Inconsistencia interna del plan: la "defensa en profundidad" lista migrar los clips[0] de creación, pero T14b omite ensureScenesForRows en addNoteLane
El plan declara como objetivo (Tarea 14a, defensa en profundidad, línea 412) un helper `placeClipEnsuringScene` que se aplique a "los `clips[0]` de creación" para que "ningún camino futuro vuelva a olvidar la scene". Sin embargo, en Tarea 14b para `addNoteLane` (líneas 417) solo dice "Quitar el `for`" y NO instruye llamar `ensureScenesForRows`, a diferencia de los demás caminos donde explícitamente nota "Mantener `ensureScenesForRows` (ya está...)". VERIFICADO: `addNoteLane` (session-host.ts:523-550) es el ÚNICO camino de creación que NO llama hoy a `ensureScenesForRows`. Tras quitar el `for` (que hoy fuerza `clips.length = max(scenes,1)`), si se invocara con `scenes.length === 0` el clip de la fila 0 quedaría sin scene y sin ▶ — exactamente el bug que el frente dice atacar. Contradicción entre el objetivo de defensa-en-profundidad y la instrucción concreta. (En la práctica actual `addNoteLane` se llama tras importar stems, con scenes ya creadas, así que el riesgo es latente, no inmediato.)

_Ubicación:_ plan Tarea 14a línea 412 vs Tarea 14b línea 417; código: src/session/session-host.ts:523-550 (sin ensureScenesForRows)

## Frente C — 12 hallazgos (ALTA 2 · MEDIA 4 · baja 6)

### [MEDIA] El plan afirma falsamente que el entorno de vitest es jsdom; en realidad es 'node' (jsdom es opt-in por archivo)
El plan, Tarea 3a, dice literalmente escribir el test de buildMasterStrip 'siguiendo el estilo DOM-only de session-host-active-lane.test.ts, que stubea document si hace falta — aunque vitest aquí usa jsdom'. Esto es falso y además autocontradictorio. vitest.config.ts:5 declara environment: 'node' (no jsdom), y test/setup.ts NO globaliza 'document' (solo node-web-audio-api y window). session-host-active-lane.test.ts:5-15 funciona porque stubea manualmente un document trivial (getElementById/querySelector que devuelven null), lo cual basta para SessionHost pero NO para un builder que hace document.createElement, addEventListener y dispatch de eventos 'input'/'click' como el test propuesto de buildMasterStrip. El patrón correcto para un test que construye DOM real bajo este repo es la directiva por-archivo '// @vitest-environment jsdom' (como src/core/lane-fx-panel.test.ts:1), NO el stub trivial de active-lane. Tal como está descrita, la Tarea 3a llevaría a un test que no arranca en environment node. Es corregible (añadir la directiva jsdom) pero la premisa y el fixture modelo citado son incorrectos.

_Ubicación:_ plan, Tarea 3 (3a) vs vitest.config.ts:5, test/setup.ts:1-15, src/session/session-host-active-lane.test.ts:5-15, src/core/lane-fx-panel.test.ts:1

### [ALTA] El spec afirma falsamente que el master volume NO se persiste ni es undo-able — sí lo es
El spec repite en tres sitios (sección 'Qué NO entra' punto 4; 'Diseño → Undo del fader'; 'Dudas abiertas' #5) que master.gain no está en el SessionState y que el undo del fader 'no tendría snapshot que restaurar (igual que hoy #volume no es undo-able)'. Esto es FALSO. Verificado en código: src/save/saved-state-v3.ts:73 guarda `masterVol: parseFloat(volInput.value)` en el snapshot SavedStateV3, y :97 lo restaura (`master.gain.value = s.masterVol; volInput.value = String(s.masterVol)`). El snapshot SavedStateV3 es exactamente lo que usa el historial (`d.snapshot()` en history-wiring.ts), y `#volume` YA está bracketeado para undo (main.ts:276-289). Por tanto el master volume HOY se guarda en disco y es undo-able. Toda la duda D3 del plan ('¿se deja sin undo o se promueve master.gain al modelo persistido, lo cual amplía alcance?') parte de una premisa incorrecta: ya está persistido, no hay que ampliar nada. La decisión correcta no es la que plantea el documento.

_Ubicación:_ spec §'Qué NO entra' p4, §'Flujo de datos → Undo del fader', §'Dudas abiertas' D... ; plan §'DUDAS ABIERTAS' D3 — vs src/save/saved-state-v3.ts:73,97 y src/main.ts:276

### [ALTA] El fader del master escribe master.gain.value pero el snapshot lee volInput.value — romperá persistencia/undo si no sincroniza con #volume
Consecuencia del hallazgo anterior, no capturada por el documento. El snapshot de guardado/undo lee `volInput.value` (saved-state-v3.ts:73), NO `master.gain.value`. El plan (Tarea 3) define que el fader del master 'escribe deps.masterGain.gain.value' y la interfaz MasterStripDeps solo recibe `masterGain: GainNode` — sin acceso a volInput. Con esa interfaz, si el usuario mueve el fader del master y guarda, se persiste el valor VIEJO de volInput.value (el fader no lo tocó); y un undo del fader restaura desde un snapshot que tomó volInput.value, no el del fader → el undo del fader del master no revierte correctamente. La sincronización fader↔#volume (que el documento trata como mera duda de UX opcional, D2 'coexisten o se consolidan', 'por defecto coexistencia') es en realidad un REQUISITO de corrección para save/undo, no una preferencia estética. El fader debe escribir volInput.value (o MasterStripDeps debe incluir el input/volInput).

_Ubicación:_ plan Tarea 3 (fader escribe masterGain.gain.value) + interfaz MasterStripDeps; duda D2 — vs src/save/saved-state-v3.ts:73

### [MEDIA] El plan asume un 'canal' registerDisposable para el VU del master que no existe en el wiring real → fuga de RAF/analyser amplificada
El plan (Tarea 6, línea 313) cablea el master strip con `registerDisposable: /* mismo canal que las MixerColumn si existe */`. Verificado: ese canal NO existe. `mixerDeps` (main.ts:220-239) NO incluye `registerDisposable`, así que las MixerColumn de lane crean su VU meter (createLevelMeter, mixer.ts:181-182) sin registrar disposal — ya hay una fuga existente: cada `renderWithMixer` hace `row.innerHTML=''` y reconstruye todas las columnas + sus level meters sin disponer los anteriores. Y `renderWithMixer` se invoca en cada cambio de play-state vía startRenderTick (session-host.ts:1044-1057), es decir muy a menudo durante el playback. Añadir el master strip mete un VU meter MÁS que se recrea en cada tick sin disponer el previo (createLevelMeter registra un RAF + retiene el analyser). El plan da por hecho un mecanismo de teardown que tendría que crearse de cero; o, si no se crea, agrava la fuga. El documento no reconoce que la fuga de VU meters ya existe ni que el master strip la amplifica.

_Ubicación:_ plan Tarea 6 línea 313 — vs src/main.ts:220-239 (mixerDeps sin registerDisposable) + src/session/session-host.ts:488,1044-1057 (innerHTML='' en hot path) + src/core/mixer.ts:181-182

### [MEDIA] Hueco de completitud: el master strip y su VU desaparecen en modo Performance, dejando ese modo sin control/medición de master visible
El spec coloca el master strip en la session-row-mixer y el panel #master-fx-panel dentro de .session-view. Verificado: .session-view vive dentro de #session-view-root, que se oculta por completo al entrar en modo Performance (performance-feature.ts:191 `sessionRoot.hidden = next !== 'session'`). Por tanto, en Performance el fader del master + VU + botón FX quedan ocultos. Hoy el único control de volumen master superviviente en Performance es `#volume`, que está en la fila de transporte global (index.html:107), FUERA de #session-view-root. El spec no menciona esta interacción con el frente B ni con el modo Performance. Es relevante porque: (a) refuerza que eliminar `#volume` (duda D2) dejaría Performance sin control de volumen master alguno; (b) el usuario que toca en Performance pierde el VU del master. El documento debería identificarlo como restricción o duda, no omitirlo.

_Ubicación:_ spec §Diseño (panel dentro de .session-view) y §Alcance — vs src/app/performance-feature.ts:189-193 + index.html:107,144,315

### [MEDIA] El canal de disposal del VU meter que el plan asume ('mismo canal que las MixerColumn') no existe
La Tarea 6 deja como placeholder `registerDisposable: /* mismo canal que las MixerColumn si existe */`. Verificado contra el código: NO existe tal canal. session-host.ts no maneja registerDisposable en ningún sitio (grep solo encuentra laneResources.dispose, no VU disposables), y mixerDeps (src/main.ts:220-239) NO incluye registerDisposable. buildMixerColumn ya registra su VU meter sólo si deps.registerDisposable existe (src/core/mixer.ts:181-182), pero como mixerDeps no lo provee, los VU de lane YA fugan su RAF+analyser en cada renderWithMixer. Y renderWithMixer hace `row.innerHTML=''` y reconstruye TODAS las columnas en cada cambio de play-state (startRenderTick, src/session/session-host.ts:1054 → renderWithMixer línea 488), o sea: cada lanzamiento de clip. El master strip AÑADE un VU meter más que fugará igual en cada re-render, sin ruta de teardown. El test unit (spec #1, plan Tarea 3) verifica registerDisposable 'si se pasa', así que pasa en aislamiento pero no refleja que en producción nadie lo pasa. El plan no detecta que el canal no existe ni propone crearlo.

_Ubicación:_ plan Tarea 6 (línea 313) y spec test #1 (líneas 266) vs src/session/session-host.ts:488,1054 + src/core/mixer.ts:155-182 + src/main.ts:220-239

## Frente D — 19 hallazgos (ALTA 4 · MEDIA 9 · baja 6)

### [ALTA] El plan ignora el seam existente `EngineUIContext.installClip` (diseñado justo para el import de loop del Sampler) e inventa un mecanismo paralelo
El spec §3/§4 y el plan (Tareas 10 y 13) proponen reorientar `onSliceToBank` a un nuevo `importLoopToSampler(laneId, file|buf)` y disparar la inserción del clip de notas "emitiendo un evento/llamando al host" (plan Tarea 13, línea 179). Pero el código YA tiene un seam diseñado exactamente para esto: `EngineUIContext.installClip?: (clip: SessionClip) => void` (engine-types.ts:74-76, comentado literalmente como "the sampler's 'import as loop' flow") está cableado en SessionHost (session-host.ts:999-1006: busca el primer slot vacío de la propia lane Sampler y coloca el clip + renderWithMixer). Ese es exactamente el comportamiento que el plan describe construir desde cero (clip de notas sobre la propia lane Sampler, guardado en this.state). Ni el spec ni el plan mencionan `installClip` en ningún punto. Resultado: el plan duplica un mecanismo en vez de reutilizar el seam previsto, y la 'maquinaria ya existente' que el spec dice reutilizar está incompleta en este punto.

_Ubicación:_ engine-types.ts:74-76 y session-host.ts:999-1006 vs spec §3-§4 / plan Tareas 10 y 13

### [MEDIA] Afirmación falsa implícita: 'reusar la maquinaria ya existente' del import de loop al Sampler — ese flujo NO existe hoy (seam huérfano sin caller)
El spec (Alcance, 'Importación de loop al Sampler ... Reutiliza la maquinaria ya existente') y el comentario de session-host.ts:999 ('sampler loop import') sugieren que el Sampler ya tiene un flujo de import de loop. La verificación muestra que NO: `sampler.ts` (buildParamUI, líneas 469-508) solo tiene fileInput + dropzone que llaman a `addSampleToKeymap` (keymap melódico), sin `buildSliceClip`, sin `slicesToKeymap`, sin `installClip`. Grep de `installClip`/`buildSliceClip` en sampler.ts no encuentra nada; el único caller real de `installClip` en todo el código fuente es inexistente (solo aparece en docs y en la definición del propio host). El antiguo `clip-editor-loop.ts` ya no existe. Por tanto el único flujo de slice→bank que funciona hoy es `onSliceToBank` desde el AUDIO lane, no desde el Sampler. El plan debería partir de que el camino Sampler-side hay que construirlo (no 'reorientar'), y el seam `installClip` está huérfano.

_Ubicación:_ src/engines/sampler.ts:469-508 (sin flujo loop) vs spec Alcance 'Importación de loop al Sampler'

### [MEDIA] Colisión no señalada con el Frente 'gestión-sesión': ambos tocan el mismo punto de inserción de clip del Sampler
El plan del Frente D crea `importLoopToSampler` con su propia inserción de clip + `ensureScenesForRows` (Tarea 13). En paralelo, docs/superpowers/specs/2026-06-06-gestion-sesion-design.md (línea 93) y su plan (Tarea 14a) modifican `installClip` (session-host.ts:999) para AÑADIR `ensureScenesForRows` porque hoy NO lo llama, y proponen extraer `placeClipEnsuringScene` para unificar TODOS los puntos de inserción (incluido `installClip`). El spec/plan del Frente D no menciona esta dependencia/solapamiento: si el Frente D crea un camino de inserción paralelo (importLoopToSampler) en vez de pasar por `installClip`/`placeClipEnsuringScene`, reintroduce el mismo bug del ▶ ausente que el otro frente arregla, o duplica el fix. Falta coordinación explícita entre frentes en un punto que ambos editan.

_Ubicación:_ plan Frente D Tarea 13 vs docs/superpowers/specs/2026-06-06-gestion-sesion-design.md:93 y plan gestion-sesion Tarea 14a

### [ALTA] Tests existentes que afirman lo contrario al cambio NO se inventarían en el plan (clip-waveform-header.test.ts + e2e audio-channel)
El plan (Tarea 9) dice crear src/session/clip-editors/clip-waveform-header.test.ts 'si no existe', pero YA EXISTE y su test 'renderAudioClipEditor shows the bpm + a Slice → pads button that calls back' (líneas 26-36) afirma que el botón .audio-clip-slice DEBE estar presente y disparar onSliceToBank. Al quitar el slicing del audio lane ese test fallará, y el plan no lo lista como 'actualizar/eliminar', solo como 'crear'. Peor aún: existe un e2e completo en tests/e2e/audio-channel.spec.ts ('Slice → pads adds a sampler lane with the sliced notes', líneas 65-78) que ejercita el flujo exacto que el spec elimina; ni el spec ni el plan lo mencionan en absoluto. La 'Qué ENTRA/Archivos a tocar' del spec y el plan omiten estos dos tests de regresión que quedarán rojos. Completitud: falta inventariar y reescribir los tests existentes que codifican el comportamiento revertido.

_Ubicación:_ plan Tarea 9 + spec §4/Plan de pruebas vs src/session/clip-editors/clip-waveform-header.test.ts:26-36 y tests/e2e/audio-channel.spec.ts:65-78

### [MEDIA] El seam ya cableado para 'import as loop' (EngineUIContext.installClip) se ignora; el plan inventa un mecanismo nuevo incompleto
Existe un seam dedicado EngineUIContext.installClip cuyo comentario dice literalmente 'Place a freshly-built clip onto this lane (the sampler\'s "import as loop" flow)' (engine-types.ts:74-76), cableado en session-host.ts:999-1006. El spec/plan no lo mencionan en ningún punto y en su lugar proponen 'emitir un evento/llamar al host' + reorientar onSliceToBank → importLoopToSampler (Tarea 10/13). Esto es una laguna de diseño: o bien se reusa installClip (y entonces hay que ampliarlo, porque hoy SOLO coloca el clip: no llama a ensureScenesForRows, no envuelve en withUndo, no selecciona/abre el piano-roll — justo lo que el flujo loop necesita), o bien se elimina/explica por qué se descarta. El documento debería reconciliar el seam existente con el nuevo importLoopToSampler en vez de dejar dos caminos sin decidir.

_Ubicación:_ spec §3/§4 y plan Tareas 10/13 vs src/engines/engine-types.ts:74-76 y src/session/session-host.ts:999-1006

### [ALTA] Importación multi-muestra melódica produce un keymap inservible (todas las zonas a 0..127, gana solo la última)
El spec presenta la importación por selección múltiple como el camino para construir un instrumento melódico multi-zona, pero el plan (Tarea 11) usa addSampleToKeymap(km, id, { rootNote }), y addSampleToKeymap fija SIEMPRE loNote:0, hiNote:127 (keymap-edit.ts:13-14). Con keymapEntryFor 'last match wins' (keymap.ts:9-15, citado por el propio spec), importar N muestras deja N zonas que cubren TODO el teclado: solo la última suena en cualquier nota, el resto quedan inaccesibles. El spec solo prevé heurística de root note por nombre (línea 31), nunca asignación de rangos loNote/hiNote para distribuir las zonas. Es justo el caso de uso 'Melódico multi-zona' que el frente promete. Falta especificar cómo se reparten los rangos al importar varias muestras (o aclarar que la importación multi solo apila full-range y que el multi-zona real solo llega vía presets bundled).

_Ubicación:_ plan Tarea 11 + spec §3 (importación) vs src/samples/keymap-edit.ts:8-15

### [MEDIA] waveformRef del loop entero no es self-healing para presets bundled de loop
El spec (§2, línea 99) y el plan (Tarea 13) dicen 're-apuntar waveformRef.sampleId al nuevo sampleId del loop entero' tras recargar, para que el header de waveform siga pintando. Pero loadInstrument loop (plan Tarea 6) SOLO genera/persiste los sampleIds de los SLICES (store.put×N); nunca crea ni guarda un sampleId para el WAV entero. El waveformRef.sampleId del clip persistido apunta al sampleId del loop entero, que solo sobrevive si el loop lo importó el usuario (queda en IndexedDB de ese navegador). Para un preset BUNDLED de loop (el caso self-healing por instrumentId que el spec defiende), tras recargar en otro navegador no hay buffer del loop entero en cache/store → el header de waveform queda en blanco. El spec afirma self-healing del loop pero el mecanismo solo cubre el banco de slices, no el waveformRef. Hay que decidir: o el loader regenera/cachea también el loop entero, o el waveformRef se reconstruye a partir de los slices, o se documenta que el header de loop bundled no se rehidrata.

_Ubicación:_ spec §2 línea 99 + plan Tarea 6/13 vs src/export/preload-scene-samples.ts:13-25 y src/samples/drumkit-loader.ts (patrón de slices)

### [MEDIA] Exclusión mutua instrumentId vs drumkitId no garantizada en el load path
El spec/plan declaran instrumentId y drumkitId 'mutuamente excluyentes' pero solo lo aseguran en la UI del selector (limpiar uno al elegir el otro, plan Tarea 12). En el load path applyLaneEngineState aplica primero drumkitId → reloadDrumkit → setKeymap y luego (bloque nuevo) instrumentId → reloadInstrument → setKeymap (apply-lane-engine-state.ts:53-64 + Tarea 7). Si por un estado corrupto/migración ambos coexisten, se ejecutan los dos reloads y el segundo pisa el keymap del primero de forma no determinista, además de routear el editor mal (chooseClipEditor mira drumkitId → drum-grid aunque sea un loop). No hay aserción de invariante ni guarda en el load path. Falta especificar la precedencia o una guarda defensiva (p.ej. ignorar instrumentId si hay drumkitId, o viceversa) y un test que cubra el estado inconsistente.

_Ubicación:_ spec §2/§3 + plan Tarea 7/12 vs src/export/apply-lane-engine-state.ts:53-64 y src/session/clip-editors/clip-editor-router.ts:51

### [MEDIA] Falta tratar el caso de loops/sliced ya existentes en sesiones guardadas tras revertir la dirección audio-channel
El spec revierte la 'audio-channel direction': el slicing sale del audio lane y los loops particionados 'vuelven al Sampler'. Pero el modelo previo (audio-channel) ya pudo crear en sesiones/demos guardadas lanes 'sampler slices' con clip de notas + waveformRef (onSliceToBank, session-host.ts:226-254) ANCLADAS a una lane sampler nueva, no a la lane audio. El spec/plan no especifican migración ni compatibilidad hacia atrás para esas sesiones: ¿siguen cargando bien (probablemente sí, porque son lanes sampler con keymap+clip de notas, sin instrumentId)? El spec asume que la migración es 'sin cambios obligatorios (campos aditivos)' y solo verifica passthrough de sample/waveformRef (Tarea 8), pero no analiza qué pasa con un audio CLIP guardado que aún tenga (en una sesión vieja) una referencia conceptual al botón Slice ya retirado, ni con demos baked que dependieran del flujo. Falta una nota explícita de compatibilidad: 'sesiones creadas con la dirección antigua siguen cargando porque X; el botón desaparecido no afecta a datos ya materializados'.

_Ubicación:_ spec §4/Archivos a tocar (session-migration sin cambios) vs src/session/session-host.ts:226-254 (onSliceToBank crea lane sampler) y saved-state-v3.ts

### [ALTA] El flujo "Importar loop" del usuario (Tarea 13) reclama self-healing por instrumentId que NO existe para imports no-bundled
Contradicción interna entre Tarea 13 y la propia política de self-healing del spec. Tarea 13 (plan, líneas 179-180) dice que al importar un loop por el usuario se llama `mirrorInstrumentId` "(para el self-heal del banco por id)" y que "solo el audio del banco se regenera vía instrumentId (Tarea 7)". Pero `instrumentId` SOLO existe para presets bundled con manifiesto (`public/instruments/<id>.json`). Un loop importado por el usuario NO tiene manifiesto, así que: (1) no hay valor de `instrumentId` que pasar a `mirrorInstrumentId` (sería undefined → no-op, contradiciendo su propósito declarado); (2) al recargar, `reloadInstrument` (Tarea 7) haría `fetchInstrumentManifest(id)` y lanzaría (fichero inexistente). Esto choca de frente con el propio spec línea 226 / plan línea 257: "Self-healing: solo los presets bundled se reconstruyen por id. Los keymaps importados por el usuario siguen atados a IndexedDB del navegador". El banco de slices de un loop importado por el usuario queda en el caso IndexedDB-only (verificado: `mirrorKeymapChange` en session-engine-state.ts:57-68 persiste sampleId crudos), NO se auto-cura. El plan debe separar claramente: loop BUNDLED (Tarea 7, con manifiesto+instrumentId, sí self-heal) vs loop IMPORTADO por el usuario (Tarea 13, sin manifiesto, NO self-heal por id).

_Ubicación:_ plan Tarea 13 (líneas 179-181) vs spec §Self-healing (línea 226) / plan línea 257

### [MEDIA] "Renombrar/reorientar onSliceToBank" es en realidad una reescritura de firma y comportamiento, no un rename
El plan Tarea 10 lo describe como "solo hace el rename + ajuste de firma" y "NO se borra; se renombra/reorienta". Verificado contra session-host.ts:197-258, el `onSliceToBank(laneId, clipIdx)` real: (1) recibe `clipIdx` (índice de clip), no `file|buf` como propone la Tarea 13/10; (2) lee el sample de un CLIP DE AUDIO existente (`if (!lane || !clip?.sample) return`, línea 201) — no un fichero suelto; (3) crea una LANE NUEVA sampler (líneas 237-245: `nextLaneSlug`/`emptyLane`/`this.state.lanes.push`). El destino propuesto (`importLoopToSampler(laneId, file|buf)` que opera "sobre la lane Sampler actual, no crea una lane nueva") cambia la fuente (clip→fichero), la firma (clipIdx→file/buf) Y elimina la creación de lane. Es un refactor sustancial; presentarlo como "rename + ajuste de firma" subestima el riesgo y puede dejar a Tarea 10 con un alcance mal calibrado (la lógica de creación-de-lane que hoy es el núcleo de la función se descarta, no se reubica).

_Ubicación:_ plan Tarea 10 (líneas 143-148) vs código real session-host.ts:197-258

### [MEDIA] Discrepancia de tipo entre el padParams del manifiesto (Partial<PadParams>) y el de engineState (Record<string,number>) sin resolución explícita
El spec/plan definen `MelodicInstrumentManifest.padParams?: Record<number, Partial<PadParams>>` y `loadInstrument` devuelve ese tipo (plan Tarea 3 línea 75, Tarea 5 línea 91). Pero el almacén persistido `SessionLane.engineState.sampler.padParams` es `Record<number, Record<string, number>>` (verificado session.ts:78), y `mirrorPadParams` está tipado a `Record<number, Record<string, number>>` (sampler.ts:359 hace un cast `as Record<number, Record<string, number>>`). El plan dice aplicar el padParams del manifiesto "vía setPadStore" (que sí acepta `Record<number, Partial<PadParams>>`, verificado sampler.ts:284) y "mirrorPadParams" (Tarea 12 línea 169), pero no aclara la conversión Partial<PadParams> → Record<string,number> ni quién la hace. Es un hueco de tipado que aflorará en `npx tsc --noEmit` y que ninguna tarea aborda explícitamente.

_Ubicación:_ plan Tarea 3 (línea 75) / Tarea 5 (línea 91) / Tarea 12 (línea 169) vs session.ts:78 + sampler.ts:284,359

### [MEDIA] public/instruments/ solo contiene SOURCES.md: ninguna muestra real existe todavía y la Tarea 18 es "opcional", dejando e2e/smoke sin contenido garantizado
Verificado: `public/instruments/` contiene ÚNICAMENTE `SOURCES.md` (ni `index.json`, ni `<id>.json`, ni WAVs). La Tarea 18 (crear 2-3 presets CC0) está marcada "Fase 7 — opcional" y "puede ir DESPUÉS sin bloquear" (plan líneas 223-229). Sin embargo, la Tarea 15 (e2e: "el selector ofrece las 3 familias") y el smoke de la Tarea 19 ("cargar un preset bundled → suena") REQUIEREN al menos una entrada melódica y/o de loop bundled para verificarse. Si Tarea 18 se difiere, Tarea 15 solo puede comprobar que las familias aparecen vacías y el smoke "cargar preset bundled" no es ejecutable. El orden menor-a-mayor-riesgo coloca la dependencia de contenido DESPUÉS de las tareas que la consumen, sin marcar esa precedencia. Además `listInstruments` devuelve [] si falta `index.json` (mismo contrato verificado en drumkit-loader.ts:70-77), por lo que el selector quedaría sin opciones bundled y el e2e de conmutación a/desde Melódico podría no tener nada que seleccionar.

_Ubicación:_ plan Tarea 18 (Fase 7, líneas 223-229) vs Tarea 15 (líneas 201-205) y Tarea 19 smoke (línea 244)

## Frente E — 15 hallazgos (ALTA 0 · MEDIA 6 · baja 9)

### [MEDIA] La premisa "Copy copia solo las notas" es falsa en el código real
El spec (§Objetivo punto 2, §Alcance línea 1, y la observación 1 del overview) justifica el reetiquetado afirmando que "Copy Clip / Paste copian solo las notas, no el clip". Verificado en src/session/session-inspector.ts:162-165: el handler #insp-copy hace `clipClipboard = JSON.parse(JSON.stringify(clip))` — copia el CLIP ENTERO (id, name, color, lengthBars, launchQuantize, sample, gridResolution, envelopes…), no solo `clip.notes`. Solo pasteReplace/pasteLayer (260-289) leen `clipClipboard.notes`. Por tanto el efecto observable (solo se pegan notas) sí justifica el rótulo "Copy notes", pero la PREMISA TÉCNICA del documento es incorrecta para el Copy. El plan Tarea 3 reetiqueta sin tocar el handler, así que el botón "Copy notes" seguirá copiando el clip entero internamente — coherente en resultado, pero el documento describe mal el mecanismo y no aprovecha para corregir el copy a solo-notas si se quisiera honestidad real.

_Ubicación:_ spec §Objetivo/§Alcance; overview obs.1; código src/session/session-inspector.ts:162-165

### [MEDIA] Solapamiento de archivos con el frente D sin orden de ejecución definido
El frente E toca clip-editor-router.ts y clip-waveform-header.ts, pero el frente D (sampler-audio, misma fecha 2026-06-06) MODIFICA los mismos archivos de forma incompatible: docs/superpowers/plans/2026-06-06-sampler-audio-plan.md:139 dice explícitamente "quitar `onSliceToBank?` de `ClipEditorDeps` (línea 31) y de la llamada a `renderAudioClipEditor` (82-85)". El frente E (Tarea 9 / dudas D-A/D-B/D-C) trata el botón Slice→pads (que invoca onSliceToBank) como "pendiente de D", pero ninguno de los dos planes fija el ORDEN de ejecución entre frentes ni quién toca primero clip-editor-router.ts/clip-waveform-header.ts. Si E se ejecuta antes que D dejando placeholders y D luego borra onSliceToBank, hay retrabajo/conflicto garantizado. La acoplación está identificada como "dudas" pero la dependencia de SECUENCIA no.

_Ubicación:_ spec §Dudas-abiertas acopladas a D; plan D-A/D-B/D-C; archivos clip-editor-router.ts y clip-waveform-header.ts compartidos con sampler-audio-plan.md:139,172

### [MEDIA] La leyenda de teclado anunciada deja FUERA atajos reales (contradice la meta del frente)
Una de las metas declaradas del frente (obs.4/5, §5) es "anunciar los atajos hoy ocultos". Pero la constante PIANO_KEY_LEGEND propuesta (spec §5 / plan Tarea 2) solo lista: notas a-k, w-e-t-y-u, z/x, 1/2, ←/→ "mover cursor", ⌫. Verificado en src/core/pianoroll.ts: el piano-roll ADEMÁS soporta Ctrl+A (select all, 565), Ctrl+C/X/V (570-594), Escape (596), y las flechas CON selección hacen nudge/transposición (incluyendo ↑/↓, 654-666) — la leyenda dice "←/→ = mover cursor" sin mencionar que con selección mueven/transponen notas ni que ↑/↓ existen. El test de coherencia del plan (Tarea 2) solo comprueba teclas de notas + z/x/1/2, así que pasaría con una leyenda incompleta y no detecta la omisión. Resultado: el popover "?" anunciaría un subconjunto, fallando parcialmente el objetivo de descubribilidad. Nota: para el drum-grid el spec sí dice "su set real (1/2 + flechas + Ctrl+C/V)", inconsistente con la pobreza de la del piano-roll.

_Ubicación:_ spec §5; plan Tarea 2 (PIANO_KEY_LEGEND); código real src/core/pianoroll.ts:565-666

### [MEDIA] El spec afirma falsamente que "Copy" opera sobre clip.notes; el reetiqueta a "Copy notes" deja el handler copiando el clip ENTERO
El spec §7 (línea 169) afirma: «Copy/Paste siguen operando sobre `clip.notes` vía el clipboard module-level `clipClipboard`... Solo cambian sus rótulos». Esto es FALSO para Copy. En `session-inspector.ts:163` el handler de #insp-copy hace `clipClipboard = JSON.parse(JSON.stringify(clip))`, es decir copia el CLIP COMPLETO (name, lengthBars, sample, launchQuantize, etc.), no solo las notas. Solo `pasteReplace`/`pasteLayer` (líneas 267,281-284) leen `clipClipboard.notes`. Por tanto, reetiquetar el botón a "Copy notes" (Tarea 3 del plan, línea 110) contradice el objetivo 2 del spec («diga la verdad en sus etiquetas»): el botón dirá "notas" pero el clipboard retiene el clip entero. Ni spec ni plan instruyen ajustar el handler a `clipClipboard = JSON.parse(JSON.stringify(clip.notes ?? []))` para que el rótulo sea honesto. Inconsistencia entre la afirmación del spec, el reetiqueta del plan y el código real.

_Ubicación:_ spec §7 (línea 169) + plan Tarea 3 (línea 110) vs src/session/session-inspector.ts:162-167

### [MEDIA] El escenario e2e del clip de AUDIO (objetivo central §6) no es ejecutable con el boot por defecto: no hay lane audio en los demos
El objetivo §6 del spec (limpiar la cabecera de audio, quitar BPM/bars duplicados) es uno de los pilares del frente, y el plan lo quiere verificar en e2e (Tarea 11, escenario 2 tercer sub-caso: «clip de audio → `.clip-edit-row` oculta; la cabecera de audio no contiene texto BPM/bar»). Pero verificado contra el código: `engineId: 'audio'` solo aparece en tests (clip-editor-router.test.ts:41, preload-scene-samples.test.ts:30), NO en ningún demo de arranque (`public/demos/*.json`). `waitForBoot` (clip-click.spec.ts:9-14) solo espera a que haya celdas llenas, que serán de los demos (subtractive/tb303/drums-machine), nunca audio. El plan reconoce el riesgo a medias (líneas 306: «si el boot no trae un clip de audio... cubrir audio en smoke manual»), pero eso deja el cambio MÁS visible del frente (cabecera de audio sin BPM/bars) SIN verificación automatizada, dependiendo de smoke manual. No hay tarea para crear un fixture de lane audio ejecutable en e2e.

_Ubicación:_ plan Tarea 11 escenario 2 (líneas 304-306) + spec §6 / Plan de pruebas Playwright punto 2; verificado: sin engineId:'audio' en public/demos/*.json

### [MEDIA] El rótulo dinámico del toggle de vista (Tarea 8) hereda un "primer click no-op" en lanes melódicos, contradiciendo la honestidad prometida
El handler actual de #insp-toggle-editor (session-inspector.ts:168-175) alterna `editorOverride` con la regla `cur === 'piano-roll' ? 'drum-grid' : 'piano-roll'`, partiendo de `cur = editorOverride.get(clip.id) ?? null`. En un lane melódico puro (editor nativo 'piano-roll', confirmado en subtractive.ts:255, tb303.ts:142, etc.) sin override previo: cur=null → next='piano-roll', que es EXACTAMENTE el editor ya activo → el primer click no produce ningún cambio visible (hay que clicar dos veces para llegar a drum-grid). La Tarea 8 (líneas 252-257) añade un rótulo dinámico "Ver como rejilla" calculado vía `chooseClipEditor` y lo refresca tras el click, pero NO arregla esta semántica: el usuario verá un botón "Ver como rejilla" que, al pulsarlo, no cambia nada (el rótulo se recalcula al mismo valor). Esto contradice el objetivo del spec §4 («toggle de vista, condicional y honesto») y la propuesta D-F de mostrarlo también para `notes`. Ni spec ni plan detectan/corrigen el caso del primer-click-no-op.

_Ubicación:_ plan Tarea 8 (líneas 251-257) + spec §4 vs src/session/session-inspector.ts:168-175 (regla de toggle)



---

# Informe consolidado

Voy a consolidar los hallazgos. Noto que varios están duplicados dentro de cada frente (parecen dos pasadas de revisión sobre el mismo material); los deduplico por contenido al contar y al detallar.

# Informe consolidado de revisión adversarial — specs/planes 2026-06-06

Nota de método: dentro de cada frente había hallazgos repetidos (dos pasadas que describen el mismo defecto). Se han fusionado los duplicados; el recuento refleja defectos **únicos**.

---

## Frente A — gestión-sesión

**Recuento (defectos únicos):** ALTA 2 · MEDIA 4 · BAJA 5

### ALTA

**A1 · La causa raíz del bug «▶ ausente» (installClip) es código muerto**
`installClip` está declarado (`engine-types.ts:76`) e implementado (`session-host.ts:999-1006`) pero **ningún** módulo lo invoca (grep en `src/engines/**` y `sampler.ts` sin resultados; su llamador se eliminó con el refactor "audio-channel direction"). El fix propuesto (añadir `ensureScenesForRows` a `installClip`) parchea una función que no se ejecuta, así que no puede arreglar el síntoma. Además el flujo real de slice (`onSliceToBank`, `session-host.ts:251`) ya llama a `ensureScenesForRows`. La causa raíz declarada está mal identificada.
Ubicación: spec §«Fix del bug ▶ ausente» (l.32/88-95); plan Tarea 14a (l.410-411); `session-host.ts:999-1006`, `engine-types.ts:76`.

**A2 · deleteScene sin compactar corrompe el mapeo escena→clip (no es UX)**
El spec propone como DEFAULT que `deleteScene` solo haga `scenes.splice(idx,1)` sin desplazar las columnas de clips, presentándolo como mera preferencia visual (Duda D2). Pero el lanzamiento es **posicional**: `launchScene` resuelve `idx = hasExplicit ? clipPerLane[lane.id] : sceneIdx` (`session-runtime.ts:103`) y `clipPerLane` está casi siempre vacío (`emptyScene → clipPerLane:{}`). Al borrar la escena N sin compactar, toda escena con índice > N se desplaza y al lanzarse lee `lane.clips[índiceEquivocado]`: corrupción funcional silenciosa, no estética. La D2 está mal planteada (presenta "compactar" como la opción arriesgada cuando es la correcta).
Ubicación: spec §Diseño deleteScene (l.66-67) + Duda D2; plan Tarea 4; `session-ui.ts:78-79`, `session-runtime.ts:102-103`.

### MEDIA

**A3 · Camino real del ▶ ausente (onCellClick) sin identificar ni cubrir con test**
Como `installClip` es muerto, el camino real probable es `onCellClick` (`session-host.ts:658-673`): hace `lane.clips[clipIdx] = clip` sin `ensureScenesForRows`. El grid solo pinta ▶ para filas con `state.scenes[r]` (`session-ui.ts:79`), así que una lane con más clips que scenes deja clip presente pero ▶ ausente. El plan solo lo cita como defensa en profundidad opcional y no añade test de regresión.
Ubicación: `session-host.ts:658-673`; spec l.94 / plan Tarea 14a l.412.

**A4 · Afirmación falsa: `onCellClick` «no crea clip» en lanes sampler**
Plan Tarea 12 (l.380) y spec §6 (l.167) deshabilitan «Crear clip» del menú contextual para `audio`/`sampler`. Pero `onCellClick` solo hace early-return para `audio` (`session-host.ts:661`); en una lane **sampler** SÍ crea un `emptyClip`. Implementarlo tal cual regresiona una capacidad existente (crear clips de notas en sampler/drumkit).
Ubicación: plan Tarea 12 l.380; spec §6 l.167; `session-host.ts:661`.

**A5 · La siembra «vacía de verdad» puede dejar la sesión sin ninguna scene lanzable**
Spec §2 y plan Tarea 14b afirman que quitar el relleno «no rompe `ensureScenesForRows`… sigue creando ≥1 scene». Falso: `ensureScenesForRows` calcula `maxClipRows = max(lane.clips.length)`; con lanes nuevas a `clips:[]`, si todas están vacías → 0 scenes → el grid no pinta ningún ▶ de scene-launch. El usuario queda sin forma de lanzar escenas. No se contempla sembrar una scene mínima.
Ubicación: spec §Siembra (l.84-86); plan Tarea 14b (l.422); `scene-ensure.ts:9-22`, `main.ts:870`.

**A6 · onDeleteLane no para la lane antes de `dispose()` (asimetría con onDeleteScene)**
Tarea 10 (onDeleteScene) llama a `stopLane`; Tarea 9 (onDeleteLane) hace `laneStates.delete` + `dispose()` sin `stopLane` previo. `dispose()` confía en que `engine.dispose()` corte las voces, pero no garantiza cortar voces/loops en vuelo ni recHooks (análogo al bug documentado "New no libera synths"). Caso "borrar lane mientras suena" no cubierto simétricamente.
Ubicación: plan Tarea 9 (l.287-302) vs Tarea 10 (l.330-339); `lane-resources.ts:42-49`.

*(Nota: el hallazgo "sceneHasContent ignora clipPerLane" aparece marcado como MEDIA en una pasada y como BAJA en otra; lo trato como BAJA por divergencia spec↔plan, ver B-list. El riesgo real —borrar sin confirmación una scene cuyo lanzamiento viene de un `clipPerLane` explícito a otra fila— es de severidad MEDIA conceptualmente; si priorizas por impacto de datos, súbelo a MEDIA.)*

### BAJA (5) — solo recuento + título
- sceneHasContent: divergencia spec↔plan (rama `clipPerLane` no implementada; puede dar falsos negativos al borrar scenes con mapeo explícito).
- Descripción inexacta: `insp-duplicate` hace `push` (append), no «primer hueco libre».
- Inventario de borrado incompleto: el botón `#insp-delete` del inspector no se menciona (tercer camino de borrado).
- Interacción con modo Performance no contemplada (aspa/menú/undo del grid; Ctrl+Z se enruta al arrangement en `performance-feature.ts:201-219`).
- El plan de pruebas asume `data-lane-id` en `.session-lane-header`, que el DOM no expone; + `page.evaluate(state)` no viable (host no expone state en `window`); + tabla del spec lista `onCellDropAudio` bajo "quitar relleno" cuando rellena con `null`; + pista SCSS apunta a `src/styles/` cuando el índice es `src/style.scss`; + contradicción interna T14a/T14b sobre `ensureScenesForRows` en `addNoteLane`.

**VEREDICTO A: necesita revisión del spec/plan.** Las dos causas estructurales (A1 causa raíz falsa, A2 corrupción de mapeo por deleteScene no-compactante) invalidan el núcleo del frente. Hay que re-identificar el camino real del ▶ (A3), forzar compactación en deleteScene, y corregir las premisas falsas (A4/A5) antes de implementar.

---

## Frente C — mixer-master

**Recuento (defectos únicos):** ALTA 2 · MEDIA 3 · BAJA 5

### ALTA

**C1 · El spec afirma falsamente que el master volume NO se persiste ni es undo-able**
El spec repite (×3 sitios) que `master.gain` no está en SessionState y que su undo «no tendría snapshot». Falso: `saved-state-v3.ts:73` guarda `masterVol: parseFloat(volInput.value)` y :97 lo restaura; el snapshot `SavedStateV3` es lo que usa el historial, y `#volume` ya está bracketeado para undo (`main.ts:276-289`). El master volume ya se persiste y es undo-able. La Duda D3 («¿promover master.gain al modelo?») parte de premisa incorrecta: no hay que ampliar nada.
Ubicación: spec §«Qué NO entra» p4 / §Undo del fader / Dudas; plan D3; `saved-state-v3.ts:73,97`, `main.ts:276`.

**C2 · El fader del master escribiría `master.gain.value` pero el snapshot lee `volInput.value` → rompe persistencia/undo**
Consecuencia de C1 no capturada. El snapshot lee `volInput.value`, no `master.gain.value`. La interfaz `MasterStripDeps` solo recibe `masterGain: GainNode`, sin acceso a `volInput`. Si el usuario mueve el fader y guarda, se persiste el valor VIEJO de `volInput`; un undo del fader restaura desde un snapshot que tomó `volInput.value`. La sincronía fader↔`#volume` (tratada como duda de UX, D2) es **requisito de corrección**, no preferencia: el fader debe escribir `volInput.value` (o `MasterStripDeps` incluir el input).
Ubicación: plan Tarea 3 + interfaz `MasterStripDeps`; D2; `saved-state-v3.ts:73`.

### MEDIA

**C3 · El «canal registerDisposable, mismo que las MixerColumn» no existe → fuga de VU/RAF**
Tarea 6 cablea `registerDisposable: /* mismo canal que las MixerColumn si existe */`. Ese canal no existe: `mixerDeps` (`main.ts:220-239`) no incluye `registerDisposable`; las MixerColumn ya fugan su VU (cada `renderWithMixer` hace `row.innerHTML=''` y reconstruye sin disponer, y se invoca en cada cambio de play-state vía `startRenderTick`, `session-host.ts:488,1044-1057`). El master strip añade un VU meter más que fuga igual, sin ruta de teardown. Hay que crear el mecanismo de cero o se agrava la fuga; el unit test «verifica registerDisposable si se pasa» pasa en aislamiento pero en producción nadie lo pasa.
Ubicación: plan Tarea 6 (l.313); `main.ts:220-239`, `session-host.ts:488,1044-1057`, `mixer.ts:181-182`.

**C4 · El master strip y su VU desaparecen en modo Performance**
`.session-view`/`#master-fx-panel` viven en `#session-view-root`, que se oculta al entrar en Performance (`performance-feature.ts:191`). En Performance el único control de master superviviente es `#volume` (en la fila de transporte, fuera de ese root). Refuerza que eliminar `#volume` (D2) dejaría Performance sin control de volumen master, y el usuario pierde el VU del master. No mencionado.
Ubicación: spec §Diseño/§Alcance; `performance-feature.ts:189-193`, `index.html:107,144,315`.

**C5 · El test de buildMasterStrip no arranca: vitest aquí es `node`, no jsdom**
Tarea 3a dice seguir el estilo de `session-host-active-lane.test.ts` «aunque vitest usa jsdom». Falso y autocontradictorio: `vitest.config.ts:5` es `environment:'node'` y `test/setup.ts` no globaliza `document`. El fixture citado funciona con un stub trivial que no basta para un builder que hace `createElement`/`addEventListener`/dispatch de `input`/`click`. El patrón correcto es la directiva por-archivo `// @vitest-environment jsdom` (como `lane-fx-panel.test.ts:1`). Corregible, pero la premisa y el modelo citado son incorrectos.
Ubicación: plan Tarea 3a; `vitest.config.ts:5`, `test/setup.ts:1-15`, `lane-fx-panel.test.ts:1`.

### BAJA (5) — solo recuento + título
- Ubicación del panel «después de #session-grid» lo intercala entre grid e inspector (`#session-inspector` sigue al grid).
- Columna de scenes (140px) no es mero spacer: aloja `session-stop-all`; coexistencia con frentes A/B no verificada.
- Bracket de undo del fader no funcionaría: `historyDeps` capturado como valor en build-time pero asignado post-construcción; el código existente usa un getter lazy (`main.ts:235-238`) que el plan no replica.
- Sincronía fader↔`#volume` sub-especificada con rangos distintos (`#volume` 0..1 vs faders 0..1.5; D1 sin resolver: gain>1 no representable en `#volume`).
- El panel movido fuera de `.page` pierde el `display:none !important` de `.page[hidden]`; auditoría de Tarea 8 no cubre este matiz del wrapper.

**VEREDICTO C: necesita revisión del spec/plan.** C1+C2 son un error fáctico central (el master volume YA se persiste/undo) que cambia las decisiones de diseño y obliga a cablear el fader contra `volInput`. Además hay deuda real de fugas (C3) y un hueco de Performance (C4) que el documento no reconoce. Reescribir el apartado de undo/persistencia y resolver el teardown del VU antes de implementar.

---

## Frente D — sampler-audio

**Recuento (defectos únicos):** ALTA 3 · MEDIA 7 · BAJA 4

### ALTA

**D1 · Se ignora el seam ya cableado `EngineUIContext.installClip` (diseñado para el import-as-loop del Sampler) e inventa un mecanismo paralelo**
El seam existe y está comentado literalmente como «the sampler's "import as loop" flow» (`engine-types.ts:74-76`), cableado en `session-host.ts:999-1006` (busca slot vacío de la propia lane + `renderWithMixer`). El spec/plan no lo mencionan y proponen construir `importLoopToSampler` desde cero «emitiendo un evento/llamando al host». Duplica un mecanismo previsto; además, si se reusara, hay que ampliarlo (hoy SOLO coloca el clip: no llama a `ensureScenesForRows`, no envuelve en `withUndo`, no abre el piano-roll).
Ubicación: `engine-types.ts:74-76`, `session-host.ts:999-1006` vs spec §3-§4 / plan Tareas 10 y 13.

**D2 · Importación multi-muestra melódica produce un keymap inservible (todas las zonas 0..127, gana la última)**
El plan (Tarea 11) usa `addSampleToKeymap(km, id, {rootNote})`, que fija SIEMPRE `loNote:0, hiNote:127` (`keymap-edit.ts:13-14`). Con `keymapEntryFor` "last match wins" (`keymap.ts:9-15`, citado por el propio spec), importar N muestras deja N zonas full-range: solo la última suena. Es justo el caso «melódico multi-zona» que el frente promete. Falta especificar el reparto de rangos lo/hi al importar varias muestras (o aclarar que multi-zona real solo llega vía presets bundled).
Ubicación: plan Tarea 11 + spec §3 vs `keymap-edit.ts:8-15`.

**D3 · Tests existentes que codifican el comportamiento revertido NO se inventarían (quedarán rojos)**
`clip-waveform-header.test.ts` YA existe (el plan dice «crear si no existe») y su test (l.26-36) afirma que el botón `.audio-clip-slice` debe estar presente y llamar a `onSliceToBank`: al quitar el slicing del audio lane fallará. Peor: `tests/e2e/audio-channel.spec.ts` (l.65-78) ejercita el flujo exacto que el spec elimina, y ni spec ni plan lo mencionan. Falta inventariar y reescribir/eliminar estos dos tests de regresión.
Ubicación: plan Tarea 9 vs `clip-waveform-header.test.ts:26-36`, `tests/e2e/audio-channel.spec.ts:65-78`.

**D4 · «Importar loop» del usuario reclama self-healing por `instrumentId` que NO existe para imports no-bundled**
Contradicción interna: Tarea 13 dice llamar a `mirrorInstrumentId` «para el self-heal del banco por id» en un loop importado por el usuario, pero `instrumentId` solo existe para presets bundled con manifiesto. Un loop de usuario no tiene manifiesto → `mirrorInstrumentId(undefined)` (no-op) y, al recargar, `reloadInstrument` haría `fetchInstrumentManifest(id)` y lanzaría. Choca con la propia política del spec (l.226 / plan l.257: «solo los bundled se reconstruyen por id»). Hay que separar loop BUNDLED (self-heal) vs IMPORTADO por usuario (IndexedDB-only).
Ubicación: plan Tarea 13 (l.179-181) vs spec §Self-healing (l.226) / plan l.257.

### MEDIA

**D5 · «Reutiliza la maquinaria ya existente» del import de loop — ese flujo NO existe hoy (seam huérfano sin caller)**
`sampler.ts` (l.469-508) solo tiene fileInput+dropzone que llaman a `addSampleToKeymap`; sin `buildSliceClip`, sin `slicesToKeymap`, sin `installClip`. El único slice→bank que funciona hoy es `onSliceToBank` desde el AUDIO lane. El plan debe partir de que el camino Sampler-side hay que **construirlo**, no «reorientar».
Ubicación: `sampler.ts:469-508` vs spec §Alcance.

**D6 · Colisión no señalada con el frente A: ambos tocan el mismo punto de inserción de clip del Sampler**
Tarea 13 crea inserción paralela con su propio `ensureScenesForRows`; el frente A modifica `installClip` para añadir `ensureScenesForRows` y propone extraer `placeClipEnsuringScene` para unificar TODOS los puntos de inserción. Si D crea un camino paralelo en vez de pasar por ese helper, reintroduce el bug del ▶ ausente o duplica el fix. Falta coordinación explícita.
Ubicación: plan D Tarea 13 vs `2026-06-06-gestion-sesion-design.md:93` + plan A Tarea 14a.

**D7 · «Renombrar/reorientar onSliceToBank» es en realidad una reescritura de firma y comportamiento**
El real `onSliceToBank(laneId, clipIdx)` (`session-host.ts:197-258`): recibe `clipIdx` (no `file|buf`), lee el sample de un CLIP de audio existente, y crea una LANE NUEVA sampler (`push` + `ensureLaneResource`). El destino (`importLoopToSampler(laneId, file|buf)` «sobre la lane actual, sin crear lane») cambia fuente, firma y elimina la creación de lane. Presentarlo como «rename + ajuste de firma» subestima el riesgo y descalibra el alcance de Tarea 10.
Ubicación: plan Tarea 10 vs `session-host.ts:197-258`.

**D8 · `waveformRef` del loop entero no es self-healing para presets bundled de loop**
`loadInstrument` loop (Tarea 6) solo genera/persiste sampleIds de los SLICES; nunca crea un sampleId para el WAV entero. El `waveformRef.sampleId` apunta al loop entero, que solo sobrevive si lo importó el usuario en ESE navegador. Para un preset bundled de loop, tras recargar en otro navegador el header de waveform queda en blanco. Decidir: regenerar/cachear el loop entero, reconstruir el ref desde slices, o documentar que el header de loop bundled no se rehidrata.
Ubicación: spec §2 l.99 + plan Tarea 6/13 vs `preload-scene-samples.ts:13-25`, `drumkit-loader.ts`.

**D9 · Exclusión mutua `instrumentId` vs `drumkitId` no garantizada en el load path**
Solo se asegura en la UI del selector. En `applyLaneEngineState` se aplica primero `drumkitId`→reload→setKeymap y luego `instrumentId`→reload→setKeymap; si por estado corrupto/migración coexisten, el segundo pisa al primero de forma no determinista y `chooseClipEditor` rutea mal (drumkitId→drum-grid). Falta guarda de invariante/precedencia + test.
Ubicación: spec §2/§3 + plan Tarea 7/12 vs `apply-lane-engine-state.ts:53-64`, `clip-editor-router.ts:51`.

**D10 · Compatibilidad hacia atrás de loops/sliced ya guardados tras revertir audio-channel sin tratar**
El modelo previo pudo crear en sesiones/demos lanes «sampler slices» con clip de notas + `waveformRef` ancladas a una lane sampler nueva. El spec asume migración «aditiva sin cambios» y solo verifica passthrough de `sample/waveformRef`, sin analizar demos baked ni el botón Slice retirado. Falta una nota explícita de compatibilidad.
Ubicación: spec §4 vs `session-host.ts:226-254`, `saved-state-v3.ts`.

**D11 · Discrepancia de tipos `padParams`: manifiesto `Partial<PadParams>` vs persistido `Record<string,number>`**
El manifiesto define `Record<number, Partial<PadParams>>`; la cadena de persistencia usa `Record<number, Record<string,number>>` (`session.ts:78`, `mirrorPadParams` en `session-engine-state.ts:97/sampler.ts:359` con cast). El plan dice aplicar «vía setPadStore + mirrorPadParams» sin resolver la conversión/cast. Aflorará en `tsc --noEmit`.
Ubicación: spec §1 / plan Tareas 3/7/12 vs `session.ts:78`, `sampler.ts:284,359`.

*(Marginal MEDIA: `public/instruments/` solo contiene `SOURCES.md`; Tarea 18 «opcional» difiere el contenido que Tareas 15/19 consumen → e2e/smoke sin contenido garantizado, `listInstruments` devuelve `[]` sin `index.json`. Lo cuento dentro de los 7 MEDIA.)*

### BAJA (4) — solo recuento + título
- `onSliceToBank` «sobre la propia lane» pero el código crea lane nueva (descripción engañosa del alcance del rename).
- Doble aplicación de `padParams` (manifiesto + persistido) sin orden definido.
- Undo/redo del cambio de familia y de la importación multi-muestra no definido.
- Fixtures DSP: spec cita `test/fixtures/loops/`, plan acierta `test/fixtures/loops/drum/`; + drift menor de números de línea citados.

**VEREDICTO D: necesita revisión del spec/plan.** Tres ALTA tocan el corazón: ignora el seam previsto (D1), genera keymaps inservibles en multi-muestra (D2), dejará tests rojos no inventariados (D3) y se contradice sobre self-healing (D4). Además colisiona con A en el punto de inserción (D6). Requiere rediseño del flujo de import al Sampler y reconciliación con el frente A.

---

## Frente E — editores-clips

**Recuento (defectos únicos):** ALTA 0 · MEDIA 4 · BAJA 5

### MEDIA

**E1 · Premisa falsa: «Copy copia solo las notas» — el handler copia el CLIP entero**
`#insp-copy` hace `clipClipboard = JSON.parse(JSON.stringify(clip))` (`session-inspector.ts:163`): clona el clip completo (name, lengthBars, sample, launchQuantize, gridResolution…). Solo `pasteReplace/pasteLayer` leen `.notes`. Reetiquetar a «Copy notes» (Tarea 3) sin tocar el handler contradice el objetivo del spec («que las etiquetas digan la verdad»): el botón dirá "notas" pero retiene el clip entero. Para honestidad real habría que ajustar el handler a `JSON.stringify(clip.notes ?? [])`.
Ubicación: spec §Objetivo/§7 (l.169) + plan Tarea 3 (l.110) vs `session-inspector.ts:162-167`.

**E2 · Solapamiento de archivos con el frente D sin orden de ejecución**
E toca `clip-editor-router.ts` y `clip-waveform-header.ts`; D los modifica de forma incompatible (`sampler-audio-plan.md:139`: «quitar `onSliceToBank?` de `ClipEditorDeps` (l.31) y de la llamada a `renderAudioClipEditor` (82-85)»). E trata el botón Slice→pads como «pendiente de D», pero ningún plan fija el ORDEN ni quién toca primero. Si E va antes con placeholders y D borra `onSliceToBank`, hay retrabajo/conflicto garantizado.
Ubicación: spec §Dudas D-A/D-B/D-C; `sampler-audio-plan.md:139,172`; archivos compartidos.

**E3 · El escenario e2e del clip de AUDIO (objetivo central §6) no es ejecutable en el boot por defecto**
Limpiar la cabecera de audio (quitar BPM/bars duplicados) es un pilar del frente y se quiere verificar en e2e, pero `engineId:'audio'` solo aparece en tests, no en ningún `public/demos/*.json`. `waitForBoot` solo espera celdas llenas (subtractive/tb303/drums), nunca audio. El cambio MÁS visible del frente queda sin verificación automatizada (solo smoke manual); no hay tarea para crear un fixture de lane audio.
Ubicación: plan Tarea 11 escenario 2 (l.304-306) + spec §6; sin `engineId:'audio'` en demos.

**E4 · El rótulo dinámico del toggle de vista hereda un «primer click no-op» en lanes melódicos**
El handler `#insp-toggle-editor` (`session-inspector.ts:168-175`) alterna sobre el OVERRIDE almacenado (`cur = override ?? null`), no sobre el editor resuelto. En un lane melódico sin override: `cur=null → next='piano-roll'` = editor ya activo → primer click no cambia nada visible (hay que clicar dos veces). Tarea 8 añade rótulo dinámico vía `chooseClipEditor` pero declara que «el handler mantiene su lógica» → el usuario verá «Ver como rejilla» que al pulsar no hace nada. Contradice el objetivo §4 («toggle honesto»).
Ubicación: plan Tarea 8 (l.251-257) + spec §4 vs `session-inspector.ts:168-175`.

### BAJA (5) — solo recuento + título
- La leyenda `PIANO_KEY_LEGEND` omite atajos reales (Ctrl+A/C/X/V, Esc, ↑/↓ con selección que nudge/transponen), contradiciendo el objetivo de descubribilidad; el test de coherencia no lo detecta; e incoherente con la `DRUM_KEY_LEGEND` que sí los incluye.
- `KEY_SEMITONES` no exportada hoy (spec da por accesible el test; el plan sí lo mitiga en Tarea 2).
- Spec §3 da por hecho que `resSel` del drum-grid va a la derecha (`margin-left:auto`); va plano (el plan lo corrige en Tarea 6b).
- Coordinación del `✕ Delete` con el frente A sin handler ni orden definidos (mismo botón/`deleteSelectedClip`, sin propietario de la confirmación).
- Decisión de rótulos EN + tooltips ES tomada como cierre (introduce mezcla idiomática nueva; debería ser duda de copy dado el énfasis en castellano); + Tarea 4 es un checkpoint sin código que infla el conteo.

**VEREDICTO E: arreglos menores antes.** No hay ALTA; los MEDIA son acotados: corregir la premisa/handler de Copy (E1), fijar el orden de ejecución E↔D y la propiedad de los archivos/botones compartidos (E2, + ✕ Delete), proveer un fixture de lane audio para el e2e o aceptar smoke manual (E3), y arreglar el no-op del primer click del toggle (E4). Una vez resueltos, el frente es implementable.

---

## Resumen ejecutivo — por dónde empezar

| Frente | ALTA | MEDIA | BAJA | Veredicto |
|---|---|---|---|---|
| **A** gestión-sesión | 2 | 4 | 5 | Necesita revisión del spec/plan |
| **C** mixer-master | 2 | 3 | 5 | Necesita revisión del spec/plan |
| **D** sampler-audio | 3 | 7 | 4 | Necesita revisión del spec/plan |
| **E** editores-clips | 0 | 4 | 5 | Arreglos menores antes |

**Orden recomendado de actuación:**

1. **Resolver la causa raíz compartida del «▶ ausente» (A1/A3 + D6/D1).** Es el nudo transversal: `installClip` es código muerto, el camino real es probablemente `onCellClick`, y el frente D inserta clips de Sampler por un punto que A quiere unificar. Decidir AQUÍ el `placeClipEnsuringScene` único y reconciliar D con él antes de tocar nada.
2. **Frente C — corregir el error fáctico de persistencia/undo del master (C1/C2).** Cambia las decisiones de diseño; el fader debe escribir `volInput.value`. Resolver también el teardown del VU (C3) o aceptar la deuda explícitamente.
3. **Frente D — rediseñar el import al Sampler (D1/D2/D3/D4).** Reusar el seam, definir reparto de rangos en multi-muestra, inventariar los tests a reescribir y separar bundled vs importado.
4. **Frente A — forzar compactación en deleteScene (A2)** y corregir premisas falsas (A4/A5).
5. **Frente E — arreglos menores (E1-E4)**, una vez fijado el orden E↔D.

Patrón recurrente a vigilar en los cuatro frentes: **premisas sobre el código sin verificar** (causa raíz falsa A1, persistencia inexistente C1, seam huérfano D1/D5, Copy E1) y **acoplamientos entre frentes declarados como "sin acoplamiento"** (A↔D en inserción de clips; E↔D en `clip-editor-router`; C↔Performance/B en `#volume`).
