import { describe, it, expect, afterEach } from 'vitest';
import { stemServiceBaseUrl, STEM_SERVICE_DEFAULT_URL } from './stem-config';

describe('stemServiceBaseUrl', () => {
  afterEach(() => { try { localStorage.removeItem('loomStemServiceUrl'); } catch { /* no DOM */ } });

  it('returns the default when nothing is overridden', () => {
    expect(stemServiceBaseUrl({})).toBe(STEM_SERVICE_DEFAULT_URL);
  });

  it('prefers an explicit override', () => {
    expect(stemServiceBaseUrl({ override: 'http://x:1' })).toBe('http://x:1');
  });

  it('strips a trailing slash', () => {
    expect(stemServiceBaseUrl({ override: 'http://x:1/' })).toBe('http://x:1');
  });
});
