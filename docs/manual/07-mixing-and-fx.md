# Mixing & FX

Every lane in Loom has its own signal path from the synthesis engine through to the master output. This chapter explains how that path is structured, what controls are available per lane, and how the shared Master FX panel ties everything together.

---

## Signal flow overview

```
Lane engine → lane insert chain → channel strip (EQ → comp → level → pan → mute → duck) → master bus
                                                                               └──→ reverb send ─┐
                                                                               └──→ delay send  ─┤
master bus → master insert chain → master compressor → output                   FxBus returns ──┘
```

In short: the engine's audio passes through any per-lane inserts first, then the channel strip where EQ, sends, pan, and level are applied. The processed signal joins the master bus, which runs through the master insert chain and the master compressor before reaching the speaker.

---

## Per-lane channel strip

Each lane owns a `ChannelStrip`. Its controls are visible below the session grid in the lane's row.

![Loom session view — channel strips appear below the clip grid, one row per lane](images/session-view.png)

### Level (fader)

The vertical slider sets the lane's output gain as a linear multiplier (0–1 = silence to unity; the percentage label reflects the current value). This is the last gain stage before output, applied after EQ and the per-lane compressor.

### Pan

The **PAN** knob positions the lane in the stereo field. Centre (0) is the default; turning it left or right continuously shifts the image. The pan value is automatable and can be modulated — see [Modulation & Note FX](06-modulation-and-note-fx.md).

### Mute and Solo

**M** silences the lane by zeroing its mute gain node. **S** solos the lane: all other lanes are muted in the UI while solo is active. Both controls affect what the sidechain tap feeds downstream — a muted lane's tap still carries pre-mute signal so sidechain routing remains stable.

### 3-band EQ

The three EQ knobs apply before the per-lane compressor:

| Knob | Filter type | Centre frequency | Notes |
|------|------------|-----------------|-------|
| **LO** | Low-shelf | 200 Hz | Boost or cut lows; default ±0 dB |
| **MID** | Peaking | 1 000 Hz | Q = 1; adds presence or scoops the midrange |
| **HI** | High-shelf | 4 500 Hz | Boost or cut highs and air |

All three bands are ±dB adjustments. EQ gain AudioParams are exposed to modulation so you can automate filter sweeps from the modulation panel.

### REV and DLY sends

The **REV** and **DLY** knobs control how much of this lane's post-duck signal is fed into the shared master reverb and delay returns. They are independent wet levels: 0 = dry only, higher values mix the lane into the reverb or delay tail. The shared reverb and delay processors live in the Master FX panel; per-lane send amounts just determine how much goes in.

---

## Per-lane inserts

Every lane also has a private insert chain that sits *before* the channel strip — the engine's audio passes through it first. If you open the lane's inspector and add FX to its insert list, those effects process the lane signal exclusively and do not affect any other lane.

**Inserts vs sends:** an insert is a serial in-line processor (distortion, filter, etc.) that replaces the signal passing through it; a send is a parallel path that adds wet signal from a shared return (reverb, delay). Use inserts when you want a destructive or tone-shaping effect on a single lane; use sends when you want a common acoustic space that multiple lanes share.

