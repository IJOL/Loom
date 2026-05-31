# Cómo crear plugins

Guía práctica para añadir synths, FX o modulators a Loom usando el plugin SPI.

## Concepto

Un plugin es una unidad audio empaquetada con su manifest. Hay tres tipos:

| Kind | Hace | Instancia |
|---|---|---|
| `synth` | Genera notas a partir de MIDI | `SynthInstance` con `trigger/release` |
| `fx` | Procesa audio in→out | `FxInstance` con `input/output` |
| `modulator` | Genera señal de control para modular AudioParams | `ModulatorInstance` con `output` |

Todos comparten:
- **Manifest** estático: `id`, `name`, `kind`, `version`, `params[]`, `presets[]`
- **Factory function**: `create(ctx, ...)` que construye una instancia
- **Param spec** unificado (`EngineParamSpec` aka `ParamSpec`): los params son la fuente de verdad para knobs UI, modulación, presets y automation

Los tipos viven en [`src/plugins/types.ts`](../src/plugins/types.ts). El registry en [`src/plugins/registry.ts`](../src/plugins/registry.ts). El bootstrap en [`src/app/plugin-bootstrap.ts`](../src/app/plugin-bootstrap.ts).

---

## Crear un synth plugin

### 1. El archivo

Crea `src/plugins/synths/my-synth.ts`. Tiene que vivir bajo `src/engines/` o `src/plugins/**` para que el auto-discovery del bootstrap lo escanee.

```ts
import type { PluginFactory, SynthInstance } from '../plugins/types';

export const mySynthPlugin: PluginFactory = {
  kind: 'synth',
  manifest: {
    id: 'my-synth',                    // único en el registry
    name: 'My Synth',                  // se ve en el dropdown
    kind: 'synth',
    version: '1.0.0',
    params: [
      // continuous → knobs
      { id: 'filter.cutoff', label: 'Cutoff', kind: 'continuous',
        min: 20, max: 20000, default: 1000, curve: 'exponential', unit: 'Hz' },
      { id: 'filter.resonance', label: 'Q', kind: 'continuous',
        min: 0.1, max: 24, default: 1, curve: 'exponential' },
      // discrete → select
      { id: 'osc.wave', label: 'Wave', kind: 'discrete',
        min: 0, max: 1, default: 0,
        options: [
          { value: 'saw', label: 'Saw' },
          { value: 'square', label: 'Sqr' },
        ] },
    ],
    presets: [],   // o leer de /public/presets/my-synth.json (ver más abajo)
  },

  create(ctx, output): SynthInstance {
    // Estado por instancia (por lane)
    let cutoff = 1000;
    let resonance = 1;
    let waveIdx = 0;

    // Grafo de audio
    const osc = ctx.createOscillator();
    osc.type = 'sawtooth';
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = cutoff;
    filter.Q.value = resonance;
    const amp = ctx.createGain();
    amp.gain.value = 0;
    osc.connect(filter).connect(amp).connect(output);
    osc.start();

    return {
      trigger(midi, time, opts) {
        const freq = 440 * Math.pow(2, (midi - 69) / 12);
        osc.frequency.setValueAtTime(freq, time);
        const peak = opts.accent ? 1.0 : 0.6;
        amp.gain.setTargetAtTime(peak, time, 0.005);
        amp.gain.setTargetAtTime(0, time + opts.gateDuration, 0.05);
      },
      release(time) {
        amp.gain.setTargetAtTime(0, time, 0.05);
      },
      connect(dest) { amp.connect(dest); },

      // Param map: id → AudioParam. El binder de modulación conecta
      // depth-gains aquí; las modulaciones LFO/ADSR llegan por estos puntos.
      getAudioParams: () => new Map<string, AudioParam>([
        ['filter.cutoff', filter.frequency],
        ['filter.resonance', filter.Q],
      ]),

      getBaseValue: (id) => {
        if (id === 'filter.cutoff') return cutoff;
        if (id === 'filter.resonance') return resonance;
        if (id === 'osc.wave') return waveIdx;
        return 0;
      },
      setBaseValue: (id, v) => {
        if (id === 'filter.cutoff') { cutoff = v; filter.frequency.value = v; }
        if (id === 'filter.resonance') { resonance = v; filter.Q.value = v; }
        if (id === 'osc.wave') {
          waveIdx = v | 0;
          osc.type = waveIdx === 1 ? 'square' : 'sawtooth';
        }
      },
      applyPreset: (name) => {
        // Busca en manifest.presets o en el cache externo y aplica params
      },
      dispose: () => {
        try { osc.stop(); osc.disconnect(); filter.disconnect(); amp.disconnect(); }
        catch { /* ok */ }
      },
    };
  },
};
```

### 2. Auto-discovery (no se registra a mano)

