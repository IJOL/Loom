<!-- Acopio de samples melódicos para los presets del Sampler de Loom.
     Generado por el workflow wf_b792d2e6-48f: 58 candidatos, 20 fuentes usables.
     Revisar cada licencia antes de incluir muestras en el repo. -->

## Presets bundled en el repo

Estas entradas se sirven desde `public/instruments/` (ver `index.json`) y son el
contenido mínimo que consumen el e2e y el smoke del frente D. **Su situación
legal NO es uniforme** — antes esta sección decía "todas redistribuibles sin
atribución", lo cual era falso y agrupaba bajo esa etiqueta un break cuyos
derechos no están aclarados:

- ✅ **Sweep Pad** (`sweep-pad.json`, 3 zonas melódicas) y **Synth Bass**
  (`synth-bass.json`, 2 zonas) — audio **sintetizado por Loom**
  (`tools/gen-bundled-instruments.mjs`, sin samples de terceros) ⇒ dominio
  público / CC0. WAV mono 22.05 kHz, recortados para web. Estos sí son
  redistribuibles sin atribución, porque los generamos nosotros.
- ⚠️ **Amen Break (loop)** (`amen-175.json`, `family:'loop'`) — **derechos NO
  aclarados.** Es el break de "Amen, Brother" (The Winstons, 1969): ni es de
  dominio público ni está libre de atribución, por muy sampleado que esté desde
  hace décadas. La justificación que figuraba aquí — "copia del fixture ya
  comiteado en `test/fixtures/loops/drum/`" — **no es una licencia**: que un
  archivo ya estuviera en el repo no dice nada sobre el derecho a redistribuirlo.
  Se sirve en el despliegue público y es alcanzable desde el desplegable de
  presets. Pendiente de decisión: retirarlo, sustituirlo por un break propio
  generado, o asumir la exposición conscientemente.
  (`slicePointsSec` FIJADO en el manifiesto para determinismo nota↔slice.)

Aquí tienes el informe completo en Markdown.

---

# Acopio de samples melódicos con licencia usable

**Objetivo:** poblar los presets del Sampler de Loom con multisamples y one-shots melódicos de licencia confirmada (CC0 o CC-BY), aptos para uso comercial y redistribución en un proyecto open-source publicado en GitHub Pages.

**Criterios:** se descartan licencias no comerciales (CC-BY-NC) y todo lo de licencia ambigua. CC0 = ideal (sin atribución). CC-BY = usable con atribución obligatoria en CREDITS.

**Nota sobre formatos:** todas las fuentes ofrecen WAV o un formato (SFZ/SF2) del que se extraen los WAV. Loom carga audio crudo (WAV/AIFF/FLAC → WAV) en una lane Sampler con keymap por nota. Las fuentes en AIFF requieren conversión (permitida por la licencia).

---

## Piano (acústico / de cola)

### ⭐ Salamander Grand Piano V3 — Alexander Holm
- **URL:** https://archive.org/details/SalamanderGrandPianoV3 · espejo SFZ remapeado: https://github.com/sfzinstruments/SalamanderGrandPiano
- **Licencia confirmada:** CC-BY 3.0 (verificada en la ficha del Internet Archive y en el XML de metadatos canónico).
- **Atribución requerida:** **Sí** — "Salamander Grand Piano V3 by Alexander Holm, licensed under CC-BY 3.0".
- **Formato:** SFZ + WAV (también OggVorbis).
- **Tipo:** multisample (Yamaha C5, 16 capas de velocidad, releases/hammer cromáticos).
- **Cómo descargar:** directa desde https://archive.org/download/SalamanderGrandPianoV3. Opciones: 48kHz/24bit (1.3 GB), **44.1kHz/16bit (466 MB)** o **OggVorbis (74 MB)**. Descomprimir el `.tar.bz2`.
- **Idoneidad sampler web:** es el estándar de facto del piano de cola libre y suena excelente. **Para web, usa la versión OggVorbis (74 MB) o la de 44.1/16bit (466 MB)** — la de 1.3 GB es inviable para cargar en navegador. Habrá que diezmar el número de capas de velocidad para un preset ligero.

