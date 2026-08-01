import { describe, it, expect, beforeEach } from 'vitest';
import {
  registerEngineCapabilities, clipContentOf, isAudioEngine, defaultNoteViewOf, acceptsAudioFile,
  acceptsNoteFx, isHarmonic, isListedInSelector, isRandomizable, __resetCapabilities,
} from './capabilities';
import { getEngine } from '../engines/registry';
import '../engines/audio';
import '../engines/sampler';
import '../engines/drums-engine';

const melodic = { clipContent: 'notes' as const, shortLabel: 'm', outputTrim: 1 };

describe('the three non-melodic in-tree engines', () => {
  // No beforeEach(__resetCapabilities) here on purpose, and placed before the
  // resetting describe below: this checks the real registrations made by the
  // imported engine files above, which a later __resetCapabilities() would wipe.

  it('los tres motores no-melodicos del arbol declaran sus capacidades', () => {
    expect(isAudioEngine('audio')).toBe(true);
    expect(acceptsAudioFile('audio')).toBe(true);
    expect(acceptsNoteFx('audio')).toBe(false);
    expect(isHarmonic('audio')).toBe(false);
    expect(isListedInSelector('audio')).toBe(false);

    expect(isAudioEngine('sampler')).toBe(false);
    expect(acceptsAudioFile('sampler')).toBe(true);
    expect(isHarmonic('sampler')).toBe(false);

    expect(isAudioEngine('drums-machine')).toBe(false);
    expect(defaultNoteViewOf('drums-machine')).toBe('pads');
    expect(acceptsNoteFx('drums-machine')).toBe(false);
    expect(isHarmonic('drums-machine')).toBe(false);
  });

  it('the sampler is a notes lane, like any other instrument', () => {
    // It accepts dropped audio files, which is a DIFFERENT question; if the two
    // were the same datum the sampler would be an audio channel.
    expect(isAudioEngine('sampler')).toBe(false);
    expect(acceptsAudioFile('sampler')).toBe(true);
  });

  it('the drum machine opens in the pad view, derived from its capability alone', () => {
    // One datum, one owner: `editor` is computed from defaultNoteView, so the two
    // cannot drift apart the way a hand-kept literal could.
    expect(getEngine('drums-machine')?.editor).toBe('drum-grid');
    expect(defaultNoteViewOf('drums-machine')).toBe('pads');
  });

  it('the sampler and the drum machine are notes lanes that cannot be randomized', () => {
    // Not derivable from clipContent: both are notes, and neither rolls a sound.
    expect(isRandomizable('sampler')).toBe(false);
    expect(isRandomizable('drums-machine')).toBe(false);
    expect(isRandomizable('audio')).toBe(false);
  });
});

describe('the capability door', () => {
  beforeEach(() => __resetCapabilities());

  it('a component that says nothing is an ordinary melodic instrument', () => {
    registerEngineCapabilities('quiet', melodic);
    expect(clipContentOf('quiet')).toBe('notes');
    expect(isAudioEngine('quiet')).toBe(false);
    expect(defaultNoteViewOf('quiet')).toBe('pitches');
    expect(acceptsNoteFx('quiet')).toBe(true);
    expect(isHarmonic('quiet')).toBe(true);
    expect(isListedInSelector('quiet')).toBe(true);
    expect(acceptsAudioFile('quiet')).toBe(false);
  });

  it('an unknown engine is a notes lane showing pitches', () => {
    expect(clipContentOf('nope')).toBe('notes');
    expect(defaultNoteViewOf('nope')).toBe('pitches');
    expect(isAudioEngine('nope')).toBe(false);
    expect(acceptsNoteFx('nope')).toBe(true);
  });

  it('an engine that asks for a waveform view is not an audio lane by that alone', () => {
    // The whole point: a UI preference must never decide what a clip IS.
    registerEngineCapabilities('note-engine', {
      clipContent: 'notes', defaultNoteView: 'pads', shortLabel: 'n', outputTrim: 1,
    });
    expect(isAudioEngine('note-engine')).toBe(false);
    expect(defaultNoteViewOf('note-engine')).toBe('pads');
  });

  it('an audio channel declares its own shape and the door honours it', () => {
    registerEngineCapabilities('probe-audio', {
      clipContent: 'audio', shortLabel: 'aud', outputTrim: 1,
      accepts: ['audio-file'], acceptsNoteFx: false, harmonic: false, listedInSelector: false,
    });
    expect(clipContentOf('probe-audio')).toBe('audio');
    expect(isAudioEngine('probe-audio')).toBe(true);
    expect(acceptsAudioFile('probe-audio')).toBe(true);
    expect(acceptsNoteFx('probe-audio')).toBe(false);
    expect(isHarmonic('probe-audio')).toBe(false);
    expect(isListedInSelector('probe-audio')).toBe(false);
  });

  it('the last registration wins, so a plugin can replace a built-in', () => {
    registerEngineCapabilities('dup', melodic);
    registerEngineCapabilities('dup', { ...melodic, defaultNoteView: 'pads' });
    expect(defaultNoteViewOf('dup')).toBe('pads');
  });

  it('an engine that says nothing is randomizable', () => {
    __resetCapabilities();
    registerEngineCapabilities('quiet', { clipContent: 'notes', shortLabel: 'q', outputTrim: 1 });
    expect(isRandomizable('quiet')).toBe(true);
  });
});
