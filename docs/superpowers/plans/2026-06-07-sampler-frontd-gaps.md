# Sampler — decisiones de diseño pendientes (Parte B)

> Trimmed 2026-06-10: la **Parte A** de este plan (preset de loop reproducible,
> tiras verticales por slice, layout del keymap, estilos del picker) **se implementó**
> con el rediseño de canal del Sampler (commits `b20d016`, `971a504`, `a36498e`), más
> el fix del `waveformRef` del preset y su e2e (commit `3aed24f`) — todo ya en `main`.
> La auditoría original y los pasos de la Parte A se recuperan del historial git.
> Queda SOLO la Parte B: decisiones del usuario antes de planificar. Mockup vivo:
> [sampler-mockup.html](../mockups/sampler-mockup.html).

## Parte B — necesita decisión de diseño (NO implementar a ciegas)

- **B1 · Reconciliar per-zona vs mockup limpio.** El mockup muestra filas de keymap
  **compactas** (nombre + root + rango + ✕) + un **mini-teclado** de colores, **sin**
  knobs per-zona a la vista. Pero el control per-pad/zona es una feature deliberada
  (per-pad control, mergeado 2026-06-04). **Decisión:** ¿los knobs per-zona van
  (a) colapsados tras un expander por zona, (b) en su fila siempre, o (c) fuera de la
  lista, en un panel de la zona seleccionada? (El rediseño actual usa (c): tiras de
  canal + "Selected sample" — confirmar si basta o se itera.)
- **B2 · Editor de clip con forma de onda (panel derecho del mockup).** Trim
  arrastrable (inicio/fin) + toggle **Loop/Tema** + campos BPM/ajuste/velocidad. Hoy
  `clip-waveform-header` pinta la waveform display-only. **Decisión:** ¿se añade trim
  arrastrable + modo Loop/Tema? (Era la Duda (d) del spec del Sampler + parte de la (c).)
- **B3 · Dudas abiertas restantes del spec de audio del Sampler** (spec borrado del
  árbol; texto íntegro en git history): (c) UI de trim/warp para el **audio lane**
  (WAV puro), (e) reparto automático multi-zona en el import multi-muestra.

> Recomendación: sesión corta de **brainstorming** (companion visual) para B1/B2 que
> produzca su propio plan detallado; B3 puede decidirse en la misma sesión.
