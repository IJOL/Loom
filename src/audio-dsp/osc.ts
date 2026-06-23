// Per-sample oscillators for the worklet voice renderer. polyBlep band-limiting
// for saw/square (adapted from strudel dough.mjs). Pure: sampleRate is injected.

function polyBlep(t: number, dt: number): number {
  if (t < dt) { t /= dt; return t + t - t * t - 1; }
  if (t > 1 - dt) { t = (t - 1) / dt; return t * t + t + t + 1; }
  return 0;
}

export class SawOsc {
  private phase = 0;
  constructor(private sr: number) {}
  update(freq: number): number {
    const dt = freq / this.sr;
    const p = polyBlep(this.phase, dt);
    const s = 2 * this.phase - 1 - p;
    this.phase += dt;
    if (this.phase > 1) this.phase -= 1;
    return s;
  }
}

export class SquareOsc {
  private phase = 0;
  constructor(private sr: number) {}
  private saw(offset: number, dt: number): number {
    const phase = (this.phase + offset) % 1;
    return 2 * phase - 1 - polyBlep(phase, dt);
  }
  update(freq: number, pw = 0.5): number {
    const dt = freq / this.sr;
    const pulse = this.saw(0, dt) - this.saw(pw, dt);
    this.phase = (this.phase + dt) % 1;
    return pulse + pw * 2 - 1;
  }
}

export class TriOsc {
  private phase = 0;
  constructor(private sr: number) {}
  update(freq: number): number {
    this.phase += freq / this.sr;
    const p = this.phase % 1;
    const v = p < 0.5 ? 2 * p : 1 - 2 * (p - 0.5);
    return v * 2 - 1;
  }
}

export class SineOsc {
  private phase = 0;
  constructor(private sr: number) {}
  update(freq: number): number {
    const v = Math.sin(this.phase * 2 * Math.PI);
    this.phase = (this.phase + freq / this.sr) % 1;
    return v;
  }
}

export class WhiteNoise {
  update(): number { return Math.random() * 2 - 1; }
}