### ⭐ YDP Grand Piano / Upright Piano KW — FreePats
- **URL:** https://freepats.zenvoid.org/Piano/acoustic-grand-piano.html
- **Licencia confirmada:** YDP Grand Piano = **CC-BY 3.0**; Upright Piano KW (misma página) = **CC0 1.0**; Salamander = CC-BY 3.0.
- **Atribución requerida:** YDP → **Sí**; Upright KW → **No (CC0)**.
  - Texto YDP: "YDP Grand Piano (CC-BY 3.0) — grabaciones del Yamaha Disklavier Pro por Zenph Studios; conversión por FreePats."
- **Formato:** SF2 (también SFZ, FLAC, WAV).
- **Tipo:** multisample cromático con varias capas de velocidad.
- **Cómo descargar:** directa desde la página. YDP Grand: `YDP-GrandPiano-SF2-20160804.tar.bz2` (~36 MiB). **Upright KW:** `UprightPianoKW-SF2-20220221.7z` (~27 MiB, CC0). Salamander SF2: ~296 MiB.
- **Idoneidad sampler web:** muy buena por tamaño contenido (~27-36 MiB). **El Upright KW es la mejor apuesta si prefieres evitar la atribución (CC0)**; el YDP si quieres un grand de cola y no te importa acreditar. SF2 hay que desempaquetar a WAV para Loom.

### VCSL — Versilian Community Sample Library (pianos)
- **URL:** https://github.com/sgossner/VCSL
- **Licencia confirmada:** **CC0 1.0** (README + LICENSE verbatim).
- **Atribución requerida:** **No**.
- **Formato:** WAV (44.1/48kHz, 16/24-bit).
- **Tipo:** multisample minimalista — muestreo por tonos enteros (wholetone), 1 round-robin, 2-3 capas de velocidad.
- **Cómo descargar:** `git clone https://github.com/sgossner/VCSL.git` o "Code → Download ZIP". Pianos en la carpeta `Keyboards/`.
- **Idoneidad sampler web:** muestreo escaso (wholetone) = pocos archivos por instrumento → **muy ligero y cómodo para web**, a costa de fidelidad. CC0 puro. Excelente cuando priorizas tamaño y cero fricción de licencia sobre el realismo de un piano de concierto.

### VSCO 2 Community Edition (orquestal, teclados limitados)
- **URL:** https://versilian-studios.com/vsco-community/ · https://github.com/sgossner/VSCO-2-CE
- **Licencia confirmada:** **CC0 1.0** ("public domain license, no rules, no royalties").
- **Atribución requerida:** No.
- **Formato:** SFZ + WAV (44.1kHz, 16/24-bit).
- **Tipo:** multisample orquestal (~3 GB total). Cobertura de teclado limitada en la base; los pianos completos están en VCSL.
- **Idoneidad sampler web:** ~3 GB en bruto → descarga solo los instrumentos concretos que necesites. Para pianos, **VCSL es mejor elección**; usa VSCO 2 CE para cuerdas/orquesta (ver Strings).

> Honestidad: la mejor calidad de piano (Salamander) viene en paquetes grandes; para web hay que aceptar la versión Ogg/16-bit o reducir capas. Si quieres tamaño mínimo y cero atribución, VCSL o Upright KW son las opciones realistas.

---

## Rhodes / EP (piano eléctrico)

