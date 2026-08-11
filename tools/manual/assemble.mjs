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
  '11-weave.md',
  '12-developer-guide.md',
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

/**
 * Slug for a heading, from its inner HTML, matching how GitHub anchors a
 * heading — so the same `#section` link works both in the .md on GitHub and in
 * the single-page build. Inline tags and entities are dropped along with the
 * character they stood for; every remaining space becomes a hyphen, so
 * "SENDS — Send A and Send B" yields "sends--send-a-and-send-b".
 */
export function slugifyHeading(inner) {
  return inner
    .replace(/<[^>]+>/g, '')
    .replace(/&(?:[a-z]+|#\d+);/gi, '')
    .toLowerCase()
    .trim()
    .replace(/[^\p{L}\p{N}\p{M}\-_ ]/gu, '')
    .replace(/ /g, '-');
}

/**
 * Give every heading an id, namespaced by chapter. marked emits bare `<h2>`,
 * so without this pass every `#section` cross-reference in the assembled page
 * is a dead link. The chapter prefix keeps two chapters that share a heading
 * ("Sampler" is both an engine and an import path) from colliding; a repeat
 * inside one chapter gets the "-1", "-2" suffix GitHub would give it.
 */
export function addHeadingIds(html, prefix) {
  const seen = new Map();
  return html.replace(/<h([1-6])>([\s\S]*?)<\/h\1>/g, (_m, level, inner) => {
    const base = slugifyHeading(inner);
    const n = seen.get(base) ?? 0;
    seen.set(base, n + 1);
    const slug = n === 0 ? base : `${base}-${n}`;
    return `<h${level} id="${prefix}--${slug}">${inner}</h${level}>`;
  });
}

/**
 * Point a chapter's own `#section` links at that chapter's namespaced heading
 * ids. Runs before the `*.md` rewrite below, so the only `href="#…"` values it
 * can see are the ones the author wrote.
 */
export function rewriteLocalAnchors(html, prefix) {
  return html.replace(/href="#([^"]+)"/g, (_m, hash) => `href="#${prefix}--${hash}"`);
}

// Inter-chapter links like "02-transport.md" / "02-transport.md#x" / "README.md".
const MD_LINK = /href="(?:\.\/)?([^"#]+?)\.md(#[^"]*)?"/gi;

/**
 * Rewrite inter-chapter `*.md` links to in-page anchors (single-page manual).
 * Only the files in CHAPTERS are rewritten: a link out of the manual, such as
 * `../../tools/stem-service/README.md`, is left as it stands rather than being
 * turned into the dead anchor `#../../tools/stem-service/README`.
 */
export function rewriteChapterLinks(html) {
  return html.replace(MD_LINK, (m, name, hash) => {
    const file = `${name.replace(/^\.\//, '')}.md`;
    if (!CHAPTERS.includes(file)) return m;
    const id = chapterId(file);
    return `href="#${hash ? `${id}--${hash.slice(1)}` : id}"`;
  });
}

// Where a link out of the manual points once the manual is read somewhere else
// than the repo. `git remote`: https://github.com/IJOL/Loom.git.
const REPO_BLOB = 'https://github.com/IJOL/Loom/blob/main/';

/**
 * Turn a link out of the manual into an absolute one. A chapter reaches the
 * source it cites with `../../src/app/lane-allocator.ts`, which is right when
 * the .md is read in the repo or on GitHub, and a 404 from the single-page
 * build served at /Loom/manual/. The .md keeps the relative form; only the
 * assembled page gets the absolute one.
 */
export function rewriteRepoLinks(html) {
  return html.replace(/href="\.\.\/\.\.\/([^"]+)"/g, (_m, path) => `href="${REPO_BLOB}${path}"`);
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
    const id = chapterId(file);
    let html = marked.parse(md);
    if (!webImages) html = rewriteHtmlImageSrcs(html, manualDir);
    html = addHeadingIds(html, id);
    html = rewriteLocalAnchors(html, id);
    html = rewriteChapterLinks(html);
    html = rewriteRepoLinks(html);
    return `<section class="chapter" id="${id}">${html}</section>`;
  });
  return `<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Loom — Manual</title>
<style>${cssText}</style></head><body>${sections.join('\n')}</body></html>`;
}
