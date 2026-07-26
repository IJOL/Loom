// Right-click a knob to jump to (or create) its automation — the whole dep
// bundle the context menu needs, in one place.
//
// The cohesion is that every field here answers the same question: given the
// knob under the cursor, WHERE does its automation live and how do we show it.
// Four of them are pure reads of the world the menu decides against (the
// destination catalogue, the session state, its meter, which clips are playing,
// the arrangement); the other four are the four ways the menu acts on that
// answer — open the clip that holds the envelope, add a timeline curve, refresh
// after an edit, scroll the timeline to the curve. Split them across files and
// the next person adds a fifth reader of `sessionHost.state` that disagrees.
//
// ORDER, and it is the reason this is a factory instead of an inline block:
// the caller must run this AFTER createPerformanceFeature has installed its own
// registerKnob hook. `onRegisterKnob` is the wrap-and-replay idiom main.ts owns
// — it wraps `automation.registerKnob` and then replays the new hook over every
// already-mounted knob, so knobs mounted during boot get the menu too. The two
// wraps compose; swapping them changes which hook sees a newly-mounted knob
// first, so this call site cannot drift above the feature's.
//
// `performanceFeature` is held BY VALUE, not behind a getter: it is built
// earlier in boot than this wiring runs, and TypeScript rejects the call if that
// is ever reversed. The reads it does (`getMode`, `arrangement`, `addCurve`) all
// happen inside a contextmenu handler, so they still see the live object.

import type { KnobHandle } from '../core/knob';
import type { Sequencer } from '../core/sequencer';
import type { SessionHost } from '../session/session-host';
import type { DestinationRegistry } from '../automation/destination-registry';
import type { PerformanceFeature } from './performance-feature';
import { attachKnobAutomationMenu } from '../automation/knob-automation-menu';

export interface KnobMenuWiringDeps {
  /** main.ts's wrap-and-replay hook over `automation.registerKnob`: installs the
   *  hook for future knobs AND replays it over every knob already mounted. Must
   *  already carry the Performance feature's own hook when this runs. */
  onRegisterKnob(hook: (k: KnobHandle) => void): void;
  /** The one automatable-param catalogue the menu resolves a knob's id against. */
  destinations: DestinationRegistry;
  /** Source of the session state, its playing lanes, the inspector the menu
   *  opens a clip in, and the re-render that makes the open clip visible. */
  sessionHost: SessionHost;
  /** Read for `seq.meter` only — a menu-created clip envelope must be sized with
   *  the same time signature a panel-created one is. */
  seq: Sequencer;
  /** Held by value: createPerformanceFeature runs earlier in boot. Supplies the
   *  current mode, the arrangement to read curves from, and the undoable
   *  addCurve the menu mutates through. */
  performanceFeature: PerformanceFeature;
}

// Task 4: right-click a knob to jump to (or create) its automation. Uses the
// same registerKnob wrap-and-replay idiom above so knobs mounted during boot
// — before this line runs — still get the menu, not just knobs mounted after.
export function wireKnobAutomationMenu(deps: KnobMenuWiringDeps): void {
  const { onRegisterKnob, destinations, sessionHost, seq, performanceFeature } = deps;
  onRegisterKnob((k) => {
    attachKnobAutomationMenu(k, {
      destinations,
      getMode: () => performanceFeature.getMode(),
      getState: () => sessionHost.state,
      getMeter: () => seq.meter,
      getLaneStates: () => sessionHost.laneStates,
      getArrangement: () => performanceFeature.arrangement,
      openClip: (laneId, clipIdx) => {
        // Same four-call recipe as session-host-callbacks.ts onClipClick:
        // setSelectedClip alone shows nothing.
        sessionHost.inspector.setSelectedClip({ laneId, clipIdx });
        sessionHost.inspector.openInspector();
        document.getElementById('session-inspector')?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        sessionHost.renderWithMixer();
      },
      addTimelineCurve: (paramId) => performanceFeature.addCurve(paramId),
      onClipEdited: () => sessionHost.inspector.refreshContext(),
      revealTimelineCurve: (paramId) => {
        const row = document.querySelector<HTMLElement>(
          `#performance-view-root [data-param-id="${CSS.escape(paramId)}"]`,
        );
        row?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      },
    });
  });
}