El bootstrap ([`src/app/plugin-bootstrap.ts`](../src/app/plugin-bootstrap.ts)) escanea con `import.meta.glob` (resuelto por Vite en build) **todos** los módulos en:

- `src/engines/*.ts`
- `src/plugins/**/*.ts`

(los `*.test.ts` se excluyen). De cada módulo recoge **cualquier export con forma de `PluginFactory`** (`{ kind, manifest, create }`) y lo registra. El array `BUILTIN` se construye solo del glob — **no edites `plugin-bootstrap.ts` ni mantengas ninguna lista**.

Único paso: **deja el archivo en una de esas carpetas exportando tu `PluginFactory`.**

> Para **synths**, registrarse en el plugin registry no basta para que sean instanciables como engine de lane hoy — mira «Estado actual: wrapper vs native» más abajo. Para FX y modulators, soltar el archivo es suficiente.

### 3. (Opcional) Presets JSON

Crea `public/presets/my-synth.json`:

```json
{
  "engineId": "my-synth",
  "presets": [
    {
      "name": "BASS Square Punch",
      "gm": [33, 34, 35],
      "params": { "filter.cutoff": 600, "filter.resonance": 8, "osc.wave": 1 }
    },
    {
      "name": "LEAD Bright Saw",
      "gm": [80, 81],
      "params": { "filter.cutoff": 3000, "filter.resonance": 2, "osc.wave": 0 }
    }
  ]
}
```

No hay que registrar el id en ningún sitio: [`src/main.ts`](../src/main.ts) deriva la lista de los synths ya registrados —

```ts
const ENGINE_IDS_FOR_PRESETS = listPlugins('synth').map((p) => p.manifest.id);
```

— así que en cuanto tu synth está registrado (paso 2) y existe `public/presets/<id>.json`, el preset loader lo lee al boot. El campo `gm` mapea presets a GM program numbers para el MIDI import.

### 4. UI

El sinte aparece **automáticamente**, sin tocar `index.html`:

- En el selector de engine de lane, que se puebla dinámicamente desde el registry ([`src/engines/engine-selector-ui.ts`](../src/engines/engine-selector-ui.ts), `melodicSynthEngineIds`)
- En el inspector de lane con preset dropdown unificado
- Sus continuous params como destinos de modulación

### 5. Listo

```bash
npm run build && npm run dev
```

Click `+` con "My Synth" seleccionado → lane nueva → sinte audible.

---

## Crear un FX plugin

Similar pero `kind: 'fx'`. La instancia expone `input` y `output` en vez de `trigger/release`. Ejemplos completos en [`src/plugins/fx/`](../src/plugins/fx/):

- [`multifilter.ts`](../src/plugins/fx/multifilter.ts) — biquad simple
- [`distortion.ts`](../src/plugins/fx/distortion.ts) — waveshaper
- [`reverb.ts`](../src/plugins/fx/reverb.ts) — convolver
- [`delay.ts`](../src/plugins/fx/delay.ts) — delay con damping en el feedback loop

Plantilla mínima:

```ts
export const myFxPlugin: PluginFactory = {
  kind: 'fx',
  manifest: {
    id: 'my-fx', name: 'My FX', kind: 'fx', version: '1.0.0',
    params: [
      { id: 'amount', label: 'Amount', kind: 'continuous', min: 0, max: 1, default: 0.5 },
    ],
    presets: [],
  },
  create(ctx): FxInstance {
    const input = ctx.createGain();
    const output = ctx.createGain();
    const node = ctx.createGain();
    input.connect(node).connect(output);
    let amount = 0.5;
    return {
      input, output,
      getAudioParams: () => new Map([['amount', node.gain]]),
      getBaseValue: (id) => id === 'amount' ? amount : 0,
      setBaseValue: (id, v) => { if (id === 'amount') { amount = v; node.gain.value = v; } },
      applyPreset: () => {},
      dispose: () => { try { input.disconnect(); node.disconnect(); output.disconnect(); } catch {} },
    };
  },
};
```

Donde aparece automáticamente:
- En el picker "+ Add insert" del lane inspector
- En el picker "+ Add insert" del master FX
- Sus continuous params como destinos de modulación en el dropdown

**No aparece en sends** (reverb/delay están escondidos del picker porque viven en FxBus como sends; los demás FX son inserts). Si quieres un FX-como-send tienes que cablearlo a mano contra FxBus — patrón para más adelante.

---

## Crear un modulator plugin

`kind: 'modulator'`. Genera una señal de control (típicamente un `ConstantSourceNode`) que el binder de modulación conecta vía depth-gain a los AudioParams del destino. Ejemplos en [`src/plugins/modulators/`](../src/plugins/modulators/).

Plantilla:

