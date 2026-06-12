import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { importStems, type StemImportDeps } from './stem-import';
import type { StemClient, JobStatus } from './stem-client';

// importStems persists each stem to IndexedDB (fire-and-forget). jsdom has no
// indexedDB, so stub the store singleton to a no-op resolve and keep the run
// hermetic (no noisy unhandled rejections).
vi.mock('../samples/store-singleton', () => ({
  sampleStore: { put: vi.fn().mockResolvedValue(undefined) },
}));

// A buffer with a steady pulse every `beatSec` seconds. detectLoop's onset
// autocorrelation locks onto that period → a known tempo (folded into [70,180]
// and snapped to whole bars over the buffer length).
function pulseBuffer(bpm: number, bars: number, meter = { num: 4, den: 4 }): AudioBuffer {
  const sampleRate = 44100;
  const beatSec = 60 / bpm;
  const beatsPerBar = meter.num;
  const durationSec = beatSec * beatsPerBar * bars;
  const length = Math.floor(durationSec * sampleRate);
  const data = new Float32Array(length);
  const beatLen = Math.floor(beatSec * sampleRate);
  // A short loud transient on each beat → strong onset peaks.
  for (let b = 0; b * beatLen < length; b++) {
    const start = b * beatLen;
    for (let i = 0; i < 200 && start + i < length; i++) data[start + i] = 1;
  }
  return {
    numberOfChannels: 1,
    length,
    duration: durationSec,
    sampleRate,
    getChannelData: () => data,
  } as unknown as AudioBuffer;
}

function fakeClient(stems: { name: string; url: string }[]): StemClient {
  const done: JobStatus = { status: 'done', progress: 1, stems };
  return {
    createJob: vi.fn().mockResolvedValue('job-1'),
    getJob: vi.fn().mockResolvedValue(done),
    cancelJob: vi.fn().mockResolvedValue(undefined),
    stemUrl: (u: string) => `http://svc${u}`,
  } as unknown as StemClient;
}

// importStems fetches each stem url, then decodes `bytes.slice(0)`. We thread the
// stem url through the BYTES themselves (a length-prefixed UTF-8 url) so it
// survives `.slice(0)` and the fake decodeAudioData can return the right buffer.
let urlList: string[] = [];

function encodeUrl(url: string): ArrayBuffer {
  const idx = urlList.indexOf(url);
  const i = idx >= 0 ? idx : (urlList.push(url) - 1);
  const buf = new ArrayBuffer(4);
  new Int32Array(buf)[0] = i;
  return buf;
}
function decodeUrl(bytes: ArrayBuffer): string {
  return urlList[new Int32Array(bytes.slice(0, 4))[0]];
}

function makeDeps(
  stems: { name: string; url: string }[],
  buffers: Record<string, AudioBuffer>,
  extra: Partial<StemImportDeps> = {},
): StemImportDeps {
  return {
    ctx: {
      decodeAudioData: vi.fn(async (bytes: ArrayBuffer) => buffers[decodeUrl(bytes)]),
    } as unknown as AudioContext,
    client: fakeClient(stems),
    addStemLanes: vi.fn(),
    ...extra,
  };
}