### ⭐ Fender Rhodes Mark II — tim.kahn (Freesound)
- **URL:** https://freesound.org/people/tim.kahn/packs/3957/
- **Licencia confirmada:** **CC-BY 4.0** (verificados 4 sonidos individuales del pack; uniformemente CC-BY).
- **Atribución requerida:** **Sí** — "Fender Rhodes Mark II samples by tim.kahn (Freesound.org), CC-BY 4.0".
- **Formato:** AIFF (`.aif`) — **requiere conversión a WAV** (la licencia no se ve afectada).
- **Tipo:** multisample real del Rhodes propio del autor (notas individuales G1…E5). **Sin keymap/.sfz incluido** — hay que mapear las notas a mano.
- **Cómo descargar:** sonido a sonido desde las páginas del pack (cuenta gratuita de Freesound requerida). IDs verificados: 65762, 65755, 65730, 65728, etc. Alternativa: API de Freesound (token gratuito).
- **Idoneidad sampler web:** **es la fuente de Rhodes real más sólida y libre que hay.** Ficheros individuales = control total del peso del preset; convierte a WAV y mapea las notas que quieras. Imprescindible acreditar a tim.kahn.

### Yamaha TX81Z FM Piano — VCSL
- **URL:** https://github.com/sgossner/VCSL → `Electrophones/TX81Z/`
- **Licencia confirmada:** **CC0 1.0**.
- **Atribución requerida:** No.
- **Formato:** WAV (multisample por nota, 3 capas de velocidad: `FMPiano_C0_vl1.wav`…).
- **Tipo:** e-piano FM digital. **No es un Rhodes de púas/tine real** — es el timbre FM clásico (tipo DX7/TX81Z).
- **Cómo descargar:** ZIP del repo o raw individual, p. ej. `raw.githubusercontent.com/sgossner/VCSL/master/Electrophones/TX81Z/FM%20Piano/FMPiano_C0_vl1.wav`.
- **Idoneidad sampler web:** ligero, CC0, ya está en WAV listo para usar. **Buena opción si quieres un EP FM sin atribución;** no sustituye al timbre tine del Rhodes real de tim.kahn.

> Honestidad: si quieres el sonido Rhodes auténtico, solo tim.kahn lo cubre y exige atribución. Si te basta un EP FM CC0 sin fricción, TX81Z de VCSL es la alternativa.

---

## Bass

### ⭐ Clean Electric Bass (YR — Yamaha RBX) — FreePats
- **URL:** https://freepats.zenvoid.org/ElectricGuitar/clean-electric-bass.html · repo: https://github.com/freepats/electric-bass-YR
- **Licencia confirmada:** **CC0 1.0** ("donated under the terms of the CC0 1.0 public domain dedication").
- **Atribución requerida:** **No** (cortesía: Andrea Biasior).
- **Formato:** SFZ + FLAC / SFZ + WAV / SF2.
- **Tipo:** multisample, dos articulaciones (FingerBassYR y PickedBassYR).
- **Cómo descargar:** GitHub Releases (tag `2019-09-30`), p. ej. `PickedBassYR-SFZ+WAV-20190930.7z`. Descomprimir el `.7z`.
- **Idoneidad sampler web:** bajo eléctrico real, CC0, dos timbres (dedo/púa). Tamaño moderado; usa la variante WAV. **Mejor base de bajo eléctrico libre del lote.**

### ⭐ Synth Bass (Lately Bass / GM39 / GM40) — FreePats
- **URL:** https://freepats.zenvoid.org/Synthesizer/synth-bass.html
- **Licencia confirmada:** **CC0 1.0** (texto literal para los tres bancos).
- **Atribución requerida:** No.
- **Formato:** SFZ + FLAC / SFZ + WAV / SF2.
- **Tipo:** multisample, tres synth bass distintos (estilo DX7) ideales para sub/synth bass.
- **Cómo descargar:** desde la página → releases de GitHub (repos `lately-bass`, `synth-bass-1`, `synth-bass-2`), `.7z`. Usar la variante SFZ+WAV.
- **Idoneidad sampler web:** synth bass tiende a pocos samples y archivos pequeños → **ideal para presets ligeros de sub/bajo electrónico**, encaja perfecto con el carácter de Loom.

