// src/export/export-scene.ts
// Orchestrates one scene export. Backend-agnostic: it asks for the total
// duration, records it, encodes, downloads, and finishes (stop transport).
// All side-effecting steps are injected so this is unit-testable.

import type { RenderedAudio } from './types';

export interface SceneExporter {
  /** Total seconds to record (music + tail). 0 ⇒ nothing is playing. */
  totalSec(): number;
  record(totalSec: number): Promise<RenderedAudio>;
  encode(channels: Float32Array[], sampleRate: number): Blob;
  download(blob: Blob): void;
  notify(message: string): void;
  setBusy(busy: boolean): void;
  /** Stop the transport + reset the play button. Always runs after a run. */
  finish(): void;
}

export async function exportCurrentScene(x: SceneExporter): Promise<void> {
  const total = x.totalSec();
  if (total <= 0) {
    x.notify('Lanzá una escena primero');
    return;
  }
  x.setBusy(true);
  try {
    const rendered = await x.record(total);
    const blob = x.encode(rendered.channels, rendered.sampleRate);
    x.download(blob);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    x.notify('No se pudo exportar: ' + msg);
  } finally {
    x.finish();
    x.setBusy(false);
  }
}
