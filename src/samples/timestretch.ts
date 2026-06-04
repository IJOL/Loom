// Time-domain overlap-add (OLA) time-stretch — preserves pitch, changes length.
// 50%-overlap Hann window (constant-overlap-add: overlapping windows sum to 1,
// so no post-normalization). ratio > 1 = longer/slower. Runs offline; the
// result is an AudioBuffer the caller caches. (A WSOLA similarity search can be
// layered on later to reduce phase artifacts; OLA already preserves pitch.)

const WIN_SEC = 0.046;

function hann(n: number): Float32Array {
  const w = new Float32Array(n);
  for (let i = 0; i < n; i++) w[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (n - 1));
  return w;
}

export function stretchBuffer(ctx: BaseAudioContext, buffer: AudioBuffer, ratio: number): AudioBuffer {
  const sr = buffer.sampleRate;
  const win = Math.max(8, Math.round(WIN_SEC * sr));
  const synHop = Math.floor(win / 2);          // 50% overlap on output
  const anaHop = synHop / ratio;               // analysis advances slower/faster
  const w = hann(win);
  const outLen = Math.max(1, Math.round(buffer.length * ratio));
  const out = ctx.createBuffer(buffer.numberOfChannels, outLen, sr);

  for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
    const inp = buffer.getChannelData(ch);
    const o = out.getChannelData(ch);
    let synPos = 0;
    let anaPos = 0;
    while (synPos < outLen) {
      const start = Math.round(anaPos);
      for (let i = 0; i < win; i++) {
        const si = start + i;
        const di = synPos + i;
        if (si >= 0 && si < inp.length && di < outLen) o[di] += inp[si] * w[i];
      }
      synPos += synHop;
      anaPos += anaHop;
    }
  }
  return out;
}
