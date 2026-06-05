// src/control/web-midi-access.ts
import type { ControlEvent, ControllerProfile, ParseCtx, MIDIPortInfo } from './controller-profile';
import { pickProfile, listProfiles } from './profile-registry';

export interface MidiAccessDeps {
  /** Injectable navigator (defaults to globalThis.navigator). */
  nav?: { requestMIDIAccess?: (opts?: { sysex?: boolean }) => Promise<any> };
}

export interface EnableOptions {
  onEvent?: (ev: ControlEvent) => void;
  onBindChange?: (info: BindInfo | null) => void;
  forceProfileId?: string;   // manual override from the UI
}

export interface BindInfo { profileId: string; variant: 'mk1' | 'mk2'; deviceName: string; }

export type EnableResult =
  | { ok: true; profileId: string; variant: 'mk1' | 'mk2'; deviceName: string }
  | { ok: false; reason: 'unsupported' | 'denied' | 'no-device' };

export interface MidiAccess {
  enable(opts?: EnableOptions): Promise<EnableResult>;
  disable(): void;
  send(bytes: number[]): void;
  isEnabled(): boolean;
  currentBind(): BindInfo | null;
}

export function createMidiAccess(deps: MidiAccessDeps = {}): MidiAccess {
  const nav = deps.nav ?? (globalThis as any).navigator;
  let access: any = null;
  let boundInput: any = null;
  let boundOutput: any = null;
  let profile: ControllerProfile | null = null;
  let parseCtx: ParseCtx = { variant: 'mk1' };
  let onEvent: ((ev: ControlEvent) => void) | undefined;
  let onBindChange: ((info: BindInfo | null) => void) | undefined;
  let forceProfileId: string | undefined;

  const portInfo = (p: any): MIDIPortInfo => ({ name: p.name ?? '', manufacturer: p.manufacturer ?? '', id: p.id });

  function send(bytes: number[]): void {
    boundOutput?.send(bytes);
  }

  function unbindCleanup(): void {
    if (profile?.onDisconnect && boundOutput) profile.onDisconnect((b) => send(b), parseCtx);
    if (boundInput) boundInput.onmidimessage = null;
    boundInput = null;
    boundOutput = null;
    profile = null;
    onBindChange?.(null);
  }

  function bindFromPorts(): boolean {
    const inputs: any[] = Array.from(access.inputs.values());
    if (inputs.length === 0) return false;
    // Choose the input: forced profile match, else best detect score.
    let chosenInput = inputs[0];
    let chosenProfile: ControllerProfile | null = null;
    if (forceProfileId) {
      chosenProfile = listProfiles().find((p) => p.id === forceProfileId) ?? null;
      chosenInput = inputs.find((i) => chosenProfile?.detect(portInfo(i)) ?? 0 > 0) ?? inputs[0];
    } else {
      let bestScore = -1;
      for (const i of inputs) {
        const p = pickProfile(portInfo(i));
        const score = p ? p.detect(portInfo(i)) : 0;
        if (score > bestScore) { bestScore = score; chosenProfile = p; chosenInput = i; }
      }
    }
    if (!chosenProfile) return false;
    profile = chosenProfile;
    boundInput = chosenInput;
    parseCtx = { variant: profile.variantFor(portInfo(chosenInput)) };
    // Pair an output by matching device name (fallback: first output).
    const outputs: any[] = Array.from(access.outputs.values());
    boundOutput = outputs.find((o) => o.name === chosenInput.name) ?? outputs[0] ?? null;

    boundInput.onmidimessage = (msg: { data: Uint8Array }) => {
      const evs = profile!.parse(msg.data, parseCtx);
      for (const e of evs) onEvent?.(e);
    };
    if (profile.onConnect && boundOutput) profile.onConnect((b) => send(b), parseCtx);
    const info: BindInfo = { profileId: profile.id, variant: parseCtx.variant, deviceName: chosenInput.name };
    onBindChange?.(info);
    return true;
  }

  async function enable(opts: EnableOptions = {}): Promise<EnableResult> {
    onEvent = opts.onEvent;
    onBindChange = opts.onBindChange;
    forceProfileId = opts.forceProfileId;
    if (!nav || typeof nav.requestMIDIAccess !== 'function') return { ok: false, reason: 'unsupported' };
    try {
      access = await nav.requestMIDIAccess({ sysex: true });
    } catch {
      return { ok: false, reason: 'denied' };
    }
    access.onstatechange = () => {
      // Re-bind on any hotplug change.
      if (boundInput && !access.inputs.has(boundInput.id)) unbindCleanup();
      if (!boundInput) bindFromPorts();
    };
    if (!bindFromPorts()) return { ok: false, reason: 'no-device' };
    return { ok: true, profileId: profile!.id, variant: parseCtx.variant, deviceName: boundInput.name };
  }

  function disable(): void {
    unbindCleanup();
    if (access) access.onstatechange = null;
    access = null;
  }

  return {
    enable, disable, send,
    isEnabled: () => !!boundInput,
    currentBind: () => (profile && boundInput
      ? { profileId: profile.id, variant: parseCtx.variant, deviceName: boundInput.name } : null),
  };
}
