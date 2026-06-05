import { describe, it, expect } from 'vitest';
import { resolveImageSrc, rewriteHtmlImageSrcs } from './assemble.mjs';

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
