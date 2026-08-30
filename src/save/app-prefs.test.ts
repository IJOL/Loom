// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { appPrefs, setAppPrefs } from './app-prefs';

beforeEach(() => localStorage.clear());

describe('arrange view state prefs', () => {
  it('round-trips zoom and scroll', () => {
    setAppPrefs({ arrangePxPerBar: 120, arrangeScrollLeft: 340 });
    expect(appPrefs().arrangePxPerBar).toBe(120);
    expect(appPrefs().arrangeScrollLeft).toBe(340);
  });

  it('garbage in storage falls back to the defaults, field by field', () => {
    localStorage.setItem('loom-app-prefs-v1', JSON.stringify({ arrangePxPerBar: -3, arrangeScrollLeft: 'x' }));
    expect(appPrefs().arrangePxPerBar).toBe(80);
    expect(appPrefs().arrangeScrollLeft).toBe(0);
  });

  it('view-state writes leave the autosave flag alone', () => {
    setAppPrefs({ autosave: true });
    setAppPrefs({ arrangePxPerBar: 200 });
    expect(appPrefs().autosave).toBe(true);
  });
});