### Growlybass / Fashionbass / Pastabass / Swagbass / Black And Blue — Karoryfer (SFZ Instruments)
- **URL índice:** https://sfzinstruments.github.io/basses/
- **Licencia confirmada:** **CC0 1.0** (README + LICENSE de cada repo; "royalty-free for all commercial and non-commercial use").
- **Atribución requerida:** No (cortesía: Karoryfer Samples).
- **Formato:** SFZ + WAV (44.1 kHz).
- **Tipo:** multisample de bajos eléctricos reales.
- **Cómo descargar (ZIP directo de GitHub Releases):**
  - Growlybass (Squier Jazz Bass, ~160 MB): `karoryfer.growlybass/releases/.../Karoryfer.Growlybass.v1.002.zip`
  - Fashionbass (~302 MB): `karoryfer.fashionbass/releases` → **usar v1.001** ("Same as before but CC0"; la v1.000 NO era CC0).
  - Pastabass (Squier Bass VI, ~301 MB): `.../Karoryfer.Pastabass.v1.101.zip`
  - Black And Blue Basses (5 cuerdas, ~961 MB): `.../Black_And_Blue_Basses_1002.zip`
  - Swagbass (~138 MB): `karoryfer.swagbass/releases` → `Karoryfer.Swagbass.v1.001.zip`
- **Idoneidad sampler web:** paquetes grandes (138 MB–961 MB) → **descarga la nota concreta que necesites, no el set entero.** Calidad alta. Precaución de licencia: **Fashionbass solo es CC0 en v1.001+**.

### Bass one-shots CC0 — Freesound (filtro de licencia)
- **URL:** https://freesound.org/search/?f=license:%22Creative+Commons+0%22 (+ "synth bass", "bass one-shot")
- **Licencia confirmada:** **CC0 1.0** (confirmado contra la FAQ de Freesound).
- **Atribución requerida:** No.
- **Formato:** WAV.
- **Tipo:** **one-shots/loops sueltos, NO multisample mapeado**.
- **Cómo descargar:** filtrar por **LICENCIA** "Creative Commons 0" (no por el tag `cc0`, que mezcla CC-BY y CC-NC); verificar por sonido; descargar con cuenta gratuita.
- **Idoneidad sampler web:** útil para un sub/synth bass puntual de un solo golpe. **Verifica la licencia por-sonido** antes de empaquetar.

---

## Pad

### ⭐ Minifreak Pads — SHLD Music (SFZ Instruments)
- **URL:** https://sfzinstruments.github.io/synthesizers/ → fuente original https://drolez.com/blog/music/ableton-free-sound-packs.php#minifreak
- **Licencia confirmada:** **CC0 1.0** (confirmada en el agregador y en la web del creador: "100% royalty-free, licensed under CC0-1.0").
- **Atribución requerida:** No.
- **Formato:** SFZ multisampleado (~265 MB).
- **Tipo:** 5 pads atmosféricos/cinemáticos del Arturia MiniFreak (VerdantMeadows, SereneLake, FrozenTundra, LushValley, HillsFactory).
- **Cómo descargar:** vía el post de Patreon enlazado desde drolez.com ("5 Free Minifreak Sampled Instruments"). No hay enlace directo permanente.
- **Idoneidad sampler web:** **pads cálidos y modernos, justo el carácter "evolving pad" que querrás en Loom.** ~265 MB → selecciona 1-2 paisajes y recorta. Mejor opción de pad sintético real del lote.

### ⭐ Sweep Pad (GM #96) — FreePats
- **URL:** https://freepats.zenvoid.org/Synthesizer/synth-pad.html
- **Licencia confirmada:** **CC0 1.0** (página + README del repo `freepats/sweep-pad`).
- **Atribución requerida:** No.
- **Formato:** SFZ + WAV / SFZ + FLAC / SF2 (**solo ~5.6 MiB**).
- **Tipo:** multisample, pad sintético cálido y evolutivo (ZynAddSubFX/Yoshimi).
- **Cómo descargar:** `sweep-pad/releases/download/2019-08-13/SweepPad-SFZ+WAV-20190813.7z`.
- **Idoneidad sampler web:** **diminuto (~5.6 MiB) y CC0 → la opción más cómoda para web sin pensar en peso.** Encaja exacto con "warm/evolving pad".

