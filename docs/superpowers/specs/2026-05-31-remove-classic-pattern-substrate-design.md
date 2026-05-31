# Spec 2 — Eliminar el sustrato Classic `seq.pattern`

**Date:** 2026-05-31
**Status:** Approved direction (auditoría completa) — pendiente de revisión del spec
**Branch:** `cleanup/remove-classic-pattern`
**Depends on:** Spec 1 (lanes de automatización en Performance view) — **ya enviado a `main`** (`b881a4e`). Su envío es lo que desbloquea borrar el tab "Automation" global.

**Scope:** Borrar por completo el sustrato Classic que cuelga de `seq.pattern`. Tras Spec 2, la **Session (clips) es el único modelo**; `seq.pattern` deja de existir. Es una **limpieza** (sin features nuevas) salvo un único re-alojo: 🎲 Notes pasa a generar notas en el clip activo de la Session.

---

## 1. Goal & Non-goals

**Goal.** `seq.pattern` y todo lo Classic que lo usa desaparecen. El `Sequencer` queda como un reloj maestro que solo dirige `sessionTick`. La automatización global Classic (tab "Automation") se borra — su reemplazo es Performance view (Spec 1). El randomize de notas se re-aloja al clip activo.

**Non-goals.**
- No tocar Performance view ni la automatización por-clip (`clip.envelopes`) — se quedan.
- No romper compatibilidad de saves antiguos: `session-migration.ts` y los tipos `BassStep/DrumStep/PolyStep` (que usa la migración) **se conservan**.
- No rediseñar el randomize de notas más allá de re-apuntarlo al clip activo con la misma lógica scale-aware.
- No renombrar `seq.length` (sigue siendo el largo por defecto de clip nuevo + el selector de compases).

---

## 2. Contexto y evidencia

