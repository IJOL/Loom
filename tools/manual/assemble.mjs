import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { marked } from 'marked';

// Chapters, in the fixed reading / PDF order.
export const CHAPTERS = [
  'README.md',
  '01-getting-started.md',
  '02-transport.md',
  '03-sessions-lanes-clips-scenes.md',
  '04-engines.md',
  '05-editing-clips.md',
  '06-modulation-and-note-fx.md',
  '07-mixing-and-fx.md',
  '08-midi-and-samples.md',
  '09-saving-and-export.md',
  '10-performance-and-arrangement.md',
  '11-developer-guide.md',
];

const ABSOLUTE = /^(?:[a-z]+:)?\/\//i; // http://, https://, //, file:// (file: handled below)

/** Relative `images/x.png` -> absolute `file://…/docs/manual/images/x.png`. */
export function resolveImageSrc(src, manualDir) {
  if (ABSOLUTE.test(src) || src.startsWith('file:')) return src;
  return pathToFileURL(join(manualDir, src)).href;
}

/** Rewrite every relative <img src> in an HTML string to a file:// URL. */
export function rewriteHtmlImageSrcs(html, manualDir) {
  return html.replace(
    /(<img\b[^>]*?\bsrc=")([^"]+)(")/gi,
    (_m, pre, src, post) => pre + resolveImageSrc(src, manualDir) + post,
  );
}

/** Read every chapter, convert to HTML, rewrite images, wrap with CSS. */
export function assembleHtml(manualDir, cssText) {
  const sections = CHAPTERS.map((file) => {
    const md = readFileSync(join(manualDir, file), 'utf8');
    const html = rewriteHtmlImageSrcs(marked.parse(md), manualDir);
    return `<section class="chapter">${html}</section>`;
  });
  return `<!doctype html><html><head><meta charset="utf-8">
<style>${cssText}</style></head><body>${sections.join('\n')}</body></html>`;
}
