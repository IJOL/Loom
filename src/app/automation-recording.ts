import type { Sequencer } from '../core/sequencer';
import type { KnobHandle } from '../core/knob';
import { AUTOMATION_SUB_RES, type AutomationLane } from '../core/pattern';
import { clamp01 } from '../automation/automation-painter';

export interface AutomationRecorderDeps {
  seq: Sequencer;
  getAutoAbsSubIdx(): number;
  onLaneAdded(): void;
}

export interface AutomationRecorder {
  registry: Map<string, KnobHandle>;
  registerKnob(k: KnobHandle): void;
  recordValue(paramId: string, value: number): void;
  setRecording(on: boolean): void;
  isRecording(): boolean;
  wireRecButton(btn: HTMLButtonElement): void;
}

export function createAutomationRecorder(deps: AutomationRecorderDeps): AutomationRecorder {
  const registry = new Map<string, KnobHandle>();
  let recording = false;

  const recordValue = (paramId: string, value: number) => {
    const entry = registry.get(paramId);
    if (!entry) return;
    const range = entry.meta.max - entry.meta.min;
    if (range === 0) return;
    const norm = clamp01((value - entry.meta.min) / range);
    let lane = deps.seq.pattern.automation.find((l: AutomationLane) => l.paramId === paramId);
    if (!lane) {
      const lengthBars = Math.max(1, deps.seq.length / 16);
      const total = lengthBars * 16 * AUTOMATION_SUB_RES;
      lane = {
        paramId, enabled: true, stepped: false, lengthBars,
        values: Array.from({ length: total }, () => norm),
      };
      deps.seq.pattern.automation.push(lane);
      deps.onLaneAdded();
    }
    const idx = deps.getAutoAbsSubIdx() % lane.values.length;
    lane.values[idx] = norm;
    if (idx > 0) lane.values[idx - 1] = (lane.values[idx - 1] + norm) / 2;
    if (idx + 1 < lane.values.length) lane.values[idx + 1] = (lane.values[idx + 1] + norm) / 2;
  };

  return {
    registry,
    registerKnob(k: KnobHandle) {
      if (!k.meta.id) return;
      registry.set(k.meta.id, k);
      k.onValueChanged = (v, fromUser) => {
        if (fromUser && recording && deps.seq.isPlaying()) {
          recordValue(k.meta.id!, v);
        }
      };
    },
    recordValue,
    setRecording(on: boolean) { recording = on; },
    isRecording: () => recording,
    wireRecButton(btn: HTMLButtonElement) {
      btn.addEventListener('click', () => {
        recording = !recording;
        btn.classList.toggle('armed', recording);
        btn.textContent = recording ? '● REC ON' : '● REC';
      });
    },
  };
}
