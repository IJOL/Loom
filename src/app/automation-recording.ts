import type { KnobHandle } from '../core/knob';

export interface AutomationRecorder {
  registry: Map<string, KnobHandle>;
  registerKnob(k: KnobHandle): void;
}

/** The knob registry: every automatable control registers here by its
 *  `meta.id`, so modulation, per-clip automation, and Performance-view
 *  automation can resolve a knob by param id.
 *
 *  (The old "record knob moves into the global pattern" recorder lived here
 *  too — that's gone with the Classic pattern; the Performance feature owns the
 *  REC behaviour now and wraps `onValueChanged` itself.) */
export function createAutomationRecorder(): AutomationRecorder {
  const registry = new Map<string, KnobHandle>();
  return {
    registry,
    registerKnob(k: KnobHandle) {
      if (!k.meta.id) return;
      registry.set(k.meta.id, k);
    },
  };
}