```ts
export const myModPlugin: PluginFactory = {
  kind: 'modulator',
  manifest: { id: 'my-mod', name: 'MyMod', kind: 'modulator', version: '1.0.0', params: [], presets: [] },
  create(ctx, bpm): ModulatorInstance {
    const output = ctx.createConstantSource();
    output.offset.value = 0;
    output.start();
    // Tu lógica para mover output.offset al ritmo que quieras
    return {
      output,
      getAudioParams: () => new Map(),
      getBaseValue: () => 0, setBaseValue: () => {},
      applyPreset: () => {},
      trigger: (t) => { /* en nota-on */ },
      release: (t) => { /* en nota-off */ },
      dispose: () => { try { output.stop(); } catch {} },
    };
  },
};
```

Donde aparece:
- En el botón "+ Source" del modulators panel (junto a +LFO +ADSR)
- Puede mapearse a cualquier destination del dropdown unificado (engine params + lane FX + master FX + master sends)

---

## Param specs

El array `manifest.params: ParamSpec[]` es la **única fuente de verdad** del sinte. Driver de:

- **Knobs/selects UI**: la unificación de inspectors lee de aquí para construir controles automáticamente
- **Automation registry**: cada param se registra como `${laneId}.${spec.id}` (e.g. `subtractive-1.filter.cutoff`)
- **Modulation destinations**: continuous params salen en el dropdown
- **Presets**: los presets JSON usan los mismos `id` keys

Shape:

```ts
interface ParamSpec {
  id: string;              // dot-namespaced: 'filter.cutoff', 'amp.attack'
  label: string;           // user-facing
  kind: 'continuous' | 'discrete';
  min: number;             // continuous: rango; discrete: 0
  max: number;             // continuous: rango; discrete: options.length - 1
  default: number;
  curve?: 'linear' | 'exponential' | 'log';
  unit?: string;
  options?: Array<{ value: string; label: string }>;   // solo discrete
}
```

Convenciones de naming (mira los engines existentes):
- `filter.cutoff`, `filter.resonance`, `filter.envAmount`
- `amp.attack`, `amp.decay`, `amp.sustain`, `amp.release`, `amp.gain`
- `osc.wave`, `osc.detune`, `osc.level`
- `bus.reverbSend`, `bus.delaySend`, `bus.eq.low` (para drums-bus)
- `opN.ratio`, `opN.detune`, `opN.level` (para FM)

Estos namespaces son los que el modulation panel agrupa y el preset JSON usa.

---

## Persistencia

`SessionLane.engineState` guarda el estado por lane (solo lo que el usuario ha cambiado, no defaults):

```ts
interface SessionLane {
  id: string;
  engineId: string;
  engineState?: {
    params?: Record<string, number>;        // values for ParamSpec ids
    modulators?: ModulatorState[];          // LFO/ADSR + connections
  };
  enginePresetName?: string;                // 'factory:LEAD Bright Saw'
  inserts?: InsertSlot[];                   // chain de FX inserts
}
```

`saveSession()` clona el state via `JSON.parse(JSON.stringify(...))` — todo lo que esté en SessionState se persiste automáticamente. No hay que tocar el SaveManager para un plugin nuevo.

`applyLoadedSessionState()` al cargar:
1. Llama `ensureLaneResource(laneId, engineId)` por cada lane
2. Aplica `enginePresetName` via `applyPresetForLane`
3. Aplica `engineState.params` via `engine.setBaseValue(id, v)` por cada entrada
4. Restaura modulators
5. Rehydrata inserts via `rehydrateInsertChain`

Tu plugin se beneficia gratis si:
- Implementas `setBaseValue` bien (escribe state + AudioParam)
- `getBaseValue` devuelve el valor actual

---

## Modulación

El binder de modulación ([`src/modulation/connection-binder.ts`](../src/modulation/connection-binder.ts)):

```
modulator.output → GainNode(depth) → target.getAudioParams().get(paramId)
```

Para que tu plugin sea **modulable**: declara el param en `manifest.params` con `kind: 'continuous'` Y devuélvelo en `getAudioParams()`. El modulation panel lo recogerá en el dropdown automáticamente.

Para que tu plugin sea **un modulator**: `kind: 'modulator'`, expone `output: AudioNode`. La señal va por el binder.

---

## El registry y lookup

```ts
import { registerPlugin, getPlugin, listPlugins, createInstance } from '../plugins/registry';

registerPlugin(mySynthPlugin);                              // se hace en bootstrap
const factory = getPlugin('synth', 'my-synth');            // el factory para un id
const allSynths = listPlugins('synth');                    // todos los synths
const inst = createInstance('synth', 'my-synth', ctx, out); // crear una instance
```

El registry está keyed por `${kind}:${id}` así que el mismo id en kinds distintos no colisiona.

---

## Estado actual: wrapper vs native

