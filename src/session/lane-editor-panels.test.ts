// src/session/lane-editor-panels.test.ts
import { describe, it, expect } from 'vitest';
import { laneEditorPanels } from './lane-editor-panels';
import { registerEngineCapabilities, __resetCapabilities } from '../plugins/capabilities';
import type { EngineCapabilities } from '@loom/plugin-sdk';
import { registerEngine } from '../engines/registry';
import { createDescriptorEngine } from '../engines/descriptor-engine';
import '../engines/audio';
import '../engines/drums-engine';
import '../engines/sampler';
import { registerPluginEngine } from '../../test/plugin-fixtures';

// subtractive and tb303 ship as plugins: the equivalent of the old
// side-effect import is that manifest going through the same adoptComponents
// door the plugin loader uses.
registerPluginEngine('subtractive');
registerPluginEngine('tb303');

/** A probe engine that is INSTALLED: capabilities AND a descriptor.
 *  laneEditorPanels discriminates on the descriptor, so capabilities on their
 *  own describe an engine that is not installed — which is a different test. */
function installProbeEngine(id: string, caps: EngineCapabilities): void {
  registerEngineCapabilities(id, caps);
  registerEngine(createDescriptorEngine({
    id, name: id, polyphony: 'poly', params: [], presets: () => [], modulators: [],
  }));
}

describe('laneEditorPanels', () => {
  it('audio lane shows NO instrument chrome but keeps inserts', () => {
    expect(laneEditorPanels('audio')).toEqual({
      engineParams: false, noteFx: false, preset: false, inserts: true,
      engineHeaderRow: false, dice: false, missingEngine: false,
    });
  });
  it('a melodic engine shows everything', () => {
    expect(laneEditorPanels('subtractive')).toEqual({
      engineParams: true, noteFx: true, preset: true, inserts: true,
      engineHeaderRow: true, dice: true, missingEngine: false,
    });
  });
  it('drums-machine keeps params/preset but no NOTE FX (unchanged behavior)', () => {
    expect(laneEditorPanels('drums-machine')).toEqual({
      engineParams: true, noteFx: false, preset: true, inserts: true,
      engineHeaderRow: true, dice: false, missingEngine: false,
    });
  });

  it('user: the sampler shows no dice — its sound is a loaded keymap, not params', () => {
    expect(laneEditorPanels('sampler').dice).toBe(false);
  });

  it('user: an engine that says nothing about rolling gets its dice', () => {
    __resetCapabilities();
    installProbeEngine('quiet', { clipContent: 'notes', shortLabel: 'q', outputTrim: 1 });
    expect(laneEditorPanels('quiet').dice).toBe(true);
  });

  it('an engine that declares no note-FX gets no note-FX panel, whatever its id', () => {
    __resetCapabilities();
    installProbeEngine('probe-drums', {
      clipContent: 'notes', shortLabel: 'p', outputTrim: 1, acceptsNoteFx: false,
    });
    expect(laneEditorPanels('probe-drums').noteFx).toBe(false);
  });

  it('an audio-editor engine gets only its inserts', () => {
    __resetCapabilities();
    installProbeEngine('probe-audio', {
      clipContent: 'audio', shortLabel: 'p', outputTrim: 1, acceptsNoteFx: false,
    });
    const p = laneEditorPanels('probe-audio');
    expect(p).toEqual({
      engineParams: false, noteFx: false, preset: false, inserts: true,
      engineHeaderRow: false, dice: false, missingEngine: false,
    });
  });

  it('an engine nobody registered shows the notice and no instrument panels', () => {
    // Nothing registers 'ghost'. Its lane must still exist and keep its inserts
    // — the strip is the host's, not the engine's — but every panel that would
    // read a descriptor is off, because there is no descriptor to read.
    const p = laneEditorPanels('ghost');
    expect(p.missingEngine).toBe(true);
    expect(p.engineParams).toBe(false);
    expect(p.preset).toBe(false);
    expect(p.noteFx).toBe(false);
    expect(p.engineHeaderRow).toBe(false);
    expect(p.dice).toBe(false);
    expect(p.inserts).toBe(true);
  });

  it('a registered engine is never reported as missing', () => {
    registerEngineCapabilities('present', { clipContent: 'notes', shortLabel: 'p', outputTrim: 1 });
    // Capabilities alone are NOT enough — the discriminator is the descriptor.
    // This asserts the two are not confused: 'present' answers every capability
    // like an ordinary melodic engine (that is the deliberate default) and is
    // STILL missing, because nothing registered anything to draw.
    expect(laneEditorPanels('present').missingEngine).toBe(true);
  });

  it('a real engine, registered the way every engine is, is not missing', () => {
    // The other half of the pair above: the 303 is imported at the top of this
    // file, which is what registers its descriptor. Without this case the two
    // `true`s above would also pass for a laneEditorPanels that always says
    // "missing".
    expect(laneEditorPanels('tb303').missingEngine).toBe(false);
  });
});
