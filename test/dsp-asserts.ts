// test/dsp-asserts.ts
// DSP statistics + assertion helpers for audio test buffers.
// All assertions are relative (factors, ordering) — never absolute thresholds.

export function rms(buf: Float32Array): number {
  let sum = 0;
  for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
  return Math.sqrt(sum / buf.length);
}

export function peak(buf: Float32Array): number {
  let p = 0;
  for (let i = 0; i < buf.length; i++) {
    const a = Math.abs(buf[i]);
    if (a > p) p = a;
  }
  return p;
}

export function isSilent(buf: Float32Array, threshold = 1e-4): boolean {
  return peak(buf) < threshold;
}

/**
 * Spectral centroid of a buffer slice, computed over a single Hann-windowed
 * frame at the buffer's centre. Returns Hz. Frame size auto-grown to the
 * next power of two ≤ buffer length, capped at 8192 samples.
 */
export function spectralCentroid(buf: Float32Array, sampleRate: number): number {
  let frameSize = 1;
  while (frameSize * 2 <= Math.min(buf.length, 8192)) frameSize *= 2;
  if (frameSize < 64) return 0;

  const start = Math.max(0, Math.floor((buf.length - frameSize) / 2));
  const re = new Float32Array(frameSize);
  const im = new Float32Array(frameSize);
  for (let i = 0; i < frameSize; i++) {
    const w = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / (frameSize - 1));
    re[i] = buf[start + i] * w;
  }

  fftRadix2(re, im);

  let weighted = 0;
  let total = 0;
  for (let k = 1; k < frameSize / 2; k++) {
    const mag = Math.hypot(re[k], im[k]);
    const freq = k * sampleRate / frameSize;
    weighted += mag * freq;
    total += mag;
  }
  return total > 0 ? weighted / total : 0;
}

/**
 * Zero-crossing rate per window, returned as estimated fundamental frequency
 * (Hz) per window. `hopMs` controls window stride and width.
 */
export function freqContour(buf: Float32Array, sampleRate: number, hopMs: number): number[] {
  const hop = Math.max(64, Math.round(sampleRate * hopMs / 1000));
  const out: number[] = [];
  for (let start = 0; start + hop <= buf.length; start += hop) {
    let crossings = 0;
    for (let i = start + 1; i < start + hop; i++) {
      if ((buf[i - 1] >= 0 && buf[i] < 0) || (buf[i - 1] < 0 && buf[i] >= 0)) crossings++;
    }
    const periodSec = hop / sampleRate;
    out.push(crossings / 2 / periodSec);
  }
  return out;
}

export function expectRising(values: number[], tolerance = 0.0): void {
  for (let i = 1; i < values.length; i++) {
    if (values[i] < values[i - 1] - tolerance) {
      throw new Error(
        `expectRising: values[${i}]=${values[i]} < values[${i - 1}]=${values[i - 1]} ` +
        `(tolerance ${tolerance}); full series: ${values.join(', ')}`,
      );
    }
  }
}

export function expectFalling(values: number[], tolerance = 0.0): void {
  for (let i = 1; i < values.length; i++) {
    if (values[i] > values[i - 1] + tolerance) {
      throw new Error(
        `expectFalling: values[${i}]=${values[i]} > values[${i - 1}]=${values[i - 1]} ` +
        `(tolerance ${tolerance}); full series: ${values.join(', ')}`,
      );
    }
  }
}

// In-place radix-2 FFT. n must be a power of two.
function fftRadix2(re: Float32Array, im: Float32Array): void {
  const n = re.length;
  // Bit reversal.
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = -2 * Math.PI / len;
    const wRe = Math.cos(ang), wIm = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let curRe = 1, curIm = 0;
      for (let k = 0; k < len / 2; k++) {
        const uRe = re[i + k], uIm = im[i + k];
        const vRe = re[i + k + len / 2] * curRe - im[i + k + len / 2] * curIm;
        const vIm = re[i + k + len / 2] * curIm + im[i + k + len / 2] * curRe;
        re[i + k]           = uRe + vRe;
        im[i + k]           = uIm + vIm;
        re[i + k + len / 2] = uRe - vRe;
        im[i + k + len / 2] = uIm - vIm;
        const nRe = curRe * wRe - curIm * wIm;
        const nIm = curRe * wIm + curIm * wRe;
        curRe = nRe; curIm = nIm;
      }
    }
  }
}
