// src/modulation/modulator-registry.ts
// The one door for "what is this modulator and what can it do". A modulator
// kind is a REGISTERED COMPONENT, never a string the core compares against.
// When a plugin can register one (Task 9) this same function answers from the
// manifest instead, and no caller notices.
import type { TemplateResult } from 'lit-html';
import type { ModulatorState, ModulatorScope, ModulatorVoice } from './types';
import type { EngineParamSpec } from '../engines/engine-params';
import type { PanelCtx } from './mod-ui-shared';

export interface ModulatorComponent {
  id: string;
  name: string;
  /** What drives the value. 'time' runs off the clock (LFO, S&H) and travels
   *  the worklet's per-sample offset sum; 'gate' is driven by the note (ADSR)
   *  and travels the renderer's per-voice envelope road instead. */
  driver: 'time' | 'gate' | 'trigger';
  /** Scopes this modulator supports. The FIRST is the default for a new
   *  instance; there is deliberately no separate defaultScope field. */
  scopes: ModulatorScope[];
  /** Prefix for generated instance ids ('lfo' → lfo1, lfo2…). */
  idPrefix: string;
  defaultState(id: string): ModulatorState;
  /** Settings the host renders when the component brings no template of its
   *  own. A plugin can only take this route: its compiled main.js cannot
   *  import our bundled lit-html. */
  params?: EngineParamSpec[];
  /** Optional hand-built config row, for a panel the generic grid cannot
   *  express. The LFO has one by legacy, not by rule. */
  configTemplate?(mod: ModulatorState, ctx: PanelCtx): TemplateResult;
  createVoice(
    ctx: AudioContext,
    opts: { state: ModulatorState; bpm: () => number },
  ): ModulatorVoice;
}

const components = new Map<string, ModulatorComponent>();

export function registerModulator(c: ModulatorComponent): void {
  components.set(c.id, c);
}

/** Reverses registerModulator for one id — the rollback half of a plugin
 *  modulator's registration, used when the plugin's own main.js throws after
 *  the modulator was already adopted. See plugin-host.ts. */
export function unregisterModulator(id: string): void {
  components.delete(id);
}

export function getModulator(id: string): ModulatorComponent | undefined {
  return components.get(id);
}

/** The component `id`, or a throw naming it. For a caller that cannot carry on
 *  without it — an engine building the default modulator set it ships with. The
 *  guard used to be written out at every such call site, which meant the same
 *  three lines and the same id-inside-an-error-string repeated in eight engine
 *  files. */
export function requireModulator(id: string): ModulatorComponent {
  const c = components.get(id);
  if (!c) throw new Error(`unknown modulator kind: ${id}`);
  return c;
}

export function listModulators(): ModulatorComponent[] {
  return [...components.values()];
}

/** Test-only. */
export function __resetModulators(): void {
  components.clear();
}
