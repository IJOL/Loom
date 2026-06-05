// src/control/control-mediator.ts
import type {
  ControlEvent, ControllerProfile, LoomControlFacade, KnobBank, Variant, SendFn,
} from './controller-profile';

export interface MediatorDeps {
  facade: LoomControlFacade;
  profile: ControllerProfile;
  send: SendFn;
  variant: Variant;
}

export interface Mediator {
  handle(ev: ControlEvent): void;
  refreshLeds(): void;
  dispose(): void;
}

const EQ_BANDS: Array<'low' | 'mid' | 'high'> = ['low', 'mid', 'high'];

export function createMediator(deps: MediatorDeps): Mediator {
  const { facade, profile, send, variant } = deps;
  let bank: KnobBank = 'device';
  const lastLed = new Map<string, string>();   // key → JSON(data); for delta send (Task 10)

  function handleKnob(index: number, value01: number): void {
    const active = facade.getActiveLane();
    const lanes = facade.laneIds();
    switch (bank) {
      case 'device': {
        if (!active) return;
        const ids = facade.engineParamIds(active);
        const id = ids[index];
        if (id) facade.setEngineParam(active, id, value01);
        return;
      }
      case 'volume': {
        const lane = lanes[index];
        if (lane) facade.setLaneVolume(lane, value01);
        return;
      }
      case 'pan': {
        const lane = lanes[index];
        if (lane) facade.setLanePan(lane, value01);
        return;
      }
      case 'send': {
        if (!active) return;
        const band = EQ_BANDS[index];
        if (band) facade.setLaneEq(active, band, value01);
        return;
      }
    }
  }

  function handleSelectLane(delta: 1 | -1): void {
    const lanes = facade.laneIds();
    if (lanes.length === 0) return;
    const active = facade.getActiveLane();
    const cur = active ? lanes.indexOf(active) : -1;
    const next = Math.max(0, Math.min(lanes.length - 1, cur + delta));
    const target = lanes[next];
    if (target) facade.setActiveLane(target);
  }

  function refreshLeds(): void {
    const view = facade.buildSurfaceView(variant, bank);
    const cmds = profile.render(view);
    for (const cmd of cmds) {
      const enc = JSON.stringify(cmd.data);
      if (lastLed.get(cmd.key) === enc) continue;  // delta: only send changes
      lastLed.set(cmd.key, enc);
      send(cmd.data);
    }
  }

  function handle(ev: ControlEvent): void {
    const active = facade.getActiveLane();
    switch (ev.type) {
      case 'noteOn':  if (active) facade.playLiveNote(active, ev.midi, ev.velocity); break;
      case 'noteOff': if (active) facade.releaseLiveNote(active, ev.midi); break;
      case 'sustain': facade.setSustain(ev.on); break;
      case 'padPress': {
        const lane = facade.laneIds()[ev.col];
        if (lane) facade.launchClip(lane, ev.row);
        break;
      }
      case 'sceneLaunch': facade.launchScene(ev.row); break;
      case 'stopAll': facade.stopAll(); break;
      case 'knob': handleKnob(ev.index, ev.value01); break;
      case 'knobBank': bank = ev.bank; refreshLeds(); break;
      case 'selectLane': handleSelectLane(ev.delta); break;
      case 'nav': break;   // reserved for banking (v1: ignored)
    }
  }

  const unsub = facade.onStateChange(() => refreshLeds());

  return {
    handle,
    refreshLeds,
    dispose() { unsub(); lastLed.clear(); },
  };
}
