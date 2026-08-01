import { describe, it, expect, beforeEach } from 'vitest';
import {
  registerEngineCapabilities, clipEditorFor, acceptsAudioFile,
  acceptsNoteFx, isHarmonic, isListedInSelector, __resetCapabilities,
} from './capabilities';
import '../engines/audio';
import '../engines/sampler';
import '../engines/drums-engine';

const melodic = { clipEditor: 'piano-roll' as const, shortLabel: 'm', outputTrim: 1 };

describe('the three non-melodic in-tree engines', () => {
  // No beforeEach(__resetCapabilities) here on purpose, and placed before the
  // resetting describe below: this checks the real registrations made by the
  // imported engine files above, which a later __resetCapabilities() would wipe.

  it('los tres motores no-melodicos del arbol declaran sus capacidades', () => {
    expect(clipEditorFor('audio')).toBe('audio');
    expect(acceptsAudioFile('audio')).toBe(true);
    expect(acceptsNoteFx('audio')).toBe(false);
    expect(isHarmonic('audio')).toBe(false);
    expect(isListedInSelector('audio')).toBe(false);

    expect(acceptsAudioFile('sampler')).toBe(true);
    expect(isHarmonic('sampler')).toBe(false);

    expect(clipEditorFor('drums-machine')).toBe('drum-grid');
    expect(acceptsNoteFx('drums-machine')).toBe(false);
  });
});

describe('the capability door', () => {
  beforeEach(() => __resetCapabilities());

  it('a component that says nothing is an ordinary melodic instrument', () => {
    registerEngineCapabilities('quiet', melodic);
    expect(clipEditorFor('quiet')).toBe('piano-roll');
    expect(acceptsNoteFx('quiet')).toBe(true);
    expect(isHarmonic('quiet')).toBe(true);
    expect(isListedInSelector('quiet')).toBe(true);
    expect(acceptsAudioFile('quiet')).toBe(false);
  });

  it('an unknown id answers as melodic, never undefined', () => {
    // An engine not yet registered must NOT blank out its lane's UI.
    expect(clipEditorFor('nope')).toBe('piano-roll');
    expect(acceptsNoteFx('nope')).toBe(true);
  });

  it('an audio channel declares its own shape and the door honours it', () => {
    registerEngineCapabilities('probe-audio', {
      clipEditor: 'audio', shortLabel: 'aud', outputTrim: 1,
      accepts: ['audio-file'], acceptsNoteFx: false, harmonic: false, listedInSelector: false,
    });
    expect(clipEditorFor('probe-audio')).toBe('audio');
    expect(acceptsAudioFile('probe-audio')).toBe(true);
    expect(acceptsNoteFx('probe-audio')).toBe(false);
    expect(isHarmonic('probe-audio')).toBe(false);
    expect(isListedInSelector('probe-audio')).toBe(false);
  });

  it('the last registration wins, so a plugin can replace a built-in', () => {
    registerEngineCapabilities('dup', melodic);
    registerEngineCapabilities('dup', { ...melodic, clipEditor: 'drum-grid' });
    expect(clipEditorFor('dup')).toBe('drum-grid');
  });
});
