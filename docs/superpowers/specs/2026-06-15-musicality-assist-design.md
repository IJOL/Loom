# Asistencia musical — Spec 1: tonalidad global, candado de escala, generadores y galería de ejemplos

**Fecha:** 2026-06-15
**Estado:** diseño aprobado, pendiente de plan de implementación
**Rama:** `worktree-musicality-assist`

## Por qué

El usuario no tiene formación de teoría musical y quiere herramientas que le ayuden a
(a) que todo suene **en tono**, (b) **generar** líneas de bajo, melodías y beats que suenen
bien, y (c) recuperar la idea de los **ejemplos de fábrica** del antiguo modo *Classic*.

Hoy Loom ya tiene piezas sueltas, pero ninguna red de seguridad ni guía:

- `randomizeClipNotes` ([src/session/clip-randomize.ts](../../../src/session/clip-randomize.ts))
  mete notas **al azar** dentro de una escala. Tiene escalas codificadas a mano
  (`major/minor/pentMinor/phrygian/chromatic`) y un selector de escala/root global
  (`#scale` + `#root` en [src/main.ts](../../../src/main.ts), ~líneas 184–202) que **solo**
  alimenta ese botón 🎲.
- El **piano-roll no conoce la escala**: se dibuja a ciegas
  ([drawGrid](../../../src/core/pianoroll.ts) / [drawKeys](../../../src/core/pianoroll.ts)),
  no resalta ni protege nada.
- El arpegiador note-FX ([src/notefx/arp-processor.ts](../../../src/notefx/arp-processor.ts))
  tiene su propio duplicado de intervalos de escala.

No hay una **tonalidad** de proyecto compartida, ni candado de escala, ni generadores con
lógica musical, ni galería de ejemplos.

## La visión (4 herramientas, este spec cubre la 1ª capa + ejemplos)

Una capa de **asistencia musical** cuyo núcleo es una **tonalidad global** (tónica + escala)
que todo lo demás respeta:

- **A — Entonar:** el piano-roll pinta y bloquea la escala (candado snap).
- **B — Generadores:** crean bajo/melodía/beat *dentro* de la tonalidad, por estilo.
- **C — Ejemplos:** clips de fábrica curados, cargables en la tonalidad actual.
- **D — Acordes (futuro):** elige una progresión dentro de la tonalidad y alimenta a B.

**Roadmap acordado (Roadmap B + ejemplos adelantados):**

| Spec | Contenido |
|------|-----------|
| **Spec 1 (este)** | Tonalidad global + override por pista · candado de escala · generadores de género · **galería de ejemplos básica** |
| Spec 2 | Ampliar la librería de ejemplos + **guardar tus propios** clips como ejemplos |
| Spec 3 | Asistente de acordes/progresiones (acorde por compás → alimenta a los generadores) |

## Decisiones tomadas (brainstorming)

