# El procedimiento: mudar un insert de `src/` a `plugins/`

Referenciado por las tareas 10–16 del plan
[2026-08-03-inserts-a-plugins.md](2026-08-03-inserts-a-plugins.md). **Se escribe
una vez y se aplica once.** No lo reinventes por efecto: si algo de tu efecto no
encaja aquí, está escrito en las particularidades de tu tarea.

Para un insert `<id>`:

## 1. Congela su conducta ANTES de tocar nada

Si el efecto tiene test, lánzalo y anota que pasa:

```bash
NO_COLOR=1 npx vitest run src/plugins/fx/<id>.test.ts
```

Si **no** tiene test, escríbele uno **antes de moverlo**. Mide una diferencia
**relativa** entre su salida y la señal seca — nunca una magnitud absoluta. Un
test escrito después de mudar congela el bug en vez de la conducta.

## 2. `plugins/<id>/plugin.json`

`params` se copia **literalmente** del `manifest.params` del fichero de `src/`,
traducido a JSON (sin `as const`, sin comentarios). `fx.color` es el que ese
mismo fichero declaró en la tarea 7.

```json
{
  "id": "<id>",
  "name": "<Name>",
  "version": "1.0.0",
  "loomApi": 1,
  "author": "Loom",
  "main": "main.js",
  "components": [
    {
      "kind": "fx",
      "id": "<id>",
      "name": "<Name>",
      "params": [ … copiados literalmente … ],
      "fx": { "color": "#……" }
    }
  ]
}
```

`name` es el del manifiesto original, no el id capitalizado: varios efectos
tienen nombre de pantalla propio (`tremolo` se llama **Trem/Gate**).

## 3. `plugins/<id>/main.ts` — sólo la fábrica

```ts
// plugins/<id>/main.ts — the factory, and nothing else. The description lives in
// plugin.json, which the host reads, validates and obeys.
import type { FxInstance } from '@loom/plugin-sdk';

Loom.registerFx('<id>', (ctx): FxInstance => {
  … exactamente el cuerpo de create() que había en src/plugins/fx/<id>.ts …
});
```

**Tres cambios respecto al cuerpo original, y sólo tres:**

1. los imports de `../types` pasan a `@loom/plugin-sdk`;
2. los imports de ayudantes (`./modulated-delay`, `./reverb-ir`) pasan a
   `@loom/plugin-sdk` — ya viven allí desde la tarea 9;
3. desaparece el objeto `PluginFactory` que envolvía a `create`.

Las constantes de módulo que el fichero tuviera (tablas de sincronía, curvas,
listas de formas de onda) **se mudan con él**, encima del `registerFx`. Son parte
del efecto.

## 4. Mueve su test a `plugins/<id>/`

`vitest.config.ts` ya recoge `plugins/**/*.test.ts`, así que no hay que tocar
configuración. El test deja de importar `<id>Plugin` y construye por la fábrica,
con un doble de `Loom` de dos líneas — el mismo patrón que
`plugins/karplus/karplus-parity.dsp.test.ts` usa para `registerRenderer`:

```ts
// The plugin's own test, run against the plugin as the host runs it: a two-line
// Loom double captures the factory, which is all main.ts needs from the ABI.
import { describe, it, expect, beforeAll } from 'vitest';
import type { FxInstance } from '@loom/plugin-sdk';

let create: (ctx: AudioContext) => FxInstance;
beforeAll(async () => {
  (globalThis as unknown as { Loom: unknown }).Loom = {
    registerFx: (_id: string, c: (ctx: AudioContext) => FxInstance) => { create = c; },
  };
  await import('./main');
});
```

Y en el cuerpo, `<id>Plugin.create(ctx)` pasa a ser `create(ctx)`. Todo lo demás
del test se queda igual: **las aserciones no se tocan**, son la prueba de que la
mudanza no cambió nada.

Un test que renderiza conserva su extensión `.dsp.test.ts`.

## 5. Borra el original

```bash
git rm src/plugins/fx/<id>.ts src/plugins/fx/<id>.test.ts
```

## 6. Verde, mirada y commit

```bash
NO_COLOR=1 npx vitest run plugins/<id>/
npm run test:unit
npm run build
```

⚠️ **`tsc --noEmit` NO detecta un import por efecto secundario a un módulo
borrado.** `import './algo';` compila con el fichero ausente. Lo pilla vitest, no
el typecheck: un `tsc` limpio no es prueba de nada aquí.

`npm run build` construye `plugins/<id>` y lo mete en `index.json`. Si el build
falla con `plugins/` vacío o mal formado, el manifiesto tiene un error de forma:
léelo, no lo adivines.

**Míralo antes de commitear:** `npm run dev`, y en Chrome real comprueba que el
efecto sale en el desplegable de "+ Add insert" **con su color**, se inserta y
suena.

Mensaje de commit en inglés, describiendo qué se movió y qué no cambió.
