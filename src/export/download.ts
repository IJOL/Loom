// src/export/download.ts
// Triggers a browser download of a Blob and builds export filenames.

/** Filesystem-safe UTC timestamp, e.g. "2026-06-04T12-30-00". */
export function exportTimestamp(): string {
  return new Date().toISOString().replace(/[:.]/g, '-').replace(/Z$/, '').slice(0, 19);
}

/** Anchor-click download of `blob` as `filename`. Revokes the object URL after. */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Revoke after a delay so the download has started — long scenes produce
  // large WAVs the browser may take a moment to begin fetching.
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}
