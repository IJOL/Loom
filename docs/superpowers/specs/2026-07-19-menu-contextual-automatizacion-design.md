# Menú contextual de automatización sobre los mandos

**Fecha:** 2026-07-19
**Estado:** diseño aprobado, pendiente de plan
**Depende de:** el registro maestro de destinos (mismo branch, spec del 2026-07-19)

> En castellano a propósito: su lector es quien lo aprueba. El código y la UI van en inglés.

## Qué se pide

Clic derecho sobre un mando → un menú que lleve directamente a la automatización de
**ese** parámetro, creándola si no existe. Hoy hay que ir a un desplegable, buscar el
parámetro entre decenas y añadirlo a mano; el mando que tienes bajo el cursor ya sabe
cuál es.

## Alcance

**Solo los mandos giratorios.** Son los únicos parámetros continuos y, por tanto, los
únicos automatizables hoy. Los selectores discretos (tipo de filtro, sincronismo) y los
botones de dos estados (ON/OFF, bypass) quedan **fuera**: no están en el catálogo de
destinos y automatizarlos exigiría que la automatización supiera saltar entre valores
enteros en vez de interpolar. Es otra función, no este menú.

## Cuándo aparece el menú

Solo si el `meta.id` del mando es un destino vivo del catálogo
(`DestinationRegistry.list()`). Un mando que no se puede automatizar —los del mezclador,
los de configuración de un LFO— no ofrece menú en absoluto, en vez de ofrecerlo y fallar
al pulsarlo.

El clic derecho está libre hoy: ni `core/knob.ts` ni `core/select-control.ts` escuchan
`contextmenu`. Se reutiliza `openContextMenu` de `src/core/context-menu.ts`, ya usado por
la rejilla de escenas.

## A dónde va la automatización

La decisión se toma en este orden:

1. **Si estamos en vista Performance** → curva en la línea de tiempo (`arrangement`).
2. **Si no, y el parámetro pertenece a un canal** → el clip que esté **sonando** en ese
   canal (`laneStates.get(laneId).playing`). Si no suena nada → el **primer clip** del
   canal, y se abre en el editor.
3. **Si no, y el parámetro es de un efecto de master o de un envío** (`fx.master.*`,
   `fx.send.*`) → curva en la línea de tiempo, **y se cambia a vista Performance** para
   que la curva quede a la vista.

El canal sale del propio identificador vía `parseAutomationParamId`; no se consulta qué
hay seleccionado en pantalla. Un mando de `subtractive-1.filter.cutoff` escribe en el
clip de `subtractive-1`, aunque estés mirando otro canal.

El punto 3 es una decisión explícita del usuario: un efecto de master es global y su
automatización pertenece a la toma, no a un clip. El cambio de vista es la contrapartida
—escribir donde el usuario no mira, sin llevarlo allí, sería el fallo silencioso que este
branch entero viene a eliminar.

## Qué ofrece el menú

- **Si ya existe automatización de ese parámetro en el destino que toca:**
  `Edit automation in <destino>` → la revela (abre el clip / cambia a Performance y hace
  scroll hasta su carril).
- **Si no existe:** `Automate in <destino>` → la crea y la revela.

**La etiqueta siempre nombra el destino** — `Automate in clip "Verse 1"`,
`Automate on the timeline`. El usuario nunca escribe a ciegas. Esto no es cosmético: es
la garantía de que la regla del punto 3 no sorprenda.

## Casos límite

| Caso | Comportamiento |
|---|---|
| El canal no tiene ningún clip | Ítem deshabilitado, con el motivo escrito |
| El mando no es un destino del catálogo | No se abre menú; no se hace `preventDefault` |
| El insert al que pertenece el mando se borra mientras el menú está abierto | El menú se cierra al perder el foco; la acción revalida el destino antes de escribir |

## Diseño técnico

Dos piezas, deliberadamente separadas:

**1. La decisión, pura y testeable.** Una función sin DOM:

```
resolveAutomationTarget(paramId, ctx) →
  | { kind: 'clip'; laneId; clipIdx; existing: boolean; label }
  | { kind: 'timeline'; existing: boolean; label; switchView: boolean }
  | { kind: 'unavailable'; reason }
```

Recibe el modo actual, el mapa de estados de canal y la sesión. Toda la tabla de
decisión de arriba vive aquí y se prueba sin navegador.

**2. El enganche, mínimo.** Un `contextmenu` sobre el elemento del mando que llama a la
función anterior, construye los ítems y delega en `openContextMenu`. Sin lógica propia.

Módulo nuevo `src/automation/knob-automation-menu.ts`. Se le pasan sus dependencias
explícitamente, como todo `src/app/`; **nada de instancia global** — el branch acaba de
borrar un respaldo que construía un segundo registro en silencio.

## Reutiliza (no reinventa)

| Necesidad | Ya existe |
|---|---|
| Menú | `core/context-menu.ts` → `openContextMenu` |
| ¿Es automatizable? + etiqueta y rango | `DestinationRegistry.list()` |
| Canal a partir del id | `parseAutomationParamId` |
| Clip sonando por canal | `LanePlayState.playing` |
| Abrir un clip | `SessionInspector.setSelectedClip({ laneId, clipIdx })` (pública, ya usada desde seis sitios) |
| Crear curva en la toma | `addAutomationCurve(state, paramId, laneIds)` (`performance/arrangement-ops.ts:176`) |
| Crear envolvente en clip | `clip.envelopes` |

## Pruebas

De comportamiento, y sobre la función pura donde sea posible:

- Cada rama de la tabla de decisión: Performance → toma; canal con clip sonando → ese
  clip; canal sin nada sonando → primer clip; master/envío → toma con cambio de vista.
- Un parámetro ya automatizado devuelve `existing: true` y no duplica el carril.
- Un mando que no es destino no abre menú.
- Un canal sin clips devuelve `unavailable` con motivo.
- La etiqueta nombra el destino real, no uno genérico.

Trampas conocidas de este repo, a evitar en los tests: `listAutomationTargets` devuelve
lista vacía **en silencio** si el plugin no está registrado, y `getEngine()` devuelve
`undefined` si el módulo del motor no se importó — cualquiera de las dos hace que un
aserto pase por motivos ajenos. Ver `docs/automation-destinations.md`.

## Fuera de alcance

- Automatizar parámetros discretos o botones de dos estados.
- Borrar automatización desde el menú (solo crear e ir a ella).
- Menú contextual sobre cualquier otro control que no sea un mando.
