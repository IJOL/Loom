import { describe, it, expect } from 'vitest';
import { moduleBlobUrl } from './module-loader';

const okResponse = (body: string): Response =>
  ({ ok: true, status: 200, text: async () => body }) as unknown as Response;

describe('moduleBlobUrl', () => {
  it('fetches the module source from the url it was given', async () => {
    const seen: string[] = [];
    const fetchImpl = (async (u: string) => { seen.push(String(u)); return okResponse('export const x = 1;'); }) as unknown as typeof fetch;
    await moduleBlobUrl('/plugins/probe/main.js', fetchImpl);
    expect(seen).toEqual(['/plugins/probe/main.js']);
  });

  it('hands back a blob: URL rather than the original one', async () => {
    const fetchImpl = (async () => okResponse('export const x = 1;')) as unknown as typeof fetch;
    const url = await moduleBlobUrl('/plugins/probe/main.js', fetchImpl);
    // The whole point: what gets imported must NOT be the public/ path, or the
    // dev server's transform middleware rejects it.
    expect(url.startsWith('blob:')).toBe(true);
    expect(url).not.toContain('/plugins/probe/main.js');
  });

  it('throws with the status when the module is not served', async () => {
    const fetchImpl = (async () => ({ ok: false, status: 404, text: async () => '' }) as unknown as Response) as unknown as typeof fetch;
    await expect(moduleBlobUrl('/plugins/missing/main.js', fetchImpl))
      .rejects.toThrow(/404/);
  });
});