### Synth Pad Choir (GM #92) / New Age (GM #89) — FreePats
- **URL:** https://freepats.zenvoid.org/Synthesizer/synth-pad.html
- **Licencia confirmada:** **CC0 1.0** (ambos).
- **Atribución requerida:** No.
- **Formato:** SFZ+FLAC / SFZ+WAV / SF2 (Choir ~6.5-12 MiB; New Age ~4.3-7.4 MiB).
- **Tipo:** multisample. Choir = pad cálido tipo coro; New Age = atmosférico/etéreo.
- **Cómo descargar:** desde la misma página, releases de GitHub `.7z`.
- **Idoneidad sampler web:** ligerísimos y CC0. Buenos complementos del Sweep Pad para variar el color (coro / ambient).

### Wavestate Pads — SHLD Music (SFZ Instruments)
- **URL:** https://sfzinstruments.github.io/synthesizers/ → https://drolez.com/blog/music/ableton-free-sound-packs.php#wavestate
- **Licencia confirmada:** **CC0 1.0** (agregador + web del creador).
- **Atribución requerida:** No.
- **Formato:** SFZ (~160 MB).
- **Tipo:** 3 pads texturales del Korg Wavestate (ElectricRain, MistyMountain, MossyForest), más digitales/granulares.
- **Cómo descargar:** vía colección de Patreon enlazada desde drolez.com (sin enlace directo permanente).
- **Idoneidad sampler web:** segunda opción frente al MiniFreak si quieres timbres más digitales. ~160 MB → selecciona y recorta.

---

## Strings

### ⭐ VSCO 2 Community Edition — Versilian Studios
- **URL:** https://versilian-studios.com/vsco-community/ · https://github.com/sgossner/VSCO-2-CE
- **Licencia confirmada:** **CC0 1.0** (la página declara consistentemente CC0; la declaración previa de CC-BY 4.0 era incorrecta — la fuente es **más** permisiva, no menos).
- **Atribución requerida:** **No** (cortesía recomendada: Versilian Studios).
- **Formato:** SFZ + WAV (44.1 kHz, 16/24-bit). Existen packs reducidos "256" y "50".
- **Tipo:** multisample orquestal — secciones de cuerda y coro con sustains, base ideal para pads cálidos orquestales.
- **Cómo descargar:** directa y gratuita desde la página oficial (versión "Vanilla" SFZ o WAV crudo). La opción de pago (Pulse Downloader, ~2-4 $) es **opcional**.
- **Idoneidad sampler web:** ~1.9 GB completo → **usa los packs reducidos "256"/"50" o descarga solo las secciones de cuerda concretas.** Es la fuente reputada y libre más cercana a cuerdas/pad orquestal cálido. CC0.

### VCSL — secciones graves/orquestales
- **URL:** https://github.com/sgossner/VCSL
- **Licencia confirmada:** **CC0 1.0**.
- **Atribución requerida:** No.
- **Formato:** WAV + SFZ en releases.
- **Tipo:** multisample minimalista; incluye instrumentos orquestales y graves (contrabajo, etc.).
- **Idoneidad sampler web:** muestreo escaso = ligero. Buen complemento CC0 a VSCO 2 cuando necesites cuerdas sueltas sin descargar gigas.

> Honestidad: **no hay en este lote librerías de cuerdas dedicadas tipo "string ensemble" de alta gama libres.** VSCO 2 CE (cámara) es lo mejor disponible y es CC0; para un sonido de sección grande tendrás que capear con sus sustains o construir el pad con capas.

---

## Pluck