Los 6 engines actuales (`tb303`, `subtractive`, `fm`, `wavetable`, `karplus`, `drums-machine`) son **plugins que wrappean clases legacy**. Cada `xxxPlugin.create()` instancia una `XxxEngine` (que implementa `SynthEngine`) y traduce su API al contrato `SynthInstance`:

```ts
// src/engines/tb303.ts
export const tb303Plugin: PluginFactory = {
  kind: 'synth',
  manifest: { /* ... */ },
  create(ctx, output) {
    const engine = new TB303Engine();              // ← clase legacy
    const voice = engine.createVoice(ctx, output);
    return {
      trigger: (m, t, o) => voice.trigger(m, t, o),  // ← delega
      // ...
    };
  },
};
```

Esto coexiste con el registry **legacy** (`registerEngine` / `registerEngineFactory` en [`src/engines/registry.ts`](../src/engines/registry.ts)) que `audio-graph.ts` y `lane-allocator.ts` siguen usando vía `createEngineInstance(id)`. Mientras esos consumidores existan, los plugins synth tienen que ser wrappers o exponer una clase paralela.

Un **plugin truly native** (no wrapper) no necesita una clase `SynthEngine`. Implementa solo la interfaz `SynthInstance` directamente desde su `create()` con DSP propio. Es lo del ejemplo arriba.

Para que tu plugin native funcione con `ensureLaneResource`, ahora mismo hay que añadir un pequeño path:

```ts
// src/app/lane-allocator.ts ensureLaneResource (pseudocódigo)
const engine = createEngineInstance(engineId);
if (!engine) {
  // fallback: crea desde el plugin registry directamente
  const inst = createInstance('synth', engineId, deps.ctx, strip.input);
  if (!inst) return;
  // wrapping inst como SynthEngine-like para el resto del flujo
}
```

Esto es un follow-up pequeño cuando lo necesites. Por ahora la forma más fácil de añadir un sinte nuevo es:

1. Crear una clase que implemente `SynthEngine`
2. Registrarla en el legacy registry (`registerEngine(myEngine)` + `registerEngineFactory(...)`)
3. Crear el `PluginFactory` wrapper que la usa
4. Añadirla a `BUILTIN` en plugin-bootstrap

Mira [`src/engines/tb303.ts`](../src/engines/tb303.ts) bottom — los 3 last lines son la patrón completa de registro dual.

---

## Checklist para añadir un plugin

- [ ] `src/engines/<name>.ts` o `src/plugins/{fx,modulators,synths}/<name>.ts` con un `PluginFactory` exportado (el glob lo descubre — no se registra a mano)
- [ ] (Synth, opcional) Crear `public/presets/<engineId>.json` con factory presets — se lee solo al boot
- [ ] (Synth nativo) Si no es wrapper de un `SynthEngine` legacy, añadir el path en `lane-allocator.ts` (ver «wrapper vs native»)
- [ ] Verificar tests + tsc + build
- [ ] Smoke test en navegador: añadir lane, cargar preset, modular un param, guardar y reload

## Tests recomendados

- **Manifest test**: importa el plugin, verifica que `manifest.params` tiene las ids esperadas
- **Round-trip test**: crea instance, `setBaseValue` cada param, `getBaseValue` debe devolver lo escrito
- **Modulation test**: `getAudioParams()` debe incluir todos los continuous params declarados (la unificación lo asume)
- **Dispose test**: tras `dispose()`, los nodos deben estar desconectados (verifica con un FakeNode mock)

Mira [`src/plugins/registry.test.ts`](../src/plugins/registry.test.ts) y [`src/plugins/fx/insert-chain.test.ts`](../src/plugins/fx/insert-chain.test.ts) para patrones.

---

## Referencias rápidas

- **SPI types**: [`src/plugins/types.ts`](../src/plugins/types.ts)
- **Registry**: [`src/plugins/registry.ts`](../src/plugins/registry.ts)
- **Bootstrap**: [`src/app/plugin-bootstrap.ts`](../src/app/plugin-bootstrap.ts)
- **FX plugins**: [`src/plugins/fx/`](../src/plugins/fx/)
- **Modulator plugins**: [`src/plugins/modulators/`](../src/plugins/modulators/)
- **Synth plugins (wrappers)**: [`src/engines/*.ts`](../src/engines/) (bottom of each file)
- **Param spec**: [`src/engines/engine-params.ts`](../src/engines/engine-params.ts)
- **Preset loader**: [`src/presets/preset-loader.ts`](../src/presets/preset-loader.ts)
- **Modulation host**: [`src/modulation/modulation-host.ts`](../src/modulation/modulation-host.ts)
- **Lane allocator**: [`src/app/lane-allocator.ts`](../src/app/lane-allocator.ts)
- **Plan/spec originales del plugin-system**: en el historial de git (se eliminaron del árbol por estar ya implementados)
