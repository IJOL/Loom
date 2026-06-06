# Loom — Revisión UX / saneamiento: índice maestro

**Fecha:** 2026-06-06
**Estado:** descomposición acordada. Cada frente tendrá su propio spec → plan → implementación.
**Origen:** sesión de brainstorming sobre gestión de lanes/scenes/clips que creció hasta abarcar varios subsistemas ("la carta a los Reyes Magos"). Se decide descomponer en 5 frentes independientes.

Este documento es el **índice**: no es un spec de implementación. Enlaza los 5 frentes, las decisiones tomadas, las dudas abiertas y los artefactos generados.

---

## Terminología (fijada)

- **Lane** = columna vertical (pista/instrumento, incluidos los canales de audio).
- **Scene** = fila horizontal.
- **Clip** = celda en la intersección lane×scene.
- **Audio lane / canal de audio** = lane con `engineId: 'audio'`.

---

## Orden acordado

1. **B · Saneamiento + cabecera** ← se empieza por aquí.
2. Resto (A, C, D, E) en el orden que se decida, uno a uno.

---

## Frente A · Gestión de sesión

- **Borrado con aspa ✕** a la izquierda de cada **clip**, **scene** y **lane** (patrón consistente). Sustituye al borrado por teclado (engorroso: al pinchar el clip se abre el editor).
  - Confirmación **solo si la lane/scene tiene contenido**; vacías se borran directas.
- **Nunca rellenar con clips vacíos** al crear una lane: el instrumento nace **totalmente vacío**; el canal de audio solo lleva su clip en la **fila 1**; el resto, celdas vacías de verdad.
- **Bug ▶ ausente** al insertar lanes no-audio (ocurría con clips recortados/slice). Reproducir con test → arreglar.
- **Menús contextuales** (botón derecho) en lane / scene / clip / celda vacía. Crear un `context-menu.ts` reutilizable (hoy no existe; el único uso de `contextmenu` es suprimir el menú nativo en el drum-grid). Pueden coexistir con el aspa.

## Frente B · Cabecera, transporte & saneamiento  *(primero)*

- **Play y Stop separados** (hoy un único `#play` con doble uso "Play / Stop").
- **Fila "Sesión" aparte**: modo Session/Performance, Copiar a Performance, grabación, Stems, New/Save/Load/Demo, MIDI bajan a su propia fila; la fila 1 (transporte/tempo) queda limpia. El viz se queda en la fila 1.
- **Solo iconos + tooltips** en los botones de acción (sin etiquetas de texto). Session/Performance se queda con texto (es un modo).
- **REC unificado**: un único botón ⦿ (punto rojo, gráfico) + **selector de 3 modos**: 🎛 knobs + clip-launches (→ take) · ⏱ tiempo real (audio a WAV) · ⚡ offline (render). Por defecto 🎛. Fusiona el `#rec` y el menú de export realtime/offline.
- **Copiar a Performance** → solo icono ⇉ con tooltip.
- **Quitar botones sueltos** de la `session-toolbar` ([index.html:315-318](../../../index.html)): `▶ Scene 1 (debug)` y `⏹ All` (redundantes con los del grid).
- **Quitar Bars + View legacy**: `#pager` (View) es UI muerta (no cableada); `#bars` aún fija `seq.length` (longitud por defecto de clips nuevos) — al quitarlo, default fijo (p.ej. 1 barra), la longitud ya es por-clip en el inspector.
- **Bug "New" no libera synths**: `applyLoadedSessionState` dispone por id de lane, pero quedan engines/voces vivos sin lane. Reproducir → arreglar.
- **Bug playhead Performance** corrido a la izquierda + sincronía descuadrada. Diagnóstico en curso.

## Frente C · Mixer del master

- **Strip del master** (suma de todas las lanes) en la columna de **scenes** (al fondo, fila de mixer).
- **Master FX como botón** que despliega los master effects **justo debajo** (hoy viven en una pestaña "Master FX" separada).

## Frente D · Sampler & audio

- **Sampler = instrumento de muestras con presets en 3 familias**:
  - **Melódicos** (multi-zona cromático, vista teclado).
  - **Percusión / Drumkits** (vista pads). Los drumkits dejan de ser un modo aparte → son **presets**.
  - **Loops sliced** (vista loop): slices + notas.
- **Drums** sigue reusando el motor del Sampler para los kits de muestra (`kitMode: 'sample'`).
- **Quitar la zona de drag**; importar con un **botón de selección múltiple**.
- ⚠️ **Revertir la "audio-channel direction"**: el **audio lane = solo WAV puros** (grabaciones, stems, takes), **sin** loops/slicing. Los **loops particionados vuelven al Sampler**.
- **Modelo de loop**: un loop sliced **es** un melódico cuyas notas son slices.
  - Importar un loop (o cargar su preset) → **recorta** + mapea slices + **auto-crea un clip de notas** en la lane (y una **escena** si hace falta) que reproduce el loop.
  - El clip se edita con el **piano-roll normal** (no hay editor especial; las notas NO se editan dentro del Sampler).
  - El **preset guarda slices + notas**; al recuperarlo, reconstruye instrumento + clip (+escena).
- **Presets melódicos**: hoy `sampler.presets = []`. Necesitan muestras reales (placeholder en mockup). Fuentes acopiadas en [public/instruments/SOURCES.md](../../../public/instruments/SOURCES.md) (20 fuentes con licencia confirmada: CC0/CC-BY).

## Frente E · Editores de clips

Aclarar piano-roll + drum-grid (mezcla de conceptos y exceso de texto). Observaciones del estado actual:
1. "Copy Clip" / "Paste" copian solo las **notas**, no el clip → etiqueta engañosa.
2. "Quantize" es el **launch-quantize** del clip, no del editor, pero vive en la barra de edición.
3. "↔ Editor" fuerza piano-roll/drum-grid **sobreescribiendo** el editor del engine (override por clip).
4. "oct: C3" es solo informativo; la octava se cambia con z/x (teclas ocultas).
5. El **teclado de ordenador** (a s d f…) para meter notas no se anuncia en la UI.
6. Inconsistencia: drum-grid tiene "Resolución" en su barra; piano-roll tiene octava. Mismo tipo de control, distinto.
7. "BPM 120" / "1 bar" son texto estático que duplica "Length"; Warp y Slice→pads (audio) metidos en un "editor".
8. La barra del inspector tiene **10 controles siempre visibles**, apliquen o no al tipo de clip.

---

## Dudas abiertas (NO fijadas)

- **`loop` / `loopStart` per-pad** (sustain-loop de la muestra): ¿se mantienen o fuera?
- **Cabecera waveform** (BPM · bar · ♺ Warp · ✂ Slice→pads): probable eliminación/reparto — slice → acto de importar al Sampler; warp → fuera para loops; BPM/bar → duplican Length.
- **Audio lane (WAV puro)**: edición tentativa = **trim + warp opcional** (no fijado).
- **Waveform en un loop**: solo como display detrás del piano-roll, sin controles.

---

## Artefactos de la sesión

- Mockups (temporales, en `public/`, **a limpiar** antes de cerrar): `header-mockup.html`, `performance-mockup.html`, `sampler-mockup.html`, `editors-mockup.html`.
- Acopio de samples melódicos: [public/instruments/SOURCES.md](../../../public/instruments/SOURCES.md).