- **Comportamiento:** *auto + red de seguridad* (genera por ti **y** te protege al editar).
- **Tonalidad:** **global del proyecto**, con **override por pista** (campo a campo).
- **Candado de escala:** **ON por defecto** (snap a la nota en tono más cercana), conmutable.
- **Presentación de escalas:** por **sensación + nombre + pista de uso** (p. ej. *"🌙 Oscura /
  tensa — La menor · el sonido acid/techno clásico"*). Se aprende sin esfuerzo.
- **Estilos:** Acid/Techno, House/Deep House, Synthwave/Electro, Lo-fi/Ambient (los cuatro).
- **Elección de estilo al generar:** **estilo global del proyecto** (un clic; cambiable).
- **Ejemplos:** **adelantados al Spec 1** como galería básica.

## Alcance del Spec 1

### 1. Modelo de datos

En [`SessionState`](../../../src/session/session.ts) (hoy: `lanes`, `scenes`,
`globalQuantize`, `masterInserts?`) añadir un bloque **opcional**:

```ts
// SessionState
musicality?: {
  key: number;        // pitch class 0–11 (0 = Do … 9 = La)
  scale: ScaleId;     // 'minor' | 'major' | 'pentMinor' | 'phrygian' | 'dorian' | 'chromatic'
  style: StyleId;     // 'acid' | 'house' | 'synthwave' | 'lofi'
  lock: boolean;      // candado de escala (default true)
};

// SessionLane
musicalityOverride?: { key?: number; scale?: ScaleId };  // se sale del global, campo a campo
```

- **Resolución por pista:** `resolveTonality(lane, state)` = `{ key: override.key ?? global.key,
  scale: override.scale ?? global.scale }`. El **estilo es solo global** en este spec.
- **Default de migración:** La menor (`key=9`, `scale='minor'`), `style='acid'`, `lock=true`.

### 2. Núcleo musical — `src/core/musicality.ts` (puro, sin DOM ni audio)

Única fuente de verdad de escalas para todo el proyecto. Sustituye los intervalos duplicados
de `clip-randomize.ts` (y, idealmente, los del arp en un paso posterior — fuera de alcance si
añade riesgo).

- `SCALE_CATALOG: ScaleEntry[]` — cada escala con sensación + nombre + pista:
  ```ts
  { id: 'minor', label: 'menor', mood: '🌙 Oscura / tensa',
    hint: 'el sonido acid/techno clásico', intervals: [0,2,3,5,7,8,10] }
  ```
  Escalas: `minor`, `major`, `pentMinor`, `phrygian`, `dorian`, `chromatic`.
- `rootNameEs(pc: number): string` → nombres en español (Do, Do♯, Re … La, Si). El nombre
  completo mostrado se compone: `` `${rootNameEs(key)} ${label}` `` → *"La menor"*.
- `inScale(midi, key, scale): boolean`
- `snapToScale(midi, key, scale): number` — a la nota en tono **más cercana** (empate → arriba).
- `degreesOf(key, scale): number[]` — pitch classes en escala (lo usan los generadores).
- `scaleDegreeToMidi(degree, octave, key, scale): number` — para renderizar ejemplos guardados
  en grados (ver §6).

**Tests:** `inScale`, `snapToScale` (incl. empates y fuera de rango), `degreesOf` por escala.

### 3. UI de tonalidad y estilo (barra superior)

Sustituir los `<select>` nativos `#scale` + `#root` (no permiten grupos con mood+hint) por un
**panel de tonalidad** propio — nuevo `src/session/musicality-bar.ts`:

- Botón compacto que muestra el estado: **`🌙 La menor · acid`**.
- Al abrir: lista de escalas **agrupada por sensación** (mood + nombre + hint), selector de
  **tónica** (Do…Si) y selector de **estilo del proyecto** (Acid / House / Synthwave / Lo-fi).
- Cambiar tonalidad/estilo muta `SessionState.musicality` con **undo** (patrón `withUndo` de
  [src/save/history-wiring.ts](../../../src/save/history-wiring.ts)) y re-renderiza el editor
  abierto (para que el resaltado del piano-roll se actualice).
- **Override por pista:** en el inspector de pista ([src/session/session-inspector.ts](../../../src/session/session-inspector.ts)),
  una línea discreta *"Tono: hereda La menor · [cambiar]"* que abre el mismo selector pero
  escribe en `lane.musicalityOverride`.

### 4. Piano-roll: resaltado + candado

El piano-roll ([src/core/pianoroll.ts](../../../src/core/pianoroll.ts)) recibe por `opts` un
contexto de escala y el flag de candado:

```ts
scaleCtx?: { inScale(midi: number): boolean; isRoot(midi: number): boolean };
scaleLock?: boolean;
```

- **Resaltado** en `drawGrid()` (filas) y `drawKeys()` (teclado lateral): filas/teclas **en
  tono** resaltadas, **fuera de tono** atenuadas, **tónica** marcada más fuerte. Tinte sutil,
  no debe competir con las notas ni el playhead.
- **Candado (snap):** cuando `scaleLock` está activo, el midi resultante de **crear, mover o
  nudge** una nota pasa por `snapToScale()`. Cubre los **tres** caminos de entrada:
  ratón (pencil/drag), teclado de ordenador (asdf/qwer + audición) y pegar/duplicar. La lógica
  pura vive en [src/core/piano-roll-editing.ts](../../../src/core/piano-roll-editing.ts)
  (testeable sin DOM); `pianoroll.ts` la invoca.
- **Inyección de la tonalidad:** el [clip-editor-router](../../../src/session/clip-editors/clip-editor-router.ts)
  resuelve `resolveTonality(lane, state)` y construye el `scaleCtx`.
- **Botón 🔒/🔓** en la barra del editor de notas (default ON, persistido en `musicality.lock`).
  Solo aplica a editores melódicos (piano-roll); en el **drum-grid** se ignora (no hay "tono").

**Tests:** snap en `piano-roll-editing` (nota fuera → cae en escala; con candado OFF se respeta).

### 5. Generadores de género — `src/core/generators/`

Reemplazan el azar de `clip-randomize.ts`. Firma única:

```ts
generate(kind: 'bass' | 'melody' | 'beat', style: StyleId, ctx: GenContext): NoteEvent[];
// GenContext = { key, scale, bars, meter, octaveBase, rng }   // rng inyectable (tests)
```

`kind` se infiere del `engineId` igual que hoy (`tb303` → bass, `drums-machine` → beat, poli →
melody). El 🎲 del inspector pasa a llamar a `generate(kind, state.musicality.style, ctx)`.

Plantillas por estilo (todas caen en escala vía `degreesOf` / `scaleDegreeToMidi`):

- **Bass:** *acid* (tónica + octavas, acentos + slides, huecos en 16th) · *house* (groove
  off-beat, root + quinta) · *synthwave* (arpegio del acorde de tónica) · *lofi* (notas largas,
  root + 3ª + 7ª, baja densidad).
- **Melody:** contorno (sube/baja), motivo que se repite, **resolución a la tónica**, densidad
  según estilo.
- **Beat:** four-on-the-floor + clap/caja en 2 y 4 + hats (off-beat en house, 16th en acid),
  *lofi* con swing y poca densidad, electro para *synthwave*. Notas GM
  (`kick 36 / snare 38 / hat 42 / openhat 46 / clap 39`).

Los acentos del bajo usan velocidad alta (modelo de velocidad ya existente,
[src/core/velocity-gain.ts](../../../src/core/velocity-gain.ts)); el slide del TB-303 se marca
en el `NoteEvent` igual que hoy lo consume el lane-scheduler (detalle del plan: confirmar el
campo de slide en `NoteEvent`).

**Tests (relativos):** cada estilo produce notas **todas en escala**; densidad esperada por
estilo (acid > lofi); el beat tiene kick en los downbeats; reproducible con `rng` fijo.

### 6. Galería de ejemplos (Classic) 🆕

Ejemplos de fábrica como **JSON**, mismo patrón que los presets
([public/presets/](../../../public/presets/)):

- **Almacenamiento:** `public/examples/<style>.json`. Cada entrada:
  ```ts
  { id, name, style, kind: 'bass'|'melody'|'beat', bars,
    // melódicos: grados de escala (encajan en CUALQUIER tonalidad)
    degrees?: { start, duration, degree, octave, velocity }[],
    // beats: notas GM tal cual
    notes?: NoteEvent[] }
  ```
- **Por qué grados y no midi:** un ejemplo melódico guardado en **grados de escala** se
  renderiza a la **tonalidad global** vía `scaleDegreeToMidi()` → suena bien en cualquier tono.
  Los beats se guardan como notas GM (no se transponen).
- **Carga:** `src/session/example-loader.ts` (espejo de `preset-loader.ts`) valida + cachea;
  `applyExampleToClip(example, clip, tonality)` renderiza y reemplaza `clip.notes` con **undo**.
- **UI:** botón **"Ejemplos…"** junto al 🎲 en el inspector → picker (estilo
  [src/demo/demo-picker.ts](../../../src/demo/demo-picker.ts)) filtrado por el `kind` de la
  pista y el `style` global.
- **Set inicial:** unos pocos curados por estilo y tipo, sembrados con ayuda del propio motor de
  generadores + un script `tools/build-examples.mjs`, revisados a oído (paridad: se cargan en
  el editor y se escuchan antes de dar por bueno el set).

### 7. Persistencia y migración

- **Persistencia:** campos nuevos **opcionales** en
  [src/save/saved-state-v3.ts](../../../src/save/saved-state-v3.ts) (`schemaVersion` sigue en 3;
  son aditivos, no rompen saves existentes).
- **Migración:** [src/session/session-migration.ts](../../../src/session/session-migration.ts)
  rellena `musicality` con el default (La menor / acid / lock ON) en saves antiguos.

## Fuera de alcance (explícito)

- Guardar **tus propios** clips como ejemplos → **Spec 2**.
- Asistente de **acordes/progresiones** → **Spec 3** (este spec ancla los generadores a la
  tónica; no hay progresión por compás todavía).
- Override de **estilo** por pista (el estilo es global en Spec 1).
- Unificar el arp y los generadores sobre `musicality.ts` si añade riesgo (puede quedar como
  limpieza posterior).
- Estado de mixer/master/sidechain: sin cambios.

## Criterios de aceptación

1. Existe una tonalidad global visible en la barra (sensación + nombre + hint) y persiste al
   guardar/recargar; una pista puede sobrescribirla.
2. Con el candado ON (default), es **imposible** colocar una nota fuera de tono en el piano-roll
   por cualquiera de los tres caminos de entrada; el candado se puede apagar.
3. El piano-roll **resalta** la escala y marca la tónica.
4. El 🎲 genera bajo/melodía/beat **en tono** y con carácter del **estilo global** (no azar
   plano); cambiar el estilo cambia el resultado.
5. La galería **"Ejemplos…"** carga clips de fábrica que suenan bien en la tonalidad actual.
6. Saves antiguos cargan sin error con el default aplicado.
7. `npx tsc --noEmit` limpio; suite de tests verde; verificación **a oído** del set de ejemplos
   y de un par de generaciones por estilo.

## Riesgos / notas

- **Paridad audible:** los generadores y el set de ejemplos son juicios musicales → "done"
  exige escucharlos, no solo tests verdes (regla del repo sobre mockups/parity y "done" honesto).
- **Resaltado del piano-roll:** no debe ensuciar la lectura del grid; ajustar opacidades a ojo.
- **Slide del TB-303:** confirmar en el plan cómo se marca en `NoteEvent` para que el bajo acid
  generado deslice como el motor espera.
- **GitNexus** es ciego al worktree (`detect_changes` no verá nada desde aquí); usar `tsc`/tests
  como verificación principal.
