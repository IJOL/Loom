// src/modulation/modulation-ui.test-helpers.ts
// Fixtures for modulation-ui.test.ts. Kept in a `.test-helpers.ts` file rather
// than a `.test.ts` one so vitest's `src/**/*.test.ts` include glob does not
// try to collect it as a suite.

import { vi } from 'vitest';
import type { ModulationUIDeps } from './modulation-ui';
import {
  makeDefaultLFO, makeDefaultADSR,
  type ModulationHost, type ModulatorState, type ModulationConnection,
} from './types';
import type { KnobHandle } from '../core/knob';
import type { AutomationTarget } from '../automation/automation-targets';
import type { DestinationRegistry } from '../automation/destination-registry';

export function makeHost(initial: ModulatorState[] = []): ModulationHost {
  const modulators: ModulatorState[] = [...initial];
  // The real ModulationHostImpl numbers per kind (lfo1, adsr1, …), not with one
  // shared counter (which would give lfo1, adsr2). Mirror it so the fake does
  // not mis-model the real system.
  let lfoN = 0;
  let adsrN = 0;
  return {
    modulators,
    addModulator: vi.fn((kind: 'lfo' | 'adsr') => {
      const id = kind === 'lfo' ? `lfo${++lfoN}` : `adsr${++adsrN}`;
      const m = kind === 'lfo' ? makeDefaultLFO(id) : makeDefaultADSR(id);
      modulators.push(m);
      return m;
    }),
    removeModulator: vi.fn((id: string) => {
      const i = modulators.findIndex((m) => m.id === id);
      if (i >= 0) modulators.splice(i, 1);
    }),
    setConnection: vi.fn((modId: string, conn: ModulationConnection) => {
      const m = modulators.find((x) => x.id === modId);
      if (!m) return;
      const i = m.connections.findIndex((c) => c.id === conn.id);
      if (i >= 0) m.connections[i] = conn;
      else m.connections.push(conn);
    }),
    removeConnection: vi.fn((modId: string, connId: string) => {
      const m = modulators.find((x) => x.id === modId);
      if (m) m.connections = m.connections.filter((c) => c.id !== connId);
    }),
    spawnVoice: vi.fn(() => new Map()),
    spawnVoiceFiltered: vi.fn(() => new Map()),
    serialize: vi.fn(() => modulators),
    deserialize: vi.fn(),
  } as unknown as ModulationHost;
}

export function target(
  id: string, laneId: string, laneName: string, label = id,
): AutomationTarget {
  return { id, laneId, laneName, label, min: 0, max: 1 };
}

/** The destinations this lane's binder can actually reach, plus one from another
 *  lane and one send-rack param — both of which the panel must filter out. */
export const DEFAULT_TARGETS: AutomationTarget[] = [
  target('bass.filter.cutoff',    'bass',       'TB-303 1', 'Cutoff'),
  target('bass.filter.resonance', 'bass',       'TB-303 1', 'Resonance'),
  target('fx.master.fx:c1.mix',   'fx.master',  'Master',   'Reverb Mix'),
  target('lead.filter.cutoff',    'lead',       'Lead',     'Cutoff'),
  target('fx.send.a.fx:s1.mix',   'fx.send.a',  'Send A',   'Mix'),
];

export interface FakeRegistry extends DestinationRegistry {
  /** Listeners currently subscribed — the AbortController contract is that this
   *  never grows past one per container. */
  listenerCount(): number;
  setTargets(next: AutomationTarget[]): void;
}

export function makeDestinations(initial = DEFAULT_TARGETS): FakeRegistry {
  let targets = [...initial];
  const listeners = new Set<() => void>();
  return {
    list: () => targets,
    subscribe(fn: () => void) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    invalidate() {
      for (const fn of [...listeners]) fn();
    },
    listenerCount: () => listeners.size,
    setTargets(next) { targets = [...next]; },
  };
}

export function makeDeps(
  host: ModulationHost,
  over: Partial<ModulationUIDeps> = {},
): ModulationUIDeps {
  const registry = new Map<string, KnobHandle>();
  return {
    engineId: 'tb303',
    laneId: 'bass',
    host,
    registry,
    registerKnob: vi.fn(),
    onChange: vi.fn(),
    onLiveEdit: vi.fn(),
    destinations: makeDestinations(),
    ...over,
  };
}

/** Visibility without committing to the mechanism (inline style vs `hidden`),
 *  so a change from `style.display` to a `[hidden]` wrapper does not need the
 *  assertions rewritten. */
export function isVisible(el: HTMLElement | null): boolean {
  if (!el) return false;
  for (let n: HTMLElement | null = el; n; n = n.parentElement) {
    if (n.hasAttribute('hidden')) return false;
    if (n.style.display === 'none') return false;
  }
  return true;
}

export function byText(root: ParentNode, sel: string, text: string): HTMLElement {
  const el = [...root.querySelectorAll<HTMLElement>(sel)]
    .find((e) => e.textContent?.trim() === text);
  if (!el) throw new Error(`no ${sel} with text "${text}"`);
  return el;
}

/** `.radio-btn`s may hold an SVG glyph with empty textContent (the waveform
 *  options), so `title` is the only stable handle. */
export function byTitle(root: ParentNode, sel: string, title: string): HTMLElement {
  const el = [...root.querySelectorAll<HTMLElement>(sel)]
    .find((e) => e.getAttribute('title') === title);
  if (!el) throw new Error(`no ${sel} with title "${title}"`);
  return el;
}

/** The knob wrapper whose `.knob-label` reads `label`. */
export function knobByLabel(root: ParentNode, label: string): HTMLElement | null {
  const lab = [...root.querySelectorAll<HTMLElement>('.knob-label')]
    .find((e) => e.textContent?.trim() === label);
  return lab?.parentElement ?? null;
}

/** Pulls a registered handle back out of the `registerKnob` mock, which is how
 *  automation and MIDI-learn would reach it. */
export function knobHandleById(deps: ModulationUIDeps, id: string): KnobHandle | undefined {
  const calls = (deps.registerKnob as unknown as { mock: { calls: Array<[KnobHandle]> } }).mock.calls;
  return calls.map(([k]) => k).find((k) => k.meta.id === id);
}

export function destOptionValues(root: ParentNode): string[] {
  const sel = root.querySelector<HTMLSelectElement>('.mod-dest-select');
  return sel ? [...sel.querySelectorAll('option')].map((o) => o.value) : [];
}

export function destGroupLabels(root: ParentNode): string[] {
  const sel = root.querySelector<HTMLSelectElement>('.mod-dest-select');
  return sel ? [...sel.querySelectorAll('optgroup')].map((g) => g.label) : [];
}
