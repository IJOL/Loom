// Which part a lane plays, when two things have an opinion about it.
//
// This exists because "the 303 is a bass machine" used to be written as
// `engineId === 'tb303'` in two separate core files, which the project forbids
// and which let a 303 lane in WEAVE and the same lane in the inspector disagree
// about being a bass.
import { describe, it, expect, beforeEach } from 'vitest';
import { laneRoleOf } from './lane-role';
import { registerEngineCapabilities, __resetCapabilities } from '../plugins/capabilities';
import type { SessionLane } from './session-types';

const lane = (engineId: string, role?: SessionLane['role']): SessionLane =>
  ({ id: 'l1', engineId, role, clips: [], inserts: [] });

beforeEach(() => {
  __resetCapabilities();
  registerEngineCapabilities('tb303', {
    clipContent: 'notes', shortLabel: 'tb-303', outputTrim: 1, defaultRole: 'bass',
  });
  registerEngineCapabilities('subtractive', {
    clipContent: 'notes', shortLabel: 'sub', outputTrim: 1,
  });
  registerEngineCapabilities('drums-machine', {
    clipContent: 'notes', shortLabel: 'drums', outputTrim: 1, harmonic: false,
  });
});

describe('laneRoleOf', () => {
  it('answers with what the ENGINE is built for when nobody has marked the lane', () => {
    expect(laneRoleOf(lane('tb303'))).toBe('bass');
  });

  it('lets the user overrule the engine', () => {
    // The declaration is a default, not a verdict: a 303 played as a lead is a
    // thing people do, and the mark has to win or it is decoration.
    expect(laneRoleOf(lane('tb303', 'melody'))).toBe('melody');
  });

  it('leaves a general-purpose instrument unmarked', () => {
    // undefined is a real answer — every melodic shelf offered, which is what an
    // unmarked lane has always been offered. Not a gap to fill with a guess.
    expect(laneRoleOf(lane('subtractive'))).toBeUndefined();
  });

  it('refuses a role on a drum lane, even one the user put there', () => {
    // The engine-swap case: mark a lane Pad, swap it to the drum machine, and
    // without this it is offered chord shapes it cannot play.
    expect(laneRoleOf(lane('drums-machine', 'pad'))).toBeUndefined();
  });

  it('answers for a lane whose engine nobody registered', () => {
    // An unknown id must behave like an ordinary melodic instrument rather than
    // blanking the lane's material — the capability door's standing rule.
    expect(laneRoleOf(lane('never-heard-of-it'))).toBeUndefined();
    expect(laneRoleOf(lane('never-heard-of-it', 'pad'))).toBe('pad');
  });

  it('answers for no lane at all', () => {
    expect(laneRoleOf(undefined)).toBeUndefined();
  });
});
