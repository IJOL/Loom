type State = 'off' | 'attack' | 'decay' | 'sustain' | 'release';

function lerp(x: number, y0: number, y1: number, exponent = 1): number {
  if (x <= 0) return y0;
  if (x >= 1) return y1;
  const cx = exponent === 0 ? x : exponent > 0 ? Math.pow(x, exponent) : 1 - Math.pow(1 - x, -exponent);
  return y0 + (y1 - y0) * cx;
}

export class Adsr {
  private state: State = 'off';
  private startTime = 0;
  private startVal = 0;
  private decayCurve = 2;
  get isOff(): boolean { return this.state === 'off'; }

  update(t: number, gate: number, attack: number, decay: number, sustain: number, release: number): number {
    switch (this.state) {
      case 'off':
        if (gate > 0) { this.state = 'attack'; this.startTime = t; this.startVal = 0; }
        return 0;
      case 'attack': {
        const dt = t - this.startTime;
        if (dt > attack) { this.state = 'decay'; this.startTime = t; return 1; }
        return lerp(dt / attack, this.startVal, 1, 1);
      }
      case 'decay': {
        const dt = t - this.startTime;
        const cur = lerp(dt / decay, 1, sustain, -this.decayCurve);
        if (gate <= 0) { this.state = 'release'; this.startTime = t; this.startVal = cur; return cur; }
        if (dt > decay) { this.state = 'sustain'; this.startTime = t; return sustain; }
        return cur;
      }
      case 'sustain':
        if (gate <= 0) { this.state = 'release'; this.startTime = t; this.startVal = sustain; }
        return sustain;
      case 'release': {
        const dt = t - this.startTime;
        if (dt > release) { this.state = 'off'; return 0; }
        const cur = lerp(dt / release, this.startVal, 0, -this.decayCurve);
        if (gate > 0) { this.state = 'attack'; this.startTime = t; this.startVal = cur; }
        return cur;
      }
    }
  }
}