The insert types available per lane are the same four plugins used on the master chain — see [Master FX panel](#master-fx-panel) below for their parameter details.

---

## Master FX panel

The master bus has its own strip at the foot of the **scenes column** of the mixer row — a **MASTER** label, an **FX** button, a fader that mirrors the master **Volume**, and a VU meter. Click its **FX** button to open the **Master FX panel** below the grid (click again to close it). *(Previously this was a separate "Master FX" tab; the controls are identical, only the way you open them changed.)*

![Loom Master FX panel — SENDS, MASTER COMP, and INSERTS sections](images/master-fx.png)

### SENDS — Reverb and Delay

The SENDS section holds the global return effects. Lane REV/DLY knobs feed into these processors; the knobs here control the shared effect itself.

**REVERB** parameters:

| Param | Range | Description |
|-------|-------|-------------|
| Wet | 0–1.5 | Wet output level |
| PreD | 0–0.5 s | Pre-delay before the reverb tail starts |
| Size | 0.05–8 s | Impulse response length (room size) |
| Decay | 0.1–10 | Tail decay shape (higher = longer tail) |

The reverb is a convolution reverb with a procedurally generated impulse response. Size and Decay rebuild the impulse in real time when adjusted.

**DELAY** parameters:

| Param | Range | Description |
|-------|-------|-------------|
| Time | 0.01–2 s | Delay time (BPM-synced at session start: 3/8 beat × BPM) |
| Fbk | 0–0.95 | Feedback amount |
| Wet | 0–1.5 | Wet output level |
| Damp | 200–12 000 Hz | Low-pass filter on the feedback loop; lower values darken repeats |

### MASTER COMP

The master compressor sits at the tail of the master chain, after all inserts. It uses the same `CompBlock` as the per-lane strip compressor, so the parameters are identical:

| Param | Range | Default | Description |
|-------|-------|---------|-------------|
| Bypass | on/off | on | Pass-through when on |
| Threshold | −100 to 0 dB | −24 dB | Level above which compression starts |
| Ratio | 1–20 | 4 | Compression ratio |
| Attack | 0–1 s | 0.003 s | Gain reduction onset time |
| Release | 0–1 s | 0.25 s | Gain recovery time |
| Knee | 0–40 dB | 30 dB | Transition softness around the threshold |
| Makeup | ~0–4 (linear) | 1 | Post-compression gain, up to about +12 dB |

The master compressor is bypassed by default. Enable it for glue and loudness control on the final mix, or to tame transient peaks before export. See [Saving & Export](09-saving-and-export.md) for how the master bus feeds the offline render.

### INSERTS → Master Filters

Below MASTER COMP, the INSERTS section holds the master insert chain. Click **+ Add Filter** to append a slot. Each slot can hold one of four plugin types, selectable in the slot's Type control:

**Filter (multifilter)**
- Type: LP / HP / BP / Notch
- Freq: 20–20 000 Hz (exponential)
- Q: 0.1–24

**Distortion (Dist)**
- Drive: 0–1 — waveshaper saturation amount (4x oversampled)
- Mix: 0–1 — dry/wet blend

**Reverb** — same parameters as the send reverb above (Wet, PreD, Size, Decay). Use as an insert to apply reverb to the full master rather than via sends.

**Delay** — same parameters as the send delay (Time, Fbk, Wet, Damp). Use as an insert for a master-bus slapback or stutter.

Slots in the chain are ordered in series: the output of each slot feeds the input of the next. Each slot has a bypass toggle so you can A/B it without removing it. Individual slots can be removed; adding the same type multiple times is allowed.

The master insert chain is distinct from the FxBus send effects — insert slots process the full mixed signal, while the send reverb and delay receive per-lane amounts and return to the master bus independently.

---

## Sidechain compression

Loom includes a sidechain ducking system. Any lane's channel strip can be ducked by the signal level of another lane (the *source*). The ducker follows the source lane's envelope via a full-wave rectifier and two smoothing filters, then reduces the target lane's gain proportionally:

```
duckGain ≈ 1 − depth × env(source)
```

Sidechain parameters (set per lane in the lane inspector):

| Param | Range | Default | Description |
|-------|-------|---------|-------------|
| Source | lane selector | — | Which lane's post-mute tap drives the duck |
| Depth | 0–1 | 0.6 | How deep the gain dips at full envelope |
| Attack | s | 0.005 s | How quickly the ducker opens (gain rises) |
| Release | s | 0.25 s | How quickly the ducker closes (gain falls) |
| Threshold | dB | −40 dB | Source envelope must exceed this to duck at all |

A typical use case is kick-drum ducking: set a bass or pad lane's sidechain source to the kick lane. Every kick hit momentarily ducks the bass, creating a pumping effect common in electronic music. Because the tap is taken from the source lane post-mute (but pre-duck), muting the source stops the ducking without feedback loops.

The sidechain bus is separate from the compressor block available on each channel strip. The per-lane compressor (`CompBlock`) is a standard dynamics compressor in the signal path; the sidechain ducker is a parallel envelope-follower that modulates gain. Both can be active simultaneously.

---

For engine-level sound design that feeds the channel strips, see [Engines](04-engines.md). For LFO and ADSR modulation of EQ, sends, pan, and other AudioParams, see [Modulation & Note FX](06-modulation-and-note-fx.md).
