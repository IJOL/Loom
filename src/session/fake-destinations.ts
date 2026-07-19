// Shared test-only stub for DestinationRegistry.
//
// SessionHostDeps.destinations and InspectorDeps.destinations are both
// required (see session-host-deps.ts for why the optional fallback that used
// to live in SessionHost.init() was deleted). Test fixtures that never
// exercise the automation-destination picker still need to satisfy the type;
// this no-op stub is that satisfaction, shared so every test file uses the
// SAME convention instead of re-declaring its own inline copy.
import type { DestinationRegistry } from '../automation/destination-registry';

export function fakeDestinations(): DestinationRegistry {
  return {
    list: () => [],
    subscribe: () => () => {},
    invalidate: () => {},
  };
}
