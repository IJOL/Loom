// src/export/export-scene.test.ts
import { describe, it, expect, vi } from 'vitest';
import { exportCurrentScene, type SceneExporter } from './export-scene';

function fakeExporter(over: Partial<SceneExporter> = {}): SceneExporter {
  return {
    totalSec: () => 4,
    record: vi.fn(async () => ({ channels: [Float32Array.of(0, 0)], sampleRate: 48000 })),
    encode: vi.fn(() => new Blob([new Uint8Array([1, 2, 3])], { type: 'audio/wav' })),
    download: vi.fn(),
    notify: vi.fn(),
    setBusy: vi.fn(),
    finish: vi.fn(),
    ...over,
  };
}

describe('exportCurrentScene', () => {
  it('notifies and does nothing when no scene is playing', async () => {
    const x = fakeExporter({ totalSec: () => 0 });
    await exportCurrentScene(x);
    expect(x.notify).toHaveBeenCalledWith('Lanzá una escena primero');
    expect(x.record).not.toHaveBeenCalled();
    expect(x.setBusy).not.toHaveBeenCalled();
  });

  it('records, encodes, downloads, then finishes on the happy path', async () => {
    const x = fakeExporter();
    await exportCurrentScene(x);
    expect(x.setBusy).toHaveBeenNthCalledWith(1, true);
    expect(x.record).toHaveBeenCalledWith(4);
    expect(x.encode).toHaveBeenCalledTimes(1);
    expect(x.download).toHaveBeenCalledTimes(1);
    expect(x.finish).toHaveBeenCalledTimes(1);
    expect(x.setBusy).toHaveBeenLastCalledWith(false);
  });

  it('reports errors and still finishes + clears busy', async () => {
    const x = fakeExporter({ record: vi.fn(async () => { throw new Error('boom'); }) });
    await exportCurrentScene(x);
    expect(x.notify).toHaveBeenCalledWith('No se pudo exportar: boom');
    expect(x.download).not.toHaveBeenCalled();
    expect(x.finish).toHaveBeenCalledTimes(1);
    expect(x.setBusy).toHaveBeenLastCalledWith(false);
  });

  it('reports errors when encoding fails and skips download', async () => {
    const x = fakeExporter({ encode: vi.fn(() => { throw new Error('bad wav'); }) });
    await exportCurrentScene(x);
    expect(x.notify).toHaveBeenCalledWith('No se pudo exportar: bad wav');
    expect(x.download).not.toHaveBeenCalled();
    expect(x.finish).toHaveBeenCalledTimes(1);
    expect(x.setBusy).toHaveBeenLastCalledWith(false);
  });
});
