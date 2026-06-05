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

/** Anchor id for a chapter file (README → "top"). */
export function chapterId(file) {
  return file === 'README.md' ? 'top' : file.replace(/\.md$/, '');
}

// Inter-chapter links like "02-transport.md" / "02-transport.md#x" / "README.md".
const MD_LINK = /href="(?:\.\/)?([^"#]+?)\.md(?:#[^"]*)?"/gi;

/** Rewrite inter-chapter `*.md` links to in-page anchors (single-page manual). */
export function rewriteChapterLinks(html) {
  return html.replace(MD_LINK, (_m, name) => `href="#${name === 'README' ? 'top' : name}"`);
}

/**
 * Read every chapter, convert to HTML, rewrite cross-links to in-page anchors,
 * wrap each in an id'd <section>, and wrap the whole thing with CSS.
 * `webImages: false` (PDF) rewrites images to file:// URLs; `true` (web) keeps
 * them relative so they resolve next to the served index.html.
 */
export function assembleHtml(manualDir, cssText, { webImages = false } = {}) {
  const sections = CHAPTERS.map((file) => {
    const md = readFileSync(join(manualDir, file), 'utf8');
    let html = marked.parse(md);
    if (!webImages) html = rewriteHtmlImageSrcs(html, manualDir);
    html = rewriteChapterLinks(html);
    return `<section class="chapter" id="${chapterId(file)}">${html}</section>`;
  });
  return `<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Loom — Manual</title>
<style>${cssText}</style></head><body>${sections.join('\n')}</body></html>`;
}
