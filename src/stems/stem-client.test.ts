import { describe, it, expect, vi } from 'vitest';
import { StemClient, StemServiceUnreachable } from './stem-client';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status, headers: { 'content-type': 'application/json' },
  });
}

describe('StemClient', () => {
  const base = 'http://svc:8765';

  it('health() returns true on ok', async () => {
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse({ ok: true, model: 'htdemucs' }));
    const c = new StemClient(base, fetchFn);
    expect(await c.health()).toEqual({ ok: true, model: 'htdemucs' });
    expect(fetchFn).toHaveBeenCalledWith(`${base}/health`, expect.anything());
  });

  it('health() maps a network error to StemServiceUnreachable', async () => {
    const fetchFn = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'));
    const c = new StemClient(base, fetchFn);
    await expect(c.health()).rejects.toBeInstanceOf(StemServiceUnreachable);
  });

  it('createJob() POSTs multipart and returns the jobId', async () => {
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse({ jobId: 'abc' }, 201));
    const c = new StemClient(base, fetchFn);
    const file = new File([new Uint8Array([1, 2, 3])], 'song.wav', { type: 'audio/wav' });
    expect(await c.createJob(file)).toBe('abc');
    const [url, init] = fetchFn.mock.calls[0];
    expect(url).toBe(`${base}/jobs`);
    expect(init.method).toBe('POST');
    expect(init.body).toBeInstanceOf(FormData);
  });

  it('getJob() returns a parsed running status', async () => {
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse({ status: 'running', progress: null }));
    const c = new StemClient(base, fetchFn);
    expect(await c.getJob('abc')).toEqual({ status: 'running', progress: null });
  });

  it('getJob() returns done with stems', async () => {
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse({
      status: 'done', progress: 1,
      stems: [{ name: 'vocals', url: '/jobs/abc/stems/vocals' }],
    }));
    const c = new StemClient(base, fetchFn);
    const s = await c.getJob('abc');
    expect(s.status).toBe('done');
    expect(s.stems?.[0]).toEqual({ name: 'vocals', url: '/jobs/abc/stems/vocals' });
  });

  it('stemUrl() resolves a relative stem url against the base', () => {
    const c = new StemClient(base, vi.fn());
    expect(c.stemUrl('/jobs/abc/stems/vocals')).toBe(`${base}/jobs/abc/stems/vocals`);
    expect(c.stemUrl('http://other/x')).toBe('http://other/x');
  });

  it('the DEFAULT fetch keeps its global binding (guards "Illegal invocation")', async () => {
    // A real browser's native fetch throws "Illegal invocation" when called with a
    // receiver other than the global object. A bare `fetchFn = fetch` default trips
    // this because StemClient calls `this.fetchFn(...)`. Mimic the native behaviour
    // and prove the default StemClient (no injected fetchFn) survives it.
    const orig = globalThis.fetch;
    const native = function (this: unknown): Promise<Response> {
      if (this !== undefined && this !== globalThis) {
        return Promise.reject(
          new TypeError("Failed to execute 'fetch' on 'Window': Illegal invocation"),
        );
      }
      return Promise.resolve(jsonResponse({ ok: true, model: 'htdemucs' }));
    };
    (globalThis as { fetch: typeof fetch }).fetch = native as unknown as typeof fetch;
    try {
      const c = new StemClient(base); // uses the default fetchFn
      await expect(c.health()).resolves.toEqual({ ok: true, model: 'htdemucs' });
    } finally {
      (globalThis as { fetch: typeof fetch }).fetch = orig;
    }
  });
});
