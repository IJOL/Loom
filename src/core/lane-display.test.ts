// src/core/lane-display.test.ts

import { describe, it, expect } from 'vitest';
import {
  slugifyLaneName, trackIdToLaneId, laneIdToTrackId,
  laneDisplaySlug, formatParamIdForDisplay,
} from './lane-display';

describe('lane-display', () => {
  it('slugifyLaneName normalises spaces, slashes, case', () => {
    expect(slugifyLaneName('Subtractive 1')).toBe('subtractive-1');
    expect(slugifyLaneName('TB-303 1')).toBe('tb-303-1');
    expect(slugifyLaneName('Drums 1')).toBe('drums-1');
    expect(slugifyLaneName('Hi / Hat')).toBe('hi-hat');
    expect(slugifyLaneName(' Padding 2 ')).toBe('padding-2');
  });

  it('trackIdToLaneId maps legacy poly/drumBus to session laneIds', () => {
    expect(trackIdToLaneId('poly')).toBe('main');
    expect(trackIdToLaneId('drumBus')).toBe('drums');
    expect(trackIdToLaneId('bass')).toBe('bass');
    expect(trackIdToLaneId('poly1')).toBe('poly1');
  });

  it('laneIdToTrackId is the inverse for the renamed ids', () => {
    expect(laneIdToTrackId('main')).toBe('poly');
    expect(laneIdToTrackId('drums')).toBe('drumBus');
    expect(laneIdToTrackId('bass')).toBe('bass');
    expect(laneIdToTrackId('poly1')).toBe('poly1');
  });

  it('laneDisplaySlug uses the session lane name', () => {
    const lookup = (id: string) => ({
      bass: 'TB-303 1', main: 'Subtractive 1', drums: 'Drums 1', poly1: 'Subtractive 2',
    } as Record<string, string>)[id];
    expect(laneDisplaySlug('bass',    lookup)).toBe('tb-303-1');
    expect(laneDisplaySlug('poly',    lookup)).toBe('subtractive-1'); // track→lane→slug
    expect(laneDisplaySlug('drumBus', lookup)).toBe('drums-1');
    expect(laneDisplaySlug('poly1',   lookup)).toBe('subtractive-2');
  });

  it('laneDisplaySlug falls back to laneId when no display name found', () => {
    expect(laneDisplaySlug('main', () => undefined)).toBe('main');
  });

  it('formatParamIdForDisplay rewrites only the prefix segment', () => {
    const lookup = (id: string) => ({
      bass: 'TB-303 1', main: 'Subtractive 1',
    } as Record<string, string>)[id];
    expect(formatParamIdForDisplay('main.osc1.level', lookup)).toBe('subtractive-1.osc1.level');
    expect(formatParamIdForDisplay('bass.cutoff',     lookup)).toBe('tb-303-1.cutoff');
    expect(formatParamIdForDisplay('mix.bass.eqhi',   lookup)).toBe('mix.bass.eqhi'); // no lookup
  });

  it('formatParamIdForDisplay leaves prefixless ids alone', () => {
    expect(formatParamIdForDisplay('nodot', () => 'whatever')).toBe('nodot');
  });
});