beforeEach(() => {
  urlList = [];
  // Global fetch: returns bytes that encode which stem url was requested.
  vi.stubGlobal('fetch', vi.fn(async (url: string) => ({
    ok: true,
    status: 200,
    arrayBuffer: async () => encodeUrl(url),
  } as unknown as Response)));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

// A non-empty buffer of pure silence (length > 0, all zeros). The separated
// drums stem of a drumless track looks like this; its all-zero onset makes
// detectLoop return a bogus ~180 BPM with zero confidence. The energy guard
// must reject it just like a length-0 buffer.
function silentBuffer(bars = 4, bpm = 120, meter = { num: 4, den: 4 }): AudioBuffer {
  const sampleRate = 44100;
  const durationSec = (60 / bpm) * meter.num * bars;
  const length = Math.floor(durationSec * sampleRate);
  const data = new Float32Array(length); // all zeros
  return {
    numberOfChannels: 1,
    length,
    duration: durationSec,
    sampleRate,
    getChannelData: () => data,
  } as unknown as AudioBuffer;
}

describe('importStems → session BPM', () => {
  it('sets the session BPM from the DRUMS stem tempo when replacing the session', async () => {
    const setSessionBpm = vi.fn();
    const stems = [
      { name: 'vocals', url: '/v' },
      { name: 'drums', url: '/d' },
      { name: 'bass', url: '/b' },
    ];
    const buffers = {
      'http://svc/v': pulseBuffer(120, 4), // distractor tempo
      'http://svc/d': pulseBuffer(140, 4), // the drums tempo we expect
      'http://svc/b': pulseBuffer(100, 4),
    };
    const deps = makeDeps(stems, buffers, { setSessionBpm });

    await importStems(deps, new File([], 'song.wav'), { replace: true });

    expect(setSessionBpm).toHaveBeenCalledTimes(1);
    const got = setSessionBpm.mock.calls[0][0] as number;
    expect(got).toBeCloseTo(140, 0);
  });

  it('falls back to the longest stem when there is no drums stem', async () => {
    const setSessionBpm = vi.fn();
    const stems = [
      { name: 'vocals', url: '/v' },
      { name: 'other', url: '/o' },
    ];
    const buffers = {
      'http://svc/v': pulseBuffer(120, 2), // shorter
      'http://svc/o': pulseBuffer(95, 8),  // longest → its tempo wins
    };
    const deps = makeDeps(stems, buffers, { setSessionBpm });

    await importStems(deps, new File([], 'song.wav'), { replace: true });

    expect(setSessionBpm).toHaveBeenCalledTimes(1);
    expect(setSessionBpm.mock.calls[0][0]).toBeCloseTo(95, 0);
  });

  it('does NOT touch the session BPM in ADD mode (replace falsy)', async () => {
    const setSessionBpm = vi.fn();
    const stems = [{ name: 'drums', url: '/d' }];
    const buffers = { 'http://svc/d': pulseBuffer(140, 4) }; // a clear drums tempo
    const deps = makeDeps(stems, buffers, { setSessionBpm });

    // No replace flag → adding lanes to an existing project must keep its tempo.
    await importStems(deps, new File([], 'song.wav'), {});

    expect(setSessionBpm).not.toHaveBeenCalled();
    expect(deps.addStemLanes).toHaveBeenCalledTimes(1);
  });

  it('sets the BPM BEFORE adding the lanes (so buildStemLane reads the new tempo)', async () => {
    const setSessionBpm = vi.fn();
    const stems = [{ name: 'drums', url: '/d' }];
    const buffers = { 'http://svc/d': pulseBuffer(140, 4) };
    const deps = makeDeps(stems, buffers, { setSessionBpm });

    await importStems(deps, new File([], 'song.wav'), { replace: true });

    expect(setSessionBpm).toHaveBeenCalledTimes(1);
    expect(deps.addStemLanes).toHaveBeenCalledTimes(1);
    const setOrder = setSessionBpm.mock.invocationCallOrder[0];
    const addOrder = (deps.addStemLanes as ReturnType<typeof vi.fn>).mock.invocationCallOrder[0];
    expect(setOrder).toBeLessThan(addOrder);
  });

  it('does not set BPM when the dep is absent (back-compat)', async () => {
    const stems = [{ name: 'drums', url: '/d' }];
    const buffers = { 'http://svc/d': pulseBuffer(128, 4) };
    const deps = makeDeps(stems, buffers); // no setSessionBpm
    // Just proves importStems still completes and creates lanes without the dep.
    await importStems(deps, new File([], 'song.wav'), { replace: true });
    expect(deps.addStemLanes).toHaveBeenCalledTimes(1);
  });

  it('leaves BPM unchanged for an empty / silent (length 0) buffer', async () => {
    const setSessionBpm = vi.fn();
    const sampleRate = 44100;
    const silent = {
      numberOfChannels: 1, length: 0, duration: 0, sampleRate,
      getChannelData: () => new Float32Array(0),
    } as unknown as AudioBuffer;
    const stems = [{ name: 'drums', url: '/d' }];
    const buffers = { 'http://svc/d': silent };
    const deps = makeDeps(stems, buffers, { setSessionBpm });

    await importStems(deps, new File([], 'song.wav'), { replace: true });

    expect(setSessionBpm).not.toHaveBeenCalled();
  });

  it('leaves BPM unchanged for a NON-empty but silent drums buffer (energy guard)', async () => {
    const setSessionBpm = vi.fn();
    // length > 0 and duration > 0, but every sample is zero — a drumless track's
    // separated drums stem. Must be rejected so a bogus ~180 BPM can't win.
    const stems = [{ name: 'drums', url: '/d' }];
    const buffers = { 'http://svc/d': silentBuffer(4) };
    const deps = makeDeps(stems, buffers, { setSessionBpm });

    await importStems(deps, new File([], 'song.wav'), { replace: true });

    expect(setSessionBpm).not.toHaveBeenCalled();
  });

  it('falls back to an energetic non-drums stem when the drums stem is silent', async () => {
    const setSessionBpm = vi.fn();
    const stems = [
      { name: 'drums', url: '/d' },
      { name: 'other', url: '/o' },
    ];
    const buffers = {
      'http://svc/d': silentBuffer(4),     // silent → skipped
      'http://svc/o': pulseBuffer(100, 8), // audible → its tempo wins
    };
    const deps = makeDeps(stems, buffers, { setSessionBpm });

    await importStems(deps, new File([], 'song.wav'), { replace: true });

    expect(setSessionBpm).toHaveBeenCalledTimes(1);
    expect(setSessionBpm.mock.calls[0][0]).toBeCloseTo(100, 0);
  });
});
