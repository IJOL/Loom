// src/session/lane-editor-panels.test.ts
import { describe, it, expect } from 'vitest';
import { laneEditorPanels } from './lane-editor-panels';
import { registerEngineCapabilities, __resetCapabilities } from '../plugins/capabilities';
import '../engines/audio';
import '../engines/drums-engine';
import '../engines/subtractive';

describe('laneEditorPanels', () => {
  it('audio lane shows NO instrument chrome but keeps inserts', () => {
    expect(laneEditorPanels('audio')).toEqual({
      engineParams: false, noteFx: false, preset: false, inserts: true, engineHeaderRow: false,
    });
  });
  it('a melodic engine shows everything', () => {
    expect(laneEditorPanels('subtractive')).toEqual({
      engineParams: true, noteFx: true, preset: true, inserts: true, engineHeaderRow: true,
    });
  });
  it('drums-machine keeps params/preset but no NOTE FX (unchanged behavior)', () => {
    expect(laneEditorPanels('drums-machine')).toEqual({
      engineParams: true, noteFx: false, preset: true, inserts: true, engineHeaderRow: true,
    });
  });

  it('an engine that declares no note-FX gets no note-FX panel, whatever its id', () => {
    __resetCapabilities();
    registerEngineCapabilities('probe-drums', {
      clipContent: 'notes', shortLabel: 'p', outputTrim: 1, acceptsNoteFx: false,
    });
    expect(laneEditorPanels('probe-drums').noteFx).toBe(false);
  });

  it('an audio-editor engine gets only its inserts', () => {
    __resetCapabilities();
    registerEngineCapabilities('probe-audio', {
      clipContent: 'audio', shortLabel: 'p', outputTrim: 1, acceptsNoteFx: false,
    });
    const p = laneEditorPanels('probe-audio');
    expect(p).toEqual({ engineParams: false, noteFx: false, preset: false, inserts: true, engineHeaderRow: false });
  });
});
