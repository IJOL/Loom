// src/export/download.ts
// Triggers a browser download of a Blob and builds export filenames.

import { html } from 'lit-html';
import { renderElement } from '../core/lit-fragment';

/** Filesystem-safe UTC timestamp, e.g. "2026-06-04T12-30-00". */
export function exportTimestamp(): string {
  return new Date().toISOString().replace(/[:.]/g, '-').replace(/Z$/, '').slice(0, 19);
}

/** Anchor-click download of `blob` as `filename`. Revokes the object URL after. */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  // Transient anchor: instantiated once, detached. It must sit in the document
  // when clicked or the download won't start.
  const a = renderElement<HTMLAnchorElement>(html`<a href=${url} download=${filename} rel="noopener"></a>`);
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Revoke after a delay so the download has started — long scenes produce
  // large WAVs the browser may take a moment to begin fetching.
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}
