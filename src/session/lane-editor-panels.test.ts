// src/session/lane-editor-panels.test.ts
import { describe, it, expect } from 'vitest';
import { laneEditorPanels } from './lane-editor-panels';

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
});
