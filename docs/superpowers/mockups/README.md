# Mockups aprobados — Loom UX overhaul

Estos son los mockups **aprobados** del rediseño de Loom. Son HTML autónomos: ábrelos
en un navegador (o sírvelos en local) para verlos.

> **Por qué están aquí (y no se pueden volver a perder).** Durante el overhaul del
> 2026-06-06 estos mockups se crearon como ficheros **temporales en `public/*-mockup.html`**
> "a limpiar antes de cerrar" — y se borraron sin commitear. El del Sampler, que el usuario
> había aprobado, se perdió y la implementación divergió de él (UI vieja + el loop preset no
> creaba clip). Se han **recuperado del transcript de la sesión** y commiteado aquí como
> fuente de verdad. Regla en [CLAUDE.md](../../../CLAUDE.md) → «Approved mockups & honest "done"».

| Archivo | Qué muestra |
|---|---|
| [2026-06-06-sampler-mockup.html](./2026-06-06-sampler-mockup.html) | **Sampler rediseñado**: barra de preset (familias Melódicos / Percusión-Drumkits, Load/Save As/🎲, Gain/Voices, toggle Teclado↔Pads), vista **Teclado** (teclado con zonas de color + lista de zonas con knobs por zona) y vista **Pads** (rejilla con M/S + knobs curados + avanzado). |
| [2026-06-06-editors-mockup.html](./2026-06-06-editors-mockup.html) | Editores de clip (incl. la forma de onda / asignación a notas del sample). |
| [2026-06-06-header-mockup.html](./2026-06-06-header-mockup.html) | Cabecera de transporte. |
| [2026-06-06-performance-mockup.html](./2026-06-06-performance-mockup.html) | Vista Performance / arrangement. |
| [2026-06-05-loop-mockups.html](./2026-06-05-loop-mockups.html) | Layouts del editor de loop (del brainstorm de loop tempo-sync, 2026-06-05). |

**Para verlos en local:** se sirven desde `dist/` con `npm run preview`
(`http://localhost:4173/<nombre>.html`), o ábrelos como fichero en el navegador.
