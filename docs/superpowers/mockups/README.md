# Mockups del rediseño de Loom

- **[sampler-mockup.html](./sampler-mockup.html)** — el mockup **vivo** del Sampler que iteramos.
  Hay **un solo** fichero, **sin versiones**: se edita en sitio (norma del usuario — nada de `*-v2/-v3…`).
  Vistas (selector): **Loop** (onda → cortes/slices → notas → clip, con herramienta de troceo
  onsets/grid + sens/umbral + cortes editables, y el preset guarda cortes+notas+sha), **Melódico**
  (muestras repartidas por el teclado, zonas con nota raíz + rango), **Pads** (drumkit). Controles en
  **módulos estrechos** (como el drum-rack real) y una **línea** une cada control con su trozo. Estilos
  reales (tokens, knob SVG, tiras `.dv-col`, IBM Plex Mono).

## Mockups aprobados recuperados (otras superficies)

Recuperados del transcript de la sesión del overhaul (se crearon como `public/*-mockup.html` temporales
y se borraron sin commitear). Regla en [CLAUDE.md](../../../CLAUDE.md) → «Approved mockups & honest "done"».

| Archivo | Qué muestra |
|---|---|
| [2026-06-06-editors-mockup.html](./2026-06-06-editors-mockup.html) | Editores de clip. |
| [2026-06-06-header-mockup.html](./2026-06-06-header-mockup.html) | Cabecera de transporte. |
| [2026-06-06-performance-mockup.html](./2026-06-06-performance-mockup.html) | Performance / arrangement. |
| [2026-06-05-loop-mockups.html](./2026-06-05-loop-mockups.html) | Layouts del editor de loop. |
| [2026-06-10-sampler-b2-waveform-edit-mockup.png](./2026-06-10-sampler-b2-waveform-edit-mockup.png) | Sampler B2 — asas de trim/loop sobre la onda (panel Selected sample). Implementado (`8edac81..6564df9`). |

**Ver en local:** `npm run preview` y abre `http://localhost:4173/sampler-mockup.html` (o el fichero
directamente en el navegador).
