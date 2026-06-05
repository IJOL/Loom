import { describe, it, expect } from 'vitest';
import { resolveImageSrc, rewriteHtmlImageSrcs, rewriteChapterLinks, chapterId } from './assemble.mjs';

describe('resolveImageSrc', () => {
  it('rewrites a relative image path to a file:// URL under the manual dir', () => {
    const out = resolveImageSrc('images/transport.png', '/repo/docs/manual');
    expect(out.startsWith('file://')).toBe(true);
    expect(out).toContain('/docs/manual/images/transport.png');
  });
  it('leaves absolute http(s) and file URLs untouched', () => {
    expect(resolveImageSrc('https://x/y.png', '/m')).toBe('https://x/y.png');
    expect(resolveImageSrc('file:///a/b.png', '/m')).toBe('file:///a/b.png');
  });
});

describe('rewriteHtmlImageSrcs', () => {
  it('rewrites only relative <img src> values', () => {
    const html = '<img src="images/a.png" alt="a"><img src="https://x/b.png">';
    const out = rewriteHtmlImageSrcs(html, '/repo/docs/manual');
    expect(out).toContain('file://');
    expect(out).toContain('/docs/manual/images/a.png');
    expect(out).toContain('https://x/b.png');
  });
});

describe('chapterId', () => {
  it('maps README to "top" and strips .md otherwise', () => {
    expect(chapterId('README.md')).toBe('top');
    expect(chapterId('10-performance-and-arrangement.md')).toBe('10-performance-and-arrangement');
  });
});

describe('rewriteChapterLinks', () => {
  it('rewrites inter-chapter .md links to in-page anchors (sub-anchor dropped)', () => {
    expect(rewriteChapterLinks('<a href="02-transport.md">x</a>'))
      .toBe('<a href="#02-transport">x</a>');
    expect(rewriteChapterLinks('<a href="05-editing-clips.md#velocity--dynamics">x</a>'))
      .toBe('<a href="#05-editing-clips">x</a>');
    expect(rewriteChapterLinks('<a href="README.md">home</a>'))
      .toBe('<a href="#top">home</a>');
  });
  it('leaves external and non-.md links untouched', () => {
    const ext = '<a href="https://ijol.github.io/Loom/">live</a>';
    expect(rewriteChapterLinks(ext)).toBe(ext);
    const pdf = '<a href="Loom-Manual.pdf">pdf</a>';
    expect(rewriteChapterLinks(pdf)).toBe(pdf);
  });
});