> **Honestidad: no hay en estos datos ninguna fuente etiquetada explícitamente como "pluck".** Recomendaciones realistas reutilizando fuentes confirmadas:

- **Karplus interno de Loom** (engine nativo) cubre el pluck sintético sin necesidad de samples — primera recomendación.
- **VCSL** (CC0, https://github.com/sgossner/VCSL): contiene instrumentos de cuerda pulsada/percutida (familia Keyboards/plucked) cuyos one-shots cortos sirven como pluck. CC0, sin atribución.
- **Synth Bass de FreePats** (CC0) con envolvente corta y registro alto puede reusarse como pluck sintético.
- **Freesound, filtro licencia "Creative Commons 0"** + término "pluck": one-shots sueltos CC0 (verificar por-sonido).

No marco ⭐ porque ninguna fuente del dataset es un multisample de pluck dedicado y verificado.

---

## Organ

> **Honestidad: el dataset no incluye ninguna fuente de órgano confirmada** (ni Hammond/tonewheel ni órgano de tubos). No puedo recomendar una fuente verificada aquí.

Pistas fiables fuera del dataset (a verificar antes de usar):
- **FreePats** mantiene bancos de órgano bajo CC0 en https://freepats.zenvoid.org/ — habría que abrir la sección de órgano y confirmar la licencia por banco (FreePats es mayoritariamente CC0).
- **VCSL** (CC0) incluye algún órgano en su familia de teclados.
- **Freesound** con filtro de **licencia** "Creative Commons 0" + "organ" / "hammond".

Marcado como **pendiente de verificación**: no incluir en presets hasta confirmar la licencia en la página real de cada banco.

---

## Lead / Keys

> **Honestidad: no hay en el dataset una fuente de "lead" sintético dedicada y confirmada.** Opciones realistas con lo verificado:

- **Engines nativos de Loom** (Subtractive, FM, Wavetable, TB-303) son la vía natural para leads — no requieren samples.
- **Synth Bass de FreePats** (CC0, GM39/GM40 estilo DX7): transpuesto al registro agudo funciona como lead/key sintético. CC0, sin atribución.
- **Minifreak / Wavestate Pads** (CC0, SHLD): aunque etiquetados "pads", varios paisajes sirven como keys/leads sostenidos con carácter.
- **TX81Z FM Piano de VCSL** (CC0): como "key" FM brillante.
- **Freesound**, filtro **licencia** "Creative Commons 0" + "synth lead": one-shots CC0 sueltos (verificar por-sonido).

No marco ⭐: ninguna entrada del dataset es un multisample de lead dedicado y verificado.

---

## Resumen rápido (las mejores por instrumento)

| Instrumento | ⭐ Recomendación 1 | ⭐ Recomendación 2 | Licencia | Atribución |
|---|---|---|---|---|
| Piano | Salamander Grand V3 (Ogg/16-bit) | Upright KW (FreePats) | CC-BY 3.0 / **CC0** | Sí / No |
| Rhodes/EP | Rhodes Mark II (tim.kahn) | TX81Z FM (VCSL) | CC-BY 4.0 / **CC0** | Sí / No |
| Bass | Clean Electric Bass YR (FreePats) | Synth Bass GM39/40 (FreePats) | **CC0** / **CC0** | No / No |
| Pad | Minifreak Pads (SHLD) | Sweep Pad (FreePats) | **CC0** / **CC0** | No / No |
| Strings | VSCO 2 CE | VCSL | **CC0** / **CC0** | No / No |
| Pluck | *(sin fuente dedicada)* — Karplus nativo / VCSL | — | **CC0** | No |
| Organ | *(sin fuente confirmada — pendiente)* | — | — | — |
| Lead/Keys | *(sin fuente dedicada)* — engines nativos / Synth Bass transpuesto | — | **CC0** | No |

---

## Atribuciones a incluir en el repo (README / CREDITS)

Incluye este bloque en `CREDITS.md` (o sección "Sample credits" del README) **solo si redistribuyes los samples de las fuentes CC-BY**. Las fuentes CC0 NO requieren entrada, pero se listan al final como cortesía.

### Obligatorias (CC-BY — texto exacto)

**Salamander Grand Piano V3** (si se incluye el piano de cola)
> Salamander Grand Piano V3 by Alexander Holm, licensed under CC-BY 3.0 (https://creativecommons.org/licenses/by/3.0/). Source: https://archive.org/details/SalamanderGrandPianoV3

**YDP Grand Piano** (si se incluye este piano en vez del Upright KW)
> YDP Grand Piano (CC-BY 3.0) — grabaciones del Yamaha Disklavier Pro por Zenph Studios; conversión/edición por roberto@zenvoid.org (FreePats). Créditos adicionales: Dr. Mikhail Krishtal y equipo, Dr. Richard Boulanger y el proyecto OLPC. Fuente: https://freepats.zenvoid.org/Piano/acoustic-grand-piano.html — Licencia: https://creativecommons.org/licenses/by/3.0/

**Fender Rhodes Mark II** (Rhodes real)
> Fender Rhodes Mark II samples by tim.kahn (Freesound.org), licensed under CC-BY 4.0 — https://freesound.org/people/tim.kahn/packs/3957/

### Fuentes CC0 — atribución NO requerida

Las siguientes fuentes están bajo **CC0 1.0 (dominio público)** y **no exigen atribución**. Pueden usarse, modificarse y redistribuirse sin crédito. Se reconocen aquí por cortesía y buena práctica (CC0 no permite reclamar autoría ajena, pero no obliga a acreditar):

- Upright Piano KW — FreePats (zenvoid.org)
- VCSL (Versilian Community Sample Library) — Versilian Studios / sgossner (incl. TX81Z FM Piano y pianos/cuerdas/plucks)
- VSCO 2 Community Edition — Versilian Studios
- Clean Electric Bass YR — Andrea Biasior, vía FreePats
- Synth Bass (Lately Bass / GM39 / GM40) — FreePats
- Growlybass, Fashionbass (v1.001+), Pastabass, Swagbass, Black And Blue Basses — Karoryfer Samples / sfzinstruments
- Sweep Pad, Synth Pad Choir, New Age — FreePats
- Minifreak Pads, Wavestate Pads — SHLD Music (Ludo "LD"), vía sfzinstruments / drolez.com
- One-shots descargados de Freesound con licencia "Creative Commons 0"

---

## Notas finales de honestidad y confianza

- **Confianza ALTA** en todas las licencias verificadas arriba (cada una confirmada en página oficial / README / LICENSE / metadatos, no solo en la declaración de partida).
- **Corrección frente a los datos de entrada:** VSCO 2 CE es **CC0**, no CC-BY 4.0 como figuraba en una de las entradas — la fuente es más permisiva.
- **Precauciones operativas:**
  - **Fashionbass:** solo la **v1.001+** es CC0 (la v1.000 inicial no lo era).
  - **Freesound:** filtra por **LICENCIA** "Creative Commons 0", nunca solo por el **tag** `cc0` (el tag mezcla CC-BY y CC-NC; CC-NC es **inusable**). Verifica por-sonido.
  - **Formatos AIFF** (Rhodes de tim.kahn, upright de beskhu) requieren conversión a WAV; la licencia no se ve afectada.
  - **SF2/SFZ** hay que desempaquetar a WAV para cargarlos en una lane Sampler de Loom.
- **Huecos reales del catálogo:** **Organ** no tiene fuente confirmada en estos datos (pendiente de verificar en FreePats/VCSL). **Pluck** y **Lead/Keys** no tienen multisample dedicado verificado — la recomendación honesta es apoyarse en los engines nativos (Karplus, FM, Wavetable, Subtractive) o reutilizar Synth Bass/VCSL transpuestos. **Strings** de sección grande tampoco existe libre de alta gama: VSCO 2 CE (cámara, CC0) es el techo realista.