Playback es **Session-only**: el `tick()` del `Sequencer` ([sequencer.ts:153-159](../../../src/core/sequencer.ts#L153)) solo llama a `sessionTick` cada 25 ms; **ya no avanza `currentStep` ni lee `pattern`**. Por tanto, además de `pattern.bass/drums/melody`, son **vestigiales**: `currentStep`, `nextStepTime`, `currentPlayPosition()`, `onStep`, `onPatternChange`, `onEnded`, `loopEnabled`, `pendingPattern`/`setPattern`/`queuePattern`.

GitNexus: `impact(Sequencer.pattern)` = **CRITICAL por nº de referencias pero `processes_affected: 0`** — muy referenciado, cero flujos de ejecución. Firma clásica de código muerto-pero-referenciado. Ver memoria `project_classic_pattern_removal_deferred`.

---

## 3. Auditoría — disposición por símbolo

### 3.1 BORRAR

| Cluster | Símbolos / archivos | Por qué |
|---|---|---|
| **Pattern Classic** | `Sequencer.pattern`, getters `bass`/`drums`/`melody`; `setPattern`/`queuePattern`/`pendingPattern`/`hasPendingPattern`/`cancelPendingPattern`; `currentPlayPosition`; `currentStep`/`nextStepTime`; `onStep`/`onPatternChange`/`onEnded`; `loopEnabled` | Nada los reproduce/dispara |
| **pattern.ts** | `PatternData`, `emptyPattern`, `clonePattern`, `PatternBank`, `AutomationLane`, `PolyTrackMode`, `BassMode` | Solo los usa Classic (`AutomationLane` queda huérfano al irse el tab global + `PatternData`) |
| **Banco A/B/C/D** | `transport.ts`: `switchSlot`, `updateSlotButtons`, botones `slot`, **Chain**, **Loop**, wiring de `onEnded`/`onPatternChange` (**conservar Play/Stop**); `copy/slot-copy.ts` (archivo entero); `demo/initial-pattern.ts` (archivo entero, `setupInitialPattern` + Sweet Dreams) | Editan/lanzan `seq.pattern`, que no suena |
| **Toggles Step↔Piano** | `main.ts` `setBassMode`/`updateBassModeButtons`/`setPolyPatternMode`; wiring `#bass-mode-*`/`#poly-mode-*` en `polysynth-presets.ts`; markup en `index.html` | Editan un pattern muerto |
| **Panel copiar notas** | `copy/lane-copy.ts` (archivo entero); `wireCopyNotesPanel` en `main.ts`; markup en `index.html` | La Session ya copia clips |
| **Tab Automation global** | `automation/automation-ui.ts` (archivo entero); `app/automation-recording.ts` (archivo entero); el bucle global de `seq.pattern.automation` en `automation/automation-tick.ts`; `wireAutomationTab` + deps en `main.ts`; `data-tab="auto"` + `data-page="auto"` en `index.html` | **Superado por Performance view (Spec 1)** |
| **Presets Classic** | `presets/presets.ts` `loadBassPreset`/`loadMelodyPreset`/`loadDrumPreset`; `presets/preset-library-ui.ts` (wiring `run`) | Escriben `PatternData`; el sistema real son los JSON de `public/presets` |
| **Accessors main.ts** | `getSeqPattern`, `getMelodySteps` | Plumbing del pattern |
| **random.ts (notas)** | la(s) ruta(s) de `randomize()` que escriben `seq.pattern.bass/melody/drums` | Reescriben el pattern muerto (ver §5) |

### 3.2 CONSERVAR

| Qué | Por qué |
|---|---|
| `seq.length` como **campo simple** del Sequencer + `setLength(n)` (solo setea el campo + notifica `engineSequencers`) | Largo por defecto de clip nuevo ([session-host.ts:414](../../../src/session/session-host.ts#L414)) + selector de compases |
| Reloj maestro: `start`/`stop`/`isPlaying`/`tick`→`sessionTick`, `bpm`, `swing`, `sessionMode`, `engineSequencers` | Es lo que mantiene viva la Session |
| Automatización **por-clip** (`clip.envelopes`, `clip-automation-lanes.ts`, `tickSessionEnvelopes`) + `automation-painter.ts` | De la Session, no Classic |
| `automation-tick.ts` partes vivas: `tickSessionEnvelopes` + `applyModulationToKnobs` | Se **vacía**, no se borra |
| `AUTOMATION_SUB_RES` (en `pattern.ts`) | Lo usan Performance + clip-automation + painter → `pattern.ts` queda reducido a esta constante |
| `BassStep`/`DrumStep`/`PolyStep` (en `sequencer.ts`) + `bassStepsToNotes`/`stepsToNotes`/`drumStepsToNotes` (`notes.ts`) | Los usa `session-migration.ts` para cargar saves viejos (paso→notas). Se reubican junto a la migración si conviene |
| `session-migration.ts` | Compat de saves viejos |
| 🎲 **Sound** (`randomizeBassSound`/`randomizeDrumsSound`: params/kit) | **Vivo** — randomiza el synth/kit real (no el pattern). Solo hay que detangle de `seq.pattern` en `random.ts` |
| **Play/Stop** (`transport.ts`) | Esencial |

### 3.3 RE-ALOJAR

| Qué | Acción |
|---|---|
| 🎲 **Notes** (`bass-random-notes`/`drums-random-notes`/`poly-random-notes`) | Reimplementar para generar `NoteEvent[]` **scale-aware** en el **clip activo** de la Session (el abierto en el clip-editor) y refrescar el editor, con undo. Reusa la lógica de `randomizePolyLaneNotes` (que ya produce `NoteEvent[]` en modo piano) (ver §5) |

---

## 4. `Sequencer` después del borrado

```ts
export class Sequencer {
  bpm = 130;
  swing = 0;
  length = 32;                 // campo simple: default clip length + selector de compases
  sessionTick?: (now: number, lookahead: number) => void;
  sessionMode = true;          // siempre true (legible para callers de boot)

  private playing = false;
  private timerId: number | null = null;
  private engineSequencers: EngineSequencer[] = [];

  constructor(private ctx: AudioContext, length = 32) { this.length = length; }

  registerEngineSequencer / unregisterEngineSequencer  // sin cambios
  isPlaying(): boolean
  start(): void   // resume ctx, playing = true, tick()
  stop(): void
  setLength(n): void  // this.length = n; engineSequencers.forEach(es => es.setLength(n))
  private tick = () => { if (this.sessionTick) this.sessionTick(this.ctx.currentTime, 0.12); if (this.playing) this.timerId = setTimeout(this.tick, 25); }
}
```

Los tipos `BassStep`/`DrumStep`/`PolyStep` se conservan (mover a `notes.ts` o dejar en `sequencer.ts` — decisión del plan; los usa la migración).

---

## 5. Randomize — detangle + re-alojo

`random.ts` hoy: `randomize(seq, synth, opts)` muta `seq.pattern` (notas) y/o params del synth según `opts`. Se parte en dos:

- **Sound (conservar):** la parte que randomiza params del synth / kit (`{mod:true}`, kit). Se desacopla de `seq.pattern` (deja de escribir notas). `randomizeBassSound`/`randomizeDrumsSound` siguen funcionando.
- **Notes (re-alojar):** una función nueva `randomizeClipNotes(clip, {scale, root, density})` **pura** que devuelve/escribe `NoteEvent[]` en `clip.notes` (scale-aware, sparse — la lógica de `randomizePolyLaneNotes`/`drumStepsToNotes` portada al modelo `NoteEvent`). Los botones `*-random-notes` del clip-editor la llaman sobre el **clip activo** (el abierto en el editor), refrescan el editor y pasan por `withUndo`.

El acceso al "clip activo" se resuelve en el plan leyendo `session-inspector.ts` / `clip-editors/` (el botón 🎲 Notes ya vive en la toolbar del clip-editor).

---

## 6. `index.html`

Quitar: `slot-group` (botones A/B/C/D), `chain-toggle`, `loop-toggle`, `#bass-mode-step/piano`, `#poly-mode-step/piano`, el panel de copiar notas, la pestaña `data-tab="auto"` y la página `data-page="auto"`. Conservar Play/Stop, el selector de compases (`#bars`), y las páginas de inspector por-engine (303/drums/poly/fx) que ya son Session.

---

## 7. Testing

Convención del repo: aserciones **relativas**.

| Capa | Qué | Cómo |
|---|---|---|
| Pura | `randomizeClipNotes` produce `NoteEvent[]` no vacío, en escala, dentro de `lengthBars` | unit nuevo |
| Scheduling | El reloj maestro slim sigue disparando `sessionTick` (start→tick→sessionTick) | harness fake-clock existente |
| Regresión | La suite completa (649 unit) sigue verde tras cada capa de borrado | `npm run test:unit` |
| DSP | Reproducir la Session demo sigue produciendo audio (no se rompió el reloj) | baterías DSP existentes |
| E2E | App arranca en Session, Performance sigue funcionando, no hay botones Classic (slots/chain/loop/automation-tab) en el DOM | ajustar/añadir Playwright |

**Tras cada capa borrada: `npx tsc --noEmit` + `npm run test:unit` verdes.** Build + e2e al final (e2e sirve `dist/` → `npm run build` antes).

---

## 8. Error handling / riesgos

- **Riesgo CRÍTICO por nº de referencias, 0 procesos** en lo muerto → seguro si se hace por capas manteniendo verde el runtime de Session.
- **El reloj maestro** (`tick`→`sessionTick`) es lo único que no se puede romper: se conserva intacto, solo se le quita el andamiaje Classic alrededor.
- **`seq.length`** debe quedar inicializado sin `setupInitialPattern` (constructor `length=32`); el selector de compases lo ajusta.
- **Saves viejos** con `seq.pattern`/slots: `session-migration.ts` ignora lo Classic y backfillea la Session; los tipos de paso se conservan para esa conversión.
- **Demo de boot:** la Session demo (`fetchDemoSession` / `minimal-techno.json`) es la que suena; `setupInitialPattern` (Sweet Dreams en slots) no afecta al audio → su borrado es seguro.

---

## 9. Orden de implementación (strangle, de hojas al núcleo)

1. **Hojas sin dependientes:** panel copiar notas (`lane-copy.ts`), `slot-copy.ts`, presets Classic (`presets.ts` + `preset-library-ui.ts`), toggles Step↔Piano. Quitar su markup en `index.html`. tsc + tests.
2. **Tab Automation global:** `automation-ui.ts`, `automation-recording.ts`, bucle global en `automation-tick.ts`, `wireAutomationTab`, `data-tab/page="auto"`. tsc + tests.
3. **Banco/transport:** `switchSlot`/slots/Chain/Loop/`onEnded`/`onPatternChange` en `transport.ts` (conservar Play/Stop), `initial-pattern.ts`, `PatternBank`. tsc + tests.
4. **Randomize:** detangle Sound en `random.ts`; re-alojar 🎲 Notes → `randomizeClipNotes` sobre el clip activo. tsc + tests + unit nuevo.
5. **Sequencer:** quitar `pattern` + toda su API (getters, set/queuePattern, currentPlayPosition, currentStep, onStep/onPatternChange/onEnded, loopEnabled); `length` pasa a campo; `tick` slim. Arreglar `main.ts` (getSeqPattern/getMelodySteps + wirings). tsc + tests.
6. **pattern.ts:** colapsar a `AUTOMATION_SUB_RES` (+ reubicar `BassStep/DrumStep/PolyStep` si hace falta). tsc + tests.
7. **Final:** `npm run build` + e2e + suite completa.

Cada paso es un commit revisable; el compilador (`tsc --noEmit`) actúa de worklist tras cada borrado.

---

## 10. Resultado

`seq.pattern` deja de existir. El `Sequencer` es un reloj que dirige `sessionTick`. La única automatización es la por-clip (Session) + la dibujable en Performance (Spec 1). 🎲 Sound randomiza el synth; 🎲 Notes randomiza el clip activo. Cero restos Classic.
