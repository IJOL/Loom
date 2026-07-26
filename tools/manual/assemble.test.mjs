import { describe, it, expect } from 'vitest';
import {
  resolveImageSrc,
  rewriteHtmlImageSrcs,
  rewriteChapterLinks,
  chapterId,
  slugifyHeading,
  addHeadingIds,
  rewriteLocalAnchors,
  rewriteRepoLinks,
} from './assemble.mjs';

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
  it('rewrites inter-chapter .md links to in-page anchors', () => {
    expect(rewriteChapterLinks('<a href="02-transport.md">x</a>'))
      .toBe('<a href="#02-transport">x</a>');
    expect(rewriteChapterLinks('<a href="README.md">home</a>'))
      .toBe('<a href="#top">home</a>');
  });
  it('keeps the sub-anchor, aimed at the target chapter’s heading id', () => {
    expect(rewriteChapterLinks('<a href="05-editing-clips.md#velocity--dynamics">x</a>'))
      .toBe('<a href="#05-editing-clips--velocity--dynamics">x</a>');
  });
  it('leaves external and non-.md links untouched', () => {
    const ext = '<a href="https://ijol.github.io/Loom/">live</a>';
    expect(rewriteChapterLinks(ext)).toBe(ext);
    const pdf = '<a href="Loom-Manual.pdf">pdf</a>';
    expect(rewriteChapterLinks(pdf)).toBe(pdf);
  });
  it('leaves a .md link that points outside the manual alone', () => {
    const out = '<a href="../../tools/stem-service/README.md">service</a>';
    expect(rewriteChapterLinks(out)).toBe(out);
  });
});

describe('slugifyHeading', () => {
  it('anchors a heading the way GitHub does', () => {
    expect(slugifyHeading('Master FX panel')).toBe('master-fx-panel');
    expect(slugifyHeading('Oscillator extras: PW and Sync')).toBe('oscillator-extras-pw-and-sync');
    expect(slugifyHeading('Unison, Detune and Drift')).toBe('unison-detune-and-drift');
    expect(slugifyHeading('Stem separation (optional, local service)'))
      .toBe('stem-separation-optional-local-service');
  });
  it('drops a removed character without closing the gap around it', () => {
    // "—" and "&" vanish, but the spaces on both sides each become a hyphen.
    expect(slugifyHeading('SENDS — Send A and Send B')).toBe('sends--send-a-and-send-b');
    expect(slugifyHeading('Velocity &amp; dynamics')).toBe('velocity--dynamics');
  });
  it('reads through inline markup', () => {
    expect(slugifyHeading('The <code>KITS</code> array')).toBe('the-kits-array');
  });
});

describe('addHeadingIds', () => {
  it('namespaces every heading id by chapter', () => {
    expect(addHeadingIds('<h2>Master FX panel</h2>', '07-mixing-and-fx'))
      .toBe('<h2 id="07-mixing-and-fx--master-fx-panel">Master FX panel</h2>');
  });
  it('numbers a heading repeated inside one chapter', () => {
    const out = addHeadingIds('<h3>Filter</h3><h3>Filter</h3>', '04-engines');
    expect(out).toContain('id="04-engines--filter"');
    expect(out).toContain('id="04-engines--filter-1"');
  });
  it('keeps the heading text and level intact', () => {
    expect(addHeadingIds('<h1>Loom — Manual</h1>', 'top'))
      .toBe('<h1 id="top--loom--manual">Loom — Manual</h1>');
  });
});

describe('rewriteRepoLinks', () => {
  it('sends a link out of the manual to the file on GitHub', () => {
    expect(rewriteRepoLinks('<a href="../../src/app/lane-allocator.ts">a</a>'))
      .toBe('<a href="https://github.com/IJOL/Loom/blob/main/src/app/lane-allocator.ts">a</a>');
    expect(rewriteRepoLinks('<a href="../../tools/stem-service/README.md">s</a>'))
      .toBe('<a href="https://github.com/IJOL/Loom/blob/main/tools/stem-service/README.md">s</a>');
  });
  it('leaves in-manual links and image sources alone', () => {
    const html = '<a href="#04-engines">e</a><img src="images/a.png">';
    expect(rewriteRepoLinks(html)).toBe(html);
  });
});

describe('rewriteLocalAnchors', () => {
  it('points a chapter’s own #section links at its namespaced ids', () => {
    expect(rewriteLocalAnchors('<a href="#sampler">S</a>', '08-midi-and-samples'))
      .toBe('<a href="#08-midi-and-samples--sampler">S</a>');
  });
  it('leaves links that are not in-page anchors alone', () => {
    const html = '<a href="04-engines.md">e</a><img src="images/a.png">';
    expect(rewriteLocalAnchors(html, '08-midi-and-samples')).toBe(html);
  });
});
