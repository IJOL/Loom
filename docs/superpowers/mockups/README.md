# Mockups del rediseño de Loom

**Política:** un mockup aprobado se **archiva junto con su spec y su plan** — cuando
el spec **y** el plan de su feature se eliminan del árbol (convención de implementados,
recuperables de git), el mockup se elimina también. Lo que queda aquí es solo el de una
feature con trabajo **pendiente** (spec aún en `../specs/`). Los mockups de features ya
implementadas se recuperan de git history.

- **[sampler-mockup.html](./sampler-mockup.html)** — el mockup **vivo** del Sampler que iteramos.
  Hay **un solo** fichero, **sin versiones**: se edita en sitio (norma del usuario — nada de `*-v2/-v3…`).
  Vistas (selector): **Loop** (onda → cortes/slices → notas → clip, con herramienta de troceo
  onsets/grid + sens/umbral + cortes editables, y el preset guarda cortes+notas+sha), **Melódico**
  (muestras repartidas por el teclado, zonas con nota raíz + rango), **Pads** (drumkit). Controles en
  **módulos estrechos** (como el drum-rack real) y una **línea** une cada control con su trozo. Estilos
  reales (tokens, knob SVG, tiras `.dv-col`, IBM Plex Mono). Sigue vivo porque el Sampler tiene trabajo
  pendiente (per-pad LFO/ADSR — [spec](../specs/2026-06-04-sampler-per-pad-modulation-design.md)).

**Ver en local:** `npm run preview` y abre `http://localhost:4173/sampler-mockup.html` (o el fichero
directamente en el navegador).
