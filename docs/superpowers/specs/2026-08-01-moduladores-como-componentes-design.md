# Rebanada B — LFO y ADSR como componentes de primera clase

> Trozo 2 del trabajo de plugins, rebanada B. La A (manifiesto por componentes +
> puerta de capacidades) está mergeada en `main` = `a4e958c`, con tres arreglos
> posteriores hasta `6f42967`. Spec hermano:
> [2026-08-01-plugins-core-por-capacidades-design.md](2026-08-01-plugins-core-por-capacidades-design.md).

**Objetivo en una frase:** que exista un **tercer modulador**. Hoy no puede
existir: el vocabulario de modulador está cerrado en cuatro sitios y el worklet
convierte en silencio cualquier tipo desconocido en un ADSR.

**Idioma:** la prosa de este documento va en castellano, igual que sus hermanos.
**Todo lo que sea código va en inglés** — identificadores, comentarios, nombres
de test y mensajes de commit. Los bloques de código de este spec y de su plan se
escriben ya en inglés, porque en la rebanada A se copiaron literalmente al
código y colaron comentarios en castellano que hubo que revertir (`4b19b59`).

---

## 1. Decisiones cerradas (no rediscutir)

**El LFO y el ADSR NO salen del árbol.** No es por comodidad. Los presets y las
sesiones guardadas están **escritos en un vocabulario que incluye `lfo` y
`adsr`**, y —lo decisivo— **las envolventes de amplitud y de filtro del
Subtractive SON moduladores ADSR**
([subtractive.ts:26-37](../../../src/engines/subtractive.ts#L26-L37):
`adsr-amp` → `paramId: 'amp'`, `adsr-filter` → `'filter.env'`), igual que las dos
del Westcoast van cableadas a `timbre.fold` y `lpg.cutoff`. Si fueran
desinstalables, quitarlos no rompería una función: **enmudecería el sinte y
rompería datos ya guardados**.

De ahí sale la regla general para el instalador del trozo 4: **lo que sólo se
USA se puede quitar; lo que además se REFERENCIA desde datos guardados, no.**

**No se fusionan.** Siguen siendo dos componentes independientes, con su id, sus
capacidades, sus params, su DSP y su estado. Comparten el MECANISMO —registro,
SPI, panel—, igual que dos motores comparten el de motores.

**El scope por defecto es el primero de la lista.** Un componente declara los
scopes que admite y el primero es el que se usa al crear uno nuevo. No hay campo
`defaultScope`.

**El `scope` de una instancia es dato de sesión, no capacidad** (decisión de la
rebanada A, sigue vigente).

---

## 2. Hechos verificados en el código

Comprobados el 2026-08-01 sobre `main` = `6f42967`, y el impacto sobre un índice
GitNexus **reconstruido entero** (11.002 nodos / 29.027 aristas).

### 2.1 Hay DOS caminos de modulación vivos a la vez

| camino | quién lo recorre | DSP |
| --- | --- | --- |
| **worklet** | params de motor de los 6 melódicos | [modulation-runtime.ts](../../../src/audio-dsp/modulation-runtime.ts), muestra a muestra |
| **Web Audio** | params de FX/inserts de CUALQUIER pista, y params de drums/sampler | [lfo-voice.ts](../../../src/modulation/lfo-voice.ts) / [adsr-voice.ts](../../../src/modulation/adsr-voice.ts) |

En los seis motores melódicos `getAudioParams()` devuelve vacío a propósito, así
que el `LFOVoice` de Web Audio **no toca ningún parámetro de motor**. Por eso
arreglar sólo el SPI no cumple la aceptación: daría un modulador que se oye en un
FX y en drums, pero **incapaz de modular el filtro de un sinte**.

El mismo LFO tiene además **tres** implementaciones de su matemática: el
`OscillatorNode` de Web Audio, el `wave()` del worklet y el `computeWaveform()`
que anima el anillo del mando.

### 2.2 El worklet es un vocabulario cerrado — y falla en silencio

`ModLite.kind` es la unión `'lfo' | 'adsr'`, y
[worklet-lane-engine.ts:110](../../../src/engines/worklet-lane-engine.ts#L110) hace:

```ts
kind: m.kind === 'lfo' ? 'lfo' : 'adsr',
```

Un tipo desconocido no se rechaza: **se convierte en un ADSR**. Es el bloqueo
real de la rebanada.

### 2.3 El "plugin" de cada modulador no es dueño de nada

[lfo.ts](../../../src/plugins/modulators/lfo.ts) y
[adsr.ts](../../../src/plugins/modulators/adsr.ts) son 29 líneas que construyen
un estado **de usar y tirar** (`makeDefaultLFO('lfo-tmp')`), y
[modulation-host.ts:84-91](../../../src/modulation/modulation-host.ts#L84-L91)
dice explícitamente que nunca hay que enrutar `lfo`/`adsr` por ahí, porque el SPI
`create(ctx, bpm)` no puede recibir el estado vivo. Un modulador de terceros sale
**mudo** por ese mismo agujero.

### 2.4 El render offline corre la MISMA clase que el worklet

`ModulationRuntime` la instancia `renderKernelLane`
([kernel-lane-render.ts](../../../src/export/kernel-lane-render.ts)), llamada por
`OfflineSceneRecorder.record`. Buena noticia: un tercer modulador implementado en
el kernel **sale gratis en el export**, siempre que `toModLite` no lo aplaste
antes.

### 2.5 Impacto medido

| símbolo | riesgo | directos | totales |
| --- | --- | --- | --- |
| `ModulatorState` | **CRITICAL** | 41 | 200 |
| `ModulationRuntime` | HIGH | 17 | 30 |
| `toModLite` | HIGH | 4 | 13 |
| `ModulationHostImpl.spawnVoiceFiltered` | LOW | 1 | 1 |

Lectura: **cambiar la forma de `ModulatorState` es caro** y además está escrito
en sesiones guardadas, así que esta rebanada **no lo cambia**. Y **arreglar el
SPI es barato** — un único llamante directo.

### 2.6 Censo de partida

`node tools/plugin-id-census.mjs --group modulator` → **18 comparaciones que
deciden en el core**, repartidas en 5 ficheros de producción:
`modulation-runtime.ts` (6), `modulation-host.ts` (4), `modulation-ui.ts` (4),
`types.ts` (3), `worklet-lane-engine.ts` (1).

### 2.7 Un bug encontrado por el camino

[lfo-voice.ts:41](../../../src/modulation/lfo-voice.ts#L41) hace
`osc.type = state.waveform as OscillatorType`. Nuestro vocabulario dice `'saw'`;
el enum de Web Audio dice `'sawtooth'`. El `as OscillatorType` es lo que lo tapa.
Medido en `node-web-audio-api`: asignar `'saw'` **no lanza, se ignora**, y el
oscilador se queda con la forma anterior. Resultado: eliges **Saw** y te sale
sierra en el worklet y **no** en el camino Web Audio. Entra en esta rebanada
porque el arreglo cae justo donde el LFO pasa a ser dueño de su forma de onda.
Pendiente de confirmar en Chrome real antes de darlo por cerrado.

---

## 3. Qué hace esta rebanada

**Un modulador deja de ser una cadena sobre la que se hace `switch` y pasa a ser
un componente registrado.** El core pregunta al registro; nunca compara ids.

### 3.1 El componente (hilo principal)

```ts
// src/modulation/modulator-registry.ts
export interface ModulatorComponent {
  id: string;                       // 'lfo', 'adsr', 'sh'
  name: string;                     // UI label: 'LFO', 'ADSR', 'S&H'
  /** What drives the value: 'time' runs off the clock (LFO, S&H); 'gate' is
   *  driven by the note (ADSR). Decides which road the modulator takes inside
   *  the worklet — see §3.2. */
  driver: 'time' | 'gate';
  /** Scopes this modulator supports. The FIRST one is the default for a new
   *  instance; there is no separate defaultScope field. */
  scopes: ModulatorScope[];
  /** Prefix for generated instance ids ('lfo' → lfo1, lfo2…). */
  idPrefix: string;
  /** Fresh state for a new instance. Replaces makeDefaultLFO/makeDefaultADSR. */
  defaultState(id: string): ModulatorState;
  /** This modulator's own config row. NOT the generic param grid — see §4. */
  configTemplate(mod: ModulatorState, ctx: PanelCtx): TemplateResult;
  /** The Web-Audio voice: FX-param modulation on every lane, plus drums and
   *  sampler engine params. Receives the LIVE state, which the old SPI could
   *  not — that is why a third modulator was mute. */
  createVoice(
    ctx: AudioContext,
    opts: { state: ModulatorState; bpm: () => number },
  ): ModulatorVoice;
}

export function registerModulator(c: ModulatorComponent): void;
export function getModulator(id: string): ModulatorComponent | undefined;
export function listModulators(): ModulatorComponent[];
```

El registro **es la puerta** para moduladores, igual que
`plugins/capabilities.ts` lo es para motores. Cuando en el trozo 3 un plugin
pueda registrar un modulador, la puerta gana esa segunda fuente por dentro y
ningún llamante se entera — que es exactamente el patrón que la rebanada A
demostró.

### 3.2 El kernel (dentro del worklet)

El worklet es otro bundle: un kernel se registra por **import de efecto
lateral** en [loom-processor.ts](../../../src/audio-worklet/loom-processor.ts),
igual que los renderers de motor.

```ts
// src/audio-dsp/modulator-kernels.ts
export interface ModulatorKernel {
  id: string;
  /** Normalised signal in -1..+1 (bipolar) or 0..1 (unipolar) at absolute time
   *  `t`, given the phase origin the runtime resolved for this modulator. */
  valueAt(m: ModLite, t: number, origin: number): number;
}

export function registerModulatorKernel(k: ModulatorKernel): void;
```

`ModulationRuntime` deja de preguntar `m.kind !== 'lfo'` y pasa a buscar el
kernel por `m.kind`. Un tipo sin kernel **no contribuye** (se ignora, no se
disfraza de otra cosa).

### 3.3 El camino `'gate'` se queda EXACTAMENTE como está

El ADSR no viaja por `valueAt`: el renderer instancia una envolvente **por voz**
y la abre y cierra con la nota (`getAdsrMods` → `ModEnvHost`). Ese camino es la
envolvente de amplitud del Subtractive, así que **esta rebanada no lo toca**: el
ADSR sólo cambia su declaración (`driver: 'gate'`), no su DSP.

Consecuencia declarada, no escondida: **al terminar la B se puede añadir un
tercer modulador `driver: 'time'`, pero todavía no uno `driver: 'gate'`.** Abrir
el camino de puerta es trabajo aparte, con la envolvente del Subtractive como red
de seguridad. Va escrito en §7.

### 3.4 Los cinco sitios que dejan de decidir

| fichero | hoy | después |
| --- | --- | --- |
| [modulation-runtime.ts](../../../src/audio-dsp/modulation-runtime.ts) | 5 comparaciones de `kind` (3 bucles + `setMods` + `getAdsrMods`) y un `wave()` propio | busca el kernel por id |
| [worklet-lane-engine.ts:110](../../../src/engines/worklet-lane-engine.ts#L110) | colapsa a `'lfo' \| 'adsr'` | pasa `kind` tal cual |
| [modulation-host.ts](../../../src/modulation/modulation-host.ts) | dos `if` de spawn + prefijo de id ternario | `getModulator(kind)` |
| [modulation-ui.ts](../../../src/modulation/modulation-ui.ts) | botones `+ LFO`/`+ ADSR` fijos, plantilla por ternario | `listModulators()` |
| [types.ts](../../../src/modulation/types.ts) | `makeDefaultLFO`/`makeDefaultADSR`/`defaultScopeFor` | los dueña cada componente |

### 3.5 El tercer modulador: S&H

Sample & Hold: a `rateHz`, engancha un valor aleatorio y lo mantiene hasta el
siguiente paso. Params mínimos: **rate** y **polaridad**. Es la prueba de que el
mecanismo funciona, y a la vez el único modulador cuya firma es inconfundible —
una señal **constante a tramos** no la puede producir un LFO.

Aleatoriedad **con semilla derivada del id del modulador**, y —esto es lo
importante— **`valueAt` se queda puro**: el valor enganchado en el paso *n* se
calcula como `hash(seed, n)`, no se guarda en una variable mutable del kernel.
Sin esa pureza el render offline y el vivo divergirían, porque no recorren la
misma secuencia de llamadas. Ficheros: su componente en
`src/plugins/modulators/sh.ts` y su kernel en `src/audio-dsp/modulators/sh.ts`.

Va **en el árbol**, no como plugin cargado de disco: la ABI todavía no expone
`registerModulator` dentro del worklet, y abrirla es el trozo 3. Que esté en el
árbol no lo hace privilegiado — lo que lo demuestra es el censo (§5.4).

---

## 4. Qué NO hace esta rebanada

- **No fusiona el LFO y el ADSR.**
- **No los saca del árbol.**
- **No cambia `ModulatorState`** (CRITICAL, 200 dependientes, y escrito en
  sesiones guardadas). Los campos siguen donde están; lo que cambia es quién los
  declara y quién los lee.
- **No pasa los mandos por el grid genérico de params.** Dos razones
  independientes, cada una suficiente:
  1. El grid es **índice numérico** de punta a punta (`min: 0`,
     `max: options.length - 1`, `default` = índice, y lee
     `options[Math.round(engine.getBaseValue(id))]`). `getBaseValue(id): number`
     es la firma sobre la que se apoyan automatización, mapeo MIDI, pads XY y el
     registro de destinos. Un param con valor de cadena no es un retoque del
     grid: es romper el contrato numérico del SPI entero.
  2. Aunque fuera gratis, **el grid no puede expresar el panel del LFO**:
     FREE/SYNC cambia qué controles existen, RETRIG es un control de tres
     posiciones que escribe **dos** campos (`scope` y `trigger`), BARS es un
     campo de texto y RATE tiene una escala a trozos propia.

  Cada componente se queda con su plantilla de configuración. Es lo que también
  traería un plugin de verdad.
- **No abre el camino `driver: 'gate'`** a moduladores nuevos (§3.3).
- **No unifica las tres implementaciones de la matemática del LFO.** La del
  worklet pasa a ser el kernel; la de Web Audio y la del anillo se quedan, ahora
  bajo el mismo dueño. Unificarlas es otra rebanada.

---

## 5. Aceptación

Cada criterio es un camino de usuario con su propio test. Sin alternativas
`(o …)`.

1. **El S&H se oye en un motor melódico.** Render DSP de un motor con un S&H
   conectado a `filter.cutoff` con profundidad, contra el mismo render con
   profundidad 0: el audio **difiere**. Aserción relativa, nunca un umbral
   absoluto.
2. **Es un S&H, no un LFO.** La señal del kernel es **constante a tramos**: dos
   muestras dentro del mismo paso son iguales; dos muestras a caballo de un
   límite de paso difieren. Es lo que distingue el mecanismo de un ternario
   afortunado.
3. **El export offline lo lleva.** La misma escena por `renderKernelLane` produce
   la modulación del S&H — mismo kernel, mismo resultado que en vivo.
4. **El censo baja a cero.** `node tools/plugin-id-census.mjs --group modulator`
   da **0** en `core-decides` (partida: 18).
5. **El Subtractive y el Westcoast siguen sonando.** Test de caracterización de
   sus envolventes por defecto: el ADSR de amplitud sigue modelando `amp`
   (sube en el ataque, cae al sustain, cae a ~0 en el release) y el de filtro
   sigue llegando a `filter.env`. Aserciones de forma, relativas.
6. **El `'saw'` del LFO produce sierra en el camino Web Audio**, no la forma
   anterior (§2.7).
7. **Comprobación de oído en Chrome real**: un S&H sobre el cutoff suena a
   escalones, y un preset de Subtractive con envolvente suena como antes del
   cambio.

---

## 6. Orden de trabajo

Cada paso deja el árbol verde y una función entera; ninguno abre una ventana en
la que una pista quede muda.

1. **Red de seguridad primero**: el test de caracterización del Subtractive y el
   Westcoast (§5.5), en verde contra el código actual. Si el refactor los rompe,
   se entera aquí.
2. El registro de componentes y el de kernels, vacíos, con LFO y ADSR
   registrándose y **nadie leyéndolos todavía**.
3. `ModulationRuntime` pasa a buscar el kernel; el LFO mueve su `wave()` al
   kernel del LFO.
4. `toModLite` deja de colapsar el `kind`.
5. `ModulationHostImpl` y `modulation-ui` pasan a leer el registro; mueren
   `makeDefaultLFO`/`makeDefaultADSR`/`defaultScopeFor`.
6. El SPI pasa a `create(ctx, { state, bpm })`; los dos stubs de 29 líneas
   desaparecen absorbidos por sus componentes.
7. El S&H: componente + kernel + sus tests (§5.1, §5.2, §5.3).
8. El arreglo del `'saw'` (§2.7) y el censo a cero (§5.4).

---

## 7. Riesgos y deuda que se acepta a sabiendas

- **El ADSR es viga maestra.** Es la envolvente de amplitud del Subtractive y del
  Westcoast. Mitigación: esta rebanada **no toca su DSP**, y el paso 1 pone la
  red antes de mover nada.
- **`driver: 'gate'` sigue cerrado.** Al terminar la B se puede añadir un
  modulador de tiempo, no uno de puerta. Es una limitación declarada, no un
  descuido; se abre cuando alguien la necesite, con la red del paso 1 ya puesta.
- **La ABI del worklet todavía no expone `registerModulator`**, así que un
  modulador de terceros aún no puede cargarse de disco. Trozo 3.
- **Siguen existiendo tres matemáticas del LFO** (§4). Ahora con un dueño cada
  una, pero tres.
- **`tools/plugin-id-census.mjs` escribe su salida en castellano.** Es un
  artefacto del repo y debería estar en inglés; se corrige en el primer commit de
  esta rebanada.
